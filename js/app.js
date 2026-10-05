/* Student page. Uses window.HSK and window.HSK_VOCAB. Plays audio files through HSK.audioSrc. */
(function () {
  "use strict";

  var vocab = window.HSK.prepareVocab(window.HSK_VOCAB);
  var entriesById = new Map(vocab.map(function (entry) { return [entry.id, entry]; }));
  var progress = loadProgress();
  var offerResume = !!progress.updatedAt;
  var batchSize = 20;
  var params = new URLSearchParams(window.location.search);
  var seedText = params.get("seed");
  var fixedSeed = seedText === null || seedText === "" ? null : Number(seedText);
  var level = Number(params.get("level") || progress.level || "1");
  if (!Number.isInteger(level) || level < 1 || level > 6) level = 1;
  var view = params.get("view") || (params.has("level") ? "list" : progress.view) || "list";
  if (view !== "list" && !validMode(view)) view = "list";
  var lastPracticeView = view === "list" ? progress.lastPracticeView || "gloss" : view;
  var preferences = loadPreferences();
  var settingsOpen = false;
  var importNotice = "";
  var searchQueries = {};
  var searchScopes = {};
  var listFilters = {};
  var filteredPages = {};
  var searchBookmarks = {};
  var listToolsOpen = false;
  var audioQueueOpen = false;
  var batchContext = null;
  var randomWordOrders = {};
  var pinyinWordOrders = {};
  var pinyinCollator = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true });
  var searchIndex = new Map(vocab.map(function (entry) {
    return [entry.id, normalizeSearch(entry.hanzi + " " + entry.pinyin + " " + entry.gloss)];
  }));

  var round = [];
  var questionIndex = 0;
  var answered = false;
  var correctCount = 0;
  var sessionSeed = fixedSeed;
  var roundComplete = false;
  var mistakes = [];
  var answers = [];
  var practiceKind = "normal";
  var reviewIds = null;
  var activeSessionKey = "";

  var app = document.getElementById("app");
  var player = document.createElement("audio");
  player.setAttribute("data-player", "");
  player.preload = "none";
  player.playbackRate = preferences.speed;
  document.body.appendChild(player);
  var nowPlaying = "";
  var audioError = "";
  var playback = window.HSK_AUDIO.create({
    player: player,
    resolveSrc: function (entry) { return window.HSK.audioSrc(entry); },
    onChange: function (state) {
      nowPlaying = state.entry ? state.entry.hanzi + (state.entry.audioText ? "（例：" + state.entry.audioText + "）" : "") : "";
      markButtons();
      refreshRecording();
      refreshQueue();
    },
    onError: function (message) { audioError = message; refreshRecording(); refreshQueue(); }
  });

  function normalizeSearch(value) {
    return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f\s]/g, "");
  }

  function loadPreferences(source) {
    var saved = source || {};
    if (!source) try { saved = JSON.parse(localStorage.getItem("hsk-study-preferences-v1")) || {}; } catch (error) {}
    var pinyinChosen = typeof saved.showPinyin === "boolean" && saved.pinyinChosen !== false;
    var speed = typeof saved.speed === "number" ? saved.speed : 1;
    return {
      speed: [0.5, 0.75, 1, 1.25, 1.5].indexOf(speed) !== -1 ? speed : 1,
      showPinyin: pinyinChosen ? saved.showPinyin === true : level <= 2,
      pinyinChosen: pinyinChosen,
      dailyGoal: saved.dailyGoal === 10 ? 10 : 20,
      repeat: saved.repeat === 2 ? 2 : 1,
      gap: [0, 1, 2, 3].indexOf(saved.gap) !== -1 ? saved.gap : 2,
      showJapanese: saved.showJapanese !== false,
      wordOrder: saved.wordOrder === "random" ? "random" : "pinyin"
    };
  }

  function savePreferences() {
    try { localStorage.setItem("hsk-study-preferences-v1", JSON.stringify(preferences)); } catch (error) {}
  }

  function validMode(mode) { return typeof mode === "string" && Object.prototype.hasOwnProperty.call(window.HSK.MODES, mode); }

  function loadProgress(source) {
    var saved = source;
    if (!source) try { saved = JSON.parse(localStorage.getItem("hsk-study-progress-v1")); } catch (error) {}
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
    function ids(value) {
      return Array.isArray(value) ? Array.from(new Set(value.filter(function (id) { return entriesById.has(id); }))) : [];
    }
    function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
    var state = {
      level: Number.isInteger(saved.level) && saved.level >= 1 && saved.level <= 6 ? saved.level : 1,
      view: saved.view === "list" || validMode(saved.view) ? saved.view : "list",
      lastPracticeView: validMode(saved.lastPracticeView) ? saved.lastPracticeView : "gloss",
      wrongIds: ids(saved.wrongIds), learnedIds: ids(saved.learnedIds),
      reviews: {}, learnedDates: {}, tipSeen: saved.tipSeen === true,
      sessions: {}, activeKinds: {}, listPositions: {}, randomSeeds: {},
      updatedAt: Number.isFinite(saved.updatedAt) ? saved.updatedAt : 0
    };
    var today = window.HSK_STUDY.todayKey();
    Object.keys(object(saved.reviews)).forEach(function (key) {
      if (entriesById.has(Number(key))) state.reviews[String(Number(key))] = window.HSK_STUDY.sanitizeReview(saved.reviews[key], today);
    });
    state.wrongIds.forEach(function (id) {
      if (!state.reviews[id]) state.reviews[id] = window.HSK_STUDY.reviewWrong(null, today);
    });
    state.wrongIds = Object.keys(state.reviews).map(Number).filter(function (id) { return !window.HSK_STUDY.isMastered(state.reviews[id]); });
    Object.keys(object(saved.learnedDates)).forEach(function (key) {
      if (entriesById.has(Number(key)) && window.HSK_STUDY.isCalendarDay(saved.learnedDates[key])) state.learnedDates[String(Number(key))] = saved.learnedDates[key];
    });
    Object.keys(object(saved.sessions)).forEach(function (key) {
      if (/^[1-6]:(gloss|hanzi|pinyin):(normal|review|batch)$/.test(key)) state.sessions[key] = saved.sessions[key];
    });
    Object.keys(object(saved.activeKinds)).forEach(function (key) {
      if (/^[1-6]:(gloss|hanzi|pinyin)$/.test(key) && ["review", "batch"].indexOf(saved.activeKinds[key]) !== -1) state.activeKinds[key] = saved.activeKinds[key];
    });
    for (var n = 1; n <= 6; n += 1) {
      var position = object(object(saved.listPositions)[n]);
      var entry = entriesById.get(position.entryId);
      state.listPositions[n] = {
        batch: Number.isInteger(position.batch) && position.batch >= 0 ? Math.min(position.batch, Math.ceil(window.HSK.wordsForLevel(vocab, n).length / 20) - 1) : 0,
        entryId: entry && entry.level === n ? entry.id : null
      };
      var seed = object(saved.randomSeeds)[n];
      if (Number.isInteger(seed) && seed > 0 && seed <= 0x7fffffff) state.randomSeeds[n] = seed;
    }
    return state;
  }

  function saveProgress() {
    progress.level = level;
    progress.view = view;
    progress.lastPracticeView = lastPracticeView;
    progress.updatedAt = Date.now();
    if (activeSessionKey && round.length) {
      progress.sessions[activeSessionKey] = {
        seed: sessionSeed, reviewIds: reviewIds, answers: answers.slice(),
        questionIndex: questionIndex, complete: roundComplete, batchContext: batchContext
      };
    }
    try { localStorage.setItem("hsk-study-progress-v1", JSON.stringify(progress)); } catch (error) {}
  }

  function setNavigation() {
    // Keep explicit shared links useful while allowing reload to keep the current screen.
    var url = new URL(window.location.href);
    if (url.searchParams.has("level")) url.searchParams.set("level", String(level));
    if (url.searchParams.has("level") || url.searchParams.has("view")) url.searchParams.set("view", view);
    try { window.history.replaceState(null, "", url); } catch (error) {}
  }

  function activateRound() {
    var base = level + ":" + view;
    practiceKind = ["review", "batch"].indexOf(progress.activeKinds[base]) !== -1 ? progress.activeKinds[base] : "normal";
    activeSessionKey = base + ":" + practiceKind;
    var saved = progress.sessions[activeSessionKey];
    try {
      if (!saved || !Number.isInteger(saved.seed) || !Array.isArray(saved.answers)) throw new Error("invalid session");
      sessionSeed = saved.seed;
      reviewIds = practiceKind !== "normal" ? saved.reviewIds : null;
      batchContext = practiceKind === "batch" && saved.batchContext && typeof saved.batchContext === "object" ? saved.batchContext : null;
      if (batchContext) {
        var nextEntry = entriesById.get(batchContext.nextId);
        batchContext = { firstId: batchContext.firstId, nextId: nextEntry && nextEntry.level === level ? nextEntry.id : null, filter: ["new", "learned"].indexOf(batchContext.filter) !== -1 ? batchContext.filter : "all" };
      }
      if (practiceKind !== "normal" && (!Array.isArray(reviewIds) || !reviewIds.length || reviewIds.length > (practiceKind === "batch" ? 20 : 10) || new Set(reviewIds).size !== reviewIds.length || !reviewIds.every(function (id) { var entry = entriesById.get(id); return entry && entry.level === level; }))) throw new Error("invalid review");
      round = window.HSK.buildRound(vocab, level, view, sessionSeed, reviewIds ? reviewIds.length : 10, reviewIds);
      questionIndex = saved.questionIndex;
      if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= round.length || (saved.answers.length !== questionIndex && saved.answers.length !== questionIndex + 1) || !saved.answers.every(function (answer) { return Number.isInteger(answer) && answer >= 0 && answer < 4; }) || (saved.complete && saved.answers.length !== round.length)) throw new Error("invalid answers");
      answers = saved.answers.slice();
      answered = answers.length > questionIndex;
      roundComplete = saved.complete === true;
      correctCount = 0;
      mistakes = [];
      answers.forEach(function (answer, index) {
        if (window.HSK.scoreChoice(round[index], answer)) correctCount += 1;
        else mistakes.push(round[index]);
      });
    } catch (error) {
      practiceKind = "normal";
      progress.activeKinds[base] = "normal";
      sessionSeed = fixedSeed;
      startRound();
    }
  }

  function rememberedPosition() { return progress.listPositions[level]; }

  function dismissResume() {
    offerResume = false;
    var card = app.querySelector(".resume-card");
    if (card) card.remove();
  }

  function rememberEntry(entry) {
    suppressScrollSave = true;
    dismissResume();
    clearTimeout(scrollTimer);
    scrollTimer = null;
    var position = rememberedPosition();
    position.entryId = entry.id;
    position.batch = Math.floor(orderedWords(false).findIndex(function (word) { return word.id === entry.id; }) / batchSize);
    saveProgress();
  }

  function wrongWords(onlyDue) {
    return progress.wrongIds.filter(function (id) {
      return entriesById.get(id).level === level && (onlyDue === false || window.HSK_STUDY.isDue(progress.reviews[id]));
    });
  }

  function beginReview(ids) {
    var targets = Array.from(new Set(ids)).slice(0, 10);
    if (!targets.length) return;
    saveProgress();
    if (view === "list") view = lastPracticeView;
    sessionSeed = fixedSeed;
    startRound(targets, "review");
    offerResume = false;
    render();
    focusContent();
  }

  function beginBatch(entries, context) {
    if (!entries.length) return;
    saveProgress();
    view = lastPracticeView;
    var ids = entries.map(function (entry) { return entry.id; });
    var saved = progress.sessions[level + ":" + view + ":batch"];
    if (saved && !saved.complete && Array.isArray(saved.reviewIds) && saved.reviewIds.length === ids.length && saved.reviewIds.every(function (id, index) { return id === ids[index]; })) {
      progress.activeKinds[level + ":" + view] = "batch";
      activateRound();
      if (practiceKind !== "batch") { sessionSeed = fixedSeed; startRound(ids, "batch", context); }
      else batchContext = context;
    } else {
      sessionSeed = fixedSeed;
      startRound(ids, "batch", context);
    }
    offerResume = false;
    render();
    focusContent();
  }

  function renderResume() {
    var box = el("div", "resume-card");
    var position = rememberedPosition();
    var entry = entriesById.get(position.entryId);
    box.appendChild(el("p", null, "HSK " + level + " · " + (view === "list" ? (entry ? entry.hanzi + " から" : "前回の単語から") : "前回の練習から")));
    var button = el("button", "secondary-button", "続きから学ぶ");
    button.type = "button";
    button.setAttribute("data-resume", "");
    button.addEventListener("click", function () {
      offerResume = false;
      entry = entriesById.get(rememberedPosition().entryId);
      if (view === "list") { searchQueries[level] = ""; listFilters[level] = "all"; }
      render();
      focusContent();
      var row = entry && app.querySelector('.word[data-entry-id="' + entry.id + '"]');
      if (row) {
        row.tabIndex = -1;
        row.focus({ preventScroll: true });
        var toolbar = app.querySelector(".list-toolbar");
        var offset = toolbar && getComputedStyle(toolbar).position === "sticky" ? toolbar.getBoundingClientRect().height : 12;
        window.scrollBy({ top: row.getBoundingClientRect().top - offset - 8, behavior: "instant" });
      }
    });
    box.appendChild(button);
    return box;
  }

  function renderReviewControls() {
    var box = el("div", "review-controls");
    var ids = wrongWords();
    var scheduled = wrongWords(false);
    var passed = Object.keys(progress.reviews).filter(function (id) { return entriesById.get(Number(id)).level === level && window.HSK_STUDY.passedToday(progress.reviews[id]); }).length;
    box.hidden = !scheduled.length && !passed;
    var button = el("button", "secondary-button", "今日の復習 · " + ids.length + " 語");
    button.type = "button";
    button.hidden = !ids.length;
    button.setAttribute("data-review-start", "");
    button.addEventListener("click", function () { beginReview(wrongWords()); });
    box.appendChild(button);
    var future = scheduled.map(function (id) { return progress.reviews[id].due; }).filter(function (day) { return day > window.HSK_STUDY.todayKey(); }).sort();
    box.appendChild(el("p", "review-summary", "HSK " + level + " · 今日通過 " + passed + " 語" + (future.length ? " · 次回 " + future[0].slice(5).replace("-", "/") : "")));
    return box;
  }

  function todayLearned() {
    var today = window.HSK_STUDY.todayKey();
    return progress.learnedIds.filter(function (id) { return progress.learnedDates[id] === today; }).length;
  }

  function renderDaily() {
    var box = el("div", "daily-card");
    var copy = el("div", "daily-copy");
    var count = todayLearned();
    var due = Object.keys(progress.reviews).filter(function (id) { return window.HSK_STUDY.isDue(progress.reviews[id]); }).length;
    copy.appendChild(el("strong", "daily-progress", "今日の新しい単語 " + count + " / " + preferences.dailyGoal));
    copy.appendChild(el("span", null, count >= preferences.dailyGoal ? "今日の目標達成！ · 復習 " + due + " 語" : "全級の合計 · 今日の復習 " + due + " 語"));
    box.appendChild(copy);
    var label = el("label", "daily-goal");
    label.appendChild(el("span", null, "目標"));
    var select = el("select");
    select.setAttribute("data-daily-goal", "");
    [10, 20].forEach(function (number) { var option = el("option", null, number + " 語"); option.value = String(number); select.appendChild(option); });
    select.value = String(preferences.dailyGoal);
    select.addEventListener("change", function () { preferences.dailyGoal = Number(select.value); savePreferences(); refreshDaily(); });
    label.appendChild(select);
    box.appendChild(label);
    if (due) {
      var review = el("button", "secondary-button", "今日の復習を始める");
      review.type = "button";
      review.setAttribute("data-review-daily", "");
      review.addEventListener("click", function () {
        saveProgress();
        var first = Object.keys(progress.reviews).map(Number).find(function (id) { return window.HSK_STUDY.isDue(progress.reviews[id]); });
        level = entriesById.get(first).level;
        if (!preferences.pinyinChosen) preferences.showPinyin = level <= 2;
        beginReview(wrongWords());
      });
      box.appendChild(review);
    }
    return box;
  }

  function refreshDaily() {
    var box = app.querySelector(".daily-card");
    if (box) box.replaceWith(renderDaily());
  }

  function settingsStatus() {
    return preferences.speed.toFixed(2).replace(/0$/, "").replace(/\.$/, "") + "× · " +
      (preferences.showPinyin ? "ピンイン表示" : "ピンイン非表示") + " · " +
      (preferences.showJapanese ? "日本語表示" : "日本語非表示");
  }

  function applyPreferences() {
    app.classList.toggle("hide-pinyin", !preferences.showPinyin);
    app.classList.toggle("hide-japanese", !preferences.showJapanese);
    var status = app.querySelector("[data-settings-status]");
    if (status) status.textContent = settingsStatus();
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function words() {
    return window.HSK.wordsForLevel(vocab, level);
  }

  function orderedWords(reshuffle) {
    if (!pinyinWordOrders[level]) {
      pinyinWordOrders[level] = words().sort(function (a, b) {
        return pinyinCollator.compare(a.pinyin, b.pinyin) || a.id - b.id;
      });
    }
    if (preferences.wordOrder === "pinyin") return pinyinWordOrders[level];
    if (reshuffle || !randomWordOrders[level]) {
      var previous = randomWordOrders[level] || pinyinWordOrders[level];
      var shuffled = pinyinWordOrders[level].slice();
      if (reshuffle || !progress.randomSeeds[level]) progress.randomSeeds[level] = Math.floor(Math.random() * 0x7fffffff) + 1;
      var random = window.HSK.seededRandom(progress.randomSeeds[level]);
      for (var i = shuffled.length - 1; i > 0; i -= 1) {
        var j = Math.floor(random() * (i + 1));
        var entry = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = entry;
      }
      if (reshuffle && shuffled.length > 1 && shuffled.every(function (entry, index) { return entry.id === previous[index].id; })) {
        progress.randomSeeds[level] = progress.randomSeeds[level] % 0x7fffffff + 1;
        delete randomWordOrders[level];
        return orderedWords(false);
      }
      randomWordOrders[level] = shuffled;
    }
    return randomWordOrders[level];
  }

  function ensureSeed() {
    if (sessionSeed === null || Number.isNaN(sessionSeed)) {
      sessionSeed = Math.floor(Math.random() * 0x7fffffff) + 1;
    }
    return sessionSeed;
  }

  function startRound(targets, kind, context) {
    reviewIds = targets || null;
    practiceKind = kind || (reviewIds ? "review" : "normal");
    batchContext = kind === "batch" ? context : null;
    activeSessionKey = level + ":" + view + ":" + practiceKind;
    progress.activeKinds[level + ":" + view] = practiceKind;
    round = window.HSK.buildRound(vocab, level, view, ensureSeed(), reviewIds ? reviewIds.length : 10, reviewIds);
    questionIndex = 0;
    answered = false;
    correctCount = 0;
    roundComplete = false;
    mistakes = [];
    answers = [];
  }

  function currentQuestion() {
    return round[questionIndex] || null;
  }

  function stopAudio() {
    audioError = "";
    if (playback) playback.stop();
    nowPlaying = "";
  }

  function markButtons() {
    var state = playback ? playback.state() : null;
    var id = state && state.entry ? String(state.entry.id) : "";
    Array.prototype.forEach.call(app.querySelectorAll("[data-audio]"), function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-audio-id") === id ? "true" : "false");
    });
    Array.prototype.forEach.call(app.querySelectorAll("[data-audio-row]"), function (row) {
      row.classList.toggle("is-playing", row.getAttribute("data-audio-id") === id);
    });
  }

  function refreshRecording() {
    var current = app.querySelector("[data-role='recording']");
    if (current) current.replaceWith(renderRecording());
  }

  function playEntry(entry) {
    audioError = "";
    playback.setSpeed(preferences.speed);
    playback.play(entry);
  }

  function refreshQueue() {
    if (!playback) return;
    var state = playback.state();
    var status = app.querySelector(".queue-status");
    if (status) status.textContent = audioError || (state.batch ? (state.index + 1) + " / " + state.total + " · " + state.entry.hanzi + " · " + (state.paused ? "一時停止" : state.playing ? "再生中" : "発音してみましょう") : "1語ずつ聞いて、声に出してみましょう。");
    [["pause", !state.batch], ["prev", !state.batch || state.index === 0], ["next", !state.batch]].forEach(function (item) {
      var button = app.querySelector('[data-audio-' + item[0] + ']');
      if (button) button.disabled = item[1];
    });
    var pause = app.querySelector("[data-audio-pause]");
    if (pause) pause.textContent = state.paused ? "続ける" : "一時停止";
  }

  function renderAudioQueue(getEntries) {
    var box = el("details", "audio-queue");
    box.open = audioQueueOpen;
    box.addEventListener("toggle", function () { audioQueueOpen = box.open; });
    box.appendChild(el("summary", null, "まとめて聞く"));
    var settings = el("div", "queue-settings");
    [["repeat", "繰り返し", [1, 2]], ["gap", "発音する間隔", [0, 1, 2, 3]]].forEach(function (item) {
      var label = el("label");
      label.appendChild(el("span", null, item[1]));
      var select = el("select");
      select.setAttribute("data-audio-" + item[0], "");
      item[2].forEach(function (value) { var option = el("option", null, value + (item[0] === "repeat" ? " 回" : " 秒")); option.value = String(value); select.appendChild(option); });
      select.value = String(preferences[item[0]]);
      select.addEventListener("change", function () { preferences[item[0]] = Number(select.value); savePreferences(); stopAudio(); });
      label.appendChild(select);
      settings.appendChild(label);
    });
    box.appendChild(settings);
    var controls = el("div", "queue-controls");
    [["play-batch", "このグループを聞く", function () { audioError = ""; playback.start(getEntries(), { repeat: preferences.repeat, gap: preferences.gap, speed: preferences.speed }); }],
      ["audio-prev", "前の単語", function () { playback.previous(); }],
      ["audio-pause", "一時停止", function () { if (playback.state().paused) playback.resume(); else playback.pause(); }],
      ["audio-next", "次の単語", function () { playback.next(); }]].forEach(function (item) {
      var button = el("button", "secondary-button", item[1]);
      button.type = "button";
      button.setAttribute("data-" + item[0], "");
      button.disabled = item[0] !== "play-batch";
      button.addEventListener("click", item[2]);
      controls.appendChild(button);
    });
    box.appendChild(controls);
    var status = el("p", "queue-status", "1語ずつ聞いて、声に出してみましょう。");
    status.setAttribute("role", "status");
    box.appendChild(status);
    return box;
  }

  function listenButton(entry) {
    var hanzi = entry.hanzi;
    var button = el("button", "listen");
    button.type = "button";
    button.setAttribute("data-audio", hanzi);
    button.setAttribute("data-audio-id", String(entry.id));
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", hanzi + (entry.audioText ? " の例「" + entry.audioText + "」を聞く" : " を聞く"));
    var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    var speaker = document.createElementNS("http://www.w3.org/2000/svg", "path");
    speaker.setAttribute("d", "M4 9h3l5-4v14l-5-4H4V9Z");
    speaker.setAttribute("fill", "currentColor");
    icon.appendChild(speaker);
    var waves = document.createElementNS("http://www.w3.org/2000/svg", "path");
    waves.setAttribute("d", "M16 8a6 6 0 0 1 0 8m2.5-11a10 10 0 0 1 0 14");
    waves.setAttribute("fill", "none");
    waves.setAttribute("stroke", "currentColor");
    waves.setAttribute("stroke-width", "1.8");
    waves.setAttribute("stroke-linecap", "round");
    icon.appendChild(waves);
    button.appendChild(icon);
    button.appendChild(el("span", "sr-only", "聞く"));
    button.addEventListener("click", function () {
      playEntry(entry);
    });
    return button;
  }

  function makeAudioTarget(row, entry) {
    row.classList.add("audio-target");
    row.setAttribute("data-audio-row", entry.hanzi);
    row.setAttribute("data-audio-id", String(entry.id));
    row.addEventListener("click", function (event) {
      // The existing native button handles keyboard access and its own clicks.
      if (event.target.closest("button, a, input, select, textarea, details")) return;
      var selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.containsNode(row, true)) return;
      playEntry(entry);
    });
  }

  function render() {
    stopAudio();
    app.textContent = "";
    app.appendChild(renderMasthead());
    var layout = el("div", "study-layout");
    var sidebar = el("aside", "study-sidebar");
    sidebar.setAttribute("aria-label", "学習メニュー");
    sidebar.appendChild(el("p", "sidebar-title", "学ぶ級"));
    sidebar.appendChild(renderLevels());
    sidebar.appendChild(renderSections());
    sidebar.appendChild(renderSettings());
    sidebar.appendChild(renderDaily());
    if (offerResume) sidebar.appendChild(renderResume());
    sidebar.appendChild(renderReviewControls());
    layout.appendChild(sidebar);
    var content = el("div", "study-content");
    content.appendChild(renderRecording());
    if (view !== "list") content.appendChild(renderViews());
    content.appendChild(view === "list" ? renderList() : renderPractice());
    layout.appendChild(content);
    app.appendChild(layout);
    applyPreferences();
    setNavigation();
    saveProgress();
    window.HSK_PAGE = {
      level: level,
      view: view,
      question: currentQuestion,
      vocab: vocab
    };
  }

  function renderMasthead() {
    var head = el("header", "masthead");
    var seal = el("span", "brand-seal", "汉");
    seal.lang = "zh-CN";
    seal.setAttribute("aria-hidden", "true");
    head.appendChild(seal);
    var copy = el("div", "masthead-copy");
    copy.appendChild(el("p", "eyebrow", "HSK 語彙 · 1–6級"));
    copy.appendChild(el("h1", null, "ことばを、ひとつずつ。"));
    copy.appendChild(el("p", null, "見て、聞いて、確かめる。自分のペースで中国語を学ぼう。"));
    head.appendChild(copy);
    var note = el("div", "masthead-note");
    note.appendChild(el("strong", null, vocab.length.toLocaleString("ja-JP")));
    note.appendChild(el("span", null, "収録語彙 / HSK 1–6"));
    head.appendChild(note);
    return head;
  }

  function renderRecording() {
    var box = el("section", nowPlaying ? "recording is-playing" : "recording");
    box.setAttribute("data-role", "recording");
    box.appendChild(el("h2", null, "音声"));
    var status = el("p", null, audioError || (nowPlaying ? (playback.state().paused ? "一時停止：" : playback.state().playing ? "再生中：" : "発音してみましょう：") + nowPlaying : "単語や中国語のカードをタップで再生・停止。"));
    status.setAttribute("role", "status");
    box.appendChild(status);
    var button = el("button", null, "停止");
    button.type = "button";
    button.disabled = !nowPlaying;
    button.setAttribute("data-stop-audio", "");
    button.addEventListener("click", function () {
      stopAudio();
      markButtons();
      refreshRecording();
    });
    box.appendChild(button);
    return box;
  }

  function renderLevels() {
    var bar = el("div", "levels");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "級");
    var n;
    for (n = 1; n <= 6; n += 1) {
      var button = el("button");
      button.appendChild(el("strong", null, "HSK " + n));
      button.appendChild(el("span", "level-count", window.HSK.wordsForLevel(vocab, n).length + " 語"));
      button.type = "button";
      button.setAttribute("data-level", String(n));
      button.setAttribute("aria-pressed", n === level ? "true" : "false");
      button.addEventListener("click", onLevel(n));
      bar.appendChild(button);
    }
    return bar;
  }

  function onLevel(next) {
    return function () {
      if (level === next) return;
      dismissResume();
      saveProgress();
      level = next;
      if (!preferences.pinyinChosen) preferences.showPinyin = level <= 2;
      if (view !== "list") activateRound();
      render();
      focusContent();
    };
  }

  function renderSections() {
    var bar = el("nav", "sections");
    bar.setAttribute("aria-label", "学習エリア");
    [["list", "単語", "見て・聞いて覚える"], ["practice", "練習", "問題で確かめる"]].forEach(function (item) {
      var active = item[0] === "list" ? view === "list" : view !== "list";
      var button = el("button", "section-button");
      button.type = "button";
      button.setAttribute("data-section", item[0]);
      if (item[0] === "list") button.setAttribute("data-view", "list");
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.appendChild(el("strong", null, item[1]));
      button.appendChild(el("span", null, item[2]));
      button.addEventListener("click", function () {
        if (active) return;
        dismissResume();
        saveProgress();
        if (item[0] === "list") {
          lastPracticeView = view;
          view = "list";
        } else {
          view = lastPracticeView;
          activateRound();
        }
        render();
        focusContent();
      });
      bar.appendChild(button);
    });
    return bar;
  }

  function renderSettings() {
    var details = el("details", "study-settings");
    details.open = settingsOpen;
    details.addEventListener("toggle", function () { settingsOpen = details.open; });
    var summary = el("summary", "settings-summary");
    summary.appendChild(el("strong", null, "学習設定"));
    var status = el("span", "settings-status", settingsStatus());
    status.setAttribute("data-settings-status", "");
    summary.appendChild(status);
    details.appendChild(summary);
    var grid = el("div", "settings-grid");
    var speedLabel = el("label", "setting-field");
    speedLabel.appendChild(el("span", "setting-name", "再生速度"));
    var speed = el("select", "speed-select");
    speed.setAttribute("aria-label", "再生速度");
    [0.5, 0.75, 1, 1.25, 1.5].forEach(function (value) {
      var option = el("option", null, value + "×");
      option.value = String(value);
      speed.appendChild(option);
    });
    speed.value = String(preferences.speed);
    speed.addEventListener("change", function () {
      preferences.speed = Number(speed.value);
      playback.setSpeed(preferences.speed);
      savePreferences();
      applyPreferences();
    });
    speedLabel.appendChild(speed);
    grid.appendChild(speedLabel);
    [["showPinyin", "ピンインを表示"], ["showJapanese", "日本語訳を表示"]].forEach(function (setting) {
      var label = el("label", "setting-toggle");
      var input = el("input");
      input.type = "checkbox";
      input.checked = preferences[setting[0]];
      input.setAttribute("data-setting", setting[0]);
      input.addEventListener("change", function () {
        preferences[setting[0]] = input.checked;
        if (setting[0] === "showPinyin") preferences.pinyinChosen = true;
        savePreferences();
        applyPreferences();
      });
      label.appendChild(input);
      label.appendChild(el("span", null, setting[1]));
      grid.appendChild(label);
    });
    details.appendChild(grid);
    details.appendChild(el("p", "settings-note", "問題に必要な文字と選択肢は常に表示されます。"));
    details.appendChild(renderBackup());
    return details;
  }

  function renderViews() {
    var bar = el("div", "views");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "練習の種類");
    var items = [
      ["gloss", "意味を選ぶ"],
      ["hanzi", "中国語を選ぶ"],
      ["pinyin", "ピンインを選ぶ"]
    ];
    items.forEach(function (item) {
      var button = el("button", null, item[1]);
      button.type = "button";
      button.setAttribute("data-view", item[0]);
      button.setAttribute("aria-pressed", view === item[0] ? "true" : "false");
      button.addEventListener("click", function () {
        if (view === item[0]) return;
        dismissResume();
        saveProgress();
        var targetKind = practiceKind;
        var targets = reviewIds ? reviewIds.slice() : null;
        var context = batchContext;
        view = item[0];
        lastPracticeView = view;
        progress.activeKinds[level + ":" + view] = targetKind;
        if (targetKind !== "normal" && targets) {
          var saved = progress.sessions[level + ":" + view + ":" + targetKind];
          var matches = saved && Array.isArray(saved.reviewIds) && saved.reviewIds.length === targets.length && saved.reviewIds.every(function (id, index) { return id === targets[index]; });
          if (matches) activateRound();
          if (!matches || practiceKind !== targetKind) { sessionSeed = fixedSeed; startRound(targets, targetKind, context); }
        } else activateRound();
        render();
        focusContent();
      });
      bar.appendChild(button);
    });
    return bar;
  }

  function renderExample(entry) {
    var example = window.HSK_EXAMPLES && window.HSK_EXAMPLES[entry.id];
    if (!example) return null;
    var box = el("details", "word-example");
    box.appendChild(el("summary", null, "例文"));
    var zh = el("p", "example-zh", example.zh);
    zh.lang = "zh-CN";
    box.appendChild(zh);
    box.appendChild(el("p", "example-pinyin", example.pinyin));
    box.appendChild(el("p", "example-ja", example.ja));
    return box;
  }

  function renderBackup() {
    var box = el("details", "backup-controls");
    box.appendChild(el("summary", null, "学習記録のバックアップ"));
    box.appendChild(el("p", null, "このブラウザの記録を保存し、別の端末でも読み込めます。"));
    var actions = el("div", "backup-actions");
    var exportButton = el("button", "secondary-button", "記録を書き出す");
    exportButton.type = "button";
    exportButton.setAttribute("data-export-progress", "");
    exportButton.addEventListener("click", function () {
      saveProgress();
      var data = { format: "hsk-study-backup", version: 1, exportedAt: new Date().toISOString(), progress: progress, preferences: preferences };
      var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      var link = el("a");
      link.href = url;
      link.download = "hsk-study-" + window.HSK_STUDY.todayKey() + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      status.textContent = "学習記録を書き出しました。";
    });
    actions.appendChild(exportButton);
    var label = el("label");
    label.appendChild(el("span", null, "記録ファイルを選ぶ"));
    var input = el("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.setAttribute("data-import-progress", "");
    label.appendChild(input);
    actions.appendChild(label);
    box.appendChild(actions);
    var status = el("p", "backup-status", importNotice || "");
    status.setAttribute("role", "status");
    status.setAttribute("data-import-status", "");
    box.appendChild(status);
    var preview = el("div", "import-preview");
    preview.setAttribute("data-import-preview", "");
    preview.hidden = true;
    box.appendChild(preview);
    var pending = null;
    var request = 0;
    input.addEventListener("change", async function () {
      var token = ++request;
      pending = null;
      preview.hidden = true;
      status.textContent = "";
      var file = input.files[0];
      if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw new Error("size");
        var data = JSON.parse(await file.text());
        if (token !== request) return;
        if (!data || data.format !== "hsk-study-backup" || data.version !== 1 || !data.progress || !Array.isArray(data.progress.learnedIds) || !Array.isArray(data.progress.wrongIds) || !data.preferences || typeof data.preferences !== "object" || Array.isArray(data.preferences)) throw new Error("format");
        pending = { progress: loadProgress(data.progress), preferences: loadPreferences(data.preferences) };
        preview.textContent = "";
        preview.appendChild(el("p", null, "学習済み " + pending.progress.learnedIds.length + " 語・復習記録 " + Object.keys(pending.progress.reviews).length + " 語。このブラウザの記録を置き換えます。"));
        var confirm = el("button", "secondary-button", "この記録を読み込む");
        confirm.type = "button";
        confirm.setAttribute("data-confirm-import", "");
        confirm.addEventListener("click", function () {
          if (!pending) return;
          clearTimeout(scrollTimer);
          scrollTimer = null;
          stopAudio();
          progress = pending.progress;
          preferences = pending.preferences;
          level = progress.level;
          view = progress.view;
          lastPracticeView = progress.lastPracticeView;
          if (!preferences.pinyinChosen) preferences.showPinyin = level <= 2;
          searchQueries = {};
          searchBookmarks = {};
          listFilters = {};
          filteredPages = {};
          randomWordOrders = {};
          activeSessionKey = "";
          round = [];
          offerResume = true;
          importNotice = "学習記録を読み込みました。";
          if (view !== "list") activateRound();
          savePreferences();
          saveProgress();
          render();
          var restored = app.querySelector(".backup-controls");
          if (restored) restored.open = true;
        });
        var cancel = el("button", "secondary-button", "キャンセル");
        cancel.type = "button";
        cancel.setAttribute("data-cancel-import", "");
        cancel.addEventListener("click", function () { pending = null; preview.hidden = true; input.value = ""; status.textContent = "読み込みをキャンセルしました。"; });
        preview.appendChild(confirm);
        preview.appendChild(cancel);
        preview.hidden = false;
      } catch (error) {
        if (token === request) status.textContent = "このファイルは読み込めません。HSKのバックアップファイルを選んでください。";
      }
    });
    return box;
  }

  function renderList() {
    var panel = el("section", "panel list");
    var listWords = orderedWords(false);
    var position = rememberedPosition();
    var filter = listFilters[level] || "all";
    if (position.entryId) position.batch = Math.floor(listWords.findIndex(function (entry) { return entry.id === position.entryId; }) / batchSize);
    var visible = [];
    var source = [];
    var pageNumber = position.batch;
    var heading = el("div", "list-heading");
    var title = el("div");
    title.appendChild(el("p", "eyebrow", "単語を学ぶ"));
    title.appendChild(el("h2", null, "HSK " + level));
    heading.appendChild(title);
    var count = el("p", "meta count-badge");
    var shown = el("span", null, String(listWords.length));
    shown.setAttribute("data-current-level", String(level));
    count.appendChild(shown);
    count.appendChild(document.createTextNode(" 語"));
    heading.appendChild(count);
    panel.appendChild(heading);
    var toolbar = el("div", "list-toolbar");
    var searchWrap = el("div", "search-wrap");
    var search = el("input", "search");
    search.type = "search";
    search.value = searchQueries[level] || "";
    search.autocomplete = "off";
    search.spellcheck = false;
    search.placeholder = "中国語・ピンイン・意味で探す";
    search.setAttribute("aria-label", "単語を探す");
    searchWrap.appendChild(search);
    var clear = el("button", "search-clear", "×");
    clear.type = "button";
    clear.hidden = !search.value;
    clear.setAttribute("aria-label", "検索をクリア");
    searchWrap.appendChild(clear);
    toolbar.appendChild(searchWrap);
    panel.appendChild(toolbar);
    var options = el("div", "list-options");
    var tools = el("details", "list-tools");
    tools.open = listToolsOpen;
    tools.addEventListener("toggle", function () { listToolsOpen = tools.open; });
    tools.appendChild(el("summary", null, "並び順・絞り込み"));
    var orderBar = el("div", "list-order");
    var orderLabel = el("label", "order-field");
    orderLabel.appendChild(el("span", null, "表示順"));
    var orderSelect = el("select", "word-order");
    orderSelect.setAttribute("data-word-order", "");
    [["pinyin", "ピンイン順"], ["random", "ランダム順"]].forEach(function (item) { var option = el("option", null, item[1]); option.value = item[0]; orderSelect.appendChild(option); });
    orderSelect.value = preferences.wordOrder;
    orderLabel.appendChild(orderSelect);
    orderBar.appendChild(orderLabel);
    var shuffle = el("button", "shuffle-words", "再シャッフル");
    shuffle.type = "button";
    shuffle.setAttribute("data-shuffle", "");
    shuffle.setAttribute("aria-label", "単語の順番をもう一度シャッフル");
    shuffle.hidden = preferences.wordOrder !== "random";
    orderBar.appendChild(shuffle);
    tools.appendChild(orderBar);
    var filters = el("div", "list-filters");
    function selection(name, hook, choices, value) {
      var label = el("label");
      label.appendChild(el("span", null, name));
      var select = el("select");
      select.setAttribute(hook, "");
      choices.forEach(function (item) { var option = el("option", null, item[1]); option.value = item[0]; select.appendChild(option); });
      select.value = value;
      label.appendChild(select);
      filters.appendChild(label);
      return select;
    }
    var learnedFilter = selection("学習状態", "data-learned-filter", [["all", "すべて"], ["new", "未学習"], ["learned", "学習済み"]], filter);
    var scope = selection("検索する範囲", "data-search-scope", [["current", "この級"], ["all", "すべての級"]], searchScopes[level] || "current");
    tools.appendChild(filters);
    options.appendChild(tools);
    var queue = renderAudioQueue(function () { return visible.slice(); });
    options.appendChild(queue);
    panel.appendChild(options);
    var status = el("p", "search-status");
    status.setAttribute("role", "status");
    panel.appendChild(status);
    var tip = el("div", "first-use-note");
    tip.hidden = progress.tipSeen;
    tip.appendChild(el("p", null, "単語をタップで音声。○で学習済み、✓でもう一度取り消せます。"));
    var dismiss = el("button", "secondary-button", "わかった");
    dismiss.type = "button";
    dismiss.addEventListener("click", function () { progress.tipSeen = true; tip.hidden = true; saveProgress(); });
    tip.appendChild(dismiss);
    panel.appendChild(tip);
    var list = el("ul", "words");
    panel.appendChild(list);
    var empty = el("div", "empty-state");
    var emptyTitle = el("strong");
    var emptyText = el("p");
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyText);
    var reset = el("button", "reset-search", "検索をクリア");
    reset.type = "button";
    empty.appendChild(reset);
    var searchAll = el("button", "secondary-button", "すべての級から探す");
    searchAll.type = "button";
    searchAll.setAttribute("data-search-all", "");
    empty.appendChild(searchAll);
    var resetFilter = el("button", "secondary-button", "すべての単語を表示");
    resetFilter.type = "button";
    resetFilter.addEventListener("click", function () { filter = "all"; learnedFilter.value = filter; listFilters[level] = filter; draw(search.value); });
    empty.appendChild(resetFilter);
    panel.appendChild(empty);
    var batchProgress = el("div", "batch-progress");
    var learnedCount = el("p", "learned-count");
    learnedCount.setAttribute("role", "status");
    batchProgress.appendChild(learnedCount);
    panel.appendChild(batchProgress);
    var batchActions = el("div", "batch-actions");
    var practice = el("button", "next");
    practice.type = "button";
    practice.setAttribute("data-practice-batch", "");
    practice.addEventListener("click", function () {
      var next = source[(pageNumber + 1) * batchSize];
      beginBatch(visible, { nextId: next ? next.id : null, firstId: visible[0].id, filter: filter });
    });
    batchActions.appendChild(practice);
    panel.appendChild(batchActions);
    var batches = el("div", "batch-controls");
    var previous = el("button", "secondary-button", "前の20語");
    previous.type = "button";
    previous.setAttribute("data-batch-prev", "");
    var batchStatus = el("span", "batch-status");
    var nextBatch = el("button", "secondary-button", "次の20語");
    nextBatch.type = "button";
    nextBatch.setAttribute("data-batch-next", "");
    batches.appendChild(previous);
    batches.appendChild(batchStatus);
    batches.appendChild(nextBatch);
    panel.appendChild(batches);

    function updateLearned() {
      var number = visible.filter(function (entry) { return progress.learnedIds.indexOf(entry.id) !== -1; }).length;
      learnedCount.textContent = (search.value.trim() ? "検索結果" : "このグループ") + "：学習済み " + number + " / " + visible.length + " 語";
      if (!search.value.trim()) status.textContent = source.length ? (pageNumber * batchSize + 1) + "–" + Math.min((pageNumber + 1) * batchSize, source.length) + " / " + source.length + " 語 · 学習済み " + number + "/" + visible.length : "該当する単語はありません";
      if (!search.value.trim() && visible.length && number === visible.length) learnedCount.textContent += " · このグループを学習しました！";
    }

    function draw(query) {
      var needle = normalizeSearch(query.trim());
      var pool = needle && scope.value === "all" ? vocab : listWords;
      source = pool.filter(function (entry) {
        if (needle) return searchIndex.get(entry.id).indexOf(needle) !== -1;
        var learned = progress.learnedIds.indexOf(entry.id) !== -1;
        return filter === "all" || (filter === "learned" ? learned : !learned);
      });
      pageNumber = filter === "all" ? position.batch : filteredPages[level + ":" + filter] || 0;
      pageNumber = Math.min(pageNumber, Math.max(0, Math.ceil(source.length / batchSize) - 1));
      if (!needle && filter !== "all") filteredPages[level + ":" + filter] = pageNumber;
      visible = needle ? source : source.slice(pageNumber * batchSize, (pageNumber + 1) * batchSize);
      batches.hidden = !!needle || !source.length;
      previous.disabled = pageNumber === 0;
      nextBatch.disabled = (pageNumber + 1) * batchSize >= source.length;
      batchStatus.textContent = (pageNumber * batchSize + 1) + "–" + Math.min((pageNumber + 1) * batchSize, source.length) + " / " + source.length;
      batchActions.hidden = !!needle || !visible.length;
      practice.textContent = "この " + visible.length + " 語を練習";
      queue.hidden = !!needle || !visible.length;
      updateLearned();
      var fragment = document.createDocumentFragment();
      visible.forEach(function (entry) {
        var item = el("li", "word");
        item.setAttribute("data-entry-id", String(entry.id));
        item.setAttribute("data-hanzi", entry.hanzi);
        item.setAttribute("data-level", String(entry.level));
        var text = el("div", "word-text");
        var title = el("div", "word-title");
        var hanzi = el("span", "hanzi", entry.hanzi);
        hanzi.lang = "zh-CN";
        title.appendChild(hanzi);
        var pos = el("span", "pos", entry.pos);
        pos.setAttribute("data-pos", entry.pos);
        title.appendChild(pos);
        if (needle && scope.value === "all") {
          var badge = el("span", "word-level", "HSK " + entry.level);
          badge.setAttribute("data-search-level", String(entry.level));
          title.appendChild(badge);
        }
        text.appendChild(title);
        text.appendChild(el("span", "pinyin", entry.pinyin));
        text.appendChild(el("span", "gloss", entry.gloss));
        if (entry.audioText) text.appendChild(el("span", "audio-note", "音声の例：" + entry.audioText));
        var example = renderExample(entry);
        if (example) text.appendChild(example);
        if (needle) {
          var from = el("button", "study-from", "ここから学ぶ");
          from.type = "button";
          from.setAttribute("data-study-from", "");
          from.addEventListener("click", function () {
            saveProgress();
            level = entry.level;
            if (!preferences.pinyinChosen) preferences.showPinyin = level <= 2;
            searchQueries[level] = "";
            listFilters[level] = "all";
            rememberEntry(entry);
            render();
            focusContent();
          });
          text.appendChild(from);
        }
        item.appendChild(text);
        var actions = el("div", "word-actions");
        actions.appendChild(listenButton(entry));
        var learned = el("button", "word-complete");
        learned.type = "button";
        learned.setAttribute("data-mark-learned", "");
        function labelLearned() {
          var complete = progress.learnedIds.indexOf(entry.id) !== -1;
          learned.textContent = complete ? "✓" : "○";
          learned.setAttribute("aria-pressed", complete ? "true" : "false");
          learned.setAttribute("aria-label", entry.hanzi + (complete ? " を未学習に戻す" : " を学習済みにする"));
          learned.title = complete ? "学習済み" : "学習済みにする";
        }
        labelLearned();
        learned.addEventListener("click", function () {
          var index = progress.learnedIds.indexOf(entry.id);
          if (index === -1) {
            progress.learnedIds.push(entry.id);
            if (!progress.learnedDates[entry.id]) progress.learnedDates[entry.id] = window.HSK_STUDY.todayKey();
          } else progress.learnedIds.splice(index, 1);
          saveProgress();
          labelLearned();
          updateLearned();
          refreshDaily();
          if (!needle && filter !== "all") {
            var oldIndex = visible.indexOf(entry);
            draw(search.value);
            var next = list.querySelectorAll("[data-mark-learned]")[Math.min(oldIndex, list.children.length - 1)];
            if (next) next.focus({ preventScroll: true });
          }
        });
        actions.appendChild(learned);
        item.appendChild(actions);
        makeAudioTarget(item, entry);
        item.addEventListener("click", function (event) {
          if (!needle && filter === "all" && !event.target.closest("details")) rememberEntry(entry);
        });
        fragment.appendChild(item);
      });
      list.replaceChildren(fragment);
      empty.hidden = source.length > 0;
      emptyTitle.textContent = needle ? "見つかりませんでした" : filter === "new" ? "未学習の単語はありません" : "学習済みの単語はまだありません";
      emptyText.textContent = needle ? "声調なしのピンインや、別のことばでも探せます。" : "○を押すと学習済みとして記録できます。";
      reset.hidden = !needle;
      searchAll.hidden = !needle || scope.value === "all";
      resetFilter.hidden = !!needle;
      if (needle) status.textContent = source.length + " 語が見つかりました / " + (scope.value === "all" ? "全級" : "HSK " + level);
      markButtons();
    }

    search.addEventListener("input", function () {
      dismissResume();
      stopAudio();
      if ((searchQueries[level] || "").trim() && !search.value.trim()) { clearSearch(); return; }
      if (!searchQueries[level] && search.value.trim()) searchBookmarks[level] = { y: window.scrollY, entryId: position.entryId };
      clear.hidden = !search.value;
      searchQueries[level] = search.value;
      draw(search.value);
    });
    learnedFilter.addEventListener("change", function () { stopAudio(); filter = learnedFilter.value; listFilters[level] = filter; draw(search.value); });
    scope.addEventListener("change", function () { searchScopes[level] = scope.value; draw(search.value); });
    searchAll.addEventListener("click", function () { scope.value = "all"; searchScopes[level] = "all"; draw(search.value); search.focus(); });
    orderSelect.addEventListener("change", function () {
      dismissResume();
      stopAudio();
      preferences.wordOrder = orderSelect.value;
      savePreferences();
      shuffle.hidden = preferences.wordOrder !== "random";
      listWords = orderedWords(false);
      position.batch = 0;
      position.entryId = listWords[0].id;
      filteredPages = {};
      draw(search.value);
      saveProgress();
    });
    shuffle.addEventListener("click", function () {
      dismissResume();
      stopAudio();
      listWords = orderedWords(true);
      position.batch = 0;
      position.entryId = listWords[0].id;
      filteredPages = {};
      draw(search.value);
      saveProgress();
    });
    function clearSearch() {
      stopAudio();
      search.value = "";
      searchQueries[level] = "";
      clear.hidden = true;
      draw("");
      search.focus({ preventScroll: true });
      var bookmark = searchBookmarks[level];
      if (bookmark) {
        suppressScrollSave = true;
        clearTimeout(scrollTimer);
        scrollTimer = null;
        position.entryId = bookmark.entryId;
        saveProgress();
        window.scrollTo({ top: bookmark.y, behavior: "instant" });
        delete searchBookmarks[level];
      }
    }
    function changeBatch(delta) {
      dismissResume();
      pageNumber = Math.max(0, Math.min(Math.ceil(source.length / batchSize) - 1, pageNumber + delta));
      if (filter === "all") {
        position.batch = pageNumber;
        position.entryId = source[pageNumber * batchSize].id;
      } else filteredPages[level + ":" + filter] = pageNumber;
      stopAudio();
      draw(search.value);
      saveProgress();
      focusContent();
    }
    previous.addEventListener("click", function () { changeBatch(-1); });
    nextBatch.addEventListener("click", function () { changeBatch(1); });
    clear.addEventListener("click", clearSearch);
    reset.addEventListener("click", clearSearch);
    draw(search.value);
    return panel;
  }

  function renderPractice() {
    if (!round.length || round[0].level !== level || round[0].mode !== view) {
      activateRound();
    }
    if (roundComplete) return renderSummary();
    var question = currentQuestion();
    var panel = el("section", "panel practice");
    panel.setAttribute("data-mode", view);
    var practiceHead = el("div", "practice-head");
    practiceHead.appendChild(el("h2", null, (practiceKind === "review" ? "復習 · " : practiceKind === "batch" ? "このグループ · " : "") + practiceTitle(view)));
    var score = el("p", "meta score", "正解 " + correctCount + " / " + round.length);
    practiceHead.appendChild(score);
    panel.appendChild(practiceHead);
    panel.appendChild(el("p", "practice-instruction", view === "gloss" ? "このことばの意味を選びましょう。" : view === "hanzi" ? "意味に合う中国語を選びましょう。" : "正しいピンインを選びましょう。"));
    panel.appendChild(el("p", "progress-label", "第 " + (questionIndex + 1) + " 問 / " + round.length));
    var track = el("div", "progress-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", "回答済みの問題数");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(round.length));
    track.setAttribute("aria-valuenow", String(questionIndex));
    var fill = el("span", "progress-fill");
    fill.style.width = (questionIndex / round.length * 100) + "%";
    track.appendChild(fill);
    panel.appendChild(track);
    var promptRow = el("div", "prompt-row");
    var prompt = el("div", "prompt", question.prompt);
    if (view !== "hanzi") prompt.lang = "zh-CN";
    promptRow.appendChild(prompt);
    var questionEntry = vocab.find(function (entry) { return entry.id === question.entryId; });
    if (questionEntry && view === "gloss") {
      promptRow.appendChild(el("span", "supplement-pinyin", questionEntry.pinyin));
    }
    if (questionEntry && view === "pinyin") {
      promptRow.appendChild(el("span", "supplement-japanese", questionEntry.gloss));
    }
    if (view !== "hanzi") {
      promptRow.appendChild(listenButton(questionEntry));
      makeAudioTarget(promptRow, questionEntry);
      if (questionEntry.audioText) promptRow.appendChild(el("span", "audio-note", "音声の例：" + questionEntry.audioText));
    }
    panel.appendChild(promptRow);

    var choices = el("div", "choices");
    question.choices.forEach(function (choice, index) {
      var button = el("button", "choice", choice.text);
      button.type = "button";
      button.setAttribute("data-choice-index", String(index));
      if (view === "hanzi") button.lang = "zh-CN";
      button.addEventListener("click", function () {
        onChoose(index);
      });
      choices.appendChild(button);
    });
    panel.appendChild(choices);

    var feedback = el("p", "feedback", "");
    feedback.setAttribute("data-feedback", "");
    feedback.setAttribute("aria-live", "polite");
    panel.appendChild(feedback);

    var bar = el("div", "practice-bar");
    var next = el("button", "next", questionIndex + 1 < round.length ? "次の問題" : "結果を見る");
    next.type = "button";
    next.disabled = true;
    next.setAttribute("data-next", "");
    next.addEventListener("click", onNext);
    bar.appendChild(next);
    panel.appendChild(bar);
    panel.appendChild(renderPracticeActions());
    if (answered) paintAnswer(panel, answers[questionIndex]);
    return panel;
  }

  function renderPracticeActions() {
    var actions = el("div", "practice-actions");
    var restart = el("button", "secondary-button", "新しく10問を始める");
    restart.type = "button";
    restart.setAttribute("data-practice-restart", "");
    var confirm = el("div", "restart-confirm");
    confirm.hidden = true;
    confirm.appendChild(el("p", null, "この練習を終了して、新しい10問を始めますか？"));
    var yes = el("button", "secondary-button", "新しく始める");
    yes.type = "button";
    yes.setAttribute("data-confirm-restart", "");
    yes.addEventListener("click", function () {
      sessionSeed = fixedSeed;
      startRound();
      render();
      focusContent();
    });
    var no = el("button", "secondary-button", "練習を続ける");
    no.type = "button";
    no.setAttribute("data-cancel-restart", "");
    no.addEventListener("click", function () { confirm.hidden = true; restart.hidden = false; restart.focus(); });
    confirm.appendChild(yes);
    confirm.appendChild(no);
    restart.addEventListener("click", function () { confirm.hidden = false; restart.hidden = true; no.focus(); });
    actions.appendChild(restart);
    actions.appendChild(confirm);
    if (practiceKind !== "normal" && progress.sessions[level + ":" + view + ":normal"]) {
      var back = el("button", "secondary-button", "通常の練習に戻る");
      back.type = "button";
      back.setAttribute("data-return-practice", "");
      back.addEventListener("click", function () {
        saveProgress();
        progress.activeKinds[level + ":" + view] = "normal";
        activateRound();
        render();
        focusContent();
      });
      actions.appendChild(back);
    }
    return actions;
  }

  function practiceTitle(mode) {
    if (mode === "gloss") return "意味を選ぶ";
    if (mode === "hanzi") return "中国語を選ぶ";
    return "ピンインを選ぶ";
  }

  function focusContent() {
    suppressScrollSave = true;
    clearTimeout(scrollTimer);
    scrollTimer = null;
    var panel = app.querySelector(".panel");
    var heading = panel.querySelector("h2");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    panel.scrollIntoView({ block: "start", behavior: "instant" });
  }

  function renderSummary() {
    var panel = el("section", "panel round-summary");
    panel.appendChild(el("p", "eyebrow", "HSK " + level + " · " + practiceTitle(view)));
    panel.appendChild(el("h2", null, "おつかれさまでした！"));
    var score = el("div", "summary-score");
    score.setAttribute("aria-label", round.length + " 問中 " + correctCount + " 問正解");
    score.appendChild(el("strong", null, String(correctCount)));
    score.appendChild(el("span", null, "/ " + round.length));
    panel.appendChild(score);
    panel.appendChild(el("p", "summary-message", mistakes.length ? "間違えたことばを、もう一度見て・聞いて覚えましょう。" : "全問正解です。この調子で、次のことばへ。"));
    if (mistakes.length) {
      panel.appendChild(el("h3", "review-heading", "振り返ることば · " + mistakes.length + " 語"));
      var review = el("ul", "review-words");
      mistakes.forEach(function (question) {
        var entry = vocab.find(function (item) { return item.id === question.entryId; });
        var row = el("li", "review-word");
        var text = el("div");
        var hanzi = el("strong", null, entry.hanzi);
        hanzi.lang = "zh-CN";
        text.appendChild(hanzi);
        text.appendChild(el("span", null, entry.pinyin));
        text.appendChild(el("p", null, entry.gloss));
        if (entry.audioText) text.appendChild(el("p", "audio-note", "音声の例：" + entry.audioText));
        row.appendChild(text);
        row.appendChild(listenButton(entry));
        makeAudioTarget(row, entry);
        review.appendChild(row);
      });
      panel.appendChild(review);
    }
    var actions = el("div", "summary-actions");
    if (mistakes.length) {
      var retry = el("button", "secondary-button", "今回の間違いだけ復習 · " + mistakes.length + " 語");
      retry.type = "button";
      retry.setAttribute("data-review-mistakes", "");
      retry.addEventListener("click", function () { beginReview(mistakes.map(function (question) { return question.entryId; })); });
      actions.appendChild(retry);
    }
    if (practiceKind === "review") {
      panel.appendChild(el("p", "summary-message", "今日通過した単語は、日をあけてもう一度復習します。"));
      panel.appendChild(renderPracticeActions());
    }
    if (practiceKind === "batch") panel.appendChild(renderPracticeActions());
    if (practiceKind === "batch" && batchContext && entriesById.has(batchContext.nextId)) {
      var continueBatch = el("button", "next", "次のグループを学ぶ");
      continueBatch.type = "button";
      continueBatch.setAttribute("data-batch-continue", "");
      continueBatch.addEventListener("click", function () {
        var nextId = batchContext.nextId;
        view = "list";
        searchQueries[level] = "";
        var nextFilter = batchContext.filter || "all";
        listFilters[level] = nextFilter;
        if (nextFilter === "all") rememberedPosition().entryId = nextId;
        else {
          var filtered = orderedWords(false).filter(function (entry) { var learned = progress.learnedIds.indexOf(entry.id) !== -1; return nextFilter === "learned" ? learned : !learned; });
          var offset = filtered.findIndex(function (entry) { return entry.id === nextId; });
          filteredPages[level + ":" + nextFilter] = Math.max(0, Math.floor(offset / batchSize));
        }
        render();
        focusContent();
      });
      actions.appendChild(continueBatch);
    }
    var restart = el("button", "next", practiceKind === "normal" ? "もう一度、10問" : "この級からランダム10問");
    restart.type = "button";
    restart.setAttribute("data-restart", "");
    restart.addEventListener("click", function () {
      if (fixedSeed === null) sessionSeed = null;
      startRound();
      render();
      focusContent();
    });
    actions.appendChild(restart);
    var back = el("button", "secondary-button", "単語に戻る");
    back.type = "button";
    back.setAttribute("data-return-list", "");
    back.addEventListener("click", function () {
      lastPracticeView = view;
      view = "list";
      render();
      focusContent();
    });
    actions.appendChild(back);
    panel.appendChild(actions);
    return panel;
  }

  function onChoose(index) {
    if (answered) return;
    dismissResume();
    answered = true;
    var question = currentQuestion();
    var ok = window.HSK.scoreChoice(question, index);
    answers[questionIndex] = index;
    if (ok) {
      correctCount += 1;
      if (practiceKind === "review") {
        progress.reviews[question.entryId] = window.HSK_STUDY.reviewCorrect(progress.reviews[question.entryId]);
        if (window.HSK_STUDY.isMastered(progress.reviews[question.entryId])) progress.wrongIds = progress.wrongIds.filter(function (id) { return id !== question.entryId; });
      }
    } else {
      mistakes.push(question);
      progress.reviews[question.entryId] = window.HSK_STUDY.reviewWrong(progress.reviews[question.entryId]);
      if (progress.wrongIds.indexOf(question.entryId) === -1) progress.wrongIds.push(question.entryId);
    }
    saveProgress();
    paintAnswer(app.querySelector(".practice"), index);
    app.querySelector("[data-next]").focus({ preventScroll: true });
    var review = app.querySelector(".review-controls");
    if (review) review.replaceWith(renderReviewControls());
    refreshDaily();
  }

  function paintAnswer(panel, index) {
    var question = currentQuestion();
    var ok = window.HSK.scoreChoice(question, index);
    var feedback = panel.querySelector("[data-feedback]");
    feedback.textContent = ok ? "正解" : "不正解";
    feedback.setAttribute("data-result", ok ? "right" : "wrong");
    if (!ok) {
      var correct = question.choices.find(function (choice) { return choice.keyed; });
      feedback.insertAdjacentElement("afterend", el("p", "answer-explanation", "正しい答え：" + correct.text));
      var example = renderExample(entriesById.get(question.entryId));
      if (example) feedback.insertAdjacentElement("afterend", example);
    }
    var buttons = panel.querySelectorAll(".choice");
    Array.prototype.forEach.call(buttons, function (button) {
      var choiceIndex = Number(button.getAttribute("data-choice-index"));
      button.disabled = true;
      if (question.choices[choiceIndex].keyed) button.classList.add("is-right");
      if (choiceIndex === index && !ok) button.classList.add("is-wrong");
    });
    var score = panel.querySelector(".score");
    score.textContent = "正解 " + correctCount + " / " + round.length;
    panel.querySelector(".progress-track").setAttribute("aria-valuenow", String(questionIndex + 1));
    panel.querySelector(".progress-fill").style.width = ((questionIndex + 1) / round.length * 100) + "%";
    var next = panel.querySelector("[data-next]");
    next.disabled = false;
    if (view === "hanzi") {
      var entry = null;
      var i;
      for (i = 0; i < vocab.length; i += 1) {
        if (vocab[i].id === question.entryId) entry = vocab[i];
      }
      if (entry) feedback.insertAdjacentElement("afterend", listenButton(entry));
    }
  }

  function onNext() {
    if (!answered) return;
    if (questionIndex + 1 < round.length) {
      questionIndex += 1;
      answered = false;
      render();
      focusContent();
      return;
    }
    roundComplete = true;
    render();
    focusContent();
  }

  var scrollTimer;
  var suppressScrollSave = true;
  function rememberVisibleWord() {
    scrollTimer = null;
    if (suppressScrollSave) return;
    if (view !== "list" || (searchQueries[level] || "").trim() || (listFilters[level] && listFilters[level] !== "all")) return;
    var toolbar = app.querySelector(".list-toolbar");
    if (!toolbar) return;
    var boundary = getComputedStyle(toolbar).position === "sticky" ? Math.max(0, toolbar.getBoundingClientRect().bottom) : 0;
    var rows = app.querySelectorAll(".word");
    for (var i = 0; i < rows.length; i += 1) {
      var rect = rows[i].getBoundingClientRect();
      if (rect.bottom > boundary + 12 && rect.top < window.innerHeight) {
        rememberedPosition().entryId = Number(rows[i].getAttribute("data-entry-id"));
        saveProgress();
        break;
      }
    }
  }
  function userScrolls() { suppressScrollSave = false; }
  window.addEventListener("wheel", userScrolls, { passive: true });
  window.addEventListener("touchmove", userScrolls, { passive: true });
  window.addEventListener("pointerdown", function (event) { if (event.clientX >= document.documentElement.clientWidth) userScrolls(); }, { passive: true });
  window.addEventListener("keydown", function (event) {
    if (["PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp", " "].indexOf(event.key) !== -1 && !event.target.closest("input, select, textarea, button, summary")) userScrolls();
  });
  window.addEventListener("scroll", function () {
    if (suppressScrollSave) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(rememberVisibleWord, 150);
  }, { passive: true });
  function flushProgress() {
    if (scrollTimer) {
      clearTimeout(scrollTimer);
      rememberVisibleWord();
    }
    saveProgress();
  }
  window.addEventListener("pagehide", flushProgress);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) flushProgress();
    else { refreshDaily(); var review = app.querySelector(".review-controls"); if (review) review.replaceWith(renderReviewControls()); }
  });
  if (view !== "list") activateRound();
  render();
})();

