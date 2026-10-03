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
        [300, 290],
        [880, 220],
        [1490, 360],
        [1570, 690],
        [1160, 790],
        [1390, 1150],
        [780, 1200],
        [330, 1080],
        [210, 810],
        [680, 670],
        [350, 540],
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
  ]);
  const colors = freeze([
    "#73ecff",
    "#ffbb69",
    "#c79aff",
    "#83edac",
    "#ff8baa",
    "#fff09d",
  ]);
  const cache = new Map();
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
    const out = { ...def, segments, length };
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
  function command(raw = {}) {
    raw = raw && typeof raw === "object" ? raw : {};
    return {
      steer: clamp(finite(raw.steer), -1, 1),
      throttle: clamp(finite(raw.throttle), 0, 1),
      brake: pressed(raw.brake),
      boost: pressed(raw.boost),
      recover: pressed(raw.recover),
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
      });
    }
    return {
      version: 1,
      trackId: c.id,
      difficulty,
      laps: clamp(Math.floor(finite(options.laps, 3)), 1, 5),
      tick: 0,
      raceTick: 0,
      phase: "countdown",
      countdown: 180,
      actors,
      events: [],
      results: null,
      // Local races keep their original first-human finish. Online authority
      // opts into a bounded finish window for all admitted human seats.
      finishMode: options.finishMode === "all-humans" ? "all-humans" : "first-human",
      firstFinishTick: null,
      finishReason: null,
    };
  }
  function cpuInput(state, actor) {
    const c = course(state.trackId),
      n = nearest(c, actor.x, actor.y),
      ahead = at(c, n.s + 70 + actor.speed * 13),
      desired = Math.atan2(ahead.y - actor.y, ahead.x - actor.x),
      turn = angle(desired - actor.heading);
    const target =
      { easy: 4.5, normal: 5.6, hard: 6.35 }[state.difficulty] *
      (1 - (actor.id.charCodeAt(actor.id.length - 1) % 3) * 0.025);
    return command({
      steer: turn * 1.85,
      throttle: actor.speed > target ? 0.2 : 1,
      brake: Math.abs(turn) > 0.9 && actor.speed > 3.3,
      boost:
        Math.abs(turn) < 0.16 && actor.fuel > 50 && state.difficulty !== "easy",
      recover:
        n.distance > c.width * 2 ||
        state.raceTick - actor.lastProgressTick > 720,
    });
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
    a.x = p.x;
    a.y = p.y;
    a.heading = Math.atan2(p.ty, p.tx);
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
  // Near a rail, turn only outward drive toward the local tangent. This is a
  // gradual heading correction, not a position snap or injected forward speed.
  // Inward steering, braking and free driving stay entirely in the pilot's hands.
  function guideRail(a, c, n, input) {
    const limit = c.width / 2 - KART_RADIUS,
      strength = clamp((n.distance - (limit - 10)) / 10, 0, 1);
    if (!strength || n.distance > limit + 0.01 || !input.throttle || input.brake) return;
    const nx = (a.x - n.x) / n.distance, ny = (a.y - n.y) / n.distance;
    if (Math.cos(a.heading) * nx + Math.sin(a.heading) * ny <= 0) return;
    // A short secant smooths the sampled centerline's segment joins. Keep
    // deliberate backwards driving backwards; a sideways impact defaults ahead.
    const behind = at(c, n.s - 18), ahead = at(c, n.s + 18),
      heading = Math.atan2(ahead.y - behind.y, ahead.x - behind.x),
      direction = Math.cos(a.heading - heading) < -0.35 ? -1 : 1,
      target = heading + (direction < 0 ? Math.PI : 0);
    a.heading = angle(a.heading + clamp(angle(target - a.heading), -0.09 * strength, 0.09 * strength));
  }
  // A continuous road-relative rail, shared by CPU and human pilots. Remove
  // only outward velocity (no bouncing); retain tangent motion around bends.
  // Existing invalid/offcourse poses move inward by at most two units per tick
  // until the explicit rescue takes over, rather than snapping to a nearby road.
  function edgeContact(a, c, old, friction = true, readPosition = true) {
    const n = nearest(c, a.x, a.y), limit = c.width / 2 - KART_RADIUS;
    if (n.distance <= limit) return n;
    const nx = (a.x - n.x) / n.distance, ny = (a.y - n.y) / n.distance;
    const wasInside = old.inside || old.released;
    const correction = Math.min(n.distance - limit, wasInside ? 32 : 2);
    a.x -= nx * correction;
    a.y -= ny * correction;
    const outward = a.vx * nx + a.vy * ny;
    if (outward > 0) {
      a.vx -= nx * outward;
      a.vy -= ny * outward;
    }
    // Gentle rail friction, independent of rendered frame rate.
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
      previous = new Map();
    for (const a of state.actors) {
      if (a.finishTick !== null || a.dnf) continue;
      const input = command(inputs[a.id]);
      if (input.recover && !a.recoverHeld && a.recoveryTicks === 0)
        recover(state, a, c);
      a.recoverHeld = input.recover;
      if (a.recoveryTicks > 0) {
        a.recoveryTicks--;
        // The release frame is already visible as an active kart. Resolve
        // contacts now, but keep the complete stationary recovery wait.
        if (a.recoveryTicks === 0) previous.set(a.id, { x: a.x, y: a.y, released: true });
        continue;
      }
      const n = nearest(c, a.x, a.y);
      previous.set(a.id, { x: a.x, y: a.y, inside: n.distance <= c.width / 2 - KART_RADIUS + 0.01 });
      // The inner shoulder eases speed before the physical rail, without a
      // sudden low-speed clamp the moment a wheel grazes the painted edge.
      a.offroad = n.distance > c.width / 2 - KART_RADIUS - 12;
      const trapped = n.distance > c.width / 2 - KART_RADIUS - 1 &&
        a.speed < 0.75 && input.throttle > 0 && !input.brake;
      a.offroadTicks = n.distance > c.width / 2 || trapped
        ? finite(a.offroadTicks) + 1 : 0;
      if (n.distance > c.width / 2 + 120 || a.offroadTicks >= OFFCOURSE_TICKS) {
        recover(state, a, c);
        continue;
      }
      if (a.padCooldown > 0) a.padCooldown--;
      if (a.padTicks > 0) a.padTicks--;
      a.boosting = input.boost && a.fuel > 1 && !a.offroad && !input.brake;
      a.fuel = clamp(a.fuel + (a.boosting ? -0.72 : 0.17), 0, 100);
      const speed = Math.hypot(a.vx, a.vy),
        turnSpeed = 0.026 + Math.min(speed, 7) * 0.0042;
      a.heading = angle(
        a.heading + input.steer * turnSpeed * (input.brake ? 1.22 : 1),
      );
      guideRail(a, c, n, input);
      const fx = Math.cos(a.heading),
        fy = Math.sin(a.heading),
        forward = a.vx * fx + a.vy * fy,
        lateral = -a.vx * fy + a.vy * fx;
      const boost = a.boosting || a.padTicks > 0,
        invalid = !previous.get(a.id).inside,
        shoulder = clamp((n.distance - (c.width / 2 - KART_RADIUS - 12)) / 12, 0, 1),
        max = invalid ? 2.6 : a.offroad ? 6.4 - 2.2 * shoulder : boost ? 9 : 6.4;
      let accel = input.throttle * (boost ? 0.19 : 0.125);
      if (input.brake) accel = -0.2;
      const velocity = clamp(
          forward * (invalid ? 0.965 : 0.991) + accel,
          0,
          invalid ? max : Math.max(max, forward - 0.14),
        ),
        slide = lateral * (input.brake ? 0.82 : 0.65);
      a.vx = fx * velocity - fy * slide;
      a.vy = fy * velocity + fx * slide;
      a.x += a.vx;
      a.y += a.vy;
      a.speed = Math.hypot(a.vx, a.vy);
      if (
        !a.offroad &&
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
      a.offroad = n.distance > c.width / 2 - KART_RADIUS - 12;
      a.speed = Math.hypot(a.vx, a.vy);
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
      if (!old.released && crossed && lateralGate < c.width / 2 + 18) {
        a.passed++;
        a.nextGate = (a.nextGate + 1) % 20;
        a.lastProgressTick = state.raceTick;
        if (a.passed % 20 === 0) {
          a.lap++;
          state.events.push({ type: "lap", id: a.id, lap: a.lap });
          if (a.lap > state.laps) {
            a.finishTick = state.raceTick;
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
    if (allDone || humansDone || graceDone || state.raceTick >= 60 * 300) {
      state.finishReason = humansDone ? "humans" : allDone ? "all" : graceDone ? "grace" : "time";
      state.phase = "finished";
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
      VERSION: 1,
      TICK_RATE: 60,
      STEP,
      GATES: 20,
      COUNTDOWN: 180,
      KART_RADIUS,
      OFFCOURSE_TICKS,
      FINISH_GRACE_TICKS: 60 * 30,
      MAX_RACE_TICKS: 60 * 300,
    }),
    tracks,
    course,
    at,
    nearest,
    command,
    create,
    cpuInput,
    step,
    checkFinish,
    standings,
    snapshot,
  });
});
