/* HSK1〜6級の単語（HSK単語サイトの data/vocab.js）をゲーム用にまとめる。
   漢字・ピンイン・意味・録音はHSKサイトのデータをそのまま使う（ここでは変更しない）。
   グループ分けはHSKサイトの単語一覧と同じ（声調を区別しないピンイン順で20語ずつ）。 */
(function () {
  'use strict';
  var GROUP = 20;
  function hanCount(h) { return (h.match(/[㐀-鿿]/g) || []).length; }
  var VOCAB = window.HSK.prepareVocab(window.HSK_VOCAB);
  var collator = new Intl.Collator('en', { sensitivity: 'base', ignorePunctuation: true });

  function toWord(e) {
    var syl = window.Pinyin.segment(e.pinyin, hanCount(e.hanzi));
    return {
      id: e.id, h: e.hanzi, pinyin: e.pinyin, ja: e.gloss, pos: e.pos, level: e.level, entry: e, s: 1,
      syl: syl || [], plain: syl ? window.Pinyin.plain(syl) : e.pinyin,
      nsyl: syl ? syl.length : hanCount(e.hanzi),
      toneable: !!syl && syl.some(function (x) { return x.tone >= 1 && x.tone <= 4; }),
      listenable: !e.audioText, audioNote: e.audioText || ''
    };
  }

  var byId = {}, levels = {};
  function level(n) {
    n = Number(n);
    if (levels[n]) return levels[n];
    var words = window.HSK.wordsForLevel(VOCAB, n).sort(function (a, b) {
      return collator.compare(a.pinyin, b.pinyin) || a.id - b.id;
    }).map(toWord);
    var groups = [];
    for (var i = 0; i < words.length; i += GROUP) {
      var ws = words.slice(i, i + GROUP);
      groups.push({ index: groups.length, from: i + 1, to: i + ws.length, label: (i + 1) + '–' + (i + ws.length), words: ws });
    }
    words.forEach(function (w) { byId[w.id] = w; });
    levels[n] = { level: n, words: words, groups: groups, q: null, qKey: '' };
    return levels[n];
  }
  for (var n = 1; n <= 6; n++) level(n);

  // 選択肢は「選んだことば」から優先して作る（選んだことばが選択肢でも何度も目に入るように）
  function questions(lv, selIds) {
    var L = level(lv), key = selIds.slice().sort().join(',');
    if (L.q && L.qKey === key) return L.q;
    var set = {}; selIds.forEach(function (id) { set[id] = 1; });
    var sel = [], rest = [];
    L.words.forEach(function (w) { w.s = set[w.id] ? 0 : 1; (set[w.id] ? sel : rest).push(w); });
    L.q = window.GameQuestions.create(L.words, [sel, rest]); L.qKey = key;
    return L.q;
  }

  window.RpgWords = {
    GROUP: GROUP, level: level, byId: byId, questions: questions,
    count: function (n) { return level(n).words.length; },
    // 録音は HSK単語サイトの audio/ をそのまま使う（rpg/ から見て ../audio/…）
    audioSrc: function (w) { return '../' + window.HSK.audioPlaybackSrc(w.entry); }
  };
})();
