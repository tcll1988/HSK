const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGame, makeChecker } = require("./game-question-rules.js");

const SAMPLES = Number(process.env.HSK_GAME_QUESTION_SAMPLES || 8);
const TYPES = ["h2ja", "h2py", "ja2h", "tone", "listen"];
const w = loadGame();
const check = makeChecker(w);

let all = null;
function sweep(filter) {
  if (!all) all = sweepAll();
  return { total: all.total, found: all.found.filter((line) => filter(line.split(": ").slice(1).join(": "))) };
}
function sweepAll() {
  const found = [];
  let total = 0;
  for (let level = 1; level <= 6; level += 1) {
    const data = w.GameLevels.build(level);
    const qg = w.GameQuestions.create(data.words, data.stages.map((s) => s.words));
    for (const word of data.words) {
      for (const type of TYPES) {
        for (let k = 0; k < SAMPLES; k += 1) {
          const q = qg.make(word, type);
          total += 1;
          for (const v of check(q, data.words)) found.push(`L${level} ${word.id} ${type}: ${v}`);
        }
      }
    }
  }
  return { total, found };
}

test("pinyin/tone distractors are never another real reading of the same hanzi (every word, all levels)", () => {
  const { total, found } = sweep((v) => v.startsWith("A:"));
  assert.ok(total > 5000 * TYPES.length * SAMPLES * 0.99);
  assert.deepEqual(found.slice(0, 20), []);
});

test("meaning options never repeat or overlap the answer, the prompt or each other (every word, all levels)", () => {
  const { found } = sweep((v) => v.startsWith("B:"));
  assert.deepEqual(found.slice(0, 20), []);
});

test("every generated question has 4 distinct options with the right answer", () => {
  const { found } = sweep((v) => !v.startsWith("A:") && !v.startsWith("B:"));
  assert.deepEqual(found.slice(0, 20), []);
});

test("known polyphones and synonyms from the content QA report", () => {
  const Q = w.GameQuestions;
  const words = [1, 2, 3, 4, 5, 6].flatMap((level) => w.GameLevels.build(level).words);
  const word = (h) => words.find((x) => x.h === h);
  for (const [h, other] of [["好", "hào"], ["少", "shào"], ["看", "kān"], ["一", "yí"], ["一", "yì"], ["不", "bú"]]) {
    const x = word(h);
    assert.ok(Q.isReading(x, other), `${h} ${other}`);
    assert.ok(Q.polyphonicChar(x), `${h} is polyphonic`);
  }
  assert.ok(Q.overlap(Q.glossSegs("待つ、待機する"), Q.glossSegs("待つ")));
  assert.ok(Q.overlap(Q.sensesOf(word("对")), Q.glossSegs("正しい")));
});
