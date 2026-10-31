/* Shared art kit — one palette, one set of cheap draw helpers.
   Anything that paints the world (the core renderer, new enemies, power-ups)
   should take its colors from SpaceManArt.C and its glows/shadows/eyes from
   here, so a new thing looks like it belongs the moment it lands.
   Rules the helpers keep: no shadowBlur/filter, no per-frame gradients (glows are
   cached sprites), no Math.random (the renderer must never perturb the run). */
(function (root) {
  'use strict';
  if (typeof module === 'object' && module.exports) { require('./cosmetics.js'); require('./anim.js'); }
  const { TAU, clamp } = typeof module === 'object' && module.exports ? require('./math.js') : root.SpaceManMath;

  // The palette — mirrors the CSS custom properties on :root.
  const C = Object.freeze({
    void: '#060818', nebula: '#131A3A', horizon: '#2A2560',
    cyan: '#38E1FF', cyanLt: '#9FF1FF', suit: '#F4F7FF', orange: '#FFB454',
    green: '#4EF07A', greenDk: '#1F9E4E', coral: '#FF4F66', gold: '#FFC93C', goldLt: '#FFE59A',
    ui: '#CFE3FF', ink: '#0A1428', panel: 'rgba(10,14,32,0.86)', panelSolid: '#0A0E20',
    flare: '#FF8A6B',
  });
  // Semantic roles for gameplay reads — keep hazards warm, friends cool, rewards gold.
  const ROLE = Object.freeze({ hazard: C.coral, friend: C.cyan, reward: C.gold, enemy: C.green, text: C.ui, power: '#B87BFF' });

  // The shared regions of the Lantern Reach (docs/art-direction.md). A mode that
  // visits a place takes its sky and accent from here, so Bloom reads as Bloom
  // whether you run, brawl or race there.
  const REGIONS = Object.freeze({
    orbital: Object.freeze({ name: 'Orbital Dock', skyTop: '#060818', horizon: '#18264A', accent: '#38E1FF' }),
    bloom: Object.freeze({ name: 'Bloom', skyTop: '#061817', horizon: '#173C36', accent: '#4EF07A' }),
    ember: Object.freeze({ name: 'Ember', skyTop: '#1A0C20', horizon: '#46202D', accent: '#FFB454' }),
    prism: Object.freeze({ name: 'Prism', skyTop: '#12152B', horizon: '#2B2A4A', accent: '#B4A6E8' }),
    aurora: Object.freeze({ name: 'Aurora', skyTop: '#0B1D33', horizon: '#1D3C55', accent: '#9FF1FF' }),
    neon: Object.freeze({ name: 'Neon', skyTop: '#150A2B', horizon: '#32124A', accent: '#FF5FD2' }),
    nebula: Object.freeze({ name: 'Nebula', skyTop: '#1A0D2E', horizon: '#3A2052', accent: '#B87BFF' }),
  });
  const CIRCUIT_REGIONS = Object.freeze({ starlight: 'orbital', ember: 'ember', bloom: 'bloom', prism: 'prism', aurora: 'aurora', neon: 'neon', nebula: 'nebula' });
  const unitRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mixRgb = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);
  // Sky dome colors for a circuit (SpaceManRender3D scene.sky): the region's
  // gradient, a horizon glow lit by its accent and darker space below. haze is
  // the fog color, so distant track sinks into the sky instead of into black.
  // A lantern season (SpaceManSeasons state) floats lanterns over the horizon.
  function circuitSky(course, season = root.SpaceManSeasons && root.SpaceManSeasons.current()) {
    const region = REGIONS[CIRCUIT_REGIONS[course && course.id]] || REGIONS.orbital;
    const top = unitRgb(region.skyTop), horizon = unitRgb(region.horizon), accent = unitRgb(region.accent);
    const lamp = root.SpaceManSeasons && season ? root.SpaceManSeasons.lanternColor(season) : null;
    return Object.freeze({ region: region.name, top, horizon, glow: mixRgb(horizon, accent, 0.16),
      ground: top, haze: mixRgb(horizon, top, 0.5), stars: 320,
      lanterns: lamp ? 24 : 0, lanternColor: lamp ? unitRgb(lamp) : null });
  }

  // Render-only Circuit design tokens. Physics retains its authored course data.
  const STARLIGHT_MATERIALS = Object.freeze({ road: '#294052', edge: '#86cdbf',
    curb: '#9aadaf', apron: '#172935', outerEdge: '#42646d', accent: '#bdeca2',
    housing: '#c6d6d3', ink: '#152a38', joint: '#355161', ramp: '#36586a' });
  const PRISM_MATERIALS = Object.freeze({ road: '#344559', edge: '#a8d7dc',
    curb: '#aebbbf', apron: '#242b41', outerEdge: '#615f7e', accent: '#f4ce84',
    housing: '#d9d8dc', ink: '#202639', joint: '#48556b', ramp: '#4a647a',
    stone: '#726882', strata: '#a294ac', crystal: '#b4d8df' });
  function circuitPalette(course) {
    if (course.id === 'prism') return PRISM_MATERIALS;
    if (course.id === 'starlight') return STARLIGHT_MATERIALS;
    return { road: course.road, edge: course.edge, accent: course.accent,
      curb: '#bdced0', apron: '#13202b', outerEdge: course.edge, housing: '#c6d6d3', ink: '#152a38', joint: '#355161', ramp: '#36586a' };
  }
  // Coordinates are [side, up]. Both canvas and mesh render these exact glyphs.
  const circuitGlyphs = Object.freeze({
    coin: Object.freeze(Array.from({length:10}, (_,i) => {
      const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4 : 8.5;
      return Object.freeze([Math.cos(a)*r, Math.sin(a)*r]);
    })),
    shield: Object.freeze([[-12,13],[12,13],[12,-2],[8,-10],[0,-17],[-8,-10],[-12,-2]].reverse().map(Object.freeze)),
    pulse: Object.freeze([[0,17],[13,1],[5,1],[5,-15],[-5,-15],[-5,1],[-13,1]].reverse().map(Object.freeze)),
  });
  const circuitStructureCache = new WeakMap();
  function circuitStructures(course, at, distance) {
    if (!['starlight','prism'].includes(course.id)) return [];
    if (circuitStructureCache.has(course)) return circuitStructureCache.get(course);
    const structures = [], half = course.width / 2, clearance = (course.runoff || 0) + 40;
    if (course.id === 'prism') {
      // Broad authored outcrops form a valley, then open up for the gallery.
      // Radius includes the entire footprint, tested against every road segment.
      const bluffs = [[.025,-1,120,130],[.10,-1,148,190],[.215,-1,125,145],
        [.32,-1,130,205],[.42,-1,165,175],[.51,-1,115,110],
        [.77,-1,145,185],[.87,-1,120,145],[.18,1,80,95],[.70,1,75,105]];
      for(const [index,[fraction,side,radius,height]] of bluffs.entries()) {
        const p=at(course,fraction*course.length), offset=half+radius+clearance+24,
          x=p.x-p.ty*offset*side,z=p.y+p.tx*offset*side;
        if(distance(course,x,z)<half+radius+clearance) continue;
        structures.push(Object.freeze({x,z,heading:Math.atan2(p.ty,p.tx),radius,
          kind:'mesa',variant:index%3,width:radius*(index%3===1?1.85:1.55),depth:radius*(index%3===2?1.25:.95),height}));
      }
      const result=Object.freeze(structures);circuitStructureCache.set(course,result);return result;
    }
    // Three legible working clusters, with open skyline between them.
    for (const [fraction, side, kind] of [[.025,-1,'bay'],[.29,1,'relay'],[.69,-1,'dock']]) {
      for (let i=0; i<3; i++) {
        const p=at(course,fraction*course.length+(i-1)*100), radius=kind==='dock'?58:48;
        for(let offset=half+250;offset<half+750;offset+=32) {
          const x=p.x-p.ty*offset*side,z=p.y+p.tx*offset*side;
          if(distance(course,x,z)<half+radius+clearance || structures.some(other=>Math.hypot(other.x-x,other.z-z)<other.radius+radius+24)) continue;
          structures.push(Object.freeze({x,z,heading:Math.atan2(p.ty,p.tx),radius,
            kind, width:kind==='dock'?88:72, depth:48, height:kind==='relay'?42+i*12:26+i*5}));
          break;
        }
      }
    }
    const result=Object.freeze(structures);circuitStructureCache.set(course,result);return result;
  }

  // The mesh and Canvas share these exact authored mesa footprint rings.
  function circuitMesaRings(structure) {
    const {x,z,width,depth,height,heading,variant=0}=structure,co=Math.cos(heading),si=Math.sin(heading);
    return [[-8,1],[height*.45,.87],[height*.48,.91],[height*.88,.66],[height,.58]].map(([y,scale]) =>
      Array.from({length:8},(_,i)=>{const a=i*Math.PI/4,f=Math.cos(a)*width/2*scale,d=Math.sin(a)*depth/2*scale;
        const lean=y>0?height*.09*(y/height)*(variant-1):0;
        return [x+co*(f+lean)-si*d,y+(y===height?Math.sin(a*2+variant)*height*.055:0),z+si*(f+lean)+co*d];}));
  }
  const circuitShelfCache = new WeakMap();
  function circuitCanyonShelves(course,at,distance) {
    if(course.id!=='prism')return [];
    if(circuitShelfCache.has(course))return circuitShelfCache.get(course);
    const shelves=[],front=course.width/2+(course.runoff||0)+72;
    // Three long rock shelves bind the separate outcrops into a canyon wall.
    // Open skyline is deliberately retained around the gallery and finish.
    for(const [start,end,peak] of [[.015,.255,66],[.305,.505,82],[.775,.955,58]]) {
      const count=Math.ceil((end-start)*course.length/55),sections=[];
      for(let i=0;i<=count;i++) {
        const u=i/count,p=at(course,course.length*(start+(end-start)*u)),
          rise=Math.sin(Math.PI*u),h=12+peak*rise,
          lanes=[[0,-10],[65,h*.72],[160,h],[260,-10]];
        const points=lanes.map(([d,y])=>[p.x+p.ty*(front+d),y,p.y-p.tx*(front+d)]);
        if(points.some(([x,y,z])=>distance(course,x,z)<front-1))throw new RangeError('Canyon shelf intersects driving clearance');
        sections.push(Object.freeze(points.map(Object.freeze)));
      }
      shelves.push(Object.freeze(sections));
    }
    const result=Object.freeze(shelves);circuitShelfCache.set(course,result);return result;
  }
  const circuitConnectionCache = new WeakMap();
  function circuitConnections(course, at, distance) {
    if(circuitConnectionCache.has(course)) return circuitConnectionCache.get(course);
    const structures=circuitStructures(course,at,distance), connections=[];
    for(let i=1;i<structures.length;i++) {
      const a=structures[i-1],b=structures[i];if(a.kind!==b.kind || a.kind==='mesa')continue;
      const length=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.ceil(length/8),
        required=course.width/2+(course.runoff||0)+40+7+4;
      let clear=true;
      for(let n=0;n<=steps;n++) if(distance(course,a.x+(b.x-a.x)*n/steps,a.z+(b.z-a.z)*n/steps)<required){clear=false;break;}
      if(clear)connections.push(Object.freeze({a,b,width:14}));
    }
    const result=Object.freeze(connections);circuitConnectionCache.set(course,result);return result;
  }

  // Biome colors for a sector hue (degrees). Pure: same hue → same strings.
  // sky* are the gradient stops, ridge* the two skyline silhouettes (far/near),
  // rim the light catching the ridge tops, mote the ambient dust tint.
  function biome(hue) {
    const h = ((hue % 360) + 360) % 360;
    return {
      hue: h,
      ridgeFar: `hsl(${h} 34% 11%)`, ridgeNear: `hsl(${h} 40% 7%)`,
      rimFar: `hsla(${(h + 330) % 360}, 80%, 70%, 0.22)`, rimNear: `hsla(${(h + 340) % 360}, 90%, 72%, 0.35)`,
      mote: `hsla(${(h + 180) % 360}, 70%, 85%, 1)`, accent: `hsl(${(h + 150) % 360} 85% 66%)`,
      glow: `hsla(${h}, 85%, 62%, 0.35)`,
    };
  }

  // Seamless 1-D ridge profile: integer-frequency sines over the tile width so
  // column 0 and column W match. Returns heights 0..1 into out (length W+1).
  function ridgeProfile(W, seed, rough, out) {
    const f = [1, 2, 3, 5, 8, 13], a = [0.5, 0.25, 0.14, 0.07, 0.035 * rough, 0.02 * rough];
    const ph = f.map((_, i) => (Math.sin((seed + 1) * (i + 1) * 91.7) * 0.5 + 0.5) * TAU);
    for (let x = 0; x <= W; x++) {
      let v = 0;
      // low octaves roll, high octaves are 'ridged' (1-|sin|) so crests come to peaks
      for (let i = 0; i < f.length; i++) {
        const s = Math.sin((x / W) * TAU * f[i] + ph[i]);
        v += (i < 2 ? s : (1 - Math.abs(s)) * 2 - 1) * a[i];
      }
      out[x] = clamp(0.5 + v, 0, 1);
    }
    return out;
  }

  const cache = new Map();
  function makeCanvas(w, h) {
    const c = root.document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  // Cached radial glow: the only sanctioned way to make something glow.
  function glow(radius, color, inner) {
    const key = 'g' + radius + color + (inner || 0.35);
    let c = cache.get(key);
    if (!c) {
      c = makeCanvas(radius * 2, radius * 2);
      const g = c.getContext('2d'), grd = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
      grd.addColorStop(0, color); grd.addColorStop(inner || 0.35, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(radius, radius, radius, 0, TAU); g.fill();
      cache.set(key, c);
    }
    return c;
  }
  // Soft elliptical contact shadow under anything standing on a slab.
  // strength 0..1 (fade it with height above the surface).
  function contactShadow(ctx, x, y, w, strength) {
    if (strength <= 0.02) return;
    const s = glow(32, 'rgba(0,0,0,0.55)', 0.3);
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * clamp(strength, 0, 1);
    ctx.drawImage(s, x - w / 2, y - w * 0.14, w, w * 0.28);
    ctx.globalAlpha = a;
  }

  /* Cartoon eyes in the house style (the aliens' look), for any new character.
     lookX/lookY -1..1, lid 0 open..1 closed, mood 0 neutral 1 happy 2 wide 3 sleepy. */
  function eyes(ctx, x, y, spacing, rx, ry, lookX, lookY, lid, mood, white, pupil) {
    for (let s = -1; s <= 1; s += 2) {
      const ex = x + s * spacing;
      if (mood === 1) {   // happy ^^
        ctx.strokeStyle = pupil || C.ink; ctx.lineWidth = Math.max(1, rx * 0.45); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(ex, y + ry * 0.35, rx * 0.85, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        continue;
      }
      const open = mood === 3 ? 0.45 : mood === 2 ? 1.15 : 1;
      const h = Math.max(0.6, ry * open * (1 - lid));
      ctx.fillStyle = white || '#FFFFFF';
      ctx.beginPath(); ctx.ellipse(ex, y, rx, h, 0, 0, TAU); ctx.fill();
      if (h > 1.2) {
        const pr = Math.min(rx, h) * (mood === 2 ? 0.38 : 0.52);
        ctx.fillStyle = pupil || C.ink;
        ctx.beginPath(); ctx.arc(ex + lookX * rx * 0.35, y + lookY * h * 0.3, pr, 0, TAU); ctx.fill();
      }
    }
  }


  // Arena is the character reference: a pale pressure suit, dark glass, paired
  // LED eyes and small, crisp instrument panels. These are render-only helpers.
  function rrPath(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  const defaultAppearance = Object.freeze({ v: 1, suit: 'classic', hat: 'none', eyes: 'bright', helmet: 'round', detail: 'plain', ship: 'comet' });
  const defaultPalette = Object.freeze({ suit: C.suit, legB: '#9FB3E0', legF: '#C6D4F5', arm: '#E4ECFF', pack: C.orange, visTop: '#61D9FF', visBot: '#1479FF' });
  function characterStyle(value, accent, palette) {
    const cosmetics = root.SpaceManCosmetics;
    const appearance = cosmetics ? cosmetics.getAppearance(value || defaultAppearance) : { ...defaultAppearance, ...(value || {}) };
    const colors = palette || (cosmetics ? cosmetics.palette(appearance) : defaultPalette);
    return { appearance, palette: colors, accent: /^#[0-9a-f]{6}$/i.test(accent || '') ? accent : colors.visTop };
  }
  // Pure face sample shared by Canvas and the small 3D visor overlay. Reactions
  // override an equipped resting expression, without changing the pilot's eyes.
  function facePose({ eyes = 'bright', mood = 0, lid = 0, lookX = 0, lookY = 0, tick = 0, id = 0, calm = false } = {}) {
    const blink = !calm && ((Math.floor(tick) + (Number(id) || 0) * 71) % 237 + 237) % 237 < 6;
    const closed = Math.max(clamp(lid, 0, 1), blink ? 1 : 0);
    return { happy: mood === 1 || (!mood && eyes === 'happy'),
      determined: !mood && eyes === 'determined',
      height: (mood === 2 ? 4.2 : mood === 3 || (!mood && eyes === 'calm') ? 1.5 : 3.2) * (1 - closed),
      width: mood === 2 ? 1.9 : 1.6, closed: closed > .8,
      lookX: clamp(lookX, -1, 1), lookY: clamp(lookY, -1, 1) };
  }
  function arenaMood(actor) {
    if (actor.stun > 0 || actor.boss?.phase === 'active') return 2;
    return actor.boss?.phase === 'recover' || actor.boss?.phase === 'defeated' ? 3 : 0;
  }
  function visorEyes(c, x, y, pose) {
    c.strokeStyle = '#DFFBFF'; c.fillStyle = '#DFFBFF'; c.lineCap = 'round';
    for (const side of [-1, 1]) {
      const ex = x + side * 2.05 + pose.lookX * 1.4, ey = y + pose.lookY * .8;
      if (pose.happy && !pose.closed) {
        c.lineWidth = 1.3; c.beginPath(); c.arc(ex, ey + .9, 1.25, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      } else if (pose.determined && !pose.closed) {
        c.lineWidth = 1.6; c.beginPath(); c.moveTo(ex - .6, ey + side * .5); c.lineTo(ex + .6, ey - side * .5); c.stroke();
      } else {
        rrPath(c, ex - pose.width / 2, ey - Math.max(.7, pose.height) / 2, pose.width, Math.max(.7, pose.height), .35); c.fill();
      }
    }
  }
  function characterHelmet(c, x, y, style, expression = {}, accessory = true) {
    const a = style.appearance, P = style.palette, accent = style.accent;
    c.save(); c.translate(x, y);
    // A neck gasket separates the helmet from the suit, even at gameplay size.
    c.fillStyle = '#415D78'; rrPath(c, -5, 7, 10, 4, 2); c.fill();
    c.fillStyle = P.suit;
    if (a.helmet === 'retro') { rrPath(c, -11, -10.5, 22, 21, 7); c.fill(); }
    else { c.beginPath(); c.arc(0, 0, 11, 0, TAU); c.fill(); }
    c.strokeStyle = accent; c.lineWidth = 1.6; c.beginPath(); c.arc(0, 0, 9.5, Math.PI * 1.1, Math.PI * 1.85); c.stroke();
    c.fillStyle = '#102D49';
    if (a.helmet === 'bubble') { c.beginPath(); c.ellipse(1, -.2, 8.7, 7.8, 0, 0, TAU); c.fill(); }
    else { rrPath(c, -5, -6, 14, 10, a.helmet === 'retro' ? 2.8 : 4.5); c.fill(); }
    c.fillStyle = P.visTop; c.globalAlpha *= .48; rrPath(c, -3, -5, 10, 2.1, 1); c.fill(); c.globalAlpha /= .48;
    const face = facePose({ ...expression, eyes: a.eyes });
    visorEyes(c, 3, -.4, face);
    // Keep the highlight away from the eyes. The old runner glint crossed them.
    c.fillStyle = '#FFFFFF'; c.globalAlpha *= .8; c.beginPath(); c.ellipse(-5, -6.2, 2.4, 1.2, -.65, 0, TAU); c.fill(); c.globalAlpha /= .8;
    c.fillStyle = P.legB; rrPath(c, -11, -2.5, 3.5, 5, 1.5); c.fill();
    c.fillStyle = accent; c.fillRect(-10.2, -1.6, 1.7, 1.2);
    // Integrated short comms aerial, distinct from the tall antenna accessory.
    if (a.hat === 'none') {
      c.strokeStyle = accent; c.lineWidth = 1.4; c.beginPath(); c.moveTo(-5, -10); c.lineTo(-7, -14); c.stroke();
      c.fillStyle = accent; c.beginPath(); c.arc(-7, -14, 1.8, 0, TAU); c.fill();
    }
    if (a.detail === 'stars') {
      c.fillStyle = accent; c.beginPath(); c.moveTo(-6, 3); c.lineTo(-5, 5); c.lineTo(-3, 6); c.lineTo(-5, 7); c.lineTo(-6, 9); c.lineTo(-7, 7); c.lineTo(-9, 6); c.lineTo(-7, 5); c.fill();
    }
    if (accessory) characterHat(c, a.hat, 1, P);
    c.restore();
  }
  function suitDetails(c, x, y, style) {
    c.save(); c.translate(x, y);
    c.strokeStyle = style.palette.legB; c.lineWidth = .8;
    c.beginPath(); c.moveTo(-6, 0); c.lineTo(-6, 6); c.moveTo(6, 0); c.lineTo(6, 6); c.stroke();
    c.fillStyle = '#243C57'; rrPath(c, -4, -1, 8, 7, 2); c.fill();
    c.fillStyle = style.accent; rrPath(c, -2.5, .3, 5, 2.3, .8); c.fill();
    c.fillStyle = '#DFFBFF'; c.fillRect(-2.3, 3.5, 1.3, 1); c.fillRect(.3, 3.5, 2, 1);
    c.fillStyle = style.palette.legB; rrPath(c, -6.5, 8, 13, 1.5, .6); c.fill();
    if (style.appearance.detail === 'stripe') {
      c.fillStyle = style.accent; c.fillRect(-7, -2, 2, 9); c.fillRect(5, -2, 2, 9);
    } else if (style.appearance.detail === 'stars') {
      c.fillStyle = style.accent; c.save(); c.translate(5.5, 5); c.rotate(Math.PI / 4); c.fillRect(-1, -1, 2, 2); c.restore();
    }
    c.restore();
  }
  function characterHat(c, id, scale = 1, palette = defaultPalette) {
    const hat = characterHats[id]; if (!hat || id === 'none') return;
    c.save(); c.scale(scale, scale); hat.draw(c, palette); c.restore();
  }

const characterHats = {
  none: { name: 'NO HAT', draw() {} },
  antenna: { name: 'ANTENNA', draw(c, palette) {
    c.strokeStyle = '#C6D4F5'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, -11); c.lineTo(0, -17); c.stroke();
    c.fillStyle = '#FFC93C'; c.beginPath(); c.arc(0, -18, 2.5, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,201,60,.4)'; c.beginPath(); c.arc(0, -18, 4, 0, TAU); c.fill();   // pre-baked halo
  } },
  sprout: { name: 'SPROUT', draw(c, palette) {
    c.strokeStyle = '#35C46B'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, -10); c.quadraticCurveTo(1, -15, 3, -17); c.stroke();
    c.fillStyle = '#4ADE87';
    c.beginPath(); c.ellipse(0.5, -15, 3, 1.6, -0.6, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(4.5, -17.5, 3, 1.6, 0.5, 0, TAU); c.fill();
  } },
  beanie: { name: 'BEANIE', draw(c, palette) {
    c.fillStyle = '#FF6B8A'; c.beginPath(); c.arc(0, -8, 9.5, Math.PI, 0); c.closePath(); c.fill();   // dome
    c.fillStyle = '#E14E6E'; rrPath(c, -9.5, -9, 19, 3.5, 1.75); c.fill();
    c.fillStyle = '#FFF3F6'; c.beginPath(); c.arc(0, -18, 2.8, 0, TAU); c.fill();                     // pom
  } },
  halo: { name: 'HALO', draw(c, palette) {
    c.strokeStyle = 'rgba(255,233,168,.35)'; c.lineWidth = 4;
    c.beginPath(); c.ellipse(0, -15, 8, 2.4, 0, 0, TAU); c.stroke();
    c.strokeStyle = '#FFE9A8'; c.lineWidth = 1.8;
    c.beginPath(); c.ellipse(0, -15, 8, 2.4, 0, 0, TAU); c.stroke();   // double-stroke glow
  } },
  crown: { name: 'CROWN', draw(c, palette) {
    c.fillStyle = '#FFC93C'; c.beginPath();
    c.moveTo(-7, -9); c.lineTo(-7, -15); c.lineTo(-3.5, -12); c.lineTo(0, -17);
    c.lineTo(3.5, -12); c.lineTo(7, -15); c.lineTo(7, -9); c.closePath(); c.fill();
    c.fillStyle = '#FF4F66'; c.beginPath(); c.arc(0, -12, 1.3, 0, TAU); c.fill();
  } },
  cone: { name: 'PARTY CONE', draw(c, palette) {
    c.fillStyle = '#B87BFF'; c.beginPath();
    c.moveTo(-5, -9); c.lineTo(5, -9); c.lineTo(0, -20); c.closePath(); c.fill();
    c.strokeStyle = '#F4F7FF'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-3.4, -12.5); c.lineTo(3.4, -12.5); c.moveTo(-1.9, -16); c.lineTo(1.9, -16); c.stroke();
    c.fillStyle = '#FFC93C'; c.beginPath(); c.arc(0, -20, 2, 0, TAU); c.fill();
  } },
  catears: { name: 'STAR CAT', draw(c, palette) {   // suit-colored ears, pink inner at 55% about the same centroid
    const tri = (m, k) => {
      const pts = [[-8.5, -7], [-3, -10], [-6.5, -16]], cx = -6, cy = -11;
      c.beginPath();
      pts.forEach(([x, y], i) => { const px = (cx + (x - cx) * k) * m, py = cy + (y - cy) * k; i ? c.lineTo(px, py) : c.moveTo(px, py); });
      c.closePath(); c.fill();
    };
    c.fillStyle = palette.suit; tri(1, 1); tri(-1, 1);
    c.fillStyle = '#FF9ECF'; tri(1, 0.55); tri(-1, 0.55);
  } },
  phones: { name: 'HEADPHONES', draw(c, palette) {
    c.strokeStyle = '#38E1FF'; c.lineWidth = 2.5; c.lineCap = 'round';
    c.beginPath(); c.arc(0, 0, 12.5, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke();
    c.fillStyle = '#1479FF'; rrPath(c, -14, -3, 4.5, 8, 2); c.fill(); rrPath(c, 9.5, -3, 4.5, 8, 2); c.fill();
    c.fillStyle = '#9FF1FF';
    c.beginPath(); c.arc(-11.75, 1, 1.2, 0, TAU); c.fill();
    c.beginPath(); c.arc(11.75, 1, 1.2, 0, TAU); c.fill();
  } },
};


  // Shared authored planform for both the canvas and WebGL craft.
  function hoverHullOutline(angle) {
    const c=Math.cos(angle), s=Math.sin(angle);
    return [Math.max(-21,4+28*c),9.4+2.3*c+.8*s*s,13.5*s*(.96+.12*c)];
  }
  const hoverHullPath=Object.freeze(Array.from({length:64},(_,i)=>Object.freeze(hoverHullOutline(i*Math.PI/32))));
  function hoverpod(c, style, { tick = 20, id = 0, calm = false, boosting = false, hero = false, shadow = true } = {}) {
    const P = style.palette, accent = style.accent, ship = style.appearance.ship;
    c.save();
    if (shadow) {
      for(let ring=4;ring>0;ring--) {c.save();c.globalAlpha*=.035;c.fillStyle='#102337';c.beginPath();c.ellipse(0,3,23+ring*1.5,14+ring,0,0,TAU);c.fill();c.restore();}
    }
    if (ship === 'orbit') {
      c.strokeStyle = accent; c.lineWidth = 1.6; c.beginPath(); c.ellipse(-8,0,20,24,0,0,TAU);c.stroke();
    }
    for(const side of [-1,1]) {
      c.fillStyle=accent;c.beginPath();c.moveTo(7,side*11);c.lineTo(-13,side*9);c.lineTo(-15,side*17);c.lineTo(5,side*17);c.closePath();c.fill();
      if(ship==='leaf'){c.beginPath();c.moveTo(-21,side*17);for(let i=0;i<=16;i++){const t=i/16;c.lineTo(-21+17*t,side*(17+9*Math.sin(t*Math.PI)));}c.lineTo(-4,side*17);c.closePath();c.fill();}
      const center=side*17;
      if(boosting||hero) {
        // Layered faint ovals approximate the same soft engine-energy falloff
        // as WebGL without allocating gradients or painting a hard white spear.
        for(let ring=3;ring>0;ring--) {c.save();c.globalAlpha*=(4-ring)*.04;c.fillStyle=ring===1?'#CBF7FF':accent;c.beginPath();c.ellipse(-26-ring*.6,center,3+ring*1.1,.6+ring*.5,0,0,TAU);c.fill();c.restore();}
      }
      // Same truncated rear / slim waist / rounded leading tip as the 3D pod.
      c.fillStyle=accent;c.beginPath();c.moveTo(-23,center-3.3);c.bezierCurveTo(-18,center-4.5,5,center-4.2,15,center-2.3);c.quadraticCurveTo(21,center,15,center+2.3);c.bezierCurveTo(5,center+4.2,-17,center+4.5,-23,center+3.3);c.closePath();c.fill();
      c.fillStyle='#DFFBFF';c.beginPath();c.moveTo(-13,center-.4);c.quadraticCurveTo(1,center-1,14,center);c.quadraticCurveTo(1,center+.7,-13,center+.4);c.fill();
      c.fillStyle='#244557';rrPath(c,-21,center-3.6,1.4,7.2,.5);c.fill();
      c.fillStyle='#193349';rrPath(c,-23.8,center-3.3,1.6,6.6,.6);c.fill();
      c.fillStyle='#CBF7FF';c.beginPath();c.ellipse(-23.9,center, .65,2,0,0,TAU);c.fill();
    }
    const hull = offset => {c.beginPath();hoverHullPath.forEach((p,i)=>{if(i)c.lineTo(p[0],p[2]+offset);else c.moveTo(p[0],p[2]+offset);});c.closePath();};
    c.fillStyle=P.legB;hull(1.7);c.fill();c.fillStyle=P.suit;hull(0);c.fill();
    c.fillStyle=accent;c.beginPath();c.moveTo(9,-2.7);c.quadraticCurveTo(21,-2.2,29,0);c.quadraticCurveTo(21,2.2,9,2.7);c.closePath();c.fill();
    c.fillStyle='#152D43';c.beginPath();c.ellipse(-5,0,10,7.8,0,0,TAU);c.fill();
    c.fillStyle=P.suit;rrPath(c,-10,-3,11,8,3);c.fill();
    c.save();c.translate(-7,1);c.scale(.62,.62);suitDetails(c,0,0,style);c.restore();
    c.fillStyle=P.legB;rrPath(c,-16,-3,3.5,6,1.4);c.fill();c.fillStyle=accent;rrPath(c,-16.3,-1.5,1,3,.5);c.fill();
    c.save();c.translate(-5,-2);c.scale(.75,.75);characterHelmet(c,0,0,style,{tick,id,calm,mood:boosting?1:0});c.restore();
    if(style.appearance.detail==='stripe'){c.strokeStyle=accent;c.lineWidth=1.2;c.beginPath();c.moveTo(-8,10);c.lineTo(14,8);c.stroke();}
    if(style.appearance.detail==='stars'){c.fillStyle=accent;c.save();c.translate(18,5);c.rotate(Math.PI/4);c.fillRect(-1.5,-1.5,3,3);c.restore();}
    c.restore();
  }
  // One limb language shared by every drawn astronaut (wardrobe/home avatar and the in-match sprite).
  function limbKit(c, style) {
    const P = style.palette;
    // One limb language for arms and legs: a hairline outline under a rounded sleeve,
    // a cuff band in the accent colour, and a mitten or boot in suit white. The far
    // side (back leg, back arm) takes the same shapes in the shaded palette, with a
    // soft dark wash so it recedes without becoming a different design.
    const FAR = 'rgba(8,18,40,.2)';
    const tube = (x1, y1, cx, cy, x2, y2, fill, edge, w) => {
      c.lineCap = 'round'; c.beginPath(); c.moveTo(x1, y1); c.quadraticCurveTo(cx, cy, x2, y2);
      c.strokeStyle = edge; c.lineWidth = w + 1.3; c.stroke();
      c.strokeStyle = fill; c.lineWidth = w; c.stroke();
    };
    // Cuff then mitten (hand) or boot (foot), drawn in the limb's own frame: +y points away from the body.
    const cuff = (x, y, angle, far) => {
      c.save(); c.translate(x, y); c.rotate(angle);
      c.fillStyle = P.legB; rrPath(c, -2.1, -2, 4.2, 2.3, 1); c.fill();
      c.fillStyle = style.accent; c.fillRect(-1.7, -1.3, 3.4, .7);
      c.restore();
    };
    const mitten = (x, y, angle, far) => {
      c.save(); c.translate(x, y); c.rotate(angle);
      c.fillStyle = far ? P.legB : P.suit; c.strokeStyle = P.legB; c.lineWidth = .6;
      c.beginPath(); c.ellipse(0, 1.6, 2.1, 2.4, 0, 0, TAU); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(-1.8, 1.2, .8, 1.3, -.4, 0, TAU); c.fill(); c.stroke();
      if (far) { c.fillStyle = FAR; c.beginPath(); c.ellipse(0, 1.6, 2.1, 2.4, 0, 0, TAU); c.fill(); }
      c.restore();
    };
    const boot = (x, y, far) => {
      cuff(x, y - 1.5, 0, far);
      c.save(); c.translate(x, y);
      c.fillStyle = far ? P.legB : P.suit; c.strokeStyle = P.legB; c.lineWidth = .6;
      c.beginPath(); c.ellipse(1.1, .8, 2.8, 1.6, 0, 0, TAU); c.fill(); c.stroke();
      if (far) { c.fillStyle = FAR; c.beginPath(); c.ellipse(1.1, .8, 2.8, 1.6, 0, 0, TAU); c.fill(); }
      c.restore();
    };
    const arm = (sx, sy, ex, ey, hx, hy, far, cap = true) => {
      tube(sx, sy, ex, ey, hx, hy, far ? P.legB : P.arm, P.legB, 3.1);
      if (far) { c.strokeStyle = FAR; c.lineWidth = 3.1; c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(ex, ey, hx, hy); c.stroke(); }
      // The sleeve's round end is the shoulder. A separate white cap reads as a lump beside the helmet, so the near arm omits it.
      if (cap) {
        c.fillStyle = far ? P.legB : P.suit; c.strokeStyle = P.legB; c.lineWidth = .7; c.beginPath(); c.arc(sx, sy, 2.4, 0, TAU); c.fill(); c.stroke();
        if (far) { c.fillStyle = FAR; c.beginPath(); c.arc(sx, sy, 2.4, 0, TAU); c.fill(); }
      }
      const wrist = Math.atan2(hy - ey, hx - ex) - Math.PI / 2;
      cuff(hx, hy, wrist, far); mitten(hx, hy, wrist, far);
    };
    return { tube, cuff, mitten, boot, arm };
  }

  /* ---- The Spacefarer rig -------------------------------------------------------
     The one astronaut every 2D surface draws (docs/art-direction.md, "The Spacefarer
     rig"). Frame: the Endless Run sprite's canvas units, a 24x34 hitbox with the
     origin at the body centre, helmet r 11 at y -9 and boots on y 16. (x, y) is the
     ground contact point under the hitbox and scale multiplies the frame, so a
     caller never needs to know the body's insides. Arm angles are radians from
     hanging-down, + toward facing (the Run's convention). Pure: no state, no
     Math.random, no gradients or blur; the same pose always paints the same calls,
     and the helmet always paints last so no limb or shoulder can cross the visor. */
  const RIG_LEG_IN = { runCycle: 0, speed: 0, onGround: true, pose: 0, hang: false, hangT: 0, crouch: 0, launch: 0, stomp: 0, groundY: 16, hipY: 4, hipX: 4, len: 6.4 };
  const RIG_LEG = new Float32Array(12), RIG_HAND = new Float32Array(3);
  const RIG_FAR = 'rgba(8,18,40,.2)', RIG_SLATE = '#415D78';
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const mix = (a, b, t) => a + (b - a) * t;
  // anim.js loads after art.js in the page; the rig only needs it at draw time.
  // The fallback is the same two-bone solve, kept for a page that loads art.js alone.
  function rigLegs(o, out) {
    const anim = root.SpaceManAnim;
    if (anim && anim.legPose) return anim.legPose(o, out);
    for (let leg = 0; leg < 2; leg++) {
      const hx = leg ? -o.hipX : o.hipX, i = leg * 6, fx = hx * .7, fy = o.groundY;
      out[i] = hx; out[i + 1] = o.hipY; out[i + 2] = (hx + fx) / 2 + 1.5; out[i + 3] = (o.hipY + fy) / 2; out[i + 4] = fx; out[i + 5] = fy;
    }
    return out;
  }
  // One sleeve: a quadratic capsule (the Run's armCapsule) with a hairline edge.
  // Writes the hand point and the wrist angle (limb frame, +y away from the body).
  function rigSleeve(c, sx, sy, ang, len, bend, fill, edge, far) {
    const hx = sx + Math.sin(ang) * len, hy = sy + Math.cos(ang) * len;
    const mx = (sx + hx) / 2 + Math.cos(ang) * bend, my = (sy + hy) / 2 - Math.sin(ang) * bend;
    c.lineCap = 'round'; c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(mx, my, hx, hy);
    c.strokeStyle = edge; c.lineWidth = 4.1; c.stroke();
    c.strokeStyle = fill; c.lineWidth = 2.8; c.stroke();
    if (far) { c.strokeStyle = RIG_FAR; c.stroke(); }
    RIG_HAND[0] = hx; RIG_HAND[1] = hy; RIG_HAND[2] = Math.atan2(hy - my, hx - mx) - Math.PI / 2;
    return RIG_HAND;
  }
  // The wrist: a cuff exactly as wide as the sleeve's outline, so the forearm runs into
  // it with no step, and the mitten overlaps the cuff's lower half so no gap can open.
  function rigCuff(c, P, accent, x, y, angle) {
    c.save(); c.translate(x, y); c.rotate(angle);
    c.fillStyle = P.legB; rrPath(c, -2.05, -1.7, 4.1, 2, 1); c.fill();
    c.fillStyle = accent; c.fillRect(-1.5, -1.05, 3, .6);
    c.restore();
  }
  function rigMitten(c, P, x, y, angle, far) {
    c.save(); c.translate(x, y); c.rotate(angle);
    c.fillStyle = far ? P.legB : P.suit; c.strokeStyle = P.legB; c.lineWidth = .6;
    c.beginPath(); c.ellipse(1.75, .7, .75, 1.15, .4, 0, TAU); c.fill(); c.stroke();   // thumb toward facing, tucked under the palm
    c.beginPath(); c.ellipse(0, 1.15, 2.1, 2.2, 0, 0, TAU); c.fill(); c.stroke();
    if (far) { c.fillStyle = RIG_FAR; c.beginPath(); c.ellipse(0, 1.15, 2.1, 2.2, 0, 0, TAU); c.fill(); }
    c.restore();
  }
  // A moon boot, origin at the foot point: one rounded shape that rises over the ankle,
  // so the shin always ends inside it (the old separate cuff block and flat disc read
  // as a detached foot). Toe toward facing, a darker sole, the accent on the shaft.
  function rigBoot(c, P, accent, x, y, angle, far) {
    c.save(); c.translate(x, y); c.rotate(angle);
    c.fillStyle = far ? P.legB : P.suit; c.strokeStyle = P.legB; c.lineWidth = .6;
    c.beginPath(); c.moveTo(-1.2, -2.7); c.lineTo(1.1, -2.7);                      // shaft top, one leg wide
    c.quadraticCurveTo(2.5, -2.7, 2.6, -1.1);                                      // instep
    c.quadraticCurveTo(4.1, -1, 4.1, .1); c.quadraticCurveTo(4.1, 1.1, 3, 1.1);    // round toe
    c.lineTo(-1.6, 1.1); c.quadraticCurveTo(-2.7, 1.1, -2.7, -.2);                 // sole, heel
    c.lineTo(-2.7, -1.3); c.quadraticCurveTo(-2.7, -2.7, -1.2, -2.7); c.closePath();
    c.fill(); c.stroke();
    if (far) { c.fillStyle = RIG_FAR; c.fill(); }
    c.fillStyle = P.legB; rrPath(c, -2.1, .3, 5.6, .75, .37); c.fill();          // sole
    c.fillStyle = accent; c.fillRect(-1.6, -2.05, 3.2, .55);                       // shaft band
    c.restore();
  }
  // Gear sits grip-at-origin, emitter toward +x, so the hand is the recoil pivot.
  function rigGear(c, P, gear, color) {
    if (gear === 'emitter') {   // Arena pulse emitter: a team-coloured puck with a bright core
      c.fillStyle = color; rrPath(c, -1.2, -5, 7.4, 6.6, 2.4); c.fill();
      c.fillStyle = RIG_SLATE; c.fillRect(-1.2, -1.6, 2.4, 2.4);
      c.fillStyle = '#E7FEFF'; c.beginPath(); c.arc(3.2, -1.7, 1.6, 0, TAU); c.fill();
    } else {                    // Run light blaster, ~7x4: visBot body, visTop emitter
      c.fillStyle = P.visBot; rrPath(c, -2, -3.6, 7, 3.4, 1.4); c.fill(); c.fillRect(-1.4, -.8, 2.2, 2.2);
      c.fillStyle = P.visTop; c.fillRect(5, -3.3, 1.6, 1.5);
    }
  }

  /* Derive a full pose from a few plain inputs, so a surface gets Run-quality motion
     without animation code of its own. o: { t (s), x (world px, for stride-locked
     feet), vx, vy, onGround, facing, maxSpeed, runCycle, action ('idle' | 'run' |
     'wave' | 'attack' | 'hit' | 'celebrate' | 'hang' | 'aim'), actionT (0..1:
     progress for attack, strength otherwise), squash {x, y}, crouch, lookX, lookY,
     mood, gear, accent, calm, tick, id }. Writes into out (reused) and returns it. */
  function spacefarerPose(o = {}, out = {}) {
    const onGround = o.onGround !== false, facing = o.facing < 0 ? -1 : 1, vx = num(o.vx, 0), vy = num(o.vy, 0), t = num(o.t, 0);
    const speed = onGround ? clamp(Math.abs(vx) / num(o.maxSpeed, 6.8), 0, 1) : 0;
    const sq = o.squash || null, sqY = sq ? num(sq.y, 1) : 1, act = o.action || 'idle', k = clamp(num(o.actionT, 1), 0, 1);
    out.facing = facing; out.t = t; out.calm = !!o.calm; out.onGround = onGround; out.speed = speed;
    // Stride-locked: the Run advances its cycle 0.06 rad per pixel run, so feet never skate.
    out.runCycle = num(o.runCycle, Number.isFinite(o.x) ? o.x * .06 * facing : t * speed * 24);
    out.air = onGround ? 0 : clamp(vy / 6, -1, 1);
    out.lean = clamp(vx * .018, -.14, .14) + (onGround ? 0 : clamp(vy * .008, -.1, .12));
    out.squashX = sq ? num(sq.x, 1) : 1; out.squashY = sqY;
    out.crouch = num(o.crouch, onGround ? clamp((1 - sqY) * 5, 0, 1.2) : 0);
    out.wave = act === 'wave' ? k : 0; out.attack = act === 'attack' ? k : 0; out.hit = act === 'hit' ? k : 0;
    out.celebrate = act === 'celebrate' ? k : 0; out.aim = act === 'aim' ? k : 0;
    out.hang = act === 'hang'; out.hangT = out.hang ? t : 0;
    out.lookX = num(o.lookX, Math.min(speed, .8)); out.lookY = num(o.lookY, onGround ? 0 : vy < 0 ? -.5 : .5);
    out.mood = o.mood ?? null; out.gear = o.gear || null; out.accent = o.accent || null;
    out.tick = num(o.tick, t * 60 + 20); out.id = o.id || 0;
    return out;
  }

  /* Paint the Spacefarer. pose fields (all optional): facing, t, calm, onGround,
     speed 0..1, runCycle, air (-1 rising..1 falling), lean (rad, world), squashX/Y
     (feet-anchored on the ground, centred in the air), crouch 0..1.2, launch, pop
     (stomp stretch), nearArm/farArm (override angles), wave, recoil, attack
     (0..1 progress), aimY (-1 up..1 down), hit, celebrate, hang, hangT, headTilt,
     armBlend with nearArmTo/farArmTo (ease toward authored arm angles), frame(c) (body-frame hook),
     lookX, lookY, mood, lid, tick, id, eyes (expression override), gear ('blaster'
     | 'emitter' | null), gearColor, gearSpin, gearFx(c) (hand frame), accent, palette,
     guardian, halo (cached sprite behind the helmet), frost, hat (false hides it). */
  function drawSpacefarer(c, x, y, scale, appearance, pose = {}) {
    let style = characterStyle(appearance, pose.accent, pose.palette);
    if (pose.eyes && pose.eyes !== style.appearance.eyes) style = { ...style, appearance: { ...style.appearance, eyes: pose.eyes } };
    const P = style.palette, accent = style.accent, calm = !!pose.calm, t = calm ? 0 : num(pose.t, 0);
    const facing = pose.facing < 0 ? -1 : 1, onGround = pose.onGround !== false, hang = !!pose.hang;
    const speed = onGround ? clamp(num(pose.speed, 0), 0, 1) : 0, cyc = num(pose.runCycle, 0), air = clamp(num(pose.air, 0), -1, 1);
    const wave = clamp(num(pose.wave, 0), 0, 1), hit = clamp(num(pose.hit, 0), 0, 1), cheer = clamp(num(pose.celebrate, 0), 0, 1);
    const aim = clamp(num(pose.aim, 0), 0, 1), rec = clamp(num(pose.recoil, 0), 0, 1), atk = clamp(num(pose.attack, 0), 0, 1);
    const crouch = clamp(num(pose.crouch, 0), 0, 1.2) * (calm ? .5 : 1), pop = calm ? 0 : clamp(num(pose.pop, 0), 0, 1);
    // Attack phases match the Arena pulse (4 windup, 7 active of 26 ticks): pull back, jab, settle.
    const windup = atk > 0 && atk < .15 ? atk / .15 : 0, jab = atk >= .15 ? (atk < .45 ? 1 : 1 - (atk - .45) / .55) : 0;
    const strike = jab * jab * (3 - 2 * jab);
    const idle = onGround && !hang && speed < .05 && !wave && !hit && !cheer && !atk;
    const breathe = idle && !calm ? Math.sin(t * 3) * .03 : 0;
    let sx = (num(pose.squashX, 1) + breathe) * (1 - pop * .1) * (1 - hit * .04), sy = (num(pose.squashY, 1) - breathe) * (1 + pop * .14) * (1 + hit * .05);
    if (cheer && !calm) sy *= 1 + Math.sin(t * 12) * .04 * cheer;
    const lean = num(pose.lean, 0) + facing * (strike * .09 - windup * .05 - hit * .2);
    c.save(); c.translate(x, y); c.scale(scale, scale);
    // Feet-anchored squash on the ground (a landing compresses toward the slab);
    // centre pivot in the air, where stretch reads along the jump.
    if (onGround) { c.rotate(lean); c.scale(facing, 1); c.scale(sx, sy); c.translate(0, -17); }
    else { c.translate(0, -17); c.rotate(lean); c.scale(facing, 1); c.scale(sx, sy); }
    if (typeof pose.frame === 'function') pose.frame(c);   // body frame (origin at the body centre): e.g. a clip
    // Torso bob twice per stride, plus the crouch sinking the upper body while the knees take it.
    const bob = (onGround ? Math.sin(cyc * 2) * 1.5 * Math.min(1, speed * 3) : 0) + crouch * 2.6;

    // Legs: two-bone IK (the Run's solver), far leg in the shade tone first.
    const L = RIG_LEG_IN;
    L.runCycle = cyc; L.speed = speed; L.onGround = onGround; L.pose = air * 4; L.hang = hang; L.hangT = num(pose.hangT, 0);
    L.launch = calm ? 0 : clamp(num(pose.launch, 0), 0, 1); L.stomp = pop; L.hipY = 4 + crouch * 2.6;
    const leg = rigLegs(L, RIG_LEG);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let k = 0; k < 2; k++) {
      const i = k * 6, far = k === 0;
      // The shin stops 1.6 short of the foot point, so its round end sits inside the boot shaft.
      const kx = leg[i + 2], ky = leg[i + 3], fx = leg[i + 4], fy = leg[i + 5], sl = Math.hypot(fx - kx, fy - ky) || 1;
      c.beginPath(); c.moveTo(leg[i], leg[i + 1]); c.lineTo(kx, ky); c.lineTo(fx - (fx - kx) / sl * 1.6, fy - (fy - ky) / sl * 1.6);
      c.strokeStyle = P.legB; c.lineWidth = 4.7; c.stroke();
      c.strokeStyle = far ? P.legB : P.legF; c.lineWidth = 3.4; c.stroke();
      if (far) { c.strokeStyle = RIG_FAR; c.stroke(); }
      // Boots stay flat on the ground and point their toes when the foot trails in the air.
      const toe = onGround && !hang ? 0 : clamp((leg[i + 2] - leg[i + 4]) * .12, -.35, .6);
      rigBoot(c, P, accent, leg[i + 4], leg[i + 5], toe, far);
    }

    // Pack: the Run's warm canister in the suit's pack colour, with the Arena's slate
    // vent carrying the crew/team accent, and a nozzle for the jetpack read.
    c.fillStyle = P.pack; c.strokeStyle = P.legB; c.lineWidth = .7; rrPath(c, -13, -6 + bob, 7, 16, 3); c.fill(); c.stroke();
    c.fillStyle = RIG_SLATE; rrPath(c, -12.3, -3 + bob, 2.8, 8.5, 1.2); c.fill(); rrPath(c, -12, 9.4 + bob, 4.2, 2, .8); c.fill();
    c.fillStyle = accent; c.fillRect(-11.8, -2 + bob, 1.8, 5);

    // Arms: the Run's angles. Unarmed hands swing in counter-phase; an armed near hand
    // carries its gear level at speed. Air poses reach forward-up and trail back.
    const sway = calm ? 0 : Math.sin(t * TAU * .8) * .07;
    let nearA, farA, reach = 10;
    if (onGround) {
      const swing = Math.sin(cyc + Math.PI) * .49 * speed;
      nearA = pose.gear ? mix(.55 + sway, 1.35 + swing * .2, speed) : mix(.55 + sway, .5 - swing * 1.1, speed);
      farA = mix(-.5 + sway, -.7 + swing, speed);
    } else {
      const fall = air * .5 + .5;
      nearA = mix(2.18, 1.75, fall); farA = mix(-.85, -.55, fall);
    }
    const dip = Math.max(0, 1 - num(pose.squashY, 1)) * 1.1;
    nearA -= dip; farA -= dip;
    if (aim) nearA = mix(nearA, 1.72, aim);
    // Hello: the sleeve stretches a little so the mitten clears the helmet rim.
    if (wave) { nearA = mix(nearA, 2.35 + (calm ? 0 : Math.sin(t * 14) * .26), wave); reach += wave * 2.6; }
    if (atk) {
      nearA = mix(mix(nearA, .25, windup), 1.62 - clamp(num(pose.aimY, 0), -1, 1) * .55, strike);
      farA = mix(farA, -.75, Math.max(strike, windup * .6)); reach += strike * 2;
    }
    if (cheer) {
      const pump = calm ? 0 : Math.sin(t * 10) * .14;
      // A fist pump in front of the visor line and the far arm flung back: both read
      // beside the head, where a straight overhead V would vanish behind the helmet.
      nearA = mix(nearA, 2.3 + pump, cheer); farA = mix(farA, -2.05 - pump, cheer); reach += cheer * 2.4;
    }
    if (hit) { nearA = mix(nearA, 1.95, hit); farA = mix(farA, -1.25, hit); }   // flinch: guard up, far arm thrown back
    if (hang) { const s = Math.sin(num(pose.hangT, 0) * 6) * .07; nearA = 2.78 + s; farA = 2.62 + s; }
    nearA += rec * .24;
    const blend = clamp(num(pose.armBlend, 0), 0, 1);   // a caller's authored arm pose, eased over the motion
    if (blend) { nearA = mix(nearA, num(pose.nearArmTo, nearA), blend); farA = mix(farA, num(pose.farArmTo, farA), blend); }
    if (Number.isFinite(pose.nearArm)) nearA = pose.nearArm;
    if (Number.isFinite(pose.farArm)) farA = pose.farArm;

    // Far arm behind the torso (shade tone + wash), from the pack-side shoulder.
    const fh = rigSleeve(c, -5, -6 + bob, farA, 12, -1.8, P.legB, P.legB, true);
    const fhx = fh[0], fhy = fh[1], fw = fh[2];
    rigCuff(c, P, accent, fhx, fhy, fw); rigMitten(c, P, fhx, fhy, fw, true);

    c.fillStyle = P.suit; c.strokeStyle = P.legB; c.lineWidth = .7; rrPath(c, -8, -4 + bob, 16, 16, 6); c.fill(); c.stroke();
    suitDetails(c, 0, bob, style);
    if (pose.guardian) {
      // Guardian plating and three charge cells; the helmet still paints over the shoulders.
      c.fillStyle = P.legB; rrPath(c, -12, -4 + bob, 6, 7, 2); c.fill(); rrPath(c, 6, -4 + bob, 6, 7, 2); c.fill();
      c.fillStyle = accent; for (let i = 0; i < 3; i++) c.fillRect(-3 + i * 2.5, 9.6 + bob, 1.5, 1.6);
    }

    // Near arm over the torso. The shoulder sits under the neck seal, inside the
    // helmet's footprint, so the helmet (painted next) always covers the joint.
    const nh = rigSleeve(c, 5, -6 + bob, nearA, reach, -1.8, P.arm, P.legB, false);
    const nhx = nh[0], nhy = nh[1], nw = nh[2];
    rigCuff(c, P, accent, nhx, nhy, nw);
    if (pose.gear) {
      const gearA = (1.35 - nearA) * .65 - rec * .2 + num(pose.gearSpin, 0);
      c.save(); c.translate(nhx, nhy); c.rotate(gearA);
      rigGear(c, P, pose.gear, pose.gearColor || accent);
      c.fillStyle = P.arm; c.strokeStyle = P.legB; c.lineWidth = .6; c.beginPath(); c.arc(0, .4, 2.1, 0, TAU); c.fill(); c.stroke();   // glove wraps the grip
      if (typeof pose.gearFx === 'function') pose.gearFx(c);
      c.restore();
    } else rigMitten(c, P, nhx, nhy, nw, false);

    // Head group, last: rides a softened bob, nods with the crouch and tips with a hit.
    const tilt = calm ? 0 : num(pose.headTilt, 0);
    c.save(); c.translate(0, -9 + bob * .35 + crouch * .8); c.rotate(tilt - pop * .08 - hit * .16 + strike * .05);
    if (pose.halo) c.drawImage(pose.halo, -20, -12, 40, 40);
    const mood = pose.mood ?? (hit > .2 ? 2 : cheer > .2 || wave > .15 ? 1 : 0);
    characterHelmet(c, 0, 0, style, { mood, lid: num(pose.lid, 0), lookX: num(pose.lookX, 0), lookY: num(pose.lookY, 0),
      tick: num(pose.tick, 20), id: pose.id || 0, calm }, pose.hat !== false);
    if (pose.frost) {   // seasonal frost creeping in from the visor edge
      c.strokeStyle = 'rgba(228,248,255,0.9)'; c.lineWidth = 1.4; c.lineCap = 'round';
      c.beginPath(); c.ellipse(1, 0, 6.6, 5.6, 0, -2.8, -1.15); c.stroke();
      c.beginPath(); c.ellipse(1, 0, 6.6, 5.6, 0, .7, 1.4); c.stroke();
      c.fillStyle = 'rgba(228,248,255,0.85)'; c.fillRect(-3.4, -4.8, 1.2, 1.2); c.fillRect(4.2, 3, 1, 1);
    }
    c.restore();
    c.restore();
  }
  // Full appearance preview with no dependency on a running game or player.
  // x/y is the slot center; size is the total headwear-to-boot height in pixels.
  function drawAvatar(c, x, y, size, appearance, { time = 0, reduceMotion = false, ship = false, greeting = 0, lookX = 0, lookY = 0, mood = null, blaster = null } = {}) {
    const k = size / 54, hello = reduceMotion ? 0 : clamp(greeting, 0, 1);
    c.save(); c.translate(x, y + size * .13); c.scale(k, k);
    if (ship) { const style = characterStyle(appearance); c.scale(.78, .78); c.rotate(-.18); hoverpod(c, style, { tick: time * 60 + 20, calm: reduceMotion, hero: true }); c.restore(); return; }
    c.fillStyle = '#0005'; c.beginPath(); c.ellipse(0, 18, 12, 2.8, 0, 0, TAU); c.fill();
    c.restore();
    // The same rig as Arena and the Run: an idle stance that breathes and sways, the
    // greeting as a real wave, and a raised pulse emitter when the lobby asks for one.
    drawSpacefarer(c, x, y + size * .13 + 17 * k, k, appearance, { t: time, calm: reduceMotion, onGround: true, speed: 0,
      wave: hello, aim: blaster ? 1 : 0, gear: blaster ? 'emitter' : null, gearColor: blaster, mood, lookX, lookY, tick: time * 60 + 20 });
  }

  // Screen-space identity is deliberately independent of suit/team color.
  // Reserve the local/followed pilot first, then move or omit crowded labels.
  function identityLayout(items, bounds, obstacles = []) {
    const placed = [];
    const overlaps = (a, b, gap = 4) => a.x < b.x + b.w + gap && a.x + a.w > b.x - gap && a.y < b.y + b.h + gap && a.y + a.h > b.y - gap;
    for (const item of [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
      const w = Math.min(item.w, bounds.right - bounds.left), h = item.h || 22;
      const own = obstacles.find(b => b.id === item.id), primary = !!item.primary || item.priority >= 2;
      const candidates = [[item.x, item.y], [item.x, item.y - h - 5]];
      // At the HUD boundary, move beside the pilot instead of clamping onto
      // their face. Size side placements from the actual body, not text width.
      if (own) candidates.push([own.x - w / 2 - 7, item.y], [own.x + own.w + w / 2 + 7, item.y]);
      candidates.push([item.x - w / 2 - 8, item.y], [item.x + w / 2 + 8, item.y], [item.x, item.y - 2 * (h + 5)]);
      const boxes = (item.fixed ? candidates.slice(0, 1) : candidates).map(([cx, cy]) => ({ ...item, w, h, x: Math.max(bounds.left, Math.min(bounds.right - w, cx - w / 2)), y: Math.max(bounds.top, Math.min(bounds.bottom - h, cy)) }));
      const available = box => !placed.some(b => overlaps(box, b));
      let box = boxes.find(b => available(b) && !obstacles.some(o => overlaps(b, o, 2)));
      // Ownership never disappears merely because somebody else crowds you.
      // Keep avoiding the local body even when secondary bodies must yield.
      if (!box && primary) box = boxes.find(b => available(b) && (!own || !overlaps(b, own, 2)));
      if (box) placed.push(box);
    }
    return placed;
  }
  // Place a compact cue around the projected craft, not on another racer.
  // Side placements include a short line back to the focused craft's edge.
  function identityMarkerLayout(id, bodies, bounds) {
    const own = bodies.find(b => b.id === id); if (!own) return null;
    const w = 20, h = 16, cx = own.x + own.w / 2, cy = own.y + own.h / 2;
    const overlap = (a, b) => a.x < b.x + b.w + 2 && a.x + a.w > b.x - 2 && a.y < b.y + b.h + 2 && a.y + a.h > b.y - 2;
    const crosses = (x1,y1,x2,y2,b) => {
      let lo=0, hi=1;
      for(const [start,delta,min,max] of [[x1,x2-x1,b.x-2,b.x+b.w+2],[y1,y2-y1,b.y-2,b.y+b.h+2]]) {
        if(Math.abs(delta)<1e-6){if(start<min||start>max)return false;continue;}
        const a=(min-start)/delta,z=(max-start)/delta;
        lo=Math.max(lo,Math.min(a,z));hi=Math.min(hi,Math.max(a,z));if(lo>hi)return false;
      }
      return true;
    };
    for (const gap of [6, 18, 30]) {
      const candidates = [
        [cx - w / 2, own.y - gap - h], [own.x - gap - w, cy - h / 2],
        [own.x + own.w + gap, cy - h / 2], [cx - w / 2, own.y + own.h + gap],
        [own.x-gap-w,own.y-gap-h],[own.x+own.w+gap,own.y-gap-h],
        [own.x-gap-w,own.y+own.h+gap],[own.x+own.w+gap,own.y+own.h+gap],
      ];
      for (const [x, y] of candidates) {
        const box = { id, x, y, w, h };
        if (x < bounds.left || x + w > bounds.right || y < bounds.top || y + h > bounds.bottom || bodies.some(b => overlap(box, b))) continue;
        const dx = x + w / 2 - cx, dy = y + h / 2 - cy;
        const edge = 1 / Math.max(Math.abs(dx) / (own.w / 2), Math.abs(dy) / (own.h / 2));
        const targetX=cx+dx*edge,targetY=cy+dy*edge,link=Math.abs(dx)>1||dy>0||gap>6;
        const length=Math.hypot(dx,dy),lineX=x+w/2-dx/length*9,lineY=y+h/2-dy/length*9;
        if(link&&bodies.some(b=>b.id!==id&&crosses(lineX,lineY,targetX,targetY,b)))continue;
        const leader=link?{x:Math.min(lineX,targetX)-2,y:Math.min(lineY,targetY)-2,
          w:Math.abs(lineX-targetX)+4,h:Math.abs(lineY-targetY)+4}:null;
        return { ...box, targetX, targetY, link, leader };
      }
    }
    return null; // The HUD remains authoritative when the visible corridor is full.
  }
  // A quiet, screen-pixel ownership cue. Local and followed pilots differ by
  // silhouette, not suit color. No box, selection frame, or animation competes
  // with the character. The dark keyline survives bright platform/effect pixels.
  function identityCue(c, x, y, role = 'you', targetX = x, targetY = y + 20, link = false) {
    c.save(); c.globalAlpha = 1; c.translate(x, y);
    c.lineJoin = 'round'; c.lineCap = 'round';
    if (link) {
      const angle = Math.atan2(targetY-y, targetX-x), dx = Math.cos(angle), dy = Math.sin(angle);
      c.beginPath(); c.moveTo(dx*9, dy*9); c.lineTo(targetX-x, targetY-y);
      c.strokeStyle = '#071522'; c.lineWidth = 3.5; c.stroke();
      c.strokeStyle = '#EAF7FF'; c.lineWidth = 1.25; c.stroke();
    }
    c.beginPath();
    if (role === 'watching') {
      c.moveTo(-7, 0); c.quadraticCurveTo(0, -7, 7, 0);
      c.quadraticCurveTo(0, 7, -7, 0); c.closePath();
      c.strokeStyle = '#071522'; c.lineWidth = 5; c.stroke();
      c.strokeStyle = '#EAF7FF'; c.lineWidth = 1.75; c.stroke();
      c.beginPath(); c.arc(0, 0, 1.75, 0, TAU); c.fillStyle = '#EAF7FF'; c.fill();
    } else {
      // A HUD-boundary side placement still points to the same pilot.
      c.rotate(Math.atan2(targetY - y, targetX - x) - Math.PI / 2);
      c.moveTo(-6, -3); c.lineTo(0, 1); c.lineTo(6, -3);
      c.lineTo(0, 6); c.closePath();
      c.strokeStyle = '#071522'; c.lineWidth = 3; c.stroke();
      c.fillStyle = '#EAF7FF'; c.fill();
    }
    c.restore();
  }

  // A floating paper lantern: warm body, dark cap and foot, a short string and a
  // cached glow. x/y is the body's centre; size is its height in pixels.
  function lantern(c, x, y, size, color, glowColor = '#FFD08A') {
    const w = size * .72, h = size;
    c.save();
    c.globalAlpha *= .55; c.drawImage(glow(32, glowColor, .1), x - size * 1.6, y - size * 1.6, size * 3.2, size * 3.2); c.globalAlpha /= .55;
    c.strokeStyle = '#2A1A22'; c.lineWidth = Math.max(1, size * .06);
    c.beginPath(); c.moveTo(x, y - h * .5); c.lineTo(x, y - h * .95); c.stroke();
    c.fillStyle = color; rrPath(c, x - w / 2, y - h / 2, w, h, w * .45); c.fill();
    c.fillStyle = 'rgba(255,240,200,.45)'; rrPath(c, x - w * .18, y - h * .36, w * .2, h * .6, w * .1); c.fill();
    c.fillStyle = '#2A1A22'; c.fillRect(x - w * .32, y - h * .58, w * .64, h * .12); c.fillRect(x - w * .26, y + h * .46, w * .52, h * .1);
    c.restore();
  }
  // Static seasonal decor for cached backdrops (Arena, previews): lanterns for
  // Dusk and Lantern Week, snow for the Long Night, petals for the equinox.
  // season is a SpaceManSeasons state; hashing the index keeps it deterministic.
  function seasonBackdrop(c, w, h, season) {
    if (!season) return;
    const seasons = root.SpaceManSeasons, M = seasons ? seasons.MOTIFS : null;
    if (!M) return;
    const rand = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    c.save();
    const lit = seasons.lanternColor(season);
    if (lit) for (let i = 0; i < 9; i++) {
      const size = Math.max(9, Math.min(w, h) * (.022 + rand(i + 3) * .02));
      c.globalAlpha = .55 + rand(i + 7) * .35;
      lantern(c, w * (.06 + i * .11 + rand(i) * .05), h * (.12 + rand(i + 11) * .42), size, lit, M.lanterns.glow);
    }
    if (season.frost) { c.fillStyle = M.snow.color; for (let i = 0; i < 90; i++) { c.globalAlpha = .25 + rand(i + 40) * .45; c.beginPath(); c.arc(rand(i + 50) * w, rand(i + 60) * h, .8 + rand(i + 70) * 1.6, 0, TAU); c.fill(); } }
    if (season.blossom) { c.fillStyle = M.petals.color; for (let i = 0; i < 26; i++) { c.globalAlpha = .35 + rand(i + 80) * .4; c.beginPath(); c.ellipse(rand(i + 90) * w, rand(i + 100) * h, 3.2, 1.8, rand(i + 110) * TAU, 0, TAU); c.fill(); } }
    c.restore();
  }

  // A carved pumpkin lantern: Dusk Week falls on Halloween, so the Reach's
  // lanterns there are jack-o'-lanterns.
  function pumpkin(c, x, y, r, lit = 1) {
    c.save();
    c.globalAlpha *= .5 * lit; c.drawImage(glow(32, '#FFB25A', .1), x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8); c.globalAlpha /= .5 * lit;
    c.fillStyle = '#E0662A'; c.beginPath(); c.ellipse(x - r * .42, y, r * .62, r * .86, 0, 0, TAU); c.ellipse(x + r * .42, y, r * .62, r * .86, 0, 0, TAU); c.fill();
    c.fillStyle = '#FF8A3D'; c.beginPath(); c.ellipse(x, y, r * .62, r * .9, 0, 0, TAU); c.fill();
    c.fillStyle = '#4E6B34'; c.fillRect(x - r * .1, y - r * 1.12, r * .2, r * .3);
    c.fillStyle = '#FFE08A';
    for (const side of [-1, 1]) { c.beginPath(); c.moveTo(x + side * r * .18, y - r * .08); c.lineTo(x + side * r * .52, y - r * .08); c.lineTo(x + side * r * .35, y - r * .4); c.closePath(); c.fill(); }
    c.beginPath(); c.moveTo(x - r * .5, y + r * .2);
    for (let i = 1; i <= 6; i++) c.lineTo(x - r * .5 + i * r / 6, y + r * (i % 2 ? .44 : .26));
    c.lineTo(x, y + r * .56); c.closePath(); c.fill();
    c.restore();
  }
  // Little holiday props, in hero units (the home hero is 640 x 400).
  function heart(c, x, y, r, color) {
    c.fillStyle = color; c.beginPath(); c.moveTo(x, y + r * .9);
    c.bezierCurveTo(x - r * 1.5, y - r * .1, x - r * .7, y - r * 1.2, x, y - r * .45);
    c.bezierCurveTo(x + r * .7, y - r * 1.2, x + r * 1.5, y - r * .1, x, y + r * .9); c.fill();
  }
  function clover(c, x, y, r, color, a = 0) {
    c.save(); c.translate(x, y); c.rotate(a); c.fillStyle = color;
    for (let i = 0; i < 3; i++) { c.save(); c.rotate(i * TAU / 3); heart(c, 0, -r * .55, r * .55, color); c.restore(); }
    c.strokeStyle = color; c.lineWidth = Math.max(1, r * .16); c.lineCap = 'round'; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(r * .2, r * .6, r * .5, r * 1.1); c.stroke();
    c.restore();
  }
  function leaf(c, x, y, r, color, a) {
    c.save(); c.translate(x, y); c.rotate(a); c.fillStyle = color;
    c.beginPath(); c.moveTo(0, -r); c.quadraticCurveTo(r * .9, -r * .2, 0, r); c.quadraticCurveTo(-r * .9, -r * .2, 0, -r); c.fill();
    c.strokeStyle = 'rgba(60,30,20,.45)'; c.lineWidth = .8; c.beginPath(); c.moveTo(0, -r * .8); c.lineTo(0, r * 1.2); c.stroke();
    c.restore();
  }
  // A round little turkey with a fanned tail: Thanksgiving, readable at 40 px.
  function turkey(c, x, y, s, colors, t) {
    const bob = Math.sin(t * 3) * 1.2 * s;
    for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * .36; c.fillStyle = colors[i % colors.length]; c.beginPath(); c.ellipse(x + Math.cos(a) * 15 * s, y - 8 * s + Math.sin(a) * 15 * s, 4.6 * s, 11 * s, a + Math.PI / 2, 0, TAU); c.fill(); }
    c.fillStyle = '#7A4A2E'; c.beginPath(); c.ellipse(x, y - 6 * s, 11 * s, 10 * s, 0, 0, TAU); c.fill();
    c.fillStyle = '#9A6240'; c.beginPath(); c.ellipse(x + 6 * s, y - 16 * s + bob, 5.4 * s, 6 * s, 0, 0, TAU); c.fill();
    c.fillStyle = '#FFC93C'; c.beginPath(); c.moveTo(x + 10.5 * s, y - 17 * s + bob); c.lineTo(x + 15 * s, y - 15.5 * s + bob); c.lineTo(x + 10.5 * s, y - 14 * s + bob); c.fill();
    c.fillStyle = '#E2524A'; c.beginPath(); c.ellipse(x + 10 * s, y - 12 * s + bob, 1.6 * s, 3 * s, 0, 0, TAU); c.fill();
    c.fillStyle = '#10202C'; c.beginPath(); c.arc(x + 7.5 * s, y - 17.5 * s + bob, 1.3 * s, 0, TAU); c.fill();
    c.strokeStyle = '#E8A33A'; c.lineWidth = 1.6 * s; c.lineCap = 'round'; c.beginPath(); c.moveTo(x - 3 * s, y + 3 * s); c.lineTo(x - 4 * s, y + 7 * s); c.moveTo(x + 3 * s, y + 3 * s); c.lineTo(x + 4 * s, y + 7 * s); c.stroke();
  }
  // A small decorated tree with a star: the winter holidays.
  function tree(c, x, y, s, t) {
    c.fillStyle = '#6B4A34'; c.fillRect(x - 3 * s, y - 6 * s, 6 * s, 6 * s);
    [[0, 30, 24], [12, 24, 19], [23, 18, 14]].forEach(([up, w, h]) => { c.fillStyle = '#2F8F5B'; c.beginPath(); c.moveTo(x - w / 2 * s, y - (6 + up) * s); c.lineTo(x + w / 2 * s, y - (6 + up) * s); c.lineTo(x, y - (6 + up + h) * s); c.closePath(); c.fill(); });
    [[-7, -12, '#FF5A4E'], [6, -16, '#FFC93C'], [-3, -24, '#9FF1FF'], [5, -30, '#FF5A4E'], [-1, -37, '#FFC93C']].forEach(([dx, dy, col], i) => {
      c.globalAlpha = .75 + .25 * Math.sin(t * 3 + i * 1.7); c.fillStyle = col; c.beginPath(); c.arc(x + dx * s, y + dy * s, 1.9 * s, 0, TAU); c.fill();
    });
    c.globalAlpha = 1; star4(c, x, y - 49 * s, 5 * s, '#FFE08A');
  }
  function star4(c, x, y, r, color) {
    c.fillStyle = color; c.beginPath();
    for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4, d = i % 2 ? r * .42 : r; c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); }
    c.closePath(); c.fill();
  }
  // A pot of gold for St. Patrick's Day.
  function potOfGold(c, x, y, s, t) {
    [[-6, -15], [0, -18], [6, -15], [-3, -21], [3, -21]].forEach(([dx, dy], i) => { c.fillStyle = i % 2 ? '#FFE08A' : '#FFC93C'; c.beginPath(); c.ellipse(x + dx * s, y + dy * s, 4.2 * s, 3 * s, 0, 0, TAU); c.fill(); });
    c.fillStyle = '#1E2630'; c.beginPath(); c.ellipse(x, y - 7 * s, 13 * s, 10 * s, 0, 0, TAU); c.fill();
    c.fillStyle = '#2E3A46'; c.fillRect(x - 13 * s, y - 15 * s, 26 * s, 4 * s);
    c.globalAlpha = .7 + .3 * Math.sin(t * 4); star4(c, x + 8 * s, y - 24 * s, 3.4 * s, '#FFF4C2'); c.globalAlpha = 1;
  }
  // Seasons on the home hero. layer 'back' paints once into the cached backdrop;
  // 'mid' runs before the characters and 'buddy' inside the alien's transform
  // (so a prop hops with it), both every living frame with t in seconds (t
  // null: a still pose for reduced motion and first paint). The headline event
  // picks the look, so each holiday reads as itself. No Math.random: a still
  // frame is the same on every device.
  function homeSeason(c, layer, season, t) {
    const seasons = root.SpaceManSeasons, M = seasons && seasons.MOTIFS, s = season || (seasons && seasons.current());
    const e = seasons && seasons.headline(s);
    if (!M || !e) return false;
    const motif = e.motif, still = !(t >= 0), time = still ? 0 : t;
    const rand = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const warm = motif === 'pumpkins' ? M.pumpkins.glow : motif === 'lanterns' ? M.lanterns.lunar : motif === 'hearts' ? M.hearts.color : motif === 'harvest' ? M.harvest.colors[1] : motif === 'clovers' ? M.clovers.gold : null;
    // Things that rise or fall through the scene: lanes keep the astronaut clear.
    const drift = (n, speed, paint, fall) => {
      for (let i = 0; i < n; i++) {
        const lane = [42, 118, 186, 470, 538, 606, 150, 520, 84, 572][i % 10], span = 470, v = speed * (.75 + rand(i) * .6);
        const p = (time * v + rand(i + 9) * span) % span, y = fall ? p - 40 : 420 - p, x = lane + Math.sin(time * .6 + i * 1.9) * 8;
        const fade = Math.max(0, Math.min(1, (420 - y) / 50, (y + 40) / 70));
        if (fade > 0) { c.globalAlpha = fade; paint(x, y, i); }
      }
    };
    c.save();
    if (layer === 'back') {
      if (warm) { c.globalAlpha = .4; c.drawImage(glow(64, warm, .05), 140, 210, 360, 180); }
      if (motif === 'snow' || s.frost) {
        // Snow settled on the pad rim and the ringed planet's cap.
        c.globalAlpha = .92; c.fillStyle = M.snow.color;
        c.beginPath(); c.ellipse(320, 296, 106, 9, 0, Math.PI, TAU); c.fill();
        c.beginPath(); c.ellipse(482, 70, 22, 8, -.25, Math.PI * .95, Math.PI * 2.05); c.fill();
      }
      if (motif === 'petals') { c.globalAlpha = .3; c.drawImage(glow(64, M.petals.color, .05), 150, 220, 340, 160); }
    } else if (layer === 'mid') {
      if (motif === 'pumpkins') {
        drift(7, 11, (x, y, i) => { c.globalAlpha *= .85 + .15 * Math.sin(time * 2.1 + i); if (i % 2) lantern(c, x, y, 13 + rand(i + 3) * 7, M.lanterns.dusk, M.lanterns.glow); else pumpkin(c, x, y, 8 + rand(i + 3) * 4); });
        // A big carved pumpkin on the pad, flickering like a real candle.
        c.globalAlpha = 1; pumpkin(c, 236, 278, 19, .85 + .15 * Math.sin(time * 7) * Math.sin(time * 3.1));
      } else if (motif === 'lanterns') {
        drift(8, 12, (x, y, i) => { c.globalAlpha *= .8 + .2 * Math.sin(time * 2.1 + i); lantern(c, x, y, 14 + rand(i + 3) * 8, M.lanterns.lunar, M.lanterns.glow); });
      } else if (motif === 'harvest') {
        drift(9, 16, (x, y, i) => leaf(c, x, y, 5 + rand(i + 3) * 3, M.harvest.colors[i % 4], time * (1 + rand(i)) + i), true);
        c.globalAlpha = 1; turkey(c, 236, 296, 1.25, M.harvest.colors, time);
      } else if (motif === 'hearts') {
        drift(9, 13, (x, y, i) => heart(c, x, y, 6 + rand(i + 3) * 5, i % 3 ? M.hearts.color : M.hearts.light));
      } else if (motif === 'clovers') {
        drift(8, 14, (x, y, i) => clover(c, x, y, 7 + rand(i + 3) * 4, M.clovers.color, time * .8 + i), true);
        c.globalAlpha = 1; potOfGold(c, 236, 296, 1.15, time);
      } else if (motif === 'petals') {
        c.fillStyle = M.petals.color;
        drift(10, 12, (x, y, i) => { c.beginPath(); c.ellipse(x, y, 3.8, 2.1, time * (1 + rand(i)) + i, 0, TAU); c.fill(); }, true);
      } else if (motif === 'fireworks') {
        const colors = s.july4 ? M.fireworks.july4 : M.fireworks.colors;
        [[128, 70], [520, 52], [574, 196], [76, 214]].forEach(([x, y], b) => {
          const k = still ? .38 : ((time + b * 1.1) % 3.4) / 3.4;
          if (k > .62) return;
          const ease = 1 - Math.pow(1 - k / .62, 3), r = 14 + 40 * ease;
          c.fillStyle = colors[b % colors.length]; c.globalAlpha = 1 - k / .62;
          for (let i = 0; i < 16; i++) { const a = i * TAU / 16 + b; c.beginPath(); c.arc(x + Math.cos(a) * r, y + Math.sin(a) * r + 9 * ease * ease, 2.6 * (1 - k * .8), 0, TAU); c.fill(); }
        });
      }
      if (motif === 'snow' || s.frost) {
        c.fillStyle = M.snow.color;
        for (let i = 0; i < 52; i++) {
          const y = ((rand(i + 20) * 420 + time * (14 + rand(i) * 18)) % 420) - 10, x = rand(i + 40) * 640 + Math.sin(time * .8 + i) * 6;
          c.globalAlpha = .35 + rand(i + 60) * .5; c.beginPath(); c.arc(x, y, 1.1 + rand(i + 80) * 1.9, 0, TAU); c.fill();
        }
        if (motif === 'snow') { c.globalAlpha = 1; tree(c, 238, 298, 1.05, time); }
      }
    } else if (layer === 'buddy') {
      // The alien's own touch. Head top is about (417, 254); the antenna is at x 408.
      const sway = still ? 0 : Math.sin(time * 2.4) * .16;
      const stick = (paint) => {
        c.strokeStyle = '#D9C9A0'; c.lineWidth = 2; c.lineCap = 'round';
        c.beginPath(); c.moveTo(427, 282); c.lineTo(441, 244); c.stroke();
        const hx = 441 + Math.sin(sway) * 8, hy = 244 + Math.cos(sway) * 8;
        c.lineWidth = 1.2; c.beginPath(); c.moveTo(441, 244); c.lineTo(hx, hy); c.stroke(); paint(hx, hy);
      };
      if (motif === 'pumpkins') stick((x, y) => pumpkin(c, x, y + 7, 7.5));
      else if (motif === 'lanterns') stick((x, y) => lantern(c, x, y + 8, 14, M.lanterns.lunar, M.lanterns.glow));
      else if (motif === 'hearts') {
        // A heart balloon on a string.
        const bx = 444 + Math.sin(time * 1.3) * 3, by = 222 + Math.sin(time * 1.9) * 2;
        c.strokeStyle = '#F6E9EE'; c.lineWidth = 1; c.beginPath(); c.moveTo(428, 280); c.quadraticCurveTo(440, 252, bx, by + 9); c.stroke();
        heart(c, bx, by, 10, M.hearts.color); c.globalAlpha = .55; heart(c, bx - 3, by - 3, 3, '#FFFFFF');
      } else if (motif === 'snow') {
        // A Santa hat, tipped away from the antenna, and a little scarf.
        c.fillStyle = '#E2524A'; c.beginPath(); c.ellipse(415, 281, 13, 3.6, 0, 0, TAU); c.fill(); c.fillRect(419, 281, 4.5, 11);
        c.save(); c.translate(422, 255); c.rotate(.42 + sway * .3);
        c.fillStyle = '#E2524A'; c.beginPath(); c.moveTo(-8, 0); c.quadraticCurveTo(-2, -16, 9, -14); c.lineTo(8, 0); c.closePath(); c.fill();
        c.fillStyle = '#F6F2EA'; c.fillRect(-9, -2.5, 18, 4.5); c.beginPath(); c.arc(9, -14, 3, 0, TAU); c.fill(); c.restore();
      } else if (motif === 'clovers') {
        c.save(); c.translate(423, 254); c.rotate(.3 + sway * .3);
        c.fillStyle = '#2E9A50'; c.fillRect(-9, -2, 18, 3); c.fillRect(-6, -13, 12, 11);
        c.fillStyle = '#FFC93C'; c.fillRect(-6, -5, 12, 2.4); c.restore();
      } else if (motif === 'harvest') leaf(c, 425, 252, 6, M.harvest.colors[0], .9 + sway);
      else if (motif === 'petals') {
        c.fillStyle = M.petals.color;
        for (let i = 0; i < 5; i++) { const a = i * TAU / 5; c.beginPath(); c.ellipse(427 + Math.cos(a) * 3.6, 255 + Math.sin(a) * 3.6, 2.8, 2, a, 0, TAU); c.fill(); }
        c.fillStyle = '#FFE08A'; c.beginPath(); c.arc(427, 255, 2, 0, TAU); c.fill();
      } else if (motif === 'fireworks') {
        if (s.july4) stick((x, y) => { for (let r = 0; r < 5; r++) { c.fillStyle = r % 2 ? '#FFFFFF' : '#FF4F5E'; c.fillRect(x, y - 8 + r * 2.2, 16, 2.2); } c.fillStyle = '#3D5AB8'; c.fillRect(x, y - 8, 7, 6.6); });
        else {
          // A party hat.
          c.translate(424, 254); c.rotate(.35 + sway * .3);
          c.fillStyle = '#9FF1FF'; c.beginPath(); c.moveTo(-7, 0); c.lineTo(7, 0); c.lineTo(0, -17); c.closePath(); c.fill();
          c.fillStyle = '#FFC93C'; c.fillRect(-4.5, -6, 9, 2.4); c.beginPath(); c.arc(0, -17, 2.6, 0, TAU); c.fill();
        }
      }
    }
    c.restore();
    return true;
  }

  // Easing set shared by render code (and mirrored by the CSS --ease tokens).
  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  };

  const api = { REGIONS, circuitSky, lantern, pumpkin, homeSeason, seasonBackdrop, circuitCanyonShelves, circuitMesaRings, circuitConnections, circuitPalette, circuitGlyphs, circuitStructures, C, ROLE, biome, ridgeProfile, glow, contactShadow, eyes, ease, makeCanvas, characterStyle, facePose, arenaMood, visorEyes, characterHelmet, suitDetails, characterHat, characterHats, hoverHullOutline, hoverpod, limbKit, spacefarerPose, drawSpacefarer, drawAvatar, identityLayout, identityMarkerLayout, identityCue };
  root.SpaceManArt = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
