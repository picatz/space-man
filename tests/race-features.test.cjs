const test = require('node:test');
const assert = require('node:assert/strict');
const Race = require('../src/race.js');
const C = Race.course('starlight'), F = Race.features(C);
function playing(count=1, options={}) {
  const state=Race.create({count,...options});
  while(state.phase==='countdown') Race.step(state);
  return state;
}
function place(a,s,d=0,speed=0) {
  const p=Race.at(C,s), passed=Math.floor(s/C.length*20);
  Object.assign(a,{x:p.x-p.ty*d,y:p.y+p.tx*d,heading:Math.atan2(p.ty,p.tx),
    vx:p.tx*speed||0,vy:p.ty*speed||0,speed,passed,nextGate:(passed+1)%20,
    lap:Math.floor(passed/20)+1,progress:s/C.length*20,steering:0});
}
function tick(s,raw={},other={}) { return Race.step(s,{[s.actors[0].id]:raw,...other}); }
function allCpu(s) { return Object.fromEntries(s.actors.map(a=>[a.id,Race.cpuInput(s,a)])); }
function assertSane(s) {
  for(const a of s.actors) {
    for(const k of ['x','y','heading','speed','z']) assert.ok(Number.isFinite(a[k]),k);
    assert.ok(Math.abs(a.speed-Math.hypot(a.vx,a.vy))<1e-9);
    assert.ok(a.fuel>=0&&a.fuel<=100);
    assert.ok(a.z>=0&&a.z<=30);
    if(!a.airRamp) assert.equal(a.z+a.airTicks,0);
    else assert.ok(a.airTicks>=0&&a.airTicks<30);
  }
  assert.ok(s.effects.length<=5);
}
function wave({observed=0,shield=false,air=false,d=0,victimS=195}={}) {
  const s=playing(2),[a,b]=s.actors; a.controller='cpu'; b.controller='human';
  place(a,100,0); place(b,victimS,d); s.raceTick=100;
  a.pulseSerial=1;
  s.effects=[{ownerId:a.id,serial:1,phase:'wave',age:0,s:156,originS:156,d:0,
    observedAt:[-1,observed],_createdTick:1}];
  if(shield)b.shieldTicks=200;
  if(air){b.airRamp=1;b.airTicks=10;b.z=26;}
  return s;
}
test('single frozen authored catalog has exact anchors, lanes, identities and empty unchanged tracks',()=>{
  assert.equal(F,Race.features('starlight'));assert.equal(F.revision,2);
  assert.equal(F.ramps.length,2);assert.equal(F.coins.length,10);assert.equal(F.rows.length,2);
  assert.equal(new Set([...F.ramps,...F.coins,...F.rows].map(o=>o.id)).size,14);
  assert.deepEqual(F.ramps.map(r=>r.s),[.175*C.length,.595*C.length]);
  assert.deepEqual(F.ramps.map(r=>r.gate),[3,11]);
  assert.ok(F.ramps.every(r=>r.s-r.startS===60&&r.width===180));
  assert.deepEqual(F.coins.slice(0,4).map(o=>o.s),[.055,.075,.095,.115].map(f=>f*C.length));
  assert.deepEqual(F.coins.slice(4).map(o=>o.d),[-44,-44,-44,44,44,44]);
  assert.deepEqual(F.rows.map(r=>r.s),[.275*C.length,.705*C.length]);
  assert.deepEqual(F.rows.map(r=>r.gate),[5,14]);
  assert.ok(Object.isFrozen(F.rows[0].choices[0]));
  for(const id of ['ember','bloom'])assert.deepEqual(Race.features(id),{revision:2,trackId:id,ramps:[],coins:[],rows:[]});
});
for(const ramp of F.ramps)for(const lane of [-44,0,44])for(const speed of [3.6,6.4,9])
  test(`${ramp.id} d=${lane} speed=${speed}: one 30-tick finite hop retains real planar motion`,()=>{
    const s=playing(),a=s.actors[0];place(a,ramp.s-1,lane,speed);
    tick(s,{throttle:1,boost:speed===9});assert.equal(a.airRamp,ramp.index+1);assert.equal(a.airTicks,0);assert.equal(a.z,10);
    const takeoff={x:a.x,y:a.y},beforePassed=a.passed;
    for(let t=1;t<=30;t++){
      tick(s,{throttle:1,boost:speed===9});assertSane(s);
      assert.equal(a.airRamp,t<30?ramp.index+1:0);assert.equal(a.airTicks,t<30?t:0);
      assert.ok(Race.nearest(C,a.x,a.y).distance<C.width/2+Race.constants.RUNOFF);
    }
    assert.ok(Math.hypot(a.x-takeoff.x,a.y-takeoff.y)>100);
    assert.ok(a.passed>=beforePassed&&a.passed<=beforePassed+2);
    place(a,ramp.s-1,lane,9);tick(s,{throttle:1,boost:true});assert.equal(a.airRamp,0,'loop cannot relaunch');
  });
test('slow, reverse, wrong-gate, recovering, offroad and finished ramp entries never launch',()=>{
  for(const mode of ['slow','reverse','wrong-gate','recovering','offroad','finished']){
    const s=playing(),a=s.actors[0],r=F.ramps[0];place(a,r.s-1,mode==='offroad'?110:0,mode==='slow'?2:6);
    if(mode==='reverse'){place(a,r.s+1,0,6);a.heading+=Math.PI;a.vx*=-1;a.vy*=-1;}
    if(mode==='wrong-gate'){a.passed=2;a.nextGate=3;}
    if(mode==='recovering')a.recoveryTicks=20;
    if(mode==='finished')a.finishTick=1;
    tick(s,{throttle:1});assert.equal(a.airRamp,0,mode);
  }
});
test('takeoff discards drift without awarding a boost; airborne brake/steer cannot charge drift',()=>{
  const s=playing(),a=s.actors[0];place(a,F.ramps[0].s-1,0,6);
  Object.assign(a,{drifting:true,driftTicks:40,driftDirection:1});
  tick(s,{throttle:1});assert.equal(a.airRamp,1);assert.equal(a.padTicks,0);assert.equal(a.driftTicks,0);
  for(let i=0;i<15;i++){tick(s,{throttle:1,brake:true,steer:.5});assert.equal(a.driftTicks,0);assert.equal(a.drifting,false);}
});
test('air keeps planar contacts and steering/brake/boost speed semantics',()=>{
  const s=playing(2),[a,b]=s.actors;place(a,F.ramps[0].s-1,0,9);place(b,F.ramps[0].s+85,0,0);
  tick(s,{throttle:1,boost:true});assert.equal(a.airRamp,1);
  for(let i=0;i<20;i++){tick(s,{throttle:1,boost:true,steer:i>12?.15:0});assertSane(s);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=56-.002);}
  assert.ok(b.speed>0,'hop kart transfers ordinary contact momentum');
});
test('rescue at takeoff/apex/landing keeps held item/masks but clears hop, shield and owned pulse',()=>{
  for(const phase of [0,15,29]){
    const s=playing(),a=s.actors[0];place(a,F.ramps[0].s-1,0,6);tick(s,{throttle:1});
    for(let i=0;i<phase;i++)tick(s,{throttle:1});
    a.item='shield';a.coinMask=7;a.shieldTicks=50;a.slowTicks=20;
    const passed=a.passed;tick(s,{recover:true});
    assert.equal(a.airRamp+a.z+a.airTicks+a.shieldTicks+a.slowTicks,0);assert.equal(a.item,'shield');
    assert.equal(a.coinMask,7);assert.equal(a.rampMask,1);assert.equal(a.passed,passed);assert.equal(a.immunityTicks,90);
    assert.equal(a.recoveryTicks,89);
  }
});
test('cancel/release preserves host airtime; no stepping freezes it at every phase',()=>{
  for(const phase of [0,15,29]){
    const s=playing(),a=s.actors[0];place(a,F.ramps[0].s-1,0,6);tick(s,{throttle:1});
    for(let i=0;i<phase;i++)tick(s,{throttle:1});
    const frozen=Race.snapshot(s);Race.cancelControl(s);assert.equal(a.airTicks,frozen.actors[0].airTicks);assert.equal(a.z,frozen.actors[0].z);
    for(let i=phase;i<30;i++)tick(s);assert.equal(a.airRamp+a.airTicks+a.z,0);
  }
});
for(const coin of F.coins)test(`${coin.id} max-speed sweep is optional, capped and personal`,()=>{
  for(const lane of [0,coin.d]){
    const s=playing(2),[a,b]=s.actors;place(a,coin.s-6,lane,9);place(b,coin.s+300,0,0);a.fuel=50;
    if(coin.airborne){a.airRamp=coin.index<7?1:2;a.airTicks=10;a.z=26;}
    tick(s,{throttle:1,boost:true});assert.equal(!!(a.coinMask&(1<<coin.index)),lane===coin.d);assert.equal(b.coinMask,0);
    if(lane===coin.d){assert.ok(Math.abs(a.fuel-55.28)<1e-8);const fuel=a.fuel;place(a,coin.s-6,lane,9);tick(s,{boost:true});assert.ok(a.fuel<fuel);}
  }
  const s=playing(),a=s.actors[0];place(a,coin.s-6,coin.d,9);if(coin.airborne){a.airRamp=1;a.airTicks=4;a.z=20;}
  tick(s,{throttle:1});assert.equal(a.fuel,100);assert.ok(a.coinMask&(1<<coin.index));
});
test('ground kart cannot collect a sky star and masks reset only at a legitimate lap',()=>{
  const s=playing(),a=s.actors[0];place(a,F.coins[4].s-6,-44,9);tick(s,{throttle:1});assert.equal(a.coinMask,0);
  a.coinMask=1023;a.rowMask=3;a.rampMask=3;a.item='pulse';
  place(a,C.length-1,0,6);tick(s,{throttle:1});assert.equal(a.passed,20);assert.equal(a.lap,2);
  assert.equal(a.coinMask+a.rowMask+a.rampMask,0);assert.equal(a.item,'pulse');
});
for(const row of F.rows)for(const lane of [-44,0,44])test(`${row.id} choice d=${lane} visits once with no replacement`,()=>{
  const s=playing(),a=s.actors[0];place(a,row.s-1,lane,9);tick(s,{throttle:1});
  assert.equal(a.rowMask,1<<row.index);assert.equal(a.item,lane===0?null:lane<0?'shield':'pulse');
  a.item=null;place(a,row.s-1,-44,9);tick(s,{throttle:1});assert.equal(a.item,null);
  const other=playing(),b=other.actors[0];place(b,row.s-1,44,9);b.item='shield';tick(other,{throttle:1});assert.equal(b.item,'shield');assert.equal(b.rowMask,1<<row.index);
});
test('Item presses before/through pickup never auto-fire; fresh local or monotonic network edges do',()=>{
  const s=playing(),a=s.actors[0],row=F.rows[0];place(a,row.s-1,-44,9);
  tick(s,{throttle:1,item:true});assert.equal(a.item,'shield');assert.equal(a.shieldTicks,0);
  for(let i=0;i<4;i++)tick(s,{item:true});assert.equal(a.item,'shield');
  tick(s,{item:false});tick(s,{item:true});assert.equal(a.item,null);assert.equal(a.shieldTicks,240);
  a.item='shield';tick(s,{item:true});assert.equal(a.item,'shield');
  tick(s,{item:true,itemEdge:2});assert.equal(a.item,null);assert.equal(a.shieldTicks,240);
  a.item='shield';tick(s,{item:true,itemEdge:2});assert.equal(a.item,'shield');
  tick(s,{item:true,itemEdge:3});assert.equal(a.item,null);
});
test('cancel suppresses held Item, preserves consumed counters unless explicitly reset, and resets warning eligibility',()=>{
  const s=wave({observed:5}),a=s.actors[1];a.item='shield';a._lastItemEdge=9;
  Race.cancelControl(s,a.id,{keepWarnings:true});assert.equal(s.effects[0].observedAt[1],5);
  Race.cancelControl(s,a.id);assert.equal(s.effects[0].observedAt[1],-1);assert.equal(a._lastItemEdge,9);
  Race.step(s,{[a.id]:{item:true}});assert.equal(a.item,'shield');
  Race.cancelControl(s,a.id,{resetEdges:true});assert.equal(a._lastItemEdge,0);
});
test('airborne Pulse keeps inventory without queuing; owner cap and saturated serial fail safely',()=>{
  const s=playing(),a=s.actors[0];place(a,F.ramps[0].s-1,0,6);tick(s,{throttle:1});a.item='pulse';tick(s,{item:true});
  assert.equal(a.item,'pulse');assert.equal(s.effects.length,0);assert.ok(s.events.some(e=>e.type==='land-pulse'));
  while(a.airRamp)tick(s,{item:true});assert.equal(s.effects.length,0);
  tick(s);tick(s,{item:true});assert.equal(s.effects.length,1);assert.equal(a.item,null);assert.equal(s.effects[0].age,0);
  a.item='pulse';tick(s,{itemEdge:1});assert.equal(s.effects.length,1);assert.equal(a.item,'pulse');
  Race.clearFeatures(s);a.item='pulse';a.pulseSerial=65535;tick(s,{itemEdge:2});assert.equal(s.effects.length,0);assert.equal(a.item,'pulse');
});
test('shield lasts exactly 240 ticks and changes no movement by itself',()=>{
  const s=playing(),copy=Race.snapshot(s),a=s.actors[0];a.item='shield';tick(s,{item:true,throttle:1});tick(copy,{throttle:1});
  for(let i=1;i<240;i++){tick(s,{throttle:1});tick(copy,{throttle:1});assert.ok(a.shieldTicks>0);}
  assert.equal(a.x,copy.actors[0].x);assert.equal(a.y,copy.actors[0].y);tick(s);assert.equal(a.shieldTicks,0);
});
test('pulse charges54 ticks then travels336 units in28 ticks with locked lane and single owner effect',()=>{
  const s=playing(),a=s.actors[0];place(a,100,72,0);a.item='pulse';tick(s,{item:true});const e=s.effects[0];assert.equal(e.d,44);
  for(let i=1;i<54;i++){tick(s);assert.equal(e.phase,'charge');assert.equal(e.age,i);}
  tick(s);assert.equal(e.phase,'wave');assert.equal(e.age,0);const start=e.s;
  for(let i=1;i<28;i++){tick(s);assert.equal(e.s,start+12*i);assert.equal(e.d,44);}
  tick(s);assert.equal(s.effects.length,0);assert.equal(e.s,start+336);
});
test('matching displayed-warning observation plus36 host ticks is the earliest possible damage',()=>{
  const s=wave({observed:66}),b=s.actors[1];
  tick(s);assert.equal(b.slowTicks,0);assert.equal(s.effects.length,1,'35 ticks is harmless');
  tick(s);assert.equal(b.slowTicks,24);assert.equal(b.immunityTicks,90);assert.equal(s.effects.length,0);
});
test('missing, late, wrong-owner and wrong-serial acknowledgements never authorize damage or retrospective hits',()=>{
  for(const ack of [null,[0,1,0,0,0],[2,0,0,0,0]]){
    const s=wave({observed:-1}),b=s.actors[1];if(ack)Race.observeWarnings(s,b.id,ack);
    for(let i=0;i<28;i++)tick(s);assert.equal(b.slowTicks,0);assert.equal(s.effects.length,0);
  }
  const s=wave({observed:-1}),b=s.actors[1];Race.observeWarnings(s,b.id,[1,0,0,0,0]);
  assert.equal(s.effects[0].observedAt[1],100);
  for(let i=0;i<28;i++)tick(s);assert.equal(b.slowTicks,0);
});
test('pulse shield block consumes shield/wave once and gives90 ticks of hit immunity',()=>{
  const s=wave({shield:true}),b=s.actors[1];tick(s);assert.equal(b.shieldTicks,0);assert.equal(b.slowTicks,0);assert.equal(b.immunityTicks,90);assert.equal(s.effects.length,0);assert.ok(s.events.some(e=>e.type==='block'));
});
test('pulse leaves heading/position/steering controllable, removes20% speed once and prevents boost/pad propulsion',()=>{
  const s=wave({victimS:190}),b=s.actors[1];place(b,190,0,3);const copy=Race.snapshot(s);copy.effects=[];
  Race.step(s,{[b.id]:{throttle:1,boost:true}});Race.step(copy,{[b.id]:{throttle:1,boost:true}});
  assert.ok(Math.abs(b.speed-copy.actors[1].speed*.8)<1e-9);assert.equal(b.x,copy.actors[1].x);assert.equal(b.heading,copy.actors[1].heading);
  assert.equal(b.slowTicks,24);assert.equal(b.boosting,false);
  b.padTicks=30;const fuel=b.fuel;Race.step(s,{[b.id]:{throttle:1,boost:true,steer:.2}});assert.equal(b.boosting,false);assert.ok(b.fuel>=fuel);assert.notEqual(b.heading,copy.actors[1].heading);
});
for(const mode of ['air','recover','finished','dnf','immune','left','right','behind','other-lap'])test(`pulse cannot hit ${mode} pilot`,()=>{
  const s=wave({air:mode==='air',d:mode==='left'?-52:mode==='right'?52:0}),b=s.actors[1];
  if(mode==='recover')b.recoveryTicks=3;if(mode==='finished')b.finishTick=1;if(mode==='dnf')b.dnf=true;if(mode==='immune')b.immunityTicks=80;
  if(mode==='behind')place(b,120,0,0);if(mode==='other-lap'){b.passed+=20;b.lap++;b.progress+=20;b.nextGate=(b.passed+1)%20;}
  for(let i=0;i<2;i++)tick(s);assert.equal(b.slowTicks,0,mode);
});
test('wave consumes only first eligible contact with stable actor-ID tie break',()=>{
  const s=playing(3);s.raceTick=100;const[a,b,c]=s.actors;place(a,100,0);place(b,195,-29);place(c,195,29);a.pulseSerial=1;
  s.effects=[{ownerId:a.id,serial:1,phase:'wave',age:0,s:156,originS:156,d:0,observedAt:[-1,0,0]}];tick(s);
  assert.equal(b.slowTicks,24);assert.equal(c.slowTicks,0);assert.equal(s.effects.length,0);
});
test('warning helper is pure, public-state-based, forward-unwrapped and available independent of lane or camera',()=>{
  const s=wave({d:52}),b=s.actors[1],before=Race.snapshot(s);assert.equal(Race.warningFor(s,b).length,1);assert.deepEqual(s,before);
  place(b,100,0);assert.equal(Race.warningFor(s,b.id).length,0);
  b.passed+=20;b.progress+=20;b.lap++;assert.equal(Race.warningFor(s,b.id).length,0);
});
test('commands strictly normalize added edges/acks without aliasing or truthy actions',()=>{
  const raw={item:'true',itemEdge:NaN,warnings:[1,65535,-1,1.5,70000]},c=Race.command(raw);
  assert.equal(c.item,false);assert.equal(c.itemEdge,0);assert.deepEqual(c.warnings,[1,65535,0,0,0]);
  c.warnings[0]=99;assert.equal(raw.warnings[0],1);assert.equal(Race.command({item:1,itemEdge:65535}).item,true);
});
for(const difficulty of ['easy','normal','hard'])test(`${difficulty} CPUs finish, collect/use both mechanics and demonstrate counterplay deterministically`,()=>{
  const s=Race.create({difficulty,laps:3});s.actors.forEach(a=>a.controller='cpu');const counts={};
  while(s.phase!=='finished'){Race.step(s,allCpu(s));for(const e of s.events)counts[e.type]=(counts[e.type]||0)+1;assertSane(s);}
  assert.ok(s.results.every(r=>r.finished));assert.ok(s.actors.every(a=>!a.recoveries));
  for(const type of ['jump','coin','item','shield','pulse'])assert.ok(counts[type]>0,`${difficulty} ${type}: ${JSON.stringify(counts)}`);
  // Deliberate fixed scenario proves the controller sees a warning, chooses a
  // legal safe lane and can actively block, independent of spontaneous races.
  const threat=wave({shield:true}),a=threat.actors[1];threat.difficulty=difficulty;a.item='shield';a.shieldTicks=0;
  const before=Race.snapshot(threat),command=Race.cpuInput(threat,a);assert.equal(command.item,true);assert.equal(command.warnings[0],1);assert.notEqual(command.steer,0);assert.deepEqual(threat,before);
  Race.step(threat,{[a.id]:command});assert.ok(threat.events.some(e=>e.type==='block'));assert.equal(a.slowTicks,0);
});
test('full snapshots replay active hops, inventory, observations and waves deterministically',()=>{
  const s=playing(5);s.actors.forEach(a=>a.controller='cpu');for(let i=0;i<300;i++)Race.step(s,allCpu(s));const copy=Race.snapshot(s);
  for(let i=0;i<600;i++){const cmd=allCpu(s);Race.step(s,cmd);Race.step(copy,cmd);assert.deepEqual(s,copy);}
});
for(const difficulty of ['easy','normal','hard'])test(`${difficulty} CPU visibly steers out of an acknowledged center-lane wave without a shield`,()=>{
  const s=playing(2,{difficulty}),[owner,victim]=s.actors;place(owner,100,0,4.5);place(victim,190,0,4.5);owner.item='pulse';let dodged=false;
  for(let t=0;t<90;t++){
    const cmd=Race.cpuInput(s,victim);
    Race.step(s,{[owner.id]:{throttle:1,item:t===0},[victim.id]:cmd});
    const n=Race.nearest(C,victim.x,victim.y),d=-(victim.x-n.x)*n.ty+(victim.y-n.y)*n.tx;
    if(s.effects.some(e=>e.phase==='wave')&&Math.abs(d)>38)dodged=true;
    assert.equal(victim.slowTicks,0);assert.ok(n.distance<C.width/2);
  }
  assert.equal(dodged,true,'evade is physical displacement while the wave exists');
});
test('slow timer suppresses all24 subsequent propulsion steps and then permits boost',()=>{
  const s=playing(),a=s.actors[0];place(a,100,0,2);a.slowTicks=24;a.padTicks=45;
  for(let i=0;i<24;i++){tick(s,{throttle:1,boost:true});assert.equal(a.boosting,false);assert.equal(a.slowTicks,23-i);}
  tick(s,{throttle:1,boost:true});assert.equal(a.boosting,true);
});
test('recovery release grants a fresh90-tick safety window without changing the stationary wait',()=>{
  const s=playing(),a=s.actors[0];tick(s,{recover:true});const position={x:a.x,y:a.y};
  for(let i=0;i<89;i++){tick(s,{throttle:1});assert.equal(a.x,position.x);assert.equal(a.y,position.y);}
  assert.equal(a.recoveryTicks,0);assert.equal(a.immunityTicks,90);tick(s,{throttle:1});assert.equal(a.immunityTicks,89);
});
test('finite serial and per-lap state cannot create more than five simultaneous owner effects',()=>{
  const s=playing(5);for(let i=0;i<5;i++){place(s.actors[i],100+i*200,44);s.actors[i].item='pulse';}
  Race.step(s,Object.fromEntries(s.actors.map(a=>[a.id,{item:true}])));assert.equal(s.effects.length,5);
  assert.equal(new Set(s.effects.map(e=>e.ownerId)).size,5);
  for(const a of s.actors)a.item='pulse';Race.step(s,Object.fromEntries(s.actors.map(a=>[a.id,{itemEdge:1}])));assert.equal(s.effects.length,5);assert.ok(s.actors.every(a=>a.item==='pulse'));
});
test('finish clears inventory/effects/transients; race creation clears every lap mask and serial',()=>{
  const s=wave({shield:true}),a=s.actors[0];a.item='pulse';a.coinMask=123;a.rowMask=3;a.rampMask=3;a.airRamp=1;a.airTicks=10;a.z=28;
  s.raceTick=60*300;Race.checkFinish(s);assert.equal(s.phase,'finished');assert.equal(s.effects.length,0);
  for(const a of s.actors)assert.equal(a.item,null);
  assert.equal(a.airRamp+a.airTicks+a.z+a.shieldTicks+a.slowTicks+a.immunityTicks,0);
  for(const a of Race.create().actors)assert.equal(a.coinMask+a.rowMask+a.rampMask+a.pulseSerial,0);
});
test('unchanged tracks retain completely empty mechanics even during rescue and release',()=>{
  for(const trackId of ['ember','bloom']){
    const s=playing(1,{trackId}),a=s.actors[0];tick(s,{recover:true});
    for(let i=0;i<100;i++){
      tick(s,{throttle:1,item:true});assert.equal(a.item,null);assert.equal(s.effects.length,0);
      assert.equal(a.coinMask+a.rowMask+a.rampMask+a.airRamp+a.airTicks+a.z+a.shieldTicks+a.slowTicks+a.immunityTicks+a.pulseSerial,0);
    }
  }
});
test('simultaneous Rescue and Item preserves inventory and consumes the edge rather than queuing a shot',()=>{
  for(const item of ['shield','pulse']){
    const s=playing(),a=s.actors[0];a.item=item;tick(s,{recover:true,item:true,itemEdge:12});
    assert.equal(a.item,item);assert.equal(a.shieldTicks,0);assert.equal(s.effects.length,0);assert.equal(a._lastItemEdge,12);
    for(let i=0;i<90;i++)tick(s,{item:true,itemEdge:12});
    assert.equal(a.item,item);assert.equal(s.effects.length,0);assert.equal(a.shieldTicks,0);
    tick(s,{itemEdge:13});assert.equal(a.item,null);
  }
});
