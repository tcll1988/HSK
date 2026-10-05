/* Browser checks for resuming study, small batches, and persistent wrong-word review. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const outDir = process.argv[2];
const results = [];
const progressKey = "hsk-study-progress-v1";
const preferencesKey = "hsk-study-preferences-v1";

function pageUrl() {
  const url = new URL("index.html", (process.env.HSK_BASE_URL || "http://127.0.0.1:8000").replace(/\/?$/, "/"));
  url.searchParams.set("seed", "7");
  return url.href;
}

async function ids(page) {
  return page.locator(".word").evaluateAll((rows) => rows.map((row) => Number(row.dataset.entryId)));
}

async function question(page) {
  return page.evaluate(() => window.HSK_PAGE.question());
}

async function answer(page, correct) {
  const current = await question(page);
  const index = current.choices.findIndex((choice) => choice.keyed === correct);
  assert.ok(index >= 0);
  await page.locator('[data-choice-index="' + index + '"]').click();
  assert.equal(await page.locator("[data-feedback]").textContent(), correct ? "正解" : "不正解");
  return current;
}

async function snapshot(page) {
  return page.evaluate(() => ({
    question: window.HSK_PAGE.question(),
    progress: document.querySelector(".progress-label").textContent,
    score: document.querySelector(".score").textContent,
    feedback: document.querySelector("[data-feedback]").textContent,
    explanation: Array.from(document.querySelectorAll(".answer-explanation"), (node) => node.textContent),
    nextDisabled: document.querySelector("[data-next]").disabled,
    choices: Array.from(document.querySelectorAll(".choice"), (node) => ({
      text: node.textContent,
      disabled: node.disabled,
      right: node.classList.contains("is-right"),
      wrong: node.classList.contains("is-wrong")
    }))
  }));
}

async function listContinuity(page) {
  await page.locator('.levels [data-level="6"]').click();
  await page.locator(".list-tools > summary").click();
  await page.locator("[data-word-order]").selectOption("random");
  const firstBatch = await ids(page);
  assert.equal(firstBatch.length, 20);
  await page.locator("[data-batch-next]").click();
  const secondBatch = await ids(page);
  assert.equal(secondBatch.length, 20);
  assert.equal(secondBatch.some((id) => firstBatch.includes(id)), false, "batches must not repeat words");
  assert.equal(await page.locator('[data-mark-learned][aria-pressed="true"]').count(), 0, "viewing words must not mark them learned");
  const remembered = secondBatch[3];
  const marked = page.locator('.word[data-entry-id="' + remembered + '"] [data-mark-learned]');
  await marked.click();
  assert.equal(await marked.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('[data-mark-learned][aria-pressed="true"]').count(), 1);
  const learnedCount = await page.locator(".learned-count").textContent();
  await page.reload({ waitUntil: "load" });
  assert.equal((await page.locator(".list h2").innerText()).trim(), "HSK 6");
  assert.equal(await page.locator("[data-word-order]").inputValue(), "random");
  assert.deepEqual(await ids(page), secondBatch, "reload must restore the batch and random order");
  assert.equal(await marked.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".learned-count").textContent(), learnedCount);
  await page.locator("[data-resume]").click();
  await page.waitForFunction((id) => {
    const row = document.querySelector('.word[data-entry-id="' + id + '"]');
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  }, remembered);

  const distantWord = await page.evaluate((visible) => window.HSK_PAGE.vocab.find((entry) => entry.level === 6 && entry.hanzi.length >= 4 && !visible.includes(entry.id)), secondBatch);
  await page.locator(".search").fill(distantWord.hanzi);
  assert.equal(await page.locator('.word[data-entry-id="' + distantWord.id + '"]').count(), 1, "search must include words outside the current batch");
  await page.locator(".search-clear").click();
  assert.deepEqual(await ids(page), secondBatch, "clearing search must restore the study batch");
  await page.locator("[data-batch-prev]").click();
  assert.deepEqual(await ids(page), firstBatch, "previous random batch must remain stable");
  await page.locator("[data-batch-next]").click();
  assert.deepEqual(await ids(page), secondBatch);
  await page.locator('[data-section="practice"]').click();
  await page.locator('[data-section="list"]').click();
  assert.deepEqual(await ids(page), secondBatch);
  await marked.click();
  assert.equal(await marked.getAttribute("aria-pressed"), "false", "learned marks must be reversible");
}

async function practiceContinuity(page) {
  await page.locator('[data-section="practice"]').click();
  await answer(page, true);
  await page.locator("[data-next]").click();
  await answer(page, false);
  const original = await snapshot(page);
  await page.locator('[data-section="list"]').click();
  await page.locator('[data-section="practice"]').click();
  assert.deepEqual(await snapshot(page), original, "looking up a word must preserve the answered question and score");
  await page.locator('[data-view="pinyin"]').click();
  await answer(page, false);
  const pinyin = await snapshot(page);
  await page.locator('[data-view="gloss"]').click();
  assert.deepEqual(await snapshot(page), original, "each practice mode must retain its session");
  await page.locator('[data-view="pinyin"]').click();
  assert.deepEqual(await snapshot(page), pinyin);
  await page.locator('[data-view="gloss"]').click();
  await page.locator('.levels [data-level="2"]').click();
  await answer(page, true);
  const level2 = await snapshot(page);
  await page.locator('.levels [data-level="1"]').click();
  assert.deepEqual(await snapshot(page), original);
  await page.locator('.levels [data-level="2"]').click();
  assert.deepEqual(await snapshot(page), level2);
  await page.locator('.levels [data-level="1"]').click();
  await page.reload({ waitUntil: "load" });
  assert.deepEqual(await snapshot(page), original, "reload must preserve answer feedback, disabled choices, score, and next action");
  await page.locator("[data-next]").click();
  const thirdQuestion = await snapshot(page);
  assert.match(thirdQuestion.progress, /第\s*3\s*問/);
  await page.locator("[data-practice-restart]").click();
  await page.locator("[data-cancel-restart]").click();
  assert.deepEqual(await snapshot(page), thirdQuestion, "cancelling restart must keep the current round");
  await page.locator("[data-practice-restart]").click();
  await page.locator("[data-confirm-restart]").click();
  assert.match(await page.locator(".progress-label").innerText(), /第\s*1\s*問/);
  assert.match(await page.locator(".score").innerText(), /正解\s*0\s*\/\s*10/);
  assert.equal(await page.locator("[data-next]").isDisabled(), true);
}

async function sameLevelChoices(page, current) {
  const levels = await page.evaluate((choices) => choices.map((choice) => window.HSK_PAGE.vocab.find((entry) => entry.id === choice.entryId).level), current.choices);
  assert.equal(current.choices.length, 4);
  assert.ok(levels.every((level) => level === current.level), "review distractors must come from the question's level");
}

async function savedReview(page) {
  await page.locator('[data-section="practice"]').click();
  const wrongIds = [];
  for (let index = 0; index < 10; index += 1) {
    const current = await answer(page, index >= 3);
    if (index < 3) wrongIds.push(current.entryId);
    await page.locator("[data-next]").click();
  }
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.locator(".review-word").count(), 3);
  await page.locator("[data-review-mistakes]").click();
  assert.equal(await page.locator(".progress-track").getAttribute("aria-valuemax"), "3");
  let clearedId;
  for (let index = 0; index < 3; index += 1) {
    const current = await question(page);
    assert.ok(wrongIds.includes(current.entryId), "review must target a saved wrong word");
    await sameLevelChoices(page, current);
    assert.ok(current.choices.some((choice) => !wrongIds.includes(choice.entryId)), "a short review still needs full-level distractors");
    if (index === 0) clearedId = current.entryId;
    await answer(page, index === 0);
    await page.locator("[data-next]").click();
  }
  await page.locator("[data-return-list]").click();
  await page.reload({ waitUntil: "load" });
  await page.locator("[data-review-start]").click();
  assert.equal(await page.locator(".progress-track").getAttribute("aria-valuemax"), "2", "a correct review answer must defer that word until tomorrow");
  const remaining = wrongIds.filter((id) => id !== clearedId);
  for (let index = 0; index < 2; index += 1) {
    const current = await question(page);
    assert.ok(remaining.includes(current.entryId));
    await sameLevelChoices(page, current);
    await answer(page, true);
    await page.locator("[data-next]").click();
  }
  await page.locator("[data-return-list]").click();
  assert.equal(await page.locator("[data-review-start]").isVisible(), false, "passed words must leave today's due queue");
}

async function corruptStorage(page) {
  await page.addInitScript(({ progress, preferences }) => {
    const value = new URL(location.href).searchParams.get("corrupt");
    if (value !== null) {
      localStorage.setItem(progress, value);
      localStorage.setItem(preferences, value);
    }
  }, { progress: progressKey, preferences: preferencesKey });
  const malformed = JSON.stringify({ level: {}, view: { toString: null }, lastPracticeView: {}, sessions: [], listPositions: [], randomSeeds: [], speed: { toString: null } });
  for (const invalid of ["{broken", "null", "[]", '"unexpected value"', malformed]) {
    const url = new URL(pageUrl());
    url.searchParams.set("corrupt", invalid);
    await page.goto(url.href, { waitUntil: "load" });
    assert.equal(await page.locator(".word").count(), 20, "invalid saved data must not prevent learning");
    await page.locator('[data-section="practice"]').click();
    await answer(page, true);
    await page.locator("[data-next]").click();
    assert.match(await page.locator(".progress-label").innerText(), /第\s*2\s*問/);
  }
}

function blockStorage() {
  Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage disabled for this test", "SecurityError"); } });
}

async function unavailableStorage(page) {
  const mark = page.locator("[data-mark-learned]").first();
  await mark.click();
  assert.equal(await mark.getAttribute("aria-pressed"), "true");
  await page.locator(".list-tools > summary").click();
  await page.locator("[data-word-order]").selectOption("random");
  await page.locator("[data-batch-next]").click();
  const batch = await ids(page);
  await page.locator('[data-section="practice"]').click();
  await answer(page, true);
  const current = await snapshot(page);
  await page.locator('[data-section="list"]').click();
  assert.deepEqual(await ids(page), batch);
  await page.locator('[data-section="practice"]').click();
  assert.deepEqual(await snapshot(page), current, "blocked storage must still permit in-memory progress");
}

async function mobileLayout(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "mobile page overflows");
  const short = await page.locator("[data-batch-prev], [data-batch-next], [data-mark-learned], [data-resume], [data-review-start], [data-review-mistakes], [data-practice-restart], [data-confirm-restart], [data-cancel-restart]").evaluateAll((nodes) => nodes.filter((node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.height < 44;
  }).map((node) => node.outerHTML.slice(0, 180)));
  assert.deepEqual(short, [], "new mobile actions need 44px touch heights");
}

async function mobileContinuity(page, width) {
  await page.locator("[data-batch-next]").tap();
  await page.locator("[data-mark-learned]").first().tap();
  await mobileLayout(page);
  await page.locator('[data-section="practice"]').tap();
  await answer(page, false);
  await page.locator("[data-practice-restart]").tap();
  await mobileLayout(page);
  await page.locator("[data-cancel-restart]").tap();
  await page.locator('[data-section="list"]').tap();
  await mobileLayout(page);
  await page.screenshot({ path: path.join(outDir, "continuity-mobile-" + width + ".png"), fullPage: true, animations: "disabled" });
  await page.locator("[data-review-start]").tap();
  await mobileLayout(page);
  await answer(page, true);
  await page.locator("[data-next]").tap();
  await mobileLayout(page);
}

async function runCase(browser, name, action, width = 1280, initialize) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: "Asia/Tokyo", reducedMotion: "reduce", hasTouch: width < 600, isMobile: width < 600 });
  if (initialize) await context.addInitScript(initialize);
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00+09:00"));
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
    await runCase(browser, "list-continuity", listContinuity);
    await runCase(browser, "practice-continuity", practiceContinuity);
    await runCase(browser, "saved-review", savedReview);
    await runCase(browser, "corrupt-storage", corruptStorage);
    await runCase(browser, "unavailable-storage", unavailableStorage, 1280, blockStorage);
    for (const width of [320, 390]) await runCase(browser, "mobile-" + width, (page) => mobileContinuity(page, width), width);
    results.push("7 cases passed; pageErrors=0; consoleErrors=0");
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outDir, "continuity.log"), results.join("\n") + "\n");
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
