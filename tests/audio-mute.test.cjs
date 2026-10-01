const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

// A recording stand-in for Web Audio: every node remembers what it was connected to and what gain/oscillators were scheduled.
function fakeAudio() {
  const log = { started: 0 };
  const param = (v = 0) => ({ value: v, setValueAtTime(x) { this.value = x; }, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime(x) { this.value = x; }, cancelScheduledValues() {} });
  const node = () => ({ connect(n) { return n; }, gain: param(1), frequency: param(), pan: param(), delayTime: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), Q: param(),
    start() { log.started++; }, stop() {}, setPeriodicWave() {} });
  class AC {
    constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = node(); }
    createGain() { const n = node(); (log.gains ||= []).push(n); return n; }
    createDynamicsCompressor() { return node(); } createBiquadFilter() { return node(); } createDelay() { return node(); }
    createOscillator() { return node(); } createBufferSource() { return node(); } createStereoPanner() { return node(); }
    createPeriodicWave() { return {}; } createBuffer(n, len) { return { getChannelData: () => new Float32Array(len) }; }
    resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); }
  }
  return { AC, log };
}

function solo(t) {
  const c = client(relay());
  t.after(() => c.close());
  const fake = fakeAudio();
  c.context.AudioContext = fake.AC; c.context.window.AudioContext = fake.AC;
  return { c, fake };
}

test('a closed Sound FX channel schedules nothing, however the sound is asked for', (t) => {
  const { c, fake } = solo(t);
  assert.equal(c.run('Audio.ensure()'), true);
  for (const off of ['settings.sfx = false', 'settings.muted = true', 'settings.sfxVol = 0']) {
    c.run('settings.sfx = true; settings.muted = false; settings.sfxVol = 1; ' + off);
    fake.log.started = 0;
    c.run("for (const k of Object.keys(Audio.sfx)) { try { Audio.sfx[k](1, 1); } catch (e) {} }; Audio.synth.tone('sine', 440, 440, .1, .1); Audio.synth.noise(.1, .1)");
    assert.equal(fake.log.started, 0, off + ': no oscillator or noise source may start');
  }
  c.run('settings.sfx = true; settings.muted = false; settings.sfxVol = 1');
  fake.log.started = 0;
  c.run('Audio.sfx.jump(false)');
  assert.ok(fake.log.started > 0, 'and it still plays when everything is on');
});

test('the jingle buses follow their channel and the mute, and a restart never reopens them', (t) => {
  const { c } = solo(t);
  c.run('Audio.ensure()');
  const levels = (sfx, music, muted) => {
    c.run(`settings.sfx = ${sfx}; settings.music = ${music}; settings.muted = ${muted}; Audio.syncChannels(); Audio.killSting()`);
    return JSON.parse(c.run('JSON.stringify(Audio.jingleLevels)'));
  };
  assert.deepEqual(levels(true, true, false), { sfx: 1, music: 1 });
  assert.deepEqual(levels(false, true, false), { sfx: 0, music: 1 }, 'Sound FX off silences the sector bells and the death jingle');
  assert.deepEqual(levels(true, false, false), { sfx: 1, music: 0 }, "Music off silences the song's own bells");
  assert.deepEqual(levels(true, true, true), { sfx: 0, music: 0 }, 'the master mute wins over both');
});
