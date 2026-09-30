// The wire-protocol doc's worked example must be the bytes the code really sends, and the
// battery-saver announcement must say what is really happening.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { client, relay } = require('./harness.cjs');

const DOC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'wire-protocol.md'), 'utf8');
const hexBytes = (s) => s.trim().split(/\s+/).map((h) => parseInt(h, 16));

test('the worked HELLO example in docs/wire-protocol.md matches the real encoder byte for byte', (t) => {
  const c = client(relay(), { game: false });
  t.after(() => c.close());
  const F = c.net._n1.frames;
  const block = DOC.match(/Full 43-byte plaintext, contiguous:\s*```\n([\s\S]*?)```/)[1];
  const docBytes = hexBytes(block);
  assert.equal(docBytes.length, 43);
  const proof16 = new Uint8Array(docBytes.slice(20, 36));   // the HMAC is example data; everything else is derived
  const real = Array.from(F.encHello(F.makeScratch(), { tag: 'KAG', suit: 3, hat: 1, wantP: 0, proof16, role: 0, caps: 0x1f, adjIdx: 5, nounIdx: 17 }));
  assert.deepEqual(docBytes, real);
  // The annotated table and the sealed envelope header carry the same version.
  const P = c.net._n1.PROTO, hx = P.toString(16).padStart(2, '0').toUpperCase();
  assert.match(DOC, new RegExp('0x01    ' + hx + '\\s+protoMin = ' + P));
  assert.match(DOC, new RegExp('\\n53 ' + hx + ' 01 00 00 00 00 00 00 00 00\\n'));
});

test('switching the manual saver off while the low-battery saver is on says saving stays on', (t) => {
  const c = client(relay(), { dpr: 2 });
  t.after(() => c.close());
  const said = () => c.elements.get('srAnnounce').textContent;
  c.run('toggleSetting("batterySaver")');                    // manual on
  assert.match(said(), /Battery saver on/);
  c.run('power.lowBattery = true; applyPower()');            // the battery runs low meanwhile
  c.run('toggleSetting("batterySaver")');                    // manual off — but saving continues
  assert.equal(c.run('powerSaving()'), true);
  assert.match(said(), /low battery|stays on/i, 'announced: ' + said());
  assert.doesNotMatch(said(), /^Battery saver off\.$/);
  c.run('power.lowBattery = false; applyPower(); toggleSetting("batterySaver"); toggleSetting("batterySaver")');
  assert.equal(c.run('powerSaving()'), false);
  assert.equal(said(), 'Battery saver off.', 'with a healthy battery, off is really off');
});
