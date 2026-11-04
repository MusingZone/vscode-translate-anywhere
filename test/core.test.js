'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Dictionary } = require('../src/dictionary');
const { createBridge, allowedOrigin } = require('../src/bridge');
const { patchSources, applyPatch, restorePatch, pathsFor, withPatchLock } = require('../src/patcher');
const ui = require('../src/ui');
const { Vocabulary } = require('../src/vocabulary');

const vscodeChecksum = text => crypto.createHash('sha256').update(text).digest('base64').replace(/=+$/, '');
const fixture = () => {
  const script = "\nconst getActiveFrame = () => {};\n";
  const hash = crypto.createHash('sha256').update(script.replace(/\r\n?/g, '\n')).digest('base64');
  const bundle = '/* Copyright (C) Microsoft Corporation */\nconsole.log("base");';
  const html = `<meta content="default-src 'none'; connect-src 'self' https: ws:;">`;
  return {
    bundle, html,
    webview: `<meta content="script-src 'sha256-${hash}' 'self'; frame-src 'self';"><script async type="module">${script}</script>`,
    product: `{\n\t"checksums": {\n\t\t"vs/workbench/workbench.desktop.main.js": "${vscodeChecksum(bundle)}",\n\t\t"vs/code/electron-browser/workbench/workbench.html": "${vscodeChecksum(html)}",\n\t\t"vs/other.js": "keep"\n\t}\n}\n`
  };
};

test('offline dictionary covers common words, Chinese definitions and misses', () => {
  const dictionary = new Dictionary(path.join(__dirname, '..', 'data', 'dictionary.json.gz'));
  assert.ok(Object.keys(dictionary.entries).length > 500000);
  for (const word of ['hello', 'release', 'performance', 'translate', 'markdown', 'selection', 'computer']) {
    const result = dictionary.lookup(word);
    assert.equal(result.found, true, word);
    assert.match(result.translation, /[\u3400-\u9fff]/);
  }
  assert.equal(dictionary.lookup(' COMPUTERS ').found, true);
  assert.equal(dictionary.lookup('qzxvnotaword').found, false);
});

test('async dictionary load matches sync load without long event-loop stalls', async () => {
  let maxStall = 0;
  let last = Date.now();
  const timer = setInterval(() => { const now = Date.now(); maxStall = Math.max(maxStall, now - last); last = now; }, 5);
  const dictionary = await Dictionary.load(path.join(__dirname, '..', 'data', 'dictionary.json.gz'));
  clearInterval(timer);
  assert.equal(dictionary.lookup('translate').found, true);
  assert.ok(maxStall < 1000, `event loop stalled ${maxStall} ms`);
});

test('patches keep CSP checks and verify exact inline hash', () => {
  const patched = patchSources(fixture(), ui.toString(), { endpoint: 'http://127.0.0.1:17865', token: 'test' });
  assert.ok(patched.html.includes("https: ws: http://127.0.0.1:17865;"));
  assert.ok(!patched.webview.includes("'unsafe-inline'"));
  const script = /<script async type="module">([\s\S]*?)<\/script>/.exec(patched.webview)[1];
  const hash = crypto.createHash('sha256').update(script.replace(/\r\n?/g, '\n')).digest('base64');
  assert.ok(patched.webview.includes(`'sha256-${hash}'`));
  // product.json checksums must match patched files so VS Code does not report a corrupt installation.
  const checksums = JSON.parse(patched.product).checksums;
  assert.equal(checksums['vs/workbench/workbench.desktop.main.js'], vscodeChecksum(patched.bundle));
  assert.equal(checksums['vs/code/electron-browser/workbench/workbench.html'], vscodeChecksum(patched.html));
  assert.equal(checksums['vs/other.js'], 'keep');
  assert.ok(patched.product.startsWith('{\n\t"checksums"'), 'formatting preserved');
  assert.throws(() => patchSources({ ...fixture(), webview: '<html></html>' }, ui.toString(), {}), /Unsupported/);
  assert.throws(() => patchSources({ ...fixture(), html: '<html></html>' }, ui.toString(), {}), /CSP/);
});

test('integrity check reads fresh checksums so a window reload after patching shows no corrupt warning', () => {
  const isPure = 'async _isPure(){let o=this.productService.checksums||{};await this.lifecycleService.when(4);}';
  const originals = { ...fixture() };
  originals.bundle += isPure;
  originals.product = originals.product.replace(vscodeChecksum(fixture().bundle), vscodeChecksum(originals.bundle));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'imt-pure-'));
  try {
    const root = path.join(temp, 'app');
    const state = path.join(temp, 'state');
    const files = pathsFor(root);
    for (const [key, file] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, originals[key]);
    }
    const config = { endpoint: 'http://127.0.0.1:17865', token: 'test', version: '1.0.0' };
    assert.equal(applyPatch(root, state, ui.toString(), config).changed, true);
    const bundle = fs.readFileSync(files.bundle, 'utf8');
    assert.ok(bundle.includes('let o=(await globalThis.__imtFreshChecksums?.())||this.productService.checksums||{};'));
    assert.equal((bundle.match(/__imtFreshChecksums=async/g) || []).length, 1);
    assert.equal(JSON.parse(fs.readFileSync(files.product, 'utf8')).checksums['vs/workbench/workbench.desktop.main.js'], vscodeChecksum(bundle));
    // A newer runtime (new version) re-patches from the backup instead of stacking a second injection.
    assert.equal(applyPatch(root, state, ui.toString(), { ...config, version: '1.0.1' }).changed, true);
    const again = fs.readFileSync(files.bundle, 'utf8');
    assert.equal((again.match(/__imtFreshChecksums\?\.\(\)/g) || []).length, 1);
    assert.equal(restorePatch(root, state), true);
    for (const [key, file] of Object.entries(files)) assert.equal(fs.readFileSync(file, 'utf8'), originals[key], key);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('patch is idempotent, reversible, update aware and rejects external edits', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'imt-test-'));
  try {
    const root = path.join(temp, 'app');
    const state = path.join(temp, 'state');
    const originals = fixture();
    const files = pathsFor(root);
    for (const [key, file] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, originals[key]);
    }
    const config = { endpoint: 'http://127.0.0.1:17865', token: 'test' };
    assert.equal(applyPatch(root, state, ui.toString(), config).changed, true);
    assert.equal(applyPatch(root, state, ui.toString(), config).changed, false);
    assert.equal(restorePatch(root, state), true);
    for (const [key, file] of Object.entries(files)) assert.equal(fs.readFileSync(file, 'utf8'), originals[key]);
    assert.equal(applyPatch(root, state, ui.toString(), config).changed, true);
    fs.appendFileSync(files.bundle, '\n// other tool');
    assert.throws(() => applyPatch(root, state, ui.toString(), config), /changed outside/);
    assert.throws(() => restorePatch(root, state), /externally changed/);
    const newRoot = path.join(temp, 'new-version');
    for (const [key, file] of Object.entries(pathsFor(newRoot))) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, originals[key]);
    }
    assert.equal(applyPatch(newRoot, state, ui.toString(), config).changed, true);
    if (/^[A-Za-z]:/.test(newRoot)) {
      // VS Code reports appRoot with a lowercase drive letter; it must resolve to the same patch state.
      const lower = newRoot[0].toLowerCase() + newRoot.slice(1);
      const upper = newRoot[0].toUpperCase() + newRoot.slice(1);
      assert.equal(applyPatch(lower, state, ui.toString(), config).changed, false);
      assert.equal(applyPatch(upper, state, ui.toString(), config).changed, false);
      assert.equal(restorePatch(lower, state), true);
    }
  } finally {
    fs.rmSync(temp, { recursive: true });
  }
});

test('upgrading from 3-file patch state adds product.json checksums and restores everything', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'imt-test-'));
  try {
    const root = path.join(temp, 'app');
    const state = path.join(temp, 'state');
    const originals = fixture();
    const files = pathsFor(root);
    for (const [key, file] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, originals[key]);
    }
    const config = { endpoint: 'http://127.0.0.1:17865', token: 'test' };
    const { stateFile } = applyPatch(root, state, ui.toString(), config);
    // Simulate state written by v0.1.x, which did not manage product.json.
    const legacy = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    delete legacy.files.product;
    fs.writeFileSync(stateFile, JSON.stringify(legacy));
    fs.writeFileSync(files.product, originals.product);
    assert.equal(applyPatch(root, state, ui.toString(), config).changed, true);
    const checksums = JSON.parse(fs.readFileSync(files.product, 'utf8')).checksums;
    assert.equal(checksums['vs/workbench/workbench.desktop.main.js'], vscodeChecksum(fs.readFileSync(files.bundle, 'utf8')));
    assert.equal(restorePatch(root, state), true);
    for (const [key, file] of Object.entries(files)) assert.equal(fs.readFileSync(file, 'utf8'), originals[key]);
  } finally {
    fs.rmSync(temp, { recursive: true });
  }
});

test('stale state from a concurrent/older run self-heals, but foreign edits are still rejected', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'imt-test-'));
  try {
    const root = path.join(temp, 'app');
    const state = path.join(temp, 'state');
    const originals = fixture();
    const files = pathsFor(root);
    for (const [key, file] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, originals[key]);
    }
    const config = { endpoint: 'http://127.0.0.1:17865', token: 'test' };
    const { stateFile } = applyPatch(root, state, 'function a(){}', config);
    const staleState = fs.readFileSync(stateFile, 'utf8');
    applyPatch(root, state, 'function b(){}', config);
    // Another window wrote the files but our view of the state is from before that write.
    fs.writeFileSync(stateFile, staleState);
    assert.equal(applyPatch(root, state, 'function c(){}', config).changed, true);
    assert.ok(fs.readFileSync(files.bundle, 'utf8').includes('function c(){}'));
    assert.equal(restorePatch(root, state), true);
    for (const [key, file] of Object.entries(files)) assert.equal(fs.readFileSync(file, 'utf8'), originals[key]);
    applyPatch(root, state, 'function d(){}', config);
    fs.writeFileSync(stateFile, staleState);
    fs.appendFileSync(files.html, '<!-- other tool -->');
    assert.throws(() => applyPatch(root, state, 'function e(){}', config), /changed outside/);
  } finally {
    fs.rmSync(temp, { recursive: true });
  }
});

test('patch lock serializes windows and recovers from stale locks', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'imt-test-'));
  try {
    let active = 0;
    let maxActive = 0;
    const job = () => withPatchLock(temp, async () => {
      maxActive = Math.max(maxActive, ++active);
      await new Promise(resolve => setTimeout(resolve, 50));
      active--;
    });
    await Promise.all([job(), job(), job()]);
    assert.equal(maxActive, 1);
    fs.writeFileSync(path.join(temp, 'patch.lock'), '1');
    const old = new Date(Date.now() - 600000);
    fs.utimesSync(path.join(temp, 'patch.lock'), old, old);
    assert.equal(await withPatchLock(temp, () => 'ok'), 'ok');
    assert.equal(fs.existsSync(path.join(temp, 'patch.lock')), false);
  } finally {
    fs.rmSync(temp, { recursive: true });
  }
});

test('bridge authenticates requests, restricts origins, validates input and never calls AI for lookup', async () => {
  let aiCalls = 0;
  let aborted = false;
  const server = await createBridge({
    port: 0, token: 'secret', isEnabled: () => true,
    dictionary: { lookup: text => ({ translation: '你好', word: text }) },
    translate: async (text, onDelta, signal) => {
      aiCalls++;
      if (text === 'stream') { onDelta('测'); onDelta('试'); return { translation: '测试', source: 'AI' }; }
      if (text === 'fail') { onDelta('部分'); throw new Error('boom'); }
      if (text === 'slow') {
        onDelta('…');
        await new Promise(resolve => signal.addEventListener('abort', resolve));
        aborted = true;
        throw new Error('cancelled');
      }
      return { translation: '测试' };
    },
    onError: () => {}
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const headers = { Origin: 'vscode-file://vscode-app', 'X-Immersive-Token': 'secret', 'Content-Type': 'application/json' };
    const send = (route, text, override = {}) => fetch(url + route, {
      method: 'POST', headers: { ...headers, ...override }, body: JSON.stringify({ text })
    });
    assert.equal((await send('/lookup', 'hello', { Origin: 'https://example.com' })).status, 403);
    assert.equal((await send('/lookup', 'hello', { 'X-Immersive-Token': 'bad' })).status, 401);
    assert.equal((await send('/lookup', '')).status, 400);
    assert.equal((await send('/lookup', 'x'.repeat(1201))).status, 400);
    assert.equal((await send('/lookup', 'hello')).status, 200);
    assert.equal(aiCalls, 0);
    assert.equal((await send('/ai', 'hello')).status, 200);
    assert.equal(aiCalls, 1);
    const streamed = await send('/ai', 'stream');
    assert.match(streamed.headers.get('content-type'), /ndjson/);
    assert.equal(streamed.headers.get('access-control-allow-origin'), 'vscode-file://vscode-app');
    const lines = (await streamed.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines, [{ delta: '测' }, { delta: '试' }, { done: true, translation: '测试', source: 'AI' }]);
    const failed = (await (await send('/ai', 'fail')).text()).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(failed.at(-1), { error: 'boom' });
    const controller = new AbortController();
    const slow = await fetch(url + '/ai', { method: 'POST', headers, body: JSON.stringify({ text: 'slow' }), signal: controller.signal });
    await slow.body.getReader().read();
    controller.abort();
    for (let i = 0; i < 50 && !aborted; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(aborted, true, 'client disconnect cancels the model request');
    assert.equal((await send('/status')).status, 200);
    assert.equal(allowedOrigin('null'), false);
    assert.equal(allowedOrigin('vscode-webview://abc-123'), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('vocabulary toggles case-insensitively, removes, and exports markdown/csv', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imt-vocab-'));
  try {
    const vocab = new Vocabulary(path.join(dir, 'sub', 'vocabulary.json'));
    assert.deepEqual(vocab.list(), []);
    assert.equal(vocab.toggle({ text: ' Performance ', translation: 'n. 性能', phonetic: "pə'fɔːməns" }), true);
    assert.equal(vocab.has('performance'), true);
    assert.equal(vocab.toggle({ text: 'say "hi", a|b', translation: '说\n你好' }), true);
    assert.match(vocab.toMarkdown(true), /生词本 \(2\)[\s\S]*a\\\|b[\s\S]*说<br>你好/);
    assert.match(vocab.toMarkdown(), /# Vocabulary \(2\)/);
    const csv = vocab.toCsv();
    assert.ok(csv.startsWith('\ufeffword,phonetic,translation,addedAt\r\n'));
    assert.match(csv, /"say ""hi"", a\|b"/);
    assert.equal(vocab.toggle({ text: 'PERFORMANCE' }), false);
    assert.equal(vocab.has('performance'), false);
    assert.equal(vocab.remove(['SAY "HI", A|B']), 1);
    assert.match(vocab.toMarkdown(true), /还没有收藏/);
    assert.match(vocab.toMarkdown(), /Nothing saved yet/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bridge vocabulary route and AI mode passthrough', async () => {
  const modes = [];
  const saved = new Set();
  const server = await createBridge({
    port: 0, token: 'secret', isEnabled: () => true,
    dictionary: { lookup: text => ({ word: text }) },
    translate: async (text, onDelta, signal, mode) => { modes.push(mode); return { translation: 'x' }; },
    vocabulary: { has: text => saved.has(text), toggle: entry => (saved.has(entry.text) ? !saved.delete(entry.text) : !!saved.add(entry.text)) },
    onError: () => {}
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const post = (route, body) => fetch(url + route, {
      method: 'POST', headers: { Origin: 'vscode-file://vscode-app', 'X-Immersive-Token': 'secret', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    assert.equal((await post('/vocab', { action: 'drop', text: 'a' })).status, 400);
    assert.deepEqual(await (await post('/vocab', { action: 'has', text: 'word' })).json(), { saved: false });
    assert.deepEqual(await (await post('/vocab', { action: 'toggle', text: 'word', translation: '词' })).json(), { saved: true });
    assert.deepEqual(await (await post('/vocab', { action: 'has', text: 'word' })).json(), { saved: true });
    await (await post('/ai', { text: 'para', mode: 'paragraph' })).text();
    await (await post('/ai', { text: 'sel' })).text();
    assert.equal(modes[0], 'paragraph');
    assert.notEqual(modes[1], 'paragraph');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

const http = require('node:http');
const zlib = require('node:zlib');
const { PROVIDERS, resolveProvider, translateWithProvider, listProviderModels } = require('../src/providers');
const { locateDictionary, downloadDictionary, downloadedFile } = require('../src/dictionary-store');

const serve = async handler => {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
};
const readBody = req => new Promise(resolve => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => resolve(s)); });

test('provider presets are complete and overrides are validated', () => {
  for (const [id, preset] of Object.entries(PROVIDERS)) {
    assert.ok(preset.label && ['openai', 'anthropic'].includes(preset.api), id);
    if (id !== 'custom') {
      assert.match(preset.baseUrl, /^https?:\/\//, id);
      assert.ok(preset.model, id);
    }
  }
  assert.equal(resolveProvider('openai', { baseUrl: 'https://proxy.example/v1///' }).baseUrl, 'https://proxy.example/v1');
  assert.equal(resolveProvider('deepseek', { model: ' deepseek-reasoner ' }).model, 'deepseek-reasoner');
  assert.throws(() => resolveProvider('custom'), /baseUrl/);
  assert.throws(() => resolveProvider('custom', { baseUrl: 'http://x' }), /apiModel/);
  assert.throws(() => resolveProvider('openai', { baseUrl: 'file:///etc' }), /http/);
  assert.throws(() => resolveProvider('nope'), /Unknown/);
});

test('OpenAI-compatible and Anthropic providers stream, list models and report key errors', async () => {
  const seen = [];
  const { base, close } = await serve(async (req, res) => {
    const body = req.method === 'POST' ? JSON.parse(await readBody(req)) : null;
    seen.push({ url: req.url, headers: req.headers, body });
    if (req.headers.authorization === 'Bearer bad' || req.headers['x-api-key'] === 'bad') {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'invalid key' } }));
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }] }));
    }
    if (req.url === '/json/chat/completions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: ' 整段 ' } }] }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (req.url === '/v1/chat/completions') {
      res.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"好"}}]}\r\n\r\ndata: [DONE]\n\n');
    } else {
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"世界"}}\n\n');
      res.write('data: {"type":"message_stop"}\n\n');
    }
    res.end();
  });
  try {
    const openai = resolveProvider('openai', { baseUrl: `${base}/v1` });
    const deltas = [];
    assert.equal(await translateWithProvider({ provider: openai, apiKey: 'k1', text: 'hello', language: 'Chinese', onDelta: d => deltas.push(d) }), '你好');
    assert.deepEqual(deltas, ['你', '好']);
    const sent = seen.at(-1);
    assert.equal(sent.headers.authorization, 'Bearer k1');
    assert.equal(sent.body.model, 'gpt-4o-mini');
    assert.equal(sent.body.stream, true);
    assert.deepEqual(JSON.parse(sent.body.messages[1].content), { text: 'hello' });

    const claude = resolveProvider('anthropic', { baseUrl: `${base}/anthropic` });
    assert.equal(await translateWithProvider({ provider: claude, apiKey: 'k2', text: 'world', mode: 'paragraph', language: 'Chinese' }), '世界');
    const sentClaude = seen.at(-1);
    assert.equal(sentClaude.url, '/anthropic/messages');
    assert.equal(sentClaude.headers['x-api-key'], 'k2');
    assert.equal(sentClaude.headers['anthropic-version'], '2023-06-01');
    assert.equal(sentClaude.headers.authorization, undefined);
    assert.match(sentClaude.body.system, /documentation/);

    const plain = resolveProvider('custom', { baseUrl: `${base}/json`, model: 'm' });
    assert.equal(await translateWithProvider({ provider: plain, text: 'x', language: 'Chinese' }), '整段');
    assert.equal(seen.at(-1).headers.authorization, undefined);

    assert.deepEqual(await listProviderModels({ provider: openai, apiKey: 'k1' }), ['a-model', 'b-model']);
    await assert.rejects(translateWithProvider({ provider: openai, apiKey: 'bad', text: 'x', language: 'Chinese' }), /HTTP 401: invalid key.*API key/);
    const before = seen.length;
    await assert.rejects(translateWithProvider({ provider: openai, text: 'x', language: 'Chinese' }), /no API key/);
    assert.equal(seen.length, before, 'no request without a key');
    const ollama = resolveProvider('ollama', { baseUrl: `${base}/v1` });
    assert.equal(await translateWithProvider({ provider: ollama, text: 'x', language: 'Chinese' }), '你好');
  } finally {
    await close();
  }
});

test('dictionary download falls back across mirrors, verifies SHA-256 and is located by priority', async () => {
  const payload = zlib.gzipSync(JSON.stringify({ hello: ['int. 你好'] }));
  const sha = crypto.createHash('sha256').update(payload).digest('hex');
  const hits = [];
  const { base, close } = await serve((req, res) => {
    hits.push(req.url);
    if (req.url === '/down') { res.writeHead(503); return res.end(); }
    if (req.url === '/tampered') { res.writeHead(200); return res.end(Buffer.concat([payload, Buffer.from('x')])); }
    res.writeHead(200, { 'content-length': payload.length });
    res.end(payload);
  });
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-dict-'));
  try {
    assert.equal(locateDictionary({ storageFolder: storage, sha256: sha }), null);
    const progress = [];
    const result = await downloadDictionary({
      storageFolder: storage, sha256: sha, mirrors: [`${base}/down`, '', `${base}/tampered`, `${base}/good`],
      onProgress: info => progress.push(info)
    });
    assert.deepEqual(hits, ['/down', '/tampered', '/good']);
    assert.equal(result.url, `${base}/good`);
    assert.equal(result.file, downloadedFile(storage, sha));
    assert.deepEqual(fs.readFileSync(result.file), payload);
    assert.equal(progress.at(-1).received, payload.length);
    assert.equal(progress.at(-1).total, payload.length);
    assert.deepEqual(fs.readdirSync(path.dirname(result.file)), [path.basename(result.file)], 'no .part leftovers');

    assert.deepEqual(locateDictionary({ storageFolder: storage, sha256: sha }), { file: result.file, kind: 'downloaded' });
    const bundled = path.join(storage, 'bundled.json.gz');
    fs.writeFileSync(bundled, payload);
    assert.equal(locateDictionary({ bundledFile: bundled, storageFolder: storage, sha256: sha }).kind, 'bundled');
    assert.equal(locateDictionary({ customPath: bundled, bundledFile: 'missing', storageFolder: storage, sha256: sha }).kind, 'custom');
    assert.throws(() => locateDictionary({ customPath: path.join(storage, 'missing.gz'), storageFolder: storage, sha256: sha }), /not found/);

    await assert.rejects(downloadDictionary({ storageFolder: storage, sha256: '0'.repeat(64), mirrors: [`${base}/down`, `${base}/good`] }),
      /every mirror[\s\S]*HTTP 503[\s\S]*checksum mismatch/);
    const controller = new AbortController();
    controller.abort(new Error('cancelled by user'));
    await assert.rejects(downloadDictionary({ storageFolder: storage, sha256: sha, mirrors: [`${base}/good`], signal: controller.signal }), /cancelled by user/);
  } finally {
    await close();
    fs.rmSync(storage, { recursive: true, force: true });
  }
});