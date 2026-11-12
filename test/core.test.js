'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Dictionary } = require('../src/dictionary');
const { createBridge, allowedOrigin } = require('../src/bridge');
const { patchSources, applyPatch, restorePatch, pathsFor, withPatchLock, patchConfig, patchedAfter, pruneStaleStates } = require('../src/patcher');
const ui = require('../src/ui');
const { Vocabulary } = require('../src/vocabulary');

const vscodeChecksum = text => crypto.createHash('sha256').update(text).digest('base64').replace(/=+$/, '');
const fixture = () => {
  const script = "\nconst getActiveFrame = () => {};\n";
  const hash = crypto.createHash('sha256').update(script.replace(/\r\n?/g, '\n')).digest('base64');
  const bundle = '/* Copyright (C) Microsoft Corporation */\nconsole.log("base");';
  const html = `<meta content="default-src 'none'; connect-src 'self' https: ws:;"><script src="./workbench.js" type="module"></script>`;
  const loader = 'let e=new URL("vs/workbench/workbench.desktop.main.js",l).href;await import(e);';
  return {
    bundle, html, loader,
    webview: `<meta content="script-src 'sha256-${hash}' 'self'; frame-src 'self';"><script async type="module">${script}</script>`,
    product: `{\n\t"checksums": {\n\t\t"vs/workbench/workbench.desktop.main.js": "${vscodeChecksum(bundle)}",\n\t\t"vs/code/electron-browser/workbench/workbench.html": "${vscodeChecksum(html)}",\n\t\t"vs/code/electron-browser/workbench/workbench.js": "${vscodeChecksum(loader)}",\n\t\t"vs/other.js": "keep"\n\t}\n}\n`
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
  assert.equal(checksums['vs/code/electron-browser/workbench/workbench.js'], vscodeChecksum(patched.loader));
  assert.equal(checksums['vs/other.js'], 'keep');
  assert.ok(patched.product.startsWith('{\n\t"checksums"'), 'formatting preserved');
  assert.throws(() => patchSources({ ...fixture(), webview: '<html></html>' }, ui.toString(), {}), /Unsupported/);
  assert.throws(() => patchSources({ ...fixture(), html: '<html></html>' }, ui.toString(), {}), /CSP/);
});

test('each patch loads under new URLs, because Reload Window reuses the in-memory module cache', () => {
  const config = { endpoint: 'http://127.0.0.1:17865', token: 'test' };
  const first = patchSources(fixture(), ui.toString(), config);
  const stamp = /src="\.\/workbench\.js(\?imt=[0-9a-f]{12})"/.exec(first.html)?.[1];
  assert.ok(stamp, 'loader script URL is versioned');
  assert.ok(first.loader.includes(`"vs/workbench/workbench.desktop.main.js${stamp}"`), 'bundle import uses the same version');
  const second = patchSources(fixture(), ui.toString(), { ...config, token: 'other' });
  assert.notEqual(/\?imt=[0-9a-f]+/.exec(second.html)[0], stamp, 'a changed bundle gets a new URL');
  // Unknown layouts keep working, just without cache busting, and never get half of the change.
  const unknown = patchSources({ ...fixture(), loader: 'import("./other.js")' }, ui.toString(), config);
  assert.ok(!unknown.html.includes('?imt=') && !unknown.loader.includes('?imt='));
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
    const config = patchConfig({ endpoint: 'http://127.0.0.1:17865', token: 'test', runtime: ui.toString() });
    assert.equal(applyPatch(root, state, ui.toString(), config).changed, true);
    const bundle = fs.readFileSync(files.bundle, 'utf8');
    assert.ok(bundle.includes('let o=(await globalThis.__imtFreshChecksums?.())||this.productService.checksums||{};'));
    assert.equal((bundle.match(/__imtFreshChecksums=async/g) || []).length, 1);
    assert.equal(JSON.parse(fs.readFileSync(files.product, 'utf8')).checksums['vs/workbench/workbench.desktop.main.js'], vscodeChecksum(bundle));
    // A newer runtime re-patches from the backup instead of stacking a second injection.
    const newer = ui.toString() + '\n';
    assert.equal(applyPatch(root, state, newer, patchConfig({ endpoint: config.endpoint, token: 'test', runtime: newer })).changed, true);
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
    const posix = process.platform !== 'win32';
    if (posix) fs.chmodSync(files.bundle, 0o640);
    assert.equal(applyPatch(root, state, ui.toString(), config).changed, true);
    if (posix) assert.equal(fs.statSync(files.bundle).mode & 0o777, 0o640, 'patch keeps file permissions');
    assert.equal(applyPatch(root, state, ui.toString(), config).changed, false);
    assert.equal(restorePatch(root, state), true);
    if (posix) assert.equal(fs.statSync(files.bundle).mode & 0o777, 0o640, 'restore keeps file permissions');
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
    // A holder waiting on the user (consent, UAC) for longer than staleMs keeps its lock.
    let overlapped = false;
    let holding = false;
    const slow = withPatchLock(temp, async () => {
      holding = true;
      await new Promise(resolve => setTimeout(resolve, 900));
      holding = false;
    }, { staleMs: 300 });
    await new Promise(resolve => setTimeout(resolve, 50));
    await withPatchLock(temp, () => { overlapped = holding; }, { staleMs: 300 });
    await slow;
    assert.equal(overlapped, false);
  } finally {
    fs.rmSync(temp, { recursive: true });
  }
});

test('patch identity ignores the extension version, detects stale windows and prunes uninstalled versions', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'imt-test-'));
  try {
    const install = path.join(temp, 'Microsoft VS Code');
    const root = path.join(install, 'aaaa', 'resources', 'app');
    const state = path.join(temp, 'state');
    const originals = fixture();
    const write = target => {
      for (const [key, file] of Object.entries(pathsFor(target))) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, originals[key]);
      }
    };
    write(root);
    const config = runtime => patchConfig({ endpoint: 'http://127.0.0.1:17865', token: 'test', runtime });
    const before = Date.now() - 1000;
    assert.equal(applyPatch(root, state, ui.toString(), config(ui.toString())).changed, true);
    // A new extension release with the same runtime leaves VS Code's files alone (no UAC, no reload).
    assert.equal(applyPatch(root, state, ui.toString(), config(ui.toString())).changed, false);
    assert.equal(patchedAfter(root, state, before), true, 'a window loaded before the patch must reload');
    assert.equal(patchedAfter(root, state, Date.now() + 1000), false);
    // VS Code updated into a new folder and removed the old one.
    const next = path.join(install, 'bbbb', 'resources', 'app');
    write(next);
    applyPatch(next, state, ui.toString(), config(ui.toString()));
    fs.rmSync(path.join(install, 'aaaa'), { recursive: true });
    // A whole drive/share being unavailable is not an uninstall: keep those backups.
    const offline = JSON.parse(fs.readFileSync(path.join(state, fs.readdirSync(state).find(name => name.startsWith('patch-'))), 'utf8'));
    fs.writeFileSync(path.join(state, 'patch-0123456789abcdef.json'), JSON.stringify({ ...offline, root: path.join(temp, 'gone', 'x', 'resources', 'app') }));
    assert.deepEqual(pruneStaleStates(state).map(item => path.basename(path.dirname(path.dirname(item)))), ['aaaa']);
    const left = fs.readdirSync(state).filter(name => name.endsWith('.original') || name.startsWith('patch-'));
    assert.equal(left.filter(name => name.endsWith('.original')).length, Object.keys(pathsFor(next)).length);
    assert.ok(left.includes('patch-0123456789abcdef.json'));
    assert.equal(restorePatch(next, state), true);
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
    assert.match(vocab.toMarkdown('zh'), /还没有收藏/);
    assert.match(vocab.toMarkdown('de'), /# Vokabelliste \(0\)[\s\S]*Noch nichts gespeichert/);
    assert.match(vocab.toMarkdown(), /Nothing saved yet/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every interface language has a complete string table', () => {
  const root = path.join(__dirname, '..');
  const nls = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const english = Object.keys(nls('package.nls.json')).sort();
  for (const file of ['package.nls.zh-cn.json', 'package.nls.de.json']) assert.deepEqual(Object.keys(nls(file)).sort(), english, file);

  const Module = require('node:module');
  const load = Module._load;
  Module._load = (request, ...rest) => request === 'vscode' ? {} : load(request, ...rest);
  let panelStrings;
  try { panelStrings = require('../src/panel').STRINGS; } finally { Module._load = load; }
  // The injected UI keeps its strings inside the serialized function, so read them from the source.
  const source = ui.toString();
  const start = source.indexOf('const STRINGS = {') + 'const STRINGS = '.length;
  const uiStrings = new Function(`return ${source.slice(start, source.indexOf('\n  };', start) + 4)}`)();
  for (const [name, table] of [['panel', panelStrings], ['ui', uiStrings]]) {
    assert.deepEqual(Object.keys(table).sort(), ['de', 'en', 'zh'], name);
    for (const lang of ['zh', 'de']) assert.deepEqual(Object.keys(table[lang]).sort(), Object.keys(table.en).sort(), `${name}.${lang}`);
  }

  // Every message in the extension host passes German as the third L() argument.
  const host = fs.readFileSync(path.join(root, 'src', 'extension.js'), 'utf8');
  const skipLiteral = (src, i) => {
    const quote = src[i];
    for (i++; src[i] !== quote; i++) {
      if (src[i] === '\\') i++;
      else if (quote === '`' && src.startsWith('${', i)) {
        for (let depth = 0; ; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
      }
    }
    return i;
  };
  const argCount = (src, from) => {
    for (let i = from, depth = 0, args = 1; i < src.length; i++) {
      const c = src[i];
      if (c === "'" || c === '"' || c === '`') i = skipLiteral(src, i);
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) return args; depth--; }
      else if (c === ',' && depth === 0) args++;
    }
    return 0;
  };
  const calls = [...host.matchAll(/(?<![.\w])L\(/g)].filter(m => !host.slice(m.index - 6, m.index).includes('const '));
  assert.ok(calls.length > 60);
  for (const call of calls) assert.equal(argCount(host, call.index + 2), 3, host.slice(call.index, call.index + 80));
  // Guards against a lossy re-encoding that once turned Chinese text and umlauts into '?'.
  for (const [file, text] of [['extension.js', host], ['panel.js', fs.readFileSync(path.join(root, 'src', 'panel.js'), 'utf8')]]) {
    assert.doesNotMatch(text, /\?{3,}|[a-zäöü]\?[a-zäöü]/, `${file} contains '?' where text was lost`);
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
    await (await post('/ai', { text: '<g1>Setting</g1>: <x2/>', mode: 'markup' })).text();
    await (await post('/ai', { text: 'other', mode: 'unknown' })).text();
    assert.equal(modes[0], 'paragraph');
    assert.notEqual(modes[1], 'paragraph');
    assert.equal(modes[2], 'markup');
    assert.equal(modes[3], 'selection');
    // Cross-page dismiss: presses are shared between pages without needing selected text.
    assert.equal((await (await post('/pointer', { action: 'get' })).json()).time, 0);
    const before = Date.now();
    const down = await (await post('/pointer', { action: 'down', source: 'chat' })).json();
    assert.equal(down.source, 'chat');
    assert.ok(down.time >= before);
    assert.deepEqual(await (await post('/pointer', { action: 'get' })).json(), down);
    await post('/pointer', { action: 'down', source: '' });
    assert.equal((await (await post('/pointer', { action: 'get' })).json()).source, 'chat');
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
test('German dictionary reduces inflected forms and the bridge routes lang=de lookups', async () => {
  const { germanCandidates } = require('../src/dictionary');
  const entries = {
    haus: ['', 'n. 房子 fángzi'], buch: ['', 'n. 书 shū'], arbeiten: ['', 'v. 工作 gōngzuò'], straße: ['', 'n. 街道 jiēdào'],
    einstellung: ['', 'n. 设置 shèzhì'], machen: ['', 'v. 做 zuò'], anrufen: ['', 'v. 打电话 dǎdiànhuà'], schnell: ['', 'adj. 快 kuài'],
    freuen: ['', 'v. 高兴 gāoxìng']
  };
  const german = new Dictionary(null, entries, 'de');
  const hit = word => german.lookup(word).word;
  assert.equal(hit('Häuser'), 'haus');
  assert.equal(hit('Bücher'), 'buch');
  assert.equal(hit('arbeitet'), 'arbeiten');
  assert.equal(hit('Strasse'), 'straße');
  assert.equal(hit('Einstellungen'), 'einstellung');
  assert.equal(hit('gemacht'), 'machen');
  assert.equal(hit('anzurufen'), 'anrufen');
  assert.equal(hit('schnellsten'), 'schnell');
  assert.equal(hit('sich freuen'), 'freuen');
  assert.equal(hit('„Haus“'), 'haus');
  assert.equal(german.lookup('Haus').source, 'HanDeDict (offline)');
  assert.equal(german.lookup('xyzzy').found, false);
  assert.equal(germanCandidates('haus')[0], 'haus', 'the exact form is tried first');
  // The English dictionary keeps its own rules.
  assert.equal(new Dictionary(null, { house: ['haʊs', 'n. 房子'] }).lookup('houses').word, 'house');

  const calls = [];
  const server = await createBridge({
    port: 0, token: 't', isEnabled: () => true, onError: () => {},
    dictionary: { lookup: (text, language) => { calls.push(language); return { found: false, word: text }; } },
    translate: async () => ({ translation: '' })
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/lookup`;
    const headers = { Origin: 'vscode-file://vscode-app', 'X-Immersive-Token': 't', 'Content-Type': 'application/json' };
    for (const body of [{ text: 'Haus', lang: 'de' }, { text: 'house' }, { text: 'x', lang: 'fr' }]) {
      assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })).status, 200);
    }
    assert.deepEqual(calls, ['de', 'en', 'en']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('German dictionary data, mirrors and packaging stay consistent', () => {
  const { GERMAN_MIRRORS, GERMAN_RELEASE_TAG } = require('../src/dictionary-store');
  const root = path.join(__dirname, '..');
  const info = JSON.parse(fs.readFileSync(path.join(root, 'data', 'dictionary-de-source.json'), 'utf8'));
  assert.match(info.dictionarySHA256, /^[0-9a-f]{64}$/);
  assert.equal(info.license, 'CC BY-SA 3.0');
  assert.ok(fs.existsSync(path.join(root, 'data', 'HanDeDict-LICENSE.txt')));
  assert.ok(GERMAN_MIRRORS.every(url => url.includes(GERMAN_RELEASE_TAG) && url.endsWith('/dictionary-de.json.gz')));
  assert.notEqual(downloadedFile('s', info.dictionarySHA256, 'dictionary-de'), downloadedFile('s', info.dictionarySHA256));
  assert.ok(fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8').split(/\r?\n/).includes('data/dictionary-de.json.gz'),
    'the Marketplace build downloads the German dictionary instead of bundling it');
  const file = path.join(root, 'data', 'dictionary-de.json.gz');
  if (fs.existsSync(file)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), info.dictionarySHA256);
    const real = new Dictionary(file, null, 'de');
    assert.match(real.lookup('Wörterbücher').translation, /词典/);
    assert.match(real.lookup('Übersetzung').translation, /翻译/);
  }
});

const { execFileSync } = require('node:child_process');
const { elevationPlan, codeExecutableFor, readOnlyInstallReason } = require('../src/elevation');

test('elevation plans are built per platform and quote paths safely', () => {
  const base = { appRoot: "/opt/VS Code's/resources/app", stateFolder: '/home/u/state', extensionRoot: '/home/u/ext',
    codeExecutable: '/opt/VS Code\'s/code', mode: 'apply', resultFile: '/home/u/state/elevation-1.json', owner: '1000:1000' };
  const win = elevationPlan({ ...base, platform: 'win32' });
  assert.equal(win.file, 'powershell.exe');
  assert.match(Buffer.from(win.args[2], 'base64').toString('utf16le'), /Start-Process -FilePath powershell\.exe -Verb RunAs/);
  const mac = elevationPlan({ ...base, platform: 'darwin', prompt: 'Say "hi"' });
  assert.equal(mac.file, 'osascript');
  assert.match(mac.args[1], /^do shell script ".*" with administrator privileges with prompt "Say \\"hi\\""$/s);
  assert.ok(mac.shell.startsWith("ELECTRON_RUN_AS_NODE=1 '/opt/VS Code'\\''s/code' "));
  assert.ok(mac.shell.endsWith(" 'apply' '/home/u/state/elevation-1.json' '1000:1000'"));
  const linux = elevationPlan({ ...base, platform: 'linux' });
  assert.deepEqual(linux.args.slice(0, 3), ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', base.codeExecutable]);
  assert.equal(linux.file, 'pkexec');
  assert.ok(linux.shell.startsWith('sudo env ELECTRON_RUN_AS_NODE=1 '));
  assert.equal(elevationPlan({ ...base, platform: 'linux', privileged: false }).file, '/bin/sh');
  assert.equal(readOnlyInstallReason('/snap/code/190/usr/share/code/resources/app', {}), 'snap');
  assert.equal(readOnlyInstallReason('/app/share/code/resources/app', {}), 'flatpak');
  assert.equal(readOnlyInstallReason('/private/var/folders/x/AppTranslocation/ABC/d/Visual Studio Code.app/Contents/Resources/app', {}), 'translocated');
  assert.equal(readOnlyInstallReason('/usr/share/code/resources/app', {}), null);
  assert.equal(readOnlyInstallReason('C:\\Program Files\\Microsoft VS Code\\resources\\app', {}), null);
});

test('macOS elevation runs the main app binary named in Info.plist', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'imt-mac-'));
  try {
    const contents = path.join(temp, 'Visual Studio Code.app', 'Contents');
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(contents, 'Resources', 'app'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'Info.plist'), '<dict><key>CFBundleExecutable</key>\n<string>Electron</string></dict>');
    fs.writeFileSync(path.join(contents, 'MacOS', 'Electron'), '');
    const appRoot = path.join(contents, 'Resources', 'app');
    assert.equal(codeExecutableFor(appRoot, '/helper', 'darwin'), path.join(contents, 'MacOS', 'Electron'));
    assert.equal(codeExecutableFor(appRoot, '/helper', 'linux'), '/helper');
  } finally {
    fs.rmSync(temp, { recursive: true });
  }
});

test('the elevated maintenance step patches and restores (unprivileged run of the real plan on this OS)', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "imt elev's-"));
  try {
    const root = path.join(temp, 'app');
    const state = path.join(temp, 'state');
    const originals = fixture();
    const files = pathsFor(root);
    for (const [key, file] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, originals[key]);
    }
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'bridge-token'), 'tok');
    const extensionRoot = path.resolve(__dirname, '..');
    const run = mode => {
      const resultFile = path.join(state, `elevation-${crypto.randomUUID()}.json`);
      if (process.platform === 'win32') {
        execFileSync(process.execPath, [path.join(extensionRoot, 'tools', 'maintenance.js'), root, state, extensionRoot, mode, resultFile]);
      } else {
        // The exact command the elevated prompt runs, minus the privilege request (osascript on macOS, sh on Linux).
        const plan = elevationPlan({ appRoot: root, stateFolder: state, extensionRoot, codeExecutable: process.execPath, mode, resultFile, privileged: false });
        execFileSync(plan.file, plan.args);
      }
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      fs.unlinkSync(resultFile);
      return result;
    };
    assert.deepEqual(run('apply'), { ok: true, changed: true });
    assert.ok(fs.readFileSync(files.bundle, 'utf8').includes('IMMERSIVE_TRANSLATE_BEGIN'));
    assert.ok(fs.readFileSync(files.bundle, 'utf8').includes('"token":"tok"'));
    assert.deepEqual(run('restore'), { ok: true, changed: true });
    for (const [key, file] of Object.entries(files)) assert.equal(fs.readFileSync(file, 'utf8'), originals[key]);
  } finally {
    fs.rmSync(temp, { recursive: true });
  }
});

const models = require('../src/models');

test('model preference ranks lightweight models, skips hidden ones and never picks Copilot auto', () => {
  const list = [
    { vendor: 'copilot', id: 'auto', name: 'Auto' },
    { vendor: 'copilot', id: 'claude-opus-4.8', name: 'Claude Opus 4.8' },
    { vendor: 'copilot', id: 'gpt-4o-mini', name: 'GPT-4o mini' },
    { vendor: 'copilot', id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5' },
    { vendor: 'copilot', id: 'gpt-5.6-luna', name: 'GPT-5.6 luna' },
    { vendor: 'copilot', id: 'gpt-6-luna', name: 'GPT-6 luna' }
  ];
  assert.equal(models.preferredRank(list[0]), -1);
  assert.equal(models.preferredRank(list[1]), -1);
  assert.deepEqual(models.sortByPreference(list).map(m => m.id),
    ['gpt-6-luna', 'gpt-5.6-luna', 'claude-haiku-4.5', 'gpt-4o-mini', 'auto', 'claude-opus-4.8']);
  assert.equal(models.pickPreferred(list).id, 'gpt-6-luna');
  assert.equal(models.pickPreferred(list.slice(0, 2)), undefined);

  const hidden = models.parseHiddenModels({ visibility: JSON.stringify({ hiddenModels: ['copilot/gpt-6-luna', 'customendpoint/Gateway/gpt-5.6-luna'] }) });
  const visible = list.filter(m => !models.isHidden(m, hidden));
  assert.ok(!visible.some(m => m.id === 'gpt-6-luna'));
  assert.ok(visible.some(m => m.id === 'gpt-5.6-luna'), 'a hidden model of another vendor does not hide this one');
  assert.ok(models.isHidden({ vendor: 'customendpoint', id: 'gpt-5.6-luna' }, hidden));
  assert.equal(models.pickPreferred(visible).id, 'gpt-5.6-luna');
  // Legacy {identifier: visible} format and malformed input.
  assert.deepEqual([...models.parseHiddenModels({ pickerPreferences: '{"copilot/a":false,"copilot/b":true}' })], ['copilot/a']);
  assert.throws(() => models.parseHiddenModels({ visibility: 'not json' }), SyntaxError);
});

test('translation picker excludes session-only models and respects colon visibility identifiers', () => {
  const cached = [
    { identifier: 'copilot/native', metadata: { vendor: 'copilot', id: 'native', isUserSelectable: true } },
    { identifier: 'agent-host-copilotcli:native', metadata: {
      vendor: 'agent-host-copilotcli', id: 'native', isUserSelectable: true, targetChatSessionType: 'agent-host-copilotcli'
    } },
    { identifier: 'copilotcli/auto', metadata: {
      vendor: 'copilotcli', id: 'auto', isUserSelectable: true, targetChatSessionType: 'copilotcli'
    } },
    { identifier: 'copilot/helper', metadata: { vendor: 'copilot', id: 'helper', isUserSelectable: false } }
  ];
  const hidden = models.parseHiddenModels({
    cached: JSON.stringify(cached),
    visibility: { hiddenModels: ['customendpoint:another', 'copilot/user-hidden'] }
  });
  const excluded = models.parseExcludedModels(cached);
  assert.deepEqual(cached.map(item => item.metadata).filter(model => !models.isHidden(model, hidden)).map(model => model.id), ['native']);
  assert.ok(models.isHidden({ vendor: 'customendpoint', id: 'another' }, hidden));
  assert.ok(!models.isHidden({ vendor: 'copilot', id: 'another' }, hidden));
  assert.ok(models.isHidden({ vendor: 'copilot', id: 'helper' }, excluded), 'internal models cannot be restored as an explicit choice');
  assert.ok(!models.isHidden({ vendor: 'copilot', id: 'user-hidden' }, excluded), 'explicit user-hidden choices remain usable');
  assert.equal(models.parseExcludedModels(undefined).size, 0);
  assert.throws(() => models.parseExcludedModels('not json'), SyntaxError);
});

test('SDK Chat visibility maps to callable Copilot and BYOK models, including lightweight models', () => {
  const cached = [
    { identifier: 'copilot/auto', metadata: { vendor: 'copilot', id: 'auto' } },
    { identifier: 'copilot/gemini-4-argon', metadata: { vendor: 'copilot', id: 'gemini-4-argon' } },
    { identifier: 'copilot/gpt-6-luna', metadata: { vendor: 'copilot', id: 'gpt-6-luna' } },
    { identifier: 'copilot/native-only', metadata: { vendor: 'copilot', id: 'native-only' } },
    { identifier: 'copilot/helper', metadata: { vendor: 'copilot', id: 'helper', isUserSelectable: false } },
    { identifier: 'customendpoint/Gateway/translation-flash', metadata: { vendor: 'customendpoint', id: 'translation-flash' } },
    { identifier: 'customendpoint/Gateway/hidden-flash', metadata: { vendor: 'customendpoint', id: 'hidden-flash' } },
    { identifier: 'customendpoint/Other/translation-flash', metadata: { vendor: 'customendpoint', id: 'translation-flash' } }
  ];
  const proxy = (id, byokModelIdentifier) => ({
    identifier: `agent-host-copilotcli:${id}`,
    metadata: {
      vendor: 'agent-host-copilotcli', id, targetChatSessionType: 'agent-host-copilotcli', byokModelIdentifier
    }
  });
  cached.push(proxy('auto'), proxy('gemini-4-argon'), proxy('gpt-6-luna'), proxy('helper'),
    proxy('customendpoint/Gateway/translation-flash', 'customendpoint/Gateway/translation-flash'),
    proxy('customendpoint/Gateway/hidden-flash', 'customendpoint/Gateway/hidden-flash'));
  const stored = {
    cached: JSON.stringify(cached),
    currentModel: 'agent-host-copilotcli:auto',
    visibility: JSON.stringify({ hiddenModels: [
      'agent-host-copilotcli:gemini-4-argon', 'copilot/gpt-6-luna', 'customendpoint/Gateway/hidden-flash'
    ] })
  };
  const hidden = models.parseHiddenModels(stored);
  assert.ok(models.isHidden({ vendor: 'copilot', id: 'gemini-4-argon' }, hidden), 'SDK-hidden Argon must not reappear via Copilot');
  assert.ok(!models.isHidden({ vendor: 'copilot', id: 'gpt-6-luna' }, hidden), 'SDK-visible luna must not inherit native Chat visibility');
  assert.ok(models.isHidden({ vendor: 'copilot', id: 'native-only' }, hidden), 'models outside the current Chat catalog are excluded');
  assert.ok(models.isHidden({ vendor: 'copilot', id: 'helper' }, hidden), 'SDK visibility cannot restore internal helpers');
  assert.ok(hidden.has('customendpoint/Gateway/hidden-flash'), 'BYOK retains its provider visibility');
  assert.ok(!hidden.has('customendpoint/Gateway/translation-flash'), 'BYOK maps to the original callable provider');
  assert.ok(!hidden.has('customendpoint/Other/translation-flash'), 'another provider group keeps its own visibility');
  assert.ok(!models.isHidden({ vendor: 'customendpoint', id: 'translation-flash' }, hidden));
  assert.ok(models.isHidden({ vendor: 'agent-host-copilotcli', id: 'gpt-6-luna' }, hidden), 'session-only proxies remain excluded');

  const native = models.parseHiddenModels({ ...stored, currentModel: 'copilot/auto' });
  assert.ok(!models.isHidden({ vendor: 'copilot', id: 'gemini-4-argon' }, native), 'ordinary Chat keeps its independent visibility');
  assert.ok(models.isHidden({ vendor: 'copilot', id: 'gpt-6-luna' }, native));
  assert.ok(!models.isHidden({ vendor: 'copilot', id: 'native-only' }, native));
  const stale = models.parseHiddenModels({ ...stored, currentModel: 'agent-host-copilotcli:removed' });
  assert.deepEqual(stale, models.parseHiddenModels({ ...stored, currentModel: undefined }), 'unknown sessions do not infer aliases');
});

test('legacy Copilot CLI sessions map visibility without hiding models of unrelated vendors', () => {
  const cached = [
    { identifier: 'copilot/luna', metadata: { vendor: 'copilot', id: 'luna' } },
    { identifier: 'copilotcli/auto', metadata: { vendor: 'copilotcli', id: 'auto', targetChatSessionType: 'copilotcli' } },
    { identifier: 'copilotcli/luna', metadata: { vendor: 'copilotcli', id: 'luna', targetChatSessionType: 'copilotcli' } }
  ];
  const hidden = models.parseHiddenModels({
    cached, currentModel: 'copilotcli/auto', pickerPreferences: { 'copilotcli/luna': false }
  });
  assert.ok(models.isHidden({ vendor: 'copilot', id: 'luna' }, hidden));
  assert.ok(!models.isHidden({ vendor: 'another-provider', id: 'luna' }, hidden));
  const excluded = models.parseExcludedModels(cached);
  assert.ok(!models.isHidden({ vendor: 'copilot', id: 'luna' }, excluded), 'a saved user choice is not mistaken for an internal proxy');
});

test('model state reads current Chat visibility read-only, including live SQLite WAL updates', () => {
  const { DatabaseSync } = require('node:sqlite');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-model-state-'));
  const file = path.join(folder, 'state.vscdb');
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = WAL; CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)');
    const write = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)');
    const cached = [
      { identifier: 'copilot/flash', metadata: { vendor: 'copilot', id: 'flash' } },
      { identifier: 'copilot/auto', metadata: { vendor: 'copilot', id: 'auto' } },
      { identifier: 'agent-host-copilotcli:auto', metadata: {
        vendor: 'agent-host-copilotcli', id: 'auto', targetChatSessionType: 'agent-host-copilotcli'
      } },
      { identifier: 'agent-host-copilotcli:flash', metadata: {
        vendor: 'agent-host-copilotcli', id: 'flash', targetChatSessionType: 'agent-host-copilotcli'
      } }
    ];
    write.run('chat.cachedLanguageModels.v2', Buffer.from(JSON.stringify(cached)));
    write.run('chat.currentLanguageModel.panel', 'agent-host-copilotcli:auto');
    write.run('chatModelVisibility', JSON.stringify({ hiddenModels: ['agent-host-copilotcli:flash'] }));
    let stored = models.readStoredModels(file);
    assert.equal(stored.currentModel, 'agent-host-copilotcli:auto');
    assert.equal(stored.pickerPreferences, undefined);
    assert.deepEqual(JSON.parse(stored.cached), cached, 'BLOB values are decoded as UTF-8');
    assert.ok(models.isHidden({ vendor: 'copilot', id: 'flash' }, models.parseHiddenModels(stored)));

    write.run('chatModelVisibility', JSON.stringify({ hiddenModels: [] }));
    stored = models.readStoredModels(file);
    assert.ok(!models.isHidden({ vendor: 'copilot', id: 'flash' }, models.parseHiddenModels(stored)), 'visibility refresh sees the WAL without a reload');
    write.run('chatModelVisibility', JSON.stringify({ hiddenModels: ['agent-host-copilotcli:flash'] }));
    write.run('chat.currentLanguageModel.panel', 'copilot/auto');
    stored = models.readStoredModels(file);
    assert.ok(!models.isHidden({ vendor: 'copilot', id: 'flash' }, models.parseHiddenModels(stored)), 'switching back restores ordinary Chat visibility');
    assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('chatModelVisibility').value),
      { hiddenModels: ['agent-host-copilotcli:flash'] }, 'the reader never changes user visibility');
    assert.throws(() => models.readStoredModels(path.join(folder, 'missing.vscdb')));
    assert.ok(!fs.existsSync(path.join(folder, 'missing.vscdb')), 'read-only access must not create databases');
  } finally {
    db.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('sidebar visibility polling notices changes even when another caller already refreshed the cache', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
  const start = source.indexOf("  let sidebarVisibility = '';");
  const end = source.indexOf('  const languageLabels', start);
  assert.ok(start >= 0 && end > start);
  let poll;
  let reads = 0;
  let refreshes = 0;
  let cleared;
  const hiddenCache = { source: 'initial' };
  const panel = { view: { visible: true }, refresh: () => { refreshes++; } };
  const context = { subscriptions: [] };
  require('node:vm').runInNewContext(source.slice(start, end), {
    hiddenCache, panel, context,
    hiddenModels: force => { assert.equal(force, true); reads++; },
    setInterval: (callback, ms) => { assert.equal(ms, 2000); poll = callback; return 42; },
    clearInterval: id => { cleared = id; }
  });
  poll();
  assert.equal(refreshes, 1);
  poll();
  assert.equal(refreshes, 1, 'unchanged visibility does not push another state');
  hiddenCache.source = 'changed by a translation or model command';
  poll();
  assert.equal(refreshes, 2, 'cache reads outside the timer must not swallow a sidebar update');
  panel.view.visible = false;
  const previousReads = reads;
  hiddenCache.source = 'changed while hidden';
  poll();
  assert.equal(reads, previousReads, 'hidden sidebar does not poll storage');
  panel.view.visible = true;
  poll();
  assert.equal(refreshes, 3, 'reopening catches changes made while hidden');
  context.subscriptions[0].dispose();
  assert.equal(cleared, 42);
});

test('sidebar retains unavailable saved models only as disabled options', () => {
  const Module = require('node:module');
  const load = Module._load;
  Module._load = (request, ...rest) => request === 'vscode' ? {} : load(request, ...rest);
  let html;
  try {
    const { SettingsPanel, STRINGS } = require('../src/panel');
    html = SettingsPanel.prototype.html.call({}, STRINGS.en);
  } finally { Module._load = load; }
  const start = html.indexOf('function fillModels(s) {');
  const end = html.indexOf('// Speed-test progress', start);
  assert.ok(start >= 0 && end > start);
  const createElement = () => ({
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; }
  });
  const select = createElement();
  const option = (value, label) => ({ value, textContent: label, disabled: false });
  const fill = new Function('document', 'option', '$', 'S', 'measured', 'seconds',
    `${html.slice(start, end)}; return fillModels;`)(
    { createElement }, option, () => select,
    { missingModel: 'not available', hiddenModel: 'hidden', model: 'Model' },
    () => false, () => ''
  );
  fill({
    modelId: 'removed',
    vscodeModels: [
      { id: 'native', name: 'Native' },
      { id: 'hidden', name: 'Hidden', hidden: true },
      { id: 'removed', name: 'removed', missing: true }
    ]
  });
  const options = select.children.flatMap(node => node.children || [node]);
  assert.deepEqual(options.map(node => node.value), ['native', 'hidden', 'removed'], 'no Auto choice is offered');
  assert.deepEqual(options.map(node => node.disabled), [false, false, true]);
  assert.equal(select.value, 'removed', 'rendering must not silently change the saved selection');
  assert.match(options[2].textContent, /not available/);
  assert.ok(!/@auto|autoModel/.test(html), 'the sidebar no longer has an Auto choice');
});

test('router models are never listed, and a legacy Auto choice is recognized', () => {
  assert.equal(models.LEGACY_AUTO_MODEL, '@auto');
  // Copilot's router reports whichever model it last routed to as its family, even a hidden one.
  assert.ok(models.isRouterModel({ id: 'auto', vendor: 'copilot', family: 'claude-fable-5.1', name: 'Auto' }));
  assert.ok(models.isRouterModel({ id: 'Auto', vendor: 'copilotcli' }));
  assert.ok(!models.isRouterModel({ id: 'gpt-6-luna', vendor: 'copilot' }));
  assert.ok(!models.isRouterModel({ id: 'autoglm', vendor: 'byok' }));
  assert.ok(!models.isRouterModel(undefined));
  assert.equal(models.preferredRank({ id: 'auto', vendor: 'copilot', family: 'gpt-6-luna' }), -1);
});

test('internal Copilot helpers are hidden, size words are a generic fallback, and AI advice is parsed strictly', () => {
  const cached = JSON.stringify([
    { identifier: 'copilot/copilot-dictation-cleanup-nano', metadata: { id: 'copilot-dictation-cleanup-nano', name: 'GPT-5.4 nano', isUserSelectable: false } },
    { identifier: 'copilot/gpt-5-mini', metadata: { id: 'gpt-5-mini', isUserSelectable: true } },
    { identifier: 'copilot/claude-opus-4.8', metadata: { id: 'claude-opus-4.8' } }
  ]);
  const hidden = models.parseHiddenModels({ cached, visibility: JSON.stringify({ hiddenModels: ['copilot/claude-opus-4.8'] }) });
  assert.ok(models.isHidden({ vendor: 'copilot', id: 'copilot-dictation-cleanup-nano' }, hidden));
  assert.ok(models.isHidden({ vendor: 'copilot', id: 'claude-opus-4.8' }, hidden), 'user-hidden models are still read alongside the cache');
  assert.ok(!models.isHidden({ vendor: 'copilot', id: 'gpt-5-mini' }, hidden));

  // Specialized models never become the default, even when small; unknown "flash"/"mini" models still can.
  assert.equal(models.preferredRank({ id: 'copilot-utility-small', name: 'GPT-4o mini' }), -1);
  assert.equal(models.preferredRank({ id: 'gpt-5.3-codex-mini', name: 'GPT-5.3-Codex mini' }), -1);
  assert.equal(models.preferredRank({ id: 'acme-chat-flash', name: 'Acme Chat Flash' }), models.PREFERRED_MODELS.length - 1);
  assert.equal(models.pickPreferred([{ id: 'big-model-pro', name: 'Big Pro' }]), undefined, 'no match means the user chooses');

  const list = [{ id: 'gpt-5-mini', name: 'GPT-5 mini', vendor: 'copilot', timing: { status: 'ok', median: 700 } },
    { id: 'claude-opus-4.8', name: 'Claude Opus 4.8', vendor: 'copilot' }];
  const prompt = models.advicePrompt(list);
  assert.ok(prompt.includes('"gpt-5-mini"') && prompt.includes('700 ms') && prompt.includes('JSON array'));
  const ids = list.map(m => m.id);
  assert.deepEqual(models.parseAdvice('Sure:\n```json\n["gpt-5-mini", "made-up", "gpt-5-mini"]\n```', ids), ['gpt-5-mini']);
  assert.deepEqual(models.parseAdvice('[]', ids), []);
  assert.equal(models.parseAdvice('I would pick GPT-5 mini.', ids), undefined);
  assert.equal(models.parseAdvice('[not json', ids), undefined);

  // The advisor is a lightweight model even when a large one measured faster; otherwise the fastest one.
  const times = { 'claude-opus-4.8': 500, 'gpt-5-mini': 900, 'big-pro': 300 };
  const rank = m => times[m.id];
  assert.equal(models.pickAdvisor([{ id: 'claude-opus-4.8' }, { id: 'gpt-5-mini', name: 'GPT-5 mini' }], rank).id, 'gpt-5-mini');
  assert.equal(models.pickAdvisor([{ id: 'claude-opus-4.8' }, { id: 'big-pro' }], rank), undefined, 'no lightweight model: no advice, not the fastest model');
  assert.equal(models.pickAdvisor([{ id: 'gpt-5.3-codex-mini' }], rank), undefined, 'specialized models are not advisors');
  assert.equal(models.pickAdvisor([], rank), undefined);
});

test('speed benchmark warms up, takes the median, limits concurrency and reports unauthorized/failed models', async () => {
  const delays = { fast: [900, 100, 120, 500], slow: [50, 300, 310, 290], broken: null };
  const calls = {};
  let inFlight = 0;
  let peak = 0;
  const progress = [];
  const result = await models.benchmark(
    [{ id: 'fast' }, { id: 'slow' }, { id: 'broken' }, { id: 'locked' }],
    async model => {
      inFlight++; peak = Math.max(peak, inFlight);
      try {
        await new Promise(resolve => setTimeout(resolve, 2));
        if (!delays[model.id]) throw new Error('boom');
        const total = delays[model.id][calls[model.id] = (calls[model.id] ?? -1) + 1];
        return { total, first: total / 2 };
      } finally { inFlight--; }
    },
    { runs: 3, concurrency: 2, warmupConcurrency: 2, canRun: model => model.id !== 'locked', onProgress: (done, total) => progress.push([done, total]) }
  );
  assert.ok(peak <= 2);
  assert.deepEqual(result.get('fast'), { status: 'ok', median: 120, first: 60, min: 100, max: 500, runs: 3 });
  assert.equal(result.get('slow').median, 300, 'the cold warm-up (50 ms) is not counted');
  assert.equal(result.get('broken').status, 'failed');
  assert.equal(result.get('locked').status, 'unauthorized');
  assert.deepEqual(progress.at(-1), [12, 12]);
  assert.ok(models.timingRank(result.get('fast')) < models.timingRank(result.get('slow')));
  assert.equal(models.timingRank(result.get('broken')), Number.MAX_SAFE_INTEGER);
});

test('bridge /tip route forwards known actions only', async () => {
  const tips = [];
  const server = await createBridge({
    port: 0, token: 'secret', isEnabled: () => true,
    dictionary: { lookup: () => null }, translate: async () => ({ translation: '' }),
    onTip: action => tips.push(action), onError: () => {}
  });
  try {
    const post = body => fetch(`http://127.0.0.1:${server.address().port}/tip`, {
      method: 'POST', headers: { Origin: 'vscode-file://vscode-app', 'X-Immersive-Token': 'secret', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    for (const action of ['shown', 'dismissed', 'tried', 'used']) assert.equal((await post({ action })).status, 200);
    assert.equal((await post({ action: 'other' })).status, 400);
    assert.deepEqual(tips, ['shown', 'dismissed', 'tried', 'used']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
test('markup prompt keeps tags and differs from the plain paragraph prompt', () => {
  const { buildPrompt } = require('../src/providers');
  const markup = buildPrompt('markup', 'Simplified Chinese');
  assert.match(markup, /<gN>/);
  assert.match(markup, /<xN\/>/);
  assert.match(markup, /Never translate, renumber, add, drop or merge tags/);
  assert.match(markup, /not instructions/);
  assert.doesNotMatch(buildPrompt('paragraph', 'Simplified Chinese'), /<gN>/);
  assert.notEqual(buildPrompt('selection', 'German'), markup);
});
