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


test('native Item taps survive one neutral step, coalesce and never repeat while held',()=>{
 const q=context.window.SpaceManRaceUI.createItemRequest();q.request();q.request();
 assert.equal(q.sample(true),false);assert.equal(q.sample(false),true);
 assert.equal(q.sample(false),false);assert.equal(q.sample(true),true);
 q.request();assert.equal(q.sample(true,false),false);assert.equal(q.sample(true,false),false);
 assert.equal(q.sample(true,true),false);assert.equal(q.sample(false,true),true);
 q.request();q.reset();assert.equal(q.sample(false),false);
});
test('a fresh queued press works immediately after cancellation without replaying held input',()=>{
 const state=Race.create({count:1});while(state.phase==='countdown')Race.step(state);
 const actor=state.actors[0];actor.item='shield';Race.cancelControl(state,actor.id);
 const q=context.window.SpaceManRaceUI.createItemRequest();q.request();
 Race.step(state,{[actor.id]:{throttle:1,item:q.sample(false)}});assert.equal(actor.item,'shield');
 Race.step(state,{[actor.id]:{throttle:1,item:q.sample(false)}});assert.equal(actor.item,null);assert.equal(actor.shieldTicks,240);
 actor.item='pulse';Race.step(state,{[actor.id]:{throttle:1,item:q.sample(true)}});assert.equal(actor.item,'pulse');
});

// Exercise the actual UI lifecycle callbacks without rendering a browser. Only
// their DOM/audio/scheduling dependencies are stubbed; queue/reset code is real.
function inputLifecycle(onRelease=()=>{}) {
 const source=fs.readFileSync(require.resolve('../src/race-ui.js'),'utf8');
 const q=context.window.SpaceManRaceUI.createItemRequest(),node=()=>({}),status={active:true,host:false,connection:'',stale:false,info:{role:0,myP:2},roster:[],current:{status:'running'}};
 let releases=0;
 const ui=vm.createContext({active:true,roomClosing:false,roomStatus:status,rootEl:{dataset:{}},
  roomEntry:node(),roomBox:node(),roomLeave:node(),roomHint:node(),roomInvite:{value:''},roomCopy:node(),roomShare:node(),roomCode:node(),roomRole:node(),roomMembers:node(),roomSignature:'[]',
  keys:new Map(),touches:new Map(),itemRequest:q,warningReceipt:receipt(),onlineActive:()=>true,
  room:{release(){releases++;onRelease();}},setText(){},setDisabled(){},syncRoomChoices(){},ensureFrame(){},setPanel(){},announce(){},
  selected:{trackId:'starlight',difficulty:'normal'},networkEpoch:1,roomPaused:false,paused:false,localRoomMenu:false,view:'play',document:{hidden:false},audio:null,followActor:()=>null});
 for(const [name,next]of[['cancelCorner','resetTouch'],['resetTouch','resetInput'],['resetInput','ownsInput'],['roomChanged','networkSnapshot'],['networkSnapshot','cycleWatch']]) {
  const start=source.indexOf(`    function ${name}(`),end=source.indexOf(`    function ${next}(`,start);
  assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),ui);
 }
 return{ui,q,status,get releases(){return releases;}};
}

test('a lost paused snapshot cannot replay a native Item queue in the resumed same-tick epoch',()=>{
 const Online=require('../src/race-online.js'),host=Online.createHost(),client=Online.createClient();
 host.syncRoster([{p:1,identity:'host',role:0},{p:2,identity:'guest',role:0}],0);host.start();
 for(let i=0;i<Race.constants.COUNTDOWN;i++)host.step(i*1000/60);
 const actor=host.state.actors[1];actor.item='shield';client.accept(host.packet(),1);client.input({},2);
 let now=3000;
 const lifecycle=inputLifecycle(()=>{const packet=client.release(2);if(packet)host.receive(2,'guest',packet,now);});
 const present=snapshot=>({...snapshot,state:{...snapshot.state,actors:snapshot.state.actors.map(a=>({...a,controller:a.id===actor.id?'human':'remote',peerP:a.id===actor.id?2:1}))}});
 lifecycle.ui.state=present(client.current).state;lifecycle.q.request();
 const beforeTick=host.state.tick;host.pause(true);host.pause(false);
 const resumed=client.accept(host.packet(),1);assert.equal(resumed.state.tick,beforeTick);assert.equal(resumed.epoch,3);
 lifecycle.ui.networkSnapshot(present(resumed));assert.equal(lifecycle.releases,1);
 const drive=()=>{
  const item=lifecycle.q.sample(false,client.itemReady(2)),packet=client.input({throttle:1,item},2);
  assert.ok(host.receive(2,'guest',packet,now));host.step(now);now+=17;client.accept(host.packet(),1);return Online.decodeInput(packet);
 };
 for(let i=0;i<5;i++)assert.equal(drive().itemEdges,0,'the pre-epoch native request was discarded');
 assert.equal(actor.item,'shield');assert.equal(actor.shieldTicks,0);
 lifecycle.q.request();drive();assert.equal(drive().itemEdges,1);
 assert.equal(actor.item,null);assert.equal(actor.shieldTicks,240,'a genuinely new post-epoch press still works');
});

test('connection and stale transitions cancel a keyboard-only queue once per transition',()=>{
 for(const kind of ['connection','stale']){
  const x=inputLifecycle(),interrupted={...x.status,[kind]:kind==='connection'?'Reconnecting':true};
  x.q.request();x.ui.roomChanged(interrupted);assert.equal(x.releases,1);
  assert.equal(x.q.sample(false),false);assert.equal(x.q.sample(false),false);
  for(let i=0;i<20;i++)x.ui.roomChanged({...interrupted});assert.equal(x.releases,1,'refreshes do not create more release generations');
  x.ui.roomChanged({...x.status});assert.equal(x.releases,2,'return also neutralizes controls');
  x.q.request();x.ui.roomChanged({...x.status});assert.equal(x.releases,2);
  assert.equal(x.q.sample(false),false);assert.equal(x.q.sample(false),true,'a fresh post-interruption press survives stable status refreshes');
 }
});

test('role, transport P and followed human ownership changes invalidate native Item queues',()=>{
 for(const info of [{role:1,myP:2},{role:0,myP:7}]){
  const x=inputLifecycle();x.q.request();x.ui.roomChanged({...x.status,info});assert.equal(x.releases,1);
  assert.equal(x.q.sample(false),false);assert.equal(x.q.sample(false),false);
  x.ui.roomChanged({...x.status,info});assert.equal(x.releases,1);
 }
 for(const replacement of [null,{id:'pilot-2',peerP:2},{id:'pilot-1',peerP:7}]){
  const x=inputLifecycle(),state=Race.create({count:3});state.phase='racing';state.tick=180;state.countdown=0;
  state.actors.forEach(a=>{a.controller=a.id==='pilot-1'?'human':'remote';a.peerP=2;});x.ui.state=state;
  const next=Race.snapshot(state);next.actors.forEach(a=>a.controller='remote');
  if(replacement)Object.assign(next.actors.find(a=>a.id===replacement.id),replacement,{controller:'human'});
  x.q.request();x.ui.networkSnapshot({state:next,epoch:1,status:'running'});assert.equal(x.releases,1);
  assert.equal(x.q.sample(false),false);assert.equal(x.q.sample(false),false);
  x.ui.networkSnapshot({state:Race.snapshot(next),epoch:1,status:'running'});assert.equal(x.releases,1);
 }
});

function controllerLifecycle(actor,onRelease=()=>{}) {
 const x=inputLifecycle(onRelease),physical={index:0,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
 Object.assign(x.ui,{root:{navigator:{getGamepads:()=>[physical]}},ownsInput:()=>true,isRunning:()=>true,canControl:()=>true,ownActor:()=>actor,
  lastPad:null,padNeutral:true,padPrevious:{},pad:{steer:0,item:false},modal:{hidden:true},escape(){},focusStep(){}});
 const source=fs.readFileSync(require.resolve('../src/race-ui.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('    function pollPad() {'),source.indexOf('    function input() {')),x.ui);
 return{...x,physical,press(on){physical.buttons[5]={pressed:on,value:on?1:0};x.ui.pollPad();}};
}

test('controller Item waits for a lost-release baseline without replay, repeated holds or empty-slot banking',()=>{
 const Online=require('../src/race-online.js'),host=Online.createHost(),client=Online.createClient();
 host.syncRoster([{p:1,identity:'host',role:0},{p:2,identity:'guest',role:0}],0);host.start();
 for(let i=0;i<Race.constants.COUNTDOWN;i++)host.step(i*1000/60);
 const actor=host.state.actors[1];actor.item='shield';client.accept(host.packet(),1);client.input({},2);
 const lostPress=client.input({item:true},2);assert.equal(Online.decodeInput(lostPress).itemEdges,1);
 const x=controllerLifecycle(actor,()=>client.release(2));x.ui.resetInput(); // Release packet is lost.
 x.press(false);assert.equal(x.ui.padNeutral,false);
 client.input({item:x.q.sample(x.ui.pad.item,client.itemReady(2))},2); // First neutral sample is lost too.
 x.press(true);assert.equal(client.itemReady(2),false);
 let now=3000;
 const drive=()=>{
  x.ui.pollPad();const packet=client.input({throttle:1,item:x.q.sample(x.ui.pad.item,client.itemReady(2))},2),decoded=Online.decodeInput(packet);
  assert.ok(host.receive(2,'guest',packet,now));host.step(now);now+=17;client.accept(host.packet(),1);return decoded;
 };
 const baseline=drive();assert.equal(baseline.itemEdges,1);assert.equal(baseline.releaseEdges,1);
 assert.equal(actor.item,'shield');assert.equal(actor.shieldTicks,0,'the lost pre-menu press is consumed without use');
 assert.equal(drive().itemEdges,1);assert.equal(drive().itemEdges,2);
 assert.equal(actor.item,null);assert.equal(actor.shieldTicks,240,'the fresh R1 edge works after acknowledgement');
 actor.item='shield';for(let i=0;i<5;i++)assert.equal(drive().itemEdges,2);assert.equal(actor.item,'shield','held R1 does not request another activation');
 actor.item=null;x.press(false);drive();x.press(true);assert.equal(drive().itemEdges,3);
 actor.item='shield';for(let i=0;i<5;i++)assert.equal(drive().itemEdges,3);assert.equal(actor.item,'shield','a press in an empty slot never banks a later pickup');
 x.press(false);drive();x.press(true);assert.equal(drive().itemEdges,3);assert.equal(drive().itemEdges,4);assert.equal(actor.item,null);
});

test('controller neutral reacquisition and menu/control gates cannot queue a held Item button',()=>{
 const actor={item:'shield'},x=controllerLifecycle(actor);x.ui.resetInput();
 for(let i=0;i<3;i++){x.press(true);assert.equal(x.ui.padNeutral,true);assert.equal(x.q.sample(x.ui.pad.item),false);}
 x.press(false);assert.equal(x.ui.padNeutral,false);x.press(true);
 assert.equal(x.q.sample(x.ui.pad.item),false);assert.equal(x.q.sample(x.ui.pad.item),true);
 for(const gate of ['menu','play','control']){
  const y=controllerLifecycle(actor);y.press(false);
  if(gate==='menu')y.ui.modal.hidden=false;
  if(gate==='play')y.ui.isRunning=()=>false;
  if(gate==='control')y.ui.canControl=()=>false;
  y.press(true);assert.equal(y.q.sample(false),false);assert.equal(y.q.sample(false),false,`${gate} cannot bank an Item request`);
 }
});
