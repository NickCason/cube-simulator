// The gel gun: it shoots jelly. Hold and it lobs out globs of the cube's own
// jelly - real jelly from the moment it leaves the nozzle, each a lumpy
// little blob of it (its own piece of the body: see SoftBody.addBlob). It
// flies in an arc, wobbling; where it lands on jelly it splats on and sinks
// in, and in a moment it's gone into it: the jelly it hit has swollen there
// by all of it. It builds the cube up - glob on glob, lump on lump, as heavy
// as what went in - one skin, one jelly (what grows is the jelly's own rest
// shape, round where it hit: SoftBody's tVS), and a spot that's taken all it
// can spreads what comes next wider round it. No limit but how far jelly
// will swell. A miss lands on the floor, a blob there (a few of those). A
// Re-cube shakes it all off: the goo flies off where it built up as the
// swelling goes down, and what's flung and what's on the floor dissolves.

import * as THREE from 'three';
import { HoleGunTool } from './basic.js';
import { REST_STEP } from '../sim/softbody.js';
import { restCentres, swellCandidates, swell } from '../sim/swell.js';

const RATE = 4; // globs a second, held (each one's a rebuild of the body as it comes, and goes)
const GLOB = 0.008; // a glob's jelly, as a share of the cube's volume
const MAX_FLY = 10; // (in the air at once: more, the oldest goes)
const MAX_FLOOR = 10; // (missed, lying on the floor: more, the oldest goes)
const WELDS = 10; // (nails a landed glob's held on with as it sinks in)
const COMPLIANCE = 3e-4; // (soft: it's drawn in, not wrenched)
const DAMP = 0.3; // (the motion at its nails damped, a substep)
const CALM = 3; // (a landed glob's motion apart from the jelly under it dies away at this rate, a second)
const SINK_T = 0.09; // (s: landed to gone - into the jelly it hit)
const GROW_T = 0.3; // (s: the jelly it went into swelling by it)

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
    // the blobs out there: { tag, cube, slot, r, state: fly | sink | gone | floor, t, tries, welds, verts, tets }
    this.blobs = [];
    this.nextTag = 1;
    this._topo = -1;
    this._rc = null; // (the tets' middles at rest, for the topology they're for)
    this.grows = []; // (jelly swelling with globs gone into it: { into, vol, t, given })
    // (their nails ride through cuts like the nail gun's - and a Re-cube
    // shakes the goo off: see _healStart)
    app.anchorProviders.push(() => this.anchors());
    app.onHealStart.push(() => this._healStart());
  }

  activate() {
    super.activate();
    this.gelMat.color.set(this.app.color || '#d4102a');
  }

  // (a glob only - no bullet: the hole gun's down shoots one - and it goes
  // the moment it's pressed: left to the next frame, a quick tap - a press
  // let go before that frame came - fired nothing at all)
  down(e, ray) {
    this.firing = true;
    this.ray.copy(ray);
    if (this.cool <= 0) this.fire();
    return true;
  }

  anchors() {
    const out = [];
    for (const b of this.blobs) for (const w of b.welds) out.push(w.a, w.b);
    return out;
  }

  // Which vertices and tets are whose (after anything that changed the body:
  // a cut, a heal, another blob): from their tags. A blob all gone is
  // forgotten; a nail the body dropped too.
  _sync(force = false) {
    const sb = this.app.sb;
    if (!force && sb.topoVersion === this._topo) return;
    this._topo = sb.topoVersion;
    if (!this.blobs.length) return;
    const by = new Map(this.blobs.map((b) => [b.tag, (b.verts = [])]));
    const byT = new Map(this.blobs.map((b) => [b.tag, (b.tets = [])]));
    for (let i = 0; i < sb.nV; i++) {
      const t = sb.vTag[i];
      if (t) by.get(t)?.push(i);
    }
    for (let t = 0; t < sb.nT; t++) {
      const g = sb.vTag[sb.T[t * 4]];
      if (g) byT.get(g)?.push(t);
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
    // aimed to land on what's under the cursor (missing the jelly: the floor
    // there): lobbed - a flight time for the distance, and the throw that
    // lands it there in that time, under this world's gravity. (At one set
    // speed the gun reached under two metres - the room's gravity is 2.2 g
    // - and a cube further off it fell short of, or flew straight at and
    // dropped under.)
    // (how big: the Cubicle's glob size - its radius - held to what a place
    // of its own beside the cube has room for)
    const gs = Math.min(1.7, Math.max(0.6, app.st?.globSize ?? 1));
    const r = Math.cbrt((3 * GLOB) / (4 * Math.PI)) * size * gs * (0.8 + Math.random() * 0.4);
    const hit = app.pickJelly(this.ray);
    let goal;
    // (its middle aimed a radius out from the spot: it's the glob's front
    // that's to land there, not its middle)
    if (hit) goal = new THREE.Vector3(...hit.point).addScaledVector(new THREE.Vector3(...hit.normal), r * 0.85);
    else {
      const r = this.ray, t = r.direction.y < -1e-3 ? -r.origin.y / r.direction.y : 4;
      goal = r.origin.clone().addScaledVector(r.direction, Math.min(t, 8));
    }
    const g = -(sb.p.gravity || -22) * (sb.gravityScale ?? 1), d = goal.clone().sub(muzzle), dist = d.length();
    const T = 0.16 + 0.085 * dist; // (s: a lob, flatter close up)
    const v = d.multiplyScalar(1 / T);
    v.y += 0.5 * g * T;
    this.aimT = T;
    // The gun's held out in front of the camera - often beyond the arena's
    // edge, where the world keeps everything in: a glob born out there was
    // shoved back in, hard, the instant it was made, and flew off into the
    // middle of the cube or over its top, wherever it was aimed. It's made
    // instead at the first point of its arc inside the edge, going as fast
    // as it would be by then.
    const P = sb.p, edge = Math.max(0.2, P.arenaRadius - 0.04 - 0.3 * size);
    const inside = (t) => {
      const px = muzzle.x + v.x * t, pz = muzzle.z + v.z * t;
      return P.box ? Math.abs(px) < edge && Math.abs(pz) < edge : px * px + pz * pz < edge * edge;
    };
    let t0 = 0;
    if (!inside(0)) {
      for (let k = 1; k <= 40; k++) {
        if (inside((T * k) / 40)) {
          t0 = (T * k) / 40;
          break;
        }
      }
    }
    if (t0 > 0) {
      muzzle.set(muzzle.x + v.x * t0, muzzle.y + v.y * t0 - 0.5 * g * t0 * t0, muzzle.z + v.z * t0);
      v.y -= g * t0;
    }
    // (the oldest in the air goes, past the most there can be)
    this._sync();
    const flying = this.blobs.filter((b) => b.state === 'fly');
    if (flying.length >= MAX_FLY) flying[0].state = 'gone';
    this._sweep();
    // A glob of the cube in the gun's jelly - its size its share of that
    // cube - its rest shape off to one side of the cube's (a place of its
    // own, so nothing else's rest shape overlaps it), at a height on it
    // picked at random: a layered cube's globs come in its colours.
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
    this.blobs.push({ tag, cube: k, slot, r, state: 'fly', t: 0, tries: 0, welds: [], verts: [], tets: [] });
    this._sync(true);
    this.recoil = Math.min(1.2, this.recoil + 0.55);
    app.audio?.squish(0.35, 1.5);
  }

  update(dt, rdt) {
    // (the time till the next glob runs down held or not: it only ran while
    // the trigger was held, so a click after a glob found it still waiting,
    // got 60 ms nearer, and fired nothing - most clicks did nothing)
    if (!this.firing) this.cool = Math.max(0, this.cool - (rdt || dt));
    super.update(dt, rdt);
    const t = rdt || dt;
    // (the tank: wobbling as it's pumped)
    if (this.tank) {
      const w = 1 + 0.06 * Math.sin(performance.now() * 0.03) * Math.min(1, this.recoil);
      this.tank.scale.set(w, 2 - w, w);
    }
    this._fly(Math.min(t, 1 / 30));
    this._sweep();
    if (this.grows.length && !this.app.healer?.active) this._grows(Math.min(t, 1 / 30));
  }

  // The globs in flight: where one's about to touch jelly it lands and sinks
  // in; one that comes down on the floor stays there. The ones landed sink.
  _fly(dt) {
    const app = this.app, sb = app.sb;
    this._sync();
    for (const b of this.blobs) {
      if (b.state === 'sink') {
        this._calm(b, dt);
        this._sink(b, dt);
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
      if (hit && (hit.piece === own || !this._takes(hit))) hit = null;
      // (or it's already touching one - side on, round an edge: what it's
      // touching, where its push came from - see SoftBody._emitImpacts)
      const q = sb._impPartner?.[own] ?? -1;
      if (!hit && q >= 0 && q !== own && sb.pieces[q]) {
        const I = sb._imp, o = own * 12 + 8, J = I[o];
        if (J > 0) {
          const dx = I[o + 1] / J - cx, dy = I[o + 2] / J - cy, dz = I[o + 3] / J - cz, L = Math.hypot(dx, dy, dz) || 1;
          const h2 = sb.raycast(cx, cy, cz, dx / L, dy / L, dz / L, L + b.r);
          if (h2 && h2.piece === q && this._takes(h2)) hit = h2;
        }
      }
      if (hit) this._land(b, hit, [cx, cy, cz], sp);
      else if (y0 < 0.06 || b.t > 4) {
        b.state = 'floor';
        b.at = performance.now();
        if (y0 < 0.09) {
          for (let q = 0; q < 3; q++) app.droplets.spawn(new THREE.Vector3(cx, 0.02, cz), new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.6 + Math.random(), (Math.random() - 0.5) * 1.6), b.r * (0.18 + Math.random() * 0.15), app.flavorColorAt(cx, cy, cz));
          app.audio?.splat(0.35);
        }
      }
    }
  }

  // What a glob landing here goes into: the cube's jelly, or a blob that's
  // landed (on the floor: it grows; sinking into the cube: on into that) -
  // not one still flying.
  _target(hit) {
    const sb = this.app.sb, tag = sb.vTag[sb.T[hit.tet * 4]];
    if (!tag) return { k: sb.tCube[hit.tet], tag: 0 };
    const b = this.blobs.find((x) => x.tag === tag);
    if (!b || b.state === 'fly') return null;
    if (b.state === 'sink' || b.state === 'gone') return b.into ? { ...b.into, chain: true } : null;
    return { k: sb.tCube[hit.tet], tag };
  }

  _takes(hit) {
    return !!this._target(hit);
  }

  // It lands: held on where it touched - each of its points on the side
  // it's coming in on tethered to the jelly's skin right under it (it rests
  // on the jelly, not in it: the two still push each other apart) - and from
  // then it melts in (see _sink), riding the swell it makes.
  _land(b, hit, c, sp) {
    const app = this.app, sb = app.sb, T = sb.T, x = sb.x, X = sb.X;
    const into = this._target(hit);
    if (!into) return;
    const [hx, hy, hz] = hit.point, [nx, ny, nz] = hit.normal;
    const own = sb.vPiece[b.verts[0]];
    // where it goes in, at rest (where the jelly will grow): the spot hit,
    // in the jelly it's in - or, landing on one going in, where that goes
    if (!into.chain) {
      const r = sb.locate(hx - nx * 0.004, hy - ny * 0.004, hz - nz * 0.004, hit.piece);
      if (!r) return;
      const tb = r.bary.map((v) => Math.max(0, v)), ts = tb[0] + tb[1] + tb[2] + tb[3] || 1;
      into.P = [0, 1, 2].map((q) => {
        let s = 0;
        for (let k = 0; k < 4; k++) s += (X[T[r.tet * 4 + k] * 3 + q] * tb[k]) / ts;
        return s;
      });
      into.R = Math.max(1.5 * b.r, 1.6 * (sb.cH[into.k] || sb.hCell));
      into.W = [hx, hy, hz];
    }
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
      // (on the skin: the point rests anywhere within a short tether of it,
      // outside the jelly - tied to a spot inside, it would dive in)
      const qx = rh.point[0] - rh.normal[0] * 0.0005, qy = rh.point[1] - rh.normal[1] * 0.0005, qz = rh.point[2] - rh.normal[2] * 0.0005;
      const r = sb.locate(qx, qy, qz, rh.piece);
      if (!r || !(r.score > -0.05)) continue;
      // (held inside its tet: a point reckoned from outside one swings
      // further than the tet moves, and a nail on it shakes things up)
      const tb = r.bary.map((v) => Math.max(0, v)), ts = tb[0] + tb[1] + tb[2] + tb[3];
      for (let q = 0; q < 4; q++) tb[q] /= ts;
      const [tt, q] = cornerOf.get(i), bb = [0, 0, 0, 0];
      bb[q] = 1;
      const w = { a: { tet: tt, b: bb }, b: { tet: r.tet, b: tb }, len: 0.003, compliance: COMPLIANCE, damp: DAMP, pair: true };
      sb.embeds.push(w);
      b.welds.push(w);
      sb.wake(rh.piece);
    }
    // (nothing to hold on to from here: another look next frame, a few
    // times, then it's on its own - it bounced off, and lies where it ends up)
    if (!b.welds.length) {
      if (++b.tries >= 4) {
        b.state = 'floor';
        b.at = performance.now();
      }
      return;
    }
    b.state = 'sink';
    b.into = into;
    b.mt = 0;
    b.given = 0;
    // (all the jelly it is: what goes in)
    b.vol = 0;
    b.vs0 = new Map();
    for (const t of b.tets) {
      b.vol += sb.vol0[t] * sb.tVS[t];
      b.vs0.set(t, sb.tVS[t]);
    }
    app.tally?.('gelled');
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

  // Melting in: its own jelly goes down to nothing, quickly (shrinking, it
  // thins, and a thin one shows clear - a pale bead on the jelly), and it's
  // gone; the jelly it hit swells round the spot by as much (see _grows).
  _sink(b, dt) {
    const sb = this.app.sb;
    if (!b.mt) this.grows.push({ into: b.into, vol: b.vol, t: 0, given: 0 });
    b.mt += dt;
    const u = Math.min(1, b.mt / SINK_T);
    const keep = 1 - 0.997 * (1 - Math.pow(1 - u, 2));
    for (const t of b.tets) sb.tVS[t] = (b.vs0.get(t) ?? 1) * keep;
    sb.wake(sb.vPiece[b.verts[0]]);
    if (u >= 1) b.state = 'gone';
  }

  // The jelly swelling with what's gone into it, eased in - and what a spot
  // swollen as far as it goes all round can't take, running off it.
  _grows(dt) {
    const app = this.app;
    for (const g of this.grows) {
      g.t += dt;
      const u = Math.min(1, g.t / GROW_T), e = u * u * (3 - 2 * u);
      g.spill = (g.spill || 0) + this._grow(g.into, g.vol * (e - g.given));
      g.given = e;
      if (e >= 1 && g.spill > 0.15 * g.vol && g.into.W) {
        const [x, y, z] = g.into.W, col = app.flavorColorAt(x, y, z), r = Math.cbrt((3 * g.spill) / (4 * Math.PI));
        for (let q = 0; q < 2; q++) app.droplets.spawn(new THREE.Vector3(x, y, z), new THREE.Vector3((Math.random() - 0.5) * 0.8, -0.3 - Math.random() * 0.6, (Math.random() - 0.5) * 0.8), Math.max(0.012, r * 0.62), col);
      }
    }
    this.grows = this.grows.filter((g) => g.given < 1);
  }

  // The tets' middles at rest (for this topology).
  _restC() {
    const sb = this.app.sb;
    if (this._rc && this._rc.topo === sb.topoVersion && this._rc.n === sb.nT) return this._rc.c;
    this._rc = { c: restCentres(sb), topo: sb.topoVersion, n: sb.nT };
    return this._rc.c;
  }

  // The jelly swells by dV round where a glob went in (see sim/swell.js);
  // what the spot can't take, handed back.
  _grow(into, dV) {
    const sb = this.app.sb;
    if (!(dV > 0)) return 0;
    if (into.topo !== sb.topoVersion || !into.cand) {
      into.cand = swellCandidates(sb, this._restC(), into.k, into.tag, into.P, into.R);
      into.topo = sb.topoVersion;
    }
    const left = swell(sb, into.cand, into.R, dV);
    for (let q = 0; q < Math.min(into.cand.length, 8); q += 2) sb.wake(sb.tPiece[into.cand[q]]);
    return left;
  }

  // The gone ones out of the body (each a rebuild), and the floor's oldest
  // past the most there can be.
  _sweep() {
    const app = this.app, sb = app.sb;
    const floor = this.blobs.filter((b) => b.state === 'floor');
    for (let q = 0; q < floor.length - MAX_FLOOR; q++) floor[q].state = 'gone';
    const gone = this.blobs.filter((b) => b.state === 'gone');
    if (!gone.length) return;
    const drop = new Set();
    for (const b of gone) for (const i of b.verts) drop.add(sb.vPiece[i]);
    this.blobs = this.blobs.filter((b) => b.state !== 'gone');
    if (!drop.size) return;
    sb.removePieces(drop);
    sb.rebuild();
    app.onTopologyChanged();
    this._sync(true);
  }

  // A landed glob moves as the jelly under it does, give or take a wobble:
  // its motion apart from that dies away (as the jelly's own wobble does).
  // The body only calms a piece's wobble, not how it moves as a whole - a
  // thrown piece keeps going - and a glob hung on its nails swung and rocked
  // on them for ever.
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

  // A Re-cube shakes the goo off: it flies off the jelly where it built up
  // (the swelling going down as the cube re-forms - see Healer), every glob
  // still about bursts, and all of it - flung, and what was on the floor -
  // splats and dissolves: none of it goes back in.
  _healStart() {
    const app = this.app, sb = app.sb, only = app.healer?.only ?? -1, T = sb.T;
    this._sync(true);
    this.grows = this.grows.filter((g) => only >= 0 && g.into.k !== only);
    // where it built up: how much over its own each tet of jelly is
    const spots = [];
    let excess = 0;
    for (let t = 0; t < sb.nT; t++) {
      if (!(sb.vol0[t] > 0) || sb.tVS[t] <= 1.15 || sb.vTag[T[t * 4]] || (only >= 0 && sb.tCube[t] !== only)) continue;
      const e = sb.vol0[t] * (sb.tVS[t] - 1);
      excess += e;
      if (sb.tetBoundary?.[t] >= 0) spots.push(t, e);
    }
    if (excess > 0 && spots.length) {
      const n = Math.min(56, 6 + Math.round(Math.sqrt(excess / 2e-4)));
      let tot = 0;
      for (let q = 1; q < spots.length; q += 2) tot += spots[q];
      // (flung out from the middle of the jelly it's on)
      const ctr = new THREE.Vector3();
      let cn = 0;
      for (let i = 0; i < sb.nV; i++) {
        if (sb.vTag[i] || !sb.alive[i] || (only >= 0 && sb.vCube[i] !== only)) continue;
        ctr.x += sb.x[i * 3]; ctr.y += sb.x[i * 3 + 1]; ctr.z += sb.x[i * 3 + 2];
        cn++;
      }
      ctr.multiplyScalar(1 / Math.max(1, cn));
      for (let k = 0; k < n; k++) {
        // (a spot, the more built up the likelier)
        let pick = Math.random() * tot, q = 0;
        for (; q < spots.length - 2 && pick > spots[q + 1]; q += 2) pick -= spots[q + 1];
        const t = spots[q];
        const p = new THREE.Vector3();
        for (let j = 0; j < 4; j++) {
          const o = T[t * 4 + j] * 3;
          p.x += sb.x[o] / 4; p.y += sb.x[o + 1] / 4; p.z += sb.x[o + 2] / 4;
        }
        const out = p.clone().sub(ctr);
        out.y = Math.max(out.y, 0) + 0.3;
        out.normalize();
        const v = out.multiplyScalar(1.6 + Math.random() * 2.2);
        v.y += 1.2 + Math.random() * 1.2;
        const r = Math.cbrt((3 * ((excess * 0.6) / n)) / (4 * Math.PI)) * (0.7 + Math.random() * 0.6);
        app.droplets.spawn(p, v, Math.min(0.09, Math.max(0.012, r)), app.flavorColorAt(p.x, p.y, p.z), { fade: 1.3 + Math.random() * 0.9 });
      }
      app.audio?.splat(Math.min(1, 0.4 + excess * 8));
      app.audio?.squish(0.7, 0.7);
    }
    // ...and the globs: burst, the same
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
      for (let q = 0; q < 3; q++) app.droplets.spawn(p.clone(), new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2), b.r * (0.25 + Math.random() * 0.15), col, { fade: 1 + Math.random() * 0.8 });
    }
    sb.removePieces(drop);
    sb.rebuild();
    app.onTopologyChanged();
    this.blobs = this.blobs.filter((b) => !go.includes(b));
    this._sync(true);
  }
}
