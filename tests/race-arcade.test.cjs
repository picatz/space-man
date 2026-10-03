const test = require('node:test');
const assert = require('node:assert/strict');
const Race = require('../src/race.js');
function ready(speed=6.4) {
  const s=Race.create({count:1}); s.phase='racing'; s.countdown=0;
  const a=s.actors[0],c=Race.course(s.trackId),p=Race.at(c,800);
  Object.assign(a,{x:p.x,y:p.y,heading:Math.atan2(p.ty,p.tx),vx:p.tx*speed,vy:p.ty*speed,speed});
  return s;
}
function step(s,cmd,n=1) { for(let i=0;i<n;i++)Race.step(s,{[s.actors[0].id]:cmd});return s.actors[0]; }
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
test('short steering corrections become calmer at boost speed and release immediately',()=>{
  const turns=[];
  for(const speed of [4,6.4,9]){
    const s=ready(speed),a=s.actors[0],before=a.heading;
    step(s,{throttle:1,steer:1,boost:speed===9},6);
    turns.push(Math.abs(wrap(a.heading-before)));
    step(s,{throttle:1});assert.equal(a.steering,0);
  }
  assert.ok(turns[0]>turns[1]&&turns[1]>turns[2],turns.join(','));
  assert.ok(turns.every(v=>v<.25),'100 ms corrections stay below 15 degrees');
});
test('brake and steer preserve a controlled slide, then reward the corner exit',()=>{
  const s=ready(),a=s.actors[0],fuel=a.fuel;
  step(s,{throttle:1,brake:true,steer:1},24);
  assert.equal(a.drifting,true);assert.equal(a.driftTicks,24);
  assert.ok(a.speed>4.5&&a.speed<=6.4);
  assert.ok(Math.abs(wrap(a.heading-Math.atan2(a.vy,a.vx)))>.15);
  step(s,{throttle:1,steer:1});
  assert.equal(a.drifting,false);assert.equal(a.driftTicks,0);assert.equal(a.padTicks,30);
  assert.deepEqual(s.events,[{type:'pad',id:a.id}]);assert.equal(a.fuel,fuel);
});
test('brake alone stops and short taps, reversal and expired input cannot mint an exit boost',()=>{
  let s=ready();step(s,{throttle:1,brake:true},60);assert.ok(s.actors[0].speed<1e-9);
  for(const end of [{}, {throttle:1,steer:-1}, {throttle:1,brake:true,steer:0}]){
    s=ready();step(s,{throttle:1,brake:true,steer:1},24);step(s,end);
    assert.equal(s.actors[0].padTicks,0);assert.equal(s.actors[0].driftTicks,0);
  }
  s=ready();step(s,{throttle:1,brake:true,steer:1},8);step(s,{throttle:1});assert.equal(s.actors[0].padTicks,0);
  s=ready();step(s,{throttle:1,brake:true,steer:1},15);step(s,{throttle:1,brake:true,steer:-1});assert.equal(s.actors[0].driftTicks,1);
});
test('recovery clears corner charge and preserves accepted gates',()=>{
  const s=ready(),a=s.actors[0];step(s,{throttle:1,brake:true,steer:1},24);
  const passed=a.passed;step(s,{throttle:1,recover:true});
  assert.equal(a.passed,passed);assert.equal(a.driftTicks,0);assert.equal(a.drifting,false);assert.equal(a.padTicks,0);
});
test('boost strips do not turn the same drift input into full braking',()=>{
  for(const remaining of [0,30,45]){
    const s=ready(),a=s.actors[0];a.padTicks=remaining;
    step(s,{throttle:1,brake:true,steer:1},24);
    assert.equal(a.drifting,true);assert.ok(a.speed>4.5);
    if(remaining>24)assert.equal(a.driftTicks,0,'existing propulsion cannot charge a second reward');
  }
});
test('explicit interruption and authoritative host pause discard charged drift without a reward',()=>{
  const s=ready(),a=s.actors[0];step(s,{throttle:1,brake:true,steer:1},24);
  Race.cancelControl(s,a.id);step(s,{throttle:1});assert.equal(a.padTicks,0);
  const Online=require('../src/race-online.js'),host=Online.createHost();
  host.syncRoster([{p:1,role:0,identity:'test-host'}],0);host.start();
  const h=host.state.actors[0];Object.assign(h,{drifting:true,driftTicks:30,driftDirection:1});
  assert.ok(host.pause(true));assert.equal(h.driftTicks,0);assert.equal(h.drifting,false);
  host.pause(false);
  Object.assign(h,{drifting:true,driftTicks:30,driftDirection:1});
  assert.ok(host.receive(1,'test-host',Online.encodeInput({epoch:host.epoch,seq:1,tick:host.state.tick,recoverEdges:0,command:{}}),1));
  assert.equal(h.driftTicks,0,'release cancels immediately, without waiting for a host step');
});
test('an exit crossing onto runoff cannot receive a newly earned boost',()=>{
  const s=ready(),a=s.actors[0],c=Race.course('starlight'),p=Race.at(c,0);
  Object.assign(a,{x:p.x,y:p.y,heading:Math.atan2(p.ty,p.tx),vx:p.tx*6.4,vy:p.ty*6.4,speed:6.4});
  step(s,{throttle:1,steer:-1,brake:true},30);
  assert.equal(a.offroad,false);assert.ok(a.driftTicks>=24);
  step(s,{throttle:1,steer:-1});assert.equal(a.offroad,true);assert.equal(a.padTicks,0);
});
test('shallow analog steering must earn the same cornering amount as a full digital turn',()=>{
  const s=ready(),a=s.actors[0];step(s,{throttle:1,brake:true,steer:.35},24);
  assert.ok(a.driftTicks<9);step(s,{throttle:1});assert.equal(a.padTicks,0);
});
