/* This function is serialized into the workbench and webview preload. */
function immersiveUI(config) {
  'use strict';
  if (window.__immersiveTranslateInstalled) return;
  window.__immersiveTranslateInstalled = true;
  const attached = new WeakSet();
  const cache = new Map();
  let disabled = false;
  const NESTED_CSS = 'p,ul,ol,pre,table,blockquote,div,dl,h1,h2,h3,h4,h5,h6';
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
    if (config.version && data.version && data.version !== config.version && !staleWarned) {
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
  function scopeFor(doc) {
    if (doc.querySelector('#vscode-markdown-preview-data')) return 'markdownPreview';
    if (doc.querySelector('#release-notes-tokenization')) return 'releaseNotes';
    // Built-in extension details webviews (README / changelog) share this scroll button template.
    if (doc !== document && doc.querySelector('body > #scroll-to-top')) return 'extensionPages';
    // Welcome walkthrough steps render their Markdown in a webview wrapped in this custom element.
    if (doc !== document && doc.querySelector('body > vertically-centered')) return 'welcome';
    if (doc === document && location.protocol === 'vscode-file:') return 'workbench';
    return null;
  }
  // [surface, where selection is allowed, where paragraph / full-page translation applies].
  // The list mirrors the workbench CSS rules that opt into `user-select: text` (VS Code 1.144); text editors,
  // inputs and editor-attached widgets stay excluded by eligible() / SKIP.
  const CHAT_EXTRA = '.chat-question-carousel-container,.chat-confirmation-widget-message,.chat-input-notification-widget';
  const WORKBENCH_UI = '.notifications-toasts,.notifications-center,.monaco-dialog-box,.workbench-hover-container,' +
    '.monaco-hover,.workspace-trust-editor,.tree-explorer-viewlet-tree-view .message,.search-view .message,' +
    '.ai-customization-management-editor,.monaco-editor-pane-placeholder,.browser-error-content';
  const REGIONS = [
    // The whole Chat view: answers, the question box (ask-user carousel), tool confirmations and input notices.
    ['chat', '.interactive-session', `.interactive-item-container .rendered-markdown,${CHAT_EXTRA}`],
    ['settings', '.settings-editor,.keybindings-editor', '.settings-editor,.keybindings-editor'],
    ['extensionPages', '.extension-editor', '.extension-editor > .header'],
    ['welcome', '.gettingStartedContainer', '.gettingStartedContainer'],
    ['workbenchUI', WORKBENCH_UI, WORKBENCH_UI]
  ];
  const surfaceOn = key => !disabled && settings.surfaces?.[key] !== false;

  function attach(doc, scope) {
    if (!scope || attached.has(doc) || !doc.body) return;
    attached.add(doc);
    // Timers and observers always come from this runtime's realm: extension README/changelog webviews are
    // sandboxed without allow-scripts, and callbacks scheduled on such a frame's window never run.
    const win = doc.defaultView;
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
      .imt-only{font-size:0!important;line-height:0!important}
      .imt-only::marker{font-size:var(--imt-fs)!important}
      .imt-only>:not(.imt-trans):not(:is(${NESTED_CSS})){display:none!important}
      .imt-only>.imt-trans,.imt-only>:is(${NESTED_CSS}){font-size:var(--imt-fs)!important;line-height:var(--imt-lh)!important}
      .imt-only>.imt-trans{display:inline!important;margin:0!important;opacity:1!important;font-weight:inherit!important}
      .imt-toast{position:fixed!important;left:50%!important;bottom:24px!important;transform:translateX(-50%)!important;padding:6px 14px!important;border-radius:6px!important;background:var(--vscode-editorWidget-background,#252526)!important;color:var(--vscode-editorWidget-foreground,#eee)!important;border:1px solid var(--vscode-widget-border,#777)!important;z-index:2147483647!important;font:13px/1.5 var(--vscode-font-family,system-ui)!important;pointer-events:none!important}
    `;
    doc.head.appendChild(style);
    // Which surface (and which container instance) an element belongs to; null when not translatable here.
    function regionOf(element) {
      if (!element?.closest) return null;
      if (scope !== 'workbench') return surfaceOn(scope) ? { key: scope, root: doc.body, content: doc.body } : null;
      for (const [key, container, content] of REGIONS) {
        const root = element.closest(container);
        if (root) return surfaceOn(key) ? { key, root, content: element.closest(content) } : null;
      }
      return null;
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
    function eligible(element) {
      if (!element || element.closest('.imt-panel,.imt-dot,input,textarea,select,[contenteditable="true"],.monaco-editor')) return false;
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
    const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dt,dd' + (scope === 'workbench'
      ? ',.setting-item-markdown,.setting-item-enumDescription,.setting-item-deprecation-message,.step-description-container,.extension-editor .description' +
        ',.chat-question-title,.chat-question-carousel-message,.chat-question-description,.chat-question-detailed-message' +
        ',.chat-confirmation-widget-message,.chat-input-notification-title,.chat-input-notification-description' +
        ',.notification-list-item-message,.dialog-message-text,.dialog-message-detail,.workspace-trust-description' +
        ',.tree-explorer-viewlet-tree-view .message,.search-view .message,.editor-placeholder-label-container'
      : '');
    const SKIP = 'pre,script,style,.imt-panel,.imt-dot,.imt-trans,.monaco-editor,input,textarea,select,[contenteditable="true"]';
    const jobs = new Map();
    const queue = [];
    const settling = new WeakMap();
    let running = 0;
    // Full-page translation is toggled per surface (e.g. Chat and Settings independently in the workbench).
    const fullSurfaces = new Set();
    let fullOnly = true;
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
    function inContent(element) {
      if (!element?.closest || element.closest(SKIP)) return false;
      const region = regionOf(element);
      return !!region?.content;
    }
    function ownText(block) {
      const clone = block.cloneNode(true);
      for (const nested of clone.querySelectorAll(`${BLOCKS},pre,ul,ol,table,.imt-trans,script,style`)) nested.remove();
      return clone.textContent.replace(/\s+/g, ' ').trim();
    }
    function translatable(block) {
      const text = ownText(block);
      return text.length >= 2 && /\p{L}{2}/u.test(text) && !inTarget(text);
    }
    const blockAt = element => {
      const block = element?.closest?.(BLOCKS);
      return block && inContent(block) ? block : null;
    };
    const transOf = block => [...block.children].find(child => child.classList.contains('imt-trans'));
    function removeTranslation(block) {
      jobs.get(block)?.abort();
      jobs.delete(block);
      transOf(block)?.remove();
      delete block.dataset.imtSrc;
      showOriginal(block);
    }
    // Translation-only mode hides the paragraph's own inline content (nested blocks stay visible)
    // with CSS instead of rewriting VS Code's DOM, so turning it off restores the page exactly.
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
    function chunks(text) {
      if (text.length <= 1000) return [text];
      const out = [];
      let current = '';
      for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) || [text]) {
        for (let i = 0; i < sentence.length; i += 1000) {
          const piece = sentence.slice(i, i + 1000);
          if (current && (current + piece).length > 1000) { out.push(current); current = ''; }
          current += piece;
        }
      }
      if (current.trim()) out.push(current);
      return out;
    }
    function enqueue(block, priority, only = false) {
      if (jobs.has(block) || !inContent(block)) return;
      const text = ownText(block);
      if (transOf(block)) {
        if (block.dataset.imtSrc === text) return;
        removeTranslation(block);
      }
      if (!translatable(block)) return;
      const span = doc.createElement('span');
      span.className = 'imt-trans imt-loading';
      span.lang = settings.targetLanguage || 'zh-CN';
      span.textContent = t('translating');
      const nested = [...block.children].find(child => child.matches(`${BLOCKS},pre,ul,ol,table`));
      block.insertBefore(span, nested || null);
      block.dataset.imtSrc = text;
      const controller = new AbortController();
      jobs.set(block, controller);
      queue[priority ? 'unshift' : 'push']({ block, span, text, controller, only });
      pump();
    }
    function pump() {
      while (running < 3 && queue.length) {
        const job = queue.shift();
        if (job.controller.signal.aborted) continue;
        running++;
        runJob(job).finally(() => { running--; pump(); });
      }
    }
    async function runJob({ block, span, text, controller, only }) {
      let done = '';
      try {
        for (const part of chunks(text)) {
          for (let attempt = 0; ; attempt++) {
            let partial = '';
            try {
              const data = await streamAI(part, controller.signal, delta => {
                partial += delta;
                span.classList.remove('imt-loading');
                span.textContent = done + partial;
                if (only) hideOriginal(block);
              }, 'paragraph');
              done += data.translation;
              break;
            } catch (error) {
              // The extension caps concurrent model calls; back off briefly instead of failing the paragraph.
              if (controller.signal.aborted || attempt >= 3 || !/concurren|上限|gleichzeitig/i.test(error.message)) throw error;
              await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
            }
          }
          span.textContent = done;
        }
        span.classList.remove('imt-loading');
        if (only) hideOriginal(block);
      } catch (error) {
        if (controller.signal.aborted) return;
        span.classList.remove('imt-loading');
        showOriginal(block);
        span.textContent = t('paraFailed', error.message);
      } finally {
        if (jobs.get(block) === controller) jobs.delete(block);
      }
    }
    const surfaceOfBlock = block => regionOf(block)?.key;
    const fullFor = block => fullSurfaces.has(surfaceOfBlock(block));
    // Chat answers stream in; wait until a paragraph stops changing before spending a model call on it.
    function settle(block) {
      if (surfaceOfBlock(block) !== 'chat') return enqueue(block, false, fullOnly);
      clearTimeout(settling.get(block));
      const snapshot = ownText(block);
      settling.set(block, setTimeout(() => {
        if (!fullFor(block) || !block.isConnected) return;
        if (ownText(block) === snapshot) enqueue(block, false, fullOnly); else settle(block);
      }, 1200));
    }
    function candidates() {
      const roots = scope === 'workbench'
        ? REGIONS.filter(([key]) => fullSurfaces.has(key)).flatMap(([, , content]) => [...doc.querySelectorAll(content)])
        : [doc.body];
      return roots.flatMap(root => [...root.querySelectorAll(BLOCKS)]).filter(block => inContent(block) && fullFor(block));
    }
    function observeAll() {
      rescanTimer = 0;
      if (!fullSurfaces.size) return;
      for (const block of candidates()) {
        if (block.dataset.imtSeen) {
          if (transOf(block) && !jobs.has(block) && block.dataset.imtSrc !== ownText(block)) settle(block);
          continue;
        }
        block.dataset.imtSeen = '1';
        visibility.observe(block);
      }
    }
    function clearTranslations(surface) {
      for (const block of doc.querySelectorAll('[data-imt-seen],[data-imt-src],.imt-only')) {
        const key = surfaceOfBlock(block);
        if (surface && key && key !== surface) continue;
        visibility?.unobserve(block);
        removeTranslation(block);
        delete block.dataset.imtSeen;
      }
    }
    function setFullMode(surface, on) {
      if (on) {
        fullOnly = settings.fullPageMode !== 'bilingual';
        fullSurfaces.add(surface);
        if (!visibility) {
          visibility = new IntersectionObserver(entries => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              visibility.unobserve(entry.target);
              if (fullFor(entry.target)) settle(entry.target);
            }
          }, { rootMargin: '400px 0px' });
          mutations = new MutationObserver(() => {
            if (!rescanTimer) rescanTimer = setTimeout(observeAll, 500);
          });
          mutations.observe(doc.body, { childList: true, subtree: true, characterData: true });
        }
        observeAll();
        toast(t('fullOn', fullOnly ? t('modeOnly') : t('modeBilingual'), settings.shortcuts.fullPage || ''));
      } else {
        fullSurfaces.delete(surface);
        for (let i = queue.length - 1; i >= 0; i--) if (surfaceOfBlock(queue[i].block) === surface) queue.splice(i, 1);
        clearTranslations(surface);
        if (!fullSurfaces.size) {
          visibility?.disconnect();
          mutations?.disconnect();
          visibility = mutations = undefined;
          clearTimeout(rescanTimer);
          rescanTimer = 0;
        }
        toast(t('fullOff'));
      }
    }
    // When a surface is switched off in settings, drop its translations and its full-page mode.
    let lastEngine = engineIdentity();
    statusListeners.push(() => {
      const currentEngine = engineIdentity();
      if (currentEngine !== lastEngine) {
        lastEngine = currentEngine;
        hide();
        for (const key of [...fullSurfaces]) setFullMode(key, false);
        for (const controller of jobs.values()) controller.abort();
        queue.length = 0;
        clearTranslations();
        applyLabels();
      }
      for (const key of [...fullSurfaces]) if (!surfaceOn(key)) setFullMode(key, false);
      if (disabled) hide();
    });
    // Registered on the window in the capture phase so they run before VS Code's own workbench handlers.
    const track = event => { pointerX = event.clientX; pointerY = event.clientY; };
    win.addEventListener('pointermove', track, { passive: true, capture: true });
    win.addEventListener('pointerdown', track, { passive: true, capture: true });
    // The surface the user is working in: the focused one, else the hovered one unless typing in an editor.
    function activeSurface() {
      if (scope !== 'workbench') return surfaceOn(scope) ? scope : null;
      const focus = doc.activeElement;
      // The Chat input is a code editor too, but the page shortcut there clearly means "the Chat view".
      if (focus?.closest?.('.interactive-session') && surfaceOn('chat')) return 'chat';
      const focused = focus && focus !== doc.body ? regionOf(focus) : null;
      if (focused) return focused.key;
      if (focus?.closest?.('.monaco-editor')) return null;
      const target = hovered();
      if (target?.closest?.('.interactive-session') && surfaceOn('chat')) return 'chat';
      return regionOf(target)?.key || null;
    }
    win.addEventListener('keydown', event => {
      if (disabled || event.repeat) return;
      if (pressed(event, settings.shortcuts.paragraph)) {
        // Toggle the paragraph under the mouse. Elsewhere, leave the key to VS Code (Alt+Z = Toggle Word Wrap).
        const target = hovered();
        const block = blockAt(target);
        if (!block) {
          if (regionOf(target) || (scope === 'workbench' && target?.closest?.('.interactive-session'))) toast(t('noParagraph'));
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (transOf(block) || jobs.has(block) || block.classList.contains('imt-only')) removeTranslation(block);
        else if (translatable(block)) { enqueue(block, true); shortcutUsed(); }
        else toast(t('noNeed'));
        return;
      }
      if (!pressed(event, settings.shortcuts.fullPage)) return;
      // Only when the user is working in a supported surface; never steal the key from a text editor.
      const surface = activeSurface();
      if (!surface) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!fullSurfaces.has(surface)) shortcutUsed();
      setFullMode(surface, !fullSurfaces.has(surface));
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
