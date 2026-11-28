/* Pure HSK exam logic: grading, official scaled scoring, vocab lookup, and state sanitization.
   Works in browser (window.HSK_EXAM) and Node.js (module.exports). */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HSK_EXAM = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function normalizeChineseSentence(text) {
    if (typeof text !== "string") return "";
    return text
      .trim()
      .replace(/[\s\u3000]+/g, "")
      .replace(/[.。!！?？,，、;；:：“”"''‘’（）()]/g, "");
  }

  function countChineseChars(text) {
    if (typeof text !== "string") return 0;
    // Official HSK character count counts non-whitespace characters (hanzi + punctuation/numbers)
    return text.replace(/\s+/g, "").length;
  }

  function isAnswered(question, response) {
    if (!question || response == null) return false;
    var val = typeof response === "string" ? response.trim() : "";
    if (!val) return false;
    if (question.type === "order") return val.length === 3;
    return true;
  }

  function gradeQuestion(question, response) {
    if (!question) return { answered: false, gradable: false, correct: false, scoreRatio: 0 };
    var ans = typeof response === "string" ? response.trim() : "";
    if (!ans) {
      return {
        answered: false,
        gradable: question.type !== "essay",
        correct: false,
        scoreRatio: 0
      };
    }

    var t = question.type;
    if (t === "tf" || t === "mc" || t === "match") {
      var ok = ans === question.answer;
      return { answered: true, gradable: true, correct: ok, scoreRatio: ok ? 1 : 0 };
    }

    if (t === "order") {
      var normAns = ans.replace(/\s+/g, "").toUpperCase();
      var okOrder = normAns.length === 3 && normAns === question.answer;
      return { answered: true, gradable: true, correct: okOrder, scoreRatio: okOrder ? 1 : 0 };
    }

    if (t === "char_input") {
      var okChar = ans === (question.answer || "").trim();
      return { answered: true, gradable: true, correct: okChar, scoreRatio: okChar ? 1 : 0 };
    }

    if (t === "scramble") {
      var userNorm = normalizeChineseSentence(ans);
      var targets = [question.answer].concat(question.altAnswers || []).filter(Boolean);
      var okScramble = targets.some(function (cand) {
        return userNorm.length > 0 && userNorm === normalizeChineseSentence(cand);
      });
      return { answered: true, gradable: true, correct: okScramble, scoreRatio: okScramble ? 1 : 0 };
    }

    if (t === "essay") {
      // Heuristic completeness check for mock scoring (keywords used + length adequacy)
      var kws = Array.isArray(question.keywords) ? question.keywords.filter(Boolean) : [];
      var usedCount = kws.filter(function (kw) { return ans.indexOf(kw) !== -1; }).length;
      var kwRatio = kws.length ? usedCount / kws.length : 1;
      var targetLen = question.targetLength || 12;
      var chLen = countChineseChars(ans);
      var lenRatio = Math.min(1, chLen / Math.max(6, targetLen * 0.75));
      var ratio = Math.round((kwRatio * 0.6 + lenRatio * 0.4) * 100) / 100;
      return {
        answered: true,
        gradable: false,
        correct: ratio >= 0.8,
        scoreRatio: ratio,
        keywordsUsed: usedCount,
        keywordsTotal: kws.length,
        charCount: chLen
      };
    }

    return { answered: true, gradable: false, correct: false, scoreRatio: 0 };
  }

  function scoreExam(setObj, responses) {
    responses = responses || {};
    var bySection = {};
    setObj.sections.forEach(function (sec) {
      bySection[sec.key] = {
        key: sec.key,
        titleJa: sec.titleJa,
        titleZh: sec.titleZh,
        total: 0,
        answered: 0,
        gradable: 0,
        correct: 0,
        earnedPoints: 0,
        scaledScore: 0
      };
    });

    var wrongNumbers = [];
    setObj.questions.forEach(function (q) {
      var bucket = bySection[q.section];
      if (!bucket) return;
      bucket.total += 1;
      var res = gradeQuestion(q, responses[String(q.n)]);
      if (res.answered) bucket.answered += 1;
      if (res.gradable) {
        bucket.gradable += 1;
        if (res.correct) {
          bucket.correct += 1;
          bucket.earnedPoints += 1;
        } else {
          wrongNumbers.push(q.n);
        }
      } else {
        bucket.earnedPoints += res.scoreRatio;
      }
    });

    var totalScaled = 0;
    var maxScaled = setObj.sections.length * 100; // 200 for HSK 1-2, 300 for HSK 3-6
    var passLine = setObj.level <= 2 ? 120 : 180;

    var sectionList = setObj.sections.map(function (sec) {
      var b = bySection[sec.key];
      b.scaledScore = b.total > 0 ? Math.round((b.earnedPoints / b.total) * 100) : 0;
      totalScaled += b.scaledScore;
      return b;
    });

    return {
      level: setObj.level,
      setId: setObj.id,
      totalScaled: totalScaled,
      maxScaled: maxScaled,
      passLine: passLine,
      passed: totalScaled >= passLine,
      sections: sectionList,
      wrongNumbers: wrongNumbers
    };
  }

  function buildVocabIndex(vocabEntries) {
    var byHanzi = new Map();
    var maxLen = 1;
    (vocabEntries || []).forEach(function (entry) {
      if (!entry || !entry.hanzi) return;
      var h = entry.hanzi;
      if (h.length > maxLen) maxLen = h.length;
      if (!byHanzi.has(h)) byHanzi.set(h, []);
      byHanzi.get(h).push(entry);
    });
    return { byHanzi: byHanzi, maxLen: Math.min(maxLen, 8) };
  }

  function segmentTextWithVocab(text, vocabIndex) {
    if (typeof text !== "string" || !text) return [];
    if (!vocabIndex || !vocabIndex.byHanzi) return [{ text: text, entries: null }];
    var tokens = [];
    var i = 0;
    var n = text.length;
    var plain = "";

    while (i < n) {
      var code = text.charCodeAt(i);
      var isCjk = code >= 0x4e00 && code <= 0x9fff;
      if (!isCjk) {
        plain += text[i];
        i += 1;
        continue;
      }
      var matchedWord = null;
      var matchedEntries = null;
      var limit = Math.min(vocabIndex.maxLen, n - i);
      for (var len = limit; len >= 1; len -= 1) {
        var sub = text.slice(i, i + len);
        if (vocabIndex.byHanzi.has(sub)) {
          matchedWord = sub;
          matchedEntries = vocabIndex.byHanzi.get(sub);
          break;
        }
      }
      if (matchedWord) {
        if (plain) {
          tokens.push({ text: plain, entries: null });
          plain = "";
        }
        tokens.push({ text: matchedWord, entries: matchedEntries });
        i += matchedWord.length;
      } else {
        plain += text[i];
        i += 1;
      }
    }
    if (plain) tokens.push({ text: plain, entries: null });
    return tokens;
  }

  function formatDurationClock(seconds) {
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    var m = Math.floor(s / 60);
    var rem = s % 60;
    return String(m).padStart(2, "0") + ":" + String(rem).padStart(2, "0");
  }

  function sanitizeProgress(raw) {
    var obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var level = Number(obj.level);
    if (!Number.isInteger(level) || level < 1 || level > 6) level = 1;
    var completed = obj.completed && typeof obj.completed === "object" && !Array.isArray(obj.completed) ? obj.completed : {};
    var sessions = obj.sessions && typeof obj.sessions === "object" && !Array.isArray(obj.sessions) ? obj.sessions : {};
    var mistakes = obj.mistakes && typeof obj.mistakes === "object" && !Array.isArray(obj.mistakes) ? obj.mistakes : {};
    return {
      level: level,
      activeSetId: typeof obj.activeSetId === "string" ? obj.activeSetId : "",
      activeMode: obj.activeMode === "mock" ? "mock" : "practice",
      completed: completed,
      sessions: sessions,
      mistakes: mistakes,
      updatedAt: Number.isFinite(obj.updatedAt) ? obj.updatedAt : 0
    };
  }

  var BASIC_STOP_WORDS = new Set([
    "的", "了", "吗", "呢", "吧", "啊", "呀", "我", "你", "他", "她", "它",
    "是", "在", "有", "不", "这", "那", "也", "都", "和", "很", "就", "还",
    "一", "个", "人", "上", "下", "里", "来", "去", "到", "说", "看", "会", "能", "要"
  ]);

  var GRAMMAR_PATTERNS = [
    { re: /把/, label: "「把」構文（主語＋把＋目的語＋動詞＋その他成分）" },
    { re: /被/, label: "「被」受身文（主語＋被＋行為者＋動詞＋その他成分）" },
    { re: /比/, label: "「比」比較文（A＋比＋B＋形容詞／程度）" },
    { re: /虽然[\s\S]*?(但是|可是|却)/, label: "譲歩複文「虽然…但是／可是…」（〜だけれども…）" },
    { re: /因为[\s\S]*?所以/, label: "因果複文「因为…所以…」（〜なので…）" },
    { re: /不但[\s\S]*?(而且|还|也)/, label: "累加複文「不但…而且／还…」（〜だけでなく…も）" },
    { re: /不仅[\s\S]*?(而且|还|也)/, label: "累加複文「不仅…而且／还…」（〜だけでなく…も）" },
    { re: /只要[\s\S]*?就/, label: "十分条件「只要…就…」（〜しさえすれば…）" },
    { re: /只有[\s\S]*?才/, label: "必要条件「只有…才…」（〜して初めて…）" },
    { re: /即使[\s\S]*?也/, label: "仮定譲歩「即使…也…」（たとえ〜でも…）" },
    { re: /既然[\s\S]*?就/, label: "既定因果「既然…就…」（〜である以上は…）" },
    { re: /无论[\s\S]*?(都|也)/, label: "無条件「无论…都／也…」（〜にかかわらず…）" },
    { re: /一边[\s\S]*?一边/, label: "同時進行「一边…一边…」（〜しながら…）" },
    { re: /越[\s\S]*?越/, label: "比例変化「越…越…」（〜すればするほど…）" },
    { re: /既[\s\S]*?(又|也)/, label: "並列「既…又／也…」（〜でもあり…でもある）" },
    { re: /连[\s\S]*?(都|也)/, label: "強調「连…都／也…」（〜でさえ…）" },
    { re: /是[\s\S]+的[。！!]?$/, label: "「是…的」構文（時間・場所・方法・動作主などの強調）" },
    { re: /[\u4e00-\u9fff]得[\u4e00-\u9fff]/, label: "「得」様態・程度補語（動詞＋得＋程度・状態）" }
  ];

  function detectGrammarHints(text) {
    if (typeof text !== "string" || !text) return [];
    var hits = [];
    for (var i = 0; i < GRAMMAR_PATTERNS.length; i += 1) {
      if (GRAMMAR_PATTERNS[i].re.test(text)) {
        hits.push(GRAMMAR_PATTERNS[i].label);
        if (hits.length >= 2) break;
      }
    }
    return hits;
  }

  function extractKeyVocab(texts, vocabIndex, level, maxItems) {
    if (!vocabIndex || !vocabIndex.byHanzi) return [];
    var limit = maxItems || 6;
    var seen = new Set();
    var multi = [];
    var single = [];
    var allowStop = Number(level) === 1;

    (texts || []).forEach(function (txt) {
      if (typeof txt !== "string" || !txt) return;
      var segs = segmentTextWithVocab(txt, vocabIndex);
      segs.forEach(function (seg) {
        if (!seg.entries || !seg.entries.length) return;
        var h = seg.text;
        if (seen.has(h)) return;
        seen.add(h);
        // Prefer entry closest to current exam level
        var best = seg.entries[0];
        if (level && seg.entries.length > 1) {
          for (var j = 0; j < seg.entries.length; j += 1) {
            if (seg.entries[j].level === level) { best = seg.entries[j]; break; }
          }
        }
        var item = {
          hanzi: best.hanzi,
          pinyin: best.pinyin || "",
          meaning: best.gloss || best.meaning || "",
          pos: best.pos || "",
          level: best.level || 1,
          entry: best
        };
        if (h.length >= 2) {
          multi.push(item);
        } else if (allowStop || !BASIC_STOP_WORDS.has(h)) {
          single.push(item);
        }
      });
    });

    return multi.concat(single).slice(0, limit);
  }

  function findOptionText(list, key) {
    if (!Array.isArray(list) || !key) return "";
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].key === key) {
        if (list[i].text) return list[i].text;
        if (list[i].image) return "（画像 " + key + "）";
      }
    }
    return "";
  }

  function buildWrongExplanation(question, userVal, opts) {
    opts = opts || {};
    var q = question || {};
    var uVal = typeof userVal === "string" ? userVal.trim() : "";
    var group = opts.group || null;
    var vocabIndex = opts.vocabIndex || null;
    var level = opts.level || 0;
    var comparison = null;
    var assembledSentence = "";
    var grammarHints = [];
    var vocabSources = [];

    if (q.type === "tf") {
      var mapTf = function (v) { return v === "√" ? "正しい（√）" : v === "×" ? "誤り（×）" : v; };
      if (uVal && uVal !== q.answer) {
        comparison = {
          userLabel: "あなたの解答",
          userText: mapTf(uVal),
          answerLabel: "正解",
          answerText: mapTf(q.answer)
        };
      }
      vocabSources.push(q.prompt, q.question, q.transcript);
    } else if (q.type === "mc") {
      var ansText = findOptionText(q.options, q.answer);
      var usrText = findOptionText(q.options, uVal);
      if (uVal && uVal !== q.answer) {
        comparison = {
          userLabel: "あなたの解答",
          userText: uVal + (usrText ? "：" + usrText : ""),
          answerLabel: "正解",
          answerText: q.answer + (ansText ? "：" + ansText : "")
        };
      }
      vocabSources.push(ansText, q.question, q.prompt, q.transcript, usrText);
    } else if (q.type === "match") {
      var pool = group && Array.isArray(group.pool) ? group.pool : [];
      var mAnsText = findOptionText(pool, q.answer);
      var mUsrText = findOptionText(pool, uVal);
      if (uVal && uVal !== q.answer) {
        comparison = {
          userLabel: "あなたの解答",
          userText: uVal + (mUsrText ? "：" + mUsrText : ""),
          answerLabel: "正解",
          answerText: q.answer + (mAnsText ? "：" + mAnsText : "")
        };
      }
      vocabSources.push(mAnsText, q.prompt, q.transcript, mUsrText);
    } else if (q.type === "order") {
      var normU = uVal.replace(/\s+/g, "").toUpperCase();
      var seq = (q.answer || "").split("");
      var clauseTexts = seq.map(function (k) { return findOptionText(q.options, k); }).filter(Boolean);
      assembledSentence = clauseTexts.reduce(function (acc, cur, idx) {
        if (!idx) return cur;
        var sep = /[，。！？；：、,.!?;:]$/.test(acc) ? "" : "，";
        return acc + sep + cur;
      }, "");
      if (assembledSentence && !/[。！？.!?]$/.test(assembledSentence)) assembledSentence += "。";
      if (normU && normU !== q.answer) {
        comparison = {
          userLabel: "あなたが選んだ順序",
          userText: normU.split("").join(" → "),
          answerLabel: "正しい順序",
          answerText: seq.join(" → ")
        };
      }
      grammarHints = detectGrammarHints(assembledSentence);
      vocabSources.push(assembledSentence);
    } else if (q.type === "scramble") {
      if (uVal) {
        comparison = {
          userLabel: "あなたの文",
          userText: uVal,
          answerLabel: "正解の文",
          answerText: q.answer || ""
        };
      }
      grammarHints = detectGrammarHints(q.answer || "");
      vocabSources = (q.tokens || []).concat([q.answer]);
    } else if (q.type === "char_input") {
      var promptStr = q.prompt || "";
      var filled = promptStr;
      if (/[（(]\s*[）)]/.test(promptStr)) {
        filled = promptStr.replace(/[（(]\s*[）)]/, "【" + (q.answer || "") + "】");
      } else if (/_{2,}/.test(promptStr)) {
        filled = promptStr.replace(/_{2,}/, "【" + (q.answer || "") + "】");
      } else {
        filled = promptStr + " → 【" + (q.answer || "") + "】";
      }
      assembledSentence = filled;
      if (uVal && uVal !== q.answer) {
        comparison = {
          userLabel: "あなたの入力",
          userText: uVal,
          answerLabel: "正解の漢字",
          answerText: (q.answer || "") + (q.pinyinHint ? "（" + q.pinyinHint + "）" : "")
        };
      }
      vocabSources.push(q.answer, promptStr);
    } else if (q.type === "essay") {
      vocabSources = (q.keywords || []).concat([q.prompt, q.answer]);
    }

    var summaryJa = (typeof q.explanationJa === "string" && q.explanationJa.trim())
      ? q.explanationJa.trim()
      : (q.answer ? "正解は「" + q.answer + "」です。文脈・語順と下のポイント語彙を確認しましょう。" : "公式の設問指示とポイント語彙を確認しましょう。");

    return {
      summaryJa: summaryJa,
      comparison: comparison,
      assembledSentence: assembledSentence,
      grammarHints: grammarHints,
      keyVocab: extractKeyVocab(vocabSources, vocabIndex, level, 6)
    };
  }

  return {
    normalizeChineseSentence: normalizeChineseSentence,
    countChineseChars: countChineseChars,
    isAnswered: isAnswered,
    gradeQuestion: gradeQuestion,
    scoreExam: scoreExam,
    buildVocabIndex: buildVocabIndex,
    segmentTextWithVocab: segmentTextWithVocab,
    detectGrammarHints: detectGrammarHints,
    extractKeyVocab: extractKeyVocab,
    buildWrongExplanation: buildWrongExplanation,
    formatDurationClock: formatDurationClock,
    sanitizeProgress: sanitizeProgress
  };
});
