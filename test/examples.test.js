const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadHsk, root } = require("./load-hsk");

test("the introductory HSK 1 group has plain-text Chinese, pinyin, and Japanese examples for its exact entries", () => {
  const { vocab } = loadHsk();
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "data/examples.js"), "utf8"), context);
  const examples = context.window.HSK_EXAMPLES;
  const collator = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true });
  const firstGroup = Array.from(vocab).filter(entry => entry.level === 1)
    .sort((a, b) => collator.compare(a.pinyin, b.pinyin) || a.id - b.id).slice(0, 20);
  assert.deepEqual(Object.keys(examples).map(Number).sort((a, b) => a - b), firstGroup.map(entry => entry.id).sort((a, b) => a - b));
  for (const [id, example] of Object.entries(examples)) {
    const entry = vocab.find(word => word.id === Number(id));
    assert.ok(entry, "example references an existing vocabulary entry: " + id);
    for (const key of ["zh", "pinyin", "ja"]) {
      assert.equal(typeof example[key], "string", id + ": " + key);
      assert.ok(example[key].trim().length > 0, id + ": " + key + " is not empty");
      assert.doesNotMatch(example[key], /[<>]/, "examples are text, not HTML");
    }
    assert.ok(example.zh.includes(entry.hanzi), "Chinese example uses " + entry.hanzi);
    assert.match(example.pinyin, /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i, "pinyin includes tone marks");
  }
});
