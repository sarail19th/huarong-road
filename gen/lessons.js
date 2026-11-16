// Generates the six guided-lesson puzzles (one per tier: Starter, Easy, Medium, Hard, Expert, Master).
// A lesson puzzle is NOT one of the 100 levels (nor its mirror image), so playing a lesson spoils no level.
// For each tier we search seeded random layouts whose true minimum number of moves (par) is close to the tier's target,
// score how cleanly the optimal line teaches the tier's idea, and keep the best one. Checkpoints are "red is at this
// square" positions that EVERY optimal line passes through, so the card shows up whichever optimal route a player (or the
// hint) follows. Deterministic: same seed, same lessons. Run: node gen/lessons.js  (~1-2 min)
const fs = require('fs');
const path = require('path');
const Sol = require('../src/solver.js');
const LEVELS = require('../src/levels.js');

const TILINGS = +process.env.TILINGS || 260;
const TIERS = [ // key, par target window, checkpoints shown before completion
  { key: 'starter', lo: 3, hi: 5, cps: 1 },
  { key: 'easy', lo: 13, hi: 17, cps: 2 },
  { key: 'medium', lo: 28, hi: 32, cps: 3 },
  { key: 'hard', lo: 50, hi: 56, cps: 4 },
  { key: 'expert', lo: 76, hi: 82, cps: 5 },
  { key: 'master', lo: 96, hi: 104, cps: 6 }
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261116);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

function randomTiling() {
  for (;;) {
    const occ = new Array(20).fill(false);
    [13, 14, 17, 18].forEach((i) => (occ[i] = true));
    const pieces = [{ t: 'R', r: 3, c: 1 }];
    const free = [];
    for (let i = 0; i < 20; i++) if (!occ[i]) free.push(i);
    shuffle(free).slice(0, 2).forEach((i) => (occ[i] = true));
    const ps = [];
    const dfs = () => {
      const i = occ.indexOf(false);
      if (i < 0) return true;
      const r = (i / 4) | 0, c = i % 4;
      const opts = [...new Set(shuffle(['V', 'V', 'V', 'H', 'S', 'S']))];
      for (const t of opts) {
        if (t === 'V' && !(r + 1 < 5 && !occ[i + 4])) continue;
        if (t === 'H' && !(c + 1 < 4 && !occ[i + 1])) continue;
        const cells = t === 'V' ? [i, i + 4] : t === 'H' ? [i, i + 1] : [i];
        cells.forEach((x) => (occ[x] = true));
        ps.push({ t, r, c });
        if (dfs()) return true;
        ps.pop();
        cells.forEach((x) => (occ[x] = false));
      }
      return false;
    };
    if (!dfs()) continue;
    const s = ps.filter((p) => p.t === 'S').length;
    if (s < 2 || s > 5) continue;
    return Sol.fromPieces(pieces.concat(ps));
  }
}

function depthMap(start) {
  const grids = new Map(); const adj = new Map();
  const q = [start]; grids.set(Sol.key(start), start);
  for (let qi = 0; qi < q.length; qi++) {
    const g = q[qi]; const gk = Sol.key(g); const list = [];
    for (const nb of Sol.neighbors(g)) {
      const nk = Sol.key(nb.g); list.push(nk);
      if (!grids.has(nk)) { grids.set(nk, nb.g); q.push(nb.g); }
    }
    adj.set(gk, list);
  }
  const depth = new Map(); const dq = [];
  for (const [k, g] of grids) if (Sol.isGoal(g)) { depth.set(k, 0); dq.push(k); }
  for (let i = 0; i < dq.length; i++) {
    const k = dq[i];
    for (const nk of adj.get(k)) if (!depth.has(nk)) { depth.set(nk, depth.get(k) + 1); dq.push(nk); }
  }
  return { grids, adj, depth };
}

const redOf = (g) => { const i = g.indexOf(1); return [(i / 4) | 0, i % 4]; };
const mirror = (g) => Sol.fromPieces(Sol.piecesOf(g).map((p) => ({ t: p.t, r: p.r, c: 4 - p.c - Sol.DIM[p.t].w }))).join('');
const taken = new Set();
LEVELS.forEach((l) => { taken.add(l.g); taken.add(mirror(l.g.split('').map(Number))); });

// Is there a shortest path from `start` to the exit that never has red at (r,c)? (false = every optimal line passes it)
function avoidable(start, adj, depth, grids, r, c) {
  const memo = new Map();
  const go = (k) => {
    if (memo.has(k)) return memo.get(k);
    const rp = redOf(grids.get(k));
    let res;
    if (rp[0] === r && rp[1] === c) res = false;
    else if (depth.get(k) === 0) res = true;
    else { res = false; for (const nk of adj.get(k)) if (depth.get(nk) === depth.get(k) - 1 && go(nk)) { res = true; break; } }
    memo.set(k, res); return res;
  };
  return go(start);
}

function analyse(g, tier, d, adj, depth, grids) {
  const k0 = Sol.key(g);
  const line = Sol.solve(g); // the same line the game's hint and solution viewer would use
  const states = [g]; let cur = g;
  line.forEach((m) => { cur = Sol.slide(cur, { t: m.t, r: m.r, c: m.c }, m.dr, m.dc, m.k); states.push(cur); });
  const reds = states.map(redOf);
  // distinct red squares along the line (in order of first arrival), start excluded, final = exit square
  const seq = [];
  reds.forEach((p, i) => { if (i === 0) return; const prev = reds[i - 1]; if (p[0] !== prev[0] || p[1] !== prev[1]) seq.push({ r: p[0], c: p[1], at: i }); });
  const forced = [];
  const seenPos = new Set();
  seq.forEach((s) => {
    const kk = s.r + ',' + s.c;
    if (seenPos.has(kk)) return; seenPos.add(kk);
    if (!avoidable(k0, adj, depth, grids, s.r, s.c)) forced.push(s);
  });
  const finalPos = { r: 3, c: 1 };
  const inter = forced.filter((s) => !(s.r === finalPos.r && s.c === finalPos.c));
  // pick tier.cps intermediate checkpoints, spread evenly along the line
  const picked = [];
  for (let j = 1; j <= tier.cps && inter.length; j++) {
    const want = (j * line.length) / (tier.cps + 1);
    let best = null;
    inter.forEach((s) => { if (picked.indexOf(s) < 0 && (!best || Math.abs(s.at - want) < Math.abs(best.at - want))) best = s; });
    if (best) picked.push(best);
  }
  picked.sort((a, b) => a.at - b.at);
  // features
  let perp = 0, sRuns = 0, run = 0, redMoves = 0, longMoves = 0;
  line.forEach((m) => {
    if ((m.t === 'V' && m.dc !== 0) || (m.t === 'H' && m.dr !== 0)) perp++;
    if (m.t === 'V' || m.t === 'H') longMoves++;
    if (m.t === 'R') redMoves++;
    if (m.t === 'S') { run++; if (run === 3) sRuns++; } else run = 0;
  });
  return { line, picked, forced: inter.length, perp, sRuns, redMoves, longMoves };
}

function score(tier, f) {
  let s = f.picked.length * 10 + f.forced; // enough clean checkpoints first
  if (tier.key === 'medium') s += Math.min(f.perp, 4) * 3;       // long block stepping sideways needs two gaps joined
  if (tier.key === 'hard') s += Math.min(f.sRuns, 3) * 4;          // small blocks carrying a gap along
  if (tier.key === 'expert') s += Math.min(f.perp, 5) * 2 + Math.min(f.longMoves, 20) * .3;
  if (tier.key === 'master') s += Math.min(f.redMoves, 8);
  if (tier.key === 'easy') s += Math.min(f.redMoves, 3);
  return s;
}

const best = TIERS.map(() => null);
for (let n = 0; n < TILINGS; n++) {
  const { grids, adj, depth } = depthMap(randomTiling());
  TIERS.forEach((tier, ti) => {
    const keys = [];
    for (const [k, d] of depth) if (d >= tier.lo && d <= tier.hi) keys.push(k);
    shuffle(keys).slice(0, 8).forEach((k) => {
      const g = grids.get(k);
      const gs = g.join('');
      if (taken.has(gs)) return;
      const f = analyse(g, tier, depth.get(k), adj, depth, grids);
      f.sc = score(tier, f);
      if (!best[ti] || f.sc > best[ti].f.sc) best[ti] = { g, par: depth.get(k), f };
    });
  });
  if ((n + 1) % 20 === 0) console.log(`tilings ${n + 1}/${TILINGS}: ` + best.map((b, i) => b ? `${TIERS[i].key} par ${b.par} cps ${b.f.picked.length} sc ${b.f.sc.toFixed(0)}` : `${TIERS[i].key} -`).join(' | '));
}

const out = TIERS.map((tier, i) => {
  const b = best[i];
  const line = b.f.line, g = b.g;
  const states = [g]; let cur = g;
  line.forEach((m) => { cur = Sol.slide(cur, { t: m.t, r: m.r, c: m.c }, m.dr, m.dc, m.k); states.push(cur); });
  const stops = b.f.picked.concat([{ r: 3, c: 1, at: line.length }]);
  const cps = []; let prevAt = 0, prevRed = redOf(g);
  stops.forEach((s) => {
    const mv = { V: 0, H: 0, S: 0 };
    for (let j = prevAt; j < s.at; j++) if (line[j].t !== 'R') mv[line[j].t]++;
    cps.push({ r: s.r, c: s.c, dr: s.r - prevRed[0], dc: s.c - prevRed[1], mv });
    prevAt = s.at; prevRed = [s.r, s.c];
  });
  const red0 = redOf(g);
  return { id: i + 1, tier: tier.key, par: line.length, g: g.join(''), red0, cps };
});
out.forEach((l) => console.log(l.tier, 'par', l.par, 'red0', l.red0.join(','), 'cps', JSON.stringify(l.cps.map((c) => [c.r, c.c, c.dr, c.dc, c.mv.V + 'v' + c.mv.H + 'h' + c.mv.S + 's']))));
fs.writeFileSync(path.join(__dirname, '..', 'src', 'lessons.js'),
  'var LESSONS=' + JSON.stringify(out) + ';\nif(typeof module!=="undefined")module.exports=LESSONS;\n');
console.log('wrote src/lessons.js');
