import * as THREE from 'three';

// ------------------------------------------------------------------ blow
// Air. Held, a gust streams from the finger into the room and pushes on the jelly it meets: on each bit of
// skin that faces it, the squarer it's met the harder, falling off away from the gust's middle (a cone,
// widening as it goes) - so a cube leans away and gives, a small piece skates off across the floor, a snow
// globe's water is stirred by the shove. A gust is never steady: it swells and dies, and its push runs over the
// skin in ripples. Nothing of it is drawn but a few motes riding it, and what it does.
const REACH = 9; // (m: as far as it blows)
const PUSH = 16; // (m/s², a whole cube's square face met full on - a small piece, as much more as it's smaller)
const PUSH_LIQ = 34; // (m/s², liquid out in the room met at the gust's middle: a puddle pushed along, its drops carried)
const _o = new THREE.Vector3(), _d = new THREE.Vector3();

export class BlowTool {
  constructor(app) {
    this.app = app;
    this.id = 'blow';
    this.cursor = 'crosshair';
    this.on = false;
    this.ray = new THREE.Ray();
    this.level = 0; // (how hard it's blowing: up while held, dying away after)
    this.t = 0;
    this.motes = 0;
    this._sound = false;
  }

  deactivate() {
    this.up();
    this.level = 0;
    this._quiet();
  }

  down(e, ray) {
    this.on = true;
    this.ray.copy(ray);
    this.app.audio.loop('blow', true, { type: 'bandpass', freq: 520, q: 0.55, gain: 0.32, lfo: 2.3, flicker: 0.45 });
    this._sound = true;
    return true;
  }

  move(e, ray) {
    this.ray.copy(ray);
  }

  up() {
    this.on = false;
  }

  _quiet() {
    if (!this._sound) return;
    this.app.audio.loop('blow', false);
    this._sound = false;
  }

  update(dt) {
    const app = this.app, sb = app.sb;
    // (it builds over a fifth of a second, and dies away over a third once let go)
    this.level += ((this.on ? 1 : 0) - this.level) * (1 - Math.exp(-dt * (this.on ? 5 : 3)));
    if (this.level < 0.01) {
      this.level = 0;
      this._quiet();
      return;
    }
    this.t += dt;
    const t = this.t, force = app.st?.blowForce ?? 1;
    // (gusty: a swell, a flutter on it)
    const gust = this.level * (0.72 + 0.2 * Math.sin(t * 4.7) + 0.08 * Math.sin(t * 11.3 + 1.7));
    if (this._sound) app.audio.loopLevel('blow', Math.min(1, gust * (0.6 + 0.25 * force)));
    const o = _o.copy(this.ray.origin), d = _d.copy(this.ray.direction).normalize();
    // the push: a pressure - what would push a whole cube, met square-on, at PUSH - on each bit of skin, by its
    // area (a small piece, its skin big against its weight, flies further), shared out to its corners by their mass
    // (a narrow gust - widening as it goes: met close, it dents the skin and runs ripples over it, rather than
    // shoving the whole side)
    const size = sb.p.size, R0 = 0.17 * size, P0 = PUSH * force * gust * size;
    const T = sb.sTri, x = sb.x, v = sb.v, w = sb.w, vp = sb.vPiece, nF = sb.nF;
    if (!T || !nF) return;
    const pcs = sb.pieces, hit = this._hit && this._hit.length >= pcs.length ? this._hit : (this._hit = new Float64Array(Math.max(64, pcs.length)));
    hit.fill(0, 0, pcs.length);
    for (let f = 0; f < nF; f++) {
      const a = T[f * 3], b = T[f * 3 + 1], c = T[f * 3 + 2];
      const pc = pcs[vp[a]];
      if (!pc || !(pc.mass > 0)) continue;
      const a3 = a * 3, b3 = b * 3, c3 = c * 3;
      const cx = (x[a3] + x[b3] + x[c3]) / 3, cy = (x[a3 + 1] + x[b3 + 1] + x[c3 + 1]) / 3, cz = (x[a3 + 2] + x[b3 + 2] + x[c3 + 2]) / 3;
      const rx = cx - o.x, ry = cy - o.y, rz = cz - o.z, s = rx * d.x + ry * d.y + rz * d.z;
      if (s <= 0 || s > REACH) continue;
      const px = rx - s * d.x, py = ry - s * d.y, pz = rz - s * d.z, R = R0 + 0.22 * s, q = (px * px + py * py + pz * pz) / (R * R);
      if (q > 4) continue;
      // (twice its area along its normal - outward: the surface runs round anticlockwise)
      const e1x = x[b3] - x[a3], e1y = x[b3 + 1] - x[a3 + 1], e1z = x[b3 + 2] - x[a3 + 2];
      const e2x = x[c3] - x[a3], e2y = x[c3 + 1] - x[a3 + 1], e2z = x[c3 + 2] - x[a3 + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const facing = -(nx * d.x + ny * d.y + nz * d.z); // (its area times how square-on it's met)
      if (facing <= 0) continue;
      // (the gust's push running over the skin in ripples, downwind)
      const ripple = 0.4 + 0.6 * Math.sin(s * 13 - t * 19 + (cx * 5.3 + cz * 4.1 + cy * 3.7)) ** 2;
      // the push: as the wind goes, and a little into the skin it meets
      const rho = sb.cDens ? sb.cDens[pc.cube] || sb.p.density : sb.p.density;
      const F = (P0 * rho * 0.5 * facing * Math.exp(-q) * ripple) / (1 + 0.04 * s * s), k = (F / 3) * dt;
      const ln = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1, ix = 0.75 * d.x - (0.25 * nx) / ln, iy = 0.75 * d.y - (0.25 * ny) / ln, iz = 0.75 * d.z - (0.25 * nz) / ln;
      for (let j = 0; j < 3; j++) {
        const vi = j === 0 ? a : j === 1 ? b : c, wi = w[vi];
        if (!(wi > 0)) continue;
        v[vi * 3] += ix * k * wi;
        v[vi * 3 + 1] += iy * k * wi;
        v[vi * 3 + 2] += iz * k * wi;
      }
      hit[vp[a]] += F;
    }
    for (let i = 0; i < pcs.length; i++) if (hit[i] > 1e-5 && pcs[i].asleep) sb.wake(i);
    // the liquid it meets: puddles and spills out in the room pushed along it - and, blown down on, out from where it
    // hits, as air spreads over a floor (a puddle blown on from above opens round the spot) - their surfaces rippled, a
    // little up off them where it runs over them; and drops in the air carried. A cube's own liquid, sealed in it, left
    // be - the gust doesn't get in; in a cube cut open, stirred, less. (It only ever pushed the jelly: a puddle sat
    // still in a gale)
    const fl = app.fluid;
    if (fl?.n) {
      const X = fl.x, V = fl.v, dIn = fl.dIn, own = fl.own, cav = sb.cav, A = PUSH_LIQ * force * gust, down = Math.max(0, -d.y);
      let any = false;
      for (let i = 0; i < fl.n; i++) {
        // (in which cube - its slot + 1; 255, not looked yet: see Fluid.dIn)
        const k = dIn[i];
        let f = 1;
        if (k === 255) {
          if (own[i]) continue;
        } else if (k) {
          const c = cav[k - 1];
          if (!c || c.sealed) continue;
          f = 0.5;
        }
        const o3 = i * 3, rx = X[o3] - o.x, ry = X[o3 + 1] - o.y, rz = X[o3 + 2] - o.z, s = rx * d.x + ry * d.y + rz * d.z;
        if (s <= 0 || s > REACH) continue;
        const px = rx - s * d.x, py = ry - s * d.y, pz = rz - s * d.z, R = R0 + 0.22 * s, q = (px * px + py * py + pz * pz) / (R * R);
        if (q > 4) continue;
        const ripple = 0.35 + 0.65 * Math.sin(s * 13 - t * 19 + (X[o3] * 5.3 + X[o3 + 2] * 4.1)) ** 2;
        const a = ((f * A * Math.exp(-q)) / (1 + 0.04 * s * s)) * ripple * dt;
        // (out from the gust's line, across the floor: none right on it)
        const out = (down * a) / (Math.sqrt(px * px + pz * pz) + 0.3 * R);
        V[o3] += d.x * a + px * out;
        V[o3 + 1] += d.y * a + 0.18 * a * ripple;
        V[o3 + 2] += d.z * a + pz * out;
        any = true;
      }
      if (any && fl.asleep) fl.wake();
    }
    // (a drop flying home to a re-cube is left to it; an ice cube, heavy and smooth, skates - pushed less)
    for (const dr of app.droplets?.items || []) {
      if (dr.home) continue;
      const rx = dr.p.x - o.x, ry = dr.p.y - o.y, rz = dr.p.z - o.z, s = rx * d.x + ry * d.y + rz * d.z;
      if (s <= 0 || s > REACH) continue;
      const px = rx - s * d.x, py = ry - s * d.y, pz = rz - s * d.z, R = R0 + 0.22 * s, q = (px * px + py * py + pz * pz) / (R * R);
      if (q > 4) continue;
      const a = ((PUSH_LIQ * force * gust * Math.exp(-q)) / (1 + 0.04 * s * s)) * (dr.ice > 0.5 ? 0.3 : 1) * dt;
      dr.v.x += d.x * a;
      dr.v.y += d.y * a;
      dr.v.z += d.z * a;
    }
    // a few motes riding it (dust in the air: which way it's going)
    this.motes += dt * 55 * gust;
    const P = app.particles?.alpha;
    while (P && this.motes >= 1) {
      this.motes -= 1;
      const s = 0.5 + Math.random() * 3, R = R0 + 0.22 * s, th = Math.random() * Math.PI * 2, rr = R * Math.sqrt(Math.random()) * 0.9;
      const u = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(d).normalize() : new THREE.Vector3(1, 0, 0).cross(d).normalize(), vv = d.clone().cross(u);
      const p = o.clone().addScaledVector(d, s).addScaledVector(u, Math.cos(th) * rr).addScaledVector(vv, Math.sin(th) * rr);
      if (p.y < 0.02) continue;
      const sp = 2.5 + 3 * Math.random() * gust;
      P.spawn(p.x, p.y, p.z, d.x * sp, d.y * sp, d.z * sp, 0.45 + 0.4 * Math.random(), 0.009, 0.016, [1, 1, 1, 0.34], [1, 1, 1, 0], 0.6, 0);
    }
  }
}
