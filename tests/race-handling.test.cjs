const test = require('node:test');
const assert = require('node:assert/strict');
const Race = require('../src/race.js');
const Online = require('../src/race-online.js');
function playing(trackId, count = 1) {
  const s = Race.create({trackId,count});
  while (s.phase === 'countdown') Race.step(s);
  return s;
}
function drive(s, input) {
  Race.step(s,Object.fromEntries(s.actors.map(a=>[a.id,a.controller==='cpu'?Race.cpuInput(s,a):input])));
}
function sane(s) {
  for (const a of s.actors) {
    for(const k of ['x','y','vx','vy','heading','speed','progress']) assert.ok(Number.isFinite(a[k]),k);
    assert.ok(Math.abs(a.speed-Math.hypot(a.vx,a.vy))<1e-9);
    assert.equal(a.nextGate,(a.passed+1)%20);
    assert.equal(a.lap,Math.floor(a.passed/20)+1);
    assert.ok(a.progress>=a.passed && a.progress<a.passed+1);
  }
}
for(const track of Race.tracks) {
  for(const steer of [-1,0,1]) test(`${track.id}: holding steering ${steer} and boost never leaves the road`,()=>{
    const s=playing(track.id), a=s.actors[0], c=Race.course(track.id);
    for(let i=0;i<3600;i++) {
      const old={...a}; drive(s,{steer,throttle:1,boost:true}); sane(s);
      assert.ok(Race.nearest(c,a.x,a.y).distance<=c.width/2-Race.constants.KART_RADIUS+1e-6);
      assert.ok(a.passed===old.passed || a.passed===old.passed+1);
      if(a.recoveries===old.recoveries) assert.ok(Math.hypot(a.x-old.x,a.y-old.y)<=9.1,'rail correction must not cause a large jump');
      else assert.equal(a.passed,old.passed,'rescue cannot grant checkpoints');
    }
  });
  test(`${track.id}: reverse driving, drift loops and repeated contacts stay bounded`,()=>{
    const s=playing(track.id,5), a=s.actors[0], c=Race.course(track.id);
    a.heading=Math.atan2(-Math.sin(a.heading),-Math.cos(a.heading));
    for(let i=0;i<3600;i++) {
      drive(s,{throttle:1,steer:Math.sin(i/34),brake:i%180<50,boost:i%71<30}); sane(s);
      for(const p of s.actors) assert.ok(Race.nearest(c,p.x,p.y).distance<=c.width/2-Race.constants.KART_RADIUS+1e-6);
    }
  });
}
test('a stranded offcourse pilot is rescued within two seconds with no ordered gate or lap credit',()=>{
  const s=playing('starlight'), a=s.actors[0], c=Race.course(s.trackId), p=Race.at(c,c.length*.3);
  Object.assign(a,{x:p.x-p.ty*(c.width/2+70),y:p.y+p.tx*(c.width/2+70),heading:Math.atan2(p.tx,-p.ty),passed:4,nextGate:5,lap:1,progress:4.9});
  let count=0;
  while(!a.recoveries && count++<Race.constants.OFFCOURSE_TICKS) drive(s,{throttle:1,boost:true});
  assert.equal(a.recoveries,1); assert.ok(count<=120); assert.equal(a.passed,4); assert.equal(a.nextGate,5); assert.equal(a.lap,1);
  const target=Race.at(c,c.length*4/20+12);
  assert.equal(a.x,target.x);assert.equal(a.y,target.y);assert.equal(a.speed,0);assert.equal(a.offroadTicks,0);
});
test('rail contact never bounces an outward-facing kart or flips its heading',()=>{
  const s=playing('starlight'), a=s.actors[0], c=Race.course(s.trackId), p=Race.at(c,200), distance=c.width/2-Race.constants.KART_RADIUS;
  const nx=-p.ty,ny=p.tx;
  Object.assign(a,{x:p.x+nx*distance,y:p.y+ny*distance,heading:Math.atan2(ny,nx),vx:0,vy:0,speed:0});
  const heading=a.heading;
  for(let i=0;i<90;i++) {
    drive(s,{throttle:1});
    assert.ok(Math.abs(a.heading-heading)<1e-12);
    assert.ok(a.vx*nx+a.vy*ny>=-0.01,'contact must not bounce');
    assert.ok(a.speed<0.15,'continuous outward throttle stays calmly against the rail');
  }
});
test('30, 60 and 120 Hz presentation schedules replay identical 60 Hz handling',()=>{
  const snapshots=[];
  for(const hz of [30,60,120]) {
    const s=playing('ember',5); let remainder=0;
    for(let frame=0;frame<hz*30;frame++) {
      remainder+=60;
      while(remainder>=hz){const tick=s.raceTick;drive(s,{throttle:1,steer:Math.sin(tick/47),brake:tick%145<20,boost:tick%71<23});remainder-=hz;}
    }
    snapshots.push(Race.snapshot(s));
  }
  assert.deepEqual(snapshots[0],snapshots[1]); assert.deepEqual(snapshots[1],snapshots[2]);
});
test('snapshot replay preserves rescue timers deterministically',()=>{
  const s=playing('bloom',5),a=s.actors[0],c=Race.course(s.trackId),p=Race.at(c,230);
  Object.assign(a,{x:p.x-p.ty*(c.width/2+60),y:p.y+p.tx*(c.width/2+60),heading:Math.atan2(p.tx,-p.ty)});
  for(let i=0;i<30;i++) drive(s,{throttle:1});
  assert.ok(a.offroadTicks>0);
  const restored=Race.snapshot(s);
  for(let i=0;i<130;i++){drive(s,{throttle:1});drive(restored,{throttle:1});assert.deepEqual(s,restored);}

});

// The timer is intentionally not added to the version-1 wire format: guests do
// not simulate. Existing authoritative pose/recovery fields remain validated.
test('authority publishes valid bounded poses throughout hostile steering and rescue',()=>{
  const host=Online.createHost({trackId:'ember'});
  host.syncRoster([{p:1,role:0,identity:'host'}],0); host.start();
  for(let i=0;i<1500;i++){
    const now=host.state.tick*1000/60;
    const packet=Online.encodeInput({epoch:host.epoch,tick:host.state.tick,seq:i+1,recoverEdges:0,command:{throttle:1,boost:true,steer:i%300<150?1:-1}});
    assert.ok(host.receive(1,'host',packet,now)); host.step(now);
    const decoded=Online.decodeSnapshot(host.packet()); assert.ok(decoded);
    for(const a of decoded.state.actors){
      const c=Race.course(decoded.state.trackId);
      assert.ok(Race.nearest(c,a.x,a.y).distance<=c.width/2-Race.constants.KART_RADIUS+0.001);
    }
  }
});

test('valid on-road rail contact crosses the expected bend checkpoint without stranding',()=>{
  const s=playing('starlight'),a=s.actors[0];
  const heading=-0.83720658724;
  Object.assign(a,{x:196.553253859489,y:582.167678533048,heading,vx:Math.cos(heading)*2.6,vy:Math.sin(heading)*2.6,speed:2.6,passed:17,nextGate:18,progress:17.99});
  drive(s,{throttle:1});
  assert.equal(a.passed,18);assert.equal(a.nextGate,19);assert.equal(a.recoveries,0);
});
test('recovery release resolves coincident visible karts without advancing checkpoints',()=>{
  const s=playing('starlight',5), c=Race.course(s.trackId),p=Race.at(c,12);
  for(const a of s.actors) Object.assign(a,{x:p.x,y:p.y,recoveryTicks:1});
  Race.step(s);
  for(let i=0;i<s.actors.length;i++){
    const a=s.actors[i];assert.equal(a.recoveryTicks,0);assert.equal(a.passed,0);
    assert.ok(Race.nearest(c,a.x,a.y).distance<=c.width/2-Race.constants.KART_RADIUS+1e-6);
    for(let j=i+1;j<s.actors.length;j++)assert.ok(Math.hypot(a.x-s.actors[j].x,a.y-s.actors[j].y)>=55.95);
  }
});
for(const track of Race.tracks)test(`${track.id}: full-size start grids and repeated tailgate/side contacts remain separated`,()=>{
  const s=Race.create({trackId:track.id,count:6}),c=Race.course(track.id);
  s.actors.forEach(a=>a.controller='cpu');
  for(let tick=0;tick<2400;tick++){
    Race.step(s,Object.fromEntries(s.actors.map(a=>[a.id,Race.cpuInput(s,a)])));
    for(let i=0;i<s.actors.length;i++){
      const a=s.actors[i];if(a.finishTick!==null || a.recoveryTicks)continue;
      assert.ok(Race.nearest(c,a.x,a.y).distance<=c.width/2-Race.constants.KART_RADIUS+1e-6);
      for(let j=i+1;j<s.actors.length;j++){
        const b=s.actors[j];if(b.finishTick!==null || b.recoveryTicks)continue;
        assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=55.95,`tick${tick} ${a.id}/${b.id}: physical hoverpod overlap`);
      }
    }
  }
});

test('rail projection introduced contacts are resolved before solver early exit',()=>{
  const s=playing('starlight',2), [a,b]=s.actors;
  Object.assign(a,{x:257.28593081224335,y:892.0137897855346,heading:-1.8187498205435788,vx:-0.48368984051242875,vy:-1.9105857197723457,speed:1.9708611453912606});
  Object.assign(b,{x:210.72255928722026,y:859.3473071978294,heading:Math.atan2(Math.sin(-3.833036278926943),Math.cos(-3.833036278926943)),vx:-6.40524167941061,vy:5.302041256491121,speed:8.31497218619478});
  Race.step(s,{[a.id]:{throttle:1},[b.id]:{throttle:1}});
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=55.95);
});

test('six simultaneous recovery releases at Ember switchback preserve the full hull envelope',()=>{
  const s=playing('ember',6),c=Race.course(s.trackId),p=Race.at(c,17*c.length/20+12);
  s.actors.forEach(a=>Object.assign(a,{x:p.x,y:p.y,heading:Math.atan2(p.ty,p.tx),recoveryTicks:1,passed:17,nextGate:18,progress:17}));
  Race.step(s);
  for(let i=0;i<6;i++)for(let j=i+1;j<6;j++)assert.ok(Math.hypot(s.actors[i].x-s.actors[j].x,s.actors[i].y-s.actors[j].y)>=55.95);
  assert.ok(s.actors.every(a=>a.passed===17 && a.nextGate===18));
});
test('simultaneous real rescues choose clear backwards-only recovery slots',()=>{
  const s=playing('ember',6), c=Race.course(s.trackId);
  Race.step(s,Object.fromEntries(s.actors.map(a=>[a.id,{recover:true}])));
  for(let i=0;i<6;i++){
    const a=s.actors[i];assert.equal(a.passed,0);assert.equal(a.nextGate,1);assert.equal(a.recoveries,1);
    assert.ok(Race.nearest(c,a.x,a.y).distance<1e-6);
    for(let j=i+1;j<6;j++)assert.ok(Math.hypot(a.x-s.actors[j].x,a.y-s.actors[j].y)>=56);
  }
});
