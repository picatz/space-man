const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../src/race.js'), Art = require('../src/art.js');
const Scene = require('../src/race-scene.js'), Track = require('../src/race-track-mesh.js');

test('Starlight materials and glyphs are shared render-only values', () => {
  const c=R.course('starlight'), before=JSON.stringify(c), p=Art.circuitPalette(c);
  assert.equal(p.road,'#294052'); assert.equal(p.accent,'#bdeca2');
  assert.ok(Object.isFrozen(p)); assert.notEqual(p.edge,p.accent);
  for(const points of Object.values(Art.circuitGlyphs)) {
    assert.ok(Object.isFrozen(points)); assert.ok(points.every(p=>Object.isFrozen(p)&&p.every(Number.isFinite)));
  }
  assert.equal(Art.circuitGlyphs.coin.length,10);
  assert.ok(Math.max(...Art.circuitGlyphs.coin.flat().map(Math.abs))<=8.5);
  const ui=fs.readFileSync(require.resolve('../src/race-ui.js'),'utf8');
  assert.match(ui,/const shape=root\.SpaceManArt\.circuitGlyphs\[kind\]/);
  assert.match(ui,/for\(const forward of\[-40,-19\]\)/);
  assert.equal(JSON.stringify(c),before);
  for(const id of ['ember','bloom']) {
    const c=R.course(id);assert.equal(Art.circuitPalette(c).road,c.road);assert.equal(Art.circuitPalette(c).accent,c.accent);
  }
});
test('orbital structures are sparse, cached and clear of the entire physical corridor',()=>{
  const c=R.course('starlight'), before=JSON.stringify(c), a=Art.circuitStructures(c,R.at,Track.distance);
  assert.equal(a,Art.circuitStructures(c,R.at,Track.distance));assert.ok(Object.isFrozen(a));
  assert.equal(a.length,9);assert.deepEqual([...new Set(a.map(x=>x.kind))],['bay','relay','dock']);
  for(const s of a) {
    assert.ok(Math.hypot((s.width+6)/2,(s.depth+6)/2)<=s.radius);
    assert.ok(Track.distance(c,s.x,s.z)>=c.width/2+s.radius+(c.runoff||0)+40);
  }
  for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++)
    assert.ok(Math.hypot(a[i].x-a[j].x,a[i].z-a[j].z)>=a[i].radius+a[j].radius+24);
  const scene=Scene.course(c,R.at), props=scene.meshes.at(-1);
  assert.equal(scene.clearances.filter(x=>x.type==='landmark').length,9);
  assert.ok(props.vertices.length/9<=7854,'static scenery does not exceed the previous Starlight budget');
  assert.ok(props.vertices.every(Number.isFinite));assert.equal(JSON.stringify(c),before);
});
test('smaller solid rewards preserve airborne height and authoritative availability',()=>{
  const c=R.course('starlight'), state=R.snapshot(R.create()), before=JSON.stringify(state);
  const meshes=Scene.featureMeshes(state,c,R.at,R.features(c),{actorId:state.actors[0].id});
  const coins=meshes.filter(x=>x.featureKind==='coin');assert.equal(coins.length,10);
  for(const coin of coins) {assert.ok(coin.bounds.max[2]-coin.bounds.min[2]<=17);assert.ok(coin.bounds.max[0]-coin.bounds.min[0]<=16.01);}
  assert.ok(coins.some(x=>x.bounds.max[1]>50));assert.ok(coins.some(x=>x.bounds.max[1]<35));
  assert.equal(JSON.stringify(state),before);
});
test('architectural sidewalls face out and their fitted bevels face upward',()=>{
  const c=R.course('starlight'), v=Scene.course(c,R.at).meshes.at(-1).vertices;
  let checked=0,bevels=0;
  for(const s of Art.circuitStructures(c,R.at,Track.distance)) for(let i=0;i<v.length;i+=27) {
    const local=[];
    for(let j=0;j<3;j++) {const o=i+j*9,dx=v[o]-s.x,dz=v[o+2]-s.z;
      local.push([dx*Math.cos(s.heading)+dz*Math.sin(s.heading),v[o+1],-dx*Math.sin(s.heading)+dz*Math.cos(s.heading)]);}
    if(!local.every(([x,y,z])=>Math.abs(x)<=s.width/2+.001&&Math.abs(z)<=s.depth/2+.001&&y>=5&&y<=5+s.height)) continue;
    const ny=v[i+4];if(ny>.999)continue;
    const x=local.reduce((n,p)=>n+p[0],0)/3,z=local.reduce((n,p)=>n+p[2],0)/3,
      nx=v[i+3]*Math.cos(s.heading)+v[i+5]*Math.sin(s.heading),
      nz=-v[i+3]*Math.sin(s.heading)+v[i+5]*Math.cos(s.heading);
    assert.ok(nx*x+nz*z>0,'side/bevel normal points away from structure center');
    assert.ok(ny>=-1e-7,'bevel is not lit as an underside');checked++;if(ny>.01)bevels++;
  }
  assert.ok(checked>=288);assert.ok(bevels>=144);
});
test('shared glyph winding gives outward badge faces and upward approach signs',()=>{
  for(const shape of Object.values(Art.circuitGlyphs))
    assert.ok(shape.reduce((n,p,i)=>{const q=shape[(i+1)%shape.length];return n+p[0]*q[1]-p[1]*q[0]},0)>0);
  const c=R.course('starlight'),state=R.create();
  for(const m of Scene.featureMeshes(state,c,R.at,R.features(c),{actorId:state.actors[0].id})) {
    if(m.featureKind==='approach') for(let i=4;i<m.vertices.length;i+=9)assert.ok(m.vertices[i]>.99);
    if(!['coin','item'].includes(m.featureKind))continue;
    const v=m.vertices;
    for(let i=0;i<v.length;i+=27) {
      const x=v[i];if(Math.abs(x)<1.99||![-2.2,-2.08,-2,2,2.08].some(n=>Math.abs(n-x)<.001))continue;
      if(Math.abs(v[i+9]-x)>.001||Math.abs(v[i+18]-x)>.001)continue;
      assert.ok(v[i+3]*x>0,'each face points away from badge center');
    }
  }
});
test('station connections stay beyond runoff and the gantry clears every chase eye',()=>{
  const c=R.course('starlight'), links=Art.circuitConnections(c,R.at,Track.distance);
  assert.equal(links,Art.circuitConnections(c,R.at,Track.distance));assert.equal(links.length,6);
  for(const {a,b,width} of links) for(let n=0;n<=100;n++) {
    const x=a.x+(b.x-a.x)*n/100,z=a.z+(b.z-a.z)*n/100;
    assert.ok(Track.distance(c,x,z)>c.width/2+(c.runoff||0)+40+width/2);
  }
  const scene=Scene.course(c,R.at);
  for(const arch of scene.clearances.filter(x=>x.type==='arch'))assert.ok(arch.height-4>151+20);
  assert.ok(scene.meshes[0].vertices.length/9<=5376,'smooth planets retain the original sky tessellation');
});

test('every circuit takes its sky from a shared region of the Lantern Reach', () => {
  const regions = new Set();
  for (const id of ['starlight', 'ember', 'bloom', 'prism', 'aurora', 'neon', 'nebula']) {
    const sky = Art.circuitSky(R.course(id));
    assert.ok(Object.values(Art.REGIONS).some(r => r.name === sky.region), id);
    regions.add(sky.region);
    for (const key of ['top', 'horizon', 'glow', 'ground', 'haze']) assert.ok(sky[key].length === 3 && sky[key].every(n => n >= 0 && n <= 1), id + ' ' + key);
    const lum = c => c[0] * .3 + c[1] * .59 + c[2] * .11;
    assert.ok(lum(sky.glow) > lum(sky.horizon) && lum(sky.horizon) > lum(sky.top), id + ' brightens toward the horizon');
  }
  assert.equal(regions.size, 7, 'no two circuits share a sky');
  assert.equal(Art.circuitSky(R.course('ember')).region, 'Ember');
});

test('Aurora, Neon and Nebula each build their own scenery, clear of the physical corridor',()=>{
  const sizes={};
  for(const id of ['aurora','neon','nebula','forge']){
    const c=R.course(id),scene=Scene.course(c,R.at),marks=scene.clearances.filter(x=>x.type==='landmark');
    assert.ok(marks.length>=12,id+' keeps most landmark sites');
    for(const m of marks)assert.ok(Track.distance(c,m.x,m.z)>=c.width/2+m.radius,id+' landmark clears the road');
    const props=scene.meshes.at(-1).vertices.length/27;
    assert.ok(props<12000,id+' props stay inside the triangle budget: '+props);
    sizes[id]=scene.meshes.map(m=>m.vertices.length).join();
  }
  assert.equal(new Set(Object.values(sizes)).size,4,'circuits no longer share a skyline');
});

test('lantern seasons float lanterns over every circuit, and no season means none', () => {
  const Seasons = require('../src/seasons.js');
  const dusk = Seasons.at(new Date(2026, 9, 29, 12)), plain = Seasons.at(new Date(2026, 6, 1, 12));
  assert.ok(Art.circuitSky(R.course('neon'), dusk).lanterns > 0);
  assert.deepEqual(Art.circuitSky(R.course('neon'), dusk).lanternColor.map(n => Math.round(n * 255)), [255, 154, 77]);
  assert.equal(Art.circuitSky(R.course('neon'), plain).lanterns, 0);
});
