const test = require('node:test');
const assert = require('node:assert/strict');
const Crew = require('../src/crew.js');

const R = (p, extra = {}) => ({ p, callsign: 'PLAYER ' + p, ...extra });
const S = (p, state, dist, score, extra = {}) => ({ p, runId: 7, state, dist, score, chain: 0, ...extra });
const RUN = 8, DEAD = 12;   // in-run; in-run + dead bit

test('everyone lands in exactly one group, and the counts add up', () => {
  const st = Crew.build({
    roster: [R(1, { host: true, you: true }), R(2), R(3), R(4), R(5, { spectator: true })],
    presence: [S(2, RUN, 400, 90), S(3, DEAD, 650, 300), S(4, 0, 0, 0)], runId: 7, roundActive: true,
    self: { p: 1, inRun: true, dist: 500, score: 120, chain: 2 },
  });
  assert.deepEqual(st.counts, { running: 2, out: 1, waiting: 1, watching: 1 });
  assert.equal(st.players, 4);
  assert.equal(st.total, 5);
  assert.equal(st.phase, 'running');
  assert.deepEqual(st.groups.map((g) => g.key), ['running', 'out', 'waiting', 'watching']);
  const seen = st.groups.flatMap((g) => g.rows.map((r) => r.p)).sort();
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
});

test('placement counts the dead as well as the living, furthest first', () => {
  const st = Crew.build({
    roster: [R(1, { you: true }), R(2), R(3)], runId: 7, roundActive: true,
    presence: [S(2, RUN, 400, 90), S(3, DEAD, 650, 300)],
    self: { p: 1, inRun: true, dist: 500, score: 10 },
  });
  const place = Object.fromEntries(st.rows.map((r) => [r.p, r.place]));
  assert.deepEqual(place, { 1: 2, 2: 3, 3: 1 });
  assert.equal(st.leader.p, 3);
  assert.deepEqual(st.groups[0].rows.map((r) => r.p), [1, 2], 'running rows are ordered by progress');
});

test('the local player is read from local truth, never from a stale sample', () => {
  const st = Crew.build({
    roster: [R(1, { you: true })], runId: 7, roundActive: true,
    presence: [S(1, RUN, 1, 1)], self: { p: 1, inRun: false, dead: true, dist: 900, score: 444, chain: 3 },
  });
  const me = st.rows[0];
  assert.equal(me.status, 'out');
  assert.equal(me.dist, 900); assert.equal(me.score, 444); assert.equal(me.chain, 3);
  assert.equal(me.you, true);
});

test("a peer's last word outlives their ghost, but a sample from another round does not count", () => {
  const st = Crew.build({
    roster: [R(1, { you: true }), R(2), R(3)], runId: 7, roundActive: true,
    presence: [S(3, RUN, 999, 999, { runId: 6 })],
    results: [{ p: 2, dist: 321, score: 55, dead: true }],
    self: { p: 1, inRun: false },
  });
  const by = Object.fromEntries(st.rows.map((r) => [r.p, r]));
  assert.equal(by[2].status, 'out'); assert.equal(by[2].dist, 321);
  assert.equal(by[3].status, 'waiting', 'yesterday’s run is not this round');
  assert.equal(by[3].dist, 0);
  assert.equal(by[1].status, 'waiting');
});

test('phases: lobby before a round, running while anyone runs, over once nobody does', () => {
  const base = { roster: [R(1, { you: true }), R(2)], runId: 7, self: { p: 1, inRun: false } };
  assert.equal(Crew.build({ ...base, roundActive: false }).phase, 'lobby');
  assert.equal(Crew.build({ ...base, roundActive: true, presence: [S(2, RUN, 1, 1)] }).phase, 'running');
  assert.equal(Crew.build({ ...base, roundActive: true, presence: [S(2, DEAD, 1, 1)] }).phase, 'over');
});

test('session bests ride along, and hostile or missing numbers never poison a row', () => {
  const st = Crew.build({
    roster: [R(2, { callsign: '' })], runId: 7, roundActive: true,
    presence: [S(2, RUN, NaN, -5, { chain: -2 })], board: [{ p: 2, bestScore: 1500, bestDist: 1480, bestChain: 4 }],
  });
  const r = st.rows[0];
  assert.equal(r.name, 'PLAYER 2');
  assert.equal(r.dist, 0); assert.equal(r.score, 0); assert.equal(r.chain, 0);
  assert.equal(r.bestScore, 1500); assert.equal(r.bestChain, 4);
});

test('summary reads naturally, omits empty groups, and says ready in the lobby', () => {
  const mk = (o) => Crew.summary(Crew.build(o));
  assert.equal(mk({}), 'empty room');
  assert.equal(mk({ roster: [R(1, { you: true }), R(2), R(3, { spectator: true })], roundActive: false, self: { p: 1 } }), '2 ready · 1 watching');
  assert.equal(mk({ roster: [R(1, { you: true }), R(2), R(3)], runId: 7, roundActive: true, presence: [S(3, DEAD, 5, 5)], self: { p: 1, inRun: true, dist: 9 } }),
    '1 running · 1 out · 1 waiting');
});
