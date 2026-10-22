# Huarong Road

Klotski-style sliding-block puzzle (4x5 board, slide the big red 2x2 to the bottom-centre exit). Plain HTML/CSS/JS, no framework, no runtime dependencies. Ships as one self-contained `dist/index.html` that works as an installable Android PWA (Chrome -> Add to Home screen).

## Layout
- `src/solver.js` - board model + BFS solver. Grid is 20 cells, row-major. Codes: 0 empty, 1-4 red 2x2 (TL,TR,BL,BR), 5-6 vertical 1x2, 7-8 horizontal 2x1, 9 single. One "move" = one block slid any distance in a straight line. Goal: red top-left at row 3, col 1.
- `src/levels.js` - GENERATED (100 levels, `{id, par, g}`). Do not hand-edit; run the generator.
- `src/game.js` - UI: setup phase (copy the LED layout, chip check = piece type at the right cell; the Auto-place toggle, default ON, pre-fills every level), play phase (pointer-drag sliding, undo, restart, two-step explained hints: tap 1 outlines the blocking pieces and says why, tap 2 shows the exact move), skins (classic / blossom pastel pink+black / neon green+black via `<html data-skin>` CSS variables), win + stars + localStorage progress (`hr_progress`, `hr_auto`, `hr_skin`, `hr_muted`, `hr_haptics`).
- `src/style.css`, `src/index.html` - templates with `/*INLINE_...*/` placeholders.
- `gen/gen.js` - level generator (seeded, deterministic). `gen/icons.py` - PWA icons (needs Pillow).
- `build.js` - inlines everything into `dist/index.html`, writes manifest + service worker, and `dist/artifact.html` (title + style + body only, for the claude.ai Artifact tool).
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
- Piece animations must not scale (pieces are positioned with `transform: translate`, scaling shifts them).

## Ideas not built yet
Daily puzzle, level editor, Capacitor/TWA wrapper for a real APK.
