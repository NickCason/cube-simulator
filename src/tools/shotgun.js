// Shotgun: a pump gun - nine pellets of buckshot in a cone along the line of sight, each punching its own short hole
// in the jelly where it strikes (all of them cut in one go: one rebuild for the lot), the jelly thumped back and
// spattered, the misses chipping the floor. Then it pumps itself: the fore-end hauled back (a red shell thrown out of
// its side) and shoved home, and it's ready again. A big flash, a lot of smoke, the view kicked up hard.

import * as THREE from 'three';
import { HoleGunTool, ragged } from './basic.js';
import { cutBody, removeSmallPieces, removeTets } from '../sim/cutting.js';
import { makeShotgun } from '../world/models.js';

const PELLETS = 9;
const SPREAD = 0.068; // (rad: the cone's, about - tighter, its holes ran into one: none narrower than the mesh's cells can be cut)
const HOLES = 6; // (holes it cuts a shot, at most - the rest of its pellets thump)
const CYCLE = 1.0; // (s: shot to ready)
const PUMP_AT = 0.36, PUMP_BACK = 0.11, PUMP_HOLD = 0.07, PUMP_HOME = 0.12; // (s: the pump, after the shot)
const PUMP_TRAVEL = 0.075; // (m: how far back it slides)

export class ShotgunTool extends HoleGunTool {
  constructor(app) {
    super(app);
    this.id = 'shotgun';
    app.scene.remove(this.model);
    this.model = makeShotgun(app.M);
    this.model.visible = false;
    this.model.traverse((o) => (o.castShadow = false));
    app.scene.add(this.model);
    this.pumpObj = this.model.getObjectByName('pump');
    this.since = 9; // (s since the last shot)
    this.ejected = true;
    this.pumpedBack = true;
    this.pumpedHome = true;
  }

  down(e, ray) {
    this.firing = true;
    this.ray.copy(ray);
    if (this.since >= CYCLE) this.fire();
    return true;
  }

  update(dt, rdt) {
    const t = rdt || dt;
    this._placeModel(t);
    this.since += t;
    // the pump: back - the shell out at the back of it - and home
    const p = this.since - PUMP_AT;
    let off = 0;
    if (p > 0 && p < PUMP_BACK) off = p / PUMP_BACK;
    else if (p >= PUMP_BACK && p < PUMP_BACK + PUMP_HOLD) off = 1;
    else if (p >= PUMP_BACK + PUMP_HOLD && p < PUMP_BACK + PUMP_HOLD + PUMP_HOME) off = 1 - (p - PUMP_BACK - PUMP_HOLD) / PUMP_HOME;
    if (this.pumpObj) this.pumpObj.position.z = -0.17 + PUMP_TRAVEL * off * off * (3 - 2 * off);
    if (p > 0 && !this.pumpedBack) {
      this.pumpedBack = true;
      this.app.audio?.pump(false);
    }
    if (p > PUMP_BACK * 0.8 && !this.ejected) {
      this.ejected = true;
      this._shell();
    }
    if (p > PUMP_BACK + PUMP_HOLD && !this.pumpedHome) {
      this.pumpedHome = true;
      this.app.audio?.pump(true);
      // (racking it rocks the gun a little)
      this.recoil = Math.max(this.recoil, 0.35);
    }
    if (this.firing && this.since >= CYCLE) this.fire();
  }

  // its spent shell out of the port on its right side - up, right and on out into the room, tumbling
  _shell() {
    const app = this.app, cam = app.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0;
    fwd.normalize();
    const at = this.model.localToWorld(new THREE.Vector3(0.03, 0.02, 0.03));
    const v = right.multiplyScalar(1.1 + Math.random() * 0.6).addScaledVector(fwd, 1.2 + Math.random() * 0.8);
    v.y += 2.2 + Math.random() * 0.8;
    app.gunfx.eject('shell', at, v);
  }

  fire() {
    const app = this.app;
    this.since = 0;
    this.ejected = this.pumpedBack = this.pumpedHome = false;
    app.tally?.('shots');
    const muzzle = this.model.localToWorld(new THREE.Vector3(0, 0.018, -0.46));
    const bdir = this.aim.clone().sub(muzzle).normalize();
    this.recoil = 2.6;
    app.gunfx.muzzle(muzzle, bdir, 1.9, { screen: 0.09, smoke: 9 });
    app.kick(0.07);
    app.shake(0.022);
    this.blast(this.ray.origin, this.ray.direction);
  }

  // The buckshot: its pellets along o + t d (d unit), spread in a cone - each into the jelly or the floor
  blast(o, d) {
    const app = this.app, sb = app.sb, size = sb.p.size, power = app.st?.gunPower ?? 1;
    // (the cone: a pellet down the middle, the rest round it - a random scatter, not a ring)
    const u = new THREE.Vector3(), w = new THREE.Vector3(), dirs = [];
    u.set(Math.abs(d.y) < 0.9 ? 0 : 1, Math.abs(d.y) < 0.9 ? 1 : 0, 0).cross(d).normalize();
    w.crossVectors(d, u);
    for (let k = 0; k < PELLETS; k++) {
      const a = Math.random() * Math.PI * 2, r = k === 0 ? 0 : SPREAD * Math.sqrt(Math.random()) * 1.4;
      dirs.push(d.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r).normalize());
    }
    const hits = [], miss = [];
    for (const q of dirs) {
      const h = sb.raycast(o.x, o.y, o.z, q.x, q.y, q.z);
      if (h) hits.push({ d: q, p: new THREE.Vector3(...h.point), piece: h.piece });
      else miss.push(q);
    }
    // the misses: off the floor, if they reach it
    let floor = 0;
    for (const q of miss) {
      if (q.y > -1e-3) continue;
      const t = -o.y / q.y;
      if (t > 14) continue;
      const p = o.clone().addScaledVector(q, t);
      if (floor++ < 4) app.gunfx.floorHit(p, q, 0.7);
    }
    const pan = app.audio?._panOf?.(hits[0]?.p ?? o) ?? 0;
    if (!hits.length || sb.nT > 30000) {
      app.audio?.shotgun(0, pan);
      return;
    }
    // frozen where the middle of it struck: it shatters (as the hole gun's round does)
    const first = hits[0];
    let cold = 0, n = 0;
    for (let i = 0; i < sb.nV; i++) {
      if (!sb.alive[i]) continue;
      const dx = sb.x[i * 3] - first.p.x, dy = sb.x[i * 3 + 1] - first.p.y, dz = sb.x[i * 3 + 2] - first.p.z;
      if (dx * dx + dy * dy + dz * dz < 0.09) (cold += sb.temp[i]), n++;
    }
    if (n && cold / n < -0.4 && app.tools.mallet?.shatter) {
      app.tools.mallet.shatter({ tg: { point: first.p, hit: { piece: first.piece } }, d: d.clone() });
      app.audio?.shotgun(0.6, pan);
      return;
    }
    // each pellet's hole: short - buckshot stops a few inches in, less in firm stuff - all cut at once
    const firm = Math.min(1, Math.max(0, Math.log(sb.p.mu / 45) / Math.log(1000 / 45)));
    const deep = (0.3 - 0.16 * firm) * size * Math.pow(power, 0.5) * (1 - 0.5 * sb.p.rigidity) / Math.sqrt(sb.p.density);
    const r = Math.max(0.026 * size * Math.pow(power, 0.3) * (app.st?.holeSize ?? 1), 0.72 * sb.hCell);
    const caps = hits.slice(0, HOLES).map((h) => [h.p.clone().addScaledVector(h.d, -0.04), h.p.clone().addScaledVector(h.d, deep)]);
    const field = ragged(capsules(caps, r), 0.25 * r);
    const anchors = app.allAnchors();
    const res = cutBody(sb, field, { separate: 0, snap: 0.15, anchors, light: true });
    if (res.changed) {
      removeTets(sb, (t, cx, cy, cz) => field.value(cx, cy, cz) < 0, anchors);
      if (sb.topoStale) sb.rebuild();
      removeSmallPieces(sb, 0.0015 * size ** 3, anchors);
      app.onTopologyChanged();
      app.markDamaged();
    }
    if (sb.topoStale) sb.rebuild();
    // each pellet: the jelly thumped along it, a spatter back out of where it went in (a cube full of liquid: its
    // liquid), a pulse of light in it
    const hitPc = sb.pieces[first.piece], wet = !!hitPc && sb.cLiq[hitPc.cube] > 0;
    for (const h of hits) {
      sb.impulse(h.p.x, h.p.y, h.p.z, h.d.x, h.d.y, h.d.z, 0.14 * size, 3.2 * power);
      const raw = app.flavorColorAt(h.p.x, h.p.y, h.p.z), col = wet ? new THREE.Color(raw) : null;
      for (let j = 0; j < 2; j++) {
        const dir = h.d.clone().negate().add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(0.9)).normalize();
        const p0 = h.p.clone().addScaledVector(dir, 0.03), vel = dir.multiplyScalar(1.5 + Math.random() * 2.5);
        if (wet) app.fluid.add(p0.x, p0.y, p0.z, 0.00015, vel.x * 0.6, vel.y * 0.6, vel.z * 0.6, col.r, col.g, col.b, 0.04, 0, 0.03);
        else app.droplets.spawn(p0, vel, 0.008 + Math.random() * 0.01, raw);
      }
      app.glowPulse?.(h.p.x, h.p.y, h.p.z, 0.5);
    }
    // and the jelly thrown open round the middle of it, the lot at once
    const c = first.p, e = c.clone().addScaledVector(d, deep * 0.7);
    sb.cavity(c.x, c.y, c.z, e.x, e.y, e.z, (0.3 + 0.15 * (1 - firm)) * size, (4 + 10 * (1 - firm) ** 1.5) * power * (1 - 0.7 * sb.p.rigidity), 0.2, 1.2 * power * (1 - firm));
    app.hitStop?.(0.06);
    app.audio?.shotgun(Math.min(1, hits.length / 4), pan);
  }
}

// (the pellets' holes as one field: inside any of the capsules a-b, radius r)
function capsules(list, r) {
  return {
    value: (x, y, z) => {
      let m = Infinity;
      for (const [a, b] of list) {
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz;
        const s = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / L2)) : 0;
        const px = x - a.x - dx * s, py = y - a.y - dy * s, pz = z - a.z - dz * s;
        const q = Math.sqrt(px * px + py * py + pz * pz) - r;
        if (q < m) m = q;
      }
      return m;
    },
    normal: (x, y, z, out) => out,
    inRegion: null,
  };
}
