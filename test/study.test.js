const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/study.js"), "utf8"), context);
const study = context.window.HSK_STUDY;

test("review mastery requires four scheduled passes on separate calendar days", () => {
  const failed = study.reviewWrong(null, "2026-10-05");
  assert.equal(study.isDue(failed, "2026-10-05"), true);
  assert.equal(study.passedToday(failed, "2026-10-05"), false);

  const first = study.reviewCorrect(failed, "2026-10-05");
  assert.equal(first.stage, 1);
  assert.equal(first.due, "2026-10-06");
  assert.equal(study.isMastered(first), false);
  assert.equal(study.isDue(first, "2026-10-05"), false);
  assert.equal(study.passedToday(first, "2026-10-05"), true);
  assert.deepEqual(study.reviewCorrect(first, "2026-10-05"), first);

  const second = study.reviewCorrect(first, "2026-10-06");
  assert.equal(second.stage, 2);
  assert.equal(second.due, "2026-10-09");
  assert.deepEqual(study.reviewCorrect(second, "2026-10-07"), second);
  assert.equal(study.isDue(second, "2026-10-08"), false);
  assert.equal(study.isDue(second, "2026-10-09"), true);

  const third = study.reviewCorrect(second, "2026-10-09");
  assert.equal(third.stage, 3);
  assert.equal(third.due, "2026-10-16");
  const mastered = study.reviewCorrect(third, "2026-10-16");
  assert.equal(mastered.stage, 4);
  assert.equal(mastered.due, null);
  assert.equal(study.isMastered(mastered), true);
  assert.equal(study.isDue(mastered, "2027-01-01"), false);
  assert.deepEqual(study.reviewCorrect(mastered, "2027-01-01"), mastered);
  assert.equal(failed.stage, 0, "transitions never mutate the saved previous record");
});

test("late passes schedule from today, while new mistakes reset the learning cycle", () => {
  const first = study.reviewCorrect(study.reviewWrong(null, "2026-10-05"), "2026-10-05");
  assert.equal(study.isDue(first, "2026-10-20"), true);
  const late = study.reviewCorrect(first, "2026-10-20");
  assert.equal(late.due, "2026-10-23");
  const failedAgain = study.reviewWrong(late, "2026-10-20");
  assert.equal(failedAgain.stage, 0);
  assert.equal(failedAgain.due, "2026-10-20");
  assert.equal(failedAgain.lastPassed, null);
  assert.equal(failedAgain.lastWrong, "2026-10-20");
  assert.equal(study.passedToday(failedAgain, "2026-10-20"), false);
  assert.equal(study.reviewCorrect(failedAgain, "2026-10-20").stage, 1);
  assert.equal(late.stage, 2);
});

test("calendar dates reject malformed and impossible values without making broken records mastered", () => {
  for (const day of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-05", "2026-00-01", "0000-01-01", null, 20261005]) {
    assert.equal(study.isCalendarDay(day), false, String(day));
    assert.throws(() => study.addDays(day, 1), /invalid calendar/);
  }
  assert.equal(study.isCalendarDay("2024-02-29"), true);
  assert.equal(study.addDays("2024-02-28"), "2024-02-29");
  assert.equal(study.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(study.addDays("2026-01-01", -1), "2025-12-31");
  assert.throws(() => study.addDays("2026-10-05", 1.5), /invalid calendar/);
  assert.throws(() => study.reviewCorrect(null, "bad-date"), /invalid calendar/);
  assert.throws(() => study.localCalendarDay("bad-date"), /invalid local date/);

  for (const broken of [null, [], { stage: 9 }, { stage: "4", due: null }, { stage: 4, due: null, lastPassed: "2026-02-30" }, { stage: 2, due: "2026-10-01", lastPassed: "2026-10-05" }]) {
    const recovered = study.sanitizeReview(broken, "2026-10-05");
    assert.equal(recovered.stage, 0);
    assert.equal(recovered.due, "2026-10-05");
    assert.equal(study.isMastered(broken), false);
  }
  assert.equal(study.isDue(null, "2026-10-05"), false);
});

test("local day and review intervals stay correct across DST and UTC midnight", () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.equal(study.localCalendarDay("2026-03-09T03:30:00Z"), "2026-03-08");
    assert.equal(study.localCalendarDay("2026-03-09T04:30:00Z"), "2026-03-09");
    assert.equal(study.localCalendarDay("2026-11-01T05:30:00Z"), "2026-11-01");
    assert.equal(study.localCalendarDay("2026-11-01T06:30:00Z"), "2026-11-01");
    const spring = study.reviewCorrect(null, "2026-03-08");
    const autumn = study.reviewCorrect(null, "2026-11-01");
    assert.equal(spring.due, "2026-03-09");
    assert.equal(autumn.due, "2026-11-02");
    process.env.TZ = "Asia/Tokyo";
    assert.equal(study.todayKey("2026-10-05T15:05:00Z"), "2026-10-06");
    assert.equal(study.nextDay("2026-10-05"), "2026-10-06");
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("daily new-word counts exclude historical and invalid dates", () => {
  const learnedDates = { 1: "2026-10-04", 2: "2026-10-05", 3: "2026-10-05", 4: null, 5: "2026-10-06", 6: "2026-10-05T00:00:00Z" };
  assert.equal(study.countLearnedToday(learnedDates, "2026-10-05"), 2);
  assert.equal(study.countLearnedToday(learnedDates, "2026-10-06"), 1);
  assert.equal(study.countLearnedToday(null, "2026-10-05"), 0);
  assert.equal(study.countLearnedToday([], "2026-10-05"), 0);
  assert.equal(learnedDates[1], "2026-10-04");
});
