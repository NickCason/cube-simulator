// Clips: a record button (top left, by the Cubby). Tap it and what's drawn
// is recorded, its sounds too, until it's tapped again (two minutes at most)
// - then a card to watch it back and share it (the system's share sheet:
// Photos, TikTok, Messages) or save it. Each frame drawn is copied into a
// picture of the clip's own (30 a second at most, its long side 1280 at
// most) with a small mark drawn in by the GPU - the logotype and where to
// play - so a clip that gets passed on brings people back.

import * as THREE from 'three';
import { mp4Facts, mp4Line } from './mp4facts.js';

const MAX_S = 120;
const FPS = 30;
const LONG = 1280; // (the clip's longer side, px, at most)
// (what the browser can make: Safari mp4, Chrome mp4 or webm)
const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
// (its ring fills as the time runs out - on a phone, all there's room for)
const RING = 2 * Math.PI * 8.5;
const REC_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring" cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle class="dot" cx="12" cy="12" r="4.6"/></svg>`;

export class Clips {
  constructor(ui, app) {
    this.app = app;
    this.ui = ui;
    this.rec = null;
    this.src = null; // the clip's own picture and its stream: see _source
    this.dest = null; // the sounds, as heard (made once)
    this._sound = false; // (the sounds going into it now)
    this.t0 = 0;
    this.url = '';
    this.file = null;
    this._tick = 0;
    this._wait = 0;
    this._n = 0; // (which recording this is: one that finishes late can't land in the next)
    this._mt = null;
    // (?stats: the last recording's own account - how many frames went in, the picture's size, the tracks'
    // say, what came out, and whether its picture keeps moving to the end: see _say, _check, diagLine)
    this.diag = null;
    // How the clip's picture is taken: 'copy' - each frame copied into a picture of the clip's own (its long
    // side 1280 at most) and sent when asked for: Chrome, Firefox - or 'gl' - the screen's own picture, as it's
    // shown, 30 a second: Safari, where a copied picture stopped coming after ~300 frames, every time (10 s
    // at 30 fps, 16 at 19 - the clip frozen from there). ?rec=copy|gl to choose; ?recsound=0, no sound.
    const q = new URLSearchParams(location.search), ua = navigator.userAgent;
    const webkit = (/AppleWebKit/.test(ua) && !/Chrome\/|Chromium|Edg\//.test(ua)) || /CriOS|FxiOS|EdgiOS/.test(ua);
    this.mode = q.get('rec') === 'copy' || q.get('rec') === 'gl' ? q.get('rec') : webkit ? 'gl' : 'copy';
    this.sound = q.get('recsound') !== '0';
    this.srcGL = null; // (the screen's own picture's stream: see _glSource)
    this.vtrack = null; // (the picture's track this recording)
    // (can't record here: no button)
    const cv = document.createElement('canvas');
    this.able = !!(cv.captureStream && window.MediaRecorder && window.MediaStream && TYPES.some((t) => MediaRecorder.isTypeSupported?.(t)));
    if (!this.able) return;
    ui.root.insertAdjacentHTML(
      'beforeend',
      `<button class="rec-btn" aria-label="Record a clip" title="Record a clip">${REC_ICON}<span class="rec-time"></span></button>
      <div class="modal clip-modal" hidden role="dialog" aria-modal="true" aria-labelledby="clip-title">
        <div class="modal-card clip-card">
          <h2 id="clip-title">Your clip</h2>
          <video class="clip-video" playsinline autoplay loop muted controls></video>
          <div class="modal-actions">
            <button class="soft clip-del">Delete</button>
            <a class="soft clip-save" download>Save</a>
            <button class="primary clip-share">Share</button>
          </div>
        </div>
      </div>`,
    );
    const root = ui.root;
    this.btn = root.querySelector('.rec-btn');
    this.timeEl = root.querySelector('.rec-time');
    this.ringEl = root.querySelector('.rec-btn .ring');
    this.modal = root.querySelector('.clip-modal');
    this.video = root.querySelector('.clip-video');
    this.saveEl = root.querySelector('.clip-save');
    this.shareEl = root.querySelector('.clip-share');
    this.btn.addEventListener('click', () => (this.rec ? this.stop() : this.start()));
    root.querySelector('.clip-del').addEventListener('click', () => this._close());
    this.shareEl.addEventListener('click', () => this._share());
    this.saveEl.addEventListener('click', () => this._say('saved'));
    this.modal.addEventListener('click', (e) => e.target === this.modal && this._close());
    window.addEventListener('keydown', (e) => e.key === 'Escape' && !this.modal.hidden && this._close());
  }

  get recording() {
    return !!this.rec;
  }

  // The clip's own picture, each frame copied into it, and its stream -
  // made once and kept, never stopped (a second recording on a canvas whose
  // first stream had been stopped never started on Safari). Frames only when
  // asked for where the browser can (nothing copied while not recording).
  _source() {
    if (this.src) return this.src;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 2;
    const g = cv.getContext('2d', { alpha: false });
    let track = cv.captureStream(0).getVideoTracks()[0];
    const manual = typeof track?.requestFrame === 'function';
    if (!manual) track = cv.captureStream(FPS).getVideoTracks()[0];
    return (this.src = { cv, g, track, manual, last: 0 });
  }

  // The screen's own picture's stream (mode 'gl'): taken by the browser as it's shown - the mark drawn into
  // it already (App._post) - made once and kept, its track off between recordings.
  _glSource() {
    if (this.srcGL) return this.srcGL;
    const track = this.app.renderer.domElement.captureStream(FPS).getVideoTracks()[0];
    return (this.srcGL = { track });
  }

  // after each frame's drawn (App.render, the mark on it): while recording,
  // a copy of it into the clip - 30 a second at most
  frame() {
    if (!this.rec) return;
    const gl = this.app.renderer.domElement;
    // (the screen's own picture: the browser takes it - nothing to copy)
    if (this.mode !== 'gl') {
      const S = this.src, now = performance.now();
      if (!S || now - S.last < 1000 / FPS - 4) return;
      S.last = now;
      S.g.drawImage(gl, 0, 0, S.cv.width, S.cv.height);
      if (S.manual) S.track.requestFrame();
    }
    const D = this.diag;
    if (D) {
      D.copies++;
      if (gl.width !== D.gw || gl.height !== D.gh) {
        D.gw = gl.width;
        D.gh = gl.height;
        this._event(`the screen's picture now ${gl.width}x${gl.height}`);
      }
    }
  }

  // (?stats: said in its log, and kept for the report's clip line)
  _say(text) {
    this.app.statsSay?.(`clip ${text}`);
  }

  _event(text) {
    const D = this.diag;
    if (D) D.events.push(`${((performance.now() - D.t0) / 1000).toFixed(1)} s ${text}`);
    this._say(text);
  }

  // the report's line: the last recording, start to what came out
  diagLine() {
    const D = this.diag;
    if (!D) return '';
    const secs = ((D.end || performance.now()) - D.t0) / 1000;
    return `clip (last): ${D.mode}, ${secs.toFixed(1)} s, ${D.copies} frames in (${(D.copies / Math.max(secs, 0.1)).toFixed(0)}/s), ${D.size} from ${D.from}, ${D.type || '?'}, frames ${D.manual ? 'asked for' : '30/s'}, sound ${D.sound}${D.events.length ? ` | ${D.events.slice(-6).join('; ')}` : ''}${D.file ? ` | made ${D.file}` : ''}${D.tracks ? ` | in the file: ${D.tracks}` : ''}${D.moved ? ` | picture moved, second by second: ${D.moved}` : ''}`;
  }

  // What came out, looked at (?stats): every second of it, a little picture - did it change since the one
  // before? (A clip whose frames stopped coming has the same one from there on: '0's.)
  async _check(blob) {
    const D = this.diag;
    // (and what's in the file itself, track by track: a picture that stops short of the sound, or has a gap, is
    // frames that never got into it - see mp4Facts)
    if (/mp4/.test(blob.type)) {
      let tracks;
      try {
        tracks = mp4Line(mp4Facts(await blob.arrayBuffer()));
      } catch (e) {
        tracks = `couldn't read it (${e?.message || e})`;
      }
      if (D) D.tracks = tracks;
      this._say(`in the file: ${tracks}`);
    }
    const url = URL.createObjectURL(blob), v = document.createElement('video');
    const once = (ev, ms) => new Promise((res) => {
      const t = setTimeout(() => res(false), ms);
      v.addEventListener(ev, () => (clearTimeout(t), res(true)), { once: true });
    });
    try {
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      // (on the page, tiny and all but invisible: a video off it isn't shown, its frames not told of)
      v.style.cssText = 'position:fixed;left:0;bottom:0;width:4px;height:4px;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.appendChild(v);
      v.src = url;
      const fail = (why) => {
        if (D) D.moved = `(${why})`;
        this._say(`check: ${why}`);
      };
      if (!(await once('loadedmetadata', 5000))) return fail('it would not load');
      let dur = v.duration;
      // (webm from MediaRecorder: its length unknown till it's looked at the end)
      if (!Number.isFinite(dur)) {
        v.currentTime = 1e6;
        await once('seeked', 4000);
        dur = v.duration;
      }
      if (!(dur > 0)) return fail('no length');
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d', { willReadFrequently: true });
      let prev = null, marks = '', lit = 0;
      // (a little picture of it now - and whether it's changed since the last one)
      const look = () => {
        g.drawImage(v, 0, 0, 32, 32);
        const px = g.getImageData(0, 0, 32, 32).data;
        let d = 0;
        for (let k = 0; k < px.length; k += 4) lit = Math.max(lit, px[k], px[k + 1], px[k + 2]);
        if (prev) for (let k = 0; k < px.length; k += 4) d = Math.max(d, Math.abs(px[k] - prev[k]), Math.abs(px[k + 1] - prev[k + 1]), Math.abs(px[k + 2] - prev[k + 2]));
        const m = prev ? (d > 1 ? '1' : '0') : '|';
        prev = px;
        return m;
      };
      // (each second's middle, sought out: one that won't come is a '?', not a '0' - played through
      // instead, headless Chrome showed too few of a video's frames to tell a held picture from a skipped one)
      // (four in a row that won't come: the rest won't either - '?'s, not 3 s more each)
      const n = Math.min(120, Math.ceil(dur));
      for (let i = 0, miss = 0; i < n; i++) {
        if (miss >= 4) {
          marks += '?';
          continue;
        }
        v.currentTime = Math.min(dur - 0.05, i + 0.5);
        const ok = await once('seeked', 3000);
        miss = ok ? 0 : miss + 1;
        marks += ok ? look() : '?';
      }
      // (every picture black: its frames couldn't be read here, not a clip of black)
      const note = lit < 4 ? ', but every picture read black - not a fair look' : '';
      if (D) D.moved = `${marks} (${dur.toFixed(1)} s long${note})`;
      this._say(`check: ${dur.toFixed(1)} s long; picture moved, second by second: ${marks}${note}`);
    } catch (e) {
      if (D) D.moved = `(failed: ${e?.message || e})`;
      this._say(`check failed: ${e?.message || e}`);
    } finally {
      v.removeAttribute('src');
      v.load?.();
      v.remove();
      URL.revokeObjectURL(url);
    }
  }

  start() {
    const app = this.app;
    if (this.rec || !this.able) return;
    try {
      // (the tap that starts it lets the sound start too)
      app.audio?.init?.();
      const gl = app.renderer.domElement, glMode = this.mode === 'gl';
      let w = gl.width, h = gl.height, manual = false;
      if (glMode) {
        this.vtrack = this._glSource().track;
        this.vtrack.enabled = true;
      } else {
        const S = this._source();
        // (its size: the screen's picture, its long side 1280 at most - even,
        // for the video encoder)
        const k = Math.min(1, LONG / Math.max(gl.width, gl.height, 1));
        w = Math.max(2, Math.round((gl.width * k) / 2) * 2);
        h = Math.max(2, Math.round((gl.height * k) / 2) * 2);
        if (S.cv.width !== w || S.cv.height !== h) (S.cv.width = w), (S.cv.height = h);
        S.last = 0;
        manual = S.manual;
        this.vtrack = S.track;
      }
      const tracks = [this.vtrack], A = app.audio, sst = A?.ctx?.state;
      // (its sounds as you hear them - none, muted; none while the phone has them stopped: an iPhone's
      // 'interrupted', after the app's been away - a clip with a sound track that never sent anything never
      // came out at all)
      if (this.sound && A?.ctx && A.out && (sst === 'running' || sst === 'suspended')) {
        try {
          this.dest ||= A.ctx.createMediaStreamDestination();
          A.out.connect(this.dest);
          this._sound = true;
          tracks.push(...this.dest.stream.getAudioTracks());
        } catch (e) {
          this._unhook();
        }
      }
      const stream = new MediaStream(tracks);
      let type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '', rec;
      try {
        rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5e6, audioBitsPerSecond: 128e3 });
      } catch (e) {
        rec = new MediaRecorder(stream);
        type = rec.mimeType || '';
      }
      // (each recording its own pieces: one that's still finishing can't
      // spill into the next)
      const chunks = [], n = ++this._n;
      rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
      rec.onstop = () => this._done(chunks, type, n);
      rec.onerror = (e) => {
        this._event(`recorder error ${e?.error?.name || ''}`);
        this.stop();
      };
      rec.start();
      this.rec = rec;
      this.diag = { mode: this.mode, t0: performance.now(), end: 0, copies: 0, copies0: 0, at: 0, gw: gl.width, gh: gl.height, from: `${gl.width}x${gl.height}`, size: `${w}x${h}`, type, manual, sound: tracks.length > 1 ? sst : this.sound && sst ? `${sst}, left out` : 'none', events: [], file: '', tracks: '', moved: '', over: false };
      const watch = (tr, name) => {
        tr.onmute = () => this._event(`${name} muted`);
        tr.onunmute = () => this._event(`${name} unmuted`);
        tr.onended = () => this._event(`${name} ended`);
      };
      watch(this.vtrack, 'picture track');
      for (const tr of tracks.slice(1)) watch(tr, 'sound track');
      this._say(`start (${this.mode}): ${type || '?'}, ${w}x${h} from the screen's ${gl.width}x${gl.height}, frames ${manual ? 'asked for' : '30/s'}, sound ${this.diag.sound}`);
    } catch (e) {
      console.warn('clip: could not start', e);
      this._unhook();
      this.rec = null;
      this.ui.hint?.("Couldn't start a recording here");
      return;
    }
    this.t0 = performance.now();
    app.markTex = this._markTexture();
    app.recording = true;
    this.btn.classList.add('on');
    this.btn.setAttribute('aria-label', 'Stop recording');
    this._tick = setInterval(() => this._time(), 250);
    this._time();
  }

  stop() {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    const D = this.diag;
    if (D) {
      D.end = performance.now();
      this._say(`stop at ${((D.end - D.t0) / 1000).toFixed(1)} s, ${D.copies} frames in`);
    }
    clearInterval(this._tick);
    if (this.srcGL) this.srcGL.track.enabled = false;
    this.app.recording = false;
    this.btn.classList.remove('on');
    this.btn.setAttribute('aria-label', 'Record a clip');
    this.timeEl.textContent = '';
    this.ringEl.style.strokeDashoffset = '';
    // (it says it's done - or, if it never does, it didn't come out)
    clearTimeout(this._wait);
    const n = this._n;
    this._wait = setTimeout(() => this._done([], '', n), 6000);
    try {
      if (rec.state !== 'inactive') rec.stop();
      else this._done([], '', n);
    } catch (e) {
      this._done([], '', n);
    }
  }

  _time() {
    const s = (performance.now() - this.t0) / 1000;
    if (s >= MAX_S) return this.stop();
    // (?stats: every 2 s, frames copied a second, the tracks, the sound, the recorder)
    const D = this.diag, V = this.vtrack;
    if (D && V && this.app.statsSay && s - D.at >= 2) {
      const n = D.copies - D.copies0, st = (tr) => `${tr.readyState}${tr.muted ? ' muted' : ''}${tr.enabled ? '' : ' off'}`;
      this._say(`${s.toFixed(1)} s: ${(n / (s - D.at)).toFixed(0)} frames/s in, picture track ${st(V)}, sound ${this.app.audio?.ctx?.state || 'none'}, recorder ${this.rec?.state}`);
      D.copies0 = D.copies;
      D.at = s;
    }
    this.timeEl.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    this.ringEl.style.strokeDashoffset = `${(RING * (1 - s / MAX_S)).toFixed(2)}`;
  }

  // (the sounds out of the clip again)
  _unhook() {
    const A = this.app.audio;
    if (this._sound && this.dest && A?.out) {
      try {
        A.out.disconnect(this.dest);
      } catch (e) {
        /* (gone already) */
      }
    }
    this._sound = false;
  }

  _done(chunks, type, n) {
    // (an earlier recording's, finishing after the next one started: let go)
    if (n !== this._n) return;
    clearTimeout(this._wait);
    this._unhook();
    if (this.diag) this.diag.over = true;
    if (!chunks.length) {
      if (!this.rec && this.modal.hidden) this.ui.hint?.("That clip didn't come out - try again");
      this._say('made nothing');
      return;
    }
    const base = (type || chunks[0].type || 'video/webm').split(';')[0], ext = base.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: base });
    if (this.diag) {
      this.diag.file = `${(blob.size / 1e6).toFixed(1)} MB ${base} in ${chunks.length} piece${chunks.length === 1 ? '' : 's'}`;
      this._say(`made ${this.diag.file}`);
      if (this.app.statsSay) this._check(blob);
    }
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const name = `cube-simulator-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
    this.file = new File([blob], name, { type: base });
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.video.src = this.url;
    this.saveEl.href = this.url;
    this.saveEl.download = name;
    // (the share sheet, where there is one that takes a file)
    this.shareEl.hidden = !(navigator.canShare && navigator.canShare({ files: [this.file] }));
    this.modal.hidden = false;
    this.video.play?.().catch(() => {});
  }

  async _share() {
    this._say('shared');
    try {
      await navigator.share({ files: [this.file], title: 'Cube Simulator' });
    } catch (e) {
      /* (cancelled) */
    }
  }

  _close() {
    this.modal.hidden = true;
    this.video.pause?.();
    this.video.removeAttribute('src');
    this.video.load?.();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
    this.file = null;
  }

  // The mark: the logotype (its own letters - see index.html) and where to
  // play, white with a soft shadow, to read over any of it
  _markTexture() {
    if (this._mt) return this._mt;
    const W = 900, H = 330, cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.shadowColor = 'rgba(0, 0, 0, 0.45)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 3;
    g.fillStyle = '#fff';
    // CUBE: the letters' paths (a 146 x 40 box)
    const s = (W * 0.62) / 146;
    g.save();
    g.translate((W - 146 * s) / 2, 20);
    g.scale(s, s);
    for (const id of ['bl-c', 'bl-u', 'bl-b', 'bl-e']) {
      const el = document.getElementById(id);
      if (!el) continue;
      g.fill(new Path2D(el.getAttribute('d')), el.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero');
    }
    g.restore();
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    // SIMULATOR, spaced out to the word's width
    g.font = `800 ${Math.round(s * 13)}px ${font}`;
    const word = 'SIMULATOR', span = 146 * s, x0 = (W - span) / 2;
    const ws = [...word].map((c) => g.measureText(c).width), gap = (span - ws.reduce((a, b) => a + b, 0)) / (word.length - 1);
    let x = x0;
    g.textAlign = 'left';
    for (let i = 0; i < word.length; i++) {
      g.fillText(word[i], x, 20 + 58 * s);
      x += ws[i] + gap;
    }
    // ...and where
    g.textAlign = 'center';
    g.font = `600 ${Math.round(s * 7.2)}px ${font}`;
    g.globalAlpha = 0.9;
    g.fillText(location.host + location.pathname.replace(/\/$/, ''), W / 2, H - 22);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return (this._mt = tex);
  }
}
