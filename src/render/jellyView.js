import * as THREE from 'three';
import {
  createBackMaterial,
  createJellyMaterial,
  createCausticMaterial,
  createMaskMaterial,
  createHeightMaterial,
  createLayerUniforms,
  absorptionFromColor,
} from './jellyMaterials.js';

const FLOOR_SPAN = 6.4;

// Owns the jelly GPU geometry (one mesh per connected piece, sharing vertex
// attributes) and the multi-pass jelly rendering.
export class JellyView {
  constructor(renderer, env, lightDir) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.meshes = [];
    this.topoVersion = -1;
    this.layerUniforms = createLayerUniforms();
    this.backMat = createBackMaterial();
    this.frontMat = createJellyMaterial(env, this.layerUniforms);
    this.causticMat = createCausticMaterial(this.layerUniforms);
    this.maskMat = createMaskMaterial();
    this.heightMat = createHeightMaterial();
    this.fxCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.floorRect = new THREE.Vector4(-FLOOR_SPAN / 2, -FLOOR_SPAN / 2, 1 / FLOOR_SPAN, 1 / FLOOR_SPAN);
    for (const m of [this.causticMat, this.maskMat, this.heightMat]) {
      if (m.uniforms.uFloorRect) m.uniforms.uFloorRect.value = this.floorRect;
    }
    this.setLightDir(lightDir);
    this.rtCaustic = new THREE.WebGLRenderTarget(768, 768, { type: THREE.HalfFloatType, depthBuffer: false, samples: 4 });
    this.rtFloorFx = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: false, samples: 4 });
    this.fxUniforms = {
      caustic: { value: this.rtCaustic.texture },
      floorFx: { value: this.rtFloorFx.texture },
      floorRect: { value: this.floorRect },
      bg: { value: new THREE.Color(0.86, 0.85, 0.83) },
      texel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      ctexel: { value: new THREE.Vector2(1 / 768, 1 / 768) },
      tint: { value: new THREE.Color(1, 0.2, 0.2) },
    };
    this.rtBack = null;
    this._v = new THREE.Vector3();
  }

  setLightDir(d) {
    this.frontMat.uniforms.uLightDir.value.copy(d);
    this.causticMat.uniforms.uLightDir.value.copy(d);
    this.maskMat.uniforms.uLightDir.value.copy(d);
  }

  // flavor: { hex } or { layers: [hex bottom..top] }
  // m: resolved material {depth, opacity, glow, rough, ior, sugar, milk}
  setStyle(flavor, m, size = 1) {
    const ref = 0.55 / m.depth;
    const colors = (flavor.layers || [flavor.hex]).map((h) => new THREE.Color(h));
    const abs = colors.map((c) => absorptionFromColor(c, ref));
    const scs = colors.map((c) => {
      const s = c.clone();
      return s.multiplyScalar(1 / Math.max(s.r, s.g, s.b, 1e-3));
    });
    const avgAbs = abs.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / abs.length);
    const avgSc = scs.reduce((a, b) => a.add(b), new THREE.Color(0, 0, 0)).multiplyScalar(1 / scs.length);
    const L = this.layerUniforms;
    if (flavor.layers) {
      L.uLayers.value = flavor.layers.length;
      L.uLayerY0.value = -size / 2;
      L.uLayerH.value = size / flavor.layers.length;
      abs.forEach((a, k) => L.uLayerAbs.value[k].copy(a));
      scs.forEach((c, k) => L.uLayerSc.value[k].set(c.r, c.g, c.b));
    } else L.uLayers.value = 0;
    const F = this.frontMat.uniforms;
    const C = this.causticMat.uniforms;
    F.uAbsorb.value.copy(avgAbs);
    C.uAbsorb.value.copy(avgAbs);
    F.uScatterColor.value.copy(flavor.layers ? avgSc : scs[0]);
    // opacity -> cloudiness; near the top end even thin parts go solid
    const o = Math.min(1, Math.max(0, m.opacity));
    const scatter = 9 * o * o;
    const hazeMin = 0.92 * Math.min(1, Math.max(0, (o - 0.45) / 0.55)) ** 2;
    // colour of light that has crossed ~0.35 units of jelly (tints the shadow)
    const tint = new THREE.Color(0, 0, 0);
    for (const a of abs) tint.r += Math.exp(-a.x * 0.35), tint.g += Math.exp(-a.y * 0.35), tint.b += Math.exp(-a.z * 0.35);
    tint.multiplyScalar(1 / abs.length);
    const cloud = Math.max(m.milk, hazeMin);
    if (cloud) tint.lerp(new THREE.Color(1, 1, 1), 0.35 * cloud).multiplyScalar(1 - 0.35 * cloud);
    this.fxUniforms.tint.value.copy(tint);
    // healing light: a luminous, lighter version of the jelly colour
    F.uGlowColor.value.copy(avgSc).lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(0.9);
    F.uScatter.value = scatter + (flavor.layers ? 1.6 * (1 - o) : 0);
    F.uHazeMin.value = hazeMin;
    F.uGlow.value = m.glow;
    C.uScatter.value = scatter + m.milk * 3;
    F.uRoughness.value = m.rough;
    F.uSugar.value = m.sugar;
    F.uMilk.value = m.milk;
    F.uIor.value = m.ior;
    F.uDispersion.value = 0.018 * Math.max(0, m.ior - 1) / 0.36;
    C.uIor.value = Math.max(1.0001, m.ior);
  }

  setSize(w, h) {
    if (this.rtBack) this.rtBack.dispose();
    this.rtBack = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
    this.frontMat.uniforms.resolution.value.set(w, h);
  }

  syncTopology(sb) {
    if (sb.topoVersion === this.topoVersion) return false;
    this.topoVersion = sb.topoVersion;
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
    const nB = sb.rCount;
    const rIndex = sb.rIndex, rSim = sb.rSim;
    const nTri = rIndex.length / 3;
    // --- one level of subdivision: a midpoint per edge. Smooth edges share
    // a midpoint (Phong-tessellated); crease edges get one per side, placed
    // on the straight edge so the surface stays watertight.
    const K = sb.nV + 1;
    const edgeMap = new Map();
    const mids = []; // ra, rb, crease
    const triMid = new Int32Array(nTri * 3);
    for (let t = 0; t < nTri; t++) {
      for (let e = 0; e < 3; e++) {
        const ra = rIndex[t * 3 + e], rb = rIndex[t * 3 + ((e + 1) % 3)];
        const sa = rSim[ra], sbv = rSim[rb];
        const key = sa < sbv ? sa * K + sbv : sbv * K + sa;
        let rec = edgeMap.get(key);
        if (!rec) {
          rec = [];
          edgeMap.set(key, rec);
        }
        rec.push(t * 3 + e, ra, rb);
      }
    }
    for (const rec of edgeMap.values()) {
      const n = rec.length / 3;
      let smooth = true;
      if (n === 2) {
        const a0 = rec[1], b0 = rec[2], a1 = rec[4], b1 = rec[5];
        smooth = (a0 === a1 && b0 === b1) || (a0 === b1 && b0 === a1);
      } else smooth = n === 1;
      if (smooth) {
        const id = nB + mids.length / 3;
        mids.push(rec[1], rec[2], 0);
        for (let k = 0; k < n; k++) triMid[rec[k * 3]] = id;
      } else {
        for (let k = 0; k < n; k++) {
          const id = nB + mids.length / 3;
          mids.push(rec[k * 3 + 1], rec[k * 3 + 2], 1);
          triMid[rec[k * 3]] = id;
        }
      }
    }
    this.mids = Int32Array.from(mids);
    this.nBase = nB;
    const n = nB + mids.length / 3;
    this.nRender = n;
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.data = new Float32Array(n * 4);
    const rest = new Float32Array(n * 3);
    for (let r = 0; r < nB; r++) {
      const i = rSim[r] * 3;
      rest[r * 3] = sb.X[i]; rest[r * 3 + 1] = sb.X[i + 1]; rest[r * 3 + 2] = sb.X[i + 2];
    }
    for (let m = 0, k = nB; m < this.mids.length; m += 3, k++) {
      const a = this.mids[m], b = this.mids[m + 1];
      for (let c = 0; c < 3; c++) rest[k * 3 + c] = (rest[a * 3 + c] + rest[b * 3 + c]) * 0.5;
    }
    const index = new Uint32Array(nTri * 12);
    for (let t = 0; t < nTri; t++) {
      const a = rIndex[t * 3], b = rIndex[t * 3 + 1], c = rIndex[t * 3 + 2];
      const ab = triMid[t * 3], bc = triMid[t * 3 + 1], ca = triMid[t * 3 + 2];
      index.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], t * 12);
    }
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    this.aRest = new THREE.BufferAttribute(rest, 3);
    sb.pieceRanges.forEach((rg, k) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', this.aPos);
      g.setAttribute('normal', this.aNrm);
      g.setAttribute('aData', this.aData);
      g.setAttribute('aRest', this.aRest);
      g.setIndex(new THREE.BufferAttribute(index.slice(rg.start * 4, (rg.start + rg.count) * 4), 1));
      const mesh = new THREE.Mesh(g, this.frontMat);
      mesh.frustumCulled = false;
      mesh.userData.piece = k;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    });
    return true;
  }

  update(sb) {
    this.syncTopology(sb);
    const pos = this.pos, nrm = this.nrm, data = this.data;
    sb.writeRender(pos, nrm, data);
    // Phong tessellation of the edge midpoints
    const mids = this.mids;
    const alpha = 0.75;
    for (let m = 0, k = this.nBase; m < mids.length; m += 3, k++) {
      const a = mids[m] * 3, b = mids[m + 1] * 3;
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
      const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
      let qx = (ax + bx) * 0.5, qy = (ay + by) * 0.5, qz = (az + bz) * 0.5;
      const nax = nrm[a], nay = nrm[a + 1], naz = nrm[a + 2];
      const nbx = nrm[b], nby = nrm[b + 1], nbz = nrm[b + 2];
      if (!mids[m + 2]) {
        const da = (qx - ax) * nax + (qy - ay) * nay + (qz - az) * naz;
        const db = (qx - bx) * nbx + (qy - by) * nby + (qz - bz) * nbz;
        const px = qx - 0.5 * (da * nax + db * nbx), py = qy - 0.5 * (da * nay + db * nby), pz = qz - 0.5 * (da * naz + db * nbz);
        qx += (px - qx) * alpha;
        qy += (py - qy) * alpha;
        qz += (pz - qz) * alpha;
      }
      const o = k * 3;
      pos[o] = qx; pos[o + 1] = qy; pos[o + 2] = qz;
      let nx = nax + nbx, ny = nay + nby, nz = naz + nbz;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l;
      const da4 = mids[m] * 4, db4 = mids[m + 1] * 4, o4 = k * 4;
      data[o4] = (data[da4] + data[db4]) * 0.5;
      data[o4 + 1] = (data[da4 + 1] + data[db4 + 1]) * 0.5;
      data[o4 + 2] = Math.max(data[da4 + 2], data[db4 + 2]);
      data[o4 + 3] = 0;
    }
    this.aPos.needsUpdate = true;
    this.aNrm.needsUpdate = true;
    this.aData.needsUpdate = true;
  }

  renderFloorFx() {
    const r = this.renderer;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    for (const m of this.meshes) m.visible = true;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtCaustic);
    r.clear(true, false, false);
    this.scene.overrideMaterial = this.causticMat;
    r.render(this.scene, this.fxCam);
    r.setRenderTarget(this.rtFloorFx);
    r.clear(true, false, false);
    const auto = r.autoClear;
    r.autoClear = false;
    this.scene.overrideMaterial = this.maskMat;
    r.render(this.scene, this.fxCam);
    this.scene.overrideMaterial = this.heightMat;
    r.render(this.scene, this.fxCam);
    r.autoClear = auto;
    this.scene.overrideMaterial = null;
    r.setClearColor(prevClear, prevAlpha);
  }

  // Render pieces back-to-front in layers: pieces that don't overlap on
  // screen share a pass; a piece that overlaps one behind it goes in a later
  // layer so it refracts that piece.
  renderPieces(camera, sb, rtScene, rtTrans, copyFn) {
    const r = this.renderer;
    const v = this._v;
    const items = [];
    for (const m of this.meshes) {
      const pc = sb.pieces[m.userData.piece];
      if (!pc) continue;
      const b = pc.bbox;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < 8; k++) {
        v.set(k & 1 ? b[3] : b[0], k & 2 ? b[4] : b[1], k & 4 ? b[5] : b[2]).project(camera);
        if (v.x < x0) x0 = v.x;
        if (v.x > x1) x1 = v.x;
        if (v.y < y0) y0 = v.y;
        if (v.y > y1) y1 = v.y;
      }
      const d = v.set(pc.com[0], pc.com[1], pc.com[2]).distanceToSquared(camera.position);
      items.push({ m, d, x0, y0, x1, y1, layer: 0 });
    }
    items.sort((a, b) => b.d - a.d);
    let nLayers = 1;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = 0; j < i; j++) {
        const b = items[j];
        if (a.x0 > b.x1 || b.x0 > a.x1 || a.y0 > b.y1 || b.y0 > a.y1) continue;
        a.layer = Math.max(a.layer, b.layer + 1);
      }
      nLayers = Math.max(nLayers, a.layer + 1);
    }
    const auto = r.autoClear;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    this.frontMat.uniforms.tScene.value = rtTrans.texture;
    this.frontMat.uniforms.tBack.value = this.rtBack.texture;
    this.layers = nLayers;
    for (let L = 0; L < nLayers; L++) {
      for (const it of items) it.m.visible = it.layer === L;
      r.autoClear = false;
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(this.rtBack);
      r.clear(true, true, false);
      this.scene.overrideMaterial = this.backMat;
      r.render(this.scene, camera);
      this.scene.overrideMaterial = null;
      r.setRenderTarget(rtScene);
      r.render(this.scene, camera);
      if (L < nLayers - 1) copyFn();
    }
    for (const m of this.meshes) m.visible = true;
    r.autoClear = auto;
    r.setClearColor(prevClear, prevAlpha);
  }
}
