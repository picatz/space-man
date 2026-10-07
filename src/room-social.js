/* Lobby ready, rematch votes and last-room memory for the online Arena and Star Circuit rooms.
 *
 * The wire carries a vote as an EMOTE with a forward-compatible id (6 AGAIN?, 7 READY; see
 * docs/wire-protocol.md section 10.8). The frame has no on/off byte, so every signal TOGGLES the
 * sender's vote and the host's tally is authoritative. A build that predates these ids drops them
 * at receipt, so such a host simply never shows a tally. Pure logic only: no DOM, no network. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SpaceManRoomSocial = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const AGAIN = 6, READY = 7;
  const IDS = Object.freeze({ again: AGAIN, ready: READY });
  const kindOf = (id) => id === READY ? 'ready' : id === AGAIN ? 'again' : null;
  const COUNTDOWN_MS = 3000;

  // Seated humans: players (not spectators). The roster never lists absent members.
  function eligible(roster) {
    const out = [];
    for (const r of Array.isArray(roster) ? roster : []) if (r && !r.spectator && r.role !== 1 && Number.isInteger(r.p)) out.push(r.p);
    return out;
  }

  function createVotes() {
    const sets = { ready: new Set(), again: new Set() };
    const bucket = (kind) => sets[kind] || null;
    return {
      toggle(kind, p) { const s = bucket(kind); if (!s || !Number.isInteger(p)) return false; if (s.has(p)) { s.delete(p); return false; } s.add(p); return true; },
      has(kind, p) { const s = bucket(kind); return !!s && s.has(p); },
      clear(kind) { const s = bucket(kind); if (s && s.size) { s.clear(); return true; } return false; },
      drop(p) { let any = false; for (const k of Object.keys(sets)) any = sets[k].delete(p) || any; return any; },
      // n of m seated humans have voted; `missing` lists who is still out. Votes from people who are
      // no longer seated (left, switched to watching) never count.
      tally(kind, roster) {
        const ps = eligible(roster), s = bucket(kind) || new Set(), missing = ps.filter(p => !s.has(p));
        return { n: ps.length - missing.length, m: ps.length, missing };
      },
    };
  }

  // Everyone has voted and there is somebody to play with. The host's own vote is part of "everyone".
  function unanimous(tally, minHumans) { return !!tally && tally.m >= (minHumans || 2) && tally.n === tally.m; }

  // Short cancellable countdown. evaluate(kind, due) arms it when the condition becomes true and
  // disarms it when it stops being true (someone left or un-voted); the host can cancel() it too.
  function createAutoStart(o) {
    const opts = o || {}, st = opts.setTimeout || setTimeout, ct = opts.clearTimeout || clearTimeout, delay = opts.delay || COUNTDOWN_MS;
    let timer = null, kind = null, endsAt = 0;
    const now = opts.now || (() => Date.now());
    function cancel() { if (timer !== null) ct(timer); timer = null; const was = kind; kind = null; endsAt = 0; return was; }
    return {
      evaluate(k, due) {
        if (!due) { if (kind === k) { cancel(); return true; } return false; }
        if (kind === k) return false;
        cancel(); kind = k; endsAt = now() + delay;
        timer = st(() => { const fired = kind; timer = null; kind = null; endsAt = 0; if (opts.fire) opts.fire(fired); }, delay);
        return true;
      },
      cancel,
      get kind() { return kind; },
      remainingMs() { return kind ? Math.max(0, endsAt - now()) : 0; },
    };
  }

  // The vote layer one room coordinator owns. `env` is the coordinator's live view:
  //   net.signal(id)   send a signal            host()            this client owns the room
  //   roster()         current roster rows      myP()/myRole()    this client's seat
  //   isLobby()        the room is in its lobby isOver()          the match/race just finished
  //   blocked()        connection trouble       changed()         status changed
  //   autoStart(kind)  host-only: begin the match (fires after the countdown)
  const PENDING_MS = 2500;
  function createRoomVotes(env) {
    const votes = createVotes(), sig = {}, pending = {}, unconfirmed = {}, suppressed = {};
    const stT = env.setTimeout || setTimeout, ctT = env.clearTimeout || clearTimeout, now = env.now || (() => Date.now());
    const pendTimers = {};
    let autoEnabled = true;
    const auto = createAutoStart({ setTimeout: stT, clearTimeout: ctT, now, delay: env.delay, fire(kind) { if (due(kind)) env.autoStart(kind); } });
    // The host is counted as already wanting a rematch: tapping Rematch starts it outright.
    function tally(kind) {
      const r = env.roster(), t = votes.tally(kind, r);
      if (kind === 'again' && env.host() && t.missing.indexOf(1) >= 0) { t.n++; t.missing = t.missing.filter(p => p !== 1); }
      return t;
    }
    const signature = (kind) => { const t = tally(kind); return t.n + '/' + t.m + ':' + t.missing.join(','); };
    function due(kind) {
      if (!env.host() || env.blocked()) return false;
      if (kind === 'ready') return autoEnabled && env.isLobby() && unanimous(tally('ready'));
      if (kind === 'again') return env.isOver() && unanimous(tally('again'));
      return false;
    }
    function evaluate() {
      if (!env.host()) { auto.cancel(); return; }
      for (const kind of ['ready', 'again']) {
        let ok = due(kind);
        if (ok && suppressed[kind] === signature(kind)) ok = false;       // the host cancelled this exact vote state
        if (!ok && suppressed[kind] !== undefined && suppressed[kind] !== signature(kind)) delete suppressed[kind];
        auto.evaluate(kind, ok);
      }
    }
    function settle(kind) { pending[kind] = 0; unconfirmed[kind] = false; if (pendTimers[kind]) { ctT(pendTimers[kind]); pendTimers[kind] = null; } }
    return {
      // A signal arrived (from the host's relay, or the host's own local event).
      onSignal(p, id) {
        const kind = kindOf(id); if (!kind) return false;
        if (p === env.myP()) settle(kind);
        // A vote that lands after its phase ended (a READY in flight as the
        // match starts, an AGAIN as the rematch begins) must not linger into
        // the next lobby or results screen and auto-start a round nobody asked for.
        if ((kind === 'ready' && !env.isLobby()) || (kind === 'again' && !env.isOver())) { env.changed(); return true; }
        votes.toggle(kind, p); evaluate(); env.changed(); return true;
      },
      // This client's own tap. The host tallies locally; a guest waits for the host's echo.
      vote(kind) {
        const id = IDS[kind]; if (!id || env.blocked() || env.myRole() !== 0) return false;
        if (kind === 'ready' && !env.isLobby()) return false;
        if (kind === 'again' && !env.isOver()) return false;
        if (env.host()) { votes.toggle(kind, env.myP()); env.net.signal(id); evaluate(); env.changed(); return true; }
        if (pending[kind]) return false;
        pending[kind] = now(); unconfirmed[kind] = false; env.net.signal(id);
        pendTimers[kind] = stT(() => { pendTimers[kind] = null; if (pending[kind]) { pending[kind] = 0; unconfirmed[kind] = true; env.changed(); } }, PENDING_MS);
        env.changed(); return true;
      },
      // A member left, was removed, or re-joined: their old votes do not carry over.
      drop(p) { if (votes.drop(p)) { evaluate(); env.changed(); } },
      // Snapshot observed: ready only lives in the lobby, again only in the results.
      observe() { let c = false; if (!env.isLobby()) c = votes.clear('ready') || c; if (!env.isOver()) c = votes.clear('again') || c; if (c) { for (const k of ['ready', 'again']) settle(k); evaluate(); } return c; },
      evaluate,
      cancelAuto() { const k = auto.cancel(); if (k) { suppressed[k] = signature(k); env.changed(); } return !!k; },
      setAutoStart(on) { autoEnabled = !!on; evaluate(); env.changed(); },
      reset() { votes.clear('ready'); votes.clear('again'); auto.cancel(); for (const k of ['ready', 'again']) { settle(k); delete suppressed[k]; } },
      status() {
        const out = {};
        for (const kind of ['ready', 'again']) { const t = tally(kind); out[kind] = { n: t.n, m: t.m, missing: t.missing, mine: votes.has(kind, env.myP()), pending: !!pending[kind], unconfirmed: !!unconfirmed[kind] }; }
        out.auto = auto.kind; out.autoMs = auto.remainingMs(); out.autoStart = autoEnabled;
        return out;
      },
    };
  }

  // Last room remembered on this device (SOC-03). Only the public join capability is stored:
  // {region, code, mode, ts}. Never a key, token or invite secret.
  const LAST_ROOM_TTL_MS = 20 * 60 * 1000;
  const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,40}$/;
  function sanitizeLastRoom(raw, nowMs) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const code = typeof raw.code === 'string' ? raw.code.trim() : '', ts = raw.ts;
    const region = typeof raw.region === 'string' && /^[A-Za-z0-9-]{0,12}$/.test(raw.region) ? raw.region : '';
    if (!CODE_RE.test(code) || typeof ts !== 'number' || !isFinite(ts)) return null;
    const age = nowMs - ts;
    if (age < 0 || age > LAST_ROOM_TTL_MS) return null;
    const mode = raw.mode === 'arena' || raw.mode === 'race' || raw.mode === 'runner' ? raw.mode : 'runner';
    return { region, code, mode, ts };
  }
  const lastRoomText = (r) => r ? (r.region ? r.region.toUpperCase() + '-' : '') + r.code : '';
  // Storage is injected (localStorage in the browser): every read and write is guarded, because a
  // private window or blocked site data must leave the game fully playable.
  function createLastRoomStore(o) {
    const opts = o || {}, key = opts.key || 'spaceman.lastroom.v1', now = opts.now || (() => Date.now());
    const store = () => { try { return opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null); } catch (_) { return null; } };
    return {
      save(entry) {
        const clean = sanitizeLastRoom(Object.assign({}, entry, { ts: now() }), now()); if (!clean) return null;
        try { const s = store(); if (s) s.setItem(key, JSON.stringify(clean)); } catch (_) {}
        return clean;
      },
      // The remembered room for `mode` while it is still recent; an expired or corrupt entry is removed.
      load(mode) {
        let raw = null;
        try { const s = store(); raw = s ? JSON.parse(s.getItem(key) || 'null') : null; } catch (_) { this.clear(); return null; }
        const clean = sanitizeLastRoom(raw, now());
        if (!clean) { if (raw) this.clear(); return null; }
        return !mode || clean.mode === mode ? clean : null;
      },
      clear() { try { const s = store(); if (s) s.removeItem(key); } catch (_) {} },
    };
  }
  return Object.freeze({ AGAIN, READY, IDS, COUNTDOWN_MS, LAST_ROOM_TTL_MS, kindOf, eligible, createVotes, unanimous, createAutoStart, createRoomVotes, sanitizeLastRoom, lastRoomText, createLastRoomStore });
});
