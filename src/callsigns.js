/* Space Man callsigns — curated online nicknames. Classic script, data only:
   a callsign is two u8 indexes into these lists (adj[i] + ' ' + noun[j]); free
   text is unrepresentable on the wire. Constraints (binding): 64+64 words,
   3-8 letters, A-Z only, all-ages, no real-world names; lists are protocol
   data — NEVER reorder or remove entries, only append in a new `v`. Receivers
   show the P-number for any out-of-range index or denied pair. `deny` is
   [adjIdx, nounIdx] pairs the picker re-rolls and receivers fall back on
   (combinations that read as well-known names). */
(function () {
  'use strict';
  const adj = [
    'LUCKY', 'TURBO', 'COMET', 'NOVA', 'COSMIC', 'ASTRO', 'LUNAR', 'SOLAR',
    'STELLAR', 'PLUCKY', 'ZIPPY', 'SNAZZY', 'WOBBLY', 'BOUNCY', 'SLEEPY', 'SNEAKY',
    'MIGHTY', 'TINY', 'MEGA', 'HYPER', 'QUANTUM', 'ROCKET', 'LASER', 'PLASMA',
    'NEON', 'VELVET', 'FUZZY', 'DIZZY', 'JOLLY', 'CHEERY', 'STARRY', 'BRAVE',
    'BOLD', 'SWIFT', 'RAPID', 'NIMBLE', 'DANDY', 'FANCY', 'SHINY', 'SPARKY',
    'FROSTY', 'TOASTY', 'WIGGLY', 'GIGGLY', 'MERRY', 'SUNNY', 'BREEZY', 'DAPPER',
    'HUMBLE', 'NOBLE', 'ROYAL', 'GOLDEN', 'SILVER', 'CRIMSON', 'EMERALD', 'ELECTRIC',
    'MAGNETIC', 'ATOMIC', 'GALACTIC', 'ORBITAL', 'RADIANT', 'SPIFFY', 'PEPPY', 'SPEEDY',
  ];
  const noun = [
    'FOX', 'OTTER', 'WOMBAT', 'SPUTNIK', 'PULSAR', 'QUASAR', 'NEBULA', 'METEOR',
    'ORBIT', 'GALAXY', 'MOON', 'COSMOS', 'BOOSTER', 'LANDER', 'PILOT', 'CADET',
    'CAPTAIN', 'RANGER', 'VOYAGER', 'TITAN', 'PHOTON', 'PROTON', 'NEUTRON', 'ATOM',
    'PENGUIN', 'WALRUS', 'GECKO', 'LLAMA', 'PANDA', 'KOALA', 'BADGER', 'FALCON',
    'MOOSE', 'YETI', 'DINGO', 'LEMUR', 'BISON', 'RACCOON', 'HAMSTER', 'NARWHAL',
    'PUFFIN', 'TOUCAN', 'MANATEE', 'AXOLOTL', 'CORGI', 'SPROCKET', 'GIZMO', 'WIDGET',
    'MODULE', 'CAPSULE', 'ANTENNA', 'CRATER', 'ECLIPSE', 'AURORA', 'APOGEE', 'VECTOR',
    'GRAVITY', 'STARDUST', 'ASTEROID', 'JUPITER', 'NEPTUNE', 'ROVER', 'SKIPPER', 'MAGPIE',
  ];
  // Reviewed pair denylist (full 64x64 enumeration read at review time).
  const deny = [
    [21, 37], // reads as a well-known comic character
    [18, 0],  // reads adjacent to a celebrity name at a glance
  ];
  window.SpaceManCallsigns = { v: 1, adj, noun, deny };
})();
