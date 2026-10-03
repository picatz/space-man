const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/expedition.js');
test('continuous route remixes modes and stages with regular boss climaxes', () => {
  const routes = new Set(), stages = new Set(), tracks = new Set();
  for (let seed = 0; seed < 100; seed++) {
    let previous;
    routes.add(Array.from({length: 4}, (_, i) => E.encounterAt(seed,i).id).join(','));
    for (let i = 0; i < 100; i++) {
      const leg = E.encounterAt(seed, i);
      assert.deepEqual(leg, E.encounterAt(seed, i));
      assert.notEqual(leg.id, previous); previous = leg.id;
      assert.equal(leg.kind === 'boss', i % 5 === 4);
      if (leg.id === 'arena') { stages.add(leg.arenaId); assert.ok(leg.durationTicks <= 3300); }
      if (leg.id === 'runner') assert.ok(leg.maxTicks <= 2400);
      if (leg.id === 'race') { tracks.add(leg.trackId); assert.equal(leg.laps,1); assert.equal(leg.maxTicks,5400); }
    }
  }
  assert.equal(routes.size,6); assert.equal(stages.size,3); assert.equal(tracks.size,3);
});
test('completion requires the current token; no result cards or fixed end after three', () => {
  const e = E.create(3);
  for (let i = 0; i < 50; i++) {
    const leg = e.begin(); assert.ok(leg); assert.equal(e.begin(), null); assert.equal(e.advance(), false);
    assert.equal(e.finish(leg.id,leg.token+1,{}),false);
    assert.equal(e.finish(leg.id,leg.token,{}),true);
    assert.equal(e.finish(leg.id,leg.token,{}),false);
    assert.equal(e.snapshot().phase,'transition');
    assert.equal(e.advance(),true);
  }
  assert.equal(e.snapshot().completed,50); assert.equal(e.snapshot().records.length,20);
  assert.equal(e.snapshot().index,50);
  const copy=e.snapshot(); copy.records[0].name='bad'; copy.current.id='bad';
  assert.notEqual(e.snapshot().records[0].name,'bad'); assert.notEqual(e.snapshot().current.id,'bad');
  e.cancel(); assert.equal(e.begin(),null); assert.equal(e.advance(),false);
});
test('receipt data is bounded and retains no unrecognized values', () => {
  const e=E.create(0),leg=e.begin();
  e.finish(leg.id,leg.token,{reached:true,distance:Infinity,score:-3,secret:'ignored'});
  const r=e.snapshot().records[0]; assert.equal(r.distance,0);assert.equal(r.score,0);assert.equal(r.secret,undefined);
});


test('page has no orphaned legacy briefing or continue controls', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
  assert.doesNotMatch(html, /id="(?:ovExpedition|btnExpeditionContinue|btnExpeditionExit|expeditionLeg[0-9])"/);
  assert.equal((html.match(/id="expeditionCue"/g)||[]).length,1);
});
