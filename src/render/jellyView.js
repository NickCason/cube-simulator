import * as THREE from 'three';
import {
  createBackMaterial,
  createJellyMaterial,
  createCausticMaterial,
  createMaskMaterial,
  createHeightMaterial,
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
    this.backMat = createBackMaterial();
    this.frontMat = createJellyMaterial(env);
    this.causticMat = createCausticMaterial();
    this.maskMat = createMaskMaterial();
    this.heightMat = createHeightMaterial();
    this.fxCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.floorRect = new THREE.Vector4(-FLOOR_SPAN / 2, -FLOOR_SPAN / 2, 1 / FLOOR_SPAN, 1 / FLOOR_SPAN);
    for (const m of [this.causticMat, this.maskMat, this.heightMat]) {
      if (m.uniforms.uFloorRect) m.uniforms.uFloorRect.value = this.floorRect;
    }
    this.setLightDir(lightDir);
    this.rtCaustic = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtFloorFx = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: false, samples: 4 });
    this.fxUniforms = {
      caustic: { value: this.rtCaustic.texture },
      floorFx: { value: this.rtFloorFx.texture },
      floorRect: { value: this.floorRect },
      bg: { value: new THREE.Color(0.86, 0.85, 0.83) },
      texel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
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

  setColor(hex, opts = {}) {
    const c = new THREE.Color(hex);
    const lin = c.clone(); // THREE.Color stores linear values
    const density = opts.density ?? (this.density || 1.5);
    const ref = 0.55 / density;
    const abs = absorptionFromColor(lin, ref);
    this.frontMat.uniforms.uAbsorb.value.copy(abs);
    this.causticMat.uniforms.uAbsorb.value.copy(abs);
    // colour of light that has crossed ~0.45 units of jelly (tints the shadow)
    this.fxUniforms.tint.value.setRGB(Math.exp(-abs.x * 0.45), Math.exp(-abs.y * 0.45), Math.exp(-abs.z * 0.45));
    const sc = lin.clone();
    // scattered light colour: saturated body colour
    const mx = Math.max(sc.r, sc.g, sc.b, 1e-3);
    sc.multiplyScalar(1 / mx);
    this.frontMat.uniforms.uScatterColor.value.copy(sc);
    const scatter = opts.scatter ?? (this.scatter ?? 0.55);
    this.frontMat.uniforms.uScatter.value = scatter;
    this.causticMat.uniforms.uScatter.value = scatter;
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
    const n = sb.rCount;
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.data = new Float32Array(n * 4);
    const rest = new Float32Array(n * 3);
    for (let r = 0; r < n; r++) {
      const i = sb.rSim[r] * 3;
      rest[r * 3] = sb.X[i]; rest[r * 3 + 1] = sb.X[i + 1]; rest[r * 3 + 2] = sb.X[i + 2];
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
      g.setIndex(new THREE.BufferAttribute(sb.rIndex.slice(rg.start, rg.start + rg.count), 1));
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
    sb.writeRender(this.pos, this.nrm, this.data);
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
