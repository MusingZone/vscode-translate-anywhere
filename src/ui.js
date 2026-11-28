/* This function is serialized into the workbench and webview preload. */
function immersiveUI(config) {
  'use strict';
  if (window.__immersiveTranslateInstalled) return;
  window.__immersiveTranslateInstalled = true;
  const attached = new WeakSet();
  const cache = new Map();
  let disabled = false;
  const NESTED_CSS = 'p,ul,ol,pre,table,blockquote,div,dl,h1,h2,h3,h4,h5,h6,li,dt,dd,td,th,figure,details,summary,' +
    'figcaption,section,article,nav,aside,header,footer,form,fieldset,hr';
  // Controls whose label is translated on its own in extension webviews, when it is long enough to be prose.
  const CONTROLS = 'button,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="treeitem"]';
  // User settings arrive from the extension through /status (polled), so changes apply without a reload.
  const DEFAULTS = {
    targetLanguage: 'zh-CN', uiLanguage: 'en', fullPageMode: 'translationOnly', autoAI: true, translationEngine: 'ai',
    surfaces: {}, shortcuts: { paragraph: 'Alt+Z', fullPage: 'Alt+W' }, tip: false
  };
  let settings = DEFAULTS;
  // Identifies this page (workbench or one webview) in the bridge's shared "last mouse press" record.
  const pageId = Math.random().toString(36).slice(2);
  let staleWarned = false;
  // The paragraph-shortcut hint appears at most once per page runtime; the extension limits it further.
  let tipShown = false;
  let tipUsedReported = false;
  const toasters = [];
  const statusListeners = [];
  const STRINGS = {
    en: {
      dotTitle: 'Hover to translate', panelLabel: 'Translation', starAdd: 'Add to vocabulary',
      starRemove: 'In vocabulary. Click to remove', close: 'Close (Esc)', aiButton: 'AI translate', aiRetry: 'Retranslate',
      aiTitle: 'Translate the selection with your AI model',
      looking: 'Looking up the offline dictionary…', aiRunning: 'Translating with AI…', aiTimeout: 'AI translation timed out',
      aiFailed: 'AI translation failed: {0}', lookupFailed: 'Lookup failed: {0}. Run "Translate Anywhere: Show Status".',
      notFound: 'Not in the offline dictionary. Click "AI translate" to translate it.',
      onlineButton: 'Online translate', onlineTitle: 'Translate with the selected online service', onlineRunning: 'Translating online…',
      onlineFailed: 'Online translation failed: {0}', onlineTimeout: 'Online translation timed out',
      onlineNotFound: 'Not in the offline dictionary. Click "Online translate" to translate it.',
      offlineNotFound: 'Not in the offline dictionary. Choose Online or AI in the sidebar for this text.',
      saved: '★ Added to vocabulary: {0}', removed: 'Removed from vocabulary: {0}', vocabFailed: 'Vocabulary update failed: {0}',
      noParagraph: 'No translatable paragraph under the mouse', noNeed: 'This paragraph is already in the target language',
      translating: 'Translating…', paraFailed: '(Translation failed: {0})',
      fullOn: 'Page translation on ({0}). Press {1} again to restore the original.', fullOff: 'Page translation off. Original text restored.',
      modeOnly: 'translation only', modeBilingual: 'bilingual',
      tipLead: 'Tip: ', tipParagraph: 'point at a paragraph and press {0} to translate it in place', tipPage: 'press {0} for the whole page',
      tipJoin: '; ', tipEnd: '.', tipTry: 'Translate this paragraph', tipDismiss: 'Got it',
      stale: 'Translate Anywhere was updated. Run "Developer: Reload Window" to load the new version.'
    },
    zh: {
      dotTitle: '悬停查看翻译', panelLabel: '划词翻译', starAdd: '加入生词本', starRemove: '已收藏，点击移出生词本',
      close: '关闭（Esc）', aiButton: 'AI 翻译', aiRetry: '重新翻译', aiTitle: '用你配置的 AI 模型翻译划选内容',
      looking: '正在查询离线词典…', aiRunning: '正在调用 AI 模型翻译…', aiTimeout: 'AI 翻译超时',
      aiFailed: 'AI 翻译失败：{0}', lookupFailed: '查询失败：{0}。请运行 Translate Anywhere: Show Status 检查扩展。',
      notFound: '离线词典未收录。点击“AI 翻译”进行翻译。',
      onlineButton: '在线翻译', onlineTitle: '使用所选在线服务翻译', onlineRunning: '正在在线翻译…',
      onlineFailed: '在线翻译失败：{0}', onlineTimeout: '在线翻译超时',
      onlineNotFound: '离线词典未收录。点击“在线翻译”进行翻译。',
      offlineNotFound: '离线词典未收录。请在侧边栏选择在线翻译或 AI 翻译此文本。',
      saved: '★ 已加入生词本：{0}', removed: '已移出生词本：{0}', vocabFailed: '生词本操作失败：{0}',
      noParagraph: '鼠标下没有可翻译的段落', noNeed: '该段落已是目标语言，无需翻译',
      translating: '翻译中…', paraFailed: '（翻译失败：{0}）',
      fullOn: '全文翻译（{0}）：已开启，再按 {1} 恢复原文', fullOff: '全文翻译：已关闭，已恢复原文',
      modeOnly: '仅译文', modeBilingual: '双语对照',
      tipLead: '小提示：', tipParagraph: '鼠标指向段落按 {0}，译文直接显示在原处', tipPage: '按 {0} 翻译整页',
      tipJoin: '；', tipEnd: '。', tipTry: '翻译此段落', tipDismiss: '知道了',
      stale: 'Translate Anywhere 已更新，请运行“Developer: Reload Window”重载窗口以使用新版本。'
    },
    de: {
      dotTitle: 'Zum Übersetzen darauf zeigen', panelLabel: 'Übersetzung', starAdd: 'Zur Vokabelliste hinzufügen',
      starRemove: 'In der Vokabelliste. Klicken zum Entfernen', close: 'Schließen (Esc)', aiButton: 'KI-Übersetzung', aiRetry: 'Neu übersetzen',
      aiTitle: 'Die Auswahl mit Ihrem KI-Modell übersetzen',
      looking: 'Offline-Wörterbuch wird durchsucht…', aiRunning: 'Wird mit KI übersetzt…', aiTimeout: 'Zeitüberschreitung der KI-Übersetzung',
      aiFailed: 'KI-Übersetzung fehlgeschlagen: {0}', lookupFailed: 'Nachschlagen fehlgeschlagen: {0}. Führen Sie "Translate Anywhere: Show Status" aus.',
      notFound: 'Nicht im Offline-Wörterbuch. Klicken Sie auf "KI-Übersetzung".',
      onlineButton: 'Online übersetzen', onlineTitle: 'Mit dem gewählten Online-Dienst übersetzen', onlineRunning: 'Wird online übersetzt…',
      onlineFailed: 'Online-Übersetzung fehlgeschlagen: {0}', onlineTimeout: 'Zeitüberschreitung der Online-Übersetzung',
      onlineNotFound: 'Nicht im Offline-Wörterbuch. Auf "Online übersetzen" klicken.',
      offlineNotFound: 'Nicht im Offline-Wörterbuch. Online oder KI in der Seitenleiste wählen.',
      saved: '★ Zur Vokabelliste hinzugefügt: {0}', removed: 'Aus der Vokabelliste entfernt: {0}', vocabFailed: 'Vokabelliste konnte nicht aktualisiert werden: {0}',
      noParagraph: 'Kein übersetzbarer Absatz unter der Maus', noNeed: 'Dieser Absatz ist bereits in der Zielsprache',
      translating: 'Wird übersetzt…', paraFailed: '(Übersetzung fehlgeschlagen: {0})',
      fullOn: 'Seitenübersetzung an ({0}). Erneut {1} drücken, um das Original wiederherzustellen.', fullOff: 'Seitenübersetzung aus. Original wiederhergestellt.',
      modeOnly: 'nur Übersetzung', modeBilingual: 'zweisprachig',
      tipLead: 'Tipp: ', tipParagraph: 'auf einen Absatz zeigen und {0} drücken übersetzt ihn an Ort und Stelle', tipPage: '{0} übersetzt die ganze Seite',
      tipJoin: '; ', tipEnd: '.', tipTry: 'Diesen Absatz übersetzen', tipDismiss: 'Verstanden',
      stale: 'Translate Anywhere wurde aktualisiert. Führen Sie "Developer: Reload Window" aus, um die neue Version zu laden.'
    }
  };
  const uiStrings = () => {
    const lang = String(settings.uiLanguage).toLowerCase();
    return STRINGS[['zh', 'de'].find(code => lang.startsWith(code)) || 'en'];
  };
  const t = (key, ...args) => (uiStrings()[key] ?? STRINGS.en[key])
    .replace(/\{(\d)\}/g, (_all, index) => String(args[index] ?? ''));
  const engineText = key => t(settings.translationEngine === 'online' ? `online${key}` : `ai${key}`);
  const engineIdentity = () => JSON.stringify([settings.translationEngine, settings.targetLanguage,
    settings.onlineProvider, settings.onlineSourceLanguage, settings.onlineAuthorized]);
  // "Ctrl+Shift+Y" style shortcuts, matched on physical key codes so keyboard layouts do not matter.
  function parseShortcut(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const shortcut = { ctrl: false, alt: false, shift: false, meta: false, code: '' };
    for (const part of text.split('+').map(value => value.trim().toLowerCase())) {
      if (part === 'ctrl' || part === 'control') shortcut.ctrl = true;
      else if (part === 'alt' || part === 'option') shortcut.alt = true;
      else if (part === 'shift') shortcut.shift = true;
      else if (['meta', 'cmd', 'win', 'super'].includes(part)) shortcut.meta = true;
      else if (/^[a-z]$/.test(part)) shortcut.code = 'Key' + part.toUpperCase();
      else if (/^[0-9]$/.test(part)) shortcut.code = 'Digit' + part;
      else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(part)) shortcut.code = part.toUpperCase();
      else if (part === 'space') shortcut.code = 'Space';
      else if (part === '`' || part === 'backquote') shortcut.code = 'Backquote';
      else return null;
    }
    return shortcut.code ? shortcut : null;
  }
  const pressed = (event, text) => {
    const shortcut = parseShortcut(text);
    return !!shortcut && event.code === shortcut.code && event.ctrlKey === shortcut.ctrl &&
      event.altKey === shortcut.alt && event.shiftKey === shortcut.shift && event.metaKey === shortcut.meta;
  };
  // Heuristic: is the text already written in the target language (so there is nothing to translate)?
  const GERMAN_WORDS = new Set(('der die das und ist nicht mit ein eine einen einem dem den des zu von für auf sich im es sie wir ' +
    'ich auch werden wird wurde oder aber wenn bei nach aus wie noch nur über durch kann können sind hat haben').split(' '));
  function inTarget(text) {
    const letters = text.match(/\p{L}/gu);
    if (!letters) return true;
    const share = pattern => (text.match(pattern) || []).length / letters.length;
    const lang = String(settings.targetLanguage || 'zh-CN').toLowerCase();
    const han = share(/\p{Script=Han}/gu);
    const kana = share(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
    if (lang.startsWith('zh')) return han >= 0.3 && kana < 0.05;
    if (lang === 'ja') return kana >= 0.05 || han >= 0.3;
    if (lang === 'ko') return share(/\p{Script=Hangul}/gu) >= 0.3;
    if (lang === 'ru' || lang === 'uk') return share(/\p{Script=Cyrillic}/gu) >= 0.5;
    if (lang === 'ar') return share(/\p{Script=Arabic}/gu) >= 0.5;
    if (lang === 'en') return /^[\x00-\x7f]*$/.test(text);
    if (lang === 'de') {
      // German shares the Latin script with English, so look at the share of common German function words.
      const words = text.toLowerCase().match(/\p{L}+/gu) || [];
      return words.length >= 4 && words.filter(word => GERMAN_WORDS.has(word)).length / words.length >= 0.15;
    }
    return false;
  }
  // Is the selection German? Umlauts/ß settle it; otherwise look at the function words around the selection.
  function looksGerman(text, selection) {
    if (/[äöüß]/i.test(text)) return true;
    let context = text;
    try {
      const node = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      const block = element?.closest('p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, div') || element;
      if (block?.textContent) context = block.textContent.slice(0, 1000);
    } catch { /* keep the selection itself as context */ }
    const words = context.toLowerCase().match(/\p{L}+/gu) || [];
    if (words.length < 4) return false;
    const ratio = words.filter(word => GERMAN_WORDS.has(word)).length / words.length;
    return ratio >= 0.12 || (ratio >= 0.06 && /[äöüß]/i.test(context));
  }
  function applyStatus(data) {
    disabled = !data.enabled;
    settings = { ...DEFAULTS, ...(data.settings || {}) };
    settings.shortcuts = { ...DEFAULTS.shortcuts, ...(data.settings?.shortcuts || {}) };
    const stale = config.uiHash ? data.uiHash && data.uiHash !== config.uiHash : config.version && data.version && data.version !== config.version;
    if (stale && !staleWarned) {
      staleWarned = true;
      for (const notify of toasters) notify(t('stale'), 8000);
    }
  }
  async function request(route, payload = {}) {
    const response = await fetch(config.endpoint + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Immersive-Token': config.token },
      body: JSON.stringify(typeof payload === 'string' ? { text: payload } : payload),
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  async function streamAI(text, signal, onDelta, mode = 'selection') {
    const response = await fetch(config.endpoint + '/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Immersive-Token': config.token },
      body: JSON.stringify({ text, mode }),
      signal
    });
    if (!(response.headers.get('content-type') || '').includes('ndjson')) {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.error) throw new Error(message.error);
        if (message.done) return message;
        if (message.delta) onDelta(message.delta);
      }
    }
    throw new Error('Translation response ended unexpectedly');
  }

  // Webview documents are one surface each; the workbench document hosts several, told apart by container.
  // VS Code puts the owning extension ID on the webview preload URL, not in the content's HTML.
  const isOwnWebview = new URLSearchParams(location.search).get('extensionId')?.toLowerCase() === 'musingzone.vscode-translate-anywhere';
  function scopeFor(doc) {
    if (doc.querySelector('#vscode-markdown-preview-data')) return 'markdownPreview';
    if (doc.querySelector('#release-notes-tokenization')) return 'releaseNotes';
    // Built-in extension details webviews (README / changelog) share this scroll button template.
    if (doc !== document && doc.querySelector('body > #scroll-to-top')) return 'extensionPages';
    // Welcome walkthrough steps render their Markdown in a webview wrapped in this custom element.
    if (doc !== document && doc.querySelector('body > vertically-centered')) return 'welcome';
    // Any other extension's webview. This extension's own sidebar is a settings form, not content.
    if (doc !== document) return isOwnWebview ? null : 'extensionPages';
    if (doc === document && location.protocol === 'vscode-file:') return 'workbench';
    return null;
  }
  // [surface, where selection is allowed, where paragraph / full-page translation applies].
  // VS Code sets `body { user-select: none }` and opts in only scattered subtrees; each enabled surface makes
  // its prose selectable while editors, inputs, scrollbars, sashes, draggable items and icons stay excluded.
  const CHAT_SURFACE = '.interactive-session,.agent-sessions-get-started,.no-agent-host-empty-state,.connection-diagnostics-content';
  const WORKBENCH_UI = '.notifications-toasts,.notifications-center,.monaco-dialog-box,.workbench-hover-container,' +
    '.monaco-hover,.workspace-trust-editor,.tree-explorer-viewlet-tree-view .message,.search-view .message,' +
    '.pane-body .welcome-view-content,.ai-customization-management-editor,.monaco-editor-pane-placeholder,.browser-error-content';
  const REGIONS = [
    // The whole Chat view and Agents window: welcome/notices, answers, question carousels, confirmations and onboarding.
    ['chat', CHAT_SURFACE, CHAT_SURFACE],
    ['settings', '.settings-editor,.keybindings-editor', '.settings-editor,.keybindings-editor'],
    ['extensionPages', '.extension-editor', '.extension-editor'],
    ['welcome', '.gettingStartedContainer,.walkThroughContent', '.gettingStartedContainer,.walkThroughContent'],
    ['workbenchUI', WORKBENCH_UI, WORKBENCH_UI]
  ];
  const surfaceOn = key => !disabled && settings.surfaces?.[key] !== false;

  function attach(doc, scope) {
    if (!scope || attached.has(doc) || !doc.body) return;
    attached.add(doc);
    // Timers and observers always come from this runtime's realm: extension README/changelog webviews are
    // sandboxed without allow-scripts, and callbacks scheduled on such a frame's window never run.
    const win = doc.defaultView;
    const WB_CONTROLS = 'button:not(.button-link,.migration-link-button),.monaco-button:not(.button-link,.migration-link-button),' +
      '.action-label,[role="tab"],[role="menuitem"]';
    // Webviews of other extensions (editor panels, sidebar views, custom editors) have arbitrary markup.
    const generic = scope === 'extensionPages' && doc !== document && !doc.querySelector('body > #scroll-to-top');
    const hasLoose = generic || scope === 'workbench';
    // Kept visible while a translation-only paragraph streams: child blocks translated on their own.
    const KEPT = generic ? `${NESTED_CSS},main,${CONTROLS}`
      : scope === 'workbench' ? `${NESTED_CSS},main,${WB_CONTROLS}` : NESTED_CSS;
    const NO_SELECT_OVERRIDE = '.monaco-editor,.monaco-editor *,.xterm,.xterm *,input,textarea,select,' +
      '.monaco-sash,.monaco-sash *,.scrollbar,.scrollbar *,[draggable="true"],[draggable="true"] *,.draggable,.draggable *,' +
      '.codicon,img,svg,canvas,.imt-panel,.imt-panel *,.imt-dot,.imt-toast';
    const workbenchSelectionCSS = scope === 'workbench' ? [
      'html[class*="imt-surface-"] :is(.monaco-editor,.xterm,.monaco-sash,.scrollbar,[draggable="true"],.draggable){user-select:none;-webkit-user-select:none}',
      ...REGIONS.map(([key, container]) =>
        `html.imt-surface-${key} :is(${container}):not(${NO_SELECT_OVERRIDE}),` +
        `html.imt-surface-${key} :is(${container}) :not(${NO_SELECT_OVERRIDE}){user-select:text!important;-webkit-user-select:text!important}` +
        `html.imt-surface-${key} :is(${container}) :is(a,button,.monaco-button,.monaco-link):not([draggable="true"],.draggable){-webkit-user-drag:none}`
      ),
      'html.imt-surface-chat .chat-question-answer-collapsible:not(.chat-question-answer-expandable) .chat-question-summary-answer-value{pointer-events:auto!important}',
      'html.imt-surface-workbenchUI .plugin-list-widget .plugin-search-header{pointer-events:auto!important}'
    ].join('\n      ') : '';
    const style = doc.createElement('style');
    const nonceStyle = doc.querySelector('style[nonce], script[nonce]');
    if (nonceStyle?.nonce) style.nonce = nonceStyle.nonce;
    style.textContent = `
      .imt-dot{position:fixed!important;box-sizing:border-box!important;width:var(--imt-dot-size,7.2px)!important;height:var(--imt-dot-size,7.2px)!important;min-width:0!important;min-height:0!important;padding:0!important;margin:0!important;border:var(--imt-dot-border,1px solid #fff)!important;border-radius:var(--imt-dot-radius,50%)!important;background:var(--imt-dot-bg,#e5484d)!important;opacity:var(--imt-dot-opacity,.85)!important;box-shadow:var(--imt-dot-shadow,0 0 2px #0006)!important;z-index:2147483646!important;cursor:pointer!important;transition:transform .12s,opacity .12s!important}
      .imt-dot::before{content:""!important;position:absolute!important;inset:-6px!important;border-radius:50%!important}
      .imt-dot:hover,.imt-dot:focus-visible{opacity:1!important;transform:scale(1.3)!important;outline:none!important}
      .imt-panel{position:fixed!important;box-sizing:border-box!important;max-width:calc(100vw - 16px)!important;width:360px!important;max-height:60vh!important;overflow:auto!important;padding:10px 12px 10px 14px!important;border:1px solid var(--vscode-widget-border,#777)!important;border-radius:10px!important;background:var(--vscode-editorWidget-background,#252526)!important;color:var(--vscode-editorWidget-foreground,#eee)!important;box-shadow:0 5px 24px #0005!important;z-index:2147483647!important;font:14px/1.6 var(--vscode-font-family,system-ui)!important;user-select:text!important}
      .imt-panel[hidden],.imt-dot[hidden],.imt-toast[hidden],.imt-panel [hidden]{display:none!important}
      .imt-head{display:flex!important;align-items:flex-start!important;gap:8px!important}
      .imt-word{flex:1!important;min-width:0!important;font-weight:600!important;overflow:hidden!important;display:-webkit-box!important;-webkit-line-clamp:3!important;-webkit-box-orient:vertical!important;overflow-wrap:anywhere!important}
      .imt-tools{display:flex!important;gap:2px!important;flex:none!important;margin:-3px -5px 0 0!important}
      .imt-icon{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:26px!important;height:26px!important;padding:0!important;margin:0!important;border:0!important;border-radius:5px!important;background:transparent!important;color:inherit!important;opacity:.65!important;cursor:pointer!important}
      .imt-icon:hover,.imt-icon:focus-visible{opacity:1!important;background:var(--vscode-toolbar-hoverBackground,#5a5d5e50)!important;outline:none!important}
      .imt-icon svg{width:16px!important;height:16px!important;fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;stroke-linecap:round!important;stroke-linejoin:round!important;pointer-events:none!important}
      .imt-star.imt-on{color:#e8a317!important;opacity:1!important}
      .imt-star.imt-on svg{fill:currentColor!important}
      .imt-panel p{margin:6px 0 0!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important}
      .imt-panel small{opacity:.7!important}
      .imt-foot{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;margin-top:8px!important}
      .imt-foot:empty{display:none!important}
      .imt-ai{flex:none!important;margin:0 0 0 auto!important;padding:1px 10px!important;border:1px solid var(--vscode-button-border,transparent)!important;border-radius:4px!important;background:var(--vscode-button-secondaryBackground,#3a3d41)!important;color:var(--vscode-button-secondaryForeground,#fff)!important;font:12px/1.7 var(--vscode-font-family,system-ui)!important;cursor:pointer!important}
      .imt-ai:hover{background:var(--vscode-button-secondaryHoverBackground,#45494e)!important}
      .imt-ai:disabled{opacity:.5!important;cursor:default!important}
      .imt-trans{display:block!important;margin:4px 0 2px!important;opacity:.82!important;white-space:pre-wrap!important;font-weight:normal!important}
      .imt-trans.imt-loading{opacity:.45!important;font-style:italic!important}
      .imt-tip{margin-top:8px!important;padding:6px 8px!important;border-radius:6px!important;background:var(--vscode-textBlockQuote-background,#7f7f7f1f)!important;border-left:3px solid var(--vscode-textLink-foreground,#4daafc)!important;font:12px/1.5 var(--vscode-font-family,system-ui)!important;white-space:normal!important;user-select:none!important}
      .imt-tip kbd{padding:0 4px!important;border:1px solid var(--vscode-keybindingLabel-border,#7f7f7f80)!important;border-bottom-width:2px!important;border-radius:3px!important;background:var(--vscode-keybindingLabel-background,#7f7f7f26)!important;font:600 11px var(--vscode-editor-font-family,monospace)!important}
      .imt-tip-actions{display:flex!important;gap:12px!important;justify-content:flex-end!important;margin-top:4px!important}
      .imt-tip-actions button{padding:0!important;margin:0!important;border:0!important;background:transparent!important;color:var(--vscode-textLink-foreground,#4daafc)!important;font:12px/1.5 var(--vscode-font-family,system-ui)!important;cursor:pointer!important}
      .imt-tip-actions button:hover{text-decoration:underline!important}
      ${workbenchSelectionCSS}
      .imt-only{font-size:0!important;line-height:0!important}
      .imt-only::marker{font-size:var(--imt-fs)!important}
      .imt-only>:not(.imt-trans):not(:is(${KEPT})){display:none!important}
      .imt-only>.imt-trans,.imt-only>:is(${KEPT}){font-size:var(--imt-fs)!important;line-height:var(--imt-lh)!important}
      .imt-only>.imt-trans{display:inline!important;margin:0!important;opacity:1!important;font-weight:inherit!important}
      .imt-toast{position:fixed!important;left:50%!important;bottom:24px!important;transform:translateX(-50%)!important;padding:6px 14px!important;border-radius:6px!important;background:var(--vscode-editorWidget-background,#252526)!important;color:var(--vscode-editorWidget-foreground,#eee)!important;border:1px solid var(--vscode-widget-border,#777)!important;z-index:2147483647!important;font:13px/1.5 var(--vscode-font-family,system-ui)!important;pointer-events:none!important}
    `;
    // An extension's CSP may permit no inline styles at all. Constructed style sheets are not subject to
    // style-src, so other extensions' webviews get the rules that way, falling back to the <style> element.
    let adopted = false;
    if (generic) {
      try {
        const sheet = new win.CSSStyleSheet();
        sheet.replaceSync(style.textContent);
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
        adopted = true;
      } catch (error) {
        console.warn('[Translate Anywhere] Constructed styles unavailable in this webview:', error.message);
      }
    }
    if (!adopted) doc.head.appendChild(style);
    if (scope === 'workbench') {
      const updateSelection = () => {
        for (const [key] of REGIONS) doc.documentElement.classList.toggle(`imt-surface-${key}`, surfaceOn(key));
      };
      updateSelection();
      statusListeners.push(updateSelection);
    }
    // Outermost matching container within the same surface selector, so nested regions (e.g. .monaco-hover inside
    // .workbench-hover-container) resolve to one pane root while sibling panes stay distinct.
    function outermost(element, selector) {
      let match = element?.closest?.(selector) || null;
      while (match?.parentElement) {
        const outer = match.parentElement.closest(selector);
        if (!outer) break;
        match = outer;
      }
      return match;
    }
    // Which surface (and which pane root) an element belongs to, ignoring enabled/disabled switches.
    function rawRegionOf(element) {
      if (!element?.closest) return null;
      if (scope !== 'workbench') return { key: scope, root: doc.body, content: doc.body };
      for (const [key, container, content] of REGIONS) {
        const root = outermost(element, container);
        if (root) return { key, root, content: outermost(element, content) };
      }
      return null;
    }
    // Which enabled surface (and which container instance) an element belongs to; null when not translatable here.
    function regionOf(element) {
      const region = rawRegionOf(element);
      return region && surfaceOn(region.key) ? region : null;
    }
    const dot = doc.createElement('button');
    dot.className = 'imt-dot';
    dot.hidden = true;
    // The user's dot style (size, colors, shape, image) as custom properties read by the .imt-dot rule.
    function styleDot() {
      const d = settings.dot || {};
      const size = d.size > 0 ? d.size : 7.2;
      const icon = typeof d.icon === 'string' && /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/]+=*$/.test(d.icon) ? d.icon : '';
      const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '';
      const set = (name, value) => value === '' ? dot.style.removeProperty(name) : dot.style.setProperty(name, value);
      set('--imt-dot-size', `${size}px`);
      set('--imt-dot-border', d.borderWidth >= 0 ? `${d.borderWidth}px solid ${color(d.borderColor) || '#fff'}` : '');
      set('--imt-dot-radius', icon ? '0' : d.shape === 'rounded' ? '28%' : '');
      set('--imt-dot-opacity', d.opacity > 0 ? String(d.opacity) : '');
      set('--imt-dot-bg', icon ? `transparent url("${icon}") center / contain no-repeat` : color(d.color));
      set('--imt-dot-shadow', icon ? 'none' : '');
    }
    styleDot();
    statusListeners.push(styleDot);
    const panel = doc.createElement('section');
    panel.className = 'imt-panel';
    panel.setAttribute('role', 'dialog');
    panel.hidden = true;
    // SVG is built with DOM APIs: the workbench enforces Trusted Types, so innerHTML strings are not allowed.
    const icon = (...paths) => {
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      for (const d of paths) {
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.append(path);
      }
      return svg;
    };
    const iconButton = (className, label, svg) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = `imt-icon ${className}`;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.append(svg);
      return button;
    };
    const head = doc.createElement('div');
    head.className = 'imt-head';
    const heading = doc.createElement('strong');
    heading.className = 'imt-word';
    const tools = doc.createElement('div');
    tools.className = 'imt-tools';
    const star = iconButton('imt-star', '',
      icon('M12 3.6l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.62l-5.1 2.68.97-5.68L3.75 9.6l5.7-.83z'));
    star.setAttribute('aria-pressed', 'false');
    const close = iconButton('imt-close', '', icon('M6.5 6.5l11 11M17.5 6.5l-11 11'));
    tools.append(star, close);
    head.append(heading, tools);
    const phonetic = doc.createElement('small');
    const result = doc.createElement('p');
    result.setAttribute('aria-live', 'polite');
    const foot = doc.createElement('div');
    foot.className = 'imt-foot';
    const source = doc.createElement('small');
    const ai = doc.createElement('button');
    ai.type = 'button';
    ai.className = 'imt-ai';
    foot.append(source, ai);
    // One-time hint that long text is quicker with the paragraph / page shortcuts.
    const tip = doc.createElement('div');
    tip.className = 'imt-tip';
    tip.hidden = true;
    const tipText = doc.createElement('div');
    const tipActions = doc.createElement('div');
    tipActions.className = 'imt-tip-actions';
    const tipTry = doc.createElement('button');
    tipTry.type = 'button';
    const tipDismiss = doc.createElement('button');
    tipDismiss.type = 'button';
    tipActions.append(tipTry, tipDismiss);
    tip.append(tipText, tipActions);
    panel.append(head, phonetic, result, foot, tip);
    doc.body.append(dot, panel);
    // Labels follow the current UI language, which can change while the page is open.
    function applyLabels() {
      dot.title = t('dotTitle');
      dot.setAttribute('aria-label', dot.title);
      panel.setAttribute('aria-label', t('panelLabel'));
      close.title = t('close');
      close.setAttribute('aria-label', close.title);
      ai.textContent = engineText('Button');
      ai.title = engineText('Title');
      ai.hidden = settings.translationEngine === 'offline';
      setStar(star.classList.contains('imt-on'));
    }
    function setStar(saved) {
      star.classList.toggle('imt-on', saved);
      star.setAttribute('aria-pressed', String(saved));
      star.title = saved ? t('starRemove') : t('starAdd');
      star.setAttribute('aria-label', star.title);
    }
    let selected = '';
    let selectedStart = null;
    let revision = 0;
    let pointerDownInPanel = false;
    // While the user is still drag-selecting, the dot stays hidden (it would otherwise chase the mouse and
    // open the panel mid-drag). If the mouse is released on top of the dot, hover only arms after it leaves.
    let dragging = false;
    let armed = true;
    let mouseX = -1;
    let mouseY = -1;
    const nearDot = (x, y) => {
      const r = dot.getBoundingClientRect();
      return x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
    };
    let lookupPromise;
    let aiController;
    let aiStartedFor = -1;
    let haveTranslation = false;
    const hide = () => {
      revision++;
      selected = '';
      haveTranslation = false;
      aiController?.abort();
      aiController = undefined;
      dot.hidden = panel.hidden = true;
    };
    const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.monaco-editor';
    function eligible(element) {
      if (!element || element.closest(`.imt-panel,.imt-dot,${EDITABLE}`)) return false;
      return !!regionOf(element);
    }
    // Anchor the dot at the last selected character (or the first one for a backward drag), i.e. where the
    // mouse was released, instead of the right edge of the whole selection's bounding box.
    function edgePoint(selection, range) {
      const backward = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset &&
        !(selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset);
      const container = range.commonAncestorContainer;
      const root = container.nodeType === 1 ? container : container.parentNode;
      const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
      const texts = [];
      let node;
      while ((node = walker.nextNode())) {
        if (range.intersectsNode(node) && /\S/.test(node.data) && !node.parentElement?.closest('.imt-panel,.imt-dot')) texts.push(node);
      }
      if (backward) texts.reverse();
      const probe = doc.createRange();
      for (let i = texts.length - 1; i >= 0; i--) {
        const text = texts[i];
        let from = text === range.startContainer ? range.startOffset : 0;
        let to = text === range.endContainer ? range.endOffset : text.length;
        if (backward) {
          while (from < to && /\s/.test(text.data[from])) from++;
          if (from >= to) continue;
          probe.setStart(text, from);
          probe.setEnd(text, from + 1);
        } else {
          while (to > from && /\s/.test(text.data[to - 1])) to--;
          if (to <= from) continue;
          probe.setStart(text, to - 1);
          probe.setEnd(text, to);
        }
        const rects = [...probe.getClientRects()].filter(r => r.width || r.height);
        if (!rects.length) continue;
        const r = backward ? rects[0] : rects[rects.length - 1];
        const size = dot.getBoundingClientRect().width || settings.dot?.size || 7.2;
        return backward ? { x: r.left - size - 4, y: r.top - size - 2 } : { x: r.right + 3, y: r.bottom + 1 };
      }
      const r = range.getBoundingClientRect();
      return { x: r.right + 3, y: r.bottom + 1 };
    }
    function selectedRange() {
      const selection = win.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
      const range = selection.getRangeAt(0);
      const start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const end = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
      const text = selection.toString().trim();
      if (!eligible(start) || !eligible(end) || !text || text.length > 1200 || inTarget(text)) return null;
      if (regionOf(start).root !== regionOf(end).root) return null;
      return { text, point: edgePoint(selection, range), start };
    }
    function position(element, x, y) {
      element.hidden = false;
      const rect = element.getBoundingClientRect();
      element.style.left = Math.max(8, Math.min(x, win.innerWidth - rect.width - 8)) + 'px';
      element.style.top = Math.max(8, Math.min(y, viewportHeight() - rect.height - 8)) + 'px';
    }
    // The workbench window can extend under the Windows taskbar; keep floating UI inside the work area.
    function viewportHeight() {
      let height = win.innerHeight;
      try {
        if (win === win.top && win.screen?.availHeight) {
          const chrome = Math.max(0, win.outerHeight - win.innerHeight);
          const bottom = (win.screen.availTop || 0) + win.screen.availHeight - win.screenY - chrome;
          if (bottom > 120) height = Math.min(height, bottom);
        }
      } catch { /* cross-origin frames keep innerHeight */ }
      return height;
    }
    // Place the panel below the dot if it fits, else above the selection, else pin it inside the viewport
    // and let it scroll. Longer text gets a wider panel. Re-run whenever the panel resizes (AI streaming).
    function placePanel() {
      if (panel.hidden) return;
      const anchor = dot.getBoundingClientRect();
      const vw = win.innerWidth;
      const vh = viewportHeight();
      const length = selected.length + result.textContent.length;
      const width = Math.min(vw - 16, length > 700 ? 640 : length > 180 ? 500 : 360);
      if (panel.style.getPropertyValue('width') !== width + 'px') panel.style.setProperty('width', width + 'px', 'important');
      panel.style.setProperty('max-height', Math.max(120, vh - 16) + 'px', 'important');
      const height = panel.offsetHeight;
      const below = vh - anchor.bottom - 14;
      const above = anchor.top - 14;
      let top;
      if (height <= below) top = anchor.bottom + 6;
      else if (height <= above) top = anchor.top - 6 - height;
      else top = Math.max(8, vh - height - 8);
      panel.style.left = Math.max(8, Math.min(anchor.left, vw - width - 8)) + 'px';
      panel.style.top = top + 'px';
    }
    const openPanel = () => { panel.hidden = false; placePanel(); };
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => placePanel()).observe(panel);
    function select() {
      if (disabled || pointerDownInPanel || dragging) return;
      const selection = win.getSelection();
      const anchor = selection?.anchorNode;
      const anchorElement = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
      if (anchorElement?.closest('.imt-panel')) return;
      const value = selectedRange();
      // Once the panel is open, keep it until Esc / Close / a click elsewhere: Chat may collapse the
      // selection when focus moves, which must not dismiss the panel the user is interacting with.
      if (!value) return panel.hidden ? hide() : undefined;
      if (value.text === selected && !dot.hidden) return;
      hide();
      applyLabels();
      selected = value.text;
      selectedStart = value.start;
      tip.hidden = true;
      heading.textContent = selected;
      heading.title = selected;
      phonetic.textContent = '';
      result.textContent = t('looking');
      source.textContent = '';
      ai.disabled = false;
      ai.textContent = engineText('Button');
      setStar(false);
      star.hidden = selected.length > 200;
      position(dot, value.point.x, value.point.y);
      armed = mouseX < 0 || !nearDot(mouseX, mouseY);
      const starFor = selected;
      if (!star.hidden) {
        request('/vocab', { text: selected, action: 'has' })
          .then(data => { if (selected === starFor) setStar(!!data.saved); })
          .catch(() => {});
      }
      // Prefetch only the local dictionaries, never the AI model: English → Chinese (ECDICT) and German → Chinese (HanDeDict).
      const german = looksGerman(selected, selection);
      const key = (german ? 'de:' : 'en:') + selected.toLowerCase();
      const dictionary = /^zh/i.test(settings.targetLanguage) && selected.length <= 64;
      lookupPromise = !dictionary ? Promise.resolve({ found: false })
        : cache.has(key) ? Promise.resolve(cache.get(key))
        : request('/lookup', german ? { text: selected, lang: 'de' } : selected).then(data => {
          if (cache.size >= 500) cache.delete(cache.keys().next().value);
          cache.set(key, data);
          return data;
        });
      lookupPromise.catch(error => console.error('[Translate Anywhere] Dictionary request failed:', error.message));
    }
    async function show() {
      if (!selected || disabled) return;
      const id = revision;
      openPanel();
      maybeTip();
      if (aiStartedFor === id) return;
      try {
        const data = await lookupPromise;
        if (revision !== id || aiStartedFor === id) return;
        if (!data.found) {
          // Dictionary misses use only the engine selected by the user.
          phonetic.textContent = '';
          if (settings.translationEngine === 'offline') result.textContent = t('offlineNotFound');
          else if (settings.autoAI !== false) runAI();
          else result.textContent = t(settings.translationEngine === 'online' ? 'onlineNotFound' : 'notFound');
          return;
        }
        result.textContent = data.translation.replace(/\\n/g, '\n');
        haveTranslation = true;
        phonetic.textContent = data.phonetic ? `/${data.phonetic}/` : '';
        source.textContent = data.source;
        placePanel();
      } catch (error) {
        if (revision === id) result.textContent = t('lookupFailed', error.message);
      }
    }
    dot.addEventListener('pointerenter', () => { if (armed) show(); });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      setTimeout(select, 0);
    };
    win.addEventListener('pointermove', event => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      if (dragging && !(event.buttons & 1)) endDrag();
      if (!armed && !nearDot(mouseX, mouseY)) armed = true;
    }, { passive: true, capture: true });
    // mousedown is a fallback in case a host widget captures/cancels the pointer stream.
    const startDrag = event => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      if (event.button === 0 && event.target !== dot && !panel.contains(event.target)) {
        dragging = true;
        dot.hidden = true;
      }
    };
    win.addEventListener('pointerdown', startDrag, { passive: true, capture: true });
    win.addEventListener('mousedown', startDrag, { passive: true, capture: true });
    // VS Code activates buttons, links and list/tree rows on click, including the click generated at the end of a text drag.
    const CLICKABLE_CONTROLS = 'a,button,label,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],' +
      '[role="option"],[role="treeitem"],[role="row"],[role="checkbox"],[role="switch"],' +
      '.monaco-button,.monaco-link,.monaco-list-row,.ai-customization-group-header,.dialog-checkbox-message,' +
      '.setting-item-bool .setting-item-description,[onclick]';
    const elementAt = node => node?.nodeType === 1 ? node : node?.parentElement || null;
    let textPress;
    win.addEventListener('pointerdown', event => {
      const target = elementAt(event.target);
      const region = scope === 'workbench' && event.button === 0 && eligible(target) ? regionOf(target) : null;
      const selection = region && win.getSelection();
      textPress = region && {
        region, x: event.clientX, y: event.clientY, anchor: selection?.anchorNode, anchorOffset: selection?.anchorOffset,
        focus: selection?.focusNode, focusOffset: selection?.focusOffset,
        nonExpandable: target.closest('.chat-question-answer-collapsible:not(.chat-question-answer-expandable)')
      };
    }, true);
    win.addEventListener('click', event => {
      const press = textPress;
      textPress = null;
      if (!press || !event.detail || !surfaceOn(press.region.key)) return;
      const target = elementAt(event.target);
      if (target && press.nonExpandable?.contains(target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const control = target?.closest(CLICKABLE_CONTROLS);
      if (!control || !press.region.root.contains(control)) return;
      const selection = win.getSelection();
      const changed = selection && (selection.anchorNode !== press.anchor || selection.anchorOffset !== press.anchorOffset ||
        selection.focusNode !== press.focus || selection.focusOffset !== press.focusOffset);
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 4;
      if (selection && !selection.isCollapsed && (changed || moved) &&
          (control.contains(selection.anchorNode) || control.contains(selection.focusNode))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    win.addEventListener('mouseup', endDrag, true);
    win.addEventListener('dragend', endDrag, true);
    win.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      setTimeout(select, 0);
    }, true);
    win.addEventListener('blur', () => { dragging = false; });
    dot.addEventListener('focus', show);
    dot.addEventListener('click', show);
    dot.addEventListener('pointerdown', event => event.preventDefault());
    panel.addEventListener('pointerdown', event => {
      pointerDownInPanel = true;
      // Buttons must not take focus: in Chat that collapses the text selection behind the panel.
      if (event.target.closest?.('button')) event.preventDefault();
    });
    panel.addEventListener('mousedown', event => { if (event.target.closest?.('button')) event.preventDefault(); });
    doc.addEventListener('pointerup', () => {
      const wasPanel = pointerDownInPanel;
      pointerDownInPanel = false;
      if (!wasPanel) setTimeout(select, 0);
    });
    doc.addEventListener('selectionchange', () => setTimeout(select, 20));
    doc.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    doc.addEventListener('pointerdown', event => {
      if (!panel.contains(event.target) && event.target !== dot) hide();
    });
    // Popups live per page (Chat/workbench vs. each webview iframe), so a click in another page is never seen
    // here. Every press is reported to the bridge; while this page is blurred with a popup open, it checks
    // whether the focus left because of a press elsewhere (alt-tab to another app keeps the popup open).
    win.addEventListener('pointerdown', () => {
      if (!disabled) request('/pointer', { action: 'down', source: pageId }).catch(() => {});
    }, { passive: true, capture: true });
    // Not document.hasFocus(): it stays true for the workbench while a child webview iframe has focus.
    let watchTimer = 0;
    let blurred = false;
    const stopWatch = () => { blurred = false; clearTimeout(watchTimer); watchTimer = 0; };
    win.addEventListener('blur', () => {
      blurred = true;
      if (panel.hidden || watchTimer) return;
      const blurAt = Date.now() - 400;
      const poll = async () => {
        watchTimer = 0;
        if (panel.hidden || !blurred) return;
        try {
          const last = await request('/pointer', { action: 'get' });
          if (last.time >= blurAt && last.source !== pageId) return hide();
        } catch { /* bridge unavailable: keep the popup */ }
        if (!panel.hidden && blurred) watchTimer = setTimeout(poll, 250);
      };
      watchTimer = setTimeout(poll, 60);
    });
    win.addEventListener('focus', stopWatch);
    win.addEventListener('scroll', event => {
      // An open panel stays until Esc / × / an outside click; Chat auto-scrolls while answers stream.
      if (panel.hidden && !panel.contains(event.target)) hide();
    }, true);
    win.addEventListener('resize', hide);
    close.addEventListener('click', hide);
    ai.addEventListener('click', runAI);
    async function runAI() {
      const id = revision;
      const text = selected;
      if (!text || ai.disabled || settings.translationEngine === 'offline') return;
      aiStartedFor = id;
      haveTranslation = false;
      ai.disabled = true;
      result.textContent = engineText('Running');
      source.textContent = '';
      const controller = aiController = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(engineText('Timeout'))), 35000);
      let streamed = '';
      try {
        const data = await streamAI(text, controller.signal, delta => {
          if (revision !== id) return;
          streamed += delta;
          result.textContent = streamed;
        });
        if (revision !== id) return;
        result.textContent = data.translation;
        haveTranslation = true;
        source.textContent = data.source;
        placePanel();
      } catch (error) {
        if (revision === id) result.textContent = t(settings.translationEngine === 'online' ? 'onlineFailed' : 'aiFailed', error.message);
      } finally {
        clearTimeout(timer);
        if (aiController === controller) aiController = undefined;
        if (revision === id) {
          ai.disabled = false;
          ai.textContent = t('aiRetry');
        }
      }
    }

    star.addEventListener('click', async () => {
      const text = selected;
      if (!text) return;
      const translation = haveTranslation ? result.textContent.slice(0, 1500) : '';
      star.disabled = true;
      try {
        const data = await request('/vocab', {
          text, action: 'toggle', translation, phonetic: phonetic.textContent.replace(/^\/|\/$/g, '')
        });
        if (selected === text) setStar(!!data.saved);
        toast(data.saved ? t('saved', text) : t('removed', text));
      } catch (error) {
        toast(t('vocabFailed', error.message));
      } finally {
        star.disabled = false;
      }
    });

    // ---- Onboarding hint after a long selection: paragraph / page shortcuts are faster for whole passages. ----
    function withKey(template, key) {
      const [before, after = ''] = template.split('{0}');
      const kbd = doc.createElement('kbd');
      kbd.textContent = key;
      return [before, kbd, after];
    }
    function maybeTip() {
      const { paragraph, fullPage } = settings.shortcuts;
      if (tipShown || !settings.tip || (!paragraph && !fullPage)) return;
      // Long sentences or passages only (about 13+ words): short phrases are what the red dot is for.
      if (selected.length < 80 || (selected.match(/\s+/g) || []).length < 12) return;
      tipShown = true;
      const parts = [];
      if (paragraph) parts.push(withKey(uiStrings().tipParagraph ?? STRINGS.en.tipParagraph, paragraph));
      if (fullPage) parts.push(withKey(uiStrings().tipPage ?? STRINGS.en.tipPage, fullPage));
      tipText.replaceChildren('💡 ' + t('tipLead'), ...parts.flatMap((nodes, index) => index ? [t('tipJoin'), ...nodes] : nodes), t('tipEnd'));
      const block = paragraph ? blockAt(selectedStart) : null;
      tipTry.hidden = !block || !translatable(block);
      tipTry.textContent = t('tipTry');
      tipDismiss.textContent = t('tipDismiss');
      tip.hidden = false;
      placePanel();
      request('/tip', { action: 'shown' }).catch(() => {});
    }
    tipTry.addEventListener('click', () => {
      const block = blockAt(selectedStart);
      hide();
      if (block && translatable(block)) enqueue(block, true);
      request('/tip', { action: 'tried' }).catch(() => {});
    });
    tipDismiss.addEventListener('click', () => {
      tip.hidden = true;
      placePanel();
      request('/tip', { action: 'dismissed' }).catch(() => {});
    });
    const shortcutUsed = () => {
      if (tipUsedReported) return;
      tipUsedReported = true;
      request('/tip', { action: 'used' }).catch(() => {});
    };

    // ---- Paragraph translation (default keys match Chrome Immersive Translate):
    //      the page shortcut toggles the whole surface, the paragraph shortcut the paragraph under the mouse. ----
    const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dt,dd,summary,figcaption,caption' + (scope === 'workbench'
      ? ',.setting-item-description,.setting-item-markdown,.setting-item-enumDescription,.setting-item-deprecation-message,.step-description-container,.extension-editor .description' +
        ',.chat-question-title,.chat-question-carousel-message,.chat-question-message,.chat-question-description,.chat-question-detailed-message' +
        ',.chat-question-list-label,.chat-question-list-label-title,.chat-question-list-label-desc,.chat-question-validation-message' +
        ',.chat-question-summary-label,.chat-question-summary-answer-title' +
        ',.chat-question-summary-question-value,.chat-question-summary-answer-value,.chat-question-summary-option-label' +
        ',.chat-confirmation-widget-title,.chat-confirmation-widget-message,.chat-confirmation-message-terminal-reason' +
        ',.chat-input-notification-title,.chat-input-notification-description' +
        ',.notification-list-item-message,.dialog-message-text,.dialog-message-detail,.workspace-trust-description,.hover-contents' +
        ',.tree-explorer-viewlet-tree-view .message,.search-view .message,.editor-placeholder-label-container'
      : '');
    const SKIP = `script,style,.imt-panel,.imt-dot,.imt-trans,.imt-toast,${EDITABLE}`;
    // Code blocks stay as they are. Extension webviews may also show wrapped prose in a <pre> without code.
    const prosePre = pre => generic && !pre.querySelector('code,kbd,samp') &&
      /^(pre-wrap|pre-line|break-spaces)$/.test(win.getComputedStyle(pre).whiteSpace);
    // Inline content kept exactly as it is: code, setting links, keys, icons, media and form controls.
    const ATOMIC = 'code,kbd,samp,var,tt,img,svg,picture,video,audio,canvas,iframe,object,embed,input,select,textarea,' +
      'math,br,wbr,hr,meter,progress,script,style,template,.codicon,.codesetting,.monaco-keybinding,.monaco-icon-label,' +
      '.chat-inline-anchor-widget,[translate="no"],.notranslate,[contenteditable]:not([contenteditable="false"])';
    // Child blocks are translated on their own and stay where they are.
    const NESTED = `${BLOCKS},${KEPT}`;
    // Elements a reader clicks, or whose state page scripts toggle (e.g. the Release Notes contents highlight).
    const INTERACTIVE = 'a,button,label,summary,input,select,textarea,[role],[tabindex],[href],[onclick]';
    const MIRRORED = ['class', 'aria-current', 'aria-selected', 'aria-expanded', 'aria-pressed', 'aria-checked', 'aria-disabled', 'hidden', 'disabled'];
    const TAG = /<\s*(\/?)\s*([gx])\s*(\d+)\s*(\/?)\s*>/gi;
    const stripTags = text => text.replace(TAG, '');
    // While streaming, also hide a marker that has only partly arrived (e.g. "<g1" or "</").
    const streamed = text => stripTags(text).replace(/<\s*\/?\s*(?:[gx]\s*\d*\s*\/?\s*)?$/i, '');
    const jobs = new Map();
    // Translation-only blocks rebuilt in place from their own nodes: block -> how to restore it exactly.
    const placed = new WeakMap();
    const originals = new WeakMap();
    const mirrors = new WeakMap();
    let mirrorObserver;
    const queue = [];
    const settling = new WeakMap();
    let running = 0;
    // Full-page translation is toggled per pane root (root Element -> { root, key, only, blocks }), never
    // across every container sharing a surface category.
    const fullPanes = new Map();
    // undefined = no click/focus observed yet; null = user moved to a non-translatable pane, webview or detached pane;
    // { key, root } = most recently clicked/focused real translatable workbench pane.
    let lastPane;
    let lastPanePressAt = 0;
    let visibility;
    let mutations;
    let rescanTimer = 0;
    let toastTimer;
    let pointerX = -1;
    let pointerY = -1;
    const hovered = () => pointerX < 0 ? null : doc.elementFromPoint(pointerX, pointerY);
    function toast(message, duration = 2200) {
      let node = doc.querySelector('.imt-toast');
      if (!node) {
        node = doc.createElement('div');
        node.className = 'imt-toast';
        doc.body.append(node);
      }
      node.textContent = message;
      node.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { node.hidden = true; }, duration);
    }
    if (scope === 'workbench') toasters.push(toast);
    const WORKBENCH_CHROME = '.monaco-toolbar,.monaco-action-bar,.chat-input-toolbars,.chat-secondary-toolbar,' +
      '.chat-attached-context,.chat-editing-session,.interactive-item-container>.header,.management-sidebar,.settings-toc-container';
    function inContent(element) {
      if (!element?.closest || element.closest(SKIP)) return false;
      if (scope === 'workbench' && element.closest(WORKBENCH_CHROME)) return false;
      const pre = element.closest('pre');
      if (pre && !prosePre(pre)) return false;
      if (generic && invisibleText(element)) return false;
      const region = regionOf(element);
      return !!region?.content;
    }
    // Invisible text overlays (e.g. the pdf.js text layer over a rendered PDF page) can be selected and looked
    // up, but a translation placed into them could not be read.
    function invisibleText(element) {
      const walker = doc.createTreeWalker(element, win.NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) {
        if (/\p{L}/u.test(node.data)) return /^transparent$|^rgba\(.*,\s*0\)$/.test(win.getComputedStyle(node.parentElement).color);
      }
      return false;
    }
    const nestedChild = node => node.nodeType === 1 &&
      (node.matches(NESTED) || node.classList.contains('imt-trans') || !!node.querySelector(hasLoose ? NESTED : BLOCKS));
    // A block's own inline content (nested blocks excluded) as numbered-tag markup, e.g.
    // "<g1>Setting</g1>: <x2/>": <gN> wraps translatable formatting or links, <xN/> stands for content kept
    // as it is. Also returns the nodes behind the tags so the translation can be rebuilt from them.
    function structure(block) {
      const elements = [];
      const inline = [];
      let plain = '';
      const walk = (parent, top) => {
        let markup = '';
        for (const node of parent.childNodes) {
          if (top) {
            if (nestedChild(node)) continue;
            inline.push(node);
          }
          if (node.nodeType === 3) { markup += node.data; plain += node.data; continue; }
          if (node.nodeType !== 1) continue;
          const info = { el: node, children: [...node.childNodes] };
          elements.push(info);
          const id = elements.length;
          if (node.matches(ATOMIC)) {
            info.atomic = true;
            if (!node.matches('script,style,template')) plain += node.textContent;
            markup += `<x${id}/>`;
            continue;
          }
          const inner = walk(node, false);
          if (/\p{L}/u.test(stripTags(inner))) { markup += `<g${id}>${inner}</g${id}>`; continue; }
          // Nothing to translate inside (an icon link, a badge): keep the whole element.
          elements.length = id;
          info.atomic = true;
          markup += `<x${id}/>`;
        }
        return markup;
      };
      const markup = walk(block, true).replace(/\s+/g, ' ').trim();
      return {
        markup, elements, inline, rich: elements.length > 0,
        text: stripTags(markup).replace(/\s+/g, ' ').trim(),
        plain: plain.replace(/\s+/g, ' ').trim()
      };
    }
    const ownText = block => structure(block).plain;
    function translatable(block) {
      const { text } = structure(block);
      return text.length >= 2 && /\p{L}{2}/u.test(text) && !inTarget(text);
    }
    // Parses translated markup into a tree. Unknown or repeated tags are dropped; a wrapper left without
    // words counts as missing.
    function parseMarkup(markup, elements) {
      const root = { children: [] };
      const stack = [root];
      const used = new Set();
      let last = 0;
      const add = value => { if (value) stack[stack.length - 1].children.push(value); };
      for (const match of markup.matchAll(TAG)) {
        add(markup.slice(last, match.index));
        last = match.index + match[0].length;
        const id = Number(match[3]);
        const info = elements[id - 1];
        if (!info) continue;
        if (match[1]) {
          const at = stack.findLastIndex(frame => frame.id === id);
          if (at > 0) stack.length = at;
          continue;
        }
        if (used.has(id) || (match[4] && !info.atomic)) continue;
        used.add(id);
        if (info.atomic) { add({ id }); continue; }
        const frame = { id, children: [] };
        add(frame);
        stack.push(frame);
      }
      add(markup.slice(last));
      const filled = frame => frame.children.some(child => typeof child === 'string' ? /\S/.test(child)
        : elements[child.id - 1].atomic || filled(child));
      const prune = children => {
        for (const child of children) {
          if (typeof child === 'string' || elements[child.id - 1].atomic) continue;
          if (!filled(child)) used.delete(child.id);
          prune(child.children);
        }
      };
      prune(root.children);
      return { tree: root.children, used };
    }
    // Replacing the original needs every kept element and every link or control back in the translation.
    const complete = (elements, used) =>
      elements.every((info, index) => used.has(index + 1) || !(info.atomic || info.el.matches(INTERACTIVE)));
    // Builds translated content from the page's own elements (in place) or from copies of them (bilingual).
    function build(tree, elements, copy) {
      const fragment = doc.createDocumentFragment();
      for (const item of tree) {
        if (typeof item === 'string') { fragment.append(item); continue; }
        const info = elements[item.id - 1];
        if (copy && info.el.matches('input,select,textarea')) continue;
        const el = copy ? copyOf(info.el, !!info.atomic) : info.el;
        if (!info.atomic) el.replaceChildren(build(item.children, elements, copy));
        fragment.append(el);
      }
      return fragment;
    }
    // Bilingual copies keep the look of links and controls and follow their state (e.g. the current section).
    function copyOf(original, deep) {
      const copy = original.cloneNode(deep);
      for (const el of [copy, ...copy.querySelectorAll('[id]')]) el.removeAttribute('id');
      originals.set(copy, original);
      if (original.matches(INTERACTIVE)) {
        if (!mirrors.has(original)) mirrors.set(original, new Set());
        mirrors.get(original).add(copy);
        mirrorObserver ??= new MutationObserver(records => {
          for (const { target, attributeName } of records) {
            for (const clone of mirrors.get(target) || []) {
              if (!clone.isConnected) { mirrors.get(target).delete(clone); continue; }
              const value = target.getAttribute(attributeName);
              if (value === null) clone.removeAttribute(attributeName); else clone.setAttribute(attributeName, value);
            }
          }
        });
        mirrorObserver.observe(original, { attributes: true, attributeFilter: MIRRORED });
      }
      return copy;
    }
    // A click on a copied control that is not a plain link runs the page's own control.
    function forwardClick(event, span) {
      const target = event.target.closest?.(INTERACTIVE);
      if (!target || !span.contains(target) || (scope !== 'workbench' && target.matches('a[href]'))) return;
      let base = target;
      const path = [];
      while (base && base !== span && !originals.has(base)) {
        path.unshift([...base.parentNode.children].indexOf(base));
        base = base.parentElement;
      }
      let original = originals.get(base);
      for (const index of path) original = original?.children[index];
      if (!original?.isConnected) return;
      event.preventDefault();
      event.stopPropagation();
      original.click();
    }
    function render(block, span, translation, source, rich) {
      const s = rich ? structure(block) : null;
      if (s && s.markup === source) span.replaceChildren(build(parseMarkup(translation, s.elements).tree, s.elements, true));
      else span.textContent = rich ? stripTags(translation) : translation;
    }
    // Translation only: swap the paragraph's own text for the translation while reusing its links, code,
    // setting buttons and controls, so their listeners, styles and live state keep working.
    function place(block, span, translation, source, rich) {
      const s = structure(block);
      if ((rich ? s.markup : s.text) !== source || !s.inline.length) return false;
      let tree = [translation];
      if (rich) {
        const parsed = parseMarkup(translation, s.elements);
        if (!complete(s.elements, parsed.used)) return false;
        tree = parsed.tree;
      }
      span.remove();
      showOriginal(block);
      const children = [...block.childNodes];
      const spot = doc.createComment('');
      block.insertBefore(spot, s.inline[0]);
      for (const node of s.inline) node.remove();
      const fragment = build(tree, s.elements, false);
      const nodes = [...fragment.childNodes];
      spot.replaceWith(fragment);
      placed.set(block, {
        children, nodes, out: ownText(block),
        wrappers: s.elements.filter(info => !info.atomic).map(info => [info.el, info.children])
      });
      block.dataset.imtPlaced = '1';
      return true;
    }
    function restore(block) {
      const state = placed.get(block);
      if (!state) return;
      placed.delete(block);
      delete block.dataset.imtPlaced;
      // Undo only our own change: if the page re-rendered the block meanwhile, its new content stays.
      if (!state.nodes.every(node => node.parentNode === block) || ownText(block) !== state.out) return;
      // The translation may have swapped nesting (link inside bold instead of bold inside link): detach every
      // wrapper first so restoring one can never insert an ancestor into its own descendant.
      for (const [el] of state.wrappers) el.remove();
      for (const [el, children] of state.wrappers) el.replaceChildren(...children);
      block.replaceChildren(...state.children);
    }
    // Webviews and workbench surfaces also put prose in plain containers (often wrapped in <span>s) and in long
    // control labels. Bare filenames/paths, 1-word chrome badges and short button labels are left alone.
    const LOOSE = generic ? `div,pre,section,article,main,header,footer,aside,nav,form,fieldset,details,figure,${CONTROLS}`
      : scope === 'workbench' ? `div,section,article,main,header,footer,aside,nav,form,fieldset,details,figure,${WB_CONTROLS}` : 'div';
    function looseBlock(el) {
      if (!el.matches(LOOSE)) return false;
      if (!hasLoose) {
        return !el.parentElement?.closest(BLOCKS) && [...el.childNodes].some(node => node.nodeType === 3 && /\p{L}{2}/u.test(node.data));
      }
      if (el.matches('pre') && !prosePre(el)) return false;
      const { text } = structure(el);
      if (!/\p{L}{2}/u.test(text)) return false;
      if (generic) {
        return !el.matches(CONTROLS) || (text.match(/[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]|[\p{L}\p{N}'’-]+/gu) || []).length >= 3;
      }
      const words = text.match(/[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]|\S*\p{L}\S*/gu) || [];
      return words.length >= (el.matches(WB_CONTROLS) ? 5 : 2);
    }
    function blockOf(element) {
      if (hasLoose) {
        const any = `${BLOCKS},${LOOSE}`;
        for (let el = element?.closest?.(any); el; el = el.parentElement?.closest(any)) {
          if ((el.matches(BLOCKS) && (scope !== 'workbench' || /\p{L}/u.test(structure(el).text))) || looseBlock(el)) return el;
        }
        return null;
      }
      const block = element?.closest?.(BLOCKS);
      if (block) return block;
      for (let el = element?.closest?.('div'); el; el = el.parentElement?.closest('div')) if (looseBlock(el)) return el;
      return null;
    }
    const blockAt = element => {
      const block = blockOf(element);
      return block && inContent(block) ? block : null;
    };
    const transOf = block => [...block.children].find(child => child.classList.contains('imt-trans'));
    const translated = block => !!transOf(block) || placed.has(block) || jobs.has(block) || block.classList.contains('imt-only');
    function removeTranslation(block) {
      jobs.get(block)?.controller.abort();
      jobs.delete(block);
      transOf(block)?.remove();
      restore(block);
      delete block.dataset.imtSrc;
      showOriginal(block);
    }
    // While a translation-only paragraph streams in, CSS hides its inline content; when it completes, place()
    // rebuilds it in place. Turning translation off restores the original nodes exactly.
    function hideOriginal(block) {
      if (block.classList.contains('imt-only')) return;
      const style = win.getComputedStyle(block);
      block.style.setProperty('--imt-fs', style.fontSize);
      block.style.setProperty('--imt-lh', style.lineHeight);
      block.classList.add('imt-only');
    }
    function showOriginal(block) {
      block.classList.remove('imt-only');
      block.style.removeProperty('--imt-fs');
      block.style.removeProperty('--imt-lh');
    }
    // Sentences, never cut inside a tagged span, so each request keeps its tags paired.
    function sentences(text, rich) {
      if (!rich) return text.match(/[^.!?]+[.!?]*\s*/g) || [text];
      const out = [];
      let depth = 0;
      let start = 0;
      for (const match of text.matchAll(new RegExp(`${TAG.source}|[.!?]\\s+`, 'gi'))) {
        if (match[2]) { if (!match[4]) depth += match[1] ? -1 : 1; continue; }
        if (depth > 0) continue;
        out.push(text.slice(start, match.index + match[0].length));
        start = match.index + match[0].length;
      }
      if (start < text.length) out.push(text.slice(start));
      return out;
    }
    function chunks(text, rich) {
      if (text.length <= 1000) return [text];
      const out = [];
      let current = '';
      for (const sentence of sentences(text, rich)) {
        for (let i = 0; i < sentence.length; i += 1000) {
          const piece = sentence.slice(i, i + 1000);
          if (current && (current + piece).length > 1000) { out.push(current); current = ''; }
          current += piece;
        }
      }
      if (current.trim()) out.push(current);
      return out;
    }
    function enqueue(block, priority, only = false, owner = null) {
      if (jobs.has(block) || !inContent(block)) return;
      if (placed.has(block)) {
        if (ownText(block) === placed.get(block).out) return;
        // The page re-rendered this paragraph: translate its new content.
        placed.delete(block);
        delete block.dataset.imtPlaced;
      }
      const s = structure(block);
      if (transOf(block)) {
        if (block.dataset.imtSrc === s.plain) return;
        removeTranslation(block);
      }
      if (!translatable(block)) return;
      const span = doc.createElement('span');
      span.className = 'imt-trans imt-loading';
      span.lang = settings.targetLanguage || 'zh-CN';
      span.textContent = t('translating');
      span.addEventListener('click', event => forwardClick(event, span));
      block.insertBefore(span, s.inline[s.inline.length - 1]?.nextSibling || null);
      block.dataset.imtSrc = s.plain;
      if (owner) owner.blocks.add(block);
      const paneRoot = owner?.root || regionOf(block)?.root || null;
      const controller = new AbortController();
      jobs.set(block, { controller, paneRoot, owner });
      queue[priority ? 'unshift' : 'push']({ block, span, text: s.rich ? s.markup : s.text, rich: s.rich, controller, only, paneRoot, owner });
      pump();
    }
    const isJobValid = ({ block, controller, owner }) => {
      if (controller.signal.aborted || disabled || !block.isConnected) return false;
      if (owner) return fullPanes.get(owner.root) === owner && owner.root.isConnected && owner.root.contains(block) && surfaceOn(owner.key);
      return !!regionOf(block);
    };
    function pump() {
      while (running < 3 && queue.length) {
        const job = queue.shift();
        if (job.controller.signal.aborted) continue;
        if (!isJobValid(job)) {
          if (job.owner && !job.owner.root.isConnected) setFullMode(job.owner.root, job.owner.key, false, true);
          else {
            removeTranslation(job.block);
            delete job.block.dataset.imtSeen;
          }
          continue;
        }
        running++;
        runJob(job).finally(() => { running--; pump(); });
      }
    }
    async function runJob(job) {
      const { block, span, text, rich, controller, only } = job;
      let done = '';
      const show = value => { span.textContent = rich ? streamed(value) : value; };
      const cancelStale = () => {
        if (!controller.signal.aborted) {
          removeTranslation(block);
          delete block.dataset.imtSeen;
        }
      };
      try {
        for (const part of chunks(text, rich)) {
          for (let attempt = 0; ; attempt++) {
            if (!isJobValid(job)) { cancelStale(); return; }
            let partial = '';
            try {
              const data = await streamAI(part, controller.signal, delta => {
                if (!isJobValid(job)) { cancelStale(); return; }
                partial += delta;
                span.classList.remove('imt-loading');
                show(done + partial);
                if (only) hideOriginal(block);
              }, rich ? 'markup' : 'paragraph');
              done += data.translation;
              break;
            } catch (error) {
              // The extension caps concurrent model calls; back off briefly instead of failing the paragraph.
              if (controller.signal.aborted || attempt >= 3 || !/concurren|上限|gleichzeitig/i.test(error.message)) throw error;
              await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
            }
          }
          if (!isJobValid(job)) { cancelStale(); return; }
          show(done);
        }
        if (!isJobValid(job)) { cancelStale(); return; }
        span.classList.remove('imt-loading');
        if (only && place(block, span, done, text, rich)) return;
        // Bilingual, or a translation whose tags could not be matched safely: the original stays visible.
        showOriginal(block);
        render(block, span, done, text, rich);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!isJobValid(job)) { cancelStale(); return; }
        span.classList.remove('imt-loading');
        showOriginal(block);
        span.textContent = t('paraFailed', error.message);
      } finally {
        if (jobs.get(block)?.controller === controller) jobs.delete(block);
      }
    }
    const paneEntryFor = block => {
      const region = regionOf(block);
      return region ? fullPanes.get(region.root) || null : null;
    };
    const fullFor = block => !!paneEntryFor(block);
    // Chat answers stream in; wait until a paragraph stops changing before spending a model call on it.
    function settle(block) {
      const entry = paneEntryFor(block);
      if (!entry) return;
      entry.blocks.add(block);
      if (entry.key !== 'chat') return enqueue(block, false, entry.only, entry);
      clearTimeout(settling.get(block));
      const snapshot = ownText(block);
      const timer = setTimeout(() => {
        if (settling.get(block) !== timer) return;
        settling.delete(block);
        const current = paneEntryFor(block);
        if (!current || current !== entry || !block.isConnected) {
          if (!jobs.has(block) && !translated(block)) {
            delete block.dataset.imtSeen;
            if (current && block.isConnected && visibility) {
              block.dataset.imtSeen = '1';
              visibility.observe(block);
            }
          }
          return;
        }
        if (ownText(block) === snapshot) enqueue(block, false, current.only, current); else settle(block);
      }, 1200);
      settling.set(block, timer);
    }
    function pruneDisconnectedPanes() {
      if (lastPane && !lastPane.root.isConnected) lastPane = null;
      for (const [root, entry] of [...fullPanes]) {
        if (!root.isConnected) setFullMode(root, entry.key, false, true);
      }
    }
    function candidates() {
      const roots = [...fullPanes.keys()].filter(root => root.isConnected);
      const blocks = roots.flatMap(root => [
        ...(root.matches(BLOCKS) || looseBlock(root) ? [root] : []),
        ...root.querySelectorAll(BLOCKS),
        ...[...root.querySelectorAll(LOOSE)].filter(looseBlock)
      ]);
      return [...new Set(blocks)].filter(block => inContent(block) && fullFor(block));
    }
    function observeAll() {
      rescanTimer = 0;
      pruneDisconnectedPanes();
      if (!fullPanes.size) return;
      for (const block of candidates()) {
        const entry = paneEntryFor(block);
        if (!entry) continue;
        entry.blocks.add(block);
        if (block.dataset.imtSeen) {
          if (jobs.has(block)) continue;
          if (transOf(block) && block.dataset.imtSrc !== ownText(block)) settle(block);
          else if (placed.has(block) && placed.get(block).out !== ownText(block)) settle(block);
          continue;
        }
        block.dataset.imtSeen = '1';
        visibility.observe(block);
      }
    }
    function clearTranslations(paneRoot, tracked) {
      const selector = '[data-imt-seen],[data-imt-src],[data-imt-placed],.imt-only';
      const nodes = new Set(paneRoot
        ? [...(paneRoot.matches(selector) ? [paneRoot] : []), ...paneRoot.querySelectorAll(selector)]
        : doc.querySelectorAll(selector));
      if (tracked) for (const block of tracked) nodes.add(block);
      for (const block of nodes) {
        visibility?.unobserve(block);
        clearTimeout(settling.get(block));
        settling.delete(block);
        removeTranslation(block);
        delete block.dataset.imtSeen;
      }
    }
    function setFullMode(paneRoot, surface, on, silent = false) {
      if (on) {
        const only = settings.fullPageMode !== 'bilingual';
        fullPanes.set(paneRoot, { root: paneRoot, key: surface, only, blocks: new Set() });
        if (!visibility) {
          visibility = new IntersectionObserver(entries => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              visibility.unobserve(entry.target);
              if (fullFor(entry.target)) settle(entry.target);
              else if (!entry.target.isConnected && !jobs.has(entry.target) && !translated(entry.target)) delete entry.target.dataset.imtSeen;
            }
          }, { rootMargin: '400px 0px' });
          mutations = new MutationObserver(() => {
            if (!rescanTimer) rescanTimer = setTimeout(observeAll, 500);
          });
          mutations.observe(doc.body, { childList: true, subtree: true, characterData: true });
        }
        observeAll();
        if (!silent) toast(t('fullOn', only ? t('modeOnly') : t('modeBilingual'), settings.shortcuts.fullPage || ''));
      } else {
        const entry = fullPanes.get(paneRoot);
        fullPanes.delete(paneRoot);
        if (lastPane?.root === paneRoot && !paneRoot.isConnected) lastPane = null;
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].paneRoot === paneRoot || paneRoot.contains(queue[i].block)) {
            const [item] = queue.splice(i, 1);
            removeTranslation(item.block);
            delete item.block.dataset.imtSeen;
          }
        }
        for (const [block, job] of [...jobs]) {
          if (job.paneRoot === paneRoot || paneRoot.contains(block)) {
            removeTranslation(block);
            delete block.dataset.imtSeen;
          }
        }
        clearTranslations(paneRoot, entry?.blocks);
        entry?.blocks.clear();
        if (!fullPanes.size) {
          visibility?.disconnect();
          mutations?.disconnect();
          visibility = mutations = undefined;
          clearTimeout(rescanTimer);
          rescanTimer = 0;
        }
        if (!silent) toast(t('fullOff'));
      }
    }
    // When a surface is switched off in settings, drop its translations and its full-page mode.
    let lastEngine = engineIdentity();
    statusListeners.push(() => {
      const currentEngine = engineIdentity();
      if (currentEngine !== lastEngine) {
        lastEngine = currentEngine;
        hide();
        for (const [root, entry] of [...fullPanes]) setFullMode(root, entry.key, false);
        for (const block of [...jobs.keys()]) removeTranslation(block);
        queue.length = 0;
        clearTranslations();
        applyLabels();
      }
      pruneDisconnectedPanes();
      for (const [root, entry] of [...fullPanes]) {
        if (!surfaceOn(entry.key)) setFullMode(root, entry.key, false);
      }
      if (disabled) hide();
    });
    // Registered on the window in the capture phase so they run before VS Code's own workbench handlers.
    const track = event => { pointerX = event.clientX; pointerY = event.clientY; };
    win.addEventListener('pointermove', track, { passive: true, capture: true });
    win.addEventListener('pointerdown', track, { passive: true, capture: true });
    // Floating / window-level command UI always retains the last real content pane rather than targeting itself.
    const EXTERNAL_COMMAND_UI = '.context-view,.monaco-menu,.monaco-menu-container,.menubar,' +
      '.command-center,.part.titlebar,.part.activitybar,.part.statusbar,' +
      '.monaco-sash,.imt-panel,.imt-dot,[role="menu"],[role="menubar"]';
    // Toolbars and action bars act as external command UI only when outside any real content pane
    // (e.g., editor-group or pane-header actions); clicking a toolbar inside a content pane selects that pane.
    const TOOLBAR_UI = '.monaco-toolbar,.monaco-action-bar,.editor-actions,.title-actions,.tab-actions,' +
      '.chat-input-toolbars,.chat-secondary-toolbar,[role="toolbar"]';
    const PANE_WRAPPER = '.editor-group-container,.editor-instance,.pane,.pane-body,.chat-viewpane,.chat-viewpane-container';
    const PANE_ANCESTOR = `.editor-container,${PANE_WRAPPER}`;
    // Surfaces whose embedded .monaco-editor is a pane-owned input/search widget rather than a raw code editor.
    const INPUT_EDITOR_SURFACES = new Set(['chat', 'settings']);
    function isRawCodeEditor(element) {
      const editor = element?.closest?.('.monaco-editor');
      if (!editor) return false;
      const region = rawRegionOf(editor);
      return !(region && INPUT_EDITOR_SURFACES.has(region.key));
    }
    function isCommandUI(element) {
      if (!element?.closest) return false;
      const rawEditor = isRawCodeEditor(element);
      const region = rawEditor ? null : rawRegionOf(element);
      const ext = element.closest(EXTERNAL_COMMAND_UI);
      if (ext && !(region && ext.contains(region.root) && ext !== region.root)) return true;
      const quick = element.closest('.quick-input-widget');
      if (quick && !(region && quick.contains(region.root) && quick !== region.root) && !element.closest('.interactive-session')) return true;
      if (!element.closest(TOOLBAR_UI)) return false;
      if (rawEditor) return false;
      return !region;
    }
    function isVisibleElement(element) {
      if (!element?.isConnected) return false;
      const computed = win.getComputedStyle(element);
      if (computed.display === 'none' || computed.visibility === 'hidden') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    }
    // Resolves a clicked or focused element to its specific content pane root, or null for non-translatable panes.
    function paneOf(element) {
      if (!element?.closest) return null;
      if (scope !== 'workbench') return { key: scope, root: doc.body };
      // A raw code editor (standalone or embedded, e.g. customizations raw file editing) keeps normal editor keys.
      if (isRawCodeEditor(element)) return null;
      const direct = rawRegionOf(element);
      if (direct) return { key: direct.key, root: direct.root };
      // Bare padding, group focus, or editor tab / pane header clicks inside a pane wrapper resolve to its sole
      // visible supported region, excluding standalone code editors, terminals, trees/lists, inputs and webview iframes.
      if (element.closest('.monaco-editor,.xterm,.monaco-list,.monaco-tree,iframe,input,textarea,select')) return null;
      const wrapper = element.closest(PANE_WRAPPER);
      if (!wrapper) return null;
      if ([...wrapper.querySelectorAll('.monaco-editor,iframe,.xterm')].some(el => !rawRegionOf(el) && isVisibleElement(el))) return null;
      const roots = [];
      for (const [key, container] of REGIONS) {
        for (const el of wrapper.querySelectorAll(container)) {
          const root = outermost(el, container);
          if (root && wrapper.contains(root) && isVisibleElement(root) && !roots.some(item => item.root === root)) {
            roots.push({ key, root });
          }
        }
      }
      return roots.length === 1 ? roots[0] : null;
    }
    const recordPointerPane = event => {
      if (scope !== 'workbench') return;
      if (event.button !== undefined && event.button !== 0 && event.button !== 2) return;
      const target = elementAt(event.target);
      if (!target || isCommandUI(target)) return;
      if (target.tagName === 'IFRAME') { lastPane = null; return; }
      const pane = paneOf(target);
      if (pane) {
        lastPane = pane;
        lastPanePressAt = Date.now();
      } else {
        lastPane = null;
      }
    };
    const recordFocusPane = event => {
      if (scope !== 'workbench') return;
      const target = elementAt(event.target);
      const related = elementAt(event.relatedTarget);
      if (target?.tagName === 'IFRAME') { lastPane = null; return; }
      if (!target || target === doc.body || target === doc.documentElement) return;
      if (isCommandUI(target)) {
        // Leaving a webview iframe into command UI must not revive a stale workbench pane.
        if (related?.tagName === 'IFRAME') lastPane = null;
        return;
      }
      const pane = paneOf(target);
      if (pane) {
        lastPane = pane;
        return;
      }
      // Clicking non-focusable prose inside a pane often moves focus to its ancestor container
      // (e.g. .editor-group-container or .pane); preserve the clicked pane instead of clearing it.
      if (lastPane?.root?.isConnected && target.contains(lastPane.root) &&
          (Date.now() - lastPanePressAt < 250 || target.matches(PANE_ANCESTOR))) {
        return;
      }
      lastPane = null;
    };
    if (scope === 'workbench') {
      win.addEventListener('pointerdown', recordPointerPane, { passive: true, capture: true });
      win.addEventListener('mousedown', recordPointerPane, { passive: true, capture: true });
      win.addEventListener('focusin', recordFocusPane, { passive: true, capture: true });
      win.addEventListener('focusout', event => {
        if (elementAt(event.target)?.tagName === 'IFRAME' && Date.now() - lastPanePressAt >= 250) lastPane = null;
      }, { passive: true, capture: true });
      win.addEventListener('blur', () => {
        if (doc.activeElement?.tagName === 'IFRAME') lastPane = null;
        setTimeout(() => { if (doc.activeElement?.tagName === 'IFRAME') lastPane = null; }, 0);
      });
    }
    // The specific content pane the user is working in: the most recently clicked/focused one (retained across
    // external command UI), never another editor group, sidebar, code editor, webview or detached pane.
    function activePane(event) {
      if (scope !== 'workbench') return surfaceOn(scope) ? { key: scope, root: doc.body } : null;
      if (event?.target?.tagName === 'IFRAME' || doc.activeElement?.tagName === 'IFRAME') return null;
      const focus = doc.activeElement;
      const focusedIsCommandUI = !!(focus && focus !== doc.body && isCommandUI(focus));
      if (focus && !focusedIsCommandUI && isRawCodeEditor(focus)) return null;
      if (lastPane && !lastPane.root.isConnected) lastPane = null;
      if (lastPane) return surfaceOn(lastPane.key) ? lastPane : null;
      if (lastPane === null) return null;
      const focused = focus && focus !== doc.body && !focusedIsCommandUI ? paneOf(focus) : null;
      if (focused) return surfaceOn(focused.key) ? focused : null;
      if (focusedIsCommandUI) return null;
      const target = hovered();
      const over = target && !isCommandUI(target) ? paneOf(target) : null;
      return over && surfaceOn(over.key) ? over : null;
    }
    win.addEventListener('keydown', event => {
      if (disabled || event.repeat) return;
      if (generic && doc.activeElement?.closest(EDITABLE)) return;
      if (pressed(event, settings.shortcuts.paragraph)) {
        // Toggle the paragraph under the mouse. Elsewhere, leave the key to VS Code (Alt+Z = Toggle Word Wrap).
        const target = hovered();
        const block = blockAt(target);
        if (!block) {
          if (regionOf(target) || (scope === 'workbench' && target?.closest?.(CHAT_SURFACE) && surfaceOn('chat'))) toast(t('noParagraph'));
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (translated(block)) removeTranslation(block);
        else if (translatable(block)) { enqueue(block, true); shortcutUsed(); }
        else toast(t('noNeed'));
        return;
      }
      if (!pressed(event, settings.shortcuts.fullPage)) return;
      // Only when the user is working in a supported content pane; never steal the key from a text editor or webview.
      const pane = activePane(event);
      if (!pane) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const on = !fullPanes.has(pane.root);
      if (on) shortcutUsed();
      setFullMode(pane.root, pane.key, on);
    }, true);
  }

  function scan() {
    if (!attached.has(document)) attach(document, scopeFor(document));
    // The privileged webview preload can access its same-origin content frame,
    // including Release Notes whose content CSP does not permit extra scripts.
    const frame = document.getElementById('active-frame');
    if (frame?.contentDocument && !attached.has(frame.contentDocument)) {
      attach(frame.contentDocument, scopeFor(frame.contentDocument));
    }
  }
  function refreshStatus() {
    return request('/status').then(data => {
      applyStatus(data);
      for (const listener of statusListeners) listener();
    }).catch(error => {
      disabled = true;
      for (const listener of statusListeners) listener();
      console.error('[Translate Anywhere] Extension bridge unavailable:', error.message);
    });
  }
  function start() {
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scan, 1500);
    refreshStatus();
    // Settings changes (language, shortcuts, surfaces) apply within seconds, and immediately on focus.
    setInterval(refreshStatus, 10000);
    window.addEventListener('focus', refreshStatus);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
if (typeof module !== 'undefined') module.exports = immersiveUI;
