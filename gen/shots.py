"""Store screenshots for the PWA manifest (Chrome's richer install dialog). Run after `node build.js`.
Needs Playwright + Chromium. Re-run when the look of the menu or the board changes."""
import os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST = os.path.join(ROOT, 'dist')
URL = 'file://' + os.path.join(DIST, 'index.html')

def launch(p):
    exe = os.environ.get('PW_CHROMIUM')
    return p.chromium.launch(executable_path=exe, args=['--no-sandbox']) if exe else p.chromium.launch()

# fixed day so the daily card looks the same every time the shots are regenerated
FIX = "Date = class extends Date { constructor(...a){ a.length ? super(...a) : super(2026, 10, 14, 12); } static now(){ return new Date(2026,10,14,12).getTime(); } };"

def fresh(browser, **kw):
    ctx = browser.new_context(**kw)
    page = ctx.new_page()
    page.add_init_script(FIX)
    page.add_init_script("localStorage.setItem('hr_howto','false')")
    return ctx, page

with sync_playwright() as p:
    b = launch(p)
    # narrow: 390x844 @2 = 780x1688
    ctx, page = fresh(b, viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page.goto(URL); page.wait_for_selector('#daily'); page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(DIST, 'screenshot-menu.png'))
    page.locator('.lv').first.click(); page.wait_for_selector('#startBtn')
    page.click('#startBtn'); page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(DIST, 'screenshot-game.png'))
    ctx.close()
    # wide: 1280x720
    ctx, page = fresh(b, viewport={'width': 1280, 'height': 720})
    page.goto(URL); page.wait_for_selector('#daily'); page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(DIST, 'screenshot-wide.png'))
    ctx.close(); b.close()
print('screenshots written')
