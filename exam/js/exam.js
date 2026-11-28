/* HSK 1-6 Past Exam Training UI.
   Uses window.HSK, window.HSK_VOCAB, window.HSK_STUDY, window.HSK_EXAM_MANIFEST, and window.HSK_EXAM. */
(function () {
  "use strict";

  var STORAGE_PROGRESS = "hsk-exam-progress-v1";
  var STORAGE_PREFS = "hsk-exam-preferences-v1";
  var MAIN_PROGRESS = "hsk-study-progress-v1";
  var MAIN_PREFS = "hsk-study-preferences-v1";

  var manifest = window.HSK_EXAM_MANIFEST || { version: "1", sets: [] };
  var allSetsMeta = manifest.sets || [];
  var setsById = new Map(allSetsMeta.map(function (s) { return [s.id, s]; }));
  window.HSK_EXAM_SETS = window.HSK_EXAM_SETS || {};

  var vocabList = window.HSK && window.HSK_VOCAB ? window.HSK.prepareVocab(window.HSK_VOCAB) : [];
  var vocabIndex = window.HSK_EXAM.buildVocabIndex(vocabList);

  var params = new URLSearchParams(window.location.search);
  var progress = loadProgress();
  var prefs = loadPreferences(progress.level);

  var level = Number(params.get("level") || progress.level || 1);
  if (!Number.isInteger(level) || level < 1 || level > 6) level = 1;
  if (!prefs.pinyinChosen) prefs.showPinyin = level <= 2;

  var area = params.get("area") || (params.get("set") ? "workspace" : "sets");
  if (["sets", "workspace", "review"].indexOf(area) === -1) area = "sets";

  var activeSetId = params.get("set") || progress.activeSetId || "";
  var activeMode = params.get("mode") === "mock" ? "mock" : (params.get("mode") === "practice" ? "practice" : progress.activeMode);
  var activeSection = "all"; // "all" | "listening" | "reading" | "writing"
  var activeSetData = null;
  var loadingSet = false;
  var loadError = "";
  var settingsOpen = false;
  var qSheetOpen = false;
  var backupNotice = "";

  // Mock timer & HSK6 summary timer state
  var mockTimerId = null;
  var mockPaused = false;
  var hsk6Phase = "free"; // "free" | "reading" | "writing" | "compare"
  var hsk6RemainSec = 0;
  var hsk6TimerId = null;

  // Audio elements (exam listening MP3 + vocab single-word MP3)
  var examAudio = document.createElement("audio");
  examAudio.preload = "metadata";
  examAudio.setAttribute("data-exam-audio", "");
  document.body.appendChild(examAudio);

  var wordAudio = document.createElement("audio");
  wordAudio.preload = "none";
  wordAudio.setAttribute("data-word-audio", "");
  document.body.appendChild(wordAudio);

  var app = document.getElementById("exam-app");
  var vocabDrawer = document.getElementById("vocab-drawer");

  function loadProgress(source) {
    var saved = source;
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem(STORAGE_PROGRESS)); } catch (e) {}
    }
    if (!saved) {
      var fallbackLevel = 1;
      try {
        var mainSaved = JSON.parse(localStorage.getItem(MAIN_PROGRESS));
        if (mainSaved && Number.isInteger(mainSaved.level) && mainSaved.level >= 1 && mainSaved.level <= 6) {
          fallbackLevel = mainSaved.level;
        }
      } catch (e2) {}
      saved = { level: fallbackLevel };
    }
    return window.HSK_EXAM.sanitizeProgress(saved);
  }

  function saveProgress() {
    progress.level = level;
    progress.activeSetId = activeSetId;
    progress.activeMode = activeMode;
    progress.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_PROGRESS, JSON.stringify(progress)); } catch (e) {}
  }

  function loadPreferences(initialLevel, source) {
    var saved = source;
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem(STORAGE_PREFS)); } catch (e) {}
    }
    var mainPrefs = {};
    try { mainPrefs = JSON.parse(localStorage.getItem(MAIN_PREFS)) || {}; } catch (e2) {}
    saved = saved && typeof saved === "object" ? saved : {};
    var speed = typeof saved.speed === "number" ? saved.speed : (typeof mainPrefs.speed === "number" ? mainPrefs.speed : 1);
    if ([0.5, 0.75, 1, 1.25, 1.5].indexOf(speed) === -1) speed = 1;
    var pinyinChosen = typeof saved.showPinyin === "boolean" && saved.pinyinChosen !== false;
    return {
      speed: speed,
      showPinyin: pinyinChosen ? saved.showPinyin : initialLevel <= 2,
      pinyinChosen: pinyinChosen,
      tapVocab: saved.tapVocab !== false
    };
  }

  function savePreferences() {
    try { localStorage.setItem(STORAGE_PREFS, JSON.stringify(prefs)); } catch (e) {}
  }

  function syncUrl() {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set("level", String(level));
      if (area === "workspace" && activeSetId) {
        url.searchParams.set("set", activeSetId);
        url.searchParams.set("mode", activeMode);
      } else {
        url.searchParams.delete("set");
        url.searchParams.delete("mode");
      }
      if (area === "review") url.searchParams.set("area", "review");
      else url.searchParams.delete("area");
      window.history.replaceState(null, "", url);
    } catch (e) {}
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function sessionKey(setId, mode) {
    return setId + ":" + mode;
  }

  function getSession(setObj, mode) {
    var key = sessionKey(setObj.id, mode);
    var cur = progress.sessions[key];
    if (!cur || typeof cur !== "object") {
      cur = {
        responses: {},
        checked: {},
        flagged: {},
        submitted: false,
        remainingSec: (setObj.durationMinutes || 60) * 60
      };
      progress.sessions[key] = cur;
    }
    cur.responses = cur.responses && typeof cur.responses === "object" ? cur.responses : {};
    cur.checked = cur.checked && typeof cur.checked === "object" ? cur.checked : {};
    cur.flagged = cur.flagged && typeof cur.flagged === "object" ? cur.flagged : {};
    if (!Number.isFinite(cur.remainingSec) || cur.remainingSec < 0) {
      cur.remainingSec = (setObj.durationMinutes || 60) * 60;
    }
    return cur;
  }

  function recordMistake(setId, qNum, lv) {
    var mKey = setId + ":" + qNum;
    progress.mistakes[mKey] = {
      setId: setId,
      q: qNum,
      level: lv,
      at: Date.now()
    };
  }

  function clearMistake(setId, qNum) {
    delete progress.mistakes[setId + ":" + qNum];
  }

  function mistakesForLevel(lv) {
    return Object.keys(progress.mistakes)
      .map(function (k) { return progress.mistakes[k]; })
      .filter(function (m) { return m && m.level === lv && setsById.has(m.setId); })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  }

  function loadSetScript(setId) {
    if (window.HSK_EXAM_SETS[setId]) {
      return Promise.resolve(window.HSK_EXAM_SETS[setId]);
    }
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "data/sets/" + encodeURIComponent(setId) + ".js?v=" + encodeURIComponent(manifest.version || "1");
      script.onload = function () {
        if (window.HSK_EXAM_SETS[setId]) resolve(window.HSK_EXAM_SETS[setId]);
        else reject(new Error("データが見つかりませんでした: " + setId));
      };
      script.onerror = function () {
        reject(new Error("試験データの読み込みに失敗しました: " + setId));
      };
      document.head.appendChild(script);
    });
  }

  function stopTimers() {
    if (mockTimerId) {
      clearInterval(mockTimerId);
      mockTimerId = null;
    }
    if (hsk6TimerId) {
      clearInterval(hsk6TimerId);
      hsk6TimerId = null;
    }
  }

  function stopAllAudio() {
    try { examAudio.pause(); } catch (e) {}
    try { wordAudio.pause(); } catch (e2) {}
  }

  function startMockTimer() {
    if (mockTimerId) clearInterval(mockTimerId);
    if (!activeSetData || area !== "workspace" || activeMode !== "mock") return;
    var sess = getSession(activeSetData, "mock");
    if (sess.submitted) return;
    mockTimerId = setInterval(function () {
      if (mockPaused || sess.submitted || area !== "workspace" || activeMode !== "mock") return;
      sess.remainingSec = Math.max(0, (sess.remainingSec || 0) - 1);
      var timerNode = app.querySelector("[data-mock-timer]");
      if (timerNode) {
        timerNode.textContent = "⏱ " + window.HSK_EXAM.formatDurationClock(sess.remainingSec);
        timerNode.classList.toggle("is-low", sess.remainingSec <= 300);
      }
      if (sess.remainingSec % 10 === 0) saveProgress();
      if (sess.remainingSec <= 0) {
        submitMockExam();
      }
    }, 1000);
  }

  function submitMockExam() {
    if (!activeSetData) return;
    var sess = getSession(activeSetData, "mock");
    sess.submitted = true;
    if (mockTimerId) {
      clearInterval(mockTimerId);
      mockTimerId = null;
    }
    var report = window.HSK_EXAM.scoreExam(activeSetData, sess.responses);
    report.wrongNumbers.forEach(function (qn) {
      recordMistake(activeSetData.id, qn, activeSetData.level);
    });
    var prev = progress.completed[activeSetData.id];
    progress.completed[activeSetData.id] = {
      bestScore: prev && prev.bestScore > report.totalScaled ? prev.bestScore : report.totalScaled,
      lastScore: report.totalScaled,
      maxScore: report.maxScaled,
      passed: report.passed || !!(prev && prev.passed),
      completedAt: Date.now()
    };
    saveProgress();
    render();
    var repEl = app.querySelector(".score-report");
    if (repEl) repEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openSet(setId, mode) {
    var meta = setsById.get(setId);
    if (!meta) return;
    stopTimers();
    stopAllAudio();
    level = meta.level;
    if (!prefs.pinyinChosen) prefs.showPinyin = level <= 2;
    activeSetId = setId;
    activeMode = mode === "mock" ? "mock" : "practice";
    activeSection = "all";
    hsk6Phase = "free";
    mockPaused = false;
    area = "workspace";
    loadingSet = true;
    loadError = "";
    saveProgress();
    syncUrl();
    render();

    loadSetScript(setId).then(function (data) {
      if (activeSetId !== setId) return;
      activeSetData = data;
      loadingSet = false;
      if (data.hasAudio && data.audio) {
        if (!examAudio.src || examAudio.getAttribute("data-src-id") !== data.id) {
          examAudio.src = data.audio + "?v=" + encodeURIComponent(manifest.version || "1");
          examAudio.setAttribute("data-src-id", data.id);
        }
        examAudio.playbackRate = prefs.speed;
      } else {
        examAudio.removeAttribute("src");
        examAudio.removeAttribute("data-src-id");
      }
      render();
      if (activeMode === "mock") startMockTimer();
      window.scrollTo(0, 0);
    }).catch(function (err) {
      loadingSet = false;
      loadError = err.message || "読み込みエラー";
      render();
    });
  }

  /* Vocabulary Tap Lookup */
  function playWordEntry(entry) {
    if (!entry || !window.HSK) return;
    try {
      wordAudio.pause();
      wordAudio.src = "../" + window.HSK.audioPlaybackSrc(entry);
      wordAudio.playbackRate = prefs.speed;
      var p = wordAudio.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function showVocabDrawer(hanzi, entries) {
    if (!entries || !entries.length) return;
    vocabDrawer.textContent = "";
    var head = el("div", "vocab-drawer-head");
    var title = el("strong", null, "語彙辞書（HSK単語サイト連携）");
    var closeBtn = el("button", "btn-ghost", "閉じる ✕");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () { vocabDrawer.hidden = true; });
    head.appendChild(title);
    head.appendChild(closeBtn);
    vocabDrawer.appendChild(head);

    entries.forEach(function (entry) {
      var row = el("div", "vocab-entry");
      var info = el("div");
      var top = el("div");
      var hz = el("span", "vocab-hanzi", entry.hanzi);
      hz.lang = "zh-CN";
      top.appendChild(hz);
      top.appendChild(el("span", "vocab-py", entry.pinyin));
      top.appendChild(el("span", "badge past", "HSK " + entry.level));
      info.appendChild(top);
      info.appendChild(el("p", "vocab-gloss", "【" + entry.pos + "】 " + entry.gloss));
      row.appendChild(info);
      var playBtn = el("button", "btn-secondary", "🔊 発音");
      playBtn.type = "button";
      playBtn.addEventListener("click", function () { playWordEntry(entry); });
      row.appendChild(playBtn);
      vocabDrawer.appendChild(row);
    });

    vocabDrawer.hidden = false;
    playWordEntry(entries[0]);
  }

  function renderChineseRichText(text, className, allowTap) {
    var box = el("div", className || "zh-block");
    box.lang = "zh-CN";
    if (!allowTap || !prefs.tapVocab) {
      box.textContent = text;
      return box;
    }
    var segs = window.HSK_EXAM.segmentTextWithVocab(text, vocabIndex);
    segs.forEach(function (seg) {
      if (!seg.entries) {
        box.appendChild(document.createTextNode(seg.text));
      } else {
        var span = el("span", "zh-word-hit", seg.text);
        span.addEventListener("click", function (ev) {
          ev.stopPropagation();
          showVocabDrawer(seg.text, seg.entries);
        });
        box.appendChild(span);
      }
    });
    return box;
  }

  /* Masthead & Sidebar */
  function renderMasthead() {
    var header = el("header", "masthead");
    var seal = el("div", "brand-seal", "真");
    seal.lang = "zh-CN";
    seal.setAttribute("aria-hidden", "true");
    header.appendChild(seal);

    var copy = el("div", "masthead-copy");
    copy.appendChild(el("p", "eyebrow", "HSK 過去問・公式サンプル · 1–6級"));
    copy.appendChild(el("h1", null, "本番の形式で、実力を試す。"));
    copy.appendChild(el("p", "masthead-sub", "全54セット（4,591問）収録。パート別練習・タイマー模試・リスニング原文・語彙辞書に対応。"));

    var links = el("div", "nav-links");
    var backVocab = el("a", "nav-pill is-vocab", "← HSK語彙サイトにもどる");
    backVocab.href = "../?level=" + encodeURIComponent(String(level));
    backVocab.setAttribute("data-back-vocab", "");
    links.appendChild(backVocab);

    var toGame = el("a", "nav-pill", "🎮 HSKもじバトル");
    toGame.href = "../game/?level=" + encodeURIComponent(String(level));
    links.appendChild(toGame);

    var toRpg = el("a", "nav-pill", "🗺️ 汉字勇者 RPG");
    toRpg.href = "../rpg/?level=" + encodeURIComponent(String(level));
    links.appendChild(toRpg);

    copy.appendChild(links);
    header.appendChild(copy);

    var note = el("div", "masthead-note");
    note.appendChild(el("strong", null, String(allSetsMeta.length)));
    note.appendChild(el("span", null, "収録試験セット / HSK 1–6"));
    header.appendChild(note);
    return header;
  }

  function renderSidebar() {
    var aside = el("aside", "exam-sidebar");
    aside.appendChild(el("p", "sidebar-title", "級を選ぶ"));
    var lvGroup = el("div", "levels");
    lvGroup.setAttribute("role", "group");
    lvGroup.setAttribute("aria-label", "HSKの級");

    for (var n = 1; n <= 6; n += 1) {
      (function (lv) {
        var setsInLv = allSetsMeta.filter(function (s) { return s.level === lv; });
        var doneInLv = setsInLv.filter(function (s) { return !!progress.completed[s.id]; }).length;
        var btn = el("button");
        btn.type = "button";
        btn.setAttribute("data-level", String(lv));
        btn.setAttribute("aria-pressed", lv === level ? "true" : "false");
        btn.appendChild(el("strong", null, "HSK " + lv));
        btn.appendChild(el("span", "level-meta", (doneInLv ? doneInLv + "/" : "") + setsInLv.length + " セット"));
        btn.addEventListener("click", function () {
          if (level === lv && area === "sets") return;
          stopTimers();
          stopAllAudio();
          level = lv;
          if (!prefs.pinyinChosen) prefs.showPinyin = level <= 2;
          if (area === "workspace" && (!activeSetData || activeSetData.level !== lv)) {
            area = "sets";
          }
          saveProgress();
          syncUrl();
          render();
        });
        lvGroup.appendChild(btn);
      })(n);
    }
    aside.appendChild(lvGroup);

    var areas = el("nav", "nav-areas");
    areas.setAttribute("aria-label", "トレーニングメニュー");
    var missCount = mistakesForLevel(level).length;
    var activeMeta = activeSetId ? setsById.get(activeSetId) : null;

    var areaSpecs = [
      ["sets", "試験一覧", "セットを選んで始める", false],
      ["workspace", "演習画面", activeMeta ? activeMeta.code + " を開く" : "セット未選択", !activeMeta],
      ["review", "復習ノート", missCount ? ("間違えた問題 " + missCount + " 問") : "記録なし", false]
    ];

    areaSpecs.forEach(function (spec) {
      var btn = el("button", "area-button");
      btn.type = "button";
      btn.disabled = spec[3];
      btn.setAttribute("data-area", spec[0]);
      btn.setAttribute("aria-pressed", area === spec[0] ? "true" : "false");
      btn.appendChild(el("strong", null, spec[1]));
      btn.appendChild(el("span", null, spec[2]));
      btn.addEventListener("click", function () {
        if (area === spec[0]) return;
        stopTimers();
        stopAllAudio();
        if (spec[0] === "workspace" && activeSetId) {
          openSet(activeSetId, activeMode);
          return;
        }
        area = spec[0];
        syncUrl();
        render();
      });
      areas.appendChild(btn);
    });
    aside.appendChild(areas);

    aside.appendChild(renderSettings());
    return aside;
  }

  function renderSettings() {
    var details = el("details", "exam-settings");
    details.open = settingsOpen;
    details.addEventListener("toggle", function () { settingsOpen = details.open; });

    var summary = el("summary", "settings-summary");
    summary.appendChild(el("span", null, "学習設定・バックアップ"));
    details.appendChild(summary);

    var body = el("div", "settings-body");

    var speedRow = el("label", "setting-row");
    speedRow.appendChild(el("span", null, "再生速度"));
    var speedSel = el("select", "setting-select");
    speedSel.setAttribute("aria-label", "音声の再生速度");
    [0.5, 0.75, 1, 1.25, 1.5].forEach(function (v) {
      var opt = el("option", null, v + "×");
      opt.value = String(v);
      speedSel.appendChild(opt);
    });
    speedSel.value = String(prefs.speed);
    speedSel.addEventListener("change", function () {
      prefs.speed = Number(speedSel.value);
      examAudio.playbackRate = prefs.speed;
      savePreferences();
    });
    speedRow.appendChild(speedSel);
    body.appendChild(speedRow);

    var pyRow = el("label", "setting-row is-check");
    var pyCheck = el("input");
    pyCheck.type = "checkbox";
    pyCheck.checked = prefs.showPinyin;
    pyCheck.setAttribute("data-setting", "showPinyin");
    pyCheck.addEventListener("change", function () {
      prefs.showPinyin = pyCheck.checked;
      prefs.pinyinChosen = true;
      savePreferences();
      document.body.classList.toggle("hide-pinyin", !prefs.showPinyin);
    });
    pyRow.appendChild(pyCheck);
    pyRow.appendChild(el("span", null, "ピンイン補助を表示"));
    body.appendChild(pyRow);

    var vocabRow = el("label", "setting-row is-check");
    var vocabCheck = el("input");
    vocabCheck.type = "checkbox";
    vocabCheck.checked = prefs.tapVocab;
    vocabCheck.setAttribute("data-setting", "tapVocab");
    vocabCheck.addEventListener("change", function () {
      prefs.tapVocab = vocabCheck.checked;
      savePreferences();
      render();
    });
    vocabRow.appendChild(vocabCheck);
    vocabRow.appendChild(el("span", null, "中国語タップで辞書表示"));
    body.appendChild(vocabRow);

    // Backup export / import
    var backup = el("div", "backup-box");
    backup.appendChild(el("p", null, "演習履歴・模試スコア・復習ノートをJSONファイルに保存・復元できます。"));
    var bActions = el("div", "backup-actions");
    var exportBtn = el("button", "btn-secondary", "記録を書き出す");
    exportBtn.type = "button";
    exportBtn.setAttribute("data-export-exam", "");
    exportBtn.addEventListener("click", function () {
      saveProgress();
      var payload = {
        format: "hsk-exam-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        progress: progress,
        preferences: prefs
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "hsk-exam-" + (window.HSK_STUDY ? window.HSK_STUDY.todayKey() : "backup") + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      backupNotice = "記録を書き出しました。";
      render();
    });
    bActions.appendChild(exportBtn);

    var importLabel = el("label", "file-btn");
    importLabel.appendChild(el("span", null, "記録ファイルを読み込む"));
    var fileIn = el("input");
    fileIn.type = "file";
    fileIn.accept = ".json,application/json";
    fileIn.addEventListener("change", async function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      try {
        var parsed = JSON.parse(await f.text());
        if (!parsed || parsed.format !== "hsk-exam-backup" || !parsed.progress) {
          throw new Error("bad format");
        }
        progress = loadProgress(parsed.progress);
        prefs = loadPreferences(progress.level, parsed.preferences);
        level = progress.level;
        saveProgress();
        savePreferences();
        backupNotice = "記録を読み込みました。";
        render();
      } catch (err) {
        backupNotice = "有効なHSK真題バックアップファイルを選んでください。";
        render();
      }
    });
    importLabel.appendChild(fileIn);
    bActions.appendChild(importLabel);
    backup.appendChild(bActions);
    if (backupNotice) {
      var note = el("p", null, backupNotice);
      note.style.marginTop = "8px";
      backup.appendChild(note);
    }
    body.appendChild(backup);

    details.appendChild(body);
    return details;
  }

  /* Area 1: Exam Sets List */
  function renderSetsView() {
    var panel = el("section", "panel");
    var sets = allSetsMeta.filter(function (s) { return s.level === level; });
    var totalQs = sets.reduce(function (acc, s) { return acc + s.totalQuestions; }, 0);
    var doneCount = sets.filter(function (s) { return !!progress.completed[s.id]; }).length;
    var mistakes = mistakesForLevel(level);

    var header = el("div", "panel-header");
    var hLeft = el("div");
    hLeft.appendChild(el("p", "eyebrow", "過去問・サンプル試験を選ぶ"));
    hLeft.appendChild(el("h2", null, "HSK " + level + "級 真題トレーニング"));
    header.appendChild(hLeft);
    panel.appendChild(header);

    var stats = el("div", "level-summary-bar");
    [
      ["収録セット", sets.length + " 回分"],
      ["収録問題数", totalQs.toLocaleString("ja-JP") + " 問"],
      ["模試クリア", doneCount + " / " + sets.length],
      ["復習ノート", mistakes.length + " 問"]
    ].forEach(function (st) {
      var chip = el("div", "stat-chip");
      chip.appendChild(el("span", null, st[0]));
      chip.appendChild(el("strong", null, st[1]));
      stats.appendChild(chip);
    });
    panel.appendChild(stats);

    var grid = el("div", "sets-grid");
    sets.forEach(function (s) {
      var comp = progress.completed[s.id];
      var pracSess = progress.sessions[sessionKey(s.id, "practice")];
      var pracCount = pracSess && pracSess.responses ? Object.keys(pracSess.responses).filter(function (k) { return !!pracSess.responses[k]; }).length : 0;

      var card = el("article", comp ? "set-card is-done" : "set-card");
      card.setAttribute("data-set-card", s.id);

      var topWrap = el("div");
      var topRow = el("div", "set-top");
      var badges = el("div", "set-badges");
      badges.appendChild(el("span", s.kind === "sample" ? "badge sample" : "badge past", s.kind === "sample" ? "公式サンプル" : "過去問"));
      if (s.hasAudio) {
        badges.appendChild(el("span", "badge past", "🎧 音声つき"));
      } else {
        badges.appendChild(el("span", "badge no-audio", "📖 読解・作文中心"));
      }
      if (comp) {
        badges.appendChild(el("span", "badge score-pass", "最高 " + comp.bestScore + "/" + comp.maxScore + "点"));
      }
      topRow.appendChild(badges);
      topWrap.appendChild(topRow);

      topWrap.appendChild(el("h3", null, s.titleJa));
      var metaP = el("p", "set-meta");
      metaP.appendChild(el("span", "meta-item", "全" + s.totalQuestions + "問（目安 " + s.durationMinutes + "分）"));
      s.sections.forEach(function (sec) {
        metaP.appendChild(document.createTextNode(" · "));
        metaP.appendChild(el("span", "meta-item", sec.titleJa + " " + sec.count + "問"));
      });
      topWrap.appendChild(metaP);
      if (pracCount > 0) {
        topWrap.appendChild(el("p", "set-progress-text", "練習モード解答済み：" + pracCount + " / " + s.totalQuestions + " 問"));
      }
      card.appendChild(topWrap);

      var actions = el("div", "set-actions");
      var btnPrac = el("button", "btn-aux", "パート練習");
      btnPrac.type = "button";
      btnPrac.setAttribute("data-start-practice", s.id);
      btnPrac.addEventListener("click", function () { openSet(s.id, "practice"); });

      var btnMock = el("button", "btn-primary", "本番タイマー模試");
      btnMock.type = "button";
      btnMock.setAttribute("data-start-mock", s.id);
      btnMock.addEventListener("click", function () { openSet(s.id, "mock"); });

      actions.appendChild(btnPrac);
      actions.appendChild(btnMock);
      card.appendChild(actions);
      grid.appendChild(card);
    });

    panel.appendChild(grid);
    return panel;
  }

  /* Sticky Audio Bar */
  function renderAudioBar(setObj) {
    if (!setObj.hasAudio || !setObj.audio) {
      return el("div", "audio-missing-note", "このセットは音声ファイル未収録のため、読解・作文パートの演習およびリスニング選択肢の確認にご利用ください。");
    }
    var bar = el("div", "audio-bar");
    bar.setAttribute("data-audio-bar", "");

    var playBtn = el("button", "audio-btn is-play", examAudio.paused ? "▶ 音声再生" : "⏸ 一時停止");
    playBtn.type = "button";
    playBtn.setAttribute("data-audio-toggle", "");
    playBtn.addEventListener("click", function () {
      if (examAudio.paused) {
        examAudio.playbackRate = prefs.speed;
        var p = examAudio.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        examAudio.pause();
      }
    });
    bar.appendChild(playBtn);

    [-10, -5, 5, 10].forEach(function (delta) {
      var seekBtn = el("button", "audio-btn", (delta > 0 ? "+" : "") + delta + "秒");
      seekBtn.type = "button";
      seekBtn.addEventListener("click", function () {
        var dur = Number.isFinite(examAudio.duration) ? examAudio.duration : 99999;
        examAudio.currentTime = Math.max(0, Math.min(dur, (examAudio.currentTime || 0) + delta));
      });
      bar.appendChild(seekBtn);
    });

    var progWrap = el("div", "audio-progress-wrap");
    var slider = el("input", "audio-seek");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(Math.max(1, Math.floor(examAudio.duration || setObj.audioDuration || 100)));
    slider.value = String(Math.floor(examAudio.currentTime || 0));
    slider.setAttribute("aria-label", "リスニング再生位置");

    var timeText = el("span", "audio-time");
    function formatTimes() {
      var cur = examAudio.currentTime || 0;
      var total = Number.isFinite(examAudio.duration) && examAudio.duration > 0 ? examAudio.duration : (setObj.audioDuration || 0);
      slider.max = String(Math.max(1, Math.floor(total || 100)));
      if (!slider.matches(":active")) slider.value = String(Math.floor(cur));
      timeText.textContent = window.HSK_EXAM.formatDurationClock(cur) + " / " + window.HSK_EXAM.formatDurationClock(total);
      playBtn.textContent = examAudio.paused ? "▶ 音声再生" : "⏸ 一時停止";
    }
    formatTimes();

    slider.addEventListener("input", function () {
      examAudio.currentTime = Number(slider.value);
    });

    examAudio.onloadedmetadata = formatTimes;
    examAudio.ontimeupdate = formatTimes;
    examAudio.onplay = formatTimes;
    examAudio.onpause = formatTimes;
    examAudio.onended = formatTimes;

    progWrap.appendChild(slider);
    progWrap.appendChild(timeText);
    bar.appendChild(progWrap);

    var speedSel = el("select", "setting-select");
    speedSel.setAttribute("aria-label", "リスニング速度");
    [0.5, 0.75, 1, 1.25, 1.5].forEach(function (v) {
      var o = el("option", null, v + "×");
      o.value = String(v);
      speedSel.appendChild(o);
    });
    speedSel.value = String(prefs.speed);
    speedSel.addEventListener("change", function () {
      prefs.speed = Number(speedSel.value);
      examAudio.playbackRate = prefs.speed;
      savePreferences();
    });
    bar.appendChild(speedSel);

    return bar;
  }

  function renderSharedGroup(group, allowVocabTap) {
    var box = el("div", "shared-group");
    var rStart = group.range[0];
    var rEnd = group.range[1];
    box.appendChild(el("p", "shared-label", "第 " + rStart + "〜" + rEnd + " 問 共通資料"));

    if (group.poolType === "image") {
      var imgGrid = el("div", "pool-images");
      (group.pool || []).forEach(function (item) {
        var card = el("div", "pool-img-card");
        card.appendChild(el("span", "pool-key", item.key));
        if (item.image) {
          var img = document.createElement("img");
          img.src = item.image;
          img.alt = "選択肢 " + item.key;
          img.loading = "lazy";
          card.appendChild(img);
        }
        imgGrid.appendChild(card);
      });
      box.appendChild(imgGrid);
    } else if (group.poolType === "text") {
      if (group.passage) {
        box.appendChild(renderChineseRichText(group.passage, "shared-passage", allowVocabTap));
      }
      var txtList = el("div", "pool-texts");
      if (group.passage) txtList.style.marginTop = "12px";
      (group.pool || []).forEach(function (item) {
        var row = el("div", "pool-text-row");
        row.appendChild(el("span", "pool-key", item.key));
        var content = el("div");
        if (item.pinyin) content.appendChild(el("span", "py-line", item.pinyin));
        content.appendChild(renderChineseRichText(item.text, "choice-text", allowVocabTap));
        row.appendChild(content);
        txtList.appendChild(row);
      });
      box.appendChild(txtList);
    } else if (group.poolType === "passage") {
      var pBox = el("div", "shared-passage");
      if (group.image) {
        var pImg = document.createElement("img");
        pImg.className = "shared-passage-img";
        pImg.src = group.image;
        pImg.alt = "本文挿絵";
        pImg.loading = "lazy";
        pBox.appendChild(pImg);
      }
      var rich = renderChineseRichText(group.passage || "", "", allowVocabTap);
      while (rich.firstChild) pBox.appendChild(rich.firstChild);
      pBox.lang = "zh-CN";
      box.appendChild(pBox);
    }
    return box;
  }

  /* Single Question Card Renderer */
  function renderQuestionCard(setObj, q, sess, opts) {
    opts = opts || {};
    var qKey = String(q.n);
    var userVal = sess.responses[qKey] || "";
    var isMock = opts.mode === "mock";
    var isReviewPage = !!opts.isReview;

    // Determine whether grading feedback is visible for this question
    var showFeedback = false;
    if (isMock) {
      showFeedback = !!sess.submitted;
    } else {
      if (q.type === "scramble" || q.type === "char_input" || q.type === "essay") {
        showFeedback = !!sess.checked[qKey];
      } else {
        showFeedback = window.HSK_EXAM.isAnswered(q, userVal);
      }
    }

    var grade = showFeedback ? window.HSK_EXAM.gradeQuestion(q, userVal) : null;
    var cardClass = "q-card";
    if (showFeedback && grade && grade.gradable) {
      cardClass += grade.correct ? " is-right" : " is-wrong";
    }

    var card = el("article", cardClass);
    card.id = "q-" + setObj.id + "-" + q.n;
    card.setAttribute("data-q-num", qKey);

    var top = el("div", "q-top");
    var leftBadges = el("div", "set-badges");
    leftBadges.appendChild(el("span", "q-num", "問 " + q.n));
    if (isReviewPage) {
      leftBadges.appendChild(el("span", "badge past", setObj.code + " · " + (q.section === "listening" ? "リスニング" : q.section === "reading" ? "リーディング" : "ライティング")));
    }
    top.appendChild(leftBadges);

    if (!isReviewPage) {
      var flagBtn = el("button", "flag-btn", sess.flagged[qKey] ? "★ 見直し中" : "☆ 見直し");
      flagBtn.type = "button";
      flagBtn.setAttribute("aria-pressed", sess.flagged[qKey] ? "true" : "false");
      flagBtn.addEventListener("click", function () {
        sess.flagged[qKey] = !sess.flagged[qKey];
        saveProgress();
        render();
      });
      top.appendChild(flagBtn);
    } else {
      var removeBtn = el("button", "btn-secondary", "✓ 復習リストから外す");
      removeBtn.type = "button";
      removeBtn.setAttribute("data-clear-mistake", setObj.id + ":" + q.n);
      removeBtn.addEventListener("click", function () {
        clearMistake(setObj.id, q.n);
        saveProgress();
        render();
      });
      top.appendChild(removeBtn);
    }
    card.appendChild(top);

    var allowTapVocab = !isMock || !!sess.submitted;

    // Optional question image (excluding HSK6 summary)
    if (q.image) {
      var imgWrap = el("div", "q-image");
      var qImg = document.createElement("img");
      qImg.src = q.image;
      qImg.alt = "問 " + q.n + " の図";
      qImg.loading = "lazy";
      imgWrap.appendChild(qImg);
      card.appendChild(imgWrap);
    }

    // Optional prompt / passage text
    if (q.prompt && q.type !== "char_input") {
      if (q.promptPinyin) card.appendChild(el("span", "py-line", q.promptPinyin));
      card.appendChild(renderChineseRichText(q.prompt, "zh-block", allowTapVocab));
    }
    if (q.question) {
      if (q.questionPinyin) card.appendChild(el("span", "py-line", q.questionPinyin));
      card.appendChild(renderChineseRichText(q.question, "q-question", allowTapVocab));
    }

    function commitObjectiveAnswer(val) {
      if (isMock && sess.submitted) return;
      sess.responses[qKey] = val;
      if (!isMock) {
        var g = window.HSK_EXAM.gradeQuestion(q, val);
        if (g.gradable && !g.correct) {
          recordMistake(setObj.id, q.n, setObj.level);
        }
      }
      saveProgress();
      if (opts.onUpdate) opts.onUpdate(card);
      else replaceQuestionCard(card, setObj, q, sess, opts);
    }

    // Type-specific interactive controls
    if (q.type === "tf") {
      var tfGrid = el("div", "choices-grid");
      [["√", "正しい（√）"], ["×", "誤り（×）"]].forEach(function (pair) {
        var cBtn = el("button", "choice-btn");
        cBtn.type = "button";
        cBtn.setAttribute("data-choice", pair[0]);
        var selected = userVal === pair[0];
        cBtn.setAttribute("aria-pressed", selected ? "true" : "false");
        if (showFeedback) {
          if (q.answer === pair[0]) cBtn.classList.add("show-right");
          else if (selected) cBtn.classList.add("show-wrong");
        }
        cBtn.appendChild(el("span", "choice-key", pair[0]));
        cBtn.appendChild(el("span", "choice-text", pair[1]));
        cBtn.addEventListener("click", function () { commitObjectiveAnswer(pair[0]); });
        tfGrid.appendChild(cBtn);
      });
      card.appendChild(tfGrid);
    } else if (q.type === "mc") {
      var hasLongOpt = (q.options || []).some(function (o) { return (o.text || "").length > 16; });
      var mcGrid = el("div", hasLongOpt ? "choices-grid is-single-col" : "choices-grid");
      (q.options || []).forEach(function (opt) {
        var cBtn = el("button", opt.image ? "choice-btn is-img-choice" : "choice-btn");
        cBtn.type = "button";
        cBtn.setAttribute("data-choice", opt.key);
        var selected = userVal === opt.key;
        cBtn.setAttribute("aria-pressed", selected ? "true" : "false");
        if (showFeedback) {
          if (q.answer === opt.key) cBtn.classList.add("show-right");
          else if (selected) cBtn.classList.add("show-wrong");
        }
        cBtn.appendChild(el("span", "choice-key", opt.key));
        if (opt.image) {
          var oImg = document.createElement("img");
          oImg.className = "opt-img";
          oImg.src = opt.image;
          oImg.alt = "選択肢 " + opt.key;
          oImg.loading = "lazy";
          cBtn.appendChild(oImg);
        }
        if (opt.text) {
          var txtWrap = el("div");
          if (opt.pinyin) txtWrap.appendChild(el("span", "py-line", opt.pinyin));
          var cSpan = el("span", "choice-text", opt.text);
          cSpan.lang = "zh-CN";
          txtWrap.appendChild(cSpan);
          cBtn.appendChild(txtWrap);
        }
        cBtn.addEventListener("click", function () { commitObjectiveAnswer(opt.key); });
        mcGrid.appendChild(cBtn);
      });
      card.appendChild(mcGrid);
    } else if (q.type === "match") {
      var poolKeys = ["A", "B", "C", "D", "E", "F"];
      if (opts.group && Array.isArray(opts.group.pool) && opts.group.pool.length) {
        poolKeys = opts.group.pool.map(function (p) { return p.key; });
      }
      var matchGrid = el("div", "choices-grid is-compact");
      poolKeys.forEach(function (k) {
        var cBtn = el("button", "choice-btn is-match-key");
        cBtn.type = "button";
        cBtn.setAttribute("data-choice", k);
        cBtn.setAttribute("aria-label", "選択肢 " + k);
        var selected = userVal === k;
        cBtn.setAttribute("aria-pressed", selected ? "true" : "false");
        if (showFeedback) {
          if (q.answer === k) cBtn.classList.add("show-right");
          else if (selected) cBtn.classList.add("show-wrong");
        }
        cBtn.appendChild(el("span", "choice-key", k));
        cBtn.addEventListener("click", function () { commitObjectiveAnswer(k); });
        matchGrid.appendChild(cBtn);
      });
      card.appendChild(matchGrid);
    } else if (q.type === "order") {
      var clausesBox = el("div", "order-clauses");
      (q.options || []).forEach(function (opt) {
        var pickedIdx = userVal.indexOf(opt.key);
        var clBtn = el("button", pickedIdx !== -1 ? "clause-btn is-picked" : "clause-btn");
        clBtn.type = "button";
        clBtn.setAttribute("data-order-clause", opt.key);
        clBtn.appendChild(el("span", "choice-key", pickedIdx !== -1 ? String(pickedIdx + 1) : opt.key));
        var sp = el("span", null, opt.key + "：" + opt.text);
        sp.lang = "zh-CN";
        clBtn.appendChild(sp);
        clBtn.addEventListener("click", function () {
          if (isMock && sess.submitted) return;
          var nextVal = userVal;
          if (nextVal.length >= 3) nextVal = "";
          if (nextVal.indexOf(opt.key) === -1) {
            nextVal += opt.key;
            sess.responses[qKey] = nextVal;
            if (!isMock && nextVal.length === 3) {
              var g = window.HSK_EXAM.gradeQuestion(q, nextVal);
              if (!g.correct) recordMistake(setObj.id, q.n, setObj.level);
            }
            saveProgress();
            replaceQuestionCard(card, setObj, q, sess, opts);
          }
        });
        clausesBox.appendChild(clBtn);
      });
      card.appendChild(clausesBox);

      var ordBar = el("div", "order-preview");
      ordBar.appendChild(el("strong", null, "選んだ順序：" + (userVal ? userVal.split("").join(" → ") : "（A・B・C を順番にクリック）")));
      var resetOrd = el("button", "btn-secondary", "順序をクリア");
      resetOrd.type = "button";
      resetOrd.addEventListener("click", function () {
        if (isMock && sess.submitted) return;
        sess.responses[qKey] = "";
        saveProgress();
        replaceQuestionCard(card, setObj, q, sess, opts);
      });
      ordBar.appendChild(resetOrd);
      card.appendChild(ordBar);
    } else if (q.type === "scramble") {
      var bank = el("div", "scramble-bank");
      (q.tokens || []).forEach(function (tok) {
        var tBtn = el("button", "tile-btn", tok);
        tBtn.type = "button";
        tBtn.lang = "zh-CN";
        tBtn.addEventListener("click", function () {
          if (isMock && sess.submitted) return;
          sess.responses[qKey] = (sess.responses[qKey] || "") + tok;
          sess.checked[qKey] = false;
          saveProgress();
          replaceQuestionCard(card, setObj, q, sess, opts);
        });
        bank.appendChild(tBtn);
      });
      card.appendChild(bank);

      var inRow = el("div", "scramble-input-row");
      var inp = el("input", "zh-input");
      inp.type = "text";
      inp.lang = "zh-CN";
      inp.placeholder = "上の語句をタップするか、直接中国語の文を入力";
      inp.value = userVal;
      inp.disabled = isMock && sess.submitted;
      inp.addEventListener("input", function () {
        sess.responses[qKey] = inp.value;
        sess.checked[qKey] = false;
        saveProgress();
      });
      inRow.appendChild(inp);

      var clearScram = el("button", "btn-secondary", "クリア");
      clearScram.type = "button";
      clearScram.disabled = isMock && sess.submitted;
      clearScram.addEventListener("click", function () {
        sess.responses[qKey] = "";
        sess.checked[qKey] = false;
        saveProgress();
        replaceQuestionCard(card, setObj, q, sess, opts);
      });
      inRow.appendChild(clearScram);

      if (!isMock) {
        var checkBtn = el("button", "btn-aux", "答え合わせ");
        checkBtn.type = "button";
        checkBtn.setAttribute("data-check-writing", qKey);
        checkBtn.addEventListener("click", function () {
          if (!(sess.responses[qKey] || "").trim()) return;
          sess.checked[qKey] = true;
          var g = window.HSK_EXAM.gradeQuestion(q, sess.responses[qKey]);
          if (!g.correct) recordMistake(setObj.id, q.n, setObj.level);
          saveProgress();
          replaceQuestionCard(card, setObj, q, sess, opts);
        });
        inRow.appendChild(checkBtn);
      }
      card.appendChild(inRow);
    } else if (q.type === "char_input") {
      var pWrap = el("div", "zh-block");
      pWrap.lang = "zh-CN";
      pWrap.appendChild(document.createTextNode(q.prompt + " "));
      var pyBadge = el("span", "pinyin-badge", q.pinyinHint);
      pWrap.appendChild(pyBadge);
      card.appendChild(pWrap);

      var cRow = el("div", "char-input-row");
      var cIn = el("input", "char-box");
      cIn.type = "text";
      cIn.lang = "zh-CN";
      cIn.maxLength = 4;
      cIn.placeholder = "漢字";
      cIn.value = userVal;
      cIn.disabled = isMock && sess.submitted;
      cIn.addEventListener("input", function () {
        sess.responses[qKey] = cIn.value.trim();
        sess.checked[qKey] = false;
        saveProgress();
      });
      cRow.appendChild(cIn);

      if (!isMock) {
        var cCheck = el("button", "btn-aux", "答え合わせ");
        cCheck.type = "button";
        cCheck.setAttribute("data-check-writing", qKey);
        cCheck.addEventListener("click", function () {
          if (!(sess.responses[qKey] || "").trim()) return;
          sess.checked[qKey] = true;
          var g = window.HSK_EXAM.gradeQuestion(q, sess.responses[qKey]);
          if (!g.correct) recordMistake(setObj.id, q.n, setObj.level);
          saveProgress();
          replaceQuestionCard(card, setObj, q, sess, opts);
        });
        cRow.appendChild(cCheck);
      }
      card.appendChild(cRow);
    } else if (q.type === "essay") {
      // HSK6 Q101 authentic 10-min reading -> 35-min hidden-text summary workflow
      if (q.essayKind === "summary" && q.passage) {
        var phaseBar = el("div", "hsk6-phase-bar");
        if (hsk6Phase === "free") {
          phaseBar.appendChild(el("span", null, "本番方式（10分読解→本文非表示で35分要約）で練習できます。"));
          var start10 = el("button", "btn-aux", "⏱ 10分読解タイマーを開始");
          start10.type = "button";
          start10.addEventListener("click", function () {
            hsk6Phase = "reading";
            hsk6RemainSec = 10 * 60;
            if (hsk6TimerId) clearInterval(hsk6TimerId);
            hsk6TimerId = setInterval(function () {
              hsk6RemainSec = Math.max(0, hsk6RemainSec - 1);
              var n = app.querySelector("[data-hsk6-timer]");
              if (n) n.textContent = window.HSK_EXAM.formatDurationClock(hsk6RemainSec);
              if (hsk6RemainSec <= 0) {
                clearInterval(hsk6TimerId);
                hsk6TimerId = null;
                hsk6Phase = "writing";
                render();
              }
            }, 1000);
            render();
          });
          phaseBar.appendChild(start10);
        } else if (hsk6Phase === "reading") {
          var tSpan = el("strong", null, "読解残り時間：");
          var clock = el("span", null, window.HSK_EXAM.formatDurationClock(hsk6RemainSec));
          clock.setAttribute("data-hsk6-timer", "");
          tSpan.appendChild(clock);
          phaseBar.appendChild(tSpan);
          var hideNow = el("button", "btn-primary", "本文を隠して要約を始める");
          hideNow.type = "button";
          hideNow.addEventListener("click", function () {
            if (hsk6TimerId) { clearInterval(hsk6TimerId); hsk6TimerId = null; }
            hsk6Phase = "writing";
            render();
          });
          phaseBar.appendChild(hideNow);
        } else if (hsk6Phase === "writing") {
          phaseBar.appendChild(el("strong", null, "要約作成中（本番同様に元の文章を隠しています）"));
          var showAgain = el("button", "btn-secondary", "元の文章を再表示して見比べる");
          showAgain.type = "button";
          showAgain.addEventListener("click", function () {
            hsk6Phase = "compare";
            render();
          });
          phaseBar.appendChild(showAgain);
        } else {
          phaseBar.appendChild(el("span", null, "元の文章と自分の要約を見比べています。"));
          var hideAgain = el("button", "btn-secondary", "もう一度本文を隠す");
          hideAgain.type = "button";
          hideAgain.addEventListener("click", function () {
            hsk6Phase = "writing";
            render();
          });
          phaseBar.appendChild(hideAgain);
        }
        card.appendChild(phaseBar);

        if (hsk6Phase !== "writing") {
          card.appendChild(renderChineseRichText(q.passage, "shared-passage", allowTapVocab));
        }
      }

      var kwBox = null;
      if (Array.isArray(q.keywords) && q.keywords.length) {
        kwBox = el("div", "keyword-chips");
        q.keywords.forEach(function (kw) {
          var chip = el("span", userVal.indexOf(kw) !== -1 ? "kw-chip is-used" : "kw-chip", (userVal.indexOf(kw) !== -1 ? "✓ " : "") + kw);
          chip.lang = "zh-CN";
          chip.setAttribute("data-kw", kw);
          kwBox.appendChild(chip);
        });
        card.appendChild(kwBox);
      }

      var areaIn = el("textarea", q.essayKind === "summary" ? "essay-area is-long" : "essay-area");
      areaIn.lang = "zh-CN";
      areaIn.placeholder = q.essayKind === "summary" ? "1行目に標題を書き、続けて400字前後で要約文を入力してください…" : "ここに中国語の文・文章を入力してください…";
      areaIn.value = userVal;
      areaIn.disabled = isMock && sess.submitted;

      var foot = el("div", "essay-footer");
      var charStat = el("span", null, "文字数：" + window.HSK_EXAM.countChineseChars(userVal) + " 字" + (q.targetLength ? "（目安 " + q.targetLength + " 字前後）" : ""));

      areaIn.addEventListener("input", function () {
        var val = areaIn.value;
        sess.responses[qKey] = val;
        charStat.textContent = "文字数：" + window.HSK_EXAM.countChineseChars(val) + " 字" + (q.targetLength ? "（目安 " + q.targetLength + " 字前後）" : "");
        if (kwBox) {
          Array.prototype.forEach.call(kwBox.querySelectorAll("[data-kw]"), function (chip) {
            var kw = chip.getAttribute("data-kw");
            var used = val.indexOf(kw) !== -1;
            chip.className = used ? "kw-chip is-used" : "kw-chip";
            chip.textContent = (used ? "✓ " : "") + kw;
          });
        }
        saveProgress();
      });
      card.appendChild(areaIn);

      foot.appendChild(charStat);
      if (!isMock) {
        var refBtn = el("button", "btn-secondary", sess.checked[qKey] ? "解答例・チェックを閉じる" : "解答例・チェックを見る");
        refBtn.type = "button";
        refBtn.setAttribute("data-check-writing", qKey);
        refBtn.addEventListener("click", function () {
          sess.checked[qKey] = !sess.checked[qKey];
          saveProgress();
          replaceQuestionCard(card, setObj, q, sess, opts);
        });
        foot.appendChild(refBtn);
      }
      card.appendChild(foot);
    }

    function buildExplanationBox(exp, includeComparison) {
      var box = el("div", "ja-explain-box");
      box.setAttribute("data-ja-explanation", "");

      var head = el("div", "ja-explain-head");
      head.appendChild(el("span", "ja-explain-badge", "日本語解説"));
      box.appendChild(head);

      box.appendChild(el("p", "ja-explain-text", exp.summaryJa));

      if (includeComparison && exp.comparison) {
        var cmp = el("div", "ja-compare");
        var uRow = el("div", "ja-compare-row is-user");
        uRow.appendChild(el("span", "ja-compare-label", exp.comparison.userLabel));
        uRow.appendChild(renderChineseRichText(exp.comparison.userText, "ja-compare-val", true));
        cmp.appendChild(uRow);

        var aRow = el("div", "ja-compare-row is-ans");
        aRow.appendChild(el("span", "ja-compare-label", exp.comparison.answerLabel));
        aRow.appendChild(renderChineseRichText(exp.comparison.answerText, "ja-compare-val", true));
        cmp.appendChild(aRow);
        box.appendChild(cmp);
      }

      if (exp.assembledSentence) {
        var asm = el("div", "ja-assembled");
        asm.appendChild(el("span", "ja-compare-label", "完成文"));
        asm.appendChild(renderChineseRichText(exp.assembledSentence, "ja-compare-val", true));
        box.appendChild(asm);
      }

      if (exp.grammarHints && exp.grammarHints.length) {
        var gNote = el("p", "ja-grammar-note");
        gNote.appendChild(el("strong", null, "文法ポイント："));
        gNote.appendChild(document.createTextNode(exp.grammarHints.join(" ／ ")));
        box.appendChild(gNote);
      }

      if (exp.keyVocab && exp.keyVocab.length) {
        var vWrap = el("div", "ja-vocab-section");
        vWrap.appendChild(el("span", "ja-vocab-title", "ポイント語彙（タップで発音）"));
        var vList = el("div", "ja-vocab-list");
        exp.keyVocab.forEach(function (v) {
          var chip = el("button", "ja-vocab-chip");
          chip.type = "button";
          chip.setAttribute("data-explain-vocab", v.hanzi);
          chip.appendChild(el("span", "ja-vocab-snd", "🔊"));
          var hz = el("span", "ja-vocab-hz", v.hanzi);
          hz.lang = "zh-CN";
          chip.appendChild(hz);
          if (v.pinyin) chip.appendChild(el("span", "ja-vocab-py", v.pinyin));
          if (v.meaning) chip.appendChild(el("span", "ja-vocab-ja", v.meaning));
          chip.addEventListener("click", function () { playWordEntry(v.entry); });
          vList.appendChild(chip);
        });
        vWrap.appendChild(vList);
        box.appendChild(vWrap);
      }

      return box;
    }

    // Feedback box (Practice mode after answering, or Mock mode after submitting)
    if (showFeedback && grade) {
      var fbClass = "q-feedback " + (grade.gradable ? (grade.correct ? "is-right" : "is-wrong") : "is-info");
      var fb = el("div", fbClass);
      fb.setAttribute("data-q-feedback", grade.gradable ? (grade.correct ? "right" : "wrong") : "info");
      var exp = window.HSK_EXAM.buildWrongExplanation(q, userVal, {
        group: opts.group || null,
        vocabIndex: vocabIndex,
        level: setObj.level
      });

      if (grade.gradable) {
        var msg = grade.correct ? "✓ 正解！" : ("✗ 不正解　｜　正解：" + q.answer);
        if (q.altAnswers && q.altAnswers.length) {
          msg += "（別解：" + q.altAnswers.join(" ／ ") + "）";
        }
        fb.appendChild(el("strong", null, msg));

        if (!grade.correct) {
          fb.appendChild(buildExplanationBox(exp, true));
        } else if (q.explanationJa) {
          var rightDet = el("details", "ja-explain-toggle");
          rightDet.appendChild(el("summary", null, "💡 日本語解説を確認する"));
          rightDet.appendChild(buildExplanationBox(exp, false));
          fb.appendChild(rightDet);
        }
      } else {
        var infoLines = [];
        if (grade.keywordsTotal > 0) {
          infoLines.push("指定語句の使用：" + grade.keywordsUsed + " / " + grade.keywordsTotal + " 語");
        }
        infoLines.push("入力文字数：" + grade.charCount + " 字");
        fb.appendChild(el("strong", null, infoLines.join("　｜　")));
        if (q.answer) {
          var modelP = el("p", null, "公式参考答案：" + q.answer);
          modelP.lang = "zh-CN";
          modelP.style.margin = "8px 0 0";
          fb.appendChild(modelP);
        } else {
          var rubricP = el("p", null, "※ 公式解答集では自由記述（略）の設問です。内容の一貫性・語彙・文字数の目安を確認しましょう。");
          rubricP.style.margin = "8px 0 0";
          fb.appendChild(rubricP);
        }
        fb.appendChild(buildExplanationBox(exp, false));
      }
      card.appendChild(fb);
    }

    // Listening transcript (available in Practice mode anytime, or in Mock mode after submission)
    if (q.transcript && (!isMock || sess.submitted)) {
      var sc = el("details", "q-script");
      if (showFeedback && grade && !grade.correct) sc.open = true;
      var scSum = el("summary", null, "🎧 リスニング原文（スクリプト）を表示");
      sc.appendChild(scSum);
      sc.appendChild(renderChineseRichText(q.transcript, "q-script-body", true));
      card.appendChild(sc);
    }

    return card;
  }

  function replaceQuestionCard(oldCard, setObj, q, sess, opts) {
    var fresh = renderQuestionCard(setObj, q, sess, opts);
    oldCard.replaceWith(fresh);
    refreshWorkspaceCounters();
  }

  function refreshWorkspaceCounters() {
    if (!activeSetData || area !== "workspace") return;
    var sess = getSession(activeSetData, activeMode);
    var statusNode = app.querySelector("[data-workspace-status]");
    if (statusNode) {
      var answeredCount = activeSetData.questions.filter(function (q) {
        return window.HSK_EXAM.isAnswered(q, sess.responses[String(q.n)]);
      }).length;
      if (activeMode === "practice") {
        var rightCount = activeSetData.questions.filter(function (q) {
          var r = sess.responses[String(q.n)];
          if (!window.HSK_EXAM.isAnswered(q, r)) return false;
          if ((q.type === "scramble" || q.type === "char_input") && !sess.checked[String(q.n)]) return false;
          var g = window.HSK_EXAM.gradeQuestion(q, r);
          return g.gradable && g.correct;
        }).length;
        statusNode.textContent = "解答 " + answeredCount + " / " + activeSetData.totalQuestions + " 問 · 正解 " + rightCount;
      } else {
        statusNode.textContent = "解答済み " + answeredCount + " / " + activeSetData.totalQuestions + " 問";
      }
    }
    var sheetNode = app.querySelector("[data-q-sheet-grid]");
    if (sheetNode) {
      var freshDots = buildQuestionDots(activeSetData, sess);
      sheetNode.replaceWith(freshDots);
    }
  }

  function buildQuestionDots(setObj, sess) {
    var grid = el("div", "q-grid");
    grid.setAttribute("data-q-sheet-grid", "");
    setObj.questions.forEach(function (q) {
      var qKey = String(q.n);
      var r = sess.responses[qKey];
      var answered = window.HSK_EXAM.isAnswered(q, r);
      var dotClass = "q-dot";
      if (activeMode === "mock" && !sess.submitted) {
        if (answered) dotClass += " is-answered";
      } else if (answered) {
        var g = window.HSK_EXAM.gradeQuestion(q, r);
        if (g.gradable && (activeMode === "mock" || q.type === "tf" || q.type === "mc" || q.type === "match" || q.type === "order" || sess.checked[qKey])) {
          dotClass += g.correct ? " is-right" : " is-wrong";
        } else {
          dotClass += " is-answered";
        }
      }
      if (sess.flagged[qKey]) dotClass += " is-flagged";
      var btn = el("button", dotClass, qKey);
      btn.type = "button";
      btn.addEventListener("click", function () {
        if (activeSection !== "all" && activeSection !== q.section) {
          activeSection = q.section;
          render();
        }
        var target = document.getElementById("q-" + setObj.id + "-" + q.n);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      grid.appendChild(btn);
    });
    return grid;
  }

  function renderScoreReport(setObj, sess) {
    var report = window.HSK_EXAM.scoreExam(setObj, sess.responses);
    var box = el("section", "score-report");
    box.setAttribute("data-score-report", "");
    box.appendChild(el("p", "eyebrow", "模擬試験 採点結果"));
    box.appendChild(el("h3", null, setObj.titleJa + " スコアレポート"));

    var totalRow = el("div", "score-total-row");
    totalRow.appendChild(el("strong", null, String(report.totalScaled)));
    totalRow.appendChild(el("span", null, "/ " + report.maxScaled + " 点満点（合格基準 " + report.passLine + " 点）"));
    totalRow.appendChild(el("span", report.passed ? "badge score-pass" : "badge no-audio", report.passed ? "合格圏クリア！" : "もう一歩（復習しましょう）"));
    box.appendChild(totalRow);

    var bd = el("div", "score-breakdown");
    report.sections.forEach(function (sec) {
      var sb = el("div", "score-sec-box");
      sb.appendChild(el("span", null, sec.titleJa + "（" + sec.titleZh + "）"));
      sb.appendChild(el("b", null, sec.scaledScore + " / 100 点"));
      sb.appendChild(el("span", null, "正答・得点換算：" + Math.round(sec.earnedPoints * 10) / 10 + " / " + sec.total + " 問"));
      bd.appendChild(sb);
    });
    box.appendChild(bd);

    var acts = el("div", "topbar-controls");
    if (report.wrongNumbers.length) {
      var revBtn = el("button", "btn-aux", "復習ノートを開く（" + mistakesForLevel(level).length + " 問）");
      revBtn.type = "button";
      revBtn.addEventListener("click", function () {
        area = "review";
        syncUrl();
        render();
      });
      acts.appendChild(revBtn);
    }
    var retryMock = el("button", "btn-primary", "もう一度白紙から模試を受ける");
    retryMock.type = "button";
    retryMock.setAttribute("data-retry-mock", "");
    retryMock.addEventListener("click", function () {
      progress.sessions[sessionKey(setObj.id, "mock")] = {
        responses: {},
        checked: {},
        flagged: {},
        submitted: false,
        remainingSec: (setObj.durationMinutes || 60) * 60
      };
      mockPaused = false;
      saveProgress();
      render();
      startMockTimer();
    });
    acts.appendChild(retryMock);
    box.appendChild(acts);
    return box;
  }

  /* Area 2: Active Exam Workspace */
  function renderWorkspaceView() {
    var wrap = el("div");
    if (loadingSet) {
      wrap.appendChild(el("div", "panel", "試験データを読み込んでいます…"));
      return wrap;
    }
    if (loadError || !activeSetData) {
      var errPanel = el("div", "panel");
      errPanel.appendChild(el("p", null, loadError || "左の「試験一覧」からトレーニングするセットを選んでください。"));
      var backBtn = el("button", "btn-primary", "試験一覧へ戻る");
      backBtn.type = "button";
      backBtn.addEventListener("click", function () { area = "sets"; syncUrl(); render(); });
      errPanel.appendChild(backBtn);
      wrap.appendChild(errPanel);
      return wrap;
    }

    var setObj = activeSetData;
    var sess = getSession(setObj, activeMode);

    // Sticky Top Bar + Audio Bar
    var sticky = el("div", "exam-sticky-bars");
    var topbar = el("div", "exam-topbar");

    var tLeft = el("div", "topbar-title");
    var backList = el("button", "btn-secondary", "← 一覧");
    backList.type = "button";
    backList.addEventListener("click", function () {
      stopTimers();
      stopAllAudio();
      area = "sets";
      syncUrl();
      render();
    });
    tLeft.appendChild(backList);
    tLeft.appendChild(el("span", activeMode === "mock" ? "badge sample" : "badge past", activeMode === "mock" ? "本番模試" : "練習モード"));
    tLeft.appendChild(el("h2", null, setObj.titleJa));
    topbar.appendChild(tLeft);

    var tRight = el("div", "topbar-controls");
    var statusSpan = el("span", "part-range");
    statusSpan.setAttribute("data-workspace-status", "");
    tRight.appendChild(statusSpan);

    if (activeMode === "mock" && !sess.submitted) {
      var timerBtn = el("button", sess.remainingSec <= 300 ? "timer-pill is-low" : "timer-pill", (mockPaused ? "⏸ 一時停止 " : "⏱ ") + window.HSK_EXAM.formatDurationClock(sess.remainingSec));
      timerBtn.type = "button";
      timerBtn.setAttribute("data-mock-timer", "");
      timerBtn.addEventListener("click", function () {
        mockPaused = !mockPaused;
        if (mockPaused) stopAllAudio();
        timerBtn.textContent = (mockPaused ? "⏸ 一時停止 " : "⏱ ") + window.HSK_EXAM.formatDurationClock(sess.remainingSec);
      });
      tRight.appendChild(timerBtn);

      var submitBtn = el("button", "btn-primary", "採点して結果を見る");
      submitBtn.type = "button";
      submitBtn.setAttribute("data-submit-mock", "");
      submitBtn.addEventListener("click", submitMockExam);
      tRight.appendChild(submitBtn);
    } else if (activeMode === "practice") {
      var switchMock = el("button", "btn-secondary", "タイマー模試へ切替");
      switchMock.type = "button";
      switchMock.addEventListener("click", function () { openSet(setObj.id, "mock"); });
      tRight.appendChild(switchMock);

      var resetPrac = el("button", "btn-ghost", "解答クリア");
      resetPrac.type = "button";
      resetPrac.addEventListener("click", function () {
        progress.sessions[sessionKey(setObj.id, "practice")] = { responses: {}, checked: {}, flagged: {}, submitted: false, remainingSec: 0 };
        saveProgress();
        render();
      });
      tRight.appendChild(resetPrac);
    }
    topbar.appendChild(tRight);
    sticky.appendChild(topbar);
    sticky.appendChild(renderAudioBar(setObj));
    wrap.appendChild(sticky);

    if (activeMode === "mock" && sess.submitted) {
      wrap.appendChild(renderScoreReport(setObj, sess));
    }

    // Section Filter Tabs
    var secTabs = el("div", "section-tabs");
    secTabs.setAttribute("role", "group");
    secTabs.setAttribute("aria-label", "試験セクション");
    var tabItems = [["all", "すべて（全" + setObj.totalQuestions + "問）"]].concat(
      setObj.sections.map(function (s) {
        return [s.key, s.titleJa + "・" + s.titleZh + "（" + s.count + "問）"];
      })
    );
    tabItems.forEach(function (item) {
      var b = el("button", "section-tab", item[1]);
      b.type = "button";
      b.setAttribute("data-sec-tab", item[0]);
      b.setAttribute("aria-pressed", activeSection === item[0] ? "true" : "false");
      b.addEventListener("click", function () {
        activeSection = item[0];
        render();
      });
      secTabs.appendChild(b);
    });
    wrap.appendChild(secTabs);

    // Collapsible Question Navigator Sheet
    var sheet = el("details", "q-sheet");
    sheet.open = qSheetOpen;
    sheet.addEventListener("toggle", function () { qSheetOpen = sheet.open; });
    var sheetSum = el("summary");
    sheetSum.appendChild(el("span", null, "解答一覧・問題番号ジャンプ（1〜" + setObj.totalQuestions + "）"));
    sheetSum.appendChild(el("span", "part-range", "クリックで開閉"));
    sheet.appendChild(sheetSum);
    sheet.appendChild(buildQuestionDots(setObj, sess));
    wrap.appendChild(sheet);

    // Build Question Lookup by Number
    var qByNum = new Map(setObj.questions.map(function (q) { return [q.n, q]; }));
    var allowTapVocab = activeMode === "practice" || !!sess.submitted;

    // Render Sections & Parts
    setObj.sections.forEach(function (sec) {
      if (activeSection !== "all" && activeSection !== sec.key) return;
      sec.parts.forEach(function (pt) {
        var pBlock = el("section", "part-block");
        var pHead = el("div", "part-head");
        var pTop = el("div", "part-head-top");
        pTop.appendChild(el("h3", null, sec.titleJa + "（" + sec.titleZh + "）· " + pt.titleZh));
        pTop.appendChild(el("span", "part-range", "第 " + pt.range[0] + "〜" + pt.range[1] + " 問"));
        pHead.appendChild(pTop);
        pHead.appendChild(el("p", "part-instr", pt.instructionJa));
        pBlock.appendChild(pHead);

        var groupByStart = new Map();
        var groupById = new Map();
        (pt.groups || []).forEach(function (g) {
          groupByStart.set(g.range[0], g);
          groupById.set(g.id, g);
        });

        for (var qn = pt.range[0]; qn <= pt.range[1]; qn += 1) {
          if (groupByStart.has(qn)) {
            pBlock.appendChild(renderSharedGroup(groupByStart.get(qn), allowTapVocab));
          }
          var q = qByNum.get(qn);
          if (q) {
            var grp = q.groupId ? groupById.get(q.groupId) : null;
            pBlock.appendChild(renderQuestionCard(setObj, q, sess, { mode: activeMode, group: grp }));
          }
        }
        wrap.appendChild(pBlock);
      });
    });

    setTimeout(refreshWorkspaceCounters, 0);
    return wrap;
  }

  /* Area 3: Mistake Review Notebook */
  function renderReviewView() {
    var panel = el("section", "panel");
    var header = el("div", "panel-header");
    var hLeft = el("div");
    hLeft.appendChild(el("p", "eyebrow", "間違えた問題を解き直す"));
    hLeft.appendChild(el("h2", null, "HSK " + level + "級 復習ノート"));
    header.appendChild(hLeft);
    panel.appendChild(header);

    var items = mistakesForLevel(level);
    if (!items.length) {
      var emptyP = el("p", null, "現在、HSK " + level + "級の復習ノートに登録されている問題はありません。練習モードや模擬試験で間違えた問題が自動的にここへ記録されます。");
      emptyP.style.marginTop = "18px";
      panel.appendChild(emptyP);
      var toSets = el("button", "btn-primary", "試験一覧からセットを選ぶ");
      toSets.type = "button";
      toSets.addEventListener("click", function () { area = "sets"; syncUrl(); render(); });
      panel.appendChild(toSets);
      return panel;
    }

    var missingIds = Array.from(new Set(items.map(function (m) { return m.setId; }))).filter(function (sid) {
      return !window.HSK_EXAM_SETS[sid];
    });
    if (missingIds.length) {
      panel.appendChild(el("p", null, "復習問題のデータを読み込んでいます…"));
      Promise.all(missingIds.map(loadSetScript)).then(function () { render(); }).catch(function () {});
      return panel;
    }

    var revList = el("div");
    revList.style.marginTop = "18px";
    var tempSess = progress.sessions["__review__:" + level] || { responses: {}, checked: {}, flagged: {} };
    progress.sessions["__review__:" + level] = tempSess;

    items.forEach(function (m) {
      var setObj = window.HSK_EXAM_SETS[m.setId];
      if (!setObj) return;
      var q = setObj.questions.find(function (itemQ) { return itemQ.n === m.q; });
      if (!q) return;

      var grp = null;
      setObj.sections.forEach(function (sec) {
        sec.parts.forEach(function (pt) {
          (pt.groups || []).forEach(function (g) {
            if (g.id === q.groupId) grp = g;
          });
        });
      });

      var wrap = el("div");
      wrap.style.marginBottom = "22px";
      if (grp) wrap.appendChild(renderSharedGroup(grp, true));
      var scopedSess = {
        responses: {},
        checked: {},
        flagged: {}
      };
      var rKey = m.setId + ":" + m.q;
      scopedSess.responses[String(q.n)] = tempSess.responses[rKey] || "";
      scopedSess.checked[String(q.n)] = !!tempSess.checked[rKey];

      var card = renderQuestionCard(setObj, q, scopedSess, {
        mode: "practice",
        group: grp,
        isReview: true,
        onUpdate: function () {
          tempSess.responses[rKey] = scopedSess.responses[String(q.n)];
          tempSess.checked[rKey] = scopedSess.checked[String(q.n)];
          saveProgress();
          render();
        }
      });
      wrap.appendChild(card);
      revList.appendChild(wrap);
    });

    panel.appendChild(revList);
    return panel;
  }

  function render() {
    document.body.classList.toggle("hide-pinyin", !prefs.showPinyin);
    app.textContent = "";
    app.appendChild(renderMasthead());

    var layout = el("div", "exam-layout");
    layout.appendChild(renderSidebar());

    var content = el("div", "exam-content");
    if (area === "workspace") content.appendChild(renderWorkspaceView());
    else if (area === "review") content.appendChild(renderReviewView());
    else content.appendChild(renderSetsView());

    layout.appendChild(content);
    app.appendChild(layout);
  }

  // Expose automation/test API matching window.HSK_PAGE pattern
  window.HSK_EXAM_PAGE = {
    manifest: manifest,
    state: function () {
      return {
        level: level,
        area: area,
        activeSetId: activeSetId,
        activeMode: activeMode,
        activeSection: activeSection,
        mistakesCount: mistakesForLevel(level).length
      };
    },
    currentSet: function () { return activeSetData; },
    openSet: openSet
  };

  window.addEventListener("pagehide", saveProgress);

  if (area === "workspace" && activeSetId && setsById.has(activeSetId)) {
    openSet(activeSetId, activeMode);
  } else {
    area = area === "review" ? "review" : "sets";
    syncUrl();
    render();
  }
})();
