import * as THREE from 'three';
import { cutBody, planeField } from '../sim/cutting.js';
import { maxStretch } from '../sim/strain.js';
import { makeNailGun } from '../world/models.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// ------------------------------------------------------------------ hand
// How far each material stretches before it tears (frozen jelly: barely).
const TEAR = { jello: 1.75, gummy: 1.9, sour: 1.8, crystal: 1.6, creamy: 2.0, slime: 3.4, water: 2.4, syrup: 3.8, mochi: 3.2, marshmallow: 2.6, rubber: 2.8, glass: 1.3 };

// Grab and drag; a quick tap pokes. Each finger holds on by itself - two on
// the jelly squish it between them or pull it apart - and pulled too far
// apart it tears between them (unless tearing's off: Settings). One hand
// never tears it: dragged however fast, the whole piece comes along.
export class HandTool {
  constructor(app) {
    this._ht = 0;
    this.app = app;
    this.id = 'hand';
    this.cursor = 'grab';
    this.multiTouch = true; // (a second finger on the jelly grabs too - see App._bindInput)
    this.drags = new Map(); // pointerId -> { grab, plane, t0, x0, y0, moved, hit, dir }
    this._over = 0; // looks in a row something held was stretched past tearing
    this._tick = 0;
    this._cool = 0;
  }

  // (the one drag, for single-pointer callers)
  get drag() {
    for (const d of this.drags.values()) return d;
    return null;
  }

  hover(e, ray) {
    if (!ray || this.drags.size) return;
    const now = performance.now();
    if (now - (this._ht || 0) < 40) return;
    this._ht = now;
    this.app.setCursor(this.app.pickJelly(ray) ? 'grab' : 'default');
  }

  down(e, ray, hit) {
    if (!hit) return false;
    const app = this.app;
    const p = hit.point;
    app.camera.getWorldDirection(_v);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_v.negate(), _w.set(p[0], p[1], p[2]));
    const grab = app.sb.startGrab(hit, p[0], p[1], p[2], 0.2);
    if (!grab) return false;
    this.drags.set(e.pointerId ?? 0, { grab, plane, t0: performance.now(), x0: e.clientX, y0: e.clientY, moved: 0, hit, dir: ray.direction.clone() });
    app.setCursor('grabbing');
    app.audio?.squish(0.35, this.drags.size > 1 ? 1.15 : 0.9);
    return true;
  }

  move(e, ray) {
    const d = this.drags.get(e.pointerId ?? 0);
    if (!d) return;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x0, e.clientY - d.y0));
    const g = d.grab;
    const pt = ray.intersectPlane(d.plane, _v);
    if (pt) {
      g.tx = pt.x;
      g.ty = Math.max(pt.y, 0.03);
      g.tz = pt.z;
      const R = this.app.sb.p.arenaRadius - 0.05;
      const r = Math.hypot(g.tx, g.tz);
      if (r > R) {
        g.tx *= R / r;
        g.tz *= R / r;
      }
    }
  }

  // A finger lifts (a pointer we don't know: all of them - the app taking
  // the gesture over for a pinch).
  up(e) {
    const id = e?.pointerId ?? 0;
    if (!this.drags.has(id)) {
      for (const k of [...this.drags.keys()]) this._release(k);
    } else this._release(id);
    if (!this.drags.size) this.app.setCursor(this.cursor);
  }

  _release(id) {
    const d = this.drags.get(id);
    if (!d) return;
    this.drags.delete(id);
    const app = this.app;
    const quick = performance.now() - d.t0 < 280 && d.moved < 8;
    app.sb.endGrab(d.grab);
    if (quick) {
      const [x, y, z] = d.hit.point;
      app.sb.impulse(x, y, z, d.dir.x, d.dir.y, d.dir.z, 0.34, 4.2, d.grab.piece);
      app.audio?.poke(0.7);
      app.glowPulse?.(x, y, z, 0.9);
    } else if (!this.drags.size) {
      // throw: speed of the grabbed region
      const pc = app.sb.pieces[d.grab.piece];
      const sp = pc ? Math.hypot(...pc.vel) : 0;
      if (sp > 3) app.audio?.whoosh(Math.min(1, sp / 12));
    }
  }

  // Each frame (every other): two hands on one piece pulling it apart -
  // stretched between them past its limit twice running, it splits there,
  // across the line between the hands, a half in each. (Torn wherever the
  // stretch peaked, a fingertip's shallow hold peeled thin flaps and
  // shredded them; and a rip that ran on in steps cut one plane over and
  // over - each cut splits every tet on its plane anew: millions. One hand
  // tore a ball out of anything dragged fast.) Bits under 5% of a cube
  // don't tear again.
  update(sdt, dt = 1 / 60) {
    const app = this.app, sb = app.sb;
    if (this.drags.size < 2 || app.healer.active || !app.tearing) {
      this._over = 0;
      return;
    }
    this._cool -= dt;
    if (++this._tick % 2 || this._cool > 0 || sb.nT > 30000) return;
    const G = sb._grabbedP;
    if (!G) return;
    const size = sb.p.size, minVol = 0.05 * size ** 3;
    // the hands on each piece, and where each holds (its held vertices' middle)
    const on = new Map();
    for (const d of this.drags.values()) {
      const g = d.grab, k = g.piece;
      const pc = sb.pieces[k];
      if (!pc || pc.volume < minVol) continue;
      const c = [0, 0, 0];
      for (let j = 0; j < g.n; j++) for (let q = 0; q < 3; q++) c[q] += sb.x[g.idx[j] * 3 + q] / g.n;
      if (!on.has(k)) on.set(k, []);
      on.get(k).push({ d, c });
    }
    let best = null;
    for (const [k, hands] of on) {
      if (hands.length < 2) continue;
      const mask = new Uint8Array(sb.pieces.length);
      mask[k] = 1;
      const [A, B] = hands, ax = B.c[0] - A.c[0], ay = B.c[1] - A.c[1], az = B.c[2] - A.c[2];
      const L2 = ax * ax + ay * ay + az * az;
      if (L2 < 1e-6) continue;
      const L = Math.sqrt(L2);
      // pulled apart - further than when they took hold - not squeezed
      // (squeezed, it bulges: stretched across the squeeze, which mustn't tear it)
      const P = B.d;
      if (P.pairWith !== A.d.grab) {
        P.pairWith = A.d.grab;
        P.d0 = L; // (how far apart they took hold)
      }
      if (L < P.d0 * 1.12) continue;
      // (the middle of the way between them, stretched along it)
      const m = maxStretch(sb, mask, (x, y, z) => {
        const u = ((x - A.c[0]) * ax + (y - A.c[1]) * ay + (z - A.c[2]) * az) / L2;
        return u > 0.2 && u < 0.8;
      });
      if (!m || Math.abs(m.dir[0] * ax + m.dir[1] * ay + m.dir[2] * az) / L < 0.7) continue;
      if (!best || m.s / this._limit(m) > best.over) best = { over: m.s / this._limit(m), m, k, n: [ax / L, ay / L, az / L] };
    }
    if (best && best.over > 1) this._over++;
    else this._over = 0;
    if (this._over < 2) return;
    this._over = 0;
    const { m, k } = best;
    const o = tetCentre(sb, m.t);
    const [nx, ny, nz] = best.n;
    const field = ragged(planeField(nx, ny, nz, nx * o[0] + ny * o[1] + nz * o[2]), 0.035 * size);
    const res = cutBody(sb, field, { separate: 0.3, anchors: app.allAnchors(), pieces: [k] });
    if (!res.changed) return;
    app.onTopologyChanged();
    app.markDamaged();
    this._cool = 0.35; // (let it snap back before looking again)
    app.audio?.squish(0.9, 0.65);
    app.audio?.crack(0.25);
    app.glowPulse?.(o[0], o[1], o[2], 0.8);
  }

  // the stretch a piece tears at: its material's, much less where frozen
  _limit(m) {
    const app = this.app, sb = app.sb;
    let lim = TEAR[app.style?.texture] || 2;
    if (m) {
      const T = sb.T, t4 = m.t * 4;
      const temp = (sb.temp[T[t4]] + sb.temp[T[t4 + 1]] + sb.temp[T[t4 + 2]] + sb.temp[T[t4 + 3]]) / 4;
      if (temp < -0.3) lim = Math.min(lim, 1.12);
      else if (temp > 0.4) lim *= 1.3; // (melting: gooier)
    }
    return lim;
  }
}

// A torn surface, not a cut one: the field's zero set rippled by a few
// crossed waves (random each tear), amp high; the normal by differences.
function ragged(f, amp) {
  const W = [];
  for (let i = 0; i < 4; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    W.push([r * Math.cos(th), u, r * Math.sin(th), 5 + Math.random() * 9, Math.random() * 6.3]);
  }
  const wav = (x, y, z) => {
    let s = 0;
    for (const [a, b, c, k, ph] of W) s += Math.sin((a * x + b * y + c * z) * k + ph);
    return (s * amp) / 2;
  };
  const value = (x, y, z) => f.value(x, y, z) + wav(x, y, z);
  const e = 0.002;
  return {
    value,
    normal: (x, y, z, out) => {
      const gx = value(x + e, y, z) - value(x - e, y, z), gy = value(x, y + e, z) - value(x, y - e, z), gz = value(x, y, z + e) - value(x, y, z - e);
      const l = Math.hypot(gx, gy, gz) || 1;
      out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
      return out;
    },
    inRegion: f.inRegion,
  };
}

function tetCentre(sb, t) {
  const T = sb.T, x = sb.x, c = [0, 0, 0];
  for (let j = 0; j < 4; j++) for (let k = 0; k < 3; k++) c[k] += x[T[t * 4 + j] * 3 + k] / 4;
  return c;
}

// ------------------------------------------------------------------ knife
export class KnifeTool {
  constructor(app) {
    this.app = app;
    this.id = 'knife';
    this.cursor = 'crosshair';
    this.stroke = null;
  }

  down(e) {
    this.stroke = { ax: e.clientX, ay: e.clientY, bx: e.clientX, by: e.clientY, t0: performance.now() };
    this.app.overlay.setStroke(this.stroke);
    return true;
  }

  move(e) {
    if (!this.stroke) return;
    this.stroke.bx = e.clientX;
    this.stroke.by = e.clientY;
    this.app.overlay.setStroke(this.stroke);
  }

  up() {
    const s = this.stroke;
    this.stroke = null;
    this.app.overlay.setStroke(null);
    if (!s) return;
    const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
    if (len < 18) return;
    this.app.overlay.slash(s);
    this.cut(s.ax, s.ay, s.bx, s.by);
  }

  // Cut with the plane through the eye and the screen-space stroke.
  cut(ax, ay, bx, by) {
    const app = this.app;
    if (app.sb.nT > 30000) {
      app.ui?.hint('That is a lot of jelly bits — hit Heal first');
      return false;
    }
    const cam = app.camera;
    const ra = app.rayFromClient(ax, ay).direction.clone();
    const rb = app.rayFromClient(bx, by).direction.clone();
    const n = new THREE.Vector3().crossVectors(ra, rb);
    if (n.lengthSq() < 1e-10) return false;
    n.normalize();
    const eye = cam.position.clone();
    const d = n.dot(eye);
    const rect = app.canvas.getBoundingClientRect();
    const sx = bx - ax, sy = by - ay;
    const L2 = sx * sx + sy * sy;
    const proj = new THREE.Vector3();
    const region = (x, y, z) => {
      proj.set(x, y, z).project(cam);
      const px = rect.left + (proj.x * 0.5 + 0.5) * rect.width;
      const py = rect.top + (-proj.y * 0.5 + 0.5) * rect.height;
      const t = ((px - ax) * sx + (py - ay) * sy) / L2;
      return t >= -0.015 && t <= 1.015;
    };
    const before = app.sb.pieces.length;
    const res = cutBody(app.sb, planeField(n.x, n.y, n.z, d, region), {
      separate: 0.35,
      anchors: app.allAnchors(),
    });
    if (!res.changed) {
      app.audio?.swish(0.4);
      return false;
    }
    app.onTopologyChanged();
    app.audio?.slice(app.sb.pieces.length > before ? 1 : 0.6);
    app.markDamaged();
    return true;
  }
}

// ------------------------------------------------------------------ nail gun
export class NailGunTool {
  constructor(app) {
    this.app = app;
    this.id = 'nailgun';
    this.cursor = 'crosshair';
    this.firing = false;
    this.cool = 0;
    this.ray = new THREE.Ray();
    this.model = makeNailGun(app.M);
    this.model.visible = false;
    this.model.traverse((o) => (o.castShadow = false));
    app.scene.add(this.model);
    this.recoil = 0;
    this.aim = new THREE.Vector3(0, 0.5, 0);
  }

  activate() {
    this.model.visible = true;
  }

  deactivate() {
    this.model.visible = false;
    this.firing = false;
  }

  hover(e, ray) {
    if (ray) this.ray.copy(ray);
  }

  // viewmodel: bottom-right of the screen, aimed at what's under the cursor
  _placeModel(dt) {
    const cam = this.app.camera;
    const hit = this.app.pickJelly(this.ray);
    const goal = hit ? new THREE.Vector3(...hit.point) : this.ray.origin.clone().addScaledVector(this.ray.direction, 4);
    this.aim.lerp(goal, 1 - Math.exp(-dt * 18));
    // anchor to a fixed spot on screen (bottom-right), whatever the aspect
    const D = 1.75;
    const ty = Math.tan((cam.fov * Math.PI) / 360);
    const off = new THREE.Vector3(0.74 * ty * cam.aspect * D, -0.6 * ty * D, -D).applyQuaternion(cam.quaternion);
    const pos = cam.position.clone().add(off);
    this.model.position.copy(pos);
    this.model.lookAt(this.aim);
    this.model.rotateY(Math.PI);
    this.recoil *= Math.exp(-dt * 14);
    this.model.translateZ(this.recoil * 0.08);
    this.model.rotateX(this.recoil * 0.25);
    this.model.updateMatrixWorld();
    return pos;
  }

  down(e, ray) {
    this.firing = true;
    this.ray.copy(ray);
    this.cool = 0;
    this.fire();
    return true;
  }

  move(e, ray) {
    this.ray.copy(ray);
  }

  up() {
    this.firing = false;
  }

  update(dt, rdt) {
    this._placeModel(rdt || dt);
    if (!this.firing) return;
    this.cool -= dt;
    if (this.cool <= 0) this.fire();
  }

  fire() {
    const app = this.app;
    this.cool = 0.16;
    const cam = app.camera;
    // muzzle sits just off-screen bottom-right, aimed at what's under the cursor
    const r = this.ray;
    // muzzle of the viewmodel
    const origin = this.model.localToWorld(new THREE.Vector3(0, 0, 0.06).multiplyScalar(-1));
    this.recoil = 1;
    this.app.particles.flash(origin, 0.05, [6, 5, 4]);
    const hit = app.pickJelly(r);
    let target;
    if (hit) target = new THREE.Vector3(...hit.point);
    else {
      const t = r.direction.y < -1e-3 ? -r.origin.y / r.direction.y : 6;
      target = r.origin.clone().addScaledVector(r.direction, Math.min(t, 8));
    }
    const dir = target.clone().sub(origin).normalize();
    // small spread
    dir.x += (Math.random() - 0.5) * 0.006;
    dir.y += (Math.random() - 0.5) * 0.006;
    dir.normalize();
    app.nails.fire(origin, dir);
    app.audio?.nailgun();
    app.shake(0.004);
  }
}
