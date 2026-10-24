/* Shared checker for HSKもじバトル question generation (used by test/game-questions.test.js).
   Rule A (pinyin/tone): a wrong option must never be another real reading of the same hanzi
     (any reading in vocab.js across all levels, pypinyin heteronyms of single characters,
     the QA report's list, or a 一/不 tone-sandhi form). Single polyphonic characters get no tone questions.
   Rule B (meaning): no two options may share a normalized meaning segment; a distractor's meaning must not
     overlap the prompt / answer meaning; no option may be another entry of the same hanzi. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const REPORT_READINGS = {
  "好": ["hǎo", "hào"], "少": ["shǎo", "shào"], "一": ["yī", "yí", "yì"], "不": ["bù", "bú"], "只": ["zhǐ", "zhī"], "教": ["jiāo", "jiào"],
  "看": ["kàn", "kān"], "为": ["wèi", "wéi"], "种": ["zhǒng", "zhòng"], "数": ["shǔ", "shù"], "难": ["nán", "nàn"], "分": ["fēn", "fèn"],
  "要": ["yào", "yāo"], "当": ["dāng", "dàng"], "发": ["fā", "fà"], "背": ["bèi", "bēi"], "倒": ["dào", "dǎo"], "干": ["gàn", "gān"],
  "更": ["gèng", "gēng"], "正": ["zhèng", "zhēng"], "便": ["biàn", "pián", "biān"], "号": ["hào", "háo"], "长": ["cháng", "zhǎng"],
  "尽量": ["jǐnliàng", "jìnliàng"]
};

function load(files) {
  const window = {};
  const context = vm.createContext({ window, globalThis: window, console });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  return window;
}
function loadGame() {
  return load(["js/hsk.js", "data/vocab.js", "game/js/pinyin.js", "game/js/readings.js", "game/js/questions.js", "game/js/levels.js"]);
}

function makeChecker(w) {
  const norm = (p) => String(p || "").normalize("NFC").toLowerCase().replace(/[\s'’\-·]/g, "");
  const han = (h) => String(h).match(/[\u3400-\u9fff]/g) || [];
  const all = w.HSK.prepareVocab(w.HSK_VOCAB);
  const byHanzi = new Map();
  for (const e of all) { if (!byHanzi.has(e.hanzi)) byHanzi.set(e.hanzi, []); byHanzi.get(e.hanzi).push(e); }
  const segs = w.GameQuestions.glossSegs;
  const legit = (word) => {
    const set = new Set([norm(word.pinyin)]);
    for (const e of byHanzi.get(word.h) || []) set.add(norm(e.pinyin));
    for (const p of REPORT_READINGS[word.h] || []) set.add(norm(p));
    if (word.h.length === 1) for (const p of (w.GAME_READINGS || {})[word.h] || []) set.add(norm(p));
    return set;
  };
  // differs from the answer only in 一 (yī/yí/yì/yi) or 不 (bù/bú/bu) syllables → a sandhi form
  const sandhiForm = (word, choice) => {
    const ch = han(word.h);
    if (!word.syl || word.syl.length !== ch.length || !/[一不]/.test(word.h)) return false;
    const s = w.Pinyin.segment(choice, ch.length);
    if (!s || s.length !== ch.length) return false;
    let diff = false;
    for (let i = 0; i < ch.length; i += 1) {
      if (s[i].base !== word.syl[i].base) return false;
      if (s[i].tone !== word.syl[i].tone) {
        const ok = { "一": [1, 2, 4, 5], "不": [2, 4, 5] }[ch[i]];
        if (!ok || !ok.includes(s[i].tone)) return false;
        diff = true;
      }
    }
    return diff;
  };
  const sensesOfHanzi = (h, extra) => {
    let out = [];
    for (const e of byHanzi.get(h) || []) out = out.concat(segs(e.gloss));
    if (extra) out = out.concat(segs(extra));
    return out;
  };
  const meets = (a, b) => a.some((x) => b.includes(x));
  const polyphonic = (word) => word.h.length === 1 && legit(word).size > 1;

  // returns a list of violation strings for one generated question
  return function check(q, levelWords) {
    const v = [];
    const word = q.word;
    if (q.choices.length !== 4) v.push("option count " + q.choices.length + " " + word.h + " " + q.type);
    if (new Set(q.choices).size !== q.choices.length) v.push("duplicate option text");
    if (q.choices[q.answer] !== ({ h2ja: word.ja, h2py: word.pinyin, tone: word.pinyin, ja2h: word.h, listen: word.h })[q.type]) v.push("answer mismatch");
    const wrong = q.choices.filter((c, i) => i !== q.answer);
    if (q.type === "h2py" || q.type === "tone") {
      const L = legit(word);
      for (const c of wrong) {
        if (L.has(norm(c))) v.push("A:other reading " + word.h + " " + c);
        else if (sandhiForm(word, c)) v.push("A:sandhi form " + word.h + " " + c);
      }
      if (q.type === "tone" && polyphonic(word)) v.push("A:tone question on polyphonic " + word.h);
    }
    if (q.type === "h2ja") {
      const S = sensesOfHanzi(word.h, word.h === "对" ? "正しい" : "").concat(segs(word.ja));
      const lists = q.choices.map((c) => segs(c));
      wrong.forEach((c) => {
        if (meets(segs(c), S)) v.push("B:distractor overlaps answer " + word.h + " [" + c + "]");
        const owner = levelWords.filter((x) => x.ja === c);
        if (owner.some((x) => x.h === word.h)) v.push("B:same hanzi " + word.h);
      });
      for (let i = 0; i < lists.length; i += 1) for (let j = i + 1; j < lists.length; j += 1) {
        if (i !== q.answer && j !== q.answer && meets(lists[i], lists[j])) v.push("B:options overlap " + word.h + " [" + q.choices[i] + "] [" + q.choices[j] + "]");
      }
    }
    if (q.type === "ja2h") {
      const P = segs(q.main);
      const senses = q.choices.map((h) => (h === word.h ? sensesOfHanzi(h).concat(P) : sensesOfHanzi(h)));
      wrong.forEach((h) => {
        if (h === word.h) v.push("B:same hanzi " + h);
        if (meets(sensesOfHanzi(h), P)) v.push("B:distractor meaning overlaps prompt " + word.h + " vs " + h);
      });
      for (let i = 0; i < senses.length; i += 1) for (let j = i + 1; j < senses.length; j += 1) {
        if (i !== q.answer && j !== q.answer && meets(senses[i], senses[j])) v.push("B:options overlap " + q.choices[i] + " / " + q.choices[j]);
      }
    }
    return v;
  };
}

module.exports = { load, loadGame, makeChecker, REPORT_READINGS };
