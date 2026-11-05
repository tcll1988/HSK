/* 汉字勇者 RPG (rpg/): maps are walkable, word groups match the site's word list, every word of every level
   yields valid questions, and every word plays one of the site's own recordings (rpg/ uses ../audio/). */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");

function loadRpg() {
  const window = {};
  const context = vm.createContext({ window: window, globalThis: window, Intl: Intl });
  for (const file of ["js/hsk.js", "data/vocab.js", "game/js/pinyin.js", "game/js/readings.js", "game/js/questions.js", "rpg/js/words.js", "rpg/js/world.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  return window;
}
const w = loadRpg();
const { MAPS, AREAS } = w.World;
const RW = w.RpgWords;
const SOLID = "TRWd~";
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function objects(m) {
  const o = [];
  m.npcs.forEach((n) => o.push(["npc " + n.id, n.x, n.y]));
  (m.signs || []).forEach((n) => o.push(["sign", n.x, n.y]));
  (m.chests || []).forEach((n) => o.push(["chest " + n.id, n.x, n.y]));
  if (m.boss) o.push(["boss", m.boss.x, m.boss.y]);
  return o;
}
function reach(m, sx, sy) {
  const occ = new Set(objects(m).map((o) => o[1] + "," + o[2]));
  const seen = new Set([sx + "," + sy]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy, k = nx + "," + ny;
      if (seen.has(k) || ny < 0 || ny >= m.rows.length || nx < 0 || nx >= m.rows[0].length) continue;
      if (SOLID.includes(m.rows[ny][nx]) || occ.has(k)) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return seen;
}

test("rpg maps: same-length rows, every person, chest, sign, boss and exit can be reached", () => {
  for (const [name, m] of Object.entries(MAPS)) {
    const width = m.rows[0].length;
    m.rows.forEach((r, i) => assert.equal(r.length, width, name + " row " + i));
    assert.ok(width >= 15 && m.rows.length >= 11, name + " is at least one screen");
    const arrivals = Object.values(MAPS).flatMap((m2) => m2.warps.filter((wp) => wp.to === name));
    assert.ok(arrivals.length, "some exit leads to " + name);
    for (const a of arrivals) {
      assert.ok(!SOLID.includes(m.rows[a.ty][a.tx]), name + " arrival " + a.tx + "," + a.ty);
      const R = reach(m, a.tx, a.ty);
      for (const [label, x, y] of objects(m)) {
        assert.ok(!SOLID.includes(m.rows[y][x]), name + " " + label + " stands on a free tile");
        assert.ok(SIDES.some(([dx, dy]) => R.has((x + dx) + "," + (y + dy))), name + " " + label + " reachable");
      }
      for (const wp of m.warps) {
        assert.ok(SIDES.some(([dx, dy]) => R.has((wp.x + dx) + "," + (wp.y + dy))), name + " exit reachable");
        assert.ok(MAPS[wp.to], "exit target exists");
      }
    }
    if (m.area) assert.ok(m.rows.join("").includes(","), name + " has grass for battles");
  }
  assert.deepEqual(Object.keys(AREAS).map((k) => AREAS[k].need), [0, 1, 2, 3], "boss conditions: found, ★1, ★2, ★3");
});

test("rpg word groups are the site's word list: every level, pinyin order, 20 words per group", () => {
  const vocab = w.HSK.prepareVocab(w.HSK_VOCAB);
  const collator = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true });
  for (let level = 1; level <= 6; level += 1) {
    const site = w.HSK.wordsForLevel(vocab, level).sort((a, b) => collator.compare(a.pinyin, b.pinyin) || a.id - b.id);
    const L = RW.level(level);
    assert.deepEqual(L.words.map((x) => x.id), site.map((e) => e.id), "level " + level + " order");
    L.groups.forEach((g, i) => {
      assert.equal(g.from, i * 20 + 1);
      assert.ok(g.words.length === 20 || i === L.groups.length - 1, "level " + level + " group " + i);
    });
    for (const x of L.words) {
      const e = site.find((s) => s.id === x.id);
      assert.equal(x.h, e.hanzi); assert.equal(x.pinyin, e.pinyin); assert.equal(x.ja, e.gloss);
    }
  }
});

test("rpg questions: four different choices for every word of every level, distractors prefer the chosen words", () => {
  for (let level = 1; level <= 6; level += 1) {
    const L = RW.level(level);
    const sel = L.groups[1].words.map((x) => x.id);
    const q = RW.questions(level, sel);
    let fromSel = 0, total = 0;
    for (const word of L.words) {
      const types = sel.includes(word.id) ? ["h2ja", "ja2h", "h2py", "listen", "tone"] : ["h2ja", "ja2h", "h2py", "listen"];
      for (const t of types) {
        const x = q.make(word, t);
        assert.equal(new Set(x.choices).size, 4, level + " " + word.h + " " + t);
        assert.equal(x.choices[x.answer], { h2ja: word.ja, ja2h: word.h, h2py: word.pinyin, listen: word.h, tone: word.pinyin }[x.type]);
        if (sel.includes(word.id)) x.owners.forEach((o) => { if (o && o !== word) { total += 1; if (sel.includes(o.id)) fromSel += 1; } });
      }
    }
    assert.ok(fromSel / total > 0.6, "HSK" + level + " distractors mostly from the chosen words: " + fromSel + "/" + total);
  }
});

test("rpg plays the site's own recording for every word (../audio/ from rpg/)", () => {
  for (let level = 1; level <= 6; level += 1) {
    for (const x of RW.level(level).words) {
      const src = RW.audioSrc(x);
      assert.match(src, /^\.\.\/audio\/\d{2}\//);
      const file = decodeURIComponent(src.replace(/^\.\.\//, "").replace(/\?.*$/, ""));
      assert.ok(fs.existsSync(path.join(root, file)), file);
    }
  }
});

test("rpg page loads the site's shared scripts (no copies of the word data inside rpg/)", () => {
  const html = fs.readFileSync(path.join(root, "rpg/index.html"), "utf8");
  for (const src of ["../js/hsk.js", "../data/vocab.js", "../game/js/pinyin.js", "../game/js/readings.js", "../game/js/questions.js"]) {
    assert.ok(html.includes('src="' + src), src);
  }
  for (const copy of ["rpg/data", "rpg/audio", "rpg/js/hsk.js", "rpg/js/questions.js"]) assert.ok(!fs.existsSync(path.join(root, copy)), copy + " should not exist");
});
