/* HSKもじバトル — ゲーム本体（HSKサイト版。単語と音声はサイトの data/vocab.js と audio/ を使う） */
(function () {
  'use strict';
  var MAX_HP = 5, SMALL_TIME = 15, BOSS_TIME = 20, MID_HITS = 3, BOSS_HITS = 5, PAGE_SIZE = 20;
  var KEY = 'hskMojiBattle.site.v1';
  var $ = function (id) { return document.getElementById(id); };
  var COUNTS = GameLevels.counts();

  /* ---------- 保存（級ごとに記録） ---------- */
  var save = load();
  function blankLevel() { return { unlocked: 0, cleared: {}, best: {}, miss: {} }; }
  function load() {
    var d = { level: 1, tutorial: false, levels: {}, settings: { timer: true, autoplay: true, speed: 1 } };
    try {
      var x = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (x && typeof x === 'object') {
        if (x.level >= 1 && x.level <= 6) d.level = Math.floor(x.level);
        d.tutorial = x.tutorial === true;
        if (x.settings && typeof x.settings === 'object') for (var k in x.settings) d.settings[k] = x.settings[k];
        if (x.levels && typeof x.levels === 'object') d.levels = x.levels;
      }
    } catch (e) { /* 壊れたデータは無視 */ }
    for (var l = 1; l <= 6; l++) {
      var v = d.levels[l]; var b = blankLevel();
      if (v && typeof v === 'object') { for (var key in b) if (v[key] !== undefined) b[key] = v[key]; }
      d.levels[l] = b;
    }
    if ([0.75, 1, 1.25].indexOf(d.settings.speed) < 0) d.settings.speed = 1;
    return d;
  }
  function store() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* 容量・プライベートモード */ } }

  /* ---------- 級のデータ ---------- */
  var LEVEL, WORDS, STAGES, STAGE_NAMES, NSTAGE, byStage, byId, LV, page = 0;
  function setLevel(l) {
    l = Math.max(1, Math.min(6, Math.floor(Number(l)) || 1));
    var data = GameLevels.build(l);
    LEVEL = l; WORDS = data.words; STAGES = data.stages; NSTAGE = STAGES.length;
    STAGE_NAMES = STAGES.map(function (s) { return s.name; });
    byStage = STAGES.map(function (s) { return s.words; });
    byId = {}; WORDS.forEach(function (w) { byId[w.id] = w; });
    LV = save.levels[l];
    if (LV.unlocked >= NSTAGE) LV.unlocked = NSTAGE - 1;
    save.level = l; store();
    page = Math.floor(Math.min(LV.unlocked, NSTAGE - 1) / PAGE_SIZE);
    renderLevelPicker();
    $('logo-sub').textContent = 'HSK ' + l + '級・' + WORDS.length + '語';
  }

  /* ---------- 音声（HSKサイトの録音mp3） ---------- */
  var player = new Audio();
  player.preload = 'auto';
  var audioToken = 0, audioUnlocked = false;
  // 無音の短いWAV（iPhoneで最初のタップ時に音声を有効にするため）
  var SILENT = (function () {
    var n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    function s(o, t) { for (var i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); }
    s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, 'data'); v.setUint32(40, n, true);
    for (var i = 0; i < n; i++) b[44 + i] = 128;
    var str = ''; for (i = 0; i < b.length; i++) str += String.fromCharCode(b[i]);
    return 'data:audio/wav;base64,' + btoa(str);
  })();
  function unlockAudio() { // ユーザーのタップの中で一度だけ再生して、以後の自動再生を許可してもらう
    if (audioUnlocked) return;
    audioUnlocked = true;
    try { player.src = SILENT; var p = player.play(); if (p && p.catch) p.catch(function () { audioUnlocked = false; }); } catch (e) { audioUnlocked = false; }
  }
  function audioNote(msg) {
    var n = $('audio-note'); if (!n) return;
    n.textContent = msg || ''; n.classList.toggle('show', !!msg);
    clearTimeout(audioNote.t); if (msg) audioNote.t = setTimeout(function () { n.classList.remove('show'); }, 4000);
  }
  // w の録音を再生する。失敗したら onFail を呼び、やさしい案内を出す（ゲームは止めない）
  function playWord(w, onFail) {
    if (!w) return;
    var token = ++audioToken, failedOnce = false;
    function fail(blocked) {
      if (token !== audioToken || failedOnce) return; failedOnce = true;
      audioNote(blocked ? '🔊 ボタンをタップすると音声が聞けます。' : '音声を読み込めませんでした。通信状態を確認して、🔊 でもう一度ためしてください。');
      if (onFail) onFail(blocked);
    }
    try {
      player.pause();
      player.onerror = function () { fail(false); };
      player.src = GameLevels.audioSrc(w);
      player.playbackRate = save.settings.speed || 1;
      var p = player.play();
      if (p && p.catch) p.catch(function (e) { fail(e && e.name === 'NotAllowedError'); });
    } catch (e) { fail(false); }
  }
  function stopAudio() { audioToken++; try { player.pause(); } catch (e) { } }

  /* ---------- ユーティリティ ---------- */
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- 問題生成 ---------- */
  var TYPES = {
    h2ja: { label: '漢字 → 意味', cls: 'zh', opt: 'ja' },
    h2py: { label: '漢字 → ピンイン（声調つき）', cls: 'zh', opt: 'py' },
    ja2h: { label: '意味 → 漢字', cls: 'ja', opt: 'zh' },
    listen: { label: 'リスニング：聞こえた単語は？', cls: 'zh', opt: 'zh' },
    tone: { label: '声調：正しいのはどれ？', cls: 'zh', opt: 'py' }
  };
  // 意味が近く、選択肢に並ぶと紛らわしい組み合わせ（意味問題では同時に出さない）
  var CONFUSE = [['会', '能'], ['几', '多少'], ['很', '太'], ['看', '看见', '读'], ['老师', '先生'], ['想', '爱', '喜欢'], ['他', '她'], ['那', '那儿'], ['哪', '哪儿'], ['这', '这儿']];
  function confusable(a, b) { return CONFUSE.some(function (g) { return g.indexOf(a.h) >= 0 && g.indexOf(b.h) >= 0; }); }
  function distractorWords(w, n, test) {
    var pool = shuffle((byStage[w.s] || []).filter(function (x) { return x !== w && test(x); }));
    var others = shuffle(WORDS.filter(function (x) { return x.s !== w.s && test(x); }));
    return pool.concat(others).slice(0, n);
  }
  function toneVariants(w) {
    var idx = []; w.syl.forEach(function (s, i) { if (s.tone >= 1 && s.tone <= 4) idx.push(i); });
    if (!idx.length) return [];
    var out = {}, list = [];
    out[w.pinyin] = 1;
    var tries = 0;
    while (list.length < 3 && tries++ < 200) {
      var syl = w.syl.map(function (s) { return { base: s.base, tone: s.tone, sep: s.sep, cap: s.cap }; });
      var k = tries > 40 && idx.length > 1 ? 2 : 1;
      shuffle(idx).slice(0, k).forEach(function (i) { var t; do { t = 1 + Math.floor(Math.random() * 4); } while (t === w.syl[i].tone); syl[i].tone = t; });
      var r = Pinyin.render(syl);
      if (r && !out[r]) { out[r] = 1; list.push(r); }
    }
    return list;
  }
  function makeQuestion(w, type) {
    var opts, answer, main, sub = '';
    if (type === 'tone' && !w.toneable) type = 'h2py';
    if (type === 'listen' && !w.listenable) type = 'h2ja';
    if (type === 'h2ja') {
      main = w.h; answer = w.ja;
      opts = distractorWords(w, 3, function (x) { return x.ja !== w.ja && !confusable(w, x); }).map(function (x) { return x.ja; });
    } else if (type === 'h2py') {
      main = w.h; answer = w.pinyin;
      // 声調ちがい1つ＋同じ音節数のほかの単語（長さで答えがわからないように）
      var d = toneVariants(w).slice(0, 1), n = w.nsyl;
      var same = distractorWords(w, 40, function (x) { return x.pinyin !== w.pinyin && x.nsyl === n; });
      var rest = distractorWords(w, 40, function (x) { return x.pinyin !== w.pinyin && Math.abs(x.nsyl - n) === 1; });
      same.concat(rest).forEach(function (x) { if (d.length < 3 && d.indexOf(x.pinyin) < 0) d.push(x.pinyin); });
      opts = d;
    } else if (type === 'ja2h') {
      main = w.ja; answer = w.h;
      opts = [];
      distractorWords(w, 40, function (x) { return x.ja !== w.ja && x.h !== w.h && !confusable(w, x); }).forEach(function (x) { if (opts.length < 3 && opts.indexOf(x.h) < 0) opts.push(x.h); });
    } else if (type === 'listen') {
      main = ''; answer = w.h;
      // 同音語（例：他／她）は除外する
      opts = [];
      distractorWords(w, 40, function (x) { return x.plain.toLowerCase() !== w.plain.toLowerCase() && x.h !== w.h; }).forEach(function (x) { if (opts.length < 3 && opts.indexOf(x.h) < 0) opts.push(x.h); });
    } else if (type === 'tone') {
      main = w.h; sub = w.plain; answer = w.pinyin; opts = toneVariants(w);
    }
    var all = shuffle([answer].concat(opts.slice(0, 3)));
    return { word: w, type: type, main: main, sub: sub, choices: all, answer: all.indexOf(answer) };
  }

  /* ---------- 画面 ---------- */
  function show(id) {
    document.querySelectorAll('.screen').forEach(function (e) { e.classList.remove('active'); });
    $('scr-' + id).classList.add('active');
    if (id === 'select') renderSelect();
    if (id !== 'game') stopAudio();
    current = id;
    window.scrollTo(0, 0);
  }
  var current = 'title';
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go]'); if (t) { stopGame(); show(t.getAttribute('data-go')); }
  });

  function renderLevelPicker() {
    var html = '';
    for (var l = 1; l <= 6; l++) {
      html += '<button class="btn lv' + (l === LEVEL ? ' on' : '') + '" data-level="' + l + '" aria-pressed="' + (l === LEVEL) + '"><b>HSK' + l + '</b><small>' + COUNTS[l] + '語</small></button>';
    }
    document.querySelectorAll('.level-picker').forEach(function (el) { el.innerHTML = html; });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-level]'); if (!b) return;
    setLevel(+b.getAttribute('data-level'));
    if (current === 'select') renderSelect();
  });

  function renderSelect() {
    var el = $('stage-list'), html = '';
    $('select-title').textContent = 'HSK ' + LEVEL + '級のステージ';
    var pages = Math.ceil(NSTAGE / PAGE_SIZE);
    if (page >= pages) page = pages - 1;
    if (page === 0) html += '<button class="btn stage-card tut' + (save.tutorial ? ' cleared' : '') + '" data-stage="tutorial"><span class="no">チュートリアル</span><span class="nm">あそびかた</span><span class="meta">' + (save.tutorial ? '✔ クリア' : 'まずはここから（ダメージなし）') + '</span></button>';
    var nm = Object.keys(LV.miss).length;
    var review = '<button class="btn stage-card review" data-stage="review"' + (nm ? '' : ' disabled') + '><span class="no">REVIEW・HSK' + LEVEL + '</span><span class="nm">まちがえた単語を復習</span><span class="meta">' + (nm ? nm + '語が記録されています' : 'まだ記録がありません') + '</span></button>';
    if (page === 0) html += review;
    for (var i = page * PAGE_SIZE; i < Math.min(NSTAGE, (page + 1) * PAGE_SIZE); i++) {
      var locked = !save.tutorial || i > LV.unlocked;
      var words = byStage[i].slice(0, 4).map(function (w) { return w.h; }).join('・');
      html += '<button class="btn stage-card' + (LV.cleared[i] ? ' cleared' : '') + '" data-stage="' + i + '"' + (locked ? ' disabled' : '') + '>' +
        '<span class="no">STAGE ' + (i + 1) + (LV.cleared[i] ? ' ✔' : '') + (locked ? ' 🔒' : '') + '</span><span class="nm">' + esc(STAGE_NAMES[i]) + '</span>' +
        '<span class="meta">' + esc(words) + '… ' + byStage[i].length + '語' + (LV.best[i] ? '／ベスト ' + LV.best[i] : '') + '</span></button>';
    }
    if (page > 0) html += review;
    el.innerHTML = html;
    var pg = $('stage-pager');
    if (pages > 1) {
      pg.style.display = '';
      pg.innerHTML = '<button class="btn small" data-page="-1"' + (page === 0 ? ' disabled' : '') + '>◀ まえ</button>' +
        '<span>' + (page * PAGE_SIZE + 1) + '〜' + Math.min(NSTAGE, (page + 1) * PAGE_SIZE) + '／全' + NSTAGE + 'ステージ</span>' +
        '<button class="btn small" data-page="1"' + (page >= pages - 1 ? ' disabled' : '') + '>つぎ ▶</button>';
    } else { pg.style.display = 'none'; pg.innerHTML = ''; }
    $('select-info').textContent = save.tutorial ? 'クリア ' + Object.keys(LV.cleared).length + '／' + NSTAGE + 'ステージ（' + WORDS.length + '語）' : 'まずチュートリアルをクリアしよう！';
  }
  $('stage-pager').addEventListener('click', function (e) {
    var b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
    page += +b.getAttribute('data-page'); renderSelect(); window.scrollTo(0, 0);
  });
  $('stage-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-stage]'); if (!b || b.disabled) return;
    var v = b.getAttribute('data-stage');
    unlockAudio();
    startStage(v === 'tutorial' ? 'tutorial' : v === 'review' ? 'review' : +v);
  });
  $('btn-start').onclick = function () { unlockAudio(); if (!save.tutorial) startStage('tutorial'); else show('select'); };
  $('btn-review').onclick = function () { unlockAudio(); if (Object.keys(LV.miss).length) startStage('review'); else { $('voice-note').textContent = 'HSK' + LEVEL + '級では、まだまちがえた単語の記録がありません。まずステージをプレイしましょう。'; } };
  $('btn-settings').onclick = function () {
    $('set-timer').checked = !!save.settings.timer; $('set-autoplay').checked = !!save.settings.autoplay;
    $('set-speed').value = String(save.settings.speed); show('settings');
  };
  $('set-timer').onchange = function () { save.settings.timer = this.checked; store(); };
  $('set-autoplay').onchange = function () { save.settings.autoplay = this.checked; store(); };
  $('set-speed').onchange = function () { save.settings.speed = +this.value; store(); };
  $('btn-voicetest').onclick = function () {
    unlockAudio();
    var w = WORDS[0]; $('voice-note2').textContent = '再生中：' + w.h + '（' + w.pinyin + '）';
    playWord(w, function () { $('voice-note2').textContent = '音声を再生できませんでした。通信状態を確認してください。'; });
  };
  $('btn-reset').onclick = function () {
    if (confirm('HSK' + LEVEL + '級のクリア記録・ベストスコア・まちがえた単語の記録を消します。よろしいですか？')) {
      save.levels[LEVEL] = blankLevel(); LV = save.levels[LEVEL]; store(); alert('HSK' + LEVEL + '級の記録を消しました。');
    }
  };

  /* ---------- ゲーム進行 ---------- */
  var G = null;
  var TUT_TIPS = [
    { type: 'h2ja', tip: 'ようこそ！上の漢字の<b>意味</b>を下の4つから選んでね。正解すると攻撃が出るよ。<br>チュートリアル中はまちがえてもダメージなし。' },
    { type: 'h2py', tip: 'つぎは<b>ピンイン</b>。声調記号（ā á ǎ à）までよく見て選ぼう。' },
    { type: 'ja2h', tip: '日本語の意味から<b>漢字</b>を選ぼう。' },
    { type: 'listen', tip: 'ボスは<b>リスニング</b>で攻撃してくる！🔊で何度でも聞けるよ。聞こえた単語を選ぼう。' },
    { type: 'tone', tip: '最後は<b>声調</b>問題。ピンインは同じで、声調だけがちがう4つから選ぼう。ここまでできたらステージ1へ！' }
  ];
  var TUT_L1 = ['你', '谢谢', '我', '再见', '一'];
  function wordByH(h) { for (var i = 0; i < WORDS.length; i++) if (WORDS[i].h === h) return WORDS[i]; }
  function tutorialWords() {
    if (LEVEL === 1) return TUT_L1.map(wordByH);
    var used = [], ws = byStage[0].concat(byStage[1] || []);
    return TUT_TIPS.map(function (t) {
      var w = ws.filter(function (x) { return used.indexOf(x) < 0 && (t.type !== 'listen' || x.listenable) && (t.type !== 'tone' || x.toneable); })[0] || ws[0];
      used.push(w); return w;
    });
  }

  function startStage(id) {
    stopGame();
    var g = G = {
      id: id, level: LEVEL, hp: MAX_HP, score: 0, combo: 0, answered: 0, correct: 0, missWords: {}, queue: [], phase: 'small',
      q: null, locked: false, timeLeft: 0, timeMax: 0, paused: false, over: false, enemy: null, bossHits: 0, retries: {}
    };
    var smallTypes = ['h2ja', 'h2py', 'ja2h'];
    if (id === 'tutorial') {
      g.words = tutorialWords();
      g.queue = TUT_TIPS.map(function (t, i) { return { w: g.words[i], type: t.type, tip: t.tip, kind: i >= 3 ? 'boss' : 'small' }; });
      g.phase = 'tutorial';
    } else {
      var ws;
      if (id === 'review') {
        ws = Object.keys(LV.miss).map(function (k) { return { w: byId[k], n: LV.miss[k] }; }).filter(function (x) { return x.w; })
          .sort(function (a, b) { return b.n - a.n; }).slice(0, 12).map(function (x) { return x.w; });
      } else ws = byStage[id];
      g.words = ws;
      var order = shuffle(ws);
      g.queue = order.map(function (w, i) { return { w: w, type: smallTypes[i % 3], kind: 'small' }; });
      g.midAt = order.length >= 6 ? Math.ceil(order.length / 2) : 0;
    }
    g.theme = Art.THEMES[(typeof id === 'number' ? id : id === 'review' ? 4 : 0) % Art.THEMES.length];
    $('hud-stage').textContent = 'HSK' + LEVEL + '　' + (id === 'tutorial' ? 'チュートリアル' : id === 'review' ? '復習' : 'STAGE ' + (id + 1));
    $('hud-stage').title = typeof id === 'number' ? STAGE_NAMES[id] : '';
    show('game');
    scene.reset(g);
    renderHP(); renderScore();
    banner(id === 'tutorial' ? 'あそびかた' : id === 'review' ? '復習スタート！' : 'STAGE ' + (id + 1) + ' スタート！', 1200);
    setTimeout(function () { if (G === g) nextQuestion(); }, 900);
    loopStart();
  }
  function stopGame() { if (G) { G.over = true; } G = null; clearTimers(); $('pause').classList.remove('show'); }
  var timers = [];
  function later(fn, ms) { var g = G; timers.push(setTimeout(function () { if (G === g && !g.over) fn(); }, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function nextQuestion() {
    var g = G; if (!g || g.over) return;
    var item;
    if (g.phase === 'tutorial') {
      item = g.queue[0];
      if (!item) return finish(true);
    } else if (g.phase === 'small') {
      if (g.midAt && g.doneSmall === g.midAt && !g.midDone) { g.phase = 'mid'; g.bossHits = 0; spawnEnemy('mid'); banner('中ボス出現！', 1100); return later(nextQuestion, 1100); }
      item = g.queue.shift();
      if (!item) { g.phase = 'boss'; g.bossHits = 0; spawnEnemy('boss'); banner('ボス出現！！', 1300); return later(nextQuestion, 1300); }
    }
    if (g.phase === 'mid') {
      item = { w: pick(g.words), type: pick(['ja2h', 'h2py', 'h2ja']), kind: 'mid' };
    }
    if (g.phase === 'boss') {
      var bt = (g.bossTry || 0) % 5 < 3 ? 'listen' : 'tone';
      var cand = g.words.filter(function (w) { return bt === 'listen' ? w.listenable : w.toneable; });
      item = { w: pick(cand.length ? cand : g.words), type: bt, kind: 'boss' };
      g.bossTry = (g.bossTry || 0) + 1;
    }
    g.item = item;
    if (item.kind === 'small' && (!g.enemy || g.enemy.dead || g.enemy.flee)) spawnEnemy('small');
    if (item.kind === 'boss' && g.phase === 'tutorial' && (!g.enemy || g.enemy.kind !== 'boss')) { spawnEnemy('boss'); }
    ask(makeQuestion(item.w, item.type), item);
  }

  function ask(q, item) {
    var g = G; g.q = q; g.locked = false;
    var T = TYPES[q.type];
    $('q-kind').textContent = T.label + (item.kind === 'boss' ? '（ボス）' : item.kind === 'mid' ? '（中ボス）' : '');
    var tip = $('tut-tip'); if (item.tip) { tip.innerHTML = item.tip; tip.classList.add('show'); } else tip.classList.remove('show');
    var main = $('q-main'); main.className = 'q-main ' + T.cls;
    main.textContent = q.main;
    if (T.cls === 'ja' && q.main.length > 12) main.className += ' long';
    main.lang = T.cls === 'zh' ? 'zh-CN' : 'ja';
    $('q-sub').textContent = q.sub;
    var fb = $('q-feedback'); fb.textContent = ''; fb.className = 'q-feedback';
    var play = $('btn-play');
    if (q.type === 'listen') {
      main.textContent = '🔊'; play.classList.add('show'); $('q-sub').textContent = '';
      later(function () { playWord(q.word, function (blocked) { if (!blocked && G === g && g.q === q) listenFallback(q); }); }, 250);
    } else play.classList.remove('show');
    var html = '';
    q.choices.forEach(function (c, i) { html += '<button class="btn choice ' + T.opt + '" data-i="' + i + '" lang="' + (T.opt === 'ja' ? 'ja' : 'zh-CN') + '"><span class="k">' + (i + 1) + '</span>' + esc(c) + '</button>'; });
    $('choices').innerHTML = html;
    var timed = save.settings.timer && g.phase !== 'tutorial';
    g.timeMax = timed ? (item.kind === 'small' ? SMALL_TIME : BOSS_TIME) : 0; g.timeLeft = g.timeMax;
    renderTimer();
    if (g.enemy) g.enemy.charging = true;
  }
  $('choices').addEventListener('click', function (e) { var b = e.target.closest('.choice'); if (b) answer(+b.getAttribute('data-i')); });
  // 音声が読み込めないときは、ピンインを見せて出題を続ける
  function listenFallback(q) {
    var main = $('q-main'); main.className = 'q-main py'; main.textContent = q.word.pinyin;
    $('q-sub').textContent = '（音声を読み込めなかったので、ピンインで出題しています）';
  }
  function replay() { var g = G; if (!g || !g.q) return; var q = g.q; unlockAudio(); playWord(q.word, function (blocked) { if (!blocked && q.type === 'listen' && G === g && g.q === q) listenFallback(q); }); }
  $('btn-play').onclick = replay;
  document.addEventListener('keydown', function (e) {
    if (current !== 'game' || !G) return;
    if (e.key >= '1' && e.key <= '4') { answer(+e.key - 1); e.preventDefault(); }
    else if (e.key === ' ' && G.q && G.q.type === 'listen') { replay(); e.preventDefault(); }
    else if (e.key === 'Escape') togglePause();
  });

  function answer(i) {
    var g = G; if (!g || g.locked || !g.q || g.paused) return;
    if (i >= g.q.choices.length) return;
    g.locked = true;
    var q = g.q, ok = i === q.answer, item = g.item, w = q.word;
    var btns = $('choices').querySelectorAll('.choice');
    if (i >= 0) btns[i].classList.add(ok ? 'correct' : 'wrong');
    btns[q.answer].classList.add('correct');
    var fb = $('q-feedback');
    var info = w.h + '　' + w.pinyin + '　' + w.ja;
    if (g.phase !== 'tutorial') g.answered++;
    if (g.enemy) g.enemy.charging = false;
    if (ok) {
      if (g.phase !== 'tutorial') { g.correct++; g.combo++; }
      var pts = 100 + Math.min(g.combo, 10) * 10 + (g.timeMax ? Math.round(g.timeLeft / g.timeMax * 50) : 0);
      if (g.phase !== 'tutorial') { g.score += pts; renderScore(); }
      fb.textContent = '正解！ ' + info; fb.className = 'q-feedback ok';
      if (g.id === 'review') { if (LV.miss[w.id]) { LV.miss[w.id]--; if (LV.miss[w.id] <= 0) delete LV.miss[w.id]; store(); } }
      if (save.settings.autoplay && q.type !== 'listen') playWord(w);
      var done = false;
      if (item.kind === 'small') { done = true; }
      else { g.bossHits++; var need = item.kind === 'mid' ? MID_HITS : BOSS_HITS; if (g.phase === 'tutorial') need = 99; done = g.bossHits >= need; }
      scene.playerShoot(done, g.phase === 'tutorial' ? '' : '+' + pts);
      later(function () {
        if (g.phase === 'tutorial') { g.queue.shift(); if (g.queue[0] && g.queue[0].kind === 'small' && g.enemy) g.enemy.dead = true; return nextQuestion(); }
        if (item.kind === 'small') { g.doneSmall = (g.doneSmall || 0) + 1; return nextQuestion(); }
        if (item.kind === 'mid' && done) { g.midDone = true; g.phase = 'small'; if (g.hp < MAX_HP) { g.hp++; renderHP(); banner('中ボス撃破！ HP+1', 1000); } else banner('中ボス撃破！', 1000); return later(nextQuestion, 1000); }
        if (item.kind === 'boss' && done) return finish(true);
        nextQuestion();
      }, 900);
    } else {
      g.combo = 0;
      fb.innerHTML = (i < 0 ? '時間切れ！' : 'ざんねん…') + ' 正解は <b>' + esc(q.choices[q.answer]) + '</b><br><small>' + esc(info) + '</small>';
      fb.className = 'q-feedback ng';
      if (g.phase === 'tutorial') {
        fb.innerHTML += '<br><small>（チュートリアルなのでダメージなし。もう一度！）</small>';
        later(function () { ask(makeQuestion(item.w, item.type), item); }, 2000);
        return;
      }
      playWord(w);
      g.missWords[w.id] = (g.missWords[w.id] || 0) + 1;
      LV.miss[w.id] = (LV.miss[w.id] || 0) + 1; store();
      g.hp--; renderHP(); scene.enemyShoot();
      $('scr-game').classList.remove('shake'); void $('scr-game').offsetWidth; $('scr-game').classList.add('shake');
      var abandon = false;
      if (item.kind === 'small') {
        g.retries[w.id] = (g.retries[w.id] || 0) + 1;
        // 1回目のミス：あとでちがう問題形式でもう一度出題。2回目のミス：そのまま次へ
        if (g.retries[w.id] <= 1) g.queue.push({ w: w, type: item.type === 'h2ja' ? 'ja2h' : item.type === 'ja2h' ? 'h2py' : 'h2ja', kind: 'small' });
        else abandon = true;
      }
      later(function () {
        if (g.hp <= 0) return finish(false);
        if (item.kind === 'small') { if (g.enemy) g.enemy.flee = true; if (abandon) g.doneSmall = (g.doneSmall || 0) + 1; }
        nextQuestion();
      }, 2200);
    }
  }

  function finish(win) {
    var g = G; if (!g) return; g.over = true; g.q = null; clearTimers();
    var id = g.id, unlockMsg = '';
    if (id === 'tutorial') {
      if (!save.tutorial) unlockMsg = 'ステージ1が解放されました！';
      save.tutorial = true;
    } else if (typeof id === 'number' && win) {
      LV.cleared[id] = true;
      if (id + 1 < NSTAGE && LV.unlocked < id + 1) { LV.unlocked = id + 1; unlockMsg = 'STAGE ' + (id + 2) + '「' + STAGE_NAMES[id + 1] + '」が解放されました！'; }
      else if (id + 1 >= NSTAGE) unlockMsg = 'HSK' + LEVEL + '級 全ステージクリア！おめでとう！';
    }
    if (typeof id === 'number') LV.best[id] = Math.max(LV.best[id] || 0, g.score);
    store();
    banner(win ? 'CLEAR!' : 'GAME OVER', 1200);
    if (win) scene.win(); else scene.lose();
    setTimeout(function () { showResult(g, win, unlockMsg); }, 1300);
  }
  function wordRow(w, count, label) {
    return '<li><span class="h" lang="zh-CN">' + esc(w.h) + '</span><span class="p">' + esc(w.pinyin) + '</span><span class="j">' + esc(w.ja) + '</span>' +
      (count ? '<span class="c">' + label + count + '</span>' : '') + '<button class="btn say" data-say="' + w.id + '" aria-label="発音を聞く">🔊</button></li>';
  }
  function showResult(g, win, unlockMsg) {
    show('result');
    $('res-title').textContent = g.id === 'tutorial' ? 'チュートリアル完了！' : win ? (g.id === 'review' ? '復習クリア！' : 'ステージクリア！') : 'ゲームオーバー';
    $('res-acc').textContent = g.answered ? Math.round(g.correct / g.answered * 100) + '%' : '—';
    $('res-score').textContent = g.score;
    $('res-best').textContent = typeof g.id === 'number' ? LV.best[g.id] : '—';
    $('res-unlock').textContent = unlockMsg;
    var mk = Object.keys(g.missWords);
    $('res-miss').innerHTML = mk.length ? mk.filter(function (k) { return byId[k]; }).map(function (k) { return wordRow(byId[k], g.missWords[k], '×'); }).join('') : '<li class="none">ありません。パーフェクト！</li>';
    var top = Object.keys(LV.miss).filter(function (k) { return byId[k]; }).sort(function (a, b) { return LV.miss[b] - LV.miss[a]; }).slice(0, 5);
    $('res-top').innerHTML = top.length ? top.map(function (k) { return wordRow(byId[k], LV.miss[k], 'ミス'); }).join('') : '<li class="none">記録はまだありません</li>';
    var next = $('btn-next');
    if (g.id === 'tutorial') { next.style.display = ''; next.textContent = 'ステージ1へ ▶'; next.onclick = function () { startStage(0); }; }
    else if (typeof g.id === 'number' && win && g.id + 1 < NSTAGE) { next.style.display = ''; next.textContent = 'つぎのステージへ ▶'; next.onclick = function () { startStage(g.id + 1); }; }
    else next.style.display = 'none';
    $('btn-retry').onclick = function () { startStage(g.id); };
    var rv = $('btn-res-review'); rv.disabled = !Object.keys(LV.miss).length; rv.onclick = function () { startStage('review'); };
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-say]'); if (!b) return;
    unlockAudio(); playWord(byId[b.getAttribute('data-say')], function (blocked) { if (!blocked) { b.textContent = '✕'; b.title = '音声を読み込めませんでした'; } });
  });
  // 問題の漢字をタップしても発音が聞ける（リスニング問題では答えがわかるので除く）
  $('q-main').addEventListener('click', function () { if (G && G.q && G.q.type !== 'listen' && /zh/.test(this.className)) { unlockAudio(); playWord(G.q.word); } });

  function renderHP() {
    var full = Art.sprite('heart').toDataURL(), empty = Art.sprite('heart', { r: '#555' }).toDataURL(), h = '';
    for (var i = 0; i < MAX_HP; i++) h += '<i style="background-image:url(' + (i < G.hp ? full : empty) + ')"></i>';
    $('hud-hp').innerHTML = h; $('hud-hp').setAttribute('aria-label', 'HP ' + G.hp + '/' + MAX_HP);
  }
  function renderScore() { $('hud-score').textContent = G.score; }
  function renderTimer() {
    var f = $('timer-fill'); if (!G || !G.timeMax) { f.style.width = '100%'; f.className = ''; return; }
    var r = Math.max(0, G.timeLeft / G.timeMax); f.style.width = (r * 100) + '%'; f.className = r < 0.3 ? 'low' : '';
  }
  var bannerT;
  function banner(t, ms) { var b = $('banner'); b.textContent = t; b.classList.add('show'); clearTimeout(bannerT); bannerT = setTimeout(function () { b.classList.remove('show'); }, ms); }
  function togglePause() {
    if (!G || G.over) return; G.paused = !G.paused; $('pause').classList.toggle('show', G.paused);
  }
  $('btn-pause').onclick = togglePause; $('btn-resume').onclick = togglePause;
  $('btn-quit').onclick = function () { stopGame(); show('select'); };
  document.addEventListener('visibilitychange', function () { if (document.hidden && G && !G.paused && !G.over && current === 'game') togglePause(); });

  function spawnEnemy(kind) { scene.spawn(kind); }

  /* ---------- 描画（canvas） ---------- */
  var cv = $('stage'), cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
  var W = 320, H = 180, GROUND = 150;
  var scene = {
    t: 0, scroll: 0, bullets: [], parts: [], texts: [], shake: 0, flash: 0, heroX: 46, heroHit: 0, state: 'play',
    reset: function (g) { this.bullets = []; this.parts = []; this.texts = []; this.state = 'play'; this.g = g; g.enemy = null; },
    spawn: function (kind) {
      var g = this.g; var e = { kind: kind, x: W + 20, tx: kind === 'small' ? 232 : 220, y: GROUND, hp: kind === 'small' ? 1 : kind === 'mid' ? MID_HITS : BOSS_HITS, dead: false, flee: false, hit: 0, charging: false, sw: Art.ENEMY_SWAPS[Math.floor(Math.random() * Art.ENEMY_SWAPS.length)] };
      if (kind === 'boss') e.sw = { g: '#e63946', l: '#ffb3c1', d: '#9d0208' };
      g.enemy = e;
    },
    playerShoot: function (kill, label) {
      var e = this.g.enemy; var tx = e ? e.x : 240;
      for (var i = 0; i < 3; i++) this.bullets.push({ x: this.heroX + 14, y: GROUND - 14 - i * 3, vx: 6 + i, vy: 0, mine: true, kill: kill && i === 0, tx: tx, label: i === 0 ? label : '' });
    },
    enemyShoot: function () {
      var e = this.g.enemy; var sx = e ? e.x - 6 : 240, sy = e ? GROUND - (e.kind === 'small' ? 8 : 22) : 130;
      var n = e && e.kind !== 'small' ? 9 : 3;
      for (var i = 0; i < n; i++) { var a = Math.PI + (i - (n - 1) / 2) * 0.12; this.bullets.push({ x: sx, y: sy, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5 * 0.6 + (GROUND - 12 - sy) / 40, mine: false }); }
    },
    win: function () { this.state = 'win'; for (var i = 0; i < 40; i++) this.burst(160, 80, ['#ffd166', '#e63946', '#52b788', '#4cc9f0'][i % 4], 1); },
    lose: function () { this.state = 'lose'; },
    burst: function (x, y, col, n) { for (var i = 0; i < (n === 1 ? 1 : 14); i++) this.parts.push({ x: x, y: y, vx: (Math.random() - .5) * 6, vy: (Math.random() - .9) * 5, life: 40 + Math.random() * 20, c: col }); },
    update: function (dt) {
      var g = this.g; this.t += dt; this.scroll += dt * (this.state === 'play' ? 0.9 : 0.2);
      if (g && !g.paused && !g.over && g.timeMax && !g.locked && g.q) {
        g.timeLeft -= dt / 60; renderTimer();
        if (g.timeLeft <= 0) { g.timeLeft = 0; answer(-1); }
      }
      var e = g && g.enemy;
      if (e) {
        if (e.flee) { e.x += 4 * dt; if (e.x > W + 40) g.enemy = null; }
        else if (!e.dead && e.x > e.tx) e.x -= 3 * dt;
        if (e.hit > 0) e.hit -= dt;
        // ボスの演出用弾幕（当たらない）
        if (e.kind === 'boss' && !e.dead && !g.over && Math.floor(this.t) % 70 === 0 && Math.floor(this.t - dt) % 70 !== 0) {
          for (var k = 0; k < 12; k++) { var a = k / 12 * Math.PI * 2 + this.t / 30; this.bullets.push({ x: e.x, y: GROUND - 28, vx: Math.cos(a) * 1.6, vy: Math.sin(a) * 1.6, mine: false, deco: true, life: 70 }); }
        }
      }
      var self = this;
      this.bullets = this.bullets.filter(function (b) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.deco) { b.life -= dt; if (b.x < self.heroX + 30) { self.parts.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 8, c: '#bde0fe' }); return false; } return b.life > 0; }
        if (b.mine && e && b.x >= e.x - 4) {
          e.hit = 8; self.burst(e.x, GROUND - 10, '#ffd166');
          if (b.label) self.texts.push({ x: e.x, y: GROUND - 40, t: b.label, life: 50 });
          if (b.kill) { e.dead = true; self.burst(e.x, GROUND - 10, e.sw.g || '#52b788'); self.burst(e.x, GROUND - 16, '#fff'); setTimeout(function () { if (g.enemy === e) g.enemy = null; }, 250); }
          else if (e.kind !== 'small') e.hp = Math.max(1, e.hp);
          self.flash = 3; return false;
        }
        if (!b.mine && b.x <= self.heroX + 10) { self.heroHit = 20; self.shake = 10; self.burst(self.heroX + 6, GROUND - 10, '#e63946'); return false; }
        return b.x > -10 && b.x < W + 10;
      });
      this.parts = this.parts.filter(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.15 * dt; p.life -= dt; return p.life > 0; });
      this.texts = this.texts.filter(function (t) { t.y -= 0.4 * dt; t.life -= dt; return t.life > 0; });
      if (this.shake > 0) this.shake -= dt; if (this.heroHit > 0) this.heroHit -= dt; if (this.flash > 0) this.flash -= dt;
    },
    draw: function () {
      var g = this.g, th = (g && g.theme) || Art.THEMES[0];
      cx.save();
      if (this.shake > 0) cx.translate((Math.random() - .5) * 4, (Math.random() - .5) * 4);
      var sky = cx.createLinearGradient(0, 0, 0, GROUND); sky.addColorStop(0, th[0]); sky.addColorStop(1, th[1]);
      cx.fillStyle = sky; cx.fillRect(-4, -4, W + 8, GROUND + 4);
      // 雲
      cx.fillStyle = 'rgba(255,255,255,.85)';
      for (var i = 0; i < 4; i++) { var x = ((i * 97 - this.scroll * 0.2) % (W + 60) + W + 60) % (W + 60) - 40, y = 18 + (i * 23) % 50; cx.fillRect(x, y, 30, 6); cx.fillRect(x + 6, y - 4, 16, 4); }
      // 山（2層）
      for (var layer = 0; layer < 2; layer++) {
        cx.fillStyle = layer ? th[3] : th[2]; var sp = layer ? 0.6 : 0.3, base = GROUND - (layer ? 8 : 26);
        for (var mx = -64; mx < W + 64; mx += 4) {
          var wx = mx + ((this.scroll * sp) % 64);
          var hh = Math.abs(((Math.floor((mx + Math.floor(this.scroll * sp / 64) * 64) / 4) * 4) % 64) - 32) * (layer ? 0.5 : 1.1);
          cx.fillRect(mx - ((this.scroll * sp) % 4), base - (layer ? 16 : 34) + hh, 4, GROUND - base + (layer ? 16 : 34) - hh);
        }
      }
      // 地面
      cx.fillStyle = '#7f5539'; cx.fillRect(0, GROUND, W, H - GROUND);
      cx.fillStyle = '#6a994e'; cx.fillRect(0, GROUND, W, 5);
      cx.fillStyle = '#9c6644'; for (var gx = -16; gx < W + 16; gx += 16) { var ox = gx - (this.scroll * 1.2 % 16); cx.fillRect(ox, GROUND + 9, 8, 4); cx.fillRect(ox + 8, GROUND + 19, 8, 4); }
      // 主人公
      var hero = Art.sprite('hero', this.heroHit > 0 && Math.floor(this.heroHit / 3) % 2 ? { w: '#fff', b: '#e63946' } : null);
      var bob = this.state === 'win' ? -Math.abs(Math.sin(this.t / 6)) * 8 : Math.floor(this.t / 10) % 2;
      if (this.state !== 'lose') cx.drawImage(hero, this.heroX, GROUND - 32 + bob, 32, 32);
      else { cx.save(); cx.translate(this.heroX + 16, GROUND - 8); cx.rotate(Math.PI / 2); cx.drawImage(hero, -16, -16, 32, 32); cx.restore(); }
      // 敵
      var e = g && g.enemy;
      if (e && !(e.dead && this.flash <= 0 && e.kind === 'small')) {
        var sc = e.kind === 'small' ? 2 : e.kind === 'mid' ? 3 : 4;
        var spr = e.kind === 'mid' ? Art.sprite('lantern') : Art.sprite('slime', e.hit > 0 ? { g: '#fff', l: '#fff', d: '#ddd' } : e.sw);
        var sw = spr.width * sc, sh = spr.height * sc, by = Math.sin(this.t / 8) * (e.kind === 'mid' ? 4 : 1);
        var ex = e.x - sw / 2, ey = (e.kind === 'mid' ? GROUND - sh - 16 : GROUND - sh) + by;
        if (e.charging && Math.floor(this.t / 6) % 2) { cx.fillStyle = 'rgba(230,57,70,.35)'; cx.fillRect(ex - 3, ey - 3, sw + 6, sh + 6); }
        cx.drawImage(spr, ex, ey, sw, sh);
        if (e.kind === 'boss') cx.drawImage(Art.sprite('crown'), e.x - 20, ey - 14, 40, 16);
        if (e.kind !== 'small' && g) {
          var need = e.kind === 'mid' ? MID_HITS : BOSS_HITS, left = g.phase === 'tutorial' ? 1 : Math.max(0, need - g.bossHits);
          cx.fillStyle = '#1b1b2f'; cx.fillRect(ex, ey - 22, sw, 7); cx.fillStyle = '#e63946'; cx.fillRect(ex + 1, ey - 21, (sw - 2) * left / need, 5);
          cx.fillStyle = '#fff'; cx.font = 'bold 8px monospace'; cx.fillText(e.kind === 'mid' ? '中ボス' : 'BOSS', ex, ey - 25);
        }
      }
      // 弾
      this.bullets.forEach(function (b) {
        if (b.mine) { cx.fillStyle = '#ffd166'; cx.fillRect(b.x - 4, b.y - 2, 8, 4); cx.fillStyle = '#fff'; cx.fillRect(b.x, b.y - 1, 4, 2); }
        else { cx.fillStyle = b.deco ? '#cdb4db' : '#e63946'; cx.fillRect(b.x - 3, b.y - 3, 6, 6); cx.fillStyle = '#fff'; cx.fillRect(b.x - 1, b.y - 1, 2, 2); }
      });
      // バリア（ボス戦の演出弾を防ぐ）
      if (e && e.kind === 'boss') { cx.strokeStyle = 'rgba(189,224,254,' + (0.4 + Math.sin(this.t / 10) * 0.2) + ')'; cx.lineWidth = 2; cx.strokeRect(this.heroX + 28, GROUND - 60, 2, 60); }
      this.parts.forEach(function (p) { cx.fillStyle = p.c; cx.fillRect(p.x, p.y, 3, 3); });
      cx.font = 'bold 10px monospace'; this.texts.forEach(function (t) { cx.fillStyle = '#1b1b2f'; cx.fillText(t.t, t.x + 1, t.y + 1); cx.fillStyle = '#ffd166'; cx.fillText(t.t, t.x, t.y); });
      if (this.flash > 0) { cx.fillStyle = 'rgba(255,255,255,.25)'; cx.fillRect(0, 0, W, H); }
      cx.restore();
    }
  };
  var last = 0, running = false;
  function frame(ts) {
    var dt = last ? Math.min(3, (ts - last) / 16.67) : 1; last = ts;
    if (!(G && G.paused)) scene.update(dt);
    scene.draw();
    if (current === 'game') requestAnimationFrame(frame); else { running = false; last = 0; }
  }
  function loopStart() { if (!running) { running = true; last = 0; requestAnimationFrame(frame); } }

  // タイトルのドット絵
  (function () {
    var c = $('title-art').getContext('2d'); c.imageSmoothingEnabled = false;
    c.drawImage(Art.sprite('hero'), 4, 8, 32, 32);
    c.fillStyle = '#ffd166'; c.fillRect(40, 22, 8, 4); c.fillRect(52, 22, 6, 4);
    c.drawImage(Art.sprite('slime', Art.ENEMY_SWAPS[1]), 62, 16, 32, 24);
  })();

  // テスト・保守用のフック（ゲーム内容には影響しない）
  window.HSKGame = {
    state: function () { return G ? { id: G.id, phase: G.phase, hp: G.hp, score: G.score, answered: G.answered, correct: G.correct, locked: G.locked, type: G.q && G.q.type, answer: G.q ? G.q.answer : -1, word: G.q && G.q.word.h, wordId: G.q && G.q.word.id, level: G.level, over: G.over } : null; },
    save: function () { return JSON.parse(JSON.stringify(save)); },
    screen: function () { return current; },
    level: function () { return LEVEL; }, setLevel: setLevel, words: function () { return WORDS; }, stages: function () { return STAGES; },
    makeQuestion: makeQuestion, audioSrc: GameLevels.audioSrc, startStage: function (id) { startStage(id); }
  };
  setLevel(save.level);
  show('title');
})();
