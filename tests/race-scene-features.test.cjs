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

test('Cockpit removes only close rival flame triangles, retaining the boosted pilot, hull and shadow',()=>{
  const original=R.snapshot(R.create()),owner={...original.actors[0],x:0,y:0,heading:0},
    rival={...original.actors[1],x:56,y:0,heading:0,airRamp:1,airTicks:12,z:28,boosting:true,padTicks:0};
  const state=frozen({...original,tick:97,actors:[owner,rival]}),before=JSON.stringify(state),
    options={course:c,catalog,nearest:R.nearest,hideId:owner.id,calm:true},
    regular=Scene.actorMeshes(state,options),safe=Scene.actorMeshes(state,{...options,cockpitEye:[6,34,0]}),
    bare=Scene.actorMeshes({...state,actors:[owner,{...rival,boosting:false}]},options);
  assert.equal(safe.filter(m=>m.actorId).length,1,'the nearby opponent is never hidden');
  const hull=list=>list.find(m=>m.actorId===rival.id),face=list=>list.find(m=>m.faceActorId===rival.id),shadow=list=>list.find(m=>m.shadowActorId===rival.id);
  assert.equal(hull(regular).vertices.length-hull(safe).vertices.length,2*8*3*6*9,'exactly two decorative wake capsules removed');
  assert.equal(hull(safe).vertices,hull(bare).vertices,'hull and helmet use the unchanged no-flame geometry');
  assert.equal(face(safe).vertices,face(regular).vertices,'real boost face cues survive plume suppression');
  assert.deepEqual(hull(safe).model,hull(regular).model);assert.equal(hull(safe).model[13],28);
  assert.equal(shadow(safe).vertices,shadow(regular).vertices);assert.deepEqual(shadow(safe).model,shadow(regular).model);
  assert.equal(shadow(safe).model[13],0);safe.forEach(bounds);
  assert.equal(JSON.stringify(state),before,'no physics or authoritative appearance changes');
});
test('Cockpit plume clearance uses the actual three-dimensional eye and rotates with a rival',()=>{
  const base=R.snapshot(R.create()),rival=base.actors[1],options={course:c,catalog,nearest:R.nearest,calm:true};
  for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2]) for(const z of [0,28]) for(const eyeHeight of [34,42,52]) {
    const co=Math.cos(heading),si=Math.sin(heading),a={...rival,x:100+56*co,y:80+56*si,heading,boosting:true,padTicks:0,z,airRamp:z?1:0};
    const state={...base,actors:[a]},full=Scene.actorMeshes(state,options).find(m=>m.actorId);
    const eye=[100+6*co,eyeHeight,80+6*si];
    const near=Scene.actorMeshes(state,{...options,cockpitEye:eye}).find(m=>m.actorId);
    // A ground plume is safely below an eye52 units up, so it remains visible.
    const shouldSuppress=z>0||eyeHeight<52;
    assert.equal(near.vertices.length,full.vertices.length-(shouldSuppress?2*8*3*6*9:0));
    for(const farEye of [[eye[0],180,eye[2]],[100-120*si,eyeHeight,80+120*co],
      [100-150*co,eyeHeight,80-150*si]]) {
      assert.equal(Scene.actorMeshes(state,{...options,cockpitEye:farEye}).find(m=>m.actorId).vertices,full.vertices,
        'distant, high or laterally separated effects remain unchanged');
    }
  }
});
test('Cockpit eye motion reuses two bounded mesh variants and never changes ordinary Chase exhaust',()=>{
  const base=R.snapshot(R.create()),a={...base.actors[1],x:56,y:0,heading:0,z:28,airRamp:1,boosting:true,padTicks:0},
    state={...base,actors:[a]},options={course:c,catalog,nearest:R.nearest,calm:true},models=new Set();
  const chase=Scene.actorMeshes(state,options).find(m=>m.actorId).vertices;
  for(let x=-140;x<=80;x+=2) models.add(Scene.actorMeshes(state,{...options,cockpitEye:[x,34,0]}).find(m=>m.actorId).vertices);
  assert.equal(models.size,2,'eye movement cannot create per-frame geometry caches');
  assert.equal(Scene.actorMeshes(state,options).find(m=>m.actorId).vertices,chase);
  assert.equal(Scene.actorMeshes(state,{...options,cockpitEye:[NaN,0,0]}).find(m=>m.actorId).vertices,chase);
});
