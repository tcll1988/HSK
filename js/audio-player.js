/* One audio element for individual words and optional, user-started group listening. */
(function () {
  "use strict";

  function create(options) {
    var player = options.player;
    var resolveSrc = options.resolveSrc;
    var onChange = options.onChange || function () {};
    var onError = options.onError || function () {};
    var entries = [];
    var request = 0;
    var timer = null;
    var waiting = false;
    var gapRemaining = 0;
    var gapUntil = 0;
    var current = {
      entry: null, playing: false, paused: false, batch: false,
      index: 0, total: 0, repetition: 0, repeats: 1, gap: 1,
      speed: validSpeed(player.playbackRate)
    };

    function validSpeed(value) {
      return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 4 ? value : 1;
    }

    function state() { return Object.assign({}, current); }
    function notify() { onChange(state()); }

    function clearTimer() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }

    function stop() {
      request += 1;
      clearTimer();
      waiting = false;
      gapRemaining = 0;
      entries = [];
      player.pause();
      current.entry = null;
      current.playing = false;
      current.paused = false;
      current.batch = false;
      current.index = 0;
      current.total = 0;
      current.repetition = 0;
      notify();
    }

    function failed(token) {
      if (token !== request || !current.entry) return;
      stop();
      onError("音声を再生できませんでした。もう一度お試しください。");
    }

    function playCurrent(restart) {
      clearTimer();
      waiting = false;
      current.playing = true;
      current.paused = false;
      var token = ++request;
      try {
        if (restart) {
          player.pause();
          player.src = resolveSrc(current.entry);
        }
        player.playbackRate = current.speed;
        var started = player.play();
        if (started && started.catch) started.catch(function () { failed(token); });
      } catch (error) {
        failed(token);
        return;
      }
      notify();
    }

    function sameEntry(first, second) {
      if (first && second && first.id !== undefined && second.id !== undefined) return first.id === second.id;
      return first === second || !!(first && second && first.hanzi && first.hanzi === second.hanzi);
    }

    function play(entry) {
      if (!entry) return;
      if (!current.batch && sameEntry(current.entry, entry)) {
        stop();
        return;
      }
      stop();
      entries = [entry];
      current.entry = entry;
      current.total = 1;
      current.repetition = 1;
      playCurrent(true);
    }

    function start(list, settings) {
      settings = settings || {};
      stop();
      entries = Array.isArray(list) ? list.filter(function (entry) { return !!entry; }) : [];
      if (!entries.length) return;
      current.batch = true;
      current.index = 0;
      current.total = entries.length;
      current.entry = entries[0];
      current.repetition = 1;
      current.repeats = settings.repeat === 2 ? 2 : 1;
      current.gap = typeof settings.gap === "number" && Number.isFinite(settings.gap) ? Math.max(0, Math.min(30, settings.gap)) : 1;
      if (settings.speed !== undefined) current.speed = validSpeed(settings.speed);
      playCurrent(true);
    }

    function advance() {
      if (!current.batch || current.paused) return;
      if (current.repetition < current.repeats) {
        current.repetition += 1;
      } else {
        current.index += 1;
        current.repetition = 1;
      }
      current.entry = entries[current.index];
      playCurrent(true);
    }

    function scheduleGap(milliseconds) {
      clearTimer();
      waiting = true;
      gapRemaining = milliseconds;
      gapUntil = Date.now() + milliseconds;
      var token = request;
      timer = setTimeout(function () {
        timer = null;
        if (token !== request || current.paused || !current.batch) return;
        advance();
      }, milliseconds);
    }

    function ended() {
      if (!current.playing || !current.entry) return;
      current.playing = false;
      if (!current.batch || (current.index === entries.length - 1 && current.repetition === current.repeats)) {
        stop();
        return;
      }
      scheduleGap(current.gap * 1000);
      notify();
    }

    function pause() {
      if (!current.entry || current.paused) return;
      request += 1;
      if (waiting) gapRemaining = Math.max(0, gapUntil - Date.now());
      clearTimer();
      player.pause();
      current.playing = false;
      current.paused = true;
      notify();
    }

    function resume() {
      if (!current.entry || !current.paused) return;
      current.paused = false;
      if (waiting) {
        scheduleGap(gapRemaining);
        notify();
      } else {
        playCurrent(false);
      }
    }

    function next() {
      if (!current.batch) return;
      if (current.index >= entries.length - 1) {
        stop();
        return;
      }
      current.index += 1;
      current.repetition = 1;
      current.entry = entries[current.index];
      playCurrent(true);
    }

    function previous() {
      if (!current.batch) return;
      current.index = Math.max(0, current.index - 1);
      current.repetition = 1;
      current.entry = entries[current.index];
      playCurrent(true);
    }

    function setSpeed(speed) {
      current.speed = validSpeed(speed);
      player.playbackRate = current.speed;
      notify();
    }

    function mediaError() { failed(request); }
    player.addEventListener("ended", ended);
    player.addEventListener("error", mediaError);

    return {
      play: play, start: start, pause: pause, resume: resume, stop: stop,
      previous: previous, next: next, setSpeed: setSpeed, state: state,
      destroy: function () {
        stop();
        player.removeEventListener("ended", ended);
        player.removeEventListener("error", mediaError);
      }
    };
  }

  window.HSK_AUDIO = { create: create };
})();
