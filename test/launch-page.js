/* Open the student page twice and check levels, scoring, and the inactive recording place. */
const { chromium } = require("playwright");
const { pathToFileURL } = require("url");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const outDir = process.argv[2];

function pageUrl() {
  const url = pathToFileURL(path.join(root, "index.html"));
  url.searchParams.set("seed", "7");
  url.searchParams.set("level", "1");
  return url.href;
}

async function hanziTexts(page) {
  return page.locator(".hanzi").allTextContents();
}

async function answer(page, keyed) {
  const question = await page.evaluate(() => window.HSK_PAGE.question());
  const index = question.choices.findIndex((choice) => choice.keyed === keyed);
  if (index < 0) {
    throw new Error("missing choice keyed=" + keyed);
  }
  const button = page.locator('[data-choice-index="' + index + '"]');
  const label = await button.evaluate((node) => node.textContent);
  if (label !== question.choices[index].text) {
    throw new Error("choice text does not match the question");
  }
  await button.click();
  const feedback = await page.locator("[data-feedback]").evaluate((node) => node.textContent);
  const wanted = keyed ? "正解" : "不正解";
  if (feedback !== wanted) {
    throw new Error("feedback was " + feedback);
  }
  return label;
}

async function runOnce(browser, index) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1
  });
  page.setDefaultTimeout(60000);
  const errors = [];
  const audio = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("request", (req) => {
    const url = req.url();
    if (req.resourceType() === "media" || /\.(mp3|wav|ogg|m4a|aac)(\?|$)/i.test(url)) {
      audio.push(url);
    }
  });

  await page.goto(pageUrl(), { waitUntil: "load" });
  const defaults = await page.evaluate(() => ({
    speed: document.querySelector("audio[data-player]").playbackRate,
    pinyinHidden: getComputedStyle(document.querySelector(".list .pinyin")).display === "none",
    japaneseVisible: getComputedStyle(document.querySelector(".list .gloss")).display !== "none",
    separate: document.querySelector('[data-section="list"]') && !document.querySelector('[data-view="gloss"]')
  }));
  if (defaults.speed !== 1 || !defaults.pinyinHidden || !defaults.japaneseVisible || !defaults.separate) {
    throw new Error("study settings defaults or separate navigation are wrong");
  }

  let level;
  for (level = 1; level <= 6; level += 1) {
    const button = page.locator('.levels [data-level="' + level + '"]');
    if (!(await button.isVisible())) {
      throw new Error("level button missing " + level);
    }
    const name = (await button.innerText()).replace(/\s+/g, " ").trim();
    if (name.indexOf(String(level)) === -1) {
      throw new Error("level button text " + name);
    }
  }

  const level1 = await hanziTexts(page);
  if (level1.indexOf("昨天") === -1) throw new Error("level 1 missing 昨天");
  if (level1.indexOf("爱不释手") !== -1) throw new Error("level 1 shows 爱不释手");
  if ((await page.locator(".list h2").innerText()).trim() !== "HSK 1") {
    throw new Error("level 1 heading");
  }

  const listen = page.locator('[data-hanzi="昨天"] [data-audio="昨天"]');
  if (!(await listen.isEnabled())) throw new Error("昨天 has no audio control");
  await Promise.all([
    page.waitForRequest((req) => decodeURIComponent(req.url()).indexOf("昨天.mp3") !== -1),
    listen.click()
  ]);
  const playedYesterday = await page.evaluate(() => {
    const node = document.querySelector("audio[data-player]");
    if (!node) return false;
    const src = decodeURIComponent(node.currentSrc || node.src);
    return src.indexOf("昨天.mp3") !== -1 && (!node.paused || node.ended || node.currentTime > 0);
  });
  if (!playedYesterday) throw new Error("昨天 did not play");

  await page.locator('.levels [data-level="6"]').click();
  await page.locator('[data-hanzi="爱不释手"]').first().waitFor();
  const level6 = await hanziTexts(page);
  if (level6.indexOf("爱不释手") === -1) throw new Error("level 6 missing 爱不释手");
  if (level6.indexOf("昨天") !== -1) throw new Error("level 6 shows 昨天");
  const marked = await page.locator('[data-hanzi="爱不释手"]').first().getAttribute("data-level");
  if (marked !== "6") throw new Error("爱不释手 marked as level " + marked);
  if ((await page.locator(".list h2").innerText()).trim() !== "HSK 6") {
    throw new Error("level 6 heading");
  }

  await page.locator('[data-section="practice"]').click();
  await page.locator('[data-view="gloss"]').waitFor();
  await page.locator('[data-choice-index="0"]').waitFor();
  const wrong = await answer(page, false);
  await page.locator("[data-next]").click();
  await page.locator('[data-choice-index="0"]').waitFor();
  const right = await answer(page, true);

  if (await page.locator("audio[data-player]").count() !== 1) {
    throw new Error("missing the shared audio player");
  }
  if (await page.locator("video").count()) throw new Error("page contains video");
  const recording = page.locator("[data-role='recording']");
  if (!(await recording.isVisible())) throw new Error("recording place hidden");
  const recordingText = await recording.innerText();
  if (recordingText.indexOf("音声") === -1) throw new Error("recording place has no 音声");
  if (recordingText.indexOf("まだ入っていません") !== -1) throw new Error("audio still marked missing");
  const promptListen = page.locator(".practice [data-audio]");
  if (await promptListen.count() !== 1) throw new Error("practice word has no 聞く");
  if (!(await promptListen.isEnabled())) throw new Error("practice 聞く is disabled");
  if (!audio.some((url) => decodeURIComponent(url).indexOf("昨天.mp3") !== -1)) {
    throw new Error("yesterday audio was not requested");
  }
  if (errors.length) throw new Error(errors.join("\n"));

  const shot = path.join(outDir, "hsk-run" + index + ".png");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot, fullPage: true, animations: "disabled" });

  await page.locator(".settings-summary").click();
  await page.locator(".speed-select").selectOption("0.75");
  await page.locator('[data-setting="showPinyin"]').check();
  await page.locator('[data-setting="showJapanese"]').uncheck();
  const changedSpeed = await page.locator("audio[data-player]").evaluate((node) => node.playbackRate);
  if (changedSpeed !== 0.75) throw new Error("audio speed did not update");
  await page.goto(pageUrl(), { waitUntil: "load" });
  const saved = await page.evaluate(() => ({
    speed: document.querySelector("audio[data-player]").playbackRate,
    pinyinVisible: getComputedStyle(document.querySelector(".list .pinyin")).display !== "none",
    japaneseHidden: getComputedStyle(document.querySelector(".list .gloss")).display === "none"
  }));
  if (saved.speed !== 0.75 || !saved.pinyinVisible || !saved.japaneseHidden) {
    throw new Error("study settings did not persist");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pageUrl(), { waitUntil: "load" });
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  });
  if (overflow) throw new Error("mobile layout overflows");
  if (errors.length) throw new Error(errors.join("\n"));

  await page.close();
  const hash = crypto.createHash("sha256").update(fs.readFileSync(shot)).digest("hex");
  return { hash: hash, wrong: wrong, right: right };
}

async function main() {
  if (!outDir) {
    throw new Error("pass the scratch directory");
  }
  fs.mkdirSync(outDir, { recursive: true });
  const lines = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const first = await runOnce(browser, 1);
    const second = await runOnce(browser, 2);
    lines.push("run1 " + first.hash + " wrong=" + first.wrong + " right=" + first.right);
    lines.push("run2 " + second.hash + " wrong=" + second.wrong + " right=" + second.right);
    if (first.hash !== second.hash || first.wrong !== second.wrong || first.right !== second.right) {
      throw new Error("the two launches did not agree");
    }
    lines.push("pageErrors=0");
    lines.push("audioPlayed=昨天");
    lines.push("recordingActive=true");
    lines.push("agree");
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outDir, "playwright-launch.log"), lines.join("\n") + "\n", "utf8");
  }
  console.log(lines.join("\n"));
}

main().catch((err) => {
  const lines = ["FAILED", err && err.stack ? err.stack : String(err)];
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "playwright-launch.log"), lines.join("\n") + "\n", "utf8");
  }
  console.error(lines.join("\n"));
  process.exit(1);
});
