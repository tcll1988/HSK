/* Calendar-based learning helpers. No storage or DOM access. */
(function () {
  "use strict";

  function dateFromDay(day) {
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    var year = Number(day.slice(0, 4));
    var month = Number(day.slice(5, 7));
    var date = Number(day.slice(8, 10));
    if (year < 1 || month < 1 || month > 12 || date < 1 || date > 31) return null;
    // UTC here is only calendar arithmetic: no local 23/25-hour DST days.
    var value = new Date(0);
    value.setUTCFullYear(year, month - 1, date);
    value.setUTCHours(0, 0, 0, 0);
    return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === date ? value : null;
  }

  function isCalendarDay(day) { return dateFromDay(day) !== null; }

  function padded(value, width) { return String(value).padStart(width, "0"); }

  function localCalendarDay(now) {
    var date = now === undefined ? new Date() : new Date(now);
    if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1 || date.getFullYear() > 9999) throw new RangeError("invalid local date");
    return padded(date.getFullYear(), 4) + "-" + padded(date.getMonth() + 1, 2) + "-" + padded(date.getDate(), 2);
  }

  function currentDay(day) {
    var value = day === undefined ? localCalendarDay() : day;
    if (!isCalendarDay(value)) throw new RangeError("invalid calendar day");
    return value;
  }

  function addDays(day, offset) {
    var value = dateFromDay(day);
    var count = offset === undefined ? 1 : offset;
    if (!value || !Number.isSafeInteger(count)) throw new RangeError("invalid calendar offset");
    value.setUTCDate(value.getUTCDate() + count);
    if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) throw new RangeError("calendar date out of range");
    return padded(value.getUTCFullYear(), 4) + "-" + padded(value.getUTCMonth() + 1, 2) + "-" + padded(value.getUTCDate(), 2);
  }

  function freshReview(today, lastWrong) {
    return { stage: 0, due: today, lastPassed: null, lastWrong: lastWrong || null };
  }

  function sanitizeReview(value, day) {
    var today = currentDay(day);
    if (!value || typeof value !== "object" || Array.isArray(value)) return freshReview(today);
    var lastWrong = isCalendarDay(value.lastWrong) ? value.lastWrong : null;
    if (!Number.isInteger(value.stage) || value.stage < 0 || value.stage > 4) return freshReview(today, lastWrong);
    if (value.stage === 0) {
      return { stage: 0, due: isCalendarDay(value.due) ? value.due : today, lastPassed: null, lastWrong: lastWrong };
    }
    if (!isCalendarDay(value.lastPassed)) return freshReview(today, lastWrong);
    if (value.stage === 4) {
      if (value.due !== null) return freshReview(today, lastWrong);
      return { stage: 4, due: null, lastPassed: value.lastPassed, lastWrong: lastWrong };
    }
    if (!isCalendarDay(value.due) || value.due <= value.lastPassed) return freshReview(today, lastWrong);
    return { stage: value.stage, due: value.due, lastPassed: value.lastPassed, lastWrong: lastWrong };
  }

  function reviewWrong(previous, day) {
    var today = currentDay(day);
    return freshReview(today, today);
  }

  function reviewCorrect(previous, day) {
    var today = currentDay(day);
    var record = sanitizeReview(previous, today);
    // Extra practice is allowed, but cannot shorten the scheduled interval.
    if (record.stage === 4 || (record.lastPassed && record.lastPassed >= today) || record.due > today) return record;
    var stage = record.stage + 1;
    return {
      stage: stage,
      due: stage === 4 ? null : addDays(today, [0, 1, 3, 7][stage]),
      lastPassed: today,
      lastWrong: record.lastWrong
    };
  }

  function isDue(value, day) {
    var today = currentDay(day);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    var record = sanitizeReview(value, today);
    return record.stage < 4 && record.due <= today;
  }

  function isMastered(value) {
    return !!value && sanitizeReview(value).stage === 4;
  }

  function passedToday(value, day) {
    var today = currentDay(day);
    var record = sanitizeReview(value, today);
    return record.stage > 0 && record.lastPassed === today;
  }

  function countLearnedToday(learnedDates, day) {
    var today = currentDay(day);
    if (!learnedDates || typeof learnedDates !== "object" || Array.isArray(learnedDates)) return 0;
    return Object.keys(learnedDates).filter(function (id) { return learnedDates[id] === today; }).length;
  }

  window.HSK_STUDY = {
    localCalendarDay: localCalendarDay,
    todayKey: localCalendarDay,
    isCalendarDay: isCalendarDay,
    addDays: addDays,
    nextDay: addDays,
    sanitizeReview: sanitizeReview,
    reviewWrong: reviewWrong,
    reviewCorrect: reviewCorrect,
    isDue: isDue,
    isMastered: isMastered,
    passedToday: passedToday,
    countLearnedToday: countLearnedToday
  };
})();
