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
