/* Render-only pose sampling. Never predicts, advances or changes race rules. */
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./math.js") : root.SpaceManMath);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpaceManRacePresentation = api;
})(typeof window !== "undefined" ? window : globalThis, function (MathKit) {
  "use strict";
  const clamp = MathKit.clamp,
    angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function capture(snapshot) {
    if (!snapshot) return null;
    return {
      tick: snapshot.tick,
      trackId: snapshot.trackId,
      epoch: snapshot.epoch,
      phase: snapshot.phase,
      actors: snapshot.actors.map((a) => ({
        id: a.id,
        x: a.x,
        y: a.y,
        heading: a.heading,
        recoveries: a.recoveries,
        recoveryTicks: a.recoveryTicks,
        z: a.z || 0,
        airRamp: a.airRamp || 0,
        airTicks: a.airTicks || 0,
      })),
    };
  }
  function between(previous, current, alpha = 1) {
    if (
      !previous ||
      !current ||
      previous.trackId !== current.trackId ||
      previous.epoch !== current.epoch ||
      (previous.phase === "finished" && current.phase !== "finished") ||
      previous.tick > current.tick
    )
      return current;
    const t = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1),
      byId = new Map(previous.actors.map((a) => [a.id, a]));
    return {
      ...current,
      actors: current.actors.map((a) => {
        const p = byId.get(a.id);
        // Rescues, rematches, reordered identities and implausible jumps snap. Never
        // interpolate a pilot across the level or through an old round.
        if (
          !p ||
          p.recoveries !== a.recoveries ||
          (!p.recoveryTicks && a.recoveryTicks) ||
          (p.airRamp && a.airRamp && (p.airRamp !== a.airRamp || p.airTicks > a.airTicks)) ||
          Math.hypot(a.x - p.x, a.y - p.y) > 120
        )
          return { ...a };
        return {
          ...a,
          x: p.x + (a.x - p.x) * t,
          y: p.y + (a.y - p.y) * t,
          heading: p.heading + angle(a.heading - p.heading) * t,
          ...airPose(p, a, t),
        };
      }),
    };
  }
  function airPose(previous, current, t) {
    const height = (a) => clamp(Number.isFinite(a.z) ? a.z : 0, 0, 32),
      before = previous.airRamp || 0, after = current.airRamp || 0;
    // Only interpolate heights that authority actually sent. In particular, a
    // missing apex snapshot cannot create a new parabola or extend a lost hop.
    // Keep the outgoing hop's identity until the interpolated landing completes.
    return {
      z: height(previous) + (height(current) - height(previous)) * t,
      airRamp: t === 1 ? after : before || after,
      airTicks: t === 1 ? (current.airTicks || 0) :
        clamp((previous.airTicks || 0) +
          ((after ? current.airTicks || 0 : before ? 30 : 0) - (previous.airTicks || 0)) * t, 0, 30),
    };
  }
  function createTimeline({ delayTicks = 3 } = {}) {
    let frames = [],
      playTick = null,
      lastNow = null,
      followedId = null;
    function reset() {
      frames = [];
      playTick = null;
      lastNow = null;
      followedId = null;
    }
    function sample(snapshot, now, { paused = false, actorId = null } = {}) {
      if (!snapshot) return null;
      const last = frames.at(-1);
      if (
        last &&
        (snapshot.trackId !== last.trackId || snapshot.epoch !== last.epoch ||
          snapshot.tick < last.tick || followedId !== actorId ||
          (last.phase === "finished" && snapshot.phase !== "finished"))
      ) {
        reset();
      }
      followedId = actorId;
      if (!frames.length || frames.at(-1).tick !== snapshot.tick) {
        frames.push(snapshot);
        if (frames.length > 10) frames.shift();
      } else {
        // Pause/roster/finish metadata can change without advancing a tick.
        // Keep the newest authority even when its pose timestamp is unchanged.
        frames[frames.length - 1] = snapshot;
      }
      const newest = frames.at(-1),
        oldest = frames[0];
      if (paused || newest.phase === "finished") {
        playTick = newest.tick;
        lastNow = now;
        return newest;
      }
      if (playTick === null || newest.tick - playTick > 18)
        playTick = Math.max(oldest.tick, newest.tick - delayTicks);
      const dt = lastNow === null ? 0 : clamp((now - lastNow) / 1000, 0, 0.1);
      lastNow = now;
      // Advance a continuous playback clock, bounded by received authoritative
      // samples. No extrapolation past the latest host pose, even during loss.
      const target = newest.tick - delayTicks;
      const rate = playTick < target - 1 ? 1.1 : 1;
      playTick = clamp(playTick + dt * 60 * rate, oldest.tick, newest.tick);
      let previous = oldest,
        current = newest;
      for (let i = 1; i < frames.length; i++) {
        if (frames[i].tick >= playTick) {
          previous = frames[i - 1];
          current = frames[i];
          break;
        }
      }
      const span = current.tick - previous.tick;
      const poses = between(
        previous,
        current,
        span ? clamp((playTick - previous.tick) / span, 0, 1) : 1,
      );
      // HUD and item/effect state use newest authority; only position, heading
      // and the received height/air progress are sampled.
      const byId = new Map(poses.actors.map((a) => [a.id, a]));
      return {
        ...newest,
        actors: newest.actors.map((a) => {
          const p = byId.get(a.id);
          return p && p.recoveries === a.recoveries
            ? { ...a, x: p.x, y: p.y, heading: p.heading, z: p.z, airRamp: p.airRamp, airTicks: p.airTicks }
            : { ...a };
        }),
      };
    }
    return { sample, reset };
  }
  // A view-independent sampler for the canvas path, including 20Hz network
  // authority. Keep it warm while WebGL is visible so a camera/context switch
  // cannot return to an old pose. It never writes to the simulation snapshot.
  function createSampler() {
    const timeline = createTimeline();
    let context = null;
    function reset() { context = null; timeline.reset(); }
    function sample(snapshot, options = {}) {
      if (!snapshot) { reset(); return null; }
      const actorId = snapshot.actors.find(a => a.id === options.actorId)?.id || snapshot.actors[0]?.id;
      const key = [snapshot.trackId, options.epoch ?? snapshot.epoch ?? null, actorId, !!options.network];
      const changed = !context || key.some((value, i) => value !== context[i]);
      if (changed) timeline.reset();
      context = key;
      if (options.network) return timeline.sample(
        { ...snapshot, epoch: options.epoch ?? snapshot.epoch }, options.now,
        { paused: options.paused, actorId });
      return between(changed ? null : options.previous, snapshot,
        options.paused || snapshot.phase === "finished" ? 1 : options.alpha);
    }
    return { sample, reset };
  }
  // Arena guests: the same playout buffer (3-tick delay, 1.1x catch-up, never
  // extrapolates) over fighter x/y. receive() records raw authority once per
  // snapshot; apply() samples it each frame and overwrites x/y (and px/py, so a
  // draw alpha of any value lands on the sampled pose) on the live state.
  function createArenaPlayout({ delayTicks = 3 } = {}) {
    const timeline = createTimeline({ delayTicks });
    let raw = null;
    const frame = (state, epoch) => ({
      tick: state.tick, trackId: state.arenaId, epoch,
      phase: state.phase === "over" ? "finished" : state.phase,
      actors: state.actors.map((a) => ({ id: a.id, x: a.x, y: a.y, heading: 0, recoveries: a.stocks })),
    });
    function reset() { raw = null; timeline.reset(); }
    function receive(state, epoch, now) {
      if (!state) { reset(); return; }
      raw = frame(state, epoch);
      timeline.sample(raw, now);
    }
    function apply(state, now, paused = false) {
      if (!state || !raw || raw.tick !== state.tick) return false;
      const pose = timeline.sample(raw, now, { paused });
      if (!pose) return false;
      const byId = new Map(pose.actors.map((a) => [a.id, a]));
      for (const a of state.actors) {
        const p = byId.get(a.id);
        if (p) { a.x = a.px = p.x; a.y = a.py = p.y; }
      }
      return true;
    }
    return { receive, apply, reset };
  }
  return Object.freeze({ capture, between, createTimeline, createSampler, createArenaPlayout });
});
