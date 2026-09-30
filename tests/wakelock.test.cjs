const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

test('the screen stays awake only while a run is live, and is let go the moment it is not', async (t) => {
  const log = [];
  const navigator = { wakeLock: { request: async (type) => { log.push('request:' + type); const l = { release: async () => { log.push('release'); }, addEventListener() {} }; return l; } } };
  const c = client(relay(), { navigator });
  t.after(() => c.close());
  c.run("G.mode = 'attract'; tickWakeLock()");
  assert.deepEqual(log, [], 'no lock on the title screen');
  c.run("G.mode = 'play'; tickWakeLock()");
  await new Promise((r) => setTimeout(r, 5));
  c.run('tickWakeLock(); tickWakeLock()');
  assert.deepEqual(log, ['request:screen'], 'one request, however many frames');
  c.run("G.mode = 'pause'; tickWakeLock()");
  assert.deepEqual(log, ['request:screen', 'release']);
});

test('a browser without wake lock, or one that refuses, changes nothing', async (t) => {
  const c = client(relay(), { navigator: { wakeLock: { request: () => Promise.reject(new Error('denied')) } } });
  t.after(() => c.close());
  c.run("G.mode = 'play'; tickWakeLock()");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(c.run('wake.lock'), null);
  assert.equal(c.run('wake.pending'), false, 'a refusal is retried on a later frame');
});
