const test=require('node:test'), assert=require('node:assert/strict');
const R=require('../src/race'),O=require('../src/race-online'),Scene=require('../src/race-scene'),Art=require('../src/art'),Mesh=require('../src/race-track-mesh');
const c=R.course('prism'),catalog=R.features(c);
const commands=s=>Object.fromEntries(s.actors.map(a=>[a.id,R.cpuInput(s,a)]));
test('Prism appends wire ID 3 with a medium, genuinely wider physical route and bounded catalog',()=>{
  assert.deepEqual(R.tracks.map(t=>t.id),['starlight','ember','bloom','prism']);
  assert.ok(c.length>4200&&c.length<4400);assert.equal(c.width,208);
  assert.ok(c.segments.every(s=>s.length>0&&Number.isFinite(s.tx+s.ty)));
  assert.equal(catalog.ramps.length,1);assert.equal(catalog.coins.length,6);assert.equal(catalog.rows.length,1);
  assert.ok(Object.isFrozen(catalog.ramps[0])&&Object.isFrozen(c.architecture.gallery));
  for(const entry of [...catalog.ramps,...catalog.rows])assert.equal(Math.floor(entry.s/c.length*20),entry.gate);
  const r=catalog.ramps[0];assert.equal(r.width,c.width);
  const before=R.at(c,r.startS-150),after=R.at(c,r.s+300);
  assert.ok(Math.abs(Math.atan2(before.tx*after.ty-before.ty*after.tx,before.tx*after.tx+before.ty*after.ty))<.4,'launch and landing occupy a shallow straight');
  for(let s=r.startS;s<=r.s+300;s+=8)assert.ok(R.nearest(c,...Object.values(R.at(c,s)).slice(0,2)).distance<.001,'the visible road is continuous through landing');
});
for(const difficulty of ['easy','normal','hard'])test(`Prism ${difficulty}: all six CPU pilots complete three real laps with no rescue`,()=>{
  const s=R.create({trackId:'prism',difficulty,count:6});s.actors.forEach(a=>a.controller='cpu');
  const counts={};let ticks=0;
  while(s.phase!=='finished'&&ticks++<18000){R.step(s,commands(s));for(const e of s.events)counts[e.type]=(counts[e.type]||0)+1;}
  assert.equal(s.phase,'finished');assert.ok(s.actors.every(a=>a.passed===60&&a.finishTick>600&&!a.dnf&&a.recoveries===0),JSON.stringify(s.actors.map(a=>[a.passed,a.recoveries])));
  assert.ok(counts.jump>=12,JSON.stringify(counts));assert.equal(counts.jump,counts.land);assert.ok(counts.pad>0&&counts.coin>0);
});
test('Prism replay is deterministic; finish/rescue and lap masks remain authoritative',()=>{
  const a=R.create({trackId:'prism',count:2}),b=R.create({trackId:'prism',count:2});
  for(let tick=0;tick<3500;tick++){const input=commands(a);if(tick===390)input[a.actors[0].id]={recover:true};R.step(a,input);R.step(b,input);}
  assert.deepEqual(R.snapshot(a),R.snapshot(b));assert.ok(a.actors[0].recoveries===1);
});
test('Prism snapshots round trip a complete authoritative race and reject every out-of-catalog mask',()=>{
  const h=O.createHost({trackId:'prism'});h.syncRoster([{p:1,identity:'host',role:0}],0);h.start();
  let ticks=0,jumps=0;const client=O.createClient();client.accept(h.packet(),1);
  while(h.state.phase!=='finished'&&ticks++<18000){
    const cmd=R.cpuInput(h.state,h.state.actors[0]);if(ticks%3===1){client.accept(h.packet(),1);assert.ok(h.receive(1,"host",client.input(cmd,1),h.state.tick*1000/60));}h.step(h.state.tick*1000/60);
    if(h.state.events.some(e=>e.type==='jump'))jumps++;
    const packet=h.packet(),decoded=O.decodeSnapshot(packet);assert.ok(decoded,'valid snapshot at '+ticks);assert.equal(decoded.state.trackId,'prism');
    assert.ok(packet.length<=O.MAX_BYTES);
    if(ticks===200){for(const [offset,value] of [[65,64],[67,2],[68,2],[69,2]]){const bad=packet.slice();bad[O.HEADER_BYTES+offset]=value;assert.equal(O.decodeSnapshot(bad),null);}
      for(const [offset,value] of [[16,4],[29,1]]){const bad=packet.slice();bad[offset]=value;assert.equal(O.decodeSnapshot(bad),null);}}
  }
  assert.equal(h.state.phase,'finished');assert.ok(jumps>0);assert.equal(h.state.actors[0].passed,60);
});
test('Prism shared architecture has safe footprint, a high open-sided gallery and separate top-down cutaway',()=>{
  const s=Scene.course(c,R.at),forms=Art.circuitStructures(c,R.at,Mesh.distance);
  const edgeClear=(a,b)=>{const count=Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/8);
    for(let n=0;n<=count;n++){const u=count?n/count:0;
      assert.ok(Mesh.distance(c,a[0]+(b[0]-a[0])*u,a[2]+(b[2]-a[2])*u)>=c.width/2+c.runoff+40,'entire shelf/mesa edge clears course');}};
  for(const shelf of Art.circuitCanyonShelves(c,R.at,Mesh.distance))for(let i=0;i<shelf.length-1;i++)for(let lane=0;lane<3;lane++){
    const poly=[shelf[i][lane],shelf[i+1][lane],shelf[i+1][lane+1],shelf[i][lane+1]];
    for(let j=0;j<4;j++)edgeClear(poly[j],poly[(j+1)%4]);edgeClear(poly[0],poly[2]);}
  for(const form of forms)for(const ring of Art.circuitMesaRings(form))for(let i=0;i<8;i++)edgeClear(ring[i],ring[(i+1)%8]);
  assert.equal(Art.circuitCanyonShelves(c,R.at,Mesh.distance).length,3);
  for(const shelf of Art.circuitCanyonShelves(c,R.at,Mesh.distance)) for(const section of shelf) for(const [x,y,z]of section)
    assert.ok(Mesh.distance(c,x,z)>=c.width/2+c.runoff+71);
  for(const form of forms)for(const ring of Art.circuitMesaRings(form))for(const [x,y,z]of ring)
    assert.ok(Mesh.distance(c,x,z)>=c.width/2+c.runoff+40,'visible rock geometry clears road');
  assert.equal(forms.length,10);assert.ok(forms.every(f=>f.kind==='mesa'));
  for(const f of forms)assert.ok(Mesh.distance(c,f.x,f.z)>=c.width/2+f.radius+c.runoff+40);
  assert.ok(s.meshes.some(m=>m.vertices.some((v,i)=>i%9===1&&v===-80)), "shelf boundary skirts close the visible rock volume");
  assert.equal(s.roofMeshes.length,1);const roof=s.roofMeshes[0];assert.ok(roof.bounds.min[1]>=210);
  assert.ok(!s.meshes.includes(roof));assert.equal(s.clearances.filter(f=>f.type==='gallery').length,12);
  for(const f of s.clearances)assert.ok(Mesh.distance(c,f.x,f.z)>=c.width/2+c.runoff+28+f.radius-1,JSON.stringify(f));
  let ceiling=0,roofTop=0;
  for(let i=0;i<roof.vertices.length;i+=27){const triangle=[0,9,18].map(k=>roof.vertices[i+k+1]);
    if(triangle.every(y=>y===220)){assert.ok(roof.vertices[i+4]<-.99);ceiling++;}
    if(triangle.every(y=>y===224)&&Math.abs(roof.vertices[i+4])>.99){assert.ok(roof.vertices[i+4]>.99);roofTop++;}}
  assert.ok(ceiling>0&&roofTop>0);
  assert.ok(roof.vertices.every(Number.isFinite));assert.ok(roof.vertices.length/9<700);
});

test('Prism gallery roof stays above the forward road sightline through camera resets and hops',()=>{
  const Camera=require('../src/race-camera'),roof=Scene.course(c,R.at).roofMeshes[0],g=c.architecture.gallery;
  const camera=Camera.create();
  for(const aspect of [320/568,390/844,568/320,844/390,820/1180,1280/720])
    for(const mode of ['chase','cockpit'])for(const reduceMotion of [false,true])
      for(const s of [g.start*c.length-250,g.start*c.length,(g.start+g.end)*c.length/2,g.end*c.length+250])
        for(const z of [0,29.24]){
          const p=R.at(c,s),actor={...R.create({trackId:'prism',count:1}).actors[0],x:p.x,y:p.y,
            heading:Math.atan2(p.ty,p.tx),vx:p.tx*9,vy:p.ty*9,speed:9,z,airRamp:z?1:0};
          camera.reset();const view=camera.update(actor,c,R.at,{aspect,mode,reduceMotion});
          assert.ok(view.eye[1]<=151&&view.target[1]<=25);
          assert.ok(Math.max(view.eye[1],view.target[1])+50<roof.bounds.min[1],
            'eye-to-forward-road segment remains below the roof, including after view reset');
        }
});
