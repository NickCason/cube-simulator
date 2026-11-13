// The fall made plain (see drop.js): the cube's shadow on the floor under it - small and faint high up, dark and as
// big as it as it comes down; specks of air it falls past, drawn as streaks as long as they'd be smeared in a 15th
// of a second; the wind, louder and higher the faster it goes; and its landing - dust kicked out in a ring, a flash
// in its colour, the view shaken - as hard as it hit.
import * as THREE from 'three';
import { REST_STEP } from '../sim/softbody.js';

const N = 320; // (specks of air)
const SPAN = 16; // (m: the specks kept within half this above and below the eye - gone past, put back the far side)
const BLUR = 0.065; // (s: a streak's length, as far as it goes in this long)

export class DropFx {
  constructor(app) {
    this.app = app;
    this.x0 = 0;
    this.z0 = 0;
    this.top = 0;
    this.wind = false;
    // its shadow: a soft dark disc on the floor
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.9)');
    gr.addColorStop(0.5, 'rgba(0,0,0,0.5)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.004;
    this.shadow.renderOrder = 2;
    this.shadow.visible = false;
    app.scene.add(this.shadow);
    // the air: specks fixed in the room, each a streak - a thin strip turned to the eye, bright at its head, gone at
    // its tail (lines are a pixel wide: on a phone, nothing)
    this.pts = new Float32Array(N * 3);
    const pos = (this.pos = new Float32Array(N * 12)), col = (this.col = new Float32Array(N * 16)), idx = new Uint16Array(N * 6);
    for (let i = 0; i < N; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', (this.aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)));
    geo.setAttribute('color', (this.aCol = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage)));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.streaks = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.streaks.renderOrder = 3;
    app.scene.add(this.streaks);
    this._v = new THREE.Vector3();
  }

  // (the specks: round where it's going up from, out from 1.2 m to 6, about the eye - spread over the whole way
  // up, the few round the eye were all there was to see)
  scatter(x, z, top) {
    this.x0 = x;
    this.z0 = z;
    this.top = top;
    const P = this.pts, y = this.app.camera.position.y;
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 1.2 + Math.sqrt(Math.random()) * 4.8;
      P[i * 3] = x + Math.cos(a) * r;
      P[i * 3 + 1] = y + (Math.random() - 0.5) * SPAN;
      P[i * 3 + 2] = z + Math.sin(a) * r;
    }
  }

  // A frame: D the Drop, pc its cube's biggest piece (null: none of it)
  update(D, pc) {
    const app = this.app, live = !!(D.on && pc && (D.phase === 'lift' || D.phase === 'hang' || D.phase === 'fall'));
    const sp = live ? Math.hypot(pc.vel[0], pc.vel[1], pc.vel[2]) : 0;
    // (the wind: up and higher with its speed)
    const want = live && sp > 4;
    if (want !== this.wind) {
      app.audio?.loop('dropwind', want, { type: 'bandpass', freq: 500, q: 0.5, gain: 0.32, lfo: 2.3, flicker: 0.35 });
      this.wind = want;
    }
    if (want) {
      const u = Math.min(1, (sp - 4) / 18);
      app.audio?.loopLevel('dropwind', 0.25 + 0.75 * u);
      const L = app.audio?.loops?.dropwind;
      if (L && app.audio.ctx) L.f.frequency.setTargetAtTime(380 + 1400 * u, app.audio.ctx.currentTime, 0.1);
    }
    if (!live) {
      this.shadow.visible = this.streaks.visible = false;
      return;
    }
    // its shadow: under it, as big as it and a little more the higher it is, darker as it comes down - gone as it
    // lands, where its own takes over
    const alt = Math.max(0, pc.bbox[1]), size = app.sb.cSize[D.slot] || 1;
    const s = size * (1.2 + 0.03 * alt);
    this.shadow.visible = alt > 0.12;
    this.shadow.position.set(pc.com[0], 0.004, pc.com[2]);
    this.shadow.scale.set(s, s, 1);
    this.shadow.material.opacity = 0.62 * Math.max(0.18, 1 - alt / 60) * Math.min(1, alt / 0.8);
    // the streaks: each speck, and where it was in the picture a moment ago - the eye's gone on with the cube
    const a = Math.min(1, Math.max(0, (sp - 3) / 10)) * (app.theme === 'dark' ? 0.7 : 0.6);
    this.streaks.visible = a > 0.01;
    if (!this.streaks.visible) return;
    const dark = app.theme === 'dark', cr = dark ? 0.92 : 0.32, cg = dark ? 0.95 : 0.36, cb = dark ? 1 : 0.44;
    const cam = app.camera.position, vx = pc.vel[0] * BLUR, vy = pc.vel[1] * BLUR, vz = pc.vel[2] * BLUR, P = this.pts, pos = this.pos, col = this.col;
    const hw = 0.014 * Math.min(2.2, 1 + sp / 25), cy = cam.y;
    for (let i = 0; i < N; i++) {
      // (gone past the eye by half the span: put back the far side - still where it is in the room till then)
      if (P[i * 3 + 1] > cy + SPAN / 2) P[i * 3 + 1] -= SPAN;
      else if (P[i * 3 + 1] < cy - SPAN / 2) P[i * 3 + 1] += SPAN;
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2], qx = px + vx, qy = py + vy, qz = pz + vz;
      // (across it, turned to the eye)
      const ex = cam.x - px, ey = cam.y - py, ez = cam.z - pz;
      let wx = vy * ez - vz * ey, wy = vz * ex - vx * ez, wz = vx * ey - vy * ex;
      const wl = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1, d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      wx *= hw / wl; wy *= hw / wl; wz *= hw / wl;
      const o = i * 12;
      pos[o] = px - wx; pos[o + 1] = py - wy; pos[o + 2] = pz - wz;
      pos[o + 3] = px + wx; pos[o + 4] = py + wy; pos[o + 5] = pz + wz;
      pos[o + 6] = qx - wx; pos[o + 7] = qy - wy; pos[o + 8] = qz - wz;
      pos[o + 9] = qx + wx; pos[o + 10] = qy + wy; pos[o + 11] = qz + wz;
      // (fainter far off, and right up at the eye)
      const f = py < 0.05 ? 0 : a * Math.min(1, d / 1.5) * Math.max(0.15, 1 - d / 12), c = i * 16;
      col[c] = col[c + 4] = col[c + 8] = col[c + 12] = cr;
      col[c + 1] = col[c + 5] = col[c + 9] = col[c + 13] = cg;
      col[c + 2] = col[c + 6] = col[c + 10] = col[c + 14] = cb;
      col[c + 3] = col[c + 7] = f;
      col[c + 11] = col[c + 15] = 0;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  // Down: dust kicked out from under it in a ring, a flash in its colour, glitter, the view shaken and the world all
  // but stopped a moment, a thud - each as hard as it hit (v m/s)
  impact(D, pc, v) {
    const app = this.app, u = Math.min(1, v / 22), size = app.sb.cSize[D.slot] || 1, cx = pc.com[0], cz = pc.com[2], half = size / 2;
    app.shake(0.012 + 0.04 * u);
    app.hitStop(0.03 + 0.05 * u);
    app.audio?.thud(0.6 + 0.9 * u);
    app.audio?.splat(0.4 + 0.6 * u);
    const dark = app.theme === 'dark', d = dark ? 0.3 : 0.92, n = Math.round(20 + 40 * u);
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2 + Math.random() * 0.2, s = (1.4 + Math.random() * 1.4) * (0.6 + 1.4 * u);
      app.particles.alpha.spawn(cx + Math.cos(th) * half * 1.05, 0.03, cz + Math.sin(th) * half * 1.05, Math.cos(th) * s, 0.2 + Math.random() * 0.5 * (0.5 + u), Math.sin(th) * s,
        0.6 + Math.random() * 0.5, 0.06, 0.26 + Math.random() * 0.2 * (1 + u), [d, d * 0.97, d * 0.94, dark ? 0.35 : 0.55], [d, d, d, 0], 3, 0.2);
    }
    const col = new THREE.Color(app.flavorColorAtRest?.(D.slot * REST_STEP, 0, 0, D.slot) ?? '#ffffff');
    app.particles.flash(new THREE.Vector3(cx, 0.05, cz), size * (1 + u), [col.r * 3, col.g * 3, col.b * 3]);
    for (let k = 0; k < 10 + 20 * u; k++) app.particles.glitter(new THREE.Vector3(cx, size * 0.5, cz), 1, [col.r, col.g, col.b], 1.5);
  }

  stop() {
    if (this.wind) this.app.audio?.loop('dropwind', false);
    this.wind = false;
    this.shadow.visible = this.streaks.visible = false;
  }
}
