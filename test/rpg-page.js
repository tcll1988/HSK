/* Browser check for 汉字勇者 RPG (rpg/):
   1. the site's main page links to the RPG with the chosen level, and the RPG links back;
   2. the RPG picks the same 20 words the site's word list shows (pinyin order and random order) and the site's mistakes;
   3. a full play: teacher lesson, battles that only ask the chosen words and bring every word back, the boss, the site's recordings;
   4. saved progress: continue from the title, and an old (HSK1-only) save asks once for words. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const outDir = process.argv[2];
const results = [];
const base = (process.env.HSK_BASE_URL || "http://127.0.0.1:8000").replace(/\/?$/, "/");
const rpgUrl = new URL("rpg/", base).href;
const track = { pageErrors: [], consoleErrors: [], mp3: [] };

async function newPage(browser, opts) {
  const context = await browser.newContext(Object.assign({ viewport: { width: 400, height: 820 } }, opts || {}));
  const page = await context.newPage();
  page.on("pageerror", (error) => track.pageErrors.push(String(error)));
  page.on("console", (msg) => { if (msg.type() === "error") track.consoleErrors.push(msg.text()); });
  page.on("response", (response) => { if (/\.mp3(\?|$)/.test(response.url())) track.mp3.push({ url: response.url(), status: response.status() }); });
  return { context, page };
}
async function toMap(page) {
  for (let i = 0; i < 20 && (await page.evaluate(() => window.__rpg.mode)) !== "map"; i += 1) { await page.keyboard.press("Enter"); await page.waitForTimeout(250); }
}
async function siteIds(page) {
  await page.locator('.word[data-entry-id]').first().waitFor();
  return page.evaluate(() => [...document.querySelectorAll('.word[data-entry-id]')].map((e) => Number(e.getAttribute("data-entry-id"))));
}
const sorted = (a) => a.slice().sort((x, y) => x - y);

// 1. サイト ⇄ RPG のリンク
async function links(browser) {
  const { context, page } = await newPage(browser);
  try {
    await page.goto(new URL("index.html?level=3", base).href);
    const link = page.locator("[data-rpg-link]");
    await link.waitFor();
    assert.match(await link.getAttribute("href"), /^rpg\/\?level=3$/);
    assert.ok(await page.locator("[data-game-link]").isVisible(), "the battle game link stays");
    await Promise.all([page.waitForURL(/\/rpg\/\?level=3$/), link.click()]);
    await page.locator("#btn-new").waitFor();
    assert.equal(await page.locator(".back-site a").getAttribute("href"), "../");
    await page.click("#btn-new");
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.locator(".pick-foot .btn").waitFor();
    assert.ok(await page.locator(".lvbtn.on").textContent().then((t) => t.includes("HSK3")), "the site's level is chosen");
    if (outDir) await page.screenshot({ path: path.join(outDir, "rpg-picker.png") });
    results.push("links: site -> rpg/?level=3 -> HSK3 picker, back link ../");
  } finally { await context.close(); }
}

// 2. サイトでいま学んでいる20語・まちがえた単語
async function siteWords(browser) {
  const { context, page } = await newPage(browser);
  try {
    await page.goto(new URL("index.html?level=2", base).href);
    await siteIds(page);
    await page.locator("[data-batch-next]").click();
    await page.locator("[data-batch-next]").click();
    const pinyinGroup = await siteIds(page);
    assert.equal(pinyinGroup.length, 20);
    // 新しく始める：サイトの級と20語がえらばれている
    await page.goto(rpgUrl + "?level=2");
    await page.click("#btn-new");
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.locator(".pick-foot .btn").waitFor();
    assert.ok((await page.locator(".btn.site").first().textContent()).includes("41–60"));
    await page.click(".pick-foot .btn");
    await toMap(page);
    assert.equal(await page.evaluate(() => window.__rpg.S.level), 2);
    assert.deepEqual(sorted(await page.evaluate(() => window.__rpg.S.sel)), sorted(pinyinGroup), "same 20 words as the site (pinyin order)");
    // サイトをランダム順にする → RPG の「サイトで学習中の20語」もその20語
    await page.goto(new URL("index.html", base).href);
    await siteIds(page);
    await page.locator(".list-tools > summary").click();
    await page.locator("[data-word-order]").selectOption("random");
    await page.locator("[data-batch-next]").click();
    const randomGroup = await siteIds(page);
    assert.notDeepEqual(sorted(randomGroup), sorted(pinyinGroup));
    await page.goto(rpgUrl);
    await page.click("#btn-continue");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__rpg.picker(false));
    const label = await page.locator(".btn.site").first().textContent();
    assert.ok(label.includes("ランダム順 21–40"), label);
    await page.locator(".btn.site").first().click();
    await page.click(".pick-foot .btn");
    assert.deepEqual(sorted(await page.evaluate(() => window.__rpg.S.sel)), sorted(randomGroup), "same 20 words as the site (random order)");
    // サイトでまちがえた単語
    const wrong = await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("hsk-study-progress-v1"));
      const ids = window.RpgWords.level(2).groups[5].words.slice(0, 6).map((x) => x.id);
      p.wrongIds = ids.concat(window.RpgWords.level(1).words.slice(0, 3).map((x) => x.id));
      localStorage.setItem("hsk-study-progress-v1", JSON.stringify(p));
      return ids;
    });
    await page.evaluate(() => window.__rpg.picker(false));
    await page.locator(".btn.site").nth(1).click();
    await page.click(".pick-foot .btn");
    assert.deepEqual(sorted(await page.evaluate(() => window.__rpg.S.sel)), sorted(wrong), "the site's mistakes for this level only");
    results.push("site words: pinyin group 41–60, random group 21–40 and 6 mistakes match the site");
  } finally { await context.close(); }
}

// 3. 遊ぶ：えらんだ8語だけが出て、どれもくりかえし出る・ボス・サイトの録音
async function play(browser) {
  const { context, page } = await newPage(browser);
  const asked = [];
  async function drive(wrongRate) {
    for (let k = 0; k < 800; k += 1) {
      if ((await page.evaluate(() => window.__rpg.mode)) !== "battle") return;
      const vis = await page.evaluate(() => ["bcmd", "bq", "bcard", "bnextwrap"].filter((id) => !document.getElementById(id).hidden).join(","));
      if (vis === "bcmd") await page.click("#bcmd button:not([disabled])");
      else if (vis === "bcard") await page.click("#bcard-ok");
      else if (vis.includes("bnextwrap")) await page.click("#bnext");
      else if (vis === "bq") {
        const q = await page.evaluate(() => ({ ans: window.__rpg.q.answer, id: window.__rpg.q.word.id }));
        const en = await page.$$("#bchoices button:not([disabled])");
        if (en.length) { asked.push(q.id); await en[Math.random() < wrongRate ? (q.ans + 1) % 4 : q.ans].click(); }
      }
      await page.waitForTimeout(vis === "bq" ? 1400 : 120);
    }
  }
  async function battle() {
    await page.evaluate(() => { if (window.__rpg.S.map !== "plain") window.__rpg.setMap("plain", 5, 2); window.__rpg.encounter(); });
    await page.waitForTimeout(1000);
    await drive(0.15);
    await toMap(page);
  }
  try {
    await page.goto(rpgUrl + "?level=3");
    await page.click("#btn-new");
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    // 1語ずつえらぶ：HSK3 の 1–20 から 8語
    await page.locator(".pick-foot .btn").waitFor();
    await page.click(".pick-quick .btn:last-child");
    await page.locator(".pick-group .pick-exp").first().click();
    for (const k of [1, 3, 5, 7, 9, 11, 13, 15]) await page.click(".pick-chips .chip:nth-child(" + k + ")");
    await page.click(".pick-foot .btn");
    await toMap(page);
    const sel = await page.evaluate(() => window.__rpg.S.sel.slice());
    assert.equal(sel.length, 8);
    await page.evaluate(() => { window.__rpg.noEncounter = true; });
    // 先生の授業：新しいことば5つを2回ずつ
    await page.evaluate(() => window.__rpg.setMap("plain", 10, 2));
    await page.keyboard.down("ArrowLeft"); await page.waitForTimeout(40); await page.keyboard.up("ArrowLeft"); await page.waitForTimeout(250);
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await drive(0);
    await toMap(page);
    assert.equal(new Set(asked).size, 5, "lesson teaches 5 words");
    assert.ok(asked.length >= 10, "each taught word twice");
    // 全部見つけるまで戦う
    for (let i = 0; i < 20 && !(await page.evaluate(() => window.__rpg.S.sel.every((id) => window.__rpg.S.words[id]))); i += 1) await battle();
    assert.ok(await page.evaluate(() => window.__rpg.S.sel.every((id) => window.__rpg.S.words[id])), "every chosen word found");
    // そのあと 2×8 問のあいだに、どのことばも必ずもう一度出る
    const before = asked.length;
    while (asked.length - before < sel.length * 2) await battle();
    const win = asked.slice(before);
    assert.deepEqual(asked.filter((id) => !sel.includes(id)), [], "only the chosen words are asked");
    for (const id of sel) assert.ok(win.includes(id), "word " + id + " came back");
    const per = sel.map((id) => asked.filter((x) => x === id).length);
    // ボス
    await page.evaluate(() => { window.__rpg.setMap("plain", 16, 15); window.__rpg.startBoss(); });
    await page.waitForTimeout(1300);
    await drive(0.1);
    await toMap(page);
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.__rpg.S.boss[1]), true, "boss 1 defeated");
    // サイトの録音（../audio/）が鳴っている
    const audio = track.mp3.filter((r) => /\/audio\/\d{2}\//.test(r.url));
    assert.ok(audio.length > 0, "recordings were played");
    assert.deepEqual(audio.filter((r) => r.status >= 400), [], "every recording loaded");
    assert.deepEqual(track.mp3.filter((r) => /\/rpg\/audio\//.test(r.url)), [], "no copy of the recordings under rpg/");
    if (outDir) await page.screenshot({ path: path.join(outDir, "rpg-village.png") });
    results.push("play: 8 chosen words, " + asked.length + " questions, each word " + Math.min(...per) + "–" + Math.max(...per) + " times, boss defeated, " + audio.length + " site recordings");
  } finally { await context.close(); }
}

// 4. 記録：つづきから／初版の記録
async function saves(browser) {
  const { context, page } = await newPage(browser);
  try {
    await page.goto(rpgUrl);
    await page.evaluate(() => localStorage.setItem("hskRpg.v1", JSON.stringify({ v: 1, map: "village", x: 11, y: 8, dir: "down", lv: 4, exp: 3, hp: 30, mp: 8, gold: 50,
      items: { herb: 1 }, weapon: null, armor: null, owned: {}, boss: {}, chests: {}, words: { 4856: { c: 2, w: 0, st: 2 } }, steps: 0, talked: {}, wins: 5, cleared: false, opt: { voice: true, sfx: true } })));
    await page.reload();
    assert.ok((await page.textContent("#continue-info")).includes("Lv4"));
    await page.click("#btn-continue");
    await page.keyboard.press("Enter");
    await page.locator(".pick-foot .btn").waitFor();
    await page.click(".pick-foot .btn");
    const s = await page.evaluate(() => ({ lv: window.__rpg.S.lv, sel: window.__rpg.S.sel.length, word: window.__rpg.S.words[4856] }));
    assert.equal(s.lv, 4); assert.ok(s.sel >= 4); assert.deepEqual(s.word, { c: 2, w: 0, st: 2 });
    results.push("saves: continue keeps level and stars; an old save asks for words once");
  } finally { await context.close(); }
}

async function main() {
  if (!outDir) throw new Error("pass an output directory");
  fs.mkdirSync(outDir, { recursive: true });
  const options = { headless: true };
  if (process.env.HSK_CHROMIUM_EXECUTABLE) options.executablePath = process.env.HSK_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(options);
  try {
    await links(browser);
    await siteWords(browser);
    await play(browser);
    await saves(browser);
    assert.deepEqual(track.pageErrors, [], "page errors");
    assert.deepEqual(track.consoleErrors, [], "console errors");
    results.push("4 rpg cases passed; pageErrors=0; consoleErrors=0");
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outDir, "rpg.log"), results.join("\n") + "\n");
    console.log(results.join("\n"));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
