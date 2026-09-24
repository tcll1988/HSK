/* Rebuild data/vocab.js by repairing glosses with the shipped HSK.prepareVocab. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const window = {};
const context = vm.createContext({ window: window });
vm.runInContext(
  fs.readFileSync(path.join(root, "js", "hsk.js"), "utf8"),
  context,
  { filename: "hsk.js" }
);

const raw = JSON.parse(
  fs.readFileSync(path.join(root, "data", "vocab-raw.json"), "utf8")
);
const vocab = window.HSK.prepareVocab(raw);
const counts = {};
vocab.forEach(function (entry) {
  counts[entry.level] = (counts[entry.level] || 0) + 1;
  if (entry.gloss.includes("Th") || entry.gloss.includes("ft")) {
    throw new Error("unrepaired gloss on id " + entry.id);
  }
});

const expected = { 1: 148, 2: 147, 3: 298, 4: 586, 5: 1311, 6: 2513 };
Object.keys(expected).forEach(function (level) {
  if (counts[level] !== expected[level]) {
    throw new Error("level " + level + " count " + counts[level]);
  }
});

function glossOf(hanzi) {
  const found = vocab.filter(function (entry) {
    return entry.hanzi === hanzi;
  });
  if (!found.length) {
    throw new Error("missing headword " + hanzi);
  }
  return found.map(function (entry) {
    return entry.gloss;
  }).join("\n");
}

const checks = [
  ["生日", "誕生日"],
  ["当然", "当然"],
  ["生动", "生き生きした"],
  ["安置", "適当な"],
  ["都市", "都市、都会"],
  ["城市", "都市"],
  ["市场", "市場"],
  ["垄断", "市場"],
  ["公民", "市民"]
];
checks.forEach(function (pair) {
  if (!glossOf(pair[0]).includes(pair[1])) {
    throw new Error(pair[0] + " gloss missing " + pair[1] + ": " + glossOf(pair[0]));
  }
});

const body = vocab.map(function (entry) {
  return "  " + JSON.stringify(entry);
}).join(",\n");
fs.writeFileSync(
  path.join(root, "data", "vocab.js"),
  "window.HSK_VOCAB = [\n" + body + "\n];\n",
  "utf8"
);
console.log("wrote " + vocab.length + " entries");
console.log(JSON.stringify(counts));
