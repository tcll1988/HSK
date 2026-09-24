/* Pure study logic. Loaded with a plain script tag; attaches window.HSK. */
(function () {
  "use strict";

  // Workbook glosses stored 生 (and 市 in 都市 / 市場 / 市民) as "Th", 当 as "ft", and 写 as "ti".

  var MODES = {
    gloss: { prompt: "hanzi", choice: "gloss" },
    hanzi: { prompt: "gloss", choice: "hanzi" },
    pinyin: { prompt: "hanzi", choice: "pinyin" }
  };

  function repairGloss(gloss) {
    if (typeof gloss !== "string") {
      throw new TypeError("gloss must be a string");
    }
    return gloss
      .replace(/都Th/g, "都市")
      .replace(/Th場/g, "市場")
      .replace(/Th民/g, "市民")
      .replace(/Th/g, "生")
      .replace(/ft/g, "当")
      .replace(/ti真/g, "写真")
      .replace(/描ti/g, "描写")
      .replace(/書きti/g, "書き写")
      .replace(/複ti/g, "複写");
  }

  function prepareVocab(entries) {
    if (!Array.isArray(entries)) {
      throw new TypeError("vocab must be an array");
    }
    return entries.map(function (entry) {
      var level = Number(entry.level);
      var id = Number(entry.id);
      if (!id) {
        throw new Error("missing id");
      }
      if (level < 1 || level > 6 || level !== Math.floor(level)) {
        throw new Error("bad level on id " + entry.id);
      }
      ["pinyin", "hanzi", "pos", "gloss"].forEach(function (key) {
        if (typeof entry[key] !== "string" || entry[key].length === 0) {
          throw new Error("missing " + key + " on id " + entry.id);
        }
      });
      return {
        id: id,
        pinyin: entry.pinyin,
        hanzi: entry.hanzi,
        level: level,
        pos: entry.pos,
        gloss: repairGloss(entry.gloss)
      };
    });
  }

  function wordsForLevel(vocab, level) {
    var n = Number(level);
    return vocab.filter(function (entry) {
      return entry.level === n;
    });
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rng) {
    var arr = list.slice();
    var i;
    for (i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function buildQuestion(pool, entry, mode, rng) {
    var spec = MODES[mode];
    var correctText = entry[spec.choice];
    var others = shuffle(
      pool.filter(function (item) {
        return item.id !== entry.id && item[spec.choice] !== correctText;
      }),
      rng
    );
    if (others.length < 3) {
      throw new Error("not enough same-level distractors for id " + entry.id);
    }
    var choices = [
      { text: correctText, entryId: entry.id, keyed: true }
    ];
    var i;
    for (i = 0; i < 3; i += 1) {
      choices.push({
        text: others[i][spec.choice],
        entryId: others[i].id,
        keyed: false
      });
    }
    return {
      mode: mode,
      level: entry.level,
      entryId: entry.id,
      prompt: entry[spec.prompt],
      choices: shuffle(choices, rng)
    };
  }

  function buildRound(vocab, level, mode, seed, count) {
    if (!MODES[mode]) {
      throw new Error("unknown practice " + mode);
    }
    var pool = wordsForLevel(prepareVocab(vocab), level);
    if (!pool.length) {
      throw new Error("no words for level " + level);
    }
    var n = count == null ? 10 : Number(count);
    if (!n || n < 1 || n > pool.length) {
      throw new Error("bad round size " + count);
    }
    var rng = mulberry32(Number(seed) || 1);
    return shuffle(pool, rng).slice(0, n).map(function (entry) {
      return buildQuestion(pool, entry, mode, rng);
    });
  }

  function audioSrc(entry) {
    var hanzi = entry && typeof entry === "object" ? entry.hanzi : entry;
    if (typeof hanzi !== "string" || hanzi.length === 0) {
      throw new Error("missing hanzi for audio");
    }
    // FNV-1a over UTF-16 code units keeps the folder stable for each headword.
    var hash = 2166136261;
    var i;
    for (i = 0; i < hanzi.length; i += 1) {
      hash = Math.imul(hash ^ hanzi.charCodeAt(i), 16777619);
    }
    var folder = ("0" + ((hash >>> 0) % 100)).slice(-2);
    return "audio/" + folder + "/" + encodeURIComponent(hanzi) + ".mp3";
  }

  function scoreChoice(question, choiceIndex) {
    if (!question || !question.choices) {
      return false;
    }
    if (choiceIndex < 0 || choiceIndex >= question.choices.length) {
      return false;
    }
    return question.choices[choiceIndex].keyed === true;
  }

  window.HSK = {
    MODES: MODES,
    repairGloss: repairGloss,
    prepareVocab: prepareVocab,
    wordsForLevel: wordsForLevel,
    buildRound: buildRound,
    audioSrc: audioSrc,
    scoreChoice: scoreChoice
  };
})();
