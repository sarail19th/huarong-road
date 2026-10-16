# Triple Town (emoji version) - build brief

Single-file HTML game, same toolchain style as Huarong Road (no framework, installable PWA, no image assets).

## Rules
- 6x6 grid. Each turn the player places the "next item" on an empty cell.
- 3+ orthogonally connected identical items merge into one of the next tier, placed on the cell just tapped.
- Tiers: grass, bush, tree, hut, house, mansion, castle (then stop or loop to a bonus tier).
- Bears wander one step randomly each turn into empty cells. A bear with no free neighbour is trapped and becomes a tombstone. 3 connected tombstones merge into a church, then cathedral.
- Item queue: mostly grass, sometimes bush/tree/bear, rare "crystal" that merges with anything. One swap/storage slot.
- Game ends when the grid is full. Score = sum of merge values; keep a local best.

## Graphics (emoji, no files)
grass 🌱, bush 🌿, tree 🌳, hut 🛖, house 🏠, mansion 🏡, castle 🏰, bear 🐻, tombstone 🪦, church ⛪, cathedral 🕌, crystal 💎. Styled board with tinted tiles, pop animation on merge, shake when a bear is trapped.

## Build order
1. Pure logic module (grid, merge flood-fill, bear movement, scoring) with Node tests.
2. Seeded RNG so tests and bug reports are reproducible.
3. UI + animations, swap slot, undo.
4. Playwright mobile test: play 50 random turns, assert no invalid state, game over reached.
5. PWA manifest + service worker, as in `build.js`.
