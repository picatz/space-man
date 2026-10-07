/* Small, dependency-free WebGL 1 scene renderer. Presentation only.
   Matrices are column-major; coordinates are right-handed and Y-up. Camera
   fov is in radians. Meshes contain triangles, with position/normal/RGB per
   vertex (nine floats). Mark only immutable vertex arrays as static. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpaceManRender3D = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const EPS = 1e-8;
  const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const IDENTITY_NORMAL = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function vector(v, fallback) {
    if (!v) return fallback.slice();
    return [finite(v[0] === undefined ? v.x : v[0], fallback[0]),
      finite(v[1] === undefined ? v.y : v[1], fallback[1]),
      finite(v[2] === undefined ? v.z : v[2], fallback[2])];
  }
  function normalize(v, fallback) {
    const length = Math.hypot(v[0], v[1], v[2]);
    return length > EPS ? v.map(n => n / length) : fallback.slice();
  }

  function perspective(fovRadians, aspect, near, far) {
    if (!(Number.isFinite(fovRadians) && fovRadians > 0 && fovRadians < Math.PI &&
        Number.isFinite(aspect) && aspect > 0 && Number.isFinite(near) && near > 0 &&
        (Number.isFinite(far) || far === Infinity) && far > near)) {
      throw new RangeError('Perspective requires 0 < fov < PI, aspect > 0 and 0 < near < far');
    }
    const f = 1 / Math.tan(fovRadians / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[11] = -1;
    m[10] = far === Infinity ? -1 : (far + near) / (near - far);
    m[14] = far === Infinity ? -2 * near : (2 * far * near) / (near - far);
    return m;
  }

  function cameraFrame(eye, target, up) {
    const e = vector(eye, [0, 0, 0]), t = vector(target, [0, 0, -1]);
    const forward = normalize([t[0] - e[0], t[1] - e[1], t[2] - e[2]], [0, 0, -1]);
    let vertical = normalize(vector(up, [0, 1, 0]), [0, 1, 0]);
    // A vertical camera must still have a well-defined, finite basis.
    if (Math.abs(dot(forward, vertical)) > 0.9999) {
      vertical = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    }
    const right = normalize(cross(forward, vertical), [1, 0, 0]);
    return { right, up: normalize(cross(right, forward), [0, 1, 0]), forward };
  }

  function lookAt(eye, target, up) {
    const e = vector(eye, [0, 0, 0]), frame = cameraFrame(e, target, up);
    const r = frame.right, u = frame.up, f = frame.forward;
    return new Float32Array([
      r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
      -dot(r, e), -dot(u, e), dot(f, e), 1
    ]);
  }

  // a * b: transform by b first, then a. `out` (optional, must not alias a or b) lets
  // a per-frame caller reuse one scratch matrix instead of allocating.
  function multiply(a, b, out) {
    out = out || new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  function project(point, viewProjection) {
    const p = vector(point, [0, 0, 0]), m = viewProjection;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    const usable = Number.isFinite(w) && Math.abs(w) > EPS;
    // Float32 matrix rounding can put points exactly on a clip plane just out.
    const edge = w + Math.max(1, Math.abs(w)) * 1e-6;
    return { x: usable ? x / w : NaN, y: usable ? y / w : NaN, z: usable ? z / w : NaN, w,
      visible: usable && w > 0 && Math.abs(x) <= edge && Math.abs(y) <= edge && Math.abs(z) <= edge };
  }

  // Inverse-transpose of the model's upper 3x3. Writes into `out` when given
  // (the identity fallback is a shared read-only constant).
  function normalMatrix(m, out) {
    const a = [m[0], m[1], m[2]], b = [m[4], m[5], m[6]], c = [m[8], m[9], m[10]];
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b), det = dot(a, bc);
    if (!Number.isFinite(det) || Math.abs(det) < EPS) return IDENTITY_NORMAL;
    out = out || new Float32Array(9);
    out[0] = bc[0] / det; out[1] = bc[1] / det; out[2] = bc[2] / det;
    out[3] = ca[0] / det; out[4] = ca[1] / det; out[5] = ca[2] / det;
    out[6] = ab[0] / det; out[7] = ab[1] / det; out[8] = ab[2] / det;
    return out;
  }

  // Streamed (non-static) meshes rotate through a small ring of buffers so a
  // re-upload never rewrites a buffer an earlier draw in flight is still reading.
  const STREAM_RING = 4;
  // Capacity for `bytes` of vertices: a power of two, at least 1 KiB.
  const streamCapacity = bytes => Math.max(1024, 2 ** Math.ceil(Math.log2(bytes)));
  // Next ring slot after `index`.
  const nextStreamSlot = index => (index + 1) % STREAM_RING;

  const VERTEX_SHADER = [
    'attribute vec3 aPosition;', 'attribute vec3 aNormal;', 'attribute vec3 aColor;',
    'uniform mat4 uViewProjection;', 'uniform mat4 uModel;', 'uniform mat3 uNormal;',
    'uniform vec3 uEye;', 'uniform float uEmissive;', 'varying mediump vec3 vColor;', 'varying mediump float vDistance;', 'varying mediump vec3 vLocal;',
    'void main() {',
    '  vec4 world = uModel * vec4(aPosition, 1.0);', '  vLocal = aPosition;',
    '  vec3 normal = uNormal * aNormal;',
    '  normal /= max(length(normal), 0.00001);',
    '  float diffuse = max(dot(normal, normalize(vec3(-0.4, 0.8, 0.35))), 0.0);',
    '  vColor = aColor * mix(0.42 + 0.58 * diffuse, 1.0, uEmissive);',
    '  vDistance = length(world.xyz - uEye);',
    '  gl_Position = uViewProjection * world;', '}'
  ].join('\n');
  const FRAGMENT_SHADER = [
    'precision mediump float;', 'varying mediump vec3 vColor;', 'varying mediump float vDistance;', 'varying mediump vec3 vLocal;', 'uniform float uOpacity;', 'uniform float uSoftShadow;', 'uniform float uTailFade;',
    'uniform vec3 uFogColor;', 'uniform vec2 uFogRange;',
    'void main() {',
    '  float fog = smoothstep(uFogRange.x, uFogRange.y, vDistance);',
    '  float alpha = uOpacity;',
    '  if (uSoftShadow > 0.5) alpha *= 1.0 - smoothstep(0.15, 1.0, length(vLocal.xz / vec2(30.0, 24.0)));',
    '  if (uTailFade > 0.5) {',
    '    float radial = length(vec2(vLocal.y - 8.0, min(abs(vLocal.z - 17.0), abs(vLocal.z + 17.0))));',
    '    alpha *= smoothstep(-35.0, -23.0, vLocal.x) * (1.0 - smoothstep(0.2, 2.5, radial));',
    '  }',
    '  gl_FragColor = vec4(mix(vColor, uFogColor, fog), alpha);', '}'
  ].join('\n');

  // Conservative homogeneous-frustum test for an axis-aligned local-space box.
  // Missing/invalid bounds stay visible. A straddling box is never clipped away.
  function boxVisible(bounds, matrix) {
    if (!bounds || !bounds.min || !bounds.max || !matrix || matrix.length !== 16) return true;
    const lo=bounds.min,hi=bounds.max;
    for(let i=0;i<3;i++) if(!Number.isFinite(lo[i])||!Number.isFinite(hi[i])||lo[i]>hi[i])return true;
    for(let axis=0;axis<3;axis++) for(const sign of [-1,1]) {
      const x=matrix[3]+sign*matrix[axis],y=matrix[7]+sign*matrix[4+axis],z=matrix[11]+sign*matrix[8+axis],w=matrix[15]+sign*matrix[12+axis];
      const support=x*(x>=0?hi[0]:lo[0])+y*(y>=0?hi[1]:lo[1])+z*(z>=0?hi[2]:lo[2])+w;
      if(support < -1e-5)return false;
    }
    return true;
  }

  function create(canvas, options) {
    options = options || {};
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    let gl;
    try {
      const attributes = { alpha: false, depth: true, stencil: false,
        antialias: !options.powerSaving, premultipliedAlpha: false, preserveDrawingBuffer: false,
        powerPreference: options.powerSaving ? 'low-power' : 'default' };
      gl = canvas.getContext('webgl', attributes) || canvas.getContext('experimental-webgl', attributes);
    } catch (_) { return null; }
    if (!gl) return null;

    let state = 'ready', lastError = null, program = null, locations = null;
    let staticCache = new WeakMap(), records = new Set(), frame = 0;
    // Stream ring: ring[i] is a buffer (created on first use) holding ringBytes[i] bytes.
    let ring = [], ringBytes = [], ringIndex = -1;
    // Per-frame scratch: no allocation per bounded mesh / per model.
    const mvpScratch = new Float32Array(16), normalScratch = new Float32Array(9), opaque = [], translucent = [], translucentPool = [];
    let width = Math.max(1, finite(canvas.width, 1)), height = Math.max(1, finite(canvas.height, 1));
    let pixelRatio = 1, maxSize = 4096;

    function release(contextLost) {
      if (!contextLost) {
        records.forEach(record => gl.deleteBuffer(record.buffer));
        ring.forEach(buffer => { if (buffer) gl.deleteBuffer(buffer); });
        if (program) gl.deleteProgram(program);
      }
      records = new Set(); staticCache = new WeakMap();
      program = null; locations = null; ring = []; ringBytes = []; ringIndex = -1;
    }

    function initialize() {
      const shaders = [];
      try {
        for (const pair of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]]) {
          const shader = gl.createShader(pair[0]);
          if (!shader) throw new Error('WebGL shader allocation failed');
          shaders.push(shader); gl.shaderSource(shader, pair[1]); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader) || 'WebGL shader compilation failed');
          }
        }
        program = gl.createProgram();
        if (!program) throw new Error('WebGL program allocation failed');
        shaders.forEach(shader => gl.attachShader(program, shader)); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(program) || 'WebGL program linking failed');
        }
        locations = {};
        ['aPosition', 'aNormal', 'aColor'].forEach(name => { locations[name] = gl.getAttribLocation(program, name); });
        ['uViewProjection', 'uModel', 'uNormal', 'uEye', 'uFogColor', 'uFogRange', 'uEmissive', 'uOpacity', 'uSoftShadow', 'uTailFade'].forEach(name => {
          locations[name] = gl.getUniformLocation(program, name);
        });
        const first = gl.createBuffer();
        if (!first) throw new Error('WebGL buffer allocation failed');
        ring = [first]; ringBytes = [0]; ringIndex = -1;
        gl.useProgram(program);
        // Attribute arrays stay enabled for the life of the context (no VAOs, one program).
        for (const name of ['aPosition', 'aNormal', 'aColor']) gl.enableVertexAttribArray(locations[name]);
        maxSize = Math.max(1, finite(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 4096));
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
        gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
        gl.clearDepth(1);
        return true;
      } catch (error) {
        lastError = error; release(false); return false;
      } finally {
        shaders.forEach(shader => gl.deleteShader(shader));
      }
    }

    function resize(w, h, dpr) {
      if (state === 'disposed') return false;
      width = Math.max(1, finite(w, 1)); height = Math.max(1, finite(h, 1));
      pixelRatio = clamp(finite(dpr, 1), 0.5, options.powerSaving ? 1 : 2);
      // Keep aspect ratio even on GPUs whose renderbuffer limit is small.
      const scale = Math.min(pixelRatio, maxSize / width, maxSize / height);
      const pixelWidth = Math.max(1, Math.round(width * scale));
      const pixelHeight = Math.max(1, Math.round(height * scale));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      if (state === 'ready') gl.viewport(0, 0, pixelWidth, pixelHeight);
      return true;
    }

    function notify(name, value) {
      if (typeof options[name] === 'function') {
        // An application callback must not prevent resource recovery/cleanup.
        try { options[name](value); } catch (_) { /* consumer callback */ }
      }
    }

    function lost(event) {
      if (state === 'disposed') return;
      if (event && event.preventDefault) event.preventDefault();
      if (state === 'lost') return;
      state = 'lost'; release(true); notify('onLost', renderer);
    }

    function restored() {
      if (state !== 'lost') return;
      if (!initialize()) { state = 'failed'; notify('onLost', renderer); return; }
      state = 'ready'; lastError = null; resize(width, height, pixelRatio);
      notify('onRestored', renderer);
    }

    function draw(scene) {
      if (state !== 'ready') return false;
      if (typeof gl.isContextLost === 'function' && gl.isContextLost()) { lost(); return false; }
      scene = scene || {};
      const camera = scene.camera || {}, eye = vector(camera.eye, [0, 3, 8]);
      const target = vector(camera.target, [0, 0, 0]);
      const near = Math.max(0.001, finite(camera.near, 0.1));
      const far = Math.max(near + 0.01, finite(camera.far, 2000));
      const fov = clamp(finite(camera.fov, Math.PI / 3), 0.01, Math.PI - 0.01);
      const vp = multiply(perspective(fov, width / height, near, far), lookAt(eye, target, camera.up));
      const background = vector(scene.background, [0.025, 0.035, 0.065]);
      const fog = scene.fog || {}, fogColor = vector(fog.color, background);
      const fogNear = Math.max(0, finite(fog.near, far * 0.45));
      const fogFar = Math.max(fogNear + 0.01, finite(fog.far, far));
      try {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(clamp(background[0], 0, 1), clamp(background[1], 0, 1), clamp(background[2], 0, 1), 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniformMatrix4fv(locations.uViewProjection, false, vp);
        gl.uniform3fv(locations.uEye, eye); gl.uniform3fv(locations.uFogColor, fogColor);
        gl.uniform2f(locations.uFogRange, fogNear, fogFar);
        frame++;
        // Opaque actors must establish depth before any wake/shadow blends.
        // Sort the small effects list far-to-near in view space so roster order
        // cannot make a farther hull erase a nearer translucent effect.
        opaque.length = 0; translucent.length = 0;
        const forward=normalize(target.map((n,i)=>n-eye[i]),[0,0,-1]);
        const isTransparent=mesh=>clamp(finite(mesh.opacity,1),0,1)<1 || mesh.softShadow===true || mesh.tailFade===true;
        const depth=mesh=>{
          const lo=mesh.bounds?.min,hi=mesh.bounds?.max,
            x=lo&&hi?finite((lo[0]+hi[0])/2,0):0,
            y=lo&&hi?finite((lo[1]+hi[1])/2,0):0,
            z=lo&&hi?finite((lo[2]+hi[2])/2,0):0,
            m=mesh.model&&mesh.model.length===16?mesh.model:IDENTITY;
          return finite((m[0]*x+m[4]*y+m[8]*z+m[12]-eye[0])*forward[0]+
            (m[1]*x+m[5]*y+m[9]*z+m[13]-eye[1])*forward[1]+
            (m[2]*x+m[6]*y+m[10]*z+m[14]-eye[2])*forward[2],0);
        };
        for(const mesh of scene.meshes||[]) if(mesh) {
          if(isTransparent(mesh)) {
            const entry = translucentPool[translucent.length] || (translucentPool[translucent.length] = { mesh: null, depth: 0 });
            entry.mesh = mesh; entry.depth = depth(mesh); translucent.push(entry);
          } else opaque.push(mesh);
        }
        translucent.sort((a,b)=>b.depth-a.depth);
        for(const entry of translucent)opaque.push(entry.mesh);
        for (const mesh of opaque) {
          if (!mesh || !mesh.vertices) continue;
          const vertices = mesh.vertices;
          // Cross-realm Float32Arrays are valid. Ignore incomplete triangles.
          if (!ArrayBuffer.isView(vertices) || vertices.BYTES_PER_ELEMENT !== 4 ||
              Object.prototype.toString.call(vertices) !== '[object Float32Array]' || vertices.length < 27) continue;
          const model = mesh.model && mesh.model.length === 16 ? mesh.model : IDENTITY;
          if (mesh.bounds && !boxVisible(mesh.bounds, model === IDENTITY ? vp : multiply(vp, model, mvpScratch))) continue;
          let buffer;
          if (mesh.static) {
            let record = staticCache.get(vertices);
            if (!record) {
              buffer = gl.createBuffer();
              if (!buffer) continue;
              gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
              record = { buffer, lastUsed: frame, vertices };
              records.add(record); staticCache.set(vertices, record);
            }
            record.lastUsed = frame; buffer = record.buffer;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          } else {
            ringIndex = nextStreamSlot(ringIndex);
            if (!ring[ringIndex]) {
              ring[ringIndex] = gl.createBuffer();
              if (!ring[ringIndex]) ringIndex = 0;   // allocation refused: share the first slot
              else ringBytes[ringIndex] = 0;
            }
            buffer = ring[ringIndex]; gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            if (vertices.byteLength > ringBytes[ringIndex]) {
              ringBytes[ringIndex] = streamCapacity(vertices.byteLength);
              gl.bufferData(gl.ARRAY_BUFFER, ringBytes[ringIndex], gl.DYNAMIC_DRAW);
            }
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
          }
          gl.vertexAttribPointer(locations.aPosition, 3, gl.FLOAT, false, 36, 0);
          gl.vertexAttribPointer(locations.aNormal, 3, gl.FLOAT, false, 36, 12);
          gl.vertexAttribPointer(locations.aColor, 3, gl.FLOAT, false, 36, 24);
          // Tiny LED face overlays emit their own light, while retaining depth
          // and distance fog. Reset per mesh so it cannot brighten the hull.
          gl.uniform1f(locations.uEmissive, mesh.emissive === true ? 1 : 0);
          const opacity = clamp(finite(mesh.opacity, 1), 0, 1), transparent = opacity < 1 || mesh.softShadow === true || mesh.tailFade === true;
          gl.uniform1f(locations.uOpacity, opacity);
          gl.uniform1f(locations.uSoftShadow, mesh.softShadow === true ? 1 : 0);
          gl.uniform1f(locations.uTailFade, mesh.tailFade === true ? 1 : 0);
          // Translucent effects follow all opaque geometry. They test its
          // completed depth buffer but never write depth themselves.
          if (transparent) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
          else { gl.disable(gl.BLEND); gl.depthMask(true); }
          gl.uniformMatrix4fv(locations.uModel, false, model);
          gl.uniformMatrix3fv(locations.uNormal, false, model === IDENTITY ? IDENTITY_NORMAL : normalMatrix(model, normalScratch));
          gl.drawArrays(gl.TRIANGLES, 0, Math.floor(vertices.length / 27) * 3);
        }
        gl.disable(gl.BLEND); gl.depthMask(true);
        // Courses can replace their immutable geometry. Reclaim old GPU buffers
        // after two seconds at 60fps, while retaining briefly culled geometry.
        if (frame % 60 === 0) records.forEach(record => {
          if (frame - record.lastUsed > 120) {
            gl.deleteBuffer(record.buffer); staticCache.delete(record.vertices); records.delete(record);
          }
        });
        return true;
      } catch (error) {
        lastError = error;
        if (typeof gl.isContextLost === 'function' && gl.isContextLost()) lost();
        else { state = 'failed'; release(false); notify('onLost', renderer); }
        return false;
      }
    }

    function dispose() {
      if (state === 'disposed') return;
      const contextLost = state === 'lost'; state = 'disposed';
      if (canvas.removeEventListener) {
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
      }
      release(contextLost);
    }

    const renderer = { draw, resize, dispose,
      get status() { return state; }, get error() { return lastError; } };
    if (!initialize()) return null;
    resize(width, height, 1);
    if (canvas.addEventListener) {
      canvas.addEventListener('webglcontextlost', lost, false);
      canvas.addEventListener('webglcontextrestored', restored, false);
    }
    return renderer;
  }

  return { perspective, lookAt, multiply, project, cameraFrame, boxVisible, create, STREAM_RING, streamCapacity, nextStreamSlot };
});
