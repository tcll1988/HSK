const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadHsk } = require("./load-hsk");

const EXPECTED = { 1: 148, 2: 147, 3: 298, 4: 586, 5: 1311, 6: 2513 };

test("each level filter returns only that level", () => {
  const { HSK, vocab } = loadHsk();
  [1, 2, 3, 4, 5, 6].forEach((level) => {
    const words = HSK.wordsForLevel(vocab, level);
    assert.equal(words.length, EXPECTED[level]);
    assert.ok(words.every((entry) => entry.level === level));
    const other = vocab.filter((entry) => entry.level !== level).map((entry) => entry.id);
    const ids = new Set(words.map((entry) => entry.id));
    other.forEach((id) => assert.equal(ids.has(id), false));
  });

  const level1 = HSK.wordsForLevel(vocab, 1).map((entry) => entry.hanzi);
  const level6 = HSK.wordsForLevel(vocab, 6).map((entry) => entry.hanzi);
  assert.ok(level1.includes("昨天"));
  assert.equal(level1.includes("爱不释手"), false);
  assert.ok(level6.includes("爱不释手"));
  assert.equal(level6.includes("昨天"), false);
});
