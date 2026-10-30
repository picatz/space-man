/* Space Man · tabletop kit
   Shared building blocks for turn-based games: a grid with its winning lines,
   a game registry, a negamax CPU, and a best-of-N match reducer whose bytes a
   Play Together host broadcasts as-is (src/table-room.js). Everything here is
   pure and deterministic: no DOM, timers, storage or Math.random, so a host,
   its guests and the tests always agree on the board.

   A game is a plain object (see lanternLines below for the reference one):
     id, wire (1..255), name, seats (2)
     init(seed)            -> state
     turn(state)           -> seat to move (1 or 2)
     moves(state)          -> legal moves (small non-negative integers)
     apply(state, move)    -> next state (never mutates its input)
     outcome(state)        -> null while playing, else { seat, line } (seat 0 = draw)
     evaluate(state, seat) -> heuristic for the CPU, positive when seat is ahead
     encode(state)         -> Uint8Array; decode(bytes) -> state or null
   Rules live in the game. Presentation lives in the mode's UI. */
(function (root) {
  'use strict';
  const games = new Map(), wires = new Map();

  // Mulberry32: tiny, seedable and identical on every engine.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A cols x rows board. lines(n) lists every straight run of n cells (rows, columns, diagonals). */
  function grid(cols, rows = cols) {
    const index = (c, r) => (c >= 0 && r >= 0 && c < cols && r < rows ? r * cols + c : -1);
    const coord = i => ({ c: i % cols, r: Math.floor(i / cols) });
    const cache = new Map();
    function lines(n) {
      if (cache.has(n)) return cache.get(n);
      const out = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
        for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
          const run = [];
          for (let k = 0; k < n; k++) run.push(index(c + dc * k, r + dr * k));
          if (run.every(i => i >= 0)) out.push(Object.freeze(run));
        }
      cache.set(n, Object.freeze(out));
      return cache.get(n);
    }
    return Object.freeze({ cols, rows, size: cols * rows, index, coord, lines });
  }

  function define(game) {
    if (!game || typeof game.id !== 'string' || !(game.wire >= 1 && game.wire <= 255)) throw new Error('tabletop game needs an id and a wire byte');
    if (games.has(game.id) || wires.has(game.wire)) throw new Error('tabletop game already defined: ' + game.id);
    const frozen = Object.freeze(Object.assign({ seats: 2 }, game));
    games.set(frozen.id, frozen); wires.set(frozen.wire, frozen);
    return frozen;
  }

  /* ---- CPU: negamax with alpha-beta. Win scores prefer the fastest win and
     the slowest loss, so a CPU never dawdles past a winning move. ---- */
  const WIN = 100000;
  function negamax(game, state, depth, alpha, beta, ply) {
    const end = game.outcome(state);
    if (end) return end.seat === 0 ? 0 : (end.seat === game.turn(state) ? WIN - ply : -(WIN - ply));
    if (depth <= 0) return game.evaluate(state, game.turn(state));
    let best = -Infinity;
    for (const move of game.moves(state)) {
      const score = -negamax(game, game.apply(state, move), depth - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best === -Infinity ? 0 : best;
  }
  /**
   * The CPU's move. depth is plies searched; slip (0..1) is the chance of
   * picking any non-losing move instead of a best one, which is how gentle
   * levels make human-looking mistakes without ever handing over a free win.
   */
  function bestMove(game, state, { depth = 3, slip = 0, seed = 1 } = {}) {
    const moves = game.moves(state);
    if (!moves.length) return -1;
    const random = rng(seed), scored = moves.map(move => ({ move, score: -negamax(game, game.apply(state, move), depth - 1, -Infinity, Infinity, 1) }));
    const top = Math.max(...scored.map(s => s.score));
    const wins = scored.filter(s => s.score > WIN / 2);
    if (wins.length) return wins[0].move;
    const pool = random() < slip ? scored.filter(s => s.score > -WIN / 2) : scored.filter(s => s.score === top);
    const pick = pool.length ? pool : scored;
    return pick[Math.floor(random() * pick.length)].move;
  }

  /* ---- Match reducer: rounds, scores and who starts. A match is plain data;
     every function returns a new match or null for an illegal request. ---- */
  const PHASES = ['playing', 'round', 'over'];
  /** A new match. target is rounds needed to win; the loser of a round starts the next one. */
  function startMatch(game, { seed = 1, target = 2, starter = 1 } = {}) {
    return Object.freeze({ game: game.id, revision: 1, phase: 'playing', round: 1, target: Math.max(1, Math.min(9, target | 0)), scores: Object.freeze([0, 0]),
      starter: starter === 2 ? 2 : 1, seed: seed >>> 0, state: game.init(seed >>> 0, starter === 2 ? 2 : 1), last: -1, result: null });
  }
  function play(game, match, seat, move) {
    if (!match || match.phase !== 'playing' || game.turn(match.state) !== seat || !game.moves(match.state).includes(move)) return null;
    const state = game.apply(match.state, move), result = game.outcome(state);
    let scores = match.scores, phase = 'playing';
    if (result) {
      scores = Object.freeze(match.scores.map((s, i) => s + (result.seat === i + 1 ? 1 : 0)));
      phase = scores.some(s => s >= match.target) ? 'over' : 'round';
    }
    return Object.freeze(Object.assign({}, match, { revision: match.revision + 1, phase, scores, state, last: move, result: result ? Object.freeze({ seat: result.seat, line: Object.freeze((result.line || []).slice()) }) : null }));
  }
  /** After a round: the next round. After a match: a rematch with fresh scores. */
  function next(game, match) {
    if (!match || match.phase === 'playing') return null;
    const loser = match.result && match.result.seat ? 3 - match.result.seat : 3 - match.starter;
    const seed = (Math.imul(match.seed ^ 0x9e3779b9, 0x85ebca6b) + match.round) >>> 0;
    const over = match.phase === 'over';
    return Object.freeze(Object.assign({}, match, { revision: match.revision + 1, phase: 'playing', round: over ? 1 : match.round + 1, scores: over ? Object.freeze([0, 0]) : match.scores,
      starter: loser, seed, state: game.init(seed, loser), last: -1, result: null }));
  }

  /* ---- Match bytes: version, game wire id, revision u16, phase, round,
     target, scores, starter, last move, result seat and line, then the game's
     own state bytes. Decoding validates every field and returns null on any
     doubt, so a peer can never hand us a board the rules could not reach. ---- */
  const MATCH_VERSION = 1;
  function encodeMatch(game, match) {
    const state = game.encode(match.state), line = match.result ? match.result.line : [];
    const out = new Uint8Array(13 + line.length + 1 + state.length);
    let o = 0;
    out[o++] = MATCH_VERSION; out[o++] = game.wire; out[o++] = match.revision & 0xff; out[o++] = (match.revision >>> 8) & 0xff;
    out[o++] = PHASES.indexOf(match.phase); out[o++] = match.round; out[o++] = match.target; out[o++] = match.scores[0]; out[o++] = match.scores[1];
    out[o++] = match.starter; out[o++] = match.last + 1; out[o++] = match.result ? match.result.seat + 1 : 0; out[o++] = line.length;
    for (const i of line) out[o++] = i;
    out[o++] = state.length; out.set(state, o);
    return out;
  }
  function decodeMatch(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : null;
    if (!b || b.length < 14 || b[0] !== MATCH_VERSION) return null;
    const game = wires.get(b[1]);
    if (!game) return null;
    const phase = PHASES[b[4]], lineLen = b[12];
    if (!phase || b[7] > 9 || b[8] > 9 || (b[9] !== 1 && b[9] !== 2) || b[11] > 3 || lineLen > 16 || b.length < 14 + lineLen) return null;
    const line = Array.from(b.subarray(13, 13 + lineLen)), stateLen = b[13 + lineLen];
    if (b.length !== 14 + lineLen + stateLen) return null;
    const state = game.decode(b.subarray(14 + lineLen));
    if (!state) return null;
    const result = b[11] ? Object.freeze({ seat: b[11] - 1, line: Object.freeze(line) }) : null;
    if ((phase === 'playing') === !!result) return null;
    return Object.freeze({ game: game.id, revision: b[2] | (b[3] << 8), phase, round: b[5], target: Math.max(1, b[6]), scores: Object.freeze([b[7], b[8]]),
      starter: b[9], seed: 0, state, last: b[10] - 1, result });
  }

  /* ---- Constellations: the reference game. Each pilot keeps at most three
     stars lit on a 3x3 star chart; lighting a fourth lets your oldest one
     fade. Three of yours in a line makes a constellation and wins the round.
     No board ever fills, so there are no dead draws, only a stalemate after
     MAX_PLY. Ids keep their first name ('lanterns', LANTERNS) for saved
     records and tests; players only ever see the name. ---- */
  function lanternLines({ id = 'lanterns', wire = 1, name = 'Constellations', cols = 3, lit = 3, run = 3, maxPly = 48 } = {}) {
    const board = grid(cols), lines = board.lines(run), center = board.size % 2 ? (board.size - 1) / 2 : -1;
    const make = (queues, turn, ply) => Object.freeze({ queues: Object.freeze(queues.map(q => Object.freeze(q.slice()))), turn, ply });
    function cells(state) {
      const out = new Array(board.size).fill(0);
      state.queues.forEach((q, s) => { for (const i of q) out[i] = s + 1; });
      return out;
    }
    // The star that fades when this seat next lights one, or -1.
    const fading = (state, seat) => { const q = state.queues[seat - 1]; return q.length >= lit ? q[0] : -1; };
    function outcome(state) {
      const c = cells(state);
      for (const line of lines) { const s = c[line[0]]; if (s && line.every(i => c[i] === s)) return { seat: s, line }; }
      return state.ply >= maxPly ? { seat: 0, line: [] } : null;
    }
    function evaluate(state, seat) {
      // Count lines each side could finish with the stars that will still be lit.
      let score = 0;
      const c = cells(state);
      for (const s of [1, 2]) { const f = fading(state, s); if (f >= 0 && s !== state.turn) c[f] = -s; }
      for (const line of lines) {
        let mine = 0, theirs = 0;
        for (const i of line) { if (c[i] === seat) mine++; else if (c[i] === 3 - seat) theirs++; }
        if (!theirs) score += mine === 2 ? 12 : mine;
        if (!mine) score -= theirs === 2 ? 14 : theirs;
      }
      if (center >= 0) score += c[center] === seat ? 3 : c[center] === 3 - seat ? -3 : 0;
      return score;
    }
    return {
      id, wire, name, board, lit, maxPly,
      init: (seed, starter = 1) => make([[], []], starter === 2 ? 2 : 1, 0),
      turn: state => state.turn,
      cells, fading,
      moves(state) { if (outcome(state)) return []; const c = cells(state), out = []; for (let i = 0; i < board.size; i++) if (!c[i]) out.push(i); return out; },
      apply(state, move) {
        const queues = state.queues.map(q => q.slice()), q = queues[state.turn - 1];
        q.push(move);
        if (q.length > lit) q.shift();
        // The turn passes even on a winning move, so the side to move is always the one who just lost.
        return make(queues, 3 - state.turn, state.ply + 1);
      },
      outcome, evaluate,
      encode: state => Uint8Array.from([state.turn, state.ply, state.queues[0].length, ...state.queues[0], state.queues[1].length, ...state.queues[1]]),
      decode(bytes) {
        if (bytes.length < 4 || (bytes[0] !== 1 && bytes[0] !== 2) || bytes[1] > maxPly) return null;
        const queues = [];
        let o = 2;
        for (let s = 0; s < 2; s++) {
          const n = bytes[o++];
          if (n > lit || o + n > bytes.length) return null;
          queues.push(Array.from(bytes.subarray(o, o + n))); o += n;
        }
        const all = queues[0].concat(queues[1]);
        if (o !== bytes.length || all.some(i => i >= board.size) || new Set(all).size !== all.length) return null;
        return make(queues, bytes[0], bytes[1]);
      },
    };
  }

  const LANTERNS = define(lanternLines());
  // CPU levels by name. Easy slips often, Normal sees a short plan, Hard plays it out.
  const LEVELS = Object.freeze({ easy: Object.freeze({ depth: 2, slip: 0.45 }), normal: Object.freeze({ depth: 4, slip: 0.12 }), hard: Object.freeze({ depth: 8, slip: 0 }) });

  const api = Object.freeze({
    rng, grid, define, bestMove, LEVELS,
    get: id => games.get(id) || null,
    byWire: wire => wires.get(wire) || null,
    startMatch, play, next, encodeMatch, decodeMatch,
    lanternLines, LANTERNS,
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpaceManTabletop = api;
})(typeof window !== 'undefined' ? window : globalThis);
