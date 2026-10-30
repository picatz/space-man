// Tabletop kit and Constellations rules: pure, deterministic, validated bytes.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/tabletop.js');
const M = require('../src/modes.js');
const g = T.LANTERNS;
const playAll = (moves, starter = 1) => moves.reduce((s, m) => g.apply(s, m), g.init(1, starter));

test('grid lists every straight line once', () => {
  assert.equal(T.grid(3).lines(3).length, 8);
  assert.equal(T.grid(4).lines(3).length, 24);
  assert.equal(T.grid(4).lines(4).length, 10);
});

test('a fourth lantern lets the oldest one go dark, and the fading lantern is known in advance', () => {
  let s = playAll([0, 3, 1, 4]);
  assert.equal(g.fading(s, 1), -1, 'two lit, nothing fades yet');
  s = playAll([0, 4, 8, 1, 7, 6]);
  assert.equal(g.outcome(s), null);
  assert.equal(g.fading(s, 1), 0, 'seat 1 has three lit; the first goes next');
  s = g.apply(s, 2);
  assert.deepEqual(g.cells(s), [0, 2, 1, 0, 2, 0, 2, 1, 1]);
  assert.deepEqual([...s.queues[0]], [8, 7, 2]);
});

test('only lit lanterns count: a line through a gone-dark lantern does not win', () => {
  // Seat 1 lights 0, 1, 8 then 2: star 0 fades at the same moment, so 0-1-2 is not a line.
  const s = playAll([0, 3, 1, 4, 8, 7, 2]);
  assert.equal(g.outcome(s), null);
  const win = playAll([0, 3, 1, 4, 2]);
  assert.deepEqual(g.outcome(win), { seat: 1, line: [0, 1, 2] });
  assert.deepEqual(g.moves(win), []);
});

test('a long stalemate ends the round as a draw', () => {
  const s = Object.freeze({ queues: [[0, 1, 5], [2, 3, 4]], turn: 1, ply: g.maxPly });
  assert.deepEqual(g.outcome(s), { seat: 0, line: [] });
});

test('match reducer: rounds, loser starts, best of three, rematch resets', () => {
  let m = T.startMatch(g, { seed: 9 });
  assert.equal(T.play(g, m, 2, 0), null, 'not seat 2’s turn');
  assert.equal(T.play(g, m, 1, 9), null, 'off the board');
  for (const [seat, cell] of [[1, 0], [2, 3], [1, 1], [2, 4], [1, 2]]) m = T.play(g, m, seat, cell);
  assert.equal(m.phase, 'round'); assert.deepEqual([...m.scores], [1, 0]);
  assert.equal(T.play(g, m, 2, 5), null, 'no moves between rounds');
  m = T.next(g, m);
  assert.equal(m.round, 2); assert.equal(g.turn(m.state), 2, 'the loser lights first');
  for (const [seat, cell] of [[2, 0], [1, 3], [2, 1], [1, 4], [2, 6], [1, 5]]) m = T.play(g, m, seat, cell);
  assert.equal(m.phase, 'over'); assert.deepEqual([...m.scores], [2, 0]);
  m = T.next(g, m);
  assert.equal(m.phase, 'playing'); assert.equal(m.round, 1); assert.deepEqual([...m.scores], [0, 0]);
});

test('match bytes round-trip and reject anything the rules could not reach', () => {
  let m = T.startMatch(g, { seed: 3 });
  for (const [seat, cell] of [[1, 4], [2, 0], [1, 2]]) m = T.play(g, m, seat, cell);
  const bytes = T.encodeMatch(g, m), back = T.decodeMatch(bytes);
  assert.equal(back.revision, m.revision); assert.deepEqual(g.cells(back.state), g.cells(m.state)); assert.equal(back.last, 2);
  const bad = (edit) => { const b = bytes.slice(); edit(b); return T.decodeMatch(b); };
  assert.equal(bad(b => { b[0] = 9; }), null, 'version');
  assert.equal(bad(b => { b[1] = 200; }), null, 'unknown game');
  assert.equal(bad(b => { b[b.length - 1] = 4; }), null, 'two lanterns on one star');
  assert.equal(bad(b => { b[b.length - 1] = 12; }), null, 'off the board');
  assert.equal(bad(b => { b[11] = 2; }), null, 'a result while still playing');
  assert.equal(T.decodeMatch(bytes.subarray(0, bytes.length - 1)), null, 'truncated');
  assert.equal(T.decodeMatch(new Uint8Array(0)), null);
});

test('CPU takes a win, blocks a loss and every level finishes quickly', () => {
  const win = playAll([0, 3, 1, 4]);
  for (const level of Object.values(T.LEVELS)) assert.equal(T.bestMove(g, win, { ...level, seed: 5 }), 2);
  const block = playAll([0, 4, 1]);
  assert.equal(T.bestMove(g, block, { ...T.LEVELS.normal, seed: 1 }), 2);
  assert.equal(T.bestMove(g, block, { ...T.LEVELS.hard, seed: 1 }), 2);
  const t0 = Date.now(); T.bestMove(g, g.init(1), T.LEVELS.hard);
  assert.ok(Date.now() - t0 < 1500, 'hard opening move under 1.5 s');
});

test('hard beats easy far more often than not, and the game is deterministic', () => {
  let hard = 0;
  for (let n = 0; n < 10; n++) {
    let m = T.startMatch(g, { seed: n + 1, target: 1, starter: n % 2 ? 2 : 1 });
    while (m.phase === 'playing') { const seat = g.turn(m.state); m = T.play(g, m, seat, T.bestMove(g, m.state, { ...T.LEVELS[seat === 1 ? 'hard' : 'easy'], seed: n * 31 + m.revision })); }
    if (m.result.seat === 1) hard++;
  }
  assert.ok(hard >= 8, 'hard won ' + hard + ' of 10');
});

test('mode registry: unique ids and buttons, a region for each, and Constellations on the table wire', () => {
  const ids = M.list().map(m => m.id), buttons = M.list().flatMap(m => [m.home, m.host]);
  assert.equal(new Set(ids).size, ids.length); assert.equal(new Set(buttons).size, buttons.length);
  const regions = ['orbital', 'bloom', 'ember', 'prism', 'aurora', 'neon', 'nebula'];
  for (const m of M.list()) assert.ok(regions.includes(m.region), m.id + ' region');
  assert.equal(M.forWire('table', 'lanterns').id, 'lanterns');
  assert.equal(M.get('lanterns').game, g.id);
});

test('every registered mode has its home card and Play Together pick in the page', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  for (const m of M.list()) {
    assert.match(html, new RegExp('id="' + m.home + '"[^>]*>.*' + m.name), m.id + ' home card');
    assert.match(html, new RegExp('id="' + m.host + '"'), m.id + ' Play Together pick');
  }
});
