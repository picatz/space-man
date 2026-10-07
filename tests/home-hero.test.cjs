const test = require('node:test');
const assert = require('node:assert/strict');
const { heroLabel, resetsIn } = require('../src/home.js');

test('hero CTA names the last-played mode and shows the run best only for Endless Run', () => {
  assert.equal(heroLabel('run', 4320), 'Play · Endless Run · best 4,320');
  assert.equal(heroLabel('run', 0), 'Play · Endless Run');
  assert.equal(heroLabel('arena', 4320), 'Play · Orbital Arena');
  assert.equal(heroLabel('race', 9), 'Play · Star Circuit');
  assert.equal(heroLabel('bogus', 5), 'Play · Endless Run · best 5', 'unknown modes fall back to the run');
});

test('Daily reset countdown is UTC-midnight based', () => {
  assert.equal(resetsIn(Date.UTC(2026, 9, 7, 18, 0, 0)), 'resets in 6h');
  assert.equal(resetsIn(Date.UTC(2026, 9, 7, 23, 30, 0)), 'resets in 30m');
  assert.equal(resetsIn(Date.UTC(2026, 9, 7, 23, 59, 59)), 'resets in 1m');
  assert.equal(resetsIn(Date.UTC(2026, 11, 31, 0, 0, 0)), 'resets in 24h');
});
