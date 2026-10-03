/* Shared cosmetic identity. Appearance is presentation-only: no physics, score,
   combat, hitbox, or handling values are accepted or returned by this module. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpaceManCosmetics = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSION = 1, PROFILE_VERSION = 1, WIRE_BYTES = 7;
  const SLOTS = Object.freeze(['suit', 'hat', 'eyes', 'helmet', 'detail', 'ship']);
  const DEFAULTS = Object.freeze({ v: VERSION, suit: 'classic', hat: 'none', eyes: 'bright', helmet: 'round', detail: 'plain', ship: 'comet' });
  // Ordering is a wire contract. Append new IDs; never reorder existing ones.
  const ORDERS = Object.freeze({
    suit: Object.freeze(['classic', 'mint', 'rose', 'gold', 'lilac', 'coral', 'aurora', 'graphite']),
    hat: Object.freeze(['none', 'antenna', 'sprout', 'beanie', 'halo', 'crown', 'cone', 'catears', 'phones']),
    eyes: Object.freeze(['bright', 'calm', 'happy', 'determined']),
    helmet: Object.freeze(['round', 'bubble', 'retro']),
    detail: Object.freeze(['plain', 'stripe', 'stars']),
    ship: Object.freeze(['comet', 'orbit', 'leaf']),
  });
  const PALETTES = {
 classic: {name:'CLASSIC',      suit:'#F4F7FF',legB:'#9FB3E0',legF:'#C6D4F5',arm:'#E4ECFF',pack:'#FFB454',visTop:'#61D9FF',visBot:'#1479FF',trail:'159,241,255,.6'},
 mint:    {name:'MINT COMET',   suit:'#C8F5DC',legB:'#8FC4A6',legF:'#AEE3C4',arm:'#B9EED0',pack:'#FFB454',visTop:'#7BF0C4',visBot:'#0E8A5F',trail:'123,240,196,.6'},
 rose:    {name:'ROSE NEBULA',  suit:'#FFD4E5',legB:'#D19BB4',legF:'#F0B8CD',arm:'#FFC6DC',pack:'#38E1FF',visTop:'#FF9ECF',visBot:'#C2247E',trail:'255,158,207,.6'},
 gold:    {name:'SOLAR GOLD',   suit:'#FFE8B0',legB:'#CBA96A',legF:'#EDD08F',arm:'#FFDF9A',pack:'#FF4F66',visTop:'#FFC93C',visBot:'#B4610A',trail:'255,201,60,.6'},
 lilac:   {name:'LILAC DRIFT',  suit:'#E4D4FF',legB:'#AC96D6',legF:'#CCB8EE',arm:'#D9C6FA',pack:'#FFC93C',visTop:'#C9A8FF',visBot:'#6A2FD0',trail:'201,168,255,.6'},
 coral:   {name:'CORAL BLAZE',  suit:'#FFC4AE',legB:'#CE8F76',legF:'#EFAC92',arm:'#FFB69C',pack:'#61D9FF',visTop:'#FF8A6B',visBot:'#C22B3A',trail:'255,138,107,.65'},
 aurora:  {name:'AURORA ICE',   suit:'#CFFAF0',legB:'#8FC9BC',legF:'#B2E4D8',arm:'#C0F0E3',pack:'#FF9ECF',visTop:'#6BF7E0',visBot:'#0C7C8C',trail:'107,247,224,.6'},
 graphite:{name:'GRAPHITE VOID',suit:'#9AA3B8',legB:'#6B7488',legF:'#848EA4',arm:'#8C96AC',pack:'#FFC93C',visTop:'#2B3A5E',visBot:'#0B1E42',trail:'154,163,184,.55'},
};
  Object.keys(PALETTES).forEach(k => Object.freeze(PALETTES[k])); Object.freeze(PALETTES);
  const META = {
    classic: ['Classic', true], mint: ['Mint comet', true], rose: ['Rose nebula', true],
    gold: ['Solar gold', false, 'Finish a run'], lilac: ['Lilac drift', false, 'Finish an arena round'],
    coral: ['Coral blaze', false, 'Explore an adventure encounter'], aurora: ['Aurora ice', false, 'Complete an adventure loop'],
    graphite: ['Graphite void', false, 'Finish 3 runs'], none: ['No hat', true], antenna: ['Antenna', true],
    sprout: ['Sprout', false, 'Explore an adventure encounter'], beanie: ['Beanie', false, 'Finish a race'],
    halo: ['Halo', false, 'Complete an adventure loop'], crown: ['Crown', false, 'Finish 3 arena rounds'],
    cone: ['Traffic cone', false, 'Finish 3 races'], catears: ['Cat ears', false, 'Finish any run, arena round or race'],
    phones: ['Headphones', false, 'Finish 3 activities'], bright: ['Bright', true], calm: ['Calm', true], happy: ['Happy', true],
    determined: ['Determined', false, 'Finish an arena round'], round: ['Round', true], bubble: ['Bubble', true],
    retro: ['Retro', false, 'Finish a race'], plain: ['Plain', true], stripe: ['Racing stripe', true],
    stars: ['Star patch', false, 'Complete an adventure loop'], comet: ['Comet', true], orbit: ['Orbit rings', true],
    leaf: ['Leaf fins', false, 'Explore 2 adventure encounters'],
  };
  const CATALOG = Object.freeze(Object.fromEntries(SLOTS.map(slot => [slot, Object.freeze(ORDERS[slot].map(id => Object.freeze({ id, name: META[id][0], free: META[id][1], hint: META[id][2] || 'Ready to wear' })))])));
  const ALL_IDS = SLOTS.flatMap(slot => ORDERS[slot]);
  const FREE_IDS = ALL_IDS.filter(id => META[id][1]);
  const EVENT_TYPES = Object.freeze(['runner', 'arena', 'race', 'encounter', 'journey', 'coop']);
  const RULES = Object.freeze([
    ['runner', 1, 'gold'], ['runner', 3, 'graphite'], ['arena', 1, 'lilac'], ['arena', 1, 'determined'], ['arena', 3, 'crown'],
    ['race', 1, 'beanie'], ['race', 1, 'retro'], ['race', 3, 'cone'], ['encounter', 1, 'coral'], ['encounter', 1, 'sprout'],
    ['encounter', 2, 'leaf'], ['journey', 1, 'aurora'], ['journey', 1, 'halo'], ['journey', 1, 'stars'], ['activities', 1, 'catears'], ['activities', 3, 'phones'],
  ]);
  const object = raw => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function idFor(slot, value) {
    // Numeric suit/hat values are the old roster representation only.
    if ((slot === 'suit' || slot === 'hat') && Number.isInteger(value)) value = ORDERS[slot][value];
    return typeof value === 'string' && ORDERS[slot].includes(value) ? value : DEFAULTS[slot];
  }
  function normalizeAppearance(raw) {
    const value = object(raw), out = { v: VERSION };
    for (const slot of SLOTS) out[slot] = idFor(slot, own(value, slot) ? value[slot] : undefined);
    return out;
  }
  function getAppearance(profile) { return normalizeAppearance(profile); }
  function wireAppearance(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== VERSION || Object.keys(raw).length !== WIRE_BYTES) return null;
    if (Object.keys(raw).some(k => k !== 'v' && !SLOTS.includes(k))) return null;
    for (const slot of SLOTS) if (!own(raw, slot) || typeof raw[slot] !== 'string' || !ORDERS[slot].includes(raw[slot])) return null;
    return normalizeAppearance(raw);
  }
  function encodeAppearance(raw) {
    const value = wireAppearance(raw); if (!value) return null;
    return new Uint8Array([VERSION, ...SLOTS.map(slot => ORDERS[slot].indexOf(value[slot]))]);
  }
  function decodeAppearance(bytes) {
    if (!bytes || bytes.length !== WIRE_BYTES || bytes[0] !== VERSION) return null;
    const out = { v: VERSION };
    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i], n = bytes[i + 1];
      if (!Number.isInteger(n) || n < 0 || n >= ORDERS[slot].length) return null;
      out[slot] = ORDERS[slot][n];
    }
    return out;
  }
  function palette(value) { return PALETTES[idFor('suit', typeof value === 'string' ? value : object(value).suit)]; }
  const count = n => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(3, Math.floor(n))) : 0;
  const eventId = id => typeof id === 'string' && /^[a-zA-Z0-9:._-]{1,96}$/.test(id);
  function migrateProfile(raw, legacy) {
    const input = object(raw), out = {};
    // Keep additive legacy metadata (callsign, companion, patches, future fields),
    // but never invoke __proto__ setters or trust metadata as an appearance.
    for (const key of Object.keys(input)) if (!['__proto__', 'constructor', 'prototype'].includes(key)) out[key] = input[key];
    Object.assign(out, normalizeAppearance(input)); out.profileVersion = PROFILE_VERSION;
    out.unlocked = (Array.isArray(input.unlocked) ? input.unlocked : []).filter((id, i, a) => ALL_IDS.includes(id) && a.indexOf(id) === i);
    for (const id of FREE_IDS) if (!out.unlocked.includes(id)) out.unlocked.push(id);
    // A valid item already worn in an old save remains owned, even if that old
    // profile had no unlock ledger. This never accepts unknown cosmetic IDs.
    for (const slot of SLOTS) if (typeof input[slot] === 'string' && ORDERS[slot].includes(input[slot]) && !out.unlocked.includes(input[slot])) out.unlocked.push(input[slot]);
    const progress = object(input.progress);
    out.progress = { events: (Array.isArray(progress.events) ? progress.events : []).filter((id, i, a) => typeof id === 'string' && /^[a-zA-Z0-9:._-]{1,110}$/.test(id) && a.indexOf(id) === i).slice(-128) };
    for (const type of EVENT_TYPES) out.progress[type] = count(progress[type]);
    // Existing run history earns the new relaxed milestones immediately. No
    // original unlock is removed, and old days/streaks are never required again.
    const old = object(legacy);
    out.progress.runner = Math.max(out.progress.runner, count(object(old.stats).runs));
    out.progress.activities = Math.max(count(progress.activities), Math.min(3, out.progress.runner + out.progress.arena + out.progress.race));
    for (const [type, threshold, id] of RULES) if (out.progress[type] >= threshold && !out.unlocked.includes(id)) out.unlocked.push(id);
    return out;
  }
  function reward(raw, event) {
    const profile = migrateProfile(raw), e = object(event), before = profile.unlocked.slice();
    if (!EVENT_TYPES.includes(e.type) || !eventId(e.id)) return { profile, unlocked: [], accepted: false };
    const key = e.type + ':' + e.id;
    if (profile.progress.events.includes(key)) return { profile, unlocked: [], accepted: false };
    profile.progress.events.push(key); profile.progress.events = profile.progress.events.slice(-128);
    profile.progress[e.type] = Math.min(3, profile.progress[e.type] + 1);
    if (['runner', 'arena', 'race'].includes(e.type)) profile.progress.activities = Math.min(3, profile.progress.activities + 1);
    for (const [type, threshold, id] of RULES) if (profile.progress[type] >= threshold && !profile.unlocked.includes(id)) profile.unlocked.push(id);
    return { profile, unlocked: profile.unlocked.filter(id => !before.includes(id)), accepted: true };
  }
  function equip(raw, slot, id) {
    const profile = migrateProfile(raw);
    if (!SLOTS.includes(slot) || !ORDERS[slot].includes(id) || !profile.unlocked.includes(id)) return { profile, equipped: false };
    profile[slot] = id; return { profile, equipped: true };
  }
  function item(id) { return META[id] && ALL_IDS.includes(id) ? { id, name: META[id][0], free: META[id][1], hint: META[id][2] || 'Ready to wear' } : null; }
  return Object.freeze({ VERSION, PROFILE_VERSION, WIRE_BYTES, SLOTS, DEFAULTS, ORDERS, CATALOG, PALETTES, EVENT_TYPES, normalizeAppearance, getAppearance, wireAppearance, encodeAppearance, decodeAppearance, palette, migrateProfile, reward, equip, item });
});
