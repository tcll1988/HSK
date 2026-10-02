/* Browser regressions for finding words, completing practice, and small screens. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const outDir = process.argv[2];
const results = [];

function pageUrl() {
  const url = new URL("index.html", (process.env.HSK_BASE_URL || "http://127.0.0.1:8000").replace(/\/?$/, "/"));
  url.searchParams.set("seed", "7");
  url.searchParams.set("level", "1");
  return url.href;
}

async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, "horizontal overflow");
}

async function usableTargets(page) {
  const small = await page.locator(".levels button, .section-button, .views button, .settings-summary, .setting-toggle, .speed-select, .search, .listen, .choice, [data-next], [data-word-order], [data-shuffle]").evaluateAll((nodes) => nodes.filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.height < 44;
  }).map((node) => node.className || node.tagName));
  assert.deepEqual(small, [], "primary controls need touch-friendly heights");
}

async function answer(page, correct) {
  const question = await page.evaluate(() => window.HSK_PAGE.question());
  const index = question.choices.findIndex((choice) => choice.keyed === correct);
  assert.ok(index >= 0, "requested answer must exist");
  await page.locator('[data-choice-index="' + index + '"]').click();
  assert.equal(await page.locator("[data-feedback]").textContent(), correct ? "正解" : "不正解");
  assert.equal(await page.locator("[data-next]").isEnabled(), true);
  return question.prompt;
}

async function completeRound(page, alternating) {
  const mistakes = [];
  for (let index = 0; index < 10; index += 1) {
    const correct = !alternating || index % 2 === 0;
    const prompt = await answer(page, correct);
    if (!correct) mistakes.push(prompt);
    if (index === 9) assert.equal((await page.locator("[data-next]").innerText()).trim(), "結果を見る");
    await page.locator("[data-next]").click();
  }
  await page.locator(".round-summary").waitFor();
  return mistakes;
}

async function searchCase(page) {
  const search = page.locator(".search");
  assert.equal(await page.locator(".word").count(), 148);
  for (const query of ["昨天", "昨日", "zuotian", "zuo tian"]) {
    await search.fill(query);
    const words = await page.locator(".word .hanzi").allTextContents();
    assert.ok(words.includes("昨天"), "search should find 昨天 for " + query);
    assert.ok(words.length < 148, "search must filter the list");
    assert.match(await page.locator(".search-status").innerText(), new RegExp("(^|\\D)" + words.length + "(?=\\D|$)"));
  }
  await search.fill("zzzz-no-such-word-12345");
  assert.equal(await page.locator(".word").count(), 0);
  assert.equal(await page.locator(".empty-state").isVisible(), true);
  assert.match(await page.locator(".search-status").innerText(), /(^|\D)0(?=\D|$)/);
  await page.locator("button.reset-search").click();
  assert.equal(await search.inputValue(), "");
  assert.equal(await page.locator(".word").count(), 148);
  assert.equal(await page.locator(".empty-state").isVisible(), false);
  await search.fill("昨天");
  await page.locator('[data-section="practice"]').click();
  await page.locator('[data-section="list"]').click();
  assert.equal(await search.inputValue(), "昨天", "returning to the list must preserve search");
  await page.locator('.levels [data-level="6"]').click();
  assert.equal(await search.inputValue(), "", "another level should have its own search");
  await search.fill("爱不释手");
  assert.equal(await page.locator('.word[data-hanzi="爱不释手"]').count(), 1);
  await page.locator('.levels [data-level="1"]').click();
  assert.equal(await search.inputValue(), "昨天");
  await page.locator('.levels [data-level="6"]').click();
  assert.equal(await search.inputValue(), "爱不释手");
}

function seedOrderingRandom() {
  let state = 1907;
  Math.random = () => {
    state = state * 16807 % 2147483647;
    return (state - 1) / 2147483646;
  };
}

async function wordIds(page) {
  return page.locator(".word").evaluateAll((rows) => rows.map((row) => Number(row.dataset.entryId)));
}

async function assertPinyinOrder(page) {
  const rows = await page.locator(".word").evaluateAll((nodes) => nodes.map((node) => ({
    id: Number(node.dataset.entryId),
    reading: node.querySelector(".pinyin").textContent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f\s'’\-]/g, "")
  })));
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    assert.ok(before.reading <= after.reading, "pinyin order: " + before.reading + " precedes " + after.reading);
    if (before.reading === after.reading) assert.ok(before.id < after.id, "matching readings must retain ID order");
  }
}

async function orderingCase(page) {
  const order = page.locator("select[data-word-order]");
  const shuffle = page.locator("button[data-shuffle]");
  assert.equal(await order.inputValue(), "pinyin");
  assert.equal(await shuffle.isVisible(), false);
  await assertPinyinOrder(page);
  const original = await wordIds(page);
  assert.equal(original.length, 148);
  assert.equal(new Set(original).size, 148, "entry identities must be unique");
  const sameEntries = (actual) => assert.deepEqual([...actual].sort((a, b) => a - b), [...original].sort((a, b) => a - b), "ordering must preserve every entry");

  await order.selectOption("random");
  assert.equal(await shuffle.isVisible(), true);
  const random = await wordIds(page);
  sameEntries(random);
  assert.notDeepEqual(random, original, "random mode must rearrange the words");
  await page.locator(".search").fill("a");
  const filtered = await wordIds(page);
  assert.ok(filtered.length > 1 && filtered.length < random.length, "filter must produce a meaningful subset");
  const matching = new Set(filtered);
  assert.deepEqual(filtered, random.filter((id) => matching.has(id)), "search must preserve relative random order");
  await page.locator(".search-clear").click();
  assert.deepEqual(await wordIds(page), random, "clearing search must restore the same order");

  await shuffle.click();
  const reshuffled = await wordIds(page);
  sameEntries(reshuffled);
  assert.notDeepEqual(reshuffled, random, "shuffle must produce a new permutation");
  await page.locator('[data-section="practice"]').click();
  await page.locator('[data-section="list"]').click();
  assert.equal(await order.inputValue(), "random");
  assert.deepEqual(await wordIds(page), reshuffled, "changing views must retain the random order");
  await page.locator('.levels [data-level="2"]').click();
  const level2 = await wordIds(page);
  await page.locator('.levels [data-level="1"]').click();
  assert.deepEqual(await wordIds(page), reshuffled, "returning to a level must retain its order");
  await page.locator('.levels [data-level="2"]').click();
  assert.deepEqual(await wordIds(page), level2, "each level must retain its own order");
  await page.locator('.levels [data-level="1"]').click();

  await page.reload({ waitUntil: "load" });
  assert.equal(await order.inputValue(), "random", "selected order must persist after reload");
  assert.equal(await shuffle.isVisible(), true);
  sameEntries(await wordIds(page));
  await order.selectOption("pinyin");
  assert.equal(await shuffle.isVisible(), false);
  await assertPinyinOrder(page);
  assert.deepEqual(await wordIds(page), original, "pinyin mode must restore the pronunciation order");
}

async function roundCase(page) {
  await page.locator('[data-section="practice"]').click();
  const mistakes = await completeRound(page, true);
  assert.equal(Number(await page.locator(".summary-score strong").innerText()), 5);
  const review = await page.locator("ul.review-words .review-word").allTextContents();
  assert.equal(review.length, 5, "review should contain only the five missed words");
  for (const prompt of mistakes) assert.ok(review.some((text) => text.includes(prompt)), "missing review word " + prompt);
  await page.screenshot({ path: path.join(outDir, "practice-results.png"), fullPage: true, animations: "disabled" });
  await page.locator("[data-restart]").click();
  assert.equal(await page.locator(".round-summary").count(), 0);
  assert.match(await page.locator(".progress-label").innerText(), /第\s*1\s*問/);
  assert.match(await page.locator(".score").innerText(), /正解\s*0\s*\/\s*10/);
  assert.equal(await page.locator("[data-next]").isDisabled(), true);
  await completeRound(page, false);
  assert.equal(Number(await page.locator(".summary-score strong").innerText()), 10);
  assert.equal(await page.locator(".review-word").count(), 0, "a perfect round has no missed words");
  await page.locator("[data-return-list]").click();
  assert.equal(await page.locator(".list").isVisible(), true);
  assert.equal(await page.locator(".word").count(), 148);
}

async function keyboardCase(page) {
  await page.locator('[data-section="practice"]').click();
  await page.locator('[data-choice-index="0"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("[data-next]").isEnabled(), true);
  assert.equal(await page.locator("[data-next]").evaluate((node) => document.activeElement === node), true, "answering must move keyboard focus to Next");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement === document.querySelector(".practice h2"));
  assert.match(await page.locator(".progress-label").innerText(), /第\s*2\s*問/);
  await page.waitForFunction(() => {
    const heading = document.querySelector(".practice h2");
    const rect = heading.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.top >= 0 && rect.bottom <= innerHeight && heading.contains(hit);
  });
}

async function mobileCase(page, width) {
  await noOverflow(page);
  await usableTargets(page);
  const order = page.locator("select[data-word-order]");
  assert.ok(await order.evaluate((node) => parseFloat(getComputedStyle(node).fontSize) >= 16), "order selector must avoid mobile input zoom");
  await order.selectOption("random");
  assert.equal(await page.locator("button[data-shuffle]").isVisible(), true);
  await page.locator("button[data-shuffle]").click();
  await noOverflow(page);
  await usableTargets(page);
  assert.ok(await page.locator(".search").evaluate((node) => parseFloat(getComputedStyle(node).fontSize) >= 16), "search must avoid mobile input zoom");
  await page.locator(".settings-summary").click();
  assert.ok(await page.locator(".speed-select").evaluate((node) => parseFloat(getComputedStyle(node).fontSize) >= 16), "speed selector must avoid mobile input zoom");
  for (const pinyin of [false, true]) {
    for (const japanese of [false, true]) {
      await page.locator('[data-setting="showPinyin"]').setChecked(pinyin);
      await page.locator('[data-setting="showJapanese"]').setChecked(japanese);
      assert.equal(await page.locator(".word .pinyin").first().isVisible(), pinyin);
      assert.equal(await page.locator(".word .gloss").first().isVisible(), japanese);
      await noOverflow(page);
      await usableTargets(page);
    }
  }
  await page.locator(".settings-summary").click();
  await page.locator(".search").fill("昨天");
  await page.screenshot({ path: path.join(outDir, "mobile-" + width + ".png"), fullPage: true, animations: "disabled" });
  await page.locator('[data-section="practice"]').click();
  for (const mode of ["gloss", "hanzi", "pinyin"]) {
    await page.locator('[data-view="' + mode + '"]').click();
    await noOverflow(page);
    await usableTargets(page);
  }
}

async function runCase(browser, name, action, width = 1280, initialize) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
  if (initialize) await context.addInitScript(initialize);
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto(pageUrl(), { waitUntil: "load" });
    await action(page);
    assert.deepEqual(errors, [], name + " browser errors");
    results.push("PASS " + name);
    console.log(results[results.length - 1]);
  } catch (error) {
    results.push("FAIL " + name + "\n" + error.stack);
    if (errors.length) results.push("browserErrors=" + JSON.stringify(errors));
    await page.screenshot({ path: path.join(outDir, name + "-failed.png"), fullPage: true, animations: "disabled" }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  if (!outDir) throw new Error("pass a scratch output directory");
  fs.mkdirSync(outDir, { recursive: true });
  const options = { headless: true };
  if (process.env.HSK_CHROMIUM_EXECUTABLE) options.executablePath = process.env.HSK_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(options);
  try {
    await runCase(browser, "search", searchCase);
    await runCase(browser, "ordering", orderingCase, 1280, seedOrderingRandom);
    await runCase(browser, "round", roundCase);
    await runCase(browser, "keyboard", keyboardCase, 390);
    for (const width of [320, 390]) await runCase(browser, "mobile-" + width, (page) => mobileCase(page, width), width);
    results.push("6 cases passed; pageErrors=0; consoleErrors=0");
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outDir, "usability.log"), results.join("\n") + "\n");
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
