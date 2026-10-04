const test=require('node:test'),assert=require('node:assert/strict');
const Scene=require('../src/race-scene.js'),C=require('../src/cosmetics.js');
const actor=appearance=>({id:'pilot',x:0,y:0,heading:0,color:'#38E1FF',appearance});
test('soft ship shells use unit smooth normals within a bounded cached geometry budget',()=>{
 for(const ship of C.ORDERS.ship)for(const helmet of C.ORDERS.helmet){
  const state={tick:20,actors:[actor({...C.DEFAULTS,ship,helmet})]},mesh=Scene.actorMeshes(state)[0],v=mesh.vertices;
  assert.ok(v.length/9<9500,'base craft stays below 9500 cached vertices');
  let smooth=0;
  for(let i=0;i<v.length;i+=27){
   for(let j=0;j<27;j+=9)assert.ok(Math.hypot(v[i+j+3],v[i+j+4],v[i+j+5])<.00001 || Math.abs(Math.hypot(v[i+j+3],v[i+j+4],v[i+j+5])-1)<.00001,'normals finite and normalized');
   if(Math.hypot(v[i+3]-v[i+12],v[i+4]-v[i+13],v[i+5]-v[i+14])>.01)smooth++;
  }
  assert.ok(smooth>1000,'rounded hull and pilot have smoothly interpolated lighting');
  assert.equal(Scene.actorMeshes({...state,tick:21})[0].vertices,v,'frame changes retain cached hull');
 }
});
test('rounded stabilizers remain compact and do not change culling or physics state',()=>{
 for(const ship of C.ORDERS.ship){
  const state={tick:20,actors:[actor({...C.DEFAULTS,ship})]},before=JSON.stringify(state),meshes=Scene.actorMeshes(state);
  for(const m of meshes)for(let i=0;i<m.vertices.length;i+=9)for(let axis=0;axis<3;axis++)assert.ok(m.vertices[i+axis]>=m.bounds.min[axis]-.001&&m.vertices[i+axis]<=m.bounds.max[axis]+.001);
  assert.equal(JSON.stringify(state),before);
  const v=meshes[0].vertices;let width=0;
  for(let i=0;i<v.length;i+=9)width=Math.max(width,Math.abs(v[i+2]));
  assert.ok(width<=29,'no long blade beyond the rounded twin pods');
 }
});

test('canvas and WebGL use the same rounded authored hull outline',()=>{
 const Art=require('../src/art.js'),v=Scene.actors({tick:20,actors:[actor(C.DEFAULTS)]}).vertices;
 for(let i=0;i<32;i++) {
  const p=Art.hoverHullOutline(i*Math.PI/16);assert.ok(p.every(Number.isFinite));
  let found=false;
  for(let n=0;n<v.length;n+=9)if(p.every((x,k)=>Math.abs(x-v[n+k])<.00001)){found=true;break;}
  assert.ok(found,'the shared planform is the real rendered perimeter');
 }
 const q=Art.hoverHullOutline(.3),r=Art.hoverHullOutline(-.3);assert.equal(q[0],r[0]);assert.equal(q[2],-r[2]);
});
test('mirrored structural shoulders face upward and engine energy stays separate from the hull',()=>{
 const state={tick:20,actors:[actor(C.DEFAULTS)]},base=Scene.actorMeshes(state),boost=Scene.actorMeshes({...state,actors:[{...state.actors[0],boosting:true}]});
 assert.equal(base[0].vertices,boost[0].vertices);assert.equal(base.find(m=>m.engineActorId).vertices,boost.find(m=>m.engineActorId).vertices);
 const shadow=base.find(m=>m.shadowActorId),wake=boost.find(m=>m.plumeActorId);assert.equal(shadow.softShadow,true);assert.ok(shadow.opacity<.3);assert.ok(wake.emissive&&wake.tailFade&&wake.opacity<.4);
 const v=base[0].vertices;let n=0;
 for(let i=0;i<v.length;i+=9)if(Math.abs(v[i+6]-0x38/255*.9)<.00001&&Math.abs(v[i+7]-0xe1/255*.9)<.00001&&Math.abs(v[i+8]-.9)<.00001){assert.ok(v[i+4]>=-.00001);n++;}
 assert.ok(n>100,'both mirrored bridges have tested top surfaces');
});
