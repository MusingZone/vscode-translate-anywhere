'use strict';
// Choosing and timing VS Code language models (pure logic, no VS Code API, so it is unit-tested).

// Explicit "Auto" choice in translateAnywhere.ai.modelId. Not "auto": Copilot has a real model with that id.
const AUTO_MODEL = '@auto';

// Lightweight models that translate well, best first. A model takes the rank of the first pattern it matches;
// within a rank the newer version wins. Models matching none are never picked as the default.
const PREFERRED_MODELS = [
  /\bgpt-[\d.]+-luna\b/,
  /\bclaude-(?:[\d.-]+-)?haiku\b/,
  /\bgemini-[\d.]+-flash-lite\b/,
  /\bgemini-[\d.]+-flash\b/,
  /\bgpt-[\d.]+o?-mini\b/,
  /\bgpt-[\d.]+-nano\b/,
  /\bgrok-[\w.-]*(?:fast|mini)\b/,
  /\b(?:deepseek|qwen|glm|kimi)[\w.-]*(?:flash|turbo|lite)\b/,
  /\b(?:mistral-small|ministral)\b/
];

const textOf = model => `${model.id} ${model.family || ''} ${String(model.name || '').replace(/\s+/g, '-')}`.toLowerCase();

// Index into PREFERRED_MODELS, or -1.
function preferredRank(model) {
  const text = textOf(model);
  if (/(^|\/)auto\b/.test(String(model.id).toLowerCase())) return -1;
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

// The default for a fresh install: the best preferred model among the visible ones, or undefined.
function pickPreferred(models) {
  const [best] = sortByPreference(models);
  return best && preferredRank(best) >= 0 ? best : undefined;
}

/**
 * Model identifiers hidden in VS Code's "Language Models" view. Newer VS Code stores
 * {"hiddenModels": [...]} under "chatModelVisibility"; older builds stored {identifier: visible}
 * under "chatModelPickerPreferences".
 */
function parseHiddenModels({ visibility, pickerPreferences } = {}) {
  const hidden = new Set();
  const parse = value => {
    if (!value) return undefined;
    try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return undefined; }
  };
  const current = parse(visibility);
  if (Array.isArray(current?.hiddenModels)) {
    for (const id of current.hiddenModels) if (typeof id === 'string') hidden.add(id);
    return hidden;
  }
  const legacy = parse(pickerPreferences);
  if (legacy && typeof legacy === 'object') {
    for (const [id, visible] of Object.entries(legacy)) if (visible === false) hidden.add(id);
  }
  return hidden;
}

// VS Code identifies models as "<vendor>/<id>"; providers with groups put the group in between.
function isHidden(model, hidden) {
  if (!hidden?.size) return false;
  const vendor = `${model.vendor}/`;
  const id = String(model.id);
  if (hidden.has(vendor + id) || hidden.has(id)) return true;
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

module.exports = {
  AUTO_MODEL, PREFERRED_MODELS, preferredRank, sortByPreference, pickPreferred,
  parseHiddenModels, isHidden, median, benchmark, timingRank
};
