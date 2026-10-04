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
test('identity painting preserves canvas state and uses distinct non-text silhouettes',()=>{
 const calls=[],state={globalAlpha:.2},stack=[];
 const c=new Proxy(state,{get(t,k){if(k in t)return t[k];if(k==='save')return()=>stack.push({...t});if(k==='restore')return()=>{Object.keys(t).forEach(k=>delete t[k]);Object.assign(t,stack.pop());};return(...a)=>calls.push([k,...a]);},set(t,k,v){t[k]=v;calls.push([k,v]);return true;}});
 Art.identityCue(c,32,20,'you');Art.identityCue(c,32,84,'watching');
 assert.equal(stack.length,0);assert.equal(c.globalAlpha,.2);assert.equal(calls.some(a=>a[0]==='fillText'),false);assert.ok(calls.some(a=>a[0]==='fillStyle'&&a[1]==='#EAF7FF'));assert.ok(calls.some(a=>a[0]==='quadraticCurveTo'));assert.ok(calls.filter(a=>a[0]==='stroke').length>=3);
});
test('runner marker belongs to the scene, does not change outfits and never marks a spectator as YOU',()=>{
 const {client,relay}=require('./harness.cjs'),c=client(relay());
 try {
  const got=JSON.parse(c.run(`(()=>{startRun();vigPose=null;G.player.dead=false;G.player.x=G.player.px=180;G.player.y=G.player.py=220;ctx.getTransform=()=>({a:view.dpr,b:0,c:0,d:view.dpr,e:0,f:0});const calls=[];const old=ART.identityCue;ART.identityCue=(...a)=>calls.push(a[3]);const appearance=JSON.stringify(G.cosmetics);drawRunnerIdentity(1);const solo=calls.splice(0);const spectating=netSpectating;netSpectating=()=>true;spec.watchP=2;ghosts.push({active:true,p:2,alpha:1,rx:170,ry:240});G.player.dead=true;drawRunnerIdentity(1);const watched=calls.splice(0);ghosts.length=0;drawRunnerIdentity(1);ART.identityCue=old;netSpectating=spectating;return JSON.stringify({solo,watched,noTarget:calls,unchanged:appearance===JSON.stringify(G.cosmetics)});})()`));
  assert.deepEqual(got,{solo:[],watched:['watching'],noTarget:[],unchanged:true});
 } finally {c.close();}
});

test('a HUD-clamped primary moves beside its own body instead of covering it',()=>{
 const body={id:1,x:390,y:80,w:25,h:30};
 const [label]=Art.identityLayout([{id:1,x:402.5,y:45,w:44,h:22,priority:2,primary:true}],{left:8,right:836,top:98,bottom:302},[body]);
 assert.ok(label);assert.equal(label.y,98);assert.equal(overlap(label,body),false);
});

test('a watched craft cue avoids nearby racers on a rotated crowded track',()=>{
 const bodies=[{id:'you',x:180,y:310,w:40,h:40},{id:'rival',x:174,y:276,w:40,h:40}];
 const cue=Art.identityMarkerLayout('you',bodies,{left:8,right:312,top:110,bottom:450});
 assert.ok(cue);assert.equal(cue.link,true);
 for(const body of bodies)assert.equal(overlap(cue,body),false);
 assert.ok(cue.targetX>=180&&cue.targetX<=220&&cue.targetY>=310&&cue.targetY<=350);
});
test('secondary crew names omit a crowded label instead of laddering over another pilot',()=>{
 const rows=Art.identityLayout([{id:1,x:160,y:180,w:20,h:16,primary:true,priority:2},{id:2,x:162,y:180,w:100,h:16,fixed:true}],bounds);
 assert.deepEqual(rows.map(r=>r.id),[1]);
});

test('a five-craft cardinal pile-up keeps a diagonally placed cue and clear leader',()=>{
 const bodies=[[140,200],[140,150],[140,250],[90,200],[190,200]].map(([x,y],id)=>({id,x,y,w:43,h:43}));
 const cue=Art.identityMarkerLayout(0,bodies,{left:6,right:314,top:110,bottom:460});
 assert.ok(cue);assert.equal(cue.link,true);assert.ok(cue.leader);
 for(const b of bodies)assert.equal(overlap(cue,b),false);
});
