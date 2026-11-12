"""Headless DOM test of the injected UI runtime (src/ui.js) against a mocked bridge.

Runs in invisible headless Chrome; no VS Code window is opened.
Usage: py -3.13 tools/ui-dom-test.py
"""
import json
import re
import time
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
<p id="de1">Die Einstellungen werden in der Datei gespeichert und sind für alle Fenster gültig.</p>
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


RELEASE_NOTES = """<!doctype html><html><head><meta charset="utf-8"></head><body style="font:14px sans-serif;width:800px">
<div id="release-notes-tokenization"></div>
<nav id="toc-nav"><div id="toc-title">In this update</div>
 <ul><li id="tl1"><a id="t1" href="#accessibility">Accessibility</a></li><li id="tl2"><a id="t2" href="#editor">Editor experience</a></li></ul></nav>
<h2 id="accessibility">Accessibility</h2>
<p id="rs"><strong>Setting</strong>: <code tabindex="0"><a id="cs" href="command:workbench.action.openSettings?%5B%22workbench.browser.enableRemoteProxy%22%5D" class="codesetting" title="Open setting" aria-role="button"><svg width="10" height="10"></svg><span class="separator"></span><span class="setting-name">workbench.browser.enableRemoteProxy</span></a></code></p>
<p id="rl">Read the <a id="lnk" href="https://code.visualstudio.com/docs">documentation</a> for more details about the proxy.</p>
<p id="rc"><input id="showReleaseNotes" type="checkbox"><label id="lab" for="showReleaseNotes">Show release notes after an update</label></p>
<p id="rb">Press the <button id="btn">Try it now</button> button to start.</p>
<p id="rd">DROPTAG Open the <a id="dl" href="#editor">editor settings</a> to try it.</p>
<p id="rsp">SPACED Use the <a id="sl" href="#editor">new layout</a> today.</p>
<p id="rw"><a id="wl" href="#editor">SWAP Click <b id="wb">here</b></a> to continue.</p>
<p id="lt">Values &lt;= 0 disable the limit entirely.</p>
<h2 id="editor">Editor experience</h2>
<script>
  // Like VS Code's release-notes scroll spy: it keeps references to the ORIGINAL contents anchors.
  window.spy = [...document.querySelectorAll('#toc-nav a[href^="#"]')];
  window.setCurrent = i => spy.forEach((a, j) => j === i ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current'));
  window.clicked = []; window.pressed = 0; window.changed = 0;
  document.addEventListener('click', e => { const a = e.target.closest('a'); if (a) { e.preventDefault(); clicked.push(a.getAttribute('href')); } });
  document.getElementById('btn').addEventListener('click', () => pressed++);
  document.getElementById('showReleaseNotes').addEventListener('change', () => changed++);
</script>
</body></html>"""


def release_notes_test(browser, handle, ui, status):
    """Release Notes: links, setting buttons, the contents navigation and controls survive full-page translation."""
    page = browser.new_page(viewport={"width": 900, "height": 900})

    def route(r):
        if r.request.url.endswith("/rn"):
            return r.fulfill(status=200, content_type="text/html", body=RELEASE_NOTES)
        return handle(r)

    page.route(ORIGIN + "/**", route)
    previous = status["fullPageMode"]
    status["fullPageMode"] = "translationOnly"
    page.goto(ORIGIN + "/rn")
    page.add_script_tag(content=f"({ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
    page.wait_for_timeout(300)
    ids = ["tl1", "tl2", "toc-title", "accessibility", "rs", "rl", "rc", "rb", "rsp", "rw", "lt"]
    page.evaluate(f"""window.orig = Object.fromEntries({json.dumps(ids + ['rd'])}.map(id => [id, document.getElementById(id).innerHTML]));
      window.nodes = Object.fromEntries(['t1','cs','lnk','showReleaseNotes','lab','btn','sl','wl','wb'].map(id => [id, document.getElementById(id)]));""")
    out = {}

    # Translation-only: text replaced in place around the page's own nodes.
    page.keyboard.press("Alt+w")
    page.wait_for_function(f"{json.dumps(ids)}.every(id => document.getElementById(id).dataset.imtPlaced)", timeout=6000)
    assert page.evaluate("Object.entries(nodes).every(([id, n]) => document.getElementById(id) === n && n.isConnected)"), "original nodes kept"
    assert page.evaluate("document.getElementById('t1').textContent") == "Accessibility" and \
        page.evaluate("document.getElementById('tl1').textContent") == "译(markup):Accessibility"
    assert page.evaluate("document.getElementById('toc-title').textContent").startswith("译(paragraph):")
    rs = page.evaluate("document.getElementById('rs').textContent")
    assert rs.startswith("译(markup):Setting: ") and rs.endswith("workbench.browser.enableRemoteProxy"), rs
    assert page.evaluate("document.querySelector('#rs code > a.codesetting') === nodes.cs && document.querySelector('#rs > strong').textContent === 'Setting'")
    assert page.evaluate("document.getElementById('sl').textContent") == "new layout", "tags returned with spaces still match"
    assert page.evaluate("document.getElementById('wb').contains(document.getElementById('wl'))"), "swapped nesting is placed"
    assert page.evaluate("document.getElementById('lt').textContent") == "译(paragraph):Values <= 0 ", "a literal < is sent"
    # The page's own scripts keep working against the original nodes.
    page.evaluate("setCurrent(1)")
    assert page.evaluate("document.querySelector('#toc-nav a[aria-current]') === document.getElementById('t2')")
    page.click("#t1")
    page.click("#cs")
    page.click("#lab")
    page.click("#btn")
    assert page.evaluate("clicked") == ["#accessibility", "command:workbench.action.openSettings?%5B%22workbench.browser.enableRemoteProxy%22%5D"]
    assert page.evaluate("nodes.showReleaseNotes.checked && changed === 1 && pressed === 1")
    # A translation that lost its tags falls back to bilingual: original (with its link) stays visible.
    page.wait_for_function("document.querySelector('#rd > .imt-trans:not(.imt-loading)')")
    assert page.evaluate("!document.getElementById('rd').dataset.imtPlaced && !document.getElementById('rd').classList.contains('imt-only')")
    assert page.evaluate("document.getElementById('dl').getBoundingClientRect().height > 0")
    out["translation_only"] = "ok"
    page.keyboard.press("Alt+w")
    page.wait_for_function("document.querySelectorAll('.imt-trans,.imt-only,[data-imt-placed],[data-imt-src]').length === 0")
    page.evaluate("setCurrent(-1)")  # the scroll-spy state set above is the page's own, not a restore artefact
    diff = page.evaluate("Object.entries(orig).filter(([id, html]) => document.getElementById(id).innerHTML !== html).map(([id, html]) => [id, html, document.getElementById(id).innerHTML])")
    assert not diff, diff
    assert page.evaluate("Object.entries(nodes).every(([id, n]) => document.getElementById(id) === n)")
    out["restore"] = "ok"

    # Bilingual: translated copies keep links and controls; state follows the originals, clicks reach them.
    status["fullPageMode"] = "bilingual"
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    page.wait_for_timeout(150)
    page.keyboard.press("Alt+w")
    page.wait_for_function("['tl1','tl2','rs','rb','rl'].every(id => document.querySelector('#'+id+' > .imt-trans:not(.imt-loading)'))", timeout=6000)
    assert page.evaluate("!!document.querySelector('#rs > .imt-trans code > a.codesetting:not([id])')")
    assert page.evaluate("document.querySelector('#rl > .imt-trans a').getAttribute('href')") == "https://code.visualstudio.com/docs"
    page.evaluate("setCurrent(0)")
    page.wait_for_function("document.querySelector('#tl1 > .imt-trans a').getAttribute('aria-current') === 'location' && !document.querySelector('#tl2 > .imt-trans a').hasAttribute('aria-current')")
    page.click("#rb > .imt-trans button")
    assert page.evaluate("pressed") == 2, "clone button forwards to the page's button"
    page.click("#tl2 > .imt-trans a")
    assert page.evaluate("clicked.at(-1)") == "#editor"
    assert page.evaluate("document.querySelectorAll('.imt-trans [id]').length") == 0, "copies never duplicate ids"
    page.keyboard.press("Alt+w")
    page.wait_for_function("document.querySelectorAll('.imt-trans').length === 0")
    out["bilingual"] = "ok"
    status["fullPageMode"] = previous
    page.close()
    return out


def cross_page_test(browser, handle, ui, select):
    """Two pages (e.g. Chat and a Markdown preview webview) each run their own runtime; a press in one page
    closes the popup open in the other, while losing focus without a VS Code click (alt-tab) keeps it."""
    pages = []
    for _ in range(2):
        page = browser.new_page(viewport={"width": 800, "height": 600})
        page.route(ORIGIN + "/**", handle)
        page.goto(ORIGIN + "/page")
        page.add_script_tag(content=f"({ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
        page.wait_for_timeout(300)
        pages.append(page)
    a, b = pages

    def open_panel():
        select(a, "p1", "performance")
        a.locator(".imt-dot").hover()
        a.wait_for_function("!document.querySelector('.imt-panel').hidden", timeout=2000)

    open_panel()
    a.evaluate("window.dispatchEvent(new Event('blur'))")  # alt-tab: no press anywhere in VS Code
    a.wait_for_timeout(700)
    assert not a.evaluate("document.querySelector('.imt-panel').hidden"), "closed on plain blur"
    a.evaluate("window.dispatchEvent(new Event('focus'))")
    b.mouse.click(400, 500)  # press in the other page, which takes focus from page a
    a.evaluate("window.dispatchEvent(new Event('blur'))")
    a.wait_for_function("document.querySelector('.imt-panel').hidden", timeout=2000)
    for page in pages:
        page.close()
    return "ok"


def main():
    ui = (ROOT / "src" / "ui.js").read_text(encoding="utf-8")
    ui = ui[:ui.rindex("if (typeof module")]  # production injects immersiveUI.toString() only
    calls, vocab, langs, tips = [], set(), [], []
    pointer = {"time": 0, "source": ""}
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
        elif path == "/lookup" and body.get("lang") == "de":
            langs.append((body["text"], "de"))
            found = body["text"] == "Einstellungen"
            data = {"found": found, "word": "einstellung", "phonetic": "", "language": "de",
                    "translation": "n. 设置 shèzhì\nadj. 态度 tàidu" if found else "", "source": "HanDeDict (offline)"}
        elif path == "/lookup":
            langs.append((body["text"], "en"))
            found = body["text"].lower() == "performance"
            data = {"found": found, "word": body["text"], "phonetic": "pə'fɔːməns" if found else "",
                    "translation": "n. 性能" if found else "离线词典未收录", "source": "ECDICT · 离线词典"}
        elif path == "/ai":
            text = body["text"]
            if body["mode"] == "markup":
                # Simulated translator quirks: tags lost entirely, or tags returned with extra spaces.
                if "DROPTAG" in text:
                    text = re.sub(r"<[^>]+>", "", text)
                elif "SPACED" in text:
                    text = re.sub(r"<(/?)([gx])(\d+)(/?)>", r"< \1 \2\3 \4>", text)
                elif "SWAP" in text:
                    text = re.sub(r"g[12]", lambda m: "g2" if m.group() == "g1" else "g1", text)
                data = {"translation": f"译(markup):{text}", "source": "AI · mock"}
            else:
                data = {"translation": f"译({body['mode']}):{text[:12]}", "source": "AI · mock"}
        elif path == "/pointer":
            if body.get("action") == "down" and body.get("source"):
                pointer.update(time=int(time.time() * 1000), source=body["source"])
            data = dict(pointer)
        elif path == "/tip":
            tips.append(body.get("action"))
            data = {"ok": True}
        elif path == "/vocab":
            if body["action"] == "toggle":
                vocab.symmetric_difference_update({body["text"]})
            data = {"saved": body["text"] in vocab}
        else:
            return route.fulfill(status=404, body="{}")
        route.fulfill(status=200, content_type="application/json", body=json.dumps(data, ensure_ascii=False))

    def select(page, element_id, pattern=None):
        # A pending scroll event hides an unopened dot, including in the unchanged baseline runtime.
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
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
        # 3b. A word inside a German paragraph is looked up in the German–Chinese dictionary.
        select(page, "de1", "Einstellungen")
        page.locator(".imt-dot").hover()
        page.wait_for_function("document.querySelector('.imt-panel p').textContent.includes('设置')")
        assert ("Einstellungen", "de") in langs and ("performance", "en") in langs, langs
        assert page.evaluate("document.querySelector('.imt-panel p').textContent").count("\n") == 1, "one line per part of speech"
        results["german_lookup"] = "ok"
        page.keyboard.press("Escape")
        page.evaluate("getSelection().removeAllRanges()")
        # 4. Alt+Z toggles the paragraph under the mouse immediately (no hold), bilingual.
        box = page.locator("#p1").bounding_box()
        page.mouse.move(box["x"] + 5, box["y"] + box["height"] / 2)
        page.keyboard.press("Alt+z")
        page.wait_for_function("document.querySelector('#p1 .imt-trans') && !document.querySelector('#p1 .imt-loading')")
        assert trans(page, "p1") == "译(markup):Improved performance for large workspaces.", trans(page, "p1")
        assert page.evaluate("!!document.querySelector('#p1 > .imt-trans > b')"), "bilingual copy keeps inline formatting"
        assert page.evaluate("!document.getElementById('p1').classList.contains('imt-only')"), "Alt+Z keeps the original"
        assert trans(page, "p2") is None
        page.keyboard.press("Alt+z")
        page.wait_for_timeout(100)
        assert trans(page, "p1") is None
        results["alt_z"] = "ok"
        # 5. Alt+W full page, translation-only (default): text replaced in place using the page's own inline
        #    elements, nested list untouched, original nodes restored exactly.
        page.evaluate("window.orig = { b: document.querySelector('#p1 b'), p1: document.getElementById('p1').innerHTML, li1: document.getElementById('li1').innerHTML }")
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelector('.imt-toast') && document.querySelector('.imt-toast').textContent.includes('仅译文')")
        page.wait_for_function("['h','p1','p2','li1','li2'].every(id => document.getElementById(id).dataset.imtPlaced)")
        assert page.evaluate("document.getElementById('li1').firstChild.data") == "译(paragraph):Outer item t"
        assert page.evaluate("document.getElementById('li1').firstChild.nextSibling.tagName") == "UL"
        assert page.evaluate("document.getElementById('p1').textContent") == "译(markup):Improved performance for large workspaces."
        assert page.evaluate("document.querySelector('#p1 b') === orig.b"), "the page's own <b> is reused"
        assert page.evaluate("document.querySelectorAll('.imt-trans,.imt-only').length") == 0
        assert page.evaluate("document.querySelector('#li2').getBoundingClientRect().height > 0"), "nested list must stay visible"
        assert page.evaluate("!document.getElementById('zh').dataset.imtPlaced && !document.querySelector('#code .imt-trans')")
        assert not page.evaluate("document.getElementById('far').dataset.imtPlaced"), "off-screen paragraph must wait for scroll"
        page.locator("#far").scroll_into_view_if_needed()
        page.wait_for_function("document.getElementById('far').dataset.imtPlaced")
        page.evaluate("window.scrollTo(0, 0)")
        page.evaluate("document.getElementById('p2').insertAdjacentHTML('afterend', '<p id=\"new\">Freshly rendered paragraph.</p>')")
        page.wait_for_function("document.getElementById('new').dataset.imtPlaced")
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelectorAll('.imt-trans,.imt-only,[data-imt-placed],[data-imt-src]').length === 0")
        assert page.evaluate("document.getElementById('p1').innerHTML === orig.p1 && document.querySelector('#p1 b') === orig.b")
        assert page.evaluate("document.getElementById('li1').innerHTML === orig.li1")
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
        page.evaluate("getSelection().removeAllRanges()")
        # 8. Long selection: a one-time hint about the paragraph/page shortcuts; "Translate this paragraph" uses Alt+Z's path.
        page.evaluate("window.scrollTo(0, 0)")
        select(page, "p2")
        page.locator(".imt-dot").hover()
        page.wait_for_function("document.querySelector('.imt-panel p').textContent.startsWith('译(selection)')")
        assert page.evaluate("document.querySelector('.imt-tip').hidden"), "no hint while the extension has not enabled it"
        page.keyboard.press("Escape")
        page.evaluate("getSelection().removeAllRanges()")
        status["tip"] = True
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(150)
        page.mouse.move(5, 5)
        select(page, "p2")
        page.locator(".imt-dot").hover()
        page.wait_for_function("!document.querySelector('.imt-panel').hidden")
        assert page.evaluate("document.querySelector('.imt-tip').hidden"), "short sentences get no hint"
        page.keyboard.press("Escape")
        page.evaluate("getSelection().removeAllRanges()")
        page.evaluate("document.getElementById('long').scrollIntoView({block: 'center'})")
        select(page, "long")
        page.locator(".imt-dot").hover()
        page.wait_for_function("!document.querySelector('.imt-tip').hidden")
        assert page.evaluate("[...document.querySelectorAll('.imt-tip kbd')].map(k => k.textContent)") == ["Alt+Z", "Alt+W"]
        assert ("/tip", None, None) in calls or any(c[0] == "/tip" for c in calls)
        page.locator(".imt-tip-actions button").first.click()
        page.wait_for_function("document.querySelector('#long > .imt-trans:not(.imt-loading)')")
        assert trans(page, "long").startswith("译(paragraph)"), trans(page, "long")
        assert tips == ["used", "shown", "tried"], tips  # "used" once, from the Alt+Z steps above
        page.mouse.move(5, 5)
        select(page, "long")
        page.locator(".imt-dot").hover()
        page.wait_for_function("!document.querySelector('.imt-panel').hidden")
        assert page.evaluate("document.querySelector('.imt-tip').hidden"), "the hint is shown once per page"
        page.keyboard.press("Escape")
        page.evaluate("getSelection().removeAllRanges()")
        page.mouse.move(5, 5)
        box = page.locator("#long").bounding_box()
        page.mouse.move(box["x"] + 5, box["y"] + 5)
        page.keyboard.press("Alt+z")
        page.wait_for_function("!document.querySelector('#long > .imt-trans')")
        status.pop("tip")
        results["tip"] = "ok"
        results["ai_calls"] = sum(1 for c in calls if c[0] == "/ai")
        results["chat"] = chat_test(browser, handle, ui)
        results["settings"] = settings_test(browser, handle, ui, status)
        results["webviews"] = webview_test(browser, handle, ui)
        results["release_notes"] = release_notes_test(browser, handle, ui, status)
        results["cross_page_dismiss"] = cross_page_test(browser, handle, ui, select)
        # New pages get the selected engine from /status; the same flow serves online and AI.
        status["translationEngine"] = "online"
        online_page = browser.new_page(viewport={"width": 900, "height": 700})
        online_page.route(ORIGIN + "/**", handle)
        online_page.goto(ORIGIN + "/page")
        online_page.add_script_tag(content=f"({ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
        online_page.wait_for_timeout(300)
        before = sum(1 for c in calls if c[0] == "/ai")
        select(online_page, "p1", "performance")
        online_page.locator(".imt-dot").hover()
        online_page.wait_for_function("document.querySelector('.imt-panel p').textContent.includes('性能')")
        assert online_page.locator(".imt-ai").inner_text() == "在线翻译"
        assert sum(1 for c in calls if c[0] == "/ai") == before
        online_page.keyboard.press("Escape")
        select(online_page, "p2")
        online_page.locator(".imt-dot").hover()
        online_page.wait_for_function("document.querySelector('.imt-panel p').textContent.startsWith('译(selection)')")
        assert sum(1 for c in calls if c[0] == "/ai") == before + 1
        online_page.keyboard.press("Escape")
        online_page.evaluate("getSelection().removeAllRanges()")
        box = online_page.locator("#p2").bounding_box()
        online_page.mouse.move(box["x"] + 5, box["y"] + 5)
        online_page.keyboard.press("Alt+z")
        online_page.wait_for_function("document.querySelector('#p2 > .imt-trans').textContent.startsWith('译(paragraph)')")
        online_page.keyboard.press("Alt+z")
        online_page.wait_for_function("!document.querySelector('#p2 > .imt-trans')")
        online_page.keyboard.press("Alt+w")
        online_page.wait_for_function("document.querySelector('#p1 > .imt-trans:not(.imt-loading)')")
        assert online_page.locator("#p1").evaluate("el => el.classList.contains('imt-only')") is False
        status["translationEngine"] = "offline"
        online_page.wait_for_timeout(2300)
        online_page.wait_for_function("!document.querySelector('.imt-trans')")
        before = sum(1 for c in calls if c[0] == "/ai")
        select(online_page, "p2")
        online_page.locator(".imt-dot").hover()
        online_page.wait_for_function("document.querySelector('.imt-panel p').textContent.includes('侧边栏')")
        assert not online_page.is_visible(".imt-ai")
        assert sum(1 for c in calls if c[0] == "/ai") == before
        online_page.close()
        results["online_and_offline_engines"] = "ok"
        browser.close()
    print(json.dumps(results))
    print("UI DOM TEST PASSED")


if __name__ == "__main__":
    main()
