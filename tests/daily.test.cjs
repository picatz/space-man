'use strict';
// Today in the Reach (src/daily.js): every player computes the same dailies,
// every daily chart is a real puzzle, and the record and streak are forgiving
// but cannot be gamed. The page wiring runs through the real index.html script.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/daily.js');
const kit = require('../src/tabletop.js');
const { client, relay } = require('./harness.cjs');

const DAY = Date.UTC(2026, 9, 31, 12);
const days = n => Array.from({ length: n }, (_, i) => D.dayKey(DAY + i * 86400000));
const ARENAS = ['orbital-dock', 'bloom-reactor', 'ember-foundry'];
const TRACKS = ['starlight', 'ember', 'bloom', 'prism', 'aurora', 'neon', 'nebula', 'forge'];

test('daily picks are the same for everyone and never repeat yesterday', () => {
  assert.deepEqual(D.arena('2026-10-31', ARENAS), D.arena('2026-10-31', ARENAS));
  assert.deepEqual(D.race('2026-10-31', TRACKS), D.race('2026-10-31', TRACKS));
  const list = days(120), arenas = list.map(d => D.arena(d, ARENAS)), races = list.map(d => D.race(d, TRACKS));
  for (let i = 1; i < list.length; i++) {
    assert.notEqual(arenas[i].arenaId, arenas[i - 1].arenaId, 'arena stage repeats on ' + list[i]);
    assert.notEqual(races[i].trackId, races[i - 1].trackId, 'circuit repeats on ' + list[i]);
  }
  // Over four months every stage, circuit, skill and format comes up.
  assert.equal(new Set(arenas.map(a => a.arenaId)).size, ARENAS.length);
  assert.equal(new Set(races.map(r => r.trackId)).size, TRACKS.length);
  assert.deepEqual([...new Set(arenas.map(a => a.difficulty))].sort(), ['easy', 'hard', 'normal']);
  assert.deepEqual([...new Set(arenas.map(a => a.format))].sort(), ['duel', 'ffa']);
});

test('every daily chart is a real puzzle: a forced line in exactly par moves, three-movers on Sundays', () => {
  const game = kit.LANTERNS;
  for (const day of days(60)) {
    const c = D.chart(day, kit);
    assert.ok(c, 'a chart for ' + day);
    assert.equal(c.par, new Date(day + 'T00:00:00Z').getUTCDay() === 0 ? 3 : 2);
    assert.equal(game.turn(c.state), 1, 'you move first');
    assert.equal(game.outcome(c.state), null);
    assert.ok(c.state.queues[0].length >= 2 && c.state.queues[1].length >= 2, 'both pilots have stars in play');
    assert.ok(D.forcedWin(game, c.state, c.par), 'solvable in par on ' + day);
    assert.ok(!D.forcedWin(game, c.state, c.par - 1), 'not solvable sooner on ' + day);
    assert.ok(D.winningMoves(game, c.state, c.par).length >= 1);
    assert.ok(D.winningMoves(game, c.state, c.par).length < game.moves(c.state).length, 'some first moves lose the chart');
  }
});

test('Flare at Hard defends the daily chart: a random first move almost never still wins', () => {
  // Playing every non-answer against Flare's perfect defence must fail the try.
  const game = kit.LANTERNS, c = D.chart('2026-10-30', kit), answers = D.winningMoves(game, c.state, c.par);
  for (const first of game.moves(c.state).filter(m => !answers.includes(m))) {
    let s = game.apply(c.state, first), mine = 1, won = false;
    while (!game.outcome(s) && mine <= c.par) {
      if (game.turn(s) === 2) { s = game.apply(s, kit.bestMove(game, s, kit.LEVELS.hard)); continue; }
      if (mine === c.par) break;
      const w = D.winningMoves(game, s, c.par - mine); s = game.apply(s, w.length ? w[0] : game.moves(s)[0]); mine++;
    }
    const o = game.outcome(s); won = !!(o && o.seat === 1);
    assert.ok(!won, 'first move ' + first + ' should not beat a perfect Flare');
  }
});

test('the record keeps today’s bests, and the streak counts days with any daily played', () => {
  let rec = D.load({ getItem: () => null }, 'k', DAY), r;
  assert.equal(D.played(rec), 0);
  ({ rec, improved: r } = D.record(rec, 'run', { score: 300 }, DAY)); assert.ok(r);
  ({ rec, improved: r } = D.record(rec, 'run', { score: 200 }, DAY)); assert.ok(!r);
  assert.deepEqual(rec.run, { best: 300, runs: 2 });
  ({ rec } = D.record(rec, 'arena', { won: false, lives: 0 }, DAY));
  assert.ok(!D.settled(rec, 'arena'));
  ({ rec, improved: r } = D.record(rec, 'arena', { won: true, lives: 2 }, DAY)); assert.ok(r);
  ({ rec } = D.record(rec, 'arena', { won: false, lives: 0 }, DAY));
  assert.deepEqual(rec.arena, { won: true, lives: 2, tries: 3 }, 'a later loss never takes back the win');
  ({ rec } = D.record(rec, 'race', { time: null, place: 4 }, DAY));
  assert.equal(rec.race.best, null);
  ({ rec, improved: r } = D.record(rec, 'race', { time: 72.4, place: 2 }, DAY)); assert.ok(r);
  ({ rec, improved: r } = D.record(rec, 'race', { time: 75, place: 1 }, DAY)); assert.ok(!r);
  assert.deepEqual(rec.race, { best: 72.4, place: 2, tries: 3 });
  assert.equal(rec.streak.count, 1, 'one day, however many dailies');
  // Tomorrow carries the streak on; skipping a day starts a new one but keeps the best.
  const next = DAY + 86400000, later = DAY + 3 * 86400000;
  ({ rec } = D.record(rec, 'run', { score: 10 }, next));
  assert.deepEqual([rec.day, rec.streak.count, rec.run.runs, rec.arena], [D.dayKey(next), 2, 1, null]);
  const store = new Map(); D.save({ setItem: (k, v) => store.set(k, v) }, 'k', rec);
  const lapsed = D.load({ getItem: k => store.get(k) }, 'k', later);
  assert.deepEqual([lapsed.streak.count, lapsed.streak.best, lapsed.run], [0, 2, null]);
  ({ rec } = D.record(lapsed, 'chart', { started: true }, later));
  assert.deepEqual([rec.streak.count, rec.streak.best], [1, 2]);
});

test('daily chart tries count from the first star and stop at three', () => {
  let rec = D.load({ getItem: () => null }, 'k', DAY);
  ({ rec } = D.record(rec, 'chart', { solved: true }, DAY));
  assert.equal(rec.chart, null, 'a solve without a started try is ignored');
  for (let i = 0; i < 5; i++) ({ rec } = D.record(rec, 'chart', { started: true }, DAY));
  assert.deepEqual(rec.chart, { solved: 0, tries: 3 });
  assert.ok(D.settled(rec, 'chart'));
  let solved = D.record(D.load({ getItem: () => null }, 'k', DAY), 'chart', { started: true }, DAY).rec;
  solved = D.record(solved, 'chart', { started: true }, DAY).rec;
  const { rec: done, improved } = D.record(solved, 'chart', { solved: true }, DAY);
  assert.ok(improved); assert.deepEqual(done.chart, { solved: 2, tries: 2 });
  assert.deepEqual(D.record(done, 'chart', { started: true }, DAY).rec.chart, { solved: 2, tries: 2 }, 'practice after a solve changes nothing');
});

test('corrupt or foreign storage loads as a fresh day', () => {
  for (const raw of ['{', 'null', '[]', '{"v":9}', JSON.stringify({ v: 1, day: '2026-10-31', run: { best: 'x', runs: 1 }, arena: { tries: -1 }, chart: { tries: 99 }, streak: { count: 'a', last: 'nope' } })]) {
    const rec = D.load({ getItem: () => raw }, 'k', DAY);
    assert.deepEqual([rec.run, rec.arena, rec.race, rec.chart, rec.streak.count], [null, null, null, null, 0], raw);
  }
});

test('the shared result is spoiler-free: day, one line of results, streak and link', () => {
  let rec = D.load({ getItem: () => null }, 'k', DAY - 86400000);
  rec = D.record(rec, 'run', { score: 1 }, DAY - 86400000).rec;
  rec = D.record(rec, 'run', { score: 4210 }, DAY).rec;
  rec = D.record(rec, 'arena', { won: true, lives: 2 }, DAY).rec;
  rec = D.record(rec, 'race', { time: 72.4, place: 1 }, DAY).rec;
  rec = D.record(rec, 'chart', { started: true }, DAY).rec;
  rec = D.record(rec, 'chart', { solved: true }, DAY).rec;
  assert.equal(D.shareText(rec, 'https://picatz.github.io/space-man/'),
    'Space Man · Today 2026-10-31\nRun 4,210 · Arena ✓ ♥♥ · Circuit 1:12.40 · Chart ✓ 1st try\n✦ 2-day streak\nhttps://picatz.github.io/space-man/');
  const fresh = D.load({ getItem: () => null }, 'k', DAY);
  assert.match(D.shareText(fresh, ''), /Run — · Arena — · Circuit — · Chart —$/);
  assert.ok(D.MODES.every(m => D.settled(rec, m)));
});

test('the home Today strip shows each daily and records through the page', (t) => {
  const hub = relay(), c = client(hub);
  t.after(() => c.close());
  c.run('renderDailyCard()');
  const text = id => c.elements.get(id).textContent;
  assert.deepEqual(['dailyInfo', 'dailyArenaInfo', 'dailyRaceInfo', 'dailyChartInfo'].map(text), ['NEW', 'NEW', 'NEW', 'NEW']);
  assert.match(text('dailyChartTwist'), /^Line in [23]$/);
  assert.match(text('dailyArenaTwist'), /^\w+ · (Cadet|Pilot|Ace)$/);
  assert.match(text('dailyRaceTwist'), /^\w+ · (Chill|Sport|Expert)$/);
  assert.equal(c.elements.get('btnTodayShare').hidden, true, 'nothing to share before a daily is played');
  c.run("recordDaily('arena', { won: true, lives: 3 }); recordDaily('race', { time: 61.25, place: 1 }); recordDaily('chart', { started: true })");
  assert.equal(text('dailyArenaInfo'), 'WON ♥♥♥');
  assert.equal(text('dailyRaceInfo'), '1:01.25');
  assert.equal(text('dailyChartInfo'), '2 OF 3 LEFT');
  assert.deepEqual(['btnDailyArena', 'btnDailyRace', 'btnDailyChart'].map(id => c.elements.get(id).dataset.state), ['done', 'done', 'played']);
  assert.equal(c.elements.get('btnTodayShare').hidden, false);
  c.run("recordDaily('chart', { solved: true }); recordDaily('run', { score: 5 })");
  assert.ok(c.run("G.discoveries.includes('sweep')"), 'all four settled in a day logs Full Sky');
});
