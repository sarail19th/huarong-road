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
  var seen = store.get('hr_seen', {}); // level ids whose solution was viewed: wins there earn no stars
  var muted = store.get('hr_muted', false);
  var haptics = store.get('hr_haptics', true);
  var autoPlace = store.get('hr_auto', true);
  var lang = store.get('hr_lang', 'en') === 'th' ? 'th' : 'en'; // guidance text (instructions, hints, solution) in English or Thai
  var SKINS = [
    { id: 'classic', name: 'Classic', theme: '#0d1117' },
    { id: 'blossom', name: 'Blossom · pastel pink & black', theme: '#0b0709' },
    { id: 'neon', name: 'Neon · green & black', theme: '#020503' }
  ];
  var skin = store.get('hr_skin', 'classic');

  var cell = 64, G = null, drag = null, uid = 0, timerId = null, msgTimer = null, autoTimer = null;
  var els = new Map();
  var ledCells = [];
  var RSVG = '<svg viewBox="0 0 100 100"><polygon points="50,12 90,84 10,84" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="6" stroke-linejoin="round"/><polygon points="50,38 68,70 32,70" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="5" stroke-linejoin="round"/></svg>';

  /* ---------- helpers ---------- */
  function L(en, th) { return lang === 'th' ? th : en; }
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
  var PAGE = 20, PAGES = Math.ceil(LV.length / PAGE);
  var menuPage = store.get('hr_page', null);
  if (typeof menuPage !== 'number') { // first visit: open on the page of the first unfinished level
    var firstOpen = 0;
    while (firstOpen < LV.length - 1 && progress[LV[firstOpen].id]) firstOpen++;
    menuPage = Math.floor(firstOpen / PAGE);
  }
  menuPage = Math.max(0, Math.min(PAGES - 1, menuPage));
  function rangeOf(pg) { return (pg * PAGE + 1) + '–' + Math.min(LV.length, (pg + 1) * PAGE); }
  function setMenuPage(pg, jump) {
    menuPage = Math.max(0, Math.min(PAGES - 1, pg)); store.set('hr_page', menuPage);
    renderMenu(); if (jump) $('pgchips').scrollIntoView({ block: 'start' });
  }

  function renderMenu() {
    var wrap = $('levels'); wrap.innerHTML = '';
    var last = null, row = null, total = 0;
    LV.forEach(function (lv, i) {
      var pr = progress[lv.id];
      if (pr) total += pr.stars;
      if (Math.floor(i / PAGE) !== menuPage) return;
      var gr = gradeOf(lv.par);
      if (gr.name !== last) {
        last = gr.name;
        var h = document.createElement('h3'); h.className = 'grade';
        h.innerHTML = '<span>' + gr.name + '</span><small>' + gr.hint + '</small>';
        wrap.appendChild(h);
        row = document.createElement('div'); row.className = 'lvgrid'; wrap.appendChild(row);
      }
      var b = document.createElement('button');
      b.className = 'lv' + (pr ? ' done' : '');
      b.innerHTML = '<b>' + (i + 1) + '</b><span class="stars">' + (seen[lv.id] ? '👁 ' : '') + stars(pr ? pr.stars : 0) + '</span>';
      b.onclick = function () { openLevel(i); };
      row.appendChild(b);
    });
    $('totalStars').textContent = total + ' / ' + LV.length * 3;
    var chips = $('pgchips'); chips.innerHTML = '';
    for (var pg = 0; pg < PAGES; pg++) (function (pg) {
      var c = document.createElement('button');
      c.className = 'pgchip' + (pg === menuPage ? ' on' : ''); c.textContent = rangeOf(pg);
      c.setAttribute('role', 'tab'); c.setAttribute('aria-selected', pg === menuPage);
      c.onclick = function () { setMenuPage(pg, false); };
      chips.appendChild(c);
    })(pg);
    var pv = $('pgPrev'), nx = $('pgNext');
    pv.disabled = menuPage === 0; nx.disabled = menuPage === PAGES - 1;
    pv.textContent = menuPage > 0 ? '‹ ' + rangeOf(menuPage - 1) : '‹';
    nx.textContent = menuPage < PAGES - 1 ? rangeOf(menuPage + 1) + ' ›' : '›';
  }
  $('pgPrev').onclick = function () { setMenuPage(menuPage - 1, true); };
  $('pgNext').onclick = function () { setMenuPage(menuPage + 1, true); };

  function showMenu() {
    clearTimer(); G = null; hideTip();
    $('game').classList.add('hidden'); $('win').classList.add('hidden');
    $('menu').classList.remove('hidden');
    renderMenu(); window.scrollTo(0, 0);
  }

  /* ---------- level lifecycle ---------- */
  function clearBoard() { els.forEach(function (el) { el.remove(); }); els.clear(); }
  function clearTimer() { if (timerId) { clearInterval(timerId); timerId = null; } stopAuto(); }

  function openLevel(i) {
    clearTimer();
    menuPage = Math.floor(i / PAGE); store.set('hr_page', menuPage); // coming back to the menu lands on this level's page
    var lv = LV[i], target = lv.g.split('').map(Number);
    G = { idx: i, lv: lv, target: target, tpieces: Sol.piecesOf(target), pieces: [], initial: null,
          phase: 'setup', sel: null, moves: 0, hints: 0, hist: [], t0: 0, elapsed: 0, msg: '', sol: null };
    clearBoard();
    $('menu').classList.add('hidden'); $('win').classList.add('hidden'); $('game').classList.remove('hidden');
    document.body.dataset.phase = 'setup';
    $('lvTitle').textContent = 'Level ' + (i + 1) + ' · ' + gradeOf(lv.par).name;
    $('par').textContent = lv.par; $('moves').textContent = '0'; $('time').textContent = '0:00';
    G.sel = firstAvailable();
    hideTip(); renderAuto();
    if (autoPlace) placeAll();
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
      el.removeAttribute('data-hint'); el.removeAttribute('data-focus');
    });
    els.forEach(function (el, id) { if (!ids.has(id)) { el.remove(); els.delete(id); } });
  }

  function renderTray() {
    if (G.phase !== 'setup') return;
    // nothing left to place (always the case with auto-place) -> hide the tray so Start stays on screen
    $('tray').classList.toggle('hidden', !firstAvailable());
    var html = '';
    TYPES.forEach(function (t) {
      var n = remaining(t), d = DIM[t];
      html += '<button data-t="' + t + '" class="' + (G.sel === t ? 'sel' : '') + '"' + (n <= 0 ? ' disabled' : '') + '>' +
        '<span class="mini m' + t + '" style="width:' + d.w * 15 + 'px;height:' + d.h * 15 + 'px"></span>' +
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
      s.classList.toggle('hidden', ready && !G.msg); // the lit-up Start button already says it
      if (G.msg) { s.textContent = G.msg; s.classList.add('warn'); }
      else if (ready) { s.textContent = L('All ' + total + ' chips confirmed ✓ — ready to play', 'ยืนยันชิปครบ ' + total + ' ตัว ✓ — พร้อมเล่น'); s.classList.add('good'); }
      else if (G.pieces.some(function (p) { return !verified(p); })) { s.textContent = L('Chip mismatch (amber) — tap that block to lift it. Verified ' + ok + '/' + total, 'ชิปไม่ตรง (สีเหลืองอำพัน) — แตะบล็อกนั้นเพื่อยกออก ตรงแล้ว ' + ok + '/' + total); s.classList.add('warn'); }
      else { s.textContent = L('Copy the LED layout: pick a block below, then tap the board. Verified ' + ok + '/' + total, 'วางให้เหมือนรูปบนจอ LED: เลือกบล็อกด้านล่าง แล้วแตะบนกระดาน ตรงแล้ว ' + ok + '/' + total); }
    } else if (G.phase === 'play') {
      s.textContent = G.msg || L('Drag blocks to free the red square — slide it to the exit.', 'ลากบล็อกเพื่อเปิดทางให้สี่เหลี่ยมแดง — เลื่อนไปที่ทางออก');
      if (G.msg) s.classList.add('warn');
    } else if (G.phase === 'solution') {
      s.textContent = '';
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
    if (!G.sel) { say(L('All blocks are placed', 'วางบล็อกครบแล้ว')); return; }
    var rect = this.getBoundingClientRect();
    var c0 = Math.floor((e.clientX - rect.left - PAD) / cell), r0 = Math.floor((e.clientY - rect.top - PAD) / cell);
    var d = DIM[G.sel];
    var c = Math.max(0, Math.min(W - d.w, c0)), r = Math.max(0, Math.min(H - d.h, r0));
    if (overlaps(r, c, d)) { say(L('That space is already taken', 'ช่องนี้มีบล็อกอยู่แล้ว')); buzz(20); return; }
    G.pieces.push({ id: ++uid, t: G.sel, r: r, c: c });
    if (remaining(G.sel) <= 0) G.sel = firstAvailable();
    beep(660, 0.05); renderAll();
    if (G.pieces.length === G.tpieces.length && G.pieces.every(verified)) { beep(880, 0.12); buzz(30); }
  });

  $('tray').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled || !G) return;
    G.sel = b.dataset.t; renderTray();
  });

  function placeAll() {
    G.pieces = G.tpieces.map(function (p) { return { id: ++uid, t: p.t, r: p.r, c: p.c }; });
    G.sel = null;
  }
  function renderAuto() {
    var b = $('autoBtn'); b.classList.toggle('on', autoPlace); b.setAttribute('aria-pressed', autoPlace);
  }
  // Toggle: on = every level opens with the layout already copied; turning it on also fills this board, off clears it for manual placement
  $('autoBtn').onclick = function () {
    if (!G || G.phase !== 'setup') return;
    autoPlace = !autoPlace; store.set('hr_auto', autoPlace); renderAuto();
    if (autoPlace) placeAll(); else { G.pieces = []; G.sel = firstAvailable(); }
    renderAll();
  };
  $('clearBtn').onclick = function () { G.pieces = []; G.sel = firstAvailable(); renderAll(); };
  $('startBtn').onclick = function () { if (!$('startBtn').disabled) startPlay(); };

  function startPlay() {
    G.phase = 'play'; document.body.dataset.phase = 'play';
    G.initial = snap(); G.moves = 0; G.hints = 0; G.hist = []; G.msg = ''; hideTip();
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
    G.hist.push(snap()); hideTip();
    p.r += dr * k; p.c += dc * k; G.moves++;
    $('moves').textContent = G.moves;
    renderPieces(); renderLED(); renderStatus(); beep(500, 0.04); buzz(15);
    if (Sol.isGoal(gridOf())) win();
  }

  $('undoBtn').onclick = function () {
    if (!G || G.phase !== 'play' || !G.hist.length) return;
    hideTip(); G.pieces = G.hist.pop(); G.moves = Math.max(0, G.moves - 1);
    $('moves').textContent = G.moves; renderPieces(); renderLED();
  };
  $('restartBtn').onclick = function () {
    if (!G || !G.initial) return;
    G.pieces = G.initial.map(function (p) { return { id: p.id, t: p.t, r: p.r, c: p.c }; });
    hideTip(); G.moves = 0; G.hist = []; G.phase = 'play'; document.body.dataset.phase = 'play';
    G.t0 = Date.now(); $('moves').textContent = '0'; $('time').textContent = '0:00';
    clearTimer(); timerId = setInterval(tick, 250);
    clearBoard(); renderAll();
  };
  /* ---------- hints: explain what to focus on, where and why ---------- */
  var KIND = { R: 'big red square', V: 'tall block', H: 'wide block', S: 'small square' };
  var KIND_TH = { R: 'สี่เหลี่ยมแดงใหญ่', V: 'บล็อกตั้ง', H: 'บล็อกนอน', S: 'บล็อกเล็ก' };
  function cellsOf(t, r, c) {
    var d = DIM[t], out = [];
    for (var y = 0; y < d.h; y++) for (var x = 0; x < d.w; x++) out.push((r + y) * W + c + x);
    return out;
  }
  function dirWord(m) {
    return m.dr < 0 ? L('up', 'ขึ้น') : m.dr > 0 ? L('down', 'ลง') : m.dc < 0 ? L('left', 'ซ้าย') : L('right', 'ขวา');
  }
  function cellsWord(k) { return k > 1 ? ' ' + k + L(' cells', ' ช่อง') : ''; }
  function nameOf(p) {
    return L('the ' + KIND[p.t] + ' at row ' + (p.r + 1) + ', col ' + (p.c + 1),
             KIND_TH[p.t] + ' แถว ' + (p.r + 1) + ' คอลัมน์ ' + (p.c + 1));
  }
  function listOf(ps) {
    var n = ps.map(nameOf);
    return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + L(' and ', ' และ ') + n[n.length - 1];
  }
  function whyText(k) {
    return k === 'apart' ? L('Rule of thumb: keep the two empty cells side by side — wide blocks and the red square can only move into a matching gap.',
                             'หลักคิด: พยายามให้ช่องว่างสองช่องอยู่ติดกัน — บล็อกนอนและตัวแดงจะเลื่อนได้ก็ต่อเมื่อมีช่องว่างพอดีกับขนาด')
      : k === 'align' ? L('Rule of thumb: the exit is under columns 2–3, so red has to line up there before it can drop out.',
                          'หลักคิด: ทางออกอยู่ใต้คอลัมน์ 2–3 ตัวแดงต้องมาอยู่ตรงนั้นก่อนจึงจะหล่นออกได้')
      : L('Rule of thumb: every move should either clear red’s path or make room for a blocker to leave it.',
          'หลักคิด: ทุกการเดินควรเปิดทางให้ตัวแดง หรือสร้างที่ว่างให้บล็อกที่ขวางเลื่อนออกไป');
  }
  function pieceAt(m) { return G.pieces.filter(function (x) { return x.t === m.t && x.r === m.r && x.c === m.c; })[0]; }

  // Study the optimal line: when does red first move, and which blocks stand on the squares it needs for that slide?
  function analyze(g, sol) {
    var j = -1, i;
    for (i = 0; i < sol.length; i++) if (sol[i].t === 'R') { j = i; break; }
    var info = { j: j, first: sol[0], mover: pieceAt(sol[0]), red: j >= 0 ? sol[j] : null, blockers: [] };
    if (j > 0) {
      var rm = sol[j], path = {};
      for (var s = 1; s <= rm.k; s++) cellsOf('R', rm.r + rm.dr * s, rm.c + rm.dc * s).forEach(function (c) { path[c] = 1; });
      G.pieces.forEach(function (p) {
        if (p.t !== 'R' && cellsOf(p.t, p.r, p.c).some(function (c) { return path[c]; })) info.blockers.push(p);
      });
    }
    var empty = [];
    for (i = 0; i < Sol.N; i++) if (g[i] === 0) empty.push(i);
    var apart = empty.length === 2 && Math.abs(empty[0] - empty[1]) !== 1 && Math.abs(empty[0] - empty[1]) !== W;
    var red = G.pieces.filter(function (p) { return p.t === 'R'; })[0];
    info.why = apart ? 'apart' : red.c !== 1 && red.r < 3 ? 'align' : 'clear'; // text is picked at display time so the language toggle applies
    info.left = sol.length;
    return info;
  }

  function hintText(h) {
    var i = h.info, m = i.first, mv = i.mover, step = ' ' + dirWord(m) + cellsWord(m.k), why = whyText(i.why);
    if (h.tier === 1) {
      if (i.j === 0) {
        var rd = dirWord(i.red);
        return { head: L('Red is free to move', 'สีแดงเคลื่อนที่ได้เลย'),
          body: L('Nothing is in the way of the red square right now. ', 'ตอนนี้ไม่มีอะไรขวางสี่เหลี่ยมแดงอยู่ ') +
            (i.red.dr > 0 ? L('Slide it down toward the exit.', 'เลื่อนลงไปทางทางออกได้เลย')
            : i.red.dr < 0 ? L('Back it up — red sometimes has to retreat so other blocks can swing around.', 'ถอยขึ้นไปก่อน — บางครั้งตัวแดงต้องถอยเพื่อให้บล็อกอื่นหมุนผ่านได้')
            : L('Shift it sideways — the exit is under columns 2–3, so red has to line up there before it drops.', 'เลื่อนไปด้านข้าง — ทางออกอยู่ใต้คอลัมน์ 2–3 ตัวแดงต้องมาอยู่ตรงนั้นก่อนจึงจะหล่นลงได้')), why: why };
      }
      var many = i.blockers.length > 1, prep = i.j > 1;
      return { head: i.blockers.length ? L('Focus on the outlined block' + (many ? 's' : ''), 'ดูบล็อกที่มีกรอบสว่าง') : L('Make room first', 'เปิดที่ว่างก่อน'),
        body: i.blockers.length
          ? L('Red’s next slide ' + dirWord(i.red) + ' is blocked by ' + listOf(i.blockers) + '. Get ' + (many ? 'them' : 'it') +
              ' out of the way — red can move after ' + i.j + ' prep move' + (prep ? 's' : '') + '.',
              'ตัวแดงเลื่อน' + dirWord(i.red) + 'ไม่ได้เพราะมี ' + listOf(i.blockers) + ' ขวางอยู่ ให้ขยับออกไปก่อน — เดินเตรียมอีก ' + i.j + ' ครั้ง ตัวแดงก็จะเดินได้')
          : L('Red can’t move yet, but ' + i.j + ' prep move' + (prep ? 's' : '') + ' will open its path.',
              'ตัวแดงยังเดินไม่ได้ แต่เดินเตรียมอีก ' + i.j + ' ครั้งก็จะเปิดทางให้'),
        why: why };
    }
    var reason = i.j === 0 ? L('This is red’s own move.', 'นี่คือการเดินของตัวแดงเอง')
      : i.blockers.indexOf(mv) >= 0 ? L('It is sitting in red’s way.', 'บล็อกนี้ขวางทางตัวแดงอยู่')
      : L('It is not in red’s way itself, but it opens the gap the blocking pieces need to slide out.', 'บล็อกนี้ไม่ได้ขวางตัวแดงโดยตรง แต่ช่วยเปิดช่องว่างให้บล็อกที่ขวางเลื่อนออกไปได้');
    return { head: L('Try this', 'ลองทำแบบนี้'), body: L('Move ' + nameOf(m) + step + '. ' + reason, 'เลื่อน' + nameOf(m) + step + ' ' + reason), why: why };
  }

  function showHint(h) {
    var t = hintText(h), i = h.info;
    els.forEach(function (el) { el.removeAttribute('data-focus'); el.removeAttribute('data-hint'); });
    var focus = i.j === 0 ? [i.mover] : i.blockers;
    focus.forEach(function (p) { if (p && els.get(p.id)) els.get(p.id).setAttribute('data-focus', ''); });
    if (h.tier === 2 && i.mover && els.get(i.mover.id)) {
      var m = i.first, arrow = m.dr < 0 ? '↑' : m.dr > 0 ? '↓' : m.dc < 0 ? '←' : '→';
      els.get(i.mover.id).setAttribute('data-hint', arrow + (m.k > 1 ? m.k : ''));
    }
    $('tipHead').innerHTML = t.head + '<span class="step">' + L(i.left + ' move' + (i.left > 1 ? 's' : '') + ' to go · hint ' + h.tier + '/2', 'เหลืออีก ' + i.left + ' ครั้ง · คำใบ้ ' + h.tier + '/2') + '</span>';
    $('tipBody').textContent = t.body; $('tipWhy').textContent = t.why;
    $('tip').classList.remove('hidden');
    try { $('tip').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
  }
  function hideTip() { if (G) G.hint = null; $('tip').classList.add('hidden'); }

  // Tap 1 explains the situation and outlines the block(s) to focus on; tap 2 shows the exact move.
  $('hintBtn').onclick = function () {
    if (!G || G.phase !== 'play') return;
    var g = gridOf(), k = Sol.key(g);
    if (!G.hint || G.hint.key !== k) {
      var sol = Sol.solve(g);
      if (!sol || !sol.length) { G.msg = L('No solution from here — try Undo', 'จากตำแหน่งนี้ไม่มีทางไข — ลองกด Undo'); renderStatus(); return; }
      G.hint = { key: k, info: analyze(g, sol), tier: 0 };
    }
    G.hint.tier = Math.min(2, G.hint.tier + 1); G.hints++;
    showHint(G.hint);
  };


  /* ---------- solution viewer: step through the optimal line from the start position ---------- */
  function stopAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } }

  function askSolution() {
    if (!G || G.phase !== 'play') return;
    if (seen[G.lv.id]) openSolution(); else $('solAsk').classList.remove('hidden');
  }
  $('solBtn').onclick = askSolution;
  $('solNo').onclick = function () { $('solAsk').classList.add('hidden'); };
  $('solYes').onclick = function () { $('solAsk').classList.add('hidden'); openSolution(); };

  function openSolution() {
    if (!G || G.phase !== 'play') return;
    var steps = Sol.solve(Sol.fromPieces(G.initial));
    if (!steps) { say(L('No solution found for this layout', 'ไม่พบเฉลยสำหรับรูปแบบนี้')); return; }
    seen[G.lv.id] = 1; store.set('hr_seen', seen);
    // freeze the player's attempt, show the start position again and walk it from there
    G.sol = { steps: steps, i: 0, stash: { pieces: snap(), hist: G.hist, moves: G.moves }, pausedAt: Date.now() };
    clearTimer(); hideTip();
    G.pieces = G.initial.map(function (p) { return { id: p.id, t: p.t, r: p.r, c: p.c }; });
    G.phase = 'solution'; document.body.dataset.phase = 'solution';
    clearBoard(); renderAll(); renderSol();
    try { $('solHead').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
  }

  function renderSol() {
    var S = G.sol, n = S.steps.length, i = S.i;
    els.forEach(function (el) { el.removeAttribute('data-hint'); });
    var next = i < n ? S.steps[i] : null;
    if (next) {
      var mv = pieceAt(next), arrow = next.dr < 0 ? '↑' : next.dr > 0 ? '↓' : next.dc < 0 ? '←' : '→';
      if (mv && els.get(mv.id)) els.get(mv.id).setAttribute('data-hint', arrow + (next.k > 1 ? next.k : ''));
      $('solHead').textContent = L('Step ' + (i + 1) + ' of ' + n, 'ขั้นที่ ' + (i + 1) + ' จาก ' + n);
      $('solBody').textContent = L('Move ' + nameOf(next) + ' ' + dirWord(next) + cellsWord(next.k) + '.', 'เลื่อน' + nameOf(next) + ' ' + dirWord(next) + cellsWord(next.k));
    } else {
      $('solHead').textContent = L('Solved in ' + n + ' move' + (n > 1 ? 's' : ''), 'ไขได้ใน ' + n + ' ครั้ง');
      $('solBody').textContent = L('The red square is out. Go back and solve it yourself — this level earns no stars now.', 'ตัวแดงออกมาแล้ว กลับไปลองไขเองดู — ด่านนี้จะไม่ได้ดาวแล้ว');
    }
    $('solPrev').disabled = i === 0;
    $('solNext').disabled = i >= n;
    $('solPlay').disabled = i >= n && !autoTimer;
    $('solPlay').textContent = autoTimer ? L('❚❚ Pause', '❚❚ หยุด') : L('▶ Play', '▶ เล่น');
    renderLED();
  }

  function solStep(dir) {
    var S = G.sol; if (!S) return;
    if (dir > 0) {
      if (S.i >= S.steps.length) return;
      var m = S.steps[S.i], p = pieceAt(m); if (!p) return;
      p.r += m.dr * m.k; p.c += m.dc * m.k; S.i++;
    } else {
      if (S.i <= 0) return;
      var b = S.steps[S.i - 1];
      var q = G.pieces.filter(function (x) { return x.t === b.t && x.r === b.r + b.dr * b.k && x.c === b.c + b.dc * b.k; })[0]; if (!q) return;
      q.r = b.r; q.c = b.c; S.i--;
    }
    renderPieces(); beep(500, 0.04); buzz(10);
    if (S.i >= S.steps.length) stopAuto();
    renderSol();
  }
  $('solNext').onclick = function () { stopAuto(); solStep(1); };
  $('solPrev').onclick = function () { stopAuto(); solStep(-1); };
  $('solPlay').onclick = function () {
    if (!G || !G.sol) return;
    if (autoTimer) { stopAuto(); renderSol(); return; }
    if (G.sol.i >= G.sol.steps.length) return;
    autoTimer = setInterval(function () { solStep(1); }, 750);
    solStep(1);
  };

  $('solBack').onclick = function () {
    if (!G || !G.sol) return;
    stopAuto();
    var S = G.sol; G.sol = null;
    G.pieces = S.stash.pieces; G.hist = S.stash.hist; G.moves = S.stash.moves;
    G.t0 += Date.now() - S.pausedAt; // the clock did not run while the solution was open
    G.phase = 'play'; document.body.dataset.phase = 'play';
    clearTimer(); timerId = setInterval(tick, 250);
    clearBoard(); renderAll();
  };

  /* ---------- win ---------- */
  function win() {
    G.phase = 'won'; document.body.dataset.phase = 'won'; clearTimer();
    G.elapsed = Date.now() - G.t0;
    var par = G.lv.par, st = seen[G.lv.id] ? 0 : G.moves <= par ? 3 : G.moves <= Math.ceil(par * 1.4) ? 2 : 1;
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
        (G.hints ? ' · Hints ' + G.hints : '') + (seen[G.lv.id] ? '<br>' + L('Solution viewed — no stars for this level', 'ดูเฉลยแล้ว — ด่านนี้ไม่ได้ดาว') : '');
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

  /* ---------- about: the story behind the name ---------- */
  var aboutPage = 0, aboutPages = document.querySelectorAll('#about .apage');
  (function () { // one dot per page; tapping a dot jumps there
    for (var i = 0; i < aboutPages.length; i++) (function (i) {
      var d = document.createElement('i'); d.onclick = function () { setAboutPage(i); }; $('aDots').appendChild(d);
    })(i);
  })();
  function setAboutPage(i) {
    aboutPage = Math.max(0, Math.min(aboutPages.length - 1, i));
    Array.prototype.forEach.call(aboutPages, function (sec, k) { sec.classList.toggle('hidden', k !== aboutPage); });
    Array.prototype.forEach.call($('aDots').children, function (d, k) { d.classList.toggle('on', k === aboutPage); });
    $('aPrev').disabled = aboutPage === 0; $('aNext').disabled = aboutPage === aboutPages.length - 1;
    $('about').firstElementChild.scrollTop = 0;
  }
  $('aPrev').onclick = function () { setAboutPage(aboutPage - 1); };
  $('aNext').onclick = function () { setAboutPage(aboutPage + 1); };
  function showAbout(on) {
    $('about').classList.toggle('hidden', !on);
    if (on) setAboutPage(0);
  }
  $('aboutBtn').onclick = function () { showAbout(true); };
  $('aboutClose').onclick = function () { showAbout(false); };
  $('about').addEventListener('click', function (e) { if (e.target === this) showAbout(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') showAbout(false); });

  /* ---------- language: instructions, hints and solution in English or Thai ---------- */
  // Static text carries its Thai copy in data-th; the English original is stashed in data-en on first switch.
  function applyLang() {
    document.documentElement.lang = lang;
    Array.prototype.forEach.call(document.querySelectorAll('[data-th]'), function (el) {
      if (el.dataset.en === undefined) el.dataset.en = el.innerHTML;
      el.innerHTML = lang === 'th' ? el.dataset.th : el.dataset.en;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.lang-btn'), function (b) {
      b.setAttribute('aria-pressed', lang === 'th'); b.setAttribute('aria-label', lang === 'th' ? 'ภาษาไทย (เปิด)' : 'Thai guidance (off)');
    });
    if (!G) return;
    if (G.msg) G.msg = '';
    renderStatus();
    if (G.phase === 'play' && G.hint && !$('tip').classList.contains('hidden')) showHint(G.hint);
    if (G.phase === 'solution' && G.sol) renderSol();
  }
  Array.prototype.forEach.call(document.querySelectorAll('.lang-btn'), function (b) {
    b.onclick = function () {
      lang = lang === 'th' ? 'en' : 'th'; store.set('hr_lang', lang); applyLang();
      if ($('about').classList.contains('hidden')) toast(lang === 'th' ? 'คำแนะนำ คำใบ้ เฉลย: ภาษาไทย' : 'Instructions, hints, solution: English');
    };
  });

  /* ---------- skins ---------- */
  var toastTimer = null;
  function toast(m) {
    var t = $('toast'); t.textContent = m; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1400);
  }
  function applySkin() {
    var sk = SKINS.filter(function (x) { return x.id === skin; })[0] || SKINS[0];
    skin = sk.id; document.documentElement.dataset.skin = sk.id;
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.setAttribute('content', sk.theme);
    return sk;
  }
  Array.prototype.forEach.call(document.querySelectorAll('.skin-btn'), function (b) {
    b.onclick = function () {
      var i = SKINS.map(function (x) { return x.id; }).indexOf(skin);
      skin = SKINS[(i + 1) % SKINS.length].id; store.set('hr_skin', skin); toast('Skin: ' + applySkin().name);
    };
  });
  applySkin();
  applyLang();

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
