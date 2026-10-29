const test = require('node:test'), assert = require('node:assert/strict');
const Seasons = require('../src/seasons.js');
const on = (y, m, d, opts) => Seasons.at(new Date(y, m - 1, d, 12), opts);
const active = s => s.events.map(e => e.flag);

test('the Lantern Reach calendar keeps every runner season on its dates', () => {
  assert.deepEqual(active(on(2026, 10, 23)), []);
  assert.deepEqual(active(on(2026, 10, 24)), ['dusk']);
  assert.deepEqual(active(on(2026, 10, 31)), ['dusk']);
  assert.deepEqual(active(on(2026, 11, 1)), []);
  assert.deepEqual(active(on(2026, 12, 1)), ['frost']);
  assert.deepEqual(active(on(2026, 12, 31)), ['fw', 'frost'], 'Turnover headlines the Long Night');
  assert.deepEqual(active(on(2027, 1, 5)), ['frost']);
  assert.deepEqual(active(on(2027, 1, 6)), []);
  assert.deepEqual(active(on(2026, 3, 20)), ['blossom']);
  assert.deepEqual(active(on(2026, 2, 17)), ['lunar']);
  assert.deepEqual(active(on(2026, 2, 23)), ['lunar']);
  assert.deepEqual(active(on(2026, 2, 24)), []);
  assert.deepEqual(active(on(2031, 2, 1)), [], 'no lunar table, no guess');
  const s = on(2026, 10, 29);
  assert.equal(s.dusk, true); assert.equal(s.frost, false); assert.equal(s.bday, 0);
});

test('the anniversary counts whole years since the first run, on that day only', () => {
  assert.equal(on(2027, 6, 2, { firstRunDate: '2026-06-02' }).bday, 1);
  assert.equal(on(2028, 6, 2, { firstRunDate: '2026-06-02' }).bday, 2);
  assert.equal(on(2026, 6, 2, { firstRunDate: '2026-06-02' }).bday, 0, 'not on the first day itself');
  assert.equal(on(2027, 6, 3, { firstRunDate: '2026-06-02' }).bday, 0);
  assert.equal(on(2027, 6, 2, { firstRunDate: 'nonsense' }).bday, 0);
  assert.match(Seasons.headline(on(2028, 6, 2, { firstRunDate: '2026-06-02' })).tag, /2 years/);
});

test('every event has a short home tagline, a spoken line and a known motif', () => {
  for (const row of Seasons.CALENDAR) {
    assert.ok(row.tag.length <= 30, row.tag + ' fits the home tagline slot');
    assert.ok(row.line.length > row.tag.length);
    assert.ok(Seasons.MOTIFS[row.motif], row.motif);
  }
  assert.equal(Seasons.headline(Seasons.off()), null);
  assert.equal(Seasons.lanternColor(on(2026, 10, 29)), Seasons.MOTIFS.lanterns.dusk);
  assert.equal(Seasons.lanternColor(on(2026, 2, 17)), Seasons.MOTIFS.lanterns.lunar);
  assert.equal(Seasons.lanternColor(on(2026, 7, 1)), null);
  assert.deepEqual(active(Seasons.at(new Date('nope'))), []);
});

test('modes read one shared state, and a cleared state is no season', () => {
  const s = on(2026, 10, 29);
  assert.equal(Seasons.set(s), s); assert.equal(Seasons.current().dusk, true);
  assert.equal(Seasons.set(null).dusk, false); assert.deepEqual(Seasons.current().events, []);
});

test('finishing a game in a season stamps the logbook once, and other modes log through SpaceManLogbook', () => {
  const { client, relay } = require('./harness.cjs');
  const c = client(relay());
  const out = JSON.parse(c.run(`JSON.stringify((() => {
    G.discoveries.length = 0;
    SEASON = window.SpaceManSeasons.set(window.SpaceManSeasons.at(new Date(2026, 9, 29, 12)));
    stampSeason(); stampSeason();
    const first = window.SpaceManLogbook.discover('photo'), again = window.SpaceManLogbook.discover('photo');
    const unknown = window.SpaceManLogbook.discover('nope');
    const stamps = window.SpaceManSeasons.CALENDAR.map(r => r.stamp).filter(id => !DISCOVERIES.some(d => d.id === id));
    return { found: G.discoveries.slice(), first: first && first.name, again, unknown, stamps, ids: new Set(DISCOVERIES.map(d => d.id)).size === DISCOVERIES.length };
  })())`));
  assert.deepEqual(out.found, ['dusk', 'photo']);
  assert.equal(out.first, 'PHOTO FINISH'); assert.equal(out.again, null); assert.equal(out.unknown, null);
  assert.deepEqual(out.stamps, [], 'every season has a logbook entry');
  assert.equal(out.ids, true);
});
