'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ONLINE_PROVIDERS, ONLINE_LANGUAGES, OnlineTranslator, splitSegments } = require('../src/online');

const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const google = text => json([[[text, 'source']], null, 'en']);
const mymemory = text => json({ responseStatus: 200, quotaFinished: false, responseData: { translatedText: text } });
const options = { provider: 'google', source: 'auto', target: 'zh-CN', text: 'Hello world.' };

test('online providers and languages match the manifest; existing users retain AI', () => {
  const properties = require('../package.json').contributes.configuration.properties;
  assert.deepEqual(properties['translateAnywhere.online.provider'].enum, Object.keys(ONLINE_PROVIDERS));
  assert.deepEqual(properties['translateAnywhere.targetLanguage'].enum, ONLINE_LANGUAGES);
  assert.deepEqual(properties['translateAnywhere.online.sourceLanguage'].enum, ['auto', ...ONLINE_LANGUAGES]);
  assert.equal(properties['translateAnywhere.translation.engine'].default, 'ai');
});

test('UTF-8 segmentation is lossless, within 500 bytes, and never joins paragraphs', () => {
  for (const text of ['hello world', '  a \r\n\r\n b\n', 'first\rsecond\r\nthird', '你好😀'.repeat(260), 'word '.repeat(400), 'x'.repeat(1200), '']) {
    const segments = splitSegments(text);
    assert.equal(segments.map(part => part.whitespace ?? part.text).join(''), text);
    for (const { text: part } of segments) {
      if (part === undefined) continue;
      assert.ok(part.length > 0);
      assert.ok(Buffer.byteLength(part) <= 500);
      assert.ok(!/[\r\n]/.test(part));
      assert.ok(!/[\ud800-\udbff]$/.test(part), 'no dangling high surrogate');
    }
  }
});

test('Google uses fixed HTTPS endpoint, no credentials, and joins response segments', async () => {
  const translator = new OnlineTranslator({ fetchImpl: async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, ONLINE_PROVIDERS.google.url);
    assert.equal(parsed.searchParams.get('q'), options.text);
    assert.equal(parsed.searchParams.get('sl'), 'auto');
    assert.equal(parsed.searchParams.get('tl'), 'zh-CN');
    assert.equal(parsed.searchParams.get('client'), 'gtx');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.deepEqual(init.headers, { Accept: 'application/json' });
    return json([[['你好', 'Hello'], ['世界。', 'world.']], null, 'en']);
  } });
  const deltas = [];
  assert.equal(await translator.translate({ ...options, onDelta: part => deltas.push(part) }), '你好世界。');
  assert.deepEqual(deltas, ['你好世界。']);
});

test('MyMemory uses Autodetect for an automatic source and splits long multibyte paragraphs without losing whitespace', async () => {
  let calls = 0;
  let pair = 'zh-CN|de';
  const translator = new OnlineTranslator({ fetchImpl: async url => {
    calls++;
    const params = new URL(url).searchParams;
    assert.equal(params.get('langpair'), pair);
    const text = params.get('q');
    assert.ok(Buffer.byteLength(text) <= 500);
    assert.ok(!text.includes('\n'));
    assert.equal(params.get('key'), null);
    assert.equal(params.get('de'), null, 'no email submitted');
    return mymemory(text);
  } });
  pair = 'Autodetect|zh-CN';
  assert.equal(await translator.translate({ ...options, provider: 'mymemory' }), options.text);
  assert.equal(calls, 1);
  pair = 'zh-CN|de';
  calls = 0;
  const text = ' \n' + '你好😀'.repeat(150) + '\n\n  第二段 ';
  assert.equal(await translator.translate({ provider: 'mymemory', text, source: 'zh-CN', target: 'de' }), text);
  assert.ok(calls > 3);
});

test('online cache is case-sensitive and isolated by provider, source and target', async () => {
  let calls = 0;
  const translator = new OnlineTranslator({ fetchImpl: async url => {
    calls++;
    return new URL(url).hostname === 'translate.googleapis.com' ? google('result') : mymemory('result');
  } });
  await translator.translate(options);
  await translator.translate(options);
  assert.equal(calls, 1);
  await translator.translate({ ...options, text: options.text.toLowerCase() });
  await translator.translate({ ...options, target: 'de' });
  await translator.translate({ ...options, source: 'en' });
  await translator.translate({ ...options, provider: 'mymemory', source: 'en' });
  assert.equal(calls, 5);
  for (let i = 0; i < 305; i++) await translator.translate({ ...options, text: String(i) });
  assert.equal(translator.cache.size, 300);
});

test('online failures are explicit, not cached and never fall back to another service', async () => {
  const cases = [
    [() => new Response('', { status: 429 }), /HTTP 429.*MyMemory/, 3],
    [() => new Response('', { status: 503 }), /HTTP 503/, 3],
    [() => new Response('', { status: 403 }), /HTTP 403/, 1],
    [() => new Response('<html>captcha</html>'), /invalid JSON/, 1],
    [() => json({ unexpected: true }), /unexpected response format/, 1],
    [() => google(''), /empty or invalid/, 1],
    [() => google('x'.repeat(6001)), /empty or invalid/, 1],
    [() => { throw new Error('URL containing private input'); }, /network request failed/, 1]
  ];
  for (const [response, expected, attempts] of cases) {
    let calls = 0;
    const translator = new OnlineTranslator({ retryDelays: [1, 1], fetchImpl: async url => {
      calls++;
      assert.equal(new URL(url).hostname, 'translate.googleapis.com');
      return response();
    } });
    await assert.rejects(translator.translate(options), expected);
    assert.equal(calls, attempts, 'only rate-limit responses are retried, at most twice, on the same service');
    assert.equal(translator.cache.size, 0);
  }
  for (const data of [
    { quotaFinished: true, responseStatus: 200 },
    { responseStatus: '429' },
    { responseStatus: 403 },
    { responseStatus: 200, mtLangSupported: false },
    { responseStatus: 200, responseData: { translatedText: 123 } },
    null
  ]) {
    const translator = new OnlineTranslator({ fetchImpl: async () => json(data) });
    await assert.rejects(translator.translate({ ...options, provider: 'mymemory', source: 'en' }), /quota|rejected|invalid/);
  }
});

test('MyMemory decodes entities as plain text, never markup', async () => {
  const translator = new OnlineTranslator({ fetchImpl: async () => mymemory('A &amp; B &lt;script&gt; &#x1F600; &#39; &#xD800;') });
  assert.equal(await translator.translate({ ...options, provider: 'mymemory', source: 'en' }), "A & B <script> 😀 ' &#xD800;");
});

test('online validates input before sending and same-language requests stay local', async () => {
  let calls = 0;
  const translator = new OnlineTranslator({ fetchImpl: async () => { calls++; return google('result'); } });
  for (const change of [{ provider: '__proto__' }, { target: 'xx' }, { source: 'xx' }, { text: '' }, { text: 123 }, { text: 'x'.repeat(1201) }]) {
    await assert.rejects(translator.translate({ ...options, ...change }));
  }
  assert.equal(await translator.translate({ ...options, source: 'en', target: 'en' }), options.text);
  assert.equal(calls, 0);
});

test('online bounds concurrency and removes cancelled queued work', async () => {
  const pending = [];
  let calls = 0;
  const translator = new OnlineTranslator({ concurrency: 1, fetchImpl: (_url, { signal }) => {
    calls++;
    return new Promise((resolve, reject) => {
      pending.push(() => resolve(google('translated')));
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } });
  const first = translator.translate(options);
  const controller = new AbortController();
  const cancelled = translator.translate({ ...options, text: 'second', signal: controller.signal });
  const third = translator.translate({ ...options, text: 'third' });
  const rejection = assert.rejects(cancelled, /cancel queued/);
  controller.abort(new Error('cancel queued'));
  await rejection;
  assert.equal(calls, 1);
  assert.equal(translator.queue.length, 1);
  pending.shift()();
  assert.equal(await first, 'translated');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  pending.shift()();
  assert.equal(await third, 'translated');
  assert.equal(translator.active, 0);
  assert.equal(translator.queue.length, 0);
});

test('aborting in flight prevents later segments, caching and success', async () => {
  const controller = new AbortController();
  let calls = 0;
  const translator = new OnlineTranslator({ fetchImpl: async () => { calls++; return mymemory('result'); } });
  await assert.rejects(translator.translate({
    ...options, provider: 'mymemory', source: 'en', text: 'a'.repeat(1100), signal: controller.signal,
    onDelta: () => controller.abort(new Error('permission revoked'))
  }), /permission revoked/);
  assert.equal(calls, 1);
  assert.equal(translator.cache.size, 0);
  assert.equal(translator.active, 0);
});

test('online timeout includes queue wait and releases all slots', async () => {
  const keepAlive = setInterval(() => {}, 100);
  try {
    const translator = new OnlineTranslator({ concurrency: 1, timeoutMs: 25, fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
    await Promise.all([
      assert.rejects(translator.translate(options), /timed out/),
      assert.rejects(translator.translate({ ...options, text: 'queued' }), /timed out/)
    ]);
    assert.equal(translator.active, 0);
    assert.equal(translator.queue.length, 0);
  } finally { clearInterval(keepAlive); }
});

test('default online limits are exactly two active and 24 queued; overflow never reaches the network', async () => {
  const controller = new AbortController();
  let calls = 0;
  const translator = new OnlineTranslator({ fetchImpl: (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const tasks = Array.from({ length: 26 }, (_, index) =>
    assert.rejects(translator.translate({ ...options, text: String(index), signal: controller.signal }), /cancel all/));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(translator.active, 2);
  assert.equal(translator.queue.length, 24);
  await assert.rejects(translator.translate({ ...options, text: 'overflow' }), /queue is full/);
  controller.abort(new Error('cancel all'));
  await Promise.all(tasks);
  assert.equal(calls, 2);
  assert.equal(translator.active, 0);
  assert.equal(translator.queue.length, 0);
});

test('authenticated bridge revocation reaches the owner even when integration is disabled; it cannot grant consent', async () => {
  const { createBridge } = require('../src/bridge');
  const revoked = [];
  const server = await createBridge({
    token: 'test-secret', isEnabled: () => false, port: 0, onError: error => { throw error; },
    onRevokeOnline: async provider => revoked.push(provider)
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/online/revoke`;
    const headers = { Origin: 'vscode-file://vscode-app', 'X-Immersive-Token': 'test-secret', 'Content-Type': 'application/json' };
    const send = (body, overrides = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(body) });
    assert.equal((await send({ provider: 'google' }, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await send({ provider: 'google' }, { 'X-Immersive-Token': 'wrong' })).status, 401);
    assert.equal((await send({ provider: 'invalid' })).status, 400);
    assert.deepEqual(revoked, []);
    assert.deepEqual(await (await send({ provider: 'google', authorized: true })).json(), { revoked: true });
    assert.deepEqual(revoked, ['google'], 'route only revokes, regardless of extra grant-like fields');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('bridge handover is authenticated, validated, and only offered to the callback', async () => {
  const { createBridge, compareVersions } = require('../src/bridge');
  assert.equal(compareVersions('0.7.0', '0.6.5'), 1);
  assert.equal(compareVersions('0.6.10', '0.6.9'), 1);
  assert.equal(compareVersions('0.7.0', '0.7.0'), 0);
  assert.equal(compareVersions('0.6.5', '1.0.0'), -1);
  const asked = [];
  const server = await createBridge({
    token: 'test-secret', isEnabled: () => false, port: 0, onError: error => { throw error; },
    onHandover: requester => { asked.push(requester); return compareVersions(requester, '0.7.0') > 0; }
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/handover`;
    const headers = { Origin: 'vscode-file://vscode-app', 'X-Immersive-Token': 'test-secret', 'Content-Type': 'application/json' };
    const send = (body, overrides = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(body) });
    assert.equal((await send({ version: '9.0.0' }, { 'X-Immersive-Token': 'wrong' })).status, 401);
    assert.equal((await send({ version: '9.0.0' }, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await send({ version: 'latest' })).status, 400);
    assert.deepEqual(asked, []);
    assert.deepEqual(await (await send({ version: '0.6.5' })).json(), { handover: false });
    assert.deepEqual(await (await send({ version: '0.7.1' })).json(), { handover: true });
    assert.deepEqual(asked, ['0.6.5', '0.7.1']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('a transient Google refusal recovers on retry, and cancellation stops the backoff wait', async () => {
  let calls = 0;
  const translator = new OnlineTranslator({ retryDelays: [1, 1], fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response('', { status: 429 }) : google('你好');
  } });
  assert.equal(await translator.translate(options), '你好');
  assert.equal(calls, 2);

  calls = 0;
  const slow = new OnlineTranslator({ retryDelays: [2000], fetchImpl: async () => { calls++; return new Response('', { status: 429 }); } });
  const controller = new AbortController();
  const pending = assert.rejects(slow.translate({ ...options, text: 'Other.', signal: controller.signal }), /stop/);
  await new Promise(resolve => setTimeout(resolve, 20));
  controller.abort(new Error('stop'));
  await pending;
  assert.equal(calls, 1, 'no request after cancellation');
  assert.equal(slow.active, 0);
});

test('all retry waits share one budget, and a longer Retry-After gives up instead of retrying early', async () => {
  let calls = 0;
  let retryAfter = '';
  const refuse = async () => {
    calls++;
    return new Response('', { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} });
  };
  const budgeted = new OnlineTranslator({ retryDelays: [30, 30], retryBudgetMs: 40, fetchImpl: refuse });
  const started = Date.now();
  await assert.rejects(budgeted.translate({ ...options, text: 'Budget.' }), /HTTP 429/);
  assert.equal(calls, 2, 'the second wait would exceed the shared budget, so it is not attempted');
  assert.ok(Date.now() - started < 200);

  calls = 0;
  retryAfter = '1';
  await assert.rejects(budgeted.translate({ ...options, text: 'Retry-After.' }), /HTTP 429/);
  assert.equal(calls, 1, 'Retry-After beyond the remaining budget is not retried early');

  const { RETRY_BUDGET_MS } = require('../src/online');
  assert.equal(RETRY_BUDGET_MS, 3000);
});
