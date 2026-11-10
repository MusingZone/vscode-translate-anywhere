'use strict';

const ONLINE_PROVIDERS = {
  google: { label: 'Google Translate (experimental)', url: 'https://translate.googleapis.com/translate_a/single' },
  mymemory: { label: 'MyMemory', url: 'https://api.mymemory.translated.net/get' }
};
const ONLINE_LANGUAGES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'uk',
  'ar', 'hi', 'vi', 'th', 'id', 'tr', 'pl', 'nl'];

// Keep paragraph boundaries and whitespace outside requests; MyMemory allows at most 500 UTF-8 bytes.
function splitSegments(text, maxBytes = 500) {
  const segments = [];
  for (const paragraph of text.split(/((?:\r\n|[\r\n])+)/)) {
    if (!paragraph) continue;
    if (/^\s+$/.test(paragraph)) { segments.push({ whitespace: paragraph }); continue; }
    let remaining = paragraph;
    while (remaining) {
      const leading = /^\s+/.exec(remaining)?.[0];
      if (leading) {
        segments.push({ whitespace: leading });
        remaining = remaining.slice(leading.length);
        continue;
      }
      let end = 0;
      let bytes = 0;
      let boundary = 0;
      for (const char of remaining) {
        const size = Buffer.byteLength(char);
        if (bytes + size > maxBytes) break;
        bytes += size;
        end += char.length;
        if (/\s/.test(char)) boundary = end - char.length;
      }
      if (!end) throw new Error('The translation segment limit is too small.');
      if (end < remaining.length && boundary > 0) end = boundary;
      const chunk = remaining.slice(0, end);
      const content = chunk.trimEnd();
      segments.push({ text: content });
      if (content.length < chunk.length) segments.push({ whitespace: chunk.slice(content.length) });
      remaining = remaining.slice(end);
    }
  }
  return segments;
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()];
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : whole;
  });
}

async function translateSegment({ provider, text, source, target, signal, fetchImpl }) {
  const preset = ONLINE_PROVIDERS[provider];
  const url = new URL(preset.url);
  if (provider === 'google') {
    url.search = new URLSearchParams({ client: 'gtx', sl: source, tl: target, dt: 't', q: text }).toString();
  } else {
    // MyMemory detects the source language itself when given "Autodetect".
    url.search = new URLSearchParams({ q: text, langpair: `${source === 'auto' ? 'Autodetect' : source}|${target}`, mt: '1' }).toString();
  }
  let response;
  try {
    response = await fetchImpl(url.toString(), { signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch (error) {
    signal.throwIfAborted();
    throw new Error(`${preset.label}: network request failed. Check connectivity / proxy settings.`, { cause: error });
  }
  if (!response.ok) {
    const limited = response.status === 429 || response.status === 503;
    throw Object.assign(new Error(`${preset.label}: HTTP ${response.status}.${limited ? (provider === 'google'
      ? ' Google is temporarily refusing requests from your network (common behind shared corporate proxies). Try again shortly or switch the online service to MyMemory in the Translate Anywhere sidebar.'
      : ' Rate limit reached; try later or choose another engine.') : ''}`), {
      retryable: limited, retryAfter: Number(response.headers?.get?.('retry-after')) || 0
    });
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`${preset.label}: invalid JSON response.`); }
  let translation;
  if (provider === 'google') {
    if (!Array.isArray(data) || !Array.isArray(data[0]) || !data[0].length ||
        !data[0].every(part => Array.isArray(part) && typeof part[0] === 'string')) {
      throw new Error(`${preset.label}: unexpected response format. The experimental endpoint may have changed.`);
    }
    translation = data[0].map(part => part[0]).join('');
  } else {
    if (data?.quotaFinished || Number(data?.responseStatus) === 429) {
      throw new Error('MyMemory: daily quota exhausted (anonymous allowance: 5,000 characters/day). Try later or choose another engine.');
    }
    if (Number(data?.responseStatus) !== 200 || data?.mtLangSupported === false) {
      throw new Error('MyMemory: translation rejected. Check the source/target language and service quota.');
    }
    translation = data?.responseData?.translatedText;
    if (typeof translation === 'string') translation = decodeEntities(translation);
  }
  if (typeof translation !== 'string' || !translation.trim() || translation.length > 6000) {
    throw new Error(`${preset.label}: empty or invalid translation.`);
  }
  return translation.trim();
}

// Google's refusals behind shared proxies are usually brief and tied to one egress node, so a rate-limited
// request is retried at most twice with backoff. All waits share one budget; a Retry-After beyond what is left
// is honoured by giving up instead of retrying early. Never another service.
const RETRY_DELAYS = [400, 1200];
const RETRY_BUDGET_MS = 3000;
async function translateWithRetry(options, delays = RETRY_DELAYS, budget = RETRY_BUDGET_MS) {
  let remaining = budget;
  for (let attempt = 0; ; attempt++) {
    try { return await translateSegment(options); }
    catch (error) {
      if (!error.retryable || attempt >= delays.length) throw error;
      const wait = Math.max(delays[attempt], error.retryAfter * 1000);
      if (wait > remaining) throw error;
      remaining -= wait;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { options.signal.removeEventListener('abort', abort); resolve(); }, wait);
        const abort = () => { clearTimeout(timer); reject(options.signal.reason); };
        options.signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
}

class OnlineTranslator {
  constructor({ fetchImpl = fetch, concurrency = 2, timeoutMs = 30000, retryDelays = RETRY_DELAYS, retryBudgetMs = RETRY_BUDGET_MS } = {}) {
    this.fetchImpl = fetchImpl;
    this.retryDelays = retryDelays;
    this.retryBudgetMs = retryBudgetMs;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
    this.active = 0;
    this.queue = [];
    this.cache = new Map();
  }

  async acquire(signal) {
    signal.throwIfAborted();
    if (this.active < this.concurrency) { this.active++; return; }
    if (this.queue.length >= 24) throw new Error('Online translation queue is full; try again shortly.');
    await new Promise((resolve, reject) => {
      const entry = { resolve: () => { signal.removeEventListener('abort', abort); resolve(); } };
      const abort = () => {
        this.queue.splice(this.queue.indexOf(entry), 1);
        reject(signal.reason);
      };
      this.queue.push(entry);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  release() {
    const next = this.queue.shift();
    if (next) next.resolve();
    else this.active--;
  }

  async translate({ provider, text, source = 'auto', target, signal, onDelta }) {
    if (!Object.hasOwn(ONLINE_PROVIDERS, provider)) throw new Error('Unknown online translation provider.');
    if (!ONLINE_LANGUAGES.includes(target) || !(source === 'auto' || ONLINE_LANGUAGES.includes(source))) {
      throw new Error('Unsupported online translation language.');
    }
    if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw new Error('Select between 1 and 1200 characters.');
    signal?.throwIfAborted();
    const key = JSON.stringify([provider, source, target, text]);
    if (this.cache.has(key)) return this.cache.get(key);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let acquired = false;
    try {
      await this.acquire(combined);
      acquired = true;
      combined.throwIfAborted();
      let translation = '';
      const segments = splitSegments(text, provider === 'mymemory' ? 500 : 1000);
      for (const segment of segments) {
        combined.throwIfAborted();
        const part = segment.whitespace ?? (source === target ? segment.text : await translateWithRetry({
          provider, text: segment.text, source, target, signal: combined, fetchImpl: this.fetchImpl
        }, this.retryDelays, this.retryBudgetMs));
        combined.throwIfAborted();
        translation += part;
        if (translation.length > 6000) throw new Error('Online translation exceeded 6000 characters.');
        onDelta?.(part);
        combined.throwIfAborted();
      }
      if (this.cache.size >= 300) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, translation);
      return translation;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (timeout.aborted) throw new Error('Online translation timed out after 30 s.');
      throw error;
    } finally {
      if (acquired) this.release();
    }
  }
}

module.exports = { ONLINE_PROVIDERS, ONLINE_LANGUAGES, OnlineTranslator, RETRY_BUDGET_MS, splitSegments };
