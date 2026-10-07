const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../src/race-presentation.js');
const snap=(tick,x,extra={})=>({tick,arenaId:'a',phase:'playing',actors:[{id:1,x,y:100,stocks:3,px:0,py:0}],...extra});
// list of [ms, tick, x] arrivals; returns the guest's drawn position every 16 ms
function feed(play,list,epoch=1){
 const out=[];let st=null,next=0;const end=list.at(-1)[0]+200;
 for(let t=0;t<=end;t+=16){
  while(next<list.length&&list[next][0]<=t){const [,tick,x]=list[next++];st=snap(tick,x);play.receive(st,epoch,t);}
  if(st){const s={...st,actors:st.actors.map(a=>({...a}))};play.apply(s,t,false);out.push({t,x:s.actors[0].x,px:s.actors[0].px});}
 }
 return out;
}
test('arena guests play snapshots through the race timeline buffer: continuous, monotonic, never ahead of the newest authority',()=>{
 // 20 Hz stream (3 ticks / 50 ms) with a stall: arrivals at 0/50/130/150 ms
 const out=feed(P.createArenaPlayout(),[[0,0,0],[50,3,30],[130,9,90],[150,12,120]]);
 for(let i=1;i<out.length;i++){assert.ok(out[i].x>=out[i-1].x-1e-9,'monotonic at '+out[i].t);assert.ok(out[i].x-out[i-1].x<=12,'no jump at '+out[i].t);}
 assert.ok(out.every(o=>o.x<=120+1e-9),'never extrapolates past the newest snapshot');
 const at=ms=>out.find(o=>o.t>=ms).x;
 assert.ok(at(60)<30,'rendering sits behind the newest snapshot (delay), not on it');
 assert.ok(at(140)>at(100),'keeps moving through the 50 to 130 ms gap rather than freezing');
 assert.equal(out.at(-1).x,120,'settles on the last authority once the stream ends');
 assert.ok(out.every(o=>o.px===o.x),'px/py follow the sampled pose so any draw alpha lands on it');
});
test('a backlog catches up at 1.1x without snapping, and a silent host is never extrapolated',()=>{
 const play=P.createArenaPlayout();
 for(let i=0;i<=6;i++)play.receive(snap(i*3,i*30),1,i*50);
 const pos=[];for(let t=300;t<=900;t+=16){const s=snap(18,180);play.apply(s,t,false);pos.push(s.actors[0].x);}
 assert.ok(pos.every((x,i)=>i===0||x>=pos[i-1]&&x-pos[i-1]<=11*1.1+1e-9),'bounded per-frame step');
 assert.ok(pos.at(-1)<=180,'no extrapolation while the host is silent');
 assert.equal(pos.at(-1),180,'and it does arrive');
});
test('an epoch change resets instead of interpolating across rounds; pause shows newest authority; stale states are not painted',()=>{
 const play=P.createArenaPlayout();
 play.receive(snap(0,0),1,0);play.receive(snap(3,500),1,50);
 play.receive(snap(0,10),2,100);
 const s=snap(0,10);play.apply(s,110,false);assert.equal(s.actors[0].x,10);
 play.receive(snap(6,40),2,150);const p=snap(6,40);play.apply(p,150,true);assert.equal(p.actors[0].x,40);
 assert.equal(play.apply(snap(3,0),160,false),false);
});
