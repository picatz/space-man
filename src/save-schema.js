/* Versioned persistence boundary. The gameplay file can evolve without
   scattering localStorage migrations through UI and physics code. */
(function () {
  'use strict';
  const VERSION = 4;
  const num = (v, fb) => (typeof v === 'number' && isFinite(v) ? v : fb);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});   // strings/arrays must not Object.assign-spread
  // Cosmetic id whitelists — hand-edited saves fall back, never render unknown skins.
  const SUIT_IDS = ['classic', 'mint', 'rose', 'gold', 'lilac', 'coral', 'aurora', 'graphite'];
  const HAT_IDS = ['none', 'antenna', 'sprout', 'beanie', 'halo', 'crown', 'cone', 'catears', 'phones'];
  const FREE_IDS = ['classic', 'mint', 'none', 'antenna'];
  // Rebindable keyboard actions (KeyboardEvent.key, lowercased). Keys the game
  // owns globally can never be bound, and a map with any invalid or duplicate
  // entry falls back whole — a half-applied map could leave an action unreachable.
  const DEFAULT_KEYS = Object.freeze({ left: 'a', right: 'd', jump: 'w', fire: 'f' });
  const RESERVED_KEYS = ['escape', 'enter', 'tab', 'p', 'm', 'r', '1', '2', '3', '4', '5', '6'];
  function bindableKey(k) { return typeof k === 'string' && k.length > 0 && k.length <= 12 && k === k.toLowerCase() && RESERVED_KEYS.indexOf(k) < 0; }
  function sanitizeKeys(raw) {
    const k = obj(raw), out = {}, seen = [];
    for (const a of Object.keys(DEFAULT_KEYS)) {
      const v = k[a] === undefined ? DEFAULT_KEYS[a] : k[a];
      if (!bindableKey(v) || seen.indexOf(v) >= 0) return Object.assign({}, DEFAULT_KEYS);
      out[a] = v; seen.push(v);
    }
    return out;
  }
  // opts.reduceMotion: the OS prefers-reduced-motion answer, used only when the
  // player never chose (the schema can't read media queries itself).
  function migrate(raw, opts) {
    const input = obj(raw);
    const inSet = obj(input.settings);
    const s = Object.assign({ music: true, sfx: true, haptics: true, shake: true, lefty: false, autorun: true }, inSet);
    if (inSet.sound !== undefined) {
      s.music = !!inSet.sound; s.sfx = !!inSet.sound;
    }
    // v4: mixer state + master quick-mute. Corrupt values fall back, never throw.
    s.musicVol = clamp01(num(s.musicVol, 1));
    s.sfxVol = clamp01(num(s.sfxVol, 1));
    s.muted = s.muted === true;
    // Additive a11y fields (no version bump): the reduce-motion switch and key map.
    s.reduceMotion = typeof s.reduceMotion === 'boolean' ? s.reduceMotion : !!(opts && opts.reduceMotion);
    s.keys = sanitizeKeys(s.keys);
    const c = Object.assign(
      { companion: 'default', patches: [], suit: 'classic', hat: 'none', unlocked: FREE_IDS.slice() },
      obj(input.cosmetics));
    if (SUIT_IDS.indexOf(c.suit) < 0) c.suit = 'classic';
    if (HAT_IDS.indexOf(c.hat) < 0) c.hat = 'none';
    c.unlocked = (Array.isArray(c.unlocked) ? c.unlocked : [])
      .filter((x, i, a) => (SUIT_IDS.indexOf(x) >= 0 || HAT_IDS.indexOf(x) >= 0) && a.indexOf(x) === i);
    for (const f of FREE_IDS) if (c.unlocked.indexOf(f) < 0) c.unlocked.push(f);   // defaults can never lock
    return {
      version: VERSION,
      settings: s,
      discoveries: Array.isArray(input.discoveries) ? input.discoveries.slice(0, 64).filter((x) => typeof x === 'string') : [],
      cosmetics: c,
      achievements: Object.assign({}, obj(input.achievements)),
    };
  }
  window.SpaceManSave = { VERSION, migrate, DEFAULT_KEYS, bindableKey, sanitizeKeys };
})();
