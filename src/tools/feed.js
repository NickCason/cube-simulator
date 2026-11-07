// Add jelly: the ladle. Hold it on a cube and jelly pours from it, blob by
// blob, into the cube (see Cubiplication.feed): it swells - fed enough, it
// cubiplies.

import * as THREE from 'three';
import { makeLadle } from '../world/models.js';
import { resolveFlavor, flavorMainHex } from '../styles.js';

export class FeedTool {
  constructor(app) {
    this.app = app;
    this.id = 'feed';
    this.cursor = 'pointer';
    this.model = makeLadle(app.M);
    this.model.visible = false;
    app.scene.add(this.model);
    this.f = null; // { slot, t, drip, lip }
    this.blobs = []; // (blobs on their way in: { d (a droplet), slot })
  }

  deactivate() {
    this.up();
  }

  down(e, ray, hit) {
    if (!hit) return false;
    const app = this.app, slot = app.sb.pieces[hit.piece]?.cube ?? 0;
    if (!app.cubiplication.start(slot)) return true;
    this.f = { slot, t: 0, drip: 0, lip: new THREE.Vector3() };
    this.model.visible = true;
    this._pose(0);
    return true;
  }

  move() {}

  up() {
    if (!this.f) return;
    this.f = null;
    this.model.visible = false;
    this.app.cubiplication.stop();
  }

  // the cube now: its middle, its top, its footprint
  _cube(slot) {
    const sb = this.app.sb;
    let cx = 0, cz = 0, n = 0, top = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < sb.nV; i++) {
      if (sb.vCube[i] !== slot || !sb.alive[i]) continue;
      const x = sb.x[i * 3], y = sb.x[i * 3 + 1], z = sb.x[i * 3 + 2];
      cx += x;
      cz += z;
      n++;
      if (y > top) top = y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    return n ? { cx: cx / n, cz: cz / n, top, x0, x1, z0, z1 } : null;
  }

  // the ladle a little above the cube, tipped to pour, bobbing as it goes
  _pose(dt) {
    const f = this.f, C = this._cube(f.slot);
    if (!C) return;
    f.t += dt;
    this.model.position.set(C.cx + 0.12, C.top + 0.24 + 0.02 * Math.sin(f.t * 7), C.cz);
    this.model.rotation.set(0, 0, 0.95 + 0.12 * Math.sin(f.t * 9));
    f.lip.set(C.cx, C.top + 0.13, C.cz);
  }

  update(dt) {
    const app = this.app, mito = app.cubiplication;
    // blobs on their way: in the top of their cube, they're fed to it
    for (let k = this.blobs.length - 1; k >= 0; k--) {
      const b = this.blobs[k], i = app.droplets.items.indexOf(b.d), C = i >= 0 ? this._cube(b.slot) : null;
      if (!C) {
        this.blobs.splice(k, 1);
        continue;
      }
      const p = b.d.p;
      if (p.y <= C.top + b.d.r * 0.4 && p.x > C.x0 && p.x < C.x1 && p.z > C.z0 && p.z < C.z1) {
        app.droplets.items.splice(i, 1);
        this.blobs.splice(k, 1);
        mito.feed(0.024, p);
      } else if (b.d.t > 2) this.blobs.splice(k, 1); // (missed: a blob on the floor)
    }
    if (!this.f) return;
    // (it cubiplied, or something else took it over: a fresh press to feed again)
    if (!mito.active || mito.m.slot !== this.f.slot) {
      this.up();
      return;
    }
    this._pose(dt);
    if (mito.dividing) return;
    // (by the clock, not the frame: a slow phone pours as fast)
    this.f.drip -= dt;
    const cb = app.cubes.find((c) => c.slot === this.f.slot);
    const hex = cb ? flavorMainHex(resolveFlavor(cb.style)) : app.color;
    for (let k = 0; k < 3 && this.f.drip <= 0; k++) {
      this.f.drip += 0.06;
      const p = this.f.lip.clone();
      p.x += (Math.random() - 0.5) * 0.05;
      p.z += (Math.random() - 0.5) * 0.05;
      p.y += k * 0.04;
      app.droplets.spawn(p, new THREE.Vector3((Math.random() - 0.5) * 0.3, -1.4, (Math.random() - 0.5) * 0.3), 0.032 + Math.random() * 0.014, hex);
      this.blobs.push({ d: app.droplets.items[app.droplets.items.length - 1], slot: this.f.slot });
    }
    this.f.drip = Math.max(this.f.drip, -0.06);
  }
}
