/* Shared art kit — one palette, one set of cheap draw helpers.
   Anything that paints the world (the core renderer, new enemies, power-ups)
   should take its colors from SpaceManArt.C and its glows/shadows/eyes from
   here, so a new thing looks like it belongs the moment it lands.
   Rules the helpers keep: no shadowBlur/filter, no per-frame gradients (glows are
   cached sprites), no Math.random (the renderer must never perturb the run). */
(function (root) {
  'use strict';
  if (typeof module === 'object' && module.exports) require('./cosmetics.js');
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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


  function hoverpod(c, style, { tick = 20, id = 0, calm = false, boosting = false, hero = false } = {}) {
    const P = style.palette, accent = style.accent, ship = style.appearance.ship;
    c.save();
    c.fillStyle = '#0006'; c.beginPath(); c.ellipse(0, 5, 28, 19, 0, 0, TAU); c.fill();
    if (boosting || hero) {
      c.fillStyle = accent; c.globalAlpha *= .35; c.beginPath(); c.moveTo(-19, -8); c.lineTo(-44 - (calm ? 0 : tick % 6), 0); c.lineTo(-19, 8); c.fill(); c.globalAlpha /= .35;
      c.fillStyle = '#DFFBFF'; c.beginPath(); c.moveTo(-22, -3); c.lineTo(-34, 0); c.lineTo(-22, 3); c.fill();
    }
    if (ship === 'orbit') {
      c.strokeStyle = '#415D78'; c.lineWidth = 5; c.beginPath(); c.ellipse(-8, 0, 17, 20, 0, 0, TAU); c.stroke();
      c.strokeStyle = accent; c.lineWidth = 1.5; c.stroke();
    }
    for (const side of [-1, 1]) {
      c.fillStyle = '#243C57'; rrPath(c, -23, side * 16 - 4, 41, 9, 4); c.fill();
      c.fillStyle = accent; rrPath(c, -22, side * 16 - 4, 38, 6, 3); c.fill();
      if (ship !== 'orbit') {
        c.beginPath(); c.moveTo(-21, side * 14); c.lineTo(ship === 'leaf' ? 8 : -8, side * 17);
        c.lineTo(ship === 'leaf' ? -14 : -25, side * (ship === 'leaf' ? 26 : 23)); c.closePath(); c.fill();
      }
      c.fillStyle = '#DFFBFF'; rrPath(c, -24, side * 16 - 2, 3, 4, 1); c.fill();
      c.fillStyle = '#102D49'; c.fillRect(-13, side * 16 - 2, 7, 1);
    }
    c.fillStyle = P.legB; c.beginPath(); c.moveTo(29, 1); c.quadraticCurveTo(18, -13, -14, -12); c.lineTo(-22, -5); c.lineTo(-22, 7); c.lineTo(-13, 14); c.quadraticCurveTo(18, 14, 29, 1); c.fill();
    c.fillStyle = P.suit; c.beginPath(); c.moveTo(29, -1); c.quadraticCurveTo(18, -14, -13, -12); c.lineTo(-21, -5); c.lineTo(-21, 5); c.lineTo(-13, 11); c.quadraticCurveTo(18, 12, 29, -1); c.fill();
    c.fillStyle = accent; rrPath(c, 12, -4, 13, 5, 2.5); c.fill();
    c.strokeStyle = P.legB; c.lineWidth = .8; c.beginPath(); c.moveTo(15, 5); c.lineTo(23, 2); c.stroke();
    c.fillStyle = '#243C57'; rrPath(c, -16, -8, 23, 17, 6); c.fill();
    c.fillStyle = P.suit; rrPath(c, -11, -5, 13, 12, 4); c.fill();
    c.save(); c.translate(-7, 2); c.scale(.72, .72); suitDetails(c, 0, 0, style); c.restore();
    c.fillStyle = '#415D78'; rrPath(c, -18, -5, 5, 9, 2); c.fill(); c.fillStyle = accent; c.fillRect(-17, -3, 1.5, 4);
    c.save(); c.translate(-5, -3); c.scale(.75, .75);
    characterHelmet(c, 0, 0, style, { tick, id, calm, mood: boosting ? 1 : 0 }); c.restore();
    if (style.appearance.detail === 'stripe') { c.strokeStyle = accent; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-9, 9); c.lineTo(16, 7); c.stroke(); }
    if (style.appearance.detail === 'stars') { c.fillStyle = accent; c.save(); c.translate(18, 5); c.rotate(Math.PI / 4); c.fillRect(-1.5, -1.5, 3, 3); c.restore(); }
    c.restore();
  }
  // Full appearance preview with no dependency on a running game or player.
  // x/y is the slot center; size is the total headwear-to-boot height in pixels.
  function drawAvatar(c, x, y, size, appearance, { time = 0, reduceMotion = false, ship = false } = {}) {
    const style = characterStyle(appearance), P = style.palette;
    const bob = reduceMotion ? 0 : Math.sin(time * 2) * .65;
    c.save(); c.translate(x, y + size * .13); c.scale(size / 54, size / 54);
    if (ship) { c.scale(.78, .78); c.rotate(-.18); hoverpod(c, style, { tick: time * 60 + 20, calm: reduceMotion, hero: true }); c.restore(); return; }
    c.fillStyle = '#0005'; c.beginPath(); c.ellipse(0, 18, 12, 2.8, 0, 0, TAU); c.fill();
    c.lineWidth = 5; c.lineCap = 'round'; c.strokeStyle = P.legB; c.beginPath(); c.moveTo(3, 7); c.lineTo(5, 16); c.stroke();
    c.strokeStyle = P.legF; c.beginPath(); c.moveTo(-3, 7); c.lineTo(-5, 16); c.stroke();
    c.fillStyle = '#415D78'; rrPath(c, -14, -5 + bob, 7, 15, 3); c.fill(); c.fillStyle = style.accent; c.fillRect(-13, -2 + bob, 2, 6);
    c.strokeStyle = P.legB; c.lineWidth = 4.5; c.beginPath(); c.moveTo(-5, bob); c.lineTo(-10, 7 + bob); c.stroke();
    c.fillStyle = P.suit; rrPath(c, -8, -5 + bob, 16, 17, 6); c.fill(); suitDetails(c, 0, bob, style);
    characterHelmet(c, 0, -9 + bob, style, { tick: time * 60 + 20, calm: reduceMotion });
    c.strokeStyle = P.arm; c.beginPath(); c.moveTo(6, bob); c.lineTo(11, 6 + bob); c.stroke();
    c.fillStyle = style.accent; rrPath(c, 8, 4 + bob, 5, 5, 2); c.fill();
    c.restore();
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
      const boxes = candidates.map(([cx, cy]) => ({ ...item, w, h, x: Math.max(bounds.left, Math.min(bounds.right - w, cx - w / 2)), y: Math.max(bounds.top, Math.min(bounds.bottom - h, cy)) }));
      const available = box => !placed.some(b => overlaps(box, b));
      let box = boxes.find(b => available(b) && !obstacles.some(o => overlaps(b, o, 2)));
      // Ownership never disappears merely because somebody else crowds you.
      // Keep avoiding the local body even when secondary bodies must yield.
      if (!box && primary) box = boxes.find(b => available(b) && (!own || !overlaps(b, own, 2)));
      if (box) placed.push(box);
    }
    return placed;
  }
  function identityBadge(c, text, x, y, w, { primary = false, color = '#A9C2D8', h = 22, pointerX = null, pointerY = null } = {}) {
    c.save(); c.globalAlpha = 1; c.lineJoin = 'round';
    if (pointerX !== null && pointerY !== null) {
      const px = Math.max(x + 7, Math.min(x + w - 7, pointerX));
      const py = pointerY < y ? y : pointerY > y + h ? y + h : pointerY;
      c.beginPath(); c.moveTo(px, py); c.lineTo(pointerX, pointerY);
      c.strokeStyle = '#07111F'; c.lineWidth = 5; c.stroke();
      c.strokeStyle = primary ? '#FFF3CE' : color; c.lineWidth = primary ? 2.5 : 1.5; c.stroke();
    }
    rrPath(c, x, y, w, h, primary ? 7 : 5);
    c.fillStyle = primary ? '#FFF3CE' : '#091525'; c.fill();
    c.strokeStyle = '#07111F'; c.lineWidth = primary ? 4 : 3; c.stroke();
    c.strokeStyle = primary ? '#FFF3CE' : color; c.lineWidth = primary ? 1.5 : 1; c.stroke();
    c.font = (primary ? '900 11px' : '700 9px') + ' system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = primary ? '#101B29' : '#EDF5FF'; c.fillText(text, x + w / 2, y + h / 2 + .5, w - 10); c.restore();
  }
  // A quiet, screen-pixel ownership cue. Local and followed pilots differ by
  // silhouette, not suit color. No box, selection frame, or animation competes
  // with the character. The dark keyline survives bright platform/effect pixels.
  function identityCue(c, x, y, role = 'you', targetX = x, targetY = y + 20) {
    c.save(); c.globalAlpha = 1; c.translate(x, y);
    c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath();
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

  // Easing set shared by render code (and mirrored by the CSS --ease tokens).
  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  };

  const api = { C, ROLE, biome, ridgeProfile, glow, contactShadow, eyes, ease, makeCanvas, characterStyle, facePose, arenaMood, visorEyes, characterHelmet, suitDetails, characterHat, characterHats, hoverpod, drawAvatar, identityLayout, identityBadge, identityCue };
  root.SpaceManArt = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
