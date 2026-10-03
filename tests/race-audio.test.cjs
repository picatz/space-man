const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Audio = require("../src/race-audio.js");

function harness(initialSettings = {}) {
  let milliseconds = 0, nextId = 1;
  const timers = new Map(), contexts = [];
  const settings = { music: true, musicVol: 1, sfx: true, sfxVol: 1, ...initialSettings };
  const param = (value = 0) => ({
    value, values: [],
    setValueAtTime(n, t) { this.value = n; this.values.push([n, t]); },
    linearRampToValueAtTime(n, t) { this.value = n; this.values.push([n, t]); },
    exponentialRampToValueAtTime(n, t) { assert.ok(n > 0); this.value = n; this.values.push([n, t]); },
    setTargetAtTime(n, t) { this.value = n; this.values.push([n, t]); },
    cancelScheduledValues() {},
  });
  class Context {
    constructor() {
      this.currentTime = 0; this.state = "suspended"; this.nodes = []; this.oscs = [];
      this.resumes = 0; this.suspends = 0; this.closes = 0;
      this.destination = this.node("destination"); contexts.push(this);
    }
    node(kind) {
      const node = { kind, links: [], gain: param(1), frequency: param(440), Q: param(),
        threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
        connect(n) { this.links.push(n); return n; }, disconnect() { this.links.length = 0; } };
      this.nodes.push(node); return node;
    }
    createGain() { return this.node("gain"); }
    createBiquadFilter() { return this.node("filter"); }
    createDynamicsCompressor() { return this.node("compressor"); }
    createOscillator() {
      const osc = this.node("osc");
      osc.start = (at = this.currentTime) => { osc.started = true; osc.startTime = at; };
      osc.stop = (at = this.currentTime) => { osc.stopTime = at; };
      this.oscs.push(osc); return osc;
    }
    resume() { this.resumes++; this.state = "running"; return Promise.resolve(); }
    suspend() { this.suspends++; this.state = "suspended"; return Promise.resolve(); }
    close() { this.closes++; this.state = "closed"; return Promise.resolve(); }
  }
  function advance(ms) {
    const end = milliseconds + ms;
    while (milliseconds < end) {
      const nearest = [...timers.values()].reduce((n, t) => Math.min(n, t.at), end);
      const delta = Math.max(0, nearest - milliseconds);
      for (const ctx of contexts) {
        if (ctx.state === "running") ctx.currentTime += delta / 1000;
        for (const osc of ctx.oscs) if (!osc.ended && osc.stopTime <= ctx.currentTime) {
          osc.ended = true; if (osc.onended) osc.onended();
        }
      }
      milliseconds = nearest;
      const due = [...timers].filter(([, t]) => t.at <= milliseconds);
      for (const [id, t] of due) { timers.delete(id); t.fn(); }
    }
  }
  const audio = Audio.create({ getSettings: () => settings, AudioContext: Context,
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { fn, at: milliseconds + ms }); return id; },
    clearTimeout(id) { timers.delete(id); } });
  const state = { phase: "countdown", countdown: 180, tick: 0, events: [] };
  const actor = { id: "pilot-0", speed: 0, finishTick: null };
  const count = () => contexts.reduce((n, ctx) => n + ctx.oscs.length, 0);
  const live = () => contexts.flatMap((ctx) => ctx.oscs.filter((o) => o.links.length && !o.ended));
  return { audio, state, actor, settings, contexts, timers, advance, count, live,
    update() { audio.update(state, actor); } };
}

async function racing(settings) {
  const h = harness(settings); await h.audio.unlock();
  h.state.phase = "racing"; h.state.tick = 180; h.update();
  return h;
}

test("UMD works without a DOM or browser audio; all unsupported actions are safe", async () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/race-audio.js"), "utf8"), context);
  const api = context.window.SpaceManRaceAudio;
  assert.ok(Object.isFrozen(api));
  const audio = api.create();
  audio.update({ phase: "racing" }, { speed: 4 });
  audio.pad(); audio.recover(); audio.lap(); audio.finish();
  assert.equal(await audio.unlock(), false);
  await audio.pause(); await audio.stop(); await audio.destroy();
});

test("only a gesture unlock creates/resumes audio, and the lobby never schedules sound", async () => {
  const h = harness();
  h.update(); h.audio.pad(); h.audio.phase("racing");
  assert.equal(h.contexts.length, 0);
  h.audio.phase("lobby");
  assert.equal(await h.audio.unlock(), true);
  assert.equal(h.contexts.length, 1); assert.equal(h.contexts[0].resumes, 1);
  assert.equal(h.count(), 0); assert.equal(h.timers.size, 0);
  h.update(); assert.ok(h.count() > 0); assert.equal(h.timers.size, 1);
  const count = h.count();
  for (let i = 0; i < 20; i++) await h.audio.unlock();
  assert.equal(h.contexts[0].resumes, 1); assert.equal(h.count(), count);
});

test("score, engine and effects stay bounded through a long race in normal and eco modes", async () => {
  for (const eco of [false, true]) {
    const h = await racing({ eco });
    h.actor.speed = 8; h.actor.boosting = true;
    for (let i = 0; i < 300; i++) {
      h.state.tick++; h.update(); h.audio.pad(); h.audio.lap(); h.advance(200);
      assert.ok(h.live().length <= (eco ? 18 : 23), `${h.live().length} live oscillators`);
      assert.equal(h.timers.size, 1);
    }
    assert.ok(h.count() > 100);
    for (const osc of h.contexts[0].oscs) {
      for (const [frequency] of osc.frequency.values) assert.ok(Number.isFinite(frequency) && frequency > 20 && frequency < 1500);
    }
    await h.audio.destroy(); assert.equal(h.live().length, 0); assert.equal(h.timers.size, 0);
  }
});

test("mute and both volume switches react immediately and cannot be reopened by effects", async () => {
  const h = await racing();
  h.actor.speed = 9; h.update(); assert.ok(h.live().length > 0);
  h.settings.muted = true; h.update();
  assert.equal(h.live().length, 0);
  let count = h.count(); h.audio.pad(); h.audio.recover(); h.advance(2000);
  assert.equal(h.count(), count); assert.equal(h.timers.size, 0);
  h.settings.muted = false; h.settings.music = false; h.settings.sfxVol = 0; h.update();
  h.audio.lap(); h.advance(2000); assert.equal(h.count(), count);
  h.settings.music = true; h.settings.musicVol = 0.5; h.update();
  assert.ok(h.count() > count);
  const gains = h.contexts[0].nodes.filter((n) => n.kind === "gain");
  assert.equal(gains[1].gain.value, 0.35); assert.equal(gains[2].gain.value, 0);
  h.settings.musicVol = 0; h.settings.sfxVol = 0.4; h.update();
  assert.equal(gains[1].gain.value, 0); assert.equal(gains[2].gain.value, 0.26);
  assert.equal(h.live().length, 2, "only the engine lives on SFX");
  h.settings.sfx = false; h.update(); assert.equal(h.live().length, 0);
});

test("simulation events dedupe by local tick and network serial, and filter other racers", async () => {
  const h = await racing({ music: false });
  h.actor.recoveryTicks = 1; h.update();
  let count = h.count();
  h.state.tick++; h.state.events = [{ type: "pad", id: h.actor.id }, { type: "pad", id: h.actor.id }, { type: "lap", id: "pilot-2" }];
  h.update(); assert.equal(h.count(), count + 2);
  count = h.count(); h.advance(300); h.update(); assert.equal(h.count(), count);
  h.state.tick++; h.state.events = [{ type: "lap", id: h.actor.id, serial: 17 }];
  h.update(); assert.equal(h.count(), count + 3);
  count = h.count(); h.advance(300); h.state.tick++; h.update(); assert.equal(h.count(), count);
  h.state.events = [{ type: "recover", id: h.actor.id, serial: 18 }];
  h.update(); assert.equal(h.count(), count + 3, "new serial can arrive without advancing tick");
});

test("countdown and results are musical once, with no endless results scheduler", async () => {
  const h = harness({ music: false }); await h.audio.unlock(); h.update();
  let count = h.count(); h.advance(500); h.update(); assert.equal(h.count(), count);
  h.state.countdown = 120; h.state.tick = 60; h.update(); assert.equal(h.count(), count + 1);
  h.advance(500); count = h.count();
  h.state.phase = "racing"; h.state.tick = 180; h.update();
  assert.equal(h.count(), count + 5, "go triad and two engine sources");
  h.state.phase = "finished"; h.state.events = [{ type: "finish", id: h.actor.id }]; h.state.tick++;
  count = h.count(); h.update(); assert.equal(h.count(), count + 4);
  count = h.count(); h.advance(5000); h.update();
  assert.equal(h.count(), count); assert.equal(h.live().length, 0); assert.equal(h.timers.size, 0);
});

test("pause clears future music and engine, suspends, and never resumes from snapshots", async () => {
  const h = await racing();
  await h.audio.pause();
  assert.equal(h.live().length, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.contexts[0].state, "suspended");
  let count = h.count();
  h.state.tick++; h.state.events = [{ type: "lap", id: h.actor.id, serial: 12 }]; h.update();
  h.advance(10000); h.update(); h.audio.pad();
  assert.equal(h.count(), count); assert.equal(h.contexts[0].resumes, 1);
  await h.audio.unlock(); h.settings.music = false; h.actor.finishTick = 99;
  count = h.count(); h.update(); assert.equal(h.count(), count, "no old lap cue on resume");
  h.advance(300); h.state.tick++; h.update(); assert.equal(h.count(), count, "serial remains consumed");
});

test("retries reuse one context, stop is quiet, destroy disconnects and permanently disables", async () => {
  const h = harness();
  for (let i = 0; i < 10; i++) {
    await h.audio.unlock(); h.state.phase = "countdown"; h.state.tick = 0; h.update(); h.advance(400);
    h.state.phase = "racing"; h.state.tick = 180; h.update(); h.advance(400);
    await h.audio.stop(); assert.equal(h.live().length, 0); assert.equal(h.timers.size, 0);
  }
  assert.equal(h.contexts.length, 1);
  await h.audio.destroy(); assert.equal(h.contexts[0].closes, 1);
  assert.ok(h.contexts[0].nodes.every((n) => n.links.length === 0));
  const count = h.count(); await h.audio.destroy();
  assert.equal(await h.audio.unlock(), false); h.update(); h.audio.phase("racing");
  assert.equal(h.count(), count); assert.equal(h.contexts[0].closes, 1);
});

test("large clock discontinuities schedule at most one fresh step instead of a backlog", async () => {
  const h = await racing({ sfx: false });
  const count = h.count(); h.contexts[0].currentTime += 300;
  h.advance(100);
  assert.ok(h.count() - count <= 5); assert.equal(h.timers.size, 1);
});

test("pause during pending unlock leaves the late-resuming context suspended", async () => {
  const h = harness(); await h.audio.unlock(); await h.audio.pause();
  const ctx = h.contexts[0]; let resolve;
  ctx.resume = () => new Promise((r) => { resolve = () => { ctx.state = "running"; r(); }; });
  const pending = h.audio.unlock(); await h.audio.pause(); resolve();
  assert.equal(await pending, false); assert.equal(ctx.state, "suspended");
  assert.equal(h.timers.size, 0); assert.equal(h.live().length, 0);
});

test("authorized menu gestures cannot queue a deferred native resume after leaving the race", async () => {
  const h = harness();
  // Exercise the production event handler with the real audio controller. The
  // DOM itself is irrelevant to this native-promise ordering regression.
  const source = fs.readFileSync(require.resolve("../src/race-ui.js"), "utf8");
  const handler = source.match(/    function unlockAudioGesture\(e\) \{[\s\S]*?\n    \}/)[0];
  const scope = { active: true, view: "lobby", paused: false, audio: h.audio,
    ownsInput: () => true, raceAudio: () => h.audio };
  const gesture = vm.runInNewContext(handler + "; unlockAudioGesture", scope);
  gesture({ isTrusted: true });
  await new Promise(setImmediate);
  assert.equal(h.audio.diagnostics().unlocked, true, "first menu gesture authorizes online host start");
  assert.equal(h.contexts[0].state, "suspended");

  const ctx = h.contexts[0], pending = [], transitions = [];
  ctx.resume = () => new Promise(resolve => {
    pending.push(() => { ctx.state = "running"; transitions.push("running"); resolve(); });
  });
  const count = h.count();
  for (const menu of [{ view: "play", paused: true }, { view: "lobby", paused: false }]) {
    Object.assign(scope, menu);
    gesture({ isTrusted: true });
    await h.audio.stop();
  }
  // Reproduce a resume that completes after the menu-exit quiet sample. Before
  // the fix these callbacks transiently woke the suspended native context.
  for (const resolve of pending.splice(0)) resolve();
  await new Promise(setImmediate);
  assert.deepEqual(transitions, [], "menu exit never has a late native wake");
  assert.equal(ctx.state, "suspended");
  assert.equal(h.audio.diagnostics().scheduled, false);
  assert.equal(h.count(), count);
  assert.equal(h.live().length, 0);

  const launch = h.audio.unlock();
  assert.equal(pending.length, 1, "explicit launch still resumes the authorized context");
  pending.shift()();
  assert.equal(await launch, true);
  await h.audio.pause();
  const resume = h.audio.resume();
  assert.equal(pending.length, 1, "explicit host resume still works");
  pending.shift()();
  assert.equal(await resume, true);
  await h.audio.stop();
});

test("online host resume reuses prior gesture permission without ever creating a context", async () => {
  const h = harness();
  assert.equal(await h.audio.resume(), false); assert.equal(h.contexts.length, 0);
  await h.audio.unlock(); await h.audio.stop();
  assert.equal(await h.audio.resume(), true); assert.equal(h.contexts.length, 1);
  assert.equal(h.contexts[0].resumes, 2);
  assert.equal(h.count(), 0, "resume in the lobby is silent");
  h.state.phase = "racing"; h.state.tick = 180; h.update(); assert.ok(h.count() > 0);
  await h.audio.pause(); h.update(); assert.equal(h.contexts[0].resumes, 2);
  await h.audio.destroy(); assert.equal(await h.audio.resume(), false);
});

test("battery saver is accepted as the eco preference and reduces score density", async () => {
  const regular = await racing({ sfx: false });
  const saver = await racing({ sfx: false, batterySaver: true });
  regular.advance(10000); saver.advance(10000);
  assert.ok(saver.count() < regular.count() * 0.8);
});

test("engine node failures clean up partial nodes and permit a later retry", async () => {
  const h = harness({ music: false }); await h.audio.unlock();
  const ctx = h.contexts[0], create = ctx.createOscillator.bind(ctx);
  let attempts = 0;
  ctx.createOscillator = () => { if (++attempts >= 2) throw Error("device unavailable"); return create(); };
  h.state.phase = "racing"; h.state.tick = 180; h.update();
  assert.equal(h.live().length, 0);
  ctx.createOscillator = create; h.advance(100); h.update();
  assert.equal(h.live().length, 2);
  await h.audio.destroy(); assert.ok(ctx.nodes.every((n) => n.links.length === 0));
});

test("a rejected resume stays silent and a later gesture can recover", async () => {
  const h = harness(); await h.audio.unlock(); await h.audio.pause();
  const ctx = h.contexts[0], resume = ctx.resume.bind(ctx);
  ctx.resume = () => Promise.reject(Error("autoplay blocked"));
  assert.equal(await h.audio.resume(), false);
  h.update(); h.advance(1000); assert.equal(h.live().length, 0); assert.equal(h.timers.size, 0);
  ctx.resume = resume; assert.equal(await h.audio.unlock(), true); h.update();
  assert.ok(h.live().length > 0);
});

test("unlock followed immediately by lobby stop retains permission for an asynchronous host start", async () => {
  const h = harness();
  const opening = h.audio.unlock(); await h.audio.stop(); await opening;
  assert.equal(h.audio.diagnostics().unlocked, true);
  assert.equal(h.audio.diagnostics().contextState, "suspended");
  assert.equal(await h.audio.resume(), true); h.update();
  assert.ok(h.audio.diagnostics().musicVoices > 0);
  const snapshot = h.audio.diagnostics();
  assert.ok(Object.isFrozen(snapshot));
  await h.audio.destroy();
  assert.equal(h.audio.diagnostics().engineVoices, 0);
  assert.equal(h.audio.diagnostics().musicVoices, 0);
  assert.equal(h.audio.diagnostics().sfxVoices, 0);
  assert.equal(h.audio.diagnostics().scheduled, false);
});

test("checkpoint increments play one subtle cue, with no duplicate or skipped-gate burst", async () => {
  const h = await racing({ music: false });
  h.actor.passed = 0; h.actor.lap = 1; h.update();
  let count = h.count();
  h.actor.passed = 1; h.state.tick++; h.update();
  assert.equal(h.count(), count + 1);
  const cue = h.contexts[0].oscs.at(-1);
  assert.ok(cue.links[0].gain.values.some(([level]) => level === 0.035), "quieter than lap cues");
  count = h.count(); h.advance(300); h.update(); assert.equal(h.count(), count);
  h.actor.passed = 4; h.state.tick += 30; h.update();
  assert.equal(h.count(), count + 1, "a skipped snapshot acknowledges only once");
});

test("checkpoint cues yield to lap and finish fanfares, including the final lap event pair", async () => {
  const h = await racing({ music: false });
  h.actor.passed = 19; h.actor.lap = 1; h.update();
  h.actor.passed = 20; h.actor.lap = 2; h.state.tick++;
  h.state.events = [{ type: "lap", id: h.actor.id }];
  let count = h.count(); h.update(); assert.equal(h.count(), count + 3);
  h.advance(400); h.actor.passed = 59; h.actor.lap = 3; h.state.events = []; h.state.tick++; h.update();
  h.advance(400); h.actor.passed = 60; h.actor.lap = 4; h.actor.finishTick = 999;
  h.state.phase = "finished"; h.state.tick++;
  h.state.events = [{ type: "lap", id: h.actor.id }, { type: "finish", id: h.actor.id }];
  count = h.count(); h.update(); assert.equal(h.count(), count + 4, "finish only, no checkpoint or last-lap overlap");
});

test("checkpoint baselines reset on pause, new actor and rewind without replaying history", async () => {
  const h = await racing({ music: false });
  h.actor.passed = 4; h.actor.lap = 1; h.update();
  await h.audio.pause(); h.actor.passed = 8; h.state.tick += 30;
  await h.audio.unlock(); h.update(); // Engine restarts; no historic checkpoint.
  let count = h.count(); h.advance(300); h.update(); assert.equal(h.count(), count);
  h.actor.passed = 9; h.state.tick++; h.update(); assert.equal(h.count(), count + 1);
  h.advance(300); count = h.count(); h.actor.id = "pilot-2"; h.actor.passed = 15;
  h.state.tick++; h.update(); assert.equal(h.count(), count);
  h.actor.passed = 16; h.state.tick++; h.update(); assert.equal(h.count(), count + 1);
  h.advance(300); count = h.count(); h.state.tick = 1; h.actor.passed = 18;
  h.update(); assert.equal(h.count(), count, "snapshot rewind only establishes a baseline");
  h.state.tick++; h.actor.passed = 19; h.update(); assert.equal(h.count(), count + 1);
  h.settings.sfx = false; h.advance(300); h.state.tick++; h.actor.passed = 21;
  count = h.count(); h.update(); h.audio.checkpoint(); assert.equal(h.count(), count);
});

test("launch and panel resume win over an in-flight lobby suspend with stale running state", async () => {
  const h = harness(); await h.audio.unlock();
  const ctx = h.contexts[0]; let suspended;
  ctx.suspend = () => new Promise((resolve) => {
    suspended = () => { ctx.state = "suspended"; resolve(); };
  });
  await h.audio.unlock(); // Captured pointerdown gesture.
  const lobbyPause = h.audio.pause(); // Browser state still reports running.
  const launch = h.audio.unlock();
  const panel = h.audio.resume();
  h.update(); suspended();
  await Promise.all([lobbyPause, launch, panel]);
  assert.equal(ctx.state, "running"); assert.equal(h.audio.diagnostics().ready, true);
  assert.equal(h.contexts.length, 1);
  h.update(); assert.ok(h.live().length > 0);
});

test("a newer pause still wins while launch is awaiting an older suspension", async () => {
  const h = harness(); await h.audio.unlock();
  const ctx = h.contexts[0], pending = [];
  ctx.suspend = () => new Promise((resolve) => pending.push(() => { ctx.state = "suspended"; resolve(); }));
  const lobbyPause = h.audio.pause(); const launch = h.audio.unlock();
  const hiddenPause = h.audio.pause();
  for (const resolve of pending) resolve();
  await Promise.all([lobbyPause, launch, hiddenPause]);
  assert.equal(ctx.state, "suspended"); assert.equal(h.audio.diagnostics().ready, false);
  assert.equal(h.live().length, 0); assert.equal(h.timers.size, 0);
});
