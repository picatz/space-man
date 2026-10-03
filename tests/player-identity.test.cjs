const test=require('node:test'),assert=require('node:assert/strict'),Art=require('../src/art.js');
const bounds={left:8,right:312,top:130,bottom:410};
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
test('ownership takes first priority when identically dressed pilots pile up',()=>{
 const items=Array.from({length:5},(_,i)=>({id:i,x:160,y:200,w:i===4?48:103,h:22,priority:i===4?2:0}));
 const result=Art.identityLayout(items,bounds);
 assert.equal(result[0].id,4);
 for(const a of result){assert.ok(a.x>=bounds.left&&a.x+a.w<=bounds.right&&a.y>=bounds.top&&a.y+a.h<=bounds.bottom);for(const b of result)if(a!==b)assert.equal(overlap(a,b),false);}
 assert.deepEqual(items.map(a=>a.x),[160,160,160,160,160],'layout never mutates simulation inputs');
});
test('crowded secondary labels avoid another player face and HUD edges',()=>{
 const result=Art.identityLayout([{id:1,x:12,y:100,w:44,priority:2},{id:2,x:80,y:166,w:100}],bounds,[{id:3,x:50,y:164,w:35,h:45}]);
 assert.equal(result[0].x,8);assert.equal(result[0].y,130);
 assert.ok(!result.some(b=>b.id===2&&overlap(b,{x:50,y:164,w:35,h:45})));
});
test('identity painting preserves canvas state and uses shape plus high-contrast text',()=>{
 const calls=[],state={globalAlpha:.2},stack=[];
 const c=new Proxy(state,{get(t,k){if(k in t)return t[k];if(k==='save')return()=>stack.push({...t});if(k==='restore')return()=>{Object.keys(t).forEach(k=>delete t[k]);Object.assign(t,stack.pop());};return(...a)=>calls.push([k,...a]);},set(t,k,v){t[k]=v;calls.push([k,v]);return true;}});
 Art.identityBadge(c,'YOU',10,20,44,{primary:true,pointerX:32,pointerY:54});Art.identityBrackets(c,32,84,40,48);
 assert.equal(stack.length,0);assert.equal(c.globalAlpha,.2);assert.ok(calls.some(a=>a[0]==='fillText'&&a[1]==='YOU'));assert.ok(calls.some(a=>a[0]==='fillStyle'&&a[1]==='#FFF3CE'));assert.ok(calls.filter(a=>a[0]==='stroke').length>=6);
});
test('runner marker belongs to the scene, does not change outfits and never marks a spectator as YOU',()=>{
 const {client,relay}=require('./harness.cjs'),c=client(relay());
 try {
  const got=JSON.parse(c.run(`(()=>{startRun();vigPose=null;G.player.dead=false;G.player.x=G.player.px=180;G.player.y=G.player.py=220;ctx.getTransform=()=>({a:view.dpr,b:0,c:0,d:view.dpr,e:0,f:0});const calls=[];const old=ART.identityBadge;ART.identityBadge=(...a)=>calls.push(a[1]);const appearance=JSON.stringify(G.cosmetics);drawRunnerIdentity(1);const solo=calls.splice(0);const spectating=netSpectating;netSpectating=()=>true;spec.watchP=2;ghosts.push({active:true,p:2,alpha:1,rx:170,ry:240});G.player.dead=true;drawRunnerIdentity(1);const watched=calls.splice(0);ghosts.length=0;drawRunnerIdentity(1);ART.identityBadge=old;netSpectating=spectating;return JSON.stringify({solo,watched,noTarget:calls,unchanged:appearance===JSON.stringify(G.cosmetics)});})()`));
  assert.deepEqual(got,{solo:['YOU'],watched:['WATCHING'],noTarget:[],unchanged:true});
 } finally {c.close();}
});
