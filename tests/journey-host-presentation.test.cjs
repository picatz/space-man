'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {client,relay,until}=require('./harness.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(t,mode){
 const seed=mode==='arena'?0:1;
 const hub=relay(),all=[];
 function peer(){const c=client(hub,{game:false});all.push(c);c.run(`window.poses=[];window.room=SpaceManJourneyRoom.create({net:SpaceManNet,hostOptions:()=>({relayHost:'relay.test'}),onSnapshot:s=>poses.push(JSON.parse(JSON.stringify(s)))});`);c.room=c.context.room;return c;}
 t.after(()=>all.forEach(c=>{c.room.leave();c.close();}));
 const host=peer();assert.equal(await host.room.hosting(seed),true);
 const guest=peer();assert.equal(await guest.room.join(host.net.info().link,0),true);
 await until(()=>guest.room.current&&guest.net.roster().some(r=>r.you));
 const watching=peer();assert.equal(await watching.room.join(host.net.info().link,1),true);
 await until(()=>watching.room.current&&watching.net.roster().some(r=>r.you));
 assert.equal(host.room.start(),true);
 async function advance(ms){for(let n=0;n<ms;n+=100){hub.advance(100);await wait(18);}}
 await advance(1200);await until(()=>guest.room.current?.phase==='running');
 // Public runner completion, not teleported combat or forced game result.
 for(let n=0;n<65&&host.room.current.mode==='runner';n++){
  host.room.runnerDone({state:8});guest.room.runnerDone({state:8});await advance(100);
 }
 await advance(1200);await until(()=>host.room.current?.mode===mode&&host.room.current.phase==='running');
 return {host,guest,watching,advance};
}
for(const mode of ['arena','race'])test(`shared ${mode} host presents every simulated tick while guests retain bounded wire snapshots`,{timeout:20000},async t=>{
 const {host,guest,watching}=await setup(t,mode);
 await until(()=>host.room.adapter.current?.state.phase===(mode==='arena'?'playing':'racing'));
 for(const c of[host,guest,watching])c.context.poses.length=0;
 const identity=[host,guest,watching].map(c=>({p:c.net.info().myP,room:c.net.info().roomId,role:c.net.info().role}));
 const input=setInterval(()=>host.room.adapter.step(mode==='arena'?{moveX:0.35}:{steer:0.1}),16);t.after(()=>clearInterval(input));
 await until(()=>host.context.poses.filter(s=>s.state.phase===(mode==='arena'?'playing':'racing')).length>=60,'sixty host simulation poses',10000);
 const rows=host.context.poses.filter(s=>s.state.phase===(mode==='arena'?'playing':'racing'));assert.ok(rows.length>30,'host receives live simulation poses');
 const gaps=rows.slice(1).map((s,i)=>s.state.tick-rows[i].state.tick);
 assert.ok(gaps.every(n=>n===1),'every authoritative tick is presented exactly once: '+gaps.join(','));
 const byTick=new Map(rows.map(s=>[s.state.tick,s]));
 for(const c of[guest,watching]){
  const remote=c.context.poses.filter(s=>byTick.has(s.state.tick));assert.ok(remote.length>5,'remote receives authoritative trajectory');
  assert.ok(remote.length<rows.length*.7,'network publication remains lower cadence than host presentation');
  for(const s of remote){const h=byTick.get(s.state.tick);assert.equal(s.epoch,h.epoch);for(const a of s.state.actors){const b=h.state.actors.find(b=>b.id===a.id);assert.ok(Math.abs(a.x-b.x)<0.001&&Math.abs(a.y-b.y)<0.001,'wire pose matches host within Float32 serialization');}}
 }
 const final=rows.at(-1);assert.equal(final.isHost,true);assert.ok(final.state.actors.some(a=>a.controller==='human'));
 assert.deepEqual([host,guest,watching].map(c=>({p:c.net.info().myP,room:c.net.info().roomId,role:c.net.info().role})),identity);
 clearInterval(input);
 assert.equal(host.room.pause(true),true);await until(()=>guest.room.current.phase==='paused'&&watching.room.current.phase==='paused');
 const paused=[host,guest,watching].map(c=>JSON.stringify(c.room.adapter.current.state,(key,value)=>key==='events'?undefined:value));await wait(250);
 assert.deepEqual([host,guest,watching].map(c=>JSON.stringify(c.room.adapter.current.state,(key,value)=>key==='events'?undefined:value)),paused,'pause holds every authority pose');
 assert.equal(host.room.pause(false),true);await until(()=>guest.room.current.phase==='running');await wait(150);
 assert.ok(host.room.adapter.current.state.tick>JSON.parse(paused[0]).tick,'resume advances normally');
 assert.deepEqual([host,guest,watching].map(c=>({p:c.net.info().myP,room:c.net.info().roomId,role:c.net.info().role})),identity);
});
