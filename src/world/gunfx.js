// The guns' show (see tools/basic.js, autogun.js, shotgun.js): what a shot looks like besides its hole.
// - its muzzle flash: a white-hot core, a star of flame round it (a few cut differently, turned at random - no two
//   alike), a tongue of flame thrown out ahead along the barrel; the room lit by it (App.fireAt) and, a big one, the
//   picture's (App.flash); a spray of sparks out ahead, and smoke rolling off forward and up
// - its spent case thrown out of its side - brass, or a shotgun's red shell - bouncing (a clink, a tock) and lying
//   where it lands a while
// - a round into the floor: its sparks, a puff of dust, its hole left in the floor (a while), now and then a ricochet
// - the gun kicks the view up (App.kick)
// Drawn over the scene (the particles' scene), lit by nothing: it's light.

import * as THREE from 'three';

const FLASH_N = 8; // (flashes at once - full auto's fourteen a second, each lasting two or three frames)
const FLASH_LIFE = 0.055; // (s)
const CASES = 120; // (spent cases lying about, of each kind)
const HOLES = 64; // (holes in the floor)
const HOLE_LIFE = 40; // (s) before one fades

const rnd = (a, b) => a + Math.random() * (b - a);

// (a canvas drawn once into a texture)
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a soft round glow
function glowTex() {
  return canvasTex(64, 64, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,240,200,0.75)');
    r.addColorStop(0.6, 'rgba(255,170,70,0.22)');
    r.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, w);
  });
}

// a star of flame: petals out of a hot middle, each its own length and width (seed: which)
function starTex(seed) {
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  return canvasTex(128, 128, (g, w) => {
    const c = w / 2;
    g.globalCompositeOperation = 'lighter';
    const n = 5 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.5, len = c * (0.55 + rand() * 0.45), wid = 0.12 + rand() * 0.14;
      g.save();
      g.translate(c, c);
      g.rotate(a);
      const lg = g.createLinearGradient(0, 0, len, 0);
      lg.addColorStop(0, 'rgba(255,250,225,0.95)');
      lg.addColorStop(0.35, 'rgba(255,200,90,0.7)');
      lg.addColorStop(1, 'rgba(255,90,20,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(0, -len * wid);
      g.quadraticCurveTo(len * 0.45, -len * wid * 0.55, len, 0);
      g.quadraticCurveTo(len * 0.45, len * wid * 0.55, 0, len * wid);
      g.closePath();
      g.fill();
      g.restore();
    }
    const r = g.createRadialGradient(c, c, 0, c, c, c * 0.42);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(1, 'rgba(255,210,120,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, w);
  });
}

// a tongue of flame, its base at the left, out to the right
function flameTex() {
  return canvasTex(128, 32, (g, w, h) => {
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const lg = g.createLinearGradient(0, 0, w, 0);
      lg.addColorStop(0, 'rgba(255,255,240,0.9)');
      lg.addColorStop(0.2, 'rgba(255,220,130,0.75)');
      lg.addColorStop(0.65, 'rgba(255,120,30,0.35)');
      lg.addColorStop(1, 'rgba(255,60,10,0)');
      g.fillStyle = lg;
      const hw = h * (0.22 + k * 0.12);
      g.beginPath();
      g.moveTo(0, h / 2 - hw * 0.6);
      g.quadraticCurveTo(w * 0.35, h / 2 - hw, w * (0.75 + k * 0.1), h / 2);
      g.quadraticCurveTo(w * 0.35, h / 2 + hw, 0, h / 2 + hw * 0.6);
      g.closePath();
      g.fill();
    }
  });
}

// a hole shot in the floor: black in the middle, a scorched ring, chips round it
function holeTex() {
  return canvasTex(64, 64, (g, w) => {
    const c = w / 2;
    let r = g.createRadialGradient(c, c, 0, c, c, c);
    r.addColorStop(0, 'rgba(8,6,5,1)');
    r.addColorStop(0.18, 'rgba(14,11,9,0.95)');
    r.addColorStop(0.3, 'rgba(40,30,22,0.55)');
    r.addColorStop(0.62, 'rgba(60,45,30,0.16)');
    r.addColorStop(1, 'rgba(60,45,30,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(20,15,12,0.55)';
    g.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, l = c * (0.35 + Math.random() * 0.4);
      g.beginPath();
      g.moveTo(c + Math.cos(a) * c * 0.15, c + Math.sin(a) * c * 0.15);
      g.lineTo(c + Math.cos(a + 0.15) * l * 0.6, c + Math.sin(a + 0.15) * l * 0.6);
      g.lineTo(c + Math.cos(a) * l, c + Math.sin(a) * l);
      g.stroke();
    }
    r = g.createRadialGradient(c, c, 0, c, c, c * 0.12);
    r.addColorStop(0, 'rgba(0,0,0,1)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, w);
  });
}

export class GunFx {
  constructor(app) {
    this.app = app;
    const scene = app.fxScene;
    this._glow = glowTex();
    this._stars = [0, 1, 2].map((s) => starTex(s + 1));
    this._flame = flameTex();
    // the flashes: each a core, a star and a tongue, reused
    const add = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false };
    const tg = new THREE.PlaneGeometry(1, 1);
    tg.translate(0.5, 0, 0);
    this.flashes = [];
    for (let k = 0; k < FLASH_N; k++) {
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glow, ...add }));
      const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._stars[0], ...add }));
      const star2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._stars[1], ...add }));
      const bloom = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glow, color: 0xffb060, ...add }));
      const tongue = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: this._flame, side: THREE.DoubleSide, ...add }));
      for (const o of [bloom, core, star, star2, tongue]) {
        o.visible = false;
        o.frustumCulled = false;
        o.renderOrder = 20;
        scene.add(o);
      }
      this.flashes.push({ core, star, star2, bloom, tongue, all: [bloom, core, star, star2, tongue], t: 1, size: 0, len: 0, rot: 0, rot2: 0 });
    }
    this.fk = 0;
    // the spent cases: brass, and shells (a red hull, a brass head) - each kind's pool
    const M = app.M;
    const brass = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.021, 8), M.brass, CASES);
    const hull = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0093, 0.0093, 0.048, 12), new THREE.MeshStandardMaterial({ color: 0xb3121c, metalness: 0, roughness: 0.42, envMap: M.brass.envMap }), CASES);
    const headG = new THREE.CylinderGeometry(0.0098, 0.0098, 0.012, 12);
    headG.translate(0, -0.024, 0);
    const head = new THREE.InstancedMesh(headG, M.brass, CASES);
    this.kinds = { brass: { meshes: [brass], list: [], r: 0.0055, sound: 'clink' }, shell: { meshes: [hull, head], list: [], r: 0.0095, sound: 'tock' } };
    for (const K of Object.values(this.kinds))
      for (const m of K.meshes) {
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        app.scene.add(m);
      }
    // the holes in the floor
    const hg = new THREE.PlaneGeometry(1, 1);
    hg.rotateX(-Math.PI / 2);
    this.holes = new THREE.InstancedMesh(hg, new THREE.MeshBasicMaterial({ map: holeTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), HOLES);
    this.holes.count = 0;
    this.holes.frustumCulled = false;
    this.holes.renderOrder = 2;
    app.scene.add(this.holes);
    this.hl = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._b = new THREE.Matrix4();
  }

  // A shot's muzzle: at p, the barrel along dir (unit), big (1: the pistol's) - its flash, light, sparks and smoke
  muzzle(p, dir, big = 1, o = {}) {
    const app = this.app, F = this.flashes[this.fk++ % FLASH_N], cam = app.camera;
    F.t = 0;
    F.size = 0.16 * big * rnd(0.85, 1.25);
    F.len = 0.24 * big * rnd(0.8, 1.3);
    F.rot = Math.random() * Math.PI * 2;
    F.rot2 = Math.random() * Math.PI * 2;
    const si = Math.floor(Math.random() * this._stars.length);
    F.star.material.map = this._stars[si];
    F.star2.material.map = this._stars[(si + 1) % this._stars.length];
    for (const q of [F.core, F.star, F.star2, F.bloom]) q.position.copy(p);
    // (the tongue: out along the barrel, turned about it to face the eye)
    const toCam = this._v.copy(cam.position).sub(p).normalize();
    const side = new THREE.Vector3().crossVectors(dir, toCam);
    if (side.lengthSq() < 1e-8) side.set(0, 1, 0);
    side.normalize();
    const nrm = new THREE.Vector3().crossVectors(dir, side).normalize();
    this._b.makeBasis(dir, side, nrm);
    F.tongue.quaternion.setFromRotationMatrix(this._b);
    F.tongue.position.copy(p);
    for (const q of F.all) q.visible = true;
    this._pose(F);
    // the room lit by it - and a big one, the picture
    app.fireAt(p, 0.9 * big);
    if (o.screen) app.flash = Math.max(app.flash || 0, o.screen);
    // sparks thrown out ahead
    const A = app.particles.add, ns = Math.round(rnd(3, 6) * big);
    for (let i = 0; i < ns; i++) {
      const s = rnd(3, 7) * Math.sqrt(big);
      A.spawn(p.x, p.y, p.z, dir.x * s + rnd(-1, 1), dir.y * s + rnd(-1, 1), dir.z * s + rnd(-1, 1), rnd(0.06, 0.2), 0.012 * big, 0.003, [9, 6, 2.5, 1], [2, 0.6, 0.15, 0.6], 3, -4);
    }
    // smoke rolling off it - forward, and up
    const S = app.particles.alpha, nk = o.smoke ?? Math.round(3 * big);
    for (let i = 0; i < nk; i++) {
      const s = rnd(0.4, 1.4) * Math.sqrt(big), c = rnd(0.55, 0.75);
      S.spawn(p.x + dir.x * 0.05, p.y + dir.y * 0.05, p.z + dir.z * 0.05, dir.x * s + rnd(-0.15, 0.15), dir.y * s + rnd(0.05, 0.3), dir.z * s + rnd(-0.15, 0.15),
        rnd(0.9, 2.2) * Math.sqrt(big), 0.05 * big, rnd(0.22, 0.4) * big, [c, c, c, 0.42], [c * 1.1, c * 1.1, c * 1.1, 0], 2.2, 0.25);
    }
  }

  // (the flash as it is, u of the way through its life: a white-hot core, two stars of flame crossed - sharp, then
  // swelling and gone - a soft bloom of light round it, the tongue)
  _pose(F) {
    const u = Math.min(1, F.t / FLASH_LIFE), a = (1 - u) * (1 - u), grow = 1 + 0.4 * u;
    F.core.scale.setScalar(F.size * 0.9 * grow);
    F.core.material.opacity = a;
    F.star.scale.setScalar(F.size * 1.9 * grow);
    F.star.material.rotation = F.rot;
    F.star.material.opacity = a;
    F.star2.scale.setScalar(F.size * 1.35 * (1 + 0.7 * u));
    F.star2.material.rotation = F.rot2;
    F.star2.material.opacity = 0.8 * a;
    F.bloom.scale.setScalar(F.size * 3.4 * (1 + 0.3 * u));
    F.bloom.material.opacity = 0.32 * (1 - u);
    F.tongue.scale.set(F.len * (0.8 + 0.5 * u), F.size * 0.75, 1);
    F.tongue.material.opacity = a;
  }

  // A spent case thrown out of a gun at p, its way v - brass or a shotgun's shell (kind), turning as it goes
  eject(kind, p, v) {
    const K = this.kinds[kind];
    if (!K) return;
    if (K.list.length >= CASES) K.list.shift();
    K.list.push({ p: p.clone(), v: v.clone(), r: new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)), w: new THREE.Vector3(rnd(-30, 30), rnd(-30, 30), rnd(-30, 30)), t: 0, rest: false });
  }

  // A round into the floor at p, going along d: sparks off it, a puff of its dust, its hole - and now and then a
  // ricochet's whine
  floorHit(p, d, big = 1) {
    const app = this.app, sb = app.sb, R = sb.p.arenaRadius;
    if (!(p.y < 0.05)) return;
    app.particles.sparks(p, Math.round(7 * big), 2.4, [1.0, 0.72, 0.3]);
    app.particles.smoke(p, 2, 0.25, 0.78, 0.25, 0.1 * big);
    // (on the floor as far as it's seen: the room's walls, or out past where the room ends - a place's floor goes on)
    const inRoom = sb.p.box ? Math.abs(p.x) < R && Math.abs(p.z) < R : Math.hypot(p.x, p.z) < 3 * R;
    if (inRoom) {
      if (this.hl.length >= HOLES) this.hl.shift();
      this.hl.push({ x: p.x, z: p.z, s: rnd(0.035, 0.055) * Math.sqrt(big), a: Math.random() * Math.PI * 2, t: 0 });
    }
    if (Math.random() < 0.28) app.audio?.ricochet(app.audio?._panOf?.(p) ?? 0);
  }

  update(dt) {
    for (const F of this.flashes) {
      if (!F.core.visible) continue;
      F.t += dt;
      if (F.t >= FLASH_LIFE) {
        for (const q of F.all) q.visible = false;
        continue;
      }
      this._pose(F);
    }
    this._cases(dt);
    this._holes(dt);
  }

  // the spent cases falling, bouncing (a clink or a tock each time) and coming to rest
  _cases(dt) {
    const app = this.app, g = app.sb.p.gravity;
    for (const [kind, K] of Object.entries(this.kinds)) {
      const L = K.list;
      if (!L.length && !K.meshes[0].count) continue;
      for (let k = L.length - 1; k >= 0; k--) {
        const c = L[k];
        c.t += dt;
        if (c.t > 20) {
          L.splice(k, 1);
          continue;
        }
        if (c.rest) continue;
        c.v.y += g * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt;
        c.r.y += c.w.y * dt;
        c.r.z += c.w.z * dt;
        if (c.p.y < K.r) {
          c.p.y = K.r;
          if (c.v.y < -0.6) {
            if (K.sound === 'clink') app.audio?.clink(Math.min(0.5, -c.v.y * 0.08), c.p);
            else app.audio?.shellTock(Math.min(0.6, -c.v.y * 0.1), c.p);
          }
          c.v.y *= -0.35;
          c.v.x *= 0.6;
          c.v.z *= 0.6;
          c.w.multiplyScalar(0.5);
          // (lying on its side, at rest)
          if (Math.abs(c.v.y) < 0.3 && Math.hypot(c.v.x, c.v.z) < 0.15) {
            c.rest = true;
            c.r.x = Math.PI / 2;
            c.r.z = 0;
          }
        }
      }
      let n = 0;
      for (const c of L) {
        this._q.setFromEuler(c.r);
        this._m.compose(c.p, this._q, this._s.set(1, 1, 1));
        for (const m of K.meshes) m.setMatrixAt(n, this._m);
        n++;
      }
      for (const m of K.meshes) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // the holes in the floor, each fading away after a while
  _holes(dt) {
    const H = this.hl;
    if (!H.length && !this.holes.count) return;
    for (let k = H.length - 1; k >= 0; k--) if ((H[k].t += dt) > HOLE_LIFE + 1) H.splice(k, 1);
    let n = 0;
    for (const h of H) {
      const s = h.s * Math.max(0, Math.min(1, HOLE_LIFE + 1 - h.t));
      this._q.setFromAxisAngle(this._v.set(0, 1, 0), h.a);
      this._m.compose(this._s.set(h.x, 0.0015, h.z), this._q, new THREE.Vector3(s, 1, s));
      this.holes.setMatrixAt(n++, this._m);
    }
    this.holes.count = n;
    this.holes.instanceMatrix.needsUpdate = true;
  }

  // (all of it shown for App.warmUp's drawing - its shaders compiled then, not at the first shot: that froze it a
  // moment on a phone - and put back by what it returns)
  warmShow() {
    const F = this.flashes[0], was = [];
    for (const q of F.all) q.visible = true;
    for (const K of Object.values(this.kinds)) for (const m of K.meshes) if (!m.count) (m.count = 1), was.push(m);
    if (!this.holes.count) (this.holes.count = 1), was.push(this.holes);
    return () => {
      for (const q of F.all) q.visible = false;
      for (const m of was) m.count = 0;
    };
  }

  // (re-cubed, a new cube: the floor swept - no holes, no brass)
  clear() {
    this.hl.length = 0;
    for (const K of Object.values(this.kinds)) K.list.length = 0;
    this._holes(0);
    this._cases(0);
  }
}
