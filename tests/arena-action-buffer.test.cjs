'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../src/arena.js'),Online=require('../src/arena-online.js');
function playing(){const s=A.create({seed:7});while(s.phase==='countdown')A.step(s,{});return s;}
function actor(overrides={}){return {...playing().actors[0],...overrides};}
const raw=action=>({[action==='attack'?'attackPressed':'dashPressed']:true});
for(const early of [1,2,3,4,5,6,7,8])test(`Pulse ${early} ticks early ${early<=6?'waits once':'is not banked'}`,()=>{
 const s=playing(),q=A.createActionBuffer(),starts=[];
 for(let n=0;n<65;n++){
  const c=q.sample(n===0||n===26-early?raw('attack'):{},s.actors[0],s.tick);
  A.step(s,{1:c});if(s.events.some(e=>e.actorId===1&&e.type==='attack'))starts.push(n);
 }
 assert.deepEqual(starts,early<=6?[0,26]:[0]);
});
test('Dash waits for the real cooldown, never refreshes its invulnerability or air resource early',()=>{
 const q=A.createActionBuffer(),a=actor({dashCooldown:7,invulnerable:0});
 assert.equal(q.sample(raw('dash'),a,100).dashPressed,false);
 for(let n=1;n<6;n++){a.dashCooldown--;assert.equal(q.sample({},a,100+n).dashPressed,false);}
 a.dashCooldown=1;const c=q.sample({},a,106);assert.equal(c.dashPressed,true);
 assert.equal(q.sample({},a,106).dashPressed,false,'same-tick resampling cannot repeat');
 const s=playing();Object.assign(s.actors[0],a);A.step(s,{1:c});
 assert.equal(s.actors[0].dashCooldown,A.constants.DASH_COOLDOWN);assert.equal(s.actors[0].dashTicks,A.constants.DASH_TICKS);
 assert.equal(s.actors[0].invulnerable,A.constants.DODGE_TICKS);
 const locked=actor({onGround:false,airDashAvailable:false,dashCooldown:1}),q2=A.createActionBuffer();
 assert.equal(q2.sample(raw('dash'),locked,1).dashPressed,false);locked.onGround=true;assert.equal(q2.sample({},locked,2).dashPressed,false,'no dash banked until a future landing');
});
test('existing simultaneous priority and fresh ready actions are preserved',()=>{
 const q=A.createActionBuffer(),s=playing(),both={attackPressed:true,dashPressed:true};
 const c=q.sample(both,s.actors[0],s.tick);assert.equal(c.attackPressed,true);assert.equal(c.dashPressed,true);
 A.step(s,{1:c});assert.equal(s.actors[0].dashTicks,10);assert.equal(s.actors[0].attackTicks,0,'ordinary dash-first rule');
 const a=actor({attackTicks:5});q.reset();assert.equal(q.sample(both,a,1).dashPressed,false);
 a.attackTicks=1;assert.equal(q.sample({},a,5).dashPressed,true);assert.equal(q.sample({},a,6).attackPressed,false,'no second stacked action');
 const b=actor({attackTicks:4,dashCooldown:40}),q2=A.createActionBuffer();q2.sample(both,b,1);b.attackTicks=1;
 assert.equal(q2.sample({},b,4).attackPressed,true,'unavailable dash does not suppress eligible Pulse');
});
test('latest fresh intent wins; axes and jump contract are untouched',()=>{
 const q=A.createActionBuffer(),a=actor({attackTicks:6});q.sample(raw('attack'),a,1);a.attackTicks=4;q.sample(raw('dash'),a,3);a.attackTicks=1;
 const c=q.sample({moveX:-.6,moveY:.8,jumpPressed:true,jumpHeld:true},a,6);
 assert.equal(c.dashPressed,true);assert.equal(c.attackPressed,false);assert.equal(c.moveX,-.6);assert.equal(c.moveY,.8);assert.equal(c.jumpPressed,true);assert.equal(c.jumpHeld,true);
 assert.equal(q.sample({},a,7).dashPressed,false);
});
for(const interruption of ['reset','disabled','hit','death','respawn','actor','peer','epoch','backwards','expiry','resource'])test(`pending intent clears on ${interruption}`,()=>{
 const q=A.createActionBuffer(),a=actor({attackTicks:7});q.sample(raw('dash'),a,100,true,'round1');let tick=102,generation='round1',enabled=true;
 if(interruption==='reset')q.reset();if(interruption==='disabled')enabled=false;if(interruption==='hit')a.stun=1;if(interruption==='death')a.stocks--;if(interruption==='respawn')a.respawnTicks=10;if(interruption==='actor')a.id++;if(interruption==='peer')a.peerP=7;if(interruption==='epoch')generation='round2';if(interruption==='backwards')tick=1;if(interruption==='expiry')tick=107;if(interruption==='resource'){a.onGround=false;a.airDashAvailable=false;}
 q.sample({},a,tick,enabled,generation);a.attackTicks=0;a.stun=0;a.respawnTicks=0;a.onGround=true;
 assert.equal(q.sample({},a,tick+1,true,generation).dashPressed,false);
 assert.equal(q.sample(raw('attack'),a,tick+2,true,generation).attackPressed,true,'a genuinely new tap still works');
});
test('a fresh tap on the final stun tick remains legal, while an old buffered tap is cancelled',()=>{
 const q=A.createActionBuffer(),a=actor({stun:1});assert.equal(q.sample(raw('attack'),a,1).attackPressed,true);
 a.stun=2;assert.equal(q.sample(raw('attack'),a,2).attackPressed,false);
});
test('unchanged authority treats delayed human edges and ready CPU commands by the same cooldown rules',()=>{
 const h=playing(),cpu=A.restore(A.snapshot(h)),q=A.createActionBuffer();let count=0;
 for(let n=0;n<55;n++){
  const human=q.sample(n===0||n===22?raw('attack'):{},h.actors[0],h.tick);
  const exact=n===0||n===26?raw('attack'):{};
  A.step(h,{1:human});A.step(cpu,{1:exact});
  assert.deepEqual(h,cpu,'buffered human equals exact-ready reference command');
  count+=h.events.filter(e=>e.type==='attack').length;
 }assert.equal(count,2);
});
test('guests preserve baseline fresh edges even when the snapshot says the action is locked',()=>{
 const q=A.createActionBuffer();
 for(const a of [actor({attackTicks:8}),actor({stun:9}),actor({onGround:false,airDashAvailable:false})]){
  const c={attackPressed:true,dashPressed:true,moveX:-.5,jumpPressed:true,jumpHeld:true};
  assert.deepEqual(q.sample(c,a,100,true,'room',{authoritative:false,nowMs:1000}),A.normalizeCommand(c));
  a.attackTicks=0;a.stun=0;a.onGround=true;
  assert.equal(q.sample({},a,101,true,'room',{authoritative:false,nowMs:1017}).attackPressed,false,'no guest replay');
 }
});
test('remote baseline cumulative edge survives loss without duplication or speculative buffering',()=>{
 const host=Online.createHost(),client=Online.createClient();host.syncRoster([{p:1,identity:'host',role:0},{p:2,identity:'peer',role:0}],0);host.start(7);
 for(let n=0;n<180;n++)host.step(n*1000/60);client.accept(host.packet(),1);
 const q=A.createActionBuffer(),a=client.current.state.actors[1];a.attackTicks=8;host.state.actors[1].attackTicks=1;
 const fresh=q.sample(raw('attack'),a,100,true,'r',{authoritative:false});const dropped=client.input(fresh,2);
 const packet=client.input(q.sample({},a,100,true,'r',{authoritative:false}),2);
 assert.equal(Online.decodeInput(packet).edges[1],1);
 assert.ok(host.receive(2,'peer',packet,3100));host.step(3100);assert.equal(host.state.events.filter(e=>e.type==='attack'&&e.actorId===2).length,1,'stale snapshot cannot suppress an authority-ready tap');
 assert.equal(host.receive(2,'peer',dropped,3117),false);host.step(3117);
 assert.equal(host.state.events.filter(e=>e.type==='attack'&&e.actorId===2).length,0);
});
test('wall time bounds frozen snapshots; rollback and invalid clocks cancel old intent',()=>{
 for(const clock of [1100.1,NaN,999]){
  const q=A.createActionBuffer(),a=actor({attackTicks:4});q.sample(raw('attack'),a,100,true,'r',{nowMs:1000});
  a.attackTicks=1;assert.equal(q.sample({},a,103,true,'r',{nowMs:clock}).attackPressed,false);
  assert.equal(q.sample({},a,104,true,'r',{nowMs:1120}).attackPressed,false);
 }
 const q=A.createActionBuffer(),a=actor({attackTicks:4});q.sample(raw('attack'),a,100,true,'r',{nowMs:1000});
 for(let n=1;n<=5;n++)assert.equal(q.sample({},a,100,true,'r',{nowMs:1000+n*20}).attackPressed,false);
 a.attackTicks=1;assert.equal(q.sample({},a,103,true,'r',{nowMs:1150}).attackPressed,false);
 const p=A.createActionBuffer(),b=actor({attackTicks:7});p.sample(raw('attack'),b,100,true,'r',{nowMs:1000});b.attackTicks=1;
 assert.equal(p.sample({},b,106,true,'r',{nowMs:1100}).attackPressed,true,'exact100ms/6tick boundary is included');
});
