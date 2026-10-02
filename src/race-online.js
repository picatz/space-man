/* Star Circuit authority boundary. Only the host runs Race.step. Guests send
 * normalized controls, never positions, checkpoints, fuel, or race results.
 * All clocks are caller-supplied monotonic milliseconds; no transport or DOM. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports
    ? require('./race.js') : root.SpaceManRace);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpaceManRaceOnline = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Race) {
  'use strict';
  const VERSION = 1, INPUT = 1, SNAPSHOT = 2, MAX_BYTES = 1024;
  const INPUT_BYTES = 19, HEADER_BYTES = 30, ACTOR_BYTES = 63, EVENT_BYTES = 8;
  const INPUT_TTL_MS = 200, REJOIN_MS = 10000, SNAPSHOT_MS = 50;
  const MAX_HUMANS = 4, PILOTS = 5, MAX_EVENTS = 12, NONE = 65535;
  const C = Race.constants;
  const DIFFICULTIES = ['easy', 'normal', 'hard'];
  const PHASES = ['countdown', 'racing', 'finished'];
  const STATUSES = ['lobby', 'running', 'paused'];
  const REASONS = [null, 'humans', 'grace', 'time', 'all'];
  const EVENTS = ['go', 'pad', 'recover', 'lap', 'finish', 'forfeit'];
  const FLOATS = ['x', 'y', 'heading', 'vx', 'vy', 'speed', 'fuel', 'progress'];
  const uint = (n, max = 0xffffffff) => Number.isInteger(n) && n >= 0 && n <= max;
  const validTime = (n) => Number.isFinite(n) && n >= 0;
  const blank = () => Race.command();
  const actorIndex = (id) => Number(id.slice(6));
  function configuration(options) {
    const o = options && typeof options === 'object' ? options : {};
    return {
      trackId: Race.course(o.trackId).id,
      difficulty: DIFFICULTIES.includes(o.difficulty) ? o.difficulty : 'normal',
      laps: Number.isFinite(o.laps) ? Math.max(1, Math.min(5, Math.floor(o.laps))) : 3,
    };
  }
  function makeState(rules) {
    return Race.create({ ...rules, count: PILOTS, finishMode: 'all-humans' });
  }
  function encodeInput(o) {
    if (!o || !uint(o.epoch) || !uint(o.seq) || !uint(o.tick) ||
        !uint(o.recoverEdges, NONE)) return null;
    const c = Race.command(o.command), b = new Uint8Array(INPUT_BYTES);
    const v = new DataView(b.buffer);
    b[0] = VERSION; b[1] = INPUT;
    v.setUint32(2, o.epoch, true); v.setUint32(6, o.seq, true);
    v.setUint32(10, o.tick, true);
    v.setInt8(14, Math.round(c.steer * 127)); b[15] = Math.round(c.throttle * 255);
    b[16] = (c.brake ? 1 : 0) | (c.boost ? 2 : 0);
    v.setUint16(17, o.recoverEdges, true);
    return b;
  }
  function decodeInput(b) {
    if (!(b instanceof Uint8Array) || b.length !== INPUT_BYTES ||
        b[0] !== VERSION || b[1] !== INPUT || b[14] === 128 || b[16] > 3) return null;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return {
      epoch: v.getUint32(2, true), seq: v.getUint32(6, true), tick: v.getUint32(10, true),
      recoverEdges: v.getUint16(17, true),
      command: Race.command({ steer: v.getInt8(14) / 127, throttle: b[15] / 255,
        brake: !!(b[16] & 1), boost: !!(b[16] & 2) }),
    };
  }
  function encodeSnapshot(host) {
    const s = host.state, events = host.events.slice(-MAX_EVENTS);
    const b = new Uint8Array(HEADER_BYTES + ACTOR_BYTES * PILOTS + EVENT_BYTES * events.length);
    const v = new DataView(b.buffer);
    b[0] = VERSION; b[1] = SNAPSHOT;
    v.setUint32(2, host.revision, true); v.setUint32(6, host.epoch, true);
    v.setUint32(10, s.tick, true); v.setUint16(14, s.raceTick, true);
    b[16] = Race.tracks.findIndex(t => t.id === s.trackId);
    b[17] = DIFFICULTIES.indexOf(s.difficulty); b[18] = s.laps;
    b[19] = STATUSES.indexOf(host.status); b[20] = PHASES.indexOf(s.phase);
    v.setUint16(21, s.countdown, true);
    v.setUint16(23, s.firstFinishTick === null ? NONE : s.firstFinishTick, true);
    b[25] = REASONS.indexOf(s.finishReason); b[26] = PILOTS;
    b[27] = host.seats.length; b[28] = events.length;
    let o = HEADER_BYTES;
    for (const a of s.actors) {
      const seat = host.seats.find(p => p.actorId === a.id);
      b[o] = actorIndex(a.id); b[o + 1] = seat ? seat.p : 0;
      b[o + 2] = seat ? (seat.connected ? 1 : 0) | (seat.forfeited ? 2 : 0) : 0;
      v.setUint32(o + 3, seat ? seat.seq : 0, true);
      v.setUint32(o + 7, seat ? seat.lastAcceptedTick : 0, true);
      v.setUint16(o + 11, seat ? seat.recoverEdges : 0, true);
      for (const [i, k] of FLOATS.entries()) v.setFloat32(o + 13 + i * 4, a[k], true);
      b[o + 45] = a.padTicks; b[o + 46] = a.padCooldown;
      b[o + 47] = a.nextGate; b[o + 48] = a.passed; b[o + 49] = a.lap;
      v.setUint16(o + 50, a.finishTick === null ? NONE : a.finishTick, true);
      b[o + 52] = (a.boosting ? 1 : 0) | (a.offroad ? 2 : 0) |
        (a.recoverHeld ? 4 : 0) | (a.dnf ? 8 : 0);
      v.setUint16(o + 53, a.recoveries, true); b[o + 55] = a.recoveryTicks;
      v.setUint16(o + 56, a.lastProgressTick, true);
      const remaining = seat && !seat.connected && !seat.forfeited
        ? Math.ceil(Math.max(0, REJOIN_MS - (host.now - seat.disconnectedAt))) : 0;
      v.setUint16(o + 58, remaining, true);
      b[o + 60] = seat ? seat.adjIdx : 255;
      b[o + 61] = seat ? seat.nounIdx : 255;
      b[o + 62] = seat ? seat.displayP : 0;
      o += ACTOR_BYTES;
    }
    for (const e of events) {
      v.setUint32(o, e.serial, true); b[o + 4] = EVENTS.indexOf(e.type);
      b[o + 5] = e.id ? actorIndex(e.id) : 255; b[o + 6] = e.lap || 0;
      o += EVENT_BYTES;
    }
    return b;
  }
  function decodeSnapshot(b) {
    if (!(b instanceof Uint8Array) || b.length < HEADER_BYTES || b.length > MAX_BYTES ||
        b[0] !== VERSION || b[1] !== SNAPSHOT || !Race.tracks[b[16]] ||
        !DIFFICULTIES[b[17]] || b[18] < 1 || b[18] > 5 || !STATUSES[b[19]] ||
        !PHASES[b[20]] || b[25] >= REASONS.length || b[26] !== PILOTS ||
        b[27] > MAX_HUMANS || b[28] > MAX_EVENTS || b[29] !== 0 ||
        b.length !== HEADER_BYTES + PILOTS * ACTOR_BYTES + b[28] * EVENT_BYTES) return null;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const state = makeState({ trackId: Race.tracks[b[16]].id,
      difficulty: DIFFICULTIES[b[17]], laps: b[18] });
    state.tick = v.getUint32(10, true); state.raceTick = v.getUint16(14, true);
    state.phase = PHASES[b[20]]; state.countdown = v.getUint16(21, true);
    const first = v.getUint16(23, true);
    state.firstFinishTick = first === NONE ? null : first;
    state.finishReason = REASONS[b[25]];
    const status = STATUSES[b[19]];
    if (state.raceTick > C.MAX_RACE_TICKS || state.countdown > C.COUNTDOWN ||
        state.tick !== C.COUNTDOWN - state.countdown + state.raceTick ||
        (state.phase === 'countdown') !== (state.countdown > 0) ||
        (state.phase === 'countdown' && state.raceTick !== 0) ||
        (state.phase === 'finished') !== !!state.finishReason ||
        (status === 'lobby' && (state.tick !== 0 || state.phase !== 'countdown')) ||
        (status === 'paused' && state.phase === 'finished') ||
        (first !== NONE && (first < 1 || first > state.raceTick))) return null;
    const seats = [], seenP = new Set();
    let o = HEADER_BYTES;
    for (const [index, a] of state.actors.entries()) {
      const p = b[o + 1], flags = b[o + 2], hasSeat = index < b[27];
      if (b[o] !== index || p > 48 || flags > 2 || (p && seenP.has(p)) ||
          (!hasSeat && p) || (hasSeat && !p && flags === 1)) return null;
      const seq = v.getUint32(o + 3, true), lastAcceptedTick = v.getUint32(o + 7, true);
      const recoverEdges = v.getUint16(o + 11, true), rejoinRemainingMs = v.getUint16(o + 58, true);
      if (lastAcceptedTick > state.tick || recoverEdges > seq || rejoinRemainingMs > REJOIN_MS ||
          (!hasSeat && (flags || seq || lastAcceptedTick || recoverEdges || rejoinRemainingMs)) ||
          (flags && rejoinRemainingMs)) return null;
      const adjIdx = b[o + 60], nounIdx = b[o + 61], displayP = b[o + 62];
      if ((adjIdx >= 64 && adjIdx !== 255) || (nounIdx >= 64 && nounIdx !== 255) ||
          (hasSeat ? displayP < 1 || displayP > 48 : displayP !== 0 || adjIdx !== 255 || nounIdx !== 255)) return null;
      if (hasSeat) {
        if (p) seenP.add(p);
        seats.push({ p, actorId: a.id, connected: !!(flags & 1), forfeited: !!(flags & 2),
          seq, lastAcceptedTick, recoverEdges, rejoinRemainingMs, adjIdx, nounIdx, displayP });
      }
      a.controller = hasSeat ? 'human' : 'cpu';
      for (const [i, k] of FLOATS.entries()) {
        a[k] = v.getFloat32(o + 13 + i * 4, true);
        if (!Number.isFinite(a[k])) return null;
      }
      if (Math.abs(a.x) > 8192 || Math.abs(a.y) > 8192 || Math.abs(a.heading) > Math.PI + 0.000001 ||
          Math.abs(a.vx) > 32 || Math.abs(a.vy) > 32 || a.speed < 0 || a.speed > 32 ||
          Math.abs(a.speed - Math.hypot(a.vx, a.vy)) > 0.001 || a.fuel < 0 || a.fuel > 100) return null;
      a.padTicks = b[o + 45]; a.padCooldown = b[o + 46]; a.nextGate = b[o + 47];
      a.passed = b[o + 48]; a.lap = b[o + 49];
      const finish = v.getUint16(o + 50, true), f = b[o + 52];
      a.finishTick = finish === NONE ? null : finish;
      a.boosting = !!(f & 1); a.offroad = !!(f & 2); a.recoverHeld = !!(f & 4); a.dnf = !!(f & 8);
      a.recoveries = v.getUint16(o + 53, true); a.recoveryTicks = b[o + 55];
      a.lastProgressTick = v.getUint16(o + 56, true);
      if (a.padTicks > 45 || a.padCooldown > 95 || a.nextGate >= C.GATES ||
          a.passed > state.laps * C.GATES || a.nextGate !== (a.passed + 1) % C.GATES ||
          a.lap !== Math.floor(a.passed / C.GATES) + 1 ||
          a.progress < a.passed || a.progress >= a.passed + 1 ||
          f > 15 || a.recoveries > state.raceTick || a.recoveryTicks > 90 ||
          a.lastProgressTick > state.raceTick || a.dnf !== !!(flags & 2) ||
          (a.dnf && (a.finishTick !== null || a.speed !== 0 || a.boosting || a.recoveryTicks)) ||
          (finish !== NONE && (finish < 1 || finish > state.raceTick || a.passed !== state.laps * C.GATES)) ||
          (finish === NONE && a.passed === state.laps * C.GATES)) return null;
      o += ACTOR_BYTES;
    }
    // These are detached presentation data. They are never restored into a host.
    state.events = [];
    for (let i = 0; i < b[28]; i++) {
      const serial = v.getUint32(o, true), type = EVENTS[b[o + 4]], index = b[o + 5], lap = b[o + 6];
      if (!serial || !type || b[o + 7] !== 0 ||
          (i && serial <= state.events[i - 1].serial) ||
          (type === 'go' ? index !== 255 : index >= PILOTS) ||
          (type === 'lap' ? lap < 2 || lap > state.laps + 1 : lap !== 0)) return null;
      const event = { serial, type };
      if (index !== 255) event.id = 'pilot-' + index;
      if (lap) event.lap = lap;
      state.events.push(event); o += EVENT_BYTES;
    }
    const humans = state.actors.filter(a => a.controller === 'human');
    const finishes = humans.filter(a => a.finishTick !== null).map(a => a.finishTick);
    if ((finishes.length ? Math.min(...finishes) : null) !== state.firstFinishTick) return null;
    const allDone = state.actors.every(a => a.finishTick !== null || a.dnf);
    const humansDone = humans.length > 0 && humans.every(a => a.finishTick !== null || a.dnf);
    const graceDone = first !== NONE && state.raceTick - first >= C.FINISH_GRACE_TICKS;
    const timedOut = state.raceTick >= C.MAX_RACE_TICKS;
    if (state.phase === 'finished') {
      const expected = humansDone ? 'humans' : allDone ? 'all' : graceDone ? 'grace' : timedOut ? 'time' : null;
      if (state.finishReason !== expected) return null;
      state.results = Race.standings(state).map((a, i) => ({ id: a.id, name: a.name,
        position: i + 1, time: a.finishTick === null ? null : a.finishTick * C.STEP,
        finished: a.finishTick !== null }));
    } else if (state.phase === 'racing' && state.raceTick > 0 && (allDone || humansDone || graceDone || timedOut)) return null;
    return { revision: v.getUint32(2, true), epoch: v.getUint32(6, true), status, state, seats };
  }
  function createHost(options) {
    let rules = configuration(options), roster = [], seats = [], state = makeState(rules);
    let epoch = 0, revision = 0, status = 'lobby', eventSerial = 0, events = [], now = 0;
    function record(e) { events.push({ ...e, serial: ++eventSerial }); events = events.slice(-MAX_EVENTS); }
    function clearCommand(s) {
      s.command = blank(); s.pendingRecover = false; s.pendingAt = -Infinity; s.receivedAt = -Infinity;
    }
    function assign() {
      seats = roster.filter(r => r.role === 0).sort((a, b) => a.p - b.p).slice(0, MAX_HUMANS)
        .map((r, i) => ({ p: r.p, identity: r.identity, actorId: 'pilot-' + i,
          connected: true, forfeited: false, disconnectedAt: null, seq: 0, recoverEdges: 0,
          adjIdx: r.adjIdx, nounIdx: r.nounIdx, displayP: r.p,
          lastAcceptedTick: 0, bucket: 12, bucketAt: now, command: blank(),
          pendingRecover: false, pendingAt: -Infinity, receivedAt: -Infinity }));
      for (const a of state.actors) a.controller = seats.some(s => s.actorId === a.id) ? 'human' : 'cpu';
    }
    function expire(s) {
      const a = state.actors[actorIndex(s.actorId)];
      if (!s.connected && !s.forfeited && state.phase !== 'finished' && a.finishTick === null &&
          s.disconnectedAt !== null && now - s.disconnectedAt >= REJOIN_MS) {
        s.forfeited = true; clearCommand(s);
        Object.assign(a, { dnf: true, vx: 0, vy: 0, speed: 0, boosting: false,
          padTicks: 0, recoveryTicks: 0, recoverHeld: false });
        record({ type: 'forfeit', id: a.id });
      }
    }
    function syncRoster(rows, time) {
      if (!validTime(time)) return false;
      now = Math.max(now, time);
      const seenP = new Set(), seenIdentity = new Set();
      roster = (Array.isArray(rows) ? rows : []).filter(r => {
        if (!r || !uint(r.p, 48) || r.p === 0 || (r.role !== 0 && r.role !== 1) ||
            typeof r.identity !== 'string' || !r.identity || r.identity.length > 128 ||
            seenP.has(r.p) || seenIdentity.has(r.identity)) return false;
        seenP.add(r.p); seenIdentity.add(r.identity); return true;
      }).slice(0, 48).map(r => ({ p: r.p, identity: r.identity, role: r.role,
        adjIdx: uint(r.adjIdx, 63) ? r.adjIdx : 255,
        nounIdx: uint(r.nounIdx, 63) ? r.nounIdx : 255 }));
      if (status === 'lobby') { state = makeState(rules); assign(); }
      else for (const s of seats) {
        expire(s);
        const peer = !s.forfeited && roster.find(r => r.identity === s.identity && r.role === 0);
        const connected = !!peer;
        if (connected !== s.connected || (peer && peer.p !== s.p)) {
          clearCommand(s); s.connected = connected;
          s.disconnectedAt = connected ? null : now;
          if (peer) s.p = peer.p;
        }
      }
      // A transport P may be recycled while its old pilot is disconnected.
      // Preserve that pilot by identity and displayP; zero means no current P.
      for (const s of seats) if (!s.connected && seats.some(other => other !== s && other.connected && other.p === s.p)) s.p = 0;
      Race.checkFinish(state);
      if (state.phase === 'finished') status = 'running';
      return true;
    }
    function configure(next) {
      if (status !== 'lobby') return false;
      rules = configuration(next); state = makeState(rules); events = []; assign(); return true;
    }
    function start() {
      if (roster.filter(r => r.role === 0).length > MAX_HUMANS || epoch === 0xffffffff) return false;
      epoch++; status = 'running'; state = makeState(rules); events = []; assign(); return true;
    }
    function lobby() {
      if (epoch === 0xffffffff) return false;
      epoch++; status = 'lobby'; state = makeState(rules); events = []; assign(); return true;
    }
    function pause(on) {
      if (status === 'lobby' || state.phase === 'finished') return false;
      if ((status === 'paused') === !!on) return true;
      if (epoch === 0xffffffff) return false;
      status = on ? 'paused' : 'running'; epoch++;
      for (const s of seats) {
        clearCommand(s); Object.assign(s, { seq: 0, recoverEdges: 0, lastAcceptedTick: 0,
          bucket: 12, bucketAt: now });
        state.actors[actorIndex(s.actorId)].recoverHeld = false;
      }
      return true;
    }
    function receive(p, identity, bytes, time) {
      const input = decodeInput(bytes);
      const s = seats.find(s => s.p === p && s.identity === identity && s.connected && !s.forfeited);
      if (!validTime(time) || !input || !s || status !== 'running' || state.phase === 'finished' ||
          state.actors[actorIndex(s.actorId)].finishTick !== null || input.epoch !== epoch ||
          !input.seq || input.seq <= s.seq || input.seq - s.seq > 3600 ||
          input.tick + 120 < state.tick || input.tick > state.tick + 12 ||
          time < s.receivedAt || input.recoverEdges < s.recoverEdges ||
          input.recoverEdges - s.recoverEdges > Math.min(120, input.seq - s.seq)) return false;
      const budget = Math.min(12, s.bucket + Math.max(0, time - s.bucketAt) * 0.06);
      if (budget < 1) return false;
      now = Math.max(now, time); s.bucket = budget - 1; s.bucketAt = Math.max(s.bucketAt, time);
      if (input.recoverEdges > s.recoverEdges) { s.pendingRecover = true; s.pendingAt = time; }
      s.recoverEdges = input.recoverEdges; s.seq = input.seq; s.command = input.command;
      s.receivedAt = time; s.lastAcceptedTick = state.tick; return true;
    }
    function step(time) {
      if (!validTime(time)) return state;
      now = Math.max(now, time);
      if (status !== 'running' || state.phase === 'finished') return state;
      const commands = {};
      for (const a of state.actors) {
        const s = seats.find(s => s.actorId === a.id);
        if (!s) { commands[a.id] = Race.cpuInput(state, a); continue; }
        expire(s);
        const fresh = s.connected && !s.forfeited && now - s.receivedAt < INPUT_TTL_MS;
        commands[a.id] = fresh ? { ...s.command, recover: s.pendingRecover && now - s.pendingAt < INPUT_TTL_MS } : blank();
        s.pendingRecover = false; s.pendingAt = -Infinity;
      }
      Race.step(state, commands);
      for (const e of state.events) if (EVENTS.includes(e.type)) record(e);
      return state;
    }
    const host = { syncRoster, configure, start, lobby, pause, receive, step,
      packet() { if (revision === 0xffffffff) return null; revision++; return encodeSnapshot(host); },
      get state() { return state; }, get status() { return status; }, get seats() { return seats; },
      get epoch() { return epoch; }, get revision() { return revision; }, get events() { return events; },
      get now() { return now; } };
    return host;
  }
  function createClient(options = {}) {
    const hostId = options && uint(options.hostId, 48) && options.hostId > 0 ? options.hostId : 1;
    let current = null, eventSerial = 0, seq = 0, recoverEdges = 0, recoverHeld = false;
    function accept(bytes, sender) {
      // The transport must supply the authenticated sender, never a packet field.
      if (sender !== hostId) return null;
      const next = decodeSnapshot(bytes);
      if (!next || (current && (next.revision <= current.revision || next.epoch < current.epoch ||
          (next.epoch === current.epoch && next.state.tick < current.state.tick)))) return null;
      if (!current || next.epoch !== current.epoch) { seq = 0; recoverEdges = 0; recoverHeld = false; }
      next.state.events = next.state.events.filter(e => e.serial > eventSerial);
      for (const e of next.state.events) eventSerial = Math.max(eventSerial, e.serial);
      current = next; return next;
    }
    function input(command, p) {
      if (!current || current.status !== 'running' || current.state.phase === 'finished') return null;
      const s = current.seats.find(s => s.p === p && s.connected && !s.forfeited);
      if (!s || current.state.actors[actorIndex(s.actorId)].finishTick !== null) return null;
      seq = Math.max(seq, s.seq); recoverEdges = Math.max(recoverEdges, s.recoverEdges);
      if (seq === 0xffffffff) return null;
      const c = Race.command(command);
      if (c.recover && !recoverHeld) recoverEdges = Math.min(NONE, recoverEdges + 1);
      recoverHeld = c.recover;
      return encodeInput({ epoch: current.epoch, seq: ++seq, tick: current.state.tick, recoverEdges, command: c });
    }
    return { accept, input, get current() { return current; } };
  }
  return Object.freeze({ VERSION, MAX_BYTES, INPUT_BYTES, HEADER_BYTES, ACTOR_BYTES, EVENT_BYTES,
    INPUT_TTL_MS, REJOIN_MS, SNAPSHOT_MS, MAX_HUMANS, PILOTS, configuration,
    encodeInput, decodeInput, encodeSnapshot, decodeSnapshot, createHost, createClient });
});
