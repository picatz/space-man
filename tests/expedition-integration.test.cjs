const test = require('node:test');
const assert = require('node:assert/strict');
const {client,relay} = require('./harness.cjs');
function setup(t) {
  const c=client(relay());t.after(()=>c.close());
  c.run("Math.random = () => 3 / 0xffffffff;");
  c.run("window.callbacks = {}; window.SpaceManArenaUI = {create: stub('arena')}; window.SpaceManRaceUI = {create: stub('race')}; function stub(id) {return options => ({active:false,openSession(config,done){this.active=true;callbacks[id]=done;return true;},close(){this.active=false;options.onClose();}});}");
  return c;
}
test('one launch flows through multiple sectors without chapter controls or result overlays',t=>{
  const c=setup(t); c.run('openExpedition()');
  assert.equal(c.run('expedition.snapshot().phase'),'playing');
  assert.equal(c.run('G.mode'),'play'); assert.equal(c.run('swSafeMoment()'),false);
  for(let i=0;i<12;i++){
    const id=c.run('expedition.snapshot().current.id');
    if(id==='runner') c.run('input.right=true;G.dist=400;G.score=450;G.finalScore=450;finalizeDeath(true);finishExpeditionRunner(true)');
    else c.run('callbacks.'+id+'({won:true,kos:3,stocks:2,position:1,finished:true,time:47})');
    assert.equal(c.run('expedition.snapshot().completed'),i+1);
    assert.equal(c.run('expedition.snapshot().phase'),'playing');
    assert.equal(c.run('expedition.snapshot().index'),i+1);
    assert.equal(c.run('input.right'),false);
  }
  assert.equal(c.net.active,false); c.run('exitExpedition(); startRun(); input.right=true; update()');
  assert.equal(c.run('expedition'),null);assert.ok(c.run('G.player.vx>0'));
});
test('death rescues immediately into the next encounter and banks once',t=>{
  const c=setup(t);c.run("openExpedition(); G.score=77; die('void'); showDeathCard()");
  assert.equal(c.run('expedition.snapshot().records[0].reached'),false);
  assert.equal(c.run('stats.runs'),1);assert.equal(c.run('arenaUI.active'),true);
  c.run('finishExpeditionRunner(false); exitExpedition()');assert.equal(c.run('stats.runs'),1);
});
test('runner timeout advances automatically',t=>{
  const c=setup(t);c.run('openExpedition();G.frameCount=expedition.snapshot().current.maxTicks; update()');
  assert.equal(c.run('expedition.snapshot().completed'),1);assert.equal(c.run('arenaUI.active'),true);
});
test('exit cancels delayed results and clears cues',t=>{
  const c=setup(t);c.run('openExpedition();G.finalScore=0;finishExpeditionRunner(false);window.oldResult=callbacks.arena;arenaUI.close()');
  assert.equal(c.run('expedition'),null);c.run('openExpedition();oldResult({won:true})');
  assert.equal(c.run('expedition.snapshot().completed'),0);c.run('exitExpedition()');
  assert.equal(c.elements.get('expeditionCue').hidden,true);
  assert.equal(c.elements.get('btnQuit').textContent,'Quit to Title');
});
test('solo never leaves or repurposes a room',t=>{
  const c=setup(t);c.net.mockActive=true;c.run('openExpedition()');
  assert.equal(c.run('expedition'),null);assert.equal(c.net.mockActive,true);c.net.mockActive=false;
});

