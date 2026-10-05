const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const pronunciationOverrides = require("../tools/pronunciation-overrides.json");
const { loadHsk, root } = require("./load-hsk");

const EXPECTED = { 1: 148, 2: 147, 3: 298, 4: 586, 5: 1311, 6: 2513 };

test("noun 地, row-counter 行, and modal 得 have matching readings and meanings", () => {
  const { vocab } = loadHsk();
  const earth = vocab.find((entry) => entry.id === 4459);
  assert.equal(earth.hanzi, "地");
  assert.equal(earth.pinyin, "dì");
  assert.equal(earth.gloss, "土地、地面");
  const row = vocab.find((entry) => entry.id === 4282);
  assert.equal(row.hanzi, "行");
  assert.equal(row.pinyin, "háng");
  assert.equal(row.pos, "量");
  const must = vocab.find((entry) => entry.id === 3903);
  assert.equal(must.pinyin, "děi");
  assert.match(must.gloss, /しなければならない/);
  assert.equal(must.gloss.includes("得る"), false, "dé meaning should not be tested as děi");
});

test("shipped vocabulary retains the corrections used by workbook rebuilds", () => {
  const { vocab } = loadHsk();
  pronunciationOverrides.forEach((override) => {
    const entry = vocab.find((item) => item.id === override.id);
    Object.keys(override).forEach((key) => assert.equal(entry[key], override[key], override.id + " " + key));
  });
});

test("workbook rebuild reapplies reviewed readings and audio without editing the source workbook", () => {
  const { raw } = loadHsk();
  const workbookRows = JSON.parse(JSON.stringify(raw));
  workbookRows.forEach((entry) => { delete entry.audio; delete entry.audioText; });
  workbookRows.find((entry) => entry.id === 4459).pinyin = "de";
  workbookRows.find((entry) => entry.id === 4282).pinyin = "xíng";
  workbookRows.find((entry) => entry.id === 3903).gloss = "要する[dei3]；得る[de2]";
  const script = path.join(root, "tools", "build_vocab.js");
  const scriptRequire = createRequire(script);
  let generated;
  const fixtureFs = Object.assign({}, fs, {
    readFileSync(filename, encoding) {
      if (filename === path.join(root, "data", "vocab-raw.json")) return JSON.stringify(workbookRows);
      return fs.readFileSync(filename, encoding);
    },
    writeFileSync(filename, contents) {
      assert.equal(filename, path.join(root, "data", "vocab.js"));
      generated = contents;
    }
  });
  vm.runInNewContext(fs.readFileSync(script, "utf8"), {
    require(name) { return name === "fs" ? fixtureFs : scriptRequire(name); },
    __dirname: path.dirname(script), console: { log() {} }
  }, { filename: script });
  assert.equal(generated, fs.readFileSync(path.join(root, "data", "vocab.js"), "utf8"));
});

test("shipped vocabulary keeps every workbook field and the six level counts", () => {
  const { HSK, raw, vocab } = loadHsk();
  assert.equal(raw.length, 5003);
  assert.equal(vocab.length, 5003);
  assert.equal(HSK.prepareVocab(raw).length, vocab.length);

  const counts = {};
  const ids = new Set();
  vocab.forEach((entry) => {
    assert.equal(typeof entry.pinyin, "string");
    assert.ok(entry.pinyin.length > 0);
    assert.equal(typeof entry.hanzi, "string");
    assert.ok(entry.hanzi.length > 0);
    assert.equal(typeof entry.pos, "string");
    assert.ok(entry.pos.length > 0);
    assert.equal(typeof entry.gloss, "string");
    assert.ok(entry.gloss.length > 0);
    assert.equal(entry.gloss.includes("Th"), false);
    assert.equal(entry.gloss.includes("ft"), false);
    assert.ok(entry.level >= 1 && entry.level <= 6);
    counts[entry.level] = (counts[entry.level] || 0) + 1;
    assert.equal(ids.has(entry.id), false);
    ids.add(entry.id);
  });
  assert.deepEqual(counts, EXPECTED);

  function glosses(hanzi) {
    return vocab.filter((entry) => entry.hanzi === hanzi).map((entry) => entry.gloss);
  }
  assert.ok(glosses("生日").some((gloss) => gloss.includes("誕生日")));
  assert.ok(glosses("当然").some((gloss) => gloss.includes("当然")));
  assert.ok(glosses("生动").some((gloss) => gloss.includes("生き生きした")));
  assert.ok(glosses("安置").some((gloss) => gloss.includes("適当な")));
  assert.ok(glosses("都市").some((gloss) => gloss.includes("都市、都会")));
  assert.ok(glosses("城市").some((gloss) => gloss.includes("都市")));
  assert.ok(glosses("市场").some((gloss) => gloss.includes("市場")));
  assert.ok(glosses("垄断").some((gloss) => gloss.includes("市場")));
  assert.ok(glosses("公民").some((gloss) => gloss.includes("市民")));
  assert.ok(glosses("照片").some((gloss) => gloss.includes("写真")));
  assert.ok(glosses("描绘").some((gloss) => gloss.includes("描写する")));
  assert.ok(glosses("复印").some((gloss) => gloss.includes("複写する")));
  vocab.forEach((entry) => {
    assert.equal(entry.gloss.includes("都生"), false, entry.hanzi);
    assert.equal(entry.gloss.includes("生場"), false, entry.hanzi);
    assert.equal(entry.gloss.includes("生民"), false, entry.hanzi);
    assert.equal(entry.gloss.includes("ti"), false, entry.hanzi);
  });

  ["过", "得", "等", "还", "只", "长", "对", "尽量"].forEach((hanzi) => {
    const rows = vocab.filter((entry) => entry.hanzi === hanzi);
    assert.equal(rows.length, 2, hanzi);
    const readings = new Set(rows.map((entry) => entry.pinyin + "\t" + entry.gloss));
    assert.equal(readings.size, 2, hanzi);
  });
});

test("repairGloss restores 生 and 当 and the page prepare path uses it", () => {
  const { HSK, vocab } = loadHsk();
  assert.equal(HSK.repairGloss("誕Th日"), "誕生日");
  assert.equal(HSK.repairGloss("ft然"), "当然");
  assert.equal(HSK.repairGloss("ThきThきした"), "生き生きした");
  assert.equal(HSK.repairGloss("適ftな"), "適当な");
  assert.equal(HSK.repairGloss("都Th、都会"), "都市、都会");
  assert.equal(HSK.repairGloss("都会、都Th"), "都会、都市");
  assert.equal(HSK.repairGloss("Th場、マーケット"), "市場、マーケット");
  assert.equal(HSK.repairGloss("独占する（Th場を）"), "独占する（市場を）");
  assert.equal(HSK.repairGloss("公民、Th民"), "公民、市民");
  assert.equal(HSK.repairGloss("ti真"), "写真");
  assert.equal(HSK.repairGloss("描tiする"), "描写する");
  assert.equal(HSK.repairGloss("書きtiす"), "書き写す");
  assert.equal(HSK.repairGloss("複tiする"), "複写する");

  const broken = vocab.map((entry) => Object.assign({}, entry));
  const birthday = broken.find((entry) => entry.hanzi === "生日");
  birthday.gloss = birthday.gloss.replace("生", "Th");
  const repaired = HSK.prepareVocab(broken);
  assert.ok(repaired.find((entry) => entry.id === birthday.id).gloss.includes("誕生日"));
  assert.equal(repaired.length, vocab.length);
});
