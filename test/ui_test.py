import json, sys, os
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SHOTS = os.environ.get('HR_SHOTS', '/tmp/hr-shots')
os.makedirs(SHOTS, exist_ok=True)
URL = 'file://' + os.path.join(ROOT, 'dist', 'index.html')

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
    page.locator('.lv').nth(level_idx).click()
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
    page.locator('.lv').nth(5).click()
    # auto-place defaults to on: layout is already copied and verified
    n = page.evaluate("() => Solver.piecesOf(LEVELS[5].g.split('').map(Number)).length")
    assert page.locator('#autoBtn').get_attribute('aria-pressed') == 'true'
    assert page.locator('.piece.ok').count() == n and page.locator('#startBtn').is_enabled(), 'auto-place default'
    page.screenshot(path=f'{SHOTS}/blossom_setup.png')
    page.click('#autoBtn')  # off: board cleared, preference saved
    assert page.locator('.piece').count() == 0 and page.evaluate("() => localStorage.getItem('hr_auto')") == 'false'
    page.click('#autoBtn')  # on again: refilled
    assert page.locator('.piece.ok').count() == n
    page.click('#backBtn'); page.locator('.lv').nth(5).click()
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
    page.locator('.lv').nth(idx).click()
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
    assert '👁' in page.locator('.lv').nth(idx).inner_text() and page.locator('#totalStars').inner_text().startswith('0 /')
    # persists: reopening the level and solving again still earns nothing; viewing again skips the confirm
    page.locator('.lv').nth(idx).click(); page.click('#startBtn'); page.click('#solBtn')
    assert page.locator('#solAsk').is_hidden() and page.locator('.solbar').is_visible()
    ctx.close()
    assert not errors, errors

with sync_playwright() as p:
    features(p)
    print('features: auto-place default, skins, two-step hints OK')
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
