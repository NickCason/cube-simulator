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
import { makeMaterials, makeBomb } from './world/models.js';
import { physicsWarmJob } from './sim/warm.js';
import { Droplets } from './world/droplets.js';
import { Bubbles } from './world/bubbles.js';
import { Glitter, GLITTER_MODES } from './world/glitter.js';
import { bevelPoint, unbevelPoint } from './sim/mesh.js';
import { DEFAULT_STYLE, TEXTURES, EDGES, LAYER_PRESETS, MIN_LAYERS, MAX_LAYERS, MAX_REPEAT, biasExp, resolveFlavor, flavorMainHex, nextLayerColor } from './styles.js';
import { SETTINGS, resolveSettings } from './settings.js';
import { Tilt } from './tilt.js';

// The two looks: the photo studio, and glow mode - lights out, the jelly
// shining in the dark over a glossy black floor that mirrors it.
const THEMES = {
  light: {
    bg: [0.86, 0.85, 0.83], floor: [0.8, 0.79, 0.77], rough: 0.82, envI: 0.75,
    key: 3.2, keyHex: 0xfff6ec, keyCol: [1, 0.97, 0.92], envJelly: 1,
    glow: 0, glowFloor: 0, refl: 0.22, reflLod: 1, bloom: 0.045, threshold: 1.1, knee: 0.6, vignette: 0.22, css: '#dcd9d5',
  },
  dark: {
    bg: [0.0045, 0.0045, 0.007], floor: [0.022, 0.022, 0.027], rough: 0.34, envI: 1,
    key: 0.85, keyHex: 0xdde6ff, keyCol: [0.76, 0.82, 1], envJelly: 1.6,
    glow: 1, glowFloor: 0.35, refl: 0.4, reflLod: 1.6, bloom: 0.38, threshold: 0.6, knee: 0.5, vignette: 0.42, css: '#050507',
  },
};
const median = (arr) => {
  const s = Float32Array.from(arr).sort();
  return s[s.length >> 1];
};
// a neon tube coming on: a few stutters, then it holds (time s, level)
const FLICKER = [[0, 0], [0.03, 0.75], [0.07, 0.06], [0.15, 0.9], [0.19, 0.15], [0.23, 0.35], [0.29, 1.05], [0.34, 0.5], [0.4, 1.12], [0.85, 1]];
function flicker(t) {
  for (let i = 1; i < FLICKER.length; i++) {
    const [t1, v1] = FLICKER[i];
    if (t < t1) {
      const [t0, v0] = FLICKER[i - 1];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return 1;
}

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

    this.theme = this._loadTheme(opts);
    this.bg = new THREE.Color();
    this._pulseC = new THREE.Color();
    this.env = createStudioEnvironment(renderer, this.lightDir, this.theme);
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
    if (this.coarse) this.jelly.maxLayers = 3;
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
    this.onNailHit = (hp) => {
      this.audio.nailHit(1);
      this.markDamaged();
      if (hp) this.glowPulse(hp.x, hp.y, hp.z, 0.7);
    };

    this.clock = { last: performance.now(), t: 0 };
    this.timeScale = 1;
    this.stats = { physMs: 0, frameMs: 0, frames: 0, physLast: 0, renderLast: 0 };
    this.substepRate = 720; // physics substeps per second
    this.isTouch = false;
    this._panV = new THREE.Vector3();
    this._hitStop = 0;
    this._resizePending = false;
    this.splash = null; // the opening splash (see main.js, ui/splash.js)
    this.splashHold = false; // keeps the cube up while the splash shows
    // the cube hangs a moment before it drops, while the physics code warms
    // up on a throwaway body (Safari runs cold code slowly at first)
    this.intro = { job: physicsWarmJob(), t: 0, ready: false, done: false };
    this.paused = false;
    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this.onFrame = [];
    this.damaged = false;

    const uiRoot = document.getElementById('ui');
    this.overlay = new Overlay(document.body);
    this.tilt = new Tilt(this); // (before the UI: its switch lives in Settings)
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
    this._applyTheme(this.theme);

    this.resize();
    // (applied at the start of the next frame: resizing the canvas clears
    // it, and a cleared canvas shown for a frame is a black flash)
    window.addEventListener('resize', () => (this._resizePending = true));
    this._bindInput();
    this._loop = this._loop.bind(this);
  }

  registerTool(t) {
    this.tools[t.id] = t;
  }

  start() {
    this.warmUp();
    requestAnimationFrame(this._loop);
  }

  // Compile every shader the tools and effects will need, now and offscreen,
  // so the first use of each doesn't stall the frame (phones compile shaders
  // slowly). The physics code warms up during the intro (see frame).
  warmUp() {
    const t0 = performance.now();
    const r = this.renderer;
    // the render surface's rebuild (two levels of subdivision) only runs
    // when the jelly is cut: run it a few times now, so it isn't cold - and
    // ten times slower - in the middle of a burst
    for (let k = 0; k < 5; k++) {
      this.jelly.topoVersion = -1;
      this.jelly.syncTopology(this.sb);
    }
    const p0 = r.info.programs?.length || 0;
    const undo = [];
    for (const id in this.tools) {
      const m = this.tools[id].model;
      if (m && !m.visible) {
        m.visible = true;
        undo.push(() => (m.visible = false));
      }
    }
    const bomb = makeBomb(this.M);
    this.scene.add(bomb);
    undo.push(() => this.scene.remove(bomb));
    for (const o of [this.nails.mesh, this.droplets.mesh]) {
      if (o.count !== 0) continue;
      const vis = o.visible;
      o.count = 1;
      o.visible = true;
      undo.push(() => ((o.count = 0), (o.visible = vis)));
    }
    for (const L of [this.particles.add, this.particles.alpha]) {
      const g = L.points.geometry, { start, count } = g.drawRange;
      g.setDrawRange(0, 1);
      undo.push(() => g.setDrawRange(start, count));
    }
    try {
      r.setRenderTarget(this.rtScene);
      // twice: three.js draws shadows with the previous render's light setup,
      // so the first pass compiles shadow shaders for a scene with no lights
      for (let k = 0; k < 2; k++) {
        r.shadowMap.needsUpdate = true;
        r.render(this.scene, this.camera);
      }
      r.render(this.fxScene, this.camera);
      r.setRenderTarget(null);
    } finally {
      for (const f of undo) f();
    }
    this.warmStats = { ms: performance.now() - t0, programs: (r.info.programs?.length || 0) - p0 };
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
      if (preset.blur !== undefined) st.layers.blur = preset.blur;
      st.layers.repeat = preset.repeat || 1;
      st.layers.bias = preset.bias || 0;
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
    if (opts.repeat !== undefined && Number.isFinite(opts.repeat)) st.layers.repeat = Math.min(MAX_REPEAT, Math.max(1, Math.round(opts.repeat)));
    if (opts.bias !== undefined && Number.isFinite(opts.bias)) st.layers.bias = Math.min(1, Math.max(-1, opts.bias));
    if (!(st.layers.repeat >= 1)) st.layers.repeat = 1;
    if (!Number.isFinite(st.layers.bias)) st.layers.bias = 0;
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
    const L = this.style.layers;
    L.colors = [...p.colors];
    if (p.blur !== undefined) L.blur = p.blur;
    L.repeat = p.repeat || 1;
    L.bias = p.bias || 0;
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  setLayerBlur(b) {
    this.style.layers.blur = Math.min(1, Math.max(0, b));
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  // how many times the colours cycle up the cube
  setLayerRepeat(n) {
    this.style.layers.repeat = Math.min(MAX_REPEAT, Math.max(1, Math.round(n)));
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  // -1..1: the bands crowd toward the bottom or the top
  setLayerBias(b) {
    this.style.layers.bias = Math.min(1, Math.max(-1, b));
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
    const from = this._edgeMorph ? this._edgeMorph.cur : this.sb.p.bevel;
    this.style.edges = id;
    this.sb.p.bevel = EDGES[id].bevel * this.sb.p.size;
    this.applyStyle();
    // A whole cube changes shape: its rest shape eases from one rounding to
    // the other and the jelly springs after it. A cut or battered one
    // re-forms with the new rounding (the heal).
    if (this.damaged || this.healer.active || this.sb.pieces.length !== 1 || !this.intro.done) {
      this._edgeMorph = null;
      this.healer.active = false;
      this.heal();
      return;
    }
    const sb = this.sb, n = sb.nV, half = sb.p.size / 2;
    const M = this._edgeMorph;
    // (the rest positions with no rounding at all, worked out once)
    let G = M && M.topo === sb.topoVersion ? M.G : null;
    if (!G) {
      G = new Float64Array(n * 3);
      for (let i = 0; i < n; i++) unbevelPoint(sb.X[i * 3], sb.X[i * 3 + 1], sb.X[i * 3 + 2], half, from, G, i * 3);
    }
    this._edgeMorph = { G, topo: sb.topoVersion, half, from, to: this.sb.p.bevel, cur: from, t: 0, dur: 0.6 };
  }

  _edgeMorphTick(dt) {
    const M = this._edgeMorph;
    if (!M) return;
    const sb = this.sb, n = sb.nV;
    // (cut or rebuilt meanwhile: the new rounding as it is, at once)
    const broken = M.topo !== sb.topoVersion || M.G.length !== n * 3;
    M.t += dt;
    const k = broken ? 1 : Math.min(1, M.t / M.dur);
    M.cur = M.from + (M.to - M.from) * k * k * (3 - 2 * k);
    const X = sb.X, G = M.G;
    if (broken) {
      const g = new Float64Array(3);
      for (let i = 0; i < n; i++) {
        unbevelPoint(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], M.half, M.from, g);
        bevelPoint(g[0], g[1], g[2], M.half, M.to, X, i * 3);
      }
    } else for (let i = 0; i < n; i++) bevelPoint(G[i * 3], G[i * 3 + 1], G[i * 3 + 2], M.half, M.cur, X, i * 3);
    sb._computeRest();
    sb._computeMass();
    sb.wakeAll();
    if (k >= 1) {
      sb._computeEscape();
      sb._rg = null;
      this.jelly.topoVersion = -1; // (the render surface's true-shape fit, for the new rounding)
      this._edgeMorph = null;
    }
  }

  // Jelly colour at a world point (layered flavours vary with rest height).
  flavorColorAt(x, y, z) {
    const f = this.flavor;
    if (!f || !f.layers) return this.color;
    const r = this.sb.locate(x, y, z);
    if (!r) return this.color;
    let ry = 0;
    for (let k = 0; k < 4; k++) ry += this.sb.X[this.sb.T[r.tet * 4 + k] * 3 + 1] * r.bary[k];
    const n = f.layers.length, m = n * (f.repeat || 1);
    const h = Math.pow(Math.min(1, Math.max(0, ry / this.sb.p.size + 0.5)), biasExp(f.bias));
    return f.layers[Math.min(m - 1, Math.floor(h * m)) % n];
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

  // Intro: hold the cube up while the warm-up job runs a few ms per frame,
  // and let it drop once the job has warmed the falling and landing code and
  // the first runs of the cutting and contact code (or after 1.2 s, or at
  // the first touch). The rest of the job finishes in the background, a
  // couple of ms a frame.
  _introStep(dt) {
    const I = this.intro;
    I.t += dt;
    if (!I.jobReady && this._warmSlice(9) === 'ready') I.jobReady = true;
    // then, behind the splash, the real cube's own code: a first visit's
    // fresh browser can still be compiling its fast tier, and the drop then
    // ran at a few frames a second for seconds - so step a twin of the cube
    // (same settings, same shapes) until its steps settle (at most ~6 s)
    if (I.jobReady && !I.ready) I.ready = !this.splashHold || this._warmTwin() || I.t > 6;
    // (behind the splash the job just carries on: the drop is its reveal)
    if ((I.ready || I.t > 1.2) && !this.splashHold) I.done = true;
    if (I.done) this.introMs = I.t * 1000;
  }

  // A twin of the cube stepped where nobody sees it; true once its steps
  // take about as long as its fastest (the hot code is compiled).
  _warmTwin() {
    const I = this.intro;
    if (!I.twin) {
      const tw = new SoftBody({ ...(this.opts.sim || {}), size: this.sb.p.size, bevel: this.sb.p.bevel });
      Object.assign(tw.p, this.sb.p);
      tw.loadCube(0, 1.1, 0, 0.18);
      I.twin = { sb: tw, times: [], best: Infinity };
      return false;
    }
    const W = I.twin;
    W.sb.p.substeps = this.sb.p.substeps || 12;
    const t0 = performance.now();
    W.sb.step(1 / 60);
    const ms = performance.now() - t0;
    W.best = Math.min(W.best, ms);
    W.times.push(ms);
    const n = W.times.length;
    if ((n >= 4 && W.times.slice(-3).every((t) => t < W.best * 1.5 + 2)) || n > 150) {
      I.twin = null;
      return true;
    }
    return false;
  }

  _warmSlice(budget) {
    const I = this.intro;
    if (!I.job) return 'ready';
    const t0 = performance.now();
    while (performance.now() - t0 < budget) {
      const r = I.job.next();
      if (r.done) {
        I.job = null;
        return 'ready';
      }
      if (r.value === 'ready' && !I.done) return 'ready';
    }
    return '';
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
    // Phones render the scene below the screen's density and the browser
    // stretches it: it's sharpened a little first (CAS, in the edge pass).
    // ?upscale: the screen gets its full density and the last pass upscales
    // instead (FSR's EASU - crisper, but that pass at full density costs
    // about as much again as the whole frame).
    const native = Math.min(window.devicePixelRatio || 1, 3);
    const stretched = native > this.pixelRatio * 1.15;
    const upscale = this.coarse && !!this.opts.upscale && stretched;
    this.renderer.setPixelRatio(upscale ? native : this.pixelRatio);
    const pw = Math.floor(w * this.pixelRatio), ph = Math.floor(h * this.pixelRatio);
    this.size = { w, h, pw, ph };
    if (this.rtScene) {
      this.rtScene.dispose();
      this.rtTrans.dispose();
      this.rtRefl.dispose();
    }
    const samples = this.opts.msaa ?? (this.coarse || this.pixelRatio > 1.6 ? 0 : 4);
    this.rtScene = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    // (no multisampling - phones, high-density screens: smooth edges in
    // post, in a pass of their own before an upscale)
    const C = this.post.compositeMat.uniforms;
    this.rtAA?.dispose();
    this.rtAA = null;
    if (upscale) {
      this.rtAA = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, depthBuffer: false });
      const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      C.uEasu.value = 1;
      C.uFxaa.value = 0;
      C.uInSize.value.set(pw, ph);
      C.uOutSize.value.copy(db);
    } else {
      C.uEasu.value = 0;
      C.uFxaa.value = samples ? 0 : 1;
    }
    C.uSharp.value = this.coarse && stretched && !upscale ? 0.45 : 0;
    this.rtTrans = new THREE.WebGLRenderTarget(pw, ph, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    // the jelly's reflection in the floor (half size, blurred by mip level)
    this.rtRefl = new THREE.WebGLRenderTarget(Math.max(1, pw >> 1), Math.max(1, ph >> 1), {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.jelly.fxUniforms.refl.value = this.rtRefl.texture;
    this.jelly.fxUniforms.res.value.set(pw, ph);
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
      this.intro.done = true; // a touch ends the intro hold right away
      this.splash?.leave(true);
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {
        // (a pointer the browser no longer knows: carry on without capture)
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // a second finger on the jelly while the hand holds it: a second
        // hand (squish it, pull it apart); anywhere else: pinch/orbit,
        // cancelling the tool's gesture
        if (mode === 'tool' && this.tool?.multiTouch) {
          const ray = this.rayFromClient(e.clientX, e.clientY);
          const hit = this.pickJelly(ray);
          if (hit && this.tool.down(e, ray, hit)) return;
        }
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
    this._rawDt = dt; // (unclamped: what the resolution adapts to)
    dt = Math.min(dt, 1 / 30);
    this.frame(dt);
  }

  frame(dt) {
    if (this.lost || this.renderer.getContext().isContextLost()) return; // (the GPU context is gone: see main.js)
    const t0 = performance.now();
    if (this._resizePending) {
      this._resizePending = false;
      this.resize();
    }
    // slow frames slow the simulation instead of piling on substeps
    if (this.slowGoal !== undefined) this.timeScale += (this.slowGoal - this.timeScale) * (1 - Math.exp(-dt * 10));
    // (a frame of up to 1/30 s while the physics is light: a screen capped at
    // 30 fps - iOS's Low Power Mode - otherwise ran everything at two-thirds
    // speed; back to 1/45 as it gets heavy, so a busy scene keeps its frame rate)
    const heavy = Math.min(1, Math.max(0, (this.stats.physMs - 14) / 10));
    let sdt = Math.min(dt, 1 / 30 + (1 / 45 - 1 / 30) * heavy) * this.timeScale;
    if (this._hitStop > 0) {
      this._hitStop -= dt;
      sdt *= 0.1;
    }
    this.clock.t += dt;
    if (!this.paused) {
      for (const f of this.onFrame) f(sdt, dt);
      this.tool?.update?.(sdt, dt);
      this.healer.update(sdt);
      this.tilt.update(dt);
      this._edgeMorphTick(dt);
      const nS = Math.max(4, Math.min(24, Math.round(this.substepRate * sdt)));
      this.sb.p.substeps = nS;
      const p0 = performance.now();
      if (!this.intro.done) this._introStep(dt);
      else if (sdt > 0) this.sb.step(sdt);
      const pm = performance.now() - p0;
      // the rest of the warm-up: a small slice a frame
      if (this.intro.done && this.intro.job) this._warmSlice(2);
      this.stats.physLast = pm;
      // adapt substep rate to the device (not to the intro's warm-up work)
      if (this.intro.done) this.stats.physMs = this.stats.physMs * 0.9 + pm * 0.1;
      if (this.intro.done && this.sb.anyAwake) {
        // (its share of the frame: more of a longer frame)
        const bud = 9.5 * Math.min(2, Math.max(1, dt * 60));
        if (this.stats.physMs > bud) this.substepRate = Math.max(420, this.substepRate * 0.985);
        else if (this.stats.physMs < bud * 0.63) this.substepRate = Math.min(720, this.substepRate * 1.004);
      }
      this.nails.update(sdt);
      this.droplets.update(sdt);
      this.bubbles.update();
      for (const k in this.tools) if (this.tools[k] !== this.tool && this.tools[k].background) this.tools[k].update(sdt, dt);
      this.particles.update(sdt);
      this._impactSounds();
      this._impactGlow();
    }
    this._themeTick(dt);
    this._updateCamera(dt);
    this.overlay.draw(dt);
    const r0 = performance.now();
    // (nothing to draw under the splash, past the first frames that build
    // the GPU's state; its own animation gets the time)
    const covered = this.splash?.active && !this.splash.leaving && this.stats.frames > 2;
    if (!covered) this.render();
    this.stats.renderLast = performance.now() - r0;
    if (this.splash?.active && this.stats.frames > 1) {
      this.splash.go();
      if (this.intro.ready || this.intro.t > 7) this.splash.ready();
    }
    const cpu = performance.now() - t0;
    this.stats.frameMs = this.stats.frameMs * 0.9 + cpu * 0.1;
    this.stats.frames++;
    this._adaptResolution(dt, cpu);
  }

  // Render resolution follows the GPU: drop it while frames are slow *and*
  // the slowness isn't our own CPU work (busy physics makes frames slow too,
  // and a blurrier picture wouldn't help that); step it back up after a few
  // seconds of smooth frames. A step up that soon has to be undone puts that
  // level off the table.
  _adaptResolution(dt, cpuMs = 0) {
    if (this.opts.preserve) return;
    const raw = Math.min(this._rawDt || dt, 0.25);
    const a = (this._adapt ||= { t: 0, slow: 0, fast: 0, ceiling: this.maxPixelRatio, upAt: -1e9, floor: 0, capDt: 0, ring: new Float32Array(48), n: 0, trial: null });
    a.t += dt;
    a.ring[a.n++ % a.ring.length] = raw;
    if (a.t < 2.5) return;
    // A step down is a trial: if frames don't come any sooner after it, it
    // wasn't the GPU holding them back - the browser caps the frame rate
    // (iOS does, at 30, in Low Power Mode) - so put it back, and stay at
    // least that sharp unless frames get much slower than that cap.
    const T = a.trial;
    if (T) {
      if (a.t - T.at < 1.5) return;
      a.trial = null;
      a.slow = a.fast = 0;
      if (median(a.ring) > T.before * 0.88) {
        this.pixelRatio = T.pr;
        a.floor = T.pr;
        a.capDt = T.before;
        this._resizePending = true;
      }
      return;
    }
    const gpuSlow = raw > 1 / 42 && cpuMs < raw * 1000 * 0.6;
    if (gpuSlow) a.slow += dt;
    else a.slow = Math.max(0, a.slow - dt * 0.5);
    if (raw < 1 / 57) a.fast += dt;
    else if (gpuSlow) a.fast = 0;
    const floor = a.floor && median(a.ring) < a.capDt * 1.5 ? a.floor : 0.75;
    if (a.slow > 1.2 && this.pixelRatio > floor + 1e-6) {
      if (a.t - a.upAt < 12) a.ceiling = this.pixelRatio - 0.25; // that step up was too much
      a.trial = { pr: this.pixelRatio, before: median(a.ring), at: a.t };
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      a.slow = 0;
      a.fast = 0;
      this._resizePending = true;
    } else if (a.fast > 5 && this.pixelRatio + 0.25 <= Math.min(this.maxPixelRatio, a.ceiling) + 1e-6) {
      this.pixelRatio = this.pixelRatio + 0.25;
      a.fast = 0;
      a.upAt = a.t;
      this._resizePending = true;
    }
  }

  // ------------------------------------------------------------ looks
  _loadTheme(opts) {
    if (THEMES[opts.theme]) return opts.theme;
    try {
      const t = localStorage.getItem('cube-sim-theme');
      if (THEMES[t]) return t;
    } catch (e) {}
    return 'light';
  }

  // Lights out: the room dims to black, then the jelly flickers on like a
  // neon tube. Lights on: a flood of daylight that settles into the studio.
  setTheme(name, animate = true) {
    if (!THEMES[name] || name === this.theme) return;
    this.theme = name;
    try {
      localStorage.setItem('cube-sim-theme', name);
    } catch (e) {}
    if (animate) this._themeAnim = { to: name, t: 0, swapped: false, from: this.jelly.frontMat.uniforms.uEmit.value };
    else {
      this._themeAnim = null;
      this._applyTheme(name);
    }
  }

  // everything that differs between the looks (glow: how far the jelly's
  // light is up, 0..1 - the switch brings it up itself)
  _applyTheme(name, glow = 1, ease = false) {
    const T = THEMES[name];
    this.env.setLook(name);
    this.bg.setRGB(...T.bg);
    this.jelly.fxUniforms.bg.value.copy(this.bg);
    const fm = this.floor.material;
    fm.color.setRGB(...T.floor);
    fm.roughness = T.rough;
    fm.envMapIntensity = T.envI;
    this.jelly.fxUniforms.floorAlbedo.value.setRGB(...T.floor);
    this.jelly.fxUniforms.floorEnv.value = T.envI;
    this.keyLight.intensity = T.key;
    this.keyLight.color.set(T.keyHex);
    this.jelly.frontMat.uniforms.uLightColor.value.setRGB(...T.keyCol).multiplyScalar(T.key);
    this.jelly.frontMat.uniforms.envIntensity.value = T.envJelly;
    this.jelly.fxUniforms.reflAmount.value = T.refl;
    this.jelly.fxUniforms.reflLod.value = T.reflLod;
    const C = this.post.compositeMat.uniforms;
    C.uBloom.value = T.bloom;
    C.uVignette.value = T.vignette;
    this.post.preMat.uniforms.uThreshold.value = T.threshold;
    this.post.preMat.uniforms.uKnee.value = T.knee;
    this._setGlow(T.glow * glow);
    const html = document.documentElement;
    if (ease) {
      html.classList.add('theming'); // (the chrome eases over too)
      clearTimeout(this._themingT);
      this._themingT = setTimeout(() => html.classList.remove('theming'), 700);
    }
    html.classList.toggle('dark', name === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', T.css);
    this.ui?.setTheme?.(name);
  }

  _setGlow(e) {
    this.jelly.setEmit(e);
    this.jelly.fxUniforms.glowFloor.value = e * THEMES.dark.glowFloor;
    this.droplets.setGlow(e);
  }

  _themeTick(dt) {
    const A = this._themeAnim;
    if (!A) return;
    A.t += dt;
    const C = this.post.compositeMat.uniforms;
    if (A.to === 'dark') {
      const SWAP = 0.3;
      if (A.t < SWAP) {
        const k = A.t / SWAP;
        C.uDim.value = 1 - 0.97 * k * k;
        C.uWash.value = Math.max(0, C.uWash.value - dt * 5); // (if it was on its way to light)
        return;
      }
      if (!A.swapped) {
        A.swapped = true;
        C.uWash.value = 0;
        this._applyTheme('dark', 0, true);
      }
      C.uDim.value = Math.min(1, 0.03 + (A.t - SWAP) / 0.3);
      const f = A.t - SWAP - 0.12;
      this._setGlow(f > 0 ? flicker(f) : 0);
      if (f > 0.9) {
        this._setGlow(1);
        C.uDim.value = 1;
        this._themeAnim = null;
      }
    } else {
      const SWAP = 0.16;
      if (A.t < SWAP) {
        const k = A.t / SWAP;
        this._setGlow(A.from * (1 - k));
        C.uWash.value = 0.7 * k * k;
        return;
      }
      if (!A.swapped) {
        A.swapped = true;
        C.uDim.value = 1;
        this._applyTheme('light', 1, true);
      }
      C.uWash.value = 0.7 * Math.exp(-(A.t - SWAP) * 6);
      if (A.t > SWAP + 0.9) {
        C.uWash.value = 0;
        this._themeAnim = null;
      }
    }
  }

  // glow mode: a ring of light racing through the jelly from a knock
  glowPulse(x, y, z, amp = 1) {
    if (this.jelly.frontMat.uniforms.uEmit.value <= 0.05) return;
    // (its ring on the floor: the colour of where it hit, brightest channel 1)
    const c = this._pulseC.set(this.flavorColorAt(x, y, z));
    c.multiplyScalar(1 / Math.max(c.r, c.g, c.b, 1e-3));
    this.jelly.pulse(x, y, z, amp, this.clock.t, c);
  }

  // (landings and collisions light up where they happen)
  _impactGlow() {
    const im = this.sb.impacts;
    if (!im.length || this.jelly.frontMat.uniforms.uEmit.value <= 0.05) return;
    let best = null, next = null;
    for (const e of im) {
      if (e.dv < 1.5) continue;
      if (!best || e.dv > best.dv) (next = best), (best = e);
      else if (!next || e.dv > next.dv) next = e;
    }
    for (const e of [best, next]) if (e) this.glowPulse(e.x, e.y, e.z, Math.min(1.2, (e.dv - 1) / 4));
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
    const v = this._panV.set(x, y, z).project(this.camera);
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

    this.jelly.renderFloorFx(this.sb);
    if (!this.opts.nojelly) this.jelly.renderReflection(this.camera, this.rtRefl);

    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.rtScene);
    r.setClearColor(this.bg, 1);
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
    if (this.rtAA) {
      this.post.fxaa(this.rtScene.texture, this.rtAA);
      this.post.composite(this.rtAA.texture, bloom, this.clock.t);
    } else this.post.composite(this.rtScene.texture, bloom, this.clock.t);
  }
}
