const test=require('node:test'),assert=require('node:assert/strict');
const {client,relay}=require('./harness.cjs');
test('paused wall time cannot consume opening mercy or change quick-death difficulty',t=>{
 const c=client(relay());t.after(()=>c.close());
 const result=JSON.parse(c.run(`JSON.stringify((()=>{
  const flare=(time)=>{stats.mercy=true;stats.deadStreak=4;resetRun(81);G.mode='play';G.frameCount=600;G.time=time;G.flare.speed=0;updateFlare();return G.flare.speed;};
  const immediate=flare(10),paused=flare(10000);
  resetRun(81);G.mode='play';G.frameCount=600;G.time=10000;G.dist=900;stats.deadStreak=0;finalizeDeath();const early=stats.deadStreak;
  resetRun(82);G.mode='play';G.frameCount=3600;G.time=0;G.dist=900;stats.deadStreak=2;finalizeDeath();
  return {immediate,paused,early,late:stats.deadStreak};
 })())`));
 assert.equal(result.immediate,result.paused);assert.equal(result.early,1);assert.equal(result.late,0);
});
test('Pause copy distinguishes solo freeze from a local shared-session menu',t=>{
 const c=client(relay());t.after(()=>c.close());
 const result=JSON.parse(c.run(`JSON.stringify((()=>{
  startRun();G.mode='pause';showOverlay('ovPause');const solo=[$('pauseTitle').textContent,$('pauseSessionNote').hidden];
  const inRun=netInRun,shared=sharedRunnerActive;netInRun=()=>true;sharedRunnerActive=()=>false;
  showOverlay('ovPause');const menu=[$('pauseTitle').textContent,$('pauseSessionNote').hidden,$('pauseSessionNote').textContent];
  netInRun=inRun;sharedRunnerActive=shared;return {solo,menu};
 })())`));
 assert.deepEqual(result.solo,['Paused',true]);assert.deepEqual(result.menu,['Menu',false,'The session continues while this menu is open.']);
});
