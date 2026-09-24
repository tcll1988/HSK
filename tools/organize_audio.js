/* Place each recording in the same stable folder used by HSK.audioSrc. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const audioRoot = fs.realpathSync(path.join(root, "audio"));
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(root, "js", "hsk.js"), "utf8"), context);
const audioSrc = context.window.HSK.audioSrc;

function targetFor(filename) {
  const hanzi = filename.slice(0, -4);
  const src = audioSrc(hanzi);
  const match = /^audio\/(\d{2})\//.exec(src);
  if (!match) throw new Error("Unexpected audio path: " + src);
  const folder = path.resolve(audioRoot, match[1]);
  const target = path.resolve(folder, filename);
  if (!folder.startsWith(audioRoot + path.sep) || !target.startsWith(folder + path.sep)) {
    throw new Error("Audio target escaped the project: " + target);
  }
  return { folder, target };
}

const counts = new Map();
const planned = [];
for (const entry of fs.readdirSync(audioRoot, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".mp3")) {
    const destination = targetFor(entry.name);
    if (fs.existsSync(destination.target)) throw new Error("Already exists: " + destination.target);
    counts.set(destination.folder, (counts.get(destination.folder) || 0) + 1);
    planned.push({ source: path.join(audioRoot, entry.name), ...destination });
  } else if (entry.isDirectory()) {
    if (!/^\d{2}$/.test(entry.name)) throw new Error("Unexpected audio folder: " + entry.name);
    const folder = path.resolve(audioRoot, entry.name);
    if (fs.realpathSync(folder) !== folder) throw new Error("Audio folder is a link: " + folder);
    for (const file of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".mp3")) throw new Error("Unexpected audio entry: " + file.name);
      if (targetFor(file.name).folder !== folder) throw new Error("Recording is in the wrong folder: " + file.name);
      counts.set(folder, (counts.get(folder) || 0) + 1);
    }
  } else {
    throw new Error("Unexpected audio entry: " + entry.name);
  }
}
const max = Math.max(0, ...counts.values());
if (max > 100) throw new Error("Audio folder would exceed 100 files: " + max);
for (const item of planned) {
  if (!fs.existsSync(item.folder)) fs.mkdirSync(item.folder);
  fs.renameSync(item.source, item.target);
}
console.log("Moved " + planned.length + " recordings; " + counts.size + " folders; maximum " + max + " files per folder.");

