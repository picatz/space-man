/* Original low-poly Star Circuit art. Pure mesh generation; no physics state. */
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./race-track-mesh.js")
      : root.SpaceManRaceTrackMesh,
    typeof module === "object" && module.exports ? require("./art.js") : root.SpaceManArt,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpaceManRaceScene = api;
})(typeof window !== "undefined" ? window : globalThis, function (TrackMesh, Art) {
  "use strict";
  const rgb = (h) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const shade = (c, s) => c.map((v) => Math.min(1, v * s));
  function builder() {
    const v = [];
    function triangle(a, b, c, color, normals) {
      const u = b.map((n, i) => n - a[i]),
        w = c.map((n, i) => n - a[i]);
      let n = [
          u[1] * w[2] - u[2] * w[1],
          u[2] * w[0] - u[0] * w[2],
          u[0] * w[1] - u[1] * w[0],
        ],
        d = Math.hypot(...n) || 1;
      n = n.map((x) => x / d);
      for (const [i, p] of [a, b, c].entries()) v.push(...p, ...(normals ? normals[i] : n), ...color);
    }
    function quad(a, b, c, d, color, normals) {
      triangle(a, b, c, color, normals && [normals[0], normals[1], normals[2]]);
      triangle(a, c, d, color, normals && [normals[0], normals[2], normals[3]]);
    }
    function box(x, y, z, w, h, d, color, heading = 0) {
      const co = Math.cos(heading),
        si = Math.sin(heading),
        p = (a, b, c) => [x + a * co - c * si, y + b, z + a * si + c * co];
      const a = p(-w / 2, 0, -d / 2),
        b = p(w / 2, 0, -d / 2),
        c = p(w / 2, 0, d / 2),
        e = p(-w / 2, 0, d / 2),
        A = p(-w / 2, h, -d / 2),
        B = p(w / 2, h, -d / 2),
        C = p(w / 2, h, d / 2),
        E = p(-w / 2, h, d / 2);
      quad(A, E, C, B, color);
      quad(A, B, b, a, shade(color, 0.78));
      quad(B, C, c, b, shade(color, 0.9));
      quad(C, E, e, c, color);
      quad(E, A, a, e, shade(color, 0.8));
    }
    function crystal(x, y, z, r, h, color, sides = 6) {
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2,
          b = ((i + 1) / sides) * Math.PI * 2;
        triangle(
          [x + r * Math.cos(a), y, z + r * Math.sin(a)],
          [x, y + h, z],
          [x + r * Math.cos(b), y, z + r * Math.sin(b)],
          shade(color, 0.7 + (i % 3) * 0.15),
        );
      }
    }
    function sphere(x, y, z, r, color, segments = 24, rings = 12) {
      const at = (a, b) => [
        x + r * Math.cos(b) * Math.cos(a),
        y + r * Math.sin(b),
        z + r * Math.cos(b) * Math.sin(a),
      ];
      for (let i = 0; i < segments; i++)
        for (let j = 0; j < rings; j++) {
          const a = (i * Math.PI * 2) / segments,
            b = ((i + 1) * Math.PI * 2) / segments,
            c = -Math.PI / 2 + (j * Math.PI) / rings,
            d = c + Math.PI / rings;
          quad(
            at(a, d),
            at(b, d),
            at(b, c),
            at(a, c),
            shade(color, 0.83 + (j % 3) * 0.08),
          );
        }
    }
    function ellipsoid(
      x,
      y,
      z,
      rx,
      ry,
      rz,
      color,
      heading = 0,
      segments = 12,
      rings = 5,
    ) {
      const co = Math.cos(heading),
        si = Math.sin(heading);
      const at = (a, b) => {
        const f = rx * Math.cos(b) * Math.cos(a),
          side = rz * Math.cos(b) * Math.sin(a);
        return [
          x + co * f - si * side,
          y + ry * Math.sin(b),
          z + si * f + co * side,
        ];
      };
      // Analytical normals remove the blocky lighting of the old flat-shaded
      // shell without subdivision or a shader/material pass. Scenery stays faceted.
      const normal = (a, b) => {
        const f = Math.cos(b) * Math.cos(a) / rx,
          up = Math.sin(b) / ry, side = Math.cos(b) * Math.sin(a) / rz,
          length = Math.hypot(f, up, side) || 1;
        return [(co * f - si * side) / length, up / length, (si * f + co * side) / length];
      };
      for (let i = 0; i < segments; i++)
        for (let j = 0; j < rings; j++) {
          const a = (i * Math.PI * 2) / segments,
            b = ((i + 1) * Math.PI * 2) / segments,
            c = -Math.PI / 2 + (j * Math.PI) / rings,
            d = c + Math.PI / rings;
          quad(at(a, d), at(b, d), at(b, c), at(a, c), color,
            [normal(a, d), normal(b, d), normal(b, c), normal(a, c)]);
        }
    }
    function surface(at, around, across, color) {
      const normal = (u, v) => {
        const a = at(u + .0001, v), b = at(u - .0001, v),
          c = at(u, v + .0001), d = at(u, v - .0001),
          du = a.map((x, i) => x - b[i]), dv = c.map((x, i) => x - d[i]);
        const n = [du[1]*dv[2]-du[2]*dv[1],du[2]*dv[0]-du[0]*dv[2],du[0]*dv[1]-du[1]*dv[0]], len = Math.hypot(...n) || 1;
        return n.map(x => x / len);
      };
      for (let i = 0; i < around; i++) for (let j = 0; j < across; j++) {
        const u = i / around, next = (i + 1) / around, v = j / across, end = (j + 1) / across;
        quad(at(u,v),at(next,v),at(next,end),at(u,end),color,
          [normal(u,v),normal(next,v),normal(next,end),normal(u,end)]);
      }
    }
    return {
      triangle,
      quad,
      box,
      crystal,
      sphere,
      ellipsoid,
      surface,
      mesh: () => ({ vertices: new Float32Array(v) }),
    };
  }
  function roadPoint(p, side, y) {
    return [p.x - p.ty * side, y, p.y + p.tx * side];
  }
  function course(c, at) {
    const b = builder(),
      edge = rgb(c.edge),
      accent = rgb(c.accent),
      road = rgb(c.road);
    const half = c.width / 2,
      clearance = (c.runoff || 0) + 28 + 12,
      clearances = [];
    const trackMesh = TrackMesh.build(c);
    // Repeated luminous pylons create strong speed/depth cues without collision walls.
    for (let d = 0; d < c.length; d += 105) {
      const p = at(c, d),
        h = Math.atan2(p.ty, p.tx);
      for (const side of [-1, 1]) {
        const x = p.x - p.ty * (half + clearance) * side,
          z = p.y + p.tx * (half + clearance) * side;
        if (TrackMesh.distance(c, x, z) < half + clearance - 1) continue;
        clearances.push({ x, z, radius: 6, type: "pylon" });
        b.box(x, 0, z, 7, 17, 7, [0.12, 0.2, 0.27], h);
        b.box(x, 16, z, 8, 3, 8, edge, h);
      }
    }
    // Track-specific skyline silhouettes are generated locally, not fetched assets.
    for (let i = 0; i < 32; i++) {
      const p = at(c, (i * c.length) / 32),
        side = i % 2 ? -1 : 1,
        dist = half + 180 + (i % 4) * 55,
        x = p.x - p.ty * dist * side,
        z = p.y + p.tx * dist * side;
      const radius = c.id === "ember" ? 60 : c.id === "bloom" ? 48 : 26;
      // Clearance is measured against EVERY track segment, including the far
      // side of a hairpin. A local tangent offset does not imply a safe site.
      if (TrackMesh.distance(c, x, z) < half + radius + clearance) continue;
      clearances.push({ x, z, radius, type: "landmark" });
      if (c.id === "ember") {
        b.crystal(
          x,
          -9,
          z,
          34 + (i % 3) * 12,
          70 + (i % 4) * 25,
          rgb(c.planet),
        );
        b.crystal(x + 17, -5, z + 13, 15, 42, accent);
      } else if (c.id === "bloom") {
        b.box(x, -6, z, 17, 65 + (i % 4) * 15, 17, [0.12, 0.29, 0.27]);
        b.sphere(
          x,
          60 + (i % 4) * 15,
          z,
          30 + (i % 3) * 8,
          shade(rgb(c.planet), 1.25),
        );
      } else {
        b.box(x, -5, z, 33, 85 + (i % 5) * 27, 30, [0.12, 0.2, 0.31]);
        b.box(x, 55 + (i % 5) * 27, z, 36, 5, 33, shade(edge, 0.8));
        b.crystal(x, 85 + (i % 5) * 27, z, 22, 30, shade(edge, 0.7));
      }
    }
    for (const fraction of c.pads) {
      const p = at(c, fraction * c.length),
        h = Math.atan2(p.ty, p.tx);
      b.box(p.x, 0.5, p.y, 60, 0.5, c.width * 0.68, shade(accent, 0.35), h);
      for (let j = -1; j <= 1; j++)
        for (const side of [-1, 1]) {
          const point = (f, s) => [
            p.x + Math.cos(h) * f - Math.sin(h) * s,
            1.4,
            p.y + Math.sin(h) * f + Math.cos(h) * s,
          ];
          b.quad(
            point(j * 16 - 8, side * 30),
            point(j * 16 - 2, side * 30),
            point(j * 16 + 10, 0),
            point(j * 16 + 4, 0),
            accent,
          );
        }
    }
    const p = at(c, 0),
      h = Math.atan2(p.ty, p.tx);
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 10; i++) {
        const side = -half + ((i + 0.5) * c.width) / 10;
        b.box(
          p.x - p.ty * side + p.tx * (j - 0.5) * 13,
          0.8,
          p.y + p.tx * side + p.ty * (j - 0.5) * 13,
          13,
          0.3,
          c.width / 10,
          (i + j) % 2 ? [0.86, 0.95, 0.93] : [0.06, 0.12, 0.19],
          h,
        );
      }
    // An offset from the start normal can land on a different branch of a
    // hairpin. Search both supports against the entire driveable corridor.
    const supports = [-1, 1].map((side) => {
      const radius = 10, required = half + (c.runoff || 0) + 28 + radius + 8;
      let offset = half + clearance, support;
      for (let attempt = 0; attempt < 160; attempt++, offset += 16) {
        const x = p.x - p.ty * offset * side,
          z = p.y + p.tx * offset * side;
        if (TrackMesh.distance(c, x, z) < required) continue;
        support = { x, z, radius, type: "arch", offset };
        break;
      }
      if (!support) throw new RangeError("No clear finish-arch support position");
      clearances.push(support);
      b.box(support.x, 0, support.z, 13, 210, 13, shade(edge, 0.6), h);
      return support;
    });
    const archX = (supports[0].x + supports[1].x) / 2,
      archZ = (supports[0].z + supports[1].z) / 2,
      archSpan = supports[0].offset + supports[1].offset;
    b.box(archX, 207, archZ, 17, 14, archSpan + 15, [0.17, 0.28, 0.37], h);
    b.box(
      archX + Math.cos(h) * 10,
      212,
      archZ + Math.sin(h) * 10,
      3,
      5,
      archSpan - 4,
      accent,
      h,
    );
    const mesh = b.mesh();
    mesh.static = true;
    const sky = builder();
    sky.sphere(2000, 900, 2000, 500, rgb(c.planet));
    sky.sphere(-1000, 520, 1200, 240, shade(accent, 0.6));
    // Star diamonds at a stable world distance; they move only with the view.
    for (let i = 0; i < 160; i++) {
      const a = i * 2.39996,
        r = 3100,
        y = 220 + ((i * 137) % 1900),
        x = 900 + Math.cos(a) * r,
        z = 750 + Math.sin(a) * r,
        s = i % 7 ? 2.7 : 5;
      sky.crystal(x, y, z, s, s * 2, [0.65, 0.8, 0.92], 4);
    }
    const skyMesh = sky.mesh();
    skyMesh.static = true;
    return {
      meshes: [skyMesh, ...(trackMesh.chunks || [trackMesh]), mesh],
      clearances,
      background: rgb(c.sky),
      fog: { color: rgb(c.sky), near: 1700, far: 6000 },
    };
  }
  function visibleActor(a, { hideId = null, chaseActor = null } = {}) {
    if (a.id === hideId) return false;
    if (chaseActor && a.id !== chaseActor.id) {
      const dx = a.x - chaseActor.x,
        dz = a.y - chaseActor.y;
      const behind =
        dx * Math.cos(chaseActor.heading) + dz * Math.sin(chaseActor.heading);
      const side =
        -dx * Math.sin(chaseActor.heading) + dz * Math.cos(chaseActor.heading);
      if (behind < -25 && behind > -320 && Math.abs(side) < 95) return false;
    }
    return true;
  }
  function actors(
    snapshot,
    { hideId = null, calm = false, chaseActor = null, course = null, catalog = null, nearest = null, shadows = true } = {},
  ) {
    const b = builder();
    for (const a of snapshot.actors) {
      if (!visibleActor(a, { hideId, chaseActor })) continue;
      const height = actorHeight(a, course, catalog, nearest);
      const h = a.heading,
        co = Math.cos(h),
        si = Math.sin(h),
        style = Art.characterStyle(a.appearance, a.color),
        P = style.palette, appearance = style.appearance,
        color = rgb(style.accent), white = rgb(P.suit);
      let pilotOffset = 0;
      const p = (f, u, side) => [
        a.x + co * f - si * side,
        u + height + pilotOffset,
        a.y + si * f + co * side,
      ];
      const pod = (f, u, side, rx, ry, rz, col, segments = 10, rings = 4) =>
        b.ellipsoid(...p(f, u, side), rx, ry, rz, col, h, segments, rings);
      // One thin, forward-biased deck surrounds a real recessed opening.
      // These surfaces meet at shared boundaries: no stacked full ellipsoids.
      const outline = Art.hoverHullOutline;
      const opening = angle => [-5 + 10*Math.cos(angle), 12 + 1.8*Math.cos(angle), 7.8*Math.sin(angle)];
      const mixPoint = (a,b,t) => a.map((x,i) => x+(b[i]-x)*t);
      const deck = (angle,v,clearance=0) => {
        const point=mixPoint(opening(angle),outline(angle),v);
        point[1]+=Math.sin(v*Math.PI)*.7+clearance;
        return p(...point);
      };
      b.surface((u,v)=>deck(u*Math.PI*2,v),32,3,white);
      // Tuck the lower skirt under the deck; the colored band is a thin seam.
      b.surface((u,v) => {
        const point = outline(u*Math.PI*2);
        point[0] = 2+(point[0]-2)*(1-.07*v);
        point[2] *= 1-.13*v;
        point[1] -= 2.4*Math.sin(v*Math.PI/2);
        return p(...point);
      },32,3,rgb(P.legB));
      // Inner walls and floor are physically below the opening, not a dark puck.
      b.surface((u,v) => {
        const point = opening(u*Math.PI*2);
        point[0] = -5+(point[0]+5)*(1-.12*v); point[2]*=1-.12*v;
        point[1] = point[1]*(1-v)+8.4*v;
        return p(...point);
      },32,1,rgb('#152D43'));
      for(let i=0;i<32;i++) {
        const point = angle => p(-5+8.8*Math.cos(angle),8.4,6.85*Math.sin(angle));
        b.triangle(p(-5,8.4,0),point((i+1)*Math.PI/16),point(i*Math.PI/16),rgb('#102337'));
      }
      // A tapered nose inlay gives the front a readable direction.
      b.surface((u,t)=>deck((u-.5)*(.55*(1-.9*t)),.16+t*.75,.08),2,10,color);
      if (appearance.ship === 'orbit') ring(b,p,-8,7.5,0,20,24,1.6,color);
      for(const side of [-1,1]) {
        const leaf = appearance.ship === 'leaf';
        // Short swept shoulders make the engines parts of one craft. Leaf
        // changes the planform rather than attaching another inflated lobe.
        const bridge=(u,v,lower=0)=>{
          const f=-13+20*(side<0?1-u:u)-2*v, c=(f-4)/28,
            edge=13.5*Math.sqrt(Math.max(0,1-c*c))*(.96+.12*c);
          return p(f,8.7+Math.sin(u*Math.PI)+.7*Math.sin(v*Math.PI)-lower,side*(edge*.9*(1-v)+17*v));
        };
        // A shallow boxed arch physically joins the shell to each engine.
        // Its end walls are visible; it is not a zero-thickness paper fin.
        b.surface((u,v)=>bridge(v,u),2,6,shade(color,.9));
        b.surface((u,v)=>bridge(v,1-u,1.6),2,6,shade(color,.62));
        for(const u of [0,1]) {const wall=[bridge(u,0),bridge(u,1),bridge(u,1,1.6),bridge(u,0,1.6)];if(u===0)wall.reverse();b.quad(...wall,shade(color,.75));}
        if(leaf) {
          const leafPoint=(u,v,lower=0)=>p(-21+17*v,7.4+.6*Math.sin(v*Math.PI)-lower,side*(17+9*Math.sin(v*Math.PI)*(side<0?1-u:u)));
          b.surface((u,v)=>leafPoint(u,v),2,8,shade(color,.88));
          b.surface((u,v)=>leafPoint(1-u,v,1),2,8,shade(color,.65));
        }
        const sections = [[-23,8,2.6,3.3],[-20,8.2,3,3.8],[-12,8.6,3.2,4.1],[-1,9.2,3,3.8],[8,9.5,2.7,3.4],[15,9.4,1.7,2.3],[18,9.2,.1,.1]];
        // Smooth cubic profile: rounded leading tip, slim waist, clipped engine
        // face. No sphere point masquerading as an exhaust connection.
        const profile = value => {
          const t = Math.max(0,Math.min(sections.length-1,value*(sections.length-1))), i=Math.min(sections.length-2,Math.floor(t)), f=t-i;
          const a=sections[Math.max(0,i-1)],b=sections[i],c=sections[i+1],d=sections[Math.min(sections.length-1,i+2)];
          return b.map((_,k)=>.5*((2*b[k])+(-a[k]+c[k])*f+(2*a[k]-5*b[k]+4*c[k]-d[k])*f*f+(-a[k]+3*b[k]-3*c[k]+d[k])*f*f*f));
        };
        const engine = (u,v) => {const q=profile(v),angle=u*Math.PI*2;return p(q[0],q[1]+q[2]*Math.cos(angle),side*17+q[3]*Math.sin(angle));};
        b.surface(engine,16,10,color);
        b.surface((u,v)=>{const q=profile(.065+v*.05),angle=u*Math.PI*2;return p(q[0],q[1]+(q[2]+.035)*Math.cos(angle),side*17+(q[3]+.035)*Math.sin(angle));},16,1,rgb('#244557'));
        // Fitted tapered reflector is a surface patch, not another solid part.
        b.surface((u,v)=>{const t=.2+v*.56, q=profile(t),angle=(u-.5)*(.24*Math.sin(v*Math.PI)+.02);return p(q[0],q[1]+(q[2]+.12)*Math.cos(angle),side*17+(q[3]+.12)*Math.sin(angle));},2,8,rgb('#DFFBFF'));
        for(let i=0;i<16;i++) {
          const ringPoint=(angle,scale)=>p(-23.12,8+2.6*scale*Math.cos(angle),side*17+3.3*scale*Math.sin(angle));
          const a=i*Math.PI/8,n=(i+1)*Math.PI/8;
          b.quad(ringPoint(a,1),ringPoint(n,1),ringPoint(n,.62),ringPoint(a,.62),rgb('#193349'));
        }
      }
      pilotOffset = -1.5;
      // Suit, shoulder capsules, collar and instrument panel belong to the
      // same astronaut used on foot. The helmet keeps a generous silhouette.
      pod(-12.5,15.5,0,1.6,3.7,5.5,rgb('#152D43'),8,4);
      pod(-7, 15.8, 0, 4.8, 3.6, 5.5, white);
      pod(-1, 15.5, -6.5, 4, 1.6, 1.8, rgb(P.arm));
      pod(-1, 15.5, 6.5, 4, 1.6, 1.8, rgb(P.arm));
      pod(-5, 17, 0, 4.5, .75, 4.5, rgb(P.legB));
      b.box(...p(.1, 14.5, 0), 1.5, 2, 5, [0.14, 0.24, 0.34], h);
      b.box(...p(1, 15.5, 0), .4, 1.1, 3, color, h);
      const helmetRadius = appearance.helmet === 'round' ? 8.5 : 9.2;
      if (appearance.helmet === 'retro') pod(-5, 24, 0, 8.2, 8, 9.1, white);
      else b.ellipsoid(...p(-5, 24, 0), helmetRadius, helmetRadius, helmetRadius, white, h, 20, 10);
      // A tessellated outer glass shell. One tall chord used to intersect the
      // helmet's different triangle grid, showing white teeth through the glass.
      // Short 2px strips plus radial clearance keep every triangle outside it.
      for (let i = 0; i < 20; i++) {
        const range = appearance.helmet === 'bubble' ? 2.35 : 2.15;
        const a0 = -range + i * range / 10, a1 = a0 + range / 10;
        const visor = (angle, y) => p(
          -5 + Math.sqrt((helmetRadius + .45) ** 2 - (y - 24) ** 2) * Math.cos(angle), y,
          Math.sqrt((helmetRadius + .45) ** 2 - (y - 24) ** 2) * Math.sin(angle));
        for (let band = 0; band < 3; band++) {
          const bottom = 21.5 + band * 2, top = bottom + 2;
          b.quad(visor(a0, bottom), visor(a0, top), visor(a1, top), visor(a1, bottom), [0.063, 0.176, 0.286]);
        }
        b.quad(visor(a0, 27.5), visor(a0, 28.3), visor(a1, 28.3), visor(a1, 27.5), rgb(P.visTop));
      }
      // Ear pods, precise rear gasket and short comms aerial make the chase
      // silhouette recognizably Arena-derived without a fake rear-facing face.
      for (const side of [-8, 8]) {
        pod(-7, 24, side, 2, 2.5, 1.3, rgb(P.legB));
        pod(-7, 24.5, side * 1.05, .8, .8, .8, color);
      }
      if (appearance.hat === 'none') {
        b.box(...p(-8, 29, -3), 1, 2.5, 1, rgb(P.legB), h);
        b.sphere(...p(-8, 31.7, -3), .9, color, 6, 3);
      }
      pilotHat(b, p, h, appearance.hat, P, color);
      if (appearance.detail === 'stripe') {
        b.box(...p(-5, 30, 0), 8, 1, 1.5, color, h);
      }
      // Colored life-support panel at the rear of the suit/helmet.
      pod(-13, 21, 0, 1.5, 2.7, 3.2, rgb(P.legB));
      pod(-14.4, 21.2, 0, .25, .55, 2.1, color);
      pilotOffset = 0;
      if(appearance.detail==='stripe') for(const side of [-1,1])
        b.surface((u,t)=>deck(side*.75+(u-.5)*.06,.45+t*.45,.09),2,6,color);
      else if(appearance.detail==='stars') b.quad(p(18,13.7,-2),p(20,13.7,0),p(18,13.7,2),p(16,13.7,0),color);
      // Raw mesh consumers get no opaque shadow: the scene adds a blended one.

    }
    return b.mesh();
  }
  function ring(b, p, f, y, z, rx, rz, thickness, color) {
    for (let i = 0; i < 20; i++) {
      const a = i * Math.PI / 10, n = (i + 1) * Math.PI / 10;
      b.quad(p(f + rx * Math.cos(a), y, z + rz * Math.sin(a)),
        p(f + rx * Math.cos(n), y, z + rz * Math.sin(n)),
        p(f + (rx - thickness) * Math.cos(n), y, z + (rz - thickness) * Math.sin(n)),
        p(f + (rx - thickness) * Math.cos(a), y, z + (rz - thickness) * Math.sin(a)), color);
    }
  }
  function pilotHat(b, p, h, hat, P, color) {
    const sphere = (f,y,z,r,c) => b.sphere(...p(f,y,z),r,c,8,4);
    if (hat === 'antenna') {
      b.box(...p(-5,32,0),1.2,5,1.2,rgb(P.legB),h); sphere(-5,38,0,2,rgb('#FFC93C'));
    } else if (hat === 'sprout') {
      b.box(...p(-5,32,0),.9,4,1,rgb('#35C46B'),h);
      b.ellipsoid(...p(-4,36,-2),2.8,.8,1.7,rgb('#4ADE87'),h,8,3);
      b.ellipsoid(...p(-6,35,2),2.8,.8,1.7,rgb('#4ADE87'),h,8,3);
    } else if (hat === 'beanie') {
      b.ellipsoid(...p(-5,31,0),8,4,8,rgb('#FF6B8A'),h,12,4);
      ring(b,p,-5,31,0,8.6,8.6,1.3,rgb('#E14E6E')); sphere(-5,36,0,2.1,rgb('#FFF3F6'));
    } else if (hat === 'halo') {
      ring(b,p,-5,36,0,8.3,8.3,1.2,rgb('#FFE9A8'));
    } else if (hat === 'crown') {
      ring(b,p,-5,32,0,7,7,1.5,rgb('#FFC93C'));
      for (let i=0;i<5;i++) { const a=i*Math.PI*2/5, n=a+.35; b.triangle(p(-5+7*Math.cos(a),32,7*Math.sin(a)),p(-5+7*Math.cos(n),37,7*Math.sin(n)),p(-5+7*Math.cos(a+.7),32,7*Math.sin(a+.7)),rgb('#FFC93C')); }
      sphere(2,33,0,1.1,rgb('#FF4F66'));
    } else if (hat === 'cone') {
      b.crystal(...p(-5,31,0),5,12,rgb('#B87BFF'),8); sphere(-5,43,0,1.5,rgb('#FFC93C'));
    } else if (hat === 'catears') {
      for (const side of [-1,1]) { b.triangle(p(-3,30,side*4),p(-5,39,side*7),p(-7,30,side*10),rgb(P.suit)); b.triangle(p(-2.8,32,side*5),p(-4.8,37,side*7),p(-6.8,32,side*9),rgb('#FF9ECF')); }
    } else if (hat === 'phones') {
      for (const side of [-9,9]) b.ellipsoid(...p(-5,24,side),3,4,2,color,h,8,4);
      ring(b,p,-5,31,0,8,10,1.6,color);
    }
  }
  function faceMesh(appearance, pose) {
    const b = builder(), r = (appearance.helmet === 'round' ? 8.5 : 9.2) + .7;
    const point = (angle,y) => [-5+Math.sqrt(Math.max(0,r*r-(y-24)*(y-24)))*Math.cos(angle),y-1.5,Math.sqrt(Math.max(0,r*r-(y-24)*(y-24)))*Math.sin(angle)];
    const patch = (angle,y,width,height) => b.quad(point(angle-width/2,y-height/2),point(angle-width/2,y+height/2),point(angle+width/2,y+height/2),point(angle+width/2,y-height/2),rgb('#DFFBFF'));
    for (const side of [-1,1]) {
      const a=side*.28+pose.lookX*.08, y=24.9-pose.lookY*.5;
      if (pose.happy && !pose.closed) {
        for(let i=0;i<4;i++) { const x=-1+i*.5; patch(a+x*.09,y+Math.sqrt(Math.max(0,1-x*x))*.65,.07,.6); }
      } else if(pose.determined && !pose.closed) {
        for(let i=0;i<3;i++) patch(a+(i-1)*.05,y+(i-1)*side*.2,.08,.65);
      } else patch(a,y,pose.width*.11,Math.max(.6,pose.height*.78));
    }
    return b.mesh().vertices;
  }
  // Geometry caches are bounded. Animation swaps only a tiny visor mesh; it
  // never rebuilds the full craft on a blink or on a fractional display frame.
  const kartModels = new Map(), faceModels = new Map(), slideModels = new Map(), engineModels = new Map();
  function cache(map, key, build, limit) {
    if (!map.has(key)) { map.set(key, build()); if(map.size > limit) map.delete(map.keys().next().value); }
    return map.get(key);
  }
  function plumeNearEye(actor, height, eye) {
    if (!eye || eye.length !== 3 || !eye.every(Number.isFinite)) return false;
    const c = Math.cos(actor.heading), s = Math.sin(actor.heading),
      dx = eye[0] - actor.x, dz = eye[2] - actor.y,
      forward = dx * c + dz * s, side = -dx * s + dz * c, up = eye[1] - height;
    // A conservative envelope around the short rounded wakes is
    // [-58,-23] x [6,12] x [-21,21]. Use a
    // conservative 36-unit eye clearance so their decorative triangles cannot
    // cross the Cockpit lens or fill it as a rival hops. This changes neither
    // the rival's hull/helmet nor its ground footprint or authoritative state.
    const x = Math.max(-58 - forward, 0, forward + 23),
      y = Math.max(6 - up, 0, up - 12), z = Math.max(-21 - side, 0, side - 21);
    return x * x + y * y + z * z < 36 * 36;
  }
  function actorMeshes(snapshot, options = {}) {
    const out = [];
    for (const a of snapshot.actors) {
      if (!visibleActor(a, options)) continue;
      const style = Art.characterStyle(a.appearance, a.color), appearance = style.appearance;
      const boosted = !!(a.boosting || a.padTicks > 0),
        height = actorHeight(a, options.course, options.catalog, options.nearest),
        plume = boosted && !plumeNearEye(a, height, options.cockpitEye);
      // The opaque craft is cached independently of boost. Its small unlit
      // engine and fading wake meshes never rebuild the hull on a cue change.
      const key = [style.accent, appearance.suit, appearance.helmet, appearance.hat, appearance.detail, appearance.ship].join(':');
      const vertices = cache(kartModels, key, () => actors({ tick: 0, actors: [{ ...a, x: 0, y: 0, z: 0, airRamp: 0, heading: 0, boosting: false, padTicks: 0 }] }, { calm: true, shadows: false }).vertices, 32);
      const c = Math.cos(a.heading), s = Math.sin(a.heading);
      const model = new Float32Array([c,0,s,0,0,1,0,0,-s,0,c,0,a.x,height,a.y,1]);
      const groundModel = new Float32Array([c,0,s,0,0,1,0,0,-s,0,c,0,a.x,0,a.y,1]);
      out.push({ vertices, static: true, actorId: a.id, bounds: { min: [-72,0,-32], max: [32,46,32] }, model });
      const pose = Art.facePose({ eyes: appearance.eyes, tick: snapshot.tick, id: a.id, calm: options.calm, mood: a.recoveryTicks ? 2 : boosted ? 1 : 0 });
      const faceKey = [appearance.helmet, pose.happy,pose.determined,pose.height,pose.width,pose.closed].join(':');
      const faceVertices = cache(faceModels, faceKey, () => faceMesh(appearance,pose), 24);
      out.push({ vertices: faceVertices, static: true, emissive: true, faceActorId: a.id, bounds: { min: [-15,18,-11], max:[6,33,11] }, model });
      out.push({ ...shadowMesh(), opacity: .28, softShadow: true, shadowActorId: a.id, model: groundModel });
      const engines = cache(engineModels, 'core', () => {
        const b=builder(),core=rgb('#CBF7FF');
        for(const side of [-17,17]) for(let i=0;i<16;i++) {const a=i*Math.PI/8,n=(i+1)*Math.PI/8;
          b.triangle([-23.25,8,side],[-23.25,8+1.55*Math.cos(n),side+2*Math.sin(n)],[-23.25,8+1.55*Math.cos(a),side+2*Math.sin(a)],core);}
        return b.mesh().vertices;
      },32);
      out.push({ vertices: engines, static: true, emissive: true, engineActorId: a.id,
        bounds:{min:[-24,6,-20],max:[-23,10,20]}, model });
      if(plume) {
        const wake=cache(engineModels,style.accent,()=>{
          const b=builder(),glow=rgb(style.accent).map(v=>.45+.55*v);
          for(const side of [-17,17]) {
            b.quad([-23.4,5.5,side],[-23.4,10.5,side],[-35,10.5,side],[-35,5.5,side],glow);
            b.quad([-23.4,8,side-2.5],[-23.4,8,side+2.5],[-35,8,side+2.5],[-35,8,side-2.5],glow);
          }
          return b.mesh().vertices;
        },32);
        out.push({vertices:wake,static:true,emissive:true,opacity:.32,tailFade:true,plumeActorId:a.id,
          bounds:{min:[-35,5,-20],max:[-23,11,20]},model});
      }
      const slip = a.speed > 3 ? Math.atan2(Math.sin(a.heading - Math.atan2(a.vy, a.vx)), Math.cos(a.heading - Math.atan2(a.vy, a.vx))) : 0;
      if (!a.offroad && !a.recoveryTicks && !a.airRamp && Math.abs(slip) > .18) {
        const direction = Math.sign(slip);
        const streaks = cache(slideModels, direction, () => {
          const b = builder();
          for (const side of [-20,20]) b.quad([-13,1,side-1.5],[-13,1,side+1.5],
            [-40,1,side+direction*10+1.5],[-40,1,side+direction*10-1.5],[.5,.92,1]);
          return b.mesh().vertices;
        }, 2);
        out.push({ vertices: streaks, static: true, emissive: true, effectActorId: a.id,
          bounds:{min:[-40,1,-32],max:[-13,1,32]}, model: groundModel });
      }
    }
    return out;
  }
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const CYAN = rgb('#8BEAF2'), GOLD = rgb('#FFDA72'), PULSE = rgb('#FFC08E');
  const featureModels = new Map(), featureCatalogs = new WeakMap();
  function boundedMesh(b, metadata = {}) {
    const mesh = b.mesh(), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.vertices.length; i += 9)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], mesh.vertices[i + axis]);
        max[axis] = Math.max(max[axis], mesh.vertices[i + axis]);
      }
    return Object.freeze({ ...mesh, static: true, ...metadata,
      bounds: Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) }) });
  }
  function featureModel(key, build) {
    return cache(featureModels, key, () => boundedMesh(build(), { emissive: true }), 8);
  }
  function poseModel(x, z, heading, height = 0) {
    const c = Math.cos(heading), s = Math.sin(heading);
    return new Float32Array([c,0,s,0,0,1,0,0,-s,0,c,0,x,height,z,1]);
  }
  function atModel(c, at, s, d = 0) {
    const p = at(c, s);
    return poseModel(p.x - p.ty * d, p.y + p.tx * d, Math.atan2(p.ty, p.tx));
  }
  function rampProfile(s, ramp) {
    // Rounded entry and a short, shallow back slope let slow/reverse traffic
    // remain visually grounded too. This profile never changes physics height.
    const u = s <= ramp.s ? (s - ramp.startS) / (ramp.s - ramp.startS) : 1 - (s - ramp.s) / 24;
    const t = clamp(u, 0, 1);
    return 10 * t * t * (3 - 2 * t);
  }
  function actorHeight(a, c, catalog, nearest) {
    if (a.airRamp) return clamp(Number.isFinite(a.z) ? a.z : 0, 0, 32);
    if (!c || !catalog || !nearest || a.recoveryTicks) return 0;
    const p = nearest(c, a.x, a.y);
    if (!p) return 0;
    const d = -(a.x - p.x) * p.ty + (a.y - p.y) * p.tx;
    for (const ramp of catalog.ramps)
      if (p.s >= ramp.startS && p.s <= ramp.s + 24 && Math.abs(d - ramp.d) <= ramp.width / 2)
        return rampProfile(p.s, ramp);
    return 0;
  }
  function shadowMesh() {
    return featureModel('shadow', () => {
      const b = builder();
      for (let i = 0; i < 32; i++) {
        const a = i * Math.PI / 16, n = (i + 1) * Math.PI / 16;
        b.triangle([0,.15,0], [30*Math.cos(n),.15,24*Math.sin(n)],
          [30*Math.cos(a),.15,24*Math.sin(a)], [.035,.07,.11]);
      }
      return b;
    });
  }
  function ribbon(b, c, at, start, end, d, width, height, color, step = 18) {
    const count = Math.max(1, Math.ceil(Math.abs(end - start) / step));
    for (let i = 0; i < count; i++) {
      const s = start + (end - start) * i / count, next = start + (end - start) * (i + 1) / count;
      const p = at(c, s), q = at(c, next), y = typeof height === 'function' ? height(s) : height,
        yy = typeof height === 'function' ? height(next) : height;
      b.quad(roadPoint(p, d + width / 2, y), roadPoint(q, d + width / 2, yy),
        roadPoint(q, d - width / 2, yy), roadPoint(p, d - width / 2, y), color);
    }
  }
  function chevron(b, c, at, s, d, width, height, color) {
    const p = (f, side) => roadPoint(at(c, s + f), d + side,
      typeof height === 'function' ? height(s + f) : height);
    for (const side of [-1, 1]) {
      const points = [p(-10,side*width/2),p(-4,side*width/2),p(10,0),p(4,0)];
      // Both halves face up, including the non-emissive ramp chevrons.
      if (side < 0) points.reverse();
      b.quad(...points,color);
    }
  }
  const SHIELD_SHAPE = [[-12,13],[12,13],[12,-2],[8,-10],[0,-17],[-8,-10],[-12,-2]];
  const PULSE_SHAPE = [[0,17],[13,1],[5,1],[5,-15],[-5,-15],[-5,1],[-13,1]];
  function symbol(b, shape, point, color) {
    for (let i = 0; i < shape.length; i++)
      b.triangle(point(0,shape===PULSE_SHAPE?3:0), point(...shape[i]), point(...shape[(i + 1) % shape.length]), color);
  }
  function badge(b, shape, y, color) {
    for (const face of [-1, 1]) symbol(b, shape, (side, up) => [face*2,y+up,side], color);
    for (let i = 0; i < shape.length; i++) {
      const [s,u] = shape[i], [ss,uu] = shape[(i+1)%shape.length];
      b.quad([-2,y+u,s],[2,y+u,s],[2,y+uu,ss],[-2,y+uu,ss],shade(color,.65));
    }
  }
  function pickupModel(kind, airborne = false) {
    return featureModel(kind === 'coin' ? 'coin-' + airborne : kind, () => {
      const b = builder(), identity = (f,y,d) => [f,y,d];
      ring(b,identity,0,.65,0,11,11,2,kind === 'coin' ? GOLD : CYAN);
      if (kind === 'coin') {
        const star = Array.from({length:10}, (_,i) => {
          const angle = Math.PI / 2 + i * Math.PI / 5, radius = i % 2 ? 5.5 : 12;
          return [Math.cos(angle)*radius,Math.sin(angle)*radius];
        });
        badge(b,star,airborne ? 43 : 28,GOLD);
        // A road bead anchors even the air-line stars to their optional lane.
        b.crystal(0,1.2,0,4,3,GOLD,4);
      } else {
        badge(b,kind === 'shield' ? SHIELD_SHAPE : PULSE_SHAPE,30,kind === 'shield' ? CYAN : PULSE);
        if (kind === 'shield') symbol(b,SHIELD_SHAPE,(side,up)=>[-2.2,30+up*.55,side*.55],[.12,.31,.4]);
      }
      return b;
    });
  }
  function shieldModel(active) {
    return featureModel(active ? 'shield-active' : 'shield-held', () => {
      const b = builder(), color = active ? CYAN : [.3,.57,.63], radius = active ? 36 : 33,
        y = active ? 14 : 6, thickness = active ? 2 : 1.1;
      for (let i = 0; i < 6; i++) {
        const a = i*Math.PI/3, n = (i+1)*Math.PI/3;
        b.quad([radius*Math.cos(a),y,radius*Math.sin(a)],
          [radius*Math.cos(n),y,radius*Math.sin(n)],
          [(radius-thickness)*Math.cos(n),y,(radius-thickness)*Math.sin(n)],
          [(radius-thickness)*Math.cos(a),y,(radius-thickness)*Math.sin(a)],color);
        if (active) b.box(radius*Math.cos(a),9,radius*Math.sin(a),1.4,17,1.4,color);
      }
      return b;
    });
  }
  function catalogMeshes(c, at, catalog) {
    let cached = featureCatalogs.get(catalog);
    if (cached && cached.course === c) return cached;
    const ramps = [], coins = [], rows = [];
    for (const ramp of catalog.ramps.slice(0, 2)) {
      const b = builder(), top = (s) => .35 + rampProfile(s, ramp);
      ribbon(b,c,at,ramp.startS,ramp.s+24,ramp.d,ramp.width,top,[.15,.3,.38],6);
      for (const side of [-1,1]) {
        ribbon(b,c,at,ramp.startS,ramp.s+24,ramp.d+side*(ramp.width/2-2),2.5,
          (s)=>top(s)+.12,CYAN,6);
        for (let s = ramp.startS; s < ramp.s+24; s+=6) {
          const n = Math.min(ramp.s+24,s+6), p=at(c,s),q=at(c,n),d=ramp.d+side*ramp.width/2;
          b.quad(roadPoint(p,d,.15),roadPoint(q,d,.15),roadPoint(q,d,top(n)),roadPoint(p,d,top(s)),[.1,.2,.28]);
        }
      }
      for (const s of [ramp.s-40,ramp.s-19]) chevron(b,c,at,s,ramp.d,108,(s)=>top(s)+.18,CYAN);
      ramps.push(boundedMesh(b,{featureKind:'ramp',featureId:ramp.id}));
      const landing = builder();
      // Small ground-relative guide rails make the continuous landing road
      // readable without filling it or suggesting a mandatory landing point.
      for (const side of [-1,1]) for (let s=ramp.s+108;s<ramp.s+270;s+=36)
        ribbon(landing,c,at,s,Math.min(s+18,ramp.s+270),side*72,2,.55,[.24,.48,.54]);
      ramps.push(boundedMesh(landing,{featureKind:'landing',featureId:ramp.id+'-landing'}));
    }
    for (const coin of catalog.coins.slice(0,10)) coins.push(Object.freeze({ ...pickupModel('coin',coin.airborne),
      model: atModel(c,at,coin.s,coin.d), featureKind:'coin',featureId:coin.id,featureIndex:coin.index }));
    for (const row of catalog.rows.slice(0,2)) {
      const meshes=[];
      for (const choice of row.choices.slice(0,2)) {
        meshes.push(Object.freeze({ ...pickupModel(choice.item),model:atModel(c,at,choice.s,choice.d),
          featureKind:'item',featureId:choice.id,item:choice.item }));
        const approach=builder(),p=at(c,choice.s-120),color=choice.item==='shield'?CYAN:PULSE;
        symbol(approach,choice.item==='shield'?SHIELD_SHAPE:PULSE_SHAPE,(side,forward)=>
          [p.x+p.tx*forward-p.ty*(choice.d+side),.55,p.y+p.ty*forward+p.tx*(choice.d+side)],shade(color,.7));
        meshes.push(boundedMesh(approach,{featureKind:'approach',featureId:choice.id+'-approach',item:choice.item}));
      }
      rows.push(Object.freeze({index:row.index,meshes:Object.freeze(meshes)}));
    }
    cached=Object.freeze({course:c,ramps:Object.freeze(ramps),coins:Object.freeze(coins),rows:Object.freeze(rows)});
    featureCatalogs.set(catalog,cached);
    return cached;
  }
  function featureMeshes(snapshot, c, at, catalog, options = {}) {
    if (!snapshot || !catalog || catalog.trackId !== c.id || !catalog.ramps.length) return [];
    const geometry=catalogMeshes(c,at,catalog),out=[...geometry.ramps],
      followed=snapshot.actors.find(a=>a.id===options.actorId)||snapshot.actors[0];
    // Availability belongs to the followed pilot. A leader's mask can never
    // remove a trailing pilot's route, including when spectating after a rejoin.
    if (followed) {
      for (const coin of geometry.coins) if (!((followed.coinMask||0)&(1<<coin.featureIndex))) out.push(coin);
      for (const row of geometry.rows) if (!((followed.rowMask||0)&(1<<row.index))) out.push(...row.meshes);
    }
    for (const a of snapshot.actors.slice(0,5)) {
      if (!(a.shieldTicks>0||a.item==='shield') || !visibleActor(a,options)) continue;
      out.push({ ...shieldModel(a.shieldTicks>0), featureKind:'shield', shieldActorId:a.id,
        active:a.shieldTicks>0,model:poseModel(a.x,a.y,a.heading,actorHeight(a,c,catalog,options.nearest)) });
    }
    // Moving lane geometry streams through the renderer's single bounded
    // buffer. Never mark per-tick effects static or accumulate GPU cache keys.
    for (const effect of (snapshot.effects||[]).slice(0,5)) {
      if (!Number.isFinite(effect.s)||!Number.isFinite(effect.d)||!['charge','wave'].includes(effect.phase)) continue;
      const b=builder(),d=clamp(effect.d,-44,44),charge=effect.phase==='charge';
      if (charge) {
        for (const side of [-1,1]) ribbon(b,c,at,effect.s+36,effect.s+392,d+side*10,2,1.1,PULSE,18);
        for (let distance=56;distance<=392;distance+=48) chevron(b,c,at,effect.s+distance,d,20,1.25,PULSE);
      } else {
        ribbon(b,c,at,effect.s-24,effect.s,d,20,1.8,[.35,.16,.12],8);
        chevron(b,c,at,effect.s-12,d,20,4,PULSE);
        chevron(b,c,at,effect.s,d,20,6,[1,.88,.68]);
      }
      out.push(boundedMesh(b,{static:false,emissive:true,featureKind:'pulse',featurePhase:effect.phase,
        effectOwnerId:effect.ownerId,effectSerial:effect.serial}));
    }
    return out;
  }
  return Object.freeze({ rgb, builder, course, actors, actorMeshes, faceMesh, actorHeight, featureMeshes });
});
