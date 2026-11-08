// The gel gun: it shoots jelly. Hold and it lobs out globs of the cube's own
// jelly - real jelly from the moment it leaves the nozzle, each a lumpy
// little blob of it (its own piece of the body: see SoftBody.addBlob). It
// flies in an arc, wobbling; where it lands it splats and sticks - tethered
// on where it touched, then, once it's squashed on, glued as it landed
// (nails that hold both ways, and the two no longer push each other out:
// see SoftBody.embeds, _solvePieceCollisions). A lump of jelly on the
// jelly: it wobbles with it, refracts, throws its light, cuts open like the
// rest; globs on globs make a heap. A miss lands on the floor, a blob there.
// A Re-cube takes them back (they burst, and stream home).

import * as THREE from 'three';
import { HoleGunTool } from './basic.js';
import { REST_STEP } from '../sim/softbody.js';

const RATE = 3.5; // globs a second, held (each one's a rebuild of the body)
const SPEED = 6.5; // m/s out of the nozzle
const GLOB = 0.008; // a glob's jelly, as a share of the cube's volume
const MAX_BLOBS = 16; // (more: the oldest goes)
const WELDS = 10; // (nails a glob's stuck on with)
const COMPLIANCE = 3e-4; // (landing: soft - it squashes on, it isn't wrenched into place)
const SET_AT = 0.3; // (s after it lands: it's set - see _set)
const DAMP = 0.05, SET_DAMP = 0.8; // (the motion at its nails damped, a substep: landing, then set)
const CALM = 3; // (a stuck glob's motion apart from the jelly under it dies away at this rate, a second)

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
    // (the tank: the jelly's colour, glossy, a little see-through)
    this.gelMat = new THREE.MeshStandardMaterial({ color: 0xd4102a, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.82, envMap: app.env.texture, envMapIntensity: 1.1 });
    this.model = makeGelGun(app.M, this.gelMat);
    this.model.visible = false;
    this.model.traverse((o) => (o.castShadow = false));
    app.scene.add(this.model);
    this.tank = this.model.getObjectByName('tank');
    // the blobs out there: { tag, cube, slot, r, state: fly | stuck | loose | floor, t, tries, welds, verts }
    this.blobs = [];
    this.nextTag = 1;
    this._topo = -1;
    // (their nails ride through cuts like the nail gun's - and a Re-cube
    // bursts the cube's: see _healStart)
    app.anchorProviders.push(() => this.anchors());
    app.onHealStart.push(() => this._healStart());
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

  anchors() {
    const out = [];
    for (const b of this.blobs) for (const w of b.welds) out.push(w.a, w.b);
    return out;
  }

  // Which vertices are whose (after anything that changed the body: a cut,
  // a heal, another blob): from their tags. A blob all gone is forgotten;
  // a nail the body dropped too.
  _sync(force = false) {
    const sb = this.app.sb;
    if (!force && sb.topoVersion === this._topo) return;
    this._topo = sb.topoVersion;
    if (!this.blobs.length) return;
    const by = new Map(this.blobs.map((b) => [b.tag, (b.verts = [])]));
    for (let i = 0; i < sb.nV; i++) {
      const t = sb.vTag[i];
      if (t) by.get(t)?.push(i);
    }
    const live = new Set(sb.embeds);
    this.blobs = this.blobs.filter((b) => b.verts.length > 0);
    for (const b of this.blobs) b.welds = b.welds.filter((w) => live.has(w));
  }

  fire() {
    const app = this.app, sb = app.sb;
    this.cool = 1 / (RATE * (app.st?.globRate ?? 1)); // (how fast: the Cubicle's)
    if (sb.nT > 30000 || app.healer?.active) return;
    const k = app.cube?.slot ?? 0, size = sb.cSize[k] || sb.p.size;
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
    // (the oldest goes, past the most there can be)
    this._sync();
    const drop = new Set();
    while (this.blobs.length >= MAX_BLOBS) for (const i of this.blobs.shift().verts) drop.add(sb.vPiece[i]);
    if (drop.size) sb.removePieces(drop);
    // A glob of the cube in the gun's jelly - its size its share of that
    // cube - its rest shape off to one side of the cube's (a place of its
    // own, so nothing else's rest shape overlaps it), at a height on it
    // picked at random: a layered cube's globs come in its colours.
    // (how big: the Cubicle's glob size - its radius - held to what a place
    // of its own beside the cube has room for)
    const gs = Math.min(1.7, Math.max(0.6, app.st?.globSize ?? 1));
    const r = Math.cbrt((3 * GLOB) / (4 * Math.PI)) * size * gs * (0.8 + Math.random() * 0.4);
    const used = new Set(this.blobs.filter((b) => b.cube === k).map((b) => b.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const rMax = Math.cbrt((3 * GLOB) / (4 * Math.PI)) * size * gs * 1.2;
    const R = [k * REST_STEP + ((slot % 4) - 1.5) * 3 * rMax, (Math.random() - 0.5) * (size - 2 * rMax), size / 2 + 1.8 * rMax + Math.floor(slot / 4) * 3 * rMax];
    const tag = this.nextTag;
    this.nextTag = (this.nextTag % 65535) + 1;
    const base = sb.addBlob(k, [muzzle.x, muzzle.y, muzzle.z], [v.x, v.y, v.z], r, R, tag);
    sb.rebuild();
    app.onTopologyChanged();
    sb.wake(sb.vPiece[base]);
    this.blobs.push({ tag, cube: k, slot, r, state: 'fly', t: 0, tries: 0, welds: [], verts: [] });
    this._sync(true);
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

  // The globs in flight: where one's about to touch other jelly it sticks;
  // one that comes down on the floor stays there.
  _fly(dt) {
    const app = this.app, sb = app.sb;
    this._sync();
    for (const b of this.blobs) {
      if (b.state === 'stuck') {
        if (!b.set && (b.st += dt) > SET_AT) this._set(b);
        this._calm(b, dt);
      }
      if (b.state !== 'fly') continue;
      b.t += dt;
      let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0, y0 = Infinity;
      for (const i of b.verts) {
        cx += sb.x[i * 3]; cy += sb.x[i * 3 + 1]; cz += sb.x[i * 3 + 2];
        vx += sb.v[i * 3]; vy += sb.v[i * 3 + 1]; vz += sb.v[i * 3 + 2];
        y0 = Math.min(y0, sb.x[i * 3 + 1]);
      }
      const n = b.verts.length;
      cx /= n; cy /= n; cz /= n; vx /= n; vy /= n; vz /= n;
      const sp = Math.hypot(vx, vy, vz), own = sb.vPiece[b.verts[0]];
      // (looked ahead from its middle, as far as it'll get by the next
      // frame: front faces only, so its own skin, seen from inside, doesn't
      // count)
      let hit = sp > 0.3 ? sb.raycast(cx, cy, cz, vx / sp, vy / sp, vz / sp, b.r * 1.05 + sp * dt) : null;
      if (hit && hit.piece === own) hit = null;
      // (or it's already touching one - side on, round an edge: what it's
      // touching, where its push came from - see SoftBody._emitImpacts)
      const q = sb._impPartner?.[own] ?? -1;
      if (!hit && q >= 0 && q !== own && sb.pieces[q]) {
        const I = sb._imp, o = own * 12 + 8, J = I[o];
        if (J > 0) {
          const dx = I[o + 1] / J - cx, dy = I[o + 2] / J - cy, dz = I[o + 3] / J - cz, L = Math.hypot(dx, dy, dz) || 1;
          const h2 = sb.raycast(cx, cy, cz, dx / L, dy / L, dz / L, L + b.r);
          if (h2 && h2.piece === q) hit = h2;
        }
      }
      if (hit) this._stick(b, hit, [cx, cy, cz], [vx / sp, vy / sp, vz / sp], sp);
      else if (y0 < 0.06 || b.t > 4) {
        b.state = 'floor';
        if (y0 < 0.09) {
          for (let q = 0; q < 3; q++) app.droplets.spawn(new THREE.Vector3(cx, 0.02, cz), new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.6 + Math.random(), (Math.random() - 0.5) * 1.6), b.r * (0.18 + Math.random() * 0.15), app.flavorColorAt(cx, cy, cz));
          app.audio?.splat(0.35);
        }
      }
    }
  }

  // It touches: nailed on where it touched - each of its points on the side
  // it's coming in on to the jelly right under it (the cube, or a glob
  // already there: a heap) - short nails, softish, so it's pulled on and
  // squashed against it: a splat that stays.
  _stick(b, hit, c, d, sp) {
    const app = this.app, sb = app.sb, T = sb.T, x = sb.x;
    const [hx, hy, hz] = hit.point, [nx, ny, nz] = hit.normal;
    const own = sb.vPiece[b.verts[0]];
    // (each of its points: a tet of its own it's a corner of)
    const cornerOf = new Map();
    for (const tt of sb.pieces[own]?.tets || []) for (let q = 0; q < 4; q++) if (!cornerOf.has(T[tt * 4 + q])) cornerOf.set(T[tt * 4 + q], [tt, q]);
    const lead = b.verts
      .filter((i) => cornerOf.has(i))
      .map((i) => [i, (x[i * 3] - c[0]) * -nx + (x[i * 3 + 1] - c[1]) * -ny + (x[i * 3 + 2] - c[2]) * -nz])
      .sort((p, q) => q[1] - p[1])
      .slice(0, WELDS * 2);
    for (const [i] of lead) {
      if (b.welds.length >= WELDS) break;
      // (the jelly under the point: looked for from well back - it may
      // have sunk in a little already - straight in toward what it hit,
      // through the glob itself)
      const o = i * 3, back = 0.2;
      const rh = sb.raycast(x[o] + nx * back, x[o + 1] + ny * back, x[o + 2] + nz * back, -nx, -ny, -nz, back + 0.25, own);
      if (!rh) continue;
      const qx = rh.point[0] - rh.normal[0] * 0.0005, qy = rh.point[1] - rh.normal[1] * 0.0005, qz = rh.point[2] - rh.normal[2] * 0.0005;
      const r = sb.locate(qx, qy, qz, rh.piece);
      if (!r || !(r.score > -0.05)) continue;
      // (held inside its tet: a point reckoned from outside one swings
      // further than the tet moves, and a nail on it shakes things up)
      const tb = r.bary.map((v) => Math.max(0, v)), ts = tb[0] + tb[1] + tb[2] + tb[3];
      for (let q = 0; q < 4; q++) tb[q] /= ts;
      const [tt, q] = cornerOf.get(i), bb = [0, 0, 0, 0];
      bb[q] = 1;
      // (a short tether to the spot on its skin: the point rests anywhere
      // within it, outside the jelly. Tied to a spot inside instead, the
      // one place it could rest was a single point - shifted at all, the
      // tether pulled it in and the jelly pushed it out, and it trembled.)
      const w = { a: { tet: tt, b: bb }, b: { tet: r.tet, b: tb }, len: 0.003, compliance: COMPLIANCE, damp: DAMP, pair: true };
      sb.embeds.push(w);
      b.welds.push(w);
      sb.wake(rh.piece);
    }
    // (nothing to hold on to from here: another look next frame, a few
    // times, then it's loose - it bounced off)
    if (!b.welds.length) {
      if (++b.tries >= 4) b.state = 'loose';
      return;
    }
    b.state = 'stuck';
    b.st = 0;
    app.tally?.('gelled');
    b.n = [nx, ny, nz];
    sb.wake(own);
    // the splat: a few drops off it, a wet slap, a glow where it landed
    const col = app.flavorColorAt(hx, hy, hz);
    const nv = new THREE.Vector3(nx, ny, nz);
    for (let q = 0; q < 4; q++) {
      const dir = nv.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).multiplyScalar(1.3)).normalize();
      app.droplets.spawn(new THREE.Vector3(hx, hy, hz).addScaledVector(dir, 0.03), dir.multiplyScalar(1 + Math.random() * 1.5 * Math.min(1, sp / 6)), b.r * (0.14 + Math.random() * 0.12), col);
    }
    app.audio?.splat(0.6);
    app.audio?.squish(0.55, 0.8);
    app.glowPulse?.(hx, hy, hz, 0.3);
    app.markDamaged();
  }

  // A glob stuck on moves as the jelly under it does, give or take a
  // wobble: its motion apart from that dies away (as the jelly's own wobble
  // does). The body only calms a piece's wobble, not how it moves as a
  // whole - a thrown piece keeps going - and a glob hung on its nails swung
  // and rocked on them for ever.
  _calm(b, dt) {
    const sb = this.app.sb, v = sb.v, T = sb.T, P = sb.pieces;
    const own = P[sb.vPiece[b.verts[0]]];
    if (!own || own.asleep || !b.welds.length) return;
    let rx = 0, ry = 0, rz = 0, n = 0;
    for (const w of b.welds) {
      if (w.b.tet < 0 || w.b.tet >= sb.nT) continue;
      for (let k = 0; k < 4; k++) {
        const o = T[w.b.tet * 4 + k] * 3, bk = w.b.b[k];
        rx += v[o] * bk; ry += v[o + 1] * bk; rz += v[o + 2] * bk;
      }
      n++;
    }
    if (!n) return;
    rx /= n; ry /= n; rz /= n;
    const f = Math.exp(-CALM * dt);
    for (const i of b.verts) {
      const o = i * 3;
      v[o] = rx + (v[o] - rx) * f; v[o + 1] = ry + (v[o + 1] - ry) * f; v[o + 2] = rz + (v[o + 2] - rz) * f;
    }
  }

  // Landed and squashed: it's glued on as it landed - each nail re-tied to
  // a spot a little inside what's under it, held at the length it is now
  // both ways, and the two no longer push each other out (pushed out by the
  // jelly and pulled in by its nails, they never quite agreed: it trembled,
  // and now and then shook itself up). The motion at its nails is damped.
  _set(b) {
    const sb = this.app.sb, x = sb.x, T = sb.T, p = [0, 0, 0], q = [0, 0, 0];
    b.set = true;
    for (const w of b.welds) {
      if (w.a.tet < 0 || w.a.tet >= sb.nT || w.b.tet < 0 || w.b.tet >= sb.nT) continue;
      sb.embedPoint(w.a.tet, w.a.b, p);
      sb.embedPoint(w.b.tet, w.b.b, q);
      // (a centimetre in, along the way from it to the spot it's tied to -
      // or, there already, straight down the nail's way in: two ends all
      // but on top of each other can't say which way to hold)
      const target = sb.tPiece[w.b.tet];
      let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], L = Math.hypot(dx, dy, dz);
      if (L < 1e-4) {
        [dx, dy, dz] = b.n;
        dx = -dx; dy = -dy; dz = -dz;
        L = 1;
      }
      dx /= L; dy /= L; dz /= L;
      const r = sb.locate(q[0] + dx * 0.01, q[1] + dy * 0.01, q[2] + dz * 0.01, target);
      if (r && r.score > -0.05) {
        const tb = r.bary.map((v) => Math.max(0, v)), ts = tb[0] + tb[1] + tb[2] + tb[3];
        w.b.tet = r.tet;
        for (let k = 0; k < 4; k++) w.b.b[k] = tb[k] / ts;
        sb.embedPoint(w.b.tet, w.b.b, q);
      }
      w.len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      w.damp = SET_DAMP;
      w.glue = true;
    }
  }

  // A Re-cube: the cube's globs (or every globs, all of them re-forming)
  // burst into drops - they stream home with the rest - and go.
  _healStart() {
    const app = this.app, sb = app.sb, only = app.healer?.only ?? -1;
    this._sync(true);
    const go = this.blobs.filter((b) => only < 0 || b.cube === only);
    if (!go.length) return;
    const drop = new Set();
    for (const b of go) {
      let cx = 0, cy = 0, cz = 0;
      for (const i of b.verts) {
        drop.add(sb.vPiece[i]);
        cx += sb.x[i * 3]; cy += sb.x[i * 3 + 1]; cz += sb.x[i * 3 + 2];
      }
      const n = b.verts.length, p = new THREE.Vector3(cx / n, cy / n, cz / n), col = app.flavorColorAt(p.x, p.y, p.z);
      for (let q = 0; q < 3; q++) app.droplets.spawn(p.clone(), new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2), b.r * (0.25 + Math.random() * 0.15), col);
    }
    sb.removePieces(drop);
    sb.rebuild();
    app.onTopologyChanged();
    this.blobs = this.blobs.filter((b) => !go.includes(b));
    this._sync(true);
  }
}
