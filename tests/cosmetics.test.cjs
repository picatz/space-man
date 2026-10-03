const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/cosmetics');

test('catalog is a bounded immutable wire vocabulary with free expressive choices', () => {
  assert.equal(C.WIRE_BYTES, 7);
  for (const slot of C.SLOTS) {
    assert.ok(Object.isFrozen(C.ORDERS[slot]));
    assert.ok(C.CATALOG[slot].filter(item => item.free).length >= 2, slot);
    assert.ok(C.ORDERS[slot].includes(C.DEFAULTS[slot]));
    assert.ok(C.CATALOG[slot].every(item => item.id.length <= 16));
  }
  assert.equal(C.palette({ suit: 'mint' }).suit, '#C8F5DC');
  assert.equal(C.palette({ suit: '__proto__' }), C.PALETTES.classic);
});

test('appearance wire is exact length, allowlisted and round trips every catalog choice', () => {
  for (const slot of C.SLOTS) for (const id of C.ORDERS[slot]) {
    const value = { ...C.DEFAULTS, [slot]: id };
    assert.deepEqual(C.decodeAppearance(C.encodeAppearance(value)), value);
  }
  for (const raw of [null, [], {}, { ...C.DEFAULTS, v: 2 }, { ...C.DEFAULTS, suit: 1 }, { ...C.DEFAULTS, eyes: '<img src=x>' }, { ...C.DEFAULTS, url: 'https://example.test' }, { ...C.DEFAULTS, damage: 9 }]) {
    assert.equal(C.wireAppearance(raw), null); assert.equal(C.encodeAppearance(raw), null);
  }
  for (const bytes of [null, [], [1, 0], [2, 0, 0, 0, 0, 0, 0], [1, 8, 0, 0, 0, 0, 0], [1, 0, 9, 0, 0, 0, 0], [1, 0, 0, -1, 0, 0, 0], [1, 0, 0, NaN, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0, 0]]) assert.equal(C.decodeAppearance(bytes), null);
});

test('legacy wardrobe migration preserves ownership, equipment, callsign and unrelated metadata', () => {
  const old = { suit: 'graphite', hat: 'halo', unlocked: ['crown', 'phones', 'halo', 'graphite', 'phones'], callsign: [2, 5], companion: 'default', patches: ['moon'], customMetadata: { lastSeen: 18 } };
  const original = JSON.stringify(old), p = C.migrateProfile(old, { stats: { runs: 25 }, flags: { bestStreak: 3 } });
  assert.equal(JSON.stringify(old), original, 'input not mutated');
  assert.equal(p.suit, 'graphite'); assert.equal(p.hat, 'halo');
  for (const id of old.unlocked) assert.ok(p.unlocked.includes(id));
  assert.deepEqual(p.callsign, [2, 5]); assert.deepEqual(p.patches, ['moon']); assert.deepEqual(p.customMetadata, old.customMetadata);
  assert.ok(p.unlocked.includes('gold')); assert.ok(p.unlocked.includes('catears')); assert.ok(p.unlocked.includes('phones'));
  assert.equal(p.progress.runner, 3);
  assert.deepEqual(C.migrateProfile(p), p, 'idempotent reload');
  assert.ok(C.migrateProfile({ suit: 'lilac', hat: 'cone' }).unlocked.includes('cone'), 'equipped legacy items remain owned without a ledger');
});

test('malformed profiles fall back without losing valid choices or admitting unknown IDs', () => {
  for (const value of [null, [], 'broken', 6, true, { unlocked: 'crown' }, { suit: '__proto__', hat: '<script>', eyes: { x: 1 }, progress: { runner: Infinity, events: [null, {}, '../remote'] } }]) {
    const p = C.migrateProfile(value);
    assert.deepEqual(C.getAppearance(p), C.DEFAULTS);
    assert.ok(p.unlocked.includes('classic')); assert.ok(p.unlocked.includes('happy'));
    assert.equal(p.progress.runner, 0); assert.ok(p.progress.events.every(x => typeof x === 'string'));
  }
  const p = C.migrateProfile(JSON.parse('{"__proto__":{"polluted":true},"suit":"mint","unlocked":["bad","crown","crown"]}'));
  assert.equal({}.polluted, undefined); assert.equal(p.suit, 'mint'); assert.equal(p.unlocked.filter(x => x === 'crown').length, 1); assert.ok(!p.unlocked.includes('bad'));
});

test('play earns deterministic cosmetics without wins, streaks, spending or power', () => {
  let p = C.migrateProfile(null);
  const earned = [];
  for (const type of ['runner', 'arena', 'race', 'encounter', 'journey']) {
    const r = C.reward(p, { type, id: 'session:1', won: false }); p = r.profile; earned.push(...r.unlocked);
    assert.equal(r.accepted, true);
    const twice = C.reward(p, { type, id: 'session:1' });
    assert.equal(twice.accepted, false); assert.deepEqual(twice.profile, p); assert.deepEqual(twice.unlocked, []);
  }
  for (const id of ['gold', 'lilac', 'beanie', 'coral', 'aurora', 'halo', 'stars', 'determined', 'retro']) assert.ok(earned.includes(id), id);
  assert.equal(C.equip(C.migrateProfile(null), 'hat', 'crown').equipped, false);
  assert.equal(C.equip(p, 'helmet', 'retro').equipped, true);
  assert.deepEqual(Object.keys(C.getAppearance(p)), ['v', ...C.SLOTS]);
  assert.equal(C.equip(p, 'damage', 999).equipped, false);
});

test('event journal is bounded, survives reload and cannot count invalid or repeated receipts', () => {
  let p = C.migrateProfile(null);
  for (let i = 0; i < 160; i++) p = C.reward(p, { type: 'runner', id: 'r:' + i }).profile;
  assert.equal(p.progress.events.length, 128); assert.equal(p.progress.runner, 3);
  const id = 'x'.repeat(96);
  p = C.reward(p, { type: 'encounter', id }).profile;
  assert.equal(C.reward(JSON.parse(JSON.stringify(p)), { type: 'encounter', id }).accepted, false);
  for (const event of [null, {}, { type: 'daily', id: 'a' }, { type: 'runner', id: 'bad id' }, { type: 'arena', id: 'x'.repeat(97) }]) assert.equal(C.reward(p, event).accepted, false);
});

test('online award receipts survive reconnects and reject secret-bearing identities', () => {
  const id = C.roundReceipt('arena', '1234abcd5678ef90', 8);
  assert.equal(id, 'room:1234abcd5678ef90:arena:8');
  let p = C.reward(null, { type:'arena', id }).profile;
  assert.equal(C.reward(JSON.parse(JSON.stringify(p)), { type:'arena', id:C.roundReceipt('arena','1234abcd5678ef90',8) }).accepted, false);
  assert.equal(C.reward(p, { type:'arena', id:C.roundReceipt('arena','1234abcd5678ef90',9) }).accepted, true);
  for (const roomId of ['', 'https://game.test/#room=SECRET', '1234ABCD5678EF90', 'f'.repeat(64)]) assert.equal(C.roundReceipt('arena', roomId, 8), null);
  for (const epoch of [-1, NaN, Infinity, 0x100000000, 1.5]) assert.equal(C.roundReceipt('race','1234abcd5678ef90',epoch), null);
});
