const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { client, relay } = require('./harness.cjs');

require('../src/relay-directory.js');
const dir = globalThis.SpaceManRelayDir;

// Regression: callers passed `list`/`text` while the directory read only `servers`,
// so a pasted relay list silently fell back to the default relays.
for (const key of ['servers', 'list', 'text']) {
  test(`relay directory list mode accepts the "${key}" key`, async () => {
    const r = await dir.load({ mode: 'list', [key]: 'a.example.com, b.example.com' });
    assert.equal(r.source, 'list');
    assert.equal(r.map.src, 'server-list');
    assert.deepEqual(r.map.regions[0].hosts, ['a.example.com', 'b.example.com']);
  });
}

test('relay directory list mode with no usable hosts yields an empty map', async () => {
  const r = await dir.load({ mode: 'list', servers: '' });
  assert.equal(r.map.regions.length, 0);
});

test('a pasted relay list activates the server-list directory in net', async (t) => {
  const c = client(relay(), { game: false }); t.after(() => c.close());
  assert.notEqual(c.net.relayDirectory().src, 'server-list');
  await c.net.setRelayDirectory('list', { list: 'a.example.com' });
  const d = c.net.relayDirectory();
  assert.equal(d.src, 'server-list');
  assert.equal(d.regions[0].hosts, 1);
});

test('index.html builds relay options in one helper that uses the directory key', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal((html.match(/function relayHostOptions\(/g) || []).length, 1);
  assert.match(html, /relayDir\.servers = settings\.netRelayList/);
  assert.doesNotMatch(html, /relayDir\.list\b/);
  assert.doesNotMatch(html, /mode: 'list', text:/);
});
