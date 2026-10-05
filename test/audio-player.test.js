const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/audio-player.js"), "utf8");
const words = [{ id: 1, hanzi: "长", recording: "chang" }, { id: 2, hanzi: "长", recording: "zhang" }];

function setup() {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const listeners = new Map();
  const failures = [];
  const history = [];
  const states = [];
  const player = {
    playbackRate: 1, src: "", currentTime: 0, paused: true, nextResult: null,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    play() {
      this.paused = false;
      history.push({ src: this.src, time: this.currentTime, speed: this.playbackRate });
      const result = this.nextResult;
      this.nextResult = null;
      return result || Promise.resolve();
    },
    pause() { this.paused = true; },
    emit(name) {
      if (name === "ended") this.paused = true;
      if (listeners.has(name)) listeners.get(name)();
    }
  };
  const context = {
    window: {}, Date: { now: () => now },
    setTimeout(callback, milliseconds) {
      const id = ++nextTimer;
      timers.set(id, { at: now + milliseconds, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source, context);
  const controller = context.window.HSK_AUDIO.create({
    player,
    resolveSrc: entry => entry.recording + ".mp3",
    onChange: state => states.push(state),
    onError: message => failures.push(message)
  });
  function tick(milliseconds) {
    const end = now + milliseconds;
    while (true) {
      const pending = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!pending || pending[1].at > end) break;
      now = pending[1].at;
      timers.delete(pending[0]);
      pending[1].callback();
    }
    now = end;
  }
  return { controller, player, history, failures, states, timers, tick };
}

test("group listening repeats each recording with the chosen gap and stops after the final word", () => {
  const { controller, player, history, timers, tick } = setup();
  assert.equal(history.length, 0, "opening a page must not start audio");
  controller.start(words, { repeat: 2, gap: 2, speed: 0.75 });
  assert.equal(history[0].src, "chang.mp3");
  assert.equal(history[0].speed, 0.75);
  player.emit("ended");
  assert.equal(controller.state().playing, false);
  assert.equal(controller.state().batch, true);
  tick(1999);
  assert.equal(history.length, 1);
  tick(1);
  assert.equal(controller.state().repetition, 2);
  assert.equal(history[1].src, "chang.mp3");
  player.emit("ended");
  tick(2000);
  assert.equal(controller.state().index, 1);
  assert.equal(controller.state().repetition, 1);
  assert.equal(history[2].src, "zhang.mp3");
  player.emit("ended");
  tick(2000);
  assert.equal(history[3].src, "zhang.mp3");
  player.emit("ended");
  tick(60000);
  assert.equal(controller.state().entry, null);
  assert.equal(history.length, 4);
  assert.equal(timers.size, 0);
});

test("pausing during the follow-along gap preserves its remainder and stopping cancels pending audio", () => {
  const { controller, player, history, tick, timers } = setup();
  controller.start(words, { gap: 3 });
  player.emit("ended");
  tick(1000);
  controller.pause();
  assert.equal(controller.state().paused, true);
  tick(20000);
  assert.equal(history.length, 1);
  controller.resume();
  tick(1999);
  assert.equal(history.length, 1);
  tick(1);
  assert.equal(history.length, 2);
  player.currentTime = 0.4;
  controller.pause();
  controller.resume();
  assert.equal(history[2].time, 0.4, "resume continues the current recording");
  controller.start(words, { gap: 3 });
  player.emit("ended");
  controller.stop();
  const count = history.length;
  tick(30000);
  assert.equal(history.length, count);
  assert.equal(timers.size, 0);
});

test("individual words replace a group, distinguish entry IDs, and ignore stale playback rejection", async () => {
  const { controller, player, history, failures, tick } = setup();
  let rejectOld;
  player.nextResult = new Promise((resolve, reject) => { rejectOld = reject; });
  controller.start(words, { gap: 1 });
  controller.play(words[1]);
  rejectOld(new Error("superseded request"));
  await Promise.resolve();
  assert.equal(failures.length, 0);
  assert.equal(controller.state().entry.id, 2);
  assert.equal(controller.state().batch, false);
  controller.play(words[0]);
  assert.equal(controller.state().entry.id, 1, "same headword with another reading remains a different entry");
  assert.equal(history.at(-1).src, "chang.mp3");
  controller.play(words[0]);
  assert.equal(controller.state().entry, null, "a second tap stops the individual recording");
  const count = history.length;
  tick(30000);
  assert.equal(history.length, count);
});

test("playback failures clear the group and its timer, and another manual play can retry", async () => {
  const { controller, player, failures, timers, history, tick } = setup();
  controller.start(words, { gap: 1 });
  player.emit("ended");
  player.emit("error");
  assert.equal(controller.state().entry, null);
  assert.equal(timers.size, 0);
  tick(10000);
  assert.equal(history.length, 1);
  assert.equal(failures.length, 1);
  player.nextResult = Promise.reject(new Error("playback denied"));
  controller.play(words[0]);
  await Promise.resolve();
  assert.equal(controller.state().entry, null);
  assert.equal(failures.length, 2);
  controller.play(words[1]);
  assert.equal(controller.state().playing, true);
  assert.equal(controller.state().entry.id, 2);
});

test("previous and next use word boundaries, reset repetition, and do not leave old timers active", () => {
  const { controller, player, history, tick, timers } = setup();
  controller.start(words, { repeat: 2, gap: 2 });
  player.emit("ended");
  controller.next();
  assert.equal(controller.state().index, 1);
  assert.equal(controller.state().repetition, 1);
  assert.equal(timers.size, 0);
  controller.previous();
  controller.previous();
  assert.equal(controller.state().index, 0);
  controller.setSpeed(1.5);
  assert.equal(player.playbackRate, 1.5);
  controller.next();
  controller.next();
  const count = history.length;
  tick(10000);
  assert.equal(controller.state().entry, null);
  assert.equal(history.length, count);
});
