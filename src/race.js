/* Star Circuit: original top-down hoverkart racing. Pure 60 Hz simulation.
 * Commands in, serializable snapshots out. No browser, renderer or transport.
 * CPUs drive the same steering/acceleration model as human pilots. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpaceManRace = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const TAU = Math.PI * 2,
    STEP = 1 / 60,
    KART_RADIUS = 28,
    RUNOFF = 48,
    OFFCOURSE_TICKS = 120;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
  const pressed = (v) => v === true || v === 1;
  const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const wrap = (a, n) => ((a % n) + n) % n;
  function freeze(o) {
    Object.values(o).forEach((v) => {
      if (v && typeof v === "object") freeze(v);
    });
    return Object.freeze(o);
  }
  const tracks = freeze([
    {
      id: "starlight",
      name: "Starlight Speedway",
      subtitle: "Wide bends. Big sky. Your first orbit.",
      difficulty: "FLOWING",
      width: 180,
      sky: "#080f24",
      road: "#233550",
      edge: "#62e9e9",
      accent: "#b7f86d",
      planet: "#487b9e",
      points: [
        [360, 320],
        [920, 290],
        [1420, 410],
        [1650, 760],
        [1430, 1080],
        [920, 1110],
        [440, 1010],
        [190, 730],
        [160, 460],
      ],
      pads: [0.14, 0.56, 0.85],
    },
    {
      id: "ember",
      name: "Ember Switchback",
      subtitle: "A volcanic slalom with a fast outer sweep.",
      difficulty: "TECHNICAL",
      width: 172,
      sky: "#1b1022",
      road: "#493447",
      edge: "#ffb26e",
      accent: "#ffc663",
      planet: "#ba584e",
      points: [
        [420, 240],
        [860, 120],
        [1510, 330],
        [1520, 620],
        [1280, 820],
        [1280, 1140],
        [780, 1240],
        [300, 1130],
        [250, 930],
        [560, 690],
        [450, 470],
      ],
      pads: [0.13, 0.45, 0.77],
    },
    {
      id: "bloom",
      name: "Bloom Lagoon",
      subtitle: "An emerald ribbon around the orbital gardens.",
      difficulty: "SWEEPING",
      width: 176,
      sky: "#071f25",
      road: "#24464f",
      edge: "#96f1c1",
      accent: "#f4da8d",
      planet: "#3b9981",
      points: [
        [340, 310],
        [820, 200],
        [1290, 300],
        [1580, 600],
        [1450, 1020],
        [1070, 1230],
        [770, 1010],
        [390, 1190],
        [150, 880],
        [260, 590],
      ],
      pads: [0.12, 0.38, 0.7],
    },
    {
      // Append-only wire ID: existing course indexes must never move.
      id: "prism",
      name: "Prism Canyon",
      subtitle: "Wide canyon sweeps. A sky ramp. The prism gallery.",
      difficulty: "OPEN · MEDIUM",
      width: 208,
      sky: "#12152b",
      road: "#344559",
      edge: "#a8d7dc",
      accent: "#f4ce84",
      planet: "#736b96",
      points: [
        [315, 346.5], [871.5, 189], [1459.5, 283.5], [1680, 588],
        [1722, 997.5], [1375.5, 1186.5], [798, 1197], [315, 1050],
        [147, 735],
      ],
      pads: [.15, .52, .84],
      architecture: { gallery: { start: .58, end: .68, clearance: 210, span: 432 } },
    },
  ]);
  const colors = freeze([
    "#73ecff",
    "#ffbb69",
    "#c79aff",
    "#83edac",
    "#ff8baa",
    "#fff09d",
  ]);
  const cache = new Map(), featureCache = new Map();
  function track(id) {
    return tracks.find((t) => t.id === id) || tracks[0];
  }
  function course(id) {
    const def = track(id);
    if (cache.has(def.id)) return cache.get(def.id);
    const pts = [],
      p = def.points;
    for (let i = 0; i < p.length; i++) {
      const a = p[wrap(i - 1, p.length)],
        b = p[i],
        c = p[(i + 1) % p.length],
        d = p[(i + 2) % p.length];
      for (let j = 0; j < 24; j++) {
        const t = j / 24,
          t2 = t * t,
          t3 = t2 * t;
        const v = (k) =>
          0.5 *
          (2 * b[k] +
            (-a[k] + c[k]) * t +
            (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
            (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3);
        pts.push({ x: v(0), y: v(1) });
      }
    }
    let length = 0;
    const segments = pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length],
        dx = q.x - p.x,
        dy = q.y - p.y,
        l = Math.hypot(dx, dy);
      const s = {
        x: p.x,
        y: p.y,
        dx,
        dy,
        length: l,
        start: length,
        tx: dx / l,
        ty: dy / l,
      };
      length += l;
      return s;
    });
    const out = { ...def, runoff: RUNOFF, segments, length };
    out.gates = Array.from({ length: 20 }, (_, i) =>
      at(out, (i * length) / 20),
    );
    freeze(out);
    cache.set(def.id, out);
    return out;
  }
  function at(c, distance) {
    const s = wrap(distance, c.length);
    const line =
      c.segments.find((g) => g.start + g.length > s) ||
      c.segments[c.segments.length - 1];
    const t = (s - line.start) / line.length;
    return {
      x: line.x + line.dx * t,
      y: line.y + line.dy * t,
      tx: line.tx,
      ty: line.ty,
      s,
    };
  }
  function nearest(c, x, y) {
    // This hot path serves steering and iterative contacts. Keep just the best
    // scalars during the scan instead of allocating a new object per candidate.
    let best = null, dist = Infinity, bestX = 0, bestY = 0, bestS = 0;
    for (const g of c.segments) {
      const t = clamp(((x-g.x)*g.dx + (y-g.y)*g.dy)/(g.length*g.length), 0, 1),
        px = g.x + g.dx*t, py = g.y + g.dy*t,
        d = (x-px)**2 + (y-py)**2;
      if (d < dist) {
        dist = d; best = g; bestX = px; bestY = py; bestS = g.start+t*g.length;
      }
    }
    return best ? { x: bestX, y: bestY, tx: best.tx, ty: best.ty, s: bestS, distance: Math.sqrt(dist) } : null;
  }
  // This is the single geometry/rules catalog used by simulation, renderers,
  // CPU routing and wire validation. There is no screen-space collision data.
  function features(value = "starlight") {
    const c = course(typeof value === "string" ? value : value && (value.id || value.trackId));
    if (featureCache.has(c.id)) return featureCache.get(c.id);
    const catalog = { revision: 1, trackId: c.id, ramps: [], coins: [], rows: [] };
    if (c.id === "starlight") {
      catalog.ramps = [.175, .595].map((f, index) => ({
        id: "ramp-" + (index ? "b" : "a"), index, s: c.length * f,
        startS: c.length * f - 60, d: 0, width: 180, gate: index ? 11 : 3,
      }));
      catalog.coins = [.055, .075, .095, .115].map((f, index) => ({
        id: "entry-" + index, index, s: c.length * f, d: 44, airborne: false,
      }));
      for (const ramp of catalog.ramps) for (let i = 0; i < 3; i++) catalog.coins.push({
        id: "sky-" + (ramp.index ? "b" : "a") + "-" + i,
        index: catalog.coins.length, s: ramp.s + 54 * (i + 1),
        d: ramp.index ? 44 : -44, airborne: true,
      });
      catalog.rows = [.275, .705].map((f, index) => ({
        id: "item-row-" + (index ? "b" : "a"), index, s: c.length * f,
        gate: index ? 14 : 5,
        choices: ["shield", "pulse"].map((item, i) => ({
          id: "item-" + (index ? "b" : "a") + "-" + item,
          item, s: c.length * f, d: i ? 44 : -44,
        })),
      }));
    }
    if (c.id === "prism") {
      // One generous straight launch; every landing remains on visible road.
      const s = c.length * .195;
      catalog.ramps = [{ id: "prism-rise", index: 0, s, startS: s - 60,
        d: 0, width: c.width, gate: 3 }];
      catalog.coins = [.055, .08, .105].map((f, index) => ({
        id: "prism-entry-" + index, index, s: c.length * f, d: 44, airborne: false,
      }));
      for (let i=0; i<3; i++) catalog.coins.push({ id: "prism-sky-" + i,
        index: catalog.coins.length, s: s + 54 * (i+1), d: -44, airborne: true });
      catalog.rows = [{ id: "prism-exit", index: 0, s: c.length * .745, gate: 14,
        choices: ["shield", "pulse"].map((item, i) => ({
          id: "prism-exit-" + item, item, s: c.length * .745, d: i ? 44 : -44,
        })) }];
    }
    freeze(catalog); featureCache.set(c.id, catalog); return catalog;
  }
  const uint16 = (v) => Number.isInteger(v) && v >= 0 && v <= 65535 ? v : 0;
  const ownerSlot = (id) => /^pilot-[0-4]$/.test(id) ? Number(id.slice(6)) : -1;
  function lateral(a, n) { return -(a.x - n.x) * n.ty + (a.y - n.y) * n.tx; }
  function raceDistance(a, c) {
    const s = nearest(c, a.x, a.y).s, base = a.passed * c.length / 20;
    // Select the same unwrapped lap as ordered progress, including the tiny
    // negative start-grid offsets. Nearness across the loop is never a target.
    return base + ((s - base + c.length * 1.5) % c.length - c.length / 2);
  }
  function threats(state, actorId) {
    const a = state.actors.find(a => a.id === (typeof actorId === "string" ? actorId : actorId && actorId.id));
    if (!a || a.dnf || a.finishTick !== null || a.recoveryTicks || state.phase !== "racing") return [];
    const s = raceDistance(a, course(state.trackId));
    return state.effects.filter(e => e.ownerId !== a.id &&
      s >= (e.phase === "charge" ? e.s - 30 : e.s - KART_RADIUS) &&
      s <= (e.phase === "charge" ? e.s + 900 : e.originS + 336 + KART_RADIUS));
  }
  function observeWarnings(state, actorId, serials) {
    const victim = state.actors.findIndex(a => a.id === actorId);
    if (victim < 0 || !Array.isArray(serials) || state.phase !== "racing") return;
    const a = state.actors[victim];
    if (a.dnf || a.finishTick !== null || a.recoveryTicks) return;
    for (const e of state.effects) {
      const slot = ownerSlot(e.ownerId);
      if (slot < 0 || e.ownerId === actorId || uint16(serials[slot]) !== e.serial) continue;
      if (!e.observedAt) e.observedAt = state.actors.map(() => -1);
      if (e.observedAt[victim] < 0) e.observedAt[victim] = state.raceTick;
    }
  }
  function clearFeatures(state, actorId, options = {}) {
    if (!state) return;
    for (const a of state.actors) if (!actorId || a.id === actorId) {
      a.airRamp = a.airTicks = a.z = a.shieldTicks = a.slowTicks = 0;
      a.immunityTicks = options.keepItem && features(state.trackId).rows.length > 0 ? 90 : 0;
      if (!options.keepItem) a.item = null;
      state.effects = state.effects.filter(e => e.ownerId !== a.id);
      cancelControl(state, a.id);
    }
  }
  function featureTick(state, a, input, c) {
    for (const field of ["shieldTicks", "immunityTicks"])
      if (a[field] > 0) a[field]--;
    if (a.airRamp) {
      if (++a.airTicks >= 30) {
        a.airRamp = a.airTicks = a.z = 0;
        state.events.push({ type: "land", id: a.id });
      } else {
        const u = a.airTicks / 30;
        a.z = 10 * (1-u) + 96 * u * (1-u);
      }
    }
    observeWarnings(state, a.id, input.warnings);
    const edge = input.itemEdge > a._lastItemEdge || (!input.itemEdge && input.item && !a._itemHeld);
    if (input.itemEdge) a._lastItemEdge = Math.max(a._lastItemEdge, input.itemEdge);
    a._itemHeld = input.item;
    if (!edge || a.recoveryTicks || !a.item) return;
    if (a.item === "shield") {
      a.item = null; a.shieldTicks = 240;
      state.events.push({ type: "shield", id: a.id });
    } else if (a.airRamp) state.events.push({ type: "land-pulse", id: a.id });
    else if (ownerSlot(a.id) >= 0 && a.pulseSerial < 65535 &&
        state.effects.length < 5 && !state.effects.some(e => e.ownerId === a.id)) {
      const n = nearest(c, a.x, a.y), s = raceDistance(a, c);
      state.effects.push({ ownerId: a.id, serial: ++a.pulseSerial,
        phase: "charge", age: 0, s, originS: s, d: clamp(lateral(a, n), -44, 44),
        observedAt: state.actors.map(() => -1), _createdTick: state.raceTick });
      state.effects.sort((a, b) => a.ownerId.localeCompare(b.ownerId));
      a.item = null; state.events.push({ type: "pulse", id: a.id });
    }
  }
  function planeCross(c, s, old, a) {
    const p = at(c, s), before = (old.x-p.x)*p.tx + (old.y-p.y)*p.ty,
      after = (a.x-p.x)*p.tx + (a.y-p.y)*p.ty;
    if (before > 0 || after <= 0 || after <= before) return null;
    const t = -before / (after-before), x = old.x+(a.x-old.x)*t, y = old.y+(a.y-old.y)*t;
    return { t, d: -(x-p.x)*p.ty+(y-p.y)*p.tx, forward: a.vx*p.tx+a.vy*p.ty };
  }
  function pickupContact(c, object, old, a, radius) {
    const p = at(c, object.s), x = p.x-p.ty*object.d, y = p.y+p.tx*object.d,
      dx = a.x-old.x, dy = a.y-old.y, length2 = dx*dx+dy*dy,
      rx = old.x-x, ry = old.y-y, b = rx*dx+ry*dy,
      start = rx*rx+ry*ry-radius*radius;
    if (start <= 0) return 0;
    if (!length2) return null;
    const discriminant = b*b-length2*start;
    if (discriminant < 0) return null;
    const t = (-b-Math.sqrt(discriminant))/length2;
    return t >= 0 && t <= 1 ? t : null;
  }
  function sweepFeatures(state, a, c, old, n, exitBoosts) {
    if (!old.inside || old.released || a.recoveryTicks || a.dnf || a.finishTick !== null) return;
    const catalog = features(c);
    for (const ramp of catalog.ramps) {
      if (a.airRamp || a.rampMask & (1 << ramp.index) || a.passed % 20 !== ramp.gate) continue;
      const hit = planeCross(c, ramp.s, old, a);
      if (!hit || Math.abs(hit.d) > c.width/2 || hit.forward < 3.6) continue;
      a.rampMask |= 1 << ramp.index; a.airRamp = ramp.index+1; a.airTicks = 0; a.z = 10;
      a.drifting = false; a.driftTicks = a.driftDirection = 0; exitBoosts.delete(a.id);
      state.events.push({ type: "jump", id: a.id });
    }
    for (const coin of catalog.coins) {
      if (a.coinMask & (1 << coin.index) || coin.airborne && !a.airRamp) continue;
      // Accepted progress owns the lap. Reverse/backtrack may collect an
      // uncollected star but cannot refresh its per-pilot lap mask.
      if (pickupContact(c, coin, old, a, 24) === null) continue;
      a.coinMask |= 1 << coin.index; a.fuel = Math.min(100, a.fuel+6);
      state.events.push({ type: "coin", id: a.id });
    }
    for (const row of catalog.rows) {
      if (a.rowMask & (1 << row.index) || a.passed % 20 !== row.gate) continue;
      const hit = planeCross(c, row.s, old, a);
      if (!hit || Math.abs(hit.d) > safetyLimit(c)+18) continue;
      a.rowMask |= 1 << row.index;
      if (a.item) continue;
      const contacts = row.choices.map(object => ({ object, t: pickupContact(c, object, old, a, 26) }))
        .filter(hit => hit.t !== null).sort((a,b) => a.t-b.t || a.object.id.localeCompare(b.object.id));
      if (contacts.length) {
        a.item = contacts[0].object.item;
        state.events.push({ type: "item", id: a.id });
      }
    }
  }
  function stepEffects(state, c, previous) {
    const remaining = [];
    for (const e of state.effects) {
      const owner = state.actors.find(a => a.id === e.ownerId);
      if (!owner || owner.dnf || owner.finishTick !== null || owner.recoveryTicks) continue;
      if (e.phase === "charge") {
        e.s = raceDistance(owner, c);
        if (e._createdTick !== state.raceTick && ++e.age >= 54) {
          e.phase = "wave"; e.age = 0; e.originS = e.s = e.s + 56;
        }
        remaining.push(e); continue;
      }
      const oldS = e.s; e.age++; e.s = e.originS + e.age*12;
      const candidates = [];
      for (let i=0; i<state.actors.length; i++) {
        const a = state.actors[i], old = previous.get(a.id);
        if (a === owner || !old || a.airRamp || a.recoveryTicks || old.released ||
            a.dnf || a.finishTick !== null || a.immunityTicks ||
            !e.observedAt || e.observedAt[i] < 0 || state.raceTick-e.observedAt[i] < 36) continue;
        const s = raceDistance(a,c), n = nearest(c,a.x,a.y),
          oldN = nearest(c,old.x,old.y), oldProgress = s + (oldN.s-n.s+c.length*1.5)%c.length-c.length/2,
          before = oldProgress-oldS, after = s-e.s;
        // Intersect all relative sweep intervals. Checking only the final lane
        // would miss a kart that crossed the pulse during this physics step.
        // A wave already behind the kart is never a retrospective impact.
        if (before < -KART_RADIUS || after > before) continue;
        let enter = 0, leave = 1;
        const interval = (from,to,low,high) => {
          if (Math.abs(to-from) < 1e-9) return from >= low && from <= high;
          const first = (low-from)/(to-from), last = (high-from)/(to-from);
          enter = Math.max(enter,Math.min(first,last));
          leave = Math.min(leave,Math.max(first,last));
          return enter <= leave;
        };
        if (!interval(before,after,-KART_RADIUS,KART_RADIUS) ||
            !interval(lateral(old,oldN),lateral(a,n),e.d-KART_RADIUS-10,e.d+KART_RADIUS+10) ||
            !interval(oldProgress,s,e.originS,e.originS+336)) continue;
        candidates.push({ a, t: enter });
      }
      candidates.sort((a,b) => a.t-b.t || a.a.id.localeCompare(b.a.id));
      if (candidates.length) {
        const a = candidates[0].a;
        a.immunityTicks = 90;
        if (a.shieldTicks) {
          a.shieldTicks = 0; state.events.push({ type: "block", id: a.id });
        } else {
          a.vx *= .8; a.vy *= .8; a.speed = Math.hypot(a.vx,a.vy);
          a.slowTicks = 24; a.padTicks = 0; a.boosting = false;
          a.drifting = false; a.driftTicks = a.driftDirection = 0;
          state.events.push({ type: "hit", id: a.id });
        }
      } else if (e.age < 28) remaining.push(e);
    }
    state.effects = remaining;
  }
  function command(raw = {}) {
    raw = raw && typeof raw === "object" ? raw : {};
    return {
      steer: clamp(finite(raw.steer), -1, 1),
      throttle: clamp(finite(raw.throttle), 0, 1),
      brake: pressed(raw.brake),
      boost: pressed(raw.boost),
      recover: pressed(raw.recover),
      item: pressed(raw.item),
      itemEdge: uint16(raw.itemEdge),
      warnings: Array.from({ length: 5 }, (_, i) => uint16(Array.isArray(raw.warnings) && raw.warnings[i])),
    };
  }
  function create(options = {}) {
    options = options && typeof options === "object" ? options : {};
    const c = course(options.trackId),
      difficulty = ["easy", "normal", "hard"].includes(options.difficulty)
        ? options.difficulty
        : "normal";
    const count = clamp(Math.floor(finite(options.count, 5)), 1, 6),
      actors = [];
    for (let i = 0; i < count; i++) {
      const spawn = at(c, 38 - Math.floor(i / 2) * (KART_RADIUS * 3 + 4)),
        side = (i % 2 === 0 ? -1 : 1) * 30;
      actors.push({
        id: "pilot-" + i,
        name: ["Nova", "Comet", "Luma", "Moss", "Flare", "Echo"][i],
        controller: i === 0 ? "human" : "cpu",
        color: colors[i],
        x: spawn.x - spawn.ty * side,
        y: spawn.y + spawn.tx * side,
        heading: Math.atan2(spawn.ty, spawn.tx),
        steering: 0,
        neutralAssist: 1,
        driftTicks: 0,
        driftDirection: 0,
        drifting: false,
        vx: 0,
        vy: 0,
        speed: 0,
        fuel: 100,
        boosting: false,
        padTicks: 0,
        padCooldown: 0,
        nextGate: 1,
        passed: 0,
        lap: 1,
        finishTick: null,
        dnf: false,
        progress: 0,
        offroad: false,
        // Host-only bookkeeping; remote clients render authoritative snapshots.
        offroadTicks: 0,
        recoveries: 0,
        recoveryTicks: 0,
        recoverHeld: false,
        lastProgressTick: 0,
        item: null, coinMask: 0, rowMask: 0, rampMask: 0,
        airRamp: 0, airTicks: 0, z: 0,
        shieldTicks: 0, slowTicks: 0, immunityTicks: 0, pulseSerial: 0,
        _itemHeld: false, _lastItemEdge: 0,
      });
    }
    return {
      version: 2,
      trackId: c.id,
      difficulty,
      laps: clamp(Math.floor(finite(options.laps, 3)), 1, 5),
      tick: 0,
      raceTick: 0,
      phase: "countdown",
      countdown: options.expedition === true ? clamp(Math.floor(finite(options.countdownTicks, 60)), 0, 180) : 180,
      ...(options.expedition === true ? { maxRaceTicks: clamp(Math.floor(finite(options.maxTicks, 5400)), 1800, 10800) } : {}),
      actors,
      events: [],
      effects: [],
      catalogRevision: 1,
      results: null,
      // Local races keep their original first-human finish. Online authority
      // opts into a bounded finish window for all admitted human seats.
      finishMode: options.finishMode === "all-humans" ? "all-humans" : "first-human",
      firstFinishTick: null,
      finishReason: null,
    };
  }
  function cpuInput(state, actor) {
    const c = course(state.trackId), n = nearest(c, actor.x, actor.y),
      catalog = features(c), incoming = threats(state, actor.id),
      index = state.actors.indexOf(actor), s = raceDistance(actor, c),
      rivalAhead = state.actors.some(a => a !== actor && !a.dnf && a.finishTick === null &&
        raceDistance(a,c) > s && raceDistance(a,c) - s < 650),
      leading = standings(state)[0] === actor;
    let lane = 0;
    // Route deliberately through optional lines, with smooth look-ahead rather
    // than teleporting onto a pickup. These choices use only public state.
    if (catalog.coins.length && n.s >= 115 && n.s < c.length*.115+32) lane = 44;
    for (const ramp of catalog.ramps)
      if (n.s >= ramp.s-170 && n.s < ramp.s+184) lane = ramp.index ? 44 : -44;
    for (const row of catalog.rows) if (!(actor.rowMask & (1 << row.index)) &&
        n.s >= row.s-200 && n.s < row.s+24) {
      lane = incoming.length || leading || !rivalAhead ? -44 : 44;
    }
    // Observation is sent through the same command path as human display acks.
    // Reaction quality varies, while warning time/hitboxes/item power do not.
    const perceived = incoming.find(e => e.observedAt && e.observedAt[index] >= 0 &&
      state.raceTick-e.observedAt[index] >= ({easy:18, normal:12, hard:6}[state.difficulty]));
    if (perceived) {
      const currentLane = lateral(actor,n);
      lane = [-52,0,52].filter(d => Math.abs(d-perceived.d) > KART_RADIUS+10)
        .sort((a,b) => Math.abs(a-currentLane)-Math.abs(b-currentLane) || a-b)[0];
    }
    const ahead = at(c, n.s + 70 + actor.speed*13),
      targetX = ahead.x-ahead.ty*lane, targetY = ahead.y+ahead.tx*lane,
      desired = Math.atan2(targetY-actor.y,targetX-actor.x),
      turn = angle(desired-actor.heading),
      target = { easy: 4.5, normal: 5.6, hard: 6.35 }[state.difficulty] *
        (1-(actor.id.charCodeAt(actor.id.length-1)%3)*.025),
      useShield = actor.item === "shield" && !actor.shieldTicks && (perceived ||
        // An otherwise quiet easy race still teaches activation; keep most
        // shields for real threats and never infer another pilot's input.
        !incoming.length && state.raceTick % 240 === (index*31)%240),
      usePulse = actor.item === "pulse" && rivalAhead && !actor.airRamp &&
        !state.effects.some(e => e.ownerId === actor.id) &&
        state.raceTick % 12 === index%12;
    return command({
      steer: turn*1.85,
      throttle: actor.speed > target ? .2 : 1,
      brake: Math.abs(turn) > .9 && actor.speed > 3.3,
      boost: Math.abs(turn) < .16 && actor.fuel > 50 && state.difficulty !== "easy",
      recover: n.distance > c.width*2 || state.raceTick-actor.lastProgressTick > 720,
      item: !!(useShield || usePulse),
      warnings: Array.from({length:5}, (_,slot) => {
        const e = incoming.find(e => ownerSlot(e.ownerId) === slot); return e ? e.serial : 0;
      }),
    });
  }
  function cancelControl(state, actorId, options = {}) {
    if (!state) return;
    for (const a of state.actors) if (!actorId || a.id === actorId) {
      a.drifting = false; a.driftTicks = 0; a.driftDirection = 0;
      // Suppress a level held through a menu/release until an actual neutral
      // sample; authenticated monotonic edge counters remain consumed.
      a._itemHeld = true;
      if (options.resetEdges) a._lastItemEdge = 0;
      const index = state.actors.indexOf(a);
      if (!options.keepWarnings) for (const e of state.effects) if (e.observedAt) e.observedAt[index] = -1;
    }
  }
  function recover(state, a, c) {
    // Explicit rescue returns to the last verified gate, never a forward jump.
    const s = ((a.passed % 20) * c.length) / 20 + 12;
    let p = at(c, s), back = 0;
    // Keep repeated/simultaneous rescues clear before their visible release,
    // searching only backwards from the verified gate (never a shortcut).
    for (let slot = 0; slot <= state.actors.length; slot++) {
      back = slot * (KART_RADIUS * 3 + 4);
      p = at(c, s - back);
      if (state.actors.every(other => other === a || other.dnf || other.finishTick !== null ||
        Math.hypot(other.x-p.x, other.y-p.y) >= KART_RADIUS * 2 + 2)) break;
    }
    clearFeatures(state, a.id, { keepItem: true });
    a.x = p.x;
    a.y = p.y;
    a.heading = Math.atan2(p.ty, p.tx);
    a.steering = 0;
    a.neutralAssist = 1;
    a.driftTicks = 0;
    a.driftDirection = 0;
    a.drifting = false;
    a.vx = a.vy = a.speed = 0;
    a.fuel = Math.max(0, a.fuel - 25);
    a.boosting = false;
    a.padTicks = 0;
    a.offroad = false;
    a.offroadTicks = 0;
    a.progress = a.passed + Math.max(0, 12-back) / (c.length / 20);
    a.recoveryTicks = 90;
    a.recoveries++;
    a.lastProgressTick = state.raceTick;
    state.events.push({ type: "recover", id: a.id });
  }
  function safetyLimit(c) {
    return c.width / 2 + RUNOFF;
  }
  // The asphalt edge is a readable cue, not an invisible wall. The existing
  // apron offers a short, slower runoff route. Assistance shares the pilot's
  // yaw budget and never reverses a deliberate steering command.
  function roadSteering(a, c, n, input, turnSpeed) {
    const desired = input.steer,
      current = finite(a.steering),
      rate = desired === 0 ? 1 : desired * current < 0 ? 0.28 : 0.18;
    // Release/cancel is immediate; buildup and direction reversals are eased.
    a.steering = current + clamp(desired - current, -rate, rate);
    // Letting go must not instantly replace a manual turn with a full-strength
    // opposite correction. Reintroduce neutral assistance over 200 ms.
    a.neutralAssist = desired || input.brake || !input.throttle
      ? 0 : Math.min(1, finite(a.neutralAssist, 1) + 1 / 12);
    const yawLimit = a.drifting ? 0.055 : turnSpeed * (input.brake ? 1.22 : 1);
    let yaw = a.steering * yawLimit;
    const strength = clamp((n.distance - (c.width / 2 - KART_RADIUS - 6)) / 54, 0, 1);
    if (strength && n.distance <= safetyLimit(c) + 0.01 && input.throttle && !input.brake) {
      const behind = at(c, n.s - 28), ahead = at(c, n.s + 28),
        tangent = Math.atan2(ahead.y - behind.y, ahead.x - behind.x),
        backwards = Math.cos(a.heading - tangent) < -0.35,
        target = at(c, n.s + (backwards ? -1 : 1) * (110 + a.speed * 6)),
        targetHeading = Math.atan2(target.y - a.y, target.x - a.x),
        correction = clamp(angle(targetHeading - a.heading), -turnSpeed, turnSpeed) * strength * (desired ? 1 : a.neutralAssist);
      if (!desired || correction * desired >= 0) yaw += correction;
      else yaw += Math.sign(correction) * Math.min(Math.abs(correction), Math.abs(yaw) * 0.3);
    }
    a.heading = angle(a.heading + clamp(yaw, -yawLimit, yawLimit));
  }
  // Only the outer apron has a final safety contact. Preserve a fraction of
  // impact momentum as a slide instead of projecting a head-on kart to rest.
  // Already-invalid poses still correct gradually and never earn gate credit.
  function edgeContact(a, c, old, friction = true, readPosition = true) {
    const n = nearest(c, a.x, a.y), limit = safetyLimit(c);
    if (n.distance <= limit) return n;
    const nx = (a.x - n.x) / n.distance, ny = (a.y - n.y) / n.distance,
      correction = Math.min(n.distance - limit, old.inside || old.released ? 32 : 2);
    a.x -= nx * correction;
    a.y -= ny * correction;
    const outward = a.vx * nx + a.vy * ny;
    if (outward > 0) {
      const speed = Math.hypot(a.vx, a.vy), tx = -ny, ty = nx,
        tangent = a.vx * tx + a.vy * ty,
        direction = Math.abs(tangent) > 0.1 ? Math.sign(tangent) : Math.sign(n.tx * tx + n.ty * ty) || 1,
        // A small throttle-only glide prevents a pin against the last safety
        // edge. This is bounded physical movement, never a positional rescue.
        glide = old.inside && old.driving ? 1.8 : 0,
        slide = Math.max(Math.abs(tangent), Math.min(Math.max(speed * 0.82, glide), 4.2));
      a.vx = tx * slide * direction;
      a.vy = ty * slide * direction;
    }
    if (friction) { a.vx *= 0.995; a.vy *= 0.995; }
    return readPosition ? nearest(c, a.x, a.y) : null;
  }
  function step(state, inputs = {}) {
    inputs = inputs && typeof inputs === "object" ? inputs : {};
    state.events = [];
    if (state.phase === "finished") return state;
    state.tick++;
    if (state.phase === "countdown") {
      if (--state.countdown <= 0) {
        state.phase = "racing";
        state.events.push({ type: "go" });
      }
      return state;
    }
    state.raceTick++;
    const c = course(state.trackId),
      previous = new Map(), exitBoosts = new Set();
    for (const a of state.actors) {
      if (a.finishTick !== null || a.dnf) continue;
      const input = command(inputs[a.id]),
        rescuing = input.recover && !a.recoverHeld && a.recoveryTicks === 0;
      if (rescuing) {
        // Rescue wins a simultaneous Item edge: preserve the held item and
        // consume the command without leaving a queued post-recovery shot.
        recover(state, a, c);
        a._lastItemEdge = Math.max(a._lastItemEdge, input.itemEdge);
      } else featureTick(state, a, input, c);
      a.recoverHeld = input.recover;
      if (a.recoveryTicks > 0) {
        a.recoveryTicks--;
        // The release frame is already visible as an active kart. Resolve
        // contacts now, but keep the complete stationary recovery wait.
        if (a.recoveryTicks === 0) {
          a.immunityTicks = features(state.trackId).rows.length > 0 ? 90 : 0;
          previous.set(a.id, { x: a.x, y: a.y, released: true });
        }
        continue;
      }
      const n = nearest(c, a.x, a.y);
      previous.set(a.id, { x: a.x, y: a.y, inside: n.distance <= safetyLimit(c) + 0.01, driving: input.throttle > 0 && !input.brake });
      // The inner shoulder eases speed before the physical rail, without a
      // sudden low-speed clamp the moment a wheel grazes the painted edge.
      a.offroad = n.distance > c.width / 2 - 4;
      const trapped = n.distance > safetyLimit(c) - 1 &&
        a.speed < 0.75 && input.throttle > 0 && !input.brake;
      a.offroadTicks = n.distance > safetyLimit(c) || trapped
        ? finite(a.offroadTicks) + 1 : 0;
      if (n.distance > c.width / 2 + 120 || a.offroadTicks >= OFFCOURSE_TICKS) {
        recover(state, a, c);
        continue;
      }
      if (a.padCooldown > 0) a.padCooldown--;
      if (a.padTicks > 0) a.padTicks--;
      a.boosting = input.boost && a.fuel > 1 && !a.offroad && !input.brake && !a.slowTicks;
      a.fuel = clamp(a.fuel + (a.boosting ? -0.72 : 0.17), 0, 100);
      const speed = Math.hypot(a.vx, a.vy),
        // A small high-speed correction must not become a spin. Low-speed
        // manoeuvres stay nimble, while boost asks for a wider, cleaner line.
        turnSpeed = a.offroad ? 0.052 + Math.min(speed, 8) * 0.0042 :
          (0.054 - clamp(speed / 9, 0, 1) * 0.018) * clamp(speed / 2, 0.45, 1);
      const wasDrifting = !!a.drifting,
        driftDirection = Math.sign(input.steer),
        canDrift = input.throttle > 0 && input.brake && Math.abs(input.steer) >= 0.35 &&
          speed >= (wasDrifting ? 2.8 : 3.6) && !a.offroad && !a.airRamp;
      // Brake + steer carves a controlled slide. A sustained, same-direction
      // road corner earns one short exit boost; tapping, reversing, offroad,
      // input expiry and rescue cannot bank or release a reward.
      if (canDrift) {
        if (!wasDrifting || a.driftDirection !== driftDirection) a.driftTicks = 0;
        a.driftTicks = a.padTicks > 0 ? 0 : Math.min(60, finite(a.driftTicks) + Math.abs(input.steer));
        a.driftDirection = driftDirection;
      } else {
        if (wasDrifting && a.driftTicks >= 24 && !input.brake && input.throttle > 0 &&
            !a.offroad && !a.airRamp && !a.slowTicks && speed >= 2.8 && (Math.abs(input.steer) < 0.1 || driftDirection === a.driftDirection)) {
          exitBoosts.add(a.id);
        }
        a.driftTicks = 0;
        a.driftDirection = 0;
      }
      a.drifting = canDrift;
      roadSteering(a, c, n, input, turnSpeed);
      const fx = Math.cos(a.heading),
        fy = Math.sin(a.heading),
        invalid = !previous.get(a.id).inside,
        runoff = a.offroad && !invalid,
        forward = runoff || a.drifting ? speed : a.vx * fx + a.vy * fy,
        lateral = -a.vx * fy + a.vy * fx;
      const boost = !a.slowTicks && (a.boosting || a.padTicks > 0),
        shoulder = clamp((n.distance - (c.width / 2 - 4)) / RUNOFF, 0, 1),
        max = invalid ? 2.6 : a.offroad ? 5.2 - 1.5 * shoulder : a.drifting ? 5.6 : boost ? 9 : 6.4;
      let accel = input.throttle * (boost ? 0.19 : 0.125);
      if (input.brake) accel = a.drifting ? 0.06 : -0.2;
      const velocity = clamp(
          forward * (invalid ? 0.965 : 0.991) + accel,
          0,
          invalid ? max : Math.max(max, forward - 0.2),
        ),
        slide = lateral * (input.brake ? 0.82 : a.offroad && !invalid ? 0.88 : 0.65);
      if ((runoff || a.drifting) && speed > 0.001) {
        // Retain scalar momentum while the travel direction catches the nose.
        // A safety-edge slide can be sideways; projecting it onto the nose on
        // the next tick would erase the very momentum contact just preserved.
        const travel = Math.atan2(a.vy, a.vx),
          direction = travel + angle(a.heading - travel) * (a.drifting ? 0.16 : input.brake ? 0.2 : 0.32);
        a.vx = Math.cos(direction) * velocity;
        a.vy = Math.sin(direction) * velocity;
      } else {
        a.vx = fx * velocity - fy * slide;
        a.vy = fy * velocity + fx * slide;
      }
      a.x += a.vx;
      a.y += a.vy;
      a.speed = Math.hypot(a.vx, a.vy);
      if (
        !a.offroad && !a.drifting && !a.slowTicks &&
        a.padCooldown === 0 &&
        c.pads.some(
          (p) =>
            (Math.abs(angle((n.s / c.length - p) * TAU)) * c.length) / TAU < 23,
        )
      ) {
        a.padTicks = 45;
        a.padCooldown = 95;
        state.events.push({ type: "pad", id: a.id });
      }
    }
    // Solve kart/rail constraints together: a single pair pass followed by a
    // rail projection can squeeze a third kart back inside its neighbour.
    const active = state.actors.filter(a => previous.has(a.id) &&
      a.finishTick === null && !a.dnf && !a.recoveryTicks);
    const driven = new Map(active.map(a => [a.id, { x: a.x, y: a.y }]));
    for (let pass = 0; pass < 64; pass++) {
      let overlap = 0;
      for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j], dx = b.x-a.x, dy = b.y-a.y,
          d = Math.hypot(dx,dy);
        if (d >= KART_RADIUS * 2) continue;
        const nx = d > 0.01 ? dx / d : Math.cos(a.heading),
          ny = d > 0.01 ? dy / d : Math.sin(a.heading),
          push = (KART_RADIUS * 2 - d) * .5;
        overlap = Math.max(overlap, push * 2);
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        // Apply contact momentum once, not once per positional solver pass.
        const rel = (a.vx-b.vx)*nx + (a.vy-b.vy)*ny;
        if (pass === 0 && rel > 0) {
          a.vx -= nx*rel*.35; a.vy -= ny*rel*.35;
          b.vx += nx*rel*.35; b.vy += ny*rel*.35;
        }
      }
      for (const a of active) {
        const old = previous.get(a.id);
        if (old.inside || old.released) edgeContact(a, c, old, pass === 0, false);
      }
      // Rail projection can introduce a new pair penetration even if no pair
      // overlapped before projection, so measure the final constrained poses.
      overlap = 0;
      for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++)
        overlap = Math.max(overlap, KART_RADIUS * 2 - Math.hypot(active[i].x-active[j].x, active[i].y-active[j].y));
      if (overlap < 0.001) break;
    }
    for (const a of state.actors) {
      const old = previous.get(a.id);
      if (!old || a.finishTick !== null || a.dnf || a.recoveryTicks) continue;
      // Ordinary on-road contacts are physical movement, including a rail
      // contact at a bend. Invalid offcourse-pose correction is never progress.
      const onroad = old.inside || old.released;
      const n = onroad ? nearest(c, a.x, a.y) : edgeContact(a, c, old);
      const swept = onroad ? a : driven.get(a.id);
      a.offroad = n.distance > c.width / 2 - 4;
      a.speed = Math.hypot(a.vx, a.vy);
      sweepFeatures(state, a, c, old, n, exitBoosts);
      // Award after movement and contacts: crossing onto runoff while releasing
      // is a missed exit, not a free boost off the edge of the road.
      if (exitBoosts.has(a.id) && !a.offroad && !a.airRamp && !a.slowTicks && a.speed >= 2.8) {
        a.padTicks = Math.max(a.padTicks, 30);
        state.events.push({ type: "pad", id: a.id });
      }
      const gate = c.gates[a.nextGate],
        before = (old.x - gate.x) * gate.tx + (old.y - gate.y) * gate.ty,
        after = (swept.x - gate.x) * gate.tx + (swept.y - gate.y) * gate.ty;
      const crossed = before <= 0 && after > 0,
        fraction = crossed ? -before / (after - before) : 0;
      const crossX = old.x + (swept.x - old.x) * fraction,
        crossY = old.y + (swept.y - old.y) * fraction;
      const lateralGate = Math.abs(
        -(crossX - gate.x) * gate.ty + (crossY - gate.y) * gate.tx,
      );
      if (!old.released && crossed && lateralGate < safetyLimit(c) + 18) {
        a.passed++;
        a.nextGate = (a.nextGate + 1) % 20;
        a.lastProgressTick = state.raceTick;
        if (a.passed % 20 === 0) {
          a.lap++;
          a.coinMask = a.rowMask = a.rampMask = 0;
          state.events.push({ type: "lap", id: a.id, lap: a.lap });
          if (a.lap > state.laps) {
            a.finishTick = state.raceTick;
            clearFeatures(state, a.id);
            state.events.push({ type: "finish", id: a.id });
          }
        }
      }
      // Ranking is based on accepted gates plus bounded progress toward the next.
      const segmentStart = ((a.passed % 20) * c.length) / 20;
      let delta = wrap(n.s - segmentStart, c.length);
      if (delta > c.length * 0.5) delta = 0;
      a.progress = a.passed + clamp(delta / (c.length / 20), 0, 0.999);
    }
    // Impact is applied after movement. Count all 24 subsequent propulsion
    // steps, then let a new hit establish a fresh bounded timer.
    for (const a of state.actors) if (a.slowTicks > 0) a.slowTicks--;
    stepEffects(state, c, previous);
    checkFinish(state);
    return state;
  }
  // Authority may settle disconnected seats while paused without advancing physics.
  function checkFinish(state) {
    if (state.phase !== "racing") return state;
    const humans = state.actors.filter((a) => a.controller === "human");
    const finishedHumans = humans.filter((a) => a.finishTick !== null);
    if (state.firstFinishTick === null && finishedHumans.length)
      state.firstFinishTick = Math.min(...finishedHumans.map((a) => a.finishTick));
    const allDone = state.actors.every((a) => a.finishTick !== null || a.dnf);
    const humansDone = state.finishMode === "all-humans"
      ? humans.length > 0 && humans.every((a) => a.finishTick !== null || a.dnf)
      : humans.length > 0 && humans[0].finishTick !== null;
    const graceDone = state.finishMode === "all-humans" &&
      state.firstFinishTick !== null && state.raceTick - state.firstFinishTick >= 60 * 30;
    if (allDone || humansDone || graceDone || state.raceTick >= (state.maxRaceTicks || 60 * 300)) {
      state.finishReason = humansDone ? "humans" : allDone ? "all" : graceDone ? "grace" : "time";
      state.phase = "finished";
      clearFeatures(state);
      state.results = standings(state).map((a, i) => ({
        id: a.id,
        name: a.name,
        position: i + 1,
        time: a.finishTick === null ? null : a.finishTick * STEP,
        finished: a.finishTick !== null,
      }));
    }
    return state;
  }
  function standings(state) {
    return state.actors
      .slice()
      .sort((a, b) =>
        a.finishTick !== null && b.finishTick !== null
          ? a.finishTick - b.finishTick
          : a.finishTick !== null
            ? -1
            : b.finishTick !== null
              ? 1
              : b.progress - a.progress || a.id.localeCompare(b.id),
      );
  }
  function snapshot(state) {
    return JSON.parse(JSON.stringify(state));
  }
  return Object.freeze({
    constants: freeze({
      VERSION: 2,
      CATALOG_REVISION: 1,
      AIR_TICKS: 30,
      WARNING_TICKS: 36,
      MAX_EFFECTS: 5,
      TICK_RATE: 60,
      STEP,
      GATES: 20,
      COUNTDOWN: 180,
      KART_RADIUS,
      RUNOFF,
      OFFCOURSE_TICKS,
      FINISH_GRACE_TICKS: 60 * 30,
      MAX_RACE_TICKS: 60 * 300,
    }),
    tracks,
    course,
    features,
    threats,
    warningFor: threats,
    observeWarnings,
    clearFeatures,
    at,
    nearest,
    command,
    cancelControl,
    create,
    cpuInput,
    step,
    checkFinish,
    standings,
    snapshot,
  });
});
