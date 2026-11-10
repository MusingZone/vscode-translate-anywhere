'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const online = require('../src/online');
const realBridge = require('../src/bridge');

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

// Activates the real extension in a VM with mocked VS Code, bridge and network services.
async function activate(options = {}) {
  const root = path.join(__dirname, '..');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-engine-'));
  const h = {
    values: new Map(Object.entries(options.values || { 'translation.engine': 'online', 'online.provider': 'google', 'online.sourceLanguage': 'auto' })),
    stored: new Map([['welcomeShown', true]]),
    commands: new Map(), configListeners: [], errors: [], warnings: [], infos: [], closed: 0,
    allow: false, info: undefined, calls: 0, aiCalls: 0, bridge: undefined, panelApi: undefined, bridgeFetches: [],
    models: options.models,
    nextResponse: async url => new URL(url).hostname === 'translate.googleapis.com'
      ? new Response(JSON.stringify([[['translated', 'source']]]))
      : new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'translated' } }))
  };
  const disposable = () => ({ dispose() {} });
  h.context = {
    subscriptions: [],
    globalStorageUri: { fsPath: path.join(folder, 'state') },
    extensionUri: { fsPath: root },
    extension: { packageJSON: require('../package.json'), id: 'musingzone.vscode-translate-anywhere' },
    asAbsolutePath: file => path.join(root, file),
    globalState: {
      get: (key, fallback) => h.stored.has(key) ? h.stored.get(key) : fallback,
      update: async (key, value) => { if (value === undefined) h.stored.delete(key); else h.stored.set(key, value); }
    },
    secrets: { get: async () => undefined, onDidChange: disposable },
    languageModelAccessInformation: { onDidChange: disposable, canSendRequest: () => true }
  };
  const vscode = {
    env: { language: 'en', appRoot: folder },
    window: {
      state: { focused: true },
      createOutputChannel: () => ({ ...disposable(), appendLine() {}, show() {} }),
      registerWebviewViewProvider: disposable, onDidChangeActiveTextEditor: disposable,
      showWarningMessage: async (message, _options, ...items) => { h.warnings.push(message); return h.allow ? items[0] : undefined; },
      showInformationMessage: async (message, ...items) => { h.infos.push(message); return h.info ? h.info(items) : undefined; },
      showErrorMessage: async message => h.errors.push(message)
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, fallback) => h.values.has(key) ? h.values.get(key) : fallback,
        inspect: () => ({}),
        update: async (key, value) => h.values.set(key, value)
      }),
      onDidChangeConfiguration: callback => { h.configListeners.push(callback); return disposable(); }
    },
    commands: {
      registerCommand: (id, handler) => { h.commands.set(id, handler); return disposable(); },
      executeCommand: async id => h.commands.get(id)?.()
    },
    lm: {
      onDidChangeChatModels: disposable,
      selectChatModels: async () => {
        h.aiCalls++;
        if (h.models) return h.models;
        throw new Error('AI should not be called');
      }
    },
    ConfigurationTarget: { Global: 1 }
  };
  h.vscode = vscode;
  const extensionFile = path.join(root, 'src', 'extension.js');
  const realRequire = createRequire(extensionFile);
  const createBridge = options.createBridge || (async bridgeOptions => {
    h.bridge = bridgeOptions;
    return { close() { h.closed++; }, closeIdleConnections() {} };
  });
  const mocks = {
    vscode,
    './panel': { SettingsPanel: class {
      constructor(_context, api) { h.panelApi = api; }
      refresh() {}
    } },
    './bridge': { PORT: 0, compareVersions: realBridge.compareVersions, createBridge: bridgeOptions => createBridge(bridgeOptions, h) },
    './dictionary': { Dictionary: { load: async () => ({ lookup: text => ({ found: true, translation: text }) }) } },
    './online': { ...online, OnlineTranslator: class extends online.OnlineTranslator {
      constructor() { super({ fetchImpl: async (url, init) => { h.calls++; return h.nextResponse(url, init); } }); }
    } }
  };
  const sandbox = {
    require: id => Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id),
    module: { exports: {} }, __dirname: path.dirname(extensionFile), process,
    // Short waits (bridge handover) run promptly; long background timers never fire.
    setTimeout: (callback, delay) => { if (delay <= 100) setImmediate(callback); return 1; },
    setInterval: () => 1, clearTimeout() {}, clearInterval() {},
    fetch: async (url, init) => {
      h.bridgeFetches.push(new URL(url).pathname);
      return options.bridgeFetch(url, init, h);
    },
    AbortSignal, AbortController, Response, console
  };
  h.changed = key => {
    for (const listener of h.configListeners) listener({
      affectsConfiguration: section => section === 'translateAnywhere' || section === `translateAnywhere.${key}` ||
        `translateAnywhere.${key}`.startsWith(`${section}.`)
    });
  };
  h.dispose = () => {
    for (const item of h.context.subscriptions.reverse()) item?.dispose();
    fs.rmSync(folder, { recursive: true, force: true });
  };
  vm.runInNewContext(fs.readFileSync(extensionFile, 'utf8'), sandbox, { filename: extensionFile });
  try { await sandbox.module.exports.activate(h.context); }
  catch (error) { h.dispose(); throw error; }
  return h;
}

test('extension routes the selected engine, gates each service, revokes and never silently falls back', async () => {
  const h = await activate();
  try {
    const { bridge, commands } = h;
    assert.ok(bridge);
    assert.equal(bridge.getStatus().settings.translationEngine, 'online');
    await assert.rejects(bridge.translate('Hello world.'), /permission/);
    assert.equal(h.calls, 0);
    await commands.get('translateAnywhere.authorizeOnline')();
    await assert.rejects(bridge.translate('Hello world.'), /permission/, 'dismissing the modal grants nothing');
    h.allow = true;
    await commands.get('translateAnywhere.authorizeOnline')();
    const state = await h.panelApi.state();
    assert.equal(state.onlineAuthorized, true);
    assert.equal(h.aiCalls, 0, 'online sidebar does not load AI models');
    assert.match((await bridge.translate('Hello world.')).source, /Google/);
    assert.equal(h.calls, 1);
    await bridge.translate('Hello world.');
    assert.equal(h.calls, 1, 'cached requests still pass the consent gate');

    h.allow = false;
    const asked = h.warnings.length;
    h.values.set('online.provider', 'mymemory');
    h.changed('online.provider');
    await flush();
    assert.equal(h.warnings.length, asked + 1, 'choosing a service that is not allowed yet asks immediately');
    await assert.rejects(bridge.translate('Hello world.'), /permission/, 'Google consent does not authorize MyMemory');
    h.allow = true;
    await commands.get('translateAnywhere.authorizeOnline')();
    assert.match((await bridge.translate('Auto detected.')).source, /MyMemory/, 'MyMemory works with the default auto source');
    assert.equal(h.calls, 2);
    h.values.set('online.sourceLanguage', 'en');
    h.changed('online.sourceLanguage');
    assert.match((await bridge.translate('Hello world.', undefined, undefined, 'paragraph')).source, /MyMemory/);
    assert.equal(h.calls, 3);

    let started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    h.nextResponse = async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      started();
    });
    const inFlight = bridge.translate('New paragraph.');
    const aborted = assert.rejects(inFlight, /cancelled/);
    await startedPromise;
    await commands.get('translateAnywhere.revokeOnline')();
    await aborted;
    await assert.rejects(bridge.translate('Hello world.'), /permission/, 'revocation blocks previously cached text');
    assert.equal((await h.panelApi.state()).onlineAuthorized, false);

    const prompts = h.warnings.length;
    h.values.set('translation.engine', 'offline');
    h.changed('translation.engine');
    await flush();
    assert.equal(h.warnings.length, prompts, 'leaving online mode never asks for online consent');
    const before = h.calls;
    await assert.rejects(bridge.translate('New paragraph.'), /Offline-only/);
    assert.equal(h.calls, before);
    assert.equal(h.aiCalls, 0);
    assert.equal(bridge.getStatus().settings.translationEngine, 'offline');
    h.values.set('translation.engine', 'ai');
    await assert.rejects(bridge.translate('AI sentence.'), /AI should not be called/);
    assert.equal(h.aiCalls, 1, 'AI mode still reaches the existing model resolver');
    assert.equal(h.calls, before, 'AI errors never fall back to online');
    await assert.rejects(h.panelApi.update('online.provider', 'invalid'), /Invalid value/);
    await assert.rejects(h.panelApi.update('translation.engine', 'invalid'), /Invalid value/);
    assert.deepEqual(h.errors, []);
  } finally { h.dispose(); }
});

test('selecting online in an unfocused window does not open a consent dialog there', async () => {
  const h = await activate({ values: { 'translation.engine': 'ai' } });
  try {
    const before = h.warnings.length;
    h.vscode.window.state.focused = false;
    h.values.set('translation.engine', 'online');
    // Every window receives the settings change; only the focused one should ask.
    h.changed('translation.engine');
    await flush();
    assert.equal(h.warnings.length, before);
    h.vscode.window.state.focused = true;
    h.changed('translation.engine');
    await flush();
    assert.equal(h.warnings.length, before + 1);
  } finally { h.dispose(); }
});

test('without any VS Code model, AI mode offers free online translation and only sends after consent', async () => {
  const h = await activate({ values: { 'translation.engine': 'ai' }, models: [] });
  try {
    h.info = items => items[0];
    h.allow = true;
    await assert.rejects(h.bridge.translate('Hello world.'), /No VS Code language model/);
    assert.equal(h.calls, 0, 'nothing is sent online while choosing');
    await flush();
    assert.equal(h.infos.length, 1);
    assert.match(h.infos[0], /no Copilot/);
    assert.equal(h.values.get('translation.engine'), 'online');
    assert.equal(h.stored.get('onlineConsent.v1.google'), true);
    assert.equal(h.warnings.length, 1, 'exactly one consent dialog');
    assert.match((await h.bridge.translate('Hello world.')).source, /Google/);
    h.values.set('translation.engine', 'ai');
    await assert.rejects(h.bridge.translate('Again.'), /No VS Code language model/);
    await flush();
    assert.equal(h.infos.length, 1, 'the choice is offered once per session');
  } finally { h.dispose(); }
});

test('declining the no-model suggestion keeps AI mode and sends nothing online', async () => {
  const h = await activate({ values: { 'translation.engine': 'ai' }, models: [] });
  try {
    await assert.rejects(h.bridge.translate('Hello world.'), /No VS Code language model/);
    await flush();
    assert.equal(h.infos.length, 1);
    assert.equal(h.values.get('translation.engine'), 'ai');
    assert.equal(h.calls, 0);
    assert.equal(h.warnings.length, 0);
  } finally { h.dispose(); }
});

const inUse = () => Object.assign(new Error('in use'), { code: 'EADDRINUSE' });
const statusReply = ownerVersion => new Response(JSON.stringify({ service: 'immersive-translate-vscode', version: ownerVersion }));

test('a newer window takes over the bridge from an owner that supports handover', async () => {
  let attempts = 0;
  const h = await activate({
    createBridge: async (options, h) => {
      if (attempts++ === 0) throw inUse();
      h.bridge = options;
      return { close() {}, closeIdleConnections() {} };
    },
    bridgeFetch: async url => new URL(url).pathname === '/status' ? statusReply('0.6.9')
      : new Response(JSON.stringify({ handover: true }))
  });
  try {
    assert.deepEqual(h.bridgeFetches, ['/status', '/handover']);
    assert.ok(h.bridge, 'this window now owns the bridge');
    assert.equal((await h.panelApi.state()).staleBridge, '');
    assert.equal(h.warnings.length, 0);
  } finally { h.dispose(); }
});

test('an owner too old for handover is reported instead of silently translating with old settings', async () => {
  const h = await activate({
    createBridge: async () => { throw inUse(); },
    bridgeFetch: async url => new URL(url).pathname === '/status' ? statusReply('0.6.5')
      : new Response(JSON.stringify({ error: 'Unknown route' }), { status: 404 })
  });
  try {
    await flush();
    assert.deepEqual(h.bridgeFetches, ['/status', '/handover']);
    assert.equal(h.bridge, undefined);
    assert.equal((await h.panelApi.state()).staleBridge, '0.6.5');
    assert.equal(h.warnings.length, 1);
    assert.match(h.warnings[0], /older version 0\.6\.5/);
  } finally { h.dispose(); }
});

test('the same or an older version reuses the owner without asking for the port', async () => {
  const h = await activate({
    createBridge: async () => { throw inUse(); },
    bridgeFetch: async () => statusReply(require('../package.json').version)
  });
  try {
    assert.deepEqual(h.bridgeFetches, ['/status']);
    assert.equal((await h.panelApi.state()).staleBridge, '');
  } finally { h.dispose(); }
});

test('the owner releases the port only to a newer version', async () => {
  const h = await activate();
  try {
    assert.equal(h.bridge.onHandover('0.0.1'), false);
    assert.equal(h.bridge.onHandover(require('../package.json').version), false);
    await flush();
    assert.equal(h.closed, 0);
    assert.equal(h.bridge.onHandover('99.0.0'), true);
    await flush();
    assert.equal(h.closed, 1);
    assert.equal(h.bridge.onHandover('99.0.1'), false, 'a window that no longer owns the port cannot hand it over');
  } finally { h.dispose(); }
});
