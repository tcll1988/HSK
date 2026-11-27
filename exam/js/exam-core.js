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

  return {
    normalizeChineseSentence: normalizeChineseSentence,
    countChineseChars: countChineseChars,
    isAnswered: isAnswered,
    gradeQuestion: gradeQuestion,
    scoreExam: scoreExam,
    buildVocabIndex: buildVocabIndex,
    segmentTextWithVocab: segmentTextWithVocab,
    formatDurationClock: formatDurationClock,
    sanitizeProgress: sanitizeProgress
  };
});
