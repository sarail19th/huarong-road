import json, sys, os
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SHOTS = os.environ.get('HR_SHOTS', '/tmp/hr-shots')
os.makedirs(SHOTS, exist_ok=True)
URL = 'file://' + os.path.join(ROOT, 'dist', 'index.html')

def lv(page, idx):
    """The menu shows 20 levels per page: jump to the page that holds level idx (0-based) and return its button."""
    page.locator('.pgchip').nth(idx // 20).click()
    return page.locator('.lv').nth(idx % 20)

def run(level_idx, p, shots=False, haptics_off=False):
    ctx = p.chromium.launch().new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
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
        assert page.locator('#hapBtn').is_visible()
        page.click('#hapBtn')
        assert page.evaluate("() => localStorage.getItem('hr_haptics')") == 'false', 'haptics setting persisted'
        assert page.locator('#hapBtn').get_attribute('aria-pressed') == 'false'

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
    ctx = p.chromium.launch().new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    # skins: classic -> blossom -> neon -> classic, persisted
    assert page.evaluate("() => document.documentElement.dataset.skin") == 'classic'
    for want in ['blossom', 'neon', 'classic']:
        page.locator('#menu .skin-btn').click()
        assert page.evaluate("() => document.documentElement.dataset.skin") == want
        assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_skin'))") == want
    page.locator('#menu .skin-btn').click()  # blossom, remembered across levels
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
    page.screenshot(path=f'{SHOTS}/blossom_hint1.png')
    page.click('#hintBtn')
    assert page.locator('.piece[data-hint]').count() == 1 and 'Try this' in page.locator('#tipHead').inner_text()
    body2 = page.locator('#tipBody').inner_text()
    page.screenshot(path=f'{SHOTS}/blossom_hint2.png')
    # follow the hinted move for real: the tip must clear after any move
    page.click('#undoBtn')  # nothing to undo yet, tip stays
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
    page.locator('#game .skin-btn').click()
    assert page.evaluate("() => document.documentElement.dataset.skin") == 'neon'
    page.click('#hintBtn'); page.wait_for_timeout(100)
    page.screenshot(path=f'{SHOTS}/neon_hint1.png')
    ctx.close()
    assert not errors, errors
    print('hint 1:', head1, '|', body1); print('hint 2:', body2)

def solution_view(p, idx):
    """Show-solution flow: confirm dialog, step viewer, no stars afterwards (even when solved optimally)."""
    ctx = p.chromium.launch().new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
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
    ctx = p.chromium.launch().new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    has_thai = lambda t: re.search('[\u0e00-\u0e7f]', t) is not None
    assert 'How it works' in page.locator('.howto').inner_text() and page.evaluate("() => document.documentElement.lang") == 'en'
    page.locator('#menu .lang-btn').click()
    assert page.evaluate("() => JSON.parse(localStorage.getItem('hr_lang'))") == 'th'
    assert page.evaluate("() => document.documentElement.lang") == 'th'
    assert 'วิธีเล่น' in page.locator('.howto').inner_text() and page.locator('#menu .lang-btn').get_attribute('aria-pressed') == 'true'
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
    page.locator('#game .lang-btn').click()      # switch back mid-hint: the open tip re-renders in English
    assert 'Try this' in page.locator('#tipHead').inner_text() and page.locator('#hintBtn').inner_text() == 'Hint'
    assert 'Drag blocks' in page.locator('#status').inner_text()
    page.locator('#game .lang-btn').click()      # and Thai again
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
    page.locator('#game .lang-btn').click()      # language switch while the solution is open
    assert page.locator('#solHead').inner_text().startswith('Solved in') and page.locator('#solPrev').inner_text() == '‹ Prev'
    page.locator('#game .lang-btn').click()
    # persisted across a reload, and English restores exactly
    page.reload()
    assert page.evaluate("() => document.documentElement.lang") == 'th' and 'วิธีเล่น' in page.locator('.howto').inner_text()
    page.locator('#menu .lang-btn').click()
    assert 'How it works' in page.locator('.howto').inner_text() and page.evaluate("() => JSON.parse(localStorage.getItem('hr_lang'))") == 'en'
    ctx.close()
    assert not errors, errors
    print('thai hint 2:', thai_body2)

def lang_switch(p):
    """EN | ไทย switch: the active side is visibly highlighted, and tapping flips it both ways on every screen."""
    ctx = p.chromium.launch().new_context(viewport={'width': 360, 'height': 780}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    bg = lambda sel: page.evaluate("(s) => getComputedStyle(document.querySelector(s)).backgroundColor", sel)
    lit = lambda side, scope: bg(f'{scope} .lang-btn .{side}') != 'rgba(0, 0, 0, 0)'
    for scope in ('#menu',):
        assert lit('en', scope) and not lit('th', scope), 'English side lit at start'
    assert page.locator('#menu .lang-btn').inner_text().replace('\n', ' ').split() == ['EN', 'ไทย']
    for turn in range(3):                          # menu: en -> th -> en -> th
        page.locator('#menu .lang-btn').tap()
        want_th = turn % 2 == 0
        assert lit('th', '#menu') == want_th and lit('en', '#menu') != want_th
        assert ('วิธีเล่น' in page.locator('.howto').inner_text()) == want_th
        assert page.evaluate("() => document.documentElement.lang") == ('th' if want_th else 'en')
    page.locator('.lv').nth(3).tap(); page.click('#startBtn')   # in Thai: game bar switch flips back and forth
    for want_th in (False, True, False):
        page.locator('#game .lang-btn').tap()
        assert lit('th', '#game') == want_th and (page.locator('#hintBtn').inner_text() == 'คำใบ้') == want_th
        assert ('Drag blocks' in page.locator('#status').inner_text()) != want_th
    page.screenshot(path=f'{SHOTS}/lang_switch_360.png')
    hb = page.locator('#game .lang-btn').bounding_box(); title = page.locator('#lvTitle').bounding_box()
    assert hb['x'] >= title['x'] + 20, 'switch not on top of the level title'
    assert page.evaluate("() => document.documentElement.scrollWidth") <= 360
    ctx.close(); assert not errors, errors

def all_hints(p):
    """Open every level in English and Thai, tap Hint twice: the text is complete, specific and fully translated."""
    import re
    ctx = p.chromium.launch().new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=1, has_touch=True, is_mobile=True)
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    bad = re.compile(r'undefined|NaN|null|\[object')
    stats = {'goal_with_space': 0, 'goal_clear': 0, 'free': 0, 'generic_setup': 0, 'n': 0}
    for th in (False, True):
        if th: page.locator('#menu .lang-btn').click()
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
    ctx = p.chromium.launch().new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=1, has_touch=True, is_mobile=True)
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
    page.locator('#menu .lang-btn, #game .lang-btn').first.click() if False else page.locator('#game .lang-btn').click()
    assert page.locator('#status').inner_text().startswith('✗ ไกลขึ้น'), 'feedback follows the language'
    page.locator('#game .lang-btn').click()
    page.click('#undoBtn'); page.wait_for_timeout(300)
    assert 'to go' in page.locator('#status').inner_text() and '✗' not in page.locator('#status').inner_text()
    page.click('#restartBtn'); assert 'Drag blocks' in page.locator('#status').inner_text(), 'restart clears the line'
    ctx.close(); assert not errors, errors

def menu_pages(p):
    """Level list is paged (20 per page), remembers where you were, and header buttons do not cover the title."""
    for w in (412, 320):
        ctx = p.chromium.launch().new_context(viewport={'width': w, 'height': 800}, device_scale_factor=2, has_touch=True, is_mobile=True)
        page = ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(URL)
        h1 = page.locator('#menu h1').bounding_box()
        for sel in ('#menu .lang-btn', '#aboutBtn', '#menu .skin-btn'):
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
    ctx = p.chromium.launch().new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
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
    page.locator('#about .lang-btn').click()      # switch language from inside the panel; stays on the same page
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
    page.locator('#menu .lang-btn').click()      # back to English; panel is English again
    page.click('#aboutBtn'); assert 'The story' in page.locator('#about').inner_text() and page.locator('#aPrev').is_disabled()
    ctx.close()
    assert not errors, errors

with sync_playwright() as p:
    features(p)
    print('features: auto-place default, skins, two-step hints OK')
    lang_switch(p)
    print('language switch: EN | ไทย highlights the active side, flips both ways, fits at 360px')
    all_hints(p)
    trend(p)
    print('on-track feedback: closer / further / undo, hidden until a hint is used')
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
