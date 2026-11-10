'use strict';
const vscode = require('vscode');
const crypto = require('node:crypto');

const STRINGS = {
  en: {
    integration: 'Integration', active: 'Active', off: 'Not enabled', enable: 'Enable / Repair', disable: 'Disable & Restore',
    shortcuts: 'Shortcuts & how to use', selectTitle: 'Select text', selectHint: 'then point at the red dot for a dictionary or AI translation',
    paragraph: 'Paragraph under the mouse', paragraphHint: 'translation appears in place; press again to restore',
    fullPage: 'Whole page', fullPageHint: 'translates the page you are reading; press again to switch back',
    shortcutHint: 'Click a key to record a new combination; Backspace turns it off.',
    worksIn: 'Works in Chat, Markdown preview, Release Notes, Settings and extension pages.', tryIt: 'Try it on a sample page',
    dotEdit: 'Customize', dotEditTitle: 'Change the size, color or image of the dot', dotHeading: 'Selection dot', dotSample: 'Select some text',
    dotSize: 'Size', dotColor: 'Color', dotBorder: 'Border', dotOpacity: 'Opacity', dotShape: 'Shape', dotCircle: 'Circle', dotRounded: 'Rounded square',
    dotImage: 'Image', dotUseImage: 'Choose image…', dotChangeImage: 'Change…', dotRemoveImage: 'Remove',
    dotImageHint: 'PNG, JPG, GIF, WebP or SVG. A square icon with a transparent background looks best; it is scaled to the size above (16–24 px works well).',
    dotImageBad: 'This image could not be read. Try a PNG or SVG file.', dotReset: 'Reset to default', done: 'Done',
    mdOff: 'Markdown files open as source text. Open them as a preview to read and translate them comfortably.',
    mdOn: 'Markdown files open as a preview.', mdSet: 'Open Markdown as preview', mdUndo: 'Open as text again',
    translation: 'Translation', target: 'Target language', pageMode: 'Whole-page translation shows', translationOnly: 'Translation only',
    bilingual: 'Bilingual (original + translation)', autoAI: 'Use AI automatically for phrases and sentences',
    ai: 'AI engine', provider: 'Provider', model: 'Model', chooseModel: '— Choose a model —', recommended: 'Recommended (light & fast)',
    otherModels: 'Other models', hiddenModel: 'hidden in Language Models', missingModel: 'not available',
    noModelChosen: 'Choose the model for phrases and paragraphs. A small, fast one works best.',
    needsAccess: 'Not authorized yet.', allowAccess: 'Allow access',
    speed: 'Test speed', testing: 'Testing… {0}%', advising: 'Picking recommendations…', unauthorized: 'not authorized', failed: 'failed',
    speedTitle: 'Each visible, authorized model translates a sentence: one warm-up, then three timed runs (median shown). Then the fastest lightweight model picks the ones suited to translation as "Recommended" (without a lightweight model this step is skipped). Requests to premium models count toward your Copilot premium-request quota; hide models you never use in VS Code\'s Language Models view to skip them.',
    speedRunning: 'One warm-up and three timed runs per model. This can take a minute.',
    fastest: 'Fastest: {0} · {1}', recommendedPick: 'Recommended: {0} · {1}', firstWords: 'first words {0}', useIt: 'Use it', speedNone: 'No model answered within 20 seconds.',
    speedUnauthorized: '{0} not authorized yet, so not measured. Choose one and click "Allow access".', close: 'Close', apiKey: 'API key', keySaved: 'Saved in the OS keychain',
    keyMissing: 'Not set', keyOptional: 'Optional', setKey: 'Set key', getKey: 'Get a key', fetch: 'Fetch list', fetching: 'Loading…',
    baseUrl: 'API base URL', noModels: 'No VS Code language model available. Sign in to GitHub Copilot or pick another provider.',
    vocabulary: 'Vocabulary', vocabEmpty: 'Click ☆ in the translation popup to collect words and sentences here.', vocabMore: '{0} more in the full list →', vocabShowMore: 'Show {0} more ▾', vocabShowLess: 'Show less ▴',
    open: 'Open', export: 'Export CSV', remove: 'Remove…',
    dictionary: 'Offline dictionary', dictReady: 'Ready · {0} entries · {1}', dictLoading: 'Loading…', dictDownloading: 'Downloading… {0}',
    dictMissing: 'Not installed. Lookups fall back to AI.', dictError: 'Error: {0}', dictIdle: 'Loads on first lookup',
    germanDictionary: 'German → Chinese (HanDeDict)', germanIdle: 'Downloads automatically (about 3 MB) on the first German word', germanOff: 'Off',
    dictShared: 'Served by another VS Code window', bundled: 'bundled', downloaded: 'downloaded', custom: 'custom file',
    download: 'Download', choose: 'Choose file…', useDefault: 'Use default',
    surfaces: 'Where to translate…', allSettings: 'All settings', log: 'Show log'
  },
  zh: {
    integration: '界面集成', active: '已启用', off: '未启用', enable: '启用 / 修复', disable: '禁用并恢复',
    shortcuts: '快捷键与用法', selectTitle: '划词', selectHint: '选中文字后，鼠标移到小红点上查看词典或 AI 翻译',
    paragraph: '翻译鼠标所在段落', paragraphHint: '译文直接显示在原处，再按一次恢复',
    fullPage: '全文翻译', fullPageHint: '翻译正在阅读的整个页面，再按一次切回原文',
    shortcutHint: '点击按键框后按下新的组合键即可修改；退格键关闭该快捷键。',
    worksIn: '适用于 Chat、Markdown 预览、Release Notes、设置页和扩展详情页。', tryIt: '在示例页面上试一试',
    dotEdit: '自定义', dotEditTitle: '修改小圆点的大小、颜色或换成图片', dotHeading: '划词小圆点', dotSample: '选中一段文字',
    dotSize: '大小', dotColor: '颜色', dotBorder: '边框', dotOpacity: '不透明度', dotShape: '形状', dotCircle: '圆形', dotRounded: '圆角方形',
    dotImage: '图片', dotUseImage: '选择图片…', dotChangeImage: '更换…', dotRemoveImage: '移除',
    dotImageHint: '支持 PNG、JPG、GIF、WebP、SVG。方形、透明背景的图标效果最好；图片会缩放到上面设置的大小（16–24 像素较合适）。',
    dotImageBad: '无法读取这张图片，请换一个 PNG 或 SVG 文件。', dotReset: '恢复默认', done: '完成',
    mdOff: 'Markdown 文件默认以源码打开。改为默认预览，阅读和翻译都更方便。',
    mdOn: 'Markdown 文件默认以预览方式打开。', mdSet: '默认以预览打开 Markdown', mdUndo: '恢复为源码打开',
    translation: '翻译', target: '目标语言', pageMode: '全文翻译显示方式', translationOnly: '仅译文', bilingual: '原文译文对照',
    autoAI: '短语、句子自动使用 AI 翻译',
    ai: 'AI 引擎', provider: '服务商', model: '模型', chooseModel: '— 请选择模型 —', recommended: '推荐（轻量、快速）',
    otherModels: '其他模型', hiddenModel: '已在“语言模型”中隐藏', missingModel: '不可用',
    noModelChosen: '请选择用于翻译句子和段落的模型，推荐小而快的模型。',
    needsAccess: '尚未授权。', allowAccess: '授权使用',
    speed: '测速', testing: '测速中… {0}%', advising: '正在挑选推荐模型…', unauthorized: '未授权', failed: '失败',
    speedTitle: '每个可见且已授权的模型翻译同一句话：先预热一次，再计时三次（显示中位数）。随后由其中最快的轻量模型挑出适合翻译的模型，标为“推荐”（没有轻量模型时跳过这一步）。对高级模型的请求会计入 Copilot 高级请求额度；不用的模型可在 VS Code 的“语言模型”视图中隐藏，测速时即会跳过。',
    speedRunning: '每个模型预热一次、计时三次，可能需要一分钟左右。',
    fastest: '最快：{0} · {1}', recommendedPick: '推荐：{0} · {1}', firstWords: '首字 {0}', useIt: '改用此模型', speedNone: '没有模型在 20 秒内返回结果。',
    speedUnauthorized: '{0} 个模型尚未授权，未参与测速。选中后点击“授权使用”即可。', close: '关闭', apiKey: 'API Key', keySaved: '已保存在系统钥匙串', keyMissing: '未设置', keyOptional: '可选',
    setKey: '设置 Key', getKey: '获取 Key', fetch: '获取列表', fetching: '加载中…', baseUrl: 'API 地址',
    noModels: '没有可用的 VS Code 语言模型。请登录 GitHub Copilot 或选择其他服务商。',
    vocabulary: '生词本', vocabEmpty: '在翻译弹窗中点击 ☆，即可把单词和句子收藏到这里。', vocabMore: '另有 {0} 条，查看完整列表 →', vocabShowMore: '展开其余 {0} 条 ▾', vocabShowLess: '收起 ▴',
    open: '打开', export: '导出 CSV', remove: '删除…',
    dictionary: '离线词典', dictReady: '可用 · {0} 词条 · {1}', dictLoading: '加载中…', dictDownloading: '下载中… {0}',
    dictMissing: '未安装，查词将回退到 AI。', dictError: '错误：{0}', dictIdle: '首次查词时加载',
    germanDictionary: '德译中（HanDeDict）', germanIdle: '首次选中德语单词时自动下载（约 3 MB）', germanOff: '已关闭',
    dictShared: '由另一个 VS Code 窗口提供', bundled: '内置', downloaded: '已下载', custom: '自定义文件',
    download: '下载', choose: '选择文件…', useDefault: '恢复默认',
    surfaces: '翻译范围…', allSettings: '全部设置', log: '查看日志'
  },
  de: {
    integration: 'Integration', active: 'Aktiv', off: 'Nicht aktiviert', enable: 'Aktivieren / Reparieren', disable: 'Deaktivieren & wiederherstellen',
    shortcuts: 'Tastenkürzel & Bedienung', selectTitle: 'Text markieren', selectHint: 'dann auf den roten Punkt zeigen für Wörterbuch oder KI-Übersetzung',
    paragraph: 'Absatz unter der Maus', paragraphHint: 'Übersetzung erscheint an Ort und Stelle; erneut drücken stellt das Original her',
    fullPage: 'Ganze Seite', fullPageHint: 'übersetzt die aktuelle Seite; erneut drücken schaltet zurück',
    shortcutHint: 'Auf eine Taste klicken und eine neue Kombination drücken; Rücktaste schaltet sie aus.',
    worksIn: 'Funktioniert in Chat, Markdown-Vorschau, Release Notes, Einstellungen und auf Erweiterungsseiten.', tryIt: 'Auf einer Beispielseite ausprobieren',
    dotEdit: 'Anpassen', dotEditTitle: 'Größe, Farbe oder Bild des Punkts ändern', dotHeading: 'Auswahlpunkt', dotSample: 'Etwas Text markieren',
    dotSize: 'Größe', dotColor: 'Farbe', dotBorder: 'Rand', dotOpacity: 'Deckkraft', dotShape: 'Form', dotCircle: 'Kreis', dotRounded: 'Abgerundetes Quadrat',
    dotImage: 'Bild', dotUseImage: 'Bild wählen…', dotChangeImage: 'Ändern…', dotRemoveImage: 'Entfernen',
    dotImageHint: 'PNG, JPG, GIF, WebP oder SVG. Ein quadratisches Symbol mit transparentem Hintergrund wirkt am besten; es wird auf die Größe oben skaliert (16–24 px passen gut).',
    dotImageBad: 'Dieses Bild konnte nicht gelesen werden. Bitte eine PNG- oder SVG-Datei versuchen.', dotReset: 'Standard wiederherstellen', done: 'Fertig',
    mdOff: 'Markdown-Dateien öffnen als Quelltext. Als Vorschau lassen sie sich bequemer lesen und übersetzen.',
    mdOn: 'Markdown-Dateien öffnen als Vorschau.', mdSet: 'Markdown als Vorschau öffnen', mdUndo: 'Wieder als Text öffnen',
    translation: 'Übersetzung', target: 'Zielsprache', pageMode: 'Seitenübersetzung zeigt', translationOnly: 'Nur Übersetzung',
    bilingual: 'Zweisprachig (Original + Übersetzung)', autoAI: 'KI automatisch für Ausdrücke und Sätze verwenden',
    ai: 'KI-Engine', provider: 'Anbieter', model: 'Modell', chooseModel: '— Modell auswählen —', recommended: 'Empfohlen (leicht & schnell)',
    otherModels: 'Weitere Modelle', hiddenModel: 'in Sprachmodelle ausgeblendet', missingModel: 'nicht verfügbar',
    noModelChosen: 'Wählen Sie das Modell für Sätze und Absätze. Ein kleines, schnelles eignet sich am besten.',
    needsAccess: 'Noch nicht autorisiert.', allowAccess: 'Zugriff erlauben',
    speed: 'Tempo messen', testing: 'Wird gemessen… {0}%', advising: 'Empfehlungen werden ermittelt…', unauthorized: 'nicht autorisiert', failed: 'fehlgeschlagen',
    speedTitle: 'Jedes sichtbare, autorisierte Modell übersetzt einen Satz: ein Aufwärmlauf, dann drei gemessene Läufe (Median). Danach wählt das schnellste leichte Modell die für Übersetzungen geeigneten als „Empfohlen“ aus (ohne leichtes Modell entfällt dieser Schritt). Anfragen an Premium-Modelle zählen zu Ihrem Copilot-Premium-Kontingent; in der Ansicht „Sprachmodelle“ ausgeblendete Modelle werden übersprungen.',
    speedRunning: 'Ein Aufwärmlauf und drei gemessene Läufe pro Modell. Das kann eine Minute dauern.',
    fastest: 'Am schnellsten: {0} · {1}', recommendedPick: 'Empfohlen: {0} · {1}', firstWords: 'erste Wörter {0}', useIt: 'Verwenden', speedNone: 'Kein Modell hat innerhalb von 20 Sekunden geantwortet.',
    speedUnauthorized: '{0} noch nicht autorisiert und daher nicht gemessen. Eines auswählen und auf „Zugriff erlauben“ klicken.', close: 'Schließen', apiKey: 'API-Schlüssel',
    keySaved: 'Im Schlüsselbund des Betriebssystems gespeichert', keyMissing: 'Nicht festgelegt', keyOptional: 'Optional',
    setKey: 'Schlüssel festlegen', getKey: 'Schlüssel erhalten', fetch: 'Liste abrufen', fetching: 'Wird geladen…',
    baseUrl: 'API-Basis-URL',
    noModels: 'Kein VS Code-Sprachmodell verfügbar. Melden Sie sich bei GitHub Copilot an oder wählen Sie einen anderen Anbieter.',
    vocabulary: 'Vokabelliste', vocabEmpty: 'Im Übersetzungsfenster auf ☆ klicken, um Wörter und Sätze hier zu sammeln.', vocabMore: '{0} weitere in der vollständigen Liste →', vocabShowMore: '{0} weitere anzeigen ▾', vocabShowLess: 'Weniger anzeigen ▴',
    open: 'Öffnen', export: 'CSV exportieren', remove: 'Entfernen…',
    dictionary: 'Offline-Wörterbuch', dictReady: 'Bereit · {0} Einträge · {1}', dictLoading: 'Wird geladen…', dictDownloading: 'Wird heruntergeladen… {0}',
    dictMissing: 'Nicht installiert. Nachschlagen erfolgt per KI.', dictError: 'Fehler: {0}', dictIdle: 'Wird beim ersten Nachschlagen geladen',
    germanDictionary: 'Deutsch → Chinesisch (HanDeDict)', germanIdle: 'Wird beim ersten deutschen Wort automatisch heruntergeladen (ca. 3 MB)', germanOff: 'Aus',
    dictShared: 'Wird von einem anderen VS Code-Fenster bereitgestellt', bundled: 'mitgeliefert', downloaded: 'heruntergeladen', custom: 'eigene Datei',
    download: 'Herunterladen', choose: 'Datei auswählen…', useDefault: 'Standard verwenden',
    surfaces: 'Wo übersetzt wird…', allSettings: 'Alle Einstellungen', log: 'Protokoll anzeigen'
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
    this.focusTarget = undefined;
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

  // Scrolls to and highlights a control (e.g. the model list); kept until the page confirms, since the view may still be loading.
  focus(target) {
    this.focusTarget = target;
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
      this.post({ type: 'state', state, focus: this.focusTarget });
    }, 50);
  }

  post(message) {
    this.view?.webview.postMessage(message);
  }

  async receive(message) {
    switch (message.type) {
      case 'ready': return this.refresh();
      case 'focused': this.focusTarget = undefined; return undefined;
      case 'update': await this.api.update(message.key, message.value); return this.refresh();
      case 'command':
        if (!/^translateAnywhere\.\w+$/.test(message.command)) return undefined;
        await this.api.command(message.command); return this.refresh();
      case 'external': if (/^https:\/\//.test(message.url)) await this.api.openExternal(message.url); return undefined;
      case 'listModels':
        try { this.post({ type: 'models', models: await this.api.listModels() }); }
        catch (error) { this.post({ type: 'models', error: error instanceof Error ? error.message : String(error) }); }
        return undefined;
      case 'benchmark': try { await this.api.benchmark(); } finally { this.refresh(); } return undefined;
      case 'pickDotIcon': {
        const picked = await this.api.pickDotIcon();
        if (picked?.resize) this.post({ type: 'resizeIcon', data: picked.resize, name: picked.name });
        return this.refresh();
      }
      case 'setDotIcon': await this.api.setDotIcon(message.data, message.name); return this.refresh();
      case 'removeDotIcon': await this.api.removeDotIcon(); return this.refresh();
      case 'resetDot': await this.api.resetDot(); return this.refresh();
      default: return undefined;
    }
  }

  html(s) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = `default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { padding: 4px 14px 16px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  details.sec { padding-bottom: 8px; }
  details.sec + details.sec { border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent)); }
  summary { display: flex; align-items: center; gap: 6px; margin: 0 -4px; padding: 10px 4px 6px; list-style: none; cursor: pointer; user-select: none;
    font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; opacity: .8; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: ''; flex: none; border: 4px solid transparent; border-left: 5px solid currentColor; border-right: 0; transition: transform .1s; }
  details[open] > summary::before { transform: rotate(90deg); }
  summary:hover { opacity: 1; }
  summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .badge { min-width: 8px; padding: 0 6px; border-radius: 9px; font-size: 10px; line-height: 16px; text-align: center; letter-spacing: 0;
    color: var(--vscode-badge-foreground, #fff); background: var(--vscode-badge-background, #4d4d4d); }
  .banner { display: flex; gap: 6px; align-items: flex-start; margin: 6px 0; padding: 6px 8px; border-radius: 2px; overflow-wrap: anywhere;
    color: var(--vscode-inputValidation-errorForeground, inherit); background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); }
  .banner span { flex: 1; }
  button.icon { padding: 0 4px; color: inherit; background: transparent; line-height: 1.2; }
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
  footer { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 16px; }
  .grow { flex: 1; }
  .end { margin: 0 0 0 auto; }
  /* Shortcuts: one row per gesture, the key on the right is also the recorder. */
  .how { display: grid; grid-template-columns: 1fr auto; gap: 8px 10px; align-items: center; margin: 4px 0 2px; }
  .how b { display: block; font-weight: 600; }
  .how .muted { margin-top: 1px; }
  input.kbd { box-sizing: border-box; width: 78px; padding: 2px 4px; text-align: center; cursor: pointer; caret-color: transparent;
    font: 600 12px var(--vscode-editor-font-family, monospace); color: var(--vscode-keybindingLabel-foreground, inherit);
    background: var(--vscode-keybindingLabel-background, rgba(128,128,128,.17)); border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,.35));
    border-bottom-color: var(--vscode-keybindingLabel-bottomBorder, rgba(128,128,128,.5)); border-radius: 3px; box-shadow: inset 0 -1px 0 rgba(128,128,128,.35); }
  input.kbd:placeholder-shown { font-weight: normal; opacity: .6; }
  .reddot { justify-self: center; width: 9px; height: 9px; margin: 0 34px; border: 1px solid #fff; border-radius: 50%; background: #e5484d; box-shadow: 0 0 2px #0006; }
  /* The selection dot as the user styled it (custom properties are set through CSSOM, which the CSP allows). */
  .seldot { flex: none; box-sizing: border-box; width: var(--s, 7px); height: var(--s, 7px); border: var(--b, 1px solid #fff); border-radius: var(--r, 50%);
    background: var(--bg, #e5484d); opacity: var(--o, .85); box-shadow: var(--sh, 0 0 2px #0006); }
  button.dotcell { justify-self: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; box-sizing: border-box;
    width: 78px; min-height: 30px; padding: 3px 0; color: inherit; background: transparent; border: 1px dashed transparent; border-radius: 4px; }
  button.dotcell:hover, button.dotcell[aria-expanded=true] { background: transparent; border-color: var(--vscode-focusBorder); }
  button.dotcell:hover .seldot { opacity: 1; }
  .dotcell .cap { font-size: 11px; line-height: 1; color: var(--vscode-textLink-foreground); }
  .dothead { display: flex; align-items: baseline; gap: 8px; }
  .dothead b { flex: 1; }
  .dotstage { display: flex; align-items: flex-end; gap: 3px; min-height: 40px; margin: 8px 0 4px; padding: 6px 10px; border-radius: 3px;
    background: var(--vscode-editor-background, #1f1f1f); }
  .dotstage .sample { padding: 0 1px; color: var(--vscode-editor-foreground, inherit); background: var(--vscode-editor-selectionBackground, #264f78); }
  .dotgrid { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; margin-top: 6px; }
  .dotgrid > label, .dotgrid > span { white-space: nowrap; }
  .dotgrid input[type=range] { flex: 1; min-width: 0; margin: 0; accent-color: var(--vscode-button-background); }
  .dotgrid output { min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; opacity: .8; }
  input[type=color] { flex: none; width: 26px; height: 20px; padding: 0; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.4)); border-radius: 3px; background: none; cursor: pointer; }
  .swatches { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  button.swatch { width: 16px; height: 16px; padding: 0; border-radius: 50%; border: 1px solid rgba(128,128,128,.5); background: var(--c); }
  button.swatch:hover { background: var(--c); transform: scale(1.15); }
  button.swatch[aria-pressed=true] { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .thumb { flex: none; width: 24px; height: 24px; border-radius: 3px; background: var(--img) center / contain no-repeat, rgba(128,128,128,.15); }
  .dotedit:focus { outline: none; }
  .disabled { opacity: .45; pointer-events: none; }
  .card { margin-top: 10px; padding: 8px 10px; border-radius: 4px; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25));
    background: var(--vscode-textBlockQuote-background, rgba(128,128,128,.08)); }
  .card .buttons { margin-top: 6px; }
  .ok::before { content: '✓ '; color: var(--vscode-testing-iconPassed, #73c991); }
  .flash { animation: flash 1.6s ease-out; }
  @keyframes flash { 0%, 40% { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; } 100% { outline: 2px solid transparent; outline-offset: 2px; } }
  /* Vocabulary: the latest entries, word over a one-line translation. */
  ul.vocab { list-style: none; margin: 4px 0 0; padding: 0; }
  ul.vocab li { padding: 5px 8px; border-left: 2px solid var(--vscode-textLink-foreground, #4daafc); margin-top: 4px; border-radius: 0 3px 3px 0;
    background: var(--vscode-textBlockQuote-background, rgba(128,128,128,.08)); }
  ul.vocab .w { font-weight: 600; overflow-wrap: anywhere; }
  ul.vocab .ph { margin-left: 6px; opacity: .65; font-size: 12px; }
  ul.vocab .tr { opacity: .8; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ul.vocab.expanded { max-height: 360px; overflow-y: auto; padding-right: 2px; }
  .vocabfoot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-top: 6px; font-size: 12px; }
  .vocabfoot a[hidden] { display: none; }
</style></head><body>
<div class="banner" id="banner" role="alert" hidden><span id="bannerText"></span><button class="icon" id="bannerClose" title="${s.close}" aria-label="${s.close}">×</button></div>
<details class="sec" data-sec="integration" open>
  <summary>${s.integration}</summary>
  <div class="status"><span class="dot" id="intDot"></span><span id="intText"></span></div>
  <div class="muted" id="intDetail"></div>
  <div class="buttons"><button id="enableBtn" class="primary" data-command="translateAnywhere.enable">${s.enable}</button>
    <button id="disableBtn" data-command="translateAnywhere.disable">${s.disable}</button></div>
</details>
<details class="sec" data-sec="shortcuts" open>
  <summary>${s.shortcuts}</summary>
  <div class="how">
    <div><b>${s.selectTitle}</b><div class="muted">${s.selectHint}</div></div>
    <button class="dotcell" id="dotBtn" title="${s.dotEditTitle}" aria-controls="dotEditor" aria-expanded="false"><span class="seldot" id="dotPreview"></span><span class="cap">${s.dotEdit}</span></button>
    <label for="scParagraph"><b>${s.paragraph}</b><div class="muted">${s.paragraphHint}</div></label>
    <input type="text" class="kbd" id="scParagraph" data-shortcut="shortcuts.paragraph" readonly placeholder="—">
    <label for="scFullPage"><b>${s.fullPage}</b><div class="muted">${s.fullPageHint}</div></label>
    <input type="text" class="kbd" id="scFullPage" data-shortcut="shortcuts.fullPage" readonly placeholder="—">
  </div>
  <div class="card dotedit" id="dotEditor" tabindex="-1" hidden>
    <div class="dothead"><b>${s.dotHeading}</b><a id="dotReset">${s.dotReset}</a></div>
    <div class="dotstage" aria-hidden="true"><span class="sample">${s.dotSample}</span><span class="seldot" id="dotStage"></span></div>
    <div class="dotgrid">
      <label for="dotSize">${s.dotSize}</label>
      <div class="inline"><input type="range" id="dotSize" data-key="dot.size" min="4" max="32" step="1"><output id="dotSizeOut"></output></div>
      <span>${s.dotColor}</span>
      <div class="swatches" id="dotColorRow">
        <button class="swatch" data-color="#e5484d"></button><button class="swatch" data-color="#f76b15"></button><button class="swatch" data-color="#ffc53d"></button>
        <button class="swatch" data-color="#30a46c"></button><button class="swatch" data-color="#0090ff"></button><button class="swatch" data-color="#8e4ec6"></button>
        <button class="swatch" data-color="#d6409f"></button><button class="swatch" data-color="#8b8d98"></button>
        <input type="color" id="dotColor" data-key="dot.color" title="${s.dotColor}" aria-label="${s.dotColor}">
      </div>
      <label for="dotBorderWidth">${s.dotBorder}</label>
      <div class="inline"><input type="range" id="dotBorderWidth" data-key="dot.borderWidth" min="0" max="4" step="1"><output id="dotBorderOut"></output>
        <input type="color" id="dotBorderColor" data-key="dot.borderColor" title="${s.dotBorder}" aria-label="${s.dotBorder}"></div>
      <label for="dotOpacity">${s.dotOpacity}</label>
      <div class="inline"><input type="range" id="dotOpacity" data-key="dot.opacity" min="0.2" max="1" step="0.05"><output id="dotOpacityOut"></output></div>
      <label for="dotShape">${s.dotShape}</label>
      <select id="dotShape" data-key="dot.shape"><option value="circle">${s.dotCircle}</option><option value="rounded">${s.dotRounded}</option></select>
      <span>${s.dotImage}</span>
      <div class="inline"><span class="thumb" id="dotThumb" hidden></span><button id="dotPick">${s.dotUseImage}</button><a id="dotRemove" hidden>${s.dotRemoveImage}</a></div>
    </div>
    <div class="muted">${s.dotImageHint}</div>
    <div class="buttons"><button class="primary" id="dotDone">${s.done}</button></div>
  </div>
  <div class="muted">${s.worksIn} ${s.shortcutHint}</div>
  <div class="buttons"><button class="primary" id="tryBtn" data-command="translateAnywhere.tryIt">${s.tryIt}</button></div>
  <div class="card" id="mdCard">
    <div id="mdText"></div>
    <div class="buttons"><button id="mdSet" data-command="translateAnywhere.openMarkdownAsPreview">${s.mdSet}</button>
      <a id="mdUndo" data-command="translateAnywhere.openMarkdownAsText">${s.mdUndo}</a></div>
  </div>
</details>
<details class="sec" data-sec="translation" open>
  <summary>${s.translation}</summary>
  <label class="row" for="targetLanguage">${s.target}</label><select id="targetLanguage" data-key="targetLanguage"></select>
  <label class="row" for="fullPageMode">${s.pageMode}</label>
  <select id="fullPageMode" data-key="fullPage.mode"><option value="translationOnly">${s.translationOnly}</option><option value="bilingual">${s.bilingual}</option></select>
  <label class="check"><input type="checkbox" id="autoAI" data-key="ai.autoTranslate">${s.autoAI}</label>
</details>
<details class="sec" data-sec="ai" open>
  <summary>${s.ai}</summary>
  <label class="row" for="provider">${s.provider}</label><select id="provider" data-key="ai.provider"></select>
  <div id="vscodeAI">
    <label class="row" for="modelId">${s.model}</label>
    <div class="inline"><select id="modelId" data-key="ai.modelId"></select><button id="speedBtn" title="${s.speedTitle}">${s.speed}</button></div>
    <div class="muted" id="chooseHint" hidden>${s.noModelChosen}</div>
    <div class="muted" id="accessInfo" hidden>${s.needsAccess} <a data-command="translateAnywhere.authorizeAI">${s.allowAccess}</a></div>
    <div class="muted" id="speedInfo" aria-live="polite" hidden></div>
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
</details>
<details class="sec" data-sec="vocabulary" open>
  <summary>${s.vocabulary}<span class="badge" id="vocabBadge" hidden></span></summary>
  <div class="muted" id="vocabEmpty" hidden>${s.vocabEmpty}</div>
  <ul class="vocab" id="vocabList"></ul>
  <div class="vocabfoot"><a id="vocabToggle" role="button" tabindex="0" aria-controls="vocabList" hidden></a>
    <a id="vocabMore" data-command="translateAnywhere.openVocabulary" role="button" tabindex="0" hidden></a></div>
  <div class="buttons"><button class="primary" id="vocabOpen" data-command="translateAnywhere.openVocabulary">${s.open}</button>
    <button id="vocabExport" data-command="translateAnywhere.exportVocabulary">${s.export}</button>
    <button id="vocabRemove" data-command="translateAnywhere.removeVocabulary">${s.remove}</button></div>
</details>
<details class="sec" data-sec="dictionary" open>
  <summary>${s.dictionary}</summary>
  <div id="dictText"></div>
  <div class="muted" id="dictPath"></div>
  <div class="buttons"><button id="dictDownload" data-command="translateAnywhere.downloadDictionary">${s.download}</button>
    <button data-command="translateAnywhere.chooseDictionaryFile">${s.choose}</button>
    <button id="dictDefault" data-command="translateAnywhere.useDefaultDictionary">${s.useDefault}</button></div>
  <div id="deBox" hidden>
    <h4 class="sub">${s.germanDictionary}</h4>
    <div id="deText"></div>
    <div class="buttons"><button id="deDownload" data-command="translateAnywhere.downloadGermanDictionary">${s.download}</button></div>
  </div>
</details>
<footer><a data-command="translateAnywhere.openSurfaceSettings">${s.surfaces}</a><a data-command="translateAnywhere.openSettings">${s.allSettings}</a><a data-command="translateAnywhere.showLog">${s.log}</a><span class="muted end" id="version"></span></footer>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const S = ${JSON.stringify(s)};
const $ = id => document.getElementById(id);
const fmt = (text, ...args) => text.replace(/\\{(\\d)\\}/g, (_, i) => args[i]);
let state;
const option = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
function fill(select, items, value) {
  select.replaceChildren(...items.map(([v, l]) => option(v, l)));
  select.value = value;
}
const seconds = ms => (ms / 1000).toFixed(1) + 's';
const measured = m => m.timing && m.timing.status === 'ok';
// Recommended models, then the rest. Without a choice a disabled placeholder is shown instead of guessing.
function fillModels(s) {
  const label = m => {
    const name = m.missing ? m.id : m.name + (m.detail ? ' (' + m.detail + ')' : '');
    const note = m.missing ? S.missingModel : m.hidden ? S.hiddenModel : m.timing && !measured(m) ? (S[m.timing.status] || m.timing.status) : '';
    return (measured(m) ? seconds(m.timing.median) + ' · ' : '') + name + (note ? ' · ' + note : '');
  };
  const group = (title, list) => {
    const g = document.createElement('optgroup');
    g.label = title;
    g.append(...list.map(m => {
      const o = option(m.id, label(m));
      o.disabled = !!m.missing;
      return o;
    }));
    return g;
  };
  const nodes = [];
  if (!s.modelId) {
    const placeholder = option('', S.chooseModel);
    placeholder.disabled = true;
    nodes.push(placeholder);
  }
  const recommended = s.vscodeModels.filter(m => m.recommended);
  const other = s.vscodeModels.filter(m => !m.recommended);
  if (recommended.length) nodes.push(group(S.recommended, recommended));
  if (other.length) nodes.push(recommended.length ? group(S.otherModels, other) : group(S.model, other));
  $('modelId').replaceChildren(...nodes);
  $('modelId').value = s.modelId;
}
// Speed-test progress, then the fastest model with a one-click switch and why some models were skipped.
function renderSpeed(s) {
  const run = s.benchmark;
  $('speedBtn').disabled = !!run || !s.vscodeModels.length;
  $('speedBtn').textContent = !run ? S.speed : run.phase === 'advice' ? S.advising : fmt(S.testing, run.total ? Math.round(run.done / run.total * 100) : 0);
  const info = $('speedInfo');
  const lines = [];
  if (run) lines.push([run.phase === 'advice' ? S.advising : S.speedRunning]);
  else if (s.vscodeModels.some(m => m.timing)) {
    const byTime = s.vscodeModels.filter(measured).sort((a, b) => a.timing.median - b.timing.median);
    // A model the user's own AI judged lightweight comes first; without any advice the fastest one is shown.
    const pick = byTime.find(m => m.recommended);
    const fastest = byTime[0];
    const timeText = m => seconds(m.timing.median) + ' (' + fmt(S.firstWords, seconds(m.timing.first)) + ')';
    if (!fastest) lines.push([S.speedNone]);
    if (pick) lines.push([fmt(S.recommendedPick, pick.name, timeText(pick)), pick.id === s.modelId ? null : pick.id]);
    if (fastest && fastest !== pick) lines.push([fmt(S.fastest, fastest.name, timeText(fastest)), fastest.id === s.modelId ? null : fastest.id]);
    const skipped = s.vscodeModels.filter(m => m.timing && m.timing.status === 'unauthorized').length;
    if (skipped) lines.push([fmt(S.speedUnauthorized, skipped)]);
  }
  info.replaceChildren(...lines.map(([text, useId]) => {
    const line = document.createElement('div');
    line.textContent = text;
    if (useId) {
      const link = document.createElement('a');
      link.textContent = S.useIt;
      link.dataset.use = useId;
      line.append(' · ', link);
    }
    return line;
  }));
  info.hidden = !lines.length;
}
// Shows the newest few; the rest of what the host sent unfolds inline, anything beyond lives in the full list.
const VOCAB_FOLDED = 5;
let vocabExpanded = !!(vscode.getState() || {}).vocabExpanded;
function renderVocabulary(s) {
  const recent = s.vocabularyRecent || [];
  const extra = Math.max(0, recent.length - VOCAB_FOLDED);
  const expanded = vocabExpanded && extra > 0;
  const shown = expanded ? recent : recent.slice(0, VOCAB_FOLDED);
  $('vocabBadge').textContent = s.vocabularyCount;
  $('vocabBadge').hidden = !s.vocabularyCount;
  $('vocabEmpty').hidden = s.vocabularyCount > 0;
  $('vocabList').classList.toggle('expanded', expanded);
  $('vocabList').replaceChildren(...shown.map(entry => {
    const li = document.createElement('li');
    const word = document.createElement('span');
    word.className = 'w';
    word.textContent = entry.text;
    li.append(word);
    if (entry.phonetic) {
      const ph = document.createElement('span');
      ph.className = 'ph';
      ph.textContent = '/' + entry.phonetic + '/';
      li.append(ph);
    }
    if (entry.translation) {
      const tr = document.createElement('div');
      tr.className = 'tr';
      tr.textContent = entry.translation;
      tr.title = entry.translation;
      li.append(tr);
    }
    return li;
  }));
  $('vocabToggle').hidden = !extra;
  $('vocabToggle').textContent = expanded ? S.vocabShowLess : fmt(S.vocabShowMore, extra);
  $('vocabToggle').setAttribute('aria-expanded', String(expanded));
  const more = s.vocabularyCount - shown.length;
  $('vocabMore').hidden = !expanded || more <= 0;
  $('vocabMore').textContent = fmt(S.vocabMore, more);
  for (const id of ['vocabOpen', 'vocabExport', 'vocabRemove']) $(id).disabled = !s.vocabularyCount;
}
function render() {
  const s = state;
  $('intDot').classList.toggle('on', s.integration.enabled);
  $('intText').textContent = s.integration.enabled ? S.active : S.off;
  $('intDetail').textContent = s.integration.enabled ? s.integration.status : '';
  $('enableBtn').classList.toggle('primary', !s.integration.enabled);
  $('disableBtn').hidden = !s.integration.enabled;
  $('scParagraph').value = s.shortcuts.paragraph;
  $('scFullPage').value = s.shortcuts.fullPage;
  $('mdText').textContent = s.markdownPreviewDefault ? S.mdOn : S.mdOff;
  $('mdText').classList.toggle('ok', !!s.markdownPreviewDefault);
  $('mdSet').hidden = !!s.markdownPreviewDefault;
  $('mdUndo').hidden = !s.markdownPreviewDefault;
  fill($('targetLanguage'), s.languages.map(l => [l.code, l.label]), s.targetLanguage);
  $('fullPageMode').value = s.fullPageMode;
  $('autoAI').checked = s.autoAI;
  fill($('provider'), s.providers.map(p => [p.id, p.label]), s.provider);
  const vs = s.provider === 'vscode';
  $('vscodeAI').hidden = !vs;
  $('httpAI').hidden = vs;
  if (vs) {
    fillModels(s);
    $('noModels').hidden = s.vscodeModels.length > 0;
    $('chooseHint').hidden = !!s.modelId || !s.vscodeModels.length;
    $('accessInfo').hidden = !s.modelId || s.modelAuthorized !== false;
    renderSpeed(s);
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
  renderVocabulary(s);
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
  // The German block appears for a German UI or once a German word has been looked up.
  $('deBox').hidden = s.uiLanguage !== 'de' && !['ready', 'loading', 'downloading', 'error'].includes(de.status);
  $('version').textContent = 'v' + s.version;
  renderDot(s.dot);
}
// The selection dot drawn exactly as the injected UI draws it (see .imt-dot in ui.js).
let dot;
function paintDot(el, d) {
  const icon = !!d.icon;
  el.style.setProperty('--s', d.size + 'px');
  el.style.setProperty('--b', d.borderWidth + 'px solid ' + d.borderColor);
  el.style.setProperty('--r', icon ? '0' : d.shape === 'rounded' ? '28%' : '50%');
  el.style.setProperty('--bg', icon ? 'transparent url("' + d.icon + '") center / contain no-repeat' : d.color);
  el.style.setProperty('--o', d.opacity);
  el.style.setProperty('--sh', icon ? 'none' : '0 0 2px #0006');
}
function renderDot(d) {
  if (!d) return;
  dot = { ...d };
  paintDot($('dotPreview'), dot);
  paintDot($('dotStage'), dot);
  // A control the user is still holding keeps its value.
  const set = (id, value) => { if (document.activeElement !== $(id)) $(id).value = value; };
  set('dotSize', dot.size);
  set('dotBorderWidth', dot.borderWidth);
  set('dotOpacity', dot.opacity);
  set('dotColor', dot.color);
  set('dotBorderColor', dot.borderColor);
  set('dotShape', dot.shape);
  dotOutputs();
  for (const sw of document.querySelectorAll('.swatch')) {
    sw.style.setProperty('--c', sw.dataset.color);
    sw.title = sw.dataset.color;
    sw.setAttribute('aria-label', S.dotColor + ' ' + sw.dataset.color);
    sw.setAttribute('aria-pressed', String(!dot.icon && sw.dataset.color.toLowerCase() === dot.color.toLowerCase()));
  }
  // With an image the fill color and shape are not visible, so those rows are dimmed.
  $('dotColorRow').classList.toggle('disabled', !!dot.icon);
  $('dotShape').disabled = !!dot.icon;
  $('dotThumb').hidden = !dot.icon;
  if (dot.icon) $('dotThumb').style.setProperty('--img', 'url("' + dot.icon + '")');
  $('dotThumb').title = dot.iconName || '';
  $('dotPick').textContent = dot.icon ? S.dotChangeImage : S.dotUseImage;
  $('dotRemove').hidden = !dot.icon;
}
function dotOutputs() {
  $('dotSizeOut').textContent = $('dotSize').value + ' px';
  $('dotBorderOut').textContent = $('dotBorderWidth').value + ' px';
  $('dotOpacityOut').textContent = Math.round($('dotOpacity').value * 100) + '%';
}
function toggleDotEditor(open = $('dotEditor').hidden) {
  $('dotEditor').hidden = !open;
  $('dotBtn').setAttribute('aria-expanded', String(open));
  vscode.setState({ ...(vscode.getState() || {}), dotEditor: open });
}
// Sliders and pickers repaint the preview while moving; the setting itself is written on "change".
const DOT_LIVE = { dotSize: 'size', dotBorderWidth: 'borderWidth', dotOpacity: 'opacity', dotColor: 'color', dotBorderColor: 'borderColor', dotShape: 'shape' };
for (const [id, key] of Object.entries(DOT_LIVE)) {
  $(id).addEventListener('input', () => {
    if (!dot) return;
    dot[key] = $(id).type === 'range' ? Number($(id).value) : $(id).value;
    paintDot($('dotPreview'), dot);
    paintDot($('dotStage'), dot);
    dotOutputs();
  });
}
$('dotBtn').addEventListener('click', () => {
  toggleDotEditor();
  if (!$('dotEditor').hidden) $('dotEditor').scrollIntoView({ block: 'nearest' });
});
$('dotDone').addEventListener('click', () => { toggleDotEditor(false); $('dotBtn').focus(); });
$('dotColorRow').addEventListener('click', event => {
  const sw = event.target.closest('.swatch');
  if (!sw) return;
  $('dotColor').value = sw.dataset.color;
  vscode.postMessage({ type: 'update', key: 'dot.color', value: sw.dataset.color });
});
$('dotPick').addEventListener('click', () => vscode.postMessage({ type: 'pickDotIcon' }));
$('dotRemove').addEventListener('click', () => vscode.postMessage({ type: 'removeDotIcon' }));
$('dotReset').addEventListener('click', () => vscode.postMessage({ type: 'resetDot' }));
if ((vscode.getState() || {}).dotEditor) toggleDotEditor(true);
// Large images are scaled down here (the extension host has no image decoder): fit into 64×64, keep transparency.
function resizeIcon(data, name) {
  const img = new Image();
  img.onload = () => {
    const box = 64, scale = Math.min(box / img.naturalWidth, box / img.naturalHeight, 1);
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = box;
    canvas.height = box;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (box - w) / 2, (box - h) / 2, w, h);
    vscode.postMessage({ type: 'setDotIcon', data: canvas.toDataURL('image/png'), name });
  };
  img.onerror = () => { $('bannerText').textContent = S.dotImageBad; $('banner').hidden = false; };
  img.src = data;
}
function focusTarget(id) {
  if (id === 'modelId' && $('vscodeAI').hidden) id = 'apiModel';
  if (id === 'vocabList' && $('vocabList').hidden) id = 'vocabOpen';
  const el = $(id);
  if (!el) return;
  if (id === 'dotEditor') toggleDotEditor(true);
  const section = el.closest('details');
  if (section) section.open = true;
  el.scrollIntoView({ block: 'center' });
  el.focus();
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  vscode.postMessage({ type: 'focused' });
}
document.addEventListener('change', event => {
  const el = event.target;
  if (!el.dataset.key) return;
  vscode.postMessage({ type: 'update', key: el.dataset.key, value: el.type === 'checkbox' ? el.checked : el.value.trim() });
});
document.addEventListener('click', event => {
  const el = event.target.closest('[data-command]');
  if (el && !el.disabled) vscode.postMessage({ type: 'command', command: el.dataset.command });
  const use = event.target.closest('[data-use]');
  if (use) vscode.postMessage({ type: 'update', key: 'ai.modelId', value: use.dataset.use });
});
// Collapsed sections are remembered across reloads of the view.
const collapsed = new Set((vscode.getState() || {}).collapsed || []);
for (const section of document.querySelectorAll('details[data-sec]')) {
  if (collapsed.has(section.dataset.sec)) section.open = false;
  section.addEventListener('toggle', () => {
    collapsed[section.open ? 'delete' : 'add'](section.dataset.sec);
    vscode.setState({ ...(vscode.getState() || {}), collapsed: [...collapsed] });
  });
}
function toggleVocab() {
  vocabExpanded = !vocabExpanded;
  vscode.setState({ ...(vscode.getState() || {}), vocabExpanded });
  renderVocabulary(state);
  if (!vocabExpanded) $('vocabList').scrollTop = 0;
}
$('vocabToggle').addEventListener('click', toggleVocab);
for (const id of ['vocabToggle', 'vocabMore']) {
  $(id).addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    $(id).click();
  });
}
$('bannerClose').addEventListener('click', () => { $('banner').hidden = true; });
$('keyLink').addEventListener('click', () => vscode.postMessage({ type: 'external', url: $('keyLink').dataset.url }));
$('speedBtn').addEventListener('click', () => {
  $('speedBtn').disabled = true;
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
      const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\\d$/.test(code) ? code.slice(5) : /^F\\d{1,2}$/.test(code) ? code :
        code === 'Space' ? 'Space' : code === 'Backquote' ? '\`' : '';
      if (!key) return;
      value = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+');
    }
    input.value = value;
    vscode.postMessage({ type: 'update', key: input.dataset.shortcut, value });
  });
}
window.addEventListener('message', ({ data }) => {
  if (data.type === 'state') {
    state = data.state;
    render();
    $('aiError').hidden = true;
    if (data.focus) focusTarget(data.focus);
  }
  if (data.type === 'error') { $('bannerText').textContent = data.message; $('banner').hidden = false; }
  if (data.type === 'resizeIcon') resizeIcon(data.data, data.name);
  if (data.type === 'models') {
    $('fetchBtn').disabled = false;
    $('fetchBtn').textContent = S.fetch;
    if (data.error) { $('aiError').textContent = data.error; $('aiError').hidden = false; return; }
    $('modelList').replaceChildren(...data.models.map(m => option(m, m)));
    $('apiModel').focus();
  }
});
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
  }
}

module.exports = { SettingsPanel, STRINGS };
