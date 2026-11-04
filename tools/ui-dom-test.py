"""Headless DOM test of the injected UI runtime (src/ui.js) against a mocked bridge.

Runs in invisible headless Chrome; no VS Code window is opened.
Usage: py -3.13 tools/ui-dom-test.py
"""
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = "http://imt.test"

PAGE = """<!doctype html><html><head><meta charset="utf-8"></head><body style="font:16px sans-serif;width:700px">
<div id="vscode-markdown-preview-data"></div>
<h1 id="h">Release Highlights</h1>
<p id="p1">Improved <b>performance</b> for large workspaces.</p>
<p id="p2">This sentence tests selection translation in the Markdown preview.</p>
<ul><li id="li1">Outer item text<ul><li id="li2">Nested item text</li></ul></li></ul>
<p id="zh">这是一段中文，不需要翻译。</p>
<pre id="code">npm run build --watch</pre>
<div style="height:3000px"></div>
<p id="far">Far away paragraph that loads lazily.</p>
<p id="long" style="width:420px">Multi line selection should anchor the red dot right next to the final selected word instead of the far edge end.</p>
<div style="height:40px"></div>
</body></html>"""


CHAT_PAGE = """<!doctype html><html><head><meta charset="utf-8"></head><body style="font:13px sans-serif;width:600px;margin:0">
<div class="interactive-session"><div class="monaco-list">
 <div class="interactive-item-container"><div class="rendered-markdown">
  <p id="c1">The assistant answer paragraph explains the change in detail.</p>
  <ul><li id="c2">First bullet of the response</li></ul>
 </div></div>
</div>
<div class="interactive-input-part">
 <div class="chat-question-carousel-widget-container"><div class="chat-question-carousel-container">
  <div class="chat-question-header-row"><div class="chat-question-title" id="q1">Switch this chat to the new workspace folder?</div></div>
  <div class="chat-question-carousel-message" id="q2">The old folder stays for now and you will be asked again before deleting it.</div>
  <div class="chat-question-list"><div class="chat-question-list-item"><span class="chat-question-list-label-title" id="q3">Confirm the switch</span></div></div>
  <div class="chat-question-input-container"><textarea class="chat-question-freeform-textarea" id="qfree">Free form answer</textarea></div>
 </div></div>
 <div class="monaco-editor"><textarea id="input">chat input</textarea></div>
</div></div>
<p id="outside">Outside chat text paragraph.</p>
<div class="notifications-toasts"><div class="notification-list-item"><div class="notification-list-item-message" id="n1">Extension host terminated unexpectedly three times.</div></div></div>
<div class="monaco-dialog-box"><div class="dialog-message-row"><div class="dialog-message-text" id="d1">Do you want to save the changes you made?</div></div></div>
<div class="monaco-editor"><div class="monaco-hover" id="eh">Editor hover documentation text</div></div>
</body></html>"""


def select_text(page, element_id, start=0, end=None):
    page.evaluate("""([id, a, b]) => { const t = document.getElementById(id).firstChild; const r = document.createRange();
      r.setStart(t, a); r.setEnd(t, b === null ? t.length : b); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""",
                  [element_id, start, end])


def chat_test(browser, handle, ui):
    """Workbench Chat surface: same runtime, 'chat' scope, with a workbench-like global key listener."""
    page = browser.new_page(viewport={"width": 800, "height": 600}, screen={"width": 800, "height": 600})

    def route(r):
        if r.request.url.endswith("/chat"):
            return r.fulfill(status=200, content_type="text/html", body=CHAT_PAGE)
        return handle(r)

    page.route(ORIGIN + "/**", route)
    page.goto(ORIGIN + "/chat")
    chat_ui = ui.replace("location.protocol === 'vscode-file:'", "true")
    page.add_script_tag(content=f"({chat_ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
    # Registered after the runtime, like VS Code's keybinding dispatcher (the runtime loads with the bundle).
    page.evaluate("window.wbKeys = []; window.addEventListener('keydown', e => wbKeys.push(e.code + (e.defaultPrevented ? ':consumed' : '')), true)")
    page.wait_for_timeout(200)
    out = {}
    # Selection -> dot -> panel -> star, panel and selection survive the click.
    page.evaluate("""(() => { const t = document.getElementById('c1').firstChild; const r = document.createRange();
      r.setStart(t, 4); r.setEnd(t, 13); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()""")
    page.locator(".imt-dot").wait_for(state="visible", timeout=3000)
    page.locator(".imt-dot").hover()
    page.wait_for_function("document.querySelector('.imt-panel p').textContent.startsWith('译')")
    page.locator(".imt-star").click()
    page.wait_for_function("document.querySelector('.imt-star').classList.contains('imt-on')")
    assert page.evaluate("!document.querySelector('.imt-panel').hidden && getSelection().toString() === 'assistant'")
    out["star"] = "ok"
    page.keyboard.press("Escape")
    page.evaluate("getSelection().removeAllRanges()")
    # Selection outside chat answers is ignored.
    page.evaluate("""(() => { const t = document.getElementById('outside').firstChild; const r = document.createRange();
      r.setStart(t, 0); r.setEnd(t, 7); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()""")
    page.wait_for_timeout(200)
    assert page.evaluate("document.querySelector('.imt-dot').hidden"), "non-chat text must be ignored"
    page.evaluate("getSelection().removeAllRanges()")
    # Alt+Z over a chat paragraph: translated and consumed before the workbench sees it.
    box = page.locator("#c1").bounding_box()
    page.mouse.move(box["x"] + 10, box["y"] + box["height"] / 2)
    page.keyboard.press("Alt+z")
    page.wait_for_function("document.querySelector('#c1 > .imt-trans:not(.imt-loading)')")
    assert "KeyZ" not in " ".join(page.evaluate("wbKeys")), page.evaluate("wbKeys")
    page.keyboard.press("Alt+z")
    page.wait_for_function("!document.querySelector('#c1 > .imt-trans')")
    # Alt+Z over the chat input is left to VS Code (Toggle Word Wrap) with a hint.
    box = page.locator("#input").bounding_box()
    page.mouse.move(box["x"] + 5, box["y"] + 5)
    page.keyboard.press("Alt+z")
    assert page.evaluate("wbKeys").count("KeyZ") == 1, page.evaluate("wbKeys")
    out["alt_z"] = "ok"
    # Alt+W with focus in the chat input toggles the whole conversation.
    page.locator("#input").focus()
    page.keyboard.press("Alt+w")
    page.wait_for_function("['c1','c2'].every(id => document.querySelector('#'+id+' > .imt-trans:not(.imt-loading)'))", timeout=6000)
    assert page.evaluate("!document.querySelector('#outside .imt-trans')")
    page.keyboard.press("Alt+w")
    page.wait_for_function("document.querySelectorAll('.imt-trans,.imt-only').length === 0")
    out["alt_w"] = "ok"
    # Real mouse drag across a chat answer: no dot while the button is held.
    page.evaluate("document.activeElement.blur(); getSelection().removeAllRanges()")
    box = page.locator("#c1").bounding_box()
    page.mouse.move(box["x"] + 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    for i in range(1, 16):
        page.mouse.move(box["x"] + 2 + (box["width"] - 10) * i / 15, box["y"] + box["height"] / 2)
        page.wait_for_timeout(15)
        assert page.evaluate("document.querySelector('.imt-dot').hidden"), "chat: dot visible mid-drag"
    page.mouse.up()
    page.locator(".imt-dot").wait_for(state="visible", timeout=3000)
    out["drag"] = "ok"
    page.keyboard.press("Escape")
    page.evaluate("getSelection().removeAllRanges()")
    # Question box (ask-user carousel in the input part), notifications and dialogs get the dot too.
    for element_id in ("q1", "q2", "n1", "d1"):
        select_text(page, element_id, 0, 6)
        page.locator(".imt-dot").wait_for(state="visible", timeout=3000)
        page.keyboard.press("Escape")
        page.evaluate("getSelection().removeAllRanges()")
        page.wait_for_timeout(50)
    # ...but never the freeform answer box, the chat input or editor-attached hovers.
    for element_id in ("qfree", "eh"):
        if element_id == "qfree":
            page.evaluate("document.getElementById('qfree').focus(); document.getElementById('qfree').setSelectionRange(0, 4)")
        else:
            select_text(page, element_id, 0, 6)
        page.wait_for_timeout(200)
        assert page.evaluate("document.querySelector('.imt-dot').hidden"), f"{element_id} must be ignored"
        page.evaluate("document.activeElement.blur(); getSelection().removeAllRanges()")
    # Alt+Z over the question message and over a notification translates that paragraph.
    for element_id in ("q2", "n1"):
        box = page.locator("#" + element_id).bounding_box()
        page.mouse.move(box["x"] + 10, box["y"] + box["height"] / 2)
        page.keyboard.press("Alt+z")
        page.wait_for_function(f"document.querySelector('#{element_id} > .imt-trans:not(.imt-loading)')")
        page.keyboard.press("Alt+z")
        page.wait_for_function(f"!document.querySelector('#{element_id} > .imt-trans')")
    out["question_box_and_workbench_ui"] = "ok"
    page.close()
    return out


SETTINGS_PAGE = """<!doctype html><html><head><meta charset="utf-8"></head><body style="font:13px sans-serif;width:700px;margin:0">
<div class="settings-editor"><div class="setting-item">
 <div class="setting-item-title">Editor: Word Wrap</div>
 <div class="setting-item-description"><div class="setting-item-markdown" id="s1"><p id="s1p">Controls how lines should wrap in the editor.</p></div></div>
 <input id="sinput" value="text input value">
</div></div>
<div class="monaco-editor"><p id="editor">Editor text must never be translated.</p></div>
</body></html>"""


def settings_test(browser, handle, ui, status):
    """Settings editor surface, custom shortcut from settings, and a surface switched off in settings."""
    page = browser.new_page(viewport={"width": 800, "height": 600}, screen={"width": 800, "height": 600})

    def route(r):
        if r.request.url.endswith("/settings"):
            return r.fulfill(status=200, content_type="text/html", body=SETTINGS_PAGE)
        return handle(r)

    page.route(ORIGIN + "/**", route)
    page.goto(ORIGIN + "/settings")
    wb_ui = ui.replace("location.protocol === 'vscode-file:'", "true")
    page.add_script_tag(content=f"({wb_ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
    page.evaluate("window.wbKeys = []; window.addEventListener('keydown', e => wbKeys.push(e.code + (e.defaultPrevented ? ':consumed' : '')), true)")
    page.wait_for_timeout(200)
    out = {}

    def select_text(element_id, start, end):
        page.evaluate("""([id, a, b]) => { const t = document.getElementById(id).firstChild; const r = document.createRange();
          r.setStart(t, a); r.setEnd(t, b); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""", [element_id, start, end])

    def refresh():
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(150)

    # Selection in a setting description -> dot -> translation.
    select_text("s1p", 0, 8)
    page.locator(".imt-dot").wait_for(state="visible", timeout=3000)
    page.locator(".imt-dot").hover()
    page.wait_for_function("document.querySelector('.imt-panel p').textContent.startsWith('译')")
    page.keyboard.press("Escape")
    # Editor text is ignored.
    select_text("editor", 0, 6)
    page.wait_for_timeout(200)
    assert page.evaluate("document.querySelector('.imt-dot').hidden"), "editor text must be ignored"
    page.evaluate("getSelection().removeAllRanges()")
    out["select"] = "ok"
    # Paragraph shortcut over a setting description.
    box = page.locator("#s1p").bounding_box()
    page.mouse.move(box["x"] + 5, box["y"] + box["height"] / 2)
    page.keyboard.press("Alt+z")
    page.wait_for_function("document.querySelector('#s1p > .imt-trans:not(.imt-loading)')")
    page.keyboard.press("Alt+z")
    page.wait_for_function("!document.querySelector('#s1p > .imt-trans')")
    # Custom shortcut from settings replaces Alt+Z, which then goes back to VS Code.
    status["shortcuts"] = {"paragraph": "Ctrl+Shift+Y", "fullPage": ""}
    refresh()
    page.evaluate("wbKeys.length = 0")
    page.keyboard.press("Alt+z")
    page.wait_for_timeout(150)
    assert page.evaluate("!document.querySelector('#s1p > .imt-trans')")
    assert "KeyZ" in page.evaluate("wbKeys"), page.evaluate("wbKeys")
    page.keyboard.press("Control+Shift+y")
    page.wait_for_function("document.querySelector('#s1p > .imt-trans:not(.imt-loading)')")
    assert "KeyY" not in " ".join(page.evaluate("wbKeys"))
    page.keyboard.press("Control+Shift+y")
    page.wait_for_function("!document.querySelector('#s1p > .imt-trans')")
    page.keyboard.press("Alt+w")
    page.wait_for_timeout(150)
    assert page.evaluate("document.querySelectorAll('.imt-trans').length") == 0, "empty full-page shortcut is disabled"
    out["custom_shortcut"] = "ok"
    # Surface turned off in settings: no dot, no paragraph translation.
    status["surfaces"] = {"settings": False}
    refresh()
    select_text("s1p", 0, 8)
    page.wait_for_timeout(250)
    assert page.evaluate("document.querySelector('.imt-dot').hidden"), "disabled surface must not show the dot"
    page.evaluate("getSelection().removeAllRanges()")
    page.mouse.move(box["x"] + 5, box["y"] + box["height"] / 2)
    page.keyboard.press("Control+Shift+y")
    page.wait_for_timeout(150)
    assert page.evaluate("!document.querySelector('#s1p > .imt-trans')")
    out["surface_off"] = "ok"
    status.pop("surfaces"); status.pop("shortcuts")
    page.close()
    return out


WEBVIEW_PRELOAD = """<!doctype html><html><body><script>
const f = document.createElement('iframe'); f.id = 'pending-frame'; f.setAttribute('sandbox', SANDBOX); f.src = './fake.html';
f.style.cssText = 'width:800px;height:500px'; document.body.appendChild(f);
f.contentWindow.addEventListener('DOMContentLoaded', e => { const d = e.target;
  setTimeout(() => { d.open(); d.write(CONTENT); d.close(); f.id = 'active-frame'; }, 0); });
</script></body></html>"""
EXTENSION_README = """<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'nonce-n';">
<style nonce="n">body{font:16px sans-serif}</style></head><body><a id="scroll-to-top" href="#"><span class="icon"></span></a>
<h1>Overview</h1><p id="p">The extension is a suite of tools for structured interaction.</p></body></html>"""
WALKTHROUGH_STEP = """<!DOCTYPE html><html><head><style nonce="n">body{font:16px sans-serif}</style></head><body>
<vertically-centered><p id="p">Pick a color theme that suits your workspace.</p></vertically-centered></body></html>"""


def webview_test(browser, handle, ui):
    """Webview content frames as VS Code's preload builds them (fake.html + document.write), driven from the
    parent realm like production. Extension README/changelog frames are sandboxed WITHOUT allow-scripts."""
    out = {}
    cases = [("extension_readme", EXTENSION_README, "allow-same-origin allow-pointer-lock"),
             ("walkthrough_step", WALKTHROUGH_STEP, "allow-same-origin allow-pointer-lock allow-scripts")]
    q = "document.getElementById('active-frame').contentDocument"
    for name, content, sandbox in cases:
        page = browser.new_page(viewport={"width": 900, "height": 600})

        def make_route(content, sandbox):
            def route(r):
                if r.request.url.endswith("/pre"):
                    body = WEBVIEW_PRELOAD.replace("SANDBOX", json.dumps(sandbox)).replace("CONTENT", json.dumps(content))
                    return r.fulfill(status=200, content_type="text/html", body=body)
                if r.request.url.endswith("/fake.html"):
                    return r.fulfill(status=200, content_type="text/html", body="<!doctype html><html><head></head><body></body></html>")
                return handle(r)
            return route

        page.route(ORIGIN + "/**", make_route(content, sandbox))
        page.goto(ORIGIN + "/pre", wait_until="domcontentloaded")
        page.add_script_tag(content=f"({ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
        # Playwright cannot drive input inside script-disabled frames, so events are dispatched from the parent.
        page.wait_for_function(f"(() => {{ const d = document.getElementById('active-frame')?.contentDocument; return d && d.querySelector('.imt-dot'); }})()", timeout=5000)
        page.evaluate(f"""(() => {{ const d = {q}, w = d.defaultView, t = d.getElementById('p').firstChild, r = d.createRange();
          r.setStart(t, 4); r.setEnd(t, 13);
          w.dispatchEvent(new w.PointerEvent('pointerdown', {{ button: 0, buttons: 1, bubbles: true }}));
          const s = w.getSelection(); s.removeAllRanges(); s.addRange(r);
          d.getElementById('p').dispatchEvent(new w.PointerEvent('pointerup', {{ bubbles: true }})); }})()""")
        page.wait_for_function(f"!{q}.querySelector('.imt-dot').hidden", timeout=3000)
        page.evaluate(f"""(() => {{ const d = {q}, w = d.defaultView, r = d.getElementById('p').getBoundingClientRect();
          w.getSelection().removeAllRanges();
          w.dispatchEvent(new w.PointerEvent('pointermove', {{ clientX: r.x + 5, clientY: r.y + 5 }}));
          w.dispatchEvent(new w.KeyboardEvent('keydown', {{ key: 'w', code: 'KeyW', altKey: true, bubbles: true }})); }})()""")
        page.wait_for_function(f"{q}.querySelector('.imt-trans') && !{q}.querySelector('.imt-trans.imt-loading')", timeout=5000)
        out[name] = "ok"
        page.close()
    return out


def main():
    ui = (ROOT / "src" / "ui.js").read_text(encoding="utf-8")
    ui = ui[:ui.rindex("if (typeof module")]  # production injects immersiveUI.toString() only
    calls, vocab = [], set()
    status = {"uiLanguage": "zh-cn", "fullPageMode": "translationOnly"}

    def handle(route):
        req = route.request
        path = req.url[len(ORIGIN):]
        if path == "/page":
            return route.fulfill(status=200, content_type="text/html", body=PAGE)
        body = json.loads(req.post_data or "{}")
        calls.append((path, body.get("mode"), body.get("text")))
        if path == "/status":
            data = {"service": "immersive-translate-vscode", "enabled": True, "version": "test", "settings": status}
        elif path == "/lookup":
            found = body["text"].lower() == "performance"
            data = {"found": found, "word": body["text"], "phonetic": "pə'fɔːməns" if found else "",
                    "translation": "n. 性能" if found else "离线词典未收录", "source": "ECDICT · 离线词典"}
        elif path == "/ai":
            data = {"translation": f"译({body['mode']}):{body['text'][:12]}", "source": "AI · mock"}
        elif path == "/vocab":
            if body["action"] == "toggle":
                vocab.symmetric_difference_update({body["text"]})
            data = {"saved": body["text"] in vocab}
        else:
            return route.fulfill(status=404, body="{}")
        route.fulfill(status=200, content_type="application/json", body=json.dumps(data, ensure_ascii=False))

    def select(page, element_id, pattern=None):
        page.evaluate("""([id, pattern]) => {
          const el = document.getElementById(id);
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node; const range = document.createRange();
          while (node = walker.nextNode()) {
            const i = pattern ? node.textContent.indexOf(pattern) : 0;
            if (i >= 0) { range.setStart(node, i); range.setEnd(node, pattern ? i + pattern.length : node.textContent.length); break; }
          }
          const s = getSelection(); s.removeAllRanges(); s.addRange(range);
        }""", [element_id, pattern])
        page.locator(".imt-dot").wait_for(state="visible", timeout=3000)

    def trans(page, element_id):
        return page.evaluate("""id => { const t = [...document.getElementById(id).children].find(c => c.classList.contains('imt-trans'));
                                return t ? t.textContent : null; }""", element_id)

    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 900, "height": 700}, screen={"width": 900, "height": 700})
        page.route(ORIGIN + "/**", handle)
        page.goto(ORIGIN + "/page")
        page.add_script_tag(content=f"({ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
        page.wait_for_timeout(300)

        # 1. Dot size and dictionary hit.
        select(page, "p1", "performance")
        size = page.evaluate("(() => { const r = document.querySelector('.imt-dot').getBoundingClientRect(); return [r.width, r.height]; })()")
        assert abs(size[0] - 7.2) < 0.3, size
        page.locator(".imt-dot").hover()
        page.wait_for_function("document.querySelector('.imt-panel p').textContent.includes('性能')")
        assert not any(c[0] == "/ai" for c in calls), "dictionary hit must not call AI"
        results["dot_px"] = size
        # 2. Icon star toggles the vocabulary book; buttons keep the panel open and the selection intact.
        assert page.evaluate("!document.querySelector('.imt-star').classList.contains('imt-on')")
        assert page.evaluate("document.querySelector('.imt-star svg') && document.querySelector('.imt-close svg')")
        page.locator(".imt-star").click()
        page.wait_for_function("document.querySelector('.imt-star').classList.contains('imt-on')")
        assert vocab == {"performance"}
        assert page.evaluate("document.querySelector('.imt-star').getAttribute('aria-pressed')") == "true"
        assert page.evaluate("!document.querySelector('.imt-panel').hidden"), "star click must keep the panel"
        assert page.evaluate("getSelection().toString()") == "performance", "star click must keep the selection"
        page.locator(".imt-star").click()
        page.wait_for_function("!document.querySelector('.imt-star').classList.contains('imt-on')")
        assert vocab == set()
        page.locator(".imt-close").click()
        assert page.evaluate("document.querySelector('.imt-panel').hidden && document.querySelector('.imt-dot').hidden")
        page.evaluate("getSelection().removeAllRanges()")
        # 3. Sentence: dictionary miss -> automatic AI (selection mode).
        select(page, "p2")
        page.locator(".imt-dot").hover()
        page.wait_for_function("document.querySelector('.imt-panel p').textContent.startsWith('译(selection)')")
        results["sentence_auto_ai"] = page.locator(".imt-panel p").inner_text()
        page.keyboard.press("Escape")
        page.evaluate("getSelection().removeAllRanges()")
        # 4. Alt+Z toggles the paragraph under the mouse immediately (no hold), bilingual.
        box = page.locator("#p1").bounding_box()
        page.mouse.move(box["x"] + 5, box["y"] + box["height"] / 2)
        page.keyboard.press("Alt+z")
        page.wait_for_function("document.querySelector('#p1 .imt-trans') && !document.querySelector('#p1 .imt-loading')")
        assert trans(page, "p1").startswith("译(paragraph):Improved per"), trans(page, "p1")
        assert page.evaluate("!document.getElementById('p1').classList.contains('imt-only')"), "Alt+Z keeps the original"
        assert trans(page, "p2") is None
        page.keyboard.press("Alt+z")
        page.wait_for_timeout(100)
        assert trans(page, "p1") is None
        results["alt_z"] = "ok"
        # 5. Alt+W full page, translation-only (default): original hidden, nested list still visible, restorable.
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelector('.imt-toast') && document.querySelector('.imt-toast').textContent.includes('仅译文')")
        page.wait_for_function("['h','p1','p2','li1','li2'].every(id => document.querySelector('#'+id+'.imt-only > .imt-trans:not(.imt-loading)'))")
        assert trans(page, "li1") == "译(paragraph):Outer item t", trans(page, "li1")
        assert page.evaluate("document.querySelector('#li1 > .imt-trans').nextElementSibling.tagName") == "UL"
        assert page.evaluate("getComputedStyle(document.querySelector('#p1 b')).display") == "none"
        assert page.evaluate("getComputedStyle(document.querySelector('#p1 > .imt-trans')).fontSize") == "16px"
        assert page.evaluate("document.querySelector('#li2').getBoundingClientRect().height > 0"), "nested list must stay visible"
        assert trans(page, "zh") is None and page.evaluate("!document.querySelector('#code .imt-trans')")
        assert trans(page, "far") is None, "off-screen paragraph must wait for scroll"
        page.locator("#far").scroll_into_view_if_needed()
        page.wait_for_function("document.querySelector('#far > .imt-trans:not(.imt-loading)')")
        page.evaluate("window.scrollTo(0, 0)")
        page.evaluate("document.getElementById('p2').insertAdjacentHTML('afterend', '<p id=\"new\">Freshly rendered paragraph.</p>')")
        page.wait_for_function("document.querySelector('#new > .imt-trans:not(.imt-loading)')")
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelectorAll('.imt-trans,.imt-only').length === 0")
        assert page.evaluate("getComputedStyle(document.querySelector('#p1 b')).display") != "none"
        # Bilingual mode via the setting (served through /status).
        status["fullPageMode"] = "bilingual"
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(150)
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelector('#p1 > .imt-trans:not(.imt-loading)')")
        assert page.evaluate("document.querySelectorAll('.imt-only').length") == 0
        assert "双语对照" in page.evaluate("document.querySelector('.imt-toast').textContent")
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelectorAll('.imt-trans').length === 0")
        results["full_page"] = "ok"
        # 6. Multi-line selection: dot sits next to the last selected character, not at the far right edge.
        page.evaluate("document.getElementById('long').scrollIntoView({block: 'center'})")
        select(page, "long")
        geo = page.evaluate("""(() => {
          const el = document.getElementById('long'); const t = el.firstChild; const r = document.createRange();
          r.setStart(t, t.length - 1); r.setEnd(t, t.length); const c = r.getBoundingClientRect();
          const d = document.querySelector('.imt-dot').getBoundingClientRect();
          return { dot: [d.left, d.top], last: [c.right, c.bottom], first: el.getClientRects()[0].top, lines: Math.round(el.getBoundingClientRect().height / c.height) };
        })()""")
        assert geo["lines"] >= 2, geo
        assert abs(geo["dot"][0] - (geo["last"][0] + 3)) < 2 and abs(geo["dot"][1] - (geo["last"][1] + 1)) < 2, geo
        results["dot_at_last_char"] = geo
        page.keyboard.press("Escape")
        page.evaluate("getSelection().removeAllRanges()")
        # 6b. Real mouse drags (forward and backward): no dot while the button is held, and releasing on
        #     the dot does not pop the panel; moving away and back opens it instantly.
        for direction in ("forward", "backward"):
            ends = page.evaluate("""(() => {
              const t = document.getElementById('long').firstChild; const r = document.createRange();
              const at = i => { r.setStart(t, i); r.setEnd(t, i + 1); return r.getClientRects()[0]; };
              const f = at(0), l = at(t.length - 1);
              return { first: [f.left + 1, f.top + f.height / 2], last: [l.right + 4, l.bottom - 2] };
            })()""")
            a, b = (ends["first"], ends["last"]) if direction == "forward" else (ends["last"], ends["first"])
            page.mouse.move(*a)
            page.mouse.down()
            for i in range(1, 21):
                page.mouse.move(a[0] + (b[0] - a[0]) * i / 20, a[1] + (b[1] - a[1]) * i / 20)
                page.wait_for_timeout(15)
                assert page.evaluate("document.querySelector('.imt-dot').hidden"), f"{direction}: dot visible mid-drag"
            page.wait_for_timeout(100)
            assert page.evaluate("document.querySelector('.imt-dot').hidden"), f"{direction}: dot before release"
            page.mouse.up()
            page.locator(".imt-dot").wait_for(state="visible", timeout=3000)
            d = page.evaluate("(() => { const r = document.querySelector('.imt-dot').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
            if direction == "forward":
                # Released right where the dot appears: jiggling on it must not pop the panel.
                page.mouse.move(d[0], d[1])
                page.wait_for_timeout(250)
                assert page.evaluate("document.querySelector('.imt-panel').hidden"), f"{direction}: panel popped on release"
            page.mouse.move(d[0] + 60, d[1] + 40)
            page.mouse.move(d[0], d[1])
            page.wait_for_function("!document.querySelector('.imt-panel').hidden", timeout=2000)
            page.keyboard.press("Escape")
            page.evaluate("getSelection().removeAllRanges()")
            page.mouse.move(5, 5)
        results["drag_select"] = "ok"
        # 7. Selection at the bottom of the viewport: panel flips/pins so it stays fully on screen.
        page.evaluate("document.getElementById('long').scrollIntoView({block: 'end'})")
        select(page, "long")
        page.locator(".imt-dot").hover()
        page.wait_for_function("document.querySelector('.imt-panel p').textContent.startsWith('译(selection)')")
        page.wait_for_timeout(100)
        rect = page.evaluate("(() => { const r = document.querySelector('.imt-panel').getBoundingClientRect(); return [r.top, r.bottom, innerHeight]; })()")
        assert rect[0] >= 0 and rect[1] <= rect[2], rect
        results["panel_in_view"] = rect
        page.keyboard.press("Escape")
        results["ai_calls"] = sum(1 for c in calls if c[0] == "/ai")
        results["chat"] = chat_test(browser, handle, ui)
        results["settings"] = settings_test(browser, handle, ui, status)
        results["webviews"] = webview_test(browser, handle, ui)
        browser.close()
    print(json.dumps(results))
    print("UI DOM TEST PASSED")


if __name__ == "__main__":
    main()
