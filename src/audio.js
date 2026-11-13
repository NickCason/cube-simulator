// Procedural sound design (WebAudio): every sound is synthesized, nothing
// is downloaded. Wet jelly squelches are built from bursts of resonant
// band-passed noise grains over pitch-dropping "bloops".

const rnd = (a, b) => a + Math.random() * (b - a);

// A piece's note (Settings > Sound > Notes): its size's - half the size, an octave up, as a bar's - held to a
// major pentatonic scale (any cubes together sound well: no note of it clashes with another), G4 at 0.62 m.
const PENTA = [0, 2, 4, 7, 9, 12];
export function noteFor(size) {
  const semis = 12 * Math.log2(0.62 / Math.max(0.03, size)), o = Math.floor(semis / 12), r = semis - 12 * o;
  let best = 0;
  for (const p of PENTA) if (Math.abs(r - p) < Math.abs(r - best)) best = p;
  return 392 * Math.pow(2, o + best / 12);
}

const MASTER = 0.8;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.out = null; // (everything as it's heard: a clip records it too - see ui/clips.js)
    this.muted = false;
    this.volume = 0.75; // master level (Settings > Sound)
    this.impactLevel = 0.55; // how loud bumps and landings are
    this.wobbleLevel = 0.5; // how loud the jelly's own hum is (see wobble)
    this.notesLevel = 0; // how much a knock rings its piece's note (see note)
    this.wob = new Map(); // per jiggling piece: where it is in its swing (see wobble)
    this.last = {};
    this.loops = {};
    this.buckets = {};
  }

  init() {
    if (this.ctx) {
      // (not running: suspended - or, on an iPhone, 'interrupted' since the app was last away, where it stayed
      // for good, the sound dead till a reload - a touch asks it back)
      const st = this.ctx.state;
      if (st !== 'running' && st !== 'closed') this.ctx.resume()?.catch?.(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this._masterGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.out = comp;
    // shared noise, and a small room's reverb - made ahead (prepare), at this rate
    const sr = ctx.sampleRate, D = this._made(sr);
    const nb = ctx.createBuffer(1, D.noise.length, sr);
    nb.copyToChannel(D.noise, 0);
    this.noiseBuf = nb;
    const ir = ctx.createBuffer(2, D.ir[0].length, sr);
    ir.copyToChannel(D.ir[0], 0);
    ir.copyToChannel(D.ir[1], 1);
    this.verb = ctx.createConvolver();
    // (the echo's own set-up - its FFTs - a moment after the touch that woke the sound, not in its frame)
    setTimeout(() => (this.verb.buffer = ir), 40);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(this.verb);
  }

  // The noise and the room's echo, made while nothing's going on (main.js, once the page is up): made on the
  // first touch - the one that has to wake the sound - they held that frame up by ~25 ms. (At the usual rates;
  // any other, made then.)
  prepare() {
    for (const sr of [48000, 44100]) this._made(sr);
  }

  _made(sr) {
    const M = (this._pre ||= {});
    if (M[sr]) return M[sr];
    const noise = new Float32Array(sr * 2);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    const ir = [new Float32Array(Math.round(sr * 1.4)), new Float32Array(Math.round(sr * 1.4))];
    for (const c of ir)
      for (let i = 0; i < c.length; i++) {
        const t = i / sr;
        c[i] = (Math.random() * 2 - 1) * Math.exp(-t * 4.2) * (t < 0.012 ? t / 0.012 : 1);
      }
    return (M[sr] = { noise, ir });
  }

  _masterGain() {
    return this.muted ? 0 : MASTER * this.volume * this.volume;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(this._masterGain(), this.ctx.currentTime, 0.05);
  }

  // Settings > Sound: overall volume, impact and wobble loudness, all 0..1
  setLevels(volume, impacts, wobble = this.wobbleLevel, notes = this.notesLevel) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.impactLevel = Math.min(1, Math.max(0, impacts));
    this.wobbleLevel = Math.min(1, Math.max(0, wobble));
    this.notesLevel = Math.min(1, Math.max(0, notes || 0));
    if (this.master) this.master.gain.setTargetAtTime(this._masterGain(), this.ctx.currentTime, 0.05);
  }

  // token bucket: at most `rate` per second, bursts of `burst`
  _bucket(key, rate, burst) {
    const now = this.ctx.currentTime;
    const b = this.buckets[key] || (this.buckets[key] = { n: burst, t: now });
    b.n = Math.min(burst, b.n + (now - b.t) * rate);
    b.t = now;
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
  }

  _panned(pan) {
    if (!pan || !this.ctx.createStereoPanner) return this.bus;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.bus);
    return p;
  }

  _ok(key, minGap) {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    if (this.last[key] && now - this.last[key] < minGap) return false;
    this.last[key] = now;
    return true;
  }

  _noise(t0, dur, type, f0, f1, q, gain, attack = 0.002, out = this.bus) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const off = Math.random() * 1.5;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0, off, dur + 0.05);
    return g;
  }

  _tone(t0, type, f0, f1, dur, gain, attack = 0.003, out = this.bus) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  // The jelly's own voice (see App._wobbleSounds): while a piece jiggles, a
  // soft wet "blub" each time it swings - at its wobble rate, a little loose
  // (never more than 5 a second: faster reads as a motor), as loud as it
  // jiggles. A plop that drops in pitch (lower for a bigger piece, tighter
  // and higher for firmer stuff) over a rounder gloop under it, and a
  // squelch of noise whose band falls with it. (A held tone that followed
  // the jiggle read as a buzz.) list: [{ id, f (wobbles a second), amp,
  // size (m), firm, wet, pan }].
  wobble(list) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, now - (this._wobT ?? now)));
    this._wobT = now;
    const S = this.wob;
    for (const st of S.values()) st.seen = false;
    for (const e of list) {
      let st = S.get(e.id);
      if (!st) S.set(e.id, (st = { ph: 0.6 + Math.random() * 0.4, seen: true }));
      st.seen = true;
      st.ph += dt * Math.min(5, e.f);
      if (st.ph < 1) continue;
      st.ph -= 1 + (Math.random() - 0.5) * 0.3;
      if (!this.muted && this.wobbleLevel > 0.01) this._blub(e.amp * this.wobbleLevel, e.size, e.firm, e.wet, e.pan);
    }
    for (const [id, st] of S) if (!st.seen) S.delete(id);
  }

  _blub(amp, size, firm, wet, pan, at = this.ctx.currentTime) {
    if (amp < 0.004) return;
    const t = at + 0.003, out = this._panned(pan);
    const pitch = Math.pow(1 / Math.min(1.6, Math.max(0.08, size)), 0.5) * rnd(0.92, 1.08);
    const f0 = (95 + 85 * firm) * pitch, dur = (0.13 - 0.05 * firm) * Math.min(1.3, 0.7 + 0.5 * size);
    this._tone(t, 'sine', f0 * 1.9, f0, dur, 0.55 * amp, 0.006, out);
    this._tone(t, 'sine', f0 * 1.3, f0 * 0.68, dur * 1.2, 0.3 * amp, 0.008, out);
    const fc = (900 + 700 * (1 - wet)) * Math.sqrt(pitch);
    this._noise(t, dur * 0.7, 'bandpass', fc * 1.6, fc * 0.6, 3.5, 0.22 * amp * wet, 0.004, out);
  }

  // wet squelch: resonant noise grains + low bloop
  squish(amount = 0.5, pitch = 1) {
    if (!this._ok('squish', 0.06)) return;
    const t = this.ctx.currentTime;
    const a = Math.min(1, amount);
    const grains = 3 + Math.floor(a * 5);
    for (let i = 0; i < grains; i++) {
      const t0 = t + rnd(0, 0.07 + a * 0.08);
      const f = rnd(450, 1800) * pitch;
      this._noise(t0, rnd(0.025, 0.07), 'bandpass', f, f * rnd(0.5, 1.6), rnd(4, 11), 0.35 * a + 0.05);
    }
    this._tone(t, 'sine', 260 * pitch, 140 * pitch, 0.1 + a * 0.06, 0.18 * a + 0.05);
  }

  poke(amount = 0.6) {
    if (!this._ok('poke', 0.05)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 300, 170, 0.09, 0.25 * amount);
    this._noise(t, 0.05, 'bandpass', 1400, 600, 5, 0.28 * amount);
    this.squish(amount * 0.6, 1.2);
  }

  // A piece lands, hits the wall or another piece. dv = how hard (its
  // change of speed, m/s), size = piece size (m), mat = { firm, wet,
  // creamy, sugar, ice } each 0..1, pan = -1..1. Soft bumps stay silent;
  // jelly gets a wet slap with a short "plop", gummy a rubbery bonk, frozen
  // pieces a glassy clack. No sub-bass thuds.
  impact(dv, size = 1, mat = {}, pan = 0, note = 0) {
    if (!this.ctx || this.muted || this.impactLevel <= 0) return;
    const a = Math.min(1, Math.max(0, (dv - 0.9) / 4));
    let loud = Math.pow(a, 1.4) * this.impactLevel * 1.3;
    if (loud < 0.006) return;
    if (!this._bucket('impact', 7, 3)) return;
    const t = this.ctx.currentTime + 0.002;
    const out = this._panned(pan);
    // (tuned: its note rung - and less of the slap, the more it's a xylophone)
    const N = this.notesLevel;
    if (N > 0.01 && note > 0) {
      this._note(t, note, Math.min(1, 0.25 + a) * this.impactLevel, mat, out);
      loud *= 1 - 0.75 * N;
      if (loud < 0.006) return;
    }
    const firm = mat.firm || 0, wet = mat.wet ?? 1, creamy = mat.creamy || 0;
    const pitch = Math.pow(1 / Math.min(1.6, Math.max(0.06, size)), 0.45) * rnd(0.93, 1.07);
    if ((mat.ice || 0) > 0.5) {
      const f = 1700 * pitch;
      this._tone(t, 'sine', f, f * 0.985, 0.05 + 0.05 * a, 0.16 * loud, 0.0008, out);
      this._tone(t, 'sine', f * 2.33, f * 2.3, 0.035, 0.08 * loud, 0.0008, out);
      this._noise(t, 0.012, 'highpass', 4800, 4800, 0.7, 0.18 * loud, 0.0005, out);
      this._tone(t, 'triangle', 380 * pitch, 240 * pitch, 0.05, 0.14 * loud, 0.001, out);
      return;
    }
    // the slap: a short, wet broadband burst (muffled for creamy jelly)
    const fc = (1250 + 900 * firm) * (1 - 0.45 * creamy) * Math.sqrt(pitch);
    this._noise(t, 0.035 + 0.04 * a, 'bandpass', fc * 1.7, fc * 0.55, 0.55, 1.1 * loud, 0.001, out);
    this._noise(t, 0.008, 'highpass', 3200, 3200, 0.7, 0.25 * loud * wet, 0.0004, out);
    // the body: a quick, quiet low-mid plop, firmer = higher and a touch longer
    const f0 = (170 + 130 * firm) * pitch;
    this._tone(t, 'sine', f0 * 1.3, f0 * 0.8, 0.05 + 0.04 * a + 0.05 * firm, 0.16 * loud, 0.002, out);
    if (firm > 0.35) this._tone(t, 'triangle', f0 * 2.05, f0 * 1.92, 0.045 + 0.05 * firm, 0.12 * loud * firm, 0.002, out);
    // the squelch: a few tiny wet grains just after
    const grains = Math.round((1 + 3 * a) * wet);
    for (let i = 0; i < grains; i++) {
      const f = rnd(900, 2500) * Math.sqrt(pitch) * (1 - 0.35 * creamy);
      this._noise(t + rnd(0.012, 0.05 + 0.08 * a), rnd(0.012, 0.03), 'bandpass', f, f * rnd(0.6, 0.9), rnd(6, 12), 0.2 * loud * wet, 0.001, out);
    }
    // sugar crust: a little crunch
    if ((mat.sugar || 0) > 0.3) {
      for (let i = 0; i < 3; i++) {
        const f = rnd(3500, 7000);
        this._noise(t + rnd(0, 0.03), rnd(0.004, 0.01), 'bandpass', f, f, 2.5, 0.12 * loud, 0.0005, out);
      }
    }
  }

  // A piece's note, rung (a tap, see App.ringNote): amount 0..1
  note(f, amount = 0.6, mat = {}, pan = 0) {
    if (!this.ctx || this.muted || !(this.notesLevel > 0.01) || !this._bucket('note', 12, 4)) return;
    this._note(this.ctx.currentTime + 0.002, f, amount * Math.max(0.35, this.impactLevel), mat, this._panned(pan));
  }

  // The note itself: firm jelly a bell - long, its partials stretched (2.76, 5.4); softer a marimba's knock (the
  // fourth harmonic, short); soft a round bonk, a little sharp as it's struck; creamy duller, frozen glassier -
  // and the mallet's click
  _note(t, f, g, mat, out) {
    const N = this.notesLevel, firm = Math.min(1, Math.max(0, mat.firm || 0)), creamy = mat.creamy || 0, ice = (mat.ice || 0) > 0.5;
    const v = g * (0.45 + 0.55 * N), ring = ice ? 1.8 : (0.3 + 1.3 * firm) * (1 - 0.45 * creamy);
    this._tone(t, 'sine', f * (1.012 + 0.035 * (1 - firm)), f, ring, 0.42 * v, 0.002, out);
    if (ice || firm > 0.55) {
      this._tone(t, 'sine', f * 2.76, f * 2.75, ring * 0.55, 0.16 * v * (ice ? 1 : firm), 0.001, out);
      this._tone(t, 'sine', f * 5.4, f * 5.38, ring * 0.28, 0.07 * v, 0.001, out);
    } else this._tone(t, 'sine', f * 4, f * 3.98, ring * 0.3, 0.14 * v * (0.35 + firm), 0.001, out);
    if (firm < 0.3) this._tone(t, 'triangle', f * 0.5, f * 0.49, 0.12, 0.08 * v, 0.003, out);
    const fc = Math.min(6500, f * 6);
    this._noise(t, 0.012, 'bandpass', fc, fc, 1.4, 0.1 * v * (1 - 0.6 * creamy), 0.0005, out);
  }

  // a droplet lands: a tiny plink, never a squelch
  drip(speed, size = 0.01, pan = 0) {
    if (!this.ctx || this.muted || this.impactLevel <= 0) return;
    const a = Math.min(1, Math.max(0, (speed - 1.5) / 6));
    if (a <= 0 || !this._bucket('drip', 5, 2)) return;
    const t = this.ctx.currentTime;
    const out = this._panned(pan);
    const f = rnd(900, 1500) * Math.pow(0.012 / Math.max(0.004, size), 0.4);
    const g = (0.035 + 0.05 * a) * this.impactLevel;
    this._tone(t, 'sine', f, f * 1.7, 0.05, g, 0.001, out);
    this._noise(t, 0.008, 'bandpass', 2600, 2600, 3, g * 0.5, 0.0005, out);
  }

  // A bubble bursting at the top of a snow globe's water: a tiny bright 'plip' - the smaller, the higher - and
  // a breath of a click (see Bubbles.tick)
  bubble(size = 0.006, pan = 0) {
    if (!this.ctx || this.muted || this.impactLevel <= 0 || !this._bucket('bubble', 6, 3)) return;
    const t = this.ctx.currentTime, out = this._panned(pan);
    const f = rnd(1300, 1900) * Math.pow(0.006 / Math.max(0.002, size), 0.35), g = 0.03 * this.impactLevel;
    this._tone(t, 'sine', f, f * 1.9, 0.035, g, 0.001, out);
    this._noise(t, 0.006, 'bandpass', 3800, 3800, 4, g * 0.35, 0.0005, out);
  }

  // big wet splat (bombs)
  splat(amount = 0.5) {
    if (!this._ok('splat', 0.09)) return;
    const t = this.ctx.currentTime;
    const a = Math.min(1, amount);
    this._noise(t, 0.12, 'bandpass', 1800, 500, 0.8, 0.5 * a);
    this._tone(t, 'sine', 210, 120, 0.14, 0.32 * a);
    for (let i = 0; i < 7; i++) {
      const f = rnd(700, 2400);
      this._noise(t + rnd(0.01, 0.14), rnd(0.02, 0.05), 'bandpass', f, f * 0.7, 8, 0.2 * a);
    }
  }

  whoosh(amount = 0.5) {
    if (!this._ok('whoosh', 0.2)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.28, 'bandpass', 400, 1600, 1.2, 0.25 * amount, 0.08);
  }

  swish(amount = 0.5) {
    if (!this._ok('swish', 0.08)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.16, 'highpass', 2500, 6500, 0.8, 0.22 * amount, 0.02);
  }

  slice(amount = 1) {
    if (!this._ok('slice', 0.05)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.2, 'highpass', 1800, 7000, 0.9, 0.3, 0.01);
    this._noise(t + 0.02, 0.12, 'bandpass', 900, 2600, 6, 0.25);
    for (let i = 0; i < 6; i++) {
      const f = rnd(700, 2600);
      this._noise(t + 0.05 + rnd(0, 0.12), rnd(0.02, 0.05), 'bandpass', f, f * 0.6, 9, 0.2 * amount);
    }
    this._tone(t + 0.06, 'sine', 180, 70, 0.15, 0.25 * amount);
  }

  nailgun() {
    if (!this._ok('nailgun', 0.04)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.07, 'highpass', 1800, 900, 0.7, 0.4, 0.001);
    this._tone(t, 'square', 3200, 1800, 0.012, 0.12, 0.0005);
    this._tone(t, 'sine', 150, 60, 0.07, 0.5, 0.001);
    this._noise(t + 0.01, 0.09, 'bandpass', 500, 300, 2, 0.18);
  }

  // The hole gun: a sharp crack with a low punch under it and a short tail;
  // into jelly, a wet thwup on top (hit 0..1: how much it went through).
  // full auto: one round - short and punchy (fourteen a second mustn't
  // turn to mush), a smack if it hits jelly
  autoshot(hit = 0, pan = 0) {
    if (!this._ok('autoshot', 0.045)) return;
    const t = this.ctx.currentTime, out = this._panned(pan);
    this._noise(t, 0.028, 'highpass', 2200, 1200, 0.7, 0.5, 0.0004, out);
    this._tone(t, 'sine', 140, 48, 0.07, 0.5, 0.001, out);
    this._noise(t + 0.008, 0.07, 'bandpass', 900, 300, 1, 0.12, 0.004, out);
    if (hit > 0) this._noise(t + 0.01, 0.05, 'bandpass', 1300, 420, 2.4, 0.22 * hit, 0.003, out);
  }

  // its barrels' motor: a whine that follows how fast they spin (0..1)
  spin(speed) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this._spin) {
      if (speed <= 0.01) return;
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth';
      f.type = 'lowpass';
      f.frequency.value = 900;
      g.gain.value = 0.0001;
      o.connect(f).connect(g).connect(this.bus);
      o.start();
      this._spin = { o, f, g };
    }
    const S = this._spin, t = ctx.currentTime;
    S.o.frequency.setTargetAtTime(55 + 240 * speed, t, 0.03);
    S.f.frequency.setTargetAtTime(500 + 1600 * speed, t, 0.03);
    S.g.gain.setTargetAtTime(this.muted ? 0 : 0.045 * speed, t, 0.04);
    if (speed <= 0.01) {
      S.g.gain.setTargetAtTime(0.0001, t, 0.05);
      setTimeout(() => {
        try {
          S.o.stop();
        } catch (e) {
          /* already stopped */
        }
      }, 300);
      this._spin = null;
    }
  }

  gunshot(hit = 0) {
    if (!this._ok('gunshot', 0.08)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.045, 'highpass', 2600, 1400, 0.7, 0.75, 0.0005);
    this._tone(t, 'square', 2400, 900, 0.01, 0.12, 0.0003);
    this._tone(t, 'sine', 120, 42, 0.12, 0.7, 0.001);
    this._noise(t + 0.02, 0.22, 'bandpass', 700, 260, 1.2, 0.16, 0.01);
    if (hit > 0) {
      this._tone(t + 0.012, 'sine', 210, 85, 0.13, 0.4 * hit, 0.003);
      this._noise(t + 0.012, 0.09, 'bandpass', 1200, 380, 2.2, 0.32 * hit, 0.004);
    }
  }

  nailHit(amount = 1) {
    if (!this._ok('nailhit', 0.03)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 320, 110, 0.07, 0.35 * amount);
    this._noise(t, 0.05, 'bandpass', 1600, 700, 7, 0.3 * amount);
  }

  // pan for a world position (the app sets panFn from its camera)
  _panOf(p) {
    return p && this.panFn ? this.panFn(p) : 0;
  }

  // metal on the floor; `at` = world position (for panning)
  clink(amount = 0.6, at = null) {
    if (!this._ok('clink', 0.035)) return;
    amount *= Math.min(1, this.impactLevel * 1.8);
    if (amount < 0.02) return;
    const t = this.ctx.currentTime;
    const out = this._panned(this._panOf(at));
    const base = rnd(1700, 2700);
    const ratios = [1, 2.76, 5.4, 8.93];
    const nyq = this.ctx.sampleRate * 0.45;
    ratios.forEach((r, i) => {
      if (base * r < nyq) this._tone(t, 'sine', base * r, base * r * 0.995, 0.25 / (i + 1) + 0.05, (0.12 * amount) / (i + 1), 0.0008, out);
    });
    this._noise(t, 0.015, 'highpass', 5000, 5000, 0.7, 0.12 * amount, 0.0005, out);
  }

  // resonance: the jelly sings a note, warmer and longer as it builds
  ring(freq, level = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + 0.01;
    const dur = 0.5 + 0.6 * level, g = 0.05 + 0.07 * level;
    this._tone(t, 'sine', freq, freq * 1.004, dur, g, 0.006);
    this._tone(t, 'sine', freq * 2, freq * 2.01, dur * 0.5, g * 0.35, 0.004);
    this._tone(t, 'triangle', freq * 0.5, freq * 0.5, dur * 0.7, g * 0.3, 0.01);
    // a little wobble in the note: the jelly's own vibrato
    this._tone(t + 0.02, 'sine', freq * 1.012, freq * 0.996, dur * 0.8, g * 0.25, 0.03);
  }

  // the resonance bursts: a bright rising chord over the splash
  resonate() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [392.0, 493.88, 587.33, 783.99, 987.77, 1174.66].forEach((f, i) => {
      this._tone(t + i * 0.035, 'sine', f, f * 1.002, 1.4, 0.06, 0.004);
      this._tone(t + i * 0.035, 'triangle', f * 2, f * 2, 0.5, 0.012, 0.004);
    });
    this._noise(t, 0.9, 'bandpass', 600, 4200, 1.1, 0.08, 0.05);
  }

  // a nail sucked out of the jelly: wet suction pop, rising
  unplug(amount = 1, at = null) {
    if (!this._ok('unplug', 0.05)) return;
    const t = this.ctx.currentTime;
    const out = this._panned(this._panOf(at));
    this._tone(t, 'sine', 240, 820, 0.07, 0.22 * amount, 0.002, out);
    this._noise(t, 0.05, 'bandpass', 900, 2600, 3, 0.22 * amount, 0.001, out);
    for (let i = 0; i < 3; i++) {
      const f = rnd(1200, 2600);
      this._noise(t + rnd(0.02, 0.09), rnd(0.01, 0.025), 'bandpass', f, f * 0.7, 9, 0.12 * amount, 0.001, out);
    }
  }

  pop(amount = 0.6) {
    if (!this._ok('pop', 0.04)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 380, 1100, 0.05, 0.3 * amount);
    this._noise(t, 0.03, 'bandpass', 2400, 1800, 4, 0.2 * amount);
  }

  // mallet: a wooden knock with a wet smack
  thud(amount = 1) {
    if (!this._ok('thud', 0.08)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'triangle', 330, 190, 0.06, 0.32 * amount, 0.001);
    this._tone(t, 'sine', 150, 85, 0.13, 0.4 * amount, 0.002);
    this._noise(t, 0.05, 'bandpass', 1500, 700, 1, 0.4 * amount);
    this._noise(t, 0.012, 'highpass', 3500, 3500, 0.7, 0.22 * amount, 0.0005);
    this.squish(amount * 0.8, 1);
  }

  crack(amount = 1) {
    if (!this._ok('crack', 0.05)) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 9; i++) {
      const f = rnd(1800, 7000);
      this._noise(t + rnd(0, 0.18) * i * 0.2, rnd(0.01, 0.05), 'bandpass', f, f * rnd(0.7, 1.3), rnd(2, 8), 0.4 * amount);
    }
    this._tone(t, 'triangle', 900, 300, 0.12, 0.2 * amount);
    this._noise(t, 0.4, 'highpass', 3000, 9000, 0.5, 0.15 * amount, 0.002);
  }

  // a knock on a pane of the glass room: a short low ring of glass, a soft thump
  glassKnock(amount = 0.5, pan = 0) {
    if (!this._ok('glassKnock', 0.06)) return;
    amount *= Math.min(1, this.impactLevel * 1.8);
    if (amount < 0.03) return;
    const t = this.ctx.currentTime;
    const out = this._panned(pan);
    const f = rnd(560, 760), nyq = this.ctx.sampleRate * 0.45;
    for (const [r, g, d] of [[1, 1, 0.22], [2.32, 0.45, 0.14], [4.25, 0.2, 0.09], [6.8, 0.08, 0.05]]) if (f * r < nyq) this._tone(t, 'sine', f * r, f * r * 0.997, d, 0.11 * amount * g, 0.001, out);
    this._noise(t, 0.05, 'lowpass', 900, 300, 0.7, 0.22 * amount, 0.001, out);
  }

  // glass (and hard candy) breaking: a bright crash, then the shards
  // tinkling down - little glass bells, each a few partials, falling
  // later and later (delay: when the tinkling starts)
  shatterGlass(amount = 1, delay = 0, key = 'glass') {
    if (!this._ok(key, 0.08)) return;
    const t = this.ctx.currentTime + delay;
    this._noise(t, 0.3, 'highpass', 2600, 7400, 0.6, 0.34 * amount, 0.0008);
    this._noise(t, 0.06, 'bandpass', 4300, 2900, 1.3, 0.3 * amount, 0.0005);
    this._tone(t, 'triangle', 1400, 520, 0.08, 0.12 * amount, 0.001);
    const nyq = this.ctx.sampleRate * 0.45;
    for (let i = 0; i < 18; i++) {
      const f = rnd(2300, 7800), at = t + 0.025 + Math.pow(Math.random(), 1.7) * 0.6, dur = rnd(0.05, 0.18);
      const g = (0.055 * amount) * (1 - 0.5 * ((at - t) / 0.65));
      for (const [r, k] of [[1, 1], [2.76, 0.38], [5.4, 0.16]]) if (f * r < nyq) this._tone(at, 'sine', f * r, f * r * 0.996, dur / Math.sqrt(r), g * k, 0.0006);
    }
  }

  boom(amount = 1) {
    if (!this._ok('boom', 0.1)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3.5);
    }
    shaper.curve = curve;
    shaper.connect(this.bus);
    this._noise(t, 0.9, 'lowpass', 2400, 120, 0.8, 0.9 * amount, 0.001, shaper);
    this._tone(t, 'sine', 70, 28, 0.8, 1.0 * amount, 0.002, shaper);
    this._noise(t, 0.06, 'highpass', 3000, 2000, 0.7, 0.5 * amount, 0.0005);
    for (let i = 0; i < 10; i++) {
      const f = rnd(800, 3000);
      this._noise(t + rnd(0.1, 0.7), rnd(0.02, 0.05), 'bandpass', f, f * 0.7, 8, 0.12 * amount);
    }
  }

  // continuous loops (torch, freeze spray, fuse sizzle, pump)
  loop(name, on, params = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    let L = this.loops[name];
    if (on && !L) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = params.type || 'bandpass';
      f.frequency.value = params.freq || 800;
      f.Q.value = params.q || 0.7;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      src.connect(f).connect(g).connect(this.bus);
      src.start();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = params.lfo || 9;
      const lg = ctx.createGain();
      lg.gain.value = (params.gain || 0.3) * (params.flicker || 0.25);
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      L = this.loops[name] = { src, f, g, lfo, params };
      g.gain.setTargetAtTime(this.muted ? 0 : params.gain || 0.3, ctx.currentTime, 0.04);
    } else if (!on && L) {
      L.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
      const l = L;
      setTimeout(() => {
        try {
          l.src.stop();
          l.lfo.stop();
        } catch (e) {
          /* already stopped */
        }
      }, 400);
      delete this.loops[name];
    }
  }

  loopLevel(name, level) {
    const L = this.loops[name];
    if (!L || !this.ctx) return;
    L.g.gain.setTargetAtTime(this.muted ? 0 : (L.params.gain || 0.3) * level, this.ctx.currentTime, 0.05);
  }

  sizzle(amount = 0.5) {
    if (!this._ok('sizzle', 0.03)) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const f = rnd(3000, 8000);
      this._noise(t + rnd(0, 0.05), rnd(0.005, 0.02), 'bandpass', f, f, 3, 0.15 * amount, 0.0005);
    }
  }

  frostCrackle(amount = 0.5) {
    if (!this._ok('frost', 0.05)) return;
    const t = this.ctx.currentTime;
    const f = rnd(2500, 6000);
    this._noise(t, rnd(0.008, 0.02), 'bandpass', f, f * 1.2, 6, 0.25 * amount, 0.0005);
  }

  schlorp(amount = 1) {
    if (!this._ok('schlorp', 0.1)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.3, 'bandpass', 300, 1500, 7, 0.5 * amount, 0.02);
    this._tone(t + 0.18, 'sine', 300, 900, 0.07, 0.35 * amount);
    this.squish(amount * 0.8, 0.9);
  }

  squeak(amount = 0.5) {
    if (!this._ok('squeak', 0.12)) return;
    const t = this.ctx.currentTime;
    const o = this._tone(t, 'triangle', rnd(700, 900), rnd(1000, 1300), 0.12, 0.08 * amount, 0.02);
    void o;
    this._noise(t, 0.14, 'highpass', 4000, 6000, 0.7, 0.06 * amount, 0.02);
  }

  zap(amount = 0.6) {
    if (!this._ok('zap', 0.05)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sawtooth', 120, 60, 0.12, 0.08 * amount);
    this._tone(t, 'sine', 2400, 1800, 0.08, 0.06 * amount);
  }

  healStart() {
    if (!this._ok('heal', 0.3)) return;
    const t = this.ctx.currentTime;
    // a slow, airy rise while the pieces loosen and spread out
    const notes = [392.0, 523.25, 659.25, 783.99, 987.77];
    notes.forEach((f, i) => {
      this._tone(t + i * 0.16, 'sine', f, f * 1.003, 1.8, 0.055, 0.12);
      this._tone(t + i * 0.16, 'triangle', f * 2, f * 2, 0.7, 0.01, 0.05);
    });
    this._noise(t, 1.4, 'bandpass', 250, 1200, 1.2, 0.07, 0.7);
  }

  healGather() {
    if (!this._ok('gather', 0.3)) return;
    const t = this.ctx.currentTime;
    // the pieces draw together: a swelling sweep into a bright chord
    this._noise(t, 0.95, 'bandpass', 500, 5200, 1.4, 0.11, 0.8);
    [1046.5, 1318.5, 1568].forEach((f, i) => this._tone(t + 0.35 + i * 0.09, 'sine', f, f * 1.002, 1.2, 0.04, 0.25));
  }

  healFuse() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 140, 70, 0.35, 0.55);
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this._tone(t + 0.02 * i, 'sine', f, f, 1.6, 0.06, 0.005));
    this.squish(0.7, 0.85);
  }

  // The dicer. A blade going through: a bright steel "shing" with a ring
  // like a struck knife over a wet chop (k: the blades before it, each a
  // semitone up, so a run of them climbs). at: when (audio clock).
  diceShink(k = 0, at = 0) {
    if (!this.ctx || this.muted) return;
    const t = Math.max(this.ctx.currentTime, at), up = Math.pow(2, k / 12);
    this._noise(t, 0.05, 'highpass', 6500, 9500, 0.7, 0.42, 0.0008);
    this._noise(t, 0.2, 'bandpass', 2600 * up, 8200 * up, 5, 0.3, 0.004);
    for (const [m, g, d] of [[1, 0.07, 0.55], [1.47, 0.048, 0.42], [2.09, 0.034, 0.32], [2.56, 0.026, 0.26]]) {
      this._tone(t, 'sine', 1750 * up * m, 1750 * up * m * 0.996, d, g, 0.002);
    }
    this._tone(t + 0.008, 'sine', 170, 58, 0.12, 0.24, 0.002);
    this._noise(t + 0.006, 0.07, 'bandpass', 900, 380, 1.5, 0.16, 0.002);
  }

  // the blade frame bottoming out: a deep thunk and a steel clank
  diceSlam(at = 0) {
    if (!this.ctx || this.muted) return;
    const t = Math.max(this.ctx.currentTime, at);
    this._tone(t, 'sine', 96, 36, 0.3, 0.55, 0.002);
    this._noise(t, 0.12, 'lowpass', 1800, 180, 0.8, 0.45, 0.001);
    for (const [f, g, d] of [[620, 0.055, 0.4], [933, 0.045, 0.32], [1414, 0.032, 0.26], [2290, 0.02, 0.2]]) this._tone(t, 'triangle', f, f * 0.99, d, g, 0.001);
  }

  // swung round for the second pass
  diceWhoosh(at = 0) {
    if (!this.ctx || this.muted) return;
    const t = Math.max(this.ctx.currentTime, at);
    this._noise(t, 0.26, 'bandpass', 450, 2600, 1.6, 0.2, 0.09);
  }

  // ...and it all falls apart into cubes: a distorted sub drop, a crunch,
  // a sparkle running up, and a patter of wet little landings
  diceDrop(at = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = Math.max(ctx.currentTime, at);
    if (!this._diceShaper || this._diceShaper.context !== ctx) {
      const sh = ctx.createWaveShaper(), curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 3);
      sh.curve = curve;
      sh.connect(this.bus);
      this._diceShaper = sh;
    }
    this._tone(t, 'sine', 150, 30, 0.8, 0.85, 0.003, this._diceShaper);
    this._noise(t, 0.32, 'lowpass', 3200, 160, 0.7, 0.55, 0.001, this._diceShaper);
    this._noise(t, 0.05, 'highpass', 4000, 6000, 0.7, 0.3, 0.0005);
    [1568, 2093, 2637, 3136, 4186].forEach((f, i) => this._tone(t + 0.04 + i * 0.04, 'triangle', f, f, 0.42, 0.03, 0.003));
    for (let i = 0; i < 9; i++) {
      const f = rnd(500, 1500);
      this._noise(t + 0.12 + rnd(0, 0.5), rnd(0.03, 0.07), 'bandpass', f, f * 0.55, 6, 0.12);
      this._tone(t + 0.12 + rnd(0, 0.5), 'sine', rnd(240, 420), rnd(90, 140), 0.08, 0.06, 0.002);
    }
  }

  // the cube cuber: a square scoop pops a cube out
  cubePop(amount = 1) {
    if (!this._ok('cubePop', 0.1)) return;
    const t = this.ctx.currentTime;
    this.schlorp(amount);
    this._tone(t + 0.07, 'square', 520, 1040, 0.07, 0.035 * amount, 0.002);
    this._tone(t + 0.07, 'sine', 380, 900, 0.09, 0.12 * amount, 0.002);
  }

  // Character select: the cube on show slurped up and away...
  swapOut() {
    if (!this._ok('swapOut', 0.2)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.5, 'bandpass', 300, 3200, 2.2, 0.2, 0.12);
    this._tone(t, 'sine', 160, 980, 0.42, 0.15, 0.05);
    this._tone(t + 0.05, 'triangle', 320, 1960, 0.36, 0.035, 0.05);
    this.squish(0.6, 1.3);
  }

  // ...the new one whistling down...
  swapIn() {
    if (!this._ok('swapIn', 0.2)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 1500, 420, 0.5, 0.055, 0.08);
    this._noise(t, 0.45, 'bandpass', 2600, 700, 3, 0.06, 0.2);
  }

  // ...and up goes its card: a quick fanfare
  stinger() {
    if (!this._ok('stinger', 0.5)) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this._tone(t + i * 0.07, 'square', f, f, 0.12, 0.03, 0.004);
      this._tone(t + i * 0.07, 'triangle', f / 2, f / 2, 0.14, 0.05, 0.004);
    });
    [1046.5, 1318.5, 1568].forEach((f) => this._tone(t + 0.3, 'triangle', f, f, 0.7, 0.035, 0.01));
    this._tone(t + 0.3, 'sine', 130.8, 65.4, 0.4, 0.18, 0.005);
  }

  // a cubiplied child that came out as something new: a fanfare - a run up
  // the scale, little bells over it; a legend's longer, ending on a chord
  fanfare(tier = 2) {
    if (!this._ok('fanfare', 0.6)) return;
    const t = this.ctx.currentTime;
    const notes = tier >= 3 ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093] : [587.33, 739.99, 880, 1174.66];
    notes.forEach((f, i) => {
      this._tone(t + i * 0.06, 'triangle', f, f, 0.5, 0.045, 0.004);
      this._tone(t + i * 0.06, 'sine', f * 2, f * 2, 0.35, 0.018, 0.002);
    });
    for (let k = 0; k < (tier >= 3 ? 14 : 8); k++) {
      const f = 2000 + Math.random() * 3000;
      this._tone(t + 0.15 + k * 0.045, 'sine', f, f * 1.01, 0.18, 0.012, 0.002);
    }
    if (tier >= 3) [261.63, 329.63, 392, 523.25].forEach((f) => this._tone(t + notes.length * 0.06, 'triangle', f, f, 1.3, 0.035, 0.02));
  }

  // a stat bar filling, a step up the scale each
  tick(step = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, f = 880 * Math.pow(2, step / 12);
    this._tone(t, 'square', f, f, 0.035, 0.016, 0.001);
  }

  // (a re-cube's: the powder on it blown off - a soft breathy poof)
  puff(amount = 0.6) {
    if (!this._ok('puff', 0.2)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.32, 'lowpass', 2400, 380, 0.7, 0.24 * amount, 0.012);
    this._noise(t + 0.02, 0.16, 'bandpass', 900, 500, 1.2, 0.12 * amount, 0.006);
  }

  // Googly eyes (see Eyes): one stuck on, a little tacky press; its pupil
  // rattling round its dome, a tiny plastic tick (at: where, for panning);
  // one peeled off, a sticky unpeel.
  eyeStick(amount = 1) {
    if (!this._ok('eyeStick', 0.03)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 520, 210, 0.07, 0.22 * amount, 0.002);
    this._noise(t, 0.03, 'bandpass', 1800, 900, 3, 0.16 * amount, 0.001);
  }

  eyeRattle(amount = 0.5, at = null) {
    if (!this._ok('eyeRattle', 0.025)) return;
    amount *= Math.min(1, this.impactLevel * 1.8);
    if (amount < 0.02) return;
    const t = this.ctx.currentTime, out = this._panned(this._panOf(at)), f = rnd(3200, 5200);
    this._tone(t, 'triangle', f, f * 0.92, 0.018, 0.07 * amount, 0.0005, out);
    this._noise(t, 0.008, 'highpass', 6000, 6000, 0.7, 0.06 * amount, 0.0004, out);
  }

  // (a re-cube's: one sucked back onto the cube - a slurp, then a thwop)
  eyeSuck(amount = 1) {
    if (!this._ok('eyeSuck', 0.035)) return;
    const t = this.ctx.currentTime, f = rnd(0.85, 1.2);
    this._noise(t, 0.05, 'bandpass', 2600 * f, 700 * f, 4, 0.16 * amount, 0.002);
    this._tone(t + 0.035, 'sine', 720 * f, 170 * f, 0.075, 0.26 * amount, 0.002);
  }

  eyePeel(amount = 1) {
    if (!this._ok('eyePeel', 0.05)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.09, 'bandpass', 700, 2600, 2.5, 0.2 * amount, 0.004);
    this._tone(t + 0.06, 'sine', 300, 900, 0.05, 0.14 * amount, 0.002);
  }

  ui() {
    if (!this._ok('ui', 0.03)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 1400, 1100, 0.04, 0.05, 0.002);
  }
}
