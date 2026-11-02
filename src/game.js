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
  var timerOn = store.get('hr_timer', true); // off = no-stress mode: the clock is hidden (time is still tracked quietly)
  var autoPlace = store.get('hr_auto', true);
  var autoStart = store.get('hr_autostart', false);
var bkFreq = store.get('hr_bkfreq', 'weekly'); // backup reminder: weekly | monthly | off
if (bkFreq !== 'monthly' && bkFreq !== 'off') bkFreq = 'weekly';
var bk = store.get('hr_bk', null); // { at: last backup (ms), stars/ds/streak: what it held, snooze: last "Later" (ms), since: first run (ms) }
if (!bk || typeof bk !== 'object') bk = { at: 0, stars: 0, ds: [], streak: 0, snooze: 0, since: Date.now() };
if (!bk.since) bk.since = Date.now();
store.set('hr_bk', bk);
  // Reduce motion: follows the phone's "remove animations" setting until the player flips the switch in Settings
  var motionPref = store.get('hr_motion', null);
  function reduced() { if (motionPref !== null) return motionPref; try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function applyMotion() { document.documentElement.dataset.motion = reduced() ? 'reduce' : ''; }
  applyMotion(); // on = opening a level skips the setup phase and starts playing at once
  var BUILD = '__BUILD__'; // stamped by build.js (hash of the app); shown in the menu and used to tell if a refresh changed anything
  var lang = store.get('hr_lang', 'en') === 'th' ? 'th' : 'en'; // guidance text (instructions, hints, solution) in English or Thai
  var SKINS = [ // shown all at once in Settings, each tile painted with its own colours (see style.css)
    { id: 'classic', name: 'Classic', theme: '#0d1117' },
    { id: 'blossom', name: 'Blossom', theme: '#0b0709' },
    { id: 'neon', name: 'Neon', theme: '#020503' },
    { id: 'ocean', name: 'Ocean', theme: '#050d14' },
    { id: 'sunset', name: 'Sunset', theme: '#0f0713' },
    { id: 'forest', name: 'Forest', theme: '#060c08' },
    { id: 'mono', name: 'Mono', theme: '#0a0a0a' },
    { id: 'gold', name: 'Gold', theme: '#0a0804' }
  ];
  var skin = store.get('hr_skin', 'classic');

  var cell = 64, G = null, drag = null, uid = 0, timerId = null, msgTimer = null, autoTimer = null;
  var els = new Map();
  var ledCells = [];
  var RSVG = '<svg viewBox="0 0 100 100"><polygon points="50,12 90,84 10,84" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="6" stroke-linejoin="round"/><polygon points="50,38 68,70 32,70" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="5" stroke-linejoin="round"/></svg>';

  /* ---------- helpers ---------- */
  function L(en, th) { return lang === 'th' ? th : en; }
  // Sound: one short, clearly audible note per event. The audio context is created/resumed on the first tap
  // (phones keep it suspended until then) and the note has a quick attack + decay so it is a "tock", not a faint click.
  function audio() {
    var Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return null;
    window._ac = window._ac || new Ctx();
    if (window._ac.state === 'suspended') try { window._ac.resume(); } catch (e) {}
    return window._ac;
  }
  ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (ev) { // wake audio on the first real tap
    document.addEventListener(ev, function unlock() {
      if (!muted) audio();
      ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (e2) { document.removeEventListener(e2, unlock, true); });
    }, true);
  });
  function beep(f, d) {
    if (muted) return;
    try {
      var ac = audio(); if (!ac) return;
      var t = ac.currentTime, dur = Math.max(d || 0.06, 0.1);
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.value = f || 520;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  function buzz(ms) { if (haptics) try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
  function fmt(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function stars(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n); }
  function gradeOf(par) {
    if (par <= 8) return { name: L('Starter', 'เริ่มต้น'), hint: L('learn the basics', 'เรียนรู้พื้นฐาน') };
    if (par <= 20) return { name: L('Easy', 'ง่าย'), hint: L('a few clever slides', 'เลื่อนอย่างมีชั้นเชิงไม่กี่ครั้ง') };
    if (par <= 40) return { name: L('Medium', 'ปานกลาง'), hint: L('plan ahead', 'วางแผนล่วงหน้า') };
    if (par <= 65) return { name: L('Hard', 'ยาก'), hint: L('think in sequences', 'คิดเป็นลำดับขั้น') };
    if (par <= 90) return { name: L('Expert', 'เชี่ยวชาญ'), hint: L('serious puzzling', 'ปริศนาจริงจัง') };
    return { name: L('Master', 'ปรมาจารย์'), hint: L('legendary layouts', 'รูปแบบระดับตำนาน') };
  }
  function levelTitle(lv, i) {
    if (lv.daily) return L('Daily #', 'รายวัน #') + lv.number + ' · ' + dayLabel(lv.key);
    if (lv.design) return lv.n ? L('Stage ', 'ด่านออกแบบ ') + lv.n + ' · ' + gradeOf(lv.par).name : L('Test play', 'ทดลองเล่น') + ' · ' + gradeOf(lv.par).name;
    return L('Level ', 'ด่าน ') + (i + 1) + ' · ' + gradeOf(lv.par).name;
  }
  function gridOf() { return Sol.fromPieces(G.pieces); }
  function snap() { return G.pieces.map(function (p) { return { id: p.id, t: p.t, r: p.r, c: p.c }; }); }

  /* ---------- dialogs: focus moves in on open and back on close; Esc closes; Tab stays inside ---------- */
  var dlgs = []; // open overlays, newest last: { id, back }
  function openDlg(id, focusSel) {
    var o = $(id);
    if (!dlgs.some(function (d) { return d.id === id; })) dlgs.push({ id: id, back: document.activeElement });
    o.classList.remove('hidden');
    var f = (focusSel && o.querySelector(focusSel)) || o.querySelector('.card');
    if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
  }
  function closeDlg(id) {
    $(id).classList.add('hidden');
    for (var i = dlgs.length - 1; i >= 0; i--) if (dlgs[i].id === id) {
      var back = dlgs[i].back; dlgs.splice(i, 1);
      if (back && back.focus && document.body.contains(back) && back.offsetParent !== null) try { back.focus({ preventScroll: true }); } catch (e) {}
      break;
    }
  }
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('button,textarea,input:not([type=file]),a[href]'), function (el) { return !el.disabled && el.offsetParent !== null; });
  }
  document.addEventListener('keydown', function (e) {
    var top = dlgs[dlgs.length - 1]; if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (top.id === 'win') return; // the win card needs a real choice
      if (top.id === 'about') showAbout(false); else if (top.id === 'settings') showSettings(false); else closeDlg(top.id);
    } else if (e.key === 'Tab') {
      var f = focusables($(top.id)); if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    }
  });

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
    renderDsCard();
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
    showScreen('menu');
    renderMenu(); renderNudge(); loadDaily(); window.scrollTo(0, 0);
  }

  /* ---------- daily puzzle: generated from today's date on the device (see daily.js) ---------- */
  var dailyLv = null, dailyBusy = null;
  function dayLabel(key) {
    var p = key.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    try { return d.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return key; }
  }
  function solvedOn(key) { return !!progress['d' + key]; }
  function streak() { // consecutive solved days, counting back from today (or from yesterday while today is still open)
    var k = Daily.dateKey(), n = 0;
    if (!solvedOn(k)) k = Daily.addDays(k, -1);
    while (solvedOn(k)) { n++; k = Daily.addDays(k, -1); }
    return n;
  }
  function renderWeek(box) { // this week, Monday to Sunday
    var today = Daily.dateKey(), mon = Daily.addDays(today, -((Daily.weekday(today) + 6) % 7));
    var names = lang === 'th' ? ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    var html = '';
    for (var i = 0; i < 7; i++) {
      var k = Daily.addDays(mon, i), done = solvedOn(k), cls = done ? 'done' : k === today ? 'today' : k > today ? 'future' : 'miss';
      html += '<span class="day ' + cls + '" title="' + k + '"><small>' + names[i] + '</small><b>' + (done ? '★' : k === today ? '?' : k > today ? '·' : '–') + '</b></span>';
    }
    box.innerHTML = html;
  }
  function untilTomorrow() {
    var now = new Date(), mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), m = Math.max(1, Math.round((mid - now) / 60000));
    var h = Math.floor(m / 60); m = m % 60;
    return L('Next puzzle in <b>' + h + ' h ' + m + ' m</b>', 'ปริศนาถัดไปในอีก <b>' + h + ' ชม. ' + m + ' นาที</b>');
  }
  function renderDaily() {
    var key = Daily.dateKey(), lv = dailyLv && dailyLv.key === key ? dailyLv : null, n = streak();
    $('dDate').textContent = dayLabel(key);
    $('dStreak').textContent = n ? '🔥 ' + L(n + '-day streak', 'ต่อเนื่อง ' + n + ' วัน') : L('Start a streak', 'เริ่มสะสมวันต่อเนื่อง');
    renderWeek($('dWeek'));
    var led = $('dLed');
    if (!lv) {
      $('dTitle').textContent = L('Daily #', 'รายวัน #') + Daily.numberOf(key); $('dGrade').textContent = L('Preparing today’s puzzle…', 'กำลังเตรียมปริศนาวันนี้…'); $('dNote').textContent = '';
      led.innerHTML = new Array(21).join('<i></i>'); $('dPlay').disabled = true; $('dPlay').textContent = L('Play today’s puzzle', 'เล่นปริศนาวันนี้');
      return;
    }
    var g = lv.g.split('').map(Number), pr = progress[lv.id];
    led.innerHTML = g.map(function (v) { return '<i class="' + (v === 0 ? '' : v <= 4 ? 'R' : v <= 8 ? 'B' : 'Y') + '"></i>'; }).join('');
    $('dTitle').textContent = L('Puzzle #', 'ปริศนา #') + lv.number;
    $('dGrade').textContent = gradeOf(lv.par).name + ' · par ' + lv.par;
    $('dNote').textContent = pr ? L('Solved ', 'ผ่านแล้ว ') + stars(pr.stars) + ' · ' + pr.moves + ' moves' : L('Same puzzle for everyone today', 'ทุกคนได้ปริศนาเดียวกันในวันนี้');
    $('dPlay').disabled = false;
    $('dPlay').textContent = pr ? L('Play again', 'เล่นอีกครั้ง') : L('Play today’s puzzle', 'เล่นปริศนาวันนี้');
  }
  // Generate today's puzzle once per day, off the main thread when possible (it explores ~20k positions)
  function loadDaily() {
    var key = Daily.dateKey();
    if (dailyLv && dailyLv.key === key) { renderDaily(); return; }
    var c = store.get('hr_daily_lv', null);
    if (c && c.key === key && c.g) { dailyLv = c; renderDaily(); return; }
    renderDaily();
    if (dailyBusy === key) return;
    dailyBusy = key;
    job({ type: 'daily', key: key }, function (lv) { dailyBusy = null; dailyLv = lv; store.set('hr_daily_lv', lv); renderDaily(); });
  }
  // Heavy searches run in a Web Worker built from the inlined solver + daily scripts; if workers are unavailable they
  // run on the main thread after a short delay instead. Results arrive through the callback either way.
  var worker = null, jobs = {}, jobSeq = 0;
  function runInline(m) { return m.type === 'daily' ? Daily.generate(m.key) : Sol.solve(m.g); }
  function job(m, cb) {
    var id = ++jobSeq, inline = function () { setTimeout(function () { cb(runInline(m)); }, 30); };
    try {
      if (!worker) {
        var src = $('srcSolver').textContent + ';\n' + $('srcDaily').textContent +
          ';\nonmessage=function(e){var m=e.data;postMessage({id:m.id,r:m.type==="daily"?Daily.generate(m.key):Solver.solve(m.g)});};';
        worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        worker.onmessage = function (e) { var j = jobs[e.data.id]; delete jobs[e.data.id]; if (j) j.cb(e.data.r); };
        worker.onerror = function (e) { // fall back for everything still waiting
          if (e && e.preventDefault) e.preventDefault();
          var pend = jobs; jobs = {}; worker = null;
          Object.keys(pend).forEach(function (k) { var j = pend[k]; setTimeout(function () { j.cb(runInline(j.m)); }, 30); });
        };
      }
      jobs[id] = { m: m, cb: cb }; m.id = id; worker.postMessage(m);
    } catch (e) { delete jobs[id]; inline(); }
  }
  $('dPlay').onclick = function () { if (dailyLv && dailyLv.key === Daily.dateKey()) openLevel(dailyLv); else loadDaily(); };

  /* ---------- design stage: build your own layout, checked by the solver, saved on this device ---------- */
  // Rules: exactly one big red block, exactly two empty cells, any mix of the other blocks. A layout that equals
  // one of the 100 levels (or its mirror image) cannot be saved. Par = true optimum; grade from par like the levels.
  var MAX_STAGES = 50;
  var designs = store.get('hr_designs', []);               // [{ n, g, par, at }]
  var levelKeys = {};
  LV.forEach(function (lv, i) { levelKeys[lv.g] = i; });
  function mirrorKey(g) {
    return Sol.fromPieces(Sol.piecesOf(g).map(function (p) { return { t: p.t, r: p.r, c: W - p.c - DIM[p.t].w }; })).join('');
  }
  function stageLv(d) { return { id: 's' + d.n, n: d.n, par: d.par, g: d.g, design: true }; }
  function saveDesigns() { store.set('hr_designs', designs); }

  function openDesign(n, pieces) {
    clearTimer();
    G = { idx: -1, lv: { id: 'draft', par: 0, g: '', design: true }, target: null, tpieces: [], pieces: [], initial: null, dc: {}, trend: null,
          phase: 'design', sel: 'R', moves: 0, hints: 0, hist: [], redo: [], t0: 0, elapsed: 0, msg: '', sol: null, editing: n || null, check: null };
    var d = n && designs.filter(function (x) { return x.n === n; })[0];
    var src = pieces || (d ? Sol.piecesOf(d.g.split('').map(Number)) : null);
    if (src) G.pieces = src.map(function (p) { return { id: ++uid, t: p.t, r: p.r, c: p.c }; });
    if (G.pieces.some(function (p) { return p.t === 'R'; })) G.sel = 'S';
    clearBoard();
    showScreen('game');
    document.body.dataset.phase = 'design';
    $('lvTitle').textContent = G.editing ? L('Edit stage ', 'แก้ไขด่าน ') + G.editing : L('Design stage', 'ออกแบบด่าน');
    hideTip(); renderRecord(); $('bestStat').classList.add('hidden'); layout(); renderAll(); designCheck(); window.scrollTo(0, 0);
  }
  function renderDesignTray() {
    var counts = { R: 0, V: 0, H: 0, S: 0 };
    G.pieces.forEach(function (p) { counts[p.t]++; });
    var names = { R: L('Red', 'แดง'), V: L('Tall', 'ตั้ง'), H: L('Wide', 'นอน'), S: L('Small', 'เล็ก') };
    $('tray').classList.remove('hidden');
    $('tray').innerHTML = TYPES.map(function (t) {
      var d = DIM[t], off = t === 'R' && counts.R >= 1;
      return '<button data-t="' + t + '" class="' + (G.sel === t ? 'sel' : '') + '"' + (off ? ' disabled' : '') + '>' +
        '<span class="mini m' + t + '" style="width:' + d.w * 15 + 'px;height:' + d.h * 15 + 'px"></span>' +
        '<small>' + names[t] + ' ×' + counts[t] + '</small></button>';
    }).join('');
  }
  function designTap(e, board) {
    var pe = e.target.closest('.piece');
    if (pe) { // tap a block to take it off
      var id = +pe.dataset.id, gone = G.pieces.filter(function (p) { return p.id === id; })[0];
      G.pieces = G.pieces.filter(function (p) { return p.id !== id; });
      if (gone && gone.t === 'R') G.sel = 'R';
      beep(380, 0.05); designChanged(); return;
    }
    if (!G.sel) return;
    var rect = board.getBoundingClientRect(), d = DIM[G.sel];
    var c0 = Math.floor((e.clientX - rect.left - PAD) / cell), r0 = Math.floor((e.clientY - rect.top - PAD) / cell);
    var c = Math.max(0, Math.min(W - d.w, c0)), r = Math.max(0, Math.min(H - d.h, r0));
    if (overlaps(r, c, d)) { say(L('That space is already taken', 'ช่องนี้มีบล็อกอยู่แล้ว')); buzz(20); return; }
    var empty = 20 - G.pieces.reduce(function (n, p) { return n + DIM[p.t].w * DIM[p.t].h; }, 0);
    if (empty - d.w * d.h < 2) { say(L('Leave 2 cells empty so blocks can move', 'ต้องเหลือช่องว่าง 2 ช่องเพื่อให้บล็อกเลื่อนได้')); buzz(20); return; }
    G.pieces.push({ id: ++uid, t: G.sel, r: r, c: c });
    if (G.sel === 'R') G.sel = 'S';
    beep(660, 0.05); designChanged();
  }
  function designChanged() { G.msg = ''; renderAll(); designCheck(); }
  function setCheck(cls, head, body) {
    var b = $('dsCheck'); b.className = 'dscheck ' + (cls || '');
    Array.prototype.forEach.call(b.querySelectorAll('.tip2'), function (t) { t.remove(); });
    $('dsHead').textContent = head; $('dsBody').textContent = body || '';
  }
  // Live check after every change: rules first, then "is it one of the levels?", then the solver (in the worker)
  function designCheck() {
    var g = gridOf(), key = g.join(''), nR = G.pieces.filter(function (p) { return p.t === 'R'; }).length;
    var empty = g.filter(function (v) { return v === 0; }).length, chk = { key: key, ok: false, par: 0, save: false };
    G.check = chk;
    if (!nR) setCheck('', L('Place the big red block', 'วางบล็อกแดงใหญ่'), L('Every stage has exactly one, plus any mix of other blocks.', 'ทุกด่านมีบล็อกแดงใหญ่ 1 ก้อน และบล็อกอื่นแบบไหนก็ได้'));
    else if (empty > 2) setCheck('', L('Fill ' + (empty - 2) + ' more cell' + (empty - 2 > 1 ? 's' : ''), 'วางเพิ่มอีก ' + (empty - 2) + ' ช่อง'), L('Exactly 2 cells stay empty so blocks can slide.', 'ต้องเหลือช่องว่างพอดี 2 ช่องเพื่อให้บล็อกเลื่อนได้'));
    else if (Sol.isGoal(g)) setCheck('bad', L('Red is already at the exit', 'บล็อกแดงอยู่ที่ทางออกแล้ว'), L('Move it away so there is something to solve.', 'ย้ายออกจากทางออก เพื่อให้มีอะไรให้แก้'));
    else {
      var lvl = levelKeys[key], mir = levelKeys[mirrorKey(g)], same = designs.filter(function (x) { return x.g === key; })[0];
      if (lvl !== undefined || mir !== undefined) {
        var i = lvl !== undefined ? lvl : mir;
        chk.ok = true; chk.par = LV[i].par;
        setCheck('bad', lvl !== undefined ? L('Same as Level ' + (i + 1), 'เหมือนกับด่าน ' + (i + 1)) : L('Mirror image of Level ' + (i + 1), 'เป็นภาพสะท้อนของด่าน ' + (i + 1)),
          L('Change at least one block to make it your own (you can still test it).', 'เปลี่ยนอย่างน้อย 1 บล็อกเพื่อให้เป็นด่านของคุณ (ยังทดลองเล่นได้)'));
      } else if (same && same.n !== G.editing) {
        chk.ok = true; chk.par = same.par;
        setCheck('bad', L('Already saved as Stage ' + same.n, 'บันทึกไว้แล้วเป็นด่าน ' + same.n), L('Change a block to make a new one.', 'เปลี่ยนบล็อกเพื่อสร้างด่านใหม่'));
      } else {
        setCheck('', L('Checking…', 'กำลังตรวจ…'), L('Looking for the shortest solution', 'กำลังหาทางแก้ที่สั้นที่สุด'));
        job({ type: 'solve', g: g }, function (sol) {
          if (!G || G.phase !== 'design' || G.check !== chk) return;   // the layout changed meanwhile
          if (!sol) {
            setCheck('bad', L('✗ No solution', '✗ ไม่มีทางแก้'), L('Red can never reach the exit from here. Move a block or two.', 'บล็อกแดงไปถึงทางออกไม่ได้เลย ลองย้ายบล็อกสักหนึ่งหรือสองก้อน'));
            var smalls = G.pieces.filter(function (p) { return p.t === 'S'; }).length;
            if (smalls < 4) { // measured: ~4% of random layouts with 0 small blocks are solvable, ~16% with 2, ~71% with 4
              var t = document.createElement('span'); t.className = 'tip2';
              t.textContent = L('Tip: layouts with fewer than 4 small blocks are usually locked — try swapping a tall or wide block for two small ones.',
                'เคล็ดลับ: ถ้ามีบล็อกเล็กน้อยกว่า 4 ก้อน มักจะติดจนแก้ไม่ได้ ลองเปลี่ยนบล็อกตั้งหรือบล็อกนอน 1 ก้อนเป็นบล็อกเล็ก 2 ก้อน');
              $('dsCheck').appendChild(t);
            }
            renderDesignButtons(); return;
          }
          chk.ok = true; chk.par = sol.length; chk.save = !same || same.g !== key || same.n !== G.editing;
          if (same && same.n === G.editing) chk.save = false;
          var gr = gradeOf(chk.par).name;
          setCheck('ok', L('✓ Solvable · minimum ' + chk.par + ' moves', '✓ แก้ได้ · อย่างน้อย ' + chk.par + ' ครั้ง'),
            L('Grade: ' + gr + ' · 3 stars at ≤ ' + chk.par + ' moves', 'ระดับ: ' + gr + ' · 3 ดาวเมื่อเดิน ≤ ' + chk.par + ' ครั้ง') + (chk.save ? '' : L(' · saved', ' · บันทึกแล้ว')));
          renderDesignButtons();
        });
      }
    }
    renderDesignButtons();
  }
  function renderDesignButtons() {
    var c = G.check || {}, full = !G.editing && designs.length >= MAX_STAGES;
    $('dsTest').disabled = !c.ok;
    $('dsSave').disabled = !c.save || full;
    $('dsSave').textContent = G.editing ? L('Save changes', 'บันทึกการแก้ไข') : full ? L('50 stages max', 'เต็ม 50 ด่านแล้ว') : L('Save stage', 'บันทึกด่าน');
  }
  $('dsTest').onclick = function () {
    var c = G.check; if (!c || !c.ok) return;
    // only an unchanged saved stage plays (and records stars) as that stage; anything else is an unrecorded draft
    var saved = G.editing && designs.filter(function (d) { return d.n === G.editing && d.g === c.key; })[0];
    openLevel(saved ? stageLv(saved) : { id: 'draft', n: null, edit: G.editing, par: c.par, g: c.key, design: true });
  };
  $('dsSave').onclick = function () {
    var c = G.check; if (!c || !c.save) return;
    if (G.editing) {
      designs.forEach(function (d) { if (d.n === G.editing) { d.g = c.key; d.par = c.par; d.at = Date.now(); } });
      delete progress['s' + G.editing]; delete seen['s' + G.editing]; store.set('hr_progress', progress); store.set('hr_seen', seen);
      say(L('Stage ' + G.editing + ' updated', 'อัปเดตด่าน ' + G.editing + ' แล้ว'));
    } else {
      if (designs.length >= MAX_STAGES) return;
      var n = designs.reduce(function (m, d) { return Math.max(m, d.n); }, 0) + 1;
      designs.push({ n: n, g: c.key, par: c.par, at: Date.now() });
      G.editing = n; $('lvTitle').textContent = L('Edit stage ', 'แก้ไขด่าน ') + n;
      say(L('Saved as Stage ' + n, 'บันทึกเป็นด่าน ' + n + ' แล้ว'));
    }
    saveDesigns(); beep(880, 0.12); buzz(30); c.save = false; renderDesignButtons();
    setCheck('ok', $('dsHead').textContent, $('dsBody').textContent.replace(L(' · saved', ' · บันทึกแล้ว'), '') + L(' · saved', ' · บันทึกแล้ว'));
  };
  function showStages() {
    clearTimer(); G = null; hideTip();
    showScreen('stages'); renderStages(); window.scrollTo(0, 0);
  }
  function renderStages() {
    var got = 0, hard = 0;
    designs.forEach(function (d) { var pr = progress['s' + d.n]; if (pr) got += pr.stars; hard = Math.max(hard, d.par); });
    $('stCount').textContent = designs.length + ' / ' + MAX_STAGES;
    $('stStars').textContent = got + ' / ' + designs.length * 3;
    $('stHard').textContent = hard ? 'par ' + hard : '–';
    $('stEmpty').classList.toggle('hidden', designs.length > 0);
    $('stNew').disabled = designs.length >= MAX_STAGES;
    var box = $('dsList');
    if (!designs.length) { box.innerHTML = ''; return; }
    box.innerHTML = designs.slice().sort(function (a, b) { return b.n - a.n; }).map(function (d) {
      var pr = progress['s' + d.n];
      return '<div class="dsrow"><button class="dsplay" data-play="' + d.n + '">' + L('Stage ', 'ด่าน ') + d.n +
        '<small>' + gradeOf(d.par).name + ' · par ' + d.par + ' · ' + stars(pr ? pr.stars : 0) + '</small></button>' +
        '<button class="icon-btn" data-edit="' + d.n + '" aria-label="' + L('Edit stage ', 'แก้ไขด่าน ') + d.n + '"><svg class="ico" aria-hidden="true"><use href="#i-edit"/></svg></button>' +
        '<button class="icon-btn" data-del="' + d.n + '" aria-label="' + L('Delete stage ', 'ลบด่าน ') + d.n + '"><svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg></button></div>';
    }).join('');
  }
  $('dsList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.play) { var d = designs.filter(function (x) { return x.n === +b.dataset.play; })[0]; if (d) { var lv = stageLv(d); lv.fromList = true; openLevel(lv); } return; }
    if (b.dataset.edit) { openDesign(+b.dataset.edit); return; }
    if (b.dataset.del) { // two taps: the first arms the button, the second deletes
      var n = +b.dataset.del;
      if (!b.classList.contains('armed')) {
        b.classList.add('armed'); b.textContent = L('Delete?', 'ลบ?');
        setTimeout(function () { if (document.body.contains(b)) renderStages(); }, 3000); return;
      }
      designs = designs.filter(function (x) { return x.n !== n; }); saveDesigns();
      delete progress['s' + n]; delete seen['s' + n]; store.set('hr_progress', progress); store.set('hr_seen', seen);
      renderStages(); renderDsCard();
    }
  });
  function renderDsCard() {
    $('dsCount').textContent = designs.length ? L(designs.length + ' saved · build your own puzzle', 'บันทึกไว้ ' + designs.length + ' ด่าน · สร้างปริศนาของคุณเอง')
      : L('Build your own puzzle', 'สร้างปริศนาของคุณเอง');
  }
  $('dsOpen').onclick = showStages;
  $('stNew').onclick = function () { openDesign(null); };
  $('stBack').onclick = showMenu;

  function showScreen(id) {
    ['menu', 'stages', 'game'].forEach(function (k) { $(k).classList.toggle('hidden', k !== id); });
    closeDlg('win');
  }

  /* ---------- level lifecycle ---------- */
  function clearBoard() { els.forEach(function (el) { el.remove(); }); els.clear(); }
  function clearTimer() { if (timerId) { clearInterval(timerId); timerId = null; } stopAuto(); }

  function openLevel(i) {
    clearTimer();
    var lv = typeof i === 'number' ? LV[i] : i;              // a daily puzzle is passed as its level object
    if (typeof i !== 'number') i = -1;
    else { menuPage = Math.floor(i / PAGE); store.set('hr_page', menuPage); } // back on the menu, land on this level's page
    var target = lv.g.split('').map(Number);
    G = { idx: i, lv: lv, target: target, tpieces: Sol.piecesOf(target), pieces: [], initial: null, dc: {}, trend: null,
          phase: 'setup', sel: null, moves: 0, hints: 0, hist: [], redo: [], t0: 0, elapsed: 0, msg: '', sol: null };
    clearBoard();
    showScreen('game');
    document.body.dataset.phase = 'setup';
    $('lvTitle').textContent = levelTitle(lv, i);
    renderBest();
    $('par').textContent = lv.par; $('moves').textContent = '0'; $('time').textContent = '0:00';
    G.sel = firstAvailable();
    hideTip(); renderAuto();
    if (autoPlace || autoStart || lv.design) placeAll();
    layout(); renderAll(); window.scrollTo(0, 0);
    if (autoStart || lv.design) startPlay();
  }

  // Best result for the open level (fewest moves ever), shown as a 4th stat once the level has been cleared
  function renderBest() {
    var pr = G && progress[G.lv.id];
    $('bestStat').classList.toggle('hidden', !pr);
    if (pr) $('best').textContent = pr.moves;
    renderRecord();
  }
  function recordText(id) {
    var pr = progress[id], parts = [];
    if (pr) parts.push(stars(pr.stars), 'Best ' + pr.moves);
    if (seen[id]) parts.push(L('solution viewed', 'ดูเฉลยแล้ว'));
    return parts.join(' · ');
  }
  // The reset link shows only when there is something to reset: stars/best, or the solution-viewed lock
  function renderRecord() {
    var id = G && G.lv && G.lv.id, can = !!id && id !== 'draft' && !G.lv.daily && G.phase !== 'design' && (progress[id] || seen[id]);
    $('recLine').classList.toggle('hidden', !can);
    if (can) $('recText').textContent = L('Your record: ', 'สถิติของคุณ: ') + recordText(id);
  }
  $('recReset').onclick = function () {
    if (!G) return;
    $('rcBody').innerHTML = L('Current record: <b>' + recordText(G.lv.id) + '</b><br>Stars, best score and the solution mark for this level are cleared, so you can earn 3 stars again.',
      'สถิติปัจจุบัน: <b>' + recordText(G.lv.id) + '</b><br>ดาว สถิติที่ดีที่สุด และเครื่องหมายดูเฉลยของด่านนี้จะถูกลบ เพื่อให้คุณเล่นเอา 3 ดาวได้อีกครั้ง');
    openDlg('rcAsk', '#rcNo');
  };
  $('rcNo').onclick = function () { closeDlg('rcAsk'); };
  $('rcYes').onclick = function () {
    closeDlg('rcAsk'); if (!G) return;
    delete progress[G.lv.id]; delete seen[G.lv.id]; store.set('hr_progress', progress); store.set('hr_seen', seen);
    renderBest(); toast(L('Record cleared — go for 3 stars', 'ลบสถิติแล้ว — ลุ้น 3 ดาวได้เลย'));
  };

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

  function renderAll() { renderLED(); renderPieces(); renderTray(); renderStatus(); renderCtl(); }
  // Undo / Redo are greyed out when there is nothing to step to
  function renderCtl() {
    var on = !!G && G.phase === 'play';
    $('undoBtn').disabled = !on || !G.hist.length; $('redoBtn').disabled = !on || !G.redo.length;
  }

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
      var setup = G.phase === 'setup', v = setup && verified(p);
      el.classList.toggle('ok', setup && v);
      el.classList.toggle('bad', setup && !v);
      el.removeAttribute('data-hint'); el.removeAttribute('data-focus');
    });
    els.forEach(function (el, id) { if (!ids.has(id)) { el.remove(); els.delete(id); } });
  }

  function renderTray() {
    if (G.phase === 'design') { renderDesignTray(); return; }
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
      var tr = G.trend ? trendText(G.trend) : null;
      s.textContent = G.msg || (tr && tr.text) || L('Drag blocks to free the red square — slide it to the exit.', 'ลากบล็อกเพื่อเปิดทางให้สี่เหลี่ยมแดง — เลื่อนไปที่ทางออก');
      if (G.msg) s.classList.add('warn'); else if (tr && tr.cls) s.classList.add(tr.cls);
    } else if (G.phase === 'solution') {
      s.textContent = '';
    } else if (G.phase === 'design') {
      s.classList.toggle('hidden', !G.msg); s.textContent = G.msg || ''; if (G.msg) s.classList.add('warn');
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
    if (G && G.phase === 'design') { designTap(e, this); return; }
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
    setSwitch($('autoPlaceBtn'), autoPlace);
  }
  // Toggle: on = every level opens with the layout already copied; turning it on also fills this board, off clears it for manual placement
  // Same setting from two places: the key on the setup screen and the switch in Settings
  function toggleAutoPlace() {
    autoPlace = !autoPlace; store.set('hr_auto', autoPlace); renderAuto();
    if (!G || G.phase !== 'setup') return;
    if (autoPlace) placeAll(); else { G.pieces = []; G.sel = firstAvailable(); }
    renderAll();
  }
  $('autoBtn').onclick = function () { if (G && G.phase === 'setup') toggleAutoPlace(); };
  $('clearBtn').onclick = function () {
    if (G && G.phase === 'design') { G.pieces = []; G.sel = 'R'; designChanged(); return; }
    G.pieces = []; G.sel = firstAvailable(); renderAll();
  };
  $('startBtn').onclick = function () { if (!$('startBtn').disabled) startPlay(); };

  function startPlay() {
    G.phase = 'play'; document.body.dataset.phase = 'play';
    G.initial = snap(); G.moves = 0; G.hints = 0; G.hist = []; G.redo = []; G.msg = ''; G.trend = null; hideTip();
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

  /* ---------- on-track feedback: after you have asked for a hint, each move says if it got you closer ---------- */
  function trendText(t) {
    var n = t.n, many = n === 1 ? '' : 's';
    if (t.kind === 'closer') return { cls: 'good', text: L('✓ Closer — ' + n + ' move' + many + ' to go', '✓ ใกล้ขึ้นแล้ว — เหลืออีก ' + n + ' ครั้ง') };
    if (t.kind === 'same') return { cls: '', text: L('↔ No progress — still ' + n + ' to go', '↔ ไม่คืบหน้า — ยังเหลืออีก ' + n + ' ครั้ง') };
    if (t.kind === 'further') return { cls: 'warn', text: L('✗ Further away — now ' + n + ' to go. Undo may help', '✗ ไกลขึ้น — ตอนนี้เหลืออีก ' + n + ' ครั้ง ลองกด Undo') };
    return { cls: '', text: L(n + ' move' + many + ' to go', 'เหลืออีก ' + n + ' ครั้ง') };
  }
  // Runs just after the move so the slide animation is not held up by the search.
  function updateTrend(before, undone) {
    var g0 = G, mv = G.moves;
    if (!G.hints) return;
    setTimeout(function () {
      if (G !== g0 || G.phase !== 'play' || G.moves !== mv) return;
      var now = distOf(gridOf()); if (now === null) return;
      if (undone) G.trend = { kind: 'now', n: now };
      else {
        var was = distOf(before);
        G.trend = { kind: was === null || now === was ? 'same' : now < was ? 'closer' : 'further', n: now };
      }
      renderStatus();
    }, 30);
  }

  function commitMove(p, dr, dc, k) {
    var before = gridOf();
    G.hist.push(snap()); G.redo = []; hideTip(); G.trend = null;
    p.r += dr * k; p.c += dc * k; G.moves++;
    $('moves').textContent = G.moves;
    renderPieces(); renderLED(); renderStatus(); renderCtl(); beep(500, 0.04); buzz(15);
    if (Sol.isGoal(gridOf())) win(); else updateTrend(before, false);
  }

  $('undoBtn').onclick = function () {
    if (!G || G.phase !== 'play' || !G.hist.length) return;
    hideTip(); G.trend = null; G.redo.push(snap()); G.pieces = G.hist.pop(); G.moves = Math.max(0, G.moves - 1);
    $('moves').textContent = G.moves; renderPieces(); renderLED(); renderStatus(); renderCtl(); updateTrend(null, true);
  };
  $('redoBtn').onclick = function () {
    if (!G || G.phase !== 'play' || !G.redo.length) return;
    var before = gridOf();
    hideTip(); G.trend = null; G.hist.push(snap()); G.pieces = G.redo.pop(); G.moves++;
    $('moves').textContent = G.moves; renderPieces(); renderLED(); renderStatus(); renderCtl(); beep(500, 0.04); buzz(15);
    if (Sol.isGoal(gridOf())) win(); else updateTrend(before, false);
  };
  function doRestart() {
    if (!G || !G.initial) return;
    G.pieces = G.initial.map(function (p) { return { id: p.id, t: p.t, r: p.r, c: p.c }; });
    hideTip(); G.trend = null; G.moves = 0; G.hist = []; G.redo = []; G.phase = 'play'; document.body.dataset.phase = 'play';
    G.t0 = Date.now(); $('moves').textContent = '0'; $('time').textContent = '0:00';
    clearTimer(); timerId = setInterval(tick, 250);
    clearBoard(); renderAll();
  }
  // Restart wipes the attempt, so ask first; nothing to lose (no moves yet) restarts straight away.
  $('restartBtn').onclick = function () {
    if (!G || G.phase !== 'play') return;
    if (!G.moves) return doRestart();
    $('rsBody').textContent = L('Your ' + G.moves + ' move' + (G.moves > 1 ? 's' : '') + ' and the clock will be reset.', 'ทั้ง ' + G.moves + ' ครั้งที่เดินและเวลาจะถูกรีเซ็ต');
    openDlg('rsAsk', '#rsNo');
  };
  $('rsNo').onclick = function () { closeDlg('rsAsk'); };
  $('rsYes').onclick = function () { closeDlg('rsAsk'); doRestart(); };
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
  // Distance (moves to go) of any position, cached per level. A solve also tells us the distance of every position along
  // its line, so following the hints keeps hitting the cache.
  function seedDist(g, sol) {
    var cur = g, n = sol.length; G.dc[Sol.key(g)] = n;
    for (var i = 0; i < sol.length; i++) { cur = slideBy(cur, sol[i]); G.dc[Sol.key(cur)] = n - i - 1; }
  }
  function distOf(g) {
    var d = G.dc[Sol.key(g)]; if (d !== undefined) return d;
    var sol = Sol.solve(g); if (!sol) return null;
    seedDist(g, sol); return sol.length;
  }
  function pieceAt(m) { return G.pieces.filter(function (x) { return x.t === m.t && x.r === m.r && x.c === m.c; })[0]; }

  // Cells a block slides across/into (not the ones it already covers) and how many of them are empty in grid g.
  function sweptCells(m) {
    var own = {}, out = {};
    cellsOf(m.t, m.r, m.c).forEach(function (c) { own[c] = 1; });
    for (var s = 1; s <= m.k; s++) cellsOf(m.t, m.r + m.dr * s, m.c + m.dc * s).forEach(function (c) { if (!own[c]) out[c] = 1; });
    return Object.keys(out).map(Number);
  }
  function freeCount(g, cells) { return cells.filter(function (c) { return g[c] === 0; }).length; }
  function slideBy(g, m) { return Sol.slide(g, { t: m.t, r: m.r, c: m.c }, m.dr, m.dc, m.k); }

  // Study the optimal line: which block stands in red's way, which one does the line free first, what space that needs,
  // and how the very next move helps with it. The hint text is built from these facts at display time (so the language
  // toggle applies).
  function analyze(g, sol) {
    var j = -1, i, k;
    for (i = 0; i < sol.length; i++) if (sol[i].t === 'R') { j = i; break; }
    var info = { j: j, first: sol[0], mover: pieceAt(sol[0]), red: j >= 0 ? sol[j] : null, blockers: [], left: sol.length,
                 X: null, b: -1, xmove: null, need: 0, free0: 0, free1: 0, onNeeded: false, opens: null };
    if (j > 0) {
      var rm = sol[j], path = {};
      for (var s = 1; s <= rm.k; s++) cellsOf('R', rm.r + rm.dr * s, rm.c + rm.dc * s).forEach(function (c) { path[c] = 1; });
      G.pieces.forEach(function (p) {
        if (p.t !== 'R' && cellsOf(p.t, p.r, p.c).some(function (c) { return path[c]; })) info.blockers.push(p);
      });
      // the blocker the line frees first (a block keeps its square until its own first move, so matching by position is exact)
      for (i = 0; i < sol.length && !info.X; i++)
        for (k = 0; k < info.blockers.length; k++) {
          var q = info.blockers[k];
          if (sol[i].t === q.t && sol[i].r === q.r && sol[i].c === q.c) { info.X = q; info.b = i; info.xmove = sol[i]; break; }
        }
      if (info.X) {
        var need = sweptCells(info.xmove), g1 = slideBy(g, sol[0]);
        info.need = need.length; info.free0 = freeCount(g, need); info.free1 = freeCount(g1, need);
        if (info.mover) info.onNeeded = cellsOf(info.mover.t, info.mover.r, info.mover.c).some(function (c) { return need.indexOf(c) >= 0; });
      }
    }
    // does the first move vacate space that the second move slides into?
    if (sol.length > 1 && info.mover) {
      var after = {}, vac = [];
      cellsOf(sol[0].t, sol[0].r + sol[0].dr * sol[0].k, sol[0].c + sol[0].dc * sol[0].k).forEach(function (c) { after[c] = 1; });
      cellsOf(sol[0].t, sol[0].r, sol[0].c).forEach(function (c) { if (!after[c]) vac.push(c); });
      var nq = pieceAt(sol[1]);
      if (nq && nq !== info.mover && sweptCells(sol[1]).some(function (c) { return vac.indexOf(c) >= 0; })) info.opens = nq;
    }
    return info;
  }

  function plural(n, en) { return n + ' ' + en + (n === 1 ? '' : 's'); }

  function hintText(h) {
    var i = h.info, m = i.first, mv = i.mover, step = ' ' + dirWord(m) + cellsWord(m.k), X = i.X;
    var plan = i.j === 0 ? L('Plan: red can move right now — ' + plural(i.left, 'move') + ' to go in total.', 'แผน: ตัวแดงเดินได้ทันที — เหลืออีก ' + i.left + ' ครั้ง')
      : L('Plan: ' + (i.b > 0 ? plural(i.b, 'move') + ' to make room, then free it; ' : 'free it; ') + 'red can move after ' + plural(i.j, 'move') + ' — ' + i.left + ' to go in total.',
          'แผน: ' + (i.b > 0 ? 'เดิน ' + i.b + ' ครั้งเพื่อเปิดที่ว่าง แล้วปลดบล็อก ' : 'ปลดบล็อก ') + 'ตัวแดงจะเดินได้หลังเดิน ' + i.j + ' ครั้ง — รวมเหลืออีก ' + i.left + ' ครั้ง');
    if (h.tier === 1) {
      if (i.j === 0) {
        return { head: L('Red is free to move', 'สีแดงเคลื่อนที่ได้เลย'),
          body: L('Nothing is in the way of the red square right now. ', 'ตอนนี้ไม่มีอะไรขวางสี่เหลี่ยมแดงอยู่ ') +
            (i.red.dr > 0 ? L('Slide it down toward the exit.', 'เลื่อนลงไปทางทางออกได้เลย')
            : i.red.dr < 0 ? L('Back it up — red sometimes has to retreat so other blocks can swing around.', 'ถอยขึ้นไปก่อน — บางครั้งตัวแดงต้องถอยเพื่อให้บล็อกอื่นหมุนผ่านได้')
            : L('Shift it sideways — the exit is under columns 2–3, so red has to line up there before it drops.', 'เลื่อนไปด้านข้าง — ทางออกอยู่ใต้คอลัมน์ 2–3 ตัวแดงต้องมาอยู่ตรงนั้นก่อนจึงจะหล่นลงได้')), why: plan };
      }
      if (!X) {
        return { head: L('Make room first', 'เปิดที่ว่างก่อน'),
          body: L('Red can’t move yet, but ' + plural(i.j, 'prep move') + ' will open its path.', 'ตัวแดงยังเดินไม่ได้ แต่เดินเตรียมอีก ' + i.j + ' ครั้งก็จะเปิดทางให้'), why: plan };
      }
      var many = i.blockers.length > 1, xs = ' ' + dirWord(i.xmove) + cellsWord(i.xmove.k), nm = nameOf(X);
      var blocked = L('Red can’t slide ' + dirWord(i.red) + ' while ' + listOf(i.blockers) + (many ? ' are' : ' is') + ' in the way.',
                      'ตัวแดงเลื่อน' + dirWord(i.red) + 'ไม่ได้ เพราะมี ' + listOf(i.blockers) + ' ขวางอยู่');
      var todo = i.b === 0
        ? L(' Slide ' + nm + xs + ' to clear the way.', ' เลื่อน' + nm + xs + ' เพื่อเปิดทาง')
        : L(' Start with ' + nm + ': it has to slide' + xs + ', but ' + (i.free0 === 0
              ? (i.need === 1 ? 'the cell it needs is taken' : 'none of the ' + i.need + ' cells it needs are empty')
              : 'only ' + i.free0 + ' of the ' + i.need + ' cells it needs ' + (i.free0 === 1 ? 'is' : 'are') + ' empty') +
            '. Opening that space takes ' + plural(i.b, 'move') + '.',
            ' เริ่มที่' + nm + ': ต้องเลื่อน' + xs + ' แต่ตอนนี้' + (i.free0 === 0 ? 'ช่องที่ต้องใช้ยังไม่ว่างเลย' : 'ช่องที่ต้องใช้ว่างเพียง ' + i.free0 + ' จาก ' + i.need + ' ช่อง') + ' การเปิดที่ว่างนั้นใช้ ' + i.b + ' ครั้ง');
      return { head: L('Next goal: free ' + nm, 'เป้าหมายถัดไป: ปลด' + nm), body: blocked + todo, why: plan };
    }
    var reason;
    if (i.j === 0) reason = L('This is red’s own move.', 'นี่คือการเดินของตัวแดงเอง');
    else if (X && mv === X) reason = L('This is the block standing in red’s way.', 'บล็อกนี้คือตัวที่ขวางทางตัวแดงอยู่');
    else if (X && i.onNeeded) reason = L('It is sitting on a space ' + nameOf(X) + ' needs.', 'บล็อกนี้ยืนอยู่บนช่องที่' + nameOf(X) + ' ต้องใช้');
    else if (X && i.free1 > i.free0) reason = L('It moves the empty space next to ' + nameOf(X) + ' — then ' + i.free1 + ' of the ' + plural(i.need, 'cell') + ' it needs ' + (i.free1 === 1 ? 'is' : 'are') + ' empty.',
      'ทำให้ช่องว่างเลื่อนเข้าไปใกล้' + nameOf(X) + ' — หลังเดินช่องที่ต้องใช้จะว่าง ' + i.free1 + ' จาก ' + i.need + ' ช่อง');
    else if (i.opens) reason = L('It empties the space ' + nameOf(i.opens) + ' slides into next' + (X ? ' — a step toward freeing ' + nameOf(X) + '.' : '.'),
      'ทำให้ช่องที่' + nameOf(i.opens) + ' จะเลื่อนเข้าไปต่อไปว่างลง' + (X ? ' — เป็นขั้นหนึ่งในการปลด' + nameOf(X) : ''));
    else reason = X ? L('It is a set-up move: it shuffles the empty spaces so ' + nameOf(X) + ' can be freed ' + plural(i.b, 'move') + ' from now.',
      'นี่คือการเดินเตรียมการ: จัดช่องว่างใหม่เพื่อให้ปลด' + nameOf(X) + ' ได้ในอีก ' + i.b + ' ครั้ง')
      : L('It is a set-up move that makes room around red.', 'นี่คือการเดินเตรียมการ เพื่อเปิดที่ว่างรอบตัวแดง');
    return { head: L('Try this', 'ลองทำแบบนี้'), body: L('Move ' + nameOf(m) + step + '. ' + reason, 'เลื่อน' + nameOf(m) + step + ' ' + reason), why: plan };
  }

  function showHint(h) {
    var t = hintText(h), i = h.info;
    els.forEach(function (el) { el.removeAttribute('data-focus'); el.removeAttribute('data-hint'); });
    var focus = i.j === 0 ? [i.mover] : i.X ? [i.X] : i.blockers.length ? i.blockers : [i.mover];
    focus.forEach(function (p) { if (p && els.get(p.id)) els.get(p.id).setAttribute('data-focus', ''); });
    if (h.tier === 2 && i.mover && els.get(i.mover.id)) {
      var m = i.first, arrow = m.dr < 0 ? '↑' : m.dr > 0 ? '↓' : m.dc < 0 ? '←' : '→';
      els.get(i.mover.id).setAttribute('data-hint', arrow + (m.k > 1 ? m.k : ''));
    }
    $('tipHead').innerHTML = '<span class="step">' + L(i.left + ' move' + (i.left > 1 ? 's' : '') + ' to go · hint ' + h.tier + '/2', 'เหลืออีก ' + i.left + ' ครั้ง · คำใบ้ ' + h.tier + '/2') + '</span>' + t.head;
    $('tipBody').textContent = t.body; $('tipWhy').textContent = t.why;
    $('tip').classList.remove('hidden');
    try { $('tip').scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) {}
  }
  function hideTip() { if (G) G.hint = null; $('tip').classList.add('hidden'); }

  // Tap 1 explains the situation and outlines the block(s) to focus on; tap 2 shows the exact move.
  $('hintBtn').onclick = function () {
    if (!G || G.phase !== 'play') return;
    var g = gridOf(), k = Sol.key(g);
    if (!G.hint || G.hint.key !== k) {
      var sol = Sol.solve(g);
      if (!sol || !sol.length) { G.msg = L('No solution from here — try Undo', 'จากตำแหน่งนี้ไม่มีทางไข — ลองกด Undo'); renderStatus(); return; }
      seedDist(g, sol); G.hint = { key: k, info: analyze(g, sol), tier: 0 };
    }
    G.hint.tier = Math.min(2, G.hint.tier + 1); G.hints++;
    showHint(G.hint);
  };


  /* ---------- solution viewer: step through the optimal line from the start position ---------- */
  function stopAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } }

  function askSolution() {
    if (!G || G.phase !== 'play') return;
    if (seen[G.lv.id]) openSolution(); else openDlg('solAsk', '#solNo');
  }
  $('solBtn').onclick = askSolution;
  $('solNo').onclick = function () { closeDlg('solAsk'); };
  $('solYes').onclick = function () { closeDlg('solAsk'); openSolution(); };

  function openSolution() {
    if (!G || G.phase !== 'play') return;
    var steps = Sol.solve(Sol.fromPieces(G.initial));
    if (!steps) { say(L('No solution found for this layout', 'ไม่พบเฉลยสำหรับรูปแบบนี้')); return; }
    if (G.lv.id !== 'draft') { seen[G.lv.id] = 1; store.set('hr_seen', seen); renderRecord(); }
    // freeze the player's attempt, show the start position again and walk it from there
    G.sol = { steps: steps, i: 0, stash: { pieces: snap(), hist: G.hist, redo: G.redo, moves: G.moves }, pausedAt: Date.now() };
    clearTimer(); hideTip();
    G.pieces = G.initial.map(function (p) { return { id: p.id, t: p.t, r: p.r, c: p.c }; });
    G.phase = 'solution'; document.body.dataset.phase = 'solution';
    clearBoard(); renderAll(); renderSol();
    try { $('solHead').scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) {}
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
    G.pieces = S.stash.pieces; G.hist = S.stash.hist; G.redo = S.stash.redo; G.moves = S.stash.moves;
    G.t0 += Date.now() - S.pausedAt; // the clock did not run while the solution was open
    G.phase = 'play'; document.body.dataset.phase = 'play';
    clearTimer(); timerId = setInterval(tick, 250);
    clearBoard(); renderAll();
  };

  /* ---------- win ---------- */
  function win() {
    G.phase = 'won'; document.body.dataset.phase = 'won'; clearTimer(); renderCtl();
    G.elapsed = Date.now() - G.t0;
    var par = G.lv.par, st = seen[G.lv.id] ? 0 : G.moves <= par ? 3 : G.moves <= Math.ceil(par * 1.4) ? 2 : 1;
    var prev = progress[G.lv.id], rec = G.lv.id !== 'draft';
    var cur = {
      stars: Math.max(st, prev ? prev.stars : 0),
      moves: Math.min(G.moves, prev ? prev.moves : 1e9),
      time: Math.min(G.elapsed, prev ? prev.time : 1e12)
    };
    if (rec) { progress[G.lv.id] = cur; store.set('hr_progress', progress); keepStorage(); }
    var red = G.pieces.filter(function (p) { return p.t === 'R'; })[0], el = els.get(red.id);
    setTimeout(function () {
      el.style.transform = 'translate(' + (PAD + red.c * cell + GAP) + 'px,' + (PAD + (red.r + 2) * cell + GAP) + 'px)';
      el.style.opacity = '0';
      beep(784, 0.12); setTimeout(function () { beep(988, 0.18); }, 130);
    }, 250);
    setTimeout(function () {
      $('winStars').textContent = stars(st);
      var best = cur, bestLine = '';
      if (prev && G.moves < prev.moves) bestLine = L('New best! ', 'สถิติใหม่! ') + L('(was ' + prev.moves + ')', '(เดิม ' + prev.moves + ')');
      else if (prev) bestLine = 'Best <b>' + best.moves + '</b>' + (timerOn ? ' · ' + fmt(best.time) : '');
      $('winInfo').innerHTML = 'Moves <b>' + G.moves + '</b> (par ' + par + ')' + (timerOn ? ' · Time <b>' + fmt(G.elapsed) + '</b>' : '') +
        (G.hints ? ' · ' + L('Hints ', 'คำใบ้ ') + G.hints : '') + (bestLine ? '<span class="best">' + bestLine + '</span>' : '') +
        (seen[G.lv.id] ? '<br>' + L('Solution viewed — no stars for this level', 'ดูเฉลยแล้ว — ด่านนี้ไม่ได้ดาว') : '');
      renderBest();
      var daily = !!G.lv.daily, hasNext = G.idx >= 0 && G.idx + 1 < LV.length;
      $('menuBtn').textContent = G.lv.fromList ? L('My stages', 'ด่านของฉัน') : G.lv.design ? L('Edit', 'แก้ไข') : L('Levels', 'ด่าน');
      $('winTitle').textContent = daily ? L('Daily solved!', 'ผ่านปริศนารายวัน!') : L('Cleared!', 'ผ่านด่าน!');
      $('dWin').classList.toggle('hidden', !daily);
      if (daily) {
        var n = streak();
        $('dWinStreak').innerHTML = '🔥 ' + L('<b>' + n + '</b>-day streak', 'ต่อเนื่อง <b>' + n + '</b> วัน');
        renderWeek($('dWinWeek')); $('dNext').innerHTML = untilTomorrow();
      }
      $('nextBtn').classList.toggle('hidden', !hasNext);
      openDlg('win', hasNext ? '#nextBtn' : '#menuBtn');
    }, 950);
  }
  $('nextBtn').onclick = function () { openLevel(G.idx + 1); };
  $('replayBtn').onclick = function () { closeDlg('win'); doRestart(); };
  // From a design's test play (or its win card) go back to the editor with that layout; otherwise to the menu
  function leave() {
    if (G && G.lv && G.lv.fromList) showStages();
    else if (G && G.lv && G.lv.design) openDesign(G.lv.n || G.lv.edit || null, G.initial);
    else showMenu();
  }
  $('menuBtn').onclick = leave;
  $('backBtn').onclick = function () { if (G && G.phase === 'design') showStages(); else leave(); };
  // Sound and vibration are switches in the Settings panel (aria-pressed = on)
  function setSwitch(btn, on, icon) {
    btn.setAttribute('aria-pressed', on); btn.setAttribute('aria-checked', on);
    if (icon) btn.querySelector('use').setAttribute('href', '#i-' + icon);
    renderSwitchText(btn);
  }
  // Every switch spells out its state next to the pill: On / Off (Thai: เปิด / ปิด)
  function renderSwitchText(btn) {
    var t = btn.querySelector('.st'); if (!t) return;
    var on = btn.getAttribute('aria-pressed') === 'true';
    t.textContent = on ? L('On', 'เปิด') : L('Off', 'ปิด'); t.classList.toggle('on', on);
  }
  $('autoPlaceBtn').onclick = toggleAutoPlace;
  function renderMotion() { setSwitch($('motionBtn'), reduced()); }
  $('motionBtn').onclick = function () { motionPref = !reduced(); store.set('hr_motion', motionPref); applyMotion(); renderMotion(); };
  function renderSound() { setSwitch($('muteBtn'), !muted, muted ? 'volx' : 'vol'); }
  $('muteBtn').onclick = function () { muted = !muted; store.set('hr_muted', muted); renderSound(); beep(660, 0.08); };
  renderSound();

  // Vibration toggle (Android Chrome only: iOS Safari has no Vibration API, so the row is hidden there)
  function renderHaptics() { setSwitch($('hapBtn'), haptics); }
  if (!navigator.vibrate) $('hapBtn').style.display = 'none';
  $('hapBtn').onclick = function () { haptics = !haptics; store.set('hr_haptics', haptics); renderHaptics(); buzz(30); };
  renderHaptics();

  // Auto-start switch: opening a level places the blocks for you and starts right away (no chips, no Start button)
  function renderAutoStart() { setSwitch($('autoStartBtn'), autoStart); }
  $('autoStartBtn').onclick = function () { autoStart = !autoStart; store.set('hr_autostart', autoStart); renderAutoStart(); };
  renderAutoStart();

  // Timer switch: off hides the clock (no-stress mode); the time keeps counting quietly so turning it back on is correct
  function renderTimer() { setSwitch($('timerBtn'), timerOn); document.body.classList.toggle('notimer', !timerOn); }
  $('timerBtn').onclick = function () { timerOn = !timerOn; store.set('hr_timer', timerOn); renderTimer(); };
  renderTimer();
  renderAuto();
  renderMotion();

  // "How to play" folds away for players who know the game; the choice is remembered (open on first launch)
  var howOpen = store.get('hr_howto', true);
  function renderHow() { $('howto').classList.toggle('closed', !howOpen); $('howToggle').setAttribute('aria-expanded', howOpen); }
  $('howToggle').onclick = function () { howOpen = !howOpen; store.set('hr_howto', howOpen); renderHow(); };
  renderHow();

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
    if (on) { setAboutPage(0); openDlg('about'); } else closeDlg('about');
  }
  $('aboutBtn').onclick = function () { showAbout(true); };
  $('aboutClose').onclick = function () { showAbout(false); };
  $('about').addEventListener('click', function (e) { if (e.target === this) showAbout(false); });

  /* ---------- language: instructions, hints and solution in English or Thai ---------- */
  // Static text carries its Thai copy in data-th; the English original is stashed in data-en on first switch.
  function applyLang() {
    document.documentElement.lang = lang;
    Array.prototype.forEach.call(document.querySelectorAll('[data-th]'), function (el) {
      if (el.dataset.en === undefined) el.dataset.en = el.innerHTML;
      el.innerHTML = lang === 'th' ? el.dataset.th : el.dataset.en;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.lang-btn'), function (b) {
      b.setAttribute('aria-pressed', lang === 'th');
      b.setAttribute('aria-label', lang === 'th' ? 'ภาษา: ไทย (แตะเพื่อเปลี่ยนเป็น English)' : 'Language: English (tap for Thai)');
    });
    renderMenu(); renderDaily(); renderBkRow(); renderBkLast(); renderNudge(); if (!$('stages').classList.contains('hidden')) renderStages();
    Array.prototype.forEach.call(document.querySelectorAll('.setrow[role=switch]'), renderSwitchText);
    if (!G) return;
    if (G.phase === 'design') { $('lvTitle').textContent = G.editing ? L('Edit stage ', 'แก้ไขด่าน ') + G.editing : L('Design stage', 'ออกแบบด่าน'); renderAll(); designCheck(); renderStages(); return; }
    $('lvTitle').textContent = levelTitle(G.lv, G.idx);
    if (G.msg) G.msg = '';
    renderStatus();
    if (G.phase === 'play' && G.hint && !$('tip').classList.contains('hidden')) showHint(G.hint);
    if (G.phase === 'solution' && G.sol) renderSol();
  }
  Array.prototype.forEach.call(document.querySelectorAll('.lang-btn'), function (b) {
    b.onclick = function () {
      lang = lang === 'th' ? 'en' : 'th'; store.set('hr_lang', lang); applyLang();
      if ($('about').classList.contains('hidden') && $('settings').classList.contains('hidden')) toast(lang === 'th' ? 'คำแนะนำ คำใบ้ เฉลย: ภาษาไทย' : 'Instructions, hints, solution: English');
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
  function renderSkinOpts() {
    Array.prototype.forEach.call($('skopts').children, function (b) {
      var on = b.dataset.sk === skin; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
  }
  SKINS.forEach(function (sk) {
    var b = document.createElement('button'); b.className = 'skopt'; b.dataset.sk = sk.id;
    b.innerHTML = '<span class="skprev" data-skin="' + sk.id + '"><i class="r"></i><i class="v"></i><i class="s"></i><i class="a"></i></span><span>' + sk.name + '</span>';
    b.setAttribute('aria-label', 'Skin: ' + sk.name);
    b.onclick = function () { skin = sk.id; store.set('hr_skin', skin); applySkin(); renderSkinOpts(); };
    $('skopts').appendChild(b);
  });
  renderSkinOpts();

  /* ---------- progress backup: a code or a small file, works offline; restoring merges and never loses anything ---------- */
  function backupCode() {
    var data = { v: 1, at: new Date().toISOString().slice(0, 10), progress: progress, seen: seen, designs: designs };
    return 'HR1.' + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  }
  function readBackup(text) {
    text = String(text || '').trim();
    var json = text.indexOf('HR1.') === 0 ? decodeURIComponent(escape(atob(text.slice(4).replace(/\s+/g, '')))) : text;
    var d = JSON.parse(json);
    if (!d || typeof d.progress !== 'object') throw new Error('bad');
    return d;
  }
  function bkSay(msg, err) { var m = $('bkMsg'); m.textContent = msg; m.classList.toggle('err', !!err); }
  function restoreFrom(text) {
    var d;
    try { d = readBackup(text); } catch (e) { bkSay(L('That is not a valid backup code.', 'รหัสสำรองไม่ถูกต้อง'), true); return; }
    (d.designs || []).forEach(function (x) {
      if (!x || typeof x.g !== 'string' || designs.some(function (y) { return y.g === x.g; }) || designs.length >= MAX_STAGES) return;
      var n = x.n;
      if (designs.some(function (y) { return y.n === n; })) { // number taken: give it a new one and move its record along
        var nn = designs.reduce(function (m, y) { return Math.max(m, y.n); }, 0) + 1;
        if (d.progress['s' + n]) { d.progress['s' + nn] = d.progress['s' + n]; delete d.progress['s' + n]; }
        n = nn;
      }
      designs.push({ n: n, g: x.g, par: x.par, at: x.at || Date.now() });
    });
    saveDesigns();
    var levels = 0;
    Object.keys(d.progress).forEach(function (id) {
      var a = d.progress[id], b = progress[id];
      if (!a || typeof a.stars !== 'number') return;
      levels++;
      progress[id] = b ? { stars: Math.max(a.stars, b.stars), moves: Math.min(a.moves, b.moves), time: Math.min(a.time, b.time) } : a;
    });
    Object.keys(d.seen || {}).forEach(function (id) { seen[id] = 1; });
    store.set('hr_progress', progress); store.set('hr_seen', seen);
    renderMenu(); renderNudge(); $('bkOut').value = backupCode(); $('bkIn').value = '';
    var total = Object.keys(progress).reduce(function (t, id) { return t + progress[id].stars; }, 0);
    bkSay(L('Restored ' + levels + ' levels · you now have ' + total + ' stars', 'กู้คืนแล้ว ' + levels + ' ด่าน · ตอนนี้มี ' + total + ' ดาว'));
  }
  $('backupBtn').onclick = function () {
    showSettings(false); $('bkOut').value = backupCode(); $('bkIn').value = ''; bkSay(''); renderBkLast();
    openDlg('backup');
  };
  $('bkClose').onclick = function () { closeDlg('backup'); };
  $('backup').addEventListener('click', function (e) { if (e.target === this) closeDlg('backup'); });
  $('bkCopy').onclick = function () {
    var t = $('bkOut'), ok = function () { bkSay(L('Code copied', 'คัดลอกรหัสแล้ว')); markBacked(); };
    t.select();
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t.value).then(ok, function () { try { document.execCommand('copy'); ok(); } catch (e) {} });
    else { try { document.execCommand('copy'); ok(); } catch (e) { bkSay(L('Select the code and copy it', 'เลือกรหัสแล้วคัดลอก'), true); } }
  };
  $('bkSave').onclick = function () {
    var a = document.createElement('a'), url = URL.createObjectURL(new Blob([$('bkOut').value], { type: 'text/plain' }));
    a.href = url; a.download = 'huarong-road-backup-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    bkSay(L('Backup file saved', 'บันทึกไฟล์สำรองแล้ว')); markBacked();
  };
  $('bkOpen').onclick = function () { $('bkFile').value = ''; $('bkFile').click(); };
  $('bkFile').onchange = function () {
    var f = this.files && this.files[0]; if (!f) return;
    var r = new FileReader(); r.onload = function () { restoreFrom(r.result); }; r.readAsText(f);
  };
  $('bkRestore').onclick = function () { restoreFrom($('bkIn').value); };

  /* ---------- backup safety net: keep storage, share sheet, and a gentle reminder ---------- */
  // 1. Ask the browser not to clear our data when the phone runs low on space (installed apps are usually granted this silently)
  var kept = false;
  function keepStorage() {
    if (kept || !(navigator.storage && navigator.storage.persist)) return;
    try { navigator.storage.persist().then(function (ok) { kept = !!ok; }, function () {}); } catch (e) {}
  }
  // 2. Share sheet: sends the backup file to Drive, Gmail, LINE... (hidden where the browser has no share sheet)
  if (!navigator.share) $('bkShareRow').style.display = 'none';
  $('bkShare').onclick = function () {
    var text = $('bkOut').value, name = 'huarong-road-backup-' + new Date().toISOString().slice(0, 10) + '.txt', job;
    try {
      var file = new File([text], name, { type: 'text/plain' });
      job = navigator.canShare && navigator.canShare({ files: [file] })
        ? navigator.share({ files: [file], title: 'Huarong Road backup' })
        : navigator.share({ title: 'Huarong Road backup', text: text });
    } catch (e) { job = Promise.reject(e); }
    job.then(function () { bkSay(L('Backup shared', 'แชร์ไฟล์สำรองแล้ว')); markBacked(); }, function (e) {
      if (e && e.name === 'AbortError') return; // the player closed the sheet: not an error, not a backup
      bkSay(L('Could not share. Use Copy code or Save file.', 'แชร์ไม่ได้ ใช้ “คัดลอกรหัส” หรือ “บันทึกเป็นไฟล์” แทน'), true);
    });
  };
  // 3. Reminder: a banner on the menu, only when something new is worth saving and the period has passed
  var DAY = 864e5, PERIOD = { weekly: 7 * DAY, monthly: 30 * DAY };
  function totalStars() { return Object.keys(progress).reduce(function (t, id) { return t + (progress[id] && progress[id].stars || 0); }, 0); }
  function saveBk() { store.set('hr_bk', bk); }
  function markBacked() {
    bk.at = Date.now(); bk.stars = totalStars(); bk.ds = designs.map(function (d) { return d.g; }); bk.streak = streak(); bk.snooze = 0;
    saveBk(); renderBkLast(); renderBkRow(); renderNudge();
  }
  function agoText(ts) {
    var d = Math.max(0, Math.floor((Date.now() - ts) / DAY));
    if (d === 0) return L('today', 'วันนี้');
    if (d === 1) return L('yesterday', 'เมื่อวาน');
    if (d < 45) return L(d + ' days ago', d + ' วันที่แล้ว');
    var m = Math.round(d / 30); return L(m + ' months ago', m + ' เดือนที่แล้ว');
  }
  function renderBkLast() {
    $('bkLast').textContent = bk.at ? L('Last backed up: ', 'สำรองล่าสุด: ') + agoText(bk.at) : L('Not backed up yet', 'ยังไม่เคยสำรอง');
  }
  var FREQ_NAME = { weekly: ['Weekly', 'ทุกสัปดาห์'], monthly: ['Monthly', 'ทุกเดือน'], off: ['Off', 'ปิด'] };
  function renderBkRow() {
    $('bkFreqVal').textContent = L(FREQ_NAME[bkFreq][0], FREQ_NAME[bkFreq][1]);
    $('bkFreqSub').textContent = bk.at ? L('Last backup ', 'สำรองล่าสุด ') + agoText(bk.at) : L('Not backed up yet', 'ยังไม่เคยสำรอง');
    $('bkFreqBtn').setAttribute('aria-label', L('Backup reminder: ', 'เตือนให้สำรอง: ') + L(FREQ_NAME[bkFreq][0], FREQ_NAME[bkFreq][1]) + L('. Tap to change.', ' แตะเพื่อเปลี่ยน'));
  }
  $('bkFreqBtn').onclick = function () {
    bkFreq = bkFreq === 'weekly' ? 'monthly' : bkFreq === 'monthly' ? 'off' : 'weekly';
    store.set('hr_bkfreq', bkFreq); bk.snooze = Date.now(); saveBk(); renderBkRow(); renderNudge();
  };
  // What is new since the last backup (null = nothing worth a nudge)
  function bkNews() {
    var stars = totalStars();
    if (stars < bk.stars) { bk.stars = stars; saveBk(); } // records were reset: count from the lower level
    var ns = stars - bk.stars, nd = designs.filter(function (d) { return (bk.ds || []).indexOf(d.g) < 0; }).length, sk = streak();
    var streakNew = sk >= 7 && sk > (bk.streak || 0);
    if (ns < 5 && nd < 1 && !streakNew) return null;
    var parts = [];
    if (ns > 0) parts.push(L(ns + (ns === 1 ? ' star' : ' stars'), ns + ' ดาว'));
    if (nd > 0) parts.push(L(nd + (nd === 1 ? ' stage' : ' stages'), nd + ' ด่านออกแบบ'));
    if (streakNew) parts.push(L(sk + '-day streak', 'ต่อเนื่อง ' + sk + ' วัน'));
    return parts.join(', ');
  }
  function nudgeDue() {
    if (bkFreq === 'off') return null;
    var ref = Math.max(bk.at || 0, bk.snooze || 0, bk.since || 0);
    if (Date.now() - ref < PERIOD[bkFreq]) return null;
    return bkNews();
  }
  function renderNudge() {
    var what = nudgeDue(), box = $('bkNudge');
    if (!what) { box.classList.add('hidden'); return; }
    $('bkNudgeTxt').textContent = bk.at ? L('New since your last backup: ', 'ใหม่หลังการสำรองครั้งล่าสุด: ') + what : L('Only on this phone: ', 'มีเฉพาะในเครื่องนี้: ') + what;
    box.classList.remove('hidden');
  }
  $('bkNudgeGo').onclick = function () { $('backupBtn').onclick(); };
  $('bkNudgeLater').onclick = function () { bk.snooze = Date.now(); saveBk(); renderNudge(); };
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !$('menu').classList.contains('hidden')) renderNudge(); });
  keepStorage();

  /* ---------- reset all progress: Settings -> bottom row -> dialog that needs a tick before it works ---------- */
  $('resetAllBtn').onclick = function () {
    showSettings(false);
    var lvStars = 0, dailies = 0;
    Object.keys(progress).forEach(function (k) { if (k.charAt(0) === 'd') dailies++; else if (/^\d+$/.test(k)) lvStars += progress[k].stars; });
    $('raSum').textContent = L('You have ' + lvStars + ' level stars and ' + dailies + ' daily solves.', 'ตอนนี้คุณมีดาว ' + lvStars + ' ดวง และผ่านปริศนารายวัน ' + dailies + ' วัน');
    $('raCheck').checked = false; $('raYes').disabled = true;
    openDlg('raAsk', '#raNo');
  };
  $('raCheck').onchange = function () { $('raYes').disabled = !this.checked; };
  $('raNo').onclick = function () { closeDlg('raAsk'); };
  $('raBackup').onclick = function () { closeDlg('raAsk'); $('backupBtn').onclick(); };
  $('raYes').onclick = function () {
    if (!$('raCheck').checked) return;
    progress = {}; seen = {}; store.set('hr_progress', progress); store.set('hr_seen', seen);
    closeDlg('raAsk'); renderMenu(); renderDaily(); renderNudge(); if (G) renderBest();
    toast(L('All progress reset', 'รีเซ็ตความคืบหน้าทั้งหมดแล้ว'));
  };

  /* ---------- settings panel: skin, sound, vibration, language ---------- */
  function showSettings(on) { if (on) { renderBkRow(); openDlg('settings'); } else closeDlg('settings'); }
  Array.prototype.forEach.call(document.querySelectorAll('.settings-btn'), function (b) { b.onclick = function () { showSettings(true); }; });
  $('setClose').onclick = function () { showSettings(false); };
  $('settings').addEventListener('click', function (e) { if (e.target === this) showSettings(false); });
  applySkin(); renderSkinOpts();
  applyLang();
  loadDaily();

  /* ---------- app updates: refresh button + "new version ready" banner ---------- */
  var hasSW = 'serviceWorker' in navigator && /^https?:/.test(location.protocol);
  var hadController = hasSW && !!navigator.serviceWorker.controller;

  // Refresh = prove the server is reachable first (a cache-busting URL, so neither the old worker nor the browser cache can
  // answer for it; offline we stop here and change nothing), then drop the cached copies and the old worker, pull the
  // page fresh into the browser cache and reload. Progress and settings live in localStorage and are not touched.
  function refreshApp() {
    var btn = $('refreshBtn'), url = location.href.split('#')[0].split('?')[0];
    if (btn.classList.contains('spin')) return;
    if (!hasSW) { location.reload(); return; }
    btn.classList.add('spin'); toast(L('Refreshing…', 'กำลังรีเฟรช…'));
    fetch(url + '?r=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      var jobs = [];
      if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (x) { return x.unregister(); })); }));
      return Promise.all(jobs);
    }).then(function () {
      return fetch(url, { cache: 'reload' }).catch(function () {}); // refresh the browser's own copy of the page too
    }).then(function () {
      try { sessionStorage.setItem('hr_refreshed', BUILD); } catch (e) {}
      location.reload();
    }, function () {
      btn.classList.remove('spin');
      toast(L('Can’t reach the server — check your connection', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ต'));
    });
  }
  $('refreshBtn').onclick = refreshApp;
  $('updBtn').onclick = function () { location.reload(); }; // the new worker already holds the new files

  function initUpdates() {
    $('verId').textContent = BUILD;
    var prev = null; try { prev = sessionStorage.getItem('hr_refreshed'); sessionStorage.removeItem('hr_refreshed'); } catch (e) {}
    var last = store.get('hr_build', null); store.set('hr_build', BUILD);
    if (prev !== null) setTimeout(function () {
      toast(last && last !== BUILD ? L('Updated ✓ version ' + BUILD, 'อัปเดตแล้ว ✓ เวอร์ชัน ' + BUILD) : L('Already the latest version (' + BUILD + ')', 'เป็นเวอร์ชันล่าสุดแล้ว (' + BUILD + ')'));
    }, 300);
    if (!hasSW) return;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      var check = function () { reg.update().catch(function () {}); };
      document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
      check();
    }).catch(function () {});
    // a new worker took over from an old one: tell the player (never reload by itself, a level may be in progress)
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) $('updbar').classList.remove('hidden');
    });
  }

  /* ---------- init ---------- */
  (function init() {
    var led = $('led');
    for (var i = 0; i < 20; i++) { var c = document.createElement('i'); led.appendChild(c); ledCells.push(c); }
    $('board').insertAdjacentHTML('afterbegin', '<div class="exitzone" id="exitzone"></div><div class="gate" id="gate"><span>EXIT</span></div>');
    window.addEventListener('resize', function () { if (G) layout(); });
    document.body.dataset.phase = 'setup';
    renderMenu();
    initUpdates();
  })();
})();
