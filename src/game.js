(function () {
  'use strict';
  var Sol = Solver, W = Sol.W, H = Sol.H, DIM = Sol.DIM, HEAD = Sol.HEAD;
  var LV = LEVELS;
  var PAD = 8, GAP = 3;
  var TYPES = ['R', 'V', 'H', 'S'];
  var $ = function (id) { return document.getElementById(id); };

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var progress = store.get('hr_progress', {});
  var muted = store.get('hr_muted', false);
  var haptics = store.get('hr_haptics', true);

  var cell = 64, G = null, drag = null, uid = 0, timerId = null, msgTimer = null;
  var els = new Map();
  var ledCells = [];
  var RSVG = '<svg viewBox="0 0 100 100"><polygon points="50,12 90,84 10,84" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="6" stroke-linejoin="round"/><polygon points="50,38 68,70 32,70" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="5" stroke-linejoin="round"/></svg>';

  /* ---------- helpers ---------- */
  function beep(f, d) {
    if (muted) return;
    try {
      window._ac = window._ac || new (window.AudioContext || window.webkitAudioContext)();
      var o = window._ac.createOscillator(), g = window._ac.createGain();
      o.frequency.value = f || 520; g.gain.value = 0.05;
      o.connect(g); g.connect(window._ac.destination); o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, window._ac.currentTime + (d || 0.06));
      o.stop(window._ac.currentTime + (d || 0.06));
    } catch (e) {}
  }
  function buzz(ms) { if (haptics) try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
  function fmt(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function stars(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n); }
  function gradeOf(par) {
    if (par <= 8) return { name: 'Starter', hint: 'learn the basics' };
    if (par <= 20) return { name: 'Easy', hint: 'a few clever slides' };
    if (par <= 40) return { name: 'Medium', hint: 'plan ahead' };
    if (par <= 65) return { name: 'Hard', hint: 'think in sequences' };
    if (par <= 90) return { name: 'Expert', hint: 'serious puzzling' };
    return { name: 'Master', hint: 'legendary layouts' };
  }
  function gridOf() { return Sol.fromPieces(G.pieces); }
  function snap() { return G.pieces.map(function (p) { return { id: p.id, t: p.t, r: p.r, c: p.c }; }); }

  /* ---------- menu ---------- */
  function renderMenu() {
    var wrap = $('levels'); wrap.innerHTML = '';
    var last = null, row = null, total = 0;
    LV.forEach(function (lv, i) {
      var gr = gradeOf(lv.par);
      if (gr.name !== last) {
        last = gr.name;
        var h = document.createElement('h3'); h.className = 'grade';
        h.innerHTML = '<span>' + gr.name + '</span><small>' + gr.hint + '</small>';
        wrap.appendChild(h);
        row = document.createElement('div'); row.className = 'lvgrid'; wrap.appendChild(row);
      }
      var pr = progress[lv.id];
      var b = document.createElement('button');
      b.className = 'lv' + (pr ? ' done' : '');
      b.innerHTML = '<b>' + (i + 1) + '</b><span class="stars">' + stars(pr ? pr.stars : 0) + '</span>';
      b.onclick = function () { openLevel(i); };
      row.appendChild(b);
      if (pr) total += pr.stars;
    });
    $('totalStars').textContent = total + ' / ' + LV.length * 3;
  }

  function showMenu() {
    clearTimer(); G = null;
    $('game').classList.add('hidden'); $('win').classList.add('hidden');
    $('menu').classList.remove('hidden');
    renderMenu(); window.scrollTo(0, 0);
  }

  /* ---------- level lifecycle ---------- */
  function clearBoard() { els.forEach(function (el) { el.remove(); }); els.clear(); }
  function clearTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function openLevel(i) {
    clearTimer();
    var lv = LV[i], target = lv.g.split('').map(Number);
    G = { idx: i, lv: lv, target: target, tpieces: Sol.piecesOf(target), pieces: [], initial: null,
          phase: 'setup', sel: null, moves: 0, hints: 0, hist: [], t0: 0, elapsed: 0, msg: '' };
    clearBoard();
    $('menu').classList.add('hidden'); $('win').classList.add('hidden'); $('game').classList.remove('hidden');
    document.body.dataset.phase = 'setup';
    $('lvTitle').textContent = 'Level ' + (i + 1) + ' · ' + gradeOf(lv.par).name;
    $('par').textContent = lv.par; $('moves').textContent = '0'; $('time').textContent = '0:00';
    G.sel = firstAvailable();
    layout(); renderAll(); window.scrollTo(0, 0);
  }

  function remaining(t) {
    var need = 0, have = 0;
    G.tpieces.forEach(function (p) { if (p.t === t) need++; });
    G.pieces.forEach(function (p) { if (p.t === t) have++; });
    return need - have;
  }
  function firstAvailable() { for (var i = 0; i < 4; i++) if (remaining(TYPES[i]) > 0) return TYPES[i]; return null; }
  function verified(p) { return G.target[p.r * W + p.c] === HEAD[p.t]; }
  function say(m) {
    G.msg = m; renderStatus();
    clearTimeout(msgTimer); msgTimer = setTimeout(function () { if (G) { G.msg = ''; renderStatus(); } }, 1800);
  }

  /* ---------- rendering ---------- */
  function layout() {
    // Fit the board inside the device frame: its content width, not the window width (the frame has its own
    // margins/padding). BORDER is the board's 2px border each side; pieces are positioned inside it.
    var BORDER = 4, dev = document.querySelector('.device'), cs = dev && getComputedStyle(dev);
    var frameW = dev && dev.clientWidth ? dev.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : window.innerWidth - 62;
    var availW = Math.min(frameW, 440);
    var availH = window.innerHeight - 340;
    cell = Math.floor(Math.min((availW - 2 * PAD - BORDER) / W, (availH - 2 * PAD - BORDER) / H));
    cell = Math.max(cell, 58);
    var b = $('board');
    b.style.width = (W * cell + 2 * PAD + BORDER) + 'px';
    b.style.height = (H * cell + 2 * PAD + BORDER) + 'px';
    var z = $('exitzone'); z.style.left = (PAD + cell) + 'px'; z.style.top = (PAD + 3 * cell) + 'px';
    z.style.width = (2 * cell) + 'px'; z.style.height = (2 * cell) + 'px';
    var g = $('gate'); g.style.left = (PAD + cell + 8) + 'px'; g.style.width = (2 * cell - 16) + 'px';
    g.style.top = (H * cell + 2 * PAD - 2) + 'px';
    if (G) renderPieces();
  }

  function renderAll() { renderLED(); renderPieces(); renderTray(); renderStatus(); }

  function renderLED() {
    var g = G.phase === 'setup' ? G.target : gridOf();
    for (var i = 0; i < 20; i++) {
      var v = g[i], cls = v === 0 ? '' : v <= 4 ? 'R' : v <= 8 ? 'B' : 'Y';
      ledCells[i].className = cls;
    }
  }

  function renderPieces() {
    var board = $('board'), ids = new Set();
    G.pieces.forEach(function (p) {
      ids.add(p.id);
      var el = els.get(p.id), d = DIM[p.t];
      if (!el) {
        el = document.createElement('div');
        el.className = 'piece t' + p.t + ' pop'; el.dataset.id = p.id;
        el.innerHTML = p.t === 'R' ? RSVG : '<i></i>';
        board.appendChild(el); els.set(p.id, el);
        setTimeout(function () { el.classList.remove('pop'); }, 260);
      }
      el.style.width = (d.w * cell - 2 * GAP) + 'px';
      el.style.height = (d.h * cell - 2 * GAP) + 'px';
      el.style.transform = 'translate(' + (PAD + p.c * cell + GAP) + 'px,' + (PAD + p.r * cell + GAP) + 'px)';
      el.style.opacity = '';
      var v = verified(p), setup = G.phase === 'setup';
      el.classList.toggle('ok', setup && v);
      el.classList.toggle('bad', setup && !v);
      el.removeAttribute('data-hint');
    });
    els.forEach(function (el, id) { if (!ids.has(id)) { el.remove(); els.delete(id); } });
  }

  function renderTray() {
    if (G.phase !== 'setup') return;
    var html = '';
    TYPES.forEach(function (t) {
      var n = remaining(t), d = DIM[t];
      var col = t === 'R' ? '#e63946' : t === 'S' ? '#f5b82e' : '#2f80ed';
      html += '<button data-t="' + t + '" class="' + (G.sel === t ? 'sel' : '') + '"' + (n <= 0 ? ' disabled' : '') + '>' +
        '<span class="mini" style="display:block;width:' + d.w * 15 + 'px;height:' + d.h * 15 + 'px;background:' + col + '"></span>' +
        '<small>×' + Math.max(n, 0) + '</small></button>';
    });
    $('tray').innerHTML = html;
  }

  function renderStatus() {
    var s = $('status');
    s.className = 'status';
    if (G.phase === 'setup') {
      var ok = G.pieces.filter(verified).length, total = G.tpieces.length;
      var ready = ok === total && G.pieces.length === total;
      $('startBtn').disabled = !ready;
      $('startBtn').classList.toggle('ready', ready);
      if (G.msg) { s.textContent = G.msg; s.classList.add('warn'); }
      else if (ready) { s.textContent = 'All ' + total + ' chips confirmed ✓ — ready to play'; s.classList.add('good'); }
      else if (G.pieces.some(function (p) { return !verified(p); })) { s.textContent = 'Chip mismatch (amber) — tap that block to lift it. Verified ' + ok + '/' + total; s.classList.add('warn'); }
      else { s.textContent = 'Copy the LED layout: pick a block below, then tap the board. Verified ' + ok + '/' + total; }
    } else if (G.phase === 'play') {
      s.textContent = G.msg || 'Drag blocks to free the red square — slide it to the green exit.';
      if (G.msg) s.classList.add('warn');
    }
  }

  /* ---------- setup phase ---------- */
  function overlaps(r, c, d) {
    var occ = {};
    G.pieces.forEach(function (p) {
      var q = DIM[p.t];
      for (var y = 0; y < q.h; y++) for (var x = 0; x < q.w; x++) occ[(p.r + y) * W + p.c + x] = 1;
    });
    for (var y = 0; y < d.h; y++) for (var x = 0; x < d.w; x++) if (occ[(r + y) * W + c + x]) return true;
    return false;
  }

  $('board').addEventListener('click', function (e) {
    if (!G || G.phase !== 'setup') return;
    var pe = e.target.closest('.piece');
    if (pe) {
      var id = +pe.dataset.id;
      G.pieces = G.pieces.filter(function (p) { return p.id !== id; });
      if (!G.sel || remaining(G.sel) <= 0) G.sel = firstAvailable();
      beep(380, 0.05); renderAll(); return;
    }
    if (!G.sel) { say('All blocks are placed'); return; }
    var rect = this.getBoundingClientRect();
    var c0 = Math.floor((e.clientX - rect.left - PAD) / cell), r0 = Math.floor((e.clientY - rect.top - PAD) / cell);
    var d = DIM[G.sel];
    var c = Math.max(0, Math.min(W - d.w, c0)), r = Math.max(0, Math.min(H - d.h, r0));
    if (overlaps(r, c, d)) { say('That space is already taken'); buzz(20); return; }
    G.pieces.push({ id: ++uid, t: G.sel, r: r, c: c });
    if (remaining(G.sel) <= 0) G.sel = firstAvailable();
    beep(660, 0.05); renderAll();
    if (G.pieces.length === G.tpieces.length && G.pieces.every(verified)) { beep(880, 0.12); buzz(30); }
  });

  $('tray').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled || !G) return;
    G.sel = b.dataset.t; renderTray();
  });

  $('autoBtn').onclick = function () {
    G.pieces = G.tpieces.map(function (p) { return { id: ++uid, t: p.t, r: p.r, c: p.c }; });
    G.sel = null; renderAll();
  };
  $('clearBtn').onclick = function () { G.pieces = []; G.sel = firstAvailable(); renderAll(); };
  $('startBtn').onclick = function () { if (!$('startBtn').disabled) startPlay(); };

  function startPlay() {
    G.phase = 'play'; document.body.dataset.phase = 'play';
    G.initial = snap(); G.moves = 0; G.hints = 0; G.hist = []; G.msg = '';
    G.t0 = Date.now(); $('moves').textContent = '0'; $('time').textContent = '0:00';
    clearTimer(); timerId = setInterval(tick, 250);
    renderAll(); beep(740, 0.1);
  }
  function tick() { if (G && G.phase === 'play') $('time').textContent = fmt(Date.now() - G.t0); }

  /* ---------- play phase: dragging ---------- */
  var board = $('board');
  board.addEventListener('pointerdown', function (e) {
    if (!G || G.phase !== 'play') return;
    var el = e.target.closest('.piece'); if (!el) return;
    var p = G.pieces.filter(function (x) { return x.id === +el.dataset.id; })[0]; if (!p) return;
    var g = gridOf(), d = DIM[p.t], pc = { t: p.t, r: p.r, c: p.c, w: d.w, h: d.h };
    drag = {
      p: p, el: el, x0: e.clientX, y0: e.clientY, axis: null, off: 0,
      up: Sol.maxSlide(g, pc, -1, 0), down: Sol.maxSlide(g, pc, 1, 0),
      left: Sol.maxSlide(g, pc, 0, -1), right: Sol.maxSlide(g, pc, 0, 1)
    };
    G.msg = ''; el.removeAttribute('data-hint');
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    el.classList.add('drag'); e.preventDefault();
  });
  board.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    var neg = drag.axis === 'x' ? drag.left : drag.up, pos = drag.axis === 'x' ? drag.right : drag.down;
    var raw = drag.axis === 'x' ? dx : dy;
    drag.off = Math.max(-neg * cell, Math.min(pos * cell, raw));
    var bx = PAD + drag.p.c * cell + GAP, by = PAD + drag.p.r * cell + GAP;
    drag.el.style.transform = 'translate(' + (bx + (drag.axis === 'x' ? drag.off : 0)) + 'px,' + (by + (drag.axis === 'y' ? drag.off : 0)) + 'px)';
  });
  function endDrag() {
    if (!drag) return;
    var d = drag; drag = null; d.el.classList.remove('drag');
    if (!d.axis) return;
    var steps = Math.round(d.off / cell);
    if (steps === 0 && Math.abs(d.off) > cell * 0.28) steps = d.off > 0 ? 1 : -1;
    if (steps === 0) { renderPieces(); return; }
    var s = steps > 0 ? 1 : -1;
    commitMove(d.p, d.axis === 'y' ? s : 0, d.axis === 'x' ? s : 0, Math.abs(steps));
  }
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);

  function commitMove(p, dr, dc, k) {
    G.hist.push(snap());
    p.r += dr * k; p.c += dc * k; G.moves++;
    $('moves').textContent = G.moves;
    renderPieces(); renderLED(); renderStatus(); beep(500, 0.04); buzz(15);
    if (Sol.isGoal(gridOf())) win();
  }

  $('undoBtn').onclick = function () {
    if (!G || G.phase !== 'play' || !G.hist.length) return;
    G.pieces = G.hist.pop(); G.moves = Math.max(0, G.moves - 1);
    $('moves').textContent = G.moves; renderPieces(); renderLED();
  };
  $('restartBtn').onclick = function () {
    if (!G || !G.initial) return;
    G.pieces = G.initial.map(function (p) { return { id: p.id, t: p.t, r: p.r, c: p.c }; });
    G.moves = 0; G.hist = []; G.phase = 'play'; document.body.dataset.phase = 'play';
    G.t0 = Date.now(); $('moves').textContent = '0'; $('time').textContent = '0:00';
    clearTimer(); timerId = setInterval(tick, 250);
    clearBoard(); renderAll();
  };
  $('hintBtn').onclick = function () {
    if (!G || G.phase !== 'play') return;
    var sol = Sol.solve(gridOf());
    if (!sol || !sol.length) { G.msg = 'No solution from here — try Undo'; renderStatus(); return; }
    var m = sol[0], arrow = m.dr < 0 ? '↑' : m.dr > 0 ? '↓' : m.dc < 0 ? '←' : '→';
    var p = G.pieces.filter(function (x) { return x.t === m.t && x.r === m.r && x.c === m.c; })[0];
    if (p && els.get(p.id)) els.get(p.id).setAttribute('data-hint', arrow + (m.k > 1 ? m.k : ''));
    G.hints++; G.msg = 'Hint: ' + sol.length + ' move' + (sol.length > 1 ? 's' : '') + ' to go from here'; renderStatus();
  };

  /* ---------- win ---------- */
  function win() {
    G.phase = 'won'; document.body.dataset.phase = 'won'; clearTimer();
    G.elapsed = Date.now() - G.t0;
    var par = G.lv.par, st = G.moves <= par ? 3 : G.moves <= Math.ceil(par * 1.4) ? 2 : 1;
    var prev = progress[G.lv.id];
    progress[G.lv.id] = {
      stars: Math.max(st, prev ? prev.stars : 0),
      moves: Math.min(G.moves, prev ? prev.moves : 1e9),
      time: Math.min(G.elapsed, prev ? prev.time : 1e12)
    };
    store.set('hr_progress', progress);
    var red = G.pieces.filter(function (p) { return p.t === 'R'; })[0], el = els.get(red.id);
    setTimeout(function () {
      el.style.transform = 'translate(' + (PAD + red.c * cell + GAP) + 'px,' + (PAD + (red.r + 2) * cell + GAP) + 'px)';
      el.style.opacity = '0';
      beep(784, 0.12); setTimeout(function () { beep(988, 0.18); }, 130);
    }, 250);
    setTimeout(function () {
      $('winStars').textContent = stars(st);
      $('winInfo').innerHTML = 'Moves <b>' + G.moves + '</b> (par ' + par + ') · Time <b>' + fmt(G.elapsed) + '</b>' +
        (G.hints ? ' · Hints ' + G.hints : '');
      $('nextBtn').classList.toggle('hidden', G.idx + 1 >= LV.length);
      $('win').classList.remove('hidden');
    }, 950);
  }
  $('nextBtn').onclick = function () { openLevel(G.idx + 1); };
  $('replayBtn').onclick = function () { $('win').classList.add('hidden'); $('restartBtn').onclick(); };
  $('menuBtn').onclick = showMenu;
  $('backBtn').onclick = showMenu;
  $('muteBtn').onclick = function () { muted = !muted; store.set('hr_muted', muted); $('muteBtn').textContent = muted ? '🔇' : '🔊'; };
  $('muteBtn').textContent = muted ? '🔇' : '🔊';

  // Vibration toggle (Android Chrome only: iOS Safari has no Vibration API, so the button is hidden there)
  function renderHaptics() {
    var b = $('hapBtn'); b.textContent = haptics ? '📳' : '📴';
    b.setAttribute('aria-pressed', haptics); b.setAttribute('aria-label', haptics ? 'Vibration on' : 'Vibration off');
  }
  if (!navigator.vibrate) $('hapBtn').style.display = 'none';
  $('hapBtn').onclick = function () { haptics = !haptics; store.set('hr_haptics', haptics); renderHaptics(); buzz(30); };
  renderHaptics();

  /* ---------- init ---------- */
  (function init() {
    var led = $('led');
    for (var i = 0; i < 20; i++) { var c = document.createElement('i'); led.appendChild(c); ledCells.push(c); }
    $('board').insertAdjacentHTML('afterbegin', '<div class="exitzone" id="exitzone"></div><div class="gate" id="gate"><span>EXIT</span></div>');
    window.addEventListener('resize', function () { if (G) layout(); });
    document.body.dataset.phase = 'setup';
    renderMenu();
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () {});
  })();
})();
