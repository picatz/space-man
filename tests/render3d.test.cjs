const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Render3D = require('../src/render3d.js');

const close = (actual, expected, epsilon = 1e-5) => assert.ok(Math.abs(actual - expected) <= epsilon,
  `${actual} should be within ${epsilon} of ${expected}`);
const closeArray = (actual, expected) => expected.forEach((value, i) => close(actual[i], value));
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const triangle = () => new Float32Array([
  -1, -1, 0, 0, 0, 1, 1, 0, 0,
   1, -1, 0, 0, 0, 1, 0, 1, 0,
   0,  1, 0, 0, 0, 1, 0, 0, 1
]);

// Exercise the real renderer against an instrumented WebGL contract. Browser
// smoke coverage remains responsible for rasterization and driver behavior.
function harness(options = {}) {
  const calls = [], listeners = new Map();
  let nextId = 0, boundBuffer = null;
  const gl = { lost: false, shaders: [], buffers: [], programs: [],
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, DYNAMIC_DRAW: 35048, FLOAT: 5126,
    DEPTH_TEST: 2929, LEQUAL: 515, BLEND: 3042, CULL_FACE: 2884, TRIANGLES: 4,
    COLOR_BUFFER_BIT: 16384, DEPTH_BUFFER_BIT: 256, MAX_RENDERBUFFER_SIZE: 34024,
    createShader(type) { const shader = { id: ++nextId, type }; this.shaders.push(shader); return shader; },
    shaderSource(shader, source) { shader.source = source; },
    getShaderParameter() { return !options.failCompile; },
    getShaderInfoLog() { return 'compile failed'; },
    createProgram() { const program = { id: ++nextId }; this.programs.push(program); return program; },
    getProgramParameter() { return !options.failLink; },
    getProgramInfoLog() { return 'link failed'; },
    getAttribLocation(_, name) { return { aPosition: 0, aNormal: 1, aColor: 2 }[name]; },
    getUniformLocation(_, name) { return name; },
    createBuffer() {
      if (options.failBuffer) return null;
      const buffer = { id: ++nextId }; this.buffers.push(buffer); return buffer;
    },
    bindBuffer(target, buffer) { boundBuffer = buffer; calls.push(['bindBuffer', target, buffer]); },
    bufferData(target, data, usage) {
      boundBuffer.capacity = typeof data === 'number' ? data : data.byteLength;
      calls.push(['bufferData', target, data, usage, boundBuffer]);
    },
    bufferSubData(target, offset, data) {
      assert.ok(data.byteLength + offset <= boundBuffer.capacity, 'stream upload fits allocation');
      calls.push(['bufferSubData', target, offset, data, boundBuffer]);
    },
    getParameter() { return options.maxSize || 4096; },
    isContextLost() { return this.lost; }
  };
  for (const name of ['compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'deleteProgram',
    'deleteBuffer', 'enable', 'depthFunc', 'depthMask', 'disable', 'clearDepth', 'viewport', 'clearColor',
    'clear', 'blendFunc', 'useProgram', 'uniformMatrix4fv', 'uniformMatrix3fv', 'uniform3fv', 'uniform2f', 'uniform1f',
    'enableVertexAttribArray', 'vertexAttribPointer', 'drawArrays']) {
    gl[name] = (...args) => calls.push([name, ...args]);
  }
  const canvas = { width: 320, height: 180,
    getContext(kind, attributes) {
      calls.push(['getContext', kind, attributes]);
      if (options.throwContext) throw new Error('context denied');
      return options.noContext ? null : gl;
    },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); }
  };
  return { gl, canvas, calls, listeners, count: name => calls.filter(call => call[0] === name).length,
    last: name => calls.filter(call => call[0] === name).at(-1),
    emit(name) {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      listeners.get(name)?.(event); return event;
    }
  };
}

test('exports load as a dependency-free browser global as well as CommonJS', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(require.resolve('../src/render3d.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.window.SpaceManRender3D).sort(), Object.keys(Render3D).sort());
  assert.equal(typeof context.window.SpaceManRender3D.create, 'function');
});

test('perspective maps the near and far planes to WebGL NDC and shrinks distant objects', () => {
  const m = Render3D.perspective(Math.PI / 2, 2, 1, 101);
  close(Render3D.project([0, 0, -1], m).z, -1);
  close(Render3D.project([0, 0, -101], m).z, 1);
  close(Render3D.project([2, 1, -1], m).x, 1);
  close(Render3D.project([2, 1, -1], m).y, 1);
  close(Render3D.project([2, 1, -2], m).x, 0.5);
  close(Render3D.project([2, 1, -2], m).y, 0.5);
  assert.equal(Render3D.project([0, 0, -1], m).visible, true);
  assert.equal(Render3D.project([0, 0, -101], m).visible, true);
});

test('projection clips behind-eye, side, near and far points without mirrored visibility', () => {
  const m = Render3D.perspective(Math.PI / 2, 1, 1, 10);
  for (const point of [[0, 0, 2], [0, 0, 0], [0, 0, -0.5], [0, 0, -11], [3, 0, -2], [0, 3, -2]]) {
    assert.equal(Render3D.project(point, m).visible, false, `clip ${point}`);
  }
  assert.equal(Render3D.project({ x: 0, y: 0, z: -2 }, m).visible, true);
  assert.ok(Number.isNaN(Render3D.project([0, 0, 0], m).x));
});

test('perspective validates invalid lenses and supports an infinite far plane', () => {
  for (const args of [[0, 1, 1, 10], [Math.PI, 1, 1, 10], [1, 0, 1, 10],
    [1, 1, 0, 10], [1, 1, 10, 1], [NaN, 1, 1, 10], [1, Infinity, 1, 10]]) {
    assert.throws(() => Render3D.perspective(...args), RangeError);
  }
  const m = Render3D.perspective(1, 1, 1, Infinity);
  assert.ok(Array.from(m).every(Number.isFinite));
  close(Render3D.project([0, 0, -1], m).z, -1);
  assert.equal(Render3D.project([0, 0, -1000000], m).visible, true);
});

test('lookAt and cameraFrame agree for translated, rotated and degenerate cameras', () => {
  const cases = [
    [[0, 0, 5], [0, 0, 0], [0, 1, 0]],
    [[7, 3, -5], [-3, 2, 12], [0, 1, 0]],
    [[0, 0, 0], [0, 4, 0], [0, 1, 0]],
    [[1, 2, 3], [1, 2, 3], [0, 0, 0]]
  ];
  for (const [eye, target, up] of cases) {
    const frame = Render3D.cameraFrame(eye, target, up), view = Render3D.lookAt(eye, target, up);
    assert.ok(Array.from(view).every(Number.isFinite));
    for (const axis of Object.values(frame)) close(Math.hypot(...axis), 1);
    close(frame.right.reduce((sum, value, i) => sum + value * frame.up[i], 0), 0);
    const eyeView = Render3D.project(eye, view);
    closeArray([eyeView.x, eyeView.y, eyeView.z], [0, 0, 0]);
    const ahead = eye.map((value, i) => value + 4 * frame.forward[i]);
    const point = Render3D.project(ahead, view);
    closeArray([point.x, point.y, point.z], [0, 0, -4]);
    const right = Render3D.project(eye.map((value, i) => value + frame.right[i]), view);
    closeArray([right.x, right.y, right.z], [1, 0, 0]);
  }
});

test('multiply composes model/view/projection in column-major order without mutating inputs', () => {
  const model = identity(); model[12] = 4; model[13] = 2; model[14] = -3;
  const view = Render3D.lookAt([4, 2, 7], [4, 2, 0]);
  const proj = Render3D.perspective(Math.PI / 2, 1, 1, 100);
  const original = Array.from(model);
  const mvp = Render3D.multiply(Render3D.multiply(proj, view), model);
  const screen = Render3D.project([1, 1, 0], mvp);
  close(screen.x, 0.1); close(screen.y, 0.1);
  assert.equal(screen.visible, true);
  assert.deepEqual(Array.from(model), original);
  closeArray(Render3D.multiply(identity(), view), view);
});

test('chase and low cockpit ground remain in front and below center across headings and aspect ratios', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.3]) {
    for (const aspect of [16 / 9, 9 / 16]) {
      for (const cockpit of [false, true]) {
        const fx = Math.cos(heading), fz = Math.sin(heading), distance = cockpit ? -6 : 132;
        const eye = [2000 - distance * fx, cockpit ? 22 : 94, -1000 - distance * fz];
        const look = cockpit ? 360 : 270;
        const target = [eye[0] + look * fx, cockpit ? 17 : 4, eye[2] + look * fz];
        const vp = Render3D.multiply(Render3D.perspective((cockpit ? 68 : 59) * Math.PI / 180, aspect, 2, 6500),
          Render3D.lookAt(eye, target));
        const road = Render3D.project([2000 + 100 * fx, 0, -1000 + 100 * fz], vp);
        assert.equal(road.visible, true);
        close(road.x, 0, 1e-5);
        assert.ok(road.y < 0 && road.y > -0.5, 'ground sits in the lower center of either view');
      }
    }
  }
});

test('create fails safely without a GPU and frees partially compiled resources', () => {
  assert.equal(Render3D.create(null), null);
  assert.equal(Render3D.create({}), null);
  for (const option of ['noContext', 'throwContext', 'failCompile', 'failLink', 'failBuffer']) {
    const h = harness({ [option]: true });
    assert.equal(Render3D.create(h.canvas), null, option);
    assert.equal(h.listeners.size, 0, 'failed creation leaves no listeners');
    assert.equal(h.count('deleteShader'), h.gl.shaders.length, 'all allocated shaders deleted');
    assert.equal(h.count('deleteProgram'), h.gl.programs.length, 'all allocated programs deleted');
  }
});

test('renderer requests depth and modest antialias, caps DPR, and preserves aspect at GPU limits', () => {
  const h = harness({ maxSize: 1024 }), renderer = Render3D.create(h.canvas);
  assert.equal(renderer.status, 'ready');
  const attributes = h.last('getContext')[2];
  assert.equal(attributes.depth, true); assert.equal(attributes.antialias, true);
  assert.equal(attributes.preserveDrawingBuffer, false);
  assert.ok(h.calls.some(call => call[0] === 'enable' && call[1] === h.gl.DEPTH_TEST));
  assert.ok(h.calls.some(call => call[0] === 'disable' && call[1] === h.gl.CULL_FACE), 'both windings remain visible');
  assert.deepEqual(h.last('depthFunc'), ['depthFunc', h.gl.LEQUAL]);
  renderer.resize(300, 200, 4);
  assert.equal(h.canvas.width, 600); assert.equal(h.canvas.height, 400);
  renderer.resize(2000, 1000, 2);
  assert.equal(h.canvas.width, 1024); assert.equal(h.canvas.height, 512);
  assert.deepEqual(h.last('viewport'), ['viewport', 0, 0, 1024, 512]);
  renderer.dispose();
  const low = harness(), lowRenderer = Render3D.create(low.canvas, { powerSaving: true });
  lowRenderer.resize(300, 200, 3);
  assert.equal(low.canvas.width, 300); assert.equal(low.canvas.height, 200);
  assert.equal(low.last('getContext')[2].antialias, false);
  assert.equal(low.last('getContext')[2].powerPreference, 'low-power');
  lowRenderer.dispose();
});

test('draw uploads perspective, diffuse-lit triangle attributes, camera and distance fog', () => {
  const h = harness(), renderer = Render3D.create(h.canvas);
  const eye = [4, 5, 6], target = [0, 0, 0], vertices = triangle();
  renderer.resize(400, 200, 1);
  assert.equal(renderer.draw({ camera: { eye, target, fov: 1, near: 0.5, far: 400 },
    background: [0.1, 0.2, 0.3], fog: { color: [0.2, 0.3, 0.4], near: 25, far: 100 },
    meshes: [{ vertices }] }), true);
  assert.deepEqual(h.last('clear'), ['clear', h.gl.COLOR_BUFFER_BIT | h.gl.DEPTH_BUFFER_BIT]);
  assert.deepEqual(h.last('clearColor'), ['clearColor', 0.1, 0.2, 0.3, 1]);
  assert.deepEqual(h.last('drawArrays'), ['drawArrays', h.gl.TRIANGLES, 0, 3]);
  assert.deepEqual(h.calls.filter(call => call[0] === 'vertexAttribPointer'), [
    ['vertexAttribPointer', 0, 3, h.gl.FLOAT, false, 36, 0],
    ['vertexAttribPointer', 1, 3, h.gl.FLOAT, false, 36, 12],
    ['vertexAttribPointer', 2, 3, h.gl.FLOAT, false, 36, 24]
  ]);
  const matrix = h.calls.find(call => call[0] === 'uniformMatrix4fv' && call[1] === 'uViewProjection')[3];
  closeArray(matrix, Render3D.multiply(Render3D.perspective(1, 2, 0.5, 400), Render3D.lookAt(eye, target)));
  assert.deepEqual(h.last('uniform2f'), ['uniform2f', 'uFogRange', 25, 100]);
  assert.deepEqual(h.calls.find(call => call[0] === 'uniform3fv' && call[1] === 'uEye'), ['uniform3fv', 'uEye', eye]);
  assert.match(h.gl.shaders[0].source, /diffuse/);
  assert.match(h.gl.shaders[0].source, /length\(world.xyz - uEye\)/);
  assert.match(h.gl.shaders[1].source, /smoothstep/);
  renderer.dispose();
});

test('static geometry caches by vertex-array identity while mutable geometry streams and grows', () => {
  const h = harness(), renderer = Render3D.create(h.canvas), vertices = triangle();
  const scene = () => ({ meshes: [{ vertices, static: true }] });
  renderer.draw(scene()); renderer.draw(scene());
  assert.equal(h.count('bufferData'), 1, 'new descriptors reuse the immutable GPU buffer');
  assert.equal(h.count('bufferSubData'), 0);
  renderer.draw({ meshes: [{ vertices }] }); vertices[0] = -2;
  renderer.draw({ meshes: [{ vertices }] });
  assert.equal(h.count('bufferData'), 2, 'one streaming allocation reused');
  assert.equal(h.count('bufferSubData'), 2, 'each mutable draw uploads current vertices');
  renderer.draw({ meshes: [{ vertices: new Float32Array(27 * 100) }] });
  assert.equal(h.count('bufferData'), 3, 'stream grows to fit larger geometry');
  assert.equal(h.count('bufferSubData'), 3);
  assert.equal(h.gl.buffers.length, 2, 'only one streaming and one static buffer');
  renderer.dispose();
  assert.equal(h.count('deleteBuffer'), 2);
});

test('unused static geometry is reclaimed and can be uploaded again', () => {
  const h = harness(), renderer = Render3D.create(h.canvas), vertices = triangle();
  renderer.draw({ meshes: [{ vertices, static: true }] });
  for (let i = 0; i < 180; i++) renderer.draw({ meshes: [] });
  assert.equal(h.count('deleteBuffer'), 1);
  renderer.draw({ meshes: [{ vertices, static: true }] });
  assert.equal(h.count('bufferData'), 2);
  renderer.dispose();
});

test('non-uniform model transforms use an inverse-transpose normal matrix', () => {
  const h = harness(), renderer = Render3D.create(h.canvas), model = identity();
  model[0] = 2; model[5] = 3; model[10] = 4; model[12] = 50;
  renderer.draw({ meshes: [{ vertices: triangle(), model }] });
  closeArray(h.last('uniformMatrix3fv')[3], [0.5, 0, 0, 0, 1 / 3, 0, 0, 0, 0.25]);
  const angle = Math.PI / 3, c = Math.cos(angle), s = Math.sin(angle);
  model[0] = 2 * c; model[1] = 2 * s; model[4] = -3 * s; model[5] = 3 * c;
  renderer.draw({ meshes: [{ vertices: triangle(), model }] });
  closeArray(h.last('uniformMatrix3fv')[3], [c / 2, s / 2, 0, -s / 3, c / 3, 0, 0, 0, 0.25]);
  model[0] = model[1] = 0;
  renderer.draw({ meshes: [{ vertices: triangle(), model }] });
  assert.ok(Array.from(h.last('uniformMatrix3fv')[3]).every(Number.isFinite), 'singular model remains finite');
  renderer.dispose();
});

test('context loss pauses drawing, prevents default, and rebuilds every resource on restore', () => {
  const h = harness(), notifications = [], renderer = Render3D.create(h.canvas, {
    onLost: value => notifications.push(['lost', value.status]),
    onRestored: value => notifications.push(['restored', value.status])
  });
  const vertices = triangle(), scene = { meshes: [{ vertices, static: true }] };
  renderer.draw(scene); renderer.resize(640, 360, 2);
  const originalProgram = h.gl.programs[0], drawCount = h.count('drawArrays');
  h.gl.lost = true;
  assert.equal(h.emit('webglcontextlost').prevented, true);
  assert.equal(renderer.status, 'lost'); assert.equal(renderer.draw(scene), false);
  assert.equal(h.count('drawArrays'), drawCount);
  assert.equal(h.count('deleteBuffer'), 0, 'lost resources are invalid, not explicitly deleted');
  h.emit('webglcontextlost');
  assert.deepEqual(notifications, [['lost', 'lost']], 'loss callback is not repeated');
  renderer.resize(300, 200, 1.5);
  h.gl.lost = false; h.emit('webglcontextrestored');
  assert.equal(renderer.status, 'ready');
  assert.deepEqual(notifications, [['lost', 'lost'], ['restored', 'ready']]);
  assert.equal(h.canvas.width, 450); assert.equal(h.canvas.height, 300);
  assert.notEqual(h.gl.programs.at(-1), originalProgram);
  assert.equal(renderer.draw(scene), true);
  assert.equal(h.count('bufferData'), 2, 'static cache is rebuilt after context restoration');
  renderer.dispose(); renderer.dispose();
  assert.equal(h.listeners.size, 0);
  assert.equal(renderer.status, 'disposed');
  assert.equal(renderer.draw(scene), false); assert.equal(renderer.resize(1, 1, 1), false);
  assert.equal(h.count('deleteProgram'), 1, 'dispose is idempotent');
  assert.equal(h.count('deleteBuffer'), 2);
});

test('loss detected before the browser event still permits restoration and disposal', () => {
  const h = harness(), renderer = Render3D.create(h.canvas, { onLost() { throw new Error('consumer'); } });
  h.gl.lost = true;
  assert.equal(renderer.draw(), false); assert.equal(renderer.status, 'lost');
  assert.equal(h.emit('webglcontextlost').prevented, true);
  renderer.dispose();
  assert.equal(h.count('deleteBuffer'), 0);
  assert.equal(h.listeners.size, 0);
});

test('failed restoration and draw exceptions surface a failed state without leaking resources', () => {
  const options = {}, h = harness(options), renderer = Render3D.create(h.canvas);
  h.emit('webglcontextlost'); options.failCompile = true;
  h.emit('webglcontextrestored');
  assert.equal(renderer.status, 'failed'); assert.match(renderer.error.message, /compile failed/);
  assert.equal(renderer.draw(), false); renderer.dispose();
  const other = harness(), r = Render3D.create(other.canvas);
  other.gl.drawArrays = () => { throw new Error('draw failed'); };
  assert.equal(r.draw({ meshes: [{ vertices: triangle() }] }), false);
  assert.equal(r.status, 'failed'); assert.equal(r.error.message, 'draw failed');
  assert.equal(other.count('deleteBuffer'), 1); assert.equal(other.count('deleteProgram'), 1);
  r.dispose(); assert.equal(other.count('deleteProgram'), 1);
});

test('malformed or empty geometry is skipped and partial triangles never overrun a buffer', () => {
  const h = harness(), renderer = Render3D.create(h.canvas);
  renderer.resize(0, NaN, Infinity);
  assert.equal(h.canvas.width, 1); assert.equal(h.canvas.height, 1);
  assert.equal(renderer.draw({ camera: { fov: NaN, near: -10, far: 0 },
    meshes: [null, {}, { vertices: [] }, { vertices: new Int32Array(27) },
      { vertices: new Float32Array(0) }, { vertices: new Float32Array(35) }] }), true);
  assert.equal(h.count('drawArrays'), 1);
  assert.deepEqual(h.last('drawArrays'), ['drawArrays', h.gl.TRIANGLES, 0, 3]);
  const matrix = h.calls.find(call => call[0] === 'uniformMatrix4fv' && call[1] === 'uViewProjection')[3];
  assert.ok(Array.from(matrix).every(Number.isFinite));
  renderer.dispose();
});

test('conservative box culling covers all clip planes and preserves straddling geometry',()=>{
 const m=Render3D.multiply(Render3D.perspective(Math.PI/2,1,1,100),Render3D.lookAt([0,0,0],[0,0,-1]));
 const box=(min,max)=>({min,max});
 assert.equal(Render3D.boxVisible(box([-1,-1,-6],[1,1,-4]),m),true);
 for(const b of [box([-1,-1,2],[1,1,4]),box([30,-1,-6],[32,1,-4]),box([-32,-1,-6],[-30,1,-4]),box([-1,30,-6],[1,32,-4]),box([-1,-32,-6],[1,-30,-4]),box([-1,-1,-120],[1,1,-110]),box([-.1,-.1,-.8],[.1,.1,-.2])])assert.equal(Render3D.boxVisible(b,m),false);
 assert.equal(Render3D.boxVisible(box([-1,-1,-2],[1,1,-.5]),m),true);
 assert.equal(Render3D.boxVisible(box([-20,-20,-20],[20,20,20]),m),true);
 assert.equal(Render3D.boxVisible(null,m),true);assert.equal(Render3D.boxVisible(box([NaN,0,0],[1,1,1]),m),true);
});
test('offscreen bounded meshes skip GPU uploads while unbounded geometry and visible models still draw',()=>{
 const h=harness(),renderer=Render3D.create(h.canvas),v=triangle();
 const camera={eye:[0,0,0],target:[0,0,-1],near:1,far:100};
 const behind={min:[-1,-1,3],max:[1,1,5]};
 renderer.draw({camera,meshes:[{vertices:v,static:true,bounds:behind}]});
 assert.equal(h.count('drawArrays'),0);assert.equal(h.count('bufferData'),0);
 const model=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,-10,1]);
 renderer.draw({camera,meshes:[{vertices:v,static:true,bounds:behind,model}]});
 assert.equal(h.count('drawArrays'),1);assert.equal(h.count('bufferData'),1);
 renderer.draw({camera,meshes:[{vertices:v,static:true}]});assert.equal(h.count('drawArrays'),2);renderer.dispose();
});

test('only explicitly marked LED meshes bypass diffuse light and keep ordinary fog/depth', () => {
  const h=harness(),renderer=Render3D.create(h.canvas),vertices=triangle();
  assert.equal(renderer.draw({meshes:[{vertices},{vertices,emissive:true},{vertices},{vertices,emissive:1}]}),true);
  assert.deepEqual(h.calls.filter(c=>c[0]==='uniform1f'&&c[1]==='uEmissive').map(c=>c[2]),[0,1,0,0]);
  assert.match(h.gl.shaders[0].source,/mix\(0.42 \+ 0.58 \* diffuse, 1.0, uEmissive\)/);
  assert.match(h.gl.shaders[1].source,/mix\(vColor, uFogColor, fog\)/);
  assert.ok(h.calls.some(c=>c[0]==='enable'&&c[1]===h.gl.DEPTH_TEST));renderer.dispose();
});


test('translucent ship shadows and engine wakes restore opaque depth and material state',()=>{
 const h=harness(),r=Render3D.create(h.canvas),vertices=triangle();
 assert.equal(r.draw({meshes:[{vertices},{vertices,opacity:.28,softShadow:true,emissive:true},{vertices,opacity:.85,tailFade:true,emissive:true},{vertices}]}),true);
 for(const [uniform,values] of [['uOpacity',[1,1,.28,.85]],['uSoftShadow',[0,0,1,0]],['uTailFade',[0,0,0,1]]])
  assert.deepEqual(h.calls.filter(c=>c[0]==='uniform1f'&&c[1]===uniform).map(c=>c[2]),values);
 assert.deepEqual(h.calls.filter(c=>c[0]==='depthMask').slice(-5).map(c=>c[1]),[true,true,false,false,true]);
 assert.equal(h.count('blendFunc'),2);r.dispose();
});


test('all opaque hulls precede view-depth-sorted wakes independent of input order',()=>{
 const h=harness(),r=Render3D.create(h.canvas),order=[],draw=h.gl.drawArrays;
 h.gl.drawArrays=(...args)=>{const buffer=h.calls.filter(c=>c[0]==='bindBuffer').at(-1)[2],upload=h.calls.find(c=>c[0]==='bufferData'&&c[4]===buffer);order.push(upload[2]);draw(...args);};
 const mesh=(z,opacity=1)=>({vertices:triangle(),static:true,opacity,model:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,z,1])});
 const nearWake=mesh(-3,.3),farHull=mesh(-8),farWake=mesh(-9,.3),frontHull=mesh(-2);
 assert.equal(r.draw({camera:{eye:[0,0,0],target:[0,0,-1]},meshes:[nearWake,farHull,farWake,frontHull]}),true);
 assert.deepEqual(order,[farHull.vertices,frontHull.vertices,farWake.vertices,nearWake.vertices]);
 order.length=0;
 assert.equal(r.draw({camera:{eye:[0,0,-12],target:[0,0,0]},meshes:[farWake,frontHull,nearWake,farHull]}),true);
 assert.deepEqual(order,[frontHull.vertices,farHull.vertices,nearWake.vertices,farWake.vertices],'reversing the eye reverses effect depth, not the roster');
 r.dispose();
});
