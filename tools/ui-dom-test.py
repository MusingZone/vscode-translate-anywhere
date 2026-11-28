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
    # A supported root can itself be the paragraph, not just contain paragraphs, and stays isolated from sibling panes.
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
    page.locator("#viewMessage").scroll_into_view_if_needed()
    page.wait_for_function("document.getElementById('viewMessage').dataset.imtPlaced === '1'")
    page.wait_for_timeout(200)
    assert page.evaluate("!document.getElementById('hoverMessage').dataset.imtPlaced && !document.querySelector('#hoverMessage .imt-trans')"), \
        "focusing a search-view message must not translate a separate hover card"
    page.keyboard.press("Alt+w")
    assert page.locator("#viewMessage").inner_text() == "No search results were found."
    page.locator("#hoverMessage").scroll_into_view_if_needed()
    box = page.locator("#hoverMessage").bounding_box()
    page.mouse.click(box["x"] + 10, box["y"] + box["height"] / 2)
    page.keyboard.press("Alt+w")
    page.wait_for_function("document.getElementById('hoverMessage').dataset.imtPlaced === '1'")
    assert page.evaluate("!document.getElementById('viewMessage').dataset.imtPlaced")
    page.keyboard.press("Alt+w")
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


MIGRATION_AND_SURFACES_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; font: 13px sans-serif; user-select: none; -webkit-user-select: none; }
  .monaco-list.mouse-support { user-select: none; -webkit-user-select: none; }
  .ai-customization-group-header { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; -webkit-user-select: none; }
  .ai-customization-management-editor .ai-customization-embedded-detail { user-select: text; -webkit-user-select: text; }
  .chat-customization-migration-notice { display: flex; align-items: center; gap: 8px; padding: 6px 12px; }
  .chat-customization-migration-notice-content { flex: 1; display: flex; flex-wrap: wrap; column-gap: 8px; row-gap: 2px; }
  .monaco-dialog-box .dialog-message-container { user-select: text; -webkit-user-select: text; }
  .monaco-dialog-box .dialog-checkbox-message { cursor: pointer; user-select: none; -webkit-user-select: none; }
  .gettingStartedContainer { user-select: initial; -webkit-user-select: initial; }
  .agent-sessions-get-started { user-select: none; -webkit-user-select: none; }
  .agent-sessions-get-started .get-started-item-description { user-select: text; -webkit-user-select: text; }
</style></head><body style="width:860px">
<div class="interactive-session">
  <div class="chat-welcome-view-container"><div class="chat-welcome-view">
    <div class="chat-welcome-view-title" id="cwTitle">Build with Agent</div>
    <div class="chat-welcome-view-disclaimer" id="cwDisclaimer">AI-generated responses may contain mistakes.</div>
  </div></div>
  <div class="interactive-input-part">
    <div class="chat-customization-migration-notice-container chat-input-stack-standalone">
      <div class="chat-customization-migration-notice" role="group" aria-label="Customization migrations">
        <div class="chat-customization-migration-notice-content" id="migNotice">
          <span id="migNoticeText">1 customization needs an update to keep working.</span>
          <a class="monaco-link" id="migReviewLink" tabindex="0" href="command:aiCustomization.openManagementEditor">Review Migrations</a>
        </div>
        <div class="monaco-action-bar"><ul class="actions-container"><li class="action-item"><a class="action-label codicon codicon-close" id="migDismiss" role="button" aria-label="Dismiss Migration Notice for This Workspace">Dismiss</a></li></ul></div>
      </div>
    </div>
    <div class="chat-input-toolbars"><span id="modelPickerLabel">GPT-4o mini</span></div>
    <div class="monaco-editor"><textarea id="chatEditorInput">ask something</textarea></div>
  </div>
</div>

<div class="agent-sessions-get-started">
  <div class="get-started-header"><div class="get-started-toggle" id="gsToggle" role="button" tabindex="0"><span class="get-started-title" id="gsTitle">Get started with Agents</span></div></div>
  <div class="get-started-item-details"><div class="get-started-item-description" id="gsDesc">Connect a repository to run background coding tasks.</div></div>
</div>
<div class="no-agent-host-empty-state">
  <h2 class="no-agent-host-title" id="nahTitle">No agent host connected</h2>
  <p class="no-agent-host-description" id="nahDesc">Run <code id="nahCode">code tunnel</code> to connect this machine. <a class="no-agent-host-link" id="nahLink" href="https://aka.ms/VSCode/Agents/docs">Learn more</a></p>
</div>

<div class="ai-customization-management-editor">
  <div class="management-sidebar">
    <button class="sidebar-home-button" id="sideHome" type="button"><span class="sidebar-home-label">Overview</span></button>
    <div class="monaco-list mouse-support"><div class="monaco-list-row" role="listitem"><div class="section-list-item"><div class="section-label" id="sideAgents">Agents</div></div></div></div>
    <div class="sidebar-migration-shortcut"><button class="sidebar-migration-button" id="sideMigBtn" type="button"><span class="sidebar-migration-label">Migrations</span><span class="sidebar-migration-count">1</span></button></div>
  </div>
  <div class="management-content"><div class="content-inner">
    <div class="prompt-migration-content-container"><div class="customization-migration-dashboard">
      <div class="migration-page">
        <div class="migration-page-header" id="migHeader">
          <div class="migration-page-title-row">
            <h1 id="migH1" tabindex="-1">Keep your customizations working</h1>
            <div class="migration-page-title-actions"><button class="monaco-button migration-secondary-button" id="migAgentBtn" type="button">Migrate with Agent</button></div>
          </div>
          <p class="migration-intro" id="migIntro">Copilot's new agent runtime uses different formats and locations for some customizations.</p>
          <a class="monaco-link" id="migLearnLink" role="link" tabindex="0" href="https://aka.ms/vscode-migrate-customizations">Learn About Migrations</a>
        </div>
        <section class="mcp-detail-diagnostic-card migration warning migration-warning-banner">
          <div class="mcp-detail-diagnostic-header"><div class="mcp-detail-diagnostic-summary" id="migWarnSummary">Prompt-to-skill conversion changes</div></div>
          <div class="mcp-detail-diagnostic-details"><p class="mcp-detail-diagnostic-message" id="migWarnMsg">Prompt files are converted into skills inside your workspace.</p></div>
        </section>
        <div class="migration-tree customization-tree-container"><div class="monaco-list mouse-support">
          <div class="monaco-list-row" id="migGroupRow" role="treeitem">
            <div class="ai-customization-group-header" id="migGroupHeader">
              <div class="group-label-group">
                <div class="group-title-row"><div class="group-label" id="migGroupLabel">Prompt Files (Workspace)</div><div class="group-count">1</div></div>
                <div class="group-description" id="migGroupDesc"><span class="migration-tree-group-destination" id="migGroupDest">Destination: .github/skills</span></div>
              </div>
              <div class="group-actions"><div class="migration-tree-group-actions"><button class="monaco-button migration-secondary-button" id="migIgnoreBtn" type="button">Ignore</button></div></div>
            </div>
          </div>
          <div class="monaco-list-row" id="migItemRow" role="treeitem">
            <div class="migration-tree-item">
              <div class="migration-tree-item-checkbox"><input type="checkbox" id="migItemCheck" checked></div>
              <div class="migration-tree-item-content">
                <div class="migration-tree-item-header"><div class="migration-tree-item-label" id="migItemFile">legacy-review.prompt.md</div></div>
                <div class="migration-tree-item-metadata"><div class="migration-tree-item-source" id="migItemSource">.github/prompts</div></div>
                <div class="migration-tree-item-changes" id="migItemChanges">Converts prompt file to a skill and disables automatic model invocation</div>
              </div>
              <button class="monaco-button migration-tree-item-review" id="migItemReviewBtn" type="button">Review</button>
            </div>
          </div>
        </div></div>
        <p class="migration-empty" id="migEmpty">No migrations are needed.</p>
        <section class="migration-recoveries">
          <h2 id="migRecTitle">Agent Migration Recovery</h2>
          <p id="migRecDesc">Restore original customization sources from before an agent migration.</p>
        </section>
      </div>
    </div></div>
    <div class="ai-customization-list-widget">
      <div class="organization-policy-notice" role="note"><div class="organization-policy-notice-message" id="orgNotice">Your organization only allows skills from plugins. Other skills are hidden.</div></div>
      <div class="list-empty-state"><div class="empty-state-text" id="emptyTitle">No agents yet</div><div class="empty-state-subtext" id="emptySubtext">Create your first custom agent to get started</div></div>
    </div>
    <div class="monaco-editor"><div class="view-lines" id="custRawEditor">raw customization markdown</div></div>
  </div></div>
</div>

<div class="monaco-dialog-box"><div class="dialog-message-row"><div class="dialog-message-container">
  <div class="dialog-message"><div class="dialog-message-text" id="dlgText">Delete this agent migration backup?</div></div>
  <div class="dialog-checkbox-row"><input type="checkbox" id="dlgCheck"><div class="dialog-checkbox-message" id="dlgCheckLabel">Do not ask me again for this workspace</div></div>
</div></div></div>

<div class="workspace-trust-editor">
  <div class="workspace-trust-header"><div class="workspace-trust-title"><div class="workspace-trust-title-text" id="wtTitle">Restricted Mode is intended for safe code browsing</div></div>
  <div class="workspace-trust-description"><div id="wtDesc1">Some features are disabled until you trust this folder.</div><div id="wtDesc2">You can configure trusted folders in <a class="monaco-link" id="wtLink" href="command:workbench.trust.configure">Settings</a>.</div></div></div>
</div>

<div class="gettingStartedContainer">
  <div class="empty-recent" id="gsEmptyRecent">You have no recent folders, <button class="button-link" id="gsOpenFolderBtn" type="button">open a folder</button> to start.</div>
  <button class="getting-started-step" id="gsStepBtn" type="button"><div class="step-container"><h3 class="step-title" id="gsStepTitle">Choose your color theme</h3><div class="step-description-container"><p id="gsStepDesc">Make the editor feel like home.</p></div></div></button>
</div>

<div class="extension-editor">
  <div class="header"><div class="details"><div class="description" id="extHeaderDesc">Translate text in VS Code surfaces.</div></div></div>
  <div class="body"><div class="content"><div class="feature-Contributions" id="extFeatureDesc">Contributes configuration settings for translation engines.</div></div></div>
</div>

<div class="keybindings-editor"><div class="keybindings-body"><div class="keybindings-table-container"><div class="monaco-list mouse-support"><div class="monaco-list-row" id="kbRow" role="row"><div class="monaco-table-tr"><div class="monaco-table-td" id="kbCommand">View: Toggle Word Wrap</div><div class="monaco-table-td"><span class="monaco-keybinding" id="kbKey">Alt+Z</span></div></div></div></div></div></div></div>
</body></html>"""


def customization_and_surfaces_test(browser, handle, ui, status):
    """Real CSS/DOM regression coverage for the Chat customization migration notice, the Migrations &
    Chat Customizations editor, Agents window views, and workbench surface gaps."""
    page = browser.new_page(viewport={"width": 900, "height": 800}, screen={"width": 900, "height": 800})

    def route(r):
        if r.request.url.endswith("/migrations"):
            return r.fulfill(status=200, content_type="text/html", body=MIGRATION_AND_SURFACES_PAGE)
        return handle(r)

    page.route(ORIGIN + "/**", route)
    page.goto(ORIGIN + "/migrations")
    wb_ui = ui.replace("location.protocol === 'vscode-file:'", "true")
    page.add_script_tag(content=f"({wb_ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
    page.wait_for_timeout(200)
    page.evaluate("""() => {
      window.counts = { review: 0, learn: 0, agent: 0, group: 0, item: 0, dlgCheck: 0, step: 0, openFolder: 0, wtLink: 0, kb: 0 };
      const bind = (id, key, prevent = true) => document.getElementById(id).addEventListener('click', e => {
        if (prevent) e.preventDefault();
        counts[key]++;
      });
      bind('migReviewLink', 'review');
      bind('migLearnLink', 'learn');
      bind('migAgentBtn', 'agent');
      bind('migGroupRow', 'group', false);
      bind('migItemRow', 'item', false);
      bind('gsStepBtn', 'step', false);
      bind('gsOpenFolderBtn', 'openFolder');
      bind('wtLink', 'wtLink');
      bind('kbRow', 'kb', false);
      document.getElementById('dlgCheckLabel').addEventListener('click', () => {
        const c = document.getElementById('dlgCheck'); c.checked = !c.checked; counts.dlgCheck++;
      });
    }""")

    def drag_select(element_id):
        page.evaluate("getSelection().removeAllRanges()")
        page.locator("#" + element_id).evaluate("el => el.scrollIntoView({ block: 'center' })")
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        rect = page.locator("#" + element_id).evaluate("""el => {
          const r = document.createRange(); r.selectNodeContents(el);
          const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height };
        }""")
        y = rect["y"] + rect["height"] / 2
        page.mouse.move(rect["x"] + 2, y)
        page.mouse.down()
        page.mouse.move(rect["x"] + min(rect["width"] - 2, 140), y, steps=10)
        page.mouse.up()
        selected = page.evaluate("getSelection().toString().trim()")
        assert len(selected) >= 3, f"real drag failed to select #{element_id}: {selected!r}"
        page.locator(".imt-dot").wait_for(state="visible", timeout=3000)
        page.mouse.move(5, 5)
        page.locator(".imt-dot").hover()
        page.wait_for_function("!document.querySelector('.imt-panel').hidden && document.querySelector('.imt-panel p').textContent.startsWith('译')")
        page.keyboard.press("Escape")
        page.evaluate("getSelection().removeAllRanges()")

    def refresh():
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(150)

    # 1. Chat migration notice & "Review Migrations" link: real mouse drag-to-select -> red dot, no accidental click.
    drag_select("migNoticeText")
    drag_select("migReviewLink")
    assert page.evaluate("counts.review === 0"), "dragging 'Review Migrations' must not open the editor"
    page.locator("#migReviewLink").click()
    page.locator("#migReviewLink").press("Enter")
    assert page.evaluate("counts.review === 2"), "normal click and Enter on 'Review Migrations' must work"

    # Alt+Z on the migration notice & Agents window views.
    for eid in ("migNoticeText", "cwDisclaimer", "gsTitle", "nahDesc"):
        page.locator("#" + eid).scroll_into_view_if_needed()
        box = page.locator("#" + eid).bounding_box()
        page.mouse.move(box["x"] + 8, box["y"] + box["height"] / 2)
        page.keyboard.press("Alt+z")
        block_id = {"migNoticeText": "migNotice", "gsTitle": "gsToggle"}.get(eid, eid)
        page.wait_for_function(f"document.querySelector('#{block_id} > .imt-trans:not(.imt-loading)')")
        page.keyboard.press("Alt+z")
        page.wait_for_function(f"!document.querySelector('#{block_id} > .imt-trans')")

    # Alt+W on Chat (both modes): each Chat/Agents container toggles independently, preserves links, ignores chrome/input, restores.
    chat_panes = [
        ("chatEditorInput", ["cwTitle", "cwDisclaimer", "migNotice"], True),
        ("gsDesc", ["gsToggle", "gsDesc"], False),
        ("nahTitle", ["nahTitle", "nahDesc"], False),
    ]
    all_chat_ids = [eid for _, ids, _ in chat_panes for eid in ids]
    chat_orig = page.evaluate("ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id).innerHTML]))", all_chat_ids)
    prev_mode = status["fullPageMode"]
    for mode in ("translationOnly", "bilingual"):
        status["fullPageMode"] = mode
        refresh()
        for trigger_id, target_ids, use_focus in chat_panes:
            if use_focus:
                page.locator("#" + trigger_id).blur()
                page.locator("#" + trigger_id).focus()
            else:
                page.locator("#" + trigger_id).scroll_into_view_if_needed()
                box = page.locator("#" + trigger_id).bounding_box()
                page.mouse.click(box["x"] + 10, box["y"] + box["height"] / 2)
            page.keyboard.press("Alt+w")
            for eid in target_ids:
                page.locator("#" + eid).scroll_into_view_if_needed()
                page.wait_for_function("""([id, m]) => {
                  const el = document.getElementById(id);
                  return m === 'translationOnly' ? el.dataset.imtPlaced === '1' : !!el.querySelector(':scope > .imt-trans:not(.imt-loading)');
                }""", arg=[eid, mode], timeout=6000)
            other_ids = [eid for eid in all_chat_ids if eid not in target_ids]
            page.wait_for_timeout(200)
            for eid in other_ids:
                assert page.evaluate("id => !document.getElementById(id).dataset.imtPlaced && !document.querySelector('#' + id + ' .imt-trans')", eid), \
                    f"Alt+W in {trigger_id} must not translate sibling pane item #{eid}"
            if trigger_id == "chatEditorInput":
                assert page.evaluate("!document.getElementById('migDismiss').dataset.imtPlaced && !document.querySelector('#migDismiss .imt-trans')")
                assert page.evaluate("!document.getElementById('modelPickerLabel').dataset.imtPlaced && !document.querySelector('#modelPickerLabel .imt-trans')")
                page.evaluate("counts.review = 0")
                page.locator("#migNotice .imt-trans a" if mode == "bilingual" else "#migReviewLink").click()
                assert page.evaluate("counts.review === 1"), f"notice link must stay clickable in {mode}"
                page.locator("#chatEditorInput").blur()
                page.locator("#chatEditorInput").focus()
            elif trigger_id == "nahTitle":
                assert page.locator("#nahCode").inner_text() == "code tunnel"
            page.keyboard.press("Alt+w")
            page.wait_for_function("document.querySelectorAll('.imt-trans,.imt-only,[data-imt-placed]').length === 0")
        restored = page.evaluate("ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id).innerHTML]))", all_chat_ids)
        assert restored == chat_orig, restored

    # Surface switch off for Chat restores user-select: none.
    status["surfaces"] = {"chat": False}
    refresh()
    assert page.locator("#migNoticeText").evaluate("el => getComputedStyle(el).userSelect") == "none"
    assert page.locator("#gsTitle").evaluate("el => getComputedStyle(el).userSelect") == "none"
    status.pop("surfaces")
    refresh()

    # 2. Migrations page & Chat Customizations editor: real drag-to-select without triggering tree rows or buttons.
    drag_select("migIntro")
    drag_select("migItemChanges")
    assert page.evaluate("counts.item === 0"), "dragging migration item text must not open the item"
    drag_select("migGroupLabel")
    assert page.evaluate("counts.group === 0"), "dragging group header must not collapse/expand the group"
    drag_select("migAgentBtn")
    assert page.evaluate("counts.agent === 0"), "dragging a short button label must not click the button"
    page.locator("#migAgentBtn").click()
    page.locator("#migItemRow").click()
    assert page.evaluate("counts.agent === 1 && counts.item === 1"), "ordinary button and tree clicks must still work"

    # Alt+Z on Migrations page non-<p> prose.
    for eid in ("migItemChanges", "migWarnSummary", "migEmpty", "emptySubtext"):
        page.locator("#" + eid).scroll_into_view_if_needed()
        box = page.locator("#" + eid).bounding_box()
        page.mouse.move(box["x"] + 8, box["y"] + box["height"] / 2)
        page.keyboard.press("Alt+z")
        page.wait_for_function(f"document.querySelector('#{eid} > .imt-trans:not(.imt-loading)')")
        page.keyboard.press("Alt+z")
        page.wait_for_function(f"!document.querySelector('#{eid} > .imt-trans')")

    # Focus-first Alt+W: with focus in Chat input, hovering the Migrations page still toggles Chat;
    # after clicking (focusing) each workbenchUI pane, Alt+W toggles ONLY that clicked pane.
    mig_ids = ["migH1", "migIntro", "migHeader", "migWarnSummary", "migWarnMsg", "migGroupLabel", "migGroupDesc",
               "migItemChanges", "migEmpty", "migRecTitle", "migRecDesc", "orgNotice", "emptyTitle", "emptySubtext"]
    dlg_ids = ["dlgText", "dlgCheckLabel"]
    wt_ids = ["wtTitle", "wtDesc1", "wtDesc2"]
    wb_ids = mig_ids + dlg_ids + wt_ids
    wb_orig = page.evaluate("ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id).innerHTML]))", wb_ids)
    for mode in ("translationOnly", "bilingual"):
        status["fullPageMode"] = mode
        refresh()
        page.locator("#chatEditorInput").focus()
        page.locator("#migIntro").scroll_into_view_if_needed()
        box = page.locator("#migIntro").bounding_box()
        page.mouse.move(box["x"] + 10, box["y"] + box["height"] / 2)
        page.keyboard.press("Alt+w")
        page.wait_for_function("""m => {
          const el = document.getElementById('migNotice');
          return m === 'translationOnly' ? el.dataset.imtPlaced === '1' : !!el.querySelector(':scope > .imt-trans:not(.imt-loading)');
        }""", arg=mode, timeout=6000)
        assert page.evaluate("!document.getElementById('migIntro').dataset.imtPlaced && !document.querySelector('#migIntro .imt-trans')"), \
            "with focus in Chat, Alt+W must toggle Chat rather than the hovered Migrations page"
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelectorAll('.imt-trans,.imt-only,[data-imt-placed]').length === 0")
        page.mouse.click(box["x"] + 10, box["y"] + box["height"] / 2)
        page.keyboard.press("Alt+w")
        for eid in mig_ids:
            page.locator("#" + eid).scroll_into_view_if_needed()
            page.wait_for_function("""([id, m]) => {
              const el = document.getElementById(id);
              return m === 'translationOnly' ? el.dataset.imtPlaced === '1' : !!el.querySelector(':scope > .imt-trans:not(.imt-loading)');
            }""", arg=[eid, mode], timeout=6000)
        # Sibling workbenchUI panes (dialog, Workspace Trust) must not translate when Migrations is toggled.
        page.wait_for_timeout(200)
        for other in dlg_ids + wt_ids:
            assert page.evaluate("id => !document.getElementById(id).dataset.imtPlaced && !document.querySelector('#' + id + ' .imt-trans')", other), \
                f"toggling Migrations must not leak into #{other}"
        # Bare filenames, paths, left sidebar chrome, short buttons and embedded editors stay untouched.
        for untouched in ("migItemFile", "migItemSource", "sideAgents", "sideHome", "sideMigBtn", "migAgentBtn", "migItemReviewBtn", "custRawEditor"):
            assert page.evaluate(f"!document.getElementById('{untouched}').dataset.imtPlaced && !document.querySelector('#{untouched} .imt-trans')"), untouched
        page.evaluate("counts.learn = 0; counts.wtLink = 0")
        page.locator("#migHeader .imt-trans a" if mode == "bilingual" else "#migLearnLink").click()
        assert page.evaluate("counts.learn === 1"), f"Migrations link must work in {mode}"
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelectorAll('.imt-trans,.imt-only,[data-imt-placed]').length === 0")
        # Dialog and Workspace Trust panes each toggle independently when clicked.
        for trigger_id, pane_ids in [("dlgText", dlg_ids), ("wtTitle", wt_ids)]:
            page.locator("#" + trigger_id).scroll_into_view_if_needed()
            pbox = page.locator("#" + trigger_id).bounding_box()
            page.mouse.click(pbox["x"] + 10, pbox["y"] + pbox["height"] / 2)
            page.keyboard.press("Alt+w")
            for eid in pane_ids:
                page.locator("#" + eid).scroll_into_view_if_needed()
                page.wait_for_function("""([id, m]) => {
                  const el = document.getElementById(id);
                  return m === 'translationOnly' ? el.dataset.imtPlaced === '1' : !!el.querySelector(':scope > .imt-trans:not(.imt-loading)');
                }""", arg=[eid, mode], timeout=6000)
            assert page.evaluate("!document.getElementById('migIntro').dataset.imtPlaced && !document.querySelector('#migIntro .imt-trans')")
            if trigger_id == "wtTitle":
                page.locator("#wtDesc2 .imt-trans a" if mode == "bilingual" else "#wtLink").click()
                assert page.evaluate("counts.wtLink === 1"), f"Workspace Trust link must work in {mode}"
            page.keyboard.press("Alt+w")
            page.wait_for_function("document.querySelectorAll('.imt-trans,.imt-only,[data-imt-placed]').length === 0")
        restored = page.evaluate("ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id).innerHTML]))", wb_ids)
        assert restored == wb_orig, {k: (wb_orig[k], restored[k]) for k in wb_orig if wb_orig[k] != restored[k]}

    # 3. Dialog checkbox, Welcome step button & inline button-link, Extension body tab, and Keybindings table.
    drag_select("dlgCheckLabel")
    assert page.evaluate("counts.dlgCheck === 0 && !document.getElementById('dlgCheck').checked"), "drag must not toggle dialog checkbox"
    page.locator("#dlgCheckLabel").click()
    assert page.evaluate("counts.dlgCheck === 1 && document.getElementById('dlgCheck').checked")

    drag_select("gsStepTitle")
    assert page.evaluate("counts.step === 0"), "dragging walkthrough step button must not activate step"
    page.locator("#gsStepTitle").click()
    assert page.evaluate("counts.step === 1")

    drag_select("kbCommand")
    assert page.evaluate("counts.kb === 0"), "dragging keybinding command must not activate row"

    status["fullPageMode"] = "translationOnly"
    refresh()
    for surface_el, target_ids in [
        ("gsEmptyRecent", ["gsEmptyRecent", "gsStepTitle", "gsStepDesc"]),
        ("extFeatureDesc", ["extHeaderDesc", "extFeatureDesc"]),
        ("kbCommand", ["kbCommand"])
    ]:
        page.locator("#" + surface_el).scroll_into_view_if_needed()
        box = page.locator("#" + surface_el).bounding_box()
        page.mouse.click(box["x"] + 10, box["y"] + box["height"] / 2)
        page.keyboard.press("Alt+w")
        for tid in target_ids:
            page.wait_for_function("id => document.getElementById(id).dataset.imtPlaced === '1'", arg=tid, timeout=4000)
        if surface_el == "gsEmptyRecent":
            page.locator("#gsOpenFolderBtn").click()
            assert page.evaluate("counts.openFolder === 1"), "inline button-link must stay in place and clickable"
        assert page.locator("#kbKey").inner_text() == "Alt+Z"
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelectorAll('[data-imt-placed]').length === 0")

    # Surface switch off for workbenchUI restores user-select: none on the Migrations page and dialogs.
    status["surfaces"] = {"workbenchUI": False}
    refresh()
    assert page.locator("#migIntro").evaluate("el => getComputedStyle(el).userSelect") == "none"
    assert page.locator("#migItemChanges").evaluate("el => getComputedStyle(el).userSelect") == "none"
    assert page.locator("#dlgCheckLabel").evaluate("el => getComputedStyle(el).userSelect") == "none"
    status.pop("surfaces")
    status["fullPageMode"] = prev_mode
    page.close()
    return "ok"


THREE_PANE_WORKBENCH_PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.4 sans-serif; user-select: none; -webkit-user-select: none; }
  .part.titlebar { display: flex; align-items: center; gap: 10px; height: 28px; padding: 0 8px; border-bottom: 1px solid #444; }
  .menubar { display: flex; gap: 6px; }
  .workbench-main { display: flex; width: 100%; height: 280px; }
  .part.sidebar { width: 160px; border-right: 1px solid #444; padding: 6px; }
  .part.editor { flex: 1; display: flex; min-width: 0; }
  .editor-group-container { flex: 1; display: flex; flex-direction: column; min-width: 0; border-right: 1px solid #444; }
  .title.tabs { display: flex; justify-content: space-between; align-items: center; height: 26px; padding: 0 6px; border-bottom: 1px solid #333; }
  .editor-container, .editor-instance { flex: 1; min-height: 0; padding: 6px; overflow: auto; }
  .part.auxiliarybar { width: 260px; display: flex; flex-direction: column; }
  .pane { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .pane-header { display: flex; justify-content: space-between; align-items: center; height: 26px; padding: 0 6px; border-bottom: 1px solid #333; }
  .pane-body, .chat-viewpane, .interactive-session { flex: 1; min-height: 0; }
  .interactive-session { padding: 6px; }
  iframe.webview { width: 100%; height: 210px; border: 0; display: block; }
  .secondary-row { display: flex; gap: 8px; padding: 8px; border-top: 1px solid #444; }
  .secondary-row > * { flex: 1; border: 1px solid #333; padding: 6px; }
  .quick-input-widget { position: fixed; top: 32px; left: 260px; width: 320px; padding: 6px; background: #222; color: #eee; border: 1px solid #666; z-index: 20; }
  .context-view { position: fixed; top: 32px; left: 600px; background: #222; color: #eee; border: 1px solid #666; z-index: 20; }
</style></head><body>
<div class="monaco-workbench">
  <div class="part titlebar">
    <div class="menubar" role="menubar">
      <button class="menubar-menu-button" id="menubarBtn" type="button" role="menuitem">File</button>
    </div>
    <div class="command-center"><button id="cmdCenterBtn" type="button">Search commands</button></div>
  </div>
  <div class="quick-input-widget" id="cmdPalette">
    <input class="input" id="quickInput" value="Translate command">
    <div class="quick-input-list"><p id="cmdPaletteDesc">Command palette description must stay untouched.</p></div>
  </div>
  <div class="context-view" id="ctxView">
    <div class="monaco-menu-container"><div class="monaco-menu" role="menu">
      <button id="ctxMenuItem" type="button" role="menuitem">Copy Selection</button>
    </div></div>
  </div>
  <div class="workbench-main">
    <div class="part sidebar">
      <div class="pane">
        <div class="pane-header"><span>EXPLORER</span></div>
        <div class="pane-body">
          <div class="welcome-view-content" id="sidebarWelcome">
            <p id="sidebarP">You have not yet opened a folder in this sidebar.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="part editor">
      <div class="editor-group-container" id="leftGroup" tabindex="0">
        <div class="title tabs">
          <span class="tab">Read-Only Chat</span>
          <div class="editor-actions"><div class="monaco-toolbar"><div class="monaco-action-bar">
            <button id="leftToolbarBtn" type="button">Split</button>
          </div></div></div>
        </div>
        <div class="editor-container"><div class="editor-instance" id="leftInstance">
          <div class="interactive-session" id="leftChat">
            <div class="monaco-list"><div class="interactive-item-container"><div class="rendered-markdown">
              <p id="leftP1">Read-only chat transcript on the left pane must stay isolated.</p>
              <ul><li id="leftLi1">Archived response bullet inside the left chat editor.</li></ul>
            </div></div></div>
          </div>
        </div></div>
      </div>
      <div class="editor-group-container" id="midGroup" tabindex="0">
        <div class="title tabs">
          <span class="tab">Extension Webview</span>
          <div class="editor-actions"><div class="monaco-toolbar"><div class="monaco-action-bar">
            <button id="midToolbarBtn" type="button">Refresh</button>
          </div></div></div>
        </div>
        <div class="editor-container"><div class="editor-instance" id="midInstance">
          <iframe class="webview ready" id="midWebview" src="/mid-pre?extensionId=example.middle-webview"></iframe>
        </div></div>
      </div>
    </div>
    <div class="part auxiliarybar">
      <div class="pane" id="rightPane">
        <div class="pane-header">
          <span>COPILOT CHAT</span>
          <div class="monaco-toolbar"><div class="monaco-action-bar">
            <button id="rightToolbarBtn" type="button">New Chat</button>
          </div></div>
        </div>
        <div class="pane-body"><div class="chat-viewpane">
          <div class="interactive-session" id="rightChat">
            <div class="monaco-list"><div class="interactive-item-container"><div class="rendered-markdown" id="rightMessages">
              <p id="rightP1">Copilot Chat answer in the right pane should translate alone.</p>
              <ul><li id="rightLi1">Second item in the right Copilot Chat pane.</li></ul>
            </div></div></div>
            <div class="interactive-input-part">
              <div class="chat-input-toolbars"><button id="rightChatToolbarBtn" type="button">Model</button></div>
              <div class="monaco-editor"><textarea id="rightInput">Ask Copilot</textarea></div>
            </div>
          </div>
        </div></div>
      </div>
    </div>
  </div>
  <div class="secondary-row">
    <div class="editor-group-container" id="settingsGroup1" tabindex="0"><div class="editor-instance">
      <div class="settings-editor" id="settingsPane1">
        <div class="setting-item-description"><p id="set1P">First settings pane description text.</p></div>
      </div>
    </div></div>
    <div class="editor-group-container" id="settingsGroup2" tabindex="0"><div class="editor-instance">
      <div class="settings-editor" id="settingsPane2">
        <div class="setting-item-description"><p id="set2P">Second settings pane description text.</p></div>
      </div>
    </div></div>
    <div class="editor-group-container" id="codeGroup" tabindex="0"><div class="editor-instance">
      <div class="monaco-editor" id="codePane"><textarea id="codeInput">const value = 42;</textarea></div>
    </div></div>
    <div class="editor-group-container" id="custGroup" tabindex="0"><div class="editor-instance">
      <div class="ai-customization-management-editor" id="custPane">
        <p id="custP">Chat customizations editor description text.</p>
      </div>
    </div></div>
    <div class="editor-group-container" id="trustGroup" tabindex="0"><div class="editor-instance">
      <div class="workspace-trust-editor" id="trustPane">
        <div class="workspace-trust-description"><p id="trustP">Workspace trust pane description text.</p></div>
      </div>
    </div></div>
    <div class="notifications-toasts" id="toastPane">
      <div class="notification-list-item-message" id="toastP">Notification toast message stays isolated.</div>
    </div>
  </div>
</div>
<script>
  window.addEventListener('message', e => {
    if (e.data?.channel !== 'did-keydown') return;
    const iframe = document.getElementById('midWebview');
    if (document.activeElement !== iframe) return;
    const ev = new KeyboardEvent('keydown', e.data);
    Object.defineProperty(ev, 'target', { get: () => iframe });
    window.dispatchEvent(ev);
  });
</script>
</body></html>"""

MIDDLE_WEBVIEW_CONTENT = """<!doctype html><html><head><meta charset="utf-8">
<style>body{font:13px sans-serif;margin:6px}</style></head><body>
<main id="midMain">
  <p id="midP1">Middle extension webview editor prose must stay isolated from chat panes.</p>
  <button id="midBtn" type="button">Inspect extension webview details</button>
  <textarea id="midNote">Editable note inside webview</textarea>
</main></body></html>"""


def focused_pane_isolation_test(browser, handle, ui, status):
    """Realistic multi-pane regression: left read-only chat editor, middle extension webview editor,
    right Copilot Chat, plus sidebar, split settings, code editor, workbenchUI panes and command UI."""
    page = browser.new_page(viewport={"width": 1200, "height": 820}, screen={"width": 1200, "height": 820})
    safe_ui = ui.replace("</", "<\\/")

    def route(r):
        if r.request.url.endswith("/three-pane"):
            return r.fulfill(status=200, content_type="text/html", body=THREE_PANE_WORKBENCH_PAGE)
        if "/mid-pre?" in r.request.url:
            preload = (
                "<!doctype html><html><body style='margin:0'><script>"
                "const f=document.createElement('iframe');f.id='pending-frame';"
                "f.setAttribute('sandbox','allow-same-origin allow-scripts');"
                "f.src='./fake.html';f.style.cssText='width:100%;height:200px;border:0';"
                "document.body.appendChild(f);"
                "f.contentWindow.addEventListener('DOMContentLoaded',e=>{const d=e.target;"
                "setTimeout(()=>{d.open();d.write(" + json.dumps(MIDDLE_WEBVIEW_CONTENT).replace("<", "\\u003c") + ");d.close();"
                "f.id='active-frame';"
                "f.contentWindow.addEventListener('keydown',ev=>{"
                "window.parent.postMessage({channel:'did-keydown',key:ev.key,code:ev.code,"
                "altKey:ev.altKey,ctrlKey:ev.ctrlKey,shiftKey:ev.shiftKey,metaKey:ev.metaKey,repeat:ev.repeat},'*');"
                "});},0);});"
                f"({safe_ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});"
                "</script></body></html>"
            )
            return r.fulfill(status=200, content_type="text/html", body=preload)
        if "/fake.html" in r.request.url:
            return r.fulfill(status=200, content_type="text/html", body="<!doctype html><html><head></head><body></body></html>")
        return handle(r)

    page.route(ORIGIN + "/**", route)
    page.goto(ORIGIN + "/three-pane")
    wb_ui = ui.replace("location.protocol === 'vscode-file:'", "true")
    page.add_script_tag(content=f"({wb_ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
    page.evaluate("window.wbKeys = []; window.addEventListener('keydown', e => wbKeys.push(e.code + (e.defaultPrevented ? ':consumed' : '')), true)")
    mid_frame = page.frame_locator("#midWebview").frame_locator("#active-frame")
    mid_frame.locator(".imt-dot").wait_for(state="attached", timeout=5000)
    page.wait_for_timeout(250)

    def refresh():
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(150)

    def translated_count(selector):
        return page.evaluate("""sel => {
          const root = document.querySelector(sel);
          if (!root) return -1;
          const hit = el => el.matches('[data-imt-placed],.imt-trans,.imt-only');
          return (hit(root) ? 1 : 0) + root.querySelectorAll('[data-imt-placed],.imt-trans,.imt-only').length;
        }""", selector)

    def mid_translated_count():
        return mid_frame.locator("[data-imt-placed],.imt-trans,.imt-only").count()

    def click_el(selector):
        loc = page.locator(selector)
        loc.scroll_into_view_if_needed()
        box = loc.bounding_box()
        page.mouse.click(box["x"] + min(12, box["width"] / 2), box["y"] + box["height"] / 2)

    def hover_el(selector):
        loc = page.locator(selector)
        loc.scroll_into_view_if_needed()
        box = loc.bounding_box()
        page.mouse.move(box["x"] + min(12, box["width"] / 2), box["y"] + box["height"] / 2)

    def wait_translated(element_id, mode):
        page.wait_for_function("""([id, m]) => {
          const el = document.getElementById(id);
          return m === 'translationOnly' ? el.dataset.imtPlaced === '1' : !!el.querySelector(':scope > .imt-trans:not(.imt-loading)');
        }""", arg=[element_id, mode], timeout=6000)

    prev_mode = status["fullPageMode"]
    right_orig = page.evaluate("['rightP1','rightLi1'].map(id => document.getElementById(id).innerHTML)")
    left_orig = page.evaluate("['leftP1','leftLi1'].map(id => document.getElementById(id).innerHTML)")

    # 1. Exact reported three-pane scenario (both translationOnly and bilingual):
    #    clicking the right Copilot Chat pane and invoking Alt+W translates ONLY the right chat pane.
    for mode in ("translationOnly", "bilingual"):
        status["fullPageMode"] = mode
        refresh()
        click_el("#rightP1")
        # Even if the pointer moves over the left read-only chat editor, the last clicked pane wins.
        hover_el("#leftP1")
        page.keyboard.press("Alt+w")
        wait_translated("rightP1", mode)
        wait_translated("rightLi1", mode)
        page.wait_for_timeout(300)
        assert translated_count("#leftChat") == 0, f"left read-only chat editor leaked in {mode}"
        assert mid_translated_count() == 0, f"middle extension webview leaked in {mode}"
        for other in ("#sidebarWelcome", "#settingsPane1", "#settingsPane2", "#custPane", "#trustPane", "#toastPane", "#codePane", "#cmdPalette"):
            assert translated_count(other) == 0, f"{other} leaked in {mode}"

        # Dynamic content arriving in both chat panes: only the translated right chat pane translates new blocks.
        page.evaluate("""() => {
          const r = document.createElement('p'); r.id = 'rightDyn'; r.textContent = 'Newly streamed right chat paragraph.';
          document.getElementById('rightMessages').append(r);
          const l = document.createElement('p'); l.id = 'leftDyn'; l.textContent = 'Newly added left chat paragraph.';
          document.querySelector('#leftChat .rendered-markdown').append(l);
        }""")
        wait_translated("rightDyn", mode)
        page.wait_for_timeout(300)
        assert translated_count("#leftChat") == 0, f"dynamic content in left chat must stay untranslated in {mode}"

        # Alt+Z paragraph translation in the left pane stays intact while toggling right chat off, then restores independently.
        hover_el("#leftP1")
        page.keyboard.press("Alt+z")
        page.wait_for_function("document.querySelector('#leftP1 > .imt-trans:not(.imt-loading)')", timeout=4000)
        page.keyboard.press("Alt+w")
        page.wait_for_function("(() => { const r = document.getElementById('rightChat'); return r.querySelectorAll('.imt-trans,.imt-only,[data-imt-placed]').length === 0; })()", timeout=4000)
        assert page.evaluate("['rightP1','rightLi1'].map(id => document.getElementById(id).innerHTML)") == right_orig
        assert page.evaluate("document.getElementById('rightDyn').textContent") == "Newly streamed right chat paragraph."
        assert page.evaluate("!!document.querySelector('#leftP1 > .imt-trans:not(.imt-loading)')"), \
            "turning off right chat full-page mode must not clear an Alt+Z paragraph translation in the left pane"
        hover_el("#leftP1")
        page.keyboard.press("Alt+z")
        page.wait_for_function("!document.querySelector('#leftP1 > .imt-trans')")
        page.evaluate("document.getElementById('rightDyn').remove(); document.getElementById('leftDyn').remove();")
        assert page.evaluate("['leftP1','leftLi1'].map(id => document.getElementById(id).innerHTML)") == left_orig

    # 2. Switch clicked pane: left read-only chat editor (non-focusable prose inside focusable editor-group-container),
    #    independent concurrent toggle with right chat, then middle extension webview, plus forwarded keydown guard.
    status["fullPageMode"] = "translationOnly"
    refresh()
    click_el("#leftP1")
    hover_el("#rightP1")
    page.keyboard.press("Alt+w")
    wait_translated("leftP1", "translationOnly")
    wait_translated("leftLi1", "translationOnly")
    page.wait_for_timeout(300)
    assert translated_count("#rightChat") == 0, "clicking left read-only chat must not translate right chat"
    assert mid_translated_count() == 0, "clicking left read-only chat must not translate middle webview"
    # Clicking right chat and toggling it on/off leaves left chat translated until left chat itself is toggled off.
    click_el("#rightP1")
    page.keyboard.press("Alt+w")
    wait_translated("rightP1", "translationOnly")
    assert translated_count("#leftChat") > 0
    page.keyboard.press("Alt+w")
    page.wait_for_function("document.querySelectorAll('#rightChat [data-imt-placed],#rightChat .imt-trans').length === 0")
    assert translated_count("#leftChat") > 0, "restoring right chat must not clear left chat"
    click_el("#leftP1")
    page.keyboard.press("Alt+w")
    page.wait_for_function("document.querySelectorAll('#leftChat [data-imt-placed],#leftChat .imt-trans').length === 0")

    # Click middle extension webview -> only middle webview translates.
    mid_frame.locator("#midP1").click()
    page.keyboard.press("Alt+w")
    mid_frame.locator("#midP1[data-imt-placed='1']").wait_for(timeout=5000)
    mid_frame.locator("#midBtn[data-imt-placed='1']").wait_for(timeout=5000)
    page.wait_for_timeout(300)
    assert translated_count("#leftChat") == 0 and translated_count("#rightChat") == 0, \
        "translating middle extension webview must not leak to chat panes"
    page.keyboard.press("Alt+w")
    mid_frame.locator("#midP1[data-imt-placed='1']").wait_for(state="detached", timeout=4000)
    assert mid_frame.locator("#midP1").inner_text() == "Middle extension webview editor prose must stay isolated from chat panes."

    # Editable textarea inside middle webview forwards unhandled Alt+W to workbench via did-keydown; workbench must ignore it.
    mid_frame.locator("#midNote").focus()
    hover_el("#rightP1")
    page.keyboard.press("Alt+w")
    page.wait_for_timeout(300)
    assert mid_translated_count() == 0 and translated_count("#leftChat") == 0 and translated_count("#rightChat") == 0, \
        "did-keydown forwarded from a focused webview must not translate workbench panes"

    # 3. Command UI focus retention: command palette (click and keyboard focus), context menu, toolbars, and menubar.
    click_el("#rightP1")
    for cmd_ui, use_focus in [
        ("#quickInput", True), ("#quickInput", False), ("#ctxMenuItem", False),
        ("#leftToolbarBtn", False), ("#rightToolbarBtn", False), ("#rightChatToolbarBtn", False), ("#menubarBtn", False),
    ]:
        if use_focus:
            page.locator(cmd_ui).focus()
        else:
            click_el(cmd_ui)
        hover_el("#leftP1")
        page.keyboard.press("Alt+w")
        wait_translated("rightP1", "translationOnly")
        page.wait_for_timeout(200)
        assert translated_count("#leftChat") == 0 and mid_translated_count() == 0 and translated_count("#cmdPalette") == 0, \
            f"command UI {cmd_ui} (focus={use_focus}) must keep rightChat as the sole target"
        page.keyboard.press("Alt+w")
        page.wait_for_function("document.querySelectorAll('#rightChat [data-imt-placed],#rightChat .imt-trans').length === 0")

    # After clicking middle webview, moving focus to command palette must NOT revive the older rightChat pane.
    click_el("#rightP1")
    mid_frame.locator("#midP1").click()
    page.wait_for_timeout(100)
    page.locator("#quickInput").focus()
    hover_el("#rightP1")
    page.keyboard.press("Alt+w")
    page.wait_for_timeout(300)
    assert translated_count("#rightChat") == 0 and translated_count("#leftChat") == 0, \
        "moving from a webview to command palette must not revive a stale workbench pane"

    # After clicking a code editor, Alt+W stays with VS Code and command palette does not revive an older chat pane.
    click_el("#rightP1")
    click_el("#codeInput")
    page.evaluate("wbKeys.length = 0")
    page.keyboard.press("Alt+w")
    page.wait_for_timeout(200)
    assert translated_count("#rightChat") == 0 and "KeyW" in page.evaluate("wbKeys"), page.evaluate("wbKeys")
    page.locator("#quickInput").focus()
    page.keyboard.press("Alt+w")
    page.wait_for_timeout(200)
    assert translated_count("#rightChat") == 0, "command palette after code editor must not revive stale chat pane"

    # 4. Generalized isolation across other pane types: split Settings editors, workbenchUI editors, sidebar & toasts.
    for trigger_id, active_sel, isolated_sels in [
        ("#set2P", "#settingsPane2", ["#settingsPane1", "#rightChat", "#leftChat"]),
        ("#custP", "#custPane", ["#trustPane", "#sidebarWelcome", "#toastPane"]),
        ("#sidebarP", "#sidebarWelcome", ["#custPane", "#trustPane", "#toastPane"]),
        ("#toastP", "#toastPane", ["#custPane", "#trustPane", "#sidebarWelcome"]),
    ]:
        click_el(trigger_id)
        page.keyboard.press("Alt+w")
        wait_translated(trigger_id[1:], "translationOnly")
        page.wait_for_timeout(200)
        for other in isolated_sels:
            assert translated_count(other) == 0, f"translating {active_sel} leaked into {other}"
        page.keyboard.press("Alt+w")
        page.wait_for_function("sel => document.querySelectorAll(sel + ' [data-imt-placed],' + sel + ' .imt-trans').length === 0", arg=active_sel)

    # 5. Selection red-dot translation still works cleanly in adjacent chat panes.
    select_text(page, "rightP1", 0, 7)
    page.locator(".imt-dot").wait_for(state="visible", timeout=3000)
    page.keyboard.press("Escape")
    page.evaluate("getSelection().removeAllRanges()")
    select_text(page, "leftP1", 0, 9)
    page.locator(".imt-dot").wait_for(state="visible", timeout=3000)
    page.keyboard.press("Escape")

    status["fullPageMode"] = prev_mode
    page.close()
    return "ok"


REMEDIATION_WORKBENCH_PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.35 sans-serif; user-select: none; -webkit-user-select: none; }
  .part.titlebar { display: flex; align-items: center; gap: 10px; height: 26px; padding: 0 8px; border-bottom: 1px solid #444; }
  .menubar { display: flex; gap: 6px; }
  .workbench-main { display: flex; width: 100%; height: 260px; }
  .part.editor { flex: 1; display: flex; min-width: 0; }
  .editor-group-container { flex: 1; display: flex; flex-direction: column; min-width: 0; border-right: 1px solid #444; }
  .title.tabs { display: flex; align-items: center; justify-content: space-between; height: 28px; padding: 0 6px; border-bottom: 1px solid #333; }
  .tabs-and-actions-container { display: flex; align-items: center; justify-content: space-between; flex: 1; gap: 6px; }
  .tabs-container { display: flex; align-items: center; gap: 4px; }
  .tab { display: inline-flex; align-items: center; gap: 6px; padding: 2px 6px; border: 1px solid #555; cursor: pointer; }
  .editor-container, .editor-instance { flex: 1; min-height: 0; padding: 6px; overflow: auto; }
  .part.auxiliarybar { width: 260px; display: flex; flex-direction: column; }
  .pane { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .pane-header { display: flex; justify-content: space-between; align-items: center; height: 26px; padding: 0 6px; border-bottom: 1px solid #333; }
  .pane-body, .chat-viewpane, .interactive-session { flex: 1; min-height: 0; }
  .interactive-session { padding: 4px; }
  iframe.webview { width: 100%; height: 190px; border: 0; display: block; }
  .secondary-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; border-top: 1px solid #444; }
  .secondary-row > * { flex: 1 1 360px; border: 1px solid #333; padding: 4px; min-width: 0; }
  .setting-item-description p { margin: 2px 0; }
  .quick-input-widget { position: fixed; bottom: 8px; left: 12px; width: 260px; padding: 4px; background: #222; color: #eee; border: 1px solid #666; z-index: 20; }
  .context-view { position: fixed; bottom: 8px; left: 290px; background: #222; color: #eee; border: 1px solid #666; z-index: 20; }
  .workbench-hover-container { padding: 4px 8px; max-width: 340px; }
</style></head><body>
<div class="monaco-workbench">
  <div class="part titlebar">
    <div class="menubar" role="menubar">
      <button class="menubar-menu-button" id="menubarBtn" type="button" role="menuitem">File</button>
    </div>
    <div class="command-center"><button id="cmdCenterBtn" type="button">Search commands</button></div>
  </div>
  <div class="quick-input-widget" id="cmdPalette">
    <input class="input" id="quickInput" value="Command palette input">
  </div>
  <div class="context-view" id="ctxView">
    <div class="monaco-menu-container"><div class="monaco-menu" role="menu">
      <button id="ctxMenuItem" type="button" role="menuitem">Copy Selection</button>
    </div></div>
  </div>
  <div class="context-view" id="hoverCtxView" style="left:460px">
    <div class="workbench-hover-container" id="hoverCardPane">
      <div class="monaco-hover" id="hoverCard" tabindex="0">
        <div class="hover-contents" id="hoverCardMsg">Workbench hover documentation inside context view.</div>
      </div>
    </div>
  </div>
  <div class="workbench-main">
    <div class="part editor">
      <div class="editor-group-container" id="leftGroup" tabindex="0">
        <div class="title tabs" id="leftTabHeader">
          <div class="tabs-and-actions-container">
            <div class="tabs-container" role="tablist">
              <div class="tab active" id="leftTab" role="tab" tabindex="0" aria-selected="true">
                <span class="tab-label">Read-Only Chat</span>
                <div class="tab-actions"><div class="monaco-action-bar">
                  <a class="action-label" id="leftTabCloseBtn" role="button" tabindex="0">Close</a>
                </div></div>
              </div>
            </div>
            <div id="leftHeaderEmpty" style="flex:1;height:18px"></div>
            <div class="editor-actions"><div class="monaco-toolbar"><div class="monaco-action-bar">
              <button id="leftToolbarBtn" type="button">Split</button>
            </div></div></div>
          </div>
        </div>
        <div class="editor-container"><div class="editor-instance" id="leftInstance">
          <div class="interactive-session" id="leftChat">
            <div class="monaco-list"><div class="interactive-item-container">
              <div class="monaco-toolbar"><div class="monaco-action-bar">
                <button id="leftInnerToolbarBtn" type="button">Copy code</button>
              </div></div>
              <div role="toolbar"><button id="leftRoleToolbarBtn" type="button">Helpful</button></div>
              <div class="rendered-markdown">
                <p id="leftP1">Left read-only chat prose for remediation regression.</p>
                <ul><li id="leftLi1">Left chat bullet item for remediation check.</li></ul>
              </div>
            </div></div>
          </div>
        </div></div>
      </div>
      <div class="editor-group-container" id="midGroup" tabindex="0">
        <div class="title tabs" id="midTabHeader">
          <div class="tabs-and-actions-container">
            <div class="tabs-container" role="tablist">
              <div class="tab active" id="midTab" role="tab" tabindex="0" aria-selected="true">Extension Webview</div>
            </div>
          </div>
        </div>
        <div class="editor-container"><div class="editor-instance" id="midInstance">
          <iframe class="webview ready" id="midWebview" src="/mid-pre?extensionId=example.middle-webview"></iframe>
        </div></div>
      </div>
      <div class="editor-group-container" id="codeGroup" tabindex="0">
        <div class="title tabs" id="codeTabHeader">
          <div class="tabs-and-actions-container">
            <div class="tabs-container" role="tablist">
              <div class="tab active" id="codeTab" role="tab" tabindex="0" aria-selected="true">app.ts</div>
            </div>
          </div>
        </div>
        <div class="editor-container"><div class="editor-instance" id="codeInstance">
          <div class="monaco-editor" id="codePane">
            <div class="find-widget"><div class="monaco-action-bar">
              <button id="codeFindBtn" type="button">Match Case</button>
            </div></div>
            <textarea id="codeInput">const value = 42;</textarea>
          </div>
        </div></div>
      </div>
    </div>
    <div class="part auxiliarybar">
      <div class="pane" id="rightPane">
        <div class="pane-header" id="rightPaneHeader">
          <span id="rightPaneTitle">COPILOT CHAT</span>
          <div class="monaco-toolbar"><div class="monaco-action-bar">
            <button id="rightToolbarBtn" type="button">New Chat</button>
          </div></div>
        </div>
        <div class="pane-body"><div class="chat-viewpane">
          <div class="interactive-session" id="rightChat">
            <div class="monaco-list"><div class="interactive-item-container"><div class="rendered-markdown">
              <p id="rightP1">Right Copilot Chat answer for remediation regression.</p>
              <ul><li id="rightLi1">Right chat bullet item for remediation check.</li></ul>
            </div></div></div>
            <div class="interactive-input-part">
              <div class="chat-input-toolbars"><button id="rightChatToolbarBtn" type="button">Model</button></div>
              <div class="monaco-editor"><textarea id="rightInput">Ask Copilot</textarea></div>
            </div>
          </div>
        </div></div>
      </div>
    </div>
  </div>
  <div class="secondary-row">
    <div class="editor-group-container" id="settingsGroup1" tabindex="0"><div class="editor-instance">
      <div class="settings-editor" id="settingsPane1">
        <div class="monaco-list" id="settings1List">
          <div class="setting-item-description" id="set1Row0"><p id="set1P0">Setting description number zero for queue test.</p></div>
          <div class="setting-item-description" id="set1Row1"><p id="set1P1">Setting description number one for queue test.</p></div>
          <div class="setting-item-description" id="set1Row2"><p id="set1P2">Setting description number two for queue test.</p></div>
          <div class="setting-item-description" id="set1Row3"><p id="set1P3">Setting description number three for queue test.</p></div>
          <div class="setting-item-description" id="set1Row4"><p id="set1P4">Setting description number four for queue test.</p></div>
          <div class="setting-item-description" id="set1Row5"><p id="set1P5">Setting description number five for queue test.</p></div>
          <div class="setting-item-description" id="set1Row6"><p id="set1P6">Setting description number six for queue test.</p></div>
        </div>
      </div>
    </div></div>
    <div class="editor-group-container" id="settingsGroup2" tabindex="0">
      <div class="title tabs" id="settings2TabHeader">
        <div class="tabs-and-actions-container">
          <div class="tabs-container" role="tablist">
            <div class="tab active" id="settings2Tab" role="tab" tabindex="0" aria-selected="true">Settings</div>
          </div>
          <div id="settings2HeaderEmpty" style="flex:1;height:18px"></div>
        </div>
      </div>
      <div class="editor-instance">
        <div class="settings-editor" id="settingsPane2">
          <div class="settings-header">
            <div class="search-container"><div class="suggest-input-container"><div class="monaco-editor" id="settings2SearchEditor">
              <textarea id="settings2SearchInput">Search settings</textarea>
            </div></div></div>
            <div class="settings-target-widget"><div class="monaco-action-bar">
              <a class="action-label" id="settings2TargetTab" role="tab" tabindex="0">Workspace</a>
            </div></div>
          </div>
          <div class="monaco-toolbar"><button id="settings2GearBtn" type="button">Reset Setting</button></div>
          <div class="setting-item-description"><p id="set2P">Second settings pane description text.</p></div>
        </div>
      </div>
    </div>
    <div class="editor-group-container" id="kbGroup" tabindex="0">
      <div class="title tabs" id="kbTabHeader">
        <div class="tabs-and-actions-container">
          <div class="tabs-container" role="tablist">
            <div class="tab active" id="kbTab" role="tab" tabindex="0" aria-selected="true">Keyboard Shortcuts</div>
          </div>
          <div id="kbHeaderEmpty" style="flex:1;height:18px"></div>
        </div>
      </div>
      <div class="editor-instance">
        <div class="keybindings-editor" id="kbPane">
          <div class="keybindings-header">
            <div class="search-container"><div class="suggest-input-container"><div class="monaco-editor" id="kbSearchEditor">
              <textarea id="kbSearchInput">Type to search in keybindings</textarea>
            </div></div></div>
          </div>
          <div class="keybindings-body"><div class="keybindings-table-container"><div class="monaco-list">
            <div class="monaco-list-row" role="row"><div class="monaco-table-tr">
              <div class="monaco-table-td" id="kbCommand">View: Toggle Word Wrap</div>
              <div class="monaco-table-td"><span class="monaco-keybinding">Alt+Z</span></div>
            </div></div>
          </div></div></div>
        </div>
      </div>
    </div>
    <div class="editor-group-container" id="custGroup" tabindex="0">
      <div class="title tabs" id="custTabHeader">
        <div class="tabs-and-actions-container">
          <div class="tabs-container" role="tablist">
            <div class="tab active" id="custTab" role="tab" tabindex="0" aria-selected="true">Chat Customizations</div>
          </div>
          <div id="custHeaderEmpty" style="flex:1;height:18px"></div>
        </div>
      </div>
      <div class="editor-instance">
        <div class="ai-customization-management-editor" id="custPane">
          <div class="management-content"><div class="content-inner">
            <p id="custP">Customizations guidance paragraph for tab targeting test.</p>
            <div class="monaco-editor" id="custRawEditor">
              <div class="find-widget"><div class="monaco-action-bar">
                <button id="custRawFindBtn" type="button">Match Case</button>
              </div></div>
              <textarea id="custRawInput">raw customization markdown</textarea>
            </div>
          </div></div>
        </div>
      </div>
    </div>
    <div class="editor-group-container" id="extGroup" tabindex="0"><div class="editor-instance">
      <div class="extension-editor" id="extPane">
        <div class="header"><div class="details"><div class="description"><p id="extP1">Extension details overview prose.</p></div></div></div>
        <div class="body"><div class="navbar"><div class="monaco-action-bar">
          <a class="action-label" id="extNavTab" role="tab" tabindex="0">Features</a>
        </div></div></div>
      </div>
    </div></div>
    <div class="notifications-toasts" id="toastPane">
      <div class="notification-list-item-message" id="toastP">Notification toast message for detached pane test.</div>
    </div>
  </div>
</div>
</body></html>"""


def focused_pane_remediation_test(browser, handle, ui, status, only=None):
    """Focused behavioral regressions for focused-pane acceptance defects:
    1) intra-pane toolbars vs external command UI;
    2) detached lastPane and detached translated-pane cleanup;
    3) virtualized/detached rows, delayed /ai requests, and queue cancellation;
    4) focusable editor tab and pane/tab header clicks;
    5) Settings/Keybindings search .monaco-editor vs embedded raw code editors;
    6) workbench hover cards inside .context-view vs actual context menus;
    7) virtualized Chat rows detached during settle() 1200ms window."""
    page = browser.new_page(viewport={"width": 1280, "height": 860}, screen={"width": 1280, "height": 860})
    safe_ui = ui.replace("</", "<\\/")

    def route(r):
        if r.request.url.endswith("/remediation-pane"):
            return r.fulfill(status=200, content_type="text/html", body=REMEDIATION_WORKBENCH_PAGE)
        if "/mid-pre?" in r.request.url:
            preload = (
                "<!doctype html><html><body style='margin:0'><script>"
                "const f=document.createElement('iframe');f.id='pending-frame';"
                "f.setAttribute('sandbox','allow-same-origin allow-scripts');"
                "f.src='./fake.html';f.style.cssText='width:100%;height:190px;border:0';"
                "document.body.appendChild(f);"
                "f.contentWindow.addEventListener('DOMContentLoaded',e=>{const d=e.target;"
                "setTimeout(()=>{d.open();d.write(" + json.dumps(MIDDLE_WEBVIEW_CONTENT).replace("<", "\\u003c") + ");d.close();"
                "f.id='active-frame';},0);});"
                f"({safe_ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});"
                "</script></body></html>"
            )
            return r.fulfill(status=200, content_type="text/html", body=preload)
        if "/fake.html" in r.request.url:
            return r.fulfill(status=200, content_type="text/html", body="<!doctype html><html><head></head><body></body></html>")
        return handle(r)

    page.route(ORIGIN + "/**", route)
    page.goto(ORIGIN + "/remediation-pane")
    page.evaluate("""() => {
      const realFetch = window.fetch.bind(window);
      window.__aiGateEnabled = false;
      window.__aiStarts = [];
      window.__aiAborts = [];
      window.__aiGates = [];
      window.__resetAiTracking = (enabled) => {
        window.__aiGateEnabled = !!enabled;
        window.__aiStarts.length = 0;
        window.__aiAborts.length = 0;
        window.__aiGates.length = 0;
      };
      window.__releaseAi = () => {
        while (window.__aiGates.length) window.__aiGates.shift()();
      };
      window.fetch = (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        if (!url.endsWith('/ai')) return realFetch(input, init);
        const body = JSON.parse(init.body || '{}');
        window.__aiStarts.push(body.text);
        if (!window.__aiGateEnabled) return realFetch(input, init);
        const signal = init.signal;
        return new Promise((resolve, reject) => {
          const onAbort = () => {
            window.__aiAborts.push(body.text);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          };
          if (signal?.aborted) return onAbort();
          signal?.addEventListener('abort', onAbort, { once: true });
          window.__aiGates.push(() => {
            signal?.removeEventListener('abort', onAbort);
            if (signal?.aborted) return onAbort();
            resolve(realFetch(input, init));
          });
        });
      };
    }""")
    wb_ui = ui.replace("location.protocol === 'vscode-file:'", "true")
    page.add_script_tag(content=f"({wb_ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
    page.evaluate("window.wbKeys = []; window.addEventListener('keydown', e => wbKeys.push(e.code + (e.defaultPrevented ? ':consumed' : '')), true)")
    mid_frame = page.frame_locator("#midWebview").frame_locator("#active-frame")
    mid_frame.locator(".imt-dot").wait_for(state="attached", timeout=5000)
    page.wait_for_timeout(250)

    def refresh():
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(150)

    def translated_count(selector):
        return page.evaluate("""sel => {
          const root = document.querySelector(sel);
          if (!root) return -1;
          const hit = el => el.matches('[data-imt-placed],.imt-trans,.imt-only');
          return (hit(root) ? 1 : 0) + root.querySelectorAll('[data-imt-placed],.imt-trans,.imt-only').length;
        }""", selector)

    def mid_translated_count():
        return mid_frame.locator("[data-imt-placed],.imt-trans,.imt-only").count()

    def click_el(selector, x_offset=None):
        loc = page.locator(selector)
        loc.scroll_into_view_if_needed()
        box = loc.bounding_box()
        x = box["x"] + (x_offset if x_offset is not None else min(12, box["width"] / 2))
        page.mouse.click(x, box["y"] + box["height"] / 2)

    def hover_el(selector):
        loc = page.locator(selector)
        loc.scroll_into_view_if_needed()
        box = loc.bounding_box()
        page.mouse.move(box["x"] + min(12, box["width"] / 2), box["y"] + box["height"] / 2)

    def wait_any_translated(selectors, timeout_ms=2200):
        page.wait_for_function("""sels => sels.some(sel => {
          const root = document.querySelector(sel);
          return !!root && root.querySelectorAll('[data-imt-placed],.imt-trans:not(.imt-loading)').length > 0;
        })""", arg=selectors, timeout=timeout_ms)

    def toggle_off(selector):
        page.keyboard.press("Alt+w")
        page.wait_for_function(
            "sel => document.querySelectorAll(sel + ' [data-imt-placed],' + sel + ' .imt-trans,' + sel + ' .imt-only').length === 0",
            arg=selector, timeout=4000
        )

    prev_mode = status["fullPageMode"]
    status["fullPageMode"] = "translationOnly"
    refresh()

    try:
        # Probe 1: Intra-pane toolbars must switch target to their owning pane, while external command UI preserves lastPane.
        if only in (None, "intra_pane_toolbars"):
            for btn_sel, expected_pane, stale_pane in [
                ("#leftInnerToolbarBtn", "#leftChat", "#rightChat"),
                ("#leftRoleToolbarBtn", "#leftChat", "#rightChat"),
                ("#settings2TargetTab", "#settingsPane2", "#rightChat"),
                ("#settings2GearBtn", "#settingsPane2", "#rightChat"),
                ("#extNavTab", "#extPane", "#rightChat"),
            ]:
                click_el("#rightP1")
                click_el(btn_sel)
                hover_el("#rightP1")
                page.keyboard.press("Alt+w")
                wait_any_translated([expected_pane, stale_pane], timeout_ms=3000)
                page.wait_for_timeout(300)
                got_expected = translated_count(expected_pane)
                got_stale = translated_count(stale_pane)
                assert got_expected > 0 and got_stale == 0, (
                    f"intra-pane toolbar {btn_sel}: expected {expected_pane}>0 and {stale_pane}==0, "
                    f"got {expected_pane}={got_expected}, {stale_pane}={got_stale}"
                )
                toggle_off(expected_pane)

            # Chat input toolbar inside rightChat switches target away from leftChat.
            click_el("#leftP1")
            click_el("#rightChatToolbarBtn")
            hover_el("#leftP1")
            page.keyboard.press("Alt+w")
            wait_any_translated(["#rightChat", "#leftChat"], timeout_ms=3000)
            page.wait_for_timeout(300)
            assert translated_count("#rightChat") > 0 and translated_count("#leftChat") == 0, (
                f"intra-pane #rightChatToolbarBtn: right={translated_count('#rightChat')}, left={translated_count('#leftChat')}"
            )
            toggle_off("#rightChat")

            # Action bar inside a non-chat code editor clears lastPane (does not preserve stale rightChat).
            click_el("#rightP1")
            click_el("#codeFindBtn")
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(1600)
            assert translated_count("#rightChat") == 0 and translated_count("#leftChat") == 0, (
                f"code editor inline action bar leaked: right={translated_count('#rightChat')}"
            )

            # External command UI (header toolbars, tab-actions, command palette, menu, menubar) preserves last workbench pane.
            click_el("#rightP1")
            for ext_ui in ("#leftToolbarBtn", "#leftTabCloseBtn", "#rightToolbarBtn", "#quickInput", "#ctxMenuItem", "#menubarBtn"):
                click_el(ext_ui)
                hover_el("#leftP1")
                page.keyboard.press("Alt+w")
                wait_any_translated(["#rightChat", "#leftChat"], timeout_ms=3000)
                page.wait_for_timeout(300)
                assert translated_count("#rightChat") > 0 and translated_count("#leftChat") == 0, (
                    f"external command UI {ext_ui} lost rightChat: right={translated_count('#rightChat')}, left={translated_count('#leftChat')}"
                )
                toggle_off("#rightChat")

        # Probe 4 (ordered before destructive Probe 2 so DOM panes remain mounted): editor tab and pane header clicks.
        if only in (None, "tab_and_header_clicks"):
            # Focusable editor tab [role="tab"][tabindex="0"] switches from rightChat to leftChat.
            click_el("#rightP1")
            click_el("#leftTab", x_offset=10)
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(1600)
            assert translated_count("#leftChat") > 0 and translated_count("#rightChat") == 0, (
                f"focusable #leftTab click failed: left={translated_count('#leftChat')}, right={translated_count('#rightChat')}"
            )
            toggle_off("#leftChat")

            # Clicking tab header when .editor-group-container already holds activeElement (no new focusin fires).
            click_el("#leftP1")
            assert page.evaluate("document.activeElement?.id") == "leftGroup"
            click_el("#leftHeaderEmpty")
            assert page.evaluate("document.activeElement?.id") == "leftGroup"
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(1600)
            assert translated_count("#leftChat") > 0 and translated_count("#rightChat") == 0, (
                f"already-focused #leftHeaderEmpty click produced no-op: left={translated_count('#leftChat')}, right={translated_count('#rightChat')}"
            )
            toggle_off("#leftChat")

            # Clicking .pane-header title selects rightChat.
            click_el("#leftP1")
            click_el("#rightPaneTitle")
            hover_el("#leftP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(1600)
            assert translated_count("#rightChat") > 0 and translated_count("#leftChat") == 0, (
                f"#rightPaneTitle header click failed: right={translated_count('#rightChat')}, left={translated_count('#leftChat')}"
            )
            toggle_off("#rightChat")

            # Clicking tabs of webview or code-editor groups clears lastPane and stays a no-op on workbench panes.
            for non_wb_tab in ("#midTab", "#codeTab"):
                click_el("#rightP1")
                click_el(non_wb_tab)
                hover_el("#rightP1")
                page.keyboard.press("Alt+w")
                page.wait_for_timeout(1600)
                assert translated_count("#rightChat") == 0 and translated_count("#leftChat") == 0 and mid_translated_count() == 0, (
                    f"non-workbench tab {non_wb_tab} leaked: right={translated_count('#rightChat')}, mid={mid_translated_count()}"
                )

        # Probe 5: Settings & Keybindings .monaco-editor search widgets + tab/header targeting vs embedded raw code editors.
        if only in (None, "embedded_monaco_panes"):
            # Settings search widget (.suggest-input-container .monaco-editor) focus targets its owning pane, not stale Chat.
            click_el("#rightP1")
            page.locator("#settings2SearchInput").focus()
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(350)
            assert translated_count("#settingsPane2") > 0 and translated_count("#settingsPane1") == 0 and translated_count("#rightChat") == 0, (
                f"Settings search .monaco-editor focus failed: set2={translated_count('#settingsPane2')}, "
                f"set1={translated_count('#settingsPane1')}, right={translated_count('#rightChat')}"
            )
            assert page.locator("#settings2SearchInput").input_value() == "Search settings"
            toggle_off("#settingsPane2")

            # Settings tab and tab-header clicks still resolve when a visible search .monaco-editor is mounted.
            for trigger in ("#settings2Tab", "#settings2HeaderEmpty"):
                click_el("#rightP1")
                click_el(trigger)
                hover_el("#rightP1")
                page.keyboard.press("Alt+w")
                page.wait_for_timeout(350)
                assert translated_count("#settingsPane2") > 0 and translated_count("#rightChat") == 0 and translated_count("#settingsPane1") == 0, (
                    f"Settings {trigger} click failed: set2={translated_count('#settingsPane2')}, right={translated_count('#rightChat')}"
                )
                toggle_off("#settingsPane2")

            # Keyboard Shortcuts search widget focus and tab/header clicks target #kbPane cleanly.
            click_el("#rightP1")
            page.locator("#kbSearchInput").focus()
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(350)
            assert translated_count("#kbPane") > 0 and translated_count("#rightChat") == 0 and translated_count("#settingsPane2") == 0, (
                f"Keybindings search .monaco-editor focus failed: kb={translated_count('#kbPane')}, right={translated_count('#rightChat')}"
            )
            assert page.locator("#kbSearchInput").input_value() == "Type to search in keybindings"
            toggle_off("#kbPane")

            for trigger in ("#kbTab", "#kbHeaderEmpty"):
                click_el("#rightP1")
                click_el(trigger)
                hover_el("#rightP1")
                page.keyboard.press("Alt+w")
                page.wait_for_timeout(350)
                assert translated_count("#kbPane") > 0 and translated_count("#rightChat") == 0, (
                    f"Keybindings {trigger} click failed: kb={translated_count('#kbPane')}, right={translated_count('#rightChat')}"
                )
                toggle_off("#kbPane")

            # Chat Customizations tab/header click targets #custPane even when an embedded raw .monaco-editor is visible,
            # leaving the embedded raw editor untouched.
            for trigger in ("#custTab", "#custHeaderEmpty"):
                click_el("#rightP1")
                click_el(trigger)
                hover_el("#rightP1")
                page.keyboard.press("Alt+w")
                page.wait_for_timeout(350)
                assert translated_count("#custPane") > 0 and translated_count("#rightChat") == 0, (
                    f"Customizations {trigger} click failed: cust={translated_count('#custPane')}, right={translated_count('#rightChat')}"
                )
                assert translated_count("#custRawEditor") == 0 and page.locator("#custRawInput").input_value() == "raw customization markdown"
                toggle_off("#custPane")

            # Focusing/clicking inside #custPane's embedded raw .monaco-editor (or its find toolbar) retains normal
            # code-editor key behavior (Alt+W passes through unconsumed and translates nothing).
            click_el("#custP")
            click_el("#custRawInput")
            page.evaluate("wbKeys.length = 0")
            hover_el("#custP")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(350)
            keys = page.evaluate("wbKeys.slice()")
            assert "KeyW" in keys and "KeyW:consumed" not in keys, f"embedded raw code editor consumed Alt+W: {keys}"
            assert translated_count("#custPane") == 0 and translated_count("#rightChat") == 0, (
                f"embedded raw code editor leaked translation: cust={translated_count('#custPane')}, right={translated_count('#rightChat')}"
            )
            # Moving from embedded raw code editor to Command Palette must not revive #custPane or #rightChat.
            click_el("#quickInput")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(350)
            assert translated_count("#custPane") == 0 and translated_count("#rightChat") == 0
            # Clicking find-bar toolbar inside embedded raw code editor clears stale #rightChat.
            click_el("#rightP1")
            click_el("#custRawFindBtn")
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(1450)
            assert translated_count("#custPane") == 0 and translated_count("#rightChat") == 0, (
                f"embedded raw code editor toolbar leaked: cust={translated_count('#custPane')}, right={translated_count('#rightChat')}"
            )

        # Probe 6: Workbench hover card inside .context-view targets the hover card, while actual context menus retain prior pane.
        if only in (None, "context_view_hover"):
            hover_orig = page.locator("#hoverCardMsg").inner_text()
            click_el("#rightP1")
            click_el("#hoverCardMsg")
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(1450)
            assert translated_count("#hoverCardPane") > 0 and translated_count("#rightChat") == 0, (
                f"hover card inside .context-view leaked to stale Chat: hover={translated_count('#hoverCardPane')}, "
                f"right={translated_count('#rightChat')}"
            )
            toggle_off("#hoverCardPane")
            assert page.locator("#hoverCardMsg").inner_text() == hover_orig

            # Clicking hover card after a non-translatable code editor (lastPane=null) still targets the hover card.
            click_el("#codeInput")
            click_el("#hoverCardMsg")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(350)
            assert translated_count("#hoverCardPane") > 0 and translated_count("#rightChat") == 0, (
                f"hover card after code editor failed: hover={translated_count('#hoverCardPane')}"
            )
            toggle_off("#hoverCardPane")

            # Actual context menu inside .context-view still retains prior workbench pane (both Chat and hover card).
            click_el("#rightP1")
            click_el("#ctxMenuItem")
            hover_el("#hoverCardMsg")
            page.keyboard.press("Alt+w")
            wait_any_translated(["#rightChat", "#hoverCardPane"], timeout_ms=3000)
            page.wait_for_timeout(300)
            assert translated_count("#rightChat") > 0 and translated_count("#hoverCardPane") == 0, (
                f"context menu failed to retain rightChat: right={translated_count('#rightChat')}, hover={translated_count('#hoverCardPane')}"
            )
            toggle_off("#rightChat")

            click_el("#hoverCardMsg")
            click_el("#ctxMenuItem")
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(350)
            assert translated_count("#hoverCardPane") > 0 and translated_count("#rightChat") == 0, (
                f"context menu failed to retain hover card: hover={translated_count('#hoverCardPane')}, right={translated_count('#rightChat')}"
            )
            toggle_off("#hoverCardPane")

        # Probe 7: Virtualized Chat row detached during settle() 1200ms window remains eligible on reinsertion while ON,
        # while toggle-off during settle() keeps the detached row clean and preserves owner/job invariants.
        if only in (None, "chat_settle_detach"):
            row_text = "Virtual chat row detached during settle window."
            page.evaluate("""text => {
              const row = document.createElement('div');
              row.className = 'interactive-item-container';
              row.id = 'rightSettleRow';
              row.innerHTML = `<div class="rendered-markdown"><p id="rightSettleP">${text}</p></div>`;
              document.querySelector('#rightChat .monaco-list').append(row);
            }""", row_text)
            try:
                page.evaluate("window.__resetAiTracking(false)")
                click_el("#rightP1")
                page.keyboard.press("Alt+w")
                page.wait_for_timeout(150)
                page.evaluate("window.__detachedSettleRow = document.getElementById('rightSettleRow'); window.__detachedSettleRow.remove();")
                page.wait_for_timeout(1350)
                assert page.evaluate("document.getElementById('rightP1').dataset.imtPlaced === '1'"), "visible chat row must settle and translate"
                starts_while_detached = page.evaluate("window.__aiStarts.slice()")
                assert not any("detached during settle window" in text for text in starts_while_detached), (
                    f"detached settling chat row must not call /ai while detached: {starts_while_detached}"
                )
                assert page.evaluate("!window.__detachedSettleRow.querySelector('#rightSettleP').dataset.imtSeen"), (
                    "detached settling chat row retained stale data-imt-seen"
                )
                page.evaluate("document.querySelector('#rightChat .monaco-list').append(window.__detachedSettleRow);")
                page.wait_for_function("document.getElementById('rightSettleP')?.dataset.imtPlaced === '1'", timeout=4500)
                toggle_off("#rightChat")
                assert page.locator("#rightSettleP").inner_text() == row_text
                assert page.evaluate("document.querySelectorAll('#rightChat [data-imt-seen],#rightChat [data-imt-placed],#rightChat .imt-trans').length") == 0

                # Owner/job invariant: detach during settle() then toggle Chat OFF before 1200ms expires -> reinsert stays clean.
                page.evaluate("window.__resetAiTracking(false)")
                click_el("#rightP1")
                page.keyboard.press("Alt+w")
                page.wait_for_timeout(150)
                page.evaluate("window.__detachedSettleRow = document.getElementById('rightSettleRow'); window.__detachedSettleRow.remove();")
                page.keyboard.press("Alt+w")
                page.wait_for_timeout(1350)
                page.evaluate("document.querySelector('#rightChat .monaco-list').append(window.__detachedSettleRow);")
                page.wait_for_timeout(600)
                assert not any("detached during settle window" in text for text in page.evaluate("window.__aiStarts.slice()"))
                assert translated_count("#rightChat") == 0
                assert page.locator("#rightSettleP").inner_text() == row_text
                assert page.evaluate("!document.getElementById('rightSettleP').dataset.imtSeen")
            finally:
                page.evaluate("document.getElementById('rightSettleRow')?.remove(); delete window.__detachedSettleRow;")

        # Probe 3: Virtualized/detached rows, delayed /ai requests, and queue cancellation.
        if only in (None, "virtualized_queue"):
            orig_rows = page.evaluate("[0,1,2,3,4,5,6].map(i => document.getElementById('set1P' + i).textContent)")
            for mode in ("translationOnly", "bilingual"):
                status["fullPageMode"] = mode
                refresh()
                page.evaluate("window.__resetAiTracking(true)")
                click_el("#set1P0")
                page.keyboard.press("Alt+w")
                page.wait_for_function("window.__aiStarts.length === 3", timeout=4000)

                # Simulate Monaco list virtualization detaching one in-flight row (#set1Row2) and one queued row (#set1Row6).
                page.evaluate("""() => {
                  window.__detached2 = document.getElementById('set1Row2');
                  window.__detached6 = document.getElementById('set1Row6');
                  window.__detached2.remove();
                  window.__detached6.remove();
                }""")
                # Toggle #settingsPane1 OFF while requests are in-flight and queued.
                page.keyboard.press("Alt+w")
                page.wait_for_timeout(120)
                aborts = page.evaluate("window.__aiAborts.slice()")
                assert any("number two" in text for text in aborts), f"in-flight detached row was not aborted in {mode}: {aborts}"

                # Release any gates and reattach virtualized rows; turned-off pane must remain completely clean.
                page.evaluate("window.__releaseAi()")
                page.wait_for_timeout(250)
                page.evaluate("""() => {
                  const list = document.getElementById('settings1List');
                  list.insertBefore(window.__detached2, document.getElementById('set1Row3'));
                  list.append(window.__detached6);
                }""")
                page.wait_for_timeout(250)
                starts = page.evaluate("window.__aiStarts.slice()")
                assert not any("number six" in text for text in starts), f"queued detached row fired /ai after cancellation in {mode}: {starts}"
                assert translated_count("#settingsPane1") == 0, (
                    f"turned-off settingsPane1 retained translations after row reattach in {mode}: "
                    f"count={translated_count('#settingsPane1')}"
                )
                assert page.evaluate("[0,1,2,3,4,5,6].map(i => document.getElementById('set1P' + i).textContent)") == orig_rows
                assert page.evaluate("document.querySelectorAll('#settingsPane1 [data-imt-seen],#settingsPane1 [data-imt-src]').length") == 0

            # Already-translated row detached before toggle-off is restored cleanly when reattached.
            status["fullPageMode"] = "translationOnly"
            refresh()
            page.evaluate("window.__resetAiTracking(false)")
            click_el("#set1P0")
            page.keyboard.press("Alt+w")
            page.wait_for_function("document.getElementById('set1P0').dataset.imtPlaced === '1'", timeout=4000)
            page.evaluate("window.__detached0 = document.getElementById('set1Row0'); window.__detached0.remove();")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(150)
            page.evaluate("document.getElementById('settings1List').prepend(window.__detached0);")
            page.wait_for_timeout(150)
            assert translated_count("#settingsPane1") == 0, "detached already-translated row must restore when pane toggles off"
            assert page.evaluate("document.getElementById('set1P0').textContent") == orig_rows[0]

            # Queued row detached while pane stays ON skips /ai while detached, then translates cleanly on reattach.
            page.evaluate("window.__resetAiTracking(true)")
            click_el("#set1P0")
            page.keyboard.press("Alt+w")
            page.wait_for_function("window.__aiStarts.length === 3", timeout=4000)
            page.evaluate("window.__detached6 = document.getElementById('set1Row6'); window.__detached6.remove();")
            page.evaluate("window.__aiGateEnabled = false; window.__releaseAi();")
            page.wait_for_function("[0,1,2,3,4,5].every(i => document.getElementById('set1P' + i).dataset.imtPlaced === '1')", timeout=4000)
            starts_while_detached = page.evaluate("window.__aiStarts.slice()")
            assert not any("number six" in text for text in starts_while_detached), (
                f"detached queued row should not spend /ai while off-screen: {starts_while_detached}"
            )
            page.evaluate("document.getElementById('settings1List').append(window.__detached6);")
            page.wait_for_function("document.getElementById('set1P6').dataset.imtPlaced === '1'", timeout=4000)
            toggle_off("#settingsPane1")
            assert page.evaluate("[0,1,2,3,4,5,6].map(i => document.getElementById('set1P' + i).textContent)") == orig_rows

            # Manual Alt+Z single-paragraph translation still works cleanly while full-page mode is OFF.
            hover_el("#rightP1")
            page.keyboard.press("Alt+z")
            page.wait_for_function("document.querySelector('#rightP1 > .imt-trans:not(.imt-loading)')", timeout=4000)
            hover_el("#rightP1")
            page.keyboard.press("Alt+z")
            page.wait_for_function("!document.querySelector('#rightP1 > .imt-trans')", timeout=4000)

            # Detaching an entire pane root mid-flight cancels remaining queue and aborts in-flight jobs.
            page.evaluate("window.__resetAiTracking(true)")
            click_el("#set1P0")
            page.keyboard.press("Alt+w")
            page.wait_for_function("window.__aiStarts.length === 3", timeout=4000)
            page.evaluate("window.__detachedPane1 = document.getElementById('settingsPane1'); window.__detachedPane1.remove();")
            page.evaluate("window.__releaseAi()")
            page.wait_for_timeout(700)
            starts_after_root_detach = page.evaluate("window.__aiStarts.slice()")
            assert not any("number six" in text for text in starts_after_root_detach), (
                f"detached pane root kept pumping queue: {starts_after_root_detach}"
            )
            assert page.evaluate("window.__detachedPane1.querySelectorAll('[data-imt-placed],.imt-trans,.imt-only').length") == 0, (
                "pruneDisconnectedPanes must clear translations on detached pane root"
            )
            page.evaluate("window.__resetAiTracking(false)")

        # Probe 2: Detached lastPane must NOT fall back to hovered(), and detached translated roots must prune cleanly.
        if only in (None, "detached_panes"):
            # 2A: Notification toast dismissed while hovering rightChat.
            click_el("#toastP")
            page.evaluate("document.getElementById('toastPane').remove()")
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(1600)
            assert translated_count("#rightChat") == 0 and translated_count("#leftChat") == 0, (
                f"detached #toastPane fell back to hover: right={translated_count('#rightChat')}, left={translated_count('#leftChat')}"
            )

            # 2B: Read-only Chat tab closed while hovering rightChat (and while focus is in Command Palette).
            click_el("#leftP1")
            page.evaluate("window.__removedLeft = document.getElementById('leftChat'); window.__removedLeft.remove();")
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(1600)
            assert translated_count("#rightChat") == 0, (
                f"detached #leftChat fell back to hovered rightChat: right={translated_count('#rightChat')}"
            )
            page.locator("#quickInput").focus()
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(1600)
            assert translated_count("#rightChat") == 0, (
                f"detached #leftChat + command palette leaked into rightChat: right={translated_count('#rightChat')}"
            )

            # 2C: Translated #settingsPane2 detached -> pruneDisconnectedPanes clears it and clears lastPane.
            click_el("#set2P")
            page.keyboard.press("Alt+w")
            page.wait_for_function("document.getElementById('set2P').dataset.imtPlaced === '1'", timeout=4000)
            page.evaluate("window.__removedSettings2 = document.getElementById('settingsPane2'); window.__removedSettings2.remove();")
            page.wait_for_timeout(700)
            assert page.evaluate("window.__removedSettings2.querySelectorAll('[data-imt-placed],.imt-trans,.imt-only,[data-imt-seen]').length") == 0, (
                "pruneDisconnectedPanes did not clean up detached translated #settingsPane2"
            )
            hover_el("#rightP1")
            page.keyboard.press("Alt+w")
            page.wait_for_timeout(1600)
            assert translated_count("#rightChat") == 0, (
                f"detached translated #settingsPane2 fell back to hovered rightChat: right={translated_count('#rightChat')}"
            )
            # Explicitly clicking rightChat afterwards still works normally.
            click_el("#rightP1")
            page.keyboard.press("Alt+w")
            wait_any_translated(["#rightChat"], timeout_ms=3000)
            assert translated_count("#rightChat") > 0
            toggle_off("#rightChat")
    finally:
        status["fullPageMode"] = prev_mode
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
        results["customization_and_surfaces"] = customization_and_surfaces_test(browser, handle, ui, status)
        results["focused_pane_isolation"] = focused_pane_isolation_test(browser, handle, ui, status)
        results["focused_pane_remediation"] = focused_pane_remediation_test(browser, handle, ui, status)
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
