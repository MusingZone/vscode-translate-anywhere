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


CHAT_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<style>
 .chat-question-list-item { user-select: none; -webkit-user-select: none; display: flex; padding: 6px 8px; }
 .chat-question-list-label { display: flex; flex-direction: column; }
 .chat-confirmation-widget-title { user-select: none; -webkit-user-select: none; }
 .chat-question-answer-collapsible .monaco-button { user-select: none; -webkit-user-select: none; }
 .chat-question-answer-collapsible:not(.chat-question-answer-expandable) > .chat-used-context-label .monaco-button { pointer-events: none; }
</style></head><body style="font:13px sans-serif;width:600px;margin:0">
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
  <div class="chat-question-message" id="qmessage">Choose the workspace that should receive this chat.</div>
  <div class="chat-question-list" role="listbox" tabindex="0">
   <div class="chat-question-list-item" id="qsingle" role="option" aria-selected="false"><span class="chat-question-list-number">1</span><div class="chat-question-list-label" id="qplain">Keep the current workspace</div></div>
   <div class="chat-question-list-item" id="qoption" role="option" aria-selected="false"><span class="chat-question-list-number">2</span><div class="chat-question-list-label"><span class="chat-question-list-label-title" id="q3">Confirm the switch</span><span class="chat-question-list-label-desc" id="qdesc">Move this chat without deleting the old folder</span></div></div>
   <div class="chat-question-list-item multi-select" id="qmulti" role="option" aria-selected="false" tabindex="-1"><input type="checkbox" id="qcheck"><div class="chat-question-list-label" id="qmultiLabel">Remember this choice</div></div>
  </div>
  <div class="chat-question-validation-message" id="qvalidation">Select at least one workspace.</div>
  <div class="chat-question-answer-collapsible"><div class="chat-used-context-label"><button class="monaco-button" id="qsummaryDisabled" aria-disabled="true" tabindex="-1"><span class="chat-question-summary-answer-value" id="qsummaryDisabledText">The freeform answer was saved.</span></button></div></div>
  <div class="chat-question-answer-collapsible chat-question-answer-expandable"><div class="chat-used-context-label"><button class="monaco-button" id="qsummaryExpandable" aria-expanded="false"><span class="chat-question-summary-answer-value" id="qsummaryExpandableText">Review the selected options.</span></button></div></div>
  <div class="chat-question-input-container"><textarea class="chat-question-freeform-textarea" id="qfree">Free form answer</textarea></div>
 </div></div>
 <div class="chat-confirmation-widget"><button class="chat-confirmation-widget-title" id="ctitle" aria-expanded="false"><span class="chat-confirmation-widget-title-inner" id="ctitleText">Allow this tool to continue?</span></button><div class="chat-confirmation-widget-message" id="cmessage">The tool needs permission to read the workspace.</div></div>
 <div class="chat-input-notification-widget"><div class="chat-input-notification-title" id="ntitle">Additional permission required</div></div>
 <div class="monaco-editor"><textarea id="input">chat input</textarea></div>
</div></div>
<p id="outside">Outside chat text paragraph.</p>
<div class="notifications-toasts"><div class="notification-list-item"><div class="notification-list-item-message" id="n1">Extension host terminated unexpectedly three times.</div></div></div>
<div class="monaco-dialog-box"><div class="dialog-message-row"><div class="dialog-message-text" id="d1">Do you want to save the changes you made?</div></div></div>
<div class="monaco-editor"><div class="monaco-hover"><div class="hover-contents" id="eh">Editor hover documentation text</div></div></div>
</body></html>"""


def select_text(page, element_id, start=0, end=None):
    page.evaluate("""([id, a, b]) => { const t = document.getElementById(id).firstChild; const r = document.createRange();
      r.setStart(t, a); r.setEnd(t, b === null ? t.length : b); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""",
                  [element_id, start, end])


def chat_test(browser, handle, ui, status):
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
    page.evaluate("""() => {
      window.optionClicks = 0;
      window.optionNode = document.getElementById('qoption');
      window.optionText = document.getElementById('q3').firstChild;
      window.checkboxNode = document.getElementById('qcheck');
      for (const id of ['qsingle', 'qoption']) document.getElementById(id).addEventListener('click', e => {
        e.currentTarget.setAttribute('aria-selected', 'true'); window.optionClicks++;
      });
      checkboxNode.addEventListener('change', () => document.getElementById('qmulti').setAttribute('aria-selected', String(checkboxNode.checked)));
      document.getElementById('qmulti').addEventListener('click', e => {
        if (e.target !== checkboxNode) checkboxNode.click();
      });
      document.getElementById('qmulti').addEventListener('keydown', e => {
        if (e.code === 'Space') { e.preventDefault(); checkboxNode.click(); }
      });
      window.titleClicks = 0; window.summaryClicks = 0; window.disabledSummaryClicks = 0;
      document.getElementById('ctitle').addEventListener('click', () => titleClicks++);
      document.getElementById('qsummaryExpandable').addEventListener('click', () => summaryClicks++);
      document.getElementById('qsummaryDisabled').addEventListener('click', () => disabledSummaryClicks++);
    }""")
    out = {}
    # VS Code disables selection on each option and submits single-select choices on click.
    # Exercise actual mouse input: a programmatic Range ignores user-select and hid the original bug.
    def drag_question_text(element_id):
        page.locator("#" + element_id).scroll_into_view_if_needed()
        rect = page.locator("#" + element_id).evaluate("""el => {
          const r = document.createRange(); r.selectNodeContents(el);
          const box = r.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
        }""")
        page.mouse.move(rect["x"] + 2, rect["y"] + rect["height"] / 2)
        page.mouse.down()
        page.mouse.move(rect["x"] + rect["width"] - 2, rect["y"] + rect["height"] / 2, steps=12)
        page.mouse.up()
        selection = page.evaluate("getSelection().toString()")
        assert len(selection) > 2, f"{element_id} could not be selected by dragging; clicks={page.evaluate('optionClicks')}"
        page.locator(".imt-dot").wait_for(state="visible", timeout=3000)
        page.locator(".imt-dot").hover()
        page.wait_for_function("document.querySelector('.imt-panel p').textContent.startsWith('译')")
        page.keyboard.press("Escape")

    drag_question_text("qdesc")
    assert page.evaluate("optionClicks === 0 && optionNode.getAttribute('aria-selected') === 'false'"), "drag must not submit a single-select option"
    page.locator("#q3").click()
    assert page.evaluate("optionClicks === 1 && optionNode.getAttribute('aria-selected') === 'true'"), "ordinary option clicks must still work"
    page.evaluate("optionClicks = 0; optionNode.setAttribute('aria-selected', 'false')")
    drag_question_text("qmultiLabel")
    assert not page.locator("#qcheck").is_checked(), "drag must not toggle a multi-select checkbox"
    page.locator("#qmultiLabel").click()
    assert page.locator("#qcheck").is_checked(), "ordinary multi-select clicks must still work"
    page.locator("#qmulti").focus()
    page.keyboard.press("Space")
    assert not page.locator("#qcheck").is_checked(), "keyboard activation must still work"
    drag_question_text("ctitleText")
    assert page.evaluate("titleClicks === 0"), "drag must not toggle the confirmation"
    page.locator("#ctitleText").click()
    assert page.evaluate("titleClicks === 1"), "the confirmation must remain clickable"
    drag_question_text("qsummaryExpandableText")
    assert page.evaluate("summaryClicks === 0"), "drag must not expand the answer summary"
    page.locator("#qsummaryExpandableText").click()
    page.locator("#qsummaryExpandable").press("Enter")
    assert page.evaluate("summaryClicks === 2"), "summary clicks and keyboard activation must still work"
    drag_question_text("qsummaryDisabledText")
    box = page.locator("#qsummaryDisabledText").bounding_box()
    page.mouse.click(box["x"] + 5, box["y"] + box["height"] / 2)
    assert page.evaluate("disabledSummaryClicks === 0"), "a non-expandable summary must remain disabled"
    status["surfaces"] = {"chat": False}
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    page.wait_for_timeout(150)
    assert page.locator("#qdesc").evaluate("el => getComputedStyle(el).userSelect") == "none"
    assert page.locator("#ctitleText").evaluate("el => getComputedStyle(el).userSelect") == "none"
    assert page.locator("#qsummaryDisabledText").evaluate("el => getComputedStyle(el).pointerEvents") == "none"
    page.locator("#q3").click()
    assert page.evaluate("optionClicks === 1"), "disabling Chat translation must restore normal option behavior"
    status.pop("surfaces")
    page.evaluate("optionClicks = 0; optionNode.setAttribute('aria-selected', 'false'); window.dispatchEvent(new Event('focus'))")
    page.wait_for_timeout(150)
    out["real_option_drag"] = "ok"
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
    for element_id in ("q1", "q2", "qplain", "q3", "qdesc", "n1", "d1"):
        page.locator("#" + element_id).scroll_into_view_if_needed()
        page.wait_for_timeout(100)
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
    for element_id in ("q2", "qplain", "q3", "qdesc", "qmultiLabel", "qmessage", "ctitle", "cmessage", "n1",
                       "qsummaryDisabledText", "qsummaryExpandableText"):
        page.locator("#" + element_id).scroll_into_view_if_needed()
        box = page.locator("#" + element_id).bounding_box()
        page.mouse.move(box["x"] + 10, box["y"] + box["height"] / 2)
        page.keyboard.press("Alt+z")
        page.wait_for_function(f"document.querySelector('#{element_id} > .imt-trans:not(.imt-loading)')")
        page.keyboard.press("Alt+z")
        page.wait_for_function(f"!document.querySelector('#{element_id} > .imt-trans')")
    out["question_box_and_workbench_ui"] = "ok"
    # Full-page mode includes option labels, direct-text confirmation roots and arriving questions.
    page.evaluate("""() => {
      const summary = document.createElement('div'); summary.className = 'chat-question-carousel-summary';
      summary.innerHTML = '<div class="chat-question-summary-label" id="qsummaryLabel">Question: Which workspace?</div>' +
        '<div class="chat-question-summary-answer-title" id="qsummaryTitle">Answer: Keep the current workspace</div>' +
        '<div class="chat-question-summary-question"><span class="chat-question-summary-question-value" id="qsummaryQuestion">Which workspace?</span></div>' +
        '<div class="chat-question-summary-decision"><span class="chat-question-summary-answer-value" id="qsummaryAnswer">Keep the current workspace</span></div>' +
        '<ul><li class="chat-question-summary-option"><span class="chat-question-summary-option-label" id="qsummaryOption">Keep the current workspace</span></li></ul>';
      document.querySelector('.chat-question-carousel-container').append(summary);
    }""")
    ids = ["q1", "q2", "qplain", "q3", "qdesc", "qmultiLabel", "qmessage", "qvalidation", "ctitle", "cmessage", "ntitle",
           "qsummaryDisabledText", "qsummaryExpandableText"]
    ids += ["qsummaryLabel", "qsummaryTitle", "qsummaryQuestion", "qsummaryAnswer", "qsummaryOption"]
    original_text = page.evaluate("ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id).textContent]))", ids)
    previous_mode = status["fullPageMode"]
    for mode in ("translationOnly", "bilingual"):
        status["fullPageMode"] = mode
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(150)
        page.locator("#input").focus()
        page.keyboard.press("Alt+w")
        for element_id in ids:
            page.locator("#" + element_id).scroll_into_view_if_needed()
            page.wait_for_function("""([id, mode]) => {
              const el = document.getElementById(id);
              return mode === 'translationOnly' ? el.dataset.imtPlaced === '1' : !!el.querySelector(':scope > .imt-trans:not(.imt-loading)');
            }""", arg=[element_id, mode], timeout=6000)
        page.locator("#q3 .imt-trans" if mode == "bilingual" else "#q3").click()
        assert page.evaluate("optionClicks === 1 && optionNode === document.getElementById('qoption') && optionNode.getAttribute('aria-selected') === 'true'")
        page.locator("#qmultiLabel .imt-trans" if mode == "bilingual" else "#qmultiLabel").click()
        assert page.evaluate("checkboxNode === document.getElementById('qcheck') && checkboxNode.checked")
        assert page.locator("#qmulti").get_attribute("aria-selected") == "true"
        assert page.locator("#qfree").input_value() == "Free form answer"
        assert page.locator(".chat-question-list-number").all_text_contents() == ["1", "2"]
        page.evaluate("""() => {
          const el = document.createElement('div'); el.id = 'qnew'; el.className = 'chat-question-list-label';
          el.textContent = 'Newly arrived question option'; document.querySelector('.chat-question-list').append(el);
        }""")
        page.locator("#qnew").scroll_into_view_if_needed()
        page.wait_for_function("""mode => {
          const el = document.getElementById('qnew');
          return mode === 'translationOnly' ? el.dataset.imtPlaced === '1' : !!el.querySelector('.imt-trans:not(.imt-loading)');
        }""", arg=mode, timeout=6000)
        original_text["qnew"] = "Newly arrived question option"
        page.locator("#input").focus()
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelectorAll('.imt-trans,.imt-only,[data-imt-placed]').length === 0")
        assert page.evaluate("document.getElementById('q3').firstChild === optionText && optionText.data === 'Confirm the switch'")
        assert page.locator("#qdesc").inner_text() == "Move this chat without deleting the old folder"
        restored = page.evaluate("ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id).textContent]))", list(original_text))
        assert restored == original_text, {key: (original_text[key], restored[key]) for key in original_text if original_text[key] != restored[key]}
        del original_text["qnew"]
        page.evaluate("document.getElementById('qnew').remove(); optionClicks = 0")
        page.locator("#qcheck").uncheck()
    status["fullPageMode"] = previous_mode
    out["question_options_full_page"] = "ok"
    # A supported root can itself be the paragraph, not just contain paragraphs.
    status["fullPageMode"] = "translationOnly"
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    page.wait_for_timeout(150)
    page.evaluate("""() => {
      const view = document.createElement('div'); view.className = 'search-view';
      view.innerHTML = '<div class="message" id="viewMessage" tabindex="0">No search results were found.</div>';
      document.body.append(view);
      const hover = document.createElement('div'); hover.className = 'workbench-hover-container';
      hover.innerHTML = '<div class="hover-contents" id="hoverMessage">More information about this action.</div>';
      document.body.append(hover);
    }""")
    page.locator("#viewMessage").focus()
    page.keyboard.press("Alt+w")
    for element_id in ("viewMessage", "hoverMessage"):
        page.locator("#" + element_id).scroll_into_view_if_needed()
        page.wait_for_function("id => document.getElementById(id).dataset.imtPlaced === '1'", arg=element_id)
    page.keyboard.press("Alt+w")
    assert page.locator("#viewMessage").inner_text() == "No search results were found."
    assert page.locator("#hoverMessage").inner_text() == "More information about this action."
    assert page.locator("#eh").inner_text() == "Editor hover documentation text"
    status["fullPageMode"] = previous_mode
    out["workbench_direct_text"] = "ok"
    page.close()
    return out


SETTINGS_PAGE = """<!doctype html><html><head><meta charset="utf-8"></head><body style="font:13px sans-serif;width:700px;margin:0">
<div class="settings-editor"><div class="setting-item">
 <div class="setting-item-title">Editor: Word Wrap</div>
 <div class="setting-item-description"><div class="setting-item-markdown" id="s1"><p id="s1p">Controls how lines should wrap in the editor.</p></div></div>
 <div class="setting-item-description" id="splain">Plain text setting description without Markdown.</div>
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
    box = page.locator("#splain").bounding_box()
    page.mouse.move(box["x"] + 5, box["y"] + box["height"] / 2)
    page.keyboard.press("Alt+z")
    page.wait_for_function("document.querySelector('#splain > .imt-trans:not(.imt-loading)')")
    page.keyboard.press("Alt+z")
    page.wait_for_function("!document.querySelector('#splain > .imt-trans')")
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


# A third-party extension webview with arbitrary markup (modelled on Update Companion's hub).
EXTENSION_WEBVIEW = """<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-hub'; script-src 'nonce-hub'">
<title>Some extension</title><style nonce="hub">body{font:16px sans-serif} pre.en-text{white-space:pre-wrap} .layer span{color:transparent}</style></head><body>
<main id="main" class="wrap">
<div class="banner" id="banner"><span class="grow">Showing the English structure for now.</span><button id="short">Generate Now</button></div>
<article class="card"><button class="title" id="title" aria-expanded="false">Improve your editor experience</button>
<p id="summary">Pick a feature that suits your workspace.</p>
<pre class="en-text" id="detail">Read the original feature description here.</pre>
<ul><li><div id="item">Review the change before you accept it.</div></li></ul>
<div id="spans"><span>Wrapped words</span> <span>inside plain spans.</span></div>
<div class="layer" id="overlay"><span>Invisible overlay text like a PDF text layer.</span></div>
<textarea id="note">Private note text</textarea><pre id="code">some code stays untouched</pre></article>
</main>
<script nonce="hub">
const title = document.querySelector('#title');
title.addEventListener('click', () => title.setAttribute('aria-expanded', 'true'));
</script></body></html>"""
# A webview whose CSP allows no inline styles at all: no nonce, no 'unsafe-inline'.
STRICT_WEBVIEW = """<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'">
</head><body><section><div id="summary">Pick a feature that suits your workspace.</div></section></body></html>"""


def extension_webview_test(browser, handle, ui, status):
    content = {"html": EXTENSION_WEBVIEW}

    def route(r):
        if "/pre?" in r.request.url:
            body = WEBVIEW_PRELOAD.replace("SANDBOX", json.dumps("allow-same-origin allow-scripts"))
            # Escape the nested closing script tag in the preload's JS string.
            return r.fulfill(content_type="text/html", body=body.replace("CONTENT", json.dumps(content["html"]).replace("<", "\\u003c")))
        if "/fake.html" in r.request.url:
            return r.fulfill(content_type="text/html", body="<!doctype html><html><head></head><body></body></html>")
        return handle(r)

    page = browser.new_page(viewport={"width": 900, "height": 600})
    page.route(ORIGIN + "/**", route)

    def open_hub(owner, html=EXTENSION_WEBVIEW):
        content["html"] = html
        page.goto(f"{ORIGIN}/pre?extensionId={owner}")
        frame = page.frame_locator("#active-frame")
        frame.locator("#summary").wait_for()
        page.add_script_tag(content=f"({ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
        return frame

    # This extension's own sidebar webview is a settings form and stays untouched.
    own = open_hub("MusingZone.vscode-translate-anywhere")
    own.locator("#summary").hover()
    page.keyboard.press("Alt+w")
    page.wait_for_timeout(300)
    assert own.locator(".imt-dot,.imt-trans").count() == 0

    strict = open_hub("other.strict-csp", STRICT_WEBVIEW)
    strict.locator(".imt-dot").wait_for(state="attached", timeout=4000)
    assert strict.locator(".imt-dot").evaluate("(el) => getComputedStyle(el).position") == "fixed", "styles must apply without a nonce"
    strict.locator("#summary").click()
    page.keyboard.press("Alt+w")
    strict.locator("#summary > .imt-trans:not(.imt-loading)").wait_for()

    # Any other extension's webview, identified by nothing but being a webview.
    hub = open_hub("example.other-extension")
    summary = hub.locator("#summary")
    dot = hub.locator(".imt-dot")
    dot.wait_for(state="attached", timeout=4000)
    assert dot.evaluate("(el) => getComputedStyle(el).position") == "fixed", "CSP must permit the runtime's UI styles"
    box = summary.bounding_box()
    y = box["y"] + box["height"] / 2
    page.mouse.move(box["x"] + 1, y)
    page.mouse.down()
    page.mouse.move(box["x"] + 120, y, steps=10)
    page.mouse.up()
    dot.wait_for(state="visible", timeout=3000)
    page.mouse.move(box["x"] + 180, y)
    dot.hover()
    hub.locator(".imt-panel").get_by_text("译(selection):", exact=False).wait_for(timeout=4000)
    page.keyboard.press("Escape")
    summary.evaluate("el => el.ownerDocument.getSelection().removeAllRanges()")

    title = hub.locator("#title")
    title.hover()
    page.keyboard.press("Alt+z")
    title.locator(".imt-trans:not(.imt-loading)").wait_for()
    title.click()
    assert title.get_attribute("aria-expanded") == "true"
    title.hover()
    page.keyboard.press("Alt+z")
    assert title.inner_text() == "Improve your editor experience"

    note = hub.locator("#note")
    note.focus()
    page.keyboard.press("Alt+w")
    assert hub.locator(".imt-trans").count() == 0
    summary.click()
    page.keyboard.press("Alt+w")
    for selector in ("#title", "#summary", "#detail", "#banner", "#item", "#spans"):
        hub.locator(f"{selector} > .imt-trans:not(.imt-loading)").wait_for()
    assert hub.locator("#short .imt-trans").count() == 0, "short control labels stay as they are"
    assert hub.locator("#overlay .imt-trans").count() == 0, "invisible text layers stay as they are"
    assert hub.locator("#short").is_visible()
    assert note.input_value() == "Private note text"
    assert hub.locator("#code").inner_text() == "some code stays untouched"
    hub.locator("#main").evaluate("el => el.insertAdjacentHTML('beforeend', '<p id=\"later\">A newly loaded review description.</p>')")
    hub.locator("#later > .imt-trans:not(.imt-loading)").wait_for()
    page.keyboard.press("Alt+w")
    assert summary.inner_text() == "Pick a feature that suits your workspace."
    assert hub.locator("#later").inner_text() == "A newly loaded review description."

    page.keyboard.press("Alt+w")
    summary.locator(".imt-trans:not(.imt-loading)").wait_for()
    status["surfaces"] = {"extensionPages": False}
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    summary.locator(".imt-trans").wait_for(state="detached")
    page.keyboard.press("Alt+w")
    assert hub.locator(".imt-trans").count() == 0
    status.pop("surfaces")
    previous_mode = status["fullPageMode"]
    status["fullPageMode"] = "translationOnly"
    with page.expect_response(lambda response: response.url.endswith("/status")):
        page.evaluate("window.dispatchEvent(new Event('focus'))")
    summary.click()
    page.keyboard.press("Alt+w")
    hub.locator("#title[data-imt-placed='1']").wait_for()
    title.click()
    assert title.get_attribute("aria-expanded") == "true"
    page.keyboard.press("Alt+w")
    assert title.inner_text() == "Improve your editor experience"
    status["fullPageMode"] = previous_mode
    page.close()
    return "ok"


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
        results["chat"] = chat_test(browser, handle, ui, status)
        results["settings"] = settings_test(browser, handle, ui, status)
        results["webviews"] = webview_test(browser, handle, ui)
        results["extension_webviews"] = extension_webview_test(browser, handle, ui, status)
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
