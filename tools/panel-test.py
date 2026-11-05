"""Headless check of the sidebar webview (src/panel.js): renders under its CSP, reflects state and posts the right messages.

Usage: py -3.13 tools/panel-test.py [--screenshot OUT.png] [--zh | --de]
"""
import json
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

DUMP = r"""
const m = require('module'); const load = m._load;
m._load = (r, ...a) => r === 'vscode' ? {} : load(r, ...a);
const { SettingsPanel, STRINGS } = require(process.argv[1]);
process.stdout.write(SettingsPanel.prototype.html.call({}, STRINGS[process.argv[2]]));
"""

# A VS Code-like dark theme so the page renders as it does in the sidebar.
THEME = """
--vscode-font-family: 'Segoe UI', sans-serif; --vscode-font-size: 13px;
--vscode-foreground: #cccccc; --vscode-descriptionForeground: #9d9d9d; --vscode-errorForeground: #f85149;
--vscode-sideBar-background: #181818; --vscode-input-background: #313131; --vscode-input-foreground: #cccccc;
--vscode-input-border: #3c3c3c; --vscode-dropdown-background: #313131; --vscode-dropdown-foreground: #cccccc;
--vscode-dropdown-border: #3c3c3c; --vscode-button-background: #0078d4; --vscode-button-foreground: #ffffff;
--vscode-button-hoverBackground: #026ec1; --vscode-button-secondaryBackground: #313131;
--vscode-button-secondaryForeground: #cccccc; --vscode-button-secondaryHoverBackground: #3c3c3c;
--vscode-focusBorder: #0078d4; --vscode-textLink-foreground: #4daafc; --vscode-checkbox-background: #313131;
--vscode-checkbox-border: #3c3c3c; --vscode-sideBarSectionHeader-border: #2b2b2b; --vscode-panel-border: #2b2b2b;
--vscode-testing-iconPassed: #73c991; --vscode-charts-green: #89d185;
"""

INIT = """
window.__posted = [];
window.acquireVsCodeApi = () => ({ postMessage: m => window.__posted.push(m), getState() {}, setState() {} });
document.addEventListener('DOMContentLoaded', () => {
  // VS Code injects theme variables through CSSOM, which the panel CSP allows (unlike a style attribute).
  for (const decl of %s.split(';')) {
    const at = decl.indexOf(':');
    if (at > 0) document.documentElement.style.setProperty(decl.slice(0, at).trim(), decl.slice(at + 1).trim());
  }
  document.body.style.setProperty('background', 'var(--vscode-sideBar-background)');
});
""" % json.dumps(THEME)


def state(provider="vscode", lang="en"):
    from_providers = subprocess.run([node(), "-e", "const p=require(process.argv[1]).PROVIDERS;process.stdout.write(JSON.stringify(p))",
                                     str(ROOT / "src" / "providers.js")], capture_output=True, text=True, encoding="utf-8", check=True)
    presets = json.loads(from_providers.stdout)
    preset = presets.get(provider)
    return {
        "version": "0.3.0", "uiLanguage": lang,
        "integration": {"enabled": True, "status": "Active (VS Code 1.144.1)"},
        "targetLanguage": "zh-CN",
        "languages": [{"code": "zh-CN", "label": "简体中文"}, {"code": "zh-TW", "label": "繁體中文"}, {"code": "ja", "label": "日本語"}, {"code": "en", "label": "English"}],
        "fullPageMode": "translationOnly", "autoAI": True,
        "provider": provider,
        "providers": [{"id": "vscode", "label": {"zh": "VS Code 语言模型（Copilot 等）", "de": "VS Code-Sprachmodelle (Copilot…)"}.get(lang, "VS Code language models (Copilot…)")}]
        + [{"id": k, "label": v["label"]} for k, v in presets.items()],
        "vscodeModels": [
            {"id": "gpt-5-mini", "name": "GPT-5 mini", "detail": "copilot · gpt-5-mini", "timing": None, "recommended": True},
            {"id": "claude-haiku-4.5", "name": "Claude Haiku 4.5", "detail": "copilot · claude-haiku-4.5", "timing": None, "recommended": True},
            {"id": "claude-opus-4.8", "name": "Claude Opus 4.8", "detail": "copilot · claude-opus-4.8", "timing": None},
        ],
        "modelId": "", "modelAuthorized": None, "apiModel": "", "baseUrl": "", "benchmark": None,
        "providerDefaults": None if not preset else {"model": preset.get("model", ""), "baseUrl": preset.get("baseUrl", ""),
                                                      "keyUrl": preset.get("keyUrl", ""), "keyOptional": bool(preset.get("keyOptional"))},
        "hasKey": provider == "deepseek",
        "dictionary": {"status": "ready", "entries": 770238, "kind": "downloaded", "path": "", "owner": True},
        "germanDictionary": {"status": "idle", "enabled": True},
        "surfaces": {"markdownPreview": True, "releaseNotes": True, "chat": True, "settings": True, "extensionPages": True, "welcome": True, "workbenchUI": True},
        "shortcuts": {"paragraph": "Alt+Z", "fullPage": "Alt+W"},
        "vocabularyCount": 12,
        "vocabularyRecent": [{"text": "serendipity", "phonetic": "ˌserənˈdɪpəti", "translation": "n. 意外发现珍奇事物的本领"},
                             {"text": "ephemeral", "phonetic": "ɪˈfemərəl", "translation": "adj. 短暂的"}]
        + [{"text": w, "phonetic": "", "translation": t} for w, t in [
            ("ubiquitous", "adj. 无处不在的"), ("meticulous", "adj. 一丝不苟的"), ("resilient", "adj. 有弹性的；能复原的"),
            ("pragmatic", "adj. 务实的"), ("ambiguous", "adj. 模棱两可的"), ("concise", "adj. 简明的"),
            ("idempotent", "adj. 幂等的"), ("latency", "n. 延迟"), ("deprecate", "v. 弃用"), ("throttle", "v. 节流")]],
        "markdownPreviewDefault": False,
        "dot": {"size": 7, "color": "#e5484d", "borderWidth": 1, "borderColor": "#ffffff", "opacity": 0.85, "shape": "circle", "icon": "", "iconName": ""},
    }


def node():
    import os, shutil
    found = os.environ.get("NODE") or shutil.which("node")
    if not found:
        raise SystemExit("node not found: put it on PATH or set NODE")
    return found


def html(lang):
    out = subprocess.run([node(), "-e", DUMP, str(ROOT / "src" / "panel.js"), lang], capture_output=True, text=True, encoding="utf-8", check=True)
    return out.stdout


def strings():
    code = "const m=require('module');const l=m._load;m._load=(r,...a)=>r==='vscode'?{}:l(r,...a);process.stdout.write(JSON.stringify(require(process.argv[1]).STRINGS))"
    out = subprocess.run([node(), "-e", code, str(ROOT / "src" / "panel.js")], capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(out.stdout)


def main():
    args = sys.argv[1:]
    shot = args[args.index("--screenshot") + 1] if "--screenshot" in args else None
    lang = "zh" if "--zh" in args else "de" if "--de" in args else "en"
    page_html = html(lang)
    STRINGS = strings()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 320, "height": 1180}, device_scale_factor=2 if shot else 1)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.add_init_script(INIT)
        page.route("https://panel.test/", lambda route: route.fulfill(status=200, content_type="text/html; charset=utf-8", body=page_html))
        page.goto("https://panel.test/", wait_until="domcontentloaded")
        post = lambda message: page.evaluate("m => window.postMessage(m, '*')", message)
        posted = lambda: page.evaluate("window.__posted.splice(0)")

        def wait(expression, timeout=5000):
            # Polled from here: Playwright's wait_for_function polls with eval, which the panel CSP blocks.
            for _ in range(timeout // 50):
                if page.evaluate(expression):
                    return
                page.wait_for_timeout(50)
            raise AssertionError("timed out waiting for " + expression)

        wait("window.__posted.some(function (m) { return m.type === 'ready'; })")

        post({"type": "state", "state": state("vscode", lang)})
        wait("document.getElementById('version').textContent === 'v0.3.0'")
        assert page.is_visible("#vscodeAI") and not page.is_visible("#httpAI")
        # Placeholder (no model chosen yet), two recommended, one other, then Auto as an explicit choice.
        assert page.eval_on_selector("#modelId", "s => [...s.options].map(o => o.value)") == ["", "gpt-5-mini", "claude-haiku-4.5", "claude-opus-4.8", "@auto"]
        assert page.eval_on_selector("#modelId", "s => s.value") == ""
        assert page.eval_on_selector_all("#modelId optgroup", "g => g.length") == 2
        assert page.is_visible("#chooseHint") and not page.is_visible("#accessInfo")
        assert page.is_visible("#tryBtn") and page.is_visible("#mdSet") and not page.is_visible("#mdUndo")
        # Vocabulary: five shown, the rest folded inline; the full-list link only when the host sent fewer than exist.
        assert page.eval_on_selector_all("#vocabList li", "l => l.length") == 5 and "serendipity" in page.inner_text("#vocabList")
        assert page.is_visible("#vocabToggle") and "7" in page.inner_text("#vocabToggle") and not page.is_visible("#vocabMore")
        assert page.inner_text("#vocabBadge") == "12"
        page.click("#vocabToggle")
        assert page.eval_on_selector_all("#vocabList li", "l => l.length") == 12 and not page.is_visible("#vocabMore")
        assert page.inner_text("#vocabToggle") == STRINGS[lang].get("vocabShowLess", STRINGS["en"]["vocabShowLess"])
        many = state("vscode", lang)
        many["vocabularyCount"] = 130
        post({"type": "state", "state": many})
        wait("document.getElementById('vocabBadge').textContent === '130'")
        assert page.is_visible("#vocabMore") and "118" in page.inner_text("#vocabMore")
        page.click("#vocabMore")
        assert any(m.get("command") == "translateAnywhere.openVocabulary" for m in posted())
        page.click("#vocabToggle")
        assert page.eval_on_selector_all("#vocabList li", "l => l.length") == 5 and not page.is_visible("#vocabMore")
        post({"type": "state", "state": state("vscode", lang)})
        wait("document.getElementById('vocabBadge').textContent === '12'")
        # Shortcuts come before the AI engine, the vocabulary before the dictionary.
        order = page.eval_on_selector_all("details.sec", "d => d.map(x => x.dataset.sec)")
        assert order.index("shortcuts") < order.index("ai") < order.index("vocabulary") < order.index("dictionary"), order
        assert not page.query_selector("[data-key^='surfaces.']") and not page.query_selector("#testBtn")
        assert page.eval_on_selector("#scParagraph", "i => i.value") == "Alt+Z"
        assert "770" in page.inner_text("#dictText")
        assert page.is_visible("#deBox") == (lang == "de"), "German dictionary block shows only for a German UI"
        assert not page.is_visible("#speedInfo")
        if shot:
            # A configured, speed-tested model; clipped below the vocabulary so the README shows the main sections.
            pretty = state("vscode", lang)
            pretty["modelId"] = "gpt-5-mini"
            pretty["modelAuthorized"] = True
            for model, ms in zip(pretty["vscodeModels"], (820, 1150, 3900)):
                model["timing"] = {"status": "ok", "median": ms, "first": ms // 2}
            post({"type": "state", "state": pretty})
            wait("document.getElementById('modelId').value === 'gpt-5-mini'")
            page.mouse.move(0, 0)
            page.wait_for_timeout(200)
            bottom = page.eval_on_selector("details[data-sec='vocabulary']", "d => d.getBoundingClientRect().bottom + window.scrollY")
            page.screenshot(path=shot, clip={"x": 0, "y": 0, "width": 320, "height": bottom + 12}, full_page=True)
            post({"type": "state", "state": state("vscode", lang)})
            wait("document.getElementById('modelId').value === ''")
        posted()

        # Speed test: progress on the button, then the fastest model first with a one-click switch.
        page.click("#speedBtn")
        assert posted() == [{"type": "benchmark"}]
        s = state("vscode", lang)
        s["benchmark"] = {"done": 1, "total": 2}
        post({"type": "state", "state": s})
        wait("document.getElementById('speedBtn').textContent.includes('50%')")
        assert page.is_disabled("#speedBtn") and page.is_visible("#speedInfo")
        s["benchmark"] = {"done": 1, "total": 1, "phase": "advice"}
        post({"type": "state", "state": s})
        wait("document.getElementById('speedBtn').textContent.indexOf('%') < 0")
        assert page.inner_text("#speedBtn") == STRINGS[lang]["advising"]
        assert page.is_disabled("#speedBtn")
        s = state("vscode", lang)
        s["vscodeModels"] = [dict(s["vscodeModels"][1], timing={"status": "ok", "median": 820, "first": 410}),
                             dict(s["vscodeModels"][0], timing={"status": "unauthorized"}), s["vscodeModels"][2]]
        post({"type": "state", "state": s})
        wait("!document.getElementById('speedBtn').disabled")
        assert page.eval_on_selector("#modelId", "s => s.options[1].textContent").startswith("0.8s · Claude Haiku 4.5")
        assert "0.4s" in page.inner_text("#speedInfo"), "time to first words is shown"
        assert "Claude Haiku 4.5" in page.inner_text("#speedInfo") and page.eval_on_selector_all("#speedInfo div", "d => d.length") == 2
        page.click("#speedInfo [data-use]")
        assert posted() == [{"type": "update", "key": "ai.modelId", "value": "claude-haiku-4.5"}]
        assert STRINGS[lang]["recommendedPick"].split("{0}")[0] in page.inner_text("#speedInfo")
        # Without advice there is no "Recommended" group, just the models in VS Code's order.
        s = state("vscode", lang)
        s["vscodeModels"] = [dict(m, recommended=False) for m in s["vscodeModels"]]
        post({"type": "state", "state": s})
        wait("document.querySelectorAll('#modelId optgroup').length === 1")
        assert page.eval_on_selector("#modelId optgroup", "g => g.label") == STRINGS[lang]["model"]

        # Selection dot: the dot in the shortcuts list opens an editor with a live preview.
        assert not page.is_visible("#dotEditor")
        assert page.eval_on_selector("#dotPreview", "e => getComputedStyle(e).width") == "7px"
        page.click("#dotBtn")
        assert page.is_visible("#dotEditor") and page.get_attribute("#dotBtn", "aria-expanded") == "true"
        page.eval_on_selector("#dotSize", "e => { e.value = 20; e.dispatchEvent(new Event('input', {bubbles: true})); }")
        assert page.eval_on_selector("#dotStage", "e => getComputedStyle(e).width") == "20px", "preview follows the slider live"
        assert posted() == []
        page.eval_on_selector("#dotSize", "e => e.dispatchEvent(new Event('change', {bubbles: true}))")
        assert posted() == [{"type": "update", "key": "dot.size", "value": "20"}]
        page.click(".swatch[data-color='#0090ff']")
        assert posted() == [{"type": "update", "key": "dot.color", "value": "#0090ff"}]
        page.select_option("#dotShape", "rounded")
        assert posted() == [{"type": "update", "key": "dot.shape", "value": "rounded"}]
        page.click("#dotPick")
        assert posted() == [{"type": "pickDotIcon"}]
        # A large image comes back to be scaled down to 64×64 here, then is saved.
        svg = "data:image/svg+xml;base64," + __import__("base64").b64encode(
            b'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#0a0"/></svg>').decode()
        post({"type": "resizeIcon", "data": svg, "name": "logo.svg"})
        wait("window.__posted.length > 0")
        msg = posted()[0]
        assert msg["type"] == "setDotIcon" and msg["name"] == "logo.svg" and msg["data"].startswith("data:image/png;base64,"), msg
        s = state("vscode", lang)
        s["dot"] = dict(s["dot"], size=16, borderWidth=0, opacity=1, icon=msg["data"], iconName="logo.svg")
        post({"type": "state", "state": s})
        wait("!document.getElementById('dotRemove').hidden")
        assert page.is_visible("#dotThumb") and page.is_disabled("#dotShape")
        assert "url(" in page.eval_on_selector("#dotPreview", "e => getComputedStyle(e).backgroundImage")
        assert page.eval_on_selector("#dotPreview", "e => getComputedStyle(e).borderRadius") == "0px", "images are not clipped to a circle"
        page.click("#dotRemove")
        assert posted() == [{"type": "removeDotIcon"}]
        page.click("#dotReset")
        assert posted() == [{"type": "resetDot"}]
        page.click("#dotDone")
        assert not page.is_visible("#dotEditor")
        # The "Customize selection dot" command opens the editor through focus().
        post({"type": "state", "state": s, "focus": "dotEditor"})
        wait("!document.getElementById('dotEditor').hidden")
        posted()
        page.click("#dotDone")

        # Errors from commands appear in a dismissible banner at the top.
        post({"type": "error", "message": "Something failed"})
        wait("!document.getElementById('banner').hidden")
        page.click("#bannerClose")
        assert not page.is_visible("#banner")

        # Collapsing a section is remembered in the webview state.
        page.click("details[data-sec='shortcuts'] > summary")
        assert page.evaluate("document.querySelector(\"details[data-sec='shortcuts']\").open") is False
        page.click("details[data-sec='shortcuts'] > summary")
        posted()

        # A chosen but unauthorized model offers "Allow access"; Markdown preview already on offers the undo link.
        s = state("vscode", lang)
        s.update(modelId="claude-haiku-4.5", modelAuthorized=False, markdownPreviewDefault=True)
        post({"type": "state", "state": s})
        wait("!document.getElementById('accessInfo').hidden")
        assert page.eval_on_selector("#modelId", "s => s.options[0].value") == "gpt-5-mini", "no placeholder once a model is chosen"
        assert not page.is_visible("#chooseHint") and not page.is_visible("#mdSet") and page.is_visible("#mdUndo")
        page.click("#accessInfo a")
        assert posted() == [{"type": "command", "command": "translateAnywhere.authorizeAI"}]
        page.click("#mdUndo")
        assert posted() == [{"type": "command", "command": "translateAnywhere.openMarkdownAsText"}]
        page.click("#tryBtn")
        assert posted() == [{"type": "command", "command": "translateAnywhere.tryIt"}]
        page.click("footer [data-command='translateAnywhere.openSurfaceSettings']")
        assert posted() == [{"type": "command", "command": "translateAnywhere.openSurfaceSettings"}]

        # The extension can ask the panel to reveal the model picker (no matching default model).
        page.click("details[data-sec='ai'] > summary")
        posted()
        post({"type": "state", "state": state("vscode", lang), "focus": "modelId"})
        wait("document.activeElement && document.activeElement.id === 'modelId'")
        assert page.evaluate("document.querySelector(\"details[data-sec='ai']\").open")
        assert {"type": "focused"} in posted()

        # The German block also appears once a German word has been looked up.
        s = state("vscode", lang)
        s["germanDictionary"] = {"status": "ready", "entries": 133000, "kind": "downloaded", "enabled": True}
        post({"type": "state", "state": s})
        wait("!document.getElementById('deBox').hidden")

        page.select_option("#provider", "deepseek")
        assert posted() == [{"type": "update", "key": "ai.provider", "value": "deepseek"}]
        post({"type": "state", "state": state("deepseek", lang)})
        wait("!document.getElementById('httpAI').hidden")
        assert not page.is_visible("#vscodeAI")
        assert page.get_attribute("#apiModel", "placeholder") == "deepseek-chat"
        assert page.is_visible("#keyLink")

        page.fill("#apiModel", "deepseek-reasoner")
        page.press("#apiModel", "Tab")
        assert {"type": "update", "key": "ai.apiModel", "value": "deepseek-reasoner"} in posted()

        page.click("#fetchBtn")
        assert posted() == [{"type": "listModels"}]
        post({"type": "models", "models": ["deepseek-chat", "deepseek-reasoner"]})
        wait("document.querySelectorAll('#modelList option').length === 2")

        post({"type": "models", "error": "DeepSeek HTTP 401: invalid key"})
        wait("!document.getElementById('aiError').hidden")

        page.click("#keyLink")
        msgs = posted()
        assert msgs and msgs[0]["type"] == "external" and msgs[0]["url"].startswith("https://"), msgs

        page.click("[data-command='translateAnywhere.setApiKey']")
        assert posted() == [{"type": "command", "command": "translateAnywhere.setApiKey"}]

        page.focus("#scParagraph")
        page.keyboard.press("Control+Shift+Y")
        assert posted() == [{"type": "update", "key": "shortcuts.paragraph", "value": "Ctrl+Shift+Y"}]
        page.keyboard.press("Backspace")
        assert posted() == [{"type": "update", "key": "shortcuts.paragraph", "value": ""}]
        page.keyboard.press("Alt+Backquote")
        assert posted() == [{"type": "update", "key": "shortcuts.paragraph", "value": "Alt+`"}]

        page.select_option("#fullPageMode", "bilingual")
        assert posted() == [{"type": "update", "key": "fullPage.mode", "value": "bilingual"}]

        s = state("deepseek", lang)
        s["dictionary"] = {"status": "downloading", "percent": 42, "received": 0, "path": "", "owner": True}
        post({"type": "state", "state": s})
        wait("document.getElementById('dictText').textContent.includes('42%')")
        assert not page.is_visible("#dictDownload")
        browser.close()
    assert not errors, errors
    print("PANEL TEST PASSED", lang)


if __name__ == "__main__":
    main()
