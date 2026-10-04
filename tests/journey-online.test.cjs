const test=require('node:test'),assert=require('node:assert/strict');
const J=require('../src/journey-online.js'),E=require('../src/expedition.js');
const rows=[1,2,3,4].map(p=>({p,identity:p===1?'host':'peer-'+p,role:0}));
function seedFor(mode){for(let seed=1;seed<100;seed++)if(E.encounterAt(seed,0).id===mode)return seed;throw Error(mode);}
function setup(seed=seedFor('runner')){const host=J.createHost({seed,session:123}),clients=rows.map(()=>J.createClient());host.syncRoster(rows,0);host.start(0);const packet=host.packet();clients.forEach(c=>c.accept(packet,1));return{host,clients};}
function readyAll(host,clients,time=0){clients.forEach((c,i)=>assert.equal(host.receive(i+1,rows[i].identity,c.ready(),time),true));host.step(time+J.MIN_BARRIER_MS);const packet=host.packet();clients.forEach(c=>assert.ok(c.accept(packet,1)));}
test('four stable identities traverse twelve bounded mixed encounters, including bosses, with authoritative epochs',()=>{
 const{host,clients}=setup();let t=0;const observed=[];
 for(let index=0;index<12;index++){
  assert.equal(host.index,index);assert.equal(host.phase,'barrier');const old=host.packet();clients.forEach(c=>c.accept(old,1));readyAll(host,clients,t);t+=J.MIN_BARRIER_MS;
  observed.push(host.config.id);assert.equal(host.seats.length,4);assert.deepEqual(host.seats.map(s=>s.identity),rows.map(r=>r.identity));
  if(host.config.encounter==='boss'){assert.equal(host.engine.state.actors.length,5);assert.equal(host.engine.seats.length,4);assert.ok(host.engine.state.actors[4].boss);}
  const stale=clients[1].input(host.config.id==='runner'?{x:80,y:20,vx:0,vy:0,state:8,chain:0,score:0,dist:0,frame:1}:{},2);
  for(let n=0;host.index===index&&n<11000;n++){t+=1000/60;host.step(t);if(n%30===0){const packet=host.packet();assert.ok(packet.length<=1024);clients.forEach(c=>assert.ok(c.accept(packet,1)));}}
  assert.equal(host.index,index+1,'each encounter has a finite deadline');assert.equal(host.receive(2,'peer-2',stale,t),false,'stale input never crosses epoch');
  const fresh=host.packet();clients.forEach(c=>{assert.ok(c.accept(fresh,1));assert.equal(c.accept(old,1),null);assert.equal(c.accept(fresh,1),null);});
 }
 assert.ok(observed.includes('runner')&&observed.includes('arena')&&observed.includes('race'));
});
test('readiness timeout fills missing seats with CPUs without blocking the crew',()=>{const{host,clients}=setup(seedFor('race'));host.receive(1,'host',clients[0].ready(),0);host.step(J.MAX_BARRIER_MS-1);assert.equal(host.phase,'barrier');host.step(J.MAX_BARRIER_MS);assert.equal(host.phase,'running');assert.deepEqual(host.seats.map(s=>s.p),[1]);assert.equal(host.engine.state.actors.filter(a=>a.controller==='cpu').length,4);const c=clients[1].accept(host.packet(),1);assert.equal(J.hasPlayer(c.players,2),false);assert.equal(clients[1].input({},2),null);});
test('commands cannot forge host state, peer identity, session, epoch or spectator role',()=>{const{host,clients}=setup();readyAll(host,clients);const good=clients[1].input({x:0,y:0,vx:0,vy:0,score:0,dist:0,frame:1,state:8,chain:0},2);assert.equal(host.receive(2,'peer-3',good,1000),false);const o=J.decode(good);for(const edit of[{session:124},{epoch:0},{type:J.SNAPSHOT},{index:1}])assert.equal(host.receive(2,'peer-2',J.encode({...o,...edit},o.payload),1000),false);assert.equal(clients[1].accept(host.packet(),2),null);host.syncRoster(rows.map(r=>r.p===2?{...r,role:1}:r),1000);assert.equal(host.receive(2,'peer-2',good,1000),false);});
test('slipstream bit is not completion; runner completion latches only within its epoch',()=>{const{host,clients}=setup();readyAll(host,clients);for(let p=1;p<=4;p++){const b=clients[p-1].input({x:0,y:0,vx:0,vy:0,score:10,dist:5,frame:1,state:24,chain:0},p);assert.ok(host.receive(p,rows[p-1].identity,b,1000));}for(let i=0;i<121;i++)host.step(1000+i);assert.equal(host.index,0);for(let p=1;p<=4;p++)host.receive(p,rows[p-1].identity,clients[p-1].input({x:0,y:0,vx:0,vy:0,score:10,dist:5,frame:2,state:40,chain:0},p),1200);host.step(1201);assert.equal(host.index,1);});
test('binary decoding rejects oversized, malformed and non-finite presence without mutating client',()=>{const{host,clients}=setup();const original=host.packet();assert.equal(J.decode(new Uint8Array(1025)),null);const broken=original.slice();broken[32]++;assert.equal(clients[0].accept(broken,1),null);assert.equal(J.encodeRunner([{p:1,x:NaN,y:0,vx:0,vy:0,score:0,dist:0,frame:0,state:0,chain:0}]),null);assert.equal(J.decodeRunner(new Uint8Array([5])),null);});

for(const mode of ['race','runner'])test(`${mode} encounter rebinds only the authenticated identity after P changes`,()=>{
 const seed=mode==='runner'?seedFor(mode):6,{host,clients}=setup(seed);readyAll(host,clients);
 const start=1000;
 if(mode==='race')assert.equal(host.config.trackId,'starlight');
 const c=clients[1],before=host.engine?.seats.find(s=>s.identity==='peer-2');
 const sample={x:10,y:20,vx:1,vy:0,score:123,dist:45,frame:4,state:40,chain:2};
 const command=mode==='runner'?sample:{};
 assert.ok(host.receive(2,'peer-2',c.input(command,2),start));
 host.syncRoster(rows.filter(r=>r.p!==2),start+1);
 const rebound=rows.map(r=>r.p===2?{...r,p:7}:r);
 // P2 is now a different player. Membership is identity-based, not P-based.
 host.syncRoster([...rebound,{p:2,identity:'replacement',role:0}],start+100);
 assert.equal(host.seats.find(s=>s.identity==='peer-2').p,7);
 assert.equal(host.seats.some(s=>s.identity==='replacement'),false);
 const frame=c.accept(host.packet(),1);assert.ok(frame);
 assert.equal(J.hasPlayer(frame.players,7),true);assert.equal(J.hasPlayer(frame.players,2),false);
 if(host.engine){const after=host.engine.seats.find(s=>s.identity==='peer-2');assert.equal(after.p,7);assert.equal(after.actorId,before.actorId);assert.equal(after.connected,true);}
 else{assert.equal(frame.runner.find(r=>r.p===7).score,123);assert.equal(frame.runner.find(r=>r.p===7).state,40,'completion remains attached to identity');assert.equal(frame.runner.some(r=>r.p===2),false,'cached sample follows its owner before any new input');}
 const packet=c.input(mode==='runner'?{...sample,frame:5}:{},7);assert.ok(packet);
 assert.equal(host.receive(2,'peer-2',packet,start+101),false,'old P is no longer authenticated');
 assert.equal(host.receive(2,'replacement',packet,start+101),false,'recycled P cannot take encounter membership');
 assert.equal(host.receive(7,'replacement',packet,start+101),false,'identity cannot choose another P');
 assert.equal(host.receive(7,'peer-2',packet,start+101),true,'same identity controls its rebound seat');
 host.syncRoster(rebound.map(r=>r.p===7?{...r,role:1}:r),start+102);
 assert.equal(host.receive(7,'peer-2',c.input(command,7),start+103),false,'a watcher cannot use the preserved identity seat');
});

test('rebound identity and new P survive mixed engine transitions without carrying stale encounter input',()=>{
 const{host,clients}=setup(6);readyAll(host,clients);let t=J.MIN_BARRIER_MS;
 host.syncRoster(rows.filter(r=>r.p!==2),t+1);
 const rebound=rows.map(r=>r.p===2?{...r,p:7}:r);host.syncRoster(rebound,t+2);
 let observed=new Set();
 for(let index=0;index<6;index++){
  const bytes=host.packet();clients.forEach(c=>assert.ok(c.accept(bytes,1)));
  assert.equal(host.seats.find(s=>s.identity==='peer-2').p,7);observed.add(host.config.id);
  const command=host.config.id==='runner'?{x:10,y:20,vx:0,vy:0,score:3,dist:2,frame:1,state:8,chain:0}:{};
  const old=clients[1].input(command,7);assert.ok(host.receive(7,'peer-2',old,t+3));
  for(let n=0;host.index===index&&n<11000;n++){t+=1000/60;host.step(t);}
  assert.equal(host.index,index+1);assert.equal(host.receive(7,'peer-2',old,t),false);
  const barrier=host.packet();clients.forEach((c,i)=>{assert.ok(c.accept(barrier,1));assert.ok(host.receive(rebound[i].p,rebound[i].identity,c.ready(),t));});
  t+=J.MIN_BARRIER_MS;host.step(t);assert.equal(host.phase,'running');
 }
 assert.deepEqual([...observed].sort(),['arena','race','runner']);
});
