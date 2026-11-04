'use strict';
const vscode = require('vscode');
const crypto = require('node:crypto');

const STRINGS = {
  en: {
    integration: 'Integration', active: 'Active', off: 'Not enabled', enable: 'Enable / Repair', disable: 'Disable & Restore',
    translation: 'Translation', target: 'Target language', pageMode: 'Full-page translation display', translationOnly: 'Translation only',
    bilingual: 'Bilingual (original + translation)', autoAI: 'Use AI automatically for phrases and sentences',
    ai: 'AI engine', provider: 'Provider', model: 'Model', autoModel: 'Auto (prefer a lightweight model)', speed: 'Test speed',
    testing: 'Testing…', unauthorized: 'not authorized', failed: 'failed', apiKey: 'API key', keySaved: 'Saved in the OS keychain',
    keyMissing: 'Not set', keyOptional: 'Optional', setKey: 'Set key', getKey: 'Get a key', fetch: 'Fetch list', fetching: 'Loading…',
    baseUrl: 'API base URL', testAI: 'Test AI', noModels: 'No VS Code language model available. Sign in to GitHub Copilot or pick another provider.',
    dictionary: 'Offline dictionary', dictReady: 'Ready · {0} entries · {1}', dictLoading: 'Loading…', dictDownloading: 'Downloading… {0}',
    dictMissing: 'Not installed. Lookups fall back to AI.', dictError: 'Error: {0}', dictIdle: 'Loads on first lookup',
    germanDictionary: 'German → Chinese (HanDeDict)', germanIdle: 'Downloads automatically (about 3 MB) on the first German word', germanOff: 'Off',
    dictShared: 'Served by another VS Code window', bundled: 'bundled', downloaded: 'downloaded', custom: 'custom file',
    download: 'Download', choose: 'Choose file…', useDefault: 'Use default',
    surfaces: 'Where to translate', markdownPreview: 'Markdown preview', releaseNotes: 'Release Notes', chat: 'Chat',
    settings: 'Settings & Keyboard Shortcuts', extensionPages: 'Extension pages', welcome: 'Welcome & walkthroughs',
    workbenchUI: 'Notifications, dialogs & hovers',
    shortcuts: 'Shortcuts', paragraph: 'Translate paragraph under mouse', fullPage: 'Translate whole page',
    shortcutHint: 'Click a box and press the key combination. Backspace clears it.',
    vocabulary: 'Vocabulary', entries: '{0} entries', open: 'Open', export: 'Export', remove: 'Remove…',
    allSettings: 'All settings', log: 'Show log'
  },
  zh: {
    integration: '界面集成', active: '已启用', off: '未启用', enable: '启用 / 修复', disable: '禁用并恢复',
    translation: '翻译', target: '目标语言', pageMode: '全文翻译显示方式', translationOnly: '仅译文', bilingual: '原文译文对照',
    autoAI: '短语、句子自动使用 AI 翻译',
    ai: 'AI 引擎', provider: '服务商', model: '模型', autoModel: '自动（优先轻量模型）', speed: '测速', testing: '测速中…',
    unauthorized: '未授权', failed: '失败', apiKey: 'API Key', keySaved: '已保存在系统钥匙串', keyMissing: '未设置', keyOptional: '可选',
    setKey: '设置 Key', getKey: '获取 Key', fetch: '获取列表', fetching: '加载中…', baseUrl: 'API 地址', testAI: '测试 AI',
    noModels: '没有可用的 VS Code 语言模型。请登录 GitHub Copilot 或选择其他服务商。',
    dictionary: '离线词典', dictReady: '可用 · {0} 词条 · {1}', dictLoading: '加载中…', dictDownloading: '下载中… {0}',
    dictMissing: '未安装，查词将回退到 AI。', dictError: '错误：{0}', dictIdle: '首次查词时加载',
    germanDictionary: '德译中（HanDeDict）', germanIdle: '首次选中德语单词时自动下载（约 3 MB）', germanOff: '已关闭',
    dictShared: '由另一个 VS Code 窗口提供', bundled: '内置', downloaded: '已下载', custom: '自定义文件',
    download: '下载', choose: '选择文件…', useDefault: '恢复默认',
    surfaces: '翻译范围', markdownPreview: 'Markdown 预览', releaseNotes: 'Release Notes', chat: 'Chat 对话',
    settings: '设置与快捷键页', extensionPages: '扩展详情页', welcome: '欢迎页与演练',
    workbenchUI: '通知、对话框与悬停提示',
    shortcuts: '快捷键', paragraph: '翻译鼠标所在段落', fullPage: '全文翻译',
    shortcutHint: '点击输入框后直接按下组合键；退格键清空。',
    vocabulary: '生词本', entries: '{0} 条', open: '打开', export: '导出', remove: '删除…',
    allSettings: '全部设置', log: '查看日志'
  },
  de: {
    integration: 'Integration', active: 'Aktiv', off: 'Nicht aktiviert', enable: 'Aktivieren / Reparieren', disable: 'Deaktivieren & wiederherstellen',
    translation: 'Übersetzung', target: 'Zielsprache', pageMode: 'Anzeige der Seitenübersetzung', translationOnly: 'Nur Übersetzung',
    bilingual: 'Zweisprachig (Original + Übersetzung)', autoAI: 'KI automatisch für Ausdrücke und Sätze verwenden',
    ai: 'KI-Engine', provider: 'Anbieter', model: 'Modell', autoModel: 'Automatisch (leichtes Modell bevorzugen)', speed: 'Tempo messen',
    testing: 'Wird gemessen…', unauthorized: 'nicht autorisiert', failed: 'fehlgeschlagen', apiKey: 'API-Schlüssel',
    keySaved: 'Im Schlüsselbund des Betriebssystems gespeichert', keyMissing: 'Nicht festgelegt', keyOptional: 'Optional',
    setKey: 'Schlüssel festlegen', getKey: 'Schlüssel erhalten', fetch: 'Liste abrufen', fetching: 'Wird geladen…',
    baseUrl: 'API-Basis-URL', testAI: 'KI testen',
    noModels: 'Kein VS Code-Sprachmodell verfügbar. Melden Sie sich bei GitHub Copilot an oder wählen Sie einen anderen Anbieter.',
    dictionary: 'Offline-Wörterbuch', dictReady: 'Bereit · {0} Einträge · {1}', dictLoading: 'Wird geladen…', dictDownloading: 'Wird heruntergeladen… {0}',
    dictMissing: 'Nicht installiert. Nachschlagen erfolgt per KI.', dictError: 'Fehler: {0}', dictIdle: 'Wird beim ersten Nachschlagen geladen',
    germanDictionary: 'Deutsch → Chinesisch (HanDeDict)', germanIdle: 'Wird beim ersten deutschen Wort automatisch heruntergeladen (ca. 3 MB)', germanOff: 'Aus',
    dictShared: 'Wird von einem anderen VS Code-Fenster bereitgestellt', bundled: 'mitgeliefert', downloaded: 'heruntergeladen', custom: 'eigene Datei',
    download: 'Herunterladen', choose: 'Datei auswählen…', useDefault: 'Standard verwenden',
    surfaces: 'Wo übersetzt wird', markdownPreview: 'Markdown-Vorschau', releaseNotes: 'Release Notes', chat: 'Chat',
    settings: 'Einstellungen & Tastenkombinationen', extensionPages: 'Erweiterungsseiten', welcome: 'Willkommensseite & Anleitungen',
    workbenchUI: 'Benachrichtigungen, Dialoge & Hover',
    shortcuts: 'Tastenkombinationen', paragraph: 'Absatz unter der Maus übersetzen', fullPage: 'Ganze Seite übersetzen',
    shortcutHint: 'In ein Feld klicken und die Tastenkombination drücken. Rücktaste löscht sie.',
    vocabulary: 'Vokabelliste', entries: '{0} Einträge', open: 'Öffnen', export: 'Exportieren', remove: 'Entfernen…',
    allSettings: 'Alle Einstellungen', log: 'Protokoll anzeigen'
  }
};

class SettingsPanel {
  static viewType = 'translateAnywhere.panel';

  constructor(context, api) {
    this.context = context;
    this.api = api;
    this.view = undefined;
    this.language = undefined;
    this.pending = undefined;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.onDidReceiveMessage(message => this.receive(message).catch(error =>
      this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) })));
    view.onDidChangeVisibility(() => { if (view.visible) this.refresh(); });
    view.onDidDispose(() => { this.view = undefined; this.language = undefined; });
    this.refresh();
  }

  // Coalesces bursts of setting changes into one state push.
  refresh() {
    if (!this.view || this.pending) return;
    this.pending = setTimeout(async () => {
      this.pending = undefined;
      if (!this.view) return;
      const state = await this.api.state();
      const language = STRINGS[state.uiLanguage] ? state.uiLanguage : 'en';
      if (language !== this.language) {
        this.language = language;
        this.view.webview.html = this.html({ ...STRINGS.en, ...STRINGS[language] });
      }
      this.post({ type: 'state', state });
    }, 50);
  }

  post(message) {
    this.view?.webview.postMessage(message);
  }

  async receive(message) {
    switch (message.type) {
      case 'ready': return this.refresh();
      case 'update': await this.api.update(message.key, message.value); return this.refresh();
      case 'command':
        if (!/^translateAnywhere\.\w+$/.test(message.command)) return undefined;
        await this.api.command(message.command); return this.refresh();
      case 'external': if (/^https:\/\//.test(message.url)) await this.api.openExternal(message.url); return undefined;
      case 'listModels':
        try { this.post({ type: 'models', models: await this.api.listModels() }); }
        catch (error) { this.post({ type: 'models', error: error instanceof Error ? error.message : String(error) }); }
        return undefined;
      case 'benchmark': this.post({ type: 'benchmark', timings: await this.api.benchmark() }); return undefined;
      default: return undefined;
    }
  }

  html(s) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { padding: 4px 14px 16px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  section { margin: 0 0 14px; }
  h3 { margin: 12px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; opacity: .8; }
  label.row { display: block; margin: 6px 0 2px; opacity: .9; }
  select, input[type=text], input[type=password] { box-sizing: border-box; width: 100%; padding: 3px 6px; color: var(--vscode-input-foreground);
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent)); border-radius: 2px; font: inherit; }
  select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border-color: var(--vscode-dropdown-border, transparent); }
  select:focus, input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .check { display: flex; gap: 6px; align-items: center; margin: 5px 0; }
  .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  button { padding: 3px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; font: inherit;
    color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .5; cursor: default; }
  .inline { display: flex; gap: 6px; align-items: center; }
  .inline > select, .inline > input { flex: 1; min-width: 0; }
  .status { display: flex; align-items: center; gap: 8px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-disabledForeground, #888); flex: none; }
  .dot.on { background: var(--vscode-testing-iconPassed, #73c991); }
  .muted { opacity: .75; font-size: 12px; margin-top: 4px; overflow-wrap: anywhere; }
  h4.sub { margin: 12px 0 4px; font-size: 12px; font-weight: 600; }
  .error { color: var(--vscode-errorForeground); }
  a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  a:hover { text-decoration: underline; }
  [hidden] { display: none !important; }
  footer { display: flex; gap: 12px; margin-top: 16px; }
  .grow { flex: 1; }
  .end { margin: 0 0 0 auto; }
</style></head><body>
<section>
  <h3>${s.integration}</h3>
  <div class="status"><span class="dot" id="intDot"></span><span id="intText"></span></div>
  <div class="muted" id="intDetail"></div>
  <div class="buttons"><button class="primary" data-command="translateAnywhere.enable">${s.enable}</button>
    <button id="disableBtn" data-command="translateAnywhere.disable">${s.disable}</button></div>
</section>
<section>
  <h3>${s.translation}</h3>
  <label class="row" for="targetLanguage">${s.target}</label><select id="targetLanguage" data-key="targetLanguage"></select>
  <label class="row" for="fullPageMode">${s.pageMode}</label>
  <select id="fullPageMode" data-key="fullPage.mode"><option value="translationOnly">${s.translationOnly}</option><option value="bilingual">${s.bilingual}</option></select>
  <label class="check"><input type="checkbox" id="autoAI" data-key="ai.autoTranslate">${s.autoAI}</label>
</section>
<section>
  <h3>${s.ai}</h3>
  <label class="row" for="provider">${s.provider}</label><select id="provider" data-key="ai.provider"></select>
  <div id="vscodeAI">
    <label class="row" for="modelId">${s.model}</label>
    <div class="inline"><select id="modelId" data-key="ai.modelId"></select><button id="speedBtn">${s.speed}</button></div>
    <div class="muted" id="noModels" hidden>${s.noModels}</div>
  </div>
  <div id="httpAI" hidden>
    <label class="row">${s.apiKey}</label>
    <div class="inline"><span id="keyState" class="grow"></span><button data-command="translateAnywhere.setApiKey">${s.setKey}</button></div>
    <div class="muted"><a id="keyLink" hidden>${s.getKey} ↗</a></div>
    <label class="row" for="apiModel">${s.model}</label>
    <div class="inline"><input type="text" id="apiModel" data-key="ai.apiModel" list="modelList" spellcheck="false"><button id="fetchBtn">${s.fetch}</button></div>
    <datalist id="modelList"></datalist>
    <label class="row" for="baseUrl">${s.baseUrl}</label><input type="text" id="baseUrl" data-key="ai.baseUrl" spellcheck="false">
  </div>
  <div class="muted error" id="aiError" hidden></div>
  <div class="buttons"><button data-command="translateAnywhere.authorizeAI">${s.testAI}</button></div>
</section>
<section>
  <h3>${s.dictionary}</h3>
  <div id="dictText"></div>
  <div class="muted" id="dictPath"></div>
  <div class="buttons"><button id="dictDownload" data-command="translateAnywhere.downloadDictionary">${s.download}</button>
    <button data-command="translateAnywhere.chooseDictionaryFile">${s.choose}</button>
    <button id="dictDefault" data-command="translateAnywhere.useDefaultDictionary">${s.useDefault}</button></div>
  <h4 class="sub">${s.germanDictionary}</h4>
  <div id="deText"></div>
  <div class="buttons"><button id="deDownload" data-command="translateAnywhere.downloadGermanDictionary">${s.download}</button></div>
</section>
<section>
  <h3>${s.surfaces}</h3>
  ${['chat', 'markdownPreview', 'releaseNotes', 'settings', 'extensionPages', 'welcome', 'workbenchUI'].map(key =>
    `<label class="check"><input type="checkbox" data-key="surfaces.${key}">${s[key]}</label>`).join('')}
</section>
<section>
  <h3>${s.shortcuts}</h3>
  <label class="row" for="scParagraph">${s.paragraph}</label><input type="text" id="scParagraph" data-shortcut="shortcuts.paragraph" readonly>
  <label class="row" for="scFullPage">${s.fullPage}</label><input type="text" id="scFullPage" data-shortcut="shortcuts.fullPage" readonly>
  <div class="muted">${s.shortcutHint}</div>
</section>
<section>
  <h3>${s.vocabulary}</h3>
  <div id="vocabCount"></div>
  <div class="buttons"><button data-command="translateAnywhere.openVocabulary">${s.open}</button>
    <button data-command="translateAnywhere.exportVocabulary">${s.export}</button>
    <button data-command="translateAnywhere.removeVocabulary">${s.remove}</button></div>
</section>
<footer><a data-command="translateAnywhere.openSettings">${s.allSettings}</a><a data-command="translateAnywhere.showLog">${s.log}</a><span class="muted end" id="version"></span></footer>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const S = ${JSON.stringify(s)};
const $ = id => document.getElementById(id);
const fmt = (text, ...args) => text.replace(/\\{(\\d)\\}/g, (_, i) => args[i]);
let state, timings = {};
const option = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
function fill(select, items, value) {
  select.replaceChildren(...items.map(([v, l]) => option(v, l)));
  select.value = value;
}
function render() {
  const s = state;
  $('intDot').classList.toggle('on', s.integration.enabled);
  $('intText').textContent = s.integration.enabled ? S.active : S.off;
  $('intDetail').textContent = s.integration.enabled ? s.integration.status : '';
  $('disableBtn').hidden = !s.integration.enabled;
  fill($('targetLanguage'), s.languages.map(l => [l.code, l.label]), s.targetLanguage);
  $('fullPageMode').value = s.fullPageMode;
  $('autoAI').checked = s.autoAI;
  fill($('provider'), s.providers.map(p => [p.id, p.label]), s.provider);
  const vs = s.provider === 'vscode';
  $('vscodeAI').hidden = !vs;
  $('httpAI').hidden = vs;
  if (vs) {
    const speed = id => { const t = timings[id]; return t === undefined ? '' : typeof t === 'number' ? ' · ' + (t / 1000).toFixed(1) + 's' : ' · ' + (S[t] || t); };
    fill($('modelId'), [['', S.autoModel], ...s.vscodeModels.map(m => [m.id, m.name + ' (' + m.detail + ')' + speed(m.id)])], s.modelId);
    $('noModels').hidden = s.vscodeModels.length > 0;
  } else {
    const d = s.providerDefaults;
    $('keyState').textContent = s.hasKey ? '✓ ' + S.keySaved : d.keyOptional ? S.keyOptional : S.keyMissing;
    $('keyState').classList.toggle('error', !s.hasKey && !d.keyOptional);
    $('keyLink').hidden = !d.keyUrl;
    $('keyLink').dataset.url = d.keyUrl;
    if (document.activeElement !== $('apiModel')) $('apiModel').value = s.apiModel;
    $('apiModel').placeholder = d.model;
    if (document.activeElement !== $('baseUrl')) $('baseUrl').value = s.baseUrl;
    $('baseUrl').placeholder = d.baseUrl || 'https://…/v1';
  }
  const dict = s.dictionary;
  const kind = S[dict.kind] || '';
  $('dictText').classList.toggle('error', dict.status === 'error');
  $('dictText').textContent =
    dict.status === 'ready' ? fmt(S.dictReady, Number(dict.entries).toLocaleString(), kind) :
    dict.status === 'loading' ? S.dictLoading :
    dict.status === 'downloading' ? fmt(S.dictDownloading, dict.percent >= 0 ? dict.percent + '%' : (dict.received / 1048576).toFixed(1) + ' MB') :
    dict.status === 'missing' ? S.dictMissing :
    dict.status === 'error' ? fmt(S.dictError, dict.error) :
    dict.owner ? S.dictIdle : S.dictShared;
  $('dictPath').textContent = dict.path || '';
  $('dictDefault').hidden = !dict.path;
  $('dictDownload').hidden = dict.status === 'ready' || dict.status === 'downloading' || !!dict.path;
  const de = s.germanDictionary || { status: 'idle' };
  $('deText').classList.toggle('error', de.status === 'error');
  $('deText').textContent =
    de.status === 'ready' ? fmt(S.dictReady, Number(de.entries).toLocaleString(), S[de.kind] || '') :
    de.status === 'loading' ? S.dictLoading :
    de.status === 'downloading' ? fmt(S.dictDownloading, de.percent >= 0 ? de.percent + '%' : (de.received / 1048576).toFixed(1) + ' MB') :
    de.status === 'error' ? fmt(S.dictError, de.error) :
    de.enabled === false ? S.germanOff : dict.owner ? S.germanIdle : S.dictShared;
  $('deDownload').hidden = de.status === 'ready' || de.status === 'downloading' || de.status === 'loading';
  for (const box of document.querySelectorAll('[data-key^="surfaces."]')) box.checked = s.surfaces[box.dataset.key.slice(9)];
  $('scParagraph').value = s.shortcuts.paragraph;
  $('scFullPage').value = s.shortcuts.fullPage;
  $('vocabCount').textContent = fmt(S.entries, s.vocabularyCount);
  $('version').textContent = 'v' + s.version;
}
document.addEventListener('change', event => {
  const el = event.target;
  if (!el.dataset.key) return;
  vscode.postMessage({ type: 'update', key: el.dataset.key, value: el.type === 'checkbox' ? el.checked : el.value.trim() });
});
document.addEventListener('click', event => {
  const el = event.target.closest('[data-command]');
  if (el) vscode.postMessage({ type: 'command', command: el.dataset.command });
});
$('keyLink').addEventListener('click', () => vscode.postMessage({ type: 'external', url: $('keyLink').dataset.url }));
$('speedBtn').addEventListener('click', () => {
  $('speedBtn').disabled = true;
  $('speedBtn').textContent = S.testing;
  vscode.postMessage({ type: 'benchmark' });
});
$('fetchBtn').addEventListener('click', () => {
  $('fetchBtn').disabled = true;
  $('fetchBtn').textContent = S.fetching;
  vscode.postMessage({ type: 'listModels' });
});
// Shortcut recorder: the pressed combination becomes the value, in the same "Alt+Z" format as settings.json.
for (const input of document.querySelectorAll('[data-shortcut]')) {
  input.addEventListener('keydown', event => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    let value;
    if (['Backspace', 'Delete'].includes(event.key) && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) value = '';
    else {
      const code = event.code;
      const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\\d$/.test(code) ? code.slice(5) : /^F\\d{1,2}$/.test(code) ? code : code === 'Space' ? 'Space' : '';
      if (!key) return;
      value = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+');
    }
    input.value = value;
    vscode.postMessage({ type: 'update', key: input.dataset.shortcut, value });
  });
}
window.addEventListener('message', ({ data }) => {
  if (data.type === 'state') { state = data.state; render(); $('aiError').hidden = true; }
  if (data.type === 'error') { $('aiError').textContent = data.message; $('aiError').hidden = false; }
  if (data.type === 'models') {
    $('fetchBtn').disabled = false;
    $('fetchBtn').textContent = S.fetch;
    if (data.error) { $('aiError').textContent = data.error; $('aiError').hidden = false; return; }
    $('modelList').replaceChildren(...data.models.map(m => option(m, m)));
    $('apiModel').focus();
  }
  if (data.type === 'benchmark') {
    timings = data.timings;
    $('speedBtn').disabled = false;
    $('speedBtn').textContent = S.speed;
    if (state) render();
  }
});
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
  }
}

module.exports = { SettingsPanel, STRINGS };
