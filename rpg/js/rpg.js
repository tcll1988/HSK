/* 汉字勇者 — ゲーム本体（地図の移動・会話・戦闘・メニュー・セーブ） */
(function () {
  'use strict';
  var W = window.World, RW = window.RpgWords, SP = window.Sprites;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  // 中国語の文字には lang="zh-CN" をつける（Android・iPhone で日本語の字形ではなく簡体字の字形で表示させるため）
  function zh(e) { e.setAttribute('lang', 'zh-CN'); return e; }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(a) { return a[rnd(a.length)]; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var TILE = 16, VW = 15, VH = 11;
  var SAVE_KEY = 'hskRpg.v1';
  var TIER = { // エリアごとの強さ
    hp: [0, 16, 30, 48, 70], atk: [0, 4, 8, 13, 18], exp: [0, 5, 9, 14, 20], gold: [0, 4, 8, 13, 20], boss: [0, 7, 12, 19, 26]
  };
  var MIN_SEL = 4; // えらぶことばの最小数

  /* ================= セーブデータ ================= */
  var S = null;
  function newGame() {
    return { v: 2, map: 'village', x: 11, y: 8, dir: 'down', lv: 1, exp: 0, hp: 20, mp: 6, gold: 10,
      items: { herb: 2, tea: 0, ink: 0 }, weapon: null, armor: null, owned: {},
      boss: {}, chests: {}, words: {}, steps: 0, talked: {}, wins: 0, cleared: false,
      level: startLevel(), sel: [], selBy: {},
      opt: { voice: true, sfx: true, pad: 'auto' } };
  }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { } }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!d || (d.v !== 1 && d.v !== 2)) return null;
      if (d.v === 1) { d.v = 2; d.level = 1; d.sel = []; d.selBy = {}; } // 初版（HSK1固定）の記録
      d.sel = (d.sel || []).filter(function (id) { return RW.byId[id] && RW.byId[id].level === d.level; });
      return d;
    } catch (e) { return null; }
  }

  function maxHp() { return 20 + (S.lv - 1) * 4; }
  function maxMp() { return 6 + Math.floor((S.lv - 1) / 2) * 2; }
  function atk() { return 5 + (S.lv - 1) + (S.weapon ? W.GEAR[S.weapon].atk : 0); }
  function def() { return (S.armor ? W.GEAR[S.armor].def : 0) + Math.floor((S.lv - 1) / 3); }
  function nextExp() { return 10 + (S.lv - 1) * 8; }

  /* ================= HSK単語サイトの学習記録（同じブラウザ・読むだけ） ================= */
  // サイトの単語一覧で「いま学んでいる20語」と「まちがえた単語」を、サイトと同じ計算で求める。サイトの記録は変更しない。
  function readJson(key) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return null; }
  }
  function siteStudy(level) {
    var prog = readJson('hsk-study-progress-v1');
    if (!prog) return null;
    var pref = readJson('hsk-study-preferences-v1') || {};
    var words = RW.level(level).words.slice(), random = false, i;
    var seed = prog.randomSeeds && typeof prog.randomSeeds === 'object' ? prog.randomSeeds[level] : null;
    if (pref.wordOrder === 'random' && typeof seed === 'number' && seed % 1 === 0 && seed > 0 && seed <= 0x7fffffff) {
      // サイトの「ランダム順」と同じ並べかえ（js/app.js の orderedWords と同じ手順）
      var rand = window.HSK.seededRandom(seed);
      for (i = words.length - 1; i > 0; i -= 1) { var j = Math.floor(rand() * (i + 1)), t = words[i]; words[i] = words[j]; words[j] = t; }
      random = true;
    }
    var groups = Math.ceil(words.length / RW.GROUP);
    var pos = prog.listPositions && typeof prog.listPositions === 'object' && prog.listPositions[level] && typeof prog.listPositions[level] === 'object' ? prog.listPositions[level] : {};
    var batch = typeof pos.batch === 'number' && pos.batch % 1 === 0 && pos.batch >= 0 ? Math.min(pos.batch, groups - 1) : 0;
    if (pos.entryId != null) for (i = 0; i < words.length; i++) if (words[i].id === pos.entryId) { batch = Math.floor(i / RW.GROUP); break; }
    var group = words.slice(batch * RW.GROUP, batch * RW.GROUP + RW.GROUP);
    var wrong = (Array.isArray(prog.wrongIds) ? prog.wrongIds : []).filter(function (id) { return RW.byId[id] && RW.byId[id].level === level; });
    return {
      level: typeof prog.level === 'number' && prog.level >= 1 && prog.level <= 6 ? prog.level : null,
      random: random, from: batch * RW.GROUP + 1, to: batch * RW.GROUP + group.length,
      group: group.map(function (w) { return w.id; }), wrong: wrong
    };
  }
  // 始めるときの級：サイトからのリンク（?level=）→ サイトでえらんでいる級 → 1級
  function startLevel() {
    var m = /[?&]level=([1-6])(?:&|$)/.exec(window.location.search);
    if (m) return Number(m[1]);
    var st = readJson('hsk-study-progress-v1');
    return st && typeof st.level === 'number' && st.level >= 1 && st.level <= 6 ? st.level : 1;
  }

  /* ================= 単語の記録 ================= */
  function rec(w) { return S.words[w.id] || null; }
  function seen(w) { return !!S.words[w.id]; }
  function stars(w) { var r = rec(w); return r ? r.st : 0; }
  function markSeen(w) { if (!S.words[w.id]) S.words[w.id] = { c: 0, w: 0, st: 0 }; }
  // ★は「間をあけて正解」したときだけふえる（カードを見た直後・まちがえた直後の正解は数えない）
  var lastAsk = {};
  function record(w, ok, isNew) {
    markSeen(w); var r = S.words[w.id];
    var spaced = !isNew && (lastAsk[w.id] == null || qc - lastAsk[w.id] >= 3);
    if (ok) { r.c++; if (spaced) r.st = Math.min(3, r.st + 1); } else { r.w++; r.st = Math.max(0, r.st - 1); }
    lastAsk[w.id] = qc;
  }
  // えらんだことば（いまの級の中から学生がえらんだ語）
  function selWords() { return S.sel.map(function (id) { return RW.byId[id]; }).filter(Boolean); }
  function Q() { return RW.questions(S.level, S.sel); }
  // ボスが現れる条件：草原＝全部見つける、森＝全部★1以上、洞窟＝全部★2以上、城＝全部★3
  function bossOk(w, n) { var need = W.AREAS[n].need; return seen(w) && stars(w) >= need; }
  function bossProgress(n) { var ws = selWords(); return { done: ws.filter(function (w) { return bossOk(w, n); }).length, total: ws.length }; }
  function needLabel(n) { var k = W.AREAS[n].need; return k === 0 ? '全部見つける' : k === 3 ? '全部★3' : '全部★' + k + '以上'; }
  function seenCount(level) { return RW.level(level).words.filter(seen).length; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ---------- くりかえしの順番 ----------
     えらんだことばに「次に出す時」を決め、いちばん待っていることばから出す。
     ・まちがえた／新しく覚えたことば → 2問あとにもう一度
     ・正解したことば → ★0：えらんだ語数の半分あと、★1：3/4あと、★2：同じ数あと、★3：1.5倍あと
     → えらんだことばが全部、何度もくりかえし出る。★が少ないことばほどよく出る。 */
  var dueAt = {}, qc = 0, schedKey = '', lastId = null;
  function schedSync() {
    var key = S.level + ':' + S.sel.join(',');
    if (key === schedKey) return;
    schedKey = key; var n = S.sel.length;
    S.sel.forEach(function (id) { if (dueAt[id] == null) dueAt[id] = qc + rnd(n); });
  }
  function gap(w) { var n = Math.max(4, S.sel.length); return Math.max(2, Math.round(n * [0.5, 0.75, 1, 1.5][stars(w)])); }
  function schedule(w, ok, isNew) { qc++; dueAt[w.id] = qc + (ok && !isNew ? gap(w) : 2); }
  function drawWord() {
    schedSync();
    var c = selWords().filter(function (w) { return seen(w) && w.id !== lastId; });
    if (!c.length) c = selWords().filter(seen);
    if (!c.length) return null;
    var best = null, bd = Infinity;
    shuffle(c).forEach(function (w) { var d = dueAt[w.id] == null ? qc : dueAt[w.id]; if (d < bd) { bd = d; best = w; } });
    return best;
  }

  /* ================= 音声 ================= */
  var player = new Audio(); player.preload = 'auto';
  // 0.05秒の無音。iPhone・iPad では、最初にタップしたときに音を一度鳴らすと、そのあと音声が使えるようになる
  var SILENT = (function () {
    var n = 400, head = 44, bytes = [], i;
    function str(t) { for (var k = 0; k < t.length; k++) bytes.push(t.charCodeAt(k)); }
    function u32(v) { bytes.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }
    function u16(v) { bytes.push(v & 255, (v >> 8) & 255); }
    str('RIFF'); u32(head - 8 + n); str('WAVE'); str('fmt '); u32(16); u16(1); u16(1); u32(8000); u32(8000); u16(1); u16(8); str('data'); u32(n);
    for (i = 0; i < n; i++) bytes.push(128);
    var s = ''; for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(s);
  })();
  var unlocked = false, actx = null;
  function unlockAudio() {
    if (!unlocked) {
      unlocked = true;
      try { player.src = SILENT; var p = player.play(); if (p && p.catch) p.catch(function () { unlocked = false; }); } catch (e) { unlocked = false; }
    }
    // 効果音（Web Audio）は、タップのたびに止まっていないか確かめて再開する（iPhone で別アプリから戻ったときなど）
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!actx && AC) actx = new AC();
      if (actx && actx.state === 'suspended' && actx.resume) actx.resume();
    } catch (e) { }
  }
  function say_(w) {
    try {
      player.pause();
      player.src = RW.audioSrc(w);
      var p = player.play();
      if (p && p.catch) p.catch(function (err) {
        if (err && err.name === 'AbortError') return; // 次の音声に切りかえたときは何もしない
        toast('🔊 音声を再生できませんでした。もう一度 🔊 を押してください');
      });
    } catch (e) { }
  }
  function voice(w, force) { if (force || S.opt.voice) say_(w); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) { try { player.pause(); } catch (e) { } keyOrder = []; setTouchDir(null); } });
  function beep(seq) { // seq: [[周波数, 長さms, 波形], ...]
    if (!S || !S.opt.sfx || !actx) return;
    var t = actx.currentTime;
    seq.forEach(function (n) {
      var o = actx.createOscillator(), gn = actx.createGain();
      o.type = n[2] || 'square'; o.frequency.value = n[0];
      gn.gain.setValueAtTime(0.06, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + n[1] / 1000);
      o.connect(gn); gn.connect(actx.destination); o.start(t); o.stop(t + n[1] / 1000);
      t += n[1] / 1000 * 0.9;
    });
  }
  var SFX = {
    ok: [[880, 80], [1320, 120]], ng: [[220, 120, 'sawtooth'], [160, 180, 'sawtooth']], hit: [[300, 60, 'triangle'], [600, 60, 'triangle']],
    hurt: [[150, 150, 'sawtooth']], lvup: [[523, 100], [659, 100], [784, 100], [1047, 250]], chest: [[660, 80], [880, 80], [990, 160]],
    sel: [[700, 40]], enc: [[400, 60], [300, 60], [400, 60], [300, 60]], win: [[784, 120], [988, 120], [1175, 300]]
  };

  /* ================= タイル描画 ================= */
  var STYLE = {
    village: { g: '#5aa548', g2: '#6cbf55', tall: '#3f8a3d', tree: '#2f7a34', tree2: '#4fa64a', path: '#d8b878', path2: '#c4a160' },
    plain: { g: '#62b04f', g2: '#79c75c', tall: '#3f8a3d', tree: '#2f7a34', tree2: '#4fa64a', path: '#dcc08a', path2: '#c8a86c' },
    forest: { g: '#3f8a3d', g2: '#4c9a46', tall: '#2a6a35', tree: '#1d5230', tree2: '#2f7a40', path: '#b89060', path2: '#9c7850' },
    cave: { g: '#5b5068', g2: '#665a74', tall: '#3a3046', tree: '#2e2638', tree2: '#4a4058', path: '#7a6f88', path2: '#6c627a' },
    castle: { g: '#8a8fa8', g2: '#7d829a', tall: '#7a2a3a', tree: '#41455e', tree2: '#555a75', path: '#a83a48', path2: '#e0b050' }
  };
  var tileCache = {};
  function tileCanvas(ch, style, frame) {
    var key = style + ch + (ch === '~' ? frame : '');
    if (tileCache[key]) return tileCache[key];
    var c = document.createElement('canvas'); c.width = c.height = TILE;
    var x = c.getContext('2d'), P = STYLE[style];
    function r(col, a, b, w, h) { x.fillStyle = col; x.fillRect(a, b, w, h); }
    function ground() {
      r(P.g, 0, 0, 16, 16);
      if (style === 'castle') { r(P.g2, 0, 0, 16, 1); r(P.g2, 0, 0, 1, 16); r(P.g2, 8, 8, 8, 1); r(P.g2, 8, 8, 1, 8); }
      else { r(P.g2, 3, 4, 1, 1); r(P.g2, 11, 2, 1, 1); r(P.g2, 7, 11, 1, 1); r(P.g2, 13, 13, 1, 1); }
    }
    switch (ch) {
      case ',':
        if (style === 'castle') { r(P.tall, 0, 0, 16, 16); r('#5c1f2c', 0, 0, 16, 1); r('#c05060', 2, 2, 12, 1); r('#c05060', 2, 13, 12, 1); break; }
        if (style === 'cave') { r(P.g, 0, 0, 16, 16); r(P.tall, 2, 3, 3, 2); r(P.tall, 9, 2, 4, 3); r(P.tall, 4, 10, 4, 3); r(P.tall, 11, 11, 3, 2); r('#8a7d9a', 10, 2, 1, 1); break; }
        ground();
        [[1, 9], [5, 3], [9, 10], [12, 4], [4, 13], [13, 13]].forEach(function (p) {
          r(P.tall, p[0], p[1] + 1, 1, 3); r(P.tall, p[0] + 1, p[1], 1, 4); r(P.tall, p[0] + 2, p[1] + 1, 1, 3);
        });
        break;
      case 'T':
        if (style === 'cave') { r(P.tree, 0, 0, 16, 16); r(P.tree2, 1, 1, 6, 5); r(P.tree2, 9, 8, 6, 6); r('#5c5070', 2, 1, 3, 1); r('#5c5070', 10, 8, 3, 1); break; }
        if (style === 'castle') { r(P.tree, 0, 0, 16, 16); r(P.tree2, 0, 3, 16, 1); r(P.tree2, 0, 11, 16, 1); r(P.tree2, 7, 0, 1, 3); r(P.tree2, 3, 4, 1, 7); r(P.tree2, 12, 4, 1, 7); r(P.tree2, 7, 12, 1, 4); break; }
        ground(); r('#6b4423', 7, 11, 3, 5);
        r(P.tree, 2, 2, 12, 10); r(P.tree, 4, 0, 8, 13); r(P.tree2, 4, 2, 4, 3); r(P.tree2, 5, 1, 2, 1); r('#1a1c2c', 2, 11, 1, 1);
        break;
      case '~':
        r(style === 'cave' ? '#2b4a7a' : '#3b7dd8', 0, 0, 16, 16);
        r('#8fd0ff', frame ? 2 : 4, 4, 4, 1); r('#8fd0ff', frame ? 9 : 11, 10, 4, 1); r('#6fb0f0', frame ? 6 : 8, 13, 3, 1);
        break;
      case '=':
        if (style === 'castle') { r(P.path, 0, 0, 16, 16); r(P.path2, 1, 0, 1, 16); r(P.path2, 14, 0, 1, 16); break; }
        r(P.path, 0, 0, 16, 16); r(P.path2, 3, 5, 2, 1); r(P.path2, 10, 11, 2, 1); r(P.path2, 12, 3, 1, 1);
        break;
      case 'f':
        ground(); r('#ff9ab0', 3, 4, 2, 2); r('#ffcd75', 10, 9, 2, 2); r('#f4f4f4', 6, 12, 2, 2); r('#257179', 4, 6, 1, 2); r('#257179', 11, 11, 1, 2);
        break;
      case 'R':
        r('#b33a3a', 0, 0, 16, 16); r('#d94a4a', 0, 2, 16, 2); r('#d94a4a', 0, 8, 16, 2); r('#8f2d3c', 0, 14, 16, 2);
        break;
      case 'W':
        r('#e8d8b0', 0, 0, 16, 16); r('#c8b890', 0, 15, 16, 1); r('#3b5dc9', 5, 4, 6, 6); r('#9bd0ff', 6, 5, 4, 4); r('#c8b890', 7, 5, 1, 4);
        break;
      case 'd':
        r('#e8d8b0', 0, 0, 16, 16); r('#6b4423', 4, 3, 8, 13); r('#8b5a2b', 5, 4, 6, 12); r('#ffcd75', 9, 10, 1, 1);
        break;
      default: ground();
    }
    tileCache[key] = c; return c;
  }

  /* ================= 地図 ================= */
  // 地図は 240×176 ドットの小さな絵（off）にかいてから、画面のピクセル数に合わせた canvas に拡大してうつす。
  // ブラウザの CSS 拡大（image-rendering）にたよらないので、どのブラウザでもドット絵がくっきり見える。
  var canvas = $('map'), vctx = canvas.getContext('2d');
  var off = document.createElement('canvas'); off.width = VW * TILE; off.height = VH * TILE;
  var ctx = off.getContext('2d');
  function noSmooth(c) {
    if ('imageSmoothingEnabled' in c) c.imageSmoothingEnabled = false;
    else { c.webkitImageSmoothingEnabled = false; c.mozImageSmoothingEnabled = false; c.msImageSmoothingEnabled = false; }
  }
  function fitBacking(vis, cssW, ratio) {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(w * ratio));
    if (vis.width !== w || vis.height !== h) { vis.width = w; vis.height = h; }
  }
  function present(vis, vc, src) { noSmooth(vc); vc.drawImage(src, 0, 0, vis.width, vis.height); }
  var cam = { x: 0, y: 0 };
  var M = null; // いまの地図
  var P = { px: 0, py: 0, moving: false, t: 0, fx: 0, fy: 0, step: 0 };
  var mode = 'title';

  function setMap(name, x, y, dir) {
    M = W.MAPS[name]; S.map = name; S.x = x; S.y = y; if (dir) S.dir = dir; walk = null;
    P.px = x * TILE; P.py = y * TILE; P.moving = false;
    $('loc').textContent = M.name;
    updateHud(); save();
  }
  function tileAt(x, y) { var r = M.rows[y]; return r ? (r[x] || 'T') : 'T'; }
  function bossHere() { return M.boss && M.area && !S.boss[M.area] ? M.boss : null; }
  function objAt(x, y) {
    var o = null;
    M.npcs.forEach(function (n) { if (n.x === x && n.y === y) o = { kind: 'npc', o: n }; });
    (M.signs || []).forEach(function (n) { if (n.x === x && n.y === y) o = { kind: 'sign', o: n }; });
    (M.chests || []).forEach(function (n) { if (n.x === x && n.y === y) o = { kind: 'chest', o: n }; });
    var b = bossHere(); if (b && b.x === x && b.y === y) o = { kind: 'boss', o: b };
    return o;
  }
  function solid(x, y) {
    if (x < 0 || y < 0 || y >= M.rows.length || x >= M.rows[0].length) return true;
    return 'TRWd~'.indexOf(tileAt(x, y)) >= 0 || !!objAt(x, y);
  }
  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  var frame = 0;
  function draw() {
    frame++;
    if (!M) return;
    var mw = M.rows[0].length, mh = M.rows.length;
    var cx = P.px + 8 - VW * TILE / 2, cy = P.py + 8 - VH * TILE / 2;
    cx = Math.max(0, Math.min(mw * TILE - VW * TILE, cx)); cy = Math.max(0, Math.min(mh * TILE - VH * TILE, cy));
    cx = Math.round(cx); cy = Math.round(cy);
    cam.x = cx; cam.y = cy;
    var tx0 = Math.floor(cx / TILE), ty0 = Math.floor(cy / TILE), wf = Math.floor(frame / 40) % 2;
    for (var j = ty0; j <= ty0 + VH; j++) for (var i = tx0; i <= tx0 + VW; i++) {
      if (j >= mh || i >= mw) continue;
      ctx.drawImage(tileCanvas(tileAt(i, j), M.style, wf), i * TILE - cx, j * TILE - cy);
    }
    function spr(name, x, y, flip, bob) { ctx.drawImage(SP.get(name, flip), x - cx, y - cy - (bob || 0)); }
    (M.signs || []).forEach(function (s) { spr('sign', s.x * TILE, s.y * TILE); });
    (M.chests || []).forEach(function (c) { spr(S.chests[c.id] ? 'chest_open' : 'chest', c.x * TILE, c.y * TILE); });
    M.npcs.forEach(function (n) { spr(n.sp, n.x * TILE, n.y * TILE, false, Math.floor(frame / 30 + n.x) % 2); });
    var b = bossHere();
    if (b) {
      var bs = W.AREAS[M.area].boss.sp;
      if (frame % 30 === 1 || draw.ready == null) { var bp = bossProgress(M.area); draw.ready = bp.total > 0 && bp.done >= bp.total; }
      var ready = draw.ready;
      if (!ready) ctx.globalAlpha = 0.45 + 0.15 * Math.sin(frame / 15);
      spr(bs, b.x * TILE, b.y * TILE, false, Math.floor(frame / 20) % 2);
      ctx.globalAlpha = 1;
    }
    // クリック・タップで行き先をえらんだとき：行き先にしるし
    if (walk && walk.mark && Math.floor(frame / 12) % 2) {
      ctx.strokeStyle = '#ffcd75'; ctx.lineWidth = 1;
      ctx.strokeRect(walk.mark.x * TILE - cx + 1.5, walk.mark.y * TILE - cy + 1.5, TILE - 3, TILE - 3);
    }
    var hs = S.dir === 'up' ? 'hero_up' : S.dir === 'down' ? 'hero_down' : 'hero_side';
    spr(hs, P.px, P.py, S.dir === 'left', P.moving && (P.step % 2) ? 1 : 0);
    present(canvas, vctx, off);
  }

  function tick() {
    if (mode === 'map' && M) {
      if (P.moving) {
        P.t += 1 / 8;
        if (P.t >= 1) { P.moving = false; P.px = S.x * TILE; P.py = S.y * TILE; onStep(); }
        else { P.px = (P.fx + (S.x - P.fx) * P.t) * TILE; P.py = (P.fy + (S.y - P.fy) * P.t) * TILE; }
      }
      if (!P.moving && mode === 'map') {
        var d = heldDir();
        if (d) { walk = null; tryMove(d); }
        else if (walk) stepWalk();
      }
    }
    // 戦闘・メニューなどで地図がかくれているあいだは、地図をかかない（電池の節約）
    if (mode !== 'battle' && mode !== 'panel' && mode !== 'ending' && !$('game').hidden) draw();
    requestAnimationFrame(tick);
  }
  function tryMove(d) {
    S.dir = d;
    var nx = S.x + DIRS[d][0], ny = S.y + DIRS[d][1];
    var wp = warpAt(nx, ny);
    if (!wp && solid(nx, ny)) return false;
    P.fx = S.x; P.fy = S.y; S.x = nx; S.y = ny; P.t = 0; P.moving = true; P.step++;
    return true;
  }

  /* ---------- クリック・タップした場所へ歩く ---------- */
  var walk = null; // { path: ['up', ...], face: 'left'|null, mark: {x, y} }
  var noEncounter = false; // テスト用
  function passable(x, y) { return !!warpAt(x, y) || !solid(x, y); }
  function findPath(goals) { // 幅優先探索：いまの場所から goals のどれかまで
    var key = function (x, y) { return x + ',' + y; };
    var goal = {}; goals.forEach(function (g) { goal[key(g[0], g[1])] = true; });
    if (goal[key(S.x, S.y)]) return [];
    var prev = {}, q = [[S.x, S.y]], seenK = {}; seenK[key(S.x, S.y)] = true;
    var names = ['up', 'down', 'left', 'right'];
    while (q.length) {
      var c = q.shift();
      for (var k = 0; k < 4; k++) {
        var d = DIRS[names[k]], nx = c[0] + d[0], ny = c[1] + d[1], nk = key(nx, ny);
        if (seenK[nk] || !passable(nx, ny)) continue;
        if (warpAt(c[0], c[1]) && !(c[0] === S.x && c[1] === S.y)) continue; // 出入口の先へは進まない
        seenK[nk] = true; prev[nk] = { from: key(c[0], c[1]), dir: names[k] };
        if (goal[nk]) {
          var path = [], cur = nk;
          while (cur !== key(S.x, S.y)) { path.unshift(prev[cur].dir); cur = prev[cur].from; }
          return path;
        }
        q.push([nx, ny]);
      }
    }
    return null;
  }
  function walkTo(tx, ty) {
    if (!M || tx < 0 || ty < 0 || ty >= M.rows.length || tx >= M.rows[0].length) return;
    var o = objAt(tx, ty);
    if (tx === S.x && ty === S.y) { walk = null; return; }
    if (o || !passable(tx, ty)) {
      // 人・宝箱・立て札など：となりまで歩いて、そちらを向いて話す・調べる
      var goals = [], face = {};
      ['up', 'down', 'left', 'right'].forEach(function (n) {
        var gx = tx - DIRS[n][0], gy = ty - DIRS[n][1];
        if ((gx === S.x && gy === S.y) || passable(gx, gy)) { goals.push([gx, gy]); face[gx + ',' + gy] = n; }
      });
      var p = goals.length ? findPath(goals) : null;
      if (!p) { walk = null; return; }
      var end = [S.x, S.y]; p.forEach(function (n) { end[0] += DIRS[n][0]; end[1] += DIRS[n][1]; });
      walk = { path: p, face: o ? face[end[0] + ',' + end[1]] : null, mark: { x: tx, y: ty } };
    } else {
      var p2 = findPath([[tx, ty]]);
      walk = p2 ? { path: p2, face: null, mark: { x: tx, y: ty } } : null;
    }
    if (walk && !P.moving) stepWalk();
  }
  function stepWalk() {
    if (!walk) return;
    if (walk.path.length) { if (!tryMove(walk.path.shift())) walk = null; return; }
    var f = walk.face; walk = null;
    if (f) { S.dir = f; interact(); }
  }
  function warpAt(x, y) { var r = null; (M.warps || []).forEach(function (w) { if (w.x === x && w.y === y) r = w; }); return r; }

  function onStep() {
    var wp = warpAt(S.x, S.y);
    if (wp) {
      if (wp.area && wp.area > 1 && !S.boss[wp.area - 1]) {
        // まだ行けない：一歩もどる
        walk = null; S.x = P.fx; S.y = P.fy; P.px = S.x * TILE; P.py = S.y * TILE;
        var prev = W.AREAS[wp.area - 1];
        dialog(W.TALK.locked.map(withName('見はりの声')).concat([{ text: '「' + W.AREAS[wp.area].name + '」へは、' + prev.name + 'のボス「' + prev.boss.name + '」をたおすと行けるようになる。' }]));
        return;
      }
      fade(function () { setMap(wp.to, wp.tx, wp.ty, wp.dir); });
      return;
    }
    if (tileAt(S.x, S.y) === ',' && M.area && !noEncounter) {
      S.steps++;
      if (S.steps >= 3 && Math.random() < 0.2) { S.steps = 0; P.moving = false; walk = null; encounter(); }
    }
    save();
  }
  function fade(fn) {
    var f = $('fade'); mode = 'busy'; f.classList.add('on');
    setTimeout(function () { fn(); f.classList.remove('on'); setTimeout(function () { if (mode === 'busy') mode = 'map'; }, 200); }, 250);
  }

  /* ================= 入力 ================= */
  var touchDir = null;
  // 古いブラウザ（旧Edgeなど）の名前（Up・Esc・Spacebar）もうけつける
  var KEYDIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Up: 'up', Down: 'down', Left: 'left', Right: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
  var keyOrder = [];
  function heldDir() { if (touchDir) return touchDir; return keyOrder.length ? KEYDIR[keyOrder[keyOrder.length - 1]] : null; }
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // ブラウザのショートカットはじゃましない
    if (mode === 'ask') return; // 確認ボックス：ボタンのふつうの操作（Tab・Enter）にまかせる
    unlockAudio();
    var k = e.key;
    if (KEYDIR[k]) { if (keyOrder.indexOf(k) < 0) keyOrder.push(k); if (mode !== 'map') navKey(KEYDIR[k], e); else e.preventDefault(); return; }
    if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'z' || k === 'Z') { e.preventDefault(); if (!e.repeat) pressA(k !== 'Enter' && k !== 'z' && k !== 'Z'); return; }
    if (k === 'Escape' || k === 'Esc' || k === 'x' || k === 'X' || k === 'm' || k === 'M') { e.preventDefault(); pressB(); return; }
    if (/^[1-4]$/.test(k) && mode === 'battle') { var bt = $('bchoices').children[Number(k) - 1]; if (bt && !bt.disabled && !$('bq').hidden) bt.click(); }
  });
  document.addEventListener('keyup', function (e) { var i = keyOrder.indexOf(e.key); if (i >= 0) keyOrder.splice(i, 1); });
  window.addEventListener('blur', function () { keyOrder = []; setTouchDir(null); });

  /* ---------- 十字ボタン：指をすべらせて向きをかえられる ---------- */
  var dpad = $('dpad'), dpadPointer = null;
  function setTouchDir(d) {
    if (touchDir === d) return;
    touchDir = d;
    Array.prototype.forEach.call(dpad.querySelectorAll('[data-dir]'), function (b) { b.classList.toggle('on', b.getAttribute('data-dir') === d); });
    if (d) { walk = null; if (mode !== 'map') navKey(d); }
  }
  function dirAt(x, y) {
    var r = dpad.getBoundingClientRect(), dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
    if (Math.abs(dx) < r.width * 0.1 && Math.abs(dy) < r.height * 0.1) return touchDir; // まん中は、そのまま
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }
  if (window.PointerEvent) {
    dpad.addEventListener('pointerdown', function (e) {
      e.preventDefault(); unlockAudio(); dpadPointer = e.pointerId;
      try { dpad.setPointerCapture(e.pointerId); } catch (err) { }
      setTouchDir(dirAt(e.clientX, e.clientY));
    });
    dpad.addEventListener('pointermove', function (e) { if (e.pointerId === dpadPointer) setTouchDir(dirAt(e.clientX, e.clientY)); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) {
      dpad.addEventListener(t, function (e) { if (e.pointerId === dpadPointer) { dpadPointer = null; setTouchDir(null); } });
    });
  } else { // Pointer Events がない古いブラウザ（iOS 12 以前など）
    var tid = null;
    dpad.addEventListener('touchstart', function (e) { e.preventDefault(); unlockAudio(); var t = e.changedTouches[0]; tid = t.identifier; setTouchDir(dirAt(t.clientX, t.clientY)); }, { passive: false });
    dpad.addEventListener('touchmove', function (e) { e.preventDefault(); for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === tid) setTouchDir(dirAt(e.changedTouches[i].clientX, e.changedTouches[i].clientY)); }, { passive: false });
    ['touchend', 'touchcancel'].forEach(function (t) { dpad.addEventListener(t, function (e) { for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === tid) { tid = null; setTouchDir(null); } }); });
    var mouseOn = false;
    dpad.addEventListener('mousedown', function (e) { mouseOn = true; setTouchDir(dirAt(e.clientX, e.clientY)); });
    window.addEventListener('mousemove', function (e) { if (mouseOn) setTouchDir(dirAt(e.clientX, e.clientY)); });
    window.addEventListener('mouseup', function () { if (mouseOn) { mouseOn = false; setTouchDir(null); } });
  }
  dpad.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------- A ボタン ---------- */
  var btnA = $('btn-a');
  function aDown(e) { if (e && e.preventDefault) e.preventDefault(); unlockAudio(); btnA.classList.add('on'); pressA(); }
  function aUp() { btnA.classList.remove('on'); }
  if (window.PointerEvent) {
    btnA.addEventListener('pointerdown', aDown);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { btnA.addEventListener(t, aUp); });
  } else {
    btnA.addEventListener('touchstart', aDown, { passive: false }); btnA.addEventListener('touchend', aUp);
    btnA.addEventListener('mousedown', aDown); btnA.addEventListener('mouseup', aUp);
  }
  btnA.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  $('btn-menu').addEventListener('click', function () { unlockAudio(); if (mode === 'map' && !P.moving) { walk = null; openMenu(); } });

  /* ---------- 地図をクリック・タップ：その場所へ歩く／人をえらぶと話す ---------- */
  canvas.addEventListener('click', function (e) {
    unlockAudio();
    if (mode !== 'map' || !M) return;
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var gx = (e.clientX - r.left) / r.width * VW * TILE + cam.x, gy = (e.clientY - r.top) / r.height * VH * TILE + cam.y;
    walkTo(Math.floor(gx / TILE), Math.floor(gy / TILE));
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------- 全画面（対応しているブラウザだけ） ---------- */
  (function () {
    var de = document.documentElement, b = $('btn-full');
    var req = de.requestFullscreen || de.webkitRequestFullscreen || de.msRequestFullscreen;
    var enabled = document.fullscreenEnabled || document.webkitFullscreenEnabled || document.msFullscreenEnabled;
    if (!req || !enabled) return;
    b.hidden = false;
    b.addEventListener('click', function () {
      var cur = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
      try {
        if (cur) (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen).call(document);
        else { var p = req.call(de); if (p && p.catch) p.catch(function () { }); }
      } catch (err) { }
    });
  })();

  /* ---------- 画面の大きさに合わせる ---------- */
  var touchDevice = (function () {
    try { if (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches) return true; } catch (e) { }
    return ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  })();
  function showPad() { var o = S && S.opt.pad; return o === 'on' ? true : o === 'off' ? false : touchDevice; }
  function layout() {
    var game = $('game');
    if (game.hidden) return;
    var touch = showPad(), body = document.body;
    var vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    var land = touch && vw > vh * 1.15 && vh < 600;
    body.classList.toggle('touch', touch); body.classList.toggle('land', land);
    for (var pass = 0; pass < 2; pass++) { // HUD の高さは幅で変わるので2回計算する
      var hudH = $('hud').offsetHeight, gap = 8, availW, availH;
      if (land) {
        var side = Math.max(dpad.offsetWidth + 16, 120);
        availW = vw - 2 * side - 16;
        availH = vh - hudH - 16;
      } else {
        var below = touch ? Math.max(dpad.offsetHeight + 16, btnA.offsetHeight + 16) : $('keys-hint').offsetHeight + gap;
        availW = Math.min(vw - 16, 1280);
        availH = vh - hudH - below - 16 - 6;
      }
      var w = Math.min(availW - 6, availH * VW / VH);
      w = Math.max(w, Math.min(availW - 6, 240)); // とても低い画面でも、地図は小さくしすぎない（そのときは画面をスクロール）
      var dpr = window.devicePixelRatio || 1, s = w * dpr / (VW * TILE);
      // パソコンの画面（1ドット＝1ピクセル前後）では、ドットの大きさがそろう倍率にする（差が1割以下のとき）
      if (dpr < 2 && s >= 2 && (s - Math.floor(s)) / s <= 0.1) w = Math.floor(s) * VW * TILE / dpr;
      w = Math.floor(w);
      var h = Math.round(w * VH / VW);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      game.style.width = land ? '' : (w + 6) + 'px';
      $('hud').style.width = land ? (w + 6) + 'px' : '';
    }
    body.classList.toggle('big', !land && w >= 880);
    fitBacking(canvas, w, VH / VW);
    if (M) draw();
    if (B) sizeBattle();
  }
  var layoutT = 0;
  function relayout() { clearTimeout(layoutT); layoutT = setTimeout(function () { layout(); if (B) sizeBattle(); titleArt(); }, 60); }
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', function () { relayout(); setTimeout(relayout, 350); }); // iPhone は回転直後の大きさが古いことがある
  if (window.visualViewport) window.visualViewport.addEventListener('resize', relayout);

  // 選択肢のキー操作（会話の選択・パネル）
  function focusRoot() {
    var ids = ['panel', 'dialog', 'battle', 'ending', 'title'];
    for (var i = 0; i < ids.length; i++) if (!$(ids[i]).hidden) return $(ids[i]);
    return null;
  }
  function focusables() {
    var root = focusRoot();
    if (!root) return [];
    return Array.prototype.filter.call(root.querySelectorAll('button:not([disabled])'), function (b) { return b.offsetParent !== null; });
  }
  function navKey(d, e) {
    var f = focusables(); if (!f.length) return;
    if (e && e.preventDefault) e.preventDefault();
    var i = f.indexOf(document.activeElement);
    if (i < 0) { f[0].focus(); return; }
    var step = (d === 'up' || d === 'left') ? -1 : 1;
    f[(i + step + f.length) % f.length].focus();
  }
  function pressA(isSpace) {
    if (mode === 'ask') return;
    if (mode === 'map') { if (!P.moving) interact(); return; }
    if (mode === 'battle' && isSpace && battleListen) { battleListen(); return; }
    var a = document.activeElement, root = focusRoot();
    if (a && a.tagName === 'BUTTON' && !a.disabled && a.offsetParent !== null && root && root.contains(a)) { a.click(); return; }
    if (advance) { var f = advance; f(); return; }
    var f2 = focusables(); if (f2.length === 1) f2[0].click();
  }
  function pressB() {
    if (mode === 'map' && !P.moving) { openMenu(); return; }
    if (mode === 'panel' && panelClose) panelClose();
  }

  /* ================= 会話 ================= */
  var advance = null;
  function withName(n) { return function (p) { var q = {}; for (var k in p) q[k] = p[k]; q.name = n; return q; }; }
  function renderLine(box, p) {
    box.innerHTML = '';
    if (p.zh) {
      box.appendChild(zh(el('div', 'd-zh', p.zh)));
      box.appendChild(el('div', 'd-py', p.py));
      box.appendChild(el('div', 'd-ja', p.ja));
    }
    if (p.text) p.text.split('\n').forEach(function (t) { box.appendChild(el('div', 'd-text', t)); });
  }
  // pages を順に表示。最後のページに choices があれば選ばせる
  function dialog(pages, done) {
    walk = null;
    var prevMode = mode === 'battle' ? 'battle' : 'map';
    mode = 'dialog';
    var d = $('dialog'), i = 0;
    d.hidden = false;
    function show() {
      var p = pages[i];
      $('d-name').textContent = p.name || '';
      $('d-name').hidden = !p.name;
      renderLine($('d-body'), p);
      var ch = $('d-choices'); ch.innerHTML = '';
      $('d-next').hidden = !!p.choices;
      if (p.choices) {
        advance = null;
        p.choices.forEach(function (c, k) {
          var b = el('button', 'btn', c.label); if (c.disabled) b.disabled = true;
          b.addEventListener('click', function () { beep(SFX.sel); close(); c.fn && c.fn(); });
          ch.appendChild(b);
        });
        setTimeout(function () { var f = ch.querySelector('button:not([disabled])'); if (f) f.focus(); }, 30);
      } else {
        advance = function () { i++; if (i < pages.length) show(); else { close(); done && done(); } };
      }
    }
    function close() { d.hidden = true; advance = null; if (mode === 'dialog') mode = prevMode; }
    show();
  }
  $('dialog').addEventListener('click', function (e) { if (e.target.tagName !== 'BUTTON' && advance) advance(); });
  $('d-next').addEventListener('click', function (e) { e.stopPropagation(); if (advance) advance(); });

  // confirm() のかわりの確認ボックス（LINE などアプリ内ブラウザでは confirm() が出ないことがあるため）
  function askConfirm(text, okLabel, onOk) {
    var wrap = el('div', 'ask'), box = el('div', 'ask-box'), btns = el('div', 'ask-btns');
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
    box.appendChild(el('p', 'ask-text', text));
    var no = el('button', 'btn', 'やめる'), ok = el('button', 'btn primary danger-ok', okLabel);
    var prevMode = mode; mode = 'ask';
    function close() { document.body.removeChild(wrap); mode = prevMode; document.removeEventListener('keydown', esc, true); }
    function esc(e) { if (e.key === 'Escape' || e.key === 'Esc') { e.stopPropagation(); e.preventDefault(); close(); } }
    no.addEventListener('click', close);
    ok.addEventListener('click', function () { close(); onOk(); });
    btns.appendChild(no); btns.appendChild(ok); box.appendChild(btns); wrap.appendChild(box);
    document.body.appendChild(wrap);
    document.addEventListener('keydown', esc, true);
    setTimeout(function () { no.focus(); }, 30);
  }
  // 画面の下にかくれたボタンを見えるところまでスクロール（どのブラウザでも同じように動く方法で）
  function ensureVisible(elm) {
    var box = elm.closest ? elm.closest('.battle, .panel') : null;
    if (!box) return;
    var r = elm.getBoundingClientRect(), br = box.getBoundingClientRect();
    var bottom = Math.min(br.bottom, window.innerHeight) - 10;
    if (r.bottom > bottom) box.scrollTop += r.bottom - bottom;
  }

  var toastT = 0;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2200); }

  /* ================= 調べる・話す ================= */
  function interact() {
    var nx = S.x + DIRS[S.dir][0], ny = S.y + DIRS[S.dir][1];
    var o = objAt(nx, ny); if (!o) return;
    if (o.kind === 'sign') { dialog([{ name: '立て札', text: o.o.text }]); return; }
    if (o.kind === 'chest') { openChest(o.o); return; }
    if (o.kind === 'boss') { talkBoss(); return; }
    if (o.kind === 'npc') talkNpc(o.o);
  }
  function openChest(c) {
    if (S.chests[c.id]) { dialog([{ text: '宝箱はからっぽだ。' }]); return; }
    S.chests[c.id] = true; beep(SFX.chest);
    var msg;
    if (c.gold) { S.gold += c.gold; msg = c.gold + ' G を手に入れた！'; }
    else if (c.item) { S.items[c.item] = (S.items[c.item] || 0) + c.n; msg = W.ITEMS[c.item].name + ' を ' + c.n + 'こ 手に入れた！'; }
    else if (c.gear) {
      var gname = W.GEAR[c.gear].name; S.owned[c.gear] = true; msg = gname + ' を手に入れた！';
      if (equipIfBetter(c.gear)) msg += '\n（そうびした：' + W.GEAR[c.gear].desc + '）';
    }
    updateHud(); save();
    dialog([{ text: '宝箱をあけた！\n' + msg }]);
  }
  function equipIfBetter(id) {
    var g = W.GEAR[id], cur = S[g.slot] ? W.GEAR[S[g.slot]] : null;
    var val = function (x) { return x ? (x.atk || 0) + (x.def || 0) : -1; };
    if (val(g) > val(cur)) { S[g.slot] = id; return true; }
    return false;
  }
  function talkNpc(n) {
    var nm = withName(n.name);
    if (n.id === 'elder') {
      var lines = W.TALK.elder.map(nm);
      if (S.cleared) lines = [W.zh('谢谢你！你是我们的朋友！', 'Xièxie nǐ! Nǐ shì wǒmen de péngyou!', 'ありがとう！きみは村の友だちじゃ！')].map(nm);
      dialog(lines); return;
    }
    if (n.id === 'kid') { dialog(W.TALK.kid.map(nm)); return; }
    if (n.id === 'shop') { dialog(W.TALK.shop.map(nm), openShop); return; }
    if (n.id === 'inn') {
      var cost = 5;
      dialog(W.TALK.inn.map(nm).concat([{ name: n.name, text: '所持金：' + S.gold + ' G', choices: [
        { label: '泊まる（5 G）', fn: function () {
          var free = S.gold < cost; if (!free) S.gold -= cost;
          fade(function () { S.hp = maxHp(); S.mp = maxMp(); updateHud(); save(); });
          setTimeout(function () { dialog([nm(W.zh('早上好！', 'Zǎoshang hǎo!', 'おはようございます！')), { text: (free ? 'お金が足りなかったけど、今回はサービスしてくれた。\n' : '') + 'HPとMPが全回復した！' }]); }, 500);
        } },
        { label: 'やめる', fn: function () { } }
      ] }]));
      return;
    }
    if (n.id === 'review') {
      var sw = selWords(), found = sw.filter(seen).length;
      dialog(W.TALK.review.map(nm).concat([{ name: n.name, text: selSummary() + '（見つけた ' + found + ' / ' + sw.length + '）', choices: [
        { label: 'ふくしゅうする（10問）', disabled: found < 1, fn: function () { practice({ title: '王先生のふくしゅう', sp: 'teacher', list: reviewList(10) }); } },
        { label: 'HSKの級・ことばをえらびなおす', fn: function () { openPicker(false); } },
        { label: 'またこんど', fn: function () { } }
      ] }]));
      return;
    }
    if (n.id === 'teacher') { teacherMenu(n); }
  }
  function selSummary() { return 'いまのことば：HSK' + S.level + '・' + S.sel.length + '語'; }
  // ★が少ない順（同じなら、まちがいが多い順）に、見つけたことばから n 問。少なければくりかえす
  function reviewList(n) {
    var ws = shuffle(selWords().filter(seen)).sort(function (a, b) {
      var ra = rec(a), rb = rec(b);
      return (stars(a) - stars(b)) || ((rb.w - rb.c) - (ra.w - ra.c));
    });
    var out = [];
    for (var i = 0; out.length < n && ws.length; i++) out.push(ws[i % ws.length]);
    return out;
  }
  function teacherMenu(n) {
    var nm = withName(n.name), sw = selWords();
    var unseen = sw.filter(function (w) { return !seen(w); });
    var choices = [
      { label: '新しいことばを教わる（のこり ' + unseen.length + '語）', disabled: !unseen.length, fn: function () { lesson(n); } },
      { label: '★が少ないことばを練習（8問）', disabled: unseen.length === sw.length, fn: function () { practice({ title: n.name + 'の練習', sp: 'teacher', list: reviewList(8) }); } },
      { label: 'やめる', fn: function () { } }
    ];
    var first = !S.talked[n.name]; S.talked[n.name] = true;
    var pages = (first ? W.TALK.teacher.map(nm) : [nm(W.zh('你好！', 'Nǐ hǎo!', 'こんにちは！'))]);
    pages.push({ name: n.name, text: selSummary() + '。何を勉強しますか？', choices: choices });
    dialog(pages);
  }

  /* ================= ステータス表示 ================= */
  function updateHud() {
    if (!S) return;
    $('h-lv').textContent = S.lv;
    $('h-hp').textContent = S.hp + '/' + maxHp();
    $('h-hpbar').style.width = Math.max(0, S.hp / maxHp() * 100) + '%';
    $('h-hpbar').classList.toggle('low', S.hp <= maxHp() * 0.3);
    $('h-mp').textContent = S.mp + '/' + maxMp();
    $('h-gold').textContent = S.gold;
    var a = M && M.area;
    if (a && !S.boss[a]) { var bp = bossProgress(a); $('h-words').textContent = 'HSK' + S.level + '・ボス条件「' + needLabel(a) + '」' + bp.done + '/' + bp.total; }
    else $('h-words').textContent = 'HSK' + S.level + '・えらんだことば ' + S.sel.length + '語（★3：' + selWords().filter(function (w) { return stars(w) === 3; }).length + '）';
  }
  function gainExp(n) {
    S.exp += n; var ups = 0;
    while (S.exp >= nextExp()) { S.exp -= nextExp(); S.lv++; ups++; }
    if (ups) { S.hp = maxHp(); S.mp = maxMp(); }
    updateHud();
    return ups;
  }

  /* ================= 戦闘画面 ================= */
  var B = null, battleListen = null;
  // 戦闘の絵も 240×120 ドットにかいてから、画面のピクセル数に合わせて拡大する
  var bvis = $('bcanvas'), bvctx = bvis.getContext('2d');
  var boff = document.createElement('canvas'); boff.width = 240; boff.height = 120;
  var bctx = boff.getContext('2d');
  function sizeBattle() { if (bvis.clientWidth) fitBacking(bvis, bvis.clientWidth, 0.5); }
  var BG = {
    plain: ['#9bd4ff', '#62b04f', '#3f8a3d'], forest: ['#2f6a4a', '#3f8a3d', '#1d5230'], cave: ['#1e1828', '#463c52', '#2e2638'],
    castle: ['#2a1f3d', '#7a2a3a', '#41455e'], village: ['#ffe2b0', '#d8b878', '#c4a160']
  };
  function drawBattle() {
    if (!B) return;
    var c = bctx, w = 240, h = 120, col = BG[B.bg] || BG.plain;
    noSmooth(c);
    c.fillStyle = col[0]; c.fillRect(0, 0, w, h);
    c.fillStyle = col[2]; c.fillRect(0, 70, w, 50);
    c.fillStyle = col[1];
    if (c.ellipse) { c.beginPath(); c.ellipse(120, 96, 70, 14, 0, 0, Math.PI * 2); c.fill(); } else c.fillRect(50, 84, 140, 24);
    if (B.bg === 'plain') { c.fillStyle = '#fff'; c.fillRect(30, 20, 26, 6); c.fillRect(36, 15, 14, 6); c.fillRect(170, 30, 30, 6); }
    if (B.bg === 'cave') { c.fillStyle = '#73eff7'; [[30, 20], [200, 35], [60, 50], [180, 12]].forEach(function (p) { c.fillRect(p[0], p[1], 2, 2); }); }
    if (B.bg === 'castle') { c.fillStyle = '#ffcd75'; c.fillRect(30, 30, 4, 10); c.fillRect(206, 30, 4, 10); c.fillStyle = '#ef7d57'; c.fillRect(30, 24, 4, 6); c.fillRect(206, 24, 4, 6); }
    if (B.enemyHp > 0 || B.practice) {
      var size = B.boss ? 80 : 64, x = 120 - size / 2 + (B.shake ? (rnd(5) - 2) : 0), y = 96 - size + 4 - (Math.floor(Date.now() / 400) % 2);
      if (!B.flash || Math.floor(Date.now() / 60) % 2) c.drawImage(SP.get(B.sp), x, y, size, size);
    }
    present(bvis, bvctx, boff);
  }
  function battleLoop() { if (B) { drawBattle(); requestAnimationFrame(battleLoop); } }
  function bmsg(t) { $('bmsg').textContent = t; }
  function bUpdate() {
    if (!B) return;
    $('b-ename').textContent = B.name;
    $('b-ehp').hidden = !!B.practice;
    $('b-ehpbar').style.width = Math.max(0, B.enemyHp / B.enemyMax * 100) + '%';
    $('b-hp').textContent = S.hp + '/' + maxHp(); $('b-mp').textContent = S.mp + '/' + maxMp();
    $('b-hpbar').style.width = Math.max(0, S.hp / maxHp() * 100) + '%';
    $('b-combo').textContent = B.combo >= 2 ? B.combo + ' コンボ！' : '';
    updateHud();
  }
  function bShow(part, keep) { ['bcmd', 'bq', 'bcard', 'bnextwrap'].forEach(function (id) { $(id).hidden = id !== part && id !== keep; }); }
  function tapNext(label, keepQuestion) {
    return new Promise(function (res) {
      bShow('bnextwrap', keepQuestion ? 'bq' : null); var b = $('bnext'); b.textContent = label || 'つぎへ ▶︎';
      setTimeout(function () { ensureVisible(b); }, 0);
      advance = function () { advance = null; res(); };
      b.onclick = function () { if (advance) advance(); };
      setTimeout(function () { b.focus(); }, 20);
    });
  }
  function bsay(t, ms) { bmsg(t); return ms ? wait(ms) : tapNext(); }

  function chooseCommand() {
    return new Promise(function (res) {
      bShow('bcmd');
      var cmds = $('bcmd'); cmds.innerHTML = '';
      var list = B.practice ? [['fight', '▶︎ こたえる']] : [['fight', '⚔ たたかう'], ['magic', '✦ こえの魔法'], ['item', '✚ どうぐ'], ['run', '➜ にげる']];
      list.forEach(function (c) {
        var b = el('button', 'btn cmd', c[1]);
        if (c[0] === 'magic') { b.appendChild(el('small', '', 'MP2・リスニングで2倍')); if (S.mp < 2) b.disabled = true; }
        if (c[0] === 'item' && !(S.items.herb || S.items.tea || S.items.ink)) b.disabled = true;
        if (c[0] === 'run' && B.boss) b.disabled = true;
        b.addEventListener('click', function () { beep(SFX.sel); res(c[0]); });
        cmds.appendChild(b);
      });
      setTimeout(function () { var f = cmds.querySelector('button:not([disabled])'); if (f) f.focus(); }, 20);
    });
  }
  function chooseItem() {
    return new Promise(function (res) {
      bShow('bcmd'); var cmds = $('bcmd'); cmds.innerHTML = '';
      ['herb', 'tea', 'ink'].forEach(function (id) {
        if (!S.items[id]) return;
        var it = W.ITEMS[id], b = el('button', 'btn cmd', it.name + ' ×' + S.items[id]); b.appendChild(el('small', '', it.desc));
        b.addEventListener('click', function () { res(id); }); cmds.appendChild(b);
      });
      var back = el('button', 'btn cmd', '← もどる'); back.addEventListener('click', function () { res(null); }); cmds.appendChild(back);
      setTimeout(function () { var f = cmds.querySelector('button'); if (f) f.focus(); }, 20);
    });
  }
  function useItem(id) {
    var it = W.ITEMS[id]; S.items[id]--;
    if (it.heal) { var h = Math.min(it.heal, maxHp() - S.hp); S.hp += h; return it.name + 'を使った！ HPが' + h + '回復した。'; }
    if (it.mp) { var m = Math.min(it.mp, maxMp() - S.mp); S.mp += m; return it.name + 'を使った！ MPが' + m + '回復した。'; }
    return '';
  }

  function wordInfo(box, w) {
    box.innerHTML = '';
    var top = el('div', 'wi-top');
    top.appendChild(zh(el('span', 'wi-h', w.h))); top.appendChild(el('span', 'wi-py', w.pinyin));
    var sb = el('button', 'btn icon', '🔊'); sb.setAttribute('aria-label', '音声を聞く');
    sb.addEventListener('click', function (e) { e.stopPropagation(); voice(w, true); });
    top.appendChild(sb);
    box.appendChild(top);
    box.appendChild(el('div', 'wi-ja', w.ja));
    if (w.audioNote) box.appendChild(el('div', 'wi-note', '録音：' + w.audioNote));
  }
  function showNewWord(w) {
    return new Promise(function (res) {
      bShow('bcard');
      wordInfo($('bcard-word'), w);
      $('bcard-title').textContent = B.practice ? '新しいことば' : '新しいことばを見つけた！';
      setTimeout(function () { voice(w); }, 150);
      var b = $('bcard-ok');
      advance = function () { advance = null; res(); };
      b.onclick = function () { if (advance) advance(); };
      setTimeout(function () { b.focus(); }, 20);
    });
  }

  var TYPE_LABEL = { h2ja: '意味はどれ？', ja2h: '中国語はどれ？', h2py: 'ピンインはどれ？', listen: '聞こえたことばはどれ？', tone: '声調が正しいのはどれ？' };
  var lastQ = null;
  function askQuestion(q) {
    lastQ = q;
    return new Promise(function (res) {
      bShow('bq'); $('battle').scrollTop = 0;
      $('bq-type').textContent = TYPE_LABEL[q.type];
      var main = $('bq-main'); main.innerHTML = ''; main.className = 'bq-main' + (q.type === 'ja2h' ? ' ja' : '');
      if (q.type === 'ja2h' || q.type === 'listen') main.removeAttribute('lang'); else main.setAttribute('lang', 'zh-CN');
      battleListen = null;
      if (q.type === 'listen') {
        var lb = el('button', 'btn listen', '🔊 もう一度聞く');
        battleListen = function () { voice(q.word, true); };
        lb.addEventListener('click', battleListen); main.appendChild(lb);
        setTimeout(function () { voice(q.word, true); }, 200);
      } else {
        main.textContent = q.main;
        if (q.type === 'tone' && q.sub) main.appendChild(el('div', 'bq-sub', q.sub));
      }
      var box = $('bchoices'); box.innerHTML = '';
      $('bq-info').hidden = true;
      q.choices.forEach(function (c, i) {
        var b = el('button', 'btn choice' + (q.type === 'ja2h' || q.type === 'listen' ? ' han' : ''));
        if (q.type === 'ja2h' || q.type === 'listen') zh(b);
        if (q.type === 'h2py' || q.type === 'tone') b.classList.add('py');
        b.appendChild(el('span', 'num', String(i + 1)));
        b.appendChild(el('span', '', c));
        b.addEventListener('click', function () {
          Array.prototype.forEach.call(box.children, function (x) { x.disabled = true; });
          battleListen = null;
          res(i);
        });
        box.appendChild(b);
      });
      setTimeout(function () { if (box.firstChild) box.firstChild.focus(); }, 30);
    });
  }
  function showResult(q, idx, ok) {
    var box = $('bchoices');
    Array.prototype.forEach.call(box.children, function (b, i) {
      if (i === q.answer) b.classList.add('right');
      else if (i === idx) b.classList.add('wrong');
    });
    var info = $('bq-info'); info.hidden = false; wordInfo(info, q.word);
    setTimeout(function () { ensureVisible(info); }, 0);
    if (!ok && q.owners && q.owners[idx]) {
      var o = q.owners[idx];
      var yours = el('div', 'wi-yours', 'あなたの答え：');
      yours.appendChild(zh(el('span', '', o.h)));
      yours.appendChild(document.createTextNode('（'));
      yours.appendChild(el('span', 'py', o.pinyin));
      yours.appendChild(document.createTextNode('）＝ ' + o.ja));
      info.appendChild(yours);
    }
    voice(q.word);
  }

  // 日本語の意味に同じ漢字がそのまま入っている語（北京＝北京、学校＝学校 など）は、
  // 意味の問題だと答えが見えてしまうので、ピンイン・リスニングの問題にする
  function sameKanji(w) { return w.h.split('').every(function (ch) { return w.ja.indexOf(ch) >= 0; }); }
  function soundType(w) { return w.listenable && Math.random() < 0.5 ? 'listen' : 'h2py'; }
  function typeFor(w, cmd, isNew) {
    if (cmd === 'magic') return w.listenable ? 'listen' : 'h2py';
    var t, st = stars(w);
    if (isNew) t = 'h2ja';
    else if (B.boss) t = pick(['h2ja', 'ja2h', 'h2py', 'listen', 'tone']);
    else if (st === 0) t = 'h2ja';
    else if (st === 1) t = pick(['h2ja', 'ja2h']);
    else t = pick(['ja2h', 'h2py', 'h2ja', 'listen']);
    if ((t === 'h2ja' || t === 'ja2h') && sameKanji(w)) t = soundType(w);
    return t;
  }
  // 次に出すことば。戦闘では「くりかえしデッキ」から順番に（新しいことばは1回の戦闘で2つまで）。
  // 先生の授業・ふくしゅうでは、決まった順番（B.list）で出す
  function nextWord() {
    var w;
    if (B.list) { w = B.list[B.li++]; return { w: w, isNew: !seen(w) }; }
    var qn = B.qn++;
    var un = selWords().filter(function (x) { return !seen(x); });
    // 1問目と3問目は、まだ見つけていないことばがあれば新しいことば（1回の戦闘で2つまで）
    if (un.length && B.newCount < 2 && (qn === 0 || qn === 2)) { B.newCount++; return { w: pick(un), isNew: true }; }
    w = drawWord();
    if (!w) { B.newCount++; return { w: pick(un), isNew: true }; } // まだ1つも見つけていないとき
    return { w: w, isNew: false };
  }

  function openBattle(cfg) {
    B = cfg; B.combo = 0; B.newCount = 0; B.li = 0; B.qn = 0;
    mode = 'battle'; bShow(null); bmsg(''); $('battle').hidden = false; $('battle').classList.toggle('practice', !!B.practice);
    $('battle').scrollTop = 0; sizeBattle();
    bUpdate(); battleLoop();
  }
  function closeBattle() { B = null; battleListen = null; advance = null; $('battle').hidden = true; mode = 'map'; updateHud(); save(); }

  async function ask(cmd) {
    var nw = nextWord(), w = nw.w;
    if (nw.isNew) { markSeen(w); updateHud(); await showNewWord(w); }
    lastId = w.id;
    var q = Q().make(w, typeFor(w, cmd, nw.isNew));
    var idx = await askQuestion(q);
    var ok = idx === q.answer;
    schedSync(); record(w, ok, nw.isNew); schedule(w, ok, nw.isNew);
    // 授業・ふくしゅうでまちがえたことばは、最後にもう一度
    if (!ok && B.list && (B.extra = (B.extra || 0) + 1) <= 6) B.list.push(w);
    showResult(q, idx, ok);
    beep(ok ? SFX.ok : SFX.ng);
    return { ok: ok, q: q };
  }

  async function encounter() {
    if (!M.area) return;
    if (S.sel.length < MIN_SEL) { openPicker(true); return; }
    var area = W.AREAS[M.area], t = area.tier, m = pick(area.monsters);
    // 1回の戦闘でだいたい4問答えるように、HPはこちらの攻撃力に合わせる（レベルが上がっても問題数がへらない）
    var hp = Math.round(Math.max(TIER.hp[t], (atk() + 1) * 3.6) * (0.9 + Math.random() * 0.2));
    beep(SFX.enc);
    openBattle({ sp: m.sp, name: m.name, bg: area.bg, enemyHp: hp, enemyMax: hp, eatk: TIER.atk[t], tier: t,
      exp: TIER.exp[t], gold: TIER.gold[t] + rnd(TIER.gold[t]) });
    await bsay(m.name + ' があらわれた！', 900);
    await fightLoop();
  }
  async function talkBoss() {
    var area = W.AREAS[M.area], n = M.area, bp = bossProgress(n);
    if (bp.total < MIN_SEL || bp.done < bp.total) {
      dialog([{ name: area.boss.name, text: '……（すがたがぼんやりしている）' },
        { text: 'ボスと戦う条件：えらんだことばを「' + needLabel(n) + '」。\nいま ' + bp.done + ' / ' + bp.total + '。草むらで戦ったり、先生と練習したりして、くりかえし覚えよう。' }]);
      return;
    }
    dialog(area.boss.intro.map(withName(area.boss.name)).concat([{ name: area.boss.name, text: '戦いますか？（にげられません）', choices: [
      { label: '戦う！', fn: startBoss }, { label: 'じゅんびする', fn: function () { } }] }]));
  }
  async function startBoss() {
    var n = M.area, area = W.AREAS[n], t = area.tier, hp = Math.max(area.boss.hits * TIER.boss[t], area.boss.hits * (atk() + 1));
    beep(SFX.enc);
    openBattle({ sp: area.boss.sp, name: area.boss.name, bg: area.bg, boss: true, enemyHp: hp, enemyMax: hp,
      eatk: Math.round(TIER.atk[t] * 1.3), tier: t, exp: TIER.exp[t] * 6, gold: TIER.gold[t] * 8, area: n });
    await bsay('ボス「' + area.boss.name + '」との戦い！', 1100);
    await fightLoop();
  }

  async function fightLoop() {
    while (true) {
      bmsg('コマンドをえらんでください');
      var cmd = await chooseCommand();
      if (cmd === 'run') {
        if (Math.random() < 0.75) { await bsay('うまくにげきれた！', 900); closeBattle(); return; }
        await bsay('にげられなかった！', 700);
        if (await enemyAttack()) return;
        continue;
      }
      if (cmd === 'item') {
        var id = await chooseItem(); if (!id) continue;
        await bsay(useItem(id), 1100); bUpdate(); continue;
      }
      if (cmd === 'magic') { S.mp -= 2; bUpdate(); }
      bmsg(cmd === 'magic' ? 'こえの魔法！ よく聞いて答えよう' : 'ことばで攻撃！');
      var r = await ask(cmd);
      if (r.ok) {
        B.combo++;
        var dmg = atk() + rnd(3);
        var note = '';
        if (cmd === 'magic') { dmg *= 2; note = '魔法が決まった！ '; }
        if (B.combo >= 3) { dmg = Math.round(dmg * 1.5); note += B.combo + 'コンボ！ '; }
        B.enemyHp -= dmg; beep(SFX.hit); B.flash = true; setTimeout(function () { if (B) B.flash = false; }, 400);
        bUpdate();
        bmsg('せいかい！ ' + note + B.name + 'に ' + dmg + ' のダメージ！');
        await wait(1300);
        if (B.enemyHp <= 0) { await victory(); return; }
      } else {
        B.combo = 0; bUpdate();
        bmsg('ざんねん… 正解をたしかめよう');
        await tapNext(null, true);
        if (await enemyAttack()) return;
      }
    }
  }
  async function enemyAttack() {
    var d = Math.max(1, B.eatk - def() + rnd(3) - 1);
    S.hp = Math.max(0, S.hp - d); beep(SFX.hurt);
    $('battle').classList.add('hurt'); setTimeout(function () { $('battle').classList.remove('hurt'); }, 400);
    bUpdate();
    await bsay(B.name + ' のこうげき！ ' + d + ' のダメージをうけた。', 1100);
    if (S.hp <= 0) { await defeat(); return true; }
    return false;
  }
  async function victory() {
    beep(SFX.win); S.wins++;
    var ups = gainExp(B.exp); S.gold += B.gold; bUpdate();
    await bsay(B.name + ' をたおした！ ' + B.exp + ' EXP と ' + B.gold + ' G を手に入れた。');
    if (ups) { beep(SFX.lvup); await bsay('レベルが ' + S.lv + ' に上がった！ HP・MPが全回復した。'); }
    if (B.boss) {
      var n = B.area, area = W.AREAS[n];
      S.boss[n] = true;
      var outro = area.boss.outro.map(withName(area.boss.name));
      closeBattle();
      var next = W.AREAS[n + 1];
      var pages = outro.concat([{ text: 'ことばの宝珠を取りもどした！（' + n + ' / 4）' }]);
      if (next) pages.push({ text: '村の道がひらけた。「' + next.name + '」へ行けるようになった！' });
      dialog(pages, function () {
        if (area.boss.final) { S.cleared = true; save(); showEnding(); }
        else fade(function () { S.hp = maxHp(); S.mp = maxMp(); setMap('village', 11, 8, 'down'); });
      });
      return;
    }
    closeBattle();
  }
  async function defeat() {
    await bsay('目の前がまっくらになった……');
    closeBattle();
    S.gold = Math.floor(S.gold / 2); S.hp = maxHp(); S.mp = maxMp();
    fade(function () { setMap('village', 5, 13, 'up'); });
    setTimeout(function () { dialog([withName('宿屋の人')(W.zh('没关系！', 'Méi guānxi!', 'だいじょうぶ！')), { text: '村の宿屋で目がさめた。（お金が半分になった）\nまちがえたことばは、王先生とふくしゅうできるよ。' }]); }, 600);
  }

  /* ================= 先生の授業・ふくしゅう ================= */
  // まだ見つけていないことばを5つ：カードで覚えて答える → 順番をかえてもう一度（1語2回ずつ）
  function lesson(n) {
    var unseen = selWords().filter(function (w) { return !seen(w); }).slice(0, 5);
    if (!unseen.length) return;
    practice({ title: n.name + 'の授業', sp: 'teacher', list: unseen.concat(shuffle(unseen)), intro: true });
  }
  async function practice(cfg) {
    if (!cfg.list.length) return;
    openBattle({ practice: true, sp: cfg.sp, name: cfg.title, bg: 'village', enemyHp: 1, enemyMax: 1, list: cfg.list.slice() });
    var right = 0, total = 0;
    await bsay(cfg.intro ? 'まず新しいことばをおぼえて、つづけて練習しよう！' : '練習をはじめます。まちがえたことばは、もう一度出ます。', 1000);
    while (B.li < B.list.length) {
      bmsg((B.li + 1) + ' / ' + B.list.length);
      var r = await ask('fight'); total++;
      if (r.ok) { right++; B.combo++; bUpdate(); await wait(1200); }
      else { B.combo = 0; bUpdate(); await tapNext(null, true); }
    }
    var ex = right * 2, ups = gainExp(ex);
    await bsay(total + '問中 ' + right + '問 正解！ ' + ex + ' EXP を手に入れた。');
    if (ups) { beep(SFX.lvup); await bsay('レベルが ' + S.lv + ' に上がった！'); }
    closeBattle();
  }

  /* ================= メニュー・お店 ================= */
  var panelClose = null;
  function openPanel(title, build) {
    mode = 'panel';
    var p = $('panel'); p.hidden = false; $('p-title').textContent = title;
    var body = $('p-body'); body.innerHTML = '';
    build(body);
    panelClose = function () { p.hidden = true; panelClose = null; mode = 'map'; updateHud(); save(); };
    setTimeout(function () { var f = p.querySelector('.p-body button, .p-tabs button'); if (f) f.focus(); }, 30);
  }
  $('p-close').addEventListener('click', function () { if (panelClose) panelClose(); });

  function openShop() {
    openPanel('お店', function (body) {
      function render() {
        body.innerHTML = '';
        body.appendChild(el('p', 'p-gold', '所持金：' + S.gold + ' G'));
        W.SHOP.forEach(function (id) {
          var it = W.ITEMS[id] || W.GEAR[id], isGear = !!W.GEAR[id];
          var row = el('div', 'shop-row');
          var nm = el('div', 'shop-name'); nm.appendChild(el('b', '', it.name)); nm.appendChild(el('small', '', it.desc + (isGear ? '' : '（持っている数：' + (S.items[id] || 0) + '）')));
          row.appendChild(nm);
          var b = el('button', 'btn', it.price + ' G');
          if (isGear && S.owned[id]) { b.textContent = S[it.slot] === id ? 'そうび中' : '持っている'; b.disabled = true; }
          else if (S.gold < it.price) b.disabled = true;
          b.addEventListener('click', function () {
            S.gold -= it.price; beep(SFX.chest);
            if (isGear) { S.owned[id] = true; if (equipIfBetter(id)) toast(it.name + ' をそうびした！'); else toast(it.name + ' を買った'); }
            else { S.items[id] = (S.items[id] || 0) + 1; toast(it.name + ' を買った'); }
            save(); render(); var f = body.querySelector('button:not([disabled])'); if (f) f.focus();
          });
          row.appendChild(b); body.appendChild(row);
        });
      }
      render();
    });
  }

  /* ================= ことばをえらぶ ================= */
  // required：えらぶまで閉じられない（はじめから・旧データのとき）
  function openPicker(required, onDone) {
    var draft = { level: S.level, ids: {} };
    var init = S.sel;
    if (!S.sel.length && required) {
      // はじめて：サイトで学んでいる級と20語を、最初からえらんでおく（なければ1つ目のグループ）
      draft.level = startLevel();
      var st0 = siteStudy(draft.level);
      init = st0 && st0.group.length ? st0.group : RW.level(draft.level).groups[0].words.map(function (w) { return w.id; });
    }
    init.forEach(function (id) { draft.ids[id] = true; });
    var open = {};
    openPanel('ことばをえらぶ', function (body) {
      function count() { return Object.keys(draft.ids).length; }
      function render() {
        var keepScroll = $('panel').scrollTop;
        body.innerHTML = '';
        body.appendChild(el('p', 'pick-note', 'えらんだことばだけが、戦闘や先生の練習で何度もくりかえし出ます。おすすめは10〜40語（1〜2グループ）。少ないほど、同じことばにたくさん会えます。'));
        // 級
        var lv = el('div', 'pick-levels');
        for (var n = 1; n <= 6; n++) (function (n) {
          var b = el('button', 'btn lvbtn' + (draft.level === n ? ' on' : ''));
          b.appendChild(el('b', '', 'HSK' + n)); b.appendChild(el('small', '', RW.count(n) + '語'));
          b.addEventListener('click', function () {
            if (draft.level === n) return;
            draft.level = n; draft.ids = {}; open = {};
            var prev = n === S.level ? S.sel : (S.selBy[n] || []);
            prev.forEach(function (id) { draft.ids[id] = true; });
            render(); $('panel').scrollTop = 0;
          });
          lv.appendChild(b);
        })(n);
        body.appendChild(lv);
        // すばやくえらぶ
        var L = RW.level(draft.level), quick = el('div', 'pick-quick');
        var st = siteStudy(draft.level);
        if (st) {
          var sb = el('button', 'btn small inline site', 'サイトで学習中の20語（' + (st.random ? 'ランダム順 ' : '') + st.from + '–' + st.to + '）');
          sb.addEventListener('click', function () { draft.ids = {}; st.group.forEach(function (id) { draft.ids[id] = true; }); render(); });
          var mb = el('button', 'btn small inline site', 'サイトでまちがえた単語（' + st.wrong.length + '語）');
          mb.disabled = st.wrong.length < MIN_SEL;
          mb.addEventListener('click', function () { draft.ids = {}; st.wrong.forEach(function (id) { draft.ids[id] = true; }); render(); });
          quick.appendChild(sb); quick.appendChild(mb);
        }
        var weak = L.words.filter(function (w) { return seen(w) && stars(w) < 3; }).sort(function (a, b) { return stars(a) - stars(b); }).slice(0, 20);
        var wb = el('button', 'btn small inline', '★が少ないことば（' + weak.length + '語）');
        wb.disabled = weak.length < MIN_SEL;
        wb.addEventListener('click', function () { draft.ids = {}; weak.forEach(function (w) { draft.ids[w.id] = true; }); render(); });
        var cb = el('button', 'btn small inline', 'ぜんぶ外す');
        cb.addEventListener('click', function () { draft.ids = {}; render(); });
        quick.appendChild(wb); quick.appendChild(cb); body.appendChild(quick);
        body.appendChild(el('p', 'pick-note', 'グループはHSK単語サイトの単語一覧（ピンイン順・20語ずつ）と同じです。▾で1語ずつえらべます。'));
        // グループ
        L.groups.forEach(function (g) {
          var nsel = g.words.filter(function (w) { return draft.ids[w.id]; }).length;
          var row = el('div', 'pick-group' + (nsel ? ' some' : ''));
          var main = el('button', 'pick-main');
          main.appendChild(el('span', 'pick-check', nsel === g.words.length ? '☑' : nsel ? '◩' : '☐'));
          var txt = el('span', 'pick-txt');
          txt.appendChild(el('b', '', g.label));
          txt.appendChild(zh(el('span', 'pick-han', g.words.slice(0, 6).map(function (w) { return w.h; }).join(' ') + ' …')));
          main.appendChild(txt);
          main.appendChild(el('span', 'pick-n', nsel + '/' + g.words.length));
          main.addEventListener('click', function () {
            var all = nsel === g.words.length;
            g.words.forEach(function (w) { if (all) delete draft.ids[w.id]; else draft.ids[w.id] = true; });
            render();
          });
          var ex = el('button', 'pick-exp', open[g.index] ? '▴' : '▾'); ex.setAttribute('aria-label', g.label + ' の単語を1語ずつえらぶ');
          ex.addEventListener('click', function () { open[g.index] = !open[g.index]; render(); });
          row.appendChild(main); row.appendChild(ex); body.appendChild(row);
          if (open[g.index]) {
            var chips = el('div', 'pick-chips');
            g.words.forEach(function (w) {
              var c = el('button', 'chip' + (draft.ids[w.id] ? ' on' : ''));
              c.appendChild(zh(el('span', 'ch', w.h))); c.appendChild(el('span', 'cp', w.pinyin));
              if (seen(w)) c.appendChild(el('span', 'cs', '★★★'.slice(0, stars(w)) + '☆☆☆'.slice(0, 3 - stars(w))));
              c.addEventListener('click', function () { if (draft.ids[w.id]) delete draft.ids[w.id]; else draft.ids[w.id] = true; render(); });
              chips.appendChild(c);
            });
            body.appendChild(chips);
          }
        });
        // 決定
        var foot = el('div', 'pick-foot'), n0 = count();
        foot.appendChild(el('div', 'pick-count', 'HSK' + draft.level + '・えらんだことば ' + n0 + '語' +
          (n0 < MIN_SEL ? '（' + MIN_SEL + '語以上えらんでください）' : n0 > 60 ? '（多いと1語あたりの回数がへります）' : '')));
        var ok = el('button', 'btn primary', 'このことばで冒険する ▶︎'); ok.disabled = n0 < MIN_SEL;
        ok.addEventListener('click', apply);
        foot.appendChild(ok); body.appendChild(foot);
        $('panel').scrollTop = keepScroll;
      }
      render();
    });
    function apply() {
      if (S.level !== draft.level) S.selBy[S.level] = S.sel;
      S.level = draft.level;
      var order = RW.level(S.level).words;
      S.sel = order.filter(function (w) { return draft.ids[w.id]; }).map(function (w) { return w.id; });
      S.selBy[S.level] = S.sel;
      close(); toast('HSK' + S.level + '・' + S.sel.length + '語で冒険します！');
      onDone && onDone();
    }
    function close() { $('panel').hidden = true; panelClose = null; mode = 'map'; updateHud(); save(); }
    panelClose = function () {
      if (required && S.sel.length < MIN_SEL) { toast('ことばをえらんで、下の「このことばで冒険する」を押してください'); return; }
      close();
    };
  }

  function openMenu() {
    openPanel('メニュー', function (body) {
      var tabs = el('div', 'p-tabs'), content = el('div', 'p-content');
      var TABS = [['status', 'ステータス'], ['items', 'どうぐ'], ['dex', 'ことば'], ['opt', 'せってい']];
      TABS.forEach(function (t) {
        var b = el('button', 'btn tab', t[1]); b.addEventListener('click', function () { show(t[0]); }); tabs.appendChild(b);
      });
      body.appendChild(tabs); body.appendChild(content);
      function show(k) {
        Array.prototype.forEach.call(tabs.children, function (b, i) { b.classList.toggle('on', TABS[i][0] === k); });
        content.innerHTML = '';
        if (k === 'status') statusTab(content);
        if (k === 'items') itemsTab(content);
        if (k === 'dex') dexTab(content);
        if (k === 'opt') optTab(content);
      }
      show('status');
    });
  }
  function star3() { return selWords().filter(function (w) { return stars(w) === 3; }).length; }
  function statusTab(c) {
    var rows = [['レベル', S.lv], ['HP', S.hp + ' / ' + maxHp()], ['MP', S.mp + ' / ' + maxMp()], ['こうげき', atk()], ['ぼうぎょ', def()],
      ['EXP', S.exp + ' / ' + nextExp() + '（次のレベルまで ' + (nextExp() - S.exp) + '）'], ['お金', S.gold + ' G'],
      ['ぶき', S.weapon ? W.GEAR[S.weapon].name : 'なし'], ['ぼうぐ', S.armor ? W.GEAR[S.armor].name : 'なし'],
      ['えらんだことば', 'HSK' + S.level + '・' + S.sel.length + '語（★3：' + star3() + '語）'],
      ['これまでに見つけたことば', Object.keys(S.words).length + '語（全級）'],
      ['宝珠', Object.keys(S.boss).length + ' / 4']];
    var t = el('table', 'stat');
    rows.forEach(function (r) { var tr = el('tr'); tr.appendChild(el('th', '', r[0])); tr.appendChild(el('td', '', String(r[1]))); t.appendChild(tr); });
    c.appendChild(t);
    var gear = Object.keys(S.owned);
    if (gear.length) {
      c.appendChild(el('h3', '', 'そうびをかえる'));
      gear.forEach(function (id) {
        var g = W.GEAR[id], b = el('button', 'btn small', (S[g.slot] === id ? '✔ ' : '') + g.name + '（' + g.desc + '）');
        b.addEventListener('click', function () { S[g.slot] = id; save(); c.innerHTML = ''; statusTab(c); });
        c.appendChild(b);
      });
    }
  }
  function itemsTab(c) {
    var any = false;
    ['herb', 'tea', 'ink'].forEach(function (id) {
      if (!S.items[id]) return; any = true;
      var it = W.ITEMS[id], b = el('button', 'btn small', it.name + ' ×' + S.items[id] + '　使う（' + it.desc + '）');
      b.addEventListener('click', function () { toast(useItem(id)); updateHud(); save(); c.innerHTML = ''; itemsTab(c); });
      c.appendChild(b);
    });
    if (!any) c.appendChild(el('p', '', 'どうぐを持っていません。村のお店で買えます。'));
  }
  function dexTab(c) {
    var pb = el('button', 'btn small', '✎ HSKの級・ことばをえらびなおす');
    pb.addEventListener('click', function () { openPicker(false); });
    c.appendChild(pb);
    c.appendChild(el('p', 'dex-note', 'タップすると音声と意味が出ます。★は「間をあけて正解」するとふえ、まちがえるとへります（最大★3）。'));
    var detail = el('div', 'dex-detail'); detail.hidden = true;
    var ws = selWords(), f = ws.filter(seen).length;
    c.appendChild(el('h3', '', 'えらんだことば（HSK' + S.level + '）　見つけた ' + f + '/' + ws.length + '・★3 ' + star3()));
    var grid = el('div', 'dex');
    ws.forEach(function (w) {
      var known = seen(w), b = el('button', 'dex-cell' + (known ? '' : ' unknown'));
      b.appendChild(known ? zh(el('span', 'dh', w.h)) : el('span', 'dh', '？'));
      b.appendChild(el('span', 'ds', known ? '★★★'.slice(0, stars(w)) + '☆☆☆'.slice(0, 3 - stars(w)) : ''));
      if (!known) b.disabled = true;
      b.addEventListener('click', function () {
        detail.hidden = false; wordInfo(detail, w);
        var r = rec(w); detail.appendChild(el('div', 'wi-note', '正解 ' + r.c + '回・まちがい ' + r.w + '回'));
        voice(w, true);
        grid.parentNode.insertBefore(detail, grid.nextSibling);
      });
      grid.appendChild(b);
    });
    c.appendChild(grid);
    c.appendChild(el('h3', '', '級ごとの見つけたことば'));
    var t = el('table', 'stat');
    for (var n = 1; n <= 6; n++) { var tr = el('tr'); tr.appendChild(el('th', '', 'HSK' + n)); tr.appendChild(el('td', '', seenCount(n) + ' / ' + RW.count(n))); t.appendChild(tr); }
    c.appendChild(t);
  }
  function optTab(c) {
    function toggle(label, key) {
      var b = el('button', 'btn small', label + '：' + (S.opt[key] ? 'オン' : 'オフ'));
      b.addEventListener('click', function () { S.opt[key] = !S.opt[key]; save(); c.innerHTML = ''; optTab(c); });
      c.appendChild(b);
    }
    toggle('答えたあとに音声を流す', 'voice');
    toggle('効果音', 'sfx');
    var PADL = { auto: '自動（タッチできる端末で表示）', on: 'いつも表示', off: '表示しない' }, cur = S.opt.pad || 'auto';
    var pb = el('button', 'btn small', '画面の十字ボタン・Aボタン：' + PADL[cur]);
    pb.addEventListener('click', function () { S.opt.pad = cur === 'auto' ? 'on' : cur === 'on' ? 'off' : 'auto'; save(); layout(); c.innerHTML = ''; optTab(c); });
    c.appendChild(pb);
    c.appendChild(el('p', 'dex-note', '記録はこの端末のブラウザに自動で保存されます（サーバーには送りません）。'));
    var t = el('button', 'btn small', 'タイトルにもどる');
    t.addEventListener('click', function () { save(); location.reload(); });
    c.appendChild(t);
    var r = el('button', 'btn small danger', '記録を消して最初から');
    r.addEventListener('click', function () {
      askConfirm('記録をすべて消して、最初からはじめますか？\n（レベル・お金・ことばの★がすべて消えます）', '消して最初から', function () { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } location.reload(); });
    });
    c.appendChild(r);
  }

  /* ================= タイトル・エンディング ================= */
  function showEnding() {
    mode = 'ending';
    var e = $('ending'); e.hidden = false;
    $('end-stats').textContent = 'レベル ' + S.lv + '・HSK' + S.level + ' のえらんだことば ' + S.sel.length + '語がすべて★3・勝利 ' + S.wins + '回';
    $('end-ok').onclick = function () { e.hidden = true; S.hp = maxHp(); S.mp = maxMp(); setMap('village', 11, 8, 'down'); mode = 'map'; };
    setTimeout(function () { $('end-ok').focus(); }, 50);
  }
  function startGame(data, isNew) {
    S = data;
    if (S.hp > maxHp()) S.hp = maxHp();
    $('title').hidden = true; $('game').hidden = false;
    setMap(S.map, S.x, S.y, S.dir);
    layout();
    mode = 'map';
    var how = showPad()
      ? '十字ボタンで歩き、A ボタンで話す・調べる。地図をタップしても、その場所へ歩けます。\n右上の「≡ メニュー」でメニュー。まずは村長に話しかけよう。'
      : '矢印キー（WASD）で歩き、Enter／スペースで話す・調べる。マウスで行きたい場所や人をクリックしても動けます。\nM／Esc か右上の「≡ メニュー」でメニュー。まずは村長に話しかけよう。';
    if (isNew) dialog([{ text: 'ここは「はじまりの村」。\nわすれんぼう大王に、ことばを持っていかれてしまった村……。' },
      { text: 'まず、勉強したいHSKの級とことばをえらぼう。\nえらんだことばが、モンスターとの戦いで何度もくりかえし出てくるぞ。' }],
      function () { openPicker(true, function () { dialog([{ text: how }]); }); });
    else if (S.sel.length < MIN_SEL) dialog([{ text: 'HSK1〜6級から、勉強することばをえらべるようになりました。\nまず、ことばをえらんでください。' }], function () { openPicker(true); });
  }
  var saved = load();
  $('btn-continue').disabled = !saved;
  if (saved) $('continue-info').textContent = 'Lv' + saved.lv + '・HSK' + saved.level + (saved.sel.length ? '・' + saved.sel.length + '語' : '');
  $('btn-new').addEventListener('click', function () {
    unlockAudio();
    if (saved) askConfirm('前の記録（Lv' + saved.lv + '）は消えます。はじめからはじめますか？', 'はじめから', function () { startGame(newGame(), true); });
    else startGame(newGame(), true);
  });
  // LINE・Instagram・Facebook・WeChat などのアプリ内ブラウザ：記録が消えやすいので、ふつうのブラウザをすすめる
  (function () {
    var ua = navigator.userAgent || '';
    if (!/\bLine\/|FBAN|FBAV|Instagram|MicroMessenger|; wv\)/i.test(ua)) return;
    var n = el('p', 'inapp', 'アプリの中のブラウザで開いています。記録が消えることがあるので、右上のメニューなどから「Safari」や「Chrome」で開きなおすのがおすすめです。');
    $('title').insertBefore(n, $('title').firstChild);
  })();
  $('btn-continue').addEventListener('click', function () { unlockAudio(); if (saved) startGame(saved, false); });
  setTimeout(function () { ($('btn-continue').disabled ? $('btn-new') : $('btn-continue')).focus(); }, 50);

  // タイトルのドット絵（小さくかいてから、画面のピクセル数に合わせて拡大）
  var tOff = document.createElement('canvas'); tOff.width = 122; tOff.height = 20;
  (function () { var c = tOff.getContext('2d'); ['hero_down', 'inkblob', 'mushroom', 'bat', 'ghost', 'king'].forEach(function (n, i) { c.drawImage(SP.get(n), i * 20 + 2, 2, 16, 16); }); })();
  function titleArt() {
    var t = $('title-art'); if ($('title').hidden || !t.clientWidth) return;
    fitBacking(t, t.clientWidth, 20 / 122); present(t, t.getContext('2d'), tOff);
  }
  titleArt();

  requestAnimationFrame(tick);

  // テスト用
  window.__rpg = { get S() { return S; }, get mode() { return mode; }, get B() { return B; }, get q() { return lastQ; }, setSel: function (level, ids) { S.level = level; S.sel = ids; S.selBy[level] = ids; updateHud(); }, picker: function (r) { openPicker(r); }, get due() { return dueAt; }, setMap: function (m, x, y) { setMap(m, x, y); }, encounter: function () { return encounter(); }, startBoss: function () { return startBoss(); }, walkTo: function (x, y) { walkTo(x, y); }, get pos() { return [S.x, S.y, S.dir]; }, get camera() { return cam; }, set noEncounter(v) { noEncounter = v; }, layout: function () { layout(); }, siteStudy: function (l) { return siteStudy(l); } };
})();
