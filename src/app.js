import * as THREE from 'three';
import { SoftBody } from './sim/softbody.js';
import { createStudioEnvironment } from './render/env.js';
import { createFloor } from './render/floor.js';
import { Post } from './render/post.js';
import { JellyView } from './render/jellyView.js';

const BG = new THREE.Color(0.86, 0.85, 0.83);

export class App {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    const renderer = (this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!opts.preserve,
    }));
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2);
    renderer.setPixelRatio(this.pixelRatio);
    const tm = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping }[opts.tm || 'neutral'];
    renderer.toneMapping = tm;
    renderer.toneMappingExposure = opts.exposure ?? 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;

    this.env = createStudioEnvironment(renderer);
    this.lightDir = new THREE.Vector3(-0.42, 0.82, 0.39).normalize();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
    this.orbit = { theta: 0.38, phi: 0.36, radius: 4.1, target: new THREE.Vector3(0, 0.44, 0) };
    this._applyOrbit();

    const key = (this.keyLight = new THREE.DirectionalLight(0xfff6ec, 3.2));
    key.position.copy(this.lightDir).multiplyScalar(9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 1; sc.far = 20;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.scene.add(key);
    this.scene.add(key.target);

    this.jelly = new JellyView(renderer, this.env, this.lightDir);
    this.floor = createFloor(this.env, this.jelly.fxUniforms);
    this.scene.add(this.floor);

    this.post = new Post(renderer);
    this.sb = new SoftBody(opts.sim || {});
    this.sb.loadCube(0, 0.25, 0, 0.18);
    this.jelly.setColor(opts.color || '#e0102a');

    this.clock = { last: performance.now(), t: 0 };
    this.timeScale = 1;
    this.stats = { physMs: 0, frameMs: 0, frames: 0 };
    this.substepRate = 720; // physics substeps per second
    this.paused = false;
    this.tools = {};
    this.tool = null;
    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this.onFrame = [];

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this._loop = this._loop.bind(this);
  }

  start() {
    requestAnimationFrame(this._loop);
  }

  _applyOrbit() {
    const o = this.orbit;
    const c = this.camera;
    c.position.set(
      o.target.x + o.radius * Math.cos(o.phi) * Math.sin(o.theta),
      o.target.y + o.radius * Math.sin(o.phi),
      o.target.z + o.radius * Math.cos(o.phi) * Math.cos(o.theta),
    );
    c.lookAt(o.target);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the cube comfortably framed on portrait screens
    this.camera.fov = w / h < 0.8 ? 30 / Math.min(1, (w / h) * 1.35) : 30;
    this.camera.updateProjectionMatrix();
    const pw = Math.floor(w * this.pixelRatio), ph = Math.floor(h * this.pixelRatio);
    this.size = { w, h, pw, ph };
    if (this.rtScene) {
      this.rtScene.dispose();
      this.rtTrans.dispose();
    }
    const samples = this.opts.msaa ?? 4;
    this.rtScene = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.rtTrans = new THREE.WebGLRenderTarget(pw, ph, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.jelly.setSize(pw, ph);
    this.jelly.frontMat.uniforms.uSceneLodMax.value = Math.floor(Math.log2(Math.max(pw, ph))) - 2;
    this.post.setSize(pw, ph);
  }

  // ------------------------------------------------------------ picking
  rayFromClient(x, y) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    return this.raycaster.ray;
  }

  pickJelly(ray) {
    const o = ray.origin, d = ray.direction;
    return this.sb.raycast(o.x, o.y, o.z, d.x, d.y, d.z);
  }

  // ------------------------------------------------------------ frame
  _loop(now) {
    requestAnimationFrame(this._loop);
    let dt = (now - this.clock.last) / 1000;
    this.clock.last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 1 / 30);
    this.frame(dt);
  }

  frame(dt) {
    const t0 = performance.now();
    const sdt = dt * this.timeScale;
    this.clock.t += dt;
    if (!this.paused) {
      for (const f of this.onFrame) f(sdt, dt);
      if (this.tool && this.tool.update) this.tool.update(sdt, dt);
      const nS = Math.max(4, Math.min(24, Math.round(this.substepRate * sdt)));
      this.sb.p.substeps = nS;
      const p0 = performance.now();
      if (sdt > 0) this.sb.step(sdt);
      this.stats.physMs = this.stats.physMs * 0.9 + (performance.now() - p0) * 0.1;
    }
    this.render();
    this.stats.frameMs = this.stats.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.stats.frames++;
  }

  render() {
    const r = this.renderer;
    this.jelly.update(this.sb);
    this.jelly.frontMat.uniforms.uTime.value = this.clock.t;

    this.jelly.renderFloorFx();

    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.rtScene);
    r.setClearColor(BG, 1);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);

    const copy = () => this.post.copy(this.rtScene.texture, this.rtTrans);
    copy();
    if (!this.opts.nojelly) this.jelly.renderPieces(this.camera, this.sb, this.rtScene, this.rtTrans, copy);

    if (this.fxScene) {
      const auto = r.autoClear;
      r.autoClear = false;
      r.setRenderTarget(this.rtScene);
      r.render(this.fxScene, this.camera);
      r.autoClear = auto;
    }

    const bloom = this.post.bloom(this.rtScene.texture, this.size.pw, this.size.ph);
    this.post.composite(this.rtScene.texture, bloom, this.clock.t);
  }
}
