/* End-to-end checks for the learning workflow, scheduling, playback, and backups. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const outDir = process.argv[2];
const results = [];
const today = "2026-10-05T12:00:00+09:00";
const tomorrow = "2026-10-06T12:00:00+09:00";
const selectedCases = process.env.HSK_LEARNING_CASE ? new Set(process.env.HSK_LEARNING_CASE.split(",")) : null;

function pageUrl() {
  const url = new URL("index.html", (process.env.HSK_BASE_URL || "http://127.0.0.1:8000").replace(/\/?$/, "/"));
  url.searchParams.set("seed", "7");
  return url.href;
}

async function visibleIds(page) {
  return page.locator(".word").evaluateAll((rows) => rows.map((row) => Number(row.dataset.entryId)));
}

async function answer(page, correct) {
  const current = await page.evaluate(() => window.HSK_PAGE.question());
  const index = current.choices.findIndex((choice) => choice.keyed === correct);
  assert.ok(index >= 0);
  await page.locator('[data-choice-index="' + index + '"]').click();
  assert.equal(await page.locator("[data-feedback]").textContent(), correct ? "正解" : "不正解");
  return current;
}

async function practiceSnapshot(page) {
  return page.evaluate(() => ({
    question: window.HSK_PAGE.question(),
    score: document.querySelector(".score").textContent,
    progress: document.querySelector(".progress-label").textContent,
    feedback: document.querySelector("[data-feedback]").textContent,
    disabled: Array.from(document.querySelectorAll(".choice"), (node) => node.disabled),
    nextDisabled: document.querySelector("[data-next]").disabled
  }));
}

async function reveal(page, selector) {
  const control = page.locator(selector);
  const closed = control.locator("xpath=ancestor::details[not(@open)]");
  while (await closed.count()) await closed.first().locator("summary").first().click();
  return control;
}

async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "horizontal overflow");
}

async function lookupCase(page) {
  await page.locator('.levels [data-level="2"]').click();
  await page.locator("[data-batch-next]").click();
  const original = await visibleIds(page);
  const remembered = original[3];
  await page.locator('.word[data-entry-id="' + remembered + '"] [data-mark-learned]').click();
  await page.locator(".search").fill("爱不释手");
  assert.equal(await page.locator(".word").count(), 0, "local search must respect the selected level");
  await (await reveal(page, "[data-search-scope]")).selectOption("all");
  const found = page.locator('.word[data-hanzi="爱不释手"]');
  assert.equal(await found.getAttribute("data-level"), "6");
  assert.match(await found.innerText(), /HSK\s*6|6\s*級/, "global results need a visible level label");
  await found.locator(".hanzi").click();
  await page.waitForFunction(() => {
    const player = document.querySelector("audio[data-player]");
    return !player.paused && player.readyState >= 2;
  });
  await found.locator(".hanzi").click();
  await found.locator("[data-mark-learned]").click();
  await page.locator(".search-clear").click();
  assert.equal((await page.locator(".list h2").innerText()).trim(), "HSK 2");
  assert.deepEqual(await visibleIds(page), original, "looking up, playing, or marking a result must not move the study batch");
  await page.reload({ waitUntil: "load" });
  assert.deepEqual(await visibleIds(page), original);
  await page.locator("[data-resume]").click();
  await page.waitForFunction((id) => {
    const row = document.querySelector('.word[data-entry-id="' + id + '"]');
    const rect = row.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  }, remembered);
  assert.equal(await page.evaluate(() => Number(document.activeElement.dataset.entryId)), remembered, "resume must focus the exact remembered word");
  await page.locator(".search").fill("爱不释手");
  await (await reveal(page, "[data-search-scope]")).selectOption("all");
  await found.locator("[data-study-from]").click();
  assert.equal((await page.locator(".list h2").innerText()).trim(), "HSK 6");
  assert.equal(await page.locator('.word[data-hanzi="爱不释手"]').count(), 1, "explicit study-from must open the result's group");
  await page.locator('.levels [data-level="2"]').click();
  if (await page.locator(".search").inputValue()) await page.locator(".search-clear").click();
  assert.deepEqual(await visibleIds(page), original, "another level's study-from must preserve the original level's place");
  await page.reload({ waitUntil: "load" });
  await page.locator("[data-resume]").click();
  const prior = await page.evaluate(() => Number(document.activeElement.dataset.entryId));
  await page.mouse.move(1000, 450);
  await page.mouse.wheel(0, 600);
  await page.waitForFunction((id) => document.querySelector('.word[data-entry-id="' + id + '"]').getBoundingClientRect().bottom < 0, prior);
  const reading = await page.locator(".word").evaluateAll((rows) => rows.filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight;
  }).map((row) => Number(row.dataset.entryId)));
  await page.reload({ waitUntil: "load" });
  await page.locator("[data-resume]").click();
  const resumed = await page.evaluate(() => Number(document.activeElement.dataset.entryId));
  assert.notEqual(resumed, prior, "real scrolling must advance the remembered word");
  assert.ok(reading.includes(resumed), "resume must return to the words actually visible after scrolling");
}

async function batchPracticeCase(page) {
  await page.locator('[data-section="practice"]').click();
  await answer(page, true);
  const normal = await practiceSnapshot(page);
  await page.locator('[data-section="list"]').click();
  await page.locator("[data-batch-next]").click();
  const targets = await visibleIds(page);
  await page.locator("[data-batch-next]").click();
  const nextBatch = await visibleIds(page);
  await page.locator("[data-batch-prev]").click();
  await page.locator("[data-practice-batch]").click();
  assert.equal(await page.locator(".progress-track").getAttribute("aria-valuemax"), "20");
  const asked = [];
  for (let index = 0; index < targets.length; index += 1) {
    const current = await page.evaluate(() => window.HSK_PAGE.question());
    assert.ok(targets.includes(current.entryId), "group practice must only ask words in that group");
    asked.push(current.entryId);
    const levels = await page.evaluate((choices) => choices.map((choice) => window.HSK_PAGE.vocab.find((entry) => entry.id === choice.entryId).level), current.choices);
    assert.equal(current.choices.length, 4);
    assert.ok(levels.every((level) => level === current.level), "group distractors must remain in the selected level");
    await answer(page, index % 2 === 0);
    if (index === 3) {
      const saved = await practiceSnapshot(page);
      await page.locator("[data-return-practice]").click();
      assert.deepEqual(await practiceSnapshot(page), normal, "group practice must not replace the ordinary practice session");
      await page.locator('[data-section="list"]').click();
      await page.locator("[data-practice-batch]").click();
      assert.deepEqual(await practiceSnapshot(page), saved);
      await page.locator('[data-view="pinyin"]').click();
      assert.equal(await page.locator(".progress-track").getAttribute("aria-valuemax"), "20", "changing mode must retain the group scope");
      assert.ok(targets.includes((await page.evaluate(() => window.HSK_PAGE.question())).entryId));
      await answer(page, false);
      const pinyin = await practiceSnapshot(page);
      await page.locator('[data-view="gloss"]').click();
      assert.deepEqual(await practiceSnapshot(page), saved);
      await page.locator('[data-view="pinyin"]').click();
      assert.deepEqual(await practiceSnapshot(page), pinyin, "each group practice mode must keep its own answer");
      await page.locator('[data-view="gloss"]').click();
      await page.reload({ waitUntil: "load" });
      assert.deepEqual(await practiceSnapshot(page), saved, "a group round must resume its answer and score");
    }
    await page.locator("[data-next]").click();
  }
  assert.deepEqual([...asked].sort((a, b) => a - b), [...targets].sort((a, b) => a - b), "every group word must be asked once");
  assert.equal(Number(await page.locator(".summary-score strong").innerText()), 10);
  await page.locator("[data-batch-continue]").click();
  assert.deepEqual(await visibleIds(page), nextBatch, "continue must lead to the next study group");
  while (await page.locator("[data-batch-next]").isEnabled()) await page.locator("[data-batch-next]").click();
  const finalBatch = await visibleIds(page);
  assert.ok(finalBatch.length > 0 && finalBatch.length < 20);
  await page.locator("[data-practice-batch]").click();
  assert.equal(Number(await page.locator(".progress-track").getAttribute("aria-valuemax")), finalBatch.length, "the final short group must use its actual size");
}

async function defaultsAndFiltersCase(page) {
  assert.equal(await page.locator(".word .pinyin").first().isVisible(), true, "fresh HSK 1 should show pronunciation");
  await page.locator('.levels [data-level="2"]').click();
  assert.equal(await page.locator(".word .pinyin").first().isVisible(), true, "fresh HSK 2 should show pronunciation");
  const initial = await visibleIds(page);
  const marks = page.locator("[data-mark-learned]");
  assert.equal((await marks.first().textContent()).trim(), "○");
  for (const id of initial.slice(0, 2)) {
    const control = page.locator('.word[data-entry-id="' + id + '"] [data-mark-learned]');
    await control.click();
    assert.equal((await control.textContent()).trim(), "✓");
    assert.equal(await control.getAttribute("aria-pressed"), "true");
  }
  await page.locator("[data-batch-next]").click();
  const distant = (await visibleIds(page))[0];
  await page.locator('[data-entry-id="' + distant + '"] [data-mark-learned]').click();
  await page.locator("[data-batch-prev]").click();
  const learnedIds = [...initial.slice(0, 2), distant];
  await (await reveal(page, "[data-learned-filter]")).selectOption("learned");
  assert.deepEqual((await visibleIds(page)).sort((a, b) => a - b), [...learnedIds].sort((a, b) => a - b), "learned filtering must span the whole level");
  await page.locator("[data-practice-batch]").click();
  assert.equal(await page.locator(".progress-track").getAttribute("aria-valuemax"), "3");
  assert.ok(learnedIds.includes((await page.evaluate(() => window.HSK_PAGE.question())).entryId), "filtered practice must use the visible learned words");
  await page.locator('[data-section="list"]').click();
  await (await reveal(page, "[data-learned-filter]")).selectOption("new");
  assert.ok((await visibleIds(page)).length > 0);
  assert.equal((await visibleIds(page)).some((id) => learnedIds.includes(id)), false);
  await (await reveal(page, "[data-learned-filter]")).selectOption("all");
  assert.deepEqual(await visibleIds(page), initial, "filtering must preserve the canonical study group");
  await (await reveal(page, '[data-setting="showPinyin"]')).uncheck();
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.locator(".word .pinyin").first().isVisible(), false, "explicit pronunciation preference must survive reload");
  await page.locator('.levels [data-level="1"]').click();
  assert.equal(await page.locator(".word .pinyin").first().isVisible(), false, "beginner defaults must not override an explicit preference");
}

async function dailyCount(page, count, goal) {
  assert.match(await page.locator(".daily-progress").innerText(), new RegExp("(^|\\D)" + count + "\\s*/\\s*" + goal + "(?=\\D|$)"));
}

async function dailyCase(page) {
  await (await reveal(page, "[data-daily-goal]")).selectOption("10");
  await dailyCount(page, 0, 10);
  const initial = await visibleIds(page);
  const first = page.locator('.word[data-entry-id="' + initial[0] + '"] [data-mark-learned]');
  await first.click();
  await dailyCount(page, 1, 10);
  await first.click();
  await dailyCount(page, 0, 10);
  await first.click();
  await dailyCount(page, 1, 10);
  await page.locator('.word[data-entry-id="' + initial[1] + '"] [data-mark-learned]').click();
  await (await reveal(page, "[data-daily-goal]")).selectOption("20");
  await dailyCount(page, 2, 20);
  await page.reload({ waitUntil: "load" });
  await dailyCount(page, 2, 20);
  await page.clock.setFixedTime(new Date(tomorrow));
  await page.reload({ waitUntil: "load" });
  await dailyCount(page, 0, 20);
  await first.click();
  await first.click();
  await dailyCount(page, 0, 20);
  await page.locator('.word[data-entry-id="' + initial[2] + '"] [data-mark-learned]').click();
  await dailyCount(page, 1, 20);
}

async function exportPayload(page, filename) {
  const control = await reveal(page, "[data-export-progress]");
  const pending = page.waitForEvent("download");
  await control.click();
  const download = await pending;
  const destination = path.join(outDir, filename);
  await download.saveAs(destination);
  const payload = JSON.parse(fs.readFileSync(destination, "utf8"));
  assert.equal(payload.format, "hsk-study-backup");
  assert.equal(payload.version, 1);
  return { payload, destination };
}

async function reviewAvailable(page) {
  const button = page.locator("[data-review-start]");
  return await button.isVisible() && await button.isEnabled();
}

async function timedReviewCase(page) {
  await page.locator('[data-section="practice"]').click();
  const wrong = await answer(page, false);
  await page.locator('[data-section="list"]').click();
  assert.equal(await reviewAvailable(page), true);
  await page.locator("[data-review-start]").click();
  assert.equal((await page.evaluate(() => window.HSK_PAGE.question())).entryId, wrong.entryId);
  await answer(page, true);
  await page.locator("[data-next]").click();
  await page.locator("[data-return-list]").click();
  assert.equal(await reviewAvailable(page), false, "a passed word must not be due again on the same day");
  const first = (await exportPayload(page, "review-day-one.json")).payload.progress.reviews[String(wrong.entryId)];
  assert.ok(first, "a passed review record must remain stored");
  assert.equal(first.stage, 1);
  assert.equal(first.due, "2026-10-06");
  await page.reload({ waitUntil: "load" });
  assert.equal(await reviewAvailable(page), false);
  await page.clock.setFixedTime(new Date(tomorrow));
  await page.reload({ waitUntil: "load" });
  assert.equal(await reviewAvailable(page), true, "the word must return when tomorrow's review is due");
  await page.locator("[data-review-start]").click();
  assert.equal((await page.evaluate(() => window.HSK_PAGE.question())).entryId, wrong.entryId);
  await answer(page, true);
  await page.locator("[data-next]").click();
  await page.locator("[data-return-list]").click();
  const second = (await exportPayload(page, "review-day-two.json")).payload.progress.reviews[String(wrong.entryId)];
  assert.equal(second.stage, 2);
  assert.equal(second.due, "2026-10-09");
  assert.equal(await reviewAvailable(page), false);

  const legacyId = await page.evaluate((previous) => window.HSK_PAGE.vocab.find((entry) => entry.level === 1 && entry.id !== previous).id, wrong.entryId);
  await page.addInitScript((id) => {
    if (sessionStorage.getItem("hsk-test-legacy-seeded")) return;
    localStorage.setItem("hsk-study-progress-v1", JSON.stringify({ level: 1, view: "list", lastPracticeView: "gloss", wrongIds: [id], learnedIds: [], sessions: {}, activeKinds: {}, listPositions: {}, randomSeeds: {} }));
    sessionStorage.setItem("hsk-test-legacy-seeded", "yes");
  }, legacyId);
  await page.goto(pageUrl(), { waitUntil: "load" });
  assert.equal(await reviewAvailable(page), true, "legacy wrong-word lists must migrate as due today");
  await page.locator("[data-review-start]").click();
  assert.equal((await page.evaluate(() => window.HSK_PAGE.question())).entryId, legacyId);
  await answer(page, false);
  await page.locator("[data-next]").click();
  await page.locator("[data-return-list]").click();
  await page.reload({ waitUntil: "load" });
  assert.equal(await reviewAvailable(page), true, "a failed review must remain due after reload");
}

async function batchAudioCase(page) {
  const expected = await page.locator(".word").evaluateAll((rows) => rows.map((row) => {
    const entry = window.HSK_PAGE.vocab.find((item) => item.id === Number(row.dataset.entryId));
    return new URL(window.HSK.audioSrc(entry), location.href).href;
  }));
  await (await reveal(page, "[data-audio-repeat]")).selectOption("1");
  await (await reveal(page, "[data-audio-gap]")).selectOption("0");
  const playing = async (source) => page.waitForFunction((src) => {
    const player = document.querySelector("audio[data-player]");
    return (player.currentSrc || player.src) === src && !player.paused && player.readyState >= 2;
  }, source);
  await (await reveal(page, "[data-play-batch]")).click();
  await playing(expected[0]);
  await page.locator("[data-audio-pause]").click();
  assert.equal(await page.locator("audio[data-player]").evaluate((node) => node.paused), true);
  await page.locator("[data-audio-pause]").click();
  await playing(expected[0]);
  await page.locator("[data-audio-next]").click();
  await playing(expected[1]);
  await page.locator("[data-audio-prev]").click();
  await playing(expected[0]);
  await page.locator("[data-stop-audio]").click();
  assert.equal(await page.locator("audio[data-player]").evaluate((node) => node.paused), true);
  await (await reveal(page, "[data-audio-repeat]")).selectOption("2");
  await (await reveal(page, "[data-audio-gap]")).selectOption("1");
  await page.evaluate(() => {
    const player = document.querySelector("audio[data-player]");
    window.__hskTestMediaEvents = [];
    for (const type of ["playing", "ended"]) player.addEventListener(type, () => {
      window.__hskTestMediaEvents.push({ type, src: player.currentSrc || player.src, at: performance.now() });
    });
  });
  await (await reveal(page, "[data-play-batch]")).click();
  await page.waitForFunction(() => window.__hskTestMediaEvents.filter((event) => event.type === "ended").length >= 2);
  const events = await page.evaluate(() => window.__hskTestMediaEvents);
  assert.deepEqual(events.filter((event) => event.type === "ended").slice(0, 2).map((event) => event.src), [expected[0], expected[0]], "repeat twice must replay the same word before advancing");
  const firstEnd = events.findIndex((event) => event.type === "ended");
  const replay = events.slice(firstEnd + 1).find((event) => event.type === "playing");
  assert.ok(replay && replay.at - events[firstEnd].at >= 900, "the configured one-second gap must be respected");
  await playing(expected[1]);
  await page.locator('.levels [data-level="2"]').click();
  assert.equal(await page.locator("audio[data-player]").evaluate((node) => node.paused), true, "navigation must stop the old group's playback");
}

async function pronunciationCase(page) {
  await (await reveal(page, "[data-search-scope]")).selectOption("all");
  await page.locator(".search").fill("长");
  const readings = page.locator('.word[data-hanzi="长"]');
  assert.equal(await readings.count(), 2, "both readings of the same written word must remain searchable");
  const entries = await readings.evaluateAll((rows) => rows.map((row) => {
    const entry = window.HSK_PAGE.vocab.find((item) => item.id === Number(row.dataset.entryId));
    return { id: entry.id, source: new URL(window.HSK.audioSrc(entry), location.href).href };
  }));
  assert.equal(new Set(entries.map((entry) => entry.source)).size, 2, "different readings require different recordings");
  async function plays(source) {
    await page.waitForFunction((expected) => {
      const player = document.querySelector("audio[data-player]");
      return (player.currentSrc || player.src) === expected && !player.paused && player.readyState >= 2;
    }, source);
  }
  for (const entry of entries) {
    const row = page.locator('.word[data-entry-id="' + entry.id + '"]');
    await row.locator(".hanzi").click();
    await plays(entry.source);
    assert.equal(await row.locator(".listen").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator('.word.is-playing[data-hanzi="长"]').count(), 1, "playing one reading must not mark both as active");
  }
  for (const [id, hanzi, context] of [[2892, "过", "去过"], [4727, "得", "说得好"]]) {
    await page.locator(".search").fill(hanzi);
    const row = page.locator('.word[data-entry-id="' + id + '"]');
    assert.match(await row.locator(".audio-note").innerText(), new RegExp(context));
    assert.match(await row.locator(".listen").getAttribute("aria-label"), new RegExp(context));
    const source = await page.evaluate((entryId) => new URL(window.HSK.audioSrc(window.HSK_PAGE.vocab.find((entry) => entry.id === entryId)), location.href).href, id);
    await row.locator(".hanzi").click();
    await plays(source);
    assert.match(await page.locator('[data-role="recording"]').innerText(), new RegExp(context), "the playing indicator must explain contextual audio");
  }
}

function backupState(payload) {
  const progress = structuredClone(payload.progress);
  // An omitted ordinary-session kind and an explicit "normal" have the same meaning.
  for (const key of Object.keys(progress.activeKinds)) if (progress.activeKinds[key] === "normal") delete progress.activeKinds[key];
  return { progress, preferences: payload.preferences };
}

async function backupCase(page, browser) {
  await page.locator('.levels [data-level="2"]').click();
  await (await reveal(page, "[data-word-order]")).selectOption("random");
  await page.locator("[data-batch-next]").click();
  await page.locator("[data-mark-learned]").first().click();
  await (await reveal(page, "[data-daily-goal]")).selectOption("20");
  await (await reveal(page, ".speed-select")).selectOption("0.75");
  await (await reveal(page, '[data-setting="showPinyin"]')).uncheck();
  const batch = await visibleIds(page);
  await page.locator('[data-section="practice"]').click();
  await answer(page, false);
  const practice = await practiceSnapshot(page);
  await page.locator('[data-section="list"]').click();
  await page.locator("[data-review-start]").click();
  await answer(page, true);
  await page.locator("[data-next]").click();
  await page.locator("[data-return-practice]").click();
  assert.deepEqual(await practiceSnapshot(page), practice);
  const exported = await exportPayload(page, "roundtrip-source.json");
  assert.ok(Object.values(exported.payload.progress.reviews).some((record) => record.due === "2026-10-06"), "the backup fixture must include a future review");
  const context = await browser.newContext({ viewport: { width: 1280, height: 844 }, timezoneId: "Asia/Tokyo", reducedMotion: "reduce" });
  const target = await context.newPage();
  const errors = [];
  browserErrors(target, errors);
  await target.clock.setFixedTime(new Date(today));
  try {
    await target.goto(pageUrl(), { waitUntil: "load" });
    await target.locator('[data-section="practice"]').click();
    await answer(target, true);
    const before = backupState((await exportPayload(target, "roundtrip-empty.json")).payload);
    const input = await reveal(target, "[data-import-progress]");
    await input.setInputFiles(exported.destination);
    await target.locator("[data-confirm-import]").waitFor();
    assert.equal(await target.locator("[data-import-preview]").isVisible(), true);
    assert.deepEqual(backupState((await exportPayload(target, "roundtrip-preview.json")).payload), before, "preview must not change existing progress");
    await target.locator("[data-cancel-import]").click();
    assert.deepEqual(backupState((await exportPayload(target, "roundtrip-cancelled.json")).payload), before, "cancel must preserve existing progress");
    await input.setInputFiles(exported.destination);
    await target.locator("[data-confirm-import]").click();
    await target.locator(".practice").waitFor();
    assert.deepEqual(await practiceSnapshot(target), practice, "import must restore the answered practice session");
    await target.reload({ waitUntil: "load" });
    assert.deepEqual(await practiceSnapshot(target), practice);
    assert.deepEqual(backupState((await exportPayload(target, "roundtrip-restored.json")).payload), backupState(exported.payload), "backup must preserve preferences, positions, learned words, and review schedules");
    const aliased = structuredClone(exported.payload);
    for (const field of ["reviews", "learnedDates"]) {
      const key = Object.keys(aliased.progress[field])[0];
      aliased.progress[field]["0" + key] = aliased.progress[field][key];
      delete aliased.progress[field][key];
    }
    await (await reveal(target, "[data-import-progress]")).setInputFiles({ name: "numeric-keys.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(aliased)) });
    await target.locator("[data-confirm-import]").click();
    assert.deepEqual(await practiceSnapshot(target), practice);
    assert.deepEqual(backupState((await exportPayload(target, "roundtrip-normalized-keys.json")).payload), backupState(exported.payload), "numeric record keys must normalize without losing progress");
    await target.locator('[data-section="list"]').click();
    assert.deepEqual(await visibleIds(target), batch);
    const stable = backupState((await exportPayload(target, "roundtrip-before-rejection.json")).payload);
    for (const [name, contents] of [["invalid.json", "{broken"], ["unsupported.json", JSON.stringify({ ...exported.payload, version: 999 })], ["wrong-format.json", JSON.stringify({ ...exported.payload, format: "unrelated" })]]) {
      await (await reveal(target, "[data-import-progress]")).setInputFiles(exported.destination);
      await target.locator("[data-confirm-import]").waitFor();
      await target.locator("[data-cancel-import]").click();
      await target.locator("[data-import-progress]").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(contents) });
      await target.waitForFunction(() => /できません|読み込めません|対応|形式|無効|不正|JSON|失敗/.test(document.querySelector("[data-import-status]").textContent));
      assert.equal(await target.locator("[data-confirm-import]").isVisible(), false);
      assert.deepEqual(backupState((await exportPayload(target, "rejected-" + name)).payload), stable, "invalid import must not partially replace saved data");
    }
    assert.deepEqual(errors, [], "backup target browser errors");
  } finally {
    await context.close();
  }
}

async function mobileCase(page, width) {
  await noOverflow(page);
  await (await reveal(page, "[data-search-scope]")).selectOption("all");
  await page.locator(".search").fill("爱不释手");
  await noOverflow(page);
  assert.ok(await page.locator("[data-study-from]").evaluate((node) => node.getBoundingClientRect().height >= 44), "global-result action needs a 44px touch height");
  await page.locator(".search-clear").click();
  await (await reveal(page, "[data-learned-filter]")).selectOption("new");
  await noOverflow(page);
  await (await reveal(page, "[data-learned-filter]")).selectOption("all");
  await reveal(page, "[data-play-batch]");
  await noOverflow(page);
  const controls = "[data-search-scope], [data-learned-filter], [data-study-from], [data-practice-batch], [data-play-batch], [data-audio-pause], [data-audio-prev], [data-audio-next], [data-audio-repeat], [data-audio-gap], [data-mark-learned]";
  const small = await page.locator(controls).evaluateAll((nodes) => nodes.filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.height < 44;
  }).map((node) => node.outerHTML.slice(0, 160)));
  assert.deepEqual(small, [], "mobile learning controls need 44px touch heights");
  await page.screenshot({ path: path.join(outDir, "learning-mobile-" + width + ".png"), fullPage: true, animations: "disabled" });
  await page.locator("[data-practice-batch]").tap();
  await noOverflow(page);
  await answer(page, false);
  await noOverflow(page);
}

function browserErrors(page, errors) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
}

async function runCase(browser, name, action, width = 1280) {
  if (selectedCases && !selectedCases.has(name)) return;
  const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: "Asia/Tokyo", reducedMotion: "reduce", hasTouch: width < 600, isMobile: width < 600 });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000);
  browserErrors(page, errors);
  await page.clock.setFixedTime(new Date(today));
  try {
    await page.goto(pageUrl(), { waitUntil: "load" });
    await action(page, browser);
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
    await runCase(browser, "lookup", lookupCase);
    await runCase(browser, "batch-practice", batchPracticeCase);
    await runCase(browser, "defaults-filters", defaultsAndFiltersCase);
    await runCase(browser, "timed-review", timedReviewCase);
    await runCase(browser, "daily", dailyCase);
    await runCase(browser, "batch-audio", batchAudioCase);
    await runCase(browser, "backup", backupCase);
    await runCase(browser, "pronunciation", pronunciationCase);
    for (const width of [320, 390]) await runCase(browser, "mobile-" + width, (page) => mobileCase(page, width), width);
    assert.ok(results.length > 0, "at least one selected case must run");
    results.push(results.length + " cases passed; pageErrors=0; consoleErrors=0");
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outDir, "learning.log"), results.join("\n") + "\n");
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
