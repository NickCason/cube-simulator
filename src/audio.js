// Procedural sound design (WebAudio): every sound is synthesized, nothing
// is downloaded. Wet jelly squelches are built from bursts of resonant
// band-passed noise grains over pitch-dropping "bloops".

const rnd = (a, b) => a + Math.random() * (b - a);

const MASTER = 0.8;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.75; // master level (Settings > Sound)
    this.impactLevel = 0.55; // how loud bumps and landings are
    this.wobbleLevel = 0.5; // how loud the jelly's own hum is (see wobble)
    this.wob = []; // its voices
    this.last = {};
    this.loops = {};
    this.buckets = {};
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
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
    // shared noise
    const len = ctx.sampleRate * 2;
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    // small room reverb
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.4, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const c = ir.getChannelData(ch);
      for (let i = 0; i < c.length; i++) {
        const t = i / ctx.sampleRate;
        c[i] = (Math.random() * 2 - 1) * Math.exp(-t * 4.2) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(this.verb);
  }

  _masterGain() {
    return this.muted ? 0 : MASTER * this.volume * this.volume;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(this._masterGain(), this.ctx.currentTime, 0.05);
  }

  // Settings > Sound: overall volume, impact and wobble loudness, all 0..1
  setLevels(volume, impacts, wobble = this.wobbleLevel) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.impactLevel = Math.min(1, Math.max(0, impacts));
    this.wobbleLevel = Math.min(1, Math.max(0, wobble));
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

  // The jelly's own voice (see App._wobbleSounds): up to three held voices,
  // each following one piece from frame to frame - a soft triangle tone at
  // its wobble pitch through a low-pass (brighter the firmer), and a wet
  // band of noise above it - their levels set each frame from how hard the
  // piece jiggles. list: [{ id, f, amp, firm, wet, pan }].
  wobble(list) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime, k = this.muted ? 0 : this.wobbleLevel;
    for (const v of this.wob) v.used = false;
    for (const e of list) {
      let v = this.wob.find((w) => w.id === e.id);
      if (!v) v = this.wob.find((w) => !w.used && w.level < 0.003);
      if (!v && this.wob.length < 3) v = this._wobVoice();
      if (!v || v.used) continue;
      v.id = e.id;
      v.used = true;
      v.level = e.amp;
      v.osc.frequency.setTargetAtTime(e.f, now, 0.03);
      v.filt.frequency.setTargetAtTime(Math.min(8000, e.f * (2 + 3 * e.firm)), now, 0.05);
      v.nf.frequency.setTargetAtTime(Math.min(8000, e.f * 2.6), now, 0.05);
      v.g.gain.setTargetAtTime(e.amp * k, now, 0.015);
      v.ng.gain.setTargetAtTime(e.amp * e.wet * 0.45 * k, now, 0.015);
      if (v.pan) v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, e.pan)), now, 0.05);
    }
    for (const v of this.wob) {
      if (v.used) continue;
      v.level *= 0.6;
      v.g.gain.setTargetAtTime(0, now, 0.05);
      v.ng.gain.setTargetAtTime(0, now, 0.05);
    }
  }

  _wobVoice() {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const dest = pan || this.bus;
    if (pan) pan.connect(this.bus);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(filt).connect(g).connect(dest);
    const ns = ctx.createBufferSource();
    ns.buffer = this.noiseBuf;
    ns.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.Q.value = 2.2;
    const ng = ctx.createGain();
    ng.gain.value = 0;
    ns.connect(nf).connect(ng).connect(dest);
    osc.start();
    ns.start();
    const v = { osc, filt, g, ns, nf, ng, pan, id: -1, used: false, level: 0 };
    this.wob.push(v);
    return v;
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
  impact(dv, size = 1, mat = {}, pan = 0) {
    if (!this.ctx || this.muted || this.impactLevel <= 0) return;
    const a = Math.min(1, Math.max(0, (dv - 0.9) / 4));
    const loud = Math.pow(a, 1.4) * this.impactLevel * 1.3;
    if (loud < 0.006) return;
    if (!this._bucket('impact', 7, 3)) return;
    const t = this.ctx.currentTime + 0.002;
    const out = this._panned(pan);
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

  ui() {
    if (!this._ok('ui', 0.03)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 1400, 1100, 0.04, 0.05, 0.002);
  }
}
