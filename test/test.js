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

// Daily puzzle: two weeks of dates. Same date -> same puzzle; par is the true optimum; difficulty follows the weekday.
const Daily = require('../src/daily.js');
let dk = '2026-11-02', dailyMs = 0;
for (let n = 0; n < 14; n++, dk = Daily.addDays(dk, 1)) {
  const t = Date.now(), a = Daily.generate(dk); dailyMs = Math.max(dailyMs, Date.now() - t);
  const b = Daily.generate(dk), g = a.g.split('').map(Number);
  assert.strictEqual(a.g, b.g, `daily ${dk}: not deterministic`);
  assert.strictEqual(a.par, Sol.solve(g).length, `daily ${dk}: par is not the optimum`);
  assert.ok(Math.abs(a.par - Daily.TARGET[Daily.weekday(dk)]) <= 3, `daily ${dk}: par ${a.par} far from target`);
  assert.strictEqual(a.number, n + 2, `daily ${dk}: number`);
  Sol.piecesOf(g).forEach((p) => assert.strictEqual(g[p.r * 4 + p.c], Sol.HEAD[p.t]));
}
assert.notStrictEqual(Daily.generate('2026-11-02').g, Daily.generate('2026-11-09').g, 'different days differ');
console.log(`OK: daily puzzle verified for 14 days (deterministic, par = optimum, weekday difficulty; slowest ${dailyMs} ms)`);

// Logic lessons: one dedicated puzzle per tier. Not a level (or its mirror), solvable, par = optimum, par inside the tier,
// checkpoints in order, each one forced on every optimal line, the last one is the exit.
const LESSONS = require('../src/lessons.js');
const TIER_MAX = { starter: [1, 8], easy: [9, 20], medium: [21, 40], hard: [41, 65], expert: [66, 90], master: [91, 1e9] };
const mir = (g) => Sol.fromPieces(Sol.piecesOf(g).map((p) => ({ t: p.t, r: p.r, c: 4 - p.c - Sol.DIM[p.t].w }))).join('');
const lvKeys = new Set(); LEVELS.forEach((l) => { lvKeys.add(l.g); lvKeys.add(mir(l.g.split('').map(Number))); });
assert.strictEqual(LESSONS.length, 6, 'six lessons');
const order = ['starter', 'easy', 'medium', 'hard', 'expert', 'master'];
LESSONS.forEach((d, i) => {
  const tag = `lesson ${i + 1}`, g = d.g.split('').map(Number);
  assert.strictEqual(d.tier, order[i], `${tag}: tier order`);
  assert.ok(!lvKeys.has(d.g), `${tag}: is a real level or its mirror`);
  const path = Sol.solve(g);
  assert.ok(path, `${tag}: unsolvable`);
  assert.strictEqual(path.length, d.par, `${tag}: par ${d.par} != optimal ${path.length}`);
  const [lo, hi] = TIER_MAX[d.tier];
  assert.ok(d.par >= lo && d.par <= hi, `${tag}: par ${d.par} outside tier ${d.tier}`);
  assert.ok(d.cps.length >= 1 && d.cps.length <= 7, `${tag}: checkpoint count`);
  const last = d.cps[d.cps.length - 1];
  assert.deepStrictEqual([last.r, last.c], [3, 1], `${tag}: last checkpoint is the exit`);
  // red square after each optimal move; every checkpoint must show up on the canonical line, in order
  let cur = g, at = 0; const reds = [];
  path.forEach((m) => { cur = Sol.slide(cur, { t: m.t, r: m.r, c: m.c }, m.dr, m.dc, m.k); const k = cur.indexOf(1); reds.push([(k / 4) | 0, k % 4]); });
  d.cps.forEach((c, j) => {
    let f = -1;
    for (let s = at; s < reds.length; s++) if (reds[s][0] === c.r && reds[s][1] === c.c) { f = s; break; }
    assert.ok(f >= 0, `${tag}: checkpoint ${j + 1} not on the optimal line (in order)`);
    at = f + 1;
  });
});
console.log(`OK: ${LESSONS.length} lessons verified (pars ${LESSONS.map((d) => d.par).join(' ')})`);
