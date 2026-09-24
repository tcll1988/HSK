/* Load the shipped browser scripts in a window global. No copy of the vocabulary. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");

function loadHsk() {
  const window = {};
  const context = vm.createContext({ window: window });
  vm.runInContext(
    fs.readFileSync(path.join(root, "js", "hsk.js"), "utf8"),
    context,
    { filename: "js/hsk.js" }
  );
  vm.runInContext(
    fs.readFileSync(path.join(root, "data", "vocab.js"), "utf8"),
    context,
    { filename: "data/vocab.js" }
  );
  if (!window.HSK || !Array.isArray(window.HSK_VOCAB)) {
    throw new Error("shipped scripts did not set window.HSK and window.HSK_VOCAB");
  }
  return {
    HSK: window.HSK,
    raw: window.HSK_VOCAB,
    vocab: window.HSK.prepareVocab(window.HSK_VOCAB)
  };
}

module.exports = { loadHsk: loadHsk, root: root };
