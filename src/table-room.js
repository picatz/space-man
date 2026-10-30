/* Space Man · tabletop room
   Play Together for turn-based games. The host owns the match: guests send
   move and rematch requests, the host checks them against the rules
   (SpaceManTabletop) and broadcasts the whole match after every change. A
   turn game sends a few bytes a minute, so there is no prediction, smoothing
   or input buffering here. The host is seat 1; the earliest other pilot is
   seat 2; everyone else watches. A rival who leaves frees the seat, and the
   next pilot to join picks the board up where it was.

   Frames (inside the transport's encrypted 'table' channel, docs/wire-protocol.md):
     SNAP  0x01 seat1P seat2P readyMask match...   host -> everyone
     MOVE  0x02 revLo revHi move                   seated guest -> host
     READY 0x03 revLo revHi                        seated guest -> host (rematch) */
(function (root) {
  'use strict';
  const SNAP = 1, MOVE = 2, READY = 3, ROUND_PAUSE_MS = 2600, REFRESH_MS = 2000;
  function create(options) {
    const opts = options || {}, net = opts.net, kit = root.SpaceManTabletop;
    const game = kit.get(opts.game || 'lanterns');
    let host = false, active = false, busy = false, serial = 0, off = null, refresh = null, roundTimer = null;
    let match = null, seats = [0, 0], ready = 0, error = '', closedReason = '', connection = '', lastSnap = 0;
    const now = () => root.performance.now(), info = () => net.info();
    const roster = () => net.roster();
    const myP = () => info().myP;
    const mySeat = () => (seats[0] && seats[0] === myP() ? 1 : seats[1] && seats[1] === myP() ? 2 : 0);
    const status = () => ({ active, busy, error, closedReason, connection, host, info: info(), roster: roster(), match, seats: seats.slice(), ready, mySeat: mySeat(),
      joinText: busy && net.joinStatus && net.joinStatus() ? net.joinStatus().text : '' });
    const changed = () => { if (opts.onChange) opts.onChange(status()); };
    const rev = m => [m.revision & 0xff, (m.revision >>> 8) & 0xff];

    function snapshotBytes() {
      const body = kit.encodeMatch(game, match), out = new Uint8Array(4 + body.length);
      out[0] = SNAP; out[1] = seats[0]; out[2] = seats[1]; out[3] = ready; out.set(body, 4);
      return out;
    }
    function publish() { if (host && active && match) { lastSnap = now(); net.sendTable(snapshotBytes()).catch(() => {}); } changed(); }
    // Seat 1 is the host. Seat 2 stays with its pilot while they are here, else goes to the longest-standing player.
    function seat() {
      // Pilots who found both seats taken wait as watchers; seat them as soon as a chair is free.
      if (net.seatWaiting) net.seatWaiting(2);
      const players = roster().filter(r => r.p !== 1 && r.role === 0 && !r.absent).map(r => r.p).sort((a, b) => a - b);
      const before = seats[1];
      seats = [1, players.includes(seats[1]) ? seats[1] : players[0] || 0];
      if (seats[1] !== before) ready = 0;
      if (seats[1] && !match) match = kit.startMatch(game, { seed: (opts.seed ? opts.seed() : Date.now()) >>> 0, target: 2 });
    }
    function hostApply(next) { if (!next) return false; match = next; ready = 0; schedule(); publish(); return true; }
    // Rounds roll on by themselves; a finished match waits for both pilots to ask for a rematch.
    function schedule() {
      if (roundTimer) { root.clearTimeout(roundTimer); roundTimer = null; }
      if (host && match && match.phase === 'round') { const at = match.revision; roundTimer = root.setTimeout(() => { roundTimer = null; if (match && match.revision === at && match.phase === 'round') hostApply(kit.next(game, match)); }, ROUND_PAUSE_MS); }
    }
    function hostReceive(p, bytes) {
      if (!match || !(bytes instanceof Uint8Array) || bytes.length < 3) return;
      const seatOf = seats[1] === p ? 2 : 0, revision = bytes[1] | (bytes[2] << 8);
      if (!seatOf || revision !== (match.revision & 0xffff)) return;
      if (bytes[0] === MOVE && bytes.length === 4) hostApply(kit.play(game, match, seatOf, bytes[3]));
      else if (bytes[0] === READY && bytes.length === 3) markReady(seatOf);
    }
    function markReady(seatNo) {
      if (!match || match.phase !== 'over') return false;
      ready |= 1 << (seatNo - 1);
      if (ready === 3) return hostApply(kit.next(game, match));
      publish(); return true;
    }
    function guestReceive(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes[0] !== SNAP) return;
      const decoded = kit.decodeMatch(bytes.subarray(4));
      if (!decoded || decoded.game !== game.id) return;
      // Revisions only move forward within one match; a rematch or a fresh host starts again at a low number.
      if (match && decoded.revision < match.revision && decoded.revision > 2) return;
      match = decoded; seats = [bytes[1], bytes[2]]; ready = bytes[3] & 3; connection = ''; changed();
    }
    function cleanup(leave = true) {
      serial++; active = false; busy = false; host = false; match = null; seats = [0, 0]; ready = 0; connection = '';
      if (roundTimer) { root.clearTimeout(roundTimer); roundTimer = null; }
      if (refresh) { root.clearInterval(refresh); refresh = null; }
      if (off) { off(); off = null; }
      if (leave) net.leave();
    }
    function subscribe() {
      off = net.onEvent((event, data) => {
        if (!active && !busy) return;
        if (event === 'table-data') { if (host) hostReceive(data.p, data.bytes); else guestReceive(data.bytes); return; }
        if (['join', 'rejoin', 'roster', 'role', 'waiting', 'leave', 'kick', 'banned', 'welcomed', 'ok'].includes(event)) { if (host) { seat(); publish(); } else changed(); return; }
        if (event === 'reconnecting' || event === 'hostaway') { connection = host ? 'Connection lost · waiting for your rival' : 'Reconnecting to the host…'; changed(); return; }
        if (event === 'reconnected' || event === 'hostback') { connection = ''; if (host) publish(); else changed(); return; }
        if (event === 'bye') {
          const message = data && data.reason === 4 ? 'Both seats at this table are taken. Join as a watcher instead.' : data && data.reason === 3 ? 'This invite is for a different game. Open it from the home screen.' : data && data.reason === 1 ? 'The host closed the table.' : 'The host ended your connection.';
          if (busy) error = message; else closedReason = message;
          cleanup(); changed();
        }
      });
      refresh = root.setInterval(() => { if (host && active && match && now() - lastSnap > REFRESH_MS) publish(); }, 500);
    }
    async function hosting() {
      if (active || busy || net.active) return false;
      const mine = ++serial; busy = true; error = ''; closedReason = ''; subscribe(); changed();
      try {
        await net.openRoom(Object.assign({}, typeof opts.hostOptions === 'function' ? opts.hostOptions() : {}, typeof opts.identity === 'function' ? opts.identity() : {},
          { mode: 'table', playerCap: 2, spectatorCap: 4, code: !(opts.build && opts.build.preview), baseUrl: typeof opts.baseUrl === 'function' ? opts.baseUrl() : opts.baseUrl }));
        if (mine !== serial) return false;
        host = true; active = true; busy = false; match = null; seat(); publish(); return true;
      } catch (e) { if (mine === serial) { error = e && e.message || 'Could not reach the room relay.'; cleanup(); changed(); } return false; }
    }
    async function join(target, role = 0, trustedPayload = false) {
      if (active || busy || net.active) return false;
      const mine = ++serial; busy = true; error = ''; closedReason = ''; subscribe(); changed();
      try {
        let payload = target;
        if (!trustedPayload) {
          const resolved = opts.build ? opts.build.resolveJoin(target) : { value: target };
          if (resolved.error) throw new Error(resolved.error);
          const parsed = net.parseJoin(resolved.value);
          if (parsed.kind === 'invite') payload = parsed.payload;
          else if (parsed.kind === 'code') payload = (await net.lookupCode(resolved.value)).invite;
          else throw new Error('Paste your friend’s invite link or room code.');
        }
        if (mine !== serial) return false;
        const peek = net.peekInvite(payload);
        if (peek.err) throw new Error(peek.err === 'expired' ? 'This invite has expired.' : 'This invite is not compatible. Refresh both games.');
        if (peek.mode !== 'table') throw new Error('That room is for another game. Join it from the home screen.');
        await net.acceptJoin(payload, Object.assign({}, typeof opts.identity === 'function' ? opts.identity() : {}, { mode: 'table', role: role === 1 ? 1 : 0 }));
        if (mine !== serial) return false;
        active = true; busy = false; changed(); return true;
      } catch (e) { if (mine === serial) { error = e && e.message || 'Could not join this table.'; cleanup(); changed(); } return false; }
    }
    /** Light a lantern (or make any move) for the local pilot. Returns false when it is not their turn. */
    function play(move) {
      if (!active || !match || connection) return false;
      const s = mySeat();
      if (!s || match.phase !== 'playing' || game.turn(match.state) !== s || !game.moves(match.state).includes(move)) return false;
      if (host) return hostApply(kit.play(game, match, s, move));
      net.sendTable(Uint8Array.from([MOVE, ...rev(match), move])).catch(() => {});
      return true;
    }
    /** Ask for a rematch after the match ends; the host starts it once both pilots are ready. */
    function rematch() {
      if (!active || !match || match.phase !== 'over') return false;
      const s = mySeat(); if (!s) return false;
      if (host) return markReady(s);
      ready |= 1 << (s - 1); changed();
      net.sendTable(Uint8Array.from([READY, ...rev(match)])).catch(() => {});
      return true;
    }
    function close() { cleanup(); error = ''; closedReason = ''; changed(); }
    return Object.freeze({ hosting, join, play, rematch, close, status, game,
      get active() { return active; }, get busy() { return busy; }, get isHost() { return host; }, get match() { return match; } });
  }
  root.SpaceManTableRoom = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
