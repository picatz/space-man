const test=require('node:test'),assert=require('node:assert/strict');
const Camera=require('../src/race-camera.js'),Scene=require('../src/race-scene.js'),R=require('../src/race.js');
test('perspective cameras use snapshot position and preserve immutable simulation',()=>{
 const s=R.snapshot(R.create()),before=JSON.stringify(s),c=R.course(s.trackId),cam=Camera.create(),a=s.actors[0];
 const chase=cam.update(a,c,R.at,{mode:'chase',reduceMotion:true});
 assert.ok(chase.eye[1]>50);assert.ok((a.x-chase.eye[0])*Math.cos(a.heading)+(a.y-chase.eye[2])*Math.sin(a.heading)>100);
 const cockpit=cam.update(a,c,R.at,{mode:'cockpit'});assert.equal(cockpit.eye[1],22);assert.ok(cockpit.target[1]<cockpit.eye[1]);
 const art=Scene.course(c,R.at),moving=Scene.actors(s);assert.equal(art.meshes.length,2);assert.ok(moving.vertices.length>100);
 for(const mesh of [...art.meshes,moving]){assert.equal(mesh.vertices.length%9,0);assert.ok(mesh.vertices.every(Number.isFinite));}
 assert.equal(JSON.stringify(s),before);
});
test('camera reset snaps after recovery and actor/mode switch, with no roll or speed zoom in reduced motion',()=>{
 const c=R.course('starlight'),a=R.create().actors[0],cam=Camera.create();cam.update(a,c,R.at,{});
 const b={...a,x:a.x+500,heading:a.heading+1,recoveries:1};const frame=cam.update(b,c,R.at,{});
 assert.ok(Math.abs(frame.eye[0]-(b.x-Math.cos(b.heading)*132))<1e-7);
 const stable=cam.update({...b,speed:100},c,R.at,{reduceMotion:true});assert.equal(stable.fov,59*Math.PI/180);
 cam.reset();assert.deepEqual(cam.update(b,c,R.at,{}),frame);
});
test('all authored tracks build finite render-only geometry',()=>{for(const track of R.tracks){const mesh=Scene.course(R.course(track.id),R.at);assert.ok(mesh.meshes.every(m=>m.static&&m.vertices.every(Number.isFinite)));}});
