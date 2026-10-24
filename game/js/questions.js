/* 問題と選択肢を作る。
   - ピンイン・声調問題：不正解の選択肢が「同じ漢字の別の正しい読み方」にならないようにする
     （全級の同じ漢字の読み＋pypinyinの多音字表 readings.js＋一・不の変調＋手作業の一覧）。
     1文字で読み方が2つ以上ある字（好・少・一・教 など）は声調問題を出さない。
   - 意味の問題：意味が同じ・重なる選択肢を並べない（意味を「、」などで区切って比べる）。
   単語・ピンイン・意味のデータそのものは変更しない。 */
(function (g) {
  'use strict';

  /* ---------- ピンインの比較 ---------- */
  function normPy(p) { return String(p || '').normalize('NFC').toLowerCase().replace(/[\s'’\-·]/g, ''); }
  function hanChars(h) { return String(h).match(/[\u3400-\u9fff]/g) || []; }

  // レビューで挙がった多音字（pypinyinの表に加えて、念のため手で登録）
  var MANUAL_READINGS = {
    '好': ['hǎo', 'hào'], '少': ['shǎo', 'shào'], '一': ['yī', 'yí', 'yì'], '不': ['bù', 'bú'], '只': ['zhǐ', 'zhī'],
    '教': ['jiāo', 'jiào'], '看': ['kàn', 'kān'], '为': ['wèi', 'wéi'], '种': ['zhǒng', 'zhòng'], '数': ['shǔ', 'shù'],
    '难': ['nán', 'nàn'], '分': ['fēn', 'fèn'], '要': ['yào', 'yāo'], '当': ['dāng', 'dàng'], '发': ['fā', 'fà'],
    '背': ['bèi', 'bēi'], '倒': ['dào', 'dǎo'], '干': ['gàn', 'gān'], '更': ['gèng', 'gēng'], '正': ['zhèng', 'zhēng'],
    '便': ['biàn', 'pián'], '号': ['hào', 'háo'], '长': ['cháng', 'zhǎng'], '还': ['hái', 'huán'], '得': ['dé', 'de', 'děi'],
    '地': ['dì', 'de'], '行': ['xíng', 'háng'], '过': ['guò', 'guo'], '了': ['le', 'liǎo'], '着': ['zhe', 'zháo', 'zhuó'],
    '和': ['hé', 'hè', 'huó', 'huò'], '重': ['zhòng', 'chóng'], '觉': ['jué', 'jiào'], '乐': ['lè', 'yuè'], '差': ['chà', 'chā', 'chāi'],
    '空': ['kōng', 'kòng'], '没': ['méi', 'mò'], '都': ['dōu', 'dū'], '会': ['huì', 'kuài'], '大': ['dà', 'dài'], '七': ['qī', 'qí'], '八': ['bā', 'bá']
  };
  // 一・不 の変調（例：一共 yígòng／yīgòng、不对 búduì／bùduì）
  var SANDHI = { '一': [1, 2, 4], '不': [4, 2] };

  // 意味の問題で、データの意味に書かれていないが「正しい」と言える意味（不正解の選択肢から外すためだけに使う）
  var EXTRA_SENSES = { '对': '正しい、そのとおりだ、合っている', '回': '帰る、戻る', '会': 'できる、…するだろう', '有': '持つ、持っている' };

  /* ---------- 意味の比較 ---------- */
  var STEM = /(する|な|だ|に|の|と|である|です)$/;
  function glossSegs(ja) {
    var s = String(ja || '').normalize('NFKC');
    s = s.replace(/\[[^\]]*\]/g, '、').replace(/\([^)]*\)/g, '、').replace(/（[^）]*）/g, '、').replace(/【[^】]*】/g, '、');
    s = s.replace(/[「」『』]/g, '').replace(/[〜~…‥]/g, '').replace(/[①-⑳]/g, '、');
    s = s.replace(/(^|、)\s*(名|動|形|副|量|介|助|代|数|接|連|感|能願|助動)\s*[:：]/g, '$1');
    var out = [];
    s.split(/[、，,;；/／。・?？]+/).forEach(function (seg) {
      seg = seg.replace(/[\s:：=＝→]/g, '');
      if (!seg) return;
      out.push(seg);
      if (seg.length >= 3) { var st = seg.replace(STEM, ''); if (st && st !== seg) out.push(st); }
    });
    return out;
  }
  function overlap(a, b) { for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) >= 0) return true; return false; }

  /* ---------- 全級の索引（同じ漢字の読み・意味） ---------- */
  var INDEX = null;
  function index() {
    if (INDEX) return INDEX;
    var all = g.HSK.prepareVocab(g.HSK_VOCAB), py = {}, gl = {};
    all.forEach(function (e) {
      (py[e.hanzi] = py[e.hanzi] || []).push(normPy(e.pinyin));
      (gl[e.hanzi] = gl[e.hanzi] || []).push(e.gloss);
    });
    INDEX = { py: py, gl: gl };
    return INDEX;
  }

  // 漢字 h の「正しい読み方」の集合（正解の w.pinyin を含む）
  var readCache = {};
  function readingsOf(w) {
    var key = w.h + '\u0000' + w.pinyin;
    if (readCache[key]) return readCache[key];
    var set = {};
    function add(p) { set[normPy(p)] = 1; }
    add(w.pinyin);
    (index().py[w.h] || []).forEach(add);
    var ch = hanChars(w.h);
    if (ch.length === 1 && w.h.length === 1) {
      ((g.GAME_READINGS || {})[w.h] || []).forEach(add);
      (MANUAL_READINGS[w.h] || []).forEach(add);
    }
    // 一・不 の変調形
    if (w.syl && w.syl.length === ch.length) {
      var pos = [];
      ch.forEach(function (c, i) { if (SANDHI[c]) pos.push(i); });
      if (pos.length && pos.length <= 3) {
        var combos = [[]];
        pos.forEach(function (i) {
          var next = [];
          combos.forEach(function (cb) { SANDHI[ch[i]].concat([5]).forEach(function (t) { next.push(cb.concat([[i, t]])); }); });
          combos = next;
        });
        combos.forEach(function (cb) {
          var syl = w.syl.map(function (s) { return { base: s.base, tone: s.tone, sep: s.sep, cap: s.cap }; });
          cb.forEach(function (it) { syl[it[0]].tone = it[1]; });
          var r = g.Pinyin.render(syl); if (r) add(r);
        });
      }
    }
    readCache[key] = set;
    return set;
  }
  function isReading(w, p) { return !!readingsOf(w)[normPy(p)]; }
  // 1文字で読み方が2つ以上ある字（声調問題は出さない）
  function polyphonicChar(w) {
    if (w.h.length !== 1) return false;
    return Object.keys(readingsOf(w)).length > 1;
  }
  // w の意味（同じ漢字のほかの見出しと、補足の意味も含める）
  var senseCache = {};
  function sensesOf(w) {
    if (senseCache[w.h]) return senseCache[w.h];
    var segs = glossSegs(w.ja);
    (index().gl[w.h] || []).forEach(function (j) { segs = segs.concat(glossSegs(j)); });
    if (EXTRA_SENSES[w.h]) segs = segs.concat(glossSegs(EXTRA_SENSES[w.h]));
    senseCache[w.h] = segs;
    return segs;
  }

  // 意味が近く、選択肢に並ぶと紛らわしい組み合わせ（意味問題では同時に出さない）
  var CONFUSE = [['会', '能'], ['几', '多少'], ['很', '太'], ['看', '看见', '读'], ['老师', '先生'], ['想', '爱', '喜欢'], ['他', '她'], ['那', '那儿'], ['哪', '哪儿'], ['这', '这儿']];
  function confusable(a, b) { return CONFUSE.some(function (c) { return c.indexOf(a.h) >= 0 && c.indexOf(b.h) >= 0; }); }

  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function toneVariants(w, n) {
    var idx = []; w.syl.forEach(function (s, i) { if (s.tone >= 1 && s.tone <= 4) idx.push(i); });
    if (!idx.length) return [];
    var out = {}, list = [];
    out[normPy(w.pinyin)] = 1;
    var tries = 0;
    while (list.length < n && tries++ < 200) {
      var syl = w.syl.map(function (s) { return { base: s.base, tone: s.tone, sep: s.sep, cap: s.cap }; });
      var k = tries > 40 && idx.length > 1 ? 2 : 1;
      shuffle(idx).slice(0, k).forEach(function (i) { var t; do { t = 1 + Math.floor(Math.random() * 4); } while (t === w.syl[i].tone); syl[i].tone = t; });
      var r = g.Pinyin.render(syl);
      if (r && !out[normPy(r)] && !isReading(w, r)) { out[normPy(r)] = 1; list.push(r); }
    }
    return list;
  }

  // words：いまの級の単語、byStage：ステージごとの単語
  function create(words, byStage) {
    // 候補を「同じステージ（ランダム順）→ ほかのステージ（ランダム順）」の順に fn へ渡す。fn が true を返したら終わり
    var ORDER = shuffle(words), calls = 0;
    function each(w, fn) {
      var pool = shuffle(byStage[w.s] || []);
      for (var i = 0; i < pool.length; i++) if (pool[i] !== w && fn(pool[i])) return;
      if (++calls % 64 === 0) ORDER = shuffle(words);
      var n = ORDER.length, off = Math.floor(Math.random() * n);
      for (var k = 0; k < n; k++) { var x = ORDER[(off + k) % n]; if (x.s !== w.s && x !== w && fn(x)) return; }
    }
    function canTone(w) { return w.toneable && !polyphonicChar(w); }

    function make(w, type) {
      var opts, answer, main, sub = '', owners = null;
      var tv = null;
      if (type === 'tone') {
        tv = canTone(w) ? toneVariants(w, 3) : [];
        if (tv.length < 3) type = 'h2py'; // 3つ作れないとき（多音字・嗯 など）はピンイン問題に
      }
      if (type === 'listen' && !w.listenable) type = 'h2ja';
      if (type === 'h2ja') {
        main = w.h; answer = w.ja;
        var S = sensesOf(w).concat(glossSegs(w.ja)), picked = [], segsPicked = [];
        each(w, function (x) {
          if (x.h === w.h || confusable(w, x)) return false;
          var xs = glossSegs(x.ja);
          if (!xs.length || overlap(xs, S)) return false;
          if (segsPicked.some(function (p) { return overlap(xs, p); })) return false;
          picked.push(x); segsPicked.push(xs);
          return picked.length >= 3;
        });
        opts = picked.map(function (x) { return x.ja; }); owners = picked;
      } else if (type === 'h2py') {
        main = w.h; answer = w.pinyin;
        // 声調ちがい1つ＋同じ音節数のほかの単語（長さで答えがわからないように）
        var d = (canTone(w) ? toneVariants(w, 1) : []).map(function (p) { return { p: p, o: null }; });
        var seen = {}; seen[normPy(w.pinyin)] = 1; d.forEach(function (x) { seen[normPy(x.p)] = 1; });
        var n = w.nsyl;
        [function (x) { return x.nsyl === n; }, function (x) { return Math.abs(x.nsyl - n) === 1; }, function () { return true; }].forEach(function (ok) {
          if (d.length >= 3) return;
          each(w, function (x) {
            if (x.h === w.h || !ok(x)) return false;
            var k = normPy(x.pinyin);
            if (seen[k] || isReading(w, x.pinyin)) return false;
            seen[k] = 1; d.push({ p: x.pinyin, o: x });
            return d.length >= 3;
          });
        });
        opts = d.map(function (x) { return x.p; }); owners = d.map(function (x) { return x.o; });
      } else if (type === 'ja2h') {
        main = w.ja; answer = w.h;
        var P = glossSegs(w.ja), chosen = [], senses = [sensesOf(w).concat(P)];
        each(w, function (x) {
          if (x.h === w.h || confusable(w, x)) return false;
          if (chosen.some(function (c) { return c.h === x.h; })) return false;
          var xs = sensesOf(x);
          if (overlap(xs, P) || senses.some(function (s) { return overlap(xs, s); })) return false;
          chosen.push(x); senses.push(xs);
          return chosen.length >= 3;
        });
        opts = chosen.map(function (x) { return x.h; }); owners = chosen;
      } else if (type === 'listen') {
        main = ''; answer = w.h;
        // 同音語（例：他／她）は除外する
        var ls = [];
        each(w, function (x) {
          if (x.plain.toLowerCase() === w.plain.toLowerCase() || x.h === w.h || ls.some(function (y) { return y.h === x.h; })) return false;
          ls.push(x); return ls.length >= 3;
        });
        opts = ls.map(function (x) { return x.h; }); owners = ls;
      } else if (type === 'tone') {
        main = w.h; sub = w.plain; answer = w.pinyin; opts = tv;
        owners = tv.map(function () { return null; });
      }
      opts = opts.slice(0, 3); owners = owners.slice(0, 3);
      var order = shuffle([0, 1, 2, 3].slice(0, opts.length + 1));
      var all = [answer].concat(opts), own = [w].concat(owners);
      return { word: w, type: type, main: main, sub: sub, choices: order.map(function (i) { return all[i]; }), owners: order.map(function (i) { return own[i]; }), answer: order.indexOf(0) };
    }
    return { make: make, canTone: canTone };
  }

  g.GameQuestions = { create: create, glossSegs: glossSegs, sensesOf: sensesOf, readingsOf: readingsOf, isReading: isReading, polyphonicChar: polyphonicChar, normPy: normPy, overlap: overlap };
})(typeof window !== 'undefined' ? window : globalThis);
