const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');
const json = (c, code) => JSON.parse(c.run('JSON.stringify(' + code + ')'));
function open(t, opts) { const c = client(relay(), opts); t.after(() => c.close()); return c; }

test('existing saves retain outfits, owned items, callsign, records, and settings across migration/reload', t => {
  const storage = new Map([
    ['sm2.cosmetics', JSON.stringify({ suit: 'graphite', hat: 'halo', unlocked: ['graphite', 'halo', 'crown'], callsign: [2, 3], patches: ['veteran'] })],
    ['sm2.stats', JSON.stringify({ runs: 29, bestScore: 812, bestDist: 777, medals: { GOLD: 1 } })],
    ['sm2.settings', JSON.stringify({ musicVol: .4, keys: { left: 'a', right: 'd', jump: 'w', fire: 'f' } })],
  ]);
  const a = open(t, { storage });
  assert.equal(a.run('G.cosmetics.suit'), 'graphite'); assert.equal(a.run('G.cosmetics.hat'), 'halo');
  assert.deepEqual(json(a, 'G.cosmetics.callsign'), [2, 3]); assert.deepEqual(json(a, 'G.cosmetics.patches'), ['veteran']);
  assert.equal(a.run('settings.musicVol'), .4); assert.equal(a.run('stats.bestScore'), 812);
  a.run('persistAll()');
  const b = open(t, { storage });
  assert.deepEqual(json(b, 'G.cosmetics'), json(a, 'G.cosmetics'));
  for (const id of ['graphite','halo','crown','gold','phones']) assert.equal(b.run(`G.cosmetics.unlocked.includes('${id}')`), true);
});

test('corrupt profile JSON cannot break the title, normalized saves or network identity', t => {
  const storage = new Map([['sm2.cosmetics', '{broken']]);
  const c = open(t, { storage });
  assert.equal(c.run('G.mode'), 'attract');
  assert.deepEqual(json(c, 'equippedAppearance()'), json(c, 'COSMETICS.DEFAULTS'));
  c.run('persistAll()'); assert.doesNotThrow(() => JSON.parse(storage.get('sm2.cosmetics')));
  assert.equal(c.run('COSMETICS.wireAppearance(netIdentity().appearance) !== null'), true);
});

test('equipped suit stays literal in rooms and six-slot identity never includes inventory or powers', t => {
  const c = open(t);
  assert.equal(c.run("effectiveSuit('classic', 3)"), 'classic');
  c.run("G.cosmetics = COSMETICS.equip(G.cosmetics, 'eyes', 'happy').profile; G.cosmetics = COSMETICS.equip(G.cosmetics, 'ship', 'orbit').profile");
  assert.equal(c.run('netIdentity().appearance.eyes'), 'happy'); assert.equal(c.run('netIdentity().appearance.ship'), 'orbit');
  assert.deepEqual(Object.keys(json(c, 'netIdentity().appearance')), ['v','suit','hat','eyes','helmet','detail','ship']);
});

test('reward bridge persists once, preserves current look and never records QA rewards', t => {
  const c = open(t);
  c.run("G.cosmetics = COSMETICS.equip(G.cosmetics, 'hat', 'antenna').profile");
  const before = json(c, 'equippedAppearance()');
  assert.deepEqual(json(c, "earnCosmeticEvent({type:'arena',id:'round:1'})"), ['lilac','determined','catears']);
  assert.deepEqual(json(c, "earnCosmeticEvent({type:'arena',id:'round:1'})"), []);
  assert.deepEqual(json(c, 'equippedAppearance()'), before);
  const shot = open(t, { hash:'#shot=play' });
  assert.deepEqual(json(shot, "earnCosmeticEvent({type:'arena',id:'round:1'})"), []);
  assert.equal(shot.run('G.cosmetics.progress.arena'), 0);
});


test('arcade rewards write only cosmetics and preserve independently updated runner records', t => {
  const storage = new Map(), c = open(t, { storage });
  storage.set('sm2.best', '4321'); storage.set('sm2.stats', JSON.stringify({ runs: 80, bestScore: 4321 }));
  storage.set('sm2.settings', JSON.stringify({ music: false, sfx: false }));
  const records = ['sm2.best', 'sm2.stats', 'sm2.settings'].map(key => storage.get(key));
  c.run("earnCosmeticEvent({type:'arena',id:'round:independent'})");
  assert.deepEqual(['sm2.best', 'sm2.stats', 'sm2.settings'].map(key => storage.get(key)), records);
  assert.equal(JSON.parse(storage.get('sm2.cosmetics')).progress.arena, 1);
});
