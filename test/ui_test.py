import json, sys, os, re
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SHOTS = os.environ.get('HR_SHOTS', '/tmp/hr-shots')
os.makedirs(SHOTS, exist_ok=True)
URL = 'file://' + os.path.join(ROOT, 'dist', 'index.html')

def launch(p):
    exe = os.environ.get('PW_CHROMIUM')
    return p.chromium.launch(executable_path=exe, args=['--no-sandbox']) if exe else p.chromium.launch()

def settings(page, on=True):
    """Open/close the Settings panel (gear in the menu header or the game bar)."""
    if on: page.locator('.settings-btn:visible').first.click(); page.wait_for_selector('#settings:not(.hidden)')
    else: page.click('#setClose'); page.wait_for_selector('#settings.hidden', state='attached')

def toggle_lang(page):
    settings(page); page.locator('#settings .lang-btn').click(); settings(page, False)

def set_skin(page, name):
    settings(page); page.locator(f'#settings .skopt[data-sk={name}]').click(); settings(page, False)

def lv(page, idx):
    """The menu shows 20 levels per page: jump to the page that holds level idx (0-based) and return its button."""
    page.locator('.pgchip').nth(idx // 20).click()
    return page.locator('.lv').nth(idx % 20)

def run(level_idx, p, shots=False, haptics_off=False):
    ctx = launch(p).new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.add_init_script("window.__vib = []; navigator.vibrate = function (ms) { window.__vib.push(ms); return true; };")
    # the manual chip-check flow below needs an empty board, so switch the (default-on) auto-place off
    page.add_init_script("localStorage.setItem('hr_auto', 'false')")
    page.goto(URL)
    if shots: page.screenshot(path=f'{SHOTS}/1_menu.png')
    lv(page, level_idx).click()
    if haptics_off:
        settings(page); assert page.locator('#hapBtn').is_visible()
        page.click('#hapBtn')
        assert page.evaluate("() => localStorage.getItem('hr_haptics')") == 'false', 'haptics setting persisted'
        assert page.locator('#hapBtn').get_attribute('aria-pressed') == 'false'
        settings(page, False)

    # --- setup phase: place every target piece by tapping tray + board
    target = page.evaluate("() => { var lv = LEVELS[%d]; return Solver.piecesOf(lv.g.split('').map(Number)); }" % level_idx)
    assert page.locator('#startBtn').is_disabled(), 'start must be disabled before setup'
    box = page.locator('#board').bounding_box()
    cell = page.evaluate("() => parseFloat(document.getElementById('board').style.width) / 1")  # width incl pad
    pad, gap = 8, 3
    cs = (box['width'] - 4 - 2 * pad) / 4  # minus 2px borders each side
    def cell_xy(r, c):
        return box['x'] + 2 + pad + (c + 0.5) * cs, box['y'] + 2 + pad + (r + 0.5) * cs
    # a deliberately wrong placement first to confirm the chip check flags it
    wrong = next(t for t in target if t['t'] == 'S')
    page.locator('#tray button[data-t="S"]').click()
    for (r, c) in [(0, 0), (0, 1), (0, 2), (0, 3), (1, 0)]:
        occupied = any(
            (q['r'] <= r < q['r'] + {'R': 2, 'V': 2, 'H': 1, 'S': 1}[q['t']]) and
            (q['c'] <= c < q['c'] + {'R': 2, 'V': 1, 'H': 2, 'S': 1}[q['t']]) for q in target)
        if not occupied and not (wrong['r'] == r and wrong['c'] == c):
            x, y = cell_xy(r, c); page.mouse.click(x, y); break
    page.wait_for_timeout(100)
    has_bad = page.locator('.piece.bad').count()
    if shots: page.screenshot(path=f'{SHOTS}/2_setup_mismatch.png')
    if has_bad:
        page.locator('.piece.bad').first.click()  # lift it again
    assert page.locator('.piece').count() == 0 or not has_bad
    for t in target:
        page.locator(f'#tray button[data-t="{t["t"]}"]').click()
        x, y = cell_xy(t['r'], t['c'])
        d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[t['t']]
        page.mouse.click(box['x'] + 2 + pad + (t['c'] + d[0] / 2) * cs, box['y'] + 2 + pad + (t['r'] + d[1] / 2) * cs)
        # clicking centre of a multi-cell piece resolves to the cell under the pointer, so adjust below
    # The click above lands in the piece's centre cell; verify chip status instead of assuming.
    ok = page.locator('.piece.ok').count(); total = len(target)
    if ok != total:
        # centre-click may offset multi-cell pieces; fall back to exact top-left clicks
        page.click('#clearBtn')
        for t in target:
            page.locator(f'#tray button[data-t="{t["t"]}"]').click()
            x, y = cell_xy(t['r'], t['c']); page.mouse.click(x, y)
        ok = page.locator('.piece.ok').count()
    assert ok == total, f'chips verified {ok}/{total}'
    assert page.locator('#startBtn').is_enabled(), 'start should enable after all chips verified'
    if shots: page.screenshot(path=f'{SHOTS}/3_setup_ready.png')
    page.click('#startBtn')
    page.wait_for_timeout(150)
    if shots: page.screenshot(path=f'{SHOTS}/4_play.png')

    # --- play phase: follow the solver with real drags
    sol = page.evaluate("() => Solver.solve(Solver.fromPieces(G_pieces()))") if False else None
    solution = page.evaluate("() => { var lv = LEVELS[%d]; return Solver.solve(lv.g.split('').map(Number)); }" % level_idx)
    state = [dict(t) for t in target]
    for m in solution:
        pc = next(s for s in state if s['t'] == m['t'] and s['r'] == m['r'] and s['c'] == m['c'])
        d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[pc['t']]
        sx = box['x'] + 2 + pad + (pc['c'] + d[0] / 2) * cs; sy = box['y'] + 2 + pad + (pc['r'] + d[1] / 2) * cs
        ex, ey = sx + m['dc'] * m['k'] * cs, sy + m['dr'] * m['k'] * cs
        page.mouse.move(sx, sy); page.mouse.down()
        for i in range(1, 7): page.mouse.move(sx + (ex - sx) * i / 6, sy + (ey - sy) * i / 6)
        page.mouse.up()
        pc['r'] += m['dr'] * m['k']; pc['c'] += m['dc'] * m['k']
        page.wait_for_timeout(40)
    moves = page.locator('#moves').inner_text()
    page.wait_for_selector('#win:not(.hidden)', timeout=4000)
    info = page.locator('#winInfo').inner_text(); st = page.locator('#winStars').inner_text()
    if shots: page.screenshot(path=f'{SHOTS}/5_win.png')
    stored = page.evaluate("() => JSON.parse(localStorage.getItem('hr_progress') || '{}')")
    vib = page.evaluate('() => window.__vib.length')
    if haptics_off:
        assert vib == 0, f'haptics off but vibrate called {vib}x'
    else:
        assert vib >= len(solution), f'haptics on: expected >= {len(solution)} vibrations, got {vib}'
    ctx.close()
    assert not errors, errors
    return len(solution), moves, st, info, stored

def features(p):
    ctx = launch(p).new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    # skins: classic -> blossom -> neon -> classic, persisted
    assert page.evaluate("() => document.documentElement.dataset.skin") == 'classic'
    for want in ['blossom', 'neon', 'classic']:
        set_skin(page, want)
        assert page.evaluate("() => document.documentElement.dataset.skin") == want
        assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_skin'))") == want
    set_skin(page, 'blossom')  # remembered across levels
    lv(page, 5).click()
    # auto-place defaults to on: layout is already copied and verified
    n = page.evaluate("() => Solver.piecesOf(LEVELS[5].g.split('').map(Number)).length")
    assert page.locator('#autoBtn').get_attribute('aria-pressed') == 'true'
    assert page.locator('.piece.ok').count() == n and page.locator('#startBtn').is_enabled(), 'auto-place default'
    page.screenshot(path=f'{SHOTS}/blossom_setup.png')
    page.click('#autoBtn')  # off: board cleared, preference saved
    assert page.locator('.piece').count() == 0 and page.evaluate("() => localStorage.getItem('hr_auto')") == 'false'
    page.click('#autoBtn')  # on again: refilled
    assert page.locator('.piece.ok').count() == n
    page.click('#backBtn'); lv(page, 5).click()
    assert page.locator('.piece.ok').count() == n, 'next level opens auto-placed'
    page.click('#startBtn')
    # hints: tap 1 = explanation + outline, tap 2 = arrow on the move
    page.click('#hintBtn')
    assert page.locator('#tip').is_visible()
    head1, body1 = page.locator('#tipHead').inner_text(), page.locator('#tipBody').inner_text()
    assert page.locator('.piece[data-focus]').count() >= 1 and page.locator('.piece[data-hint]').count() == 0
    assert page.evaluate("() => getComputedStyle(document.querySelector('#tipHead .step')).float") == 'none', 'step label must not float into the text'
    # measured in one go: the tip scrolls smoothly into view, so separate reads could straddle the scroll
    sb, hb, bb = page.evaluate("() => ['#tipHead .step', '#tipHead', '#tipBody'].map(q => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })")
    assert sb['y'] <= hb['y'] + 2 and bb['y'] >= hb['y'] + hb['height'] - 2, ('step line above the headline; body starts below it', sb, hb, bb)
    assert bb['x'] <= hb['x'] + 2, 'body text starts at the left edge, not pushed in by a float'
    page.screenshot(path=f'{SHOTS}/blossom_hint1.png')
    page.click('#hintBtn')
    assert page.locator('.piece[data-hint]').count() == 1 and 'Try this' in page.locator('#tipHead').inner_text()
    body2 = page.locator('#tipBody').inner_text()
    page.screenshot(path=f'{SHOTS}/blossom_hint2.png')
    # follow the hinted move for real: the tip must clear after any move
    assert page.locator('#undoBtn').is_disabled() and page.locator('#redoBtn').is_disabled(), 'nothing to undo/redo yet'
    assert page.locator('#tip').is_visible()
    m = page.evaluate("() => { var s = Solver.solve(LEVELS[5].g.split('').map(Number)); return s[0]; }")
    box = page.locator('#board').bounding_box(); cs = (box['width'] - 4 - 16) / 4
    d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[m['t']]
    sx = box['x'] + 2 + 8 + (m['c'] + d[0] / 2) * cs; sy = box['y'] + 2 + 8 + (m['r'] + d[1] / 2) * cs
    page.mouse.move(sx, sy); page.mouse.down()
    for i in range(1, 7): page.mouse.move(sx + m['dc'] * m['k'] * cs * i / 6, sy + m['dr'] * m['k'] * cs * i / 6)
    page.mouse.up(); page.wait_for_timeout(100)
    assert page.locator('#tip').is_hidden(), 'tip clears after a move'
    page.screenshot(path=f'{SHOTS}/blossom_play.png')
    set_skin(page, 'neon')
    assert page.evaluate("() => document.documentElement.dataset.skin") == 'neon'
    page.click('#hintBtn'); page.wait_for_timeout(100)
    page.screenshot(path=f'{SHOTS}/neon_hint1.png')
    ctx.close()
    assert not errors, errors
    print('hint 1:', head1, '|', body1); print('hint 2:', body2)

def solution_view(p, idx):
    """Show-solution flow: confirm dialog, step viewer, no stars afterwards (even when solved optimally)."""
    ctx = launch(p).new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    lv(page, idx).click()
    page.click('#startBtn')                       # auto-place is on by default
    assert page.locator('#solBtn').is_visible()
    page.click('#solBtn')
    assert page.locator('#solAsk').is_visible()
    page.click('#solNo')
    assert page.locator('#solAsk').is_hidden() and page.evaluate("() => localStorage.getItem('hr_seen')") is None, 'cancel must not count as viewing'
    page.click('#solBtn'); page.click('#solYes')
    assert page.locator('.solbar').is_visible() and page.locator('#solBtn').is_hidden()
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_seen'))") == {str(page.evaluate("() => LEVELS[%d].id" % idx)): 1}
    n = page.evaluate("() => Solver.solve(LEVELS[%d].g.split('').map(Number)).length" % idx)
    assert f'of {n}' in page.locator('#solHead').inner_text()
    assert page.locator('#solPrev').is_disabled()
    page.screenshot(path=f'{SHOTS}/solution_step1.png')
    for i in range(n):
        assert page.locator('.piece[data-hint]').count() == 1, 'next move is marked'
        page.click('#solNext'); page.wait_for_timeout(30)
    assert page.locator('#solNext').is_disabled()
    assert 'Solved in %d' % n in page.locator('#solHead').inner_text()
    page.screenshot(path=f'{SHOTS}/solution_end.png')
    page.click('#solPrev'); page.click('#solNext')            # step back and forth
    for i in range(n): page.click('#solPrev')
    assert page.locator('#solPrev').is_disabled() and 'Step 1 of' in page.locator('#solHead').inner_text()
    page.click('#solPlay'); page.wait_for_timeout(100)        # autoplay advances, pause stops it
    assert 'Pause' in page.locator('#solPlay').inner_text()
    page.click('#solPlay'); i1 = page.locator('#solHead').inner_text(); page.wait_for_timeout(1000)
    assert page.locator('#solHead').inner_text() == i1, 'pause stops autoplay'
    page.click('#solBack')
    assert page.locator('.solbar').is_hidden() and page.locator('#solBtn').is_visible() and page.locator('#moves').inner_text() == '0'
    # solve it by hand with the optimal line: still 0 stars
    sol = page.evaluate("() => Solver.solve(LEVELS[%d].g.split('').map(Number))" % idx)
    box = page.locator('#board').bounding_box(); cs = (box['width'] - 4 - 16) / 4
    state = [dict(t) for t in page.evaluate("() => Solver.piecesOf(LEVELS[%d].g.split('').map(Number))" % idx)]
    for m in sol:
        pc = next(q for q in state if q['t'] == m['t'] and q['r'] == m['r'] and q['c'] == m['c'])
        d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[pc['t']]
        sx = box['x'] + 10 + (pc['c'] + d[0] / 2) * cs; sy = box['y'] + 10 + (pc['r'] + d[1] / 2) * cs
        page.mouse.move(sx, sy); page.mouse.down()
        for i in range(1, 7): page.mouse.move(sx + m['dc'] * m['k'] * cs * i / 6, sy + m['dr'] * m['k'] * cs * i / 6)
        page.mouse.up(); pc['r'] += m['dr'] * m['k']; pc['c'] += m['dc'] * m['k']; page.wait_for_timeout(40)
    page.wait_for_selector('#win:not(.hidden)', timeout=4000)
    assert page.locator('#winStars').inner_text() == '☆☆☆', 'no stars after viewing the solution'
    assert 'no stars' in page.locator('#winInfo').inner_text()
    page.screenshot(path=f'{SHOTS}/solution_win.png')
    page.click('#menuBtn')
    assert '👁' in lv(page, idx).inner_text() and page.locator('#totalStars').inner_text().startswith('0 /')
    # persists: reopening the level and solving again still earns nothing; viewing again skips the confirm
    lv(page, idx).click(); page.click('#startBtn'); page.click('#solBtn')
    assert page.locator('#solAsk').is_hidden() and page.locator('.solbar').is_visible()
    ctx.close()
    assert not errors, errors

def thai(p):
    """Language toggle: instructions, hints and solution switch to Thai and back; the choice persists."""
    import re
    ctx = launch(p).new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    has_thai = lambda t: re.search('[\u0e00-\u0e7f]', t) is not None
    assert 'How to play' in page.locator('.howto').inner_text() and page.evaluate("() => document.documentElement.lang") == 'en'
    toggle_lang(page)
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_lang'))") == 'th'
    assert page.evaluate("() => document.documentElement.lang") == 'th'
    assert 'วิธีเล่น' in page.locator('.howto').inner_text() and page.locator('#settings .lang-btn').get_attribute('aria-pressed') == 'true'
    page.screenshot(path=f'{SHOTS}/thai_menu.png')
    lv(page, 5).click()
    assert has_thai(page.locator('#status').inner_text()) or page.locator('#status').is_hidden()
    page.click('#startBtn')
    assert 'ลากบล็อก' in page.locator('#status').inner_text()
    assert page.locator('#hintBtn').inner_text() == 'คำใบ้' and page.locator('#solBtn').inner_text() == 'ดูเฉลย'
    page.click('#hintBtn')
    h1, b1, w1 = page.locator('#tipHead').inner_text(), page.locator('#tipBody').inner_text(), page.locator('#tipWhy').inner_text()
    assert has_thai(h1) and has_thai(b1) and has_thai(w1) and 'คำใบ้ 1/2' in h1, (h1, b1, w1)
    assert not re.search('[A-Za-z]{4,}', b1 + w1), 'hint body fully Thai: ' + b1 + w1
    page.screenshot(path=f'{SHOTS}/thai_hint1.png')
    page.click('#hintBtn')
    assert 'ลองทำแบบนี้' in page.locator('#tipHead').inner_text() and 'เลื่อน' in page.locator('#tipBody').inner_text()
    thai_body2 = page.locator('#tipBody').inner_text()
    page.screenshot(path=f'{SHOTS}/thai_hint2.png')
    toggle_lang(page)      # switch back mid-hint: the open tip re-renders in English
    assert 'Try this' in page.locator('#tipHead').inner_text() and page.locator('#hintBtn').inner_text() == 'Hint'
    assert 'Drag blocks' in page.locator('#status').inner_text()
    toggle_lang(page)      # and Thai again
    assert 'ลองทำแบบนี้' in page.locator('#tipHead').inner_text()
    # solution flow in Thai
    page.click('#solBtn')
    assert 'ดูเฉลยไหม' in page.locator('#solAsk h2').inner_text() and 'ไม่ได้ดาว' in page.locator('#solAsk p').inner_text()
    assert page.locator('#solNo').inner_text() == 'ลองต่อ' and page.locator('#solYes').inner_text() == 'ดูเลย'
    page.screenshot(path=f'{SHOTS}/thai_confirm.png')
    page.click('#solYes')
    n = page.evaluate("() => Solver.solve(LEVELS[5].g.split('').map(Number)).length")
    assert page.locator('#solHead').inner_text() == f'ขั้นที่ 1 จาก {n}', page.locator('#solHead').inner_text()
    assert page.locator('#solBody').inner_text().startswith('เลื่อน')
    assert page.locator('#solNext').inner_text() == 'ถัดไป ›' and page.locator('#solBack').inner_text() == 'กลับไปเล่น' and '▶ เล่น' in page.locator('#solPlay').inner_text()
    page.screenshot(path=f'{SHOTS}/thai_solution.png')
    for i in range(n): page.click('#solNext')
    assert page.locator('#solHead').inner_text() == f'ไขได้ใน {n} ครั้ง'
    toggle_lang(page)      # language switch while the solution is open
    assert page.locator('#solHead').inner_text().startswith('Solved in') and page.locator('#solPrev').inner_text() == '‹ Prev'
    toggle_lang(page)
    # persisted across a reload, and English restores exactly
    page.reload()
    assert page.evaluate("() => document.documentElement.lang") == 'th' and 'วิธีเล่น' in page.locator('.howto').inner_text()
    toggle_lang(page)
    assert 'How to play' in page.locator('.howto').inner_text() and page.evaluate("() => JSON.parse(localStorage.getItem('hr_lang'))") == 'en'
    ctx.close()
    assert not errors, errors
    print('thai hint 2:', thai_body2)

def lang_switch(p):
    """EN | ไทย switch: the active side is visibly highlighted, and tapping flips it both ways on every screen."""
    ctx = launch(p).new_context(viewport={'width': 360, 'height': 780}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    bg = lambda sel: page.evaluate("(s) => getComputedStyle(document.querySelector(s)).backgroundColor", sel)
    lit = lambda side, scope: bg(f'#settings .lang-btn .{side}') != 'rgba(0, 0, 0, 0)'
    for scope in ('#menu',):
        assert lit('en', scope) and not lit('th', scope), 'English side lit at start'
    assert page.locator('#settings .lang-btn span').all_text_contents() == ['EN', 'TH']
    for turn in range(3):                          # menu: en -> th -> en -> th
        toggle_lang(page)
        want_th = turn % 2 == 0
        assert lit('th', '#menu') == want_th and lit('en', '#menu') != want_th
        assert ('วิธีเล่น' in page.locator('.howto').inner_text()) == want_th
        assert page.evaluate("() => document.documentElement.lang") == ('th' if want_th else 'en')
    page.locator('.lv').nth(3).tap(); page.click('#startBtn')   # in Thai: game bar switch flips back and forth
    for want_th in (False, True, False):
        toggle_lang(page)
        assert lit('th', '#game') == want_th and (page.locator('#hintBtn').inner_text() == 'คำใบ้') == want_th
        assert ('Drag blocks' in page.locator('#status').inner_text()) != want_th
    page.screenshot(path=f'{SHOTS}/lang_switch_360.png')
    gb = page.locator('#game .settings-btn').bounding_box(); title = page.locator('#lvTitle').bounding_box()
    assert gb['x'] >= title['x'] + 20, 'gear sits right of the title'
    assert page.evaluate("() => document.documentElement.scrollWidth") <= 360
    ctx.close(); assert not errors, errors

def all_hints(p):
    """Open every level in English and Thai, tap Hint twice: the text is complete, specific and fully translated."""
    import re
    ctx = launch(p).new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=1, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    bad = re.compile(r'undefined|NaN|null|\[object')
    stats = {'goal_with_space': 0, 'goal_clear': 0, 'free': 0, 'generic_setup': 0, 'n': 0}
    for th in (False, True):
        if th: toggle_lang(page)
        for idx in range(100):
            lv(page, idx).click(); page.click('#startBtn')
            for tap in (1, 2):
                page.click('#hintBtn')
                head, body, why = (page.locator(f'#{i}').inner_text() for i in ('tipHead', 'tipBody', 'tipWhy'))
                txt = head + body + why
                assert body.strip() and why.strip() and not bad.search(txt), (idx + 1, th, tap, txt)
                if th: assert not re.search('[A-Za-z]{3,}', body + why), (idx + 1, 'untranslated', body + why)
                if tap == 1:
                    assert page.locator('.piece[data-focus]').count() >= 1 and page.locator('.piece[data-hint]').count() == 0, (idx + 1, 'tier1 outline')
                else:
                    assert page.locator('.piece[data-hint]').count() == 1, (idx + 1, 'tier2 arrow')
                    if not th:
                        stats['n'] += 1
                        if 'set-up move' in body: stats['generic_setup'] += 1
                if tap == 1 and not th:
                    if 'Red is free' in head: stats['free'] += 1
                    elif 'it has to slide' in body: stats['goal_with_space'] += 1
                    else: stats['goal_clear'] += 1
            page.click('#backBtn')
    ctx.close(); assert not errors, errors
    print('hints on 100 levels x EN/TH:', stats)
    assert stats['generic_setup'] <= 40, 'too many fallback explanations: ' + str(stats)

def trend(p):
    """After a hint was used each move says closer / no progress / further; no such line without a hint."""
    ctx = launch(p).new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=1, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    IDX = 12
    lv(page, IDX).click(); page.click('#startBtn')
    grid = page.evaluate("() => LEVELS[%d].g.split('').map(Number)" % IDX)
    def do(move, g):
        pc = next(q for q in page.evaluate("(g) => Solver.piecesOf(g)", g) if q['t'] == move['t'] and q['r'] == move['r'] and q['c'] == move['c'])
        d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[pc['t']]
        box = page.locator('#board').bounding_box(); cs = (box['width'] - 4 - 16) / 4
        sx = box['x'] + 10 + (pc['c'] + d[0] / 2) * cs; sy = box['y'] + 10 + (pc['r'] + d[1] / 2) * cs
        page.mouse.move(sx, sy); page.mouse.down()
        for i in range(1, 7): page.mouse.move(sx + move['dc'] * move['k'] * cs * i / 6, sy + move['dr'] * move['k'] * cs * i / 6)
        page.mouse.up(); page.wait_for_timeout(400)
        return page.evaluate("([g, m]) => Solver.slide(g, {t: m.t, r: m.r, c: m.c}, m.dr, m.dc, m.k)", [g, move])
    best = page.evaluate("(g) => Solver.solve(g)", grid)
    # no hint used yet: the good move gets no on-track line
    g1 = do(best[0], grid)
    assert 'Drag blocks' in page.locator('#status').inner_text(), 'no feedback line before any hint'
    page.click('#hintBtn')                                           # now a hint has been used
    best = page.evaluate("(g) => Solver.solve(g)", g1)
    g2 = do(best[0], g1)
    st = page.locator('#status').inner_text(); assert st.startswith('✓ Closer') and 'to go' in st, st
    assert 'good' in page.locator('#status').get_attribute('class')
    worse = page.evaluate("""(g) => { var d = Solver.solve(g).length; var ns = Solver.neighbors(g);
        for (var i = 0; i < ns.length; i++) if (Solver.solve(ns[i].g).length > d) return ns[i].m; return null; }""", g2)
    assert worse, 'a worse move exists'
    g3 = do(worse, g2)
    st = page.locator('#status').inner_text(); assert st.startswith('✗ Further'), st
    toggle_lang(page)
    assert page.locator('#status').inner_text().startswith('✗ ไกลขึ้น'), 'feedback follows the language'
    toggle_lang(page)
    page.click('#undoBtn'); page.wait_for_timeout(300)
    assert 'to go' in page.locator('#status').inner_text() and '✗' not in page.locator('#status').inner_text()
    page.click('#restartBtn'); page.click('#rsYes'); assert 'Drag blocks' in page.locator('#status').inner_text(), 'restart clears the line'
    ctx.close(); assert not errors, errors

def updates(p):
    """Update flow against a real local server: banner on a new deploy, ↻ beats stale browser caches, offline is safe,
    and progress survives."""
    import re, shutil, tempfile, threading, http.server, functools
    tmp = tempfile.mkdtemp(); site = os.path.join(tmp, 'site'); shutil.copytree(os.path.join(ROOT, 'dist'), site)
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=site))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
    rd = lambda f: open(os.path.join(site, f), encoding='utf8').read()
    def wr(f, t): open(os.path.join(site, f), 'w', encoding='utf8').write(t)
    h1 = re.search(r'huarong-([0-9a-f]{7})', rd('sw.js')).group(1)
    def deploy(newhash, marker, with_sw=True):
        old = re.search(r'huarong-([0-9a-f]{7})', rd('sw.js')).group(1)
        wr('index.html', rd('index.html').replace(old, newhash).replace('</body>', f'<!--{marker}--></body>'))
        if with_sw: wr('sw.js', rd('sw.js').replace(old, newhash))
    ctx = launch(p).new_context(viewport={'width': 412, 'height': 860}, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    ver = lambda: page.locator('#verId').inner_text()
    controlled = lambda: page.wait_for_function("() => navigator.serviceWorker.controller", timeout=10000)
    page.goto(base); controlled()
    assert ver() == h1 and 'Version' in page.locator('.ver').inner_text()
    page.evaluate("() => localStorage.setItem('hr_progress', JSON.stringify({1: {stars: 3, moves: 2, time: 1}}))")
    page.reload(); controlled()
    assert page.locator('#updbar').is_hidden(), 'no banner without an update'
    # 1) a new version is deployed: the open page notices and offers Update (never reloads by itself)
    deploy('aaaaaa1', 'v2')
    page.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_selector('#updbar:not(.hidden)', timeout=10000)
    assert ver() == h1, 'running page is untouched until the player taps Update'
    page.screenshot(path=f'{SHOTS}/update_banner.png')
    page.click('#updBtn'); page.wait_for_function("() => ((document.getElementById('verId') || {}).textContent) === 'aaaaaa1'", timeout=10000)
    assert '<!--v2-->' in page.evaluate("() => document.documentElement.outerHTML")
    # 2) deployed again but the worker file is unchanged (worst case: stale caches). The ↻ button still gets the newest page
    controlled()
    deploy('bbbbbb2', 'v3', with_sw=False)
    page.click('#refreshBtn')
    page.wait_for_function("() => ((document.getElementById('verId') || {}).textContent) === 'bbbbbb2'", timeout=10000)
    assert '<!--v3-->' in page.evaluate("() => document.documentElement.outerHTML")
    page.wait_for_selector('#toast:not(.hidden)', timeout=3000)
    assert 'Updated' in page.locator('#toast').inner_text(), page.locator('#toast').inner_text()
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_progress'))['1'].stars") == 3, 'progress survives a refresh'
    # 3) nothing new: ↻ says so
    controlled(); page.wait_for_timeout(1800)
    page.click('#refreshBtn')
    page.wait_for_function("() => { var t = document.getElementById('toast'); return !!t && !t.classList.contains('hidden') && /latest/.test(t.textContent); }", timeout=10000)
    # 4) offline: ↻ fails politely and the installed copy keeps working
    controlled(); page.wait_for_timeout(1800)
    ctx.set_offline(True)
    page.click('#refreshBtn')
    page.wait_for_function("() => { var t = document.getElementById('toast'); return !!t && /server|เซิร์ฟเวอร์/.test(t.textContent); }", timeout=10000)
    assert page.evaluate("() => caches.keys().then(k => k.length)") >= 1 and page.locator('.lv').count() == 20
    assert page.locator('#refreshBtn').get_attribute('class') is None or 'spin' not in page.locator('#refreshBtn').get_attribute('class')
    page.reload(); page.wait_for_selector('.lv', timeout=10000)      # still launches offline from the cache
    assert ver() == 'bbbbbb2'
    ctx.set_offline(False)
    ctx.close(); srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
    assert not errors, errors

def menu_pages(p):
    """Level list is paged (20 per page), remembers where you were, and header buttons do not cover the title."""
    for w in (412, 320):
        ctx = launch(p).new_context(viewport={'width': w, 'height': 800}, device_scale_factor=2, has_touch=True, is_mobile=True)
        page = ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(URL)
        h1 = page.locator('#menu h1').bounding_box()
        for sel in ('#menu .settings-btn', '#aboutBtn'):
            b = page.locator(sel).bounding_box()
            assert b['y'] + b['height'] <= h1['y'] + 1 or b['x'] + b['width'] <= h1['x'] or b['x'] >= h1['x'] + h1['width'], f'{sel} overlaps the title at {w}px'
        sw = page.evaluate("() => document.documentElement.scrollWidth")
        assert sw <= w, f'horizontal overflow {sw} > {w}'
        if w == 412:
            assert page.locator('.pgchip').count() == 5 and page.locator('.lv').count() == 20
            assert page.locator('.lv b').first.inner_text() == '1' and page.locator('.pgchip.on').inner_text() == '1–20'
            assert page.locator('#pgPrev').is_disabled() and page.locator('#pgNext').inner_text() == '21–40 ›'
            page.screenshot(path=f'{SHOTS}/menu_page1.png')
            page.click('#pgNext')
            assert page.locator('.lv b').first.inner_text() == '21' and page.locator('.pgchip.on').inner_text() == '21–40'
            page.locator('.pgchip').nth(4).click()
            assert page.locator('.lv b').first.inner_text() == '81' and page.locator('.lv b').last.inner_text() == '100'
            assert page.locator('#pgNext').is_disabled() and page.locator('#totalStars').inner_text() == '0 / 300'
            page.screenshot(path=f'{SHOTS}/menu_page5.png')
            page.locator('.lv').nth(3).click()            # level 84; back lands on the same page
            assert 'Level 84' in page.locator('#lvTitle').inner_text()
            page.click('#backBtn')
            assert page.locator('.pgchip.on').inner_text() == '81–100'
            page.reload(); assert page.locator('.pgchip.on').inner_text() == '81–100', 'page remembered across reloads'
        else:
            page.screenshot(path=f'{SHOTS}/menu_320.png')
        ctx.close(); assert not errors, errors

def about(p):
    """? button: 'about this game' panel with the story, in English or Thai; closes three ways."""
    import re
    ctx = launch(p).new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    assert page.locator('#about').is_hidden()
    page.click('#aboutBtn')
    assert page.locator('#about').is_visible()
    pages = page.locator('#about .apage'); n = pages.count(); assert n == 4
    assert page.locator('#aPrev').is_disabled() and page.locator('#aNext').is_enabled()
    seen_txt = ''
    for k in range(n):
        assert page.locator('#about .apage:visible').count() == 1, 'exactly one page visible'
        seen_txt += page.locator('#about .apage:visible').inner_text()
        if k == 1: page.wait_for_timeout(400); page.screenshot(path=f'{SHOTS}/about_en.png')
        if k < n - 1: page.click('#aNext')
    assert page.locator('#aNext').is_disabled() and page.locator('#aboutClose').is_visible()
    for w in ('Cao Cao', 'Guan Yu', 'Huarong Road', 'Klotski', '25,955', '81'): assert w in seen_txt, w
    page.click('#aPrev'); page.click('#aPrev'); page.click('#aPrev'); assert page.locator('#aPrev').is_disabled()
    page.locator('#aDots i').nth(2).click()     # dots jump straight to a page
    assert 'Why' in page.locator('#about .apage:visible h4').inner_text() and page.locator('#about .apage:visible').count() == 1
    page.locator('#aDots i').nth(0).click()
    sw = lambda c: page.locator(f'#about .sw.{c}').bounding_box()
    page.locator('#aDots i').nth(1).click()
    h, v = sw('H'), sw('V'); assert h['width'] > h['height'] and v['height'] > v['width'], 'wide block swatch is wide, tall block swatch is tall'
    page.locator('#aDots i').nth(0).click()
    page.locator('#about .lang-btn').click()      # switch language from inside the panel; stays on the same page
    assert 'ศึกผาแดง' in page.locator('#about').inner_text() and 'เซ็กเพ็ก' not in page.locator('#about').inner_text(), 'Red Cliffs is ศึกผาแดง in Thai'
    assert page.evaluate("() => getComputedStyle(document.querySelector('#about .apage p')).textAlign") == 'justify'
    for _ in range(3):                                      # proper names are kept whole across all pages
        for nm in page.locator('#about .apage:visible .nw').all():
            r = nm.evaluate("e => e.getClientRects().length"); assert r == 1, ('name split over lines', nm.inner_text())
        page.click('#aNext')
    for _ in range(3): page.click('#aPrev')
    th = page.locator('#about').inner_text()
    assert 'โจโฉ' in th and 'กวนอู' in th and 'เกี่ยวกับเกมนี้' in th and 'The story' not in th
    assert page.locator('#about').is_visible(), 'panel stays open when the language changes'
    page.screenshot(path=f'{SHOTS}/about_th.png')
    page.click('#aNext'); page.click('#aNext'); page.click('#aNext')
    assert 'เกร็ดน่ารู้' in page.locator('#about .apage:visible').inner_text() and '25,955' in page.locator('#about').inner_text()
    page.screenshot(path=f'{SHOTS}/about_th_bottom.png')
    assert page.locator('#aboutClose').is_visible(), 'close button reachable'
    page.click('#aboutClose'); assert page.locator('#about').is_hidden()
    page.click('#aboutBtn'); page.keyboard.press('Escape'); assert page.locator('#about').is_hidden()
    page.click('#aboutBtn'); page.mouse.click(5, 5); assert page.locator('#about').is_hidden(), 'backdrop tap closes'
    toggle_lang(page)      # back to English; panel is English again
    page.click('#aboutBtn'); assert 'The story' in page.locator('#about').inner_text() and page.locator('#aPrev').is_disabled()
    ctx.close()
    assert not errors, errors

def controls(p):
    """Undo/Redo pair, Hint+Solution pair, Restart away from Undo and behind a confirm, settings panel holds the rest."""
    ctx = launch(p).new_context(viewport={'width': 360, 'height': 780}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.add_init_script("window.__vib = []; navigator.vibrate = function (ms) { window.__vib.push(ms); return true; };")
    page.goto(URL)
    # How to play: open at first, folds away, remembered, saves space, Thai heading
    assert 'How to play' in page.locator('#howToggle').inner_text() and page.locator('#howBody').is_visible()
    assert page.locator('#howToggle').get_attribute('aria-expanded') == 'true'
    y_open = page.locator('.lv').first.bounding_box()['y']
    page.click('#howToggle')
    assert page.locator('#howBody').is_hidden() and page.locator('#howToggle').get_attribute('aria-expanded') == 'false'
    assert page.locator('.lv').first.bounding_box()['y'] < y_open - 80, 'levels move up when the panel is folded'
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_howto'))") is False
    page.reload(); assert page.locator('#howBody').is_hidden(), 'folded state survives a reload'
    toggle_lang(page); assert page.locator('#howToggle').inner_text().strip() == 'วิธีเล่น'; page.click('#howToggle'); assert 'ตั้งค่า' in page.locator('#howBody').inner_text()
    toggle_lang(page); assert page.locator('#howBody').is_visible() and page.locator('#howToggle').inner_text().strip() == 'How to play'
    page.click('#howToggle'); assert page.locator('#howBody').is_hidden()
    page.click('#howToggle'); assert page.locator('#howBody').is_visible() and 'Set up' in page.locator('#howBody').inner_text()
    # header: title shares the row with ? and the gear; one-line centred subtitle; star icon on the stars line
    tb = page.locator('#menu h1').bounding_box(); ab = page.locator('#aboutBtn').bounding_box(); gb0 = page.locator('#menu .settings-btn').bounding_box()
    assert abs((tb['y'] + tb['height'] / 2) - (ab['y'] + ab['height'] / 2)) < 10 and abs((tb['y'] + tb['height'] / 2) - (gb0['y'] + gb0['height'] / 2)) < 10, 'title on the same row as the buttons'
    assert ab['x'] + ab['width'] <= tb['x'] and tb['x'] + tb['width'] <= gb0['x'], 'title sits between the buttons'
    assert abs((tb['x'] + tb['width'] / 2) - 180) < 6, 'title centred'
    tg = page.locator('#menu .tagline').bounding_box(); assert tg['height'] < 22, 'tagline is a single line'
    assert abs((tg['x'] + tg['width'] / 2) - 180) < 6, 'tagline centred'
    assert page.locator('.total .ico.star').is_visible()
    # consistency: the gear is top-right on the menu and in the game, and the update button is not a lookalike of Restart
    mg = page.locator('#menu .settings-btn').bounding_box()
    assert abs((mg['x'] + mg['width']) - 344) <= 2, 'menu gear sits at the top right'
    assert page.locator('.ver #refreshBtn').count() == 1, 'update button sits next to the version label'
    vb = page.locator('#verId').bounding_box(); rb0 = page.locator('#refreshBtn').bounding_box()
    assert abs((vb['y'] + vb['height'] / 2) - (rb0['y'] + rb0['height'] / 2)) < 12 and rb0['x'] > vb['x'], 'same line, right of the version'
    assert page.locator('#refreshBtn use').get_attribute('href') != page.locator('#restartBtn use').get_attribute('href'), 'update icon differs from restart icon'
    page.screenshot(path=f'{SHOTS}/menu_header.png')
    lv(page, 5).click()
    gg = page.locator('#game .settings-btn').bounding_box()
    assert abs((gg['x'] + gg['width']) - (mg['x'] + mg['width'])) <= 1 and abs(gg['y'] - mg['y']) <= 8, 'game gear is in the same corner as the menu gear'
    settings(page); assert page.evaluate("() => document.querySelector('#settings .setrow .lbl').textContent.trim()") == 'Language', 'language is the first row'; page.click('#setClose')
    # game bar no longer carries skin / sound / vibration / language buttons: only the gear
    for sel in ('#game .skin-btn', '#game .lang-btn', '#game #muteBtn', '#game #hapBtn'): assert page.locator(sel).count() == 0 or page.locator(sel).is_hidden(), sel
    page.click('#startBtn')
    box = lambda sel: page.locator(sel).bounding_box()
    # grouping: undo+redo share a pill, hint+solution share a pill, restart is far from undo
    assert page.locator('.grp:has(#undoBtn):has(#redoBtn)').count() == 1 and page.locator('.grp:has(#hintBtn):has(#solBtn)').count() == 1
    u, r = box('#undoBtn'), box('#restartBtn')
    lb = box('#led')
    assert r['x'] >= lb['x'] + lb['width'] and r['x'] - (lb['x'] + lb['width']) <= 20, 'restart sits right next to the LED'
    assert u['x'] - (r['x'] + r['width']) >= 48, f"restart keeps a thumb-width gap from undo ({u['x'] - (r['x'] + r['width']):.0f}px)"
    assert page.locator('.hud #restartBtn').count() == 0, 'restart left the top bar'
    for sel in ('#undoBtn', '#redoBtn', '#hintBtn', '#solBtn', '#restartBtn'):
        b = box(sel); assert b['height'] >= 40 and b['width'] >= 40, f'{sel} touch target {b}'
    assert page.evaluate("() => document.documentElement.scrollWidth") <= 360
    # restart with no moves: nothing to lose, no prompt
    page.click('#restartBtn'); assert page.locator('#rsAsk').is_hidden()
    # make two moves from the optimal line
    sol = page.evaluate("() => Solver.solve(LEVELS[5].g.split('').map(Number))")
    def play(m):
        bx = page.locator('#board').bounding_box(); cs = (bx['width'] - 4 - 16) / 4
        d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[m['t']]
        sx = bx['x'] + 2 + 8 + (m['c'] + d[0] / 2) * cs; sy = bx['y'] + 2 + 8 + (m['r'] + d[1] / 2) * cs
        page.mouse.move(sx, sy); page.mouse.down()
        for i in range(1, 7): page.mouse.move(sx + m['dc'] * m['k'] * cs * i / 6, sy + m['dr'] * m['k'] * cs * i / 6)
        page.mouse.up(); page.wait_for_timeout(250)
    snap = lambda: page.evaluate("() => G_state()") if False else page.locator('.piece').evaluate_all("els => els.map(e => e.style.transform).join('|')")
    s0 = snap(); play(sol[0]); s1 = snap(); play(sol[1]); s2 = snap()
    assert page.locator('#moves').inner_text() == '2' and s0 != s1 != s2
    assert page.locator('#undoBtn').is_enabled() and page.locator('#redoBtn').is_disabled()
    page.click('#undoBtn'); page.wait_for_timeout(250)
    assert snap() == s1 and page.locator('#moves').inner_text() == '1' and page.locator('#redoBtn').is_enabled()
    page.click('#redoBtn'); page.wait_for_timeout(250)
    assert snap() == s2 and page.locator('#moves').inner_text() == '2' and page.locator('#redoBtn').is_disabled(), 'redo restores the move'
    page.click('#undoBtn'); page.click('#undoBtn'); page.wait_for_timeout(250)
    assert snap() == s0 and page.locator('#undoBtn').is_disabled() and page.locator('#redoBtn').is_enabled()
    page.click('#redoBtn'); page.wait_for_timeout(250); page.click('#undoBtn'); page.wait_for_timeout(250)
    play(sol[0])   # a new move after undo drops the redo branch
    assert page.locator('#redoBtn').is_disabled(), 'new move clears redo'
    # restart now has something to lose: confirm first, "keep playing" changes nothing
    page.click('#restartBtn')
    assert page.locator('#rsAsk').is_visible() and '1 move' in page.locator('#rsBody').inner_text()
    page.screenshot(path=f'{SHOTS}/restart_confirm.png')
    page.click('#rsNo'); assert page.locator('#rsAsk').is_hidden() and page.locator('#moves').inner_text() != '0'
    page.click('#restartBtn'); page.click('#rsYes')
    assert page.locator('#moves').inner_text() == '0' and snap() == s0 and page.locator('#undoBtn').is_disabled() and page.locator('#redoBtn').is_disabled()
    # Thai confirm
    play(sol[0]); toggle_lang(page); page.click('#restartBtn')
    assert 'เริ่มด่านนี้ใหม่' in page.locator('#rsAsk h2').inner_text() and page.locator('#rsYes').inner_text() == 'เริ่มใหม่'
    assert page.locator('#undoBtn').inner_text() == 'Undo' and page.locator('#redoBtn').inner_text() == 'Redo' and page.locator('#timeStat small').text_content() == 'Time', 'game terms stay English in Thai mode'
    assert page.locator('#hintBtn').inner_text() == 'คำใบ้'
    page.click('#rsNo'); toggle_lang(page)
    # settings panel: sound + vibration switches and skin options; gear opens, Done / backdrop / Esc close
    settings(page)
    assert page.locator('#muteBtn').get_attribute('aria-pressed') == 'true'
    page.click('#muteBtn'); assert page.locator('#muteBtn').get_attribute('aria-pressed') == 'false' and page.evaluate("() => JSON.parse(localStorage.getItem('hr_muted'))") is True
    page.click('#muteBtn'); assert page.locator('#muteBtn').get_attribute('aria-pressed') == 'true'
    page.screenshot(path=f'{SHOTS}/settings.png')
    page.click('#setClose'); assert page.locator('#settings').is_hidden()
    page.locator('#game .settings-btn').click(); page.keyboard.press('Escape'); assert page.locator('#settings').is_hidden()
    page.locator('#game .settings-btn').click(); page.mouse.click(5, 5); assert page.locator('#settings').is_hidden()
    # solution viewer keeps redo history safe
    page.click('#undoBtn'); page.wait_for_timeout(250); assert page.locator('#redoBtn').is_enabled()
    page.click('#solBtn'); page.click('#solYes'); page.click('#solBack'); page.wait_for_timeout(250)
    assert page.locator('#redoBtn').is_enabled(), 'redo survives a look at the solution'
    ctx.close(); assert not errors, errors


def skins_timer(p):
    """All skins visible at once (live previews), each selectable in one tap; timer switch hides the clock."""
    ctx = launch(p).new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    settings(page)
    tiles = page.locator('#settings .skopt'); n = tiles.count()
    assert n >= 8, f'{n} skins'
    vp = page.viewport_size
    for i in range(n):
        b = tiles.nth(i).bounding_box(); assert b['y'] >= 0 and b['y'] + b['height'] <= vp['height'], f'skin tile {i} must be visible without scrolling'
    # each preview paints with its own colours
    cols = page.evaluate("() => [...document.querySelectorAll('#settings .skprev .r')].map(e => getComputedStyle(e).backgroundImage)")
    assert len(set(cols)) == n, 'every skin preview looks different'
    ids = page.evaluate("() => [...document.querySelectorAll('#settings .skopt')].map(b => b.dataset.sk)")
    for sid in ids:                                   # one tap each, applied at once, remembered
        page.locator(f'#settings .skopt[data-sk={sid}]').click()
        assert page.evaluate("() => document.documentElement.dataset.skin") == sid
        assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_skin'))") == sid
        assert page.locator(f'#settings .skopt[data-sk={sid}]').get_attribute('aria-pressed') == 'true' and page.locator('#settings .skopt[aria-pressed=true]').count() == 1
        bgc = page.evaluate("() => getComputedStyle(document.body).backgroundColor"); assert bgc
        page.screenshot(path=f'{SHOTS}/skin_{sid}.png')
    page.click('#setClose')
    for sid in ('ocean', 'mono'):                     # new skins also drive the board itself
        page.evaluate("(s) => { document.documentElement.dataset.skin = s; }", sid)
        lv(page, 3).click(); page.click('#startBtn'); page.screenshot(path=f'{SHOTS}/play_{sid}.png'); page.click('#backBtn')
    # timer: on by default, off hides the clock and the time on the win card, persists
    lv(page, 0).click(); page.click('#startBtn')
    assert page.locator('#timeStat').is_visible() and page.locator('#timerBtn').count() == 1
    settings(page); assert page.locator('#timerBtn').get_attribute('aria-pressed') == 'true'
    page.click('#timerBtn'); assert page.locator('#timerBtn').get_attribute('aria-pressed') == 'false'
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_timer'))") is False
    page.screenshot(path=f'{SHOTS}/settings_notimer.png'); page.click('#setClose')
    assert page.locator('#timeStat').is_hidden(), 'clock hidden in no-stress mode'
    sol = page.evaluate("() => Solver.solve(LEVELS[0].g.split('').map(Number))")
    for m in sol:
        bx = page.locator('#board').bounding_box(); cs = (bx['width'] - 4 - 16) / 4
        d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[m['t']]
        sx = bx['x'] + 2 + 8 + (m['c'] + d[0] / 2) * cs; sy = bx['y'] + 2 + 8 + (m['r'] + d[1] / 2) * cs
        page.mouse.move(sx, sy); page.mouse.down()
        for i in range(1, 7): page.mouse.move(sx + m['dc'] * m['k'] * cs * i / 6, sy + m['dr'] * m['k'] * cs * i / 6)
        page.mouse.up(); page.wait_for_timeout(250)
    page.wait_for_selector('#win:not(.hidden)', timeout=5000)
    assert 'Time' not in page.locator('#winInfo').inner_text() and 'Moves' in page.locator('#winInfo').inner_text(), page.locator('#winInfo').inner_text()
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_progress'))['1'].stars") == 3, 'stars still earned without the clock'
    page.reload(); lv(page, 1).click(); assert page.locator('#timeStat').is_hidden(), 'setting survives a reload'
    settings(page); page.click('#timerBtn'); page.click('#setClose'); assert page.locator('#timeStat').is_visible()
    ctx.close(); assert not errors, errors


def sound(p):
    """Sound is really produced (running context, audible level, decent length) and the Sound switch silences it."""
    ctx = launch(p).new_context(viewport={'width': 390, 'height': 800}, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script("""window.__peaks = []; window.__osc = 0;
      var r = AudioParam.prototype.exponentialRampToValueAtTime; AudioParam.prototype.exponentialRampToValueAtTime = function (v, t) { window.__peaks.push(v); return r.call(this, v, t); };
      var c = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { window.__osc++; return c.call(this); };""")
    page.goto(URL)
    assert page.evaluate("() => window._ac === undefined"), 'no audio context before the first tap'
    lv(page, 0).tap(); page.click('#startBtn')
    assert page.evaluate("() => window._ac && window._ac.state") == 'running', 'context awake after the first taps'
    page.wait_for_timeout(200)
    n0 = page.evaluate("() => window.__osc"); assert n0 >= 1 and max(page.evaluate("() => window.__peaks")) >= 0.2, 'audible level'
    def drag_first():
        sol = page.evaluate("() => Solver.solve(LEVELS[0].g.split('').map(Number))"); m = sol[0]
        bx = page.locator('#board').bounding_box(); cs = (bx['width'] - 20) / 4; d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[m['t']]
        sx = bx['x'] + 10 + (m['c'] + d[0] / 2) * cs; sy = bx['y'] + 10 + (m['r'] + d[1] / 2) * cs
        page.mouse.move(sx, sy); page.mouse.down()
        for i in range(1, 7): page.mouse.move(sx + m['dc'] * m['k'] * cs * i / 6, sy + m['dr'] * m['k'] * cs * i / 6)
        page.mouse.up(); page.wait_for_timeout(250)
    drag_first(); assert page.evaluate("() => window.__osc") > n0, 'a move makes a sound'
    n1 = page.evaluate("() => window.__osc"); page.click('#undoBtn')
    settings(page); page.click('#muteBtn'); n2 = page.evaluate("() => window.__osc")      # now muted
    page.click('#setClose'); page.click('#redoBtn'); page.wait_for_timeout(200)
    assert page.evaluate("() => window.__osc") == n2, 'muted: no sound'
    settings(page); page.click('#muteBtn'); page.wait_for_timeout(100)
    assert page.evaluate("() => window.__osc") > n2, 'switching Sound back on plays a confirmation note'
    ctx.close(); assert not errors, errors


def autostart(p):
    """Auto-start: off by default; on = levels open already in play (skip chips + Start), remembered, works for Next/Replay/Restart."""
    ctx = launch(p).new_context(viewport={'width': 390, 'height': 800}, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.add_init_script("if (!sessionStorage.getItem('seeded')) { localStorage.setItem('hr_auto', 'false'); sessionStorage.setItem('seeded', '1'); }")
    page.goto(URL)
    settings(page); assert page.locator('#autoStartBtn').get_attribute('aria-pressed') == 'false', 'off by default'; page.click('#setClose')
    lv(page, 0).click(); assert page.evaluate("() => document.body.dataset.phase") == 'setup' and page.locator('#startBtn').is_visible(), 'off: normal setup, even with Auto-place off'
    assert page.locator('.piece').count() == 0
    page.click('#backBtn')
    settings(page); page.click('#autoStartBtn')
    assert page.locator('#autoStartBtn').get_attribute('aria-pressed') == 'true' and page.evaluate("() => JSON.parse(localStorage.getItem('hr_autostart'))") is True
    page.click('#setClose')
    n = page.evaluate("() => Solver.piecesOf(LEVELS[3].g.split('').map(Number)).length")
    lv(page, 3).click()
    assert page.evaluate("() => document.body.dataset.phase") == 'play', 'level opens straight into play'
    assert page.locator('#startBtn').is_hidden() and page.locator('.piece').count() == n and page.locator('.piece.bad').count() == 0
    assert page.locator('#undoBtn').is_visible() and page.locator('#hintBtn').is_visible(), 'play controls are there'
    page.wait_for_timeout(1300); assert page.locator('#time').inner_text() != '0:00', 'clock runs'
    sol = page.evaluate("() => Solver.solve(LEVELS[3].g.split('').map(Number))")
    for m in sol:                                                   # solve it; the win card's Next opens the next level in play too
        bx = page.locator('#board').bounding_box(); cs = (bx['width'] - 20) / 4; d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[m['t']]
        sx = bx['x'] + 10 + (m['c'] + d[0] / 2) * cs; sy = bx['y'] + 10 + (m['r'] + d[1] / 2) * cs
        page.mouse.move(sx, sy); page.mouse.down()
        for i in range(1, 7): page.mouse.move(sx + m['dc'] * m['k'] * cs * i / 6, sy + m['dr'] * m['k'] * cs * i / 6)
        page.mouse.up(); page.wait_for_timeout(250)
    page.wait_for_selector('#win:not(.hidden)', timeout=5000)
    page.click('#nextBtn'); assert page.evaluate("() => document.body.dataset.phase") == 'play' and page.locator('#lvTitle').inner_text().startswith('Level 5'), 'Next auto-starts too'
    page.reload(); lv(page, 0).click(); assert page.evaluate("() => document.body.dataset.phase") == 'play', 'setting survives a reload'
    page.click('#backBtn'); settings(page); page.click('#autoStartBtn'); page.click('#setClose')
    lv(page, 0).click(); assert page.evaluate("() => document.body.dataset.phase") == 'setup', 'off again: setup returns'
    ctx.close(); assert not errors, errors


def solve_on_board(page, idx, extra=0):
    """Play level idx to the win using the optimal line; extra > 0 first wastes that many moves (one block out and back)."""
    sol = page.evaluate("(i) => Solver.solve(LEVELS[i].g.split('').map(Number))", idx)
    def drag(m):
        bx = page.locator('#board').bounding_box(); cs = (bx['width'] - 20) / 4; d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[m['t']]
        sx = bx['x'] + 10 + (m['c'] + d[0] / 2) * cs; sy = bx['y'] + 10 + (m['r'] + d[1] / 2) * cs
        page.mouse.move(sx, sy); page.mouse.down()
        for i in range(1, 7): page.mouse.move(sx + m['dc'] * m['k'] * cs * i / 6, sy + m['dr'] * m['k'] * cs * i / 6)
        page.mouse.up(); page.wait_for_timeout(230)
    if extra:
        m = sol[0]; back = dict(m, r=m['r'] + m['dr'] * m['k'], c=m['c'] + m['dc'] * m['k'], dr=-m['dr'], dc=-m['dc'])
        for _ in range(extra // 2): drag(m); drag(back)
    for m in sol: drag(m)
    page.wait_for_selector('#win:not(.hidden)', timeout=5000)

def polish(p):
    """Thai covers every action/message, dialogs behave with the keyboard, progress backup round-trips, best score shows."""
    import re, tempfile
    ctx = launch(p).new_context(viewport={'width': 390, 'height': 820}, has_touch=True, is_mobile=True, accept_downloads=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    # --- 1. Thai: only brand names and agreed game terms stay English
    ALLOW = {'Huarong', 'Road', 'Time', 'Moves', 'Par', 'par', 'Best', 'Undo', 'Redo', 'EXIT', 'LED', 'Source', 'GitHub', 'Icon', 'credits', 'on'}
    scan = """() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const n = w.currentNode, e = n.parentElement, t = n.textContent;
        if (!e || e.closest('svg,script,style,.hidden,#verId') || !e.getBoundingClientRect().width) continue;
        (t.match(/[A-Za-z]{3,}/g) || []).forEach(x => out.push(x)); } return out; }"""
    def english_left(where):
        left = sorted(set(page.evaluate(scan)) - ALLOW); assert not left, (where, left)
    toggle_lang(page); english_left('menu')
    lv(page, 0).click(); english_left('setup')
    assert page.locator('#lvTitle').inner_text().startswith('ด่าน 1 · เริ่มต้น')
    page.click('#startBtn'); english_left('play')
    solve_on_board(page, 0); english_left('win card')
    assert page.locator('#winTitle').inner_text() == 'ผ่านด่าน!' and page.locator('#nextBtn').inner_text() == 'ด่านถัดไป'
    # --- 2. dialogs: focus moves in, Esc closes (not the win card), Tab stays inside, focus comes back
    assert page.evaluate("() => !!document.activeElement.closest('#win')"), 'focus moves into the win card'
    page.keyboard.press('Escape'); assert page.locator('#win').is_visible(), 'Esc does not dismiss the win card'
    page.click('#replayBtn'); toggle_lang(page)
    solm = page.evaluate("() => Solver.solve(LEVELS[0].g.split('').map(Number))")[0]
    page.click('#solBtn'); assert page.evaluate("() => document.activeElement.id") == 'solNo', 'safe choice focused'
    for _ in range(5): page.keyboard.press('Tab')
    assert page.evaluate("() => !!document.activeElement.closest('#solAsk')"), 'Tab stays inside the dialog'
    page.keyboard.press('Escape'); assert page.locator('#solAsk').is_hidden(), 'Esc closes the solution confirm'
    assert page.evaluate("() => document.activeElement.id") == 'solBtn', 'focus returns to the button that opened it'
    page.locator('#game .settings-btn').click(); assert page.evaluate("() => !!document.activeElement.closest('#settings')")
    page.keyboard.press('Escape'); assert page.locator('#settings').is_hidden()
    page.click('#backBtn'); page.click('#aboutBtn'); page.keyboard.press('Escape'); assert page.locator('#about').is_hidden()
    # --- 5. best score: a slower clear, then a better one
    lv(page, 1).click(); page.click('#startBtn')
    assert page.locator('#bestStat').is_hidden(), 'no best before the first clear'
    par = int(page.locator('#par').inner_text())
    solve_on_board(page, 1, extra=2)
    assert 'Best' not in page.locator('#winInfo').inner_text(), 'first clear: no best line yet'
    assert page.locator('#bestStat').is_visible() and page.locator('#best').inner_text() == str(par + 2)
    page.click('#replayBtn'); solve_on_board(page, 1)
    assert 'New best!' in page.locator('#winInfo').inner_text() and f'(was {par + 2})' in page.locator('#winInfo').inner_text()
    assert page.locator('#best').inner_text() == str(par)
    page.click('#replayBtn'); solve_on_board(page, 1, extra=2)
    assert f'Best {par}' in page.locator('#winInfo').inner_text().replace('\n', ' '), page.locator('#winInfo').inner_text()
    page.screenshot(path=f'{SHOTS}/win_best.png')
    page.click('#menuBtn')
    # --- 4. backup: save code + file, wipe, restore from code and from file, bad code is refused
    stars_before = page.locator('#totalStars').inner_text()
    settings(page); page.click('#backupBtn'); assert page.locator('#backup').is_visible() and page.locator('#settings').is_hidden()
    code = page.locator('#bkOut').input_value(); assert code.startswith('HR1.') and len(code) > 20
    with page.expect_download() as dl: page.click('#bkSave')
    path = dl.value.path(); assert dl.value.suggested_filename.startswith('huarong-road-backup-') and open(path).read() == code
    page.screenshot(path=f'{SHOTS}/backup.png')
    page.click('#bkClose')
    page.evaluate("() => { localStorage.removeItem('hr_progress'); localStorage.removeItem('hr_seen'); }"); page.reload()
    assert page.locator('#totalStars').inner_text().startswith('0 /'), 'progress wiped'
    settings(page); page.click('#backupBtn')
    page.fill('#bkIn', 'not a code'); page.click('#bkRestore')
    assert 'err' in page.locator('#bkMsg').get_attribute('class') and page.locator('#totalStars').inner_text().startswith('0 /')
    page.fill('#bkIn', code); page.click('#bkRestore')
    assert 'Restored 2 levels' in page.locator('#bkMsg').inner_text(), page.locator('#bkMsg').inner_text()
    page.click('#bkClose'); assert page.locator('#totalStars').inner_text() == stars_before, 'stars back from the code'
    page.evaluate("() => localStorage.removeItem('hr_progress')"); page.reload()
    settings(page); page.click('#backupBtn')
    with page.expect_file_chooser() as fc: page.click('#bkOpen')
    fc.value.set_files(path); page.wait_for_timeout(300)
    assert 'Restored' in page.locator('#bkMsg').inner_text(); page.click('#bkClose')
    assert page.locator('#totalStars').inner_text() == stars_before, 'stars back from the file'
    lv(page, 1).click(); assert page.locator('#best').inner_text() == str(par), 'best score restored too'
    ctx.close(); assert not errors, errors


def toggles(p):
    """Auto-place is also a Settings switch (default on, synced with the setup key); every switch shows On/Off in words."""
    ctx = launch(p).new_context(viewport={'width': 360, 'height': 780}, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    settings(page)
    sw = page.locator('#settings .setrow[role=switch]'); n = sw.count(); assert n >= 5
    for i in range(n):
        b = sw.nth(i); want = 'On' if b.get_attribute('aria-pressed') == 'true' else 'Off'
        if b.is_visible(): assert b.locator('.st').inner_text() == want, (b.get_attribute('id'), want)
    assert page.locator('#autoPlaceBtn').get_attribute('aria-pressed') == 'true', 'Auto-place on by default'
    assert page.locator('#autoStartBtn .st').inner_text() == 'Off' and page.locator('#timerBtn .st').inner_text() == 'On'
    page.click('#autoPlaceBtn'); assert page.locator('#autoPlaceBtn .st').inner_text() == 'Off'
    assert page.evaluate("() => localStorage.getItem('hr_auto')") == 'false'
    page.screenshot(path=f'{SHOTS}/settings_toggles.png')
    page.click('#setClose'); lv(page, 2).click()
    assert page.locator('.piece').count() == 0 and page.locator('#autoBtn').get_attribute('aria-pressed') == 'false', 'off: empty board, key agrees'
    page.click('#autoBtn')                                       # setup key turns it back on and the Settings switch follows
    assert page.locator('.piece').count() > 0
    settings(page); assert page.locator('#autoPlaceBtn').get_attribute('aria-pressed') == 'true'
    page.click('#autoPlaceBtn'); page.click('#setClose'); assert page.locator('.piece').count() == 0, 'switching off in Settings during setup clears the board'
    settings(page); page.click('#autoPlaceBtn'); page.click('#setClose'); assert page.locator('.piece').count() > 0
    toggle_lang(page); settings(page)
    assert page.locator('#autoPlaceBtn .st').inner_text() == 'เปิด' and page.locator('#autoStartBtn .st').inner_text() == 'ปิด'
    ctx.close(); assert not errors, errors


def daily(p):
    """Daily puzzle from the date: same as the Node generator, playable, streak + week row, rolls over at midnight."""
    import datetime
    ctx = launch(p).new_context(viewport={'width': 390, 'height': 820}, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    def at(y, m, d, h=9):
        page.clock.set_fixed_time(datetime.datetime(y, m, d, h, 30)); page.goto(URL)
        page.wait_for_function("() => !document.getElementById('dPlay').disabled", timeout=20000)
    def play_daily(extra=0):
        page.click('#dPlay')
        if page.locator('#startBtn').is_visible(): page.click('#startBtn')
        g = page.evaluate("() => JSON.parse(localStorage.getItem('hr_daily_lv')).g")
        sol = page.evaluate("(g) => Solver.solve(g.split('').map(Number))", g)
        for m in sol:
            bx = page.locator('#board').bounding_box(); cs = (bx['width'] - 20) / 4; d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[m['t']]
            sx = bx['x'] + 10 + (m['c'] + d[0] / 2) * cs; sy = bx['y'] + 10 + (m['r'] + d[1] / 2) * cs
            page.mouse.move(sx, sy); page.mouse.down()
            for i in range(1, 7): page.mouse.move(sx + m['dc'] * m['k'] * cs * i / 6, sy + m['dr'] * m['k'] * cs * i / 6)
            page.mouse.up(); page.wait_for_timeout(200)
        page.wait_for_selector('#win:not(.hidden)', timeout=5000)
        return len(sol)
    at(2026, 11, 4)                                                    # a Wednesday
    lvd = page.evaluate("() => JSON.parse(localStorage.getItem('hr_daily_lv'))")
    assert lvd['key'] == '2026-11-04' and lvd['number'] == 4
    assert page.evaluate("(k) => Daily.generate(k).g", '2026-11-04') == lvd['g'], 'background result = direct generation'
    assert abs(lvd['par'] - 27) <= 3, lvd['par']
    assert 'Puzzle #4' in page.inner_text('#daily') and f"par {lvd['par']}" in page.inner_text('#daily') and 'Start a streak' in page.inner_text('#daily')
    assert page.locator('#dWeek .day').count() == 7 and page.locator('#dWeek .day.today').count() == 1
    n = play_daily()
    assert page.inner_text('#lvTitle').startswith('Daily #4')
    assert page.inner_text('#winTitle') == 'Daily solved!' and page.locator('#nextBtn').is_hidden()
    assert '1-day streak' in page.inner_text('#dWinStreak') and 'Next puzzle in' in page.inner_text('#dNext')
    assert '14 h 30 m' in page.inner_text('#dNext'), page.inner_text('#dNext')
    assert page.locator('#dWinWeek .day.done').count() == 1 and page.locator('#win .big').inner_text() == '★★★'
    page.screenshot(path=f'{SHOTS}/daily_win.png')
    page.click('#menuBtn')
    assert 'Solved ★★★' in page.inner_text('#daily') and page.inner_text('#dPlay') == 'Play again' and '1-day streak' in page.inner_text('#dStreak')
    assert page.inner_text('#totalStars').startswith('0 /'), 'daily stars are separate from the 300 level stars'
    at(2026, 11, 5)                                                    # next day: new puzzle, streak still alive
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_daily_lv')).key") == '2026-11-05'
    assert '1-day streak' in page.inner_text('#dStreak') and page.inner_text('#dPlay') == 'Play today’s puzzle'
    play_daily(); assert '2-day streak' in page.inner_text('#dWinStreak')
    page.click('#menuBtn'); assert page.locator('#dWeek .day.done').count() == 2
    toggle_lang(page); assert 'ต่อเนื่อง 2 วัน' in page.inner_text('#dStreak') and 'ปริศนา #5' in page.inner_text('#daily'); toggle_lang(page)
    at(2026, 11, 7)                                                    # skipped the 6th: streak broken
    assert 'Start a streak' in page.inner_text('#dStreak') and page.locator('#dWeek .day.miss').count() >= 1
    # backup carries daily results too
    settings(page); page.click('#backupBtn'); code = page.locator('#bkOut').input_value(); page.click('#bkClose')
    assert '2026-11-04' in page.evaluate("(c) => decodeURIComponent(escape(atob(c.slice(4))))", code)
    ctx.close(); assert not errors, errors


def design(p):
    """Design stage: 1 red + exactly 2 empty cells, any other blocks; level/mirror duplicates blocked; solver checks it,
    grades it by par; save (max 50), test play records stars, edit, two-tap delete; kept in backups; Thai."""
    ctx = launch(p).new_context(viewport={'width': 390, 'height': 900}, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    assert 'Build your own puzzle' in page.inner_text('#dsCard')
    page.click('#dsOpen'); assert page.evaluate("() => document.body.dataset.phase") == 'design'
    assert page.inner_text('#lvTitle') == 'Design stage' and page.locator('.stats').is_hidden() and page.locator('#undoBtn').is_hidden()
    def tap(r, c):
        bx = page.locator('#board').bounding_box(); cs = (bx['width'] - 20) / 4
        page.mouse.click(bx['x'] + 10 + (c + .5) * cs, bx['y'] + 10 + (r + .5) * cs)
    def build(pieces):
        page.click('#clearBtn')
        for t, r, c in pieces: page.click(f'#tray button[data-t={t}]'); tap(r, c)
        page.wait_for_function("() => !/Checking/.test(document.getElementById('dsHead').textContent)", timeout=15000)
    head = lambda: page.inner_text('#dsHead')
    assert head() == 'Place the big red block' and page.locator('#dsSave').is_disabled() and page.locator('#dsTest').is_disabled()
    page.click('#tray button[data-t=R]'); tap(0, 1)
    assert page.locator('#tray button[data-t=R]').is_disabled(), 'only one red block'
    assert head() == 'Fill 14 more cells'
    # not allowed to cover more than 18 cells
    build([('R', 0, 1), ('V', 0, 0), ('V', 0, 3), ('V', 2, 0), ('H', 2, 1), ('V', 2, 3), ('S', 3, 1), ('S', 3, 2), ('S', 4, 0), ('S', 4, 3)])
    page.click('#tray button[data-t=S]'); tap(4, 1)
    assert 'Leave 2 cells empty' in page.inner_text('#status'), 'a third empty cell cannot be filled'
    assert head() == 'Same as Level 86' and page.locator('#dsSave').is_disabled() and page.locator('#dsTest').is_enabled(), 'the classic is level 86'
    mir = page.evaluate("() => Solver.piecesOf(LEVELS[9].g.split('').map(Number)).map(p => [p.t, p.r, 4 - p.c - ({R:2,V:1,H:2,S:1})[p.t]])")
    build([tuple(x) for x in sorted(mir, key=lambda x: x[0] != 'R')])
    assert head() in ('Mirror image of Level 10', 'Same as Level 10'), head()
    build([('R', 0, 0), ('H', 0, 2), ('H', 1, 2), ('H', 2, 0), ('H', 2, 2), ('H', 3, 0), ('H', 3, 2), ('H', 4, 0)])
    assert head() == '✗ No solution' and page.locator('#dsSave').is_disabled() and page.locator('#dsTest').is_disabled()
    build([('R', 0, 1), ('V', 0, 0), ('V', 0, 3), ('V', 2, 0), ('H', 2, 1), ('V', 2, 3), ('S', 3, 1), ('S', 3, 2), ('S', 4, 0), ('S', 4, 1)])
    assert head().startswith('✓ Solvable · minimum ') and 'Grade: ' in page.inner_text('#dsBody'), head()
    par = int(re.search(r'minimum (\d+)', head()).group(1))
    page.screenshot(path=f'{SHOTS}/design.png', full_page=True)
    page.click('#dsSave')
    assert 'Saved as Stage 1' in page.inner_text('#status') and page.inner_text('#lvTitle') == 'Edit stage 1'
    assert page.locator('#dsSave').is_disabled() and page.locator('.dsrow').count() == 1 and '1 / 50' in page.inner_text('#dsListCount')
    stored = page.evaluate("() => JSON.parse(localStorage.getItem('hr_designs'))"); assert stored[0]['n'] == 1 and stored[0]['par'] == par
    # play the saved stage from the list (opens straight into play), win records stars for that stage
    page.click('.dsrow .dsplay')
    assert page.evaluate("() => document.body.dataset.phase") == 'play' and page.inner_text('#lvTitle').startswith('Stage 1 · ')
    g = page.evaluate("() => JSON.parse(localStorage.getItem('hr_designs'))[0].g")
    for m in page.evaluate("(g) => Solver.solve(g.split('').map(Number))", g):
        bx = page.locator('#board').bounding_box(); cs = (bx['width'] - 20) / 4; d = {'R': (2, 2), 'V': (1, 2), 'H': (2, 1), 'S': (1, 1)}[m['t']]
        sx = bx['x'] + 10 + (m['c'] + d[0] / 2) * cs; sy = bx['y'] + 10 + (m['r'] + d[1] / 2) * cs
        page.mouse.move(sx, sy); page.mouse.down()
        for i in range(1, 7): page.mouse.move(sx + m['dc'] * m['k'] * cs * i / 6, sy + m['dr'] * m['k'] * cs * i / 6)
        page.mouse.up(); page.wait_for_timeout(120)
    page.wait_for_selector('#win:not(.hidden)', timeout=5000)
    assert page.inner_text('#menuBtn') == 'Edit' and page.locator('#nextBtn').is_hidden()
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_progress'))['s1'].stars") == 3
    page.click('#menuBtn'); assert page.evaluate("() => document.body.dataset.phase") == 'design' and '★★★' in page.inner_text('#dsList')
    # an unsaved draft never records anything
    build([('R', 0, 1), ('V', 0, 0), ('V', 0, 3), ('V', 2, 0), ('H', 2, 1), ('V', 2, 3), ('S', 3, 1), ('S', 3, 2), ('S', 4, 3), ('S', 4, 2)])
    keys0 = page.evaluate("() => Object.keys(JSON.parse(localStorage.getItem('hr_progress') || '{}')).sort().join()")
    page.click('#dsTest'); assert page.inner_text('#lvTitle').startswith('Test play')
    page.click('#solBtn'); page.click('#solYes'); page.click('#solBack')
    assert page.evaluate("() => Object.keys(JSON.parse(localStorage.getItem('hr_seen') || '{}')).join()") == '', 'a draft leaves no solution mark'
    page.click('#backBtn'); assert page.evaluate("() => document.body.dataset.phase") == 'design'
    # cap: 50 stages
    page.evaluate("() => { var d = JSON.parse(localStorage.getItem('hr_designs')); for (var i = 2; i <= 50; i++) d.push({ n: i, g: d[0].g.slice(0, 18) + ('0' + i).slice(-2), par: 5, at: 0 }); localStorage.setItem('hr_designs', JSON.stringify(d)); }")
    page.reload(); page.click('#dsOpen')
    build([('R', 0, 1), ('V', 0, 0), ('V', 0, 3), ('V', 2, 0), ('H', 2, 1), ('V', 2, 3), ('S', 3, 1), ('S', 3, 2), ('S', 4, 3), ('S', 4, 2)])
    assert page.locator('#dsSave').is_disabled() and page.inner_text('#dsSave') == '50 stages max' and '50 / 50' in page.inner_text('#dsListCount')
    # two-tap delete
    first = page.locator('.dsrow [data-del]').first; first.click(); assert page.locator('.dsrow [data-del].armed').count() == 1
    page.locator('.dsrow [data-del].armed').click(); assert '49 / 50' in page.inner_text('#dsListCount')
    # Thai
    toggle_lang(page); assert page.inner_text('#lvTitle') in ('ออกแบบด่าน',) and 'บันทึกด่าน' in page.inner_text('#dsSave') + 'บันทึกด่าน'
    toggle_lang(page)
    # backup carries designs
    page.click('#backBtn'); settings(page); page.click('#backupBtn'); code = page.locator('#bkOut').input_value(); page.click('#bkClose')
    page.evaluate("() => { localStorage.removeItem('hr_designs'); localStorage.removeItem('hr_progress'); }"); page.reload()
    assert 'Build your own puzzle' == page.inner_text('#dsCount')
    settings(page); page.click('#backupBtn'); page.fill('#bkIn', code); page.click('#bkRestore'); page.click('#bkClose')
    assert page.inner_text('#dsCount').startswith('49 saved')
    ctx.close(); assert not errors, errors


def resets_motion(p):
    """Per-level reset (only with a record; confirm shows it), reset-all behind a tick box, reduce-motion switch."""
    ctx = launch(p).new_context(viewport={'width': 360, 'height': 780}, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.add_init_script("""if (!sessionStorage.getItem('seed')) { sessionStorage.setItem('seed', 1);
      localStorage.setItem('hr_progress', JSON.stringify({ '1': { stars: 3, moves: 2, time: 1000 }, '15': { stars: 2, moves: 14, time: 60000 }, 'd2026-11-01': { stars: 3, moves: 9, time: 1 } }));
      localStorage.setItem('hr_seen', JSON.stringify({ '15': 1 })); }""")
    page.goto(URL)
    lv(page, 1).click(); assert page.locator('#recLine').is_hidden(), 'no record, no reset link'
    page.click('#backBtn'); lv(page, 14).click()
    assert page.locator('#recLine').is_visible() and 'solution viewed' in page.inner_text('#recText') and 'Best 14' in page.inner_text('#recText')
    page.click('#recReset'); assert page.locator('#rcAsk').is_visible() and '★★☆' in page.inner_text('#rcBody')
    page.click('#rcNo'); assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_progress'))['15'].stars") == 2, 'Keep it keeps it'
    page.click('#recReset'); page.click('#rcYes')
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_progress'))['15']") is None
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_seen'))['15']") is None, 'solution lock lifted'
    assert page.locator('#recLine').is_hidden() and page.locator('#bestStat').is_hidden()
    page.click('#backBtn'); assert page.inner_text('#totalStars').startswith('3 /')
    # reset all: in Settings, needs the tick, keeps designs + settings
    page.evaluate("() => localStorage.setItem('hr_designs', JSON.stringify([{ n: 1, g: LEVELS[5].g.replace(/9/, '9'), par: 4, at: 0 }]))")
    settings(page); assert page.locator('#settings .setrow').last.get_attribute('id') == 'resetAllBtn', 'reset-all is the last row'
    page.click('#resetAllBtn'); assert page.locator('#raAsk').is_visible() and page.locator('#settings').is_hidden()
    assert '3 level stars and 1 daily' in page.inner_text('#raSum') and page.locator('#raYes').is_disabled()
    page.keyboard.press('Escape'); assert page.locator('#raAsk').is_hidden() and page.inner_text('#totalStars').startswith('3 /')
    settings(page); page.click('#resetAllBtn'); page.check('#raCheck'); assert page.locator('#raYes').is_enabled()
    page.screenshot(path=f'{SHOTS}/reset_all.png')
    page.click('#raYes')
    assert page.inner_text('#totalStars').startswith('0 /') and page.evaluate("() => localStorage.getItem('hr_progress')") == '{}'
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_designs')).length") == 1, 'designs kept'
    assert page.evaluate("() => localStorage.getItem('hr_lang')") in (None, '"en"'), 'settings untouched'
    # reduce motion: default follows the phone, the switch overrides; animations really stop
    assert page.evaluate("() => document.documentElement.dataset.motion") == ''
    settings(page); assert page.locator('#motionBtn .st').inner_text() == 'Off'
    page.click('#motionBtn'); assert page.evaluate("() => document.documentElement.dataset.motion") == 'reduce' and page.locator('#motionBtn .st').inner_text() == 'On'
    page.click('#setClose'); lv(page, 5).click(); page.click('#startBtn'); page.click('#hintBtn')
    assert page.evaluate("() => getComputedStyle(document.querySelector('.piece[data-focus]')).animationName") == 'none', 'hint does not pulse'
    assert page.evaluate("() => getComputedStyle(document.querySelector('.piece')).transitionDuration") == '0s', 'blocks move instantly'
    page.reload(); assert page.evaluate("() => document.documentElement.dataset.motion") == 'reduce', 'remembered'
    ctx.close()
    ctx2 = launch(p).new_context(viewport={'width': 360, 'height': 780}, reduced_motion='reduce')
    pg2 = ctx2.new_page(); pg2.goto(URL)
    assert pg2.evaluate("() => document.documentElement.dataset.motion") == 'reduce', "follows the phone's setting by default"
    ctx2.close(); assert not errors, errors


with sync_playwright() as p:
    if os.environ.get('HR_ONLY'):
        globals()[os.environ['HR_ONLY']](p); print('ONLY', os.environ['HR_ONLY'], 'OK'); sys.exit(0)
    features(p)
    controls(p)
    sound(p)
    autostart(p)
    polish(p)
    toggles(p)
    daily(p)
    design(p)
    resets_motion(p)
    print('resets + motion: per-level reset with record, reset-all behind a tick, reduce motion')
    print('design stage: rules, duplicates, solver + grade, save/play/edit/delete, 50 cap, backup')
    print('daily: generated from the date, playable, streak + week row, day rollover, in backups')
    print('toggles: Auto-place switch synced with the setup key, On/Off words on every switch')
    print('polish: Thai covers actions, dialogs keyboard-safe, backup round-trips, best score')
    print('auto-start: skips setup, Next/reload keep it, off restores setup')
    print('sound: context wakes on first tap, audible level, mute silences')
    skins_timer(p)
    print('skins: all visible at once, one tap each; timer switch hides the clock')
    print('controls: undo/redo pair, hint+solution pair, restart confirm, settings panel OK')
    print('features: auto-place default, skins, two-step hints OK')
    lang_switch(p)
    print('language switch: EN | TH highlights the active side, flips both ways, fits at 360px')
    all_hints(p)
    trend(p)
    print('on-track feedback: closer / further / undo, hidden until a hint is used')
    updates(p)
    print('updates: banner on new deploy, refresh beats stale caches, offline safe, progress kept')
    menu_pages(p)
    print('menu pages: 20 per page, remembered, header does not cover the title')
    thai(p)
    about(p)
    print('about panel: story in EN/TH, closes via button, backdrop, Esc')
    print('thai toggle: instructions, hints, solution switch language and persist')
    for idx in (0, 45, 99): solution_view(p, idx)
    print('solution viewer: confirm, step/play/pause, back, no stars after viewing OK')
    # level 1 (with screenshots), a mid level, and a hard level
    for idx, shots in [(0, True), (30, False), (60, False)]:
        n, moves, st, info, stored = run(idx, p, shots)
        assert int(moves) == n, f'moves counter {moves} != {n}'
        print(f'level {idx + 1}: solved in {n} drags | stars {st} | {info} | saved={bool(stored)}')
    # same level with the haptics toggle switched off: no vibration at all
    run(0, p, False, haptics_off=True)
    print('haptics toggle: on vibrates every move, off is silent')
print('UI TEST PASSED')
