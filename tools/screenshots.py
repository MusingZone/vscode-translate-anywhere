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

RELEASE_NOTES = f"""<!doctype html><html><head><meta charset="utf-8"><style>{STYLE}</style></head><body>
<div id="release-notes-tokenization"></div>
<div class="tabs"><div class="tab">extension.ts</div><div class="tab on">Release Notes: 1.99</div><div class="tab">README.md</div></div>
<main>
<h1 id="title">Release notes for the sample update</h1>
<p class="muted">A demo page for Translate Anywhere screenshots.</p>
<h2 id="h-perf">Faster workspace search</h2>
<p id="p1">Search now streams results as soon as they are found, which noticeably improves <b>throughput</b> in very large repositories.</p>
<p id="p2">Indexing runs in the background, so you can keep typing while the cache warms up.</p>
<h2 id="h-term">Terminal improvements</h2>
<p id="p3">Commands that take longer than a few seconds now show a progress indicator in the tab, and you can hover it to see the elapsed time.</p>
<ul><li id="li1">Sticky scroll keeps the current command visible.</li><li id="li2">Links to files open in the existing editor group.</li></ul>
</main>{CURSOR}<script>{CURSOR_JS}</script></body></html>"""

CHAT = f"""<!doctype html><html><head><meta charset="utf-8"><style>{STYLE}</style></head><body>
<div class="chat"><div class="editor">
<div>export function activate(context) {{</div><div>&nbsp;&nbsp;const output = createOutput();</div>
<div>&nbsp;&nbsp;context.subscriptions.push(output);</div><div>}}</div></div>
<div class="pane interactive-session"><div class="monaco-list">
 <div class="interactive-item-container"><div class="who">You</div><div class="rendered-markdown"><p>Why does my extension activate so late?</p></div></div>
 <div class="interactive-item-container"><div class="who">Copilot</div><div class="rendered-markdown">
  <p id="c1">Your extension uses the <code>onStartupFinished</code> activation event, so VS Code waits until the window has fully loaded before starting it.</p>
  <p id="c2">If you need it earlier, contribute a more specific activation event, such as a command or a language, instead of activating on every startup.</p>
 </div></div></div></div></div>{CURSOR}<script>{CURSOR_JS}</script></body></html>"""

DICT = {
    "throughput": {"phonetic": "'θruːpʊt", "translation": "n. 吞吐量；生产量；处理能力"},
    "indexing": {"phonetic": "'ɪndeksɪŋ", "translation": "n. 索引；编制索引"},
}
AI = {
    "Search now streams results as soon as they are found": "搜索现在会在找到结果后立即以流式方式返回",
    "Search now streams results as soon as they are found, which noticeably improves throughput in very large repositories.":
        "搜索现在会在找到结果后立即以流式方式返回，显著提升了超大型仓库中的吞吐量。",
    "Indexing runs in the background, so you can keep typing while the cache warms up.": "索引在后台运行，因此在缓存预热期间你可以继续输入。",
    "Commands that take longer than a few seconds now show a progress indicator in the tab, and you can hover it to see the elapsed time.":
        "运行超过几秒的命令现在会在标签页中显示进度指示器，将鼠标悬停其上即可查看已用时间。",
    "Release notes for the sample update": "示例更新的发行说明",
    "A demo page for Translate Anywhere screenshots.": "用于 Translate Anywhere 截图的演示页面。",
    "Faster workspace search": "更快的工作区搜索",
    "Terminal improvements": "终端改进",
    "Sticky scroll keeps the current command visible.": "粘性滚动让当前命令始终可见。",
    "Links to files open in the existing editor group.": "文件链接会在现有编辑器组中打开。",
    "Your extension uses the onStartupFinished activation event, so VS Code waits until the window has fully loaded before starting it.":
        "你的扩展使用了 onStartupFinished 激活事件，因此 VS Code 会等到窗口完全加载后才启动它。",
    "If you need it earlier, contribute a more specific activation event, such as a command or a language, instead of activating on every startup.":
        "如果需要更早激活，请贡献更具体的激活事件（例如命令或语言），而不是在每次启动时激活。",
}


def handler(lang):
    def handle(route):
        url = route.request.url[len(ORIGIN):]
        if url in ("/release", "/chat"):
            return route.fulfill(status=200, content_type="text/html", body=RELEASE_NOTES if url == "/release" else CHAT)
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
            data = {"translation": AI.get(text, AI.get(text.rstrip("."), "（译文）")), "source": "AI · GPT-4o mini"}
        elif url == "/vocab":
            data = {"saved": False}
        else:
            return route.fulfill(status=404, body="{}")
        route.fulfill(status=200, content_type="application/json", body=json.dumps(data, ensure_ascii=False))
    return handle


class Recorder:
    """Collects GIF frames; each frame keeps its own display duration."""

    def __init__(self, page):
        self.page, self.frames = page, []

    def snap(self, ms=80):
        self.frames.append((Image.open(io.BytesIO(self.page.screenshot())).convert("RGB"), ms))

    def hold(self, ms):
        self.snap(ms)

    def move(self, x0, y0, x1, y1, steps=8, ms=40):
        for i in range(1, steps + 1):
            self.page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
            self.snap(ms)

    def save(self, path):
        frames = [f.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f, _ in self.frames]
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


def drag_select(rec, page, box, start, steps=10):
    rec.move(*start, box["x0"], box["y0"], steps=6)
    page.mouse.down()
    rec.move(box["x0"], box["y0"], box["x1"], box["y1"], steps=steps, ms=50)
    page.mouse.up()
    page.wait_for_timeout(150)
    rec.snap(300)
    return box["x1"], box["y1"]


def open_page(browser, lang, path, workbench=False):
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
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


def render(browser, lang, out):
    out.mkdir(parents=True, exist_ok=True)
    # Release Notes: word -> dictionary, sentence -> AI, Alt+Z, Alt+W. Recorded as the demo GIF.
    page = open_page(browser, lang, "/release")
    rec = Recorder(page)
    rec.hold(600)
    pos = drag_select(rec, page, word_box(page, "p1", "throughput"), (W - 60, H - 40), steps=6)
    dot = dot_center(page)
    rec.move(*pos, *dot, steps=6)
    page.wait_for_function("document.querySelector('.imt-panel:not([hidden])')?.textContent.includes('吞吐量')")
    page.wait_for_timeout(100)
    rec.hold(1800)
    page.screenshot(path=str(out / "dictionary.png"))
    page.keyboard.press("Escape")
    page.mouse.click(820, 120)
    rec.snap(200)

    box = word_box(page, "p1", "Search now streams results as soon as they are found")
    pos = drag_select(rec, page, box, (820, 120), steps=12)
    dot = dot_center(page)
    rec.move(*pos, *dot, steps=6)
    page.wait_for_function("document.querySelector('.imt-panel:not([hidden])')?.textContent.includes('流式')")
    page.wait_for_timeout(100)
    rec.hold(1800)
    page.screenshot(path=str(out / "ai-translation.png"))
    page.keyboard.press("Escape")
    page.mouse.click(820, 120)
    rec.snap(200)

    p3 = word_box(page, "p3", "progress indicator")
    rec.move(820, 120, p3["x0"], p3["y0"], steps=8)
    rec.hold(300)
    page.keyboard.press("Alt+Z")
    page.wait_for_function("document.querySelector('#p3 .imt-trans')?.textContent.includes('进度')")
    page.wait_for_timeout(100)
    rec.hold(1800)
    page.screenshot(path=str(out / "paragraph.png"))
    page.keyboard.press("Alt+Z")
    page.wait_for_timeout(150)
    rec.snap(300)

    page.keyboard.press("Alt+W")
    page.wait_for_function("document.getElementById('title').textContent.includes('示例')")
    page.wait_for_timeout(300)
    rec.hold(2200)
    page.screenshot(path=str(out / "full-page.png"))
    page.keyboard.press("Alt+W")
    page.wait_for_timeout(300)
    rec.hold(900)
    rec.save(out / "demo.gif")
    page.close()

    # Chat: a sentence in an assistant answer, translated by AI automatically.
    page = open_page(browser, lang, "/chat", workbench=True)
    box = word_box(page, "c2", "If you need it earlier, contribute a more specific activation event, such as a command or a language, instead of activating on every startup.")
    page.mouse.move(box["x0"], box["y0"])
    page.mouse.down()
    page.mouse.move(box["x1"], box["y1"], steps=12)
    page.mouse.up()
    page.mouse.move(*dot_center(page), steps=5)
    page.wait_for_function("document.querySelector('.imt-panel:not([hidden])')?.textContent.includes('激活')")
    page.wait_for_timeout(150)
    page.screenshot(path=str(out / "chat.png"))
    page.close()


def sidebar(lang, out):
    args = [sys.executable, str(ROOT / "tools" / "panel-test.py"), "--screenshot", str(out / "sidebar.png")]
    if lang.startswith("zh"):
        args.append("--zh")
    subprocess.run(args, check=True, env=os.environ)
    img = Image.open(out / "sidebar.png")
    # Keep the AI engine section in view; the full panel is longer than a typical sidebar.
    img.crop((0, 0, img.width, min(img.height, 1500))).save(out / "sidebar.png", optimize=True)


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
