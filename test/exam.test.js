/* HSK Past Exam Training (exam/) data integrity and pure logic tests. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const examDir = path.join(root, "exam");
const examCore = require(path.join(examDir, "js/exam-core.js"));

function loadManifest() {
  const win = {};
  const ctx = vm.createContext({ window: win, globalThis: win });
  const src = fs.readFileSync(path.join(examDir, "data/manifest.js"), "utf8");
  vm.runInContext(src, ctx, { filename: "exam/data/manifest.js" });
  return win.HSK_EXAM_MANIFEST;
}

function loadSet(setId) {
  const win = { HSK_EXAM_SETS: {} };
  const ctx = vm.createContext({ window: win, globalThis: win });
  const file = path.join(examDir, "data/sets", setId + ".js");
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  return win.HSK_EXAM_SETS[setId];
}

function loadVocab() {
  const win = {};
  const ctx = vm.createContext({ window: win, globalThis: win });
  vm.runInContext(fs.readFileSync(path.join(root, "js/hsk.js"), "utf8"), ctx, { filename: "js/hsk.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "data/vocab.js"), "utf8"), ctx, { filename: "data/vocab.js" });
  return win.HSK.prepareVocab(win.HSK_VOCAB);
}

test("exam manifest covers all 54 HSK 1-6 sets with valid question counts", () => {
  const manifest = loadManifest();
  assert.ok(manifest && Array.isArray(manifest.sets));
  assert.equal(manifest.sets.length, 54);
  const perLevel = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const expectedTotalPerLevel = { 1: 40, 2: 60, 3: 80, 4: 100, 5: 100, 6: 101 };
  let totalQuestions = 0;
  for (const meta of manifest.sets) {
    perLevel[meta.level] += 1;
    assert.equal(meta.totalQuestions, expectedTotalPerLevel[meta.level], meta.id);
    totalQuestions += meta.totalQuestions;
    assert.ok(fs.existsSync(path.join(examDir, "data/sets", meta.id + ".js")), meta.id + " js missing");
  }
  assert.deepEqual(perLevel, { 1: 6, 2: 7, 3: 9, 4: 10, 5: 11, 6: 11 });
  assert.equal(totalQuestions, 4591);
});

test("every exam set has valid questions, valid answers, existing images, and valid audio files", () => {
  const manifest = loadManifest();
  const garbledRe = /[\u0370-\u1fff\ufffd\ue000-\uf8ff]/;
  let audioSets = 0;
  let checkedImages = 0;
  let pinyinACount = 0;

  function assertCleanText(val, label) {
    if (!val) return;
    assert.ok(!garbledRe.test(val), label + " contains garbled text: " + val.slice(0, 40));
  }

  for (const meta of manifest.sets) {
    const s = loadSet(meta.id);
    assert.equal(s.id, meta.id);
    assert.equal(s.level, meta.level);
    assert.equal(s.questions.length, meta.totalQuestions, meta.id + " question count");

    const groups = new Map();
    for (const sec of s.sections) {
      for (const pt of sec.parts) {
        for (const g of pt.groups || []) {
          groups.set(g.id, g);
          assertCleanText(g.passage, meta.id + " " + g.id + " passage");
          if (g.image) {
            assert.ok(fs.existsSync(path.join(examDir, g.image)), meta.id + " missing " + g.image);
            checkedImages += 1;
          }
          for (const item of g.pool || []) {
            assertCleanText(item.text, meta.id + " " + g.id + " pool " + item.key);
            if (item.pinyin && item.pinyin.includes("ā")) pinyinACount += 1;
            if (item.image) {
              assert.ok(fs.existsSync(path.join(examDir, item.image)), meta.id + " missing " + item.image);
              checkedImages += 1;
            }
          }
        }
      }
    }

    s.questions.forEach((q, idx) => {
      assert.equal(q.n, idx + 1, meta.id + " sequential question number");
      assertCleanText(q.prompt, meta.id + " Q" + q.n + " prompt");
      assertCleanText(q.passage, meta.id + " Q" + q.n + " passage");
      assertCleanText(q.transcript, meta.id + " Q" + q.n + " transcript");
      assertCleanText(q.answer, meta.id + " Q" + q.n + " answer");
      assert.ok(
        typeof q.explanationJa === "string" && q.explanationJa.trim().length >= 10 && /[\u3040-\u309f\u30a0-\u30ff]/.test(q.explanationJa),
        meta.id + " Q" + q.n + " must have Japanese explanationJa"
      );
      if (q.promptPinyin && q.promptPinyin.includes("ā")) pinyinACount += 1;
      if (q.pinyinHint && q.pinyinHint.includes("ā")) pinyinACount += 1;
      if (q.section === "listening" && meta.hasTranscript) {
        assert.ok(q.transcript && q.transcript.trim().length > 0, meta.id + " Q" + q.n + " missing transcript");
      }
      if (q.section === "reading") {
        const g = groups.get(q.groupId);
        if (q.type === "tf" || q.type === "match") {
          assert.ok(q.prompt && q.prompt.trim().length > 0, meta.id + " Q" + q.n + " empty reading prompt");
        } else if (q.type === "mc" && !(s.level === 6 && q.n >= 51 && q.n <= 60)) {
          assert.ok(
            (q.prompt && q.prompt.trim().length > 0) || (g && g.passage && g.passage.trim().length > 0),
            meta.id + " Q" + q.n + " missing reading prompt/passage"
          );
        }
      }
      if (q.image) {
        assert.ok(fs.existsSync(path.join(examDir, q.image)), meta.id + " Q" + q.n + " missing " + q.image);
        checkedImages += 1;
      }
      if (q.type === "tf") {
        assert.ok(q.answer === "√" || q.answer === "×", meta.id + " Q" + q.n + " tf answer");
      } else if (q.type === "mc") {
        const expectedLen = s.level <= 3 ? 3 : 4;
        assert.equal(q.options.length, expectedLen, meta.id + " Q" + q.n + " option count");
        const keys = new Set(q.options.map((o) => o.key));
        assert.ok(keys.has(q.answer), meta.id + " Q" + q.n + " answer in options");
        for (const o of q.options) {
          assertCleanText(o.text, meta.id + " Q" + q.n + " opt " + o.key);
          if (o.pinyin && o.pinyin.includes("ā")) pinyinACount += 1;
          if (o.image) {
            assert.ok(fs.existsSync(path.join(examDir, o.image)), meta.id + " Q" + q.n + " opt missing " + o.image);
            checkedImages += 1;
          }
        }
      } else if (q.type === "match") {
        const g = groups.get(q.groupId);
        assert.ok(g, meta.id + " Q" + q.n + " group exists");
        const keys = new Set(g.pool.map((p) => p.key));
        assert.ok(keys.has(q.answer), meta.id + " Q" + q.n + " match answer in pool");
      } else if (q.type === "order") {
        assert.equal(q.options.length, 3, meta.id + " Q" + q.n + " 3 order clauses");
        assert.match(q.answer, /^[ABC]{3}$/, meta.id + " Q" + q.n + " order answer");
        assert.equal(new Set(q.answer.split("")).size, 3);
      } else if (q.type === "scramble") {
        assert.ok(Array.isArray(q.tokens) && q.tokens.length >= 2, meta.id + " Q" + q.n + " scramble tokens");
        assert.ok(q.answer && q.answer.length >= 2, meta.id + " Q" + q.n + " scramble answer");
      } else if (q.type === "char_input") {
        assert.ok(q.pinyinHint && q.pinyinHint.length >= 1, meta.id + " Q" + q.n + " pinyinHint");
        assert.ok(q.answer && q.answer.length >= 1, meta.id + " Q" + q.n + " char_input answer");
      } else if (q.type === "essay") {
        if (s.level === 6) {
          assert.ok(q.passage && q.passage.length >= 300, meta.id + " Q101 summary passage");
        }
      }
    });

    if (meta.hasAudio) {
      audioSets += 1;
      const audioPath = path.join(examDir, meta.audio);
      assert.ok(fs.existsSync(audioPath), meta.id + " audio missing: " + meta.audio);
      assert.ok(fs.statSync(audioPath).size > 100_000, meta.id + " audio too small");
      assert.ok(meta.audioDuration > 120, meta.id + " audioDuration positive");
    }
  }

  assert.equal(audioSets, 48);
  assert.ok(checkedImages >= 650, "expected >= 650 extracted images, got " + checkedImages);
  assert.ok(pinyinACount >= 150, "expected intact first-tone pinyin ā, got " + pinyinACount);
});

test("exam-core grading covers tf, mc, match, order, scramble (with punctuation/altAnswers), char_input, and essay", () => {
  assert.equal(examCore.gradeQuestion({ type: "tf", answer: "√" }, "√").correct, true);
  assert.equal(examCore.gradeQuestion({ type: "tf", answer: "√" }, "×").correct, false);
  assert.equal(examCore.gradeQuestion({ type: "mc", answer: "B" }, "B").correct, true);
  assert.equal(examCore.gradeQuestion({ type: "match", answer: "E" }, "E").correct, true);
  assert.equal(examCore.gradeQuestion({ type: "order", answer: "BAC" }, "bac").correct, true);
  assert.equal(examCore.gradeQuestion({ type: "order", answer: "BAC" }, "BA").correct, false);
  assert.equal(examCore.gradeQuestion({ type: "char_input", answer: "出" }, " 出 ").correct, true);

  const scram = {
    type: "scramble",
    answer: "她很羡慕会弹钢琴的人。",
    altAnswers: ["会弹钢琴的人很羡慕她。"]
  };
  assert.equal(examCore.gradeQuestion(scram, "她很羡慕会弹钢琴的人").correct, true);
  assert.equal(examCore.gradeQuestion(scram, "会弹钢琴的人很羡慕她！").correct, true);
  assert.equal(examCore.gradeQuestion(scram, "她会弹钢琴").correct, false);

  const essay = { type: "essay", keywords: ["结账", "感谢"], targetLength: 20 };
  const eRes = examCore.gradeQuestion(essay, "昨天朋友请客结账，我非常感谢他的热情招待。");
  assert.equal(eRes.gradable, false);
  assert.equal(eRes.keywordsUsed, 2);
  assert.equal(eRes.keywordsTotal, 2);
  assert.ok(eRes.scoreRatio >= 0.9);
});

test("exam-core scoreExam computes official HSK 200-pt (L1-2) and 300-pt (L3-6) scaled scores", () => {
  const s1 = loadSet("H10901");
  const allRight1 = {};
  s1.questions.forEach((q) => { allRight1[String(q.n)] = q.answer; });
  const r1 = examCore.scoreExam(s1, allRight1);
  assert.equal(r1.maxScaled, 200);
  assert.equal(r1.passLine, 120);
  assert.equal(r1.totalScaled, 200);
  assert.equal(r1.passed, true);
  assert.equal(r1.wrongNumbers.length, 0);

  const s4 = loadSet("H41001");
  const partial4 = {};
  s4.questions.forEach((q) => {
    if (q.n <= 75) partial4[String(q.n)] = q.answer;
  });
  const r4 = examCore.scoreExam(s4, partial4);
  assert.equal(r4.maxScaled, 300);
  assert.equal(r4.passLine, 180);
  assert.ok(r4.totalScaled >= 160 && r4.totalScaled < 300);
  assert.ok(r4.wrongNumbers.includes(76));
});

test("exam-core vocab lookup segments Chinese exam text and builds Japanese wrong-answer explanations", () => {
  const vocab = loadVocab();
  const idx = examCore.buildVocabIndex(vocab);
  const segs = examCore.segmentTextWithVocab("我明天去图书馆学习汉语。", idx);
  const words = segs.filter((s) => s.entries).map((s) => s.text);
  assert.ok(words.includes("明天"));
  assert.ok(words.includes("图书馆"));
  assert.ok(words.includes("学习"));
  assert.ok(words.includes("汉语"));

  const expMc = examCore.buildWrongExplanation({
    type: "mc",
    prompt: "他每天去图书馆学习。",
    options: [
      { key: "A", text: "去医院" },
      { key: "B", text: "去图书馆" },
      { key: "C", text: "去商店" }
    ],
    answer: "B",
    explanationJa: "本文に「每天去图书馆学习（毎日図書館へ勉強しに行く）」とあるため、Bが正解です。"
  }, "A", { vocabIndex: idx, level: 2 });
  assert.match(expMc.summaryJa, /図書館/);
  assert.equal(expMc.comparison.userText, "A：去医院");
  assert.equal(expMc.comparison.answerText, "B：去图书馆");
  assert.ok(expMc.keyVocab.some((v) => v.hanzi === "图书馆" && v.meaning.length > 0));

  const expScram = examCore.buildWrongExplanation({
    type: "scramble",
    tokens: ["他", "把", "书", "放在", "桌子上了"],
    answer: "他把书放在桌子上了。",
    explanationJa: "「把」構文（主語＋把＋目的語＋動詞＋場所補語）で「彼は本を机の上に置いた」となります。"
  }, "他书把放在桌子上了", { vocabIndex: idx, level: 4 });
  assert.ok(expScram.grammarHints.some((h) => h.includes("「把」構文")));
  assert.equal(expScram.comparison.answerText, "他把书放在桌子上了。");
});

test("exam/index.html references existing shared site files and exam assets", () => {
  const html = fs.readFileSync(path.join(examDir, "index.html"), "utf8");
  for (const rel of ["../js/hsk.js", "../data/vocab.js", "../js/study.js", "data/manifest.js", "js/exam-core.js", "js/exam.js", "css/exam.css"]) {
    assert.ok(html.includes(rel), "exam/index.html must load " + rel);
    assert.ok(fs.existsSync(path.resolve(examDir, rel)), "missing file " + rel);
  }
});
