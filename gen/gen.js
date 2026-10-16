// Generates graded Huarong Road levels. Every level's "par" is the true minimum
// number of moves (BFS), so difficulty grading is exact and solvability is guaranteed.
const fs = require('fs');
const path = require('path');
const Sol = require('../src/solver.js');

const TILINGS = +process.env.TILINGS || 140;
const COUNT = 99; // generated levels (+1 classic finale)

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261016);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

function randomTiling() {
  for (;;) {
    const occ = new Array(20).fill(false);
    [13, 14, 17, 18].forEach((i) => (occ[i] = true)); // red parked at the exit
    const pieces = [{ t: 'R', r: 3, c: 1 }];
    const free = [];
    for (let i = 0; i < 20; i++) if (!occ[i]) free.push(i);
    shuffle(free).slice(0, 2).forEach((i) => (occ[i] = true)); // two empty cells
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

// Enumerate the connected component, then multi-source BFS from every solved state.
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
  return { grids, depth };
}

const pool = new Map(); // par -> [grid]
for (let n = 0; n < TILINGS; n++) {
  const { grids, depth } = depthMap(randomTiling());
  const byDepth = new Map();
  for (const [k, d] of depth) { if (d < 1) continue; if (!byDepth.has(d)) byDepth.set(d, []); byDepth.get(d).push(k); }
  for (const [d, keys] of byDepth) {
    shuffle(keys).slice(0, 3).forEach((k) => {
      if (!pool.has(d)) pool.set(d, []);
      pool.get(d).push(grids.get(k));
    });
  }
  if ((n + 1) % 20 === 0) console.log(`tilings ${n + 1}/${TILINGS}, max par so far ${Math.max(...pool.keys())}`);
}

const maxPar = Math.min(Math.max(...pool.keys()), 110);
const used = new Set(); const picked = [];
for (let i = 0; i < COUNT; i++) {
  const target = Math.round(2 + Math.pow(i / (COUNT - 1), 1.35) * (maxPar - 2));
  for (let off = 0; off < 60; off++) {
    const cands = [target + off, target - off].filter((p) => p >= 1 && pool.has(p) && pool.get(p).length);
    if (!cands.length) continue;
    const p = cands[(rng() * cands.length) | 0];
    const arr = pool.get(p);
    const g = arr.splice((rng() * arr.length) | 0, 1)[0];
    const k = Sol.key(g);
    if (used.has(k)) continue;
    used.add(k); picked.push({ par: p, g }); break;
  }
}

// Classic "Heng Dao Li Ma" as the final Master level.
const classic = Sol.fromPieces([
  { t: 'V', r: 0, c: 0 }, { t: 'R', r: 0, c: 1 }, { t: 'V', r: 0, c: 3 },
  { t: 'V', r: 2, c: 0 }, { t: 'H', r: 2, c: 1 }, { t: 'V', r: 2, c: 3 },
  { t: 'S', r: 3, c: 1 }, { t: 'S', r: 3, c: 2 }, { t: 'S', r: 4, c: 0 }, { t: 'S', r: 4, c: 3 },
]);
picked.push({ par: Sol.solve(classic).length, g: classic });
picked.sort((a, b) => a.par - b.par);

const levels = picked.map((x, i) => ({ id: i + 1, par: x.par, g: x.g.join('') }));
const out = 'var LEVELS=' + JSON.stringify(levels) + ';\nif(typeof module!=="undefined")module.exports=LEVELS;\n';
fs.writeFileSync(path.join(__dirname, '..', 'src', 'levels.js'), out);
console.log(`wrote ${levels.length} levels, par ${levels[0].par}..${levels[levels.length - 1].par}`);
