/* Space Man · shared spectator layer
   One way to watch, in every mode: a dock at the bottom edge that says who you
   are watching and what happens next, switches target with arrows, swipes,
   keys or a controller, and offers the mode's own next steps (overview, join,
   leave). Modes own who is watchable and how the camera follows; this module
   owns the look, the gestures and the wording. No gameplay, no network. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpaceManSpectate = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // Keyboard: arrows are the obvious pair, Q/E and [ ] keep a hand on WASD, V
  // toggles the mode's wide view. Modifier chords belong to the browser.
  const KEYS = Object.freeze({
    ArrowLeft: "prev", ArrowRight: "next", KeyQ: "prev", KeyE: "next",
    BracketLeft: "prev", BracketRight: "next", KeyV: "overview",
  });
  function keyAction(e) {
    if (!e || e.metaKey || e.ctrlKey || e.altKey) return null;
    return KEYS[e.code] || null;
  }

  // Controller, standard mapping: bumpers (4/5) or d-pad left/right (14/15)
  // switch, Y / triangle (3) toggles the wide view. Edge-triggered, so holding a
  // bumper moves one target, and a press carried over from play is ignored
  // until it is released.
  const PAD = Object.freeze([[4, "prev"], [14, "prev"], [5, "next"], [15, "next"], [3, "overview"]]);
  function padReader() {
    let held = null;
    const down = (gp, i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.55));
    return {
      read(gp) {
        if (!gp || !gp.buttons) { held = null; return null; }
        const now = PAD.map(([i]) => down(gp, i)), first = held === null;
        const was = held || now;
        held = now;
        if (first) return null;
        const i = now.findIndex((d, k) => d && !was[k]);
        return i < 0 ? null : PAD[i][1];
      },
      reset() { held = null; },
    };
  }

  // Next/previous through an ordered list of ids, wrapping. Nobody followed yet:
  // next starts at the front (the leader), previous at the back.
  function cycle(ids, current, dir) {
    if (!ids || !ids.length) return null;
    const at = ids.indexOf(current);
    if (at < 0) return dir < 0 ? ids[ids.length - 1] : ids[0];
    return ids[(at + (dir < 0 ? -1 : 1) + ids.length) % ids.length];
  }

  // The one line that teaches switching, in the language of the hand on the device.
  function hintFor(kind, count) {
    if (count < 2) return count ? "Only one left to watch" : "Nobody to watch yet";
    if (kind === "pad") return "LB RB or d-pad to switch · Y wide view";
    if (kind === "keys") return "← → or Q E to switch · V wide view";
    return "Swipe or tap ‹ › to switch";
  }

  // Horizontal swipe on the play surface: left = next, right = previous, like
  // flipping cards. Taps, vertical drags and presses on real controls pass by.
  function bindSwipe(surface, opts) {
    if (!surface || !surface.addEventListener) return () => {};
    let start = null;
    const isControl = (t) => !!(t && t.closest && t.closest("button,a,input,select,textarea,[role=button]"));
    const onDown = (e) => {
      start = opts.enabled() && e.isPrimary !== false && !isControl(e.target)
        ? { x: e.clientX, y: e.clientY, at: e.timeStamp || 0, id: e.pointerId } : null;
    };
    const onUp = (e) => {
      const s = start; start = null;
      if (!s || s.id !== e.pointerId || !opts.enabled()) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y, ms = (e.timeStamp || 0) - s.at;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5 || ms > 900) return;
      if (dx < 0) opts.onNext(); else opts.onPrev();
    };
    const onCancel = () => { start = null; };
    surface.addEventListener("pointerdown", onDown, { passive: true });
    surface.addEventListener("pointerup", onUp, { passive: true });
    surface.addEventListener("pointercancel", onCancel, { passive: true });
    return () => {
      surface.removeEventListener("pointerdown", onDown);
      surface.removeEventListener("pointerup", onUp);
      surface.removeEventListener("pointercancel", onCancel);
    };
  }

  // The dock. ids are `${prefix}Previous`, `${prefix}Next`, `${prefix}Name`,
  // `${prefix}Overview` and `${prefix}<Action id>`, so each mode's tests keep
  // stable handles. update() is cheap to call every frame: it only writes what
  // changed, and announces a new target once through its own live region
  // (announce: false when the mode already says it).
  function createBar(opts) {
    const doc = opts.doc || root.document, prefix = opts.prefix || "watch";
    const make = (tag, cls, text) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    const press = (label, cls, fn, aria) => {
      const b = make("button", cls, label);
      b.type = "button";
      if (aria) b.setAttribute("aria-label", aria);
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    const el = make("section", "sm-watch");
    el.hidden = true;
    el.setAttribute("aria-label", "Spectating");
    if (opts.mode) el.dataset.mode = opts.mode;
    const prev = press("‹", "sm-watch-step", opts.onPrev, opts.prevLabel || "Watch previous");
    const next = press("›", "sm-watch-step", opts.onNext, opts.nextLabel || "Watch next");
    prev.id = prefix + "Previous";
    next.id = prefix + "Next";
    const card = make("div", "sm-watch-card");
    const eyebrow = make("span", "sm-watch-eyebrow"), name = make("strong", "sm-watch-name"),
      detail = make("span", "sm-watch-detail"), hint = make("span", "sm-watch-hint");
    name.id = prefix + "Name";
    card.append(eyebrow, name, detail, hint);
    const row = make("div", "sm-watch-row");
    row.append(prev, card, next);
    const actions = make("div", "sm-watch-actions");
    const buttons = new Map();
    let overview = null;
    if (opts.onOverview) {
      overview = press(opts.overviewLabel || "Overview", "sm-watch-action", opts.onOverview);
      overview.id = prefix + "Overview";
      overview.setAttribute("aria-pressed", "false");
      actions.append(overview);
    }
    for (const a of opts.actions || []) {
      const b = press(a.label, "sm-watch-action" + (a.primary ? " sm-watch-primary" : ""), a.onClick);
      b.id = prefix + a.id[0].toUpperCase() + a.id.slice(1);
      buttons.set(a.id, b);
      actions.append(b);
    }
    const live = make("span", "sm-watch-live");
    live.setAttribute("aria-live", "polite");
    el.append(row, actions, live);
    (opts.parent || doc.body).append(el);

    const last = {};
    const put = (key, node, value) => {
      if (last[key] === value) return;
      last[key] = value;
      node.textContent = value;
    };
    const flag = (key, node, attr, value) => {
      if (last[key] === value) return;
      last[key] = value;
      if (attr === "hidden") node.hidden = !!value;
      else if (attr === "disabled") node.disabled = !!value;
      else node.setAttribute(attr, String(value));
    };
    function update(m) {
      const on = !!(m && m.active);
      flag("active", el, "hidden", !on);
      if (!on) return;
      const count = m.count == null ? 2 : m.count;
      put("eyebrow", eyebrow, m.eyebrow || "WATCHING");
      put("name", name, m.name || "");
      put("detail", detail, m.detail || "");
      put("hint", hint, m.hint != null ? m.hint : hintFor(m.inputKind || "touch", count));
      flag("tone", el, "data-tone", m.tone || "live");
      flag("input", el, "data-input", m.inputKind || "touch");
      flag("stepPrev", prev, "disabled", count < 2);
      flag("stepNext", next, "disabled", count < 2);
      if (overview) {
        flag("ovHidden", overview, "hidden", m.overviewAvailable === false);
        flag("ovPressed", overview, "aria-pressed", !!m.overview);
        put("ovLabel", overview, m.overview ? (opts.followLabel || "Follow") : (opts.overviewLabel || "Overview"));
      }
      const states = m.actions || {};
      for (const [id, b] of buttons) {
        const s = states[id] || {};
        flag(id + ":h", b, "hidden", !!s.hidden);
        flag(id + ":d", b, "disabled", !!s.disabled);
        if (s.label) put(id + ":l", b, s.label);
      }
      const said = m.announce || (m.name ? "Watching " + m.name : "");
      if (said && last.said !== said && opts.announce !== false) { last.said = said; live.textContent = said; }
    }
    return {
      el,
      update,
      isActive: () => !el.hidden,
      destroy() { el.remove(); },
    };
  }

  return { keyAction, padReader, cycle, hintFor, bindSwipe, createBar };
});
