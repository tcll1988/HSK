const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadHsk, root } = require("./load-hsk");

test("every shipped word has its own recording, and same-headword rows share it", () => {
  const { HSK, vocab } = loadHsk();
  const files = new Set();
  vocab.forEach((entry) => {
    const src = HSK.audioSrc(entry);
    assert.match(src, /^audio\/\d{2}\//);
    assert.equal(src.endsWith("/" + encodeURIComponent(entry.hanzi) + ".mp3"), true);
    const file = path.join(root, decodeURIComponent(src));
    assert.equal(fs.existsSync(file), true, entry.hanzi);
    assert.equal(fs.statSync(file).size > 0, true, entry.hanzi);
    files.add(entry.hanzi);
  });
  assert.equal(files.size, 4995);
  const audioRoot = path.join(root, "audio");
  const folders = fs.readdirSync(audioRoot, { withFileTypes: true });
  assert.equal(folders.some((entry) => entry.isFile()), false, "audio root should contain folders only");
  let total = 0;
  folders.forEach((entry) => {
    assert.equal(entry.isDirectory(), true, entry.name);
    assert.match(entry.name, /^\d{2}$/);
    const recordings = fs.readdirSync(path.join(audioRoot, entry.name));
    assert.equal(recordings.length <= 100, true, entry.name + " has " + recordings.length + " files");
    total += recordings.length;
  });
  assert.equal(total, files.size);
  ["过", "得", "等", "还", "只", "长", "对", "尽量"].forEach((hanzi) => {
    const rows = vocab.filter((entry) => entry.hanzi === hanzi);
    assert.equal(rows.length, 2);
    assert.equal(HSK.audioSrc(rows[0]), HSK.audioSrc(rows[1]));
  });
  const yesterday = vocab.find((entry) => entry.hanzi === "昨天");
  assert.equal(yesterday.level, 1);
  assert.equal(HSK.audioSrc("昨天").includes(encodeURIComponent("昨天")), true);
});
