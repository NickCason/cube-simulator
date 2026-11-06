import * as THREE from 'three';
import { SoftBody } from './sim/softbody.js';
import { createStudioEnvironment } from './render/env.js';
import { createFloor } from './render/floor.js';
import { Post } from './render/post.js';
import { JellyView } from './render/jellyView.js';
import { NailSystem } from './world/nails.js';
import { Particles } from './world/particles.js';
import { Healer } from './heal.js';
import { AudioEngine } from './audio.js';
import { Overlay } from './ui/overlay.js';
import { UI } from './ui/ui.js';
import { HandTool, KnifeTool, NailGunTool } from './tools/basic.js';
import { MalletTool, TorchTool, FreezeTool, BallerTool, BombTool, SyringeTool, MagnetTool } from './tools/more.js';
import { makeMaterials } from './world/models.js';
import { Droplets } from './world/droplets.js';
import { Bubbles } from './world/bubbles.js';
import { Glitter, GLITTER_MODES } from './world/glitter.js';
import { DEFAULT_STYLE, TEXTURES, EDGES, LAYER_PRESETS, MIN_LAYERS, MAX_LAYERS, resolveFlavor, flavorMainHex, nextLayerColor } from './styles.js';
import { SETTINGS, resolveSettings } from './settings.js';

const BG = new THREE.Color(0.86, 0.85, 0.83);

export class App {
  // Wobble frequency ~ sqrt(mu/rho)/size: above ~sqrt(850)/1 the solver goes
  // unstable at low substep counts (and foamy material even sooner).
  // A floor keeps it from flattening into nothing under its own weight.
  static safeMu(mu, rho, size, lambdaRatio, gravity = 22) {
    const foam = Math.min(1, lambdaRatio / 6);
    const hi = 850 * rho * size * size * (0.35 + 0.65 * foam);
    const lo = (0.45 * rho * Math.abs(gravity) * size) / (0.4 + 0.6 * foam);
    return Math.max(Math.min(mu, hi), Math.min(lo, hi));
  }

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
    this.coarse = window.matchMedia?.('(pointer: coarse)').matches;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, opts.maxDpr || (this.coarse ? 1.75 : 2));
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    const tm = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping }[opts.tm || 'neutral'];
    renderer.toneMapping = tm;
    renderer.toneMappingExposure = opts.exposure ?? 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;

    const LIGHTS = { front: [-0.42, 0.82, 0.39], back: [-0.38, 0.74, -0.56], side: [-0.62, 0.72, -0.18] };
    this.lightDir = new THREE.Vector3(...(LIGHTS[opts.light] || LIGHTS.side)).normalize();

    this.env = createStudioEnvironment(renderer, this.lightDir);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
    this.orbit = { theta: 0.38, phi: 0.36, radius: 4.1, target: new THREE.Vector3(0, 0.44, 0) };
    this.orbitGoal = { theta: this.orbit.theta, phi: this.orbit.phi, radius: this.orbit.radius };
    this._shake = 0;
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
    // warm dynamic light for flames and blasts (lights the floor and the jelly)
    this.fireLight = new THREE.PointLight(0xff8a3c, 0, 3.5, 2);
    this.fireLight.position.set(0, 1, 0);
    this.scene.add(this.fireLight);
    this.fireLevel = 0;
    this.fireGoal = 0;
    this.floor = createFloor(this.env, this.jelly.fxUniforms);
    this.scene.add(this.floor);

    this.post = new Post(renderer);
    this.style = this._loadStyle(opts);
    this.tune = this._loadTune();
    const t0 = resolveSettings(this.tune, TEXTURES[this.style.texture]);
    this.sb = new SoftBody({ ...(opts.sim || {}), size: t0.size, bevel: EDGES[this.style.edges].bevel * t0.size });
    this.sb.loadCube(0, opts.dropHeight ?? 1.1, 0, 0.18);

    this.audio = new AudioEngine();
    this.audio.panFn = (p) => this._pan(p.x, p.y, p.z);
    this.M = makeMaterials(this.env);
    this.nails = new NailSystem(this);
    this.particles = new Particles(this);
    this.fxScene = this.particles.scene;
    this.healer = new Healer(this);
    this.onHealStart = [];
    this.onHealEnd = [];
    this.onColor = [];
    this.droplets = new Droplets(this);
    this.healZoom = 0;
    this.flash = 0;
    this.anchorProviders = [() => this.nails.anchors()];
    this.bubbles = new Bubbles(this);
    this.glitter = new Glitter(this);
    this.onNailHit = () => {
      this.audio.nailHit(1);
      this.markDamaged();
    };

    this.clock = { last: performance.now(), t: 0 };
    this.timeScale = 1;
    this.stats = { physMs: 0, frameMs: 0, frames: 0 };
    this.substepRate = 720; // physics substeps per second
    this.paused = false;
    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this.onFrame = [];
    this.damaged = false;

    const uiRoot = document.getElementById('ui');
    this.overlay = new Overlay(document.body);
    if (uiRoot) this.ui = new UI(this, uiRoot);

    this.tools = {
      hand: new HandTool(this),
      knife: new KnifeTool(this),
      nailgun: new NailGunTool(this),
      mallet: new MalletTool(this),
      torch: new TorchTool(this),
      freeze: new FreezeTool(this),
      baller: new BallerTool(this),
      bomb: new BombTool(this),
      syringe: new SyringeTool(this),
      magnet: new MagnetTool(this),
    };
    this.tool = null;
    this.setTool('hand');
    this.applyStyle();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this._bindInput();
    this._loop = this._loop.bind(this);
  }

  registerTool(t) {
    this.tools[t.id] = t;
  }

  start() {
    requestAnimationFrame(this._loop);
  }

  // ------------------------------------------------------------ state
  setTool(id) {
    const t = this.tools[id];
    if (!t || t === this.tool) return;
    if (this.tool) {
      this.tool.up?.();
      this.tool.deactivate?.();
    }
    this.tool = t;
    t.activate?.();
    this.setCursor(t.cursor || 'default');
    this.ui?.setTool(id);
  }

  // ------------------------------------------------------------ jelly style
  _loadStyle(opts) {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem('cube-sim-style') || '{}') || {};
    } catch (e) {
      saved = {};
    }
    const st = { ...DEFAULT_STYLE, ...saved };
    st.layers = { ...DEFAULT_STYLE.layers, ...(saved.layers || {}) };
    st.layers.colors = [...st.layers.colors];
    if (opts.flavor) st.flavor = opts.flavor;
    if (opts.color) st.flavor = opts.color;
    if (opts.texture) st.texture = opts.texture;
    if (opts.edges) st.edges = opts.edges;
    if (opts.glitter) st.glitter = opts.glitter;
    if (!(st.glitter in GLITTER_MODES)) st.glitter = 'off';
    if (st.flavor === 'rainbow') {
      st.flavor = 'layers';
      if (opts.flavor === 'rainbow') st.layers.colors = [...LAYER_PRESETS[0].colors];
    }
    const preset = LAYER_PRESETS.find((p) => p.id === opts.flavor);
    if (preset) {
      st.flavor = 'layers';
      st.layers.colors = [...preset.colors];
    }
    if (opts.layers) {
      const cols = opts.layers.split(',').map((c) => '#' + c.replace('#', '').trim()).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
      if (cols.length >= MIN_LAYERS) {
        st.flavor = 'layers';
        // URL lists layers top -> bottom (reading order); stored bottom -> top
        st.layers.colors = cols.slice(0, MAX_LAYERS).reverse();
      }
    }
    if (opts.blend !== undefined && Number.isFinite(opts.blend)) st.layers.blur = Math.min(1, Math.max(0, opts.blend));
    const L = st.layers;
    if (!Array.isArray(L.colors) || L.colors.length < MIN_LAYERS) L.colors = [...DEFAULT_STYLE.layers.colors];
    L.colors = L.colors.slice(0, MAX_LAYERS);
    if (!TEXTURES[st.texture]) st.texture = DEFAULT_STYLE.texture;
    if (!EDGES[st.edges]) st.edges = DEFAULT_STYLE.edges;
    return st;
  }

  _loadTune() {
    try {
      return JSON.parse(localStorage.getItem('cube-sim-tune') || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  // Resolved settings: user overrides on top of the texture preset.
  get settings() {
    return resolveSettings(this.tune, TEXTURES[this.style.texture]);
  }

  applyStyle() {
    const f = resolveFlavor(this.style);
    const tex = TEXTURES[this.style.texture];
    const st = this.settings;
    this.jelly.setStyle(f, { ...tex, ...st }, this.sb.p.size);
    const sb = this.sb;
    sb.p.mu = App.safeMu(st.mu, st.weight, sb.p.size, st.lambda, st.gravity);
    sb.p.damping = st.damping;
    sb.p.lambdaRatio = st.lambda;
    sb.p.bounce = st.bounce;
    sb.p.friction = st.grip;
    sb.p.gravity = -st.gravity;
    sb.setDensity(st.weight);
    sb.wakeAll();
    this.audio.setLevels(st.volume, st.impacts);
    this.bubbles?.configure(st.bubbles, st.bubbleSize);
    this.glitter?.configure({ mode: this.style.glitter, count: st.glitterAmount, size: st.glitterSize, sparkle: st.glitterSparkle });
    this.flavor = f;
    this.color = flavorMainHex(f);
    for (const fn of this.onColor || []) fn(this.color, f);
    this.ui?.setStyle(this.style, f);
    this.ui?.setSettings?.(st, tex);
    try {
      localStorage.setItem('cube-sim-style', JSON.stringify(this.style));
      localStorage.setItem('cube-sim-tune', JSON.stringify(this.tune));
    } catch (e) {
      /* private mode */
    }
  }

  setFlavor(id) {
    this.style.flavor = id;
    this.applyStyle();
  }

  setColor(hex) {
    this.setFlavor(hex);
  }

  // ---- layered jelly editing (colours listed bottom -> top)
  setLayerColor(i, hex) {
    const L = this.style.layers;
    if (i < 0 || i >= L.colors.length) return;
    L.colors[i] = hex;
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  setLayerCount(n) {
    const L = this.style.layers;
    n = Math.max(MIN_LAYERS, Math.min(MAX_LAYERS, n));
    while (L.colors.length < n) L.colors.push(nextLayerColor(L.colors[L.colors.length - 1]));
    if (L.colors.length > n) L.colors.length = n;
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  setLayerPreset(id) {
    const p = LAYER_PRESETS.find((q) => q.id === id);
    if (!p) return;
    this.style.layers.colors = [...p.colors];
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  setLayerBlur(b) {
    this.style.layers.blur = Math.min(1, Math.max(0, b));
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  setGlitter(id) {
    if (!(id in GLITTER_MODES)) return;
    this.style.glitter = id;
    this.applyStyle();
    if (id !== 'off') this.sb.impulse(0, 0.6, 0, 0, -1, 0, 3, 0.8); // a jiggle to show it off
  }

  setTexture(id) {
    if (!TEXTURES[id]) return;
    this.style.texture = id;
    // material sliders follow the new texture preset
    for (const s of SETTINGS) if (s.mat) delete this.tune[s.key];
    this.applyStyle();
    this.sb.impulse(0, 0.6, 0, 0, -1, 0, 3, 1.2);
  }

  // One fine-tuning slider changed (value in physical units).
  setSetting(key, value, final = true) {
    this.tune[key] = value;
    if (key === 'size') {
      if (final) this.setCubeSize(value);
      return;
    }
    this.applyStyle();
  }

  resetSettings() {
    const oldSize = this.sb.p.size;
    // (the jelly resets; your sound levels stay)
    const { volume, impacts } = this.tune;
    this.tune = {};
    if (volume !== undefined) this.tune.volume = volume;
    if (impacts !== undefined) this.tune.impacts = impacts;
    this.applyStyle();
    if (Math.abs(this.settings.size - oldSize) > 1e-6) this.setCubeSize(this.settings.size);
  }

  setCubeSize(size) {
    const old = this.sb.p.size;
    if (Math.abs(size - old) < 1e-6) return;
    this.tune.size = size;
    this.sb.p.size = size;
    this.sb.p.bevel = EDGES[this.style.edges].bevel * size;
    this.applyStyle();
    // re-form the cube at the new size
    this.healer.active = false;
    this.heal({ scale: size / old });
  }

  setEdges(id) {
    if (!EDGES[id] || this.style.edges === id) return;
    this.style.edges = id;
    this.sb.p.bevel = EDGES[id].bevel * this.sb.p.size;
    this.applyStyle();
    // reform the cube with the new rounding
    this.healer.active = false;
    this.heal();
  }

  // Jelly colour at a world point (layered flavours vary with rest height).
  flavorColorAt(x, y, z) {
    const f = this.flavor;
    if (!f || !f.layers) return this.color;
    const r = this.sb.locate(x, y, z);
    if (!r) return this.color;
    let ry = 0;
    for (let k = 0; k < 4; k++) ry += this.sb.X[this.sb.T[r.tet * 4 + k] * 3 + 1] * r.bary[k];
    const n = f.layers.length;
    const i = Math.max(0, Math.min(n - 1, Math.floor((ry / this.sb.p.size + 0.5) * n)));
    return f.layers[i];
  }

  setCursor(c) {
    this.canvas.style.cursor = c;
  }

  allAnchors() {
    const out = [];
    for (const f of this.anchorProviders) out.push(...f());
    return out;
  }

  onTopologyChanged() {
    for (const f of this.onTopology || []) f();
  }

  markDamaged() {
    if (!this.damaged) {
      this.damaged = true;
      this.ui?.setDamaged(true);
    }
  }

  markHealed() {
    this.damaged = false;
    this.ui?.setDamaged(false);
  }

  heal(opts) {
    if (this.healer.active) return;
    this.tool?.up?.();
    this.healer.start(opts);
  }

  fireAt(p, level) {
    this.fireLight.position.copy(p);
    this.fireGoal = Math.max(this.fireGoal, level);
  }

  setSlowMo(on) {
    this.slowGoal = on ? 0.2 : 1;
    if (on) this.ui?.hint('Slow motion', 1200);
  }

  shake(a) {
    if (this.reducedMotion) return;
    this._shake = Math.min(0.05, this._shake + a);
  }

  // a heavy blow: the world all but freezes for a moment
  hitStop(sec) {
    if (this.reducedMotion) return;
    this._hitStop = Math.max(this._hitStop || 0, sec);
  }

  // ------------------------------------------------------------ camera
  _applyOrbit() {
    const o = this.orbit;
    const c = this.camera;
    // pull back while a bottom sheet hides part of a small screen
    const r = o.radius * (1 + (this._lift || 0) * 1.5) * (1 + (this.healZoom || 0));
    c.position.set(
      o.target.x + r * Math.cos(o.phi) * Math.sin(o.theta),
      o.target.y + r * Math.sin(o.phi),
      o.target.z + r * Math.cos(o.phi) * Math.cos(o.theta),
    );
    c.lookAt(o.target);
    if (this._shake > 1e-4) {
      c.position.x += (Math.random() - 0.5) * this._shake;
      c.position.y += (Math.random() - 0.5) * this._shake;
    }
  }

  _updateCamera(dt) {
    // lift the scene above an open bottom sheet on small screens
    const cover = this.ui ? this.ui.panelCover : 0;
    const goal = cover > 0 ? Math.min(0.42, cover * 0.42) : 0;
    this._lift = (this._lift || 0) + (goal - (this._lift || 0)) * (1 - Math.exp(-dt * 10));
    const c = this.camera;
    if (Math.abs(this._lift) > 1e-3) {
      const W = this.size.w, H = this.size.h;
      c.setViewOffset(W, H, 0, this._lift * H, W, H);
    } else if (c.view && c.view.enabled) c.clearViewOffset();
    const o = this.orbit, g = this.orbitGoal;
    const k = 1 - Math.exp(-dt * 12);
    o.theta += (g.theta - o.theta) * k;
    o.phi += (g.phi - o.phi) * k;
    o.radius += (g.radius - o.radius) * k;
    this._shake *= Math.exp(-dt * 14);
    this._applyOrbit();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the cube comfortably framed on portrait screens
    this.camera.fov = w / h < 0.8 ? 30 / Math.min(1, (w / h) * 1.18) : 30;
    this.camera.updateProjectionMatrix();
    // keep the arena inside what the default view can see
    const halfV = Math.tan((this.camera.fov * Math.PI) / 360) * this.orbitGoal.radius;
    const halfW = halfV * (w / h);
    this.sb.p.arenaRadius = Math.max(1.15, Math.min(2.3, halfW * 0.92 - 0.35));
    // pixel budget: huge screens render at a lower ratio
    const budget = Math.sqrt(3.6e6 / Math.max(1, w * h));
    if (this.pixelRatio > budget) this.pixelRatio = Math.max(0.6, budget);
    this.renderer.setPixelRatio(this.pixelRatio);
    const pw = Math.floor(w * this.pixelRatio), ph = Math.floor(h * this.pixelRatio);
    this.size = { w, h, pw, ph };
    if (this.rtScene) {
      this.rtScene.dispose();
      this.rtTrans.dispose();
    }
    const samples = this.opts.msaa ?? (this.coarse || this.pixelRatio > 1.6 ? 0 : 4);
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

  // ------------------------------------------------------------ input
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

  _bindInput() {
    const el = this.canvas;
    const pointers = new Map();
    let mode = null; // 'tool' | 'orbit' | 'pinch'
    let last = null;
    let pinch0 = 0;
    el.addEventListener('pointerdown', (e) => {
      this.audio.init();
      this.isTouch = e.pointerType === 'touch';
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // second finger: switch to pinch/orbit, cancel tool gesture
        if (mode === 'tool') this.tool?.up?.(e, this.rayFromClient(e.clientX, e.clientY));
        mode = 'pinch';
        const [a, b] = [...pointers.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        last = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return;
      }
      if (pointers.size > 2) return;
      if (this.healer.active) {
        mode = 'orbit';
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      const ray = this.rayFromClient(e.clientX, e.clientY);
      const hit = this.pickJelly(ray);
      const consumed = e.button === 0 && this.tool?.down?.(e, ray, hit);
      if (consumed) mode = 'tool';
      else {
        mode = 'orbit';
        last = { x: e.clientX, y: e.clientY };
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === 'tool') {
        const ray = this.rayFromClient(e.clientX, e.clientY);
        this.tool?.move?.(e, ray);
      } else if (mode === 'orbit' && last) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        this.orbitGoal.theta -= dx * 0.006;
        this.orbitGoal.phi = Math.min(1.25, Math.max(0.06, this.orbitGoal.phi + dy * 0.004));
      } else if (mode === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) this.orbitGoal.radius = Math.min(7.5, Math.max(2.4, this.orbitGoal.radius * (pinch0 / d)));
        pinch0 = d;
        const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (last) {
          this.orbitGoal.theta -= (c.x - last.x) * 0.006;
          this.orbitGoal.phi = Math.min(1.25, Math.max(0.06, this.orbitGoal.phi + (c.y - last.y) * 0.004));
        }
        last = c;
      } else if (!mode && e.pointerType === 'mouse') {
        this.tool?.hover?.(e, this.rayFromClient(e.clientX, e.clientY));
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (mode === 'tool') this.tool?.up?.(e, this.rayFromClient(e.clientX, e.clientY));
      if (pointers.size === 0) {
        mode = null;
        last = null;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.tool?.hover?.(null, null);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.orbitGoal.radius = Math.min(7.5, Math.max(2.4, this.orbitGoal.radius * Math.exp(e.deltaY * 0.0012)));
      },
      { passive: false },
    );
    el.addEventListener('contextmenu', (e) => e.preventDefault());
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
    // slow frames slow the simulation instead of piling on substeps
    if (this.slowGoal !== undefined) this.timeScale += (this.slowGoal - this.timeScale) * (1 - Math.exp(-dt * 10));
    let sdt = Math.min(dt, 1 / 45) * this.timeScale;
    if (this._hitStop > 0) {
      this._hitStop -= dt;
      sdt *= 0.1;
    }
    this.clock.t += dt;
    if (!this.paused) {
      for (const f of this.onFrame) f(sdt, dt);
      this.tool?.update?.(sdt, dt);
      this.healer.update(sdt);
      const nS = Math.max(4, Math.min(16, Math.round(this.substepRate * sdt)));
      this.sb.p.substeps = nS;
      const p0 = performance.now();
      if (sdt > 0) this.sb.step(sdt);
      const pm = performance.now() - p0;
      this.stats.physMs = this.stats.physMs * 0.9 + pm * 0.1;
      // adapt substep rate to the device
      if (this.sb.anyAwake) {
        if (this.stats.physMs > 9.5) this.substepRate = Math.max(420, this.substepRate * 0.985);
        else if (this.stats.physMs < 6) this.substepRate = Math.min(720, this.substepRate * 1.004);
      }
      this.nails.update(sdt);
      this.droplets.update(sdt);
      this.bubbles.update();
      for (const k in this.tools) if (this.tools[k] !== this.tool && this.tools[k].background) this.tools[k].update(sdt, dt);
      this.particles.update(sdt);
      this._impactSounds();
    }
    this._updateCamera(dt);
    this.overlay.draw(dt);
    this.render();
    this.stats.frameMs = this.stats.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.stats.frames++;
    this._adaptResolution(dt);
  }

  // Drop the render resolution if the device can't keep up (and recover).
  _adaptResolution(dt) {
    if (this.opts.preserve) return;
    const a = (this._adapt ||= { t: 0, slow: 0, fast: 0 });
    a.t += dt;
    if (a.t < 2.5) return;
    if (dt > 1 / 42) a.slow += dt;
    else a.slow = Math.max(0, a.slow - dt * 0.5);
    if (dt < 1 / 58) a.fast += dt;
    else a.fast = 0;
    if (a.slow > 1.2 && this.pixelRatio > 0.75) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      a.slow = 0;
      a.fast = 0;
      this.resize();
    } else if (a.fast > 8 && this.pixelRatio < this.maxPixelRatio) {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.25);
      a.fast = 0;
      this.resize();
    }
  }

  // Landings and knocks: the physics reports at most one impact per piece
  // per frame (and only sudden ones). Play the hardest one or two, each
  // shaped by that piece's size and material, panned to where it happened.
  _impactSounds() {
    const im = this.sb.impacts;
    if (!im.length || !this.audio.ctx) return;
    const healing = this.healer.active;
    const list = im.filter((e) => !(healing && e.kind === 'piece')).sort((a, b) => b.dv - a.dv);
    let played = 0;
    const done = new Set();
    for (const e of list) {
      if (played >= 2 || done.has(e.piece)) continue;
      done.add(e.piece);
      if (e.partner >= 0) done.add(e.partner); // one sound per collision
      const pc = this.sb.pieces[e.piece];
      if (!pc) continue;
      const size = Math.cbrt(e.mass / Math.max(0.05, this.sb.p.density));
      this.audio.impact(e.dv, size, this._impactMaterial(pc), this._pan(e.x, e.y, e.z));
      played++;
    }
  }

  // What a piece sounds like: firm/wet from the feel settings, creamy and
  // sugary from the texture, glassy when frozen, extra soft when melted.
  _impactMaterial(pc) {
    const st = this.settings;
    const tex = TEXTURES[this.style.texture];
    let firm = Math.min(1, Math.max(0, Math.log(st.mu / 45) / Math.log(1000 / 45)));
    let temp = 0;
    const T = this.sb.temp, vs = pc.verts, step = Math.max(1, Math.floor(vs.length / 64));
    let n = 0;
    for (let k = 0; k < vs.length; k += step, n++) temp += T[vs[k]];
    temp /= Math.max(1, n);
    if (temp > 0.4) firm *= 0.5;
    return {
      firm,
      wet: Math.max(0.25, 1 - 0.6 * firm - 0.3 * (tex.sugar || 0)),
      creamy: tex.milk || 0,
      sugar: tex.sugar || 0,
      ice: temp < -0.45 ? 1 : 0,
    };
  }

  // stereo position of a world point (-1 left .. 1 right, kept gentle)
  _pan(x, y, z) {
    const v = (this._panV ||= new THREE.Vector3()).set(x, y, z).project(this.camera);
    return Math.max(-1, Math.min(1, v.x)) * 0.6;
  }

  render() {
    const r = this.renderer;
    this.jelly.update(this.sb);
    this.jelly.frontMat.uniforms.uTime.value = this.clock.t;
    // fire light: torch sets fireGoal each frame, bombs spike it
    this.fireLevel += (this.fireGoal - this.fireLevel) * 0.35;
    this.fireGoal *= 0.6;
    const fl = this.fireLevel * (0.85 + Math.random() * 0.3);
    this.fireLight.intensity = fl * 3.2;
    this.jelly.frontMat.uniforms.uPLPos.value.copy(this.fireLight.position);
    this.jelly.frontMat.uniforms.uPLColor.value.setRGB(1.0 * fl, 0.55 * fl, 0.2 * fl);

    this.jelly.renderFloorFx();

    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.rtScene);
    r.setClearColor(BG, 1);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);

    const copy = () => this.post.copy(this.rtScene.texture, this.rtTrans);
    copy();
    if (!this.opts.nojelly) this.jelly.renderPieces(this.camera, this.sb, this.rtScene, this.rtTrans, copy);

    this.glitter.update(this.clock.t);
    if (this.fxScene) {
      const auto = r.autoClear;
      r.autoClear = false;
      r.setRenderTarget(this.rtScene);
      r.render(this.fxScene, this.camera);
      r.autoClear = auto;
    }

    this.flash *= 0.86;
    this.post.compositeMat.uniforms.uFlash.value = this.flash;
    const bloom = this.post.bloom(this.rtScene.texture, this.size.pw, this.size.ph);
    this.post.composite(this.rtScene.texture, bloom, this.clock.t);
  }
}
