"""Screenshots + social preview for README.md, written to docs/. Run after `node build.js`.
Needs Playwright + Chromium (PW_CHROMIUM=<path> if needed) and Pillow. Fixed date, so reruns are reproducible."""
import os
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DOCS = os.path.join(ROOT, 'docs')
URL = 'file://' + os.path.join(ROOT, 'dist', 'index.html')
FIX = "Date = class extends Date { constructor(...a){ a.length ? super(...a) : super(2026, 10, 14, 12); } static now(){ return new Date(2026,10,14,12).getTime(); } };"

def launch(p):
    exe = os.environ.get('PW_CHROMIUM')
    return p.chromium.launch(executable_path=exe, args=['--no-sandbox']) if exe else p.chromium.launch()

def out(name): return os.path.join(DOCS, name)

def shrink(path):
    # 256-colour palette: the UI is flat colour, so this cuts the size a lot with no visible change
    im = Image.open(path).convert('RGB').quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    im.save(path, optimize=True)

with sync_playwright() as p:
    b = launch(p)
    def phone(extra=''):
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.add_init_script(FIX)
        page.add_init_script("localStorage.setItem('hr_howto','false');" + extra)
        page.goto(URL); page.wait_for_selector('#daily'); page.wait_for_timeout(1500)
        return ctx, page

    ctx, page = phone()                                   # menu
    page.screenshot(path=out('menu.png'))
    page.locator('.lv').nth(5).click(); page.wait_for_selector('#startBtn'); page.click('#startBtn'); page.wait_for_timeout(600)
    page.click('#hintBtn'); page.wait_for_timeout(300); page.click('#hintBtn'); page.wait_for_timeout(500)   # hint, second tap
    page.screenshot(path=out('game-hint.png'))
    ctx.close()

    ctx, page = phone()                                            # settings + skins, from the menu
    page.locator('#menu .settings-btn').first.click(); page.wait_for_timeout(500)
    page.screenshot(path=out('settings.png'))
    ctx.close()

    ctx, page = phone("localStorage.setItem('hr_skin','\"neon\"');")   # neon skin in play
    page.locator('.lv').nth(11).click(); page.wait_for_selector('#startBtn'); page.click('#startBtn'); page.wait_for_timeout(600)
    page.screenshot(path=out('game-neon.png'))
    ctx.close()

    ctx, page = phone("localStorage.setItem('hr_lang','\"th\"');")     # Thai
    page.screenshot(path=out('menu-th.png'))
    ctx.close()

    # social preview 1280x640 (GitHub's recommended size): title + tagline + phone shots
    import base64
    def uri(n): return 'data:image/png;base64,' + base64.b64encode(open(out(n), 'rb').read()).decode()
    html = """<html><body style="margin:0;width:1280px;height:640px;overflow:hidden;font-family:Inter,'Helvetica Neue',Arial,sans-serif;
      background:linear-gradient(115deg,#12233d 0%,#0d1117 55%,#2b161b 100%);color:#fff;position:relative">
      <div style="position:absolute;left:72px;top:150px;width:560px">
        <div style="font-size:84px;font-weight:800;line-height:1.02;letter-spacing:-1px">Huarong<br><span style="color:#fbbf24">Road</span></div>
        <div style="font-size:30px;color:#c9d1d9;margin-top:26px;line-height:1.35">Free sliding-block puzzle.<br>Slide the big red block out.</div>
        <div style="margin-top:34px;font-size:22px;color:#8b949e">100 levels &middot; daily puzzle &middot; hints<br>Offline &middot; no ads &middot; English &amp; Thai</div>
      </div>
      <div style="position:absolute;left:700px;top:70px;width:230px;height:497px;border-radius:30px;overflow:hidden;box-shadow:0 20px 50px #000a;border:4px solid #30363d"><img src="@@A@@" style="width:100%"></div>
      <div style="position:absolute;left:965px;top:120px;width:230px;height:497px;border-radius:30px;overflow:hidden;box-shadow:0 20px 50px #000a;border:4px solid #30363d"><img src="@@B@@" style="width:100%"></div>
    </body></html>""".replace("@@A@@", uri('menu.png')).replace("@@B@@", uri('game-hint.png'))
    ctx = b.new_context(viewport={'width': 1280, 'height': 640}); pg = ctx.new_page()
    pg.set_content(html); pg.wait_for_timeout(300); pg.screenshot(path=out('social-preview.png')); ctx.close(); b.close()

for f in os.listdir(DOCS):
    if f.endswith('.png'): shrink(out(f))
print('docs written')
