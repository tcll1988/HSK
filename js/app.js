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
  var searchQueries = {};
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
  var audioRequest = 0;

  player.addEventListener("playing", function () {
    markButtons();
  });
  player.addEventListener("ended", function () {
    nowPlaying = "";
    markButtons();
    refreshRecording();
  });
  player.addEventListener("error", function () {
    if (nowPlaying) audioFailed(audioRequest);
  });

  function normalizeSearch(value) {
    return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f\s]/g, "");
  }

  function loadPreferences() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("hsk-study-preferences-v1")) || {}; } catch (error) {}
    var speed = typeof saved.speed === "number" ? saved.speed : 1;
    return {
      speed: [0.5, 0.75, 1, 1.25, 1.5].indexOf(speed) !== -1 ? speed : 1,
      showPinyin: saved.showPinyin === true,
      showJapanese: saved.showJapanese !== false,
      wordOrder: saved.wordOrder === "random" ? "random" : "pinyin"
    };
  }

  function savePreferences() {
    try { localStorage.setItem("hsk-study-preferences-v1", JSON.stringify(preferences)); } catch (error) {}
  }

  function validMode(mode) { return typeof mode === "string" && Object.prototype.hasOwnProperty.call(window.HSK.MODES, mode); }

  function loadProgress() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem("hsk-study-progress-v1")); } catch (error) {}
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
      sessions: {}, activeKinds: {}, listPositions: {}, randomSeeds: {},
      updatedAt: Number.isFinite(saved.updatedAt) ? saved.updatedAt : 0
    };
    Object.keys(object(saved.sessions)).forEach(function (key) {
      if (/^[1-6]:(gloss|hanzi|pinyin):(normal|review)$/.test(key)) state.sessions[key] = saved.sessions[key];
    });
    Object.keys(object(saved.activeKinds)).forEach(function (key) {
      if (/^[1-6]:(gloss|hanzi|pinyin)$/.test(key) && saved.activeKinds[key] === "review") state.activeKinds[key] = "review";
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
        questionIndex: questionIndex, complete: roundComplete
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
    practiceKind = progress.activeKinds[base] === "review" ? "review" : "normal";
    activeSessionKey = base + ":" + practiceKind;
    var saved = progress.sessions[activeSessionKey];
    try {
      if (!saved || !Number.isInteger(saved.seed) || !Array.isArray(saved.answers)) throw new Error("invalid session");
      sessionSeed = saved.seed;
      reviewIds = practiceKind === "review" ? saved.reviewIds : null;
      if (practiceKind === "review" && (!Array.isArray(reviewIds) || !reviewIds.length || reviewIds.length > 10 || new Set(reviewIds).size !== reviewIds.length || !reviewIds.every(function (id) { var entry = entriesById.get(id); return entry && entry.level === level; }))) throw new Error("invalid review");
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
    dismissResume();
    clearTimeout(scrollTimer);
    scrollTimer = null;
    var position = rememberedPosition();
    position.entryId = entry.id;
    position.batch = Math.floor(orderedWords(false).findIndex(function (word) { return word.id === entry.id; }) / batchSize);
    saveProgress();
  }

  function wrongWords() {
    return progress.wrongIds.filter(function (id) { return entriesById.get(id).level === level; });
  }

  function beginReview(ids) {
    saveProgress();
    if (view === "list") view = lastPracticeView;
    var targets = Array.from(new Set(ids)).slice(0, 10);
    if (!targets.length) return;
    sessionSeed = fixedSeed;
    startRound(targets);
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
      if (view === "list") searchQueries[level] = "";
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
    box.hidden = !ids.length;
    var button = el("button", "secondary-button", "間違えた単語を復習 · " + ids.length + " 語");
    button.type = "button";
    button.setAttribute("data-review-start", "");
    button.addEventListener("click", function () { beginReview(wrongWords()); });
    box.appendChild(button);
    return box;
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

  function startRound(targets) {
    reviewIds = targets || null;
    practiceKind = reviewIds ? "review" : "normal";
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
    audioRequest += 1;
    player.pause();
    nowPlaying = "";
    audioError = "";
  }

  function audioFailed(request) {
    if (request !== audioRequest) return;
    player.pause();
    nowPlaying = "";
    audioError = "音声を再生できませんでした。もう一度お試しください。";
    markButtons();
    refreshRecording();
  }

  function markButtons() {
    var buttons = app.querySelectorAll("[data-audio]");
    Array.prototype.forEach.call(buttons, function (button) {
      var on = button.getAttribute("data-audio") === nowPlaying;
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    Array.prototype.forEach.call(app.querySelectorAll("[data-audio-row]"), function (row) {
      row.classList.toggle("is-playing", row.getAttribute("data-audio-row") === nowPlaying);
    });
  }

  function refreshRecording() {
    var current = app.querySelector("[data-role='recording']");
    if (!current) return;
    current.replaceWith(renderRecording());
  }

  function playHanzi(hanzi) {
    if (nowPlaying === hanzi) {
      stopAudio();
      markButtons();
      refreshRecording();
      return;
    }
    var request = ++audioRequest;
    audioError = "";
    nowPlaying = hanzi;
    player.src = window.HSK.audioSrc(hanzi);
    player.playbackRate = preferences.speed;
    var started = player.play();
    if (started && started.catch) started.catch(function () { audioFailed(request); });
    markButtons();
    refreshRecording();
  }

  function listenButton(hanzi) {
    var button = el("button", "listen");
    button.type = "button";
    button.setAttribute("data-audio", hanzi);
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", hanzi + " を聞く");
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
      playHanzi(hanzi);
    });
    return button;
  }

  function makeAudioTarget(row, hanzi) {
    row.classList.add("audio-target");
    row.setAttribute("data-audio-row", hanzi);
    row.addEventListener("click", function (event) {
      // The existing native button handles keyboard access and its own clicks.
      if (event.target.closest("button, a, input, select, textarea, summary")) return;
      var selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.containsNode(row, true)) return;
      playHanzi(hanzi);
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
    var status = el("p", null, audioError || (nowPlaying ? "再生中：" + nowPlaying : "単語や中国語のカードをタップで再生・停止。"));
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
      player.playbackRate = preferences.speed;
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
        savePreferences();
        applyPreferences();
      });
      label.appendChild(input);
      label.appendChild(el("span", null, setting[1]));
      grid.appendChild(label);
    });
    details.appendChild(grid);
    details.appendChild(el("p", "settings-note", "問題に必要な文字と選択肢は常に表示されます。"));
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
        view = item[0];
        lastPracticeView = view;
        activateRound();
        render();
        focusContent();
      });
      bar.appendChild(button);
    });
    return bar;
  }

  function renderList() {
    var panel = el("section", "panel list");
    var listWords = orderedWords(false);
    var position = rememberedPosition();
    if (position.entryId) position.batch = Math.floor(listWords.findIndex(function (entry) { return entry.id === position.entryId; }) / batchSize);
    var toolbar = el("div", "list-toolbar");
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
    toolbar.appendChild(heading);

    var searchWrap = el("div", "search-wrap");
    var search = el("input", "search");
    search.type = "search";
    search.value = searchQueries[level] || "";
    search.autocomplete = "off";
    search.spellcheck = false;
    search.placeholder = "中国語・ピンイン・意味で探す";
    search.setAttribute("aria-label", "この級の中から探す");
    searchWrap.appendChild(search);
    var clear = el("button", "search-clear", "×");
    clear.type = "button";
    clear.hidden = !search.value;
    clear.setAttribute("aria-label", "検索をクリア");
    searchWrap.appendChild(clear);
    toolbar.appendChild(searchWrap);
    var orderBar = el("div", "list-order");
    var orderLabel = el("label", "order-field");
    orderLabel.appendChild(el("span", null, "表示順"));
    var orderSelect = el("select", "word-order");
    orderSelect.setAttribute("data-word-order", "");
    [["pinyin", "ピンイン順"], ["random", "ランダム順"]].forEach(function (item) {
      var option = el("option", null, item[1]);
      option.value = item[0];
      orderSelect.appendChild(option);
    });
    orderSelect.value = preferences.wordOrder;
    orderLabel.appendChild(orderSelect);
    orderBar.appendChild(orderLabel);
    var shuffleButton = el("button", "shuffle-words", "再シャッフル");
    shuffleButton.type = "button";
    shuffleButton.setAttribute("data-shuffle", "");
    shuffleButton.setAttribute("aria-label", "単語の順番をもう一度シャッフル");
    shuffleButton.hidden = preferences.wordOrder !== "random";
    orderBar.appendChild(shuffleButton);
    toolbar.appendChild(orderBar);
    var status = el("p", "search-status");
    status.setAttribute("role", "status");
    toolbar.appendChild(status);
    panel.appendChild(toolbar);

    var list = el("ul", "words");
    panel.appendChild(list);
    var empty = el("div", "empty-state");
    empty.appendChild(el("strong", null, "見つかりませんでした"));
    empty.appendChild(el("p", null, "この級の中で検索しています。別のことばや、声調なしのピンインでも探せます。"));
    var reset = el("button", "reset-search", "検索をクリア");
    reset.type = "button";
    empty.appendChild(reset);
    panel.appendChild(empty);
    var batchProgress = el("div", "batch-progress");
    var learnedCount = el("p", "learned-count");
    learnedCount.setAttribute("role", "status");
    batchProgress.appendChild(learnedCount);
    panel.appendChild(batchProgress);
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

    function updateLearned(entries) {
      var count = entries.filter(function (entry) { return progress.learnedIds.indexOf(entry.id) !== -1; }).length;
      learnedCount.textContent = (search.value.trim() ? "検索結果" : "このグループ") + "：学習済み " + count + " / " + entries.length + " 語";
      if (!search.value.trim()) status.textContent = (position.batch * batchSize + 1) + "–" + Math.min((position.batch + 1) * batchSize, listWords.length) + " / " + listWords.length + " 語 · ✓ 学習済み " + count + "/" + entries.length;
    }

    function draw(query) {
      var fragment = document.createDocumentFragment();
      var needle = normalizeSearch(query.trim());
      var matches = listWords.filter(function (entry) { return !needle || searchIndex.get(entry.id).indexOf(needle) !== -1; });
      var matched = matches.length;
      var start = position.batch * batchSize;
      var visible = needle ? matches : matches.slice(start, start + batchSize);
      batches.hidden = !!needle;
      previous.disabled = position.batch === 0;
      nextBatch.disabled = start + batchSize >= listWords.length;
      batchStatus.textContent = (start + 1) + "–" + Math.min(start + batchSize, listWords.length) + " / " + listWords.length;
      updateLearned(visible);
      visible.forEach(function (entry) {
        var item = el("li", "word");
        item.setAttribute("data-entry-id", String(entry.id));
        item.setAttribute("data-hanzi", entry.hanzi);
        item.setAttribute("data-level", String(entry.level));
        var hanzi = el("span", "hanzi", entry.hanzi);
        hanzi.lang = "zh-CN";
        item.appendChild(hanzi);
        item.appendChild(el("span", "pinyin", entry.pinyin));
        var pos = el("span", "pos", entry.pos);
        pos.setAttribute("data-pos", entry.pos);
        item.appendChild(pos);
        item.appendChild(el("span", "gloss", entry.gloss));
        item.appendChild(listenButton(entry.hanzi));
        var learned = el("button", "word-complete", "✓");
        learned.type = "button";
        learned.setAttribute("data-mark-learned", "");
        function labelLearned() {
          var complete = progress.learnedIds.indexOf(entry.id) !== -1;
          learned.setAttribute("aria-pressed", complete ? "true" : "false");
          learned.setAttribute("aria-label", entry.hanzi + (complete ? " を未学習に戻す" : " を学習済みにする"));
          learned.title = complete ? "学習済み" : "学習済みにする";
        }
        labelLearned();
        learned.addEventListener("click", function () {
          var index = progress.learnedIds.indexOf(entry.id);
          if (index === -1) progress.learnedIds.push(entry.id);
          else progress.learnedIds.splice(index, 1);
          rememberEntry(entry);
          labelLearned();
          updateLearned(visible);
        });
        item.appendChild(learned);
        makeAudioTarget(item, entry.hanzi);
        item.addEventListener("click", function () { rememberEntry(entry); });
        fragment.appendChild(item);
      });
      list.replaceChildren(fragment);
      empty.hidden = matched > 0;
      if (needle) status.textContent = matched + " 語が見つかりました / 全 " + listWords.length + " 語";
      markButtons();
    }

    search.addEventListener("input", function () {
      dismissResume();
      clear.hidden = !search.value;
      searchQueries[level] = search.value;
      draw(search.value);
    });
    orderSelect.addEventListener("change", function () {
      dismissResume();
      preferences.wordOrder = orderSelect.value;
      savePreferences();
      shuffleButton.hidden = preferences.wordOrder !== "random";
      listWords = orderedWords(false);
      position.batch = 0;
      position.entryId = listWords[0].id;
      draw(search.value);
      saveProgress();
    });
    shuffleButton.addEventListener("click", function () {
      dismissResume();
      listWords = orderedWords(true);
      position.batch = 0;
      position.entryId = listWords[0].id;
      draw(search.value);
      saveProgress();
    });
    function clearSearch() {
      search.value = "";
      searchQueries[level] = "";
      clear.hidden = true;
      draw("");
      search.focus();
    }
    function changeBatch(delta) {
      dismissResume();
      position.batch = Math.max(0, Math.min(Math.ceil(listWords.length / batchSize) - 1, position.batch + delta));
      position.entryId = listWords[position.batch * batchSize].id;
      stopAudio();
      refreshRecording();
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
    practiceHead.appendChild(el("h2", null, (practiceKind === "review" ? "復習 · " : "") + practiceTitle(view)));
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
      promptRow.appendChild(listenButton(question.prompt));
      makeAudioTarget(promptRow, question.prompt);
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
    if (practiceKind === "review" && progress.sessions[level + ":" + view + ":normal"]) {
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
        row.appendChild(text);
        row.appendChild(listenButton(entry.hanzi));
        makeAudioTarget(row, entry.hanzi);
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
    if (practiceKind === "review") panel.appendChild(renderPracticeActions());
    var restart = el("button", "next", "もう一度、10問");
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
      if (practiceKind === "review") progress.wrongIds = progress.wrongIds.filter(function (id) { return id !== question.entryId; });
    } else {
      mistakes.push(question);
      if (progress.wrongIds.indexOf(question.entryId) === -1) progress.wrongIds.push(question.entryId);
    }
    saveProgress();
    paintAnswer(app.querySelector(".practice"), index);
    app.querySelector("[data-next]").focus({ preventScroll: true });
    var review = app.querySelector(".review-controls");
    if (review) review.replaceWith(renderReviewControls());
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
      if (entry) feedback.insertAdjacentElement("afterend", listenButton(entry.hanzi));
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
  function rememberVisibleWord() {
    scrollTimer = null;
    if (view !== "list" || (searchQueries[level] || "").trim()) return;
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
  window.addEventListener("scroll", function () {
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
  document.addEventListener("visibilitychange", function () { if (document.hidden) flushProgress(); });
  if (view !== "list") activateRound();
  render();
})();

