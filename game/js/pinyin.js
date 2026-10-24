/* 声調記号つきピンイン（HSKサイトの表記）を音節に分け、声調だけを変えた形を作る。
   サイトのピンイン文字列そのものは変更しない（正解の表示には元の文字列を使う）。 */
(function (g) {
  'use strict';
  var MARKS = {
    a: ['ā', 'á', 'ǎ', 'à'], e: ['ē', 'é', 'ě', 'è'], i: ['ī', 'í', 'ǐ', 'ì'],
    o: ['ō', 'ó', 'ǒ', 'ò'], u: ['ū', 'ú', 'ǔ', 'ù'], 'ü': ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
    n: ['', 'ń', 'ň', 'ǹ'], m: ['', 'ḿ', '', '']
  };
  var UNMARK = {};
  Object.keys(MARKS).forEach(function (b) { MARKS[b].forEach(function (c, i) { if (c) UNMARK[c] = { b: b, t: i + 1 }; }); });

  var INITIALS = ['', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w'];
  var FINALS = ['a', 'o', 'e', 'i', 'u', 'ü', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'er',
    'ia', 'ie', 'iao', 'iu', 'ian', 'in', 'iang', 'ing', 'iong', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 'ueng',
    'üe', 'üan', 'ün', 'ue', 'uan'];
  // 実在するかどうかは厳密に見ず、組み合わせを広めに許す（音節数と声調記号の数で絞り込む）
  var SYL = {};
  INITIALS.forEach(function (i) { FINALS.forEach(function (f) { if (f !== 'er' || i === '') SYL[i + f] = 1; }); });
  ['ng', 'n', 'm', 'hm', 'hng'].forEach(function (s) { SYL[s] = 1; });

  function unmark(str) {
    var letters = [], tones = [];
    for (var k = 0; k < str.length; k++) {
      var ch = str[k], u = UNMARK[ch.toLowerCase()];
      var up = ch !== ch.toLowerCase();
      if (u) { letters.push(up ? u.b.toUpperCase() : u.b); tones.push(u.t); }
      else { letters.push(ch); tones.push(0); }
    }
    return { letters: letters, tones: tones };
  }

  // 音節に分ける。target＝期待する音節数（漢字の数）。見つからなければ null
  function segment(pinyin, target) {
    var u = unmark(pinyin), L = u.letters, T = u.tones, n = L.length;
    var lower = L.map(function (c) { return c.toLowerCase(); });
    var results = [];
    function rec(pos, acc) {
      if (results.length > 4) return;
      if (pos === n) { results.push(acc.slice()); return; }
      var sep = '';
      var p = pos;
      if (lower[p] === "'" || lower[p] === '’' || lower[p] === ' ' || lower[p] === '-') { sep = L[p]; p++; }
      for (var len = Math.min(6, n - p); len >= 1; len--) {
        var base = lower.slice(p, p + len).join('');
        var erhua = false;
        if (!SYL[base]) {
          if (base.length > 1 && base[base.length - 1] === 'r' && SYL[base.slice(0, -1)] && base !== 'er') erhua = true; else continue;
        }
        var tone = 0, marks = 0;
        for (var k = p; k < p + len; k++) if (T[k]) { tone = T[k]; marks++; }
        if (marks > 1) continue;
        acc.push({ base: base, tone: tone || 5, sep: sep, cap: L[p] !== lower[p], erhua: erhua });
        rec(p + len, acc);
        acc.pop();
      }
    }
    rec(0, []);
    var ok = results.filter(function (r) { return render(r) === pinyin; });
    var exact = ok.filter(function (r) { return r.length === target; });
    if (exact.length) return exact[0];
    // 儿化（例：nàr）は「儿」が独立した音節にならない
    var er = ok.filter(function (r) { return r.length === target - 1 && r.some(function (s) { return s.erhua; }); });
    return er.length ? er[0] : null;
  }

  function markSyl(base, tone) {
    if (tone < 1 || tone > 4) return base;
    var idx = -1;
    if (base.indexOf('a') >= 0) idx = base.indexOf('a');
    else if (base.indexOf('e') >= 0) idx = base.indexOf('e');
    else if (base.indexOf('ou') >= 0) idx = base.indexOf('o');
    else {
      for (var k = base.length - 1; k >= 0; k--) if ('iouü'.indexOf(base[k]) >= 0) { idx = k; break; }
      if (idx < 0) for (k = 0; k < base.length; k++) if ('nm'.indexOf(base[k]) >= 0) { idx = k; break; }
    }
    if (idx < 0) return base;
    var c = MARKS[base[idx]] && MARKS[base[idx]][tone - 1];
    if (!c) return null;
    return base.slice(0, idx) + c + base.slice(idx + 1);
  }
  function render(syls) {
    var out = '';
    for (var k = 0; k < syls.length; k++) {
      var s = syls[k], m = markSyl(s.base, s.tone);
      if (m === null) return null;
      if (s.cap) m = m.charAt(0).toUpperCase() + m.slice(1);
      out += s.sep + m;
    }
    return out;
  }
  function plain(syls) {
    return syls.map(function (s, i) { var b = s.cap ? s.base.charAt(0).toUpperCase() + s.base.slice(1) : s.base; return (i ? s.sep : '') + b; }).join('');
  }
  g.Pinyin = { segment: segment, render: render, plain: plain, markSyl: markSyl };
  if (typeof module !== 'undefined') module.exports = g.Pinyin;
})(typeof window !== 'undefined' ? window : globalThis);
