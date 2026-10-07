/* Presentation-only cameras: one simulation snapshot can feed any view. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpaceManRaceCamera = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const MODES = Object.freeze(["chase", "cockpit", "topdown"]);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const mix = (a, b, t) => a + (b - a) * t;
  // Look toward actual travel during a slide, so rotating the nose does not
  // sweep the road out of frame. Authoritative velocity works for old snapshots.
  function travelHeading(actor, weight = 0.7) {
    const h = actor.heading;
    if (!(actor.speed > 1.2) || !Number.isFinite(actor.vx) || !Number.isFinite(actor.vy)) return h;
    const slip = Math.max(-0.55, Math.min(0.55, wrap(Math.atan2(actor.vy, actor.vx) - h)));
    return h + slip * weight;
  }
  function laneHeading(actor, course, heading, back) {
    if (!course?.segments?.length) return heading;
    let distance = Infinity, side = 0;
    for (const line of course.segments) {
      const t = Math.max(0, Math.min(1, ((actor.x - line.x) * line.dx +
        (actor.y - line.y) * line.dy) / (line.length * line.length)));
      const dx = actor.x - line.x - line.dx * t,
        dy = actor.y - line.y - line.dy * t, squared = dx * dx + dy * dy;
      if (squared < distance) {
        distance = squared;
        side = -dx * Math.sin(heading) + dy * Math.cos(heading);
      }
    }
    // Recenter the road opening, not the eye or the pilot. Looking toward the
    // center 160 road units ahead fits both landing edges from the ±44 coin
    // lanes without a wider lens. The eye remains on the travel line; even
    // off-course traffic can turn the look direction by less than 20 degrees.
    const lane = Math.max(-52, Math.min(52, side));
    return heading + Math.max(-.34, Math.min(.34, Math.atan2(-lane, back + 160)));
  }
  // Boost punch: a brief FOV widen on pad / exit boost (and a smaller one when
  // the boost button engages). Peak degrees and decay seconds are exported.
  const KICK = Object.freeze({ padFov: 9, boostFov: 4.5, seconds: 0.6 });
  function create() {
    let current = null,
      lastRecovery = null,
      lastActor = null,
      kick = 0, lastPad = 0, lastBoost = false;
    return {
      reset() {
        kick = 0; lastPad = 0; lastBoost = false;
        current = null;
        lastRecovery = null;
        lastActor = null;
      },
      update(actor, course, at, options = {}) {
        if (!actor) return null;
        const mode = MODES.includes(options.mode) ? options.mode : "chase",
          calm = !!options.reduceMotion;
        const dt = Math.max(
          0,
          Math.min(0.1, Number.isFinite(options.dt) ? options.dt : 1 / 60),
        );
        // Edge-detect from authoritative fields so snapshots, interpolation and
        // late joins need no event: padTicks rising means a fresh pad/exit boost.
        const pad = Math.max(0, actor.padTicks || 0), boosting = !!actor.boosting;
        if (calm || mode === "topdown" || lastActor !== actor.id) { kick = 0; }
        else {
          kick = Math.max(0, kick - dt / KICK.seconds);
          if (pad > lastPad) kick = 1;
          else if (boosting && !lastBoost) kick = Math.max(kick, KICK.boostFov / KICK.padFov);
        }
        lastPad = pad; lastBoost = boosting;
        const reset =
          !current ||
          current.mode !== mode ||
          lastActor !== actor.id ||
          lastRecovery !== actor.recoveries;
        const h = travelHeading(actor, mode === "cockpit" ? 0.25 : 0.7),
          fx = Math.cos(h),
          fz = Math.sin(h);
        const cockpit = mode === "cockpit";
        const aspect = Number.isFinite(options.aspect)
          ? Math.max(0.1, options.aspect)
          : 1;
        const portrait = Math.max(1, Math.min(1.95, 0.9 / aspect)),
          back = cockpit ? -6 : 132 * portrait,
          framedHeading = laneHeading(actor, course, h, back);
        // A vertical-only FOV makes portrait Cockpit a narrow tunnel. Preserve
        // a useful horizontal opening for the full upcoming landing road;
        // landscape retains the existing 68-degree vertical lens.
        const cockpitFov = Math.max(68, Math.min(150, 2 * Math.atan(1 / aspect) * 180 / Math.PI));
        // Fixed horizon: never roll or shake. Reduced motion removes speed zoom and
        // follow lag, rather than making the road turn underneath a fixed camera.
        const desired = {
          mode, aspect,
          x: actor.x - fx * back,
          // Chase remains ground-relative throughout a hop. Cockpit adds only
          // a small, capped rise; its road target never lifts with the pilot.
          y: cockpit ? 34 + (calm ? 0 : Math.min(8, Math.max(0, Number.isFinite(actor.z) ? actor.z : 0))) : 94 + (portrait - 1) * 60,
          z: actor.y - fz * back,
          heading: framedHeading,
          fov:
            (cockpit ? cockpitFov : 59) +
            (!calm ? Math.min(4, Math.max(0, actor.speed || 0) * 0.5) : 0),
        };
        // Viewport rotation changes how much road must fit immediately. Do not
        // spend several frames at the old short Chase distance in portrait.
        if (reset || calm || current.aspect !== aspect) current = { ...desired };
        else {
          const t = 1 - Math.exp(-dt * 12);
          current.x = mix(current.x, desired.x, t);
          current.y = mix(current.y, desired.y, t);
          current.z = mix(current.z, desired.z, t);
          current.heading += wrap(framedHeading - current.heading) * t;
          // Rotation cannot temporarily narrow the newly required opening.
          current.fov = Math.max(cockpit ? cockpitFov : 59,
            mix(current.fov, desired.fov, 1 - Math.exp(-dt * 3)));
        }
        lastRecovery = actor.recoveries;
        lastActor = actor.id;
        const look = cockpit ? 360 : 270 + (portrait - 1) * 145;
        return {
          eye: [current.x, current.y, current.z],
          target: [
            current.x + Math.cos(current.heading) * look,
            cockpit ? 25 : 4,
            current.z + Math.sin(current.heading) * look,
          ],
          fov: ((current.fov + KICK.padFov * kick) * Math.PI) / 180,
          boostKick: kick,
          near: 2,
          far: 6500,
          mode,
        };
      },
    };
  }
  function createTopdown() {
    let current = null, context = null;
    function reset() { current = context = null; }
    function update(actor, options = {}) {
      if (!actor) { reset(); return null; }
      const heading = travelHeading(actor),
        portrait = !!options.portrait && !options.reduceMotion,
        desired = { x: actor.x + Math.cos(heading) * 105,
          y: actor.y + Math.sin(heading) * 105,
          rotation: portrait ? -heading - Math.PI / 2 : 0 },
        key = [actor.id, actor.recoveries, options.trackId, options.epoch, portrait],
        changed = !context || key.some((value, i) => value !== context[i]);
      // Preserve the old 60Hz tuning, but integrate elapsed display time. At
      // 120Hz two half-sized updates now equal one 60Hz update for a fixed goal.
      // Pausing does not let the road continue sliding underneath parked ships.
      const dt = options.paused ? 0 : Math.max(0, Math.min(.1,
        Number.isFinite(options.dt) ? options.dt : 1 / 60));
      if (changed) current = { ...desired };
      else {
        const position = 1 - Math.pow(1 - .12, dt * 60),
          rotation = 1 - Math.pow(1 - .1, dt * 60);
        current.x = mix(current.x, desired.x, position);
        current.y = mix(current.y, desired.y, position);
        current.rotation += wrap(desired.rotation - current.rotation) * rotation;
      }
      context = key;
      return { ...current };
    }
    return { update, reset };
  }
  return Object.freeze({ MODES, create, createTopdown, wrap, travelHeading, KICK });
});
