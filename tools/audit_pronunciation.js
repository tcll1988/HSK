/* Check pronunciation collisions without trusting headword-only audio paths. */
const fs = require("node:fs");
const path = require("node:path");
const { loadHsk, root } = require("../test/load-hsk");
const { HSK, vocab } = loadHsk();
const groups = new Map();
vocab.forEach((entry) => {
  if (!groups.has(entry.hanzi)) groups.set(entry.hanzi, []);
  groups.get(entry.hanzi).push(entry);
});
let failures = 0;
let homographs = 0;
for (const [hanzi, entries] of groups) {
  if (new Set(entries.map((entry) => entry.pinyin)).size < 2) continue;
  homographs += 1;
  const paths = entries.map((entry) => HSK.audioSrc(entry));
  if (new Set(paths).size !== new Set(entries.map((entry) => entry.pinyin)).size) {
    failures += 1;
    console.error("Shared recording for different readings:", hanzi);
  }
  console.log(hanzi + ": " + entries.map((entry) => entry.pinyin + " → " + HSK.audioSrc(entry)).join(" | "));
}
for (const entry of vocab) {
  const file = path.join(root, decodeURIComponent(HSK.audioSrc(entry)));
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    failures += 1;
    console.error("Missing pronunciation asset:", entry.id, entry.hanzi);
  }
}
console.log(`${vocab.length} entries; ${homographs} homographs with different readings; ${vocab.filter((entry) => entry.audio).length} explicit clips; ${failures} failures.`);
process.exitCode = failures ? 1 : 0;
