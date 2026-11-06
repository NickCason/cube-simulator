// Procedural sound design (WebAudio): every sound is synthesized, nothing
// is downloaded. Wet jelly squelches are built from bursts of resonant
// band-passed noise grains over pitch-dropping "bloops".

const rnd = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = {};
    this.loops = {};
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
    this.master.gain.value = this.muted ? 0 : 0.9;
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

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
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
    this._tone(t, 'sine', 210 * pitch, 85 * pitch, 0.14 + a * 0.08, 0.35 * a + 0.08);
  }

  poke(amount = 0.6) {
    if (!this._ok('poke', 0.05)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 260, 120, 0.11, 0.45 * amount);
    this._noise(t, 0.05, 'bandpass', 1400, 600, 5, 0.25 * amount);
    this.squish(amount * 0.6, 1.2);
  }

  splat(amount = 0.5) {
    if (!this._ok('splat', 0.09)) return;
    const t = this.ctx.currentTime;
    const a = Math.min(1, amount);
    this._tone(t, 'sine', 120, 48, 0.16, 0.5 * a + 0.05);
    this._noise(t, 0.09, 'lowpass', 1800, 300, 1, 0.3 * a);
    for (let i = 0; i < 4; i++) {
      const f = rnd(600, 2200);
      this._noise(t + rnd(0.0, 0.06), rnd(0.02, 0.05), 'bandpass', f, f * 0.7, 8, 0.22 * a);
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

  clink(amount = 0.6) {
    if (!this._ok('clink', 0.035)) return;
    const t = this.ctx.currentTime;
    const base = rnd(1700, 2700);
    const ratios = [1, 2.76, 5.4, 8.93];
    const nyq = this.ctx.sampleRate * 0.45;
    ratios.forEach((r, i) => {
      if (base * r < nyq) this._tone(t, 'sine', base * r, base * r * 0.995, 0.25 / (i + 1) + 0.05, (0.14 * amount) / (i + 1), 0.0008);
    });
    this._noise(t, 0.015, 'highpass', 5000, 5000, 0.7, 0.15 * amount, 0.0005);
  }

  pop(amount = 0.6) {
    if (!this._ok('pop', 0.04)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 380, 1100, 0.05, 0.3 * amount);
    this._noise(t, 0.03, 'bandpass', 2400, 1800, 4, 0.2 * amount);
  }

  thud(amount = 1) {
    if (!this._ok('thud', 0.08)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sine', 95, 38, 0.28, 0.8 * amount, 0.002);
    this._noise(t, 0.12, 'lowpass', 900, 200, 1, 0.5 * amount);
    this._noise(t, 0.03, 'bandpass', 2600, 1600, 3, 0.25 * amount);
    this.squish(amount, 0.8);
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
    const notes = [523.25, 659.25, 783.99, 987.77, 1174.66, 1567.98];
    notes.forEach((f, i) => {
      this._tone(t + i * 0.07, 'sine', f, f * 1.002, 1.2, 0.07, 0.03);
      this._tone(t + i * 0.07, 'triangle', f * 2, f * 2, 0.5, 0.015, 0.01);
    });
    this._noise(t, 1.3, 'bandpass', 300, 4000, 1.5, 0.12, 0.6);
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
