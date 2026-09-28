const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { client, relay } = require('./harness.cjs');

// src/course.js on its own: pure parsing, no game, no DOM.
function course() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'course.js'), 'utf8'), sandbox);
  return sandbox.window.SpaceManCourse;
}
function solo(t) { const c = client(relay()); t.after(() => c.close()); return c; }
// Streams the course far ahead; the noisy client also kills everything it sees,
// sprays particles, burns gameplay rng, carries mercy history and generates in
// different batch sizes — none of which may fork a fixed course.
function terrain(c, start, noisy, mercy = noisy) {
  return JSON.parse(c.run(`JSON.stringify((() => {
    stats.mercy=${mercy}; stats.deadStreak=${mercy ? 9 : 0};
    ${start};
    const all = new Map();
    for (let x=30; x<30000; x+=${noisy ? 711 : 370}) {
      G.player.x=x;
      ${noisy ? `for (const e of G.enemies) if (!e.dead) killEnemy(e, 'stomp', false);
      burst(x, 200, 40, 3, 30, 3, '#fff', 0.1, 2); for (let j=0;j<53;j++) rng(); G.enemies=[];` : ''}
      generateAhead(); for (const p of G.platforms) all.set(p.x,[p.x,p.y,p.w,p.boost,p.boostX]);
    }
    return [...all.values()].filter((p)=>p[0]<29000);
  })())`));
}

test('the daily course is identical for everyone on a date, whatever happens mid-run', (t) => {
  const a = solo(t), b = solo(t);
  const start = "startRun({course: dailyCourse('2026-09-28')})";
  const quiet = terrain(a, start, false), noisy = terrain(b, start, true);
  assert.ok(quiet.length > 50);
  assert.deepEqual(quiet, noisy);
  assert.equal(b.run('G.mercy'), false);
  assert.equal(b.run('G.runSeed'), course().daySeed('2026-09-28'));
  assert.notDeepEqual(terrain(a, "startRun({course: dailyCourse('2026-09-27')})", false), quiet);
});

test('normal solo runs stay random, and a shared run is the exact same course for a friend', (t) => {
  const a = solo(t), b = solo(t);
  const played = terrain(a, 'startRun()', true, false), seed = a.run('G.runSeed');
  assert.equal(a.run('G.course'), null);
  assert.notDeepEqual(terrain(a, 'startRun()', false), played);           // next run: new random course
  assert.notEqual(a.run('G.runSeed'), seed);
  assert.deepEqual(terrain(b, `challenge = COURSE.parse('#seed=${seed}&beat=10', Date.now()); startRun()`, false), played);
  // Mercy reshapes a struggling player's course, so that run isn't offered as a race.
  a.run('stats.mercy=true; stats.deadStreak=9; startRun()');
  assert.equal(a.run('G.worldRng'), null); assert.equal(a.run('G.mercy'), true);
});

test('challenge fragments accept valid links and reject everything else', () => {
  const C = course(), now = Date.UTC(2026, 8, 28, 23, 59);
  assert.deepEqual({ ...C.parse('#daily=2026-09-28&beat=1234', now) },
    { kind: 'daily', day: '2026-09-28', seed: C.daySeed('2026-09-28'), beat: 1234 });
  assert.equal(C.parse('#daily=2026-09-21', now).beat, 0);                 // a week old, no score
  assert.deepEqual({ ...C.parse('#seed=42&beat=900', now) }, { kind: 'seed', seed: 42, beat: 900 });
  assert.equal(C.parse('beat=7&seed=4294967295', now).seed, 4294967295);
  for (const bad of [
    '', '#', '#seed=42', '#beat=5', '#daily=2026-09-29', '#daily=2026-09-20', '#daily=2026-02-30',
    '#daily=2026-9-28', '#daily=20260928', '#seed=4294967296&beat=1', '#seed=12345678901&beat=1',
    '#seed=-1&beat=1', '#seed=0x10&beat=1', '#seed=1e5&beat=1', '#seed=1&beat=12345678', '#seed=1&beat=-3',
    '#seed=1&beat=1&beat=2', '#daily=2026-09-28&seed=1&beat=1', '#daily=2026-09-28&beat=<b>x</b>',
    '#shot=dead&seed=3&beat=5', '#j=AQBrYWctcm9vbS1tb2Nr', '#seed=1&beat=1&x=1', '#seed=%31&beat=1',
    '#seed=1&beat=1&' , '#' + 'seed=1&'.repeat(12) + 'beat=1', '#daily=2026-09-28&beat=' + '9'.repeat(80),
  ]) assert.equal(C.parse(bad, now), null, bad);
  const link = C.link({ kind: 'daily', day: '2026-09-28' }, 1234);
  assert.equal(link, 'https://picatz.github.io/space-man/#daily=2026-09-28&beat=1234');
  assert.equal(C.parse(link.slice(link.indexOf('#')), now).beat, 1234);
  assert.equal(C.link({ kind: 'seed', seed: 77 }, 5), 'https://picatz.github.io/space-man/#seed=77&beat=5');
});

test('a challenge link plays its seed once, and Play Again races it again', (t) => {
  const c = solo(t);
  c.run("challenge = COURSE.parse('#seed=77&beat=500', Date.now()); renderDailyCard();");
  assert.equal(c.elements.get('challengeBanner').textContent, 'Beat 500 on this course');
  const quiet = terrain(c, 'startRun()', false);
  assert.equal(c.run('G.runSeed'), 77); assert.equal(c.run('G.course.target'), 500);
  assert.ok(c.run('G.worldRng !== null'));
  assert.deepEqual(terrain(c, 'G.mode="dead"; G.deadShownAt=-9; tryRestart()', true), quiet);
  c.run('startRun()');
  assert.equal(c.run('G.course'), null);
});

test('daily record tracks today only and the death card reports it', (t) => {
  const c = solo(t);
  c.run("saveJSON(LS.daily, {day:'2000-01-01', best:999, bestDist:9, runs:5})");
  assert.equal(c.run('loadDaily().runs'), 0);
  const run = (score) => c.run(`startRun({course: dailyCourse()}); G.score=${score}; G.dist=40; G.finalScore=undefined; finalizeDeath(); deathCourseLine(${score})`);
  assert.match(run(300), /^DAILY \d{4}-\d{2}-\d{2} · TODAY’S FIRST RUN$/);
  assert.match(run(200), /100 TO TODAY’S BEST$/);
  assert.equal(c.run('G.course.target'), 300);
  assert.match(run(450), /NEW DAILY BEST \+150$/);
  assert.equal(c.run('loadDaily().runs'), 3);
  assert.equal(c.run('loadDaily().best'), 450);
  c.run('renderDailyCard()');
  assert.equal(c.elements.get('dailyInfo').textContent, 'BEST 450 · 3 RUNS');
});

test('the death card shares a spoiler-free result with a challenge link', async (t) => {
  const c = solo(t);
  let copied = null;
  c.context.navigator.clipboard = { writeText: async (s) => { copied = s; } };
  c.run("startRun({course: dailyCourse('2026-09-28')}); G.score=1234; G.dist=940; die('void'); showDeathCard();");
  assert.equal(c.elements.get('btnShare').style.display, '');
  assert.match(c.elements.get('deadCourse').textContent, /^DAILY 2026-09-28/);
  c.run('shareRun()');
  await new Promise((r) => setImmediate(r));
  assert.equal(copied, 'SPACE MAN · Daily 2026-09-28 · 1,234 pts · 940 m 🚀\nhttps://picatz.github.io/space-man/#daily=2026-09-28&beat=1234');
  assert.equal(c.elements.get('btnShare').textContent, 'Copied ✓');
  c.run("startRun(); G.score=50; G.dist=12; die('void'); showDeathCard(); shareRun();");
  await new Promise((r) => setImmediate(r));
  assert.equal(copied, 'SPACE MAN · 50 pts · 12 m 🚀\nhttps://picatz.github.io/space-man/#seed=' + c.run('G.runSeed') + '&beat=50');
});
