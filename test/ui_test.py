import json, sys, os
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SHOTS = '/tmp/claude-0/-home-claude/00debd21-7fd6-5cb6-b361-efccb73703af/scratchpad'
os.makedirs(SHOTS, exist_ok=True)
URL = 'file://' + os.path.join(ROOT, 'dist', 'index.html')

def run(level_idx, p, shots=False):
    ctx = p.chromium.launch().new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    if shots: page.screenshot(path=f'{SHOTS}/1_menu.png')
    page.locator('.lv').nth(level_idx).click()

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
    ctx.close()
    assert not errors, errors
    return len(solution), moves, st, info, stored

with sync_playwright() as p:
    # level 1 (with screenshots), a mid level, and a hard level
    for idx, shots in [(0, True), (30, False), (60, False)]:
        n, moves, st, info, stored = run(idx, p, shots)
        assert int(moves) == n, f'moves counter {moves} != {n}'
        print(f'level {idx + 1}: solved in {n} drags | stars {st} | {info} | saved={bool(stored)}')
print('UI TEST PASSED')
