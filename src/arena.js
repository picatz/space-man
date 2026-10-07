/* Space Man: Pulse Arena. Pure, fixed-tick rules shared by every controller.
 * Positions are top-left world pixels; velocities are pixels per 60 Hz tick.
 * Rendering, audio, input sampling and elapsed real time never enter this module.
 * cpuInput is an explicit controller: step never invents missing commands.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpaceManArena = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const sign = (v) => v < 0 ? -1 : v > 0 ? 1 : 0;
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.keys(value).forEach((key) => freeze(value[key]));
      Object.freeze(value);
    }
    return value;
  }
  const constants = freeze({
    VERSION: 1, TICK_RATE: 60, STEP: 1 / 60, WIDTH: 960, HEIGHT: 600,
    COUNTDOWN_TICKS: 180, MATCH_TICKS: 180 * 60, STOCKS: 3,
    FIGHTER_W: 24, FIGHTER_H: 34,
    ACCEL_GROUND: 0.85, ACCEL_AIR: 0.5, MAX_RUN: 6.4,
    FRICTION_GROUND: 0.80, FRICTION_AIR: 0.985,
    JUMP_SPEED: 12.8, DOUBLE_JUMP_SPEED: 11.8,
    GRAVITY_RISE: 0.52, GRAVITY_FALL: 0.78, MAX_FALL: 15,
    COYOTE_TICKS: 6, BUFFER_TICKS: 8, JUMP_CUT: 0.48,
    ATTACK_TICKS: 26, ATTACK_WINDUP: 4, ATTACK_ACTIVE: 7, ATTACK_DAMAGE: 12,
    ATTACK_REACH: 35, ATTACK_W: 48, ATTACK_H: 42, ACTION_BUFFER_TICKS: 6,
    DASH_TICKS: 10, DASH_SPEED: 11.5, DASH_COOLDOWN: 55, DODGE_TICKS: 8,
    RESPAWN_TICKS: 60, RESPAWN_INVULNERABLE: 90,
    // Pulse commitment: recovery after the swing, a short post-hit guard that
    // only blocks further pulses, and a hold-to-charge tier. A charge below
    // CHARGE_MIN is an ordinary tap (windup pre-spent while held); a release at
    // or above it fires a stronger, slower, telegraphed pulse.
    ATTACK_RECOVERY: 10, HIT_GUARD: 8,
    CHARGE_MIN: 18, CHARGE_MAX: 36, CHARGE_AUTO: 60, CHARGE_MOVE: 0.45,
    CHARGED_WINDUP: 10, CHARGED_TICKS: 32, CHARGE_DAMAGE: 0.5, CHARGE_KNOCKBACK: 0.7,
    LAND_MIN_IMPACT: 3,
  });
  const profiles = freeze([
    { id: 'nova', name: 'Nova', color: '#38E1FF', accent: '#9FF1FF', suit: '#F4F7FF' },
    { id: 'moss', name: 'Moss', color: '#4EF07A', accent: '#BEFFA2', suit: '#D9F5DB' },
    { id: 'flare', name: 'Flare', color: '#FFB454', accent: '#FFE59A', suit: '#FFF0D6' },
    { id: 'luma', name: 'Luma', color: '#B87BFF', accent: '#E6C6FF', suit: '#EEE4FF' },
  ]);
  const arenas = freeze([
    {
      id: 'orbital-dock', name: 'Orbital Dock', description: 'A broad landing deck beneath three orbital gantries.',
      width: 960, height: 600,
      theme: { id: 'orbital', sky: '#060818', skyTop: '#060818', skyBottom: '#18264A', background: '#060818', accent: '#38E1FF', glow: '#9FF1FF', platform: '#192B48', platformTop: '#38E1FF', hazard: '#FF4F66', detail: '#456688' },
      platforms: [
        { id: 'dock', x: 150, y: 454, w: 660, h: 26 },
        { id: 'port', x: 200, y: 336, w: 180, h: 16 },
        { id: 'starboard', x: 580, y: 336, w: 180, h: 16 },
        { id: 'gantry', x: 400, y: 238, w: 160, h: 16 },
      ],
      spawns: [{ x: 245, y: 420 }, { x: 691, y: 420 }, { x: 345, y: 420 }, { x: 591, y: 420 }],
      bounds: { left: -150, right: 1110, top: -240, bottom: 760 },
    },
    {
      id: 'bloom-reactor', name: 'Bloom Reactor', description: 'Twin garden rafts linked by a raised reactor bridge.',
      width: 960, height: 600,
      theme: { id: 'bloom', sky: '#061817', skyTop: '#061817', skyBottom: '#173C36', background: '#061817', accent: '#4EF07A', glow: '#BDFFA2', platform: '#173F38', platformTop: '#4EF07A', hazard: '#FFB454', detail: '#3B7561' },
      platforms: [
        { id: 'garden-left', x: 145, y: 464, w: 270, h: 25 },
        { id: 'garden-right', x: 545, y: 464, w: 270, h: 25 },
        { id: 'reactor', x: 390, y: 357, w: 180, h: 20 },
        { id: 'canopy-left', x: 220, y: 264, w: 160, h: 16 },
        { id: 'canopy-right', x: 580, y: 264, w: 160, h: 16 },
      ],
      spawns: [{ x: 220, y: 430 }, { x: 716, y: 430 }, { x: 335, y: 430 }, { x: 601, y: 430 }],
      bounds: { left: -150, right: 1110, top: -240, bottom: 770 },
    },
    {
      id: 'ember-foundry', name: 'Ember Foundry', description: 'A high furnace crown with staggered cooling shelves.',
      width: 960, height: 600,
      theme: { id: 'ember', sky: '#1A0C20', skyTop: '#1A0C20', skyBottom: '#46202D', background: '#1A0C20', accent: '#FFB454', glow: '#FFE59A', platform: '#4A2C3B', platformTop: '#FFB454', hazard: '#FF4F66', detail: '#825061' },
      platforms: [
        { id: 'hearth', x: 155, y: 490, w: 650, h: 28 },
        { id: 'cooler-left', x: 175, y: 380, w: 170, h: 18 },
        { id: 'cooler-right', x: 615, y: 350, w: 170, h: 18 },
        { id: 'furnace', x: 400, y: 286, w: 160, h: 22 },
        { id: 'crown', x: 395, y: 172, w: 170, h: 16 },
      ],
      spawns: [{ x: 240, y: 456 }, { x: 696, y: 456 }, { x: 345, y: 456 }, { x: 591, y: 456 }],
      bounds: { left: -150, right: 1110, top: -260, bottom: 790 },
    },
  ]);
  const difficulties = freeze({
    easy: { reaction: 15, attackDelay: 39, dodge: 0.12, charge: 0.4 },
    normal: { reaction: 9, attackDelay: 29, dodge: 0.35, charge: 1 },
    hard: { reaction: 5, attackDelay: 26, dodge: 0.60, charge: 1.4 },
  });

  function getArena(id) { return arenas.find((arena) => arena.id === id) || arenas[0]; }
  function normalizeCommand(input) {
    const c = input && typeof input === 'object' ? input : {};
    return {
      moveX: clamp(finite(c.moveX, 0), -1, 1),
      moveY: clamp(finite(c.moveY, 0), -1, 1),
      jumpPressed: c.jumpPressed === true || c.jumpPressed === 1,
      jumpHeld: c.jumpHeld === true || c.jumpHeld === 1,
      attackPressed: c.attackPressed === true || c.attackPressed === 1,
      attackHeld: c.attackHeld === true || c.attackHeld === 1,
      dashPressed: c.dashPressed === true || c.dashPressed === 1,
    };
  }
  // Presentation-owned intent, never extra authority state or wire fields.
  // A fresh late tap may wait at most 100 ms of observed simulation time.
  // Ordinary key-up preserves that tap; menus/ownership changes call reset.
  function createActionBuffer() {
    let pending = null, scope = null, lastTick = -1, lastNow = -1;
    function reset() { pending = null; scope = null; lastTick = -1; lastNow = -1; }
    function sample(input, actor, tick, enabled = true, generation = '', options = {}) {
      const c = normalizeCommand(input);
      // A guest snapshot can lag readiness. Never suppress or replay a guest's
      // fresh edge based on that estimate; leave its existing wire path intact.
      const now = options.nowMs === undefined ? tick * 1000 / constants.TICK_RATE : options.nowMs;
      if (options.authoritative === false || !Number.isFinite(now)) { reset(); return c; }
      const usable = enabled && actor && !actor.boss && actor.stocks > 0 && !actor.respawnTicks && Number.isInteger(tick);
      const key = actor && [generation, actor.id, actor.peerP || 0, actor.controller, actor.stocks].join(':');
      if (!usable) { reset(); c.attackPressed = c.dashPressed = false; return c; }
      if (actor.stun) {
        reset(); // Never replay a pre-hit intent after stun.
        if (actor.stun > 1) c.attackPressed = c.dashPressed = false;
        return c; // A new tap on the final stun tick retains original rules.
      }
      if (scope !== key || tick < lastTick || now < lastNow) pending = null;
      scope = key; lastTick = tick; lastNow = now;
      // moveActor decrements these locks before considering an action.
      const lock = action => action === 'dash'
        ? (!(actor.onGround || actor.airDashAvailable) ? Infinity : Math.max(dashLockTicks(actor), actor.dashTicks, actor.dashCooldown))
        : actor.charge > 0 ? Infinity : Math.max(actor.attackTicks > 0 ? actor.attackTicks + constants.ATTACK_RECOVERY : (actor.attackCooldown || 0), actor.dashTicks);
      const fresh = c.attackPressed || c.dashPressed;
      if (fresh) {
        pending = null; // Latest deliberate action replaces, never stacks.
        if ((c.dashPressed && lock('dash') <= 1) || (c.attackPressed && lock('attack') <= 1)) return c;
        const action = c.dashPressed && lock('dash') <= constants.ACTION_BUFFER_TICKS + 1 ? 'dash' : c.attackPressed && lock('attack') <= constants.ACTION_BUFFER_TICKS + 1 ? 'attack' : null;
        if (action) pending = { action, expires: tick + constants.ACTION_BUFFER_TICKS, expiresAt: now + 100 };
        c.attackPressed = c.dashPressed = false;
      } else if (pending) {
        if (tick > pending.expires || now > pending.expiresAt + .001 || lock(pending.action) > constants.ACTION_BUFFER_TICKS + 1) pending = null;
        else if (lock(pending.action) <= 1) {
          c[pending.action === 'dash' ? 'dashPressed' : 'attackPressed'] = true;
          pending = null;
        }
      }
      return c;
    }
    return Object.freeze({ sample, reset });
  }
  // All random draws have explicit, serializable ownership. Controller call order
  // cannot change another controller's random stream.
  function random(owner) {
    owner.rngState = (owner.rngState + 0x6D2B79F5) >>> 0;
    let t = owner.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function resetBody(actor, spawn) {
    Object.assign(actor, {
      x: spawn.x, y: spawn.y, px: spawn.x, py: spawn.y, vx: 0, vy: 0,
      onGround: true, supportId: null, damage: 0, stun: 0,
      jumpCount: 0, coyoteTicks: constants.COYOTE_TICKS, jumpBufferTicks: 0,
      jumpHeldLast: false, attackTicks: 0, attackDirX: actor.facing, attackDirY: 0,
      attackHitIds: [], attackCooldown: 0, attackCharge: 0, charge: 0, hitGuard: 0, dashTicks: 0, dashCooldown: 0, airDashAvailable: true,
      dropTicks: 0, dropPlatformId: null, respawnTicks: 0,
      invulnerable: constants.RESPAWN_INVULNERABLE, lastHitBy: null,
    });
  }
  // Expedition rules are opt-in. Ordinary local/online matches keep their
  // original canonical state and three-minute, three-stock rules.
  function encounterOptions(options) {
    if (options.encounter !== 'boss' && options.encounter !== 'skirmish') return null;
    const boss = options.encounter === 'boss';
    const encounter = {
      type: options.encounter,
      durationTicks: clamp(Math.trunc(finite(options.durationTicks, boss ? 3300 : 2100)), 900, 5400),
      countdownTicks: clamp(Math.trunc(finite(options.countdownTicks, 60)), 0, constants.COUNTDOWN_TICKS),
      stocks: clamp(Math.trunc(finite(options.stocks, 2)), 1, 3),
    };
    if (boss) {
      encounter.bossTier = clamp(Math.trunc(finite(options.bossTier, 1)), 1, 5);
      encounter.wingmate = options.wingmate !== false;
      if (options.crewCount !== undefined) {
        encounter.crewCount = clamp(Math.trunc(finite(options.crewCount, encounter.wingmate ? 2 : 1)), 1, 4);
        encounter.wingmate = encounter.crewCount > 1;
      }
    }
    return encounter;
  }
  function crewCount(encounter) { return encounter.crewCount || (encounter.wingmate ? 2 : 1); }
  function bossHealth(encounter) { return 168 + encounter.bossTier * 24 + (crewCount(encounter) - 1) * 192; }
  function create(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const arena = getArena(opts.arenaId), encounter = encounterOptions(opts);
    const bossEncounter = encounter && encounter.type === 'boss';
    const format = bossEncounter ? 'teams' : ['duel', 'ffa', 'teams'].includes(opts.format) ? opts.format : 'duel';
    const difficulty = Object.hasOwn(difficulties, opts.difficulty) ? opts.difficulty : 'normal';
    const seed = Math.trunc(finite(opts.seed, 1)) >>> 0;
    const state = {
      version: constants.VERSION, tick: 0, phase: 'countdown',
      countdownTicks: constants.COUNTDOWN_TICKS, timeLeftTicks: constants.MATCH_TICKS,
      arenaId: arena.id, format, difficulty, seed, rngState: seed,
      actors: [], events: [], result: null,
    };
    if (encounter) {
      state.encounter = encounter;
      state.countdownTicks = encounter.countdownTicks;
      state.timeLeftTicks = encounter.durationTicks;
      if (!state.countdownTicks) state.phase = 'playing';
    }
    const count = bossEncounter ? (crewCount(encounter) + 1) : format === 'duel' ? 2 : 4;
    for (let index = 0; index < count; index++) {
      const isBoss = bossEncounter && index === count - 1;
      const profile = profiles[isBoss ? 2 : index];
      const actor = {
        id: index + 1, profileId: profile.id, name: profile.name, color: profile.color,
        accent: profile.accent, suit: profile.suit,
        team: bossEncounter ? (isBoss ? 1 : 0) : format === 'teams' ? (index < 2 ? 0 : 1) : index,
        controller: index === 0 ? 'human' : 'cpu',
        w: constants.FIGHTER_W, h: constants.FIGHTER_H, facing: index % 2 ? -1 : 1,
        stocks: isBoss ? 1 : encounter ? encounter.stocks : constants.STOCKS, deaths: 0, kos: 0, attackSerial: 0,
        ai: {
          rngState: Math.floor(random(state) * 4294967296) >>> 0,
          aggression: 0.75 + random(state) * 0.5,
          reactionOffset: Math.floor(random(state) * 4),
          nextThinkTick: 0, nextJumpTick: 0, nextAttackTick: 0, chargeUntil: 0, chargeAimX: 0, chargeAimY: 0,
          targetId: null, goalPlatformId: null, lastTick: -1,
          intent: normalizeCommand(), cachedCommand: normalizeCommand(),
        },
      };
      // A wingmate helps with navigation, pressure and tells, but leaves the
      // player room to fight instead of clearing a boss on their behalf.
      if (bossEncounter && index > 0 && !isBoss) actor.ai.aggression *= 0.30;
      if (isBoss) {
        actor.name = 'Sentinel'; actor.w = 56; actor.h = 74;
        actor.facing = -1; actor.color = '#FF856B'; actor.accent = '#FFE09C'; actor.suit = '#422C51';
        const maxHealth = bossHealth(encounter);
        actor.boss = {
          tier: encounter.bossTier, maxHealth, health: maxHealth,
          phase: 'idle', phaseTicks: 72, phaseDuration: 72,
          move: 'shockwave', cycle: 0, attack: null, hitIds: [],
        };
      }
      // Teams begin on opposite halves; each pair is together. A boss has one
      // larger body, rather than a disguised extra team of normal fighters.
      const spawnIndex = bossEncounter ? (isBoss ? 1 : [0, 2][index]) : format === 'teams' ? [0, 2, 1, 3][index] : index;
      let spawn = arena.spawns[spawnIndex];
      if (bossEncounter && !isBoss && crewCount(encounter) > 2) {
        const deck = arena.platforms[0];
        spawn = { x: deck.x + 24 + index * Math.min(64, (deck.w - 72) / 3), y: deck.y - constants.FIGHTER_H };
      }
      resetBody(actor, { x: spawn.x, y: spawn.y + constants.FIGHTER_H - actor.h });
      actor.supportId = supportAt(arena, actor).id;
      state.actors.push(actor);
    }
    return state;
  }

  function centerX(actor) { return actor.x + actor.w / 2; }
  function centerY(actor) { return actor.y + actor.h / 2; }
  function enemies(state, a, b) { return a.id !== b.id && (state.format !== 'teams' || a.team !== b.team); }
  function supportAt(arena, actor) {
    return arena.platforms.find((p) => actor.x + actor.w > p.x && actor.x < p.x + p.w && Math.abs(actor.y + actor.h - p.y) < 1.5) || null;
  }
  function platformBelow(arena, actor) {
    const cx = centerX(actor), feet = actor.y + actor.h;
    let best = null;
    for (const p of arena.platforms) {
      if (cx >= p.x - 8 && cx <= p.x + p.w + 8 && p.y >= feet - 14 && (!best || p.y < best.y)) best = p;
    }
    return best;
  }
  function aim(command, facing) {
    let x = command.moveX, y = command.moveY;
    if (Math.abs(x) < 0.25) x = 0;
    if (Math.abs(y) < 0.25) y = 0;
    if (!x && !y) x = facing;
    const length = Math.sqrt(x * x + y * y);
    return { x: x / length, y: y / length };
  }
  function attackBox(actor) {
    if (actor.boss || actor.attackTicks <= 0) return null;
    const dx = actor.attackDirX, dy = actor.attackDirY;
    const vertical = Math.abs(dy) > Math.abs(dx);
    const w = vertical ? constants.ATTACK_H : constants.ATTACK_W;
    const h = vertical ? constants.ATTACK_W : constants.ATTACK_H;
    const elapsed = attackElapsed(actor), windup = attackWindup(actor);
    return {
      x: centerX(actor) + dx * constants.ATTACK_REACH - w / 2,
      y: centerY(actor) + dy * constants.ATTACK_REACH - h / 2, w, h,
      active: elapsed >= windup && elapsed < windup + constants.ATTACK_ACTIVE,
      charged: actor.attackCharge > 0,
    };
  }
  // Pulse timeline helpers. A charged swing has a longer, telegraphed windup;
  // a tapped swing may start with part of its windup already spent while held.
  function attackTotal(actor) { return actor.attackCharge > 0 ? constants.CHARGED_TICKS : constants.ATTACK_TICKS; }
  function attackWindup(actor) { return actor.attackCharge > 0 ? constants.CHARGED_WINDUP : constants.ATTACK_WINDUP; }
  function attackElapsed(actor) { return attackTotal(actor) - actor.attackTicks; }
  // Ticks until a dash may leave the swing. Only the active frames are
  // committed: windup (a feint), end lag and recovery can all be dash-cancelled.
  function dashLockTicks(actor) {
    if (!(actor.attackTicks > 0)) return 0;
    const elapsed = attackElapsed(actor), windup = attackWindup(actor);
    return elapsed + 1 >= windup && elapsed + 1 < windup + constants.ATTACK_ACTIVE ? windup + constants.ATTACK_ACTIVE - elapsed : 0;
  }
  function chargeLevel(charge) { return charge >= constants.CHARGE_MIN ? Math.min(constants.CHARGE_MAX, Math.floor(charge)) : 0; }
  function pulseDamage(actor) { return constants.ATTACK_DAMAGE + (actor && actor.attackCharge > 0 ? Math.round(actor.attackCharge * constants.CHARGE_DAMAGE) : 0); }
  function pulseKnockback(actor) { return 1 + (actor && actor.attackCharge > 0 ? actor.attackCharge / constants.CHARGE_MAX * constants.CHARGE_KNOCKBACK : 0); }
  // The exact collision rectangle is also the telegraph: renderers never have
  // to guess where a special will land. Once charging starts it cannot track.
  function bossAttackBox(actor) {
    const boss = actor && actor.boss;
    if (!boss || !boss.attack || (boss.phase !== 'charging' && boss.phase !== 'active')) return null;
    return Object.assign({}, boss.attack, { active: boss.phase === 'active', move: boss.move });
  }
  function setBossPhase(boss, phase, ticks) {
    boss.phase = phase; boss.phaseTicks = ticks; boss.phaseDuration = ticks;
  }
  function beginBossAttack(state, actor) {
    const boss = actor.boss;
    const targets = state.actors.filter((other) => enemies(state, actor, other) && other.stocks > 0 && !other.respawnTicks);
    targets.sort((a, b) => Math.abs(centerX(a) - centerX(actor)) - Math.abs(centerX(b) - centerX(actor)) || a.id - b.id);
    if (!targets.length) return;
    const target = targets[0], tier = boss.tier;
    boss.move = boss.cycle % 2 ? 'lance' : 'shockwave'; boss.cycle++;
    boss.hitIds = [];
    if (boss.move === 'shockwave') {
      const reach = 170 + tier * 12;
      boss.attack = { x: centerX(actor) - reach, y: actor.y + actor.h - 24, w: reach * 2, h: 26 };
    } else {
      const width = 62 + tier * 4, bounds = getArena(state.arenaId).bounds;
      boss.attack = { x: centerX(target) - width / 2, y: bounds.top, w: width, h: bounds.bottom - bounds.top };
    }
    setBossPhase(boss, 'charging', (boss.move === 'shockwave' ? 70 : 64) - tier * 3);
    actor.invulnerable = 0; actor.vx = 0;
    emit(state, 'boss-warning', actor, { move: boss.move, ticks: boss.phaseTicks });
  }
  function tickBoss(state, actor, command) {
    const boss = actor.boss;
    if (!boss || actor.stocks <= 0 || actor.respawnTicks) return;
    if (boss.phaseTicks > 0) boss.phaseTicks--;
    if (!boss.phaseTicks) {
      if (boss.phase === 'idle') {
        if (command.attackPressed && actor.onGround && !actor.stun) beginBossAttack(state, actor);
      } else if (boss.phase === 'charging') {
        setBossPhase(boss, 'active', 10);
        emit(state, 'boss-strike', actor, { move: boss.move });
      } else if (boss.phase === 'active') {
        setBossPhase(boss, 'recover', 78);
        emit(state, 'boss-exposed', actor, { ticks: boss.phaseTicks });
      } else if (boss.phase === 'recover') {
        boss.attack = null;
        setBossPhase(boss, 'idle', 62 - boss.tier * 3);
      }
    }
  }
  function resolveBossAttacks(state) {
    for (const attacker of state.actors) {
      const boss = attacker.boss, box = bossAttackBox(attacker);
      if (!boss || attacker.stocks <= 0 || !box || !box.active) continue;
      for (const target of state.actors.slice().sort((a, b) => a.id - b.id)) {
        if (!enemies(state, attacker, target) || target.stocks <= 0 || target.respawnTicks || target.invulnerable || boss.hitIds.includes(target.id) || !overlap(box, target)) continue;
        boss.hitIds.push(target.id); boss.hitIds.sort((a, b) => a - b);
        const damage = 12 + boss.tier * 2;
        target.damage = Math.min(999, target.damage + damage);
        const force = 7 + target.damage * 0.055;
        target.vx = sign(centerX(target) - centerX(attacker) || attacker.facing) * force;
        target.vy = boss.move === 'shockwave' ? -8.5 : -6.5;
        target.stun = 18; target.attackTicks = 0; target.dashTicks = 0; clearPulse(target);
        target.onGround = false; target.supportId = null; target.coyoteTicks = 0;
        target.lastHitBy = attacker.id;
        emit(state, 'hit', attacker, { targetId: target.id, x: centerX(target), y: centerY(target), damage, knockback: force, move: boss.move });
      }
    }
  }
  function clearPulse(actor) { actor.attackCharge = 0; actor.charge = 0; actor.attackCooldown = 0; }
  function overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function emit(state, type, actor, extra) {
    state.events.push(Object.assign({ type, actorId: actor.id, x: centerX(actor), y: centerY(actor) }, extra));
  }
  function startJump(state, actor) {
    const groundJump = actor.onGround || actor.coyoteTicks > 0;
    if (!groundJump && actor.jumpCount >= 2) return false;
    actor.jumpCount = groundJump ? 1 : Math.max(1, actor.jumpCount) + 1;
    actor.vy = -(groundJump ? constants.JUMP_SPEED : constants.DOUBLE_JUMP_SPEED);
    actor.onGround = false; actor.supportId = null; actor.coyoteTicks = 0;
    actor.jumpBufferTicks = 0; actor.jumpHeldLast = true;
    emit(state, 'jump', actor, { double: !groundJump });
    return true;
  }
  function beginAttack(state, actor, command, charge) {
    const direction = aim(command, actor.facing), level = chargeLevel(charge || 0);
    actor.attackDirX = direction.x; actor.attackDirY = direction.y;
    actor.attackCharge = level; actor.charge = 0;
    // A tap held for a few ticks already spent that much of its windup.
    actor.attackTicks = constants.ATTACK_TICKS - (level ? 0 : Math.min(constants.ATTACK_WINDUP - 1, Math.max(0, (charge || 0) - 1)));
    if (level) actor.attackTicks = constants.CHARGED_TICKS;
    actor.attackSerial++;
    actor.attackHitIds = [];
    // A spawn shield is defensive, not a free unanswerable attack.
    actor.invulnerable = 0;
    emit(state, 'attack', actor, { directionX: direction.x, directionY: direction.y, charged: level > 0 });
  }
  function moveActor(state, actor, command, arena) {
    actor.px = actor.x; actor.py = actor.y;
    if (actor.boss && actor.boss.phase !== 'idle') {
      command = normalizeCommand(); actor.vx = 0;
    }
    const wasAttacking = actor.attackTicks > 0, wasGrounded = actor.onGround;
    for (const field of ['stun', 'invulnerable', 'attackTicks', 'attackCooldown', 'hitGuard', 'dashTicks', 'dashCooldown', 'dropTicks', 'jumpBufferTicks']) {
      if (actor[field] > 0) actor[field]--;
    }
    if (wasAttacking && !actor.attackTicks) { actor.attackCooldown = constants.ATTACK_RECOVERY; actor.attackCharge = 0; }
    if (!actor.dropTicks) actor.dropPlatformId = null;
    if (actor.onGround) actor.coyoteTicks = constants.COYOTE_TICKS;
    else if (actor.coyoteTicks > 0) actor.coyoteTicks--;
    if (command.jumpPressed) actor.jumpBufferTicks = constants.BUFFER_TICKS;

    if (!actor.stun) {
      if (command.moveX) actor.facing = sign(command.moveX);
      if (actor.jumpBufferTicks > 0 && !actor.dashTicks) {
        if (actor.onGround && command.moveY > 0.6) {
          actor.dropTicks = 18; actor.dropPlatformId = actor.supportId;
          actor.y += 3; actor.onGround = false; actor.supportId = null;
          actor.coyoteTicks = 0; actor.jumpCount = 1; actor.jumpBufferTicks = 0;
          actor.vy = 1;
        } else startJump(state, actor);
      }
      if (!actor.boss && command.dashPressed && !actor.dashCooldown && !dashLockTicks(actor) && (actor.onGround || actor.airDashAvailable)) {
        const direction = aim(command, actor.facing);
        // Dash-cancel: leaving windup, charge or recovery drops the pulse.
        actor.attackTicks = 0; clearPulse(actor);
        actor.dashTicks = constants.DASH_TICKS; actor.dashCooldown = constants.DASH_COOLDOWN;
        actor.invulnerable = Math.max(actor.invulnerable, constants.DODGE_TICKS);
        actor.vx = direction.x * constants.DASH_SPEED; actor.vy = direction.y * constants.DASH_SPEED;
        if (!actor.onGround) actor.airDashAvailable = false;
        actor.onGround = false; actor.supportId = null;
      }
      if (!actor.boss && actor.charge > 0) {
        if (command.attackHeld && actor.charge < constants.CHARGE_AUTO) actor.charge++;
        else beginAttack(state, actor, command, actor.charge);
      } else if (!actor.boss && command.attackPressed && !actor.attackTicks && !actor.attackCooldown && !actor.dashTicks) {
        // Holding the button charges; an unheld press is an immediate tap.
        if (command.attackHeld) actor.charge = 1; else beginAttack(state, actor, command, 0);
      }
    } else if (actor.charge) actor.charge = 0;

    if (!actor.dashTicks) {
      const input = actor.stun ? command.moveX * 0.10 : actor.charge > 0 ? command.moveX * constants.CHARGE_MOVE : command.moveX;
      const accel = actor.onGround ? constants.ACCEL_GROUND : constants.ACCEL_AIR;
      if (input) {
        const desired = input * constants.MAX_RUN;
        // Never clamp away knockback. Inputs brake it gradually, like normal movement.
        if (Math.abs(actor.vx) <= constants.MAX_RUN || sign(input) !== sign(actor.vx)) {
          const change = clamp(desired - actor.vx, -accel, accel);
          actor.vx += change * (actor.stun ? 0.18 : 1);
        }
        actor.vx *= 0.995;
      } else actor.vx *= actor.onGround ? constants.FRICTION_GROUND : constants.FRICTION_AIR;
      if (!command.jumpHeld && actor.jumpHeldLast && actor.vy < -2 && !actor.stun) actor.vy *= constants.JUMP_CUT;
      actor.vy = Math.min(constants.MAX_FALL, actor.vy + (actor.vy < 0 ? constants.GRAVITY_RISE : constants.GRAVITY_FALL));
    }
    actor.jumpHeldLast = command.jumpHeld;
    const oldFeet = actor.y + actor.h, fallSpeed = actor.vy;
    actor.x += actor.vx; actor.y += actor.vy;
    actor.onGround = false; actor.supportId = null;
    if (actor.vy >= 0) {
      let landed = null;
      for (const p of arena.platforms) {
        if (actor.dropTicks && actor.dropPlatformId === p.id) continue;
        if (oldFeet <= p.y + 0.01 && actor.y + actor.h >= p.y && actor.x + actor.w > p.x && actor.x < p.x + p.w && (!landed || p.y < landed.y)) landed = p;
      }
      if (landed) {
        actor.y = landed.y - actor.h; actor.vy = 0;
        actor.onGround = true; actor.supportId = landed.id;
        actor.jumpCount = 0; actor.coyoteTicks = constants.COYOTE_TICKS;
        actor.airDashAvailable = true;
        if (!wasGrounded && fallSpeed >= constants.LAND_MIN_IMPACT) emit(state, 'land', actor, { impact: Math.round(fallSpeed * 10) / 10 });
      }
    }
  }

  function resolveAttacks(state) {
    const pending = [];
    for (const attacker of state.actors) {
      if (attacker.stocks <= 0 || attacker.respawnTicks || attacker.stun) continue;
      const box = attackBox(attacker);
      if (!box || !box.active) continue;
      for (const target of state.actors) {
        if (!enemies(state, attacker, target) || target.stocks <= 0 || target.respawnTicks || target.invulnerable || target.hitGuard > 0 || attacker.attackHitIds.includes(target.id)) continue;
        if (overlap(box, target)) {
          attacker.attackHitIds.push(target.id);
          pending.push({ attacker, target });
        }
      }
    }
    // Capture every hit before applying any, then group by stable target ID.
    // Simultaneous pulses add damage but average their launch vectors at the
    // resulting damage: knockback stays bounded to a single equal-damage strike,
    // and opposite pulses cancel horizontally. Canonical ID order also makes
    // floating-point sums/events stable when the actor array is permuted.
    pending.sort((a, b) => a.target.id - b.target.id || a.attacker.id - b.attacker.id);
    for (const actor of state.actors) actor.attackHitIds.sort((a, b) => a - b);
    for (let index = 0; index < pending.length;) {
      const b = pending[index].target, hits = [];
      while (index < pending.length && pending[index].target.id === b.id) hits.push(pending[index++]);
      if (b.boss) {
        // Super armor prevents stun-locking a telegraph. Recovery is a genuine
        // opening: the same pulse deals double core damage for 1.3 seconds.
        const damage = constants.ATTACK_DAMAGE * (b.boss.phase === 'recover' ? 2 : 1);
        b.boss.health = Math.max(0, b.boss.health - damage * hits.length);
        b.damage = b.boss.maxHealth - b.boss.health;
        b.lastHitBy = hits[0].attacker.id;
        for (const hit of hits) emit(state, 'hit', hit.attacker, { targetId: b.id, x: centerX(b), y: centerY(b), damage, knockback: 0, boss: true });
        if (!b.boss.health) loseStock(state, b);
        continue;
      }
      b.damage = Math.min(999, b.damage + hits.reduce((sum, hit) => sum + pulseDamage(hit.attacker), 0));
      const force = 5.8 + b.damage * 0.105;
      let vx = 0, vy = 0;
      for (const hit of hits) {
        const a = hit.attacker;
        const launchX = Math.abs(a.attackDirX) < 0.12 ? (centerX(b) >= centerX(a) ? 0.14 : -0.14) : a.attackDirX;
        const power = pulseKnockback(a);
        vx += launchX * force * 1.15 * power;
        vy += (a.attackDirY > 0.3 ? a.attackDirY * force : a.attackDirY * force - 5.2 - force * 0.20) * power;
        emit(state, 'hit', a, { targetId: b.id, x: centerX(b), y: centerY(b), damage: pulseDamage(a), knockback: force * power, charged: a.attackCharge > 0 });
      }
      b.vx = vx / hits.length; b.vy = vy / hits.length;
      b.stun = Math.min(50, 15 + Math.floor(b.damage * 0.13));
      b.attackTicks = 0; b.dashTicks = 0; b.onGround = false; b.supportId = null; clearPulse(b); b.hitGuard = constants.HIT_GUARD;
      // Equal-strength simultaneous contributors tie by stable actor ID for KO
      // credit only; that cosmetic statistic never breaks a match-result tie.
      b.coyoteTicks = 0; b.lastHitBy = hits[0].attacker.id;
    }
  }
  function outOfBounds(actor, bounds) {
    return actor.x + actor.w < bounds.left || actor.x > bounds.right || actor.y + actor.h < bounds.top || actor.y > bounds.bottom;
  }
  function loseStock(state, actor) {
    actor.stocks = Math.max(0, actor.stocks - 1); actor.deaths++;
    // Damage belongs to the stock just lost, not the fresh stock waiting to
    // respawn. A timeout during that wait must use the same score as after it.
    actor.damage = 0;
    const credit = state.actors.find((other) => other.id === actor.lastHitBy);
    if (credit && enemies(state, actor, credit)) credit.kos++;
    actor.vx = 0; actor.vy = 0; actor.attackTicks = 0; actor.dashTicks = 0; clearPulse(actor);
    actor.respawnTicks = actor.stocks > 0 ? constants.RESPAWN_TICKS : 0;
    actor.onGround = false; actor.supportId = null;
    if (actor.boss) {
      actor.boss.health = 0; actor.boss.attack = null;
      setBossPhase(actor.boss, 'defeated', 0);
      emit(state, 'boss-defeated', actor);
    }
    emit(state, 'ringout', actor, { targetId: credit ? credit.id : null, stocks: actor.stocks });
  }
  function respawn(state, actor, arena) {
    let best = arena.spawns[(actor.id + actor.deaths) % arena.spawns.length], score = -Infinity;
    for (let i = 0; i < arena.spawns.length; i++) {
      const spawn = arena.spawns[(i + actor.id + actor.deaths) % arena.spawns.length];
      let nearest = 1e9;
      for (const other of state.actors) {
        if (!enemies(state, actor, other) || other.stocks <= 0 || other.respawnTicks) continue;
        const dx = other.x - spawn.x, dy = other.y - spawn.y;
        nearest = Math.min(nearest, dx * dx + dy * dy);
      }
      if (nearest > score) { score = nearest; best = spawn; }
    }
    resetBody(actor, best);
    actor.supportId = supportAt(arena, actor).id;
    actor.ai.nextThinkTick = state.tick; actor.ai.nextJumpTick = state.tick;
    actor.ai.intent = normalizeCommand(); actor.ai.lastTick = -1;
    emit(state, 'respawn', actor);
  }
  function finish(state, reason) {
    const groups = [];
    for (const actor of state.actors) {
      const id = state.format === 'teams' ? actor.team : actor.id;
      let group = groups.find((item) => item.id === id);
      if (!group) { group = { id, stocks: 0, damage: 0, actorIds: [] }; groups.push(group); }
      group.stocks += actor.stocks;
      group.damage += actor.stocks > 0 ? actor.damage : 0;
      group.actorIds.push(actor.id);
    }
    groups.sort((a, b) => b.stocks - a.stocks || a.damage - b.damage || a.id - b.id);
    const top = groups[0];
    const bossEncounter = state.encounter && state.encounter.type === 'boss';
    const survivingBoss = bossEncounter && state.actors.some((actor) => actor.boss && actor.stocks > 0);
    const winners = bossEncounter && reason === 'time' && survivingBoss ? groups.filter((group) => group.id === 1) : top.stocks === 0 ? [] : groups.filter((group) => group.stocks === top.stocks && (reason !== 'time' || group.damage === top.damage));
    const tie = winners.length !== 1;
    state.phase = 'over';
    state.result = {
      winnerIds: winners.flatMap((group) => group.actorIds).sort((a, b) => a - b),
      winnerTeam: state.format === 'teams' && !tie ? winners[0].id : null,
      tie, reason,
    };
    state.events.push({ type: 'finish', actorId: state.result.winnerIds[0] || 0, x: 480, y: 300, reason });
  }
  function step(state, commandsById) {
    state.events = [];
    if (state.phase === 'over') return state;
    state.tick++;
    if (state.phase === 'countdown') {
      state.countdownTicks = Math.max(0, state.countdownTicks - 1);
      if (state.countdownTicks === 0) state.phase = 'playing';
      return state;
    }
    const arena = getArena(state.arenaId);
    const commands = commandsById && typeof commandsById === 'object' ? commandsById : {};
    for (const actor of state.actors) {
      if (actor.stocks <= 0) continue;
      if (actor.respawnTicks > 0) {
        actor.respawnTicks--;
        if (!actor.respawnTicks) respawn(state, actor, arena);
        continue;
      }
      moveActor(state, actor, normalizeCommand(commands[actor.id]), arena);
    }
    for (const actor of state.actors) tickBoss(state, actor, normalizeCommand(commands[actor.id]));
    resolveAttacks(state);
    resolveBossAttacks(state);
    for (const actor of state.actors) {
      if (actor.stocks > 0 && !actor.respawnTicks && outOfBounds(actor, arena.bounds)) loseStock(state, actor);
    }
    state.timeLeftTicks = Math.max(0, state.timeLeftTicks - 1);
    const alive = state.actors.filter((actor) => actor.stocks > 0);
    const remaining = state.format === 'teams' ? new Set(alive.map((actor) => actor.team)).size : alive.length;
    if (remaining <= 1) finish(state, 'stocks');
    else if (state.timeLeftTicks === 0) finish(state, 'time');
    return state;
  }

  // A tiny platform graph is enough for these hand-authored stages. Edges use
  // conservative double-jump reach, not line-of-sight chasing across a pit.
  function platformGap(a, b) { return Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)); }
  function nextPlatform(arena, from, to) {
    if (!from || !to || from.id === to.id) return to;
    const distance = {}, first = {}, visited = new Set();
    distance[from.id] = 0;
    for (let n = 0; n < arena.platforms.length; n++) {
      let current = null;
      for (const p of arena.platforms) {
        if (!visited.has(p.id) && distance[p.id] !== undefined && (!current || distance[p.id] < distance[current.id])) current = p;
      }
      if (!current) break;
      if (current.id === to.id) return first[current.id] || to;
      visited.add(current.id);
      for (const p of arena.platforms) {
        const rise = current.y - p.y, gap = platformGap(current, p);
        if (p.id === current.id || rise > 235 || gap > 235 || (rise > 150 && gap > 150)) continue;
        const cost = distance[current.id] + 1 + gap / 200 + Math.max(0, rise) / 240;
        if (distance[p.id] === undefined || cost < distance[p.id]) {
          distance[p.id] = cost; first[p.id] = first[current.id] || p;
        }
      }
    }
    return null;
  }
  function recoveryPlatform(arena, actor) {
    let best = null, bestScore = Infinity;
    for (const p of arena.platforms) {
      const x = clamp(centerX(actor), p.x + 28, p.x + p.w - 28);
      const rise = actor.y + actor.h - p.y;
      // Favor an attainable low ledge; spending both jumps on a high decorative
      // shelf is worse than landing safely and climbing via the graph.
      const score = Math.abs(centerX(actor) - x) + Math.max(0, rise) * 1.8 + Math.max(0, -rise) * 0.25;
      if (score < bestScore) { best = p; bestScore = score; }
    }
    return best;
  }
  function cpuDecision(state, actor) {
    const ai = actor.ai, arena = getArena(state.arenaId), difficulty = difficulties[state.difficulty];
    const c = normalizeCommand();
    const candidates = state.actors.filter((other) => enemies(state, actor, other) && other.stocks > 0 && !other.respawnTicks);
    let target = null, bestScore = Infinity;
    for (const other of candidates) {
      const score = Math.abs(centerX(other) - centerX(actor)) + Math.abs(centerY(other) - centerY(actor)) * 0.9 + (other.invulnerable ? 70 : 0) - (other.id === ai.targetId ? 28 : 0);
      if (score < bestScore) { target = other; bestScore = score; }
    }
    ai.targetId = target ? target.id : null;
    const support = arena.platforms.find((p) => p.id === actor.supportId) || (actor.onGround ? supportAt(arena, actor) : null);
    const below = platformBelow(arena, actor);
    const targetPlatform = target && (arena.platforms.find((p) => p.id === target.supportId) || platformBelow(arena, target));
    let goal = support && targetPlatform ? nextPlatform(arena, support, targetPlatform) : targetPlatform;
    const lowest = Math.max(...arena.platforms.map((p) => p.y));
    const offstage = !below && (!support || actor.y + actor.h > lowest - 75);
    if (offstage || (!support && !goal)) goal = recoveryPlatform(arena, actor);
    if (!goal) goal = support || recoveryPlatform(arena, actor);
    ai.goalPlatformId = goal.id;
    const samePlatform = support && targetPlatform && support.id === targetPlatform.id;
    const hunting = target && !offstage && (samePlatform || (below && targetPlatform && below.id === targetPlatform.id));
    let destination = hunting ? centerX(target) : goal.x + goal.w / 2;
    // Stand at striking distance, rather than crossing through the opponent
    // during windup. Proportional steering also breaks synchronized chase loops.
    if (hunting && Math.abs(centerY(target) - centerY(actor)) < 42) destination -= sign(centerX(target) - centerX(actor) || actor.facing) * 39;
    // Pursuit always aims for a safe landing zone, even if the target just fell.
    destination = clamp(destination, goal.x + 24, goal.x + goal.w - 24);
    const dxGoal = destination - centerX(actor);
    c.moveX = Math.abs(dxGoal) > 8 ? clamp(dxGoal / (actor.onGround ? 55 : 38), -1, 1) : 0;
    // Brake before a landing rather than overshooting it at full run speed.
    if (sign(dxGoal) === sign(actor.vx) && Math.abs(dxGoal) < Math.abs(actor.vx) * (actor.onGround ? 3.0 : 3.8)) c.moveX = actor.onGround ? 0 : -sign(actor.vx) * 0.5;
    c.jumpHeld = true;
    const feet = actor.y + actor.h;
    const needRise = goal.y < feet - 24;
    const gapAhead = support && goal.id !== support.id && platformGap(support, goal) > 0;
    const approachingEdge = support && ((c.moveX > 0 && actor.x + actor.w + Math.max(22, actor.vx * 8) > support.x + support.w) || (c.moveX < 0 && actor.x - Math.max(22, -actor.vx * 8) < support.x));
    if (state.tick >= ai.nextJumpTick) {
      const launch = actor.onGround && (needRise || gapAhead || (approachingEdge && !samePlatform));
      const recover = !actor.onGround && actor.jumpCount < 2 && actor.vy > -2.5 && (offstage || needRise || (goal.y <= feet + 15 && Math.abs(dxGoal) > 65));
      if (launch || recover) { c.jumpPressed = true; ai.nextJumpTick = state.tick + 13; }
    }
    // Drop through a one-way ledge to reach a lower opponent; never drop over a
    // void. This also keeps a bot from camping forever on the furnace crown.
    if (support && targetPlatform && targetPlatform.y > support.y + 45 && centerX(actor) > targetPlatform.x + 25 && centerX(actor) < targetPlatform.x + targetPlatform.w - 25 && state.tick >= ai.nextJumpTick) {
      c.moveY = 1; c.jumpPressed = true; ai.nextJumpTick = state.tick + 20;
    }
    // Guardian specials have their own aim/phase logic below. Fighter pulse and
    // dodge steering would overwrite the safe destination, then persist after
    // the unsupported action is discarded (including a run straight offstage).
    if (target && !actor.boss) {
      const dx = centerX(target) - centerX(actor), dy = centerY(target) - centerY(actor);
      if (!offstage && Math.abs(dx) < 68 && Math.abs(dy) < 60 && !target.invulnerable && state.tick >= ai.nextAttackTick && !actor.stun && !actor.attackTicks && !actor.attackCooldown && !actor.charge && !actor.dashTicks) {
        c.attackPressed = true;
        // Aim through the target. Directional attacks still use the same axes
        // as a human, including the resulting ordinary movement that tick.
        c.moveX = Math.abs(dx) > 12 ? sign(dx) : 0;
        c.moveY = Math.abs(dy) > 23 ? sign(dy) : 0;
        if (!c.moveX && !c.moveY) c.moveX = actor.facing;
        ai.nextAttackTick = state.tick + Math.round(difficulty.attackDelay / ai.aggression);
        // Punish a long stun or a high-damage target with a charged pulse; the
        // bot holds for a fixed span and releases along the aim it chose.
        const chance = (target.stun >= 22 ? 0.5 : target.damage >= 70 ? 0.2 : 0.06) * difficulty.charge;
        if (random(ai) < chance) {
          ai.chargeUntil = state.tick + constants.CHARGE_MIN + 2 + Math.floor(random(ai) * (constants.CHARGE_MAX - constants.CHARGE_MIN));
          ai.chargeAimX = c.moveX; ai.chargeAimY = c.moveY; c.attackHeld = true;
        }
      }
      const safeDash = support && actor.x > support.x + 90 && actor.x + actor.w < support.x + support.w - 90;
      if (safeDash && !actor.dashCooldown && !actor.attackTicks && target.attackTicks > 0 && Math.abs(dx) < 95 && Math.abs(dy) < 55 && random(ai) < difficulty.dodge) {
        c.dashPressed = true; c.attackPressed = false; c.moveX = -sign(dx || actor.facing); c.moveY = 0;
      }
    }
    if (actor.boss) {
      c.attackPressed = actor.boss.phase === 'idle' && actor.boss.phaseTicks <= difficulty.reaction && !!target;
      c.dashPressed = false;
      if (actor.boss.phase !== 'idle') return normalizeCommand();
    } else if (state.encounter && state.encounter.type === 'boss') {
      const boss = state.actors.find((other) => other.boss && other.stocks > 0);
      const box = boss && bossAttackBox(boss);
      if (box && boss.boss.phase === 'charging' && boss.boss.phaseTicks <= 32 && overlap(box, actor)) {
        if (boss.boss.move === 'shockwave') {
          c.jumpPressed = actor.onGround; c.jumpHeld = true; c.attackPressed = false;
        } else {
          // Evade the marked column toward room on this platform, never dive
          // over a nearby ledge just because the shortest direction is unsafe.
          const midpoint = box.x + box.w / 2;
          let away = sign(centerX(actor) - midpoint) || -1;
          if (support && (away < 0 ? actor.x - support.x < 70 : support.x + support.w - actor.x - actor.w < 70)) away *= -1;
          c.moveX = away; c.moveY = 0; c.attackPressed = false;
        }
      }
    }
    return c;
  }
  function cpuInput(state, actorId) {
    const actor = state.actors.find((item) => item.id === actorId);
    if (!actor || actor.controller !== 'cpu') return normalizeCommand();
    const ai = actor.ai;
    if (ai.lastTick === state.tick) return Object.assign({}, ai.cachedCommand);
    let command = normalizeCommand();
    if (state.phase === 'playing' && actor.stocks > 0 && !actor.respawnTicks) {
      if (state.tick >= ai.nextThinkTick) {
        command = cpuDecision(state, actor);
        ai.intent = Object.assign({}, command, { jumpPressed: false, attackPressed: false, dashPressed: false });
        if (command.attackPressed && actor.onGround) { ai.intent.moveX = 0; ai.intent.moveY = 0; }
        ai.nextThinkTick = state.tick + difficulties[state.difficulty].reaction + ai.reactionOffset;
      } else command = Object.assign({}, ai.intent);
    }
    if (!actor.boss && (actor.charge > 0 || command.attackHeld)) {
      // The hold is resolved every tick so release timing never waits for the
      // slower think cadence.
      if (state.tick < ai.chargeUntil && !actor.stun) command.attackHeld = true;
      else { command.attackHeld = false; if (actor.charge > 0) { command.moveX = ai.chargeAimX; command.moveY = ai.chargeAimY; } }
    } else command.attackHeld = false;
    ai.lastTick = state.tick; ai.cachedCommand = command;
    return Object.assign({}, command);
  }

  // Presentation math, kept pure so node --test can pin it. Nothing here is read
  // by step(): hit-stop, shake, slow-mo and edge cues never alter the simulation
  // or the wire. Tuning mirrors the runner (trauma decays 0.03/tick, shake is
  // trauma squared, directional kick eases out over ~0.15 s).
  const feel = freeze({
    TRAUMA_DECAY: 0.03, KICK_RATE: 16, SHAKE_PX: 9, SHAKE_ROT: 0.01,
    KO_SLOW_TICKS: 21, KO_TIMESCALE: 0.4, KO_ZOOM: 0.06, KO_FLASH_TICKS: 14,
    LAND_SQUASH_TICKS: 5, DANGER_RANGE: 180, DANGER_LOOKAHEAD: 14, BOUNDS_GLOW_RANGE: 220,
    // Heavier hits freeze longer: a 0% pulse (knockback ~6) holds 4 ticks, a
    // 100% pulse (~16) holds 7, a full charge holds the 8-tick cap.
    hitstopTicksFor(event) {
      const e = event || {}, knock = Math.max(0, finite(e.knockback, 0)), dmg = Math.max(0, finite(e.damage, 0));
      return clamp(Math.round(2 + knock * 0.28 + (dmg >= 20 ? 1 : 0)), 2, 8);
    },
    // Trauma added by one hit; involved = the viewer dealt or took it.
    traumaFor(event, involved) {
      const e = event || {}, knock = Math.max(0, finite(e.knockback, 0));
      const base = clamp(0.12 + knock * 0.02 + (finite(e.damage, 0) >= 20 ? 0.12 : 0), 0.15, 0.62);
      return involved === false ? base * 0.35 : base;
    },
    addTrauma(trauma, amount) { return clamp(finite(trauma, 0) + finite(amount, 0), 0, 1); },
    decayTrauma(trauma, ticks) { return Math.max(0, finite(trauma, 0) - feel.TRAUMA_DECAY * Math.max(0, finite(ticks, 1))); },
    // Screen-space impulse along the victim's launch, in CSS px.
    kickFor(event, victim) {
      const e = event || {}, v = victim || {}, knock = clamp(finite(e.knockback, 0), 0, 30);
      const vx = finite(v.vx, 0), vy = finite(v.vy, 0), len = Math.hypot(vx, vy) || 1;
      const mag = clamp(2 + knock * 0.35, 2, 9);
      return { x: vx / len * mag, y: vy / len * mag * 0.6 };
    },
    // seconds t; kick = {x, y, at}. Deterministic in its inputs.
    shakeOffset(trauma, t, kick) {
      const tr = clamp(finite(trauma, 0), 0, 1) ** 2, k = kick ? Math.exp(-Math.max(0, t - kick.at) * feel.KICK_RATE) : 0, amp = tr * feel.SHAKE_PX;
      return {
        x: amp * (Math.sin(t * 71.0) * 0.6 + Math.sin(t * 47.3) * 0.4) + (kick ? kick.x * k : 0),
        y: amp * (Math.sin(t * 89.7 + 1.3) * 0.6 + Math.sin(t * 53.1 + 2.1) * 0.4) + (kick ? kick.y * k : 0),
        rot: tr * feel.SHAKE_ROT * Math.sin(t * 61.3 + 0.7) || 0,
      };
    },
    // Timescale for the KO slow-mo; remaining counts down from KO_SLOW_TICKS and
    // eases back to real time over the final quarter.
    koTimescale(remaining) {
      if (!(remaining > 0)) return 1;
      const ease = clamp(remaining / (feel.KO_SLOW_TICKS * 0.25), 0, 1);
      return feel.KO_TIMESCALE + (1 - feel.KO_TIMESCALE) * (1 - ease);
    },
    // Squash and stretch for a landing; age counts ticks since the land event.
    landSquash(age, impact) {
      const n = feel.LAND_SQUASH_TICKS;
      if (!(age >= 0) || age >= n) return { x: 1, y: 1 };
      const strength = clamp((finite(impact, 0) - constants.LAND_MIN_IMPACT) / 9, 0, 1) * 0.5 + 0.5, k = 1 - age / n;
      return { x: 1 + 0.15 * strength * k, y: 1 - 0.15 * strength * k };
    },
    dustCount(impact) { return impact > 6 ? clamp(Math.round(2 + (impact - 6) * 0.5), 4, 6) : 0; },
    // Per-side alpha (0..1) for the edge-danger vignette. Distance is measured
    // from the fighter's nearest edge to each blast line, shortened by up to
    // DANGER_LOOKAHEAD ticks of travel toward that line so a launch warns early.
    edgeDanger(actor, bounds) {
      const out = { left: 0, right: 0, top: 0, bottom: 0, max: 0 };
      if (!actor || !bounds) return out;
      const range = feel.DANGER_RANGE, look = feel.DANGER_LOOKAHEAD;
      const dist = {
        left: actor.x - bounds.left, right: bounds.right - (actor.x + actor.w),
        top: actor.y - bounds.top, bottom: bounds.bottom - (actor.y + actor.h),
      };
      const toward = { left: -finite(actor.vx, 0), right: finite(actor.vx, 0), top: -finite(actor.vy, 0), bottom: finite(actor.vy, 0) };
      for (const side of ['left', 'right', 'top', 'bottom']) {
        const projected = dist[side] - Math.max(0, toward[side]) * look;
        out[side] = clamp(1 - projected / range, 0, 1);
        if (out[side] > out.max) out.max = out[side];
      }
      return out;
    },
    // Alpha for the faint blast-line guide: how close any live fighter is.
    boundsGlow(distance) { return clamp(1 - finite(distance, Infinity) / feel.BOUNDS_GLOW_RANGE, 0, 1); },
  });

  function snapshot(state) { return JSON.parse(JSON.stringify(state)); }
  function restore(saved) {
    if (!saved || saved.version !== constants.VERSION || !arenas.some((a) => a.id === saved.arenaId) || !['duel', 'ffa', 'teams'].includes(saved.format) || !Object.hasOwn(difficulties, saved.difficulty) || !['countdown', 'playing', 'over'].includes(saved.phase)) throw new TypeError('Invalid arena snapshot');
    if (!Number.isInteger(saved.tick) || saved.tick < 0 || !Number.isInteger(saved.rngState) || !Number.isInteger(saved.countdownTicks) || !Number.isInteger(saved.timeLeftTicks) || !Array.isArray(saved.events) || !Array.isArray(saved.actors) || saved.actors.length !== (saved.encounter && saved.encounter.type === 'boss' ? (crewCount(saved.encounter) + 1) : saved.format === 'duel' ? 2 : 4)) throw new TypeError('Invalid arena snapshot state');
    if (saved.encounter !== undefined) {
      const e = saved.encounter;
      const canonical = e && encounterOptions(Object.assign({}, e, { encounter: e.type }));
      if (!canonical || Object.keys(e).length !== Object.keys(canonical).length || Object.keys(canonical).some((key) => e[key] !== canonical[key]) || saved.timeLeftTicks < 0 || saved.timeLeftTicks > e.durationTicks || saved.countdownTicks < 0 || saved.countdownTicks > e.countdownTicks || (e.type === 'boss' && saved.format !== 'teams')) throw new TypeError('Invalid arena snapshot encounter');
    }
    const bossEncounter = saved.encounter && saved.encounter.type === 'boss';
    const ids = new Set();
    for (const actor of saved.actors) {
      if (!actor || !Number.isInteger(actor.id) || actor.id < 1 || ids.has(actor.id) || !actor.ai || !Number.isInteger(actor.ai.rngState) || !actor.ai.intent || !actor.ai.cachedCommand || !Array.isArray(actor.attackHitIds)) throw new TypeError('Invalid arena snapshot actor');
      ids.add(actor.id);
      if (actor.boss) {
        const b = actor.boss;
        if (!bossEncounter || actor.id !== saved.actors.length || actor.team !== 1 || actor.w !== 56 || actor.h !== 74 || b.tier !== saved.encounter.bossTier || b.maxHealth !== bossHealth(saved.encounter) || !Number.isInteger(b.health) || b.health < 0 || b.health > b.maxHealth || !['idle', 'charging', 'active', 'recover', 'defeated'].includes(b.phase) || !['shockwave', 'lance'].includes(b.move) || !Number.isInteger(b.cycle) || b.cycle < 0 || !Number.isInteger(b.phaseTicks) || !Number.isInteger(b.phaseDuration) || b.phaseTicks < 0 || b.phaseTicks > b.phaseDuration || b.phaseDuration > 78 || !Array.isArray(b.hitIds) || b.hitIds.some((id, i) => !Number.isInteger(id) || id < 1 || id >= actor.id || (i && b.hitIds[i - 1] >= id))) throw new TypeError('Invalid arena snapshot boss');
        if (b.attack !== null && (!b.attack || Object.keys(b.attack).length !== 4 || !['x', 'y', 'w', 'h'].every((key) => Number.isFinite(b.attack[key])) || b.attack.w <= 0 || b.attack.h <= 0 || b.attack.w > 1000 || b.attack.h > 2000)) throw new TypeError('Invalid arena snapshot boss attack');
        if (((b.phase === 'charging' || b.phase === 'active' || b.phase === 'recover') && !b.attack) || ((b.phase === 'idle' || b.phase === 'defeated') && b.attack) || (b.phase === 'defeated') !== (b.health === 0) || actor.stocks !== (b.health > 0 ? 1 : 0)) throw new TypeError('Invalid arena snapshot boss phase');
      } else if (bossEncounter && (actor.id >= saved.actors.length || actor.team !== 0)) throw new TypeError('Invalid arena snapshot boss roster');
      for (const key of ['x', 'y', 'px', 'py', 'vx', 'vy', 'w', 'h', 'stocks', 'damage', 'stun', 'invulnerable', 'attackTicks', 'dashTicks', 'respawnTicks']) {
        if (!Number.isFinite(actor[key])) throw new TypeError('Invalid arena snapshot number');
      }
      // Pulse commitment fields arrived after VERSION 1 shipped; saves made
      // without them restore with the neutral value.
      for (const key of ['attackCooldown', 'attackCharge', 'charge', 'hitGuard']) {
        if (actor[key] === undefined) actor[key] = 0;
        else if (!Number.isInteger(actor[key]) || actor[key] < 0 || actor[key] > 255) throw new TypeError('Invalid arena snapshot number');
      }
    }
    if (bossEncounter && saved.actors.filter((actor) => actor.boss).length !== 1) throw new TypeError('Invalid arena snapshot boss roster');
    return snapshot(saved);
  }

  return freeze({ feel, pulseDamage, pulseKnockback, dashLockTicks, constants, profiles, difficulties, arenas, getArena, create, normalizeCommand, createActionBuffer, step, cpuInput, attackBox, bossAttackBox, snapshot, restore });
});
