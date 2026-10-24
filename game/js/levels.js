/* HSKサイトの data/vocab.js（window.HSK_VOCAB）から、級ごとのゲーム用単語とステージを作る。
   漢字・ピンイン・日本語の意味・音声は、サイトのデータをそのまま使う（ここでは変更しない）。 */
(function () {
  'use strict';
  var VOCAB = window.HSK.prepareVocab(window.HSK_VOCAB);
  var STAGE_SIZE = 14; // 1ステージあたりの目安（12〜15語になるように均等に分ける）
  // HSK1だけはテーマ別のステージ（ゲーム初版の分け方）。単語の中身はサイトのデータ
  var L1_NAMES = ['あいさつ・ひと', 'かず', 'かぞく・しごと', 'じかん', 'たべもの・かいもの', 'ばしょ・のりもの', 'うごき①', 'うごき②', 'もの・てんき', 'ようす', 'ぎもん・ことば'];
  var L1_THEME = {"你":0,"我":0,"他":0,"她":0,"我们":0,"人":0,"谢谢":0,"不客气":0,"对不起":0,"没关系":0,"再见":0,"喂":0,"请":0,"名字":0,"叫":0,"一":1,"二":1,"三":1,"四":1,"五":1,"六":1,"七":1,"八":1,"九":1,"十":1,"零":1,"几":1,"多少":1,"岁":1,"个":1,"爸爸":2,"妈妈":2,"儿子":2,"女儿":2,"朋友":2,"老师":2,"学生":2,"同学":2,"医生":2,"先生":2,"小姐":2,"谁":2,"今天":3,"明天":3,"昨天":3,"年":3,"月":3,"日":3,"星期":3,"上午":3,"中午":3,"下午":3,"现在":3,"时候":3,"点":3,"分钟":3,"吃":4,"喝":4,"菜":4,"茶":4,"米饭":4,"水":4,"水果":4,"苹果":4,"杯子":4,"饭馆":4,"钱":4,"块":4,"买":4,"北京":5,"中国":5,"学校":5,"医院":5,"商店":5,"火车站":5,"出租车":5,"飞机":5,"家":5,"里":5,"前面":5,"后面":5,"上":5,"下":5,"爱":6,"喜欢":6,"想":6,"看":6,"看见":6,"听":6,"说话":6,"读":6,"写":6,"学习":6,"工作":6,"做":6,"打电话":6,"去":7,"来":7,"回":7,"住":7,"在":7,"坐":7,"开":7,"睡觉":7,"下雨":7,"认识":7,"会":7,"能":7,"有":7,"是":7,"书":8,"字":8,"东西":8,"衣服":8,"椅子":8,"桌子":8,"电脑":8,"电视":8,"电影":8,"猫":8,"狗":8,"天气":8,"热":8,"冷":8,"大":9,"小":9,"多":9,"少":9,"好":9,"高兴":9,"漂亮":9,"很":9,"太":9,"都":9,"不":9,"没":9,"汉语":9,"什么":10,"哪":10,"那":10,"这":10,"怎么":10,"怎么样":10,"呢":10,"吗":10,"的":10,"了":10,"和":10,"些":10,"本":10};

  function hanCount(h) { return (h.match(/[\u3400-\u9fff]/g) || []).length; }

  function toWord(e) {
    var syl = window.Pinyin.segment(e.pinyin, hanCount(e.hanzi));
    return {
      id: e.id, h: e.hanzi, pinyin: e.pinyin, ja: e.gloss, level: e.level, entry: e,
      syl: syl || [], plain: syl ? window.Pinyin.plain(syl) : e.pinyin,
      nsyl: syl ? syl.length : hanCount(e.hanzi),
      toneable: !!syl && syl.some(function (s) { return s.tone >= 1 && s.tone <= 4; }),
      // 録音が例文・語句（audioText）になっている語は、リスニング問題には使わない
      listenable: !e.audioText,
      audioNote: e.audioText || ''
    };
  }

  var cache = {};
  function build(level) {
    level = Number(level);
    if (cache[level]) return cache[level];
    var words = window.HSK.wordsForLevel(VOCAB, level).map(toWord);
    var stages = [];
    if (level === 1) {
      L1_NAMES.forEach(function (nm) { stages.push({ name: nm, words: [] }); });
      words.forEach(function (w) {
        var s = L1_THEME[w.h];
        if (s === undefined) s = L1_THEME[w.h.replace(/儿$/, '')];
        if (s === undefined) s = L1_NAMES.length - 1;
        stages[s].words.push(w);
      });
    } else {
      var n = Math.max(1, Math.round(words.length / STAGE_SIZE));
      for (var i = 0; i < n; i++) {
        var a = Math.floor(i * words.length / n), b = Math.floor((i + 1) * words.length / n);
        var ws = words.slice(a, b);
        stages.push({ name: ws[0].pinyin + ' 〜 ' + ws[ws.length - 1].pinyin, words: ws });
      }
    }
    stages.forEach(function (st, i) { st.words.forEach(function (w) { w.s = i; }); });
    cache[level] = { level: level, words: words, stages: stages };
    return cache[level];
  }
  function counts() { var c = {}; for (var l = 1; l <= 6; l++) c[l] = window.HSK.wordsForLevel(VOCAB, l).length; return c; }

  window.GameLevels = { build: build, counts: counts, audioSrc: function (w) { return '../' + window.HSK.audioPlaybackSrc(w.entry); } };
})();
