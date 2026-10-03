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
  function create() {
    let current = null,
      lastRecovery = null,
      lastActor = null;
    return {
      reset() {
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
        const portrait = Math.max(1, Math.min(1.95, 0.9 / aspect));
        // Fixed horizon: never roll or shake. Reduced motion removes speed zoom and
        // follow lag, rather than making the road turn underneath a fixed camera.
        const desired = {
          mode,
          x: actor.x - fx * (cockpit ? -6 : 132 * portrait),
          y: cockpit ? 34 : 94 + (portrait - 1) * 60,
          z: actor.y - fz * (cockpit ? -6 : 132 * portrait),
          heading: h,
          fov:
            (cockpit ? 68 : 59) +
            (!calm ? Math.min(4, Math.max(0, actor.speed || 0) * 0.5) : 0),
        };
        if (reset || calm) current = { ...desired };
        else {
          const t = 1 - Math.exp(-dt * 12);
          current.x = mix(current.x, desired.x, t);
          current.y = mix(current.y, desired.y, t);
          current.z = mix(current.z, desired.z, t);
          current.heading += wrap(h - current.heading) * t;
          current.fov = mix(current.fov, desired.fov, 1 - Math.exp(-dt * 3));
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
          fov: (current.fov * Math.PI) / 180,
          near: 2,
          far: 6500,
          mode,
        };
      },
    };
  }
  return Object.freeze({ MODES, create, wrap, travelHeading });
});
