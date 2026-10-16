// Independent verification of every shipped level.
const assert = require('assert');
const Sol = require('../src/solver.js');
const LEVELS = require('../src/levels.js');

let maxPar = 0, seen = new Set();
const t0 = Date.now();
LEVELS.forEach((lv, i) => {
  const g = lv.g.split('').map(Number);
  assert.strictEqual(g.length, 20, `L${i + 1}: grid length`);

  // piece decomposition must tile exactly 18 cells with 2 empty, and re-encode identically
  const ps = Sol.piecesOf(g);
  assert.deepStrictEqual(Sol.fromPieces(ps), g, `L${i + 1}: re-encode mismatch`);
  const counts = { R: 0, V: 0, H: 0, S: 0 };
  ps.forEach((p) => counts[p.t]++);
  assert.strictEqual(counts.R, 1, `L${i + 1}: exactly one red`);
  assert.strictEqual(g.filter((x) => x === 0).length, 2, `L${i + 1}: two empty cells`);
  assert.ok(!Sol.isGoal(g), `L${i + 1}: already solved`);
  assert.ok(!seen.has(lv.g), `L${i + 1}: duplicate`); seen.add(lv.g);

  // solve, check path length == par, and replay every move with independent legality checks
  const path = Sol.solve(g);
  assert.ok(path, `L${i + 1}: unsolvable`);
  assert.strictEqual(path.length, lv.par, `L${i + 1}: par ${lv.par} != optimal ${path.length}`);
  let cur = g;
  path.forEach((m, s) => {
    const p = Sol.piecesOf(cur).find((q) => q.t === m.t && q.r === m.r && q.c === m.c);
    assert.ok(p, `L${i + 1} step ${s}: piece missing`);
    assert.ok(Sol.maxSlide(cur, p, m.dr, m.dc) >= m.k, `L${i + 1} step ${s}: illegal slide`);
    cur = Sol.slide(cur, p, m.dr, m.dc, m.k);
  });
  assert.ok(Sol.isGoal(cur), `L${i + 1}: replay does not reach exit`);
  maxPar = Math.max(maxPar, lv.par);
});

// par must be non-decreasing within generated levels (classic included)
for (let i = 1; i < LEVELS.length; i++) assert.ok(LEVELS[i].par >= LEVELS[i - 1].par, 'ordering');

// setup "chip" verification logic: head code at target position matches piece type
LEVELS.forEach((lv) => {
  const g = lv.g.split('').map(Number);
  Sol.piecesOf(g).forEach((p) => assert.strictEqual(g[p.r * 4 + p.c], Sol.HEAD[p.t]));
});

console.log(`OK: ${LEVELS.length} levels verified (par ${LEVELS[0].par}..${maxPar}) in ${Date.now() - t0} ms`);
console.log('par curve:', LEVELS.map((l) => l.par).join(' '));
