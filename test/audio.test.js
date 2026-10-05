const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadHsk, root } = require("./load-hsk");

test("every entry has audio and different readings use separate pronunciation clips", () => {
  const { HSK, vocab } = loadHsk();
  const words = new Set();
  const overrides = new Set();
  vocab.forEach((entry) => {
    const src = HSK.audioSrc(entry);
    assert.match(src, /^audio\/\d{2}\//);
    const file = path.join(root, decodeURIComponent(src));
    assert.equal(fs.existsSync(file), true, entry.hanzi + " " + entry.pinyin);
    assert.ok(fs.statSync(file).size > 0, entry.hanzi);
    words.add(entry.hanzi);
    if (entry.audio) overrides.add(src);
    else assert.equal(src.endsWith("/" + encodeURIComponent(entry.hanzi) + ".mp3"), true);
    assert.equal(fs.existsSync(path.join(root, decodeURIComponent(HSK.audioSrc(entry.hanzi)))), true, "legacy string API remains available");
  });
  assert.equal(words.size, 4995);
  assert.equal(overrides.size, 14);
  const audioRoot = path.join(root, "audio");
  let total = 0;
  fs.readdirSync(audioRoot, { withFileTypes: true }).forEach((folder) => {
    assert.equal(folder.isDirectory(), true, folder.name);
    assert.match(folder.name, /^\d{2}$/);
    const recordings = fs.readdirSync(path.join(audioRoot, folder.name));
    assert.ok(recordings.length <= 100, folder.name);
    total += recordings.length;
  });
  assert.equal(total, words.size + overrides.size);
  ["过", "得", "还", "只", "长", "尽量"].forEach((hanzi) => {
    const rows = vocab.filter((entry) => entry.hanzi === hanzi);
    assert.equal(rows.length, 2);
    const sources = rows.map((entry) => HSK.audioSrc(entry));
    assert.notEqual(sources[0], sources[1], hanzi + " must not collapse readings");
    const digests = sources.map((src) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, src))).digest("hex"));
    assert.notEqual(digests[0], digests[1], hanzi + " must not just rename one recording");
  });
  ["等", "对"].forEach((hanzi) => {
    const rows = vocab.filter((entry) => entry.hanzi === hanzi);
    assert.equal(HSK.audioSrc(rows[0]), HSK.audioSrc(rows[1]), "same reading can share a clip");
  });
  assert.equal(HSK.audioSrc("昨天").includes(encodeURIComponent("昨天")), true);
});

test("prepared vocabulary preserves pronunciation metadata across repeated preparation", () => {
  const { HSK, raw } = loadHsk();
  const twice = HSK.prepareVocab(HSK.prepareVocab(raw));
  const corrected = twice.filter((entry) => entry.audio);
  assert.equal(corrected.length, 14);
  corrected.forEach((entry) => assert.equal(HSK.audioSrc(entry), entry.audio));
  assert.equal(twice.find((entry) => entry.id === 2892).audioText, "去过");
  assert.equal(twice.find((entry) => entry.id === 4727).audioText, "说得好");
  const invalid = Object.assign({}, raw[0], { audio: "audio/00/entry-99999.mp3" });
  assert.throws(() => HSK.prepareVocab([invalid]), /bad pronunciation audio/);
  assert.throws(() => HSK.audioSrc(invalid), /bad pronunciation audio/);
});
