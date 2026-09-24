const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadHsk } = require("./load-hsk");

const CHOICE_FIELD = { gloss: "gloss", hanzi: "hanzi", pinyin: "pinyin" };
const PROMPT_FIELD = { gloss: "hanzi", hanzi: "gloss", pinyin: "hanzi" };

test("three practices stay inside the selected level and score the keyed choice", () => {
  const { HSK, vocab } = loadHsk();
  const byId = new Map(vocab.map((entry) => [entry.id, entry]));
  const seed = 20260924;

  [1, 2, 3, 4, 5, 6].forEach((level) => {
    ["gloss", "hanzi", "pinyin"].forEach((mode) => {
      const round = HSK.buildRound(vocab, level, mode, seed, 10);
      assert.equal(round.length, 10);
      const again = HSK.buildRound(vocab, level, mode, seed, 10);
      assert.deepEqual(again, round);

      round.forEach((question) => {
        assert.equal(question.level, level);
        assert.equal(question.mode, mode);
        assert.equal(question.choices.length, 4);
        const keyed = question.choices.filter((choice) => choice.keyed);
        assert.equal(keyed.length, 1);
        const correctIndex = question.choices.findIndex((choice) => choice.keyed);
        const wrongIndex = question.choices.findIndex((choice) => !choice.keyed);
        assert.equal(HSK.scoreChoice(question, correctIndex), true);
        assert.equal(HSK.scoreChoice(question, wrongIndex), false);
        assert.equal(HSK.scoreChoice(question, -1), false);
        assert.equal(HSK.scoreChoice(question, 4), false);

        const promptEntry = byId.get(question.entryId);
        assert.equal(promptEntry.level, level);
        assert.equal(question.prompt, promptEntry[PROMPT_FIELD[mode]]);
        assert.equal(keyed[0].text, promptEntry[CHOICE_FIELD[mode]]);
        assert.equal(keyed[0].entryId, promptEntry.id);

        question.choices.forEach((choice) => {
          const source = byId.get(choice.entryId);
          assert.ok(source, "missing source " + choice.entryId);
          assert.equal(source.level, level);
          assert.equal(choice.text, source[CHOICE_FIELD[mode]]);
          if (!choice.keyed) {
            assert.notEqual(choice.text, keyed[0].text);
            assert.notEqual(choice.entryId, promptEntry.id);
          }
        });
      });
    });
  });

  const otherSeed = HSK.buildRound(vocab, 1, "gloss", seed + 1, 10);
  const sameSeed = HSK.buildRound(vocab, 1, "gloss", seed, 10);
  assert.notDeepEqual(otherSeed, sameSeed);
});
