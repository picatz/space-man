/* Render-only pose sampling. Never predicts, advances or changes race rules. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpaceManRacePresentation = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)),
    angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function capture(snapshot) {
    if (!snapshot) return null;
    return {
      tick: snapshot.tick,
      trackId: snapshot.trackId,
      actors: snapshot.actors.map((a) => ({
        id: a.id,
        x: a.x,
        y: a.y,
        heading: a.heading,
        recoveries: a.recoveries,
      })),
    };
  }
  function between(previous, current, alpha = 1) {
    if (
      !previous ||
      !current ||
      previous.trackId !== current.trackId ||
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
          Math.hypot(a.x - p.x, a.y - p.y) > 120
        )
          return { ...a };
        return {
          ...a,
          x: p.x + (a.x - p.x) * t,
          y: p.y + (a.y - p.y) * t,
          heading: p.heading + angle(a.heading - p.heading) * t,
        };
      }),
    };
  }
  function createTimeline({ delayTicks = 3 } = {}) {
    let frames = [],
      playTick = null,
      lastNow = null;
    function reset() {
      frames = [];
      playTick = null;
      lastNow = null;
    }
    function sample(snapshot, now, { paused = false } = {}) {
      if (!snapshot) return null;
      const last = frames.at(-1);
      if (
        last &&
        (snapshot.trackId !== last.trackId || snapshot.tick < last.tick)
      ) {
        reset();
      }
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
      // HUD and phase always use the newest authority; only x/y/heading are sampled.
      const byId = new Map(poses.actors.map((a) => [a.id, a]));
      return {
        ...newest,
        actors: newest.actors.map((a) => {
          const p = byId.get(a.id);
          return p && p.recoveries === a.recoveries
            ? { ...a, x: p.x, y: p.y, heading: p.heading }
            : { ...a };
        }),
      };
    }
    return { sample, reset };
  }
  return Object.freeze({ capture, between, createTimeline });
});
