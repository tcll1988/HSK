/* HSKもじバトル (game/): word data comes from data/vocab.js and every word plays an existing recording. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");

function loadGame() {
  const window = {};
  const context = vm.createContext({ window: window, globalThis: window });
  for (const file of ["js/hsk.js", "data/vocab.js", "game/js/pinyin.js", "game/js/readings.js", "game/js/questions.js", "game/js/levels.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  return window;
}

test("game stages cover every word of every level exactly once, 12-16 words each", () => {
  const w = loadGame();
  for (let level = 1; level <= 6; level += 1) {
    const data = w.GameLevels.build(level);
    const siteIds = w.HSK.wordsForLevel(w.HSK.prepareVocab(w.HSK_VOCAB), level).map((e) => e.id).sort((a, b) => a - b);
    const stageIds = data.stages.flatMap((s) => s.words.map((x) => x.id)).sort((a, b) => a - b);
    assert.deepEqual(stageIds, siteIds, "level " + level);
    for (const s of data.stages) assert.ok(s.words.length >= 12 && s.words.length <= 16, "level " + level + " stage size " + s.words.length);
  }
});

test("game shows the site's own hanzi, pinyin and Japanese meaning unchanged", () => {
  const w = loadGame();
  const byId = new Map(w.HSK.prepareVocab(w.HSK_VOCAB).map((e) => [e.id, e]));
  for (let level = 1; level <= 6; level += 1) {
    for (const word of w.GameLevels.build(level).words) {
      const e = byId.get(word.id);
      assert.equal(word.h, e.hanzi);
      assert.equal(word.pinyin, e.pinyin);
      assert.equal(word.ja, e.gloss);
    }
  }
});

test("pinyin syllables re-render to exactly the site's pinyin", () => {
  const w = loadGame();
  for (let level = 1; level <= 6; level += 1) {
    for (const word of w.GameLevels.build(level).words) {
      assert.ok(word.syl.length > 0, "no syllables for " + word.h + " " + word.pinyin);
      assert.equal(w.Pinyin.render(word.syl), word.pinyin, word.h);
    }
  }
});

test("every game word maps to an existing site recording", () => {
  const w = loadGame();
  for (let level = 1; level <= 6; level += 1) {
    for (const word of w.GameLevels.build(level).words) {
      const src = w.GameLevels.audioSrc(word);
      assert.ok(src.startsWith("../audio/"), src);
      const file = decodeURIComponent(new URL(src, "https://x.test/game/").pathname.replace(/^\//, ""));
      assert.ok(fs.existsSync(path.join(root, file)), "missing " + file + " for " + word.h);
      assert.equal("../" + w.HSK.audioPlaybackSrc(word.entry), src);
    }
  }
});

test("game page loads the shared site scripts and no speech synthesis", () => {
  const html = fs.readFileSync(path.join(root, "game", "index.html"), "utf8");
  assert.match(html, /src="\.\.\/js\/hsk\.js/);
  assert.match(html, /src="\.\.\/data\/vocab\.js/);
  assert.match(html, /href="\.\.\/"/);
  for (const file of ["game/js/game.js", "game/js/levels.js", "game/js/questions.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /speechSynthesis|SpeechSynthesisUtterance/);
  }
});
