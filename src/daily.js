// Daily puzzle: generated on the device from the local date, so it works offline and everyone gets the
// same puzzle on the same day. Same method as gen/gen.js: a random tiling with red parked at the exit,
// the whole reachable state space, multi-source BFS from the solved states; par is the true optimum.
// Difficulty climbs through the week (Monday easiest, Sunday hardest).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./solver.js'));
  else root.Daily = factory(root.Solver);
})(this, function (Sol) {
  'use strict';
  var EPOCH = Date.UTC(2026, 10, 1);              // 1 Nov 2026 = Daily #1
  var TARGET = [62, 14, 20, 27, 34, 42, 52];      // by weekday, Sunday = 0

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function utcOf(key) { var p = key.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function weekday(key) { return new Date(utcOf(key)).getUTCDay(); }
  function numberOf(key) { return Math.round((utcOf(key) - EPOCH) / 864e5) + 1; }
  function addDays(key, n) { var d = new Date(utcOf(key) + n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }

  function tiling(rng) {
    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = (rng() * (i + 1)) | 0, t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    for (;;) {
      var occ = []; for (var i = 0; i < 20; i++) occ.push(false);
      [13, 14, 17, 18].forEach(function (x) { occ[x] = true; });
      var free = []; for (i = 0; i < 20; i++) if (!occ[i]) free.push(i);
      shuffle(free).slice(0, 2).forEach(function (x) { occ[x] = true; });
      var ps = [];
      var dfs = function () {
        var i = occ.indexOf(false); if (i < 0) return true;
        var r = (i / 4) | 0, c = i % 4, opts = [], seen = {};
        shuffle(['V', 'V', 'V', 'H', 'S', 'S']).forEach(function (t) { if (!seen[t]) { seen[t] = 1; opts.push(t); } });
        for (var k = 0; k < opts.length; k++) {
          var t = opts[k];
          if (t === 'V' && !(r + 1 < 5 && !occ[i + 4])) continue;
          if (t === 'H' && !(c + 1 < 4 && !occ[i + 1])) continue;
          var cells = t === 'V' ? [i, i + 4] : t === 'H' ? [i, i + 1] : [i];
          cells.forEach(function (x) { occ[x] = true; }); ps.push({ t: t, r: r, c: c });
          if (dfs()) return true;
          ps.pop(); cells.forEach(function (x) { occ[x] = false; });
        }
        return false;
      };
      if (!dfs()) continue;
      var s = ps.filter(function (p) { return p.t === 'S'; }).length;
      if (s < 2 || s > 5) continue;
      return Sol.fromPieces([{ t: 'R', r: 3, c: 1 }].concat(ps));
    }
  }

  // every reachable state, then the distance of each one to the nearest solved state
  function depths(start) {
    var grids = new Map(), adj = new Map(), q = [start];
    grids.set(Sol.key(start), start);
    for (var qi = 0; qi < q.length; qi++) {
      var g = q[qi], list = [];
      Sol.neighbors(g).forEach(function (nb) {
        var nk = Sol.key(nb.g); list.push(nk);
        if (!grids.has(nk)) { grids.set(nk, nb.g); q.push(nb.g); }
      });
      adj.set(Sol.key(g), list);
    }
    var depth = new Map(), dq = [];
    grids.forEach(function (g, k) { if (Sol.isGoal(g)) { depth.set(k, 0); dq.push(k); } });
    for (var i = 0; i < dq.length; i++) {
      var k = dq[i], d = depth.get(k);
      adj.get(k).forEach(function (nk) { if (!depth.has(nk)) { depth.set(nk, d + 1); dq.push(nk); } });
    }
    return { grids: grids, depth: depth };
  }

  function generate(key) {
    var rng = mulberry32(hash('huarong-daily-' + key)), target = TARGET[weekday(key)], best = null;
    for (var attempt = 0; attempt < 4; attempt++) {
      var r = depths(tiling(rng)), byDepth = {};
      r.depth.forEach(function (d, k) { if (d > 0) (byDepth[d] = byDepth[d] || []).push(k); });
      for (var off = 0; off <= 40; off++) {
        var cands = [target - off, target + off].filter(function (d) { return byDepth[d]; });
        if (!cands.length) continue;
        var d = cands[0], keys = byDepth[d], k = keys[(rng() * keys.length) | 0];
        if (!best || off < best.off) best = { off: off, par: d, g: r.grids.get(k) };
        break;
      }
      if (best && best.off <= 2) break;
    }
    return { id: 'd' + key, key: key, number: numberOf(key), par: best.par, g: best.g.join(''), daily: true };
  }

  return { generate: generate, dateKey: dateKey, numberOf: numberOf, weekday: weekday, addDays: addDays, TARGET: TARGET };
});
