(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Solver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Board: 4 columns x 5 rows. Grid = array of 20 cell codes (row-major).
  // Codes: 0 empty | 1-4 red 2x2 (TL,TR,BL,BR) | 5-6 vertical 1x2 (top,bottom)
  //        7-8 horizontal 2x1 (left,right) | 9 single 1x1
  var W = 4, H = 5, N = 20;
  var DIM = { R: { w: 2, h: 2 }, V: { w: 1, h: 2 }, H: { w: 2, h: 1 }, S: { w: 1, h: 1 } };
  var HEAD = { R: 1, V: 5, H: 7, S: 9 };
  var HEADTYPE = { 1: 'R', 5: 'V', 7: 'H', 9: 'S' };
  // Exit: red block's top-left must reach row 3, col 1 (bottom centre).
  var GOAL_IDX = 3 * W + 1;

  function place(g, t, r, c) {
    var i = r * W + c;
    if (t === 'R') { g[i] = 1; g[i + 1] = 2; g[i + W] = 3; g[i + W + 1] = 4; }
    else if (t === 'V') { g[i] = 5; g[i + W] = 6; }
    else if (t === 'H') { g[i] = 7; g[i + 1] = 8; }
    else { g[i] = 9; }
  }

  function fromPieces(ps) {
    var g = new Array(N).fill(0);
    for (var i = 0; i < ps.length; i++) place(g, ps[i].t, ps[i].r, ps[i].c);
    return g;
  }

  function piecesOf(g) {
    var ps = [];
    for (var i = 0; i < N; i++) {
      var t = HEADTYPE[g[i]];
      if (t) ps.push({ t: t, r: (i / W) | 0, c: i % W });
    }
    return ps;
  }

  function key(g) {
    var s = '';
    for (var i = 0; i < N; i++) s += String.fromCharCode(48 + g[i]);
    return s;
  }

  function isGoal(g) { return g[GOAL_IDX] === 1; }

  // How many cells can piece p slide in direction (dr,dc)?
  function maxSlide(g, p, dr, dc) {
    var d = DIM[p.t], k = 0;
    for (;;) {
      var nr = p.r + dr * (k + 1), nc = p.c + dc * (k + 1);
      if (nr < 0 || nc < 0 || nr + d.h > H || nc + d.w > W) break;
      var ok = true, x, y;
      if (dr !== 0) {
        var row = dr > 0 ? nr + d.h - 1 : nr;
        for (x = 0; x < d.w; x++) if (g[row * W + p.c + x] !== 0) { ok = false; break; }
      } else {
        var col = dc > 0 ? nc + d.w - 1 : nc;
        for (y = 0; y < d.h; y++) if (g[(p.r + y) * W + col] !== 0) { ok = false; break; }
      }
      if (!ok) break;
      k++;
    }
    return k;
  }

  function slide(g, p, dr, dc, k) {
    var d = DIM[p.t], ng = g.slice(), x, y;
    for (y = 0; y < d.h; y++) for (x = 0; x < d.w; x++) ng[(p.r + y) * W + p.c + x] = 0;
    place(ng, p.t, p.r + dr * k, p.c + dc * k);
    return ng;
  }

  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // One "move" = one block slid any distance in a straight line.
  function neighbors(g) {
    var out = [], ps = piecesOf(g);
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      for (var d = 0; d < 4; d++) {
        var dr = DIRS[d][0], dc = DIRS[d][1];
        var m = maxSlide(g, p, dr, dc);
        for (var k = 1; k <= m; k++) {
          out.push({ g: slide(g, p, dr, dc, k), m: { t: p.t, r: p.r, c: p.c, dr: dr, dc: dc, k: k } });
        }
      }
    }
    return out;
  }

  // Shortest solution as a list of moves ([] if already solved, null if impossible).
  function solve(start) {
    if (isGoal(start)) return [];
    var k0 = key(start);
    var parent = new Map();
    parent.set(k0, null);
    var queue = [start], qi = 0;
    while (qi < queue.length) {
      var g = queue[qi++], gk = key(g);
      var nb = neighbors(g);
      for (var i = 0; i < nb.length; i++) {
        var nk = key(nb[i].g);
        if (parent.has(nk)) continue;
        parent.set(nk, { prev: gk, m: nb[i].m });
        if (isGoal(nb[i].g)) {
          var path = [], cur = nk;
          while (parent.get(cur)) { var e = parent.get(cur); path.push(e.m); cur = e.prev; }
          return path.reverse();
        }
        queue.push(nb[i].g);
      }
    }
    return null;
  }

  return {
    W: W, H: H, N: N, DIM: DIM, HEAD: HEAD, GOAL_IDX: GOAL_IDX,
    fromPieces: fromPieces, piecesOf: piecesOf, key: key, isGoal: isGoal,
    maxSlide: maxSlide, slide: slide, neighbors: neighbors, solve: solve
  };
});
