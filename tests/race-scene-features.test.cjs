const test = require('node:test'), assert = require('node:assert/strict');
const R = require('../src/race.js'), Scene = require('../src/race-scene.js');
const c = R.course('starlight'), catalog = R.features(c);
const frozen = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
};
const meshes = (state, options={}) => Scene.featureMeshes(state,c,R.at,catalog,{actorId:state.actors[0].id,nearest:R.nearest,...options});
function bounds(mesh) {
  assert.equal(mesh.vertices.length % 27,0);
  assert.ok(mesh.vertices.length > 0 && mesh.vertices.every(Number.isFinite));
  assert.ok(mesh.bounds && [...mesh.bounds.min,...mesh.bounds.max].every(Number.isFinite));
  if(mesh.model) assert.ok(mesh.model.every(Number.isFinite));
  for(let i=0;i<mesh.vertices.length;i+=9) for(let k=0;k<3;k++)
    assert.ok(mesh.vertices[i+k]>=mesh.bounds.min[k] && mesh.vertices[i+k]<=mesh.bounds.max[k]);
}
test('catalog meshes are finite, immutable-input, bounded and statically cached',()=>{
  const state=frozen(R.snapshot(R.create())),before=JSON.stringify([state,c,catalog]);
  const first=meshes(state),second=meshes({...state,tick:state.tick+100});
  assert.equal(first.length,22);
  assert.equal(first.filter(m=>m.featureKind==='ramp').length,2);
  assert.equal(first.filter(m=>m.featureKind==='landing').length,2);
  assert.equal(first.filter(m=>m.featureKind==='coin').length,10);
  assert.equal(first.filter(m=>m.featureKind==='item').length,4);
  assert.equal(first.filter(m=>m.featureKind==='approach').length,4);
  assert.ok(first.reduce((n,m)=>n+m.vertices.length/9,0)<5000);
  for(let i=0;i<first.length;i++) {
    bounds(first[i]);assert.ok(first[i].static);assert.equal(first[i],second[i]);
    assert.ok(Object.isFrozen(first[i])&&Object.isFrozen(first[i].bounds));
  }
  assert.equal(JSON.stringify([state,c,catalog]),before);
  for(const id of ['ember','bloom']) {
    const state=R.create({trackId:id}),course=R.course(id);
    assert.deepEqual(Scene.featureMeshes(state,course,R.at,R.features(course)),[]);
  }
});
test('only the followed pilot masks can remove their optional stars and item rows',()=>{
  const state=R.create();state.actors[1].coinMask=1023;state.actors[1].rowMask=3;
  assert.equal(meshes(state).filter(m=>m.featureKind==='coin').length,10);
  assert.equal(meshes(state).filter(m=>m.featureKind==='item').length,4);
  assert.equal(meshes(state,{actorId:state.actors[1].id}).length,4);
  state.actors[0].coinMask=1<<4;state.actors[0].rowMask=1;
  const shown=meshes(state);assert.equal(shown.filter(m=>m.featureKind==='coin').length,9);
  assert.ok(!shown.some(m=>m.featureId===catalog.coins[4].id));
  assert.equal(shown.filter(m=>m.featureKind==='item').length,2);
  assert.ok(shown.filter(m=>m.featureKind==='item').every(m=>catalog.rows[1].choices.some(choice=>choice.id===m.featureId)));
});
test('rounded ramp rendering is shallow and airborne height is host-authored',()=>{
  const base=R.create().actors[0];
  for(const ramp of catalog.ramps) for(let offset=-10;offset<=95;offset+=5) {
    const p=R.at(c,ramp.startS+offset),a={...base,x:p.x,y:p.y};
    const height=Scene.actorHeight(a,c,catalog,R.nearest);
    assert.ok(height>=0&&height<=10);
    if(offset===30) assert.ok(Math.abs(height-5)<1e-6);
    if(offset<0||offset>84) assert.equal(height,0);
    assert.equal(Scene.actorHeight({...a,recoveryTicks:1},c,catalog,R.nearest),0);
    assert.equal(Scene.actorHeight({...a,airRamp:1,z:27.25},c,catalog,R.nearest),27.25);
  }
  const ramp=catalog.ramps[0],p=R.at(c,ramp.startS+30);
  assert.equal(Scene.actorHeight({...base,x:p.x-p.ty*110,y:p.y+p.tx*110},c,catalog,R.nearest),0);
});
test('craft, thrusters, faces and labels can share elevation while cached ground shadows stay on road',()=>{
  const state=R.create(),options={course:c,catalog,nearest:R.nearest};
  state.actors=state.actors.slice(0,1);const a=state.actors[0];
  a.boosting=true;const grounded=Scene.actorMeshes(state,options);
  a.airRamp=1;a.airTicks=12;a.z=28;a.vx=3;a.vy=3;a.speed=Math.hypot(3,3);
  const airborne=Scene.actorMeshes(state,options);
  for(const kind of ['actorId','faceActorId']) {
    const ground=grounded.find(m=>m[kind]===a.id),air=airborne.find(m=>m[kind]===a.id);
    assert.equal(air.vertices,ground.vertices);assert.equal(air.model[13],28);bounds(air);
  }
  const shadow=airborne.find(m=>m.shadowActorId===a.id);
  assert.equal(shadow.model[13],0);assert.ok(shadow.vertices.every((v,i)=>i%9!==1||Math.abs(v-.15)<1e-6));
  assert.ok(!airborne.some(m=>m.effectActorId));
  assert.equal(shadow.vertices,grounded.find(m=>m.shadowActorId).vertices);
  a.airRamp=0;a.z=0;assert.equal(Scene.actorMeshes(state,options).find(m=>m.actorId).model[13],0,'a cached airborne craft cannot elevate later grounded pilots');
});
test('shield and pulse have distinct bounded, snapshot-driven states in reduced motion',()=>{
  const state=R.create();state.actors[0].item='shield';
  const held=meshes(state,{calm:true}).find(m=>m.featureKind==='shield');
  state.actors[0].item=null;state.actors[0].shieldTicks=240;state.actors[0].airRamp=1;state.actors[0].z=20;
  const active=meshes(state,{calm:true}).find(m=>m.featureKind==='shield');
  assert.equal(held.active,false);assert.equal(active.active,true);assert.notEqual(active.vertices,held.vertices);
  assert.equal(active.model[13],20);bounds(held);bounds(active);
  assert.ok(!meshes(state,{hideId:state.actors[0].id}).some(m=>m.shieldActorId===state.actors[0].id));
  state.effects=Array.from({length:5},(_,i)=>({ownerId:'pilot-'+i,serial:i+1,phase:i%2?'wave':'charge',age:10,s:c.length*2+i*40,d:i%2?44:-44,originS:c.length*2}));
  frozen(state);const before=JSON.stringify(state),effects=meshes(state,{calm:true}).filter(m=>m.featureKind==='pulse');
  assert.equal(effects.length,5);assert.ok(effects.reduce((n,m)=>n+m.vertices.length/9,0)<5000);
  for(const m of effects) { bounds(m);assert.equal(m.static,false);assert.equal(m.emissive,true); }
  assert.equal(effects.filter(m=>m.featurePhase==='charge').length,3);
  assert.equal(effects.filter(m=>m.featurePhase==='wave').length,2);
  assert.equal(JSON.stringify(state),before);
  const next=meshes(state,{calm:false}).filter(m=>m.featureKind==='pulse');
  effects.forEach((m,i)=>assert.deepEqual(m.vertices,next[i].vertices,'motion preference cannot remove charge lanes or fabricate wave motion'));
});
