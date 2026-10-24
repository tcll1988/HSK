/* Browser check for HSKもじバトル (game/): tutorial, stage 1 with mid-boss and boss, per-level progress,
   the site's own recordings, and a gentle fallback when a recording cannot load. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const outDir = process.argv[2];
const results = [];
const base = (process.env.HSK_BASE_URL || "http://127.0.0.1:8000").replace(/\/?$/, "/");
const gameUrl = new URL("game/", base).href;

const initScript = () => {
  window.__speech = 0;
  window.__played = [];
  if (window.speechSynthesis) window.speechSynthesis.speak = function () { window.__speech += 1; };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const src = this.currentSrc || this.src;
    const p = play.call(this);
    if (p && p.then) p.then(() => { if (!/^data:/.test(src)) { window.__played.push(src); if (window.__reportPlayed) window.__reportPlayed(src); } }, () => {});
    return p;
  };
};

async function newPage(browser, width, height, track) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 600 ? 2 : 1, isMobile: width < 600, hasTouch: width < 600 });
  track.played = [];
  await context.exposeFunction("__reportPlayed", (src) => { track.played.push(src); });
  await context.addInitScript(initScript);
  const page = await context.newPage();
  page.on("pageerror", (error) => track.pageErrors.push(String(error)));
  page.on("console", (msg) => { if (msg.type() === "error") track.consoleErrors.push(msg.text()); });
  page.on("response", (response) => {
    if (/\.mp3(\?|$)/.test(response.url())) track.mp3.push({ url: response.url(), status: response.status() });
  });
  return { context, page };
}

async function tap(page, selector) {
  const el = page.locator(selector).first();
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) await el.tap(); else await el.click();
}

async function waitQuestion(page) {
  await page.waitForFunction(() => {
    if (window.HSKGame.screen() === "result") return true;
    const s = window.HSKGame.state();
    return s && !s.locked && s.answer >= 0 && document.querySelectorAll(".choice").length > 0 && !document.querySelector(".choice.correct");
  }, null, { timeout: 15000 });
  return page.evaluate(() => window.HSKGame.screen() === "result" ? null : window.HSKGame.state());
}

// Plays until the result screen. Answers wrong once when `missOnce` is set. Returns the question types seen.
async function playToResult(page, opts = {}) {
  const kinds = new Set();
  let missed = false;
  for (let n = 0; n < 120; n += 1) {
    const s = await waitQuestion(page);
    if (!s) return kinds;
    kinds.add(s.type);
    if (s.id !== "tutorial") kinds.add("phase:" + s.phase);
    if (s.type === "listen" && opts.shotListen) { await page.waitForTimeout(500); await page.screenshot({ path: opts.shotListen }); opts.shotListen = null; }
    if (opts.shotQuestion && s.type !== "listen") { await page.screenshot({ path: opts.shotQuestion }); opts.shotQuestion = null; }
    let choice = s.answer;
    if (opts.missOnce && !missed && s.id !== "tutorial") { choice = (s.answer + 1) % 4; missed = true; }
    await tap(page, '.choice[data-i="' + choice + '"]');
    if (choice !== s.answer) {
      // A wrong answer stops and waits for 「つぎへ ▶」.
      await page.locator("#btn-continue.show").waitFor();
      if (opts.shotWrong) { await page.screenshot({ path: opts.shotWrong }); opts.shotWrong = null; }
      await tap(page, "#btn-continue");
    }
  }
  throw new Error("stage did not finish");
}

async function chooseLevel(page, level) {
  await tap(page, '#scr-' + (await page.evaluate(() => window.HSKGame.screen())) + ' [data-level="' + level + '"]');
  assert.equal(await page.evaluate(() => window.HSKGame.level()), level);
}

async function stageOne(page, level, shots, label) {
  await page.goto(gameUrl);
  await chooseLevel(page, level);
  await tap(page, "#btn-start");
  await page.locator("#scr-select.active").waitFor();
  if (shots) await page.screenshot({ path: path.join(shots, label + "-select.png"), fullPage: true });
  await tap(page, '[data-stage="0"]');
  const kinds = await playToResult(page, { missOnce: true, shotListen: shots && path.join(shots, label + "-boss-listening.png"), shotQuestion: shots && path.join(shots, label + "-question.png"), shotWrong: shots && path.join(shots, label + "-wrong-next.png") });
  for (const k of ["listen", "phase:small", "phase:mid", "phase:boss"]) assert.ok(kinds.has(k), "boss must ask " + k + " (level " + level + ")");
  assert.ok(kinds.has("h2ja") && kinds.has("h2py") && kinds.has("ja2h"), "small enemy question types");
  await page.locator("#scr-result.active").waitFor();
  assert.match(await page.locator("#res-title").textContent(), /ステージクリア|ゲームオーバー/);
  if (shots) await page.screenshot({ path: path.join(shots, label + "-result.png"), fullPage: true });
  const saved = await page.evaluate(() => window.HSKGame.save());
  return { kinds: [...kinds], saved };
}

async function runViewport(browser, name, width, height, levels) {
  const track = { pageErrors: [], consoleErrors: [], mp3: [] };
  const { context, page } = await newPage(browser, width, height, track);
  const shots = width < 600 ? outDir : null;
  try {
    // Site main page links to the game.
    await page.goto(new URL("index.html?level=1", base).href);
    const link = page.locator("[data-game-link]");
    await link.waitFor();
    await Promise.all([page.waitForURL(/\/game\/\?level=1$/), link.click()]);
    await page.locator("#scr-title.active").waitFor();
    assert.equal(await page.locator("#scr-title .back-site").getAttribute("href"), "../");
    if (shots) await page.screenshot({ path: path.join(shots, "phone-title.png"), fullPage: true });

    // Tutorial (level 1).
    await tap(page, "#btn-start");
    if (shots) { await page.waitForTimeout(1300); await page.screenshot({ path: path.join(shots, "phone-tutorial.png") }); }
    const tutKinds = await playToResult(page);
    assert.deepEqual([...tutKinds].filter((k) => !k.startsWith("phase:")).sort(), ["h2ja", "h2py", "ja2h", "listen", "tone"]);
    assert.equal(await page.evaluate(() => window.HSKGame.save().tutorial), true);

    const summary = [];
    for (const level of levels) {
      const r = await stageOne(page, level, shots, "phone-hsk" + level);
      const lv = r.saved.levels[level];
      assert.ok(Object.keys(lv.miss).length >= 1, "miss saved per level");
      assert.ok(lv.best[0] > 0, "best score saved");
      for (const other of [1, 2, 3, 4, 5, 6].filter((l) => levels.indexOf(l) < 0)) assert.deepEqual(r.saved.levels[other].miss, {}, "level " + other + " untouched");
      summary.push("HSK" + level + " stage1 " + (lv.cleared[0] ? "cleared" : "game over") + " types=" + r.kinds.join("/"));
      // Review mode for this level uses that level's missed words.
      await tap(page, "#btn-res-review");
      await page.waitForFunction(() => window.HSKGame.state() && window.HSKGame.state().id === "review");
      const reviewWord = await waitQuestion(page);
      assert.ok(Object.keys(lv.miss).map(Number).includes(reviewWord.wordId), "review uses the level's missed words");
      await tap(page, "#btn-pause"); await tap(page, "#btn-quit");
    }

    // Paged stage map for big levels.
    await page.goto(gameUrl);
    await chooseLevel(page, 6);
    await tap(page, "#btn-start");
    assert.equal(await page.locator("#stage-pager .page-select").inputValue(), "0");
    assert.match(await page.locator("#stage-pager").textContent(), /1〜20/);
    assert.match(await page.locator("#stage-pager").textContent(), /／全180/);
    await tap(page, '#stage-pager [data-page="1"]');
    assert.equal(await page.locator("#stage-pager .page-select").inputValue(), "1");
    assert.equal(await page.locator("#stage-pager2 .page-select").inputValue(), "1", "bottom pager follows");
    assert.equal(await page.locator('[data-stage="20"]').isDisabled(), false, "HSK2-6 stages are all open after the tutorial");
    if (shots) await page.screenshot({ path: path.join(shots, "phone-hsk6-stage-map-page2.png"), fullPage: true });

    assert.equal(await page.evaluate(() => window.__speech), 0, "no speech synthesis");
    const played = track.played;
    assert.ok(played.length > 0, "recordings were played");
    assert.ok(track.mp3.length > 0, "mp3 requested");
    const bad = track.mp3.filter((r) => r.status !== 200 && r.status !== 206);
    assert.deepEqual(bad, [], "every mp3 request succeeded");
    for (const r of track.mp3) assert.match(new URL(r.url).pathname, /\/audio\/\d{2}\/[^/]+\.mp3$/);
    assert.deepEqual(track.pageErrors, []);
    assert.deepEqual(track.consoleErrors, []);
    results.push(name + ": tutorial ok; " + summary.join("; ") + "; mp3 requests=" + track.mp3.length + " (statuses " + [...new Set(track.mp3.map((r) => r.status))].join(",") + "); played=" + played.length);
  } catch (error) {
    results.push(name + " FAILED: " + (error.stack || error) + " pageErrors=" + JSON.stringify(track.pageErrors) + " consoleErrors=" + JSON.stringify(track.consoleErrors));
    await page.screenshot({ path: path.join(outDir, name + "-failed.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

async function audioFallback(browser) {
  const track = { pageErrors: [], consoleErrors: [], mp3: [] };
  const { context, page } = await newPage(browser, 390, 844, track);
  try {
    await page.route(/\.mp3(\?|$)/, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto(gameUrl);
    await tap(page, "#btn-start");
    // Tutorial step 4 is listening; answer the first three, then the listening question must fall back to pinyin.
    for (let i = 0; i < 3; i += 1) { const s = await waitQuestion(page); await tap(page, '.choice[data-i="' + s.answer + '"]'); }
    const s = await waitQuestion(page);
    assert.equal(s.type, "listen");
    await page.waitForFunction(() => /ピンインで出題/.test(document.getElementById("q-sub").textContent), null, { timeout: 5000 });
    assert.match(await page.locator("#audio-note").textContent(), /読み込めませんでした/);
    await page.screenshot({ path: path.join(outDir, "phone-audio-fallback.png") });
    await tap(page, '.choice[data-i="' + s.answer + '"]');
    assert.deepEqual(track.pageErrors, []);
    results.push("audio-fallback: listening question showed pinyin and a note; pageErrors=0");
  } finally {
    await context.close();
  }
}

// Reviewer fixes: ?level, site-level fallback, HSK6 page dropdown, listening replay,
// wrong answer waits for つぎへ, pause really pauses, title review state, reduced motion.
async function reviewFixes(browser) {
  const track = { pageErrors: [], consoleErrors: [], mp3: [] };
  const { context, page } = await newPage(browser, 375, 667, track);
  const log = [];
  try {
    // No game save: the site's level is used. ?level wins over everything.
    await page.goto(gameUrl);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("hsk-study-progress-v1", JSON.stringify({ level: 5 })); });
    await page.reload();
    assert.equal(await page.evaluate(() => window.HSKGame.level()), 5, "falls back to the site's level");
    await page.goto(gameUrl + "?level=4");
    assert.equal(await page.evaluate(() => window.HSKGame.level()), 4, "?level=4 opens HSK4");
    await page.goto(gameUrl + "?level=9");
    assert.equal(await page.evaluate(() => window.HSKGame.level()), 4, "bad ?level keeps the saved level");
    log.push("level param/site fallback ok");

    // Title review button disabled with a note when nothing is recorded.
    assert.equal(await page.locator("#btn-review").isDisabled(), true);
    assert.match(await page.locator("#review-note").textContent(), /まだ記録がありません/);

    // HSK6 page dropdown (tutorial marked done).
    await page.evaluate(() => { const s = window.HSKGame.save(); s.tutorial = true; s.level = 6; localStorage.setItem("hskMojiBattle.site.v1", JSON.stringify(s)); });
    await page.goto(gameUrl);
    await tap(page, "#btn-start");
    await page.locator("#scr-select.active").waitFor();
    await page.locator("#stage-pager .page-select").selectOption("5");
    assert.match(await page.locator('[data-stage="100"]').textContent(), /STAGE 101/);
    assert.equal(await page.locator('[data-stage="100"]').isDisabled(), false);
    assert.equal(await page.locator("#stage-pager2 .page-select").inputValue(), "5");
    await page.locator("#stage-pager2 .page-select").selectOption("8");
    assert.equal(await page.locator("#stage-pager .page-select").inputValue(), "8");
    log.push("HSK6 dropdown ok");

    // Wrong answer stops the flow; Enter advances.
    await tap(page, '[data-stage="160"]');
    let s = await waitQuestion(page);
    await tap(page, '.choice[data-i="' + ((s.answer + 1) % 4) + '"]');
    await page.locator("#btn-continue.show").waitFor();
    assert.match(await page.locator("#q-feedback").textContent(), /あなたの答え：/);
    await page.waitForTimeout(3000);
    let after = await page.evaluate(() => window.HSKGame.state());
    assert.equal(after.answered, 1); assert.equal(after.locked, true, "still waiting after 3s");
    assert.equal(await page.evaluate(() => window.HSKGame.waitingNext()), true);
    await page.keyboard.press("Enter");
    s = await waitQuestion(page);
    assert.equal(await page.evaluate(() => window.HSKGame.waitingNext()), false);
    log.push("wrong answer waits for つぎへ ok");

    // Pause during the correct-answer delay: nothing advances; resume continues.
    await tap(page, '.choice[data-i="' + s.answer + '"]');
    await tap(page, "#btn-pause");
    assert.equal(await page.evaluate(() => window.HSKGame.paused()), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), "btn-resume", "focus moves into the dialog");
    assert.equal(await page.evaluate(() => document.getElementById("scr-game").inert), true, "game is inert while paused");
    assert.equal(await page.locator("#pause").getAttribute("role"), "dialog");
    const before = await page.evaluate(() => window.HSKGame.state());
    assert.ok(await page.evaluate(() => window.HSKGame.pendingTimers()) > 0);
    await page.waitForTimeout(2500);
    const still = await page.evaluate(() => window.HSKGame.state());
    assert.equal(still.wordId, before.wordId, "paused: no next question");
    assert.equal(still.answered, before.answered);
    await tap(page, "#btn-resume");
    assert.equal(await page.evaluate(() => document.activeElement.id), "btn-pause", "focus returns to the pause button");
    s = await waitQuestion(page);
    assert.equal(s.answered, before.answered, "resume continues to the next question");
    log.push("pause suspends ok");

    // Listening replay through the big 🔊 button.
    for (let n = 0; n < 80 && s && s.type !== "listen"; n += 1) {
      await tap(page, '.choice[data-i="' + s.answer + '"]');
      s = await waitQuestion(page);
    }
    assert.equal(s.type, "listen", "reached a listening question");
    const btn = page.locator("#btn-listen");
    assert.equal(await btn.getAttribute("aria-label"), "もう一度聞く");
    assert.match(await btn.textContent(), /タップでもう一度/);
    await page.waitForTimeout(800);
    const n0 = track.played.length;
    await tap(page, "#btn-listen");
    await page.waitForTimeout(800);
    assert.ok(track.played.length > n0, "tapping 🔊 replays the recording");
    if (outDir) await page.screenshot({ path: path.join(outDir, "phone375-listening-boss.png") });
    log.push("listen replay ok");

    // Long HSK6 meaning fits at 375x667 and 360x740 (no horizontal overflow).
    const long = await page.evaluate(() => window.HSKGame.words().filter((w) => w.ja.length >= 29)[0]);
    assert.ok(long, "an HSK6 word with a 29+ character meaning");
    for (const [w, h] of [[375, 667], [360, 740]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const type of ["ja2h", "h2ja"]) {
        assert.equal(await page.evaluate(([id, t]) => window.HSKGame.ask(id, t), [long.id, type]), true);
        const fits = await page.evaluate(() => {
          const els = [document.getElementById("q-main")].concat([...document.querySelectorAll(".choice")]);
          const inView = document.getElementById("choices").getBoundingClientRect().bottom <= innerHeight + 1;
          return els.every((m) => m.scrollWidth <= m.clientWidth + 1 && (m.id === "q-main" || m.scrollHeight <= m.clientHeight + 1)) && document.documentElement.scrollWidth <= innerWidth + 1 && inView;
        });
        if (outDir) await page.screenshot({ path: path.join(outDir, "phone" + w + "x" + h + "-hsk6-long-meaning-" + type + ".png") });
        assert.ok(fits, "long meaning (" + type + ") fits at " + w + "x" + h + " " + JSON.stringify(await page.evaluate(() => [document.getElementById("choices").getBoundingClientRect().bottom, innerHeight, [...document.querySelectorAll(".choice")].map((m) => [m.scrollWidth, m.clientWidth, m.scrollHeight, m.clientHeight])])));
      }
    }
    log.push("long meaning fits");
    await tap(page, "#btn-pause"); await tap(page, "#btn-quit");

    assert.deepEqual(track.pageErrors, []);
    assert.deepEqual(track.consoleErrors, []);
  } finally {
    await context.close();
  }

  // Reduced motion: no shake on a wrong answer.
  const t2 = { pageErrors: [], consoleErrors: [], mp3: [] };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    p.on("pageerror", (e) => t2.pageErrors.push(String(e)));
    await p.goto(gameUrl + "?level=2");
    await p.evaluate(() => { const s = window.HSKGame.save(); s.tutorial = true; localStorage.setItem("hskMojiBattle.site.v1", JSON.stringify(s)); });
    await p.goto(gameUrl + "?level=2");
    await p.click("#btn-start");
    await p.click('[data-stage="3"]');
    const s = await waitQuestion(p);
    await p.click('.choice[data-i="' + ((s.answer + 1) % 4) + '"]');
    await p.locator("#btn-continue.show").waitFor();
    assert.equal(await p.evaluate(() => document.getElementById("scr-game").classList.contains("shake")), false, "no shake with reduced motion");
    assert.deepEqual(t2.pageErrors, []);
    log.push("reduced motion ok");
  } finally {
    await ctx.close();
  }
  results.push("review-fixes: " + log.join("; "));
}

async function main() {
  if (!outDir) throw new Error("pass an output directory");
  fs.mkdirSync(outDir, { recursive: true });
  const options = { headless: true };
  if (process.env.HSK_CHROMIUM_EXECUTABLE) options.executablePath = process.env.HSK_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(options);
  try {
    if (process.env.HSK_GAME_ONLY === "review") { await reviewFixes(browser); return; }
    await runViewport(browser, "phone-390x844", 390, 844, [1, 3, 6]);
    await runViewport(browser, "desktop-1280x800", 1280, 800, [1, 6]);
    await audioFallback(browser);
    await reviewFixes(browser);
    results.push("4 game cases passed; pageErrors=0; consoleErrors=0");
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outDir, "game.log"), results.join("\n") + "\n");
    console.log(results.join("\n"));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
