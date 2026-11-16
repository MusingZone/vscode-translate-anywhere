'use strict';
// Choosing and timing language models and reading profile visibility, without the VS Code API.

// Value of translateAnywhere.ai.modelId written by versions before 0.6.5, which had an "Auto" choice.
const LEGACY_AUTO_MODEL = '@auto';
// Copilot's "auto" router (and SDK Chat's Copilot Fusion) picks a model per request, possibly one the user hid.
// Its cached family names whichever model it last routed to, so it is not listed or measured.
const isRouterModel = model => String(model?.id || '').toLowerCase() === 'auto';

// Only used to borrow a model for a translation while the user has not chosen one, among the models the user can
// see; the result says so. Patterns name model tiers and size words, not versions, so newer releases still match.
// The last pattern catches any "mini/nano/flash/lite/…" model. If nothing matches, the user is asked to choose.
const PREFERRED_MODELS = [
  /\bgpt-[\d.]+-luna\b/,
  /\bclaude-(?:[\d.-]+-)?haiku\b/,
  /\bgemini-[\d.]+-flash-lite\b/,
  /\bgemini-[\d.]+-flash\b/,
  /\bgpt-[\d.]+o?-mini\b/,
  /\bgpt-[\d.]+-nano\b/,
  /\bgrok-[\w.-]*(?:fast|mini)\b/,
  /\b(?:deepseek|qwen|glm|kimi)[\w.-]*(?:flash|turbo|lite)\b/,
  /\b(?:mistral-small|ministral)\b/,
  /\b(?:mini|nano|flash|lite|haiku|small|fast|turbo)\b/
];
// Specialized models that are a poor default for translation even when they are small.
const NOT_FOR_TRANSLATION = /\b(?:code|codex|coder|embed\w*|vision|audio|tts|whisper|image|dictation|utility)\b/;

const textOf = model => `${model.id} ${model.family || ''} ${String(model.name || '').replace(/\s+/g, '-')}`.toLowerCase();

// Index into PREFERRED_MODELS, or -1.
function preferredRank(model) {
  const text = textOf(model);
  if (/(^|\/)auto\b/.test(String(model.id).toLowerCase()) || NOT_FOR_TRANSLATION.test(text)) return -1;
  return PREFERRED_MODELS.findIndex(pattern => pattern.test(text));
}

// Version numbers in the id ("gpt-5.6-luna" → [5, 6]), compared left to right; higher is newer.
function versionOf(model) {
  return (String(model.id).match(/\d+/g) || []).map(Number);
}
function compareVersions(a, b) {
  const x = versionOf(a);
  const y = versionOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (y[i] ?? -1) - (x[i] ?? -1);
    if (diff) return diff;
  }
  return 0;
}

// Preferred models first (by rank, then newest), then everything else in the original order.
function sortByPreference(models) {
  return models.map((model, index) => ({ model, index, rank: preferredRank(model) }))
    .sort((a, b) => {
      const ra = a.rank < 0 ? Infinity : a.rank;
      const rb = b.rank < 0 ? Infinity : b.rank;
      return ra - rb || (ra === Infinity ? a.index - b.index : compareVersions(a.model, b.model) || a.index - b.index);
    })
    .map(item => item.model);
}

// The model borrowed while none is chosen: the best preferred model among the visible ones, or undefined.
function pickPreferred(models) {
  const [best] = sortByPreference(models);
  return best && preferredRank(best) >= 0 ? best : undefined;
}

/**
 * Model identifiers missing from VS Code's model picker: those the user hid in the "Language Models" view and
 * internal helper models that are not user-selectable (e.g. Copilot's "copilot-dictation-cleanup-nano"),
 * which the extension API still returns. Newer VS Code stores {"hiddenModels": [...]} under
 * "chatModelVisibility"; older builds stored {identifier: visible} under "chatModelPickerPreferences".
 * "chat.cachedLanguageModels.v2" lists [{identifier, metadata: {isUserSelectable, targetChatSessionType}}].
 */
function parseStoredModels(value) {
  if (!value) return undefined;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

const STORED_KEYS = {
  visibility: 'chatModelVisibility', pickerPreferences: 'chatModelPickerPreferences',
  cached: 'chat.cachedLanguageModels.v2', currentModel: 'chat.currentLanguageModel.panel',
  sessionType: 'chat.userSelectedSessionType'
};

// Reads the keys from the first database that has each one. The profile database comes first; the
// application database follows because the Agents window keeps model preferences in application scope.
function readStoredModels(files) {
  const { DatabaseSync } = require('node:sqlite');
  const stored = {};
  for (const file of [].concat(files)) {
    let db;
    try { db = new DatabaseSync(file, { readOnly: true }); } catch (error) {
      if (file === [].concat(files)[0]) throw error;
      continue;
    }
    try {
      const query = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
      for (const [name, key] of Object.entries(STORED_KEYS)) {
        if (stored[name] !== undefined) continue;
        const value = query.get(key)?.value;
        if (value !== undefined && value !== null) stored[name] = value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : value;
      }
    } finally { db.close(); }
  }
  return stored;
}

// SDK Chat harnesses (e.g. "agent-host-copilotcli") list Copilot models under their own identifiers, each with
// its own visibility. Returns which picker the translation list should mirror:
// - { types: [] } for the standard picker,
// - { types: [type] } for an SDK harness the user selected,
// - { types: [...], from: 'fallback' } when no key says which one is in use: the standard picker and every SDK picker
//   the user customized are candidates, and only models visible in all of them are listed, so a model hidden in the
//   picker actually in use is never offered. (VS Code renamed the key once: chat.currentLanguageModel.panel →
//   chat.userSelectedSessionType. The extension logs the fallback so a future rename is visible.)
function visibilityPicker({ cached, currentModel, sessionType, visibility } = {}) {
  const list = parseStoredModels(cached);
  if (!Array.isArray(list)) return { types: [], from: 'none' };
  const sdkTypes = new Set();
  for (const item of list) {
    const type = item?.metadata?.targetChatSessionType;
    if (typeof type === 'string' && item.metadata.isUserSelectable !== false && !isRouterModel(item.metadata)) sdkTypes.add(type);
  }
  const fromModel = list.find(item => item?.identifier === currentModel)?.metadata?.targetChatSessionType;
  if (fromModel && sdkTypes.has(fromModel)) return { types: [fromModel], from: STORED_KEYS.currentModel };
  if (typeof sessionType === 'string' && sessionType) {
    return sdkTypes.has(sessionType) ? { types: [sessionType], from: STORED_KEYS.sessionType } : { types: [], from: STORED_KEYS.sessionType };
  }
  if (currentModel) return { types: [], from: STORED_KEYS.currentModel };
  const hidden = parseStoredModels(visibility)?.hiddenModels;
  const customized = Array.isArray(hidden) ? [...sdkTypes].filter(type => list.some(item =>
    item?.metadata?.targetChatSessionType === type && hidden.includes(item.identifier))) : [];
  return { types: customized, from: 'fallback' };
}

// Session-specific models belong to their own Chat picker, not the extension translation picker.
function parseExcludedModels(cached) {
  const excluded = new Set();
  const list = parseStoredModels(cached);
  if (!Array.isArray(list)) return excluded;
  for (const item of list) {
    if (item?.metadata?.isUserSelectable !== false && !item?.metadata?.targetChatSessionType) continue;
    if (typeof item.identifier === 'string') excluded.add(item.identifier);
    const { vendor, id } = item.metadata;
    if (typeof vendor === 'string' && typeof id === 'string') excluded.add(`${vendor}/${id}`);
  }
  return excluded;
}

function parseHiddenModels(stored = {}) {
  const { visibility, pickerPreferences, cached } = stored;
  const hidden = new Set();
  const current = parseStoredModels(visibility);
  if (Array.isArray(current?.hiddenModels)) {
    for (const id of current.hiddenModels) if (typeof id === 'string') hidden.add(id);
  } else {
    const legacy = parseStoredModels(pickerPreferences);
    if (legacy && typeof legacy === 'object') {
      for (const [id, visible] of Object.entries(legacy)) if (visible === false) hidden.add(id);
    }
  }
  const list = parseStoredModels(cached);
  const { types, from } = visibilityPicker(stored);
  if (Array.isArray(list) && types.length) {
    // The extension calls the standard models; SDK entries say which of them the user sees there. BYOK entries
    // point back to the original provider; Copilot ones share the model id. Copilot models absent from an SDK
    // picker are not visible there.
    const pickers = types.map(type => {
      const visible = new Set();
      const mapped = new Set();
      for (const item of list) {
        const meta = item?.metadata;
        if (meta?.targetChatSessionType !== type || meta.isUserSelectable === false || isRouterModel(meta)) continue;
        const identifier = meta.byokModelIdentifier || `copilot/${meta.id}`;
        mapped.add(identifier);
        if (!hidden.has(item.identifier) && !(meta.byokModelIdentifier && hidden.has(identifier))) visible.add(identifier);
      }
      return { visible, mapped };
    });
    // Known picker: mirror it. Unknown picker: the standard picker's own hidden set stays, and a model hidden in
    // any candidate SDK picker is hidden too (never unhidden), so the guess cannot reveal a model the user hid.
    const fallback = from === 'fallback';
    for (const item of list) {
      if (item?.metadata?.targetChatSessionType) continue;
      const relevant = pickers.filter(picker => item.metadata?.vendor === 'copilot' || picker.mapped.has(item.identifier));
      if (!relevant.length) continue;
      const shown = relevant.every(picker => picker.visible.has(item.identifier));
      if (!shown) hidden.add(item.identifier);
      else if (!fallback) hidden.delete(item.identifier);
    }
  }
  for (const id of parseExcludedModels(cached)) hidden.add(id);
  return hidden;
}

// VS Code identifies models as "<vendor>/<id>"; providers with groups put the group in between.
function isHidden(model, hidden) {
  if (!hidden?.size) return false;
  const vendor = `${model.vendor}/`;
  const id = String(model.id);
  if (hidden.has(vendor + id) || hidden.has(`${model.vendor}:${id}`) || hidden.has(id)) return true;
  for (const entry of hidden) {
    if (entry.startsWith(vendor) && entry.endsWith(`/${id}`)) return true;
  }
  return false;
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Speed test. One untimed warm-up request per model (connection setup, routing, cold caches), then
 * `runs` timed rounds. Rounds alternate between models so a slow network moment hits all of them,
 * and at most `concurrency` requests are in flight so models do not queue behind each other.
 * The result per model is the median, which ignores a single outlier.
 * @param {object[]} models
 * @param {(model: object) => Promise<{total: number, first: number}>} run  one timed translation
 * @returns {Promise<Map<string, {status: 'ok', median: number, first: number, min: number, max: number, runs: number}
 *   | {status: 'unauthorized' | 'failed'}>>}
 */
async function benchmark(models, run, {
  runs = 3, concurrency = 2, warmupConcurrency = concurrency, canRun = () => true, onProgress = () => {}, isCancelled = () => false
} = {}) {
  const results = new Map();
  const samples = new Map();
  const live = [];
  for (const model of models) {
    if (canRun(model)) live.push(model);
    else results.set(model.id, { status: 'unauthorized' });
  }
  const total = live.length * (runs + 1);
  let done = 0;
  const pool = async (tasks, width = concurrency) => {
    let next = 0;
    const worker = async () => {
      while (next < tasks.length && !isCancelled()) await tasks[next++]();
    };
    await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, worker));
  };
  const step = () => onProgress(++done, total);
  await pool(live.map(model => async () => {
    try { await run(model); samples.set(model.id, []); } catch {
      results.set(model.id, { status: 'failed' });
      done += runs; // its timed runs are skipped
    }
    step();
  }), warmupConcurrency);
  for (let round = 0; round < runs && !isCancelled(); round++) {
    const order = live.filter(model => samples.has(model.id));
    // Rotate the start so no model always goes first.
    const rotated = order.slice(round % Math.max(1, order.length)).concat(order.slice(0, round % Math.max(1, order.length)));
    await pool(rotated.map(model => async () => {
      try { samples.get(model.id).push(await run(model)); } catch { /* one failed run is ignored */ }
      step();
    }));
  }
  for (const [id, list] of samples) {
    if (!list.length) { results.set(id, { status: 'failed' }); continue; }
    const totals = list.map(sample => sample.total);
    results.set(id, {
      status: 'ok', median: Math.round(median(totals)), first: Math.round(median(list.map(sample => sample.first))),
      min: Math.min(...totals), max: Math.max(...totals), runs: list.length
    });
  }
  return results;
}

// Sort key for measured results: milliseconds, unmeasured last.
const timingRank = timing => timing?.status === 'ok' ? timing.median : Number.MAX_SAFE_INTEGER;

/**
 * After a speed test, one of the user's own models judges which visible models are lightweight and suited to
 * quick translation, so recommendations follow the models people actually have instead of a built-in list.
 * @param {{id: string, name: string, vendor?: string, family?: string, timing?: object}[]} list
 */
function advicePrompt(list) {
  const lines = list.map(model => {
    const time = model.timing?.status === 'ok' ? `, measured ${model.timing.median} ms` : '';
    return `- id: ${JSON.stringify(model.id)}, name: ${JSON.stringify(model.name || model.id)}, vendor: ${model.vendor || '?'}, family: ${model.family || '?'}${time}`;
  });
  return [
    'You help pick an AI model for translating short UI text, sentences and paragraphs quickly.',
    'From the models below, choose the ones that are lightweight, low-latency general chat models that translate well',
    '(for example "mini", "flash", "haiku", "lite" or similar small tiers). Exclude large flagship models,',
    'reasoning-focused models, and models specialized for code, embeddings, images or audio. Measured times, when given,',
    'are the median for one translation and may help, but judge mainly by the model itself.',
    'If you do not recognize a model, leave it out. If none fit, answer [].',
    'Reply with only a JSON array of the chosen ids, e.g. ["id-a", "id-b"]. No other text.',
    '',
    ...lines
  ].join('\n');
}

// Model asked for the advice above: a lightweight one, since flagship models can cost many premium requests.
// The fastest measured model that looks lightweight by name. Without one there is no advisor (and no advice):
// speed says nothing about price, so a fast flagship model is never asked.
function pickAdvisor(measured, speedRank) {
  return [...measured].sort((a, b) => speedRank(a) - speedRank(b)).find(model => preferredRank(model) >= 0);
}

// The ids from a model's answer that really are in `ids`; undefined when the answer is not a JSON array.
function parseAdvice(text, ids) {
  const match = String(text || '').match(/\[[\s\S]*?\]/);
  if (!match) return undefined;
  let list;
  try { list = JSON.parse(match[0]); } catch { return undefined; }
  if (!Array.isArray(list)) return undefined;
  const known = new Set(ids);
  return [...new Set(list.filter(id => typeof id === 'string' && known.has(id)))];
}

module.exports = {
  LEGACY_AUTO_MODEL, isRouterModel, PREFERRED_MODELS, preferredRank, sortByPreference, pickPreferred,
  readStoredModels, visibilityPicker, parseHiddenModels, parseExcludedModels, isHidden, median, benchmark, timingRank, advicePrompt, parseAdvice, pickAdvisor
};
