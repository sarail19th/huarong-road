# Huarong Road

Klotski-style sliding-block puzzle (4x5 board, slide the big red 2x2 to the bottom-centre exit). Plain HTML/CSS/JS, no framework, no runtime dependencies. Ships as one self-contained `dist/index.html` that works as an installable Android PWA (Chrome -> Add to Home screen).

## Layout
- `src/solver.js` - board model + BFS solver. Grid is 20 cells, row-major. Codes: 0 empty, 1-4 red 2x2 (TL,TR,BL,BR), 5-6 vertical 1x2, 7-8 horizontal 2x1, 9 single. One "move" = one block slid any distance in a straight line. Goal: red top-left at row 3, col 1.
- `src/levels.js` - GENERATED (100 levels, `{id, par, g}`). Do not hand-edit; run the generator.
- `src/game.js` - UI: setup phase (copy the LED layout, chip check = piece type at the right cell; the Auto-place toggle, default ON, pre-fills every level), play phase (pointer-drag sliding, undo, restart, two-step explained hints built from the optimal line: tap 1 names the next goal (the blocker the line frees first, how many of the cells it needs are empty, how many moves to make room) and outlines it; tap 2 shows the exact move plus why it helps (it is the blocker / sits on a needed cell / brings the gap next to it / empties the space the next move needs); once a hint was used, each move shows ✓ closer / ↔ no progress / ✗ further via a lazily cached distance-to-goal, `distOf`), skins (classic / blossom pastel pink+black / neon green+black via `<html data-skin>` CSS variables), solution viewer ("Show solution" -> confirm -> step/play through the BFS-optimal line from the start position; viewing it records the level in `hr_seen` and wins on that level earn 0 stars, forever), a language switch (`EN | TH`, active side highlighted, `hr_lang`) that switches the how-to, status messages, hints and solution viewer to Thai (`L(en, th)` in code, `data-th` attributes in the HTML for static text), a `?` About panel (4 pages with Back/Next and dots; story behind the name, Thai-aware; numbers quoted there were checked against the solver), an in-app updater (`↻` button on the menu: probes the server, clears caches + old service worker, reloads; plus a "new version ready · Update" banner when a new worker takes over; progress/localStorage is never touched; the menu shows `Version <hash>`), a paged level menu (20 levels per page via chips + prev/next, `hr_page` remembers the page, opening a level moves the menu to its page), win + stars + localStorage progress (`hr_progress`, `hr_seen`, `hr_auto`, `hr_skin`, `hr_muted`, `hr_haptics`, `hr_lang`, `hr_page`).
- `src/style.css`, `src/index.html` - templates with `/*INLINE_...*/` placeholders.
- `gen/gen.js` - level generator (seeded, deterministic). `gen/icons.py` - PWA icons (needs Pillow).
- `build.js` - inlines everything into `dist/index.html` (stamping `__BUILD__` with a content hash that also names the service worker cache; the worker fetches its files with `cache:'reload'`), writes manifest + service worker, and `dist/artifact.html` (title + style + body only, for the claude.ai Artifact tool).
- `test/test.js` - verifies every level (solvable, par == true optimum, replay is legal). `test/ui_test.py` - Playwright mobile-viewport end-to-end test (needs `pip install playwright` + Chromium).

## Commands
```
node gen/gen.js        # regenerate src/levels.js (~25 s)
node test/test.js      # must print "OK: 100 levels verified"
node build.js          # produce dist/
python3 gen/icons.py   # icons into dist/ (run after build)
python3 test/ui_test.py
```
Serve `dist/` over https (or localhost) for the service worker to register; opening the file directly also works but skips the PWA parts.

## Rules when changing things
- Changing the solver, grid codes, or generator: re-run `node gen/gen.js` and `node test/test.js`.
- Keep `par` equal to the true BFS optimum; star rating depends on it (<= par = 3 stars, <= 1.4x par = 2).
- UI changes: rebuild and run `python3 test/ui_test.py`.
- New guidance text (hints, status, solution, about) needs a Thai version too: use `L(en, th)` in JS or `data-th` in HTML.
- Piece animations must not scale (pieces are positioned with `transform: translate`, scaling shifts them).

## Ideas not built yet
Daily puzzle, level editor, Capacitor/TWA wrapper for a real APK.
