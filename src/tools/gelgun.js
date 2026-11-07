// The gel gun: it shoots jelly instead of holes. Hold and it pumps out globs
// of the jelly in its tank, lobbed in an arc, wobbling as they fly, and
// where one lands it splats and soaks in: the jelly there swells (its little
// pieces grow in volume, as under the syringe - see SoftBody tVS), so the
// cube grows a lump of itself. Real jelly - it refracts, throws its coloured
// light, wobbles and cuts open like the rest; lumps on lumps; a Re-cube
// takes them back. A miss splats on the floor.

import * as THREE from 'three';
import { HoleGunTool } from './basic.js';

const RATE = 7; // globs a second, held
const SPEED = 6.5; // m/s out of the nozzle
const GLOB = 0.008; // a glob's jelly, as a share of the cube's volume
const MAX_VS = 3.4; // (no little piece of jelly swells past this; the rest spreads round it)
const MAX_GLOBS = 24;

// the gun: a chunky squirt gun - body, grip, nozzle, and a tank of the jelly on top
function makeGelGun(M, tankMat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, 0.24), M.orange);
  body.position.set(0, 0, 0);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.06), M.rubber);
  grip.position.set(0, -0.085, 0.07);
  grip.rotation.x = -0.25;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.1, 16), M.steel);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.005, -0.16);
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 16), tankMat);
  tank.position.set(0, 0.075, 0.02);
  tank.name = 'tank';
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 16), M.steel);
  cap.position.set(0, 0.135, 0.02);
  const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 12), M.steel);
  pump.rotation.x = Math.PI / 2;
  pump.position.set(0, -0.02, -0.05);
  g.add(body, grip, nozzle, tank, cap, pump);
  return g;
}

export class GelGunTool extends HoleGunTool {
  constructor(app) {
    super(app);
    this.id = 'gelgun';
    this.background = true; // (globs in flight land even after a change of tool)
    app.scene.remove(this.model);
    // (the jelly: its colour the cube's; see of glossy, a little see-through)
    this.gelMat = new THREE.MeshStandardMaterial({ color: 0xd4102a, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.82, envMap: app.env.texture, envMapIntensity: 1.1 });
    this.model = makeGelGun(app.M, this.gelMat);
    this.model.visible = false;
    this.model.traverse((o) => (o.castShadow = false));
    app.scene.add(this.model);
    this.tank = this.model.getObjectByName('tank');
    // the globs in flight
    this.globs = [];
    this.globMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), this.gelMat, MAX_GLOBS);
    this.globMesh.count = 0;
    this.globMesh.frustumCulled = false;
    this.globMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    app.scene.add(this.globMesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._massT = 0;
  }

  activate() {
    super.activate();
    this.gelMat.color.set(this.app.color || '#d4102a');
  }

  // (a glob only - no shot on the way down)
  down(e, ray) {
    this.firing = true;
    this.ray.copy(ray);
    this.cool = 0;
    return true;
  }

  fire() {
    const app = this.app, sb = app.sb;
    this.cool = 1 / RATE;
    if (this.globs.length >= MAX_GLOBS) return;
    const muzzle = this.model.localToWorld(new THREE.Vector3(0, 0.005, -0.22));
    // aimed to land on what's under the cursor: lobbed - the arc that gets
    // there at this speed (the flatter of the two), else straight at it
    const hit = app.pickJelly(this.ray);
    const goal = hit ? new THREE.Vector3(...hit.point) : this.ray.origin.clone().addScaledVector(this.ray.direction, 4);
    const g = -(sb.p.gravity || 22), d = goal.clone().sub(muzzle), h = Math.hypot(d.x, d.z), v2 = SPEED * SPEED;
    const disc = v2 * v2 - g * (g * h * h + 2 * d.y * v2);
    let v;
    if (h > 1e-3 && disc > 0) {
      const ang = Math.atan2(v2 - Math.sqrt(disc), g * h);
      v = new THREE.Vector3(d.x / h, 0, d.z / h).multiplyScalar(SPEED * Math.cos(ang));
      v.y = SPEED * Math.sin(ang);
    } else v = d.normalize().multiplyScalar(SPEED);
    // (a glob's size: its share of the cube it's aimed at)
    const size = sb.p.size, r = Math.cbrt((3 * GLOB) / (4 * Math.PI)) * size;
    this.globs.push({ p: muzzle, v, r, t: 0, ph: Math.random() * 6.28, col: this.gelMat.color.getHex() });
    this.recoil = Math.min(1.2, this.recoil + 0.55);
    app.audio?.squish(0.35, 1.5);
  }

  update(dt, rdt) {
    super.update(dt, rdt);
    const t = rdt || dt;
    // (the tank: wobbling as it's pumped)
    if (this.tank) {
      const w = 1 + 0.06 * Math.sin(performance.now() * 0.03) * Math.min(1, this.recoil);
      this.tank.scale.set(w, 2 - w, w);
    }
    this._fly(Math.min(t, 1 / 30));
  }

  // the globs flying: falling, wobbling; where one meets jelly it splats
  // into it, the floor, onto it
  _fly(dt) {
    const app = this.app, sb = app.sb, g = sb.p.gravity || -22;
    const prev = new THREE.Vector3();
    for (let k = this.globs.length - 1; k >= 0; k--) {
      const b = this.globs[k];
      b.t += dt;
      prev.copy(b.p);
      b.v.y += g * dt;
      b.p.addScaledVector(b.v, dt);
      const step = b.p.clone().sub(prev), len = step.length();
      const hit = len > 1e-6 ? sb.raycast(prev.x, prev.y, prev.z, step.x / len, step.y / len, step.z / len, len + b.r * 0.6) : null;
      if (hit) {
        this._splat(b, hit);
        this.globs.splice(k, 1);
      } else if (b.p.y < b.r * 0.5) {
        // (a miss: a puddle's worth of drops on the floor)
        b.p.y = b.r * 0.5;
        for (let q = 0; q < 4; q++) app.droplets.spawn(b.p.clone(), new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.6 + Math.random(), (Math.random() - 0.5) * 1.6), b.r * (0.25 + Math.random() * 0.2), '#' + b.col.toString(16).padStart(6, '0'));
        app.audio?.splat(0.35);
        this.globs.splice(k, 1);
      } else if (b.t > 3) this.globs.splice(k, 1);
    }
    // drawn: each a glob, squashed along its flight and wobbling
    let n = 0;
    for (const b of this.globs) {
      const sp = b.v.length() || 1, wob = 1 + 0.12 * Math.sin(b.t * 30 + b.ph);
      this._q.setFromUnitVectors(this._up, this._s.copy(b.v).multiplyScalar(1 / sp));
      this._s.set(b.r * wob, b.r * (1.25 / wob), b.r * wob);
      this._m.compose(b.p, this._q, this._s);
      this.globMesh.setMatrixAt(n, this._m);
      n++;
    }
    this.globMesh.count = n;
    this.globMesh.instanceMatrix.needsUpdate = true;
    this.globMesh.visible = n > 0;
  }

  // A glob meets jelly: it soaks in - the jelly round where it landed swells
  // by the glob's volume (most where it hit, less further in; a little piece
  // swollen as far as it goes passes the rest on round it) - with a splat
  _splat(b, hit) {
    const app = this.app, sb = app.sb, k = sb.tCube[hit.tet], size = sb.cSize[k] || sb.p.size;
    const [px, py, pz] = hit.point;
    let left = GLOB * size * size * size, R = 0.14 * size;
    const T = sb.T, x = sb.x, vol0 = sb.vol0, vs = sb.tVS;
    for (let pass = 0; pass < 4 && left > 1e-7; pass++) {
      const R2 = R * R, lim = 6 * R2, list = [];
      let W = 0;
      for (let t = 0; t < sb.nT; t++) {
        if (sb.tCube[t] !== k || vol0[t] <= 0 || vs[t] >= MAX_VS) continue;
        const a = T[t * 4] * 3, bb = T[t * 4 + 1] * 3, c = T[t * 4 + 2] * 3, d = T[t * 4 + 3] * 3;
        const cx = (x[a] + x[bb] + x[c] + x[d]) / 4 - px, cy = (x[a + 1] + x[bb + 1] + x[c + 1] + x[d + 1]) / 4 - py, cz = (x[a + 2] + x[bb + 2] + x[c + 2] + x[d + 2]) / 4 - pz;
        const d2 = cx * cx + cy * cy + cz * cz;
        if (d2 > lim) continue;
        const w = Math.exp(-d2 / R2);
        list.push(t, w);
        W += vol0[t] * w;
      }
      if (W > 0) {
        const per = left / W;
        left = 0;
        for (let i = 0; i < list.length; i += 2) {
          const t = list[i], add = per * list[i + 1], a = Math.min(add, MAX_VS - vs[t]);
          vs[t] += a;
          left += (add - a) * vol0[t];
        }
      }
      R *= 1.6;
    }
    // (the new jelly weighs something; at most a few times a second)
    const now = performance.now();
    if (now - this._massT > 200) {
      this._massT = now;
      sb._computeMass();
    }
    sb.wake(sb.tPiece[hit.tet]);
    const d = b.v.clone().normalize();
    sb.impulse(px, py, pz, d.x, d.y, d.z, 0.14 * size, 1.4, hit.piece);
    // the splat: a few drops off it, a wet slap, a glow where it landed
    const col = app.flavorColorAt(px, py, pz);
    const n = new THREE.Vector3(...hit.normal);
    for (let q = 0; q < 3; q++) {
      const dir = n.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).multiplyScalar(1.2)).normalize();
      app.droplets.spawn(new THREE.Vector3(px, py, pz).addScaledVector(dir, 0.02), dir.multiplyScalar(1 + Math.random() * 1.5), b.r * (0.18 + Math.random() * 0.15), col);
    }
    app.audio?.splat(0.55);
    app.audio?.squish(0.5, 0.8);
    app.glowPulse?.(px, py, pz, 0.3);
    app.markDamaged();
  }
}
