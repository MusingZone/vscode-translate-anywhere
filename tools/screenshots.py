"""Renders the README screenshots and demo GIF with the real UI runtime (src/ui.js) in headless Chrome.

The pages are VS Code-styled demo pages and the bridge is mocked with canned translations, so the
images are reproducible and contain no personal data. Output: docs/images/<lang>/*.png|gif.

Usage: py -3.13 tools/screenshots.py            (needs node on PATH or NODE=... for the sidebar shot)
"""
import io
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = "http://imt.test"
W, H = 880, 540

STYLE = """
html{--vscode-font-family:'Segoe UI',system-ui,sans-serif;--vscode-editorWidget-background:#202020;--vscode-widget-border:#454545;
 --vscode-editorWidget-foreground:#cccccc;--vscode-textLink-foreground:#4daafc;--vscode-descriptionForeground:#9d9d9d}
body{margin:0;background:#1f1f1f;color:#cccccc;font:14px/1.65 'Segoe UI',system-ui,sans-serif}
.tabs{display:flex;height:35px;background:#181818;border-bottom:1px solid #2b2b2b}
.tab{padding:0 14px;line-height:35px;font-size:13px;color:#9d9d9d;border-right:1px solid #2b2b2b}
.tab.on{background:#1f1f1f;color:#fff;border-top:1px solid #0078d4}
main{padding:14px 44px 40px;max-width:760px}
h1{font-size:26px;font-weight:600;margin:12px 0 4px;color:#e7e7e7}
h2{font-size:18px;font-weight:600;margin:20px 0 6px;color:#e7e7e7;border-bottom:1px solid #2b2b2b;padding-bottom:4px}
p,li{margin:6px 0}
code{font-family:Consolas,monospace;background:#2b2b2b;padding:1px 5px;border-radius:4px;color:#d7ba7d}
a{color:#4daafc;text-decoration:none}
.muted{color:#9d9d9d;font-size:13px}
::selection{background:#264f78}
#cursor{position:fixed;left:0;top:0;width:18px;height:24px;pointer-events:none;z-index:2147483647;transform:translate(-2px,-2px)}
.chat{display:grid;grid-template-columns:1fr 360px;height:100vh}
.chat .editor{background:#1f1f1f;border-right:1px solid #2b2b2b;padding:14px 20px;font:13px/1.6 Consolas,monospace;color:#9cdcfe}
.chat .pane{background:#181818;padding:10px 14px;overflow:hidden}
.interactive-item-container{padding:10px 0;border-bottom:1px solid #2b2b2b}
.who{font-weight:600;font-size:13px;color:#e7e7e7;margin-bottom:4px}
.rendered-markdown p,.rendered-markdown li{font-size:13px}
"""

CURSOR = ('<svg id="cursor" viewBox="0 0 18 24"><path d="M1 1v19l5-4.5 3.4 7.3 3-1.4-3.3-7.1H16z" '
          'fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>')
CURSOR_JS = """addEventListener('mousemove', e => { const c = document.getElementById('cursor');
  c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; document.body.appendChild(c); }, true);"""

KEYCAST = ('<svg id="keycast" viewBox="0 0 120 44" width="120" height="44" style="position:fixed;left:50%;bottom:26px;'
           'margin-left:-60px;display:none;z-index:2147483646;pointer-events:none"><rect x="1" y="1" width="118" height="42" rx="8" '
           'fill="#2b2b2b" stroke="#6b6b6b" stroke-width="1.5"/><text x="60" y="29" text-anchor="middle" fill="#ffffff" '
           'font-family="Segoe UI,sans-serif" font-size="19" font-weight="600"></text></svg>')
KEYCAST_JS = """window.__key = label => { const k = document.getElementById('keycast');
  k.querySelector('text').textContent = label || ''; k.style.display = label ? 'block' : 'none'; document.body.appendChild(k); };"""

# Every step of the demo translates the sentence that explains that step.
TOUR = f"""<!doctype html><html><head><meta charset="utf-8"><style>{STYLE}</style></head><body>
<div id="vscode-markdown-preview-data"></div>
<div class="tabs"><div class="tab">extension.ts</div><div class="tab on">Preview TOUR.md</div><div class="tab">settings.json</div></div>
<main>
<h1 id="title">A quick tour of Translate Anywhere</h1>
<p id="intro" class="muted">Each step below translates the sentence that explains it.</p>
<h2 id="h-word">Look up a word</h2>
<p id="p1">Select a single word, such as vocabulary, and point at the red dot: the offline dictionary explains it instantly.</p>
<h2 id="h-sentence">Translate a sentence</h2>
<p id="p2">Select a whole sentence and point at the red dot, and the AI engine translates it in context.</p>
<h2 id="h-paragraph">Translate a paragraph</h2>
<p id="p3">Point at a paragraph and press the paragraph key: the translation appears in place, and pressing the key again restores the original.</p>
<h2 id="h-page">Translate the whole page</h2>
<p id="p4">Press the full-page key to translate everything you are reading, including content that appears later.</p>
<ul><li id="li1">Links, code and buttons keep working.</li><li id="li2">Press the key again to switch back to the original.</li></ul>
</main>{CURSOR}{KEYCAST}<script>{CURSOR_JS}{KEYCAST_JS}</script></body></html>"""

CHAT = f"""<!doctype html><html><head><meta charset="utf-8"><style>{STYLE}</style></head><body>
<div class="chat"><div class="editor">
<div>{{</div><div>&nbsp;&nbsp;"translateAnywhere.targetLanguage": "zh-CN",</div>
<div>&nbsp;&nbsp;"translateAnywhere.fullPage.mode": "bilingual"</div><div>}}</div></div>
<div class="pane interactive-session"><div class="monaco-list">
 <div class="interactive-item-container"><div class="who">You</div><div class="rendered-markdown"><p>How do I translate an answer in Chat?</p></div></div>
 <div class="interactive-item-container"><div class="who">Copilot</div><div class="rendered-markdown">
  <p id="c1">Select any sentence in this answer and point at the red dot; the translation appears without leaving Chat.</p>
  <p id="c2">To translate the whole conversation, point at it and press the full-page key. Code blocks stay exactly as they are.</p>
 </div></div></div></div></div>{CURSOR}<script>{CURSOR_JS}</script></body></html>"""

DICT = {
    "vocabulary": {"phonetic": "vəˈkæbjələri", "translation": "n. 词汇；词汇量；词汇表"},
}
AI = {
    "extension.ts": "extension.ts", "Preview TOUR.md": "预览 TOUR.md", "settings.json": "settings.json",
    "A quick tour of Translate Anywhere": "Translate Anywhere 快速导览",
    "Each step below translates the sentence that explains it.": "下面每一步都会翻译讲解这一步的那句话。",
    "Look up a word": "查单词",
    "Select a single word, such as vocabulary, and point at the red dot: the offline dictionary explains it instantly.":
        "选中一个单词（例如 vocabulary），再指向小红点：离线词典会立即给出释义。",
    "Translate a sentence": "翻译句子",
    "Select a whole sentence and point at the red dot, and the AI engine translates it in context.":
        "选中一整句话再指向小红点，AI 引擎会结合上下文翻译它。",
    "Translate a paragraph": "翻译段落",
    "Point at a paragraph and press the paragraph key: the translation appears in place, and pressing the key again restores the original.":
        "指向一个段落并按下段落快捷键：译文直接显示在原处，再按一次即恢复原文。",
    "Translate the whole page": "翻译整页",
    "Press the full-page key to translate everything you are reading, including content that appears later.":
        "按下全文快捷键即可翻译正在阅读的全部内容，之后新出现的内容也会翻译。",
    "Links, code and buttons keep working.": "链接、代码和按钮照常可用。",
    "Press the key again to switch back to the original.": "再按一次即可切回原文。",
    "Select any sentence in this answer and point at the red dot; the translation appears without leaving Chat.":
        "选中这条回答中的任意一句再指向小红点，无需离开 Chat 就能看到译文。",
    "To translate the whole conversation, point at it and press the full-page key. Code blocks stay exactly as they are.":
        "要翻译整个对话，把鼠标移到对话上并按下全文快捷键。代码块保持原样。",
}


def handler(lang):
    def handle(route):
        url = route.request.url[len(ORIGIN):]
        if url in ("/tour", "/chat"):
            return route.fulfill(status=200, content_type="text/html", body=TOUR if url == "/tour" else CHAT)
        body = json.loads(route.request.post_data or "{}")
        text = " ".join((body.get("text") or "").split())
        if url == "/status":
            data = {"service": "immersive-translate-vscode", "enabled": True, "version": "0.3.0",
                    "settings": {"uiLanguage": lang, "fullPageMode": "translationOnly", "autoAI": True}}
        elif url == "/lookup":
            hit = DICT.get(text.lower())
            data = {"found": bool(hit), "word": text, "phonetic": hit["phonetic"] if hit else "",
                    "translation": hit["translation"] if hit else "", "source": "ECDICT"}
        elif url == "/ai":
            translation = AI.get(text, AI.get(text.rstrip(".")))
            if translation is None:
                print("screenshots.py: no canned translation for", repr(text), file=sys.stderr)
            data = {"translation": translation or "（译文）", "source": "AI · GPT-6 Luna"}
        elif url == "/vocab":
            data = {"saved": False}
        else:
            return route.fulfill(status=404, body="{}")
        route.fulfill(status=200, content_type="application/json", body=json.dumps(data, ensure_ascii=False))
    return handle


class Recorder:
    """Collects GIF frames at the page's device pixel ratio; each frame keeps its own display duration."""

    FRAME = 30  # ms; browsers slow down GIF frames shorter than 20 ms

    def __init__(self, page):
        self.page, self.frames, self.pos = page, [], (0, 0)

    def snap(self, ms=FRAME):
        self.frames.append((Image.open(io.BytesIO(self.page.screenshot())).convert("RGB"), ms))

    def hold(self, ms):
        self.snap(ms)

    def move(self, x1, y1, ms=None, frames=None):
        """Eased pointer movement; the number of frames follows the distance so speed stays even."""
        x0, y0 = self.pos
        dist = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
        n = frames or max(4, min(22, round(dist / 28)))
        for i in range(1, n + 1):
            k = i / n
            k = k * k * (3 - 2 * k)
            self.page.mouse.move(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)
            self.snap(ms or self.FRAME)
        self.pos = (x1, y1)

    def key(self, combo, wait=None):
        """Shows the pressed key in an on-screen badge while the page reacts."""
        self.page.evaluate("k => window.__key(k)", combo)
        self.hold(350)
        self.page.keyboard.press(combo)
        if wait:
            self.page.wait_for_function(wait)
        self.page.wait_for_timeout(120)
        self.hold(250)
        self.page.evaluate("window.__key('')")

    def save(self, path):
        # One shared palette from a sample of frames keeps colors stable from frame to frame (no flicker).
        sample = [f for f, _ in self.frames[::max(1, len(self.frames) // 12)]]
        w, h = sample[0].size
        sheet = Image.new("RGB", (w, h * len(sample)))
        for i, f in enumerate(sample):
            sheet.paste(f, (0, h * i))
        palette = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        frames = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f, _ in self.frames]
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=[d for _, d in self.frames], loop=0, optimize=True)


def word_box(page, element_id, word):
    return page.evaluate("""([id, word]) => {
      const el = document.getElementById(id); const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node; while (node = walker.nextNode()) { const i = node.textContent.indexOf(word);
        if (i >= 0) { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + word.length);
          const rects = [...r.getClientRects()]; const a = rects[0], b = rects[rects.length - 1];
          return {x0: a.left + 1, y0: a.top + a.height / 2, x1: b.right - 1, y1: b.top + b.height / 2}; } }
      return null; }""", [element_id, word])


def dot_center(page):
    page.locator(".imt-dot").wait_for(state="visible", timeout=3000)
    box = page.locator(".imt-dot").bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def drag_select(rec, page, box):
    rec.move(box["x0"], box["y0"])
    page.mouse.down()
    dist = abs(box["x1"] - box["x0"]) + abs(box["y1"] - box["y0"]) * 4
    rec.move(box["x1"], box["y1"], frames=max(5, min(26, round(dist / 30))))
    page.mouse.up()
    page.wait_for_timeout(150)
    rec.hold(250)


def open_page(browser, lang, path, workbench=False, scale=1):
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=scale)
    page.route(ORIGIN + "/**", handler(lang))
    page.goto(ORIGIN + path)
    ui = (ROOT / "src" / "ui.js").read_text(encoding="utf-8")
    ui = ui[:ui.rindex("if (typeof module")]
    if workbench:
        ui = ui.replace("location.protocol === 'vscode-file:'", "true")
    page.add_script_tag(content=f"({ui})({json.dumps({'endpoint': ORIGIN, 'token': 't'})});")
    page.wait_for_timeout(300)
    page.mouse.move(W - 60, H - 40)
    return page


def still(page, path):
    """README stills: rendered at the GIF's 2x scale, stored at 1x for small files."""
    img = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    img.resize((W, H), Image.Resampling.LANCZOS).save(path, optimize=True)


def popup(page, text):
    page.wait_for_function(f"document.querySelector('.imt-panel:not([hidden])')?.textContent.includes({json.dumps(text)})")
    page.wait_for_timeout(100)


def dismiss(rec, page):
    page.keyboard.press("Escape")
    page.mouse.click(*rec.pos)
    page.wait_for_timeout(100)
    rec.hold(200)


def render(browser, lang, out):
    out.mkdir(parents=True, exist_ok=True)
    # The tour page: word -> dictionary, sentence -> AI, paragraph key, full-page key. Recorded as the demo GIF.
    page = open_page(browser, lang, "/tour", scale=2)
    rec = Recorder(page)
    rec.pos = (W - 60, H - 40)
    rec.hold(700)

    drag_select(rec, page, word_box(page, "p1", "vocabulary"))
    rec.move(*dot_center(page))
    popup(page, "词汇")
    rec.hold(1700)
    still(page, out / "dictionary.png")
    dismiss(rec, page)

    drag_select(rec, page, word_box(page, "p2", "Select a whole sentence and point at the red dot, and the AI engine translates it in context."))
    rec.move(*dot_center(page))
    popup(page, "上下文")
    rec.hold(2000)
    still(page, out / "ai-translation.png")
    dismiss(rec, page)

    p3 = word_box(page, "p3", "the translation appears")
    rec.move(p3["x0"], p3["y0"])
    rec.hold(250)
    rec.key("Alt+Z", "document.querySelector('#p3 .imt-trans')?.textContent.includes('原处')")
    rec.hold(1900)
    still(page, out / "paragraph.png")
    rec.key("Alt+Z")
    rec.hold(400)

    rec.key("Alt+W", "document.getElementById('title').textContent.includes('导览')")
    page.wait_for_timeout(300)
    rec.hold(2600)
    still(page, out / "full-page.png")
    rec.key("Alt+W")
    rec.hold(900)
    rec.save(out / "demo.gif")
    page.close()

    # Chat: a sentence in an assistant answer, translated by AI automatically.
    page = open_page(browser, lang, "/chat", workbench=True, scale=2)
    box = word_box(page, "c1", "Select any sentence in this answer and point at the red dot; the translation appears without leaving Chat.")
    page.mouse.move(box["x0"], box["y0"])
    page.mouse.down()
    page.mouse.move(box["x1"], box["y1"], steps=12)
    page.mouse.up()
    page.mouse.move(*dot_center(page), steps=5)
    popup(page, "Chat")
    page.wait_for_timeout(150)
    still(page, out / "chat.png")
    page.close()


def sidebar(lang, out):
    args = [sys.executable, str(ROOT / "tools" / "panel-test.py"), "--screenshot", str(out / "sidebar.png")]
    if lang.startswith("zh"):
        args.append("--zh")
    subprocess.run(args, check=True, env=os.environ)
    img = Image.open(out / "sidebar.png")
    # panel-test.py lays the sections out in three columns; this only guards against a runaway height.
    img.crop((0, 0, img.width, min(img.height, 3200))).save(out / "sidebar.png", optimize=True)


def main():
    targets = [("en", ROOT / "docs" / "images" / "en"), ("zh-cn", ROOT / "docs" / "images" / "zh-CN")]
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        for lang, out in targets:
            render(browser, lang, out)
        browser.close()
    for lang, out in targets:
        sidebar(lang, out)
    for _, out in targets:
        for f in sorted(out.iterdir()):
            print(f"{f.relative_to(ROOT)}  {f.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
