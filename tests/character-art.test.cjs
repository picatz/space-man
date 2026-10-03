const test = require('node:test'), assert = require('node:assert/strict');
const Art = require('../src/art.js'), Cosmetics = require('../src/cosmetics.js'), Scene = require('../src/race-scene.js');
function drawing() {
  const calls = [], stack = [], state = {globalAlpha: .6};
  const ctx = new Proxy(state,{get(target,key) {
    if (key in target) return target[key];
    if (key === 'save') return () => stack.push({...target});
    if (key === 'restore') return () => { const saved=stack.pop(); Object.keys(target).forEach(k=>delete target[k]); Object.assign(target,saved); };
    return (...args) => { assert.ok(!/^create.*Gradient$|shadowBlur|filter/.test(key),'no per-frame gradient/filter'); assert.ok(args.every(v=>typeof v!=='number'||Number.isFinite(v)),key+' finite arguments'); calls.push([key,...args]); };
  },set(t,k,v) { if(typeof v==='number') assert.ok(Number.isFinite(v)); t[k]=v; calls.push([k,v]); return true; }});
  return {ctx,calls,stack,state};
}
function frozen(raw) { Object.freeze(raw); for(const v of Object.values(raw))if(v&&typeof v==='object')frozen(v); return raw; }
test('every allowlisted appearance has a finite, immutable 2D portrait and craft', () => {
  for(const slot of Cosmetics.SLOTS) for(const id of Cosmetics.ORDERS[slot]) {
    const appearance=frozen({...Cosmetics.DEFAULTS,[slot]:id}), before=JSON.stringify(appearance);
    for(const ship of [false,true]) {
      const d=drawing(); Art.drawAvatar(d.ctx,100,100,180,appearance,{time:1.5,ship});
      assert.equal(d.stack.length,0); assert.equal(d.state.globalAlpha,.6); assert.equal(JSON.stringify(appearance),before); assert.ok(d.calls.length>50);
    }
  }
});
test('equipped expressions are visible but impact and celebration take priority', () => {
  assert.ok(Art.facePose({eyes:'happy',tick:20}).happy);
  assert.ok(Art.facePose({eyes:'calm',tick:20}).height < Art.facePose({eyes:'bright',tick:20}).height);
  assert.ok(Art.facePose({eyes:'determined',tick:20}).determined);
  assert.equal(Art.facePose({eyes:'happy',mood:2,tick:20}).happy,false);
  assert.ok(Art.facePose({eyes:'calm',mood:2,tick:20}).height>3);
  assert.equal(Art.facePose({lid:1,tick:20}).height,0);
});
test('reduced motion makes idle portraits stable across time and retains detail', () => {
  for(const ship of [false,true]) { const a=drawing(),b=drawing(); Art.drawAvatar(a.ctx,0,0,180,Cosmetics.DEFAULTS,{time:0,reduceMotion:true,ship});Art.drawAvatar(b.ctx,0,0,180,Cosmetics.DEFAULTS,{time:3.93,reduceMotion:true,ship});assert.deepEqual(a.calls,b.calls); }
});
test('all cosmetic choices change their intended art and stay within 3D culling bounds', () => {
  const signature = appearance => {
    const actor={id:1,x:0,y:0,heading:0,color:'#38E1FF',appearance};
    const snapshot=frozen({tick:20,actors:[actor]}),before=JSON.stringify(snapshot);
    const meshes=Scene.actorMeshes(snapshot),signature=meshes.map(m=>Buffer.from(m.vertices.buffer).toString('base64')).join(':');
    for(const m of meshes)for(let i=0;i<m.vertices.length;i+=9)for(let axis=0;axis<3;axis++)assert.ok(m.vertices[i+axis]>=m.bounds.min[axis]-.001&&m.vertices[i+axis]<=m.bounds.max[axis]+.001,'geometry inside bounds');
    assert.equal(JSON.stringify(snapshot),before);return signature;
  };
  for(const slot of Cosmetics.SLOTS) { const signatures=Cosmetics.ORDERS[slot].map(id=>signature({...Cosmetics.DEFAULTS,[slot]:id}));assert.equal(new Set(signatures).size,signatures.length,slot+' choices differ in rendered geometry/colors'); }
});
test('a blink only swaps the tiny visor overlay, preserving static craft geometry', () => {
  const snapshot={tick:20,actors:[{id:1,x:0,y:0,heading:0,color:'#38E1FF',appearance:Cosmetics.DEFAULTS}]};
  const open=Scene.actorMeshes(snapshot),blink=Scene.actorMeshes({...snapshot,tick:166});
  assert.equal(open[0].vertices,blink[0].vertices);assert.notEqual(open[1].vertices,blink[1].vertices);
  assert.ok(open[1].vertices.length<500,'face is a small mesh');
  assert.equal(Scene.actorMeshes({...snapshot,tick:166},{calm:true})[1].vertices,open[1].vertices);
});

test('a real Arena pulse drives the impact-wide expression from stun', () => {
  const Arena=require('../src/arena.js'),s=Arena.create();
  for(let i=0;i<Arena.constants.COUNTDOWN_TICKS;i++)Arena.step(s);
  s.actors.forEach((a,i)=>Object.assign(a,{x:440+i*44,y:420,px:440+i*44,py:420,vx:0,vy:0,invulnerable:0,stun:0,onGround:true,supportId:'dock',facing:1}));
  Arena.step(s,{1:{attackPressed:true}});
  for(let i=0;i<Arena.constants.ATTACK_TICKS&&!s.actors[1].stun;i++)Arena.step(s);
  assert.ok(s.actors[1].stun>0,'the real attack connected');
  assert.equal(Art.arenaMood(s.actors[1]),2);
  assert.ok(Art.facePose({mood:Art.arenaMood(s.actors[1]),tick:20}).height>3.2);
});

test('every visor triangle stays outside the helmet shell at its centroid', () => {
  for(const helmet of Cosmetics.ORDERS.helmet) {
    const radius=helmet==='round'?8.5:9.2;
    const vertices=Scene.actors({tick:20,actors:[{id:1,x:0,y:0,heading:0,color:'#38E1FF',appearance:{...Cosmetics.DEFAULTS,helmet}}]}).vertices;
    let n=0;
    for(let i=0;i<vertices.length;i+=27) {
      if(Math.abs(vertices[i+6]-.063)>.00001||Math.abs(vertices[i+7]-.176)>.00001||Math.abs(vertices[i+8]-.286)>.00001)continue;
      const x=(vertices[i]+vertices[i+9]+vertices[i+18])/3+5,y=(vertices[i+1]+vertices[i+10]+vertices[i+19])/3-24,z=(vertices[i+2]+vertices[i+11]+vertices[i+20])/3;
      assert.ok(Math.hypot(x,y,z)>radius+.2,helmet+' glass cannot cut through shell');n++;
    }
    assert.ok(n>=120,'curved visor is vertically subdivided');
  }
});
