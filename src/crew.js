/* Space Man crew standings — a pure projection of a room onto the four things a player asks
   about it: who is RUNNING right now, who is OUT of this round, who is WAITING for the next
   one, and who is WATCHING. No DOM, no clock, no network: the game hands in what it already
   knows (roster, presence samples, session board, this round's results) and gets back rows
   ready to draw, so the rules are testable and the panel, the death card and the room card
   can never disagree. Classic script; also loadable from Node (tests).

   Inputs (all optional, all plain data):
     roster    [{ p, callsign, host, you, spectator }]          who is in the room
     presence  [{ p, runId, state, dist, score, chain }]        latest sample per peer; state bits:
                                                                 1 facing, 2 grounded, 4 dead, 8 in run
     board     [{ p, bestScore, bestDist, bestChain }]          session bests, monotonic
     results   [{ p, dist, score, dead }]                       this round's last-seen figures
     self      { p, inRun, dead, dist, score, chain }           the local player, from local truth
     runId     the round being played; presence from another round counts as "not in it"
     roundActive  true once the host has started a round that has not ended
     wins      { [p]: rounds won this session } — kept by the caller, see winnerOf() */
(function () {
  'use strict';
  const GROUPS = [
    { key: 'running', label: 'RUNNING' },
    { key: 'out', label: 'OUT THIS ROUND' },
    { key: 'waiting', label: 'WAITING' },
    { key: 'watching', label: 'WATCHING' },
  ];
  const DEAD = 4, IN_RUN = 8;

  // Furthest first, then score, then seat number — the same order the death card has always used.
  function byProgress(a, b) { return (b.dist - a.dist) || (b.score - a.score) || (a.p - b.p); }

  function build(input) {
    const o = input || {};
    const roster = o.roster || [], presence = o.presence || [], board = o.board || [], results = o.results || [];
    const wins = o.wins || {}, self = o.self || null, runId = o.runId | 0, roundActive = !!o.roundActive;
    const pres = new Map(presence.map((s) => [s.p, s]));
    const best = new Map(board.map((b) => [b.p, b]));
    const res = new Map(results.map((r) => [r.p, r]));
    const rows = [];
    for (const m of roster) {
      const isSelf = !!(m.you || (self && self.p === m.p));
      const b = best.get(m.p) || {};
      const row = {
        p: m.p, name: m.callsign || ('PLAYER ' + m.p), you: isSelf, host: !!m.host, status: 'waiting',
        dist: 0, score: 0, chain: 0, place: 0,
        bestScore: b.bestScore | 0, bestDist: b.bestDist | 0, bestChain: b.bestChain | 0, unverified: !!m.unverified, wins: wins[m.p] | 0,
      };
      if (m.spectator) { row.status = 'watching'; rows.push(row); continue; }
      let inRound = false, dead = false, fig = null;
      if (isSelf && self) {
        if (self.inRun || self.dead) { inRound = true; dead = !!self.dead; fig = self; }
      } else {
        const s = pres.get(m.p);
        if (s && (s.runId | 0) === runId && (s.state & (IN_RUN | DEAD))) { inRound = true; dead = !!(s.state & DEAD); fig = s; }
        else if (res.has(m.p)) { const r = res.get(m.p); inRound = true; dead = !!r.dead; fig = r; }   // their last word outlives their ghost
      }
      if (inRound && fig) {
        row.status = dead ? 'out' : 'running';
        row.dist = Math.max(0, +fig.dist || 0); row.score = Math.max(0, +fig.score || 0); row.chain = Math.max(0, fig.chain | 0);
      }
      rows.push(row);
    }
    // Placement is earned by everyone who has run this round, alive or not; a live runner's place can still change.
    const ran = rows.filter((r) => r.status === 'running' || r.status === 'out').sort(byProgress);
    ran.forEach((r, i) => { r.place = i + 1; });
    const groups = GROUPS.map((g) => ({ key: g.key, label: g.label, rows: [] }));
    const at = Object.fromEntries(groups.map((g) => [g.key, g]));
    for (const r of rows) at[r.status].rows.push(r);
    at.running.rows.sort(byProgress); at.out.rows.sort(byProgress);
    at.waiting.rows.sort((a, b) => a.p - b.p); at.watching.rows.sort((a, b) => a.p - b.p);
    const counts = { running: at.running.rows.length, out: at.out.rows.length, waiting: at.waiting.rows.length, watching: at.watching.rows.length };
    const players = counts.running + counts.out + counts.waiting;
    const phase = !roundActive ? 'lobby' : (counts.running ? 'running' : 'over');
    // A round is only won against someone: a lone runner's round is practice, not a win.
    const winner = phase === 'over' && ran.length >= 2 ? ran[0] : null;
    return { phase, counts, players, total: rows.length, groups, leader: ran[0] || null, winner, rows };
  }

  // "2 running · 1 out · 1 waiting · 3 watching", zero groups left out; the lobby says who is here instead.
  function summary(standings) {
    const c = standings.counts, parts = [];
    if (c.running) parts.push(c.running + ' running');
    if (c.out) parts.push(c.out + ' out');
    if (c.waiting) parts.push(c.waiting + (standings.phase === 'lobby' ? ' ready' : ' waiting'));
    if (c.watching) parts.push(c.watching + ' watching');
    return parts.join(' · ') || 'empty room';
  }

  // The one place a round is scored. Returns the record to keep, or null when the round has no winner yet.
  function winnerOf(standings) {
    const w = standings && standings.winner;
    return w ? { p: w.p, name: w.name, dist: Math.floor(w.dist), score: Math.floor(w.score), ran: standings.rows.filter((r) => r.place).length } : null;
  }

  const api = { build, summary, winnerOf, GROUPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.SpaceManCrew = api;
})();
