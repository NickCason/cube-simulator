import * as THREE from 'three';
import { cutBody, planeField } from '../sim/cutting.js';
import { makeNailGun } from '../world/models.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// ------------------------------------------------------------------ hand
export class HandTool {
  constructor(app) {
    this._ht = 0;
    this.app = app;
    this.id = 'hand';
    this.cursor = 'grab';
    this.drag = null;
    this.plane = new THREE.Plane();
  }

  hover(e, ray) {
    if (!ray || this.drag) return;
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
    this.plane.setFromNormalAndCoplanarPoint(_v.negate(), _w.set(p[0], p[1], p[2]));
    if (!app.sb.startGrab(hit, p[0], p[1], p[2], 0.2)) return false;
    this.drag = { t0: performance.now(), x0: e.clientX, y0: e.clientY, moved: 0, hit, dir: ray.direction.clone(), lastY: p[1] };
    app.setCursor('grabbing');
    app.audio?.squish(0.35, 0.9);
    return true;
  }

  move(e, ray) {
    const d = this.drag;
    if (!d) return;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x0, e.clientY - d.y0));
    const g = this.app.sb.grab;
    if (!g) return;
    const pt = ray.intersectPlane(this.plane, _v);
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

  up() {
    const d = this.drag;
    if (!d) return;
    const app = this.app;
    const quick = performance.now() - d.t0 < 280 && d.moved < 8;
    app.sb.endGrab();
    if (quick) {
      const [x, y, z] = d.hit.point;
      app.sb.impulse(x, y, z, d.dir.x, d.dir.y, d.dir.z, 0.34, 4.2, d.hit.piece);
      app.audio?.poke(0.7);
    } else {
      // throw: speed of the grabbed region
      const pc = app.sb.pieces[d.hit.piece];
      const sp = pc ? Math.hypot(...pc.vel) : 0;
      if (sp > 3) app.audio?.whoosh(Math.min(1, sp / 12));
    }
    this.drag = null;
    app.setCursor(this.cursor);
  }
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
