const test=require('node:test'),assert=require('node:assert/strict');
const Scene=require('../src/race-scene.js'),C=require('../src/cosmetics.js');
const actor=appearance=>({id:'pilot',x:0,y:0,heading:0,color:'#38E1FF',appearance});
test('soft ship shells use unit smooth normals within a bounded cached geometry budget',()=>{
 for(const ship of C.ORDERS.ship)for(const helmet of C.ORDERS.helmet){
  const state={tick:20,actors:[actor({...C.DEFAULTS,ship,helmet})]},mesh=Scene.actorMeshes(state)[0],v=mesh.vertices;
  assert.ok(v.length/9<9000,'base craft stays below 9000 cached vertices');
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
