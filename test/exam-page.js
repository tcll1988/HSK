/* Browser end-to-end tests for HSK Past Exam Training (exam/). */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const outDir = process.argv[2];
const results = [];
const base = (process.env.HSK_BASE_URL || "http://127.0.0.1:8000").replace(/\/?$/, "/");
const examUrl = new URL("exam/", base).href;
const track = { pageErrors: [], consoleErrors: [], mp3: [] };

async function newPage(browser, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => track.pageErrors.push(String(error)));
  page.on("console", (msg) => { if (msg.type() === "error") track.consoleErrors.push(msg.text()); });
  page.on("response", (res) => {
    if (/\.mp3(\?|$)/.test(res.url())) track.mp3.push({ url: res.url(), status: res.status() });
  });
  return { context, page };
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.equal(overflow, false, "horizontal overflow detected");
}

// 1. Main site <-> exam links and level switching
async function linksCase(browser) {
  const { context, page } = await newPage(browser);
  try {
    await page.goto(new URL("index.html?level=4", base).href, { waitUntil: "load" });
    const examLink = page.locator("[data-exam-link]");
    await examLink.waitFor();
    assert.equal(await examLink.getAttribute("href"), "exam/?level=4");
    assert.ok(await page.locator("[data-game-link]").isVisible(), "game link stays visible");
    assert.ok(await page.locator("[data-rpg-link]").isVisible(), "rpg link stays visible");

    await Promise.all([page.waitForURL(/\/exam\/\?level=4$/), examLink.click()]);
    await page.locator('[data-set-card="H41001"]').waitFor();
    assert.equal(await page.locator("[data-set-card]").count(), 10, "HSK 4 has 10 exam sets");
    assert.equal(await page.locator("[data-back-vocab]").getAttribute("href"), "../?level=4");
    if (outDir) await page.screenshot({ path: path.join(outDir, "exam-sets-hsk4.png"), fullPage: true, animations: "disabled" });
    results.push("links: site -> exam/?level=4 (10 sets) and back link ../?level=4");
  } finally {
    await context.close();
  }
}

// 2. HSK 1 practice mode: images, audio playback, immediate grading, transcript, vocab drawer, review notebook
async function practiceAndVocabCase(browser) {
  const { context, page } = await newPage(browser);
  try {
    await page.goto(examUrl + "?level=1", { waitUntil: "load" });
    await page.locator('[data-start-practice="H10901"]').click();
    await page.locator('[data-q-num="1"]').waitFor();
    await page.locator("[data-audio-bar]").waitFor();

    // Verify images loaded cleanly
    const brokenImgs = await page.locator("img").evaluateAll((imgs) =>
      imgs.filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src)
    );
    assert.deepEqual(brokenImgs, [], "exam images must load");

    // Verify exam audio file fetches 200
    await page.locator("[data-audio-toggle]").click();
    await page.waitForTimeout(300);
    await page.locator("[data-audio-toggle]").click();

    // Answer Q1 correctly, Q21 wrongly -> verify instant feedback, Japanese explanation, and mistake logging
    const q1Ans = await page.evaluate(() => window.HSK_EXAM_PAGE.currentSet().questions[0].answer);
    await page.locator('[data-q-num="1"] [data-choice="' + q1Ans + '"]').click();
    assert.equal(await page.locator('[data-q-num="1"] [data-q-feedback]').getAttribute("data-q-feedback"), "right");

    const q21Ans = await page.evaluate(() => window.HSK_EXAM_PAGE.currentSet().questions[20].answer);
    const q21Wrong = q21Ans === "√" ? "×" : "√";
    await page.locator('[data-q-num="21"] [data-choice="' + q21Wrong + '"]').click();
    assert.equal(await page.locator('[data-q-num="21"] [data-q-feedback]').getAttribute("data-q-feedback"), "wrong");
    const jaExp = page.locator('[data-q-num="21"] [data-ja-explanation]');
    await jaExp.waitFor();
    const jaExpText = await jaExp.innerText();
    assert.match(jaExpText, /日本語解説/, "wrong answer shows Japanese explanation badge");
    assert.match(jaExpText, /[\u3040-\u309f\u30a0-\u30ff]/, "wrong answer shows Japanese explanation body");
    assert.ok(jaExpText.includes("あなたの解答") && jaExpText.includes("正解"), "wrong answer compares chosen vs correct");

    // Tap a Chinese word in reading Q26 to open vocab drawer
    const wordHit = page.locator('[data-q-num="26"] .zh-word-hit').first();
    await wordHit.click();
    await page.locator("#vocab-drawer:not([hidden])").waitFor();
    assert.ok((await page.locator("#vocab-drawer").innerText()).includes("HSK"));
    if (outDir) await page.screenshot({ path: path.join(outDir, "exam-practice-hsk1.png"), animations: "disabled" });

    // Open Review Notebook and verify Q21 is recorded and removable
    await page.locator('[data-area="review"]').click();
    await page.locator('[data-clear-mistake="H10901:21"]').waitFor();
    await page.locator('[data-clear-mistake="H10901:21"]').click();
    assert.equal(await page.locator('[data-clear-mistake="H10901:21"]').count(), 0);

    results.push("practiceAndVocab: H10901 images, audio, instant grading, Japanese wrong-answer explanation, vocab drawer, review notebook");
  } finally {
    await context.close();
  }
}

// 3. HSK 4 mock exam (clause order + scramble + scaled score report) & HSK 6 summary timer
async function mockAndWritingCase(browser) {
  const { context, page } = await newPage(browser);
  try {
    await page.goto(examUrl + "?set=H41001&mode=mock", { waitUntil: "load" });
    await page.locator("[data-mock-timer]").waitFor();
    await page.locator('[data-sec-tab="reading"]').click();

    // Solve HSK 4 clause ordering Q56 using correct sequence
    const q56Ans = await page.evaluate(() => window.HSK_EXAM_PAGE.currentSet().questions[55].answer);
    for (const ch of q56Ans) {
      await page.locator('[data-q-num="56"] [data-order-clause="' + ch + '"]').click();
    }

    // Switch to writing and type answer for Q86
    await page.locator('[data-sec-tab="writing"]').click();
    const q86Ans = await page.evaluate(() => window.HSK_EXAM_PAGE.currentSet().questions[85].answer);
    await page.locator('[data-q-num="86"] .zh-input').fill(q86Ans);

    // Submit mock exam and confirm scaled 300-point score report appears
    await page.locator("[data-submit-mock]").click();
    await page.locator("[data-score-report]").waitFor();
    const reportText = await page.locator("[data-score-report]").innerText();
    assert.ok(reportText.includes("/ 300 点満点"), "HSK 4 mock report shows 300-point scale");
    if (outDir) await page.screenshot({ path: path.join(outDir, "exam-mock-report-hsk4.png"), animations: "disabled" });

    // Check HSK 6 Q101 10-min reading -> hide passage workflow
    await page.goto(examUrl + "?set=H61001&mode=practice", { waitUntil: "load" });
    await page.locator('[data-sec-tab="writing"]').click();
    await page.locator('[data-q-num="101"]').waitFor();
    assert.ok(await page.locator('[data-q-num="101"] .shared-passage').isVisible(), "HSK6 story initially visible");
    await page.locator('[data-q-num="101"] .hsk6-phase-bar button').click();
    await page.locator('[data-hsk6-timer]').waitFor();
    await page.locator('[data-q-num="101"] .hsk6-phase-bar button').click();
    assert.equal(await page.locator('[data-q-num="101"] .shared-passage').count(), 0, "HSK6 story hidden during summary writing");

    results.push("mockAndWriting: H41001 order+scramble+300pt mock report and H61001 hidden-text summary workflow");
  } finally {
    await context.close();
  }
}

// 4. Mobile responsiveness & reload persistence
async function mobileAndPersistenceCase(browser) {
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  try {
    await page.goto(examUrl + "?level=3", { waitUntil: "load" });
    await page.locator('[data-start-practice="H31001"]').waitFor();
    await noOverflow(page);
    await page.locator('[data-start-practice="H31001"]').click();
    await page.locator('[data-sec-tab="writing"]').click();
    await page.locator('[data-q-num="76"]').waitFor();
    await noOverflow(page);

    // Fill HSK3 char_input Q76 and check
    const q76Ans = await page.evaluate(() => window.HSK_EXAM_PAGE.currentSet().questions[75].answer);
    await page.locator('[data-q-num="76"] .char-box').fill(q76Ans);
    await page.locator('[data-check-writing="76"]').click();
    assert.equal(await page.locator('[data-q-num="76"] [data-q-feedback]').getAttribute("data-q-feedback"), "right");

    // Reload and confirm answer persists
    await page.reload({ waitUntil: "load" });
    await page.locator('[data-sec-tab="writing"]').click();
    assert.equal(await page.locator('[data-q-num="76"] .char-box').inputValue(), q76Ans);
    if (outDir) await page.screenshot({ path: path.join(outDir, "exam-mobile-hsk3.png"), animations: "disabled" });

    results.push("mobileAndPersistence: 390px zero overflow, H31001 char_input grading, reload persistence");
  } finally {
    await context.close();
  }
}

async function main() {
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.HSK_CHROMIUM_EXECUTABLE || undefined
  });
  try {
    await linksCase(browser);
    await practiceAndVocabCase(browser);
    await mockAndWritingCase(browser);
    await mobileAndPersistenceCase(browser);
  } finally {
    await browser.close();
  }

  const badMp3 = track.mp3.filter((m) => m.status !== 200 && m.status !== 206);
  assert.deepEqual(badMp3, [], "MP3 requests must succeed");
  assert.equal(track.pageErrors.length, 0, "pageErrors: " + track.pageErrors.join("; "));
  assert.equal(track.consoleErrors.length, 0, "consoleErrors: " + track.consoleErrors.join("; "));

  const summary = results.join("\n") + "\n" + results.length + " exam cases passed; pageErrors=0; consoleErrors=0\n";
  if (outDir) fs.writeFileSync(path.join(outDir, "exam.log"), summary);
  process.stdout.write(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
