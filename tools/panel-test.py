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
            {"id": "gpt-5-mini", "name": "GPT-5 mini", "detail": "copilot · gpt-5-mini", "timing": None},
            {"id": "claude-haiku-4.5", "name": "Claude Haiku 4.5", "detail": "copilot · claude-haiku-4.5", "timing": None},
        ],
        "modelId": "", "apiModel": "", "baseUrl": "", "benchmark": None,
        "providerDefaults": None if not preset else {"model": preset.get("model", ""), "baseUrl": preset.get("baseUrl", ""),
                                                      "keyUrl": preset.get("keyUrl", ""), "keyOptional": bool(preset.get("keyOptional"))},
        "hasKey": provider == "deepseek",
        "dictionary": {"status": "ready", "entries": 770238, "kind": "downloaded", "path": "", "owner": True},
        "germanDictionary": {"status": "idle", "enabled": True},
        "surfaces": {"markdownPreview": True, "releaseNotes": True, "chat": True, "settings": True, "extensionPages": True, "welcome": True, "workbenchUI": True},
        "shortcuts": {"paragraph": "Alt+Z", "fullPage": "Alt+W"},
        "vocabularyCount": 12,
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


def main():
    args = sys.argv[1:]
    shot = args[args.index("--screenshot") + 1] if "--screenshot" in args else None
    lang = "zh" if "--zh" in args else "de" if "--de" in args else "en"
    page_html = html(lang)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 320, "height": 1180}, device_scale_factor=2 if shot else 1)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.add_init_script(INIT)
        page.route("https://panel.test/", lambda route: route.fulfill(status=200, content_type="text/html; charset=utf-8", body=page_html))
        page.goto("https://panel.test/", wait_until="domcontentloaded")
        page.wait_for_function("window.__posted.some(m => m.type === 'ready')")
        post = lambda message: page.evaluate("m => window.postMessage(m, '*')", message)
        posted = lambda: page.evaluate("window.__posted.splice(0)")

        post({"type": "state", "state": state("vscode", lang)})
        page.wait_for_function("document.getElementById('version').textContent === 'v0.3.0'")
        assert page.is_visible("#vscodeAI") and not page.is_visible("#httpAI")
        assert page.eval_on_selector("#modelId", "s => s.options.length") == 3
        assert page.eval_on_selector("#scParagraph", "i => i.value") == "Alt+Z"
        assert "770" in page.inner_text("#dictText")
        assert page.is_visible("#deBox") == (lang == "de"), "German dictionary block shows only for a German UI"
        assert not page.is_visible("#speedInfo")
        if shot:
            page.screenshot(path=shot, full_page=True)
        posted()

        # Speed test: progress on the button, then the fastest model first with a one-click switch.
        page.click("#speedBtn")
        assert posted() == [{"type": "benchmark"}]
        s = state("vscode", lang)
        s["benchmark"] = {"done": 1, "total": 2}
        post({"type": "state", "state": s})
        page.wait_for_function("document.getElementById('speedBtn').textContent.includes('1/2')")
        assert page.is_disabled("#speedBtn") and page.is_visible("#speedInfo")
        s = state("vscode", lang)
        s["vscodeModels"] = [dict(s["vscodeModels"][1], timing=820), dict(s["vscodeModels"][0], timing="unauthorized")]
        post({"type": "state", "state": s})
        page.wait_for_function("!document.getElementById('speedBtn').disabled")
        assert page.eval_on_selector("#modelId", "s => s.options[1].textContent").startswith("0.8s · Claude Haiku 4.5")
        assert "Claude Haiku 4.5" in page.inner_text("#speedInfo") and page.eval_on_selector_all("#speedInfo div", "d => d.length") == 2
        page.click("#speedInfo [data-use]")
        assert posted() == [{"type": "update", "key": "ai.modelId", "value": "claude-haiku-4.5"}]

        # Errors from commands appear in a dismissible banner at the top.
        post({"type": "error", "message": "Something failed"})
        page.wait_for_function("!document.getElementById('banner').hidden")
        page.click("#bannerClose")
        assert not page.is_visible("#banner")

        # Collapsing a section is remembered in the webview state.
        page.click("details[data-sec='surfaces'] > summary")
        assert page.evaluate("document.querySelector(\"details[data-sec='surfaces']\").open") is False
        page.click("details[data-sec='surfaces'] > summary")
        posted()

        # The German block also appears once a German word has been looked up.
        s = state("vscode", lang)
        s["germanDictionary"] = {"status": "ready", "entries": 133000, "kind": "downloaded", "enabled": True}
        post({"type": "state", "state": s})
        page.wait_for_function("!document.getElementById('deBox').hidden")

        page.select_option("#provider", "deepseek")
        assert posted() == [{"type": "update", "key": "ai.provider", "value": "deepseek"}]
        post({"type": "state", "state": state("deepseek", lang)})
        page.wait_for_function("!document.getElementById('httpAI').hidden")
        assert not page.is_visible("#vscodeAI")
        assert page.get_attribute("#apiModel", "placeholder") == "deepseek-chat"
        assert page.is_visible("#keyLink")

        page.fill("#apiModel", "deepseek-reasoner")
        page.press("#apiModel", "Tab")
        assert {"type": "update", "key": "ai.apiModel", "value": "deepseek-reasoner"} in posted()

        page.click("#fetchBtn")
        assert posted() == [{"type": "listModels"}]
        post({"type": "models", "models": ["deepseek-chat", "deepseek-reasoner"]})
        page.wait_for_function("document.querySelectorAll('#modelList option').length === 2")

        post({"type": "models", "error": "DeepSeek HTTP 401: invalid key"})
        page.wait_for_function("!document.getElementById('aiError').hidden")

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

        page.uncheck("[data-key='surfaces.chat']")
        assert posted() == [{"type": "update", "key": "surfaces.chat", "value": False}]

        page.select_option("#fullPageMode", "bilingual")
        assert posted() == [{"type": "update", "key": "fullPage.mode", "value": "bilingual"}]

        s = state("deepseek", lang)
        s["dictionary"] = {"status": "downloading", "percent": 42, "received": 0, "path": "", "owner": True}
        post({"type": "state", "state": s})
        page.wait_for_function("document.getElementById('dictText').textContent.includes('42%')")
        assert not page.is_visible("#dictDownload")
        browser.close()
    assert not errors, errors
    print("PANEL TEST PASSED", lang)


if __name__ == "__main__":
    main()
