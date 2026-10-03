const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../src/race-ui.js'),'utf8'),context);
const receipt=()=>context.window.SpaceManRaceUI.createWarningReceipt();
const read=(r,serials,frame,more={})=>Array.from(r.observe(serials,{frame,visible:true,actorId:'pilot-0',epoch:1,...more}));
test('warning receipts require distinct visible paint frames, not repeated calls or packet arrival',()=>{
 const r=receipt();assert.deepEqual(read(r,[0,5,0,0,0],1),[0,0,0,0,0]);assert.deepEqual(read(r,[0,5,0,0,0],1),[0,0,0,0,0]);assert.deepEqual(read(r,[0,5,0,0,0],2),[0,5,0,0,0]);
 assert.deepEqual(read(r,[0,6,0,0,0],3),[0,5,0,0,0]);assert.deepEqual(read(r,[0,6,0,0,0],4),[0,6,0,0,0]);
});
test('hidden warnings, cancellation, actor changes and epoch changes cannot preserve acknowledgement',()=>{
 const r=receipt();read(r,[0,5],1);read(r,[0,5],2);assert.deepEqual(read(r,[0,5],3,{visible:false}),[0,0,0,0,0]);
 assert.deepEqual(read(r,[0,5],4),[0,0,0,0,0]);assert.deepEqual(read(r,[0,5],5),[0,5,0,0,0]);
 assert.deepEqual(read(r,[0,5],6,{epoch:2}),[0,0,0,0,0]);assert.deepEqual(read(r,[0,5],7,{epoch:2}),[0,5,0,0,0]);
 assert.deepEqual(read(r,[0,5],8,{epoch:2,actorId:'pilot-1'}),[0,0,0,0,0]);r.reset();assert.deepEqual(read(r,[0,5],9),[0,0,0,0,0]);
});
test('invalid serials and stale/repeated frame clocks never acknowledge a new threat',()=>{
 const r=receipt();read(r,[Infinity,-1,65536,'4',2],3);assert.deepEqual(read(r,[Infinity,-1,65536,'4',2],4),[0,0,0,0,2]);
 assert.deepEqual(read(r,[1,2,3,4,5],2),[0,0,0,0,0]);assert.deepEqual(read(r,[1,2,3,4,5],NaN),[0,0,0,0,0]);
});
const Race=require('../src/race.js');
const guide=context.window.SpaceManRaceUI.pulseGuide;
test('pulse source arrows point toward every cardinal and diagonal screen-space bearing',()=>{
 const arrow=context.window.SpaceManRaceUI.sourceBearingArrow;
 for(const [x,y,expected]of[[1,0,'→'],[1,1,'↘'],[0,1,'↓'],[-1,1,'↙'],[-1,0,'←'],[-1,-1,'↖'],[0,-1,'↑'],[1,-1,'↗']])
  assert.equal(arrow(x,y),expected,`source at ${x},${y}`);
 const c=Race.course('starlight'),pilot=Race.at(c,600),source=Race.at(c,500),angle=-Math.atan2(pilot.ty,pilot.tx)-Math.PI/2;
 const dx=source.x-pilot.x,dy=source.y-pilot.y;
 assert.equal(arrow(dx*Math.cos(angle)-dy*Math.sin(angle),dx*Math.sin(angle)+dy*Math.cos(angle)),'↓','a rear source points behind the followed pilot');
});
test('pulse counterplay identifies the locked lane and a comfortably clear escape',()=>{
 const c=Race.course('starlight'),p=Race.at(c,800),actor={x:p.x-p.ty*44,y:p.y+p.tx*44,item:null,shieldTicks:0};
 let g=guide(actor,c,[{d:44}],Race.nearest);assert.equal(g.direction,'left');assert.equal(g.actionable,true);assert.match(g.description,/right lane/);
 g=guide(actor,c,[{d:-44}],Race.nearest);assert.equal(g.direction,'right');assert.equal(g.actionable,true);
 g=guide(actor,c,[{d:0}],Race.nearest);assert.equal(g.direction,'right');assert.ok(g.safe>0);
});
test('crowded pulse lanes require a real shield option before acknowledgement is actionable',()=>{
 const c=Race.course('starlight'),p=Race.at(c,800),actor={x:p.x,y:p.y,item:null,shieldTicks:0};
 const effects=[{d:-44},{d:0},{d:44}];assert.equal(guide(actor,c,effects,Race.nearest).actionable,false);
 assert.equal(guide({...actor,item:'shield'},c,effects,Race.nearest).actionable,true);
 assert.equal(guide({...actor,shieldTicks:20},c,effects,Race.nearest).actionable,false);
 assert.equal(guide({...actor,shieldTicks:84},c,effects,Race.nearest).actionable,false);
 assert.equal(guide({...actor,shieldTicks:85},c,effects,Race.nearest).actionable,true);
 assert.equal(guide({...actor,shieldTicks:90},c,effects,Race.nearest).actionable,true);
});
test('an expiring active Shield cannot acknowledge blocked lanes through a full charge and later receive damage',()=>{
 const state=Race.create({count:4});while(state.phase==='countdown')Race.step(state);
 const c=Race.course('starlight'),positions=[0,80,140,300],victim=state.actors[3],r=receipt();
 for(const [i,a]of state.actors.entries()){
  const s=positions[i],p=Race.at(c,s),passed=Math.floor(s/c.length*20);
  Object.assign(a,{x:p.x,y:p.y,heading:Math.atan2(p.ty,p.tx),vx:0,vy:0,speed:0,
   passed,nextGate:(passed+1)%20,lap:1,progress:s/c.length*20,controller:'human'});
 }
 victim.shieldTicks=50;
 state.effects=state.actors.slice(0,3).map((owner,i)=>{
  owner.pulseSerial=1;
  return{ownerId:owner.id,serial:1,phase:'charge',age:0,s:positions[i],originS:positions[i],
   d:[-44,0,44][i],observedAt:Array(4).fill(-1),_createdTick:state.raceTick};
 });
 let sawWave=false,sawExpiredShield=false;
 for(let frame=0;frame<90;frame++){
  const effects=Race.warningFor(state,victim),g=guide(victim,c,effects,Race.nearest),serials=Array(5).fill(0);
  for(const effect of effects)serials[Number(effect.ownerId.slice(6))]=effect.serial;
  const observed=read(r,serials,frame,{actorId:victim.id,visible:effects.length>0&&g.actionable});
  if(g.safe===null)assert.ok(observed.every(n=>n===0),'a Shield that expires before the waves is not actionable counterplay');
  Race.step(state,{[victim.id]:{warnings:observed}});
  sawWave ||= state.effects.some(effect=>effect.phase==='wave');
  sawExpiredShield ||= victim.shieldTicks===0;
  assert.equal(victim.slowTicks,0,'withheld receipts prevent a later unshielded hit');
  assert.ok(!state.events.some(event=>event.id===victim.id&&event.type==='hit'));
 }
 assert.ok(sawWave&&sawExpiredShield);assert.equal(state.effects.length,0);
});
