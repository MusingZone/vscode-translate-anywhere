'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Dictionary } = require('./dictionary');
const { DEFAULT_MIRRORS, GERMAN_MIRRORS, RELEASE_TAG, locateDictionary, downloadDictionary } = require('./dictionary-store');
const { PROVIDERS, buildPrompt, resolveProvider, translateWithProvider, listProviderModels } = require('./providers');
const { SettingsPanel } = require('./panel');
const { createBridge, PORT } = require('./bridge');
const { applyPatch, restorePatch, withPatchLock } = require('./patcher');
const ui = require('./ui');
const { elevatedMaintenance, readOnlyInstallReason } = require('./elevation');
const { Vocabulary } = require('./vocabulary');

const SECTION = 'translateAnywhere';
// Settings and state of the pre-release build that was published under a different name.
const LEGACY_SECTION = 'immersiveTranslate';
const LEGACY_EXTENSION_ID = 'local.immersive-translate-vscode';
const LEGACY_KEYS = ['integration.enabled', 'integration.autoRepair', 'fullPage.mode', 'ai.modelId'];
const LANGUAGES = {
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', en: 'English', ja: 'Japanese', ko: 'Korean',
  fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', it: 'Italian', ru: 'Russian', uk: 'Ukrainian',
  ar: 'Arabic', hi: 'Hindi', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', tr: 'Turkish', pl: 'Polish', nl: 'Dutch'
};
// Interface languages with full string tables; anything else falls back to English.
const UI_LANGUAGES = ['en', 'zh', 'de'];
const resolveUiLanguage = code => UI_LANGUAGES.find(lang => String(code || '').toLowerCase().startsWith(lang)) || 'en';
const SURFACES = ['markdownPreview', 'releaseNotes', 'chat', 'settings', 'extensionPages', 'welcome', 'workbenchUI'];
const MAX_AI_CONCURRENCY = 8;

async function migrateLegacy(stateFolder) {
  const legacy = vscode.workspace.getConfiguration(LEGACY_SECTION);
  const current = vscode.workspace.getConfiguration(SECTION);
  for (const key of LEGACY_KEYS) {
    const value = legacy.inspect(key)?.globalValue;
    if (value !== undefined && current.inspect(key)?.globalValue === undefined) {
      await current.update(key, value, vscode.ConfigurationTarget.Global);
    }
  }
  const legacyFolder = path.join(path.dirname(stateFolder), LEGACY_EXTENSION_ID);
  const marker = path.join(stateFolder, '.legacy-migrated');
  if (!fs.existsSync(legacyFolder) || fs.existsSync(marker)) return;
  // Copies the bridge token, vocabulary and patch backups; patch records point at the backups by absolute path.
  for (const name of fs.readdirSync(legacyFolder)) {
    const from = path.join(legacyFolder, name);
    const to = path.join(stateFolder, name);
    if (name === 'patch.lock' || fs.existsSync(to) || !fs.statSync(from).isFile()) continue;
    if (/^patch-[0-9a-f]+\.json$/.test(name)) {
      const state = JSON.parse(fs.readFileSync(from, 'utf8'));
      for (const record of Object.values(state.files || {})) record.backup = path.join(stateFolder, path.basename(record.backup));
      fs.writeFileSync(to, JSON.stringify(state, null, 2), 'utf8');
    } else {
      fs.copyFileSync(from, to);
    }
  }
  fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
}

async function activate(context) {
  const output = vscode.window.createOutputChannel('Translate Anywhere');
  context.subscriptions.push(output);
  const config = () => vscode.workspace.getConfiguration(SECTION);
  const uiLanguage = () => {
    const setting = config().get('uiLanguage', 'auto');
    return resolveUiLanguage(setting === 'auto' ? vscode.env.language : setting);
  };
  const L = (en, zh, de = en) => ({ en, zh, de })[uiLanguage()];
  const stateFolder = context.globalStorageUri.fsPath;
  fs.mkdirSync(stateFolder, { recursive: true });
  const errorText = error => error instanceof Error ? error.message : String(error);
  const logError = error => output.appendLine(`Error: ${errorText(error)}`);
  try { await migrateLegacy(stateFolder); } catch (error) { logError(error); }
  const tokenFile = path.join(stateFolder, 'bridge-token');
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const token = fs.readFileSync(tokenFile, 'utf8');
  const version = context.extension.packageJSON.version;
  const vocabulary = new Vocabulary(path.join(stateFolder, 'vocabulary.json'));
  let panel;
  let server;
  let sharedBridge = false;
  let patchStatus = 'Not applied';
  let aiInFlight = 0;
  const aiCache = new Map();
  const targetLanguage = () => {
    const code = config().get('targetLanguage', 'zh-CN');
    return LANGUAGES[code] ? code : 'zh-CN';
  };
  const AUTHORIZE_HINT = () => L(
    'First use needs your permission: run "Translate Anywhere: Authorize AI Model" from the Command Palette in this window and click Allow.',
    '首次使用需授权：在命令面板中运行「Translate Anywhere: Authorize AI Model」并点击允许。',
    'Beim ersten Mal ist Ihre Zustimmung nötig: Führen Sie in diesem Fenster über die Befehlspalette "Translate Anywhere: Authorize AI Model" aus und klicken Sie auf "Zulassen".'
  );
  const lightweightRank = model => {
    const name = `${model.id} ${model.family} ${model.name}`.toLowerCase();
    if (name.includes('luna')) return 0;
    if (/mini|flash|haiku|lite|nano|small/.test(name)) return 1;
    return 2;
  };
  const sortedModels = async () => (await vscode.lm.selectChatModels({}))
    .sort((a, b) => lightweightRank(a) - lightweightRank(b));
  // Speed-test results for this session (milliseconds, 'unauthorized' or 'failed'), shared by the sidebar and the model picker.
  const modelTimings = new Map();
  const speedRank = model => typeof modelTimings.get(model.id) === 'number' ? modelTimings.get(model.id) : Number.MAX_SAFE_INTEGER;
  // Only measures models this extension may already use, so no consent dialog pops up per provider.
  async function measureModels(models, onProgress, token) {
    let done = 0;
    await Promise.all(models.map(async model => {
      if (context.languageModelAccessInformation.canSendRequest(model) !== true) {
        modelTimings.set(model.id, 'unauthorized');
      } else {
        const started = Date.now();
        try {
          await runModel(model, 'resilience', 15000, undefined, undefined, token);
          modelTimings.set(model.id, Date.now() - started);
        } catch {
          if (!token?.isCancellationRequested) modelTimings.set(model.id, 'failed');
        }
      }
      onProgress(++done, models.length);
    }));
  }
  async function resolveModel() {
    const modelId = config().get('ai.modelId', '');
    if (modelId) {
      const [configured] = await vscode.lm.selectChatModels({ id: modelId });
      if (configured) return configured;
    }
    const [lightest] = await sortedModels();
    if (!lightest) {
      throw new Error(L('No VS Code language model is available. Sign in to GitHub Copilot or configure a model provider first.',
        '没有可用的 VS Code 语言模型。请先登录 Copilot 或配置模型提供程序。',
        'Kein VS Code-Sprachmodell verfügbar. Melden Sie sich zuerst bei GitHub Copilot an oder konfigurieren Sie einen Modellanbieter.'));
    }
    return lightest;
  }
  // The list opens immediately; benchmarking is opt-in through the title-bar button.
  async function chooseModel() {
    const models = await sortedModels();
    if (!models.length) {
      throw new Error(L('No VS Code language model is available. Configure a model provider first.', '没有可用的 VS Code 模型。请先配置模型提供程序。',
        'Kein VS Code-Sprachmodell verfügbar. Konfigurieren Sie zuerst einen Modellanbieter.'));
    }
    const current = config().get('ai.modelId', '');
    const picker = vscode.window.createQuickPick();
    picker.title = L('Translate Anywhere: AI translation model', 'Translate Anywhere：选择 AI 翻译模型', 'Translate Anywhere: KI-Übersetzungsmodell');
    picker.placeholder = L('Lightweight models are listed first. Click the speed button to benchmark authorized models.',
      '轻量模型排在前面。可点击右上角测速按钮实测已授权模型的翻译耗时。',
      'Leichte Modelle stehen oben. Klicken Sie auf die Tempo-Schaltfläche, um autorisierte Modelle zu messen.');
    picker.matchOnDescription = picker.matchOnDetail = true;
    const measure = { iconPath: new vscode.ThemeIcon('dashboard'), tooltip: L('Measure translation speed', '测速', 'Übersetzungstempo messen') };
    picker.buttons = [measure];
    const auto = { label: `$(sparkle) ${L('Auto (prefer a lightweight model)', '自动（优先轻量模型）', 'Automatisch (leichtes Modell bevorzugen)')}`, model: null };
    const speed = model => {
      const timing = modelTimings.get(model.id);
      if (timing === undefined) return '';
      if (typeof timing === 'number') return `${(timing / 1000).toFixed(1)}s · `;
      return timing === 'unauthorized' ? L('not authorized yet · ', '未授权 · ', 'noch nicht autorisiert · ') : L('failed · ', '失败 · ', 'fehlgeschlagen · ');
    };
    const render = () => {
      const ordered = [...models].sort((a, b) => speedRank(a) - speedRank(b) || lightweightRank(a) - lightweightRank(b));
      auto.description = current ? '' : L('current', '当前', 'aktuell');
      const items = [auto, ...ordered.map(model => ({
        label: model.name,
        description: `${speed(model)}${model.vendor} · ${model.family}${model.id === current ? L(' · current', ' · 当前', ' · aktuell') : ''}`,
        detail: model.id, model
      }))];
      const active = picker.activeItems[0]?.model?.id ?? current;
      picker.items = items;
      picker.activeItems = [items.find(item => (item.model?.id || '') === active) || auto];
    };
    render();
    const cancel = new vscode.CancellationTokenSource();
    return new Promise(resolve => {
      let accepted = false;
      picker.onDidTriggerButton(async () => {
        picker.busy = true;
        picker.buttons = [];
        await measureModels(models, () => { if (!cancel.token.isCancellationRequested) render(); }, cancel.token);
        picker.busy = false;
        picker.buttons = [measure];
        panel?.refresh();
      });
      picker.onDidAccept(async () => {
        const item = picker.selectedItems[0];
        if (!item) return;
        accepted = true;
        picker.hide();
        await config().update('ai.modelId', item.model ? item.model.id : undefined, vscode.ConfigurationTarget.Global);
        resolve(item.model || await resolveModel());
      });
      picker.onDidHide(() => {
        cancel.cancel();
        picker.dispose();
        if (!accepted) resolve(undefined);
      });
      picker.show();
    });
  }
  async function runModel(model, text, timeoutMs, onDelta, signal, token, mode = 'selection') {
    const cancellation = new vscode.CancellationTokenSource();
    const timer = setTimeout(() => cancellation.cancel(), timeoutMs);
    const cancel = () => cancellation.cancel();
    signal?.addEventListener('abort', cancel);
    const tokenListener = token?.onCancellationRequested(cancel);
    const language = LANGUAGES[targetLanguage()];
    try {
      const messages = [
        vscode.LanguageModelChatMessage.User(buildPrompt(mode, language)),
        vscode.LanguageModelChatMessage.User(JSON.stringify({ text }))
      ];
      const native = (context.extension.packageJSON.contributes.configuration.properties[`${SECTION}.targetLanguage`]
        .enumItemLabels[Object.keys(LANGUAGES).indexOf(targetLanguage())] || language).replace(/ \(.*\)$/, '');
      const justification = L(`Translate Anywhere uses this model to translate text you select into ${language}.`,
        `Translate Anywhere 需要使用该模型，把你划选的文本翻译为${native}。`,
        `Translate Anywhere verwendet dieses Modell, um von Ihnen markierten Text zu übersetzen (Zielsprache: ${native}).`);
      const response = await model.sendRequest(messages, { justification }, cancellation.token);
      let translation = '';
      for await (const fragment of response.text) {
        translation += fragment;
        if (translation.length > 6000) {
          cancellation.cancel();
          throw new Error(L('The model output exceeded 6000 characters.', '模型输出超过 6000 字限制。', 'Die Modellausgabe hat 6000 Zeichen überschritten.'));
        }
        onDelta?.(fragment);
      }
      if (cancellation.token.isCancellationRequested) throw new Error(L('AI translation timed out or was cancelled.', 'AI 翻译超时或已取消。',
        'Die KI-Übersetzung hat das Zeitlimit überschritten oder wurde abgebrochen.'));
      if (!translation.trim()) throw new Error(L('The model returned no translation.', '模型未返回译文。', 'Das Modell hat keine Übersetzung geliefert.'));
      return translation.trim();
    } catch (error) {
      if (error instanceof vscode.LanguageModelError && error.code === 'NoPermissions') {
        throw new Error(`${L('This model is not authorized yet.', '尚未授权使用该模型。', 'Dieses Modell ist noch nicht autorisiert.')} ${AUTHORIZE_HINT()}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      tokenListener?.dispose();
      cancellation.dispose();
    }
  }
  // The AI engine: "vscode" (models offered through VS Code, e.g. Copilot) or a direct HTTP provider.
  const aiProvider = () => {
    const id = config().get('ai.provider', 'vscode');
    return id === 'vscode' || Object.hasOwn(PROVIDERS, id) ? id : 'vscode';
  };
  const secretKey = id => `translateAnywhere.apiKey.${id}`;
  const httpProvider = () => resolveProvider(aiProvider(), {
    baseUrl: config().get('ai.baseUrl', ''), model: config().get('ai.apiModel', '')
  });
  async function translate(text, onDelta, signal, mode = 'selection') {
    const providerId = aiProvider();
    const model = providerId === 'vscode' ? await resolveModel() : undefined;
    const provider = providerId === 'vscode' ? undefined : httpProvider();
    const engine = model ? model.id : `${provider.id}|${provider.baseUrl}|${provider.model}`;
    const key = `${engine}\n${targetLanguage()}\n${mode}\n${text.trim().toLowerCase()}`;
    if (aiCache.has(key)) return aiCache.get(key);
    if (aiInFlight >= MAX_AI_CONCURRENCY) {
      throw new Error(L(`Too many concurrent AI translations (limit ${MAX_AI_CONCURRENCY}); try again shortly.`,
        `同时进行的 AI 翻译已达 ${MAX_AI_CONCURRENCY} 个上限，请稍后重试。`,
        `Zu viele gleichzeitige KI-Übersetzungen (Limit ${MAX_AI_CONCURRENCY}); bitte gleich erneut versuchen.`));
    }
    aiInFlight++;
    try {
      const started = Date.now();
      let translation;
      let label;
      if (model) {
        // The consent dialog would open in this (bridge-owning) window, which may not be the one the user is reading.
        // Only allow it to prompt when this window is focused; otherwise fail fast with instructions.
        if (context.languageModelAccessInformation.canSendRequest(model) !== true && !vscode.window.state.focused) {
          throw new Error(AUTHORIZE_HINT());
        }
        translation = await runModel(model, text, 30000, onDelta, signal, undefined, mode);
        label = model.name;
      } else {
        const timeout = AbortSignal.timeout(30000);
        translation = await translateWithProvider({
          provider, apiKey: await context.secrets.get(secretKey(provider.id)) || '', text, mode,
          language: LANGUAGES[targetLanguage()], onDelta,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        }).catch(error => {
          if (timeout.aborted) throw new Error(L('AI translation timed out after 30 s.', 'AI 翻译超时（30 秒）。', 'Zeitüberschreitung der KI-Übersetzung nach 30 s.'));
          throw error;
        });
        label = `${provider.label} ${provider.model}`;
      }
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      output.appendLine(`AI ${engine}: ${elapsed}s for ${text.length} chars (${mode})`);
      const result = { translation, source: `AI · ${label} · ${elapsed}s` };
      if (aiCache.size >= 300) aiCache.delete(aiCache.keys().next().value);
      aiCache.set(key, result);
      return result;
    } finally {
      aiInFlight--;
    }
  }
  // Authorizes a VS Code model, or sends a short test request to an HTTP provider.
  async function authorizeModel() {
    if (aiProvider() !== 'vscode') {
      const provider = httpProvider();
      const apiKey = await context.secrets.get(secretKey(provider.id)) || '';
      const started = Date.now();
      const sample = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: L(`Testing ${provider.label} (${provider.model})…`, `正在测试 ${provider.label}（${provider.model}）…`,
          `${provider.label} (${provider.model}) wird getestet…`) },
        () => translateWithProvider({
          provider, apiKey, text: 'Hello, world', language: LANGUAGES[targetLanguage()],
          signal: AbortSignal.timeout(30000)
        })
      );
      await vscode.window.showInformationMessage(L(`AI translation is ready: ${provider.label} ${provider.model} (${((Date.now() - started) / 1000).toFixed(1)}s) → ${sample}`,
        `AI 翻译可用：${provider.label} ${provider.model}（${((Date.now() - started) / 1000).toFixed(1)} 秒）→ ${sample}`,
        `KI-Übersetzung ist bereit: ${provider.label} ${provider.model} (${((Date.now() - started) / 1000).toFixed(1)} s) → ${sample}`));
      return;
    }
    const model = await resolveModel();
    if (context.languageModelAccessInformation.canSendRequest(model) === true) {
      await vscode.window.showInformationMessage(L(`Translate Anywhere is authorized to use ${model.name}.`, `Translate Anywhere 已获得模型授权：${model.name}`,
        `Translate Anywhere darf jetzt ${model.name} verwenden.`));
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: L(`Requesting access to ${model.name}…`, `正在请求授权并测试 ${model.name}…`,
        `Zugriff auf ${model.name} wird angefordert…`) },
      () => runModel(model, 'hello', 60000)
    );
    await vscode.window.showInformationMessage(L(`AI translation is ready: ${model.name}`, `AI 翻译已可用：${model.name}`, `KI-Übersetzung ist bereit: ${model.name}`));
  }
  async function setApiKey(id = aiProvider()) {
    if (id === 'vscode') {
      id = (await pickProvider(false)) || '';
      if (!id) return false;
    }
    const preset = PROVIDERS[id];
    const value = await vscode.window.showInputBox({
      title: L(`API key for ${preset.label}`, `${preset.label} 的 API Key`, `API-Schlüssel für ${preset.label}`),
      prompt: L('Stored in VS Code Secret Storage (the OS keychain), never in settings.json. Leave empty and press Enter to delete the saved key.',
        '保存在 VS Code Secret Storage（系统钥匙串）中，不会写入 settings.json。留空并回车可删除已保存的 Key。',
        'Wird im VS Code Secret Storage (Schlüsselbund des Betriebssystems) gespeichert, nie in settings.json. Leer lassen und Enter drücken, um den gespeicherten Schlüssel zu löschen.'),
      password: true, ignoreFocusOut: true, placeHolder: preset.keyUrl ? L(`Get a key: ${preset.keyUrl}`, `获取 Key：${preset.keyUrl}`,
        `Schlüssel erhalten: ${preset.keyUrl}`) : ''
    });
    if (value === undefined) return false;
    if (value.trim()) await context.secrets.store(secretKey(id), value.trim());
    else await context.secrets.delete(secretKey(id));
    panel?.refresh();
    return true;
  }
  // QuickPick of AI engines; switching resets the per-provider endpoint/model overrides.
  async function pickProvider(includeVsCode = true) {
    const current = aiProvider();
    const items = [
      ...(includeVsCode ? [{ id: 'vscode', label: L('VS Code language models (GitHub Copilot etc.)', 'VS Code 语言模型（GitHub Copilot 等）',
        'VS Code-Sprachmodelle (GitHub Copilot usw.)'), description: L('no API key needed', '无需 API Key',
        'kein API-Schlüssel nötig') }] : []),
      ...Object.entries(PROVIDERS).map(([id, preset]) => ({ id, label: preset.label, description: preset.model ? `${preset.model}` : '' }))
    ].map(item => ({ ...item, description: `${item.description || ''}${item.id === current ? L(' · current', ' · 当前', ' · aktuell') : ''}` }));
    const picked = await vscode.window.showQuickPick(items, { title: L('Translate Anywhere: AI provider', 'Translate Anywhere：AI 服务商',
      'Translate Anywhere: KI-Anbieter') });
    return picked?.id;
  }
  async function switchProvider(id) {
    const target = vscode.ConfigurationTarget.Global;
    if (id !== aiProvider()) {
      await config().update('ai.provider', id === 'vscode' ? undefined : id, target);
      await config().update('ai.apiModel', undefined, target);
      await config().update('ai.baseUrl', undefined, target);
    }
    if (id !== 'vscode' && !PROVIDERS[id].keyOptional && !await context.secrets.get(secretKey(id))) await setApiKey(id);
  }
  // Model list of the HTTP provider; typing a name that is not listed is allowed.
  async function chooseApiModel() {
    const id = aiProvider();
    const preset = PROVIDERS[id];
    const current = config().get('ai.apiModel', '') || preset.model;
    const picker = vscode.window.createQuickPick();
    picker.title = L(`Translate Anywhere: ${preset.label} model`, `Translate Anywhere：${preset.label} 模型`, `Translate Anywhere: ${preset.label}-Modell`);
    picker.placeholder = L('Pick a model or type any model name and press Enter', '选择模型，或直接输入模型名后回车',
      'Modell auswählen oder beliebigen Modellnamen eingeben und Enter drücken');
    picker.busy = true;
    const toItems = names => [...new Set([current, preset.model, ...names].filter(Boolean))]
      .map(name => ({ label: name, description: [name === preset.model ? L('default', '默认',
        'Standard') : '', name === current ? L('current', '当前',
        'aktuell') : ''].filter(Boolean).join(' · ') }));
    picker.items = toItems([]);
    picker.show();
    // The model field may still be empty for a custom endpoint; listing does not need it.
    const showListError = error => {
      picker.placeholder = L(`Could not list models (${errorText(error)}); type a model name`, `无法获取模型列表（${errorText(error)}）；请直接输入模型名`,
        `Modelle konnten nicht abgerufen werden (${errorText(error)}); bitte Modellnamen eingeben`);
    };
    Promise.resolve().then(async () => listProviderModels({
      provider: resolveProvider(id, { baseUrl: config().get('ai.baseUrl', ''), model: current || 'any' }),
      apiKey: await context.secrets.get(secretKey(id)) || '', signal: AbortSignal.timeout(15000)
    }))
      .then(names => { picker.items = toItems(names); }, showListError)
      .finally(() => { picker.busy = false; });
    return new Promise(resolve => {
      let accepted = false;
      picker.onDidAccept(async () => {
        const name = (picker.selectedItems[0]?.label || picker.value).trim();
        if (!name) return;
        accepted = true;
        picker.hide();
        await config().update('ai.apiModel', name === preset.model ? undefined : name, vscode.ConfigurationTarget.Global);
        resolve(name);
      });
      picker.onDidHide(() => { picker.dispose(); if (!accepted) resolve(undefined); });
    });
  }
  // Dictionary: a user-chosen file, the copy bundled in the offline VSIX, or a one-time download.
  const dictionaryInfo = JSON.parse(fs.readFileSync(context.asAbsolutePath('data/dictionary-source.json'), 'utf8'));
  let dictionary;
  let dictionaryPromise;
  let downloadPromise;
  let dictionaryState = { status: 'idle' };
  // After a failed automatic download, wait before retrying and warn only once per window.
  let downloadRetryAt = 0;
  let downloadWarned = false;
  const setDictionaryState = state => { dictionaryState = state; panel?.refresh(); };
  function findDictionary() {
    return locateDictionary({
      customPath: config().get('dictionary.path', '').trim(),
      bundledFile: context.asAbsolutePath('data/dictionary.json.gz'),
      storageFolder: stateFolder, sha256: dictionaryInfo.dictionarySHA256
    });
  }
  const loadDictionary = () => {
    dictionaryPromise ||= (async () => {
      let found = findDictionary();
      if (!found) {
        if (!config().get('dictionary.autoDownload', true)) {
          setDictionaryState({ status: 'missing' });
          throw new Error(L('The offline dictionary is not installed.', '离线词典尚未安装。', 'Das Offline-Wörterbuch ist nicht installiert.'));
        }
        if (Date.now() < downloadRetryAt) throw new Error(dictionaryState.error || L('Dictionary download failed.', '词典下载失败。',
          'Download des Wörterbuchs fehlgeschlagen.'));
        await fetchDictionary();
        found = findDictionary();
        if (!found) throw new Error(L('The offline dictionary is not installed.', '离线词典尚未安装。', 'Das Offline-Wörterbuch ist nicht installiert.'));
      }
      setDictionaryState({ status: 'loading', kind: found.kind, file: found.file });
      const loaded = await Dictionary.load(found.file);
      const entries = found.kind === 'custom' ? Object.keys(loaded.entries).length : dictionaryInfo.entries;
      dictionary = loaded;
      setDictionaryState({ status: 'ready', kind: found.kind, file: found.file, entries });
      output.appendLine(`Dictionary loaded (${found.kind}, ${entries} entries): ${found.file}`);
      return loaded;
    })().catch(error => {
      dictionaryPromise = undefined;
      if (dictionaryState.status !== 'missing') setDictionaryState({ status: 'error', error: errorText(error) });
      throw error;
    });
    return dictionaryPromise;
  };
  function reloadDictionary() {
    dictionary = undefined;
    dictionaryPromise = undefined;
    if (server) loadDictionary().catch(logError);
    else setDictionaryState({ status: 'idle' });
  }
  // Downloads in the background with status-bar progress; lookups fall back to AI until it is ready.
  function fetchDictionary({ manual = false } = {}) {
    downloadPromise ||= vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: L('Translate Anywhere: downloading dictionary', 'Translate Anywhere：正在下载词典',
        'Translate Anywhere: Wörterbuch wird heruntergeladen') },
      async progress => {
        const custom = config().get('dictionary.downloadUrl', '').trim();
        let last = -1;
        const result = await downloadDictionary({
          storageFolder: stateFolder, sha256: dictionaryInfo.dictionarySHA256,
          mirrors: [custom, ...DEFAULT_MIRRORS],
          onProgress: ({ url, received, total }) => {
            const percent = total ? Math.floor(received * 100 / total) : -1;
            if (percent === last) return;
            last = percent;
            progress.report({ message: total ? `${percent}%` : `${(received / 1048576).toFixed(1)} MB` });
            setDictionaryState({ status: 'downloading', percent, received, url });
          }
        });
        output.appendLine(`Dictionary downloaded from ${result.url}`);
        downloadRetryAt = 0;
        return result;
      }
    ).then(result => result, error => {
      logError(error);
      downloadRetryAt = Date.now() + 10 * 60 * 1000;
      setDictionaryState({ status: 'error', error: errorText(error).split('\n')[0] });
      if (!manual && downloadWarned) throw error;
      downloadWarned = true;
      const retry = L('Retry', '重试', 'Wiederholen');
      const choose = L('Choose File…', '选择本地文件…', 'Datei auswählen…');
      const offline = L('Offline Package', '离线安装包', 'Offline-Paket');
      vscode.window.showWarningMessage(
        L('Translate Anywhere could not download the offline dictionary (AI translation still works). Retry, pick a local dictionary file, or install the offline VSIX.',
          'Translate Anywhere 无法下载离线词典（AI 翻译仍可用）。可重试、指定本地词典文件，或安装离线版 VSIX。',
          'Translate Anywhere konnte das Offline-Wörterbuch nicht herunterladen (die KI-Übersetzung funktioniert weiterhin). Erneut versuchen, eine lokale Wörterbuchdatei auswählen oder die Offline-VSIX installieren.'),
        retry, choose, offline).then(choice => {
        if (choice === retry) vscode.commands.executeCommand('translateAnywhere.downloadDictionary');
        if (choice === choose) vscode.commands.executeCommand('translateAnywhere.chooseDictionaryFile');
        if (choice === offline) vscode.env.openExternal(vscode.Uri.parse('https://github.com/MusingZone/vscode-translate-anywhere/releases'));
      });
      throw error;
    }).finally(() => { downloadPromise = undefined; });
    return downloadPromise;
  }
  async function lookup(text) {
    if (dictionary) return dictionary.lookup(text);
    // While the dictionary loads from disk, wait; while it downloads (or is missing), let the UI fall back to AI.
    if (!downloadPromise) {
      try { return (await loadDictionary()).lookup(text); } catch { /* reported via dictionaryState */ }
    }
    return { found: false, word: text.trim(), unavailable: true };
  }
  // German–Chinese dictionary (HanDeDict): loaded on the first German lookup, downloaded once if not bundled.
  const germanInfo = JSON.parse(fs.readFileSync(context.asAbsolutePath('data/dictionary-de-source.json'), 'utf8'));
  let germanDictionary;
  let germanPromise;
  let germanDownload;
  let germanRetryAt = 0;
  let germanState = { status: 'idle' };
  const setGermanState = state => { germanState = state; panel?.refresh(); };
  const findGerman = () => locateDictionary({
    bundledFile: context.asAbsolutePath('data/dictionary-de.json.gz'),
    storageFolder: stateFolder, sha256: germanInfo.dictionarySHA256, name: 'dictionary-de'
  });
  function fetchGerman() {
    germanDownload ||= vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: L('Translate Anywhere: downloading German dictionary',
        'Translate Anywhere：正在下载德汉词典', 'Translate Anywhere: Deutsch-Chinesisch-Wörterbuch wird heruntergeladen') },
      async progress => {
        let last = -1;
        const result = await downloadDictionary({
          storageFolder: stateFolder, sha256: germanInfo.dictionarySHA256, name: 'dictionary-de', mirrors: GERMAN_MIRRORS,
          onProgress: ({ url, received, total }) => {
            const percent = total ? Math.floor(received * 100 / total) : -1;
            if (percent === last) return;
            last = percent;
            progress.report({ message: total ? `${percent}%` : `${(received / 1048576).toFixed(1)} MB` });
            setGermanState({ status: 'downloading', percent, received, url });
          }
        });
        output.appendLine(`German dictionary downloaded from ${result.url}`);
        germanRetryAt = 0;
        return result;
      }
    ).then(result => result, error => {
      logError(error);
      germanRetryAt = Date.now() + 10 * 60 * 1000;
      setGermanState({ status: 'error', error: errorText(error).split('\n')[0] });
      throw error;
    }).finally(() => { germanDownload = undefined; });
    return germanDownload;
  }
  const loadGerman = ({ manual = false } = {}) => {
    germanPromise ||= (async () => {
      let found = findGerman();
      if (!found) {
        if (!manual && (!config().get('dictionary.german', true) || Date.now() < germanRetryAt)) {
          throw new Error(L('The German dictionary is not installed.', '德汉词典尚未安装。', 'Das Deutsch-Chinesisch-Wörterbuch ist nicht installiert.'));
        }
        await fetchGerman();
        found = findGerman();
        if (!found) throw new Error(L('The German dictionary is not installed.', '德汉词典尚未安装。', 'Das Deutsch-Chinesisch-Wörterbuch ist nicht installiert.'));
      }
      setGermanState({ status: 'loading', kind: found.kind });
      germanDictionary = await Dictionary.load(found.file, 'de');
      setGermanState({ status: 'ready', kind: found.kind, entries: germanInfo.entries });
      output.appendLine(`German dictionary loaded (${found.kind}, ${germanInfo.entries} entries): ${found.file}`);
      return germanDictionary;
    })().catch(error => {
      germanPromise = undefined;
      if (germanState.status !== 'error') setGermanState({ status: 'idle' });
      throw error;
    });
    return germanPromise;
  };
  // German context: HanDeDict first. A miss on a word without umlauts (an English term inside German text, or a
  // misdetected context) falls back to the English dictionary, so English lookups behave exactly as before.
  async function lookupAny(text, language) {
    if (language !== 'de') return lookup(text);
    const german = await lookupGerman(text);
    if (german.found || german.unavailable || /[äöüß]/i.test(text)) return german;
    const english = await lookup(text);
    return english.found ? english : german;
  }
  async function lookupGerman(text) {
    const enabled = config().get('dictionary.german', true);
    if (enabled && germanDictionary) return germanDictionary.lookup(text);
    if (enabled && !germanDownload) {
      // Load (or start the one-time download) without blocking: until then the UI falls back to AI.
      const pending = loadGerman();
      pending.catch(() => {});
      if (findGerman()) {
        try { return (await pending).lookup(text); } catch { /* reported via germanState */ }
      }
    }
    return { found: false, word: text.trim(), unavailable: true, language: 'de' };
  }
  // Everything the injected UI needs; it polls /status, so changes apply without a reload.
  const runtimeSettings = () => {
    const surfaces = config().get('surfaces', {}) || {};
    const shortcuts = config().get('shortcuts', {}) || {};
    return {
      targetLanguage: targetLanguage(),
      uiLanguage: uiLanguage(),
      fullPageMode: config().get('fullPage.mode', 'translationOnly'),
      autoAI: config().get('ai.autoTranslate', true),
      surfaces: Object.fromEntries(SURFACES.map(key => [key, surfaces[key] !== false])),
      shortcuts: {
        paragraph: typeof shortcuts.paragraph === 'string' ? shortcuts.paragraph : 'Alt+Z',
        fullPage: typeof shortcuts.fullPage === 'string' ? shortcuts.fullPage : 'Alt+W'
      }
    };
  };
  // Another window may be busy starting up (e.g. after a crash restores several windows), so retry before giving up.
  async function probeSharedBridge() {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      let response;
      try {
        response = await fetch(`http://127.0.0.1:${PORT}/status`, {
          method: 'POST',
          headers: { Origin: 'vscode-file://vscode-app', 'X-Immersive-Token': token },
          signal: AbortSignal.timeout(5000)
        });
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      const status = await response.json().catch(() => ({}));
      if (!response.ok || status.service !== 'immersive-translate-vscode') {
        throw Object.assign(new Error(`Port ${PORT} is used by another program; it was left untouched.`), { foreign: true });
      }
      return;
    }
    throw lastError;
  }
  let bridgeStarting;
  let reuseLogged = false;
  function startBridge() {
    if (server) return Promise.resolve();
    bridgeStarting ||= startBridgeOnce().finally(() => { bridgeStarting = undefined; });
    return bridgeStarting;
  }
  async function startBridgeOnce() {
    try {
      server = await createBridge({
        token, dictionary: { lookup: lookupAny }, translate, vocabulary,
        isEnabled: () => config().get('integration.enabled', false),
        getStatus: () => ({ version, settings: runtimeSettings() }),
        onError: logError
      });
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      // Heartbeat keeps retrying and takes over the port if the owning window goes away.
      sharedBridge = true;
      try {
        await probeSharedBridge();
        if (!reuseLogged) output.appendLine('Reusing the authenticated local bridge from another VS Code window.');
        reuseLogged = true;
      } catch (probeError) {
        if (probeError.foreign) { sharedBridge = false; throw probeError; }
        output.appendLine(`Shared bridge not responding yet (${errorText(probeError)}); will retry in background.`);
      }
      return;
    }
    sharedBridge = false;
    loadDictionary().catch(logError);
    context.subscriptions.push({ dispose: () => server.close() });
    output.appendLine(`Local bridge listening on 127.0.0.1:${PORT}`);
  }
  async function maintain(mode) {
    return withPatchLock(stateFolder, () => maintainUnlocked(mode));
  }
  async function maintainUnlocked(mode) {
    try {
      return mode === 'apply'
        ? applyPatch(vscode.env.appRoot, stateFolder, ui.toString(), { endpoint: `http://127.0.0.1:${PORT}`, token, version })
        : { changed: restorePatch(vscode.env.appRoot, stateFolder) };
    } catch (error) {
      if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw error;
      const readOnly = readOnlyInstallReason(vscode.env.appRoot);
      if (readOnly || error.code === 'EROFS') throw new Error(readOnlyMessage(readOnly));
      if (!['win32', 'darwin', 'linux'].includes(process.platform)) throw error;
      const { message, button } = elevationText();
      const consent = await vscode.window.showWarningMessage(message, { modal: true }, button);
      if (!consent) throw new Error(L('Administrator confirmation was cancelled; VS Code files were not changed.', '已取消管理员确认，未修改 VS Code 文件。',
        'Administratorbestätigung abgebrochen; VS Code-Dateien wurden nicht geändert.'));
      try {
        return await elevatedMaintenance({
          appRoot: vscode.env.appRoot, stateFolder, extensionRoot: context.extensionUri.fsPath,
          codeExecutable: process.execPath, mode,
          prompt: L('Translate Anywhere needs to update VS Code\'s UI files.', 'Translate Anywhere 需要更新 VS Code 的界面文件。',
            'Translate Anywhere muss die UI-Dateien von VS Code aktualisieren.')
        });
      } catch (elevationError) {
        if (elevationError.manualCommand) {
          const copy = L('Copy Terminal Command', '复制终端命令', 'Terminalbefehl kopieren');
          const choice = await vscode.window.showErrorMessage(L(
            `Translate Anywhere: ${elevationError.message}. Run the copied command in a terminal (it asks for your sudo password), then reload the window.`,
            `Translate Anywhere：${elevationError.message}。请在终端中运行已复制的命令（会要求输入 sudo 密码），然后重载窗口。`,
            `Translate Anywhere: ${elevationError.message}. Führen Sie den kopierten Befehl in einem Terminal aus (er fragt nach Ihrem sudo-Passwort) und laden Sie dann das Fenster neu.`), copy);
          if (choice === copy) await vscode.env.clipboard.writeText(elevationError.manualCommand);
        }
        throw elevationError;
      }
    }
  }
  function elevationText() {
    if (process.platform === 'darwin') {
      return {
        message: L('The VS Code application is not writable by your user account. Confirm this one patch operation with an administrator password? No background helper is installed; VS Code updates may ask again.',
          'VS Code 应用对当前用户账户不可写。是否用管理员密码确认这一次修改？不会安装任何后台程序；VS Code 更新后可能需要再次确认。',
          'Die VS Code-Anwendung ist für Ihr Benutzerkonto nicht beschreibbar. Diesen einen Patch-Vorgang mit einem Administratorpasswort bestätigen? Es wird kein Hintergrunddienst installiert; nach VS Code-Updates wird eventuell erneut gefragt.'),
        button: L('Continue as Administrator', '以管理员身份继续', 'Als Administrator fortfahren')
      };
    }
    if (process.platform === 'linux') {
      return {
        message: L('The VS Code installation folder is owned by root (typical for .deb/.rpm installs). Confirm this one patch operation through the system authentication dialog (polkit)? No background service is installed; VS Code updates will ask again.',
          'VS Code 安装目录属于 root（.deb/.rpm 安装通常如此）。是否通过系统认证对话框（polkit）确认这一次修改？不会安装任何后台服务；VS Code 更新后需要再次确认。',
          'Der VS Code-Installationsordner gehört root (typisch für .deb/.rpm-Installationen). Diesen einen Patch-Vorgang über den Systemauthentifizierungsdialog (polkit) bestätigen? Es wird kein Hintergrunddienst installiert; nach VS Code-Updates wird erneut gefragt.'),
        button: L('Continue as Administrator', '以管理员身份继续', 'Als Administrator fortfahren')
      };
    }
    return {
      message: L('The VS Code installation folder needs administrator rights. Confirm this one patch operation through Windows UAC? No persistent admin task is created; VS Code updates will ask again.',
        'VS Code 安装目录需要管理员权限。是否通过 Windows UAC 确认这一次修改？不会创建常驻的管理员任务；VS Code 更新后需要再次确认。',
        'Der VS Code-Installationsordner erfordert Administratorrechte. Diesen einen Patch-Vorgang über die Windows-Benutzerkontensteuerung (UAC) bestätigen? Es wird keine dauerhafte Admin-Aufgabe angelegt; nach VS Code-Updates wird erneut gefragt.'),
      button: L('Continue with UAC', '通过 UAC 继续', 'Mit UAC fortfahren')
    };
  }
  function readOnlyMessage(reason) {
    if (reason === 'translocated') {
      return L('VS Code is running from a temporary read-only location (macOS App Translocation). Move "Visual Studio Code.app" to the Applications folder, start it from there and retry.',
        'VS Code 正从 macOS 的临时只读位置运行（App Translocation）。请把“Visual Studio Code.app”移到“应用程序”文件夹，从那里启动后重试。',
        'VS Code läuft von einem temporären, schreibgeschützten Ort (macOS App Translocation). Verschieben Sie "Visual Studio Code.app" in den Ordner "Programme", starten Sie es von dort und versuchen Sie es erneut.');
    }
    if (reason === 'snap' || reason === 'flatpak') {
      return L(`The ${reason === 'snap' ? 'Snap' : 'Flatpak'} package of VS Code is read-only and cannot be integrated. Install VS Code from the .deb/.rpm package or the .tar.gz archive from code.visualstudio.com instead.`,
        `VS Code 的 ${reason === 'snap' ? 'Snap' : 'Flatpak'} 包是只读的，无法集成。请改用 code.visualstudio.com 提供的 .deb/.rpm 包或 .tar.gz 压缩包安装 VS Code。`,
        `Das ${reason === 'snap' ? 'Snap' : 'Flatpak'}-Paket von VS Code ist schreibgeschützt und kann nicht integriert werden. Installieren Sie VS Code stattdessen aus dem .deb/.rpm-Paket oder dem .tar.gz-Archiv von code.visualstudio.com.`);
    }
    return L('The VS Code installation is on a read-only file system and cannot be integrated.', 'VS Code 安装位于只读文件系统上，无法集成。',
      'Die VS Code-Installation liegt auf einem schreibgeschützten Dateisystem und kann nicht integriert werden.');
  }
  // The patched integrity check reads the current product.json checksums, so a window reload is enough.
  async function offerReload(message) {
    const reload = L('Reload Window', '重载窗口', 'Fenster neu laden');
    if (await vscode.window.showInformationMessage(message, reload) === reload) {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }
  async function integrate() {
    if (!server && !sharedBridge) await startBridge();
    const result = await maintain('apply');
    patchStatus = result.changed ? 'Applied; reload windows to load the new UI' : 'Installed and up to date';
    output.appendLine(patchStatus);
    panel?.refresh();
    if (result.changed) {
      await offerReload(L('Translate Anywhere is integrated with this VS Code version. Reload the window to start using it.',
        'Translate Anywhere 已为当前 VS Code 版本完成集成，重载窗口后生效。',
        'Translate Anywhere ist in diese VS Code-Version integriert. Laden Sie das Fenster neu, um es zu verwenden.'));
    }
  }
  async function enable() {
    if (!config().get('integration.enabled', false)) {
      const consent = await vscode.window.showWarningMessage(
        L('Enable the Translate Anywhere UI integration?', '启用 Translate Anywhere 界面集成？', 'UI-Integration von Translate Anywhere aktivieren?'),
        {
          modal: true,
          detail: L('To show translations inside Chat, Markdown preview, Release Notes and Settings, this extension adds a small script to VS Code\'s own UI files and updates their checksums. Originals are backed up and restored by "Disable and Restore VS Code" or on uninstall. VS Code updates replace the files; the patch is then reapplied automatically.',
            '为在 Chat、Markdown 预览、Release Notes、设置页中显示翻译，本扩展会向 VS Code 自身的界面文件加入一小段脚本并更新其校验值。原文件会备份，可通过“Disable and Restore VS Code”或卸载扩展时恢复。VS Code 更新会替换这些文件，之后会自动重新集成。',
            'Um Übersetzungen in Chat, Markdown-Vorschau, Release Notes und Einstellungen anzuzeigen, fügt diese Erweiterung den UI-Dateien von VS Code ein kleines Skript hinzu und aktualisiert deren Prüfsummen. Die Originale werden gesichert und durch "Disable and Restore VS Code" oder bei der Deinstallation wiederhergestellt. VS Code-Updates ersetzen die Dateien; der Patch wird dann automatisch erneut angewendet.')
        },
        L('Allow and Enable', '允许并启用', 'Zulassen und aktivieren')
      );
      if (!consent) return;
      await config().update('integration.enabled', true, vscode.ConfigurationTarget.Global);
    }
    await integrate();
  }
  const guarded = action => async () => {
    try { await action(); }
    catch (error) {
      patchStatus = errorText(error);
      logError(error);
      panel?.refresh();
      await vscode.window.showErrorMessage(`Translate Anywhere: ${errorText(error)}`);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('translateAnywhere.enable', guarded(enable)),
    vscode.commands.registerCommand('translateAnywhere.disable', guarded(async () => {
      await config().update('integration.enabled', false, vscode.ConfigurationTarget.Global);
      const restored = (await maintain('restore')).changed;
      patchStatus = restored ? 'Restored; restart VS Code to unload the UI patch' : 'Disabled';
      output.appendLine(patchStatus);
      panel?.refresh();
      if (restored) {
        await offerReload(L('VS Code files restored. Restart VS Code to finish; until then a reload may show VS Code\'s one-time "installation appears to be corrupt" notice.',
          '已恢复 VS Code 原文件。完全重启 VS Code 后彻底生效；在此之前重载窗口可能出现一次“安装已损坏”提示。',
          'VS Code-Dateien wiederhergestellt. Starten Sie VS Code neu, um den Vorgang abzuschließen; bis dahin kann ein Neuladen einmalig den VS Code-Hinweis zu einer "beschädigten Installation" anzeigen.'));
      } else {
        await vscode.window.showInformationMessage(L('Translation disabled.', '已禁用翻译。', 'Übersetzung deaktiviert.'));
      }
    })),
    vscode.commands.registerCommand('translateAnywhere.selectModel', guarded(async () => {
      if (aiProvider() !== 'vscode') {
        if (await chooseApiModel()) await authorizeModel();
      } else if (await chooseModel()) {
        await authorizeModel();
      }
    })),
    vscode.commands.registerCommand('translateAnywhere.selectProvider', guarded(async () => {
      const id = await pickProvider();
      if (!id) return;
      await switchProvider(id);
      if (id !== 'vscode' && (PROVIDERS[id].keyOptional || await context.secrets.get(secretKey(id)))) await authorizeModel();
    })),
    vscode.commands.registerCommand('translateAnywhere.setApiKey', guarded(() => setApiKey())),
    vscode.commands.registerCommand('translateAnywhere.downloadDictionary', guarded(async () => {
      // A failure is already reported with recovery actions.
      try { await fetchDictionary({ manual: true }); } catch { return; }
      reloadDictionary();
      await vscode.window.showInformationMessage(L('Offline dictionary installed.', '离线词典已安装。', 'Offline-Wörterbuch installiert.'));
    })),
    vscode.commands.registerCommand('translateAnywhere.downloadGermanDictionary', guarded(async () => {
      germanDictionary = undefined;
      germanPromise = undefined;
      germanRetryAt = 0;
      await loadGerman({ manual: true });
      await vscode.window.showInformationMessage(L('German–Chinese dictionary installed.', '德汉词典已安装。', 'Deutsch-Chinesisch-Wörterbuch installiert.'));
    })),
    vscode.commands.registerCommand('translateAnywhere.chooseDictionaryFile', guarded(async () => {
      const [file] = await vscode.window.showOpenDialog({
        canSelectMany: false, title: L('Choose a Translate Anywhere dictionary (.json.gz)', '选择 Translate Anywhere 词典文件（.json.gz）',
          'Translate Anywhere-Wörterbuch auswählen (.json.gz)'),
        filters: { [L('Dictionary', '词典', 'Wörterbuch')]: ['gz'] }
      }) || [];
      if (!file) return;
      // Validate before saving the setting so a bad file never replaces a working dictionary.
      const loaded = await Dictionary.load(file.fsPath);
      let sample;
      for (const word in loaded.entries) { sample = loaded.entries[word]; break; }
      if (!Array.isArray(sample)) throw new Error(L('Not a Translate Anywhere dictionary file.', '不是有效的词典文件。', 'Keine gültige Translate Anywhere-Wörterbuchdatei.'));
      await config().update('dictionary.path', file.fsPath, vscode.ConfigurationTarget.Global);
    })),
    vscode.commands.registerCommand('translateAnywhere.useDefaultDictionary', guarded(() =>
      config().update('dictionary.path', undefined, vscode.ConfigurationTarget.Global))),
    vscode.commands.registerCommand('translateAnywhere.showLog', () => output.show(true)),
    vscode.commands.registerCommand('translateAnywhere.authorizeAI', guarded(authorizeModel)),
    vscode.commands.registerCommand('translateAnywhere.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)),
    vscode.commands.registerCommand('translateAnywhere.openVocabulary', guarded(async () => {
      const file = vscode.Uri.file(path.join(stateFolder, 'vocabulary.md'));
      fs.writeFileSync(file.fsPath, vocabulary.toMarkdown(uiLanguage()), 'utf8');
      await vscode.commands.executeCommand('markdown.showPreview', file);
    })),
    vscode.commands.registerCommand('translateAnywhere.exportVocabulary', guarded(async () => {
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(require('node:os').homedir(), 'Documents', 'vocabulary.csv')),
        filters: { CSV: ['csv'] }, title: L('Export vocabulary', '导出生词本', 'Vokabelliste exportieren')
      });
      if (!target) return;
      fs.writeFileSync(target.fsPath, vocabulary.toCsv(), 'utf8');
      await vscode.window.showInformationMessage(L(`Exported ${vocabulary.list().length} entries to ${target.fsPath}`,
        `已导出 ${vocabulary.list().length} 条生词到 ${target.fsPath}`,
        `${vocabulary.list().length} Einträge nach ${target.fsPath} exportiert`));
    })),
    vscode.commands.registerCommand('translateAnywhere.removeVocabulary', guarded(async () => {
      const picked = await vscode.window.showQuickPick(
        vocabulary.list().map(entry => ({ label: entry.text, description: entry.translation.replace(/\s+/g, ' ').slice(0, 80) })),
        { canPickMany: true, title: L('Select vocabulary entries to remove', '选择要从生词本删除的条目',
          'Zu entfernende Einträge der Vokabelliste auswählen'), matchOnDescription: true }
      );
      if (!picked?.length) return;
      const removed = vocabulary.remove(picked.map(item => item.label));
      await vscode.window.showInformationMessage(L(`Removed ${removed} entries.`, `已从生词本删除 ${removed} 条。`, `${removed} Einträge entfernt.`));
    })),
    vscode.commands.registerCommand('translateAnywhere.status', () => {
      output.appendLine(JSON.stringify({
        version, appRoot: vscode.env.appRoot, patchStatus,
        enabled: config().get('integration.enabled', false),
        autoRepair: config().get('integration.autoRepair', true),
        aiProvider: aiProvider(), dictionary: dictionaryState, germanDictionary: germanState,
        bridgeListening: !!server || sharedBridge, sharedBridge, modelId: config().get('ai.modelId', ''),
        settings: runtimeSettings()
      }, null, 2));
      output.show(true);
    })
  );
  const heartbeat = setInterval(() => {
    if (sharedBridge) startBridge().catch(logError);
  }, 10000);
  context.subscriptions.push({ dispose: () => clearInterval(heartbeat) });
  const languageLabels = context.extension.packageJSON.contributes.configuration.properties[`${SECTION}.targetLanguage`].enumItemLabels;
  // Everything the sidebar renders. Values come from settings, so the panel and the Settings UI stay in sync.
  async function panelState() {
    const providerId = aiProvider();
    const preset = PROVIDERS[providerId];
    let vscodeModels = [];
    if (providerId === 'vscode') {
      try {
        vscodeModels = (await sortedModels()).sort((a, b) => speedRank(a) - speedRank(b))
          .map(model => ({ id: model.id, name: model.name, detail: `${model.vendor} · ${model.family}`, timing: modelTimings.get(model.id) ?? null }));
      } catch (error) { logError(error); }
    }
    return {
      version, uiLanguage: uiLanguage(),
      integration: { enabled: config().get('integration.enabled', false), status: patchStatus },
      targetLanguage: targetLanguage(),
      languages: Object.keys(LANGUAGES).map((code, index) => ({ code, label: languageLabels[index] || code })),
      fullPageMode: config().get('fullPage.mode', 'translationOnly'),
      autoAI: config().get('ai.autoTranslate', true),
      provider: providerId,
      providers: [{ id: 'vscode', label: L('VS Code language models (Copilot…)', 'VS Code 语言模型（Copilot 等）', 'VS Code-Sprachmodelle (Copilot…)') },
        ...Object.entries(PROVIDERS).map(([id, item]) => ({ id, label: item.label }))],
      vscodeModels, modelId: config().get('ai.modelId', ''), benchmark,
      apiModel: config().get('ai.apiModel', ''), baseUrl: config().get('ai.baseUrl', ''),
      providerDefaults: preset ? { model: preset.model, baseUrl: preset.baseUrl, keyUrl: preset.keyUrl || '', keyOptional: !!preset.keyOptional } : null,
      hasKey: preset ? !!await context.secrets.get(secretKey(providerId)) : false,
      dictionary: { ...dictionaryState, path: config().get('dictionary.path', ''), owner: !!server },
      germanDictionary: { ...germanState, enabled: config().get('dictionary.german', true) },
      surfaces: runtimeSettings().surfaces,
      shortcuts: runtimeSettings().shortcuts,
      vocabularyCount: vocabulary.list().length
    };
  }
  // Sidebar speed test: progress and results reach the panel through its state, so they survive the view being hidden.
  let benchmark = null;
  async function benchmarkModels() {
    if (benchmark) return;
    const models = await sortedModels();
    benchmark = { done: 0, total: models.length };
    panel.refresh();
    try {
      await measureModels(models, done => { benchmark.done = done; panel.refresh(); });
    } finally {
      benchmark = null;
      panel.refresh();
    }
  }
  const PANEL_KEYS = /^(targetLanguage|fullPage\.mode|ai\.(autoTranslate|provider|modelId|apiModel|baseUrl)|surfaces\.\w+|shortcuts\.(paragraph|fullPage))$/;
  panel = new SettingsPanel(context, {
    state: panelState,
    update: async (key, value) => {
      if (!PANEL_KEYS.test(key)) throw new Error(`Unsupported setting: ${key}`);
      if (key === 'ai.provider') return switchProvider(value);
      if (key.startsWith('surfaces.') || key.startsWith('shortcuts.')) {
        const [group, name] = key.split('.');
        if (group === 'shortcuts') return config().update(`shortcuts.${name}`, value, vscode.ConfigurationTarget.Global);
        const surfaces = { ...runtimeSettings().surfaces, [name]: !!value };
        return config().update('surfaces', surfaces, vscode.ConfigurationTarget.Global);
      }
      return config().update(key, value === '' || value === null ? undefined : value, vscode.ConfigurationTarget.Global);
    },
    command: (id, ...args) => vscode.commands.executeCommand(id, ...args),
    listModels: async () => {
      const id = aiProvider();
      return listProviderModels({
        provider: resolveProvider(id, { baseUrl: config().get('ai.baseUrl', ''), model: 'any' }),
        apiKey: await context.secrets.get(secretKey(id)) || '', signal: AbortSignal.timeout(15000)
      });
    },
    benchmark: benchmarkModels,
    openExternal: url => vscode.env.openExternal(vscode.Uri.parse(url))
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SettingsPanel.viewType, panel),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration(SECTION)) return;
      if (event.affectsConfiguration(`${SECTION}.dictionary.path`)) reloadDictionary();
      if (event.affectsConfiguration(`${SECTION}.ai`) || event.affectsConfiguration(`${SECTION}.targetLanguage`)) aiCache.clear();
      panel.refresh();
    }),
    context.secrets.onDidChange(() => panel.refresh()),
    vscode.lm.onDidChangeChatModels(() => panel.refresh())
  );
  try {
    await startBridge();
    if (config().get('integration.enabled', false)) {
      if (config().get('integration.autoRepair', true)) await integrate();
    } else if (!context.globalState.get('welcomeShown')) {
      await context.globalState.update('welcomeShown', true);
      const action = L('Enable…', '启用…', 'Aktivieren…');
      const choice = await vscode.window.showInformationMessage(
        L('Translate Anywhere: select text in Chat, Markdown preview, Release Notes or Settings and hover the red dot to translate. Enable the UI integration to start.',
          'Translate Anywhere：在 Chat、Markdown 预览、Release Notes、设置页中划词并悬停红点即可翻译。启用界面集成后开始使用。',
          'Translate Anywhere: Markieren Sie Text in Chat, Markdown-Vorschau, Release Notes oder Einstellungen und zeigen Sie auf den roten Punkt, um ihn zu übersetzen. Aktivieren Sie zuerst die UI-Integration.'),
        action);
      if (choice === action) await guarded(enable)();
    }
  } catch (error) {
    patchStatus = errorText(error);
    logError(error);
    await vscode.window.showErrorMessage(L(
      `Translate Anywhere could not integrate automatically: ${errorText(error)}. Nothing was overwritten; run "Translate Anywhere: Enable / Repair Integration" to retry.`,
      `Translate Anywhere 自动集成失败：${errorText(error)}。未强行覆盖；运行 Enable / Repair 检查权限或兼容性。`,
      `Translate Anywhere konnte nicht automatisch integriert werden: ${errorText(error)}. Es wurde nichts überschrieben; führen Sie "Translate Anywhere: Enable / Repair Integration" aus, um es erneut zu versuchen.`));
  }
}
module.exports = { activate };
