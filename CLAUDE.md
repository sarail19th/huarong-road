# Huarong Road

Klotski-style sliding-block puzzle (4x5 board, slide the big red 2x2 to the bottom-centre exit). Plain HTML/CSS/JS, no framework, no runtime dependencies. Ships as one self-contained `dist/index.html` that works as an installable Android PWA (Chrome -> Add to Home screen).

## Layout
- `src/solver.js` - board model + BFS solver. Grid is 20 cells, row-major. Codes: 0 empty, 1-4 red 2x2 (TL,TR,BL,BR), 5-6 vertical 1x2, 7-8 horizontal 2x1, 9 single. One "move" = one block slid any distance in a straight line. Goal: red top-left at row 3, col 1.
- `src/daily.js` - daily puzzle, generated on the device from the local date (offline; same puzzle for everyone that day): seeded random tiling + full state-space BFS like `gen/gen.js`, par = true optimum, weekday difficulty targets (`TARGET`, Mon 14 ... Sun 62). Daily #1 = 1 Nov 2026. UMD, also used by `test/test.js`.
- `src/levels.js` - GENERATED (100 levels, `{id, par, g}`). Do not hand-edit; run the generator.
- `src/game.js` - all UI logic. Main pieces:
  - **Setup phase:** copy the LED layout; chip check = piece type at the right cell. The Auto-place toggle (default ON, `hr_auto`) pre-fills every level.
  - **Play phase:** pointer-drag sliding. Undo + Redo are grouped in one pill beside the LED; Hint + Show solution are grouped under the board; Restart sits in the top bar away from Undo and asks first when moves would be lost. Buttons use a flat inline-SVG icon set (a `<symbol>` sprite at the top of `index.html`, drawn with `currentColor`; most shapes are adapted from Google's Material Design icons, Apache-2.0, see `NOTICE.md`; no Flaticon files).
  - **Hints:** two explained taps built from the optimal line. Tap 1 names the next goal (the blocker the line frees first, how many of the cells it needs are empty, how many moves to make room) and outlines it. Tap 2 shows the exact move plus why it helps (it is the blocker / sits on a needed cell / brings the gap next to it / empties the space the next move needs). Once a hint was used, each move shows ✓ closer / ↔ no progress / ✗ further via a lazily cached distance-to-goal, `distOf`.
  - **Solution viewer:** "Show solution" -> confirm -> step/play through the BFS-optimal line from the start position. Viewing it records the level in `hr_seen`; wins on that level earn 0 stars, forever.
  - **Settings panel** (gear, top-right on the menu and in the game). In order: language switch (`EN | TH`, active side highlighted, `hr_lang`); skin picker (8 skins: classic, blossom, neon, ocean, sunset, forest, mono, gold, all shown at once as live preview tiles; each skin is a `[data-skin=...]` block of CSS variables in `style.css` that sets every variable it uses, and a tile carries its own `data-skin` to paint itself; `hr_skin`); sound (`hr_muted`); vibration (`hr_haptics`, hidden where unsupported); Auto-place switch (`hr_auto`, same setting as the key on the setup screen, kept in sync); Auto-start switch (`hr_autostart`, default off: opening a level places the blocks and starts playing at once, skipping the chips and the Start button; it overrides Auto-place); Timer switch (`hr_timer`; off = no-stress mode: the clock and the win-card time are hidden, time is still tracked); Back up progress (opens a dialog: copy a `HR1.<base64 JSON>` code or save it as a .txt file, restore from a pasted code or a file; restoring merges, keeping the best of both, and never loses progress). Every switch shows On/Off (เปิด/ปิด) beside the pill.
  - **Language:** `EN | TH` switches every action, message, hint, grade name and the solution viewer to Thai; brand name and the game terms Moves, Par, Time, Best, Undo, Redo and EXIT stay English on purpose (`L(en, th)` in code, `data-th` attributes in the HTML for static text). The switch also lives in the About panel.
  - **Dialogs:** `openDlg`/`closeDlg` move keyboard focus into a dialog and back to the opener; Esc closes the top dialog (except the win card); Tab stays inside.
  - **Daily puzzle:** card at the top of the menu (date, streak, LED preview, grade + par, this week's row, Play). Generated once per day in a Web Worker built from the inlined `srcSolver` + `srcDaily` scripts (falls back to the main thread), cached in `hr_daily_lv`. Results live in `hr_progress` under `d<YYYY-MM-DD>` (so backups include them; they do not count toward the 300 level stars). Streak = consecutive solved days back from today (or yesterday while today is open). The win card shows streak, week row and a countdown to midnight.
  - **Design stage** (menu card -> `openDesign`, game screen in phase `design`): tap a block type in the tray, tap the board to place it, tap a block to remove it. Rules: exactly one red 2x2, exactly 2 empty cells, any mix of tall/wide/small. Live check: rules -> equal to one of the 100 levels or its mirror image (`levelKeys`, `mirrorKey`; can be tested, not saved) -> already saved -> solver in the worker (`job({type:'solve'})`): "No solution" or "Solvable · minimum N moves", graded with `gradeOf(par)`. Save keeps up to 50 stages (`MAX_STAGES`) in `hr_designs` = `[{n, g, par, at}]`; stars per stage in `hr_progress['s<n>']` (not counted in the 300). Saved stages play straight away (no setup); Edit reopens one (saving changes resets its record); delete is two taps. An unsaved draft's test play records nothing (id `draft`). Designs are included in backups (restore merges by layout, renumbering clashes).
  - **Best score:** fewest moves per level, shown as a 4th stat (`Best`) once a level is cleared and on the win card ("New best!" when beaten).
  - **About panel** (`?`): 4 pages with Back/Next and dots; story behind the name, Thai-aware; numbers quoted there were checked against the solver.
  - **Menu:** collapsible "How to play" panel (open on first launch, `hr_howto`); paged level list (20 per page via chips + prev/next, `hr_page` remembers the page, opening a level moves the menu to its page); win + stars + progress in localStorage (`hr_progress`; daily cache `hr_daily_lv`).
  - **In-app updater:** the `Update` pill next to the `Version <hash>` label at the bottom of the menu probes the server, clears caches + the old service worker and reloads; a "new version ready · Update" banner shows when a new worker takes over. Progress/localStorage is never touched.
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

## Credits
See `NOTICE.md` (icons adapted from Material Design icons, Apache-2.0; licence text in `third_party/`).

## Ideas not built yet
Share codes for Design stage layouts (optional), Capacitor/TWA wrapper for a real APK.
