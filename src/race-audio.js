/* Star Circuit's original, asset-free score and hoverkart sound design.
 * Only gesture-triggered unlock() can create an AudioContext. resume() can reuse
 * that permission after a host resumes an online race; update() never resumes.
 * update() accepts the simulation state and the locally followed racer. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpaceManRaceAudio = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";
  const BEAT = 60 / 104;
  // Dmaj9, Bm7, Gmaj9, A6. Voicings and the eight-step motif are original.
  const CHORDS = [
    { bass: 38, pad: [54, 61, 64], arp: [66, 69, 73, 76] },
    { bass: 35, pad: [54, 57, 62], arp: [66, 69, 74, 78] },
    { bass: 31, pad: [54, 57, 62], arp: [67, 69, 74, 78] },
    { bass: 33, pad: [52, 57, 61], arp: [64, 66, 69, 73] },
  ];
  const MOTIF = [0, 2, 1, 3, 2, 1, 3, 1];
  const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, finite(n)));
  const hz = (note) => 440 * Math.pow(2, (note - 69) / 12);
  function create(options = {}) {
    options = options && typeof options === "object" ? options : {};
    const later = options.setTimeout || ((fn, ms) => root.setTimeout(fn, ms));
    const cancel = options.clearTimeout || ((id) => root.clearTimeout(id));
    const voices = new Set(), suspensions = new Set();
    let ctx = null, master = null, musicBus = null, sfxBus = null, limiter = null;
    let timer = null, disposed = false, paused = false, ready = false, generation = 0;
    let gestureUnlocked = false;
    let phaseName = "lobby", nextNote = 0, step = 0, resultUntil = 0;
    let lastCountdown = null, lastEventTick = null, lastActorId = null, baselineEvents = false;
    let lastSerial = 0, suppressCues = false, lastPassed = null, lastLap = null;
    let lastStateTick = null, lastLevels = "", lastEco = false, engine = null, actorNow = null;
    let lastEngineTime = -Infinity, boostAmount = 0, finishPlayed = false;
    const lastCue = Object.create(null);

    function settings() {
      let p = {};
      try { p = options.getSettings ? options.getSettings() || {} : {}; } catch (_) {}
      const muted = p.muted || p.mute || p.sound === false;
      return {
        music: muted || p.music === false ? 0 : clamp(p.musicVol ?? 1, 0, 1),
        sfx: muted || p.sfx === false ? 0 : clamp(p.sfxVol ?? 1, 0, 1),
        eco: !!(p.eco || p.batterySaver),
      };
    }
    function available() { return !!ctx && ready && !paused && !disposed && ctx.state === "running"; }
    function active() { return phaseName === "countdown" || phaseName === "racing"; }
    function time() { return ctx ? finite(ctx.currentTime) : 0; }
    function target(param, value, at, smooth = 0.035) {
      param.cancelScheduledValues(at);
      param.setTargetAtTime(value, at, smooth);
    }
    function disconnect(node) { try { node.disconnect(); } catch (_) {} }
    function drop(voice) {
      if (!voices.delete(voice)) return;
      voice.osc.onended = null;
      try { voice.osc.stop(); } catch (_) {}
      disconnect(voice.osc); disconnect(voice.gain);
    }
    function clearVoices(channel) {
      for (const voice of Array.from(voices)) if (!channel || voice.channel === channel) drop(voice);
    }
    function clearTimer() {
      if (timer !== null) { cancel(timer); timer = null; }
    }
    function killEngine() {
      if (!engine) return;
      for (const osc of engine.oscs) {
        try { osc.stop(); } catch (_) {}
        disconnect(osc);
      }
      disconnect(engine.gain); disconnect(engine.filter);
      engine = null; lastEngineTime = -Infinity;
    }
    function sync() {
      const p = settings();
      if (!ctx) return p;
      const key = `${p.music}:${p.sfx}`;
      if (lastLevels !== key) {
        target(musicBus.gain, p.music * 0.7, time(), 0.02);
        target(sfxBus.gain, p.sfx * 0.65, time(), 0.02);
        lastLevels = key;
      }
      if (!p.music) clearVoices("music");
      if (!p.sfx) { clearVoices("sfx"); killEngine(); }
      if (p.eco && !lastEco) {
        const music = Array.from(voices).filter((v) => v.channel === "music");
        music.slice(0, Math.max(0, music.length - 9)).forEach(drop);
      }
      lastEco = p.eco;
      return p;
    }
    function note(channel, midi, at, duration, level, type = "sine", attack = 0.015, endMidi) {
      if (!available()) return;
      const p = settings();
      if (!p[channel]) return;
      const channelVoices = Array.from(voices).filter((v) => v.channel === channel);
      const cap = channel === "music" ? (p.eco ? 9 : 14) : 7;
      if (channelVoices.length >= cap) drop(channelVoices[0]);
      let osc, gain;
      try {
        osc = ctx.createOscillator(); gain = ctx.createGain();
        const voice = { osc, gain, channel };
        at = Math.max(time(), finite(at, time()));
        duration = clamp(duration, 0.06, 4);
        attack = Math.min(attack, duration * 0.4);
        osc.type = type;
        osc.frequency.setValueAtTime(hz(midi), at);
        if (Number.isFinite(endMidi)) osc.frequency.exponentialRampToValueAtTime(hz(endMidi), at + duration * 0.75);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(clamp(level, 0, 0.16), at + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(gain); gain.connect(channel === "music" ? musicBus : sfxBus);
        voices.add(voice);
        osc.onended = () => { voices.delete(voice); disconnect(osc); disconnect(gain); };
        osc.start(at); osc.stop(at + duration + 0.02);
      } catch (_) {
        for (const voice of Array.from(voices)) if (voice.osc === osc) drop(voice);
        if (osc) disconnect(osc); if (gain) disconnect(gain);
      }
    }
    function barNote(at, p) {
      const bar = Math.floor(step / 8), sub = step % 8, chord = CHORDS[bar % 4];
      if (sub === 0) {
        chord.pad.slice(p.eco ? 1 : 0).forEach((n) => note("music", n, at, BEAT * 4.6, 0.029, "sine", 0.28));
      }
      if (sub === 0 || sub === 4) note("music", chord.bass, at, BEAT * 1.6, 0.1, "sine", 0.025);
      if (!p.eco || sub % 2 === 0) {
        // Two interlocking phrases leave breathing room between soft plucks.
        const n = chord.arp[MOTIF[(sub + (bar % 2) * 2) % 8]];
        note("music", n, at, BEAT * 1.25, sub % 2 ? 0.037 : 0.047, "sine", 0.014);
      }
      step++;
    }
    function updateEngine(p) {
      const a = actorNow;
      if (!available() || phaseName !== "racing" || !p.sfx || !a || a.dnf ||
          (a.finishTick !== null && a.finishTick !== undefined) || a.recoveryTicks > 0) {
        killEngine(); return;
      }
      const t = time();
      if (t - lastEngineTime < (p.eco ? 1 / 15 : 1 / 30)) return;
      lastEngineTime = t;
      if (!engine) {
        try {
          engine = { gain: null, filter: null, oscs: [] };
          const gain = engine.gain = ctx.createGain();
          const filter = engine.filter = ctx.createBiquadFilter();
          engine.oscs.push(ctx.createOscillator());
          engine.oscs.push(ctx.createOscillator());
          const oscs = engine.oscs;
          gain.gain.value = 0;
          filter.type = "lowpass"; filter.Q.value = 0.45;
          oscs[0].type = "sine"; oscs[1].type = "triangle";
          oscs.forEach((osc) => { osc.connect(filter); osc.start(); });
          filter.connect(gain); gain.connect(sfxBus);
          engine = { gain, filter, oscs };
        } catch (_) { killEngine(); return; }
      }
      const speed = clamp(a.speed / 9, 0, 1);
      const boost = Math.max(boostAmount, a.boosting || a.padTicks > 0 ? 1 : 0);
      // Slightly separated fundamentals make a rounded turbine, not a buzzer.
      // Velocity and boost glide rather than stepping with network snapshots.
      const pitch = 47 + speed * 90 + boost * 23;
      target(engine.oscs[0].frequency, pitch, t, 0.1);
      target(engine.oscs[1].frequency, pitch * 1.503, t, 0.12);
      target(engine.filter.frequency, 230 + speed * 310 + boost * 180, t, 0.1);
      target(engine.gain.gain, (0.013 + speed * 0.026 + boost * 0.01) * (a.offroad ? 0.65 : 1), t, 0.12);
    }
    function schedule() {
      clearTimer();
      if (!available()) return;
      const p = sync(), t = time();
      if (active() && p.music) {
        if (nextNote < t - 0.2) nextNote = t + 0.03; // Never catch up a background backlog.
        let count = 0;
        while (nextNote < t + 0.16 && count++ < 2) {
          barNote(nextNote, p); nextNote += BEAT / 2;
        }
      }
      updateEngine(p);
      if (phaseName === "finished" && resultUntil && t >= resultUntil) {
        resultUntil = 0; clearVoices("music");
      }
      if ((active() && (p.music || p.sfx)) || resultUntil > t) {
        timer = later(schedule, p.eco ? 100 : 50);
      }
    }
    function cue(name, notes, interval = 0.1, duration = 0.35, level = 0.085) {
      if (suppressCues || !available() || !["countdown", "racing", "finished"].includes(phaseName)) return;
      sync();
      if (!settings().sfx) return;
      const t = time();
      if (lastCue[name] !== undefined && t - lastCue[name] < 0.16) return;
      lastCue[name] = t;
      notes.forEach((n, i) => note("sfx", n, t + i * interval, duration, level, "sine", 0.016));
    }
    function countdown(value) {
      value = Math.ceil(finite(value));
      if (value === lastCountdown || value < 0 || value > 3) return;
      lastCountdown = value;
      if (value === 0) cue("go", [69, 74, 78], 0.065, 0.38);
      else cue("countdown", [value === 1 ? 69 : 66], 0, 0.22);
    }
    function pad() {
      if (!available()) return;
      cue("pad", [69, 74], 0.075, 0.4);
    }
    function checkpoint() {
      if (phaseName === "racing") cue("checkpoint", [74], 0, 0.15, 0.035);
    }
    function threat() { cue("threat", [57, 62], 0.1, 0.18, 0.055); }
    function recover() { cue("recover", [62, 57, 62], 0.11, 0.35); }
    function lap() { cue("lap", [66, 69, 74], 0.09, 0.45); }
    function finish() {
      if (finishPlayed || !available()) return;
      finishPlayed = true;
      cue("finish", [69, 74, 78, 81], 0.13, 0.7);
    }
    // Slipstream engaging: a quiet low airy tick, never a melodic reward.
    function draft() { cue("draft", [45, 52], 0.06, 0.22, 0.03); }
    function boost(value) { boostAmount = value === true ? 1 : clamp(value, 0, 1); }
    function phase(value) {
      value = value === "results" ? "finished" : value;
      if (!["countdown", "racing", "finished"].includes(value)) value = "lobby";
      if (value === phaseName) return;
      const previous = phaseName;
      phaseName = value;
      if (value === "lobby") {
        clearTimer(); clearVoices(); killEngine(); resultUntil = 0;
      } else if (value === "countdown") {
        clearVoices(); killEngine(); step = 0; nextNote = time() + 0.04;
        lastCountdown = null; resultUntil = 0; finishPlayed = false;
        for (const k of Object.keys(lastCue)) delete lastCue[k];
      } else if (value === "racing") {
        resultUntil = 0;
        if (previous === "countdown") countdown(0);
        nextNote = Math.max(nextNote, time() + 0.025);
      } else {
        clearVoices("music"); killEngine();
        if (available()) {
          resultUntil = time() + 3.4;
          [50, 57, 61, 66].forEach((n) => note("music", n, time() + 0.025, 3.2, 0.047, "sine", 0.2));
          finish();
        }
      }
      schedule();
    }
    function update(state, actor) {
      if (disposed) return;
      state = state && typeof state === "object" ? state : {};
      actorNow = actor || null;
      const tick = Number.isFinite(state.tick) ? state.tick : null;
      const actorId = actor && actor.id;
      const previousPassed = lastPassed, previousLap = lastLap;
      lastPassed = actor && Number.isFinite(actor.passed) ? actor.passed : null;
      lastLap = actor && Number.isFinite(actor.lap) ? actor.lap : null;
      const rewound = lastStateTick !== null && tick !== null && tick < lastStateTick;
      if (rewound) {
        lastEventTick = null; lastCountdown = null; lastSerial = 0; finishPlayed = false;
        step = 0; nextNote = time() + 0.04; clearVoices();
        for (const k of Object.keys(lastCue)) delete lastCue[k];
      }
      const skipEvents = baselineEvents || paused || !ready || rewound || actorId !== lastActorId;
      lastActorId = actorId;
      lastStateTick = tick;
      // Paused snapshots establish a fresh event baseline without playing old cues.
      if (paused || !ready) {
        for (const event of Array.isArray(state.events) ? state.events : []) lastSerial = Math.max(lastSerial, finite(event && event.serial));
        lastEventTick = tick; baselineEvents = true;
        return;
      }
      suppressCues = baselineEvents;
      phase(state.phase);
      suppressCues = false;
      if (state.phase === "countdown") {
        const value = Math.ceil(finite(state.countdown) / 60);
        if (baselineEvents) lastCountdown = value;
        else countdown(value);
      }
      let milestoneCue = false;
      if (Array.isArray(state.events)) {
        const seen = new Set();
        for (const event of state.events) {
          if (!event) continue;
          const serial = finite(event.serial);
          const fresh = serial > 0 ? serial > lastSerial : tick !== lastEventTick;
          lastSerial = Math.max(lastSerial, serial);
          if (skipEvents || !fresh || (event.id !== undefined && event.id !== actorId)) continue;
          const key = event.type + ":" + event.id;
          if (seen.has(key)) continue;
          seen.add(key);
          if (event.type === "coin") cue("coin", [81, 86], 0.04, 0.15, 0.045);
          else if (event.type === "item") cue("item", [74, 78], 0.07, 0.25, 0.055);
          else if (event.type === "shield" || event.type === "block") cue("shield", [69, 81], 0.07, 0.25, 0.055);
          else if (event.type === "pulse") cue("pulse", [54, 61, 66], 0.08, 0.25, 0.05);
          else if (event.type === "jump") cue("jump", [69, 76], 0.045, 0.19, 0.035);
          else if (event.type === "hit") cue("hit", [55, 50], 0.055, 0.18, 0.055);
          else if (event.type === "pad") pad();
          else if (event.type === "recover") recover();
          else if (event.type === "lap") {
            milestoneCue = true;
            if (state.phase !== "finished" && (!actor || actor.finishTick === null || actor.finishTick === undefined)) lap();
          }
          else if (event.type === "finish") { milestoneCue = true; finish(); }
        }
      }
      // Network snapshots may skip gates. One quiet cue acknowledges the new
      // checkpoint, never a catch-up burst, lap/finish double cue, or replay.
      if (!skipEvents && !milestoneCue && state.phase === "racing" && actor &&
          !actor.dnf && (actor.finishTick === null || actor.finishTick === undefined) &&
          previousPassed !== null && lastPassed > previousPassed && lastPassed % 20 !== 0 &&
          (lastLap === null || previousLap === null || lastLap === previousLap)) checkpoint();
      lastEventTick = tick; baselineEvents = false;
      const p = sync();
      updateEngine(p);
      if (timer === null) schedule();
    }
    function unlock(reuseOnly = false) {
      if (reuseOnly && (!gestureUnlocked || !ctx || ctx.state === "closed")) return Promise.resolve(false);
      if (disposed) return Promise.resolve(false);
      if (available()) { sync(); return Promise.resolve(true); }
      let resume, created = false;
      try {
        if (!ctx || ctx.state === "closed") {
          const AudioContext = options.AudioContext || root.AudioContext || root.webkitAudioContext;
          if (!AudioContext) return Promise.resolve(false);
          clearVoices(); killEngine();
          [musicBus, sfxBus, master, limiter].filter(Boolean).forEach(disconnect);
          ctx = new AudioContext(); created = true;
          master = ctx.createGain(); musicBus = ctx.createGain(); sfxBus = ctx.createGain();
          master.gain.value = 0.7; musicBus.gain.value = 0; sfxBus.gain.value = 0;
          musicBus.connect(master); sfxBus.connect(master);
          if (ctx.createDynamicsCompressor) {
            limiter = ctx.createDynamicsCompressor();
            limiter.threshold.value = -14; limiter.knee.value = 10; limiter.ratio.value = 6;
            limiter.attack.value = 0.006; limiter.release.value = 0.18;
            master.connect(limiter); limiter.connect(ctx.destination);
          } else master.connect(ctx.destination);
          lastLevels = "";
        }
        const token = ++generation, context = ctx;
        paused = false;
        ready = false;
        const pending = Array.from(suspensions);
        // The initial resume is synchronous in the gesture. A pending suspend
        // can still win later, so settle it before checking the latest intent.
        resume = ctx.state === "running" && !pending.length ? Promise.resolve() : ctx.resume();
        const stale = () => {
          if (!disposed && paused && context.state === "running") suspendContext(context);
          return disposed || paused || token !== generation || context !== ctx;
        };
        const finishUnlock = () => {
          if (stale()) return false;
          ready = context.state === "running";
          if (ready) { gestureUnlocked = true; nextNote = time() + 0.04; sync(); schedule(); }
          return ready;
        };
        return Promise.all([Promise.resolve(resume), ...pending]).then(() => {
          // Gesture permission survives an intentional immediate lobby stop.
          if (!disposed && !reuseOnly) gestureUnlocked = true;
          if (stale()) return false;
          if (context.state !== "running") {
            // This only reuses the gesture-authorized context. It cannot create
            // a context, revive a hidden/menu pause, or supersede a newer start.
            return Promise.resolve(context.resume()).then(finishUnlock, () => {
              if (token === generation) ready = false;
              return false;
            });
          }
          return finishUnlock();
        }, () => { if (token === generation) ready = false; return false; });
      } catch (_) {
        ready = false;
        if (created) {
          [musicBus, sfxBus, master, limiter].filter(Boolean).forEach(disconnect);
          try { Promise.resolve(ctx.close()).catch(() => {}); } catch (_) {}
          ctx = master = musicBus = sfxBus = limiter = null;
        }
        return Promise.resolve(false);
      }
    }
    // For an authoritative host start/resume, after a prior gesture unlock.
    // Callers must still gate this on visibility and their local pause menu.
    function resume() { return unlock(true); }
    function suspendContext(context) {
      if (!context || context.state !== "running") return Promise.resolve();
      try {
        const operation = Promise.resolve(context.suspend()).catch(() => {}).then(() => {
          suspensions.delete(operation);
        });
        suspensions.add(operation);
        return operation;
      } catch (_) { return Promise.resolve(); }
    }
    function pause() {
      generation++; paused = true; ready = false; baselineEvents = true;
      clearTimer(); clearVoices(); killEngine(); resultUntil = 0;
      return suspendContext(ctx);
    }
    function stop() {
      phaseName = "lobby"; actorNow = null; boostAmount = 0;
      lastStateTick = lastEventTick = lastCountdown = lastActorId = null;
      finishPlayed = false; step = 0; lastSerial = 0; lastPassed = lastLap = null;
      const result = pause();
      // A new start should announce its countdown; only resume suppresses history.
      baselineEvents = false;
      return result;
    }
    function destroy() {
      if (disposed) return Promise.resolve();
      stop(); disposed = true; generation++;
      if (ctx) {
        [musicBus, sfxBus, master, limiter].filter(Boolean).forEach(disconnect);
        try { return Promise.resolve(ctx.close()).catch(() => {}); } catch (_) {}
      }
      return Promise.resolve();
    }
    function diagnostics() {
      return Object.freeze({
        phase: phaseName, contextState: ctx ? ctx.state : "uninitialized",
        unlocked: gestureUnlocked, paused, ready, disposed,
        scheduled: timer !== null,
        musicVoices: Array.from(voices).filter((v) => v.channel === "music").length,
        sfxVoices: Array.from(voices).filter((v) => v.channel === "sfx").length,
        engineVoices: engine ? engine.oscs.length : 0,
      });
    }
    return Object.freeze({ unlock: () => unlock(false), resume, update, phase, countdown, checkpoint, pad, recover, lap, finish, boost, threat, draft, pause, stop, destroy, diagnostics });
  }
  return Object.freeze({ create });
});
