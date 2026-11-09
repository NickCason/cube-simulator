import * as THREE from 'three';
import { SoftBody, MAX_CUBES, REST_STEP } from './sim/softbody.js';
import { createStudioEnvironment } from './render/env.js';
import { createSkyDome, setSky } from './render/sky.js';
import { PLACES, PLACE_BY_ID } from './places.js';
import { createFloor } from './render/floor.js';
import { Post } from './render/post.js';
import { JellyView } from './render/jellyView.js';
import { NailSystem } from './world/nails.js';
import { Particles } from './world/particles.js';
import { Healer } from './heal.js';
import { Swapper } from './swap.js';
import { AudioEngine } from './audio.js';
import { Overlay } from './ui/overlay.js';
import { UI } from './ui/ui.js';
import { HandTool, KnifeTool, NailGunTool, HoleGunTool } from './tools/basic.js';
import { MalletTool, TorchTool, FreezeTool, BallerTool, BombTool, SyringeTool, MagnetTool } from './tools/more.js';
import { CuberTool, DicerTool } from './tools/cubey.js';
import { FeedTool } from './tools/feed.js';
import { TwistTool } from './tools/twist.js';
import { AutoGunTool } from './tools/autogun.js';
import { GelGunTool } from './tools/gelgun.js';
import { FlourTool } from './tools/flour.js';
import { EyesTool } from './tools/eyes.js';
import { Eyes, LATE_LAYER } from './world/eyes.js';
import { copyEyes, EYE_FACES } from './eyes.js';
import { SURFACE, SURFACES } from './surfaces.js';
import { AcidTool } from './tools/acid.js';
import { Cubiplication } from './cubiplication.js';
import { makeMaterials, makeBomb } from './world/models.js';
import { physicsWarmJob } from './sim/warm.js';
import { Droplets } from './world/droplets.js';
import { Fluid } from './world/fluid.js';
import { Flour } from './world/flour.js';
import { Strands } from './world/strands.js';
import { Bubbles } from './world/bubbles.js';
import { GlassRoom } from './world/glassroom.js';
import { Glitter, GLITTER_MODES } from './world/glitter.js';
import { Portraits } from './portrait.js';
import { captureCube } from './cubecode.js';
import { bevelPoint, unbevelPoint } from './sim/mesh.js';
import { RUBIK_COLORS, rubikCellAt, TRIM } from './styles.js';
import { DEFAULT_STYLE, TEXTURES, EDGES, LAYER_PRESETS, MIN_LAYERS, MAX_LAYERS, MAX_REPEAT, resolveFlavor, flavorMainHex, nextLayerColor } from './styles.js';
import { GRAD_SHAPE_INDEX, gradStops, gradT, gradColorAt, copyLayers, tileLocal, MAX_TILES } from './styles.js';
import { freeNodes, freeNodesDefault, freeColorAt, FREE_K_MIN, FREE_K_MAX } from './freeform.js';
import { randomGradient } from './genetics.js';
import { SETTINGS, resolveSettings } from './settings.js';

const SETTING_BY_KEY = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));
// each cube's own settings: its material's, and its size (the rest - gravity,
// the sound, the tools - are the room's, the same in every cube)
// (its own: its material's sliders, its size, its bubbles)
const PER_CUBE = (k) => !!SETTING_BY_KEY[k]?.mat || k === 'size' || k === 'bubbles' || k === 'bubbleSize' || k === 'surfDepth' || k === 'surfScale' || k === 'trimSize' || k === 'trimDepth';
import { DiceWatch } from './dice.js';
import { Tilt } from './tilt.js';
import { nameCube } from './namegen.js';

// The two looks: the photo studio, and glow mode - lights out, the jelly
// shining in the dark over a glossy black floor that mirrors it.
const THEMES = {
  light: {
    bg: [0.86, 0.85, 0.83], floor: [0.8, 0.79, 0.77], rough: 0.82, envI: 0.75,
    key: 3.2, keyHex: 0xfff6ec, keyCol: [1, 0.97, 0.92], envJelly: 1,
    glow: 0, glowFloor: 0, refl: 0.22, reflLod: 1, bloom: 0.045, threshold: 1.1, knee: 0.6, vignette: 0.22, css: '#dcd9d5',
    metalCeil: [1.3, 1.32, 1.38],
  },
  dark: {
    bg: [0.0045, 0.0045, 0.007], floor: [0.022, 0.022, 0.027], rough: 0.34, envI: 1,
    key: 0.85, keyHex: 0xdde6ff, keyCol: [0.76, 0.82, 1], envJelly: 1.6,
    glow: 1, glowFloor: 0.35, refl: 0.4, reflLod: 1.6, bloom: 0.38, threshold: 0.6, knee: 0.5, vignette: 0.42, css: '#050507',
    metalCeil: [0.05, 0.05, 0.07],
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
    this.place = this._loadPlace(opts); // (where the cube is: see places.js)
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
    key.layers.enable(LATE_LAYER); // (the late pass's light too: see render)

    this.jelly = new JellyView(renderer, this.env, this.lightDir);
    if (this.coarse) this.jelly.maxLayers = 4;
    // warm dynamic light for flames and blasts (lights the floor and the jelly)
    this.fireLight = new THREE.PointLight(0xff8a3c, 0, 3.5, 2);
    this.fireLight.position.set(0, 1, 0);
    this.fireLight.layers.enable(LATE_LAYER);
    this.scene.add(this.fireLight);
    this.fireLevel = 0;
    this.fireGoal = 0;
    this.floor = createFloor(this.env, this.jelly.fxUniforms);
    this.scene.add(this.floor);
    // the sky (a place's: the studio has its sweep, the backdrop colour)
    this.sky = createSkyDome();
    this.sky.visible = false;
    this.scene.add(this.sky);

    this.post = new Post(renderer);
    this.style = this._loadStyle(opts);
    this.tune = this._loadTune();
    // The cubes in the room, each its own style and tune (its material
    // sliders; the world's, sound's and the Cubicle's are the same in all).
    // The selected one is this.style / this.tune - what the panels edit.
    this.cubes = [{ slot: 0, style: this.style, tune: this.tune }];
    this.sel = 0;
    this.stackOrder = [0]; // (bottom to top: see stack)
    this.st = null; // (resolved settings: see applyStyle)
    const t0 = resolveSettings(this.tune, TEXTURES[this.style.texture]);
    this.sb = new SoftBody({ ...(opts.sim || {}), size: t0.size, bevel: EDGES[this.style.edges].bevel * t0.size });
    this.cell = this.sb.p.size / this.sb.p.res; // (the mesh's cells: see _resolution)
    this.sb.loadCube(0, opts.dropHeight ?? 1.1, 0, 0.18);

    this.audio = new AudioEngine();
    this.audio.panFn = (p) => this._pan(p.x, p.y, p.z);
    this.M = makeMaterials(this.env);
    this.nails = new NailSystem(this);
    this.particles = new Particles(this);
    this.fxScene = this.particles.scene;
    this.healer = new Healer(this);
    this.swapper = new Swapper(this); // (putting on a saved cube, with ceremony)
    this.onHealStart = [];
    this.onHealEnd = [];
    this.onColor = [];
    this.droplets = new Droplets(this);
    this.fluid = new Fluid(this); // (molten jelly: see TorchTool, FreezeTool)
    this.strands = new Strands(this); // (strings of goo: torn, dripping)
    this.healZoom = 0;
    this.flash = 0;
    this.anchorProviders = [() => this.nails.anchors()];
    this.bubbles = new Bubbles(this);
    this.flour = new Flour(this); // (on the floor, and on the jelly: see FlourTool)
    this.eyes = new Eyes(this); // (googly: see EyesTool, eyes.js)
    this.glitter = new Glitter(this);
    this.portraits = new Portraits(this); // (a cube's picture, taken properly: see portrait.js)
    this.cubiplication = new Cubiplication(this); // (fed jelly, a cube cubiplies - see tools/feed.js)
    this.dice = new DiceWatch(this); // (a die says what it rolled - see dice.js)
    // the glass room (Settings > World), as it was left
    this.room = new GlassRoom(this);
    try {
      if (localStorage.getItem('cube-sim-room') === '1') this.room.setOn(true);
    } catch (e) {
      /* private mode */
    }
    this.onNailHit = (hp) => {
      this.audio.nailHit(1);
      this.markDamaged();
      if (hp) this.glowPulse(hp.x, hp.y, hp.z, 0.7);
    };

    this.clock = { last: performance.now(), t: 0 };
    this.timeScale = 1;
    this.stats = { physMs: 0, frameMs: 0, frames: 0, physLast: 0, renderLast: 0 };
    // (parts of the drawing left out, for ?stats' bench - and its time then
    // taken to when the GPU's done with the frame: see ui/stats.js)
    this.skip = { floorFx: false, refl: false, room: false, jelly: false, fx: false, bloom: false, aa: false, adapt: false };
    // (a clip being recorded: its mark drawn over each frame - see ui/clips.js)
    this.recording = false;
    this.markTex = null;
    this.benchSync = false;
    this._px = new Uint8Array(4);
    this.substepRate = 720; // physics substeps per second
    this.isTouch = false;
    this._panV = new THREE.Vector3();
    this._hitStop = 0;
    this._resizePending = false;
    this.splash = null; // the opening splash (see main.js, ui/splash.js)
    this.splashHold = false; // keeps the cube up while the splash shows
    // the cube hangs a moment before it drops, while the physics code warms
    // up on a throwaway body (Safari runs cold code slowly at first)
    this.intro = { job: physicsWarmJob(), t: 0, ready: false, done: false, jobReady: false, twinDone: false, gpu: 0, twin: null };
    this._bootAt = performance.now();
    this.paused = false;
    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this.onFrame = [(sdt, dt) => this.dice.update(dt)];
    this.damaged = false;

    const uiRoot = document.getElementById('ui');
    this.overlay = new Overlay(document.body);
    this.tilt = new Tilt(this); // (before the UI: its switch lives in Settings)
    if (uiRoot) this.ui = new UI(this, uiRoot);

    this.tools = {
      hand: new HandTool(this),
      knife: new KnifeTool(this),
      dicer: new DicerTool(this),
      nailgun: new NailGunTool(this),
      holegun: new HoleGunTool(this),
      autogun: new AutoGunTool(this),
      gelgun: new GelGunTool(this),
      acid: new AcidTool(this),
      flour: new FlourTool(this),
      eyes: new EyesTool(this),
      mallet: new MalletTool(this),
      torch: new TorchTool(this),
      freeze: new FreezeTool(this),
      baller: new BallerTool(this),
      cuber: new CuberTool(this),
      feed: new FeedTool(this),
      bomb: new BombTool(this),
      syringe: new SyringeTool(this),
      magnet: new MagnetTool(this),
      twist: new TwistTool(this),
    };
    this.tool = null;
    this.setTool('hand');
    this._restoreScene();
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
    st.eyes = copyEyes(saved.eyes);
    st.surface = SURFACE[saved.surface] ? saved.surface : 'none';
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
    if (opts.shape && GRAD_SHAPE_INDEX[opts.shape] !== undefined) {
      st.flavor = 'layers';
      st.layers.shape = opts.shape;
    }
    if (!(st.layers.repeat >= 1)) st.layers.repeat = 1;
    if (!Number.isFinite(st.layers.bias)) st.layers.bias = 0;
    if (!Array.isArray(st.layers.colors) || st.layers.colors.length < MIN_LAYERS) st.layers.colors = [...DEFAULT_STYLE.layers.colors];
    st.layers.colors = st.layers.colors.slice(0, MAX_LAYERS);
    st.layers = copyLayers(st.layers);
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

  // what's round a cube as it's named (see namegen): the place, glow mode,
  // the date and time, and where in the world (for its holidays and seasons)
  nameCtx() {
    return { place: this.place, theme: this.theme, now: new Date(), locale: navigator.language || '' };
  }

  // the room as it is (its cubes, their looks, names and families) for next time
  saveScene() {
    try {
      localStorage.setItem('cube-sim-scene', JSON.stringify({ sel: this.sel, order: this.stackOrder, cubes: this.cubes.map((c) => ({ slot: c.slot, style: c.style, tune: c.tune, name: c.name || '', lin: c.lin || null })) }));
    } catch (e) {
      /* private mode */
    }
  }

  applyStyle() {
    const f = resolveFlavor(this.style);
    const tex = TEXTURES[this.style.texture];
    const st = this.settings;
    this.jelly.setStyle(f, { ...tex, ...st }, this.sb.p.size);
    const sb = this.sb;
    // every cube its own material and look (and bubbles)
    const fizz = [];
    for (const cb of this.cubes) {
      const ct = TEXTURES[cb.style.texture], cs = resolveSettings(cb.tune, ct);
      fizz.push({ slot: cb.slot, count: cs.bubbles, scale: cs.bubbleSize });
      // (its surface map holds on better, or slides: see surfaces.js grip)
      sb.setCube(cb.slot, {
        mu: App.safeMu(cs.mu, cs.weight, sb.cSize[cb.slot], cs.lambda, cs.gravity),
        damping: cs.damping, lambdaRatio: cs.lambda, bounce: cs.bounce, friction: cs.grip * (SURFACE[cb.style.surface]?.grip ?? 1),
        rigidity: cs.rigidity, density: cs.weight, airDrag: cs.airDrag,
      });
      this.jelly.setCubeLook(cb.slot, resolveFlavor(cb.style), { ...ct, ...cs, surface: cb.style.surface, trim: cb.style.trim, bevelRatio: (EDGES[cb.style.edges] || EDGES[DEFAULT_STYLE.edges]).bevel }, sb.cSize[cb.slot]);
    }
    this.jelly.multiCube = this.cubes.length > 1; // (their shadows on each other)
    // (a gradient across, corner to corner or out from the middle: the jelly
    // draws where each line of sight leaves it as a whole rest point)
    // (and a layered one with a coat: its rest height can't share with the
    // coat the back pass keeps for what the line of sight leaves through)
    this.jelly.needRest = this.cubes.some((cb) => {
      const f = resolveFlavor(cb.style), t = TEXTURES[cb.style.texture];
      return !!f.layers && (f.shape !== 'up' || t.sugar > 0 || t.dust > 0 || !!cb.floured);
    });
    // (any layered one: the floor takes its shadow's colour band by band)
    this.jelly.fxUniforms.tintLocal.value = this.cubes.some((cb) => resolveFlavor(cb.style).layers) ? 1 : 0;
    sb.p.mu = App.safeMu(st.mu, st.weight, sb.p.size, st.lambda, st.gravity);
    sb.p.damping = st.damping;
    sb.p.lambdaRatio = st.lambda;
    sb.p.bounce = st.bounce;
    sb.p.friction = st.grip * (SURFACE[this.style.surface]?.grip ?? 1);
    sb.p.rigidity = st.rigidity;
    sb.p.grabK = st.handPull;
    sb.p.contactGrip = st.contactGrip;
    sb.p.airDrag = st.airDrag;
    sb.p.gravity = -st.gravity;
    this.st = st; // (resolved settings, for tools that read them each use)
    sb.p.density = st.weight; // (each cube's own mass: setCube)
    sb.wakeAll();
    this.audio.setLevels(st.volume, st.impacts, st.wobble);
    this.bubbles?.configure(fizz);
    this.glitter?.configure({ mode: this.style.glitter, count: st.glitterAmount, size: st.glitterSize, sparkle: st.glitterSparkle });
    this.flavor = f;
    this.color = flavorMainHex(f);
    for (const fn of this.onColor || []) fn(this.color, f);
    this.ui?.setStyle(this.style, f);
    this.ui?.setSettings?.(st, tex);
    try {
      localStorage.setItem('cube-sim-style', JSON.stringify(this.style));
      localStorage.setItem('cube-sim-tune', JSON.stringify(this.tune));
      this.saveScene();
    } catch (e) {
      /* private mode */
    }
  }

  setFlavor(id) {
    // (Rubik, picked again: scrambled anew)
    if (id === 'rubik' && (this.style.flavor === 'rubik' || !(this.style.rubik >= 1))) {
      this.style.rubik = 1 + Math.floor(Math.random() * 65535);
      delete this.style.rubikState; // (scrambled afresh: no turns made yet)
    }
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

  // (a colour more goes on the end - set stops: halfway from the last to the
  // end, or all evened out if there's no room; a colour fewer comes off it)
  setLayerCount(n) {
    const L = this.style.layers;
    n = Math.max(MIN_LAYERS, Math.min(MAX_LAYERS, n));
    if (L.shape === 'free') this._freeNodes(); // (the points stay where they are)
    while (L.colors.length < n) {
      L.colors.push(nextLayerColor(L.colors[L.colors.length - 1]));
      if (L.nodes) L.nodes.push(App._freeRoom(L.nodes));
      if (L.stops) {
        const last = L.stops[L.stops.length - 1];
        if (1 - last > 0.08) L.stops.push((last + 1) / 2);
        else L.stops = null;
      }
    }
    if (L.colors.length > n) L.colors.length = n;
    if (L.stops) L.stops.length = L.colors.length;
    if (L.nodes) L.nodes.length = L.colors.length;
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  // (a preset's colours evenly spaced; its shape, if it has one)
  setLayerPreset(id) {
    const p = LAYER_PRESETS.find((q) => q.id === id);
    if (!p) return;
    const L = this.style.layers;
    L.colors = [...p.colors];
    if (p.blur !== undefined) L.blur = p.blur;
    L.repeat = p.repeat || 1;
    L.bias = p.bias || 0;
    L.stops = null;
    L.nodes = null;
    if (p.shape) L.shape = p.shape;
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  // ---- the gradient (see styles.js): its shape; its stops' places (0..1
  // along one round of it - null, evenly spaced), kept in order with their
  // colours. Moving one past another swaps them: it returns where it is now.
  setLayerShape(id) {
    if (GRAD_SHAPE_INDEX[id] === undefined) return;
    this.style.layers.shape = id;
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  setLayerStops(stops) {
    const L = this.style.layers;
    L.stops = Array.isArray(stops) && stops.length === L.colors.length ? stops.map((v) => Math.min(1, Math.max(0, v))) : null;
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  moveLayerStop(i, p) {
    const L = this.style.layers, s = gradStops({ layers: L.colors, stops: L.stops });
    if (i < 0 || i >= s.length) return i;
    s[i] = Math.min(1, Math.max(0, p));
    const order = s.map((_, k) => k).sort((a, b) => s[a] - s[b] || a - b);
    L.colors = order.map((k) => L.colors[k]);
    L.stops = order.map((k) => s[k]);
    if (L.nodes?.length === order.length) L.nodes = order.map((k) => L.nodes[k]);
    this.style.flavor = 'layers';
    this.applyStyle();
    return order.indexOf(i);
  }

  // a stop more at place p, in the colour there (one round, no bias - as
  // the editor shows it): its index, or -1 when there are all there can be
  addLayerStop(p, hex = null) {
    const L = this.style.layers;
    if (L.colors.length >= MAX_LAYERS) return -1;
    p = Math.min(1, Math.max(0, p));
    const s = gradStops({ layers: L.colors, stops: L.stops });
    const col = hex || gradColorAt({ layers: L.colors, stops: L.stops, blur: L.blur, repeat: 1, bias: 0 }, p);
    let at = s.findIndex((v) => v > p);
    if (at < 0) at = s.length;
    L.colors.splice(at, 0, col);
    s.splice(at, 0, p);
    L.stops = s;
    if (L.nodes) L.nodes.splice(at, 0, App._freeRoom(L.nodes));
    this.style.flavor = 'layers';
    this.applyStyle();
    return at;
  }

  // subdivided: the cube as little cubes, n a side, each with the whole gradient
  setLayerTiles(n) {
    this.style.layers.tiles = Math.min(MAX_TILES, Math.max(1, Math.round(n)));
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  // the die: a gradient no one's seen before, in the shape it has (see
  // genetics.js randomGradient)
  rollGradient() {
    const L = this.style.layers;
    Object.assign(L, copyLayers(randomGradient(L.shape || 'up')));
    this.style.flavor = 'layers';
    this.applyStyle();
    this.sb.impulse(0, 0.6, 0, 0, -1, 0, 3, 0.8); // (a jiggle to show it off)
  }

  // ---- a freeform gradient's points (see freeform.js): each colour's place
  // on (or in) the cube, as shares of its side, and its strength
  _freeNodes() {
    const L = this.style.layers;
    if (!L.nodes || L.nodes.length !== L.colors.length) L.nodes = freeNodes({ layers: L.colors, nodes: L.nodes }).map((q) => ({ ...q }));
    return L.nodes;
  }

  // (a place for a new point: of a spread of them, the one furthest from those there)
  static _freeRoom(nodes) {
    let best = null, bd = -1;
    for (const c of freeNodesDefault(14)) {
      const d = Math.min(...nodes.map((q) => Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z)), 9);
      if (d > bd) [best, bd] = [c, d];
    }
    return { ...best };
  }

  moveLayerNode(i, x, y, z) {
    const N = this._freeNodes();
    if (!N[i]) return;
    Object.assign(N[i], { x, y, z });
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  setLayerNodeStrength(i, k) {
    const N = this._freeNodes();
    if (!N[i]) return;
    N[i].k = Math.min(FREE_K_MAX, Math.max(FREE_K_MIN, k));
    this.style.flavor = 'layers';
    this.applyStyle();
  }

  // a point more at (x, y, z), in the colour there unless given: its index,
  // or -1 when there are all there can be
  addLayerNode(x, y, z, hex = null) {
    const L = this.style.layers;
    if (L.colors.length >= MAX_LAYERS) return -1;
    const N = this._freeNodes();
    L.colors.push(hex || freeColorAt({ layers: L.colors, nodes: N, blur: L.blur }, x, y, z));
    N.push({ x, y, z, k: 1 });
    if (L.stops) L.stops.push(1);
    this.style.flavor = 'layers';
    this.applyStyle();
    return L.colors.length - 1;
  }

  removeLayerNode(i) {
    const L = this.style.layers;
    if (L.colors.length <= MIN_LAYERS || i < 0 || i >= L.colors.length) return false;
    const N = this._freeNodes();
    L.colors.splice(i, 1);
    N.splice(i, 1);
    if (L.stops?.length > i) L.stops.splice(i, 1);
    this.style.flavor = 'layers';
    this.applyStyle();
    return true;
  }

  removeLayerStop(i) {
    const L = this.style.layers;
    if (L.colors.length <= MIN_LAYERS || i < 0 || i >= L.colors.length) return false;
    const s = gradStops({ layers: L.colors, stops: L.stops });
    L.colors.splice(i, 1);
    s.splice(i, 1);
    L.stops = s;
    if (L.nodes?.length > i) L.nodes.splice(i, 1);
    this.style.flavor = 'layers';
    this.applyStyle();
    return true;
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

  // its surface map (surfaces.js): moulded into its skin - a jiggle to show it off
  setSurface(id) {
    if (!SURFACE[id] || this.style.surface === id) return;
    this.style.surface = id;
    this.applyStyle();
    if (id !== 'none') this.sb.impulse(0, 0.6, 0, 0, -1, 0, 3, 0.6);
    if (id === 'dice') this.ui?.hint("A die - throw it and it'll tell you what it rolled", 3000);
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

  // Two hands pulling the jelly apart tear it (Settings > Feel > Tearing).
  get tearing() {
    return this.tune.tear !== false;
  }

  setTearing(on) {
    for (const cb of this.cubes) cb.tune.tear = !!on;
    try {
      localStorage.setItem('cube-sim-tune', JSON.stringify(this.tune));
    } catch (e) {
      /* private mode */
    }
  }

  // One fine-tuning slider changed (value in physical units).
  setSetting(key, value, final = true) {
    this.tune[key] = value;
    if (!PER_CUBE(key)) for (const cb of this.cubes) cb.tune[key] = value; // (the same in every cube)
    if (key === 'size') {
      if (final) this.setCubeSize(value);
      return;
    }
    this.applyStyle();
  }

  // only: just these keys (a Cubicle tool's knobs: see Ui) - else all of it
  resetSettings(only = null) {
    const oldSize = this.sb.p.size;
    // (the jelly resets - the selected cube's material and everyone's world;
    // your sound levels and the tearing switch stay)
    const keep = new Set(['volume', 'impacts', 'wobble', 'tear']);
    for (const cb of this.cubes) {
      for (const k of Object.keys(cb.tune)) if (!keep.has(k) && (!only || only.includes(k)) && (cb === this.cube || !PER_CUBE(k))) delete cb.tune[k];
    }
    if (only) for (const k of only) delete this.tune[k];
    this.applyStyle();
    if (Math.abs(this.settings.size - oldSize) > 1e-6) this.setCubeSize(this.settings.size);
  }

  // The Cubicle's every tool at once: gentle (softer, slower, smaller),
  // normal (as made) or wild (turned right up) - each knob to the same far
  // along its own scale.
  labPreset(id) {
    const t = { gentle: 0.22, wild: 0.86 }[id];
    const keys = SETTINGS.filter((st) => st.lab && st.tool && st.key !== 'dice' && st.key !== 'boilOff');
    if (t === undefined) return this.resetSettings(keys.map((st) => st.key));
    for (const st of keys) {
      // (the middle of a knob's scale is its normal: this far below or above it)
      const mid = st.from(st.def ?? 1), v = st.to(t < 0.5 ? mid * (t / 0.5) : mid + (1 - mid) * ((t - 0.5) / 0.5));
      this.tune[st.key] = st.int ? Math.round(v) : v;
      for (const cb of this.cubes) cb.tune[st.key] = this.tune[st.key];
    }
    this.applyStyle();
  }

  // The selected cube's size (each its own): it re-forms at the new size -
  // with others about, just it, and they stay as they are.
  setCubeSize(size) {
    const sb = this.sb, slot = this.cube.slot, old = sb.cSize[slot];
    this.tune.size = size;
    if (Math.abs(size - old) < 1e-6) return;
    this._edgeMorphTick(0, true);
    if (this.healer.active || this.healer.settling) this.healer.cancel();
    this.swapper.stop?.();
    if (this.cubes.length > 1) {
      this.applyStyle();
      this.heal({ only: slot, scale: size / old });
      return;
    }
    sb.p.size = size;
    sb.p.bevel = EDGES[this.style.edges].bevel * size;
    this.applyStyle();
    this.heal({ scale: size / old });
  }

  // The selected cube's edges' trim: scalloped, stitched... (see styles.js TRIMS)
  setTrim(id) {
    if (!TRIM[id] || (this.style.trim || 'none') === id) return;
    this.style.trim = id;
    this.applyStyle();
    this.sb.impulse(0, 0.6, 0, 0, -1, 0, 3, 0.5);
  }

  // The selected cube's edges (each cube has its own).
  setEdges(id) {
    if (!EDGES[id] || this.style.edges === id) return;
    const sb = this.sb, slot = this.cube.slot;
    // (one cube's change of shape at a time)
    if (this._edgeMorph && this._edgeMorph.slot !== slot) this._edgeMorphTick(0, true);
    const from = this._edgeMorph ? this._edgeMorph.cur : sb.cBevel[slot];
    this.style.edges = id;
    sb.p.bevel = sb.cBevel[slot] = this.bevelOf(this.cube);
    this.applyStyle();
    // A whole cube changes shape: its rest shape eases from one rounding to
    // the other and the jelly springs after it. A cut or battered one
    // re-forms with the new rounding (the heal - with others in the room,
    // they all do, each with its own).
    if (!this._whole(slot) || this.healer.active || !this.intro.done) {
      this._edgeMorph = null;
      this.healer.active = false;
      this.heal();
      return;
    }
    const half = sb.cSize[slot] / 2, R = slot * REST_STEP, M = this._edgeMorph;
    // (the rest positions with no rounding at all, worked out once; its
    // rest shape sits R along x)
    let G = M && M.topo === sb.topoVersion ? M.G : null, idx = G ? M.idx : null;
    if (!G) {
      idx = [];
      // (not the gel gun's blobs: their rest shapes are their own)
      for (let i = 0; i < sb.nV; i++) if (sb.vCube[i] === slot && !sb.vTag[i]) idx.push(i);
      G = new Float64Array(idx.length * 3);
      idx.forEach((i, j) => unbevelPoint(sb.X[i * 3] - R, sb.X[i * 3 + 1], sb.X[i * 3 + 2], half, from, G, j * 3));
    }
    this._edgeMorph = { G, idx, slot, R, topo: sb.topoVersion, half, from, to: sb.cBevel[slot], cur: from, t: 0, dur: 0.6 };
  }

  // cube slot all in one piece, nothing cut out of it, nothing melted
  _whole(slot) {
    const sb = this.sb, ps = sb.pieces.filter((pc) => pc.cube === slot);
    if (ps.length !== 1 || ps[0].verts.length !== sb.cN[slot]) return false;
    for (const i of ps[0].verts) if (sb.melt[i]) return false;
    return !this.damaged || this.cubes.length > 1;
  }

  // (finish: all the way there now - another cube's turn, or a rebuild)
  _edgeMorphTick(dt, finish = false) {
    const M = this._edgeMorph;
    if (!M) return;
    const sb = this.sb, X = sb.X, R = M.R;
    // (cut or rebuilt meanwhile: the new rounding as it is, at once)
    const broken = M.topo !== sb.topoVersion;
    M.t += dt;
    const k = broken || finish ? 1 : Math.min(1, M.t / M.dur);
    const was = M.cur;
    M.cur = M.from + (M.to - M.from) * k * k * (3 - 2 * k);
    if (broken) {
      const g = new Float64Array(3);
      for (let i = 0; i < sb.nV; i++) {
        if (sb.vCube[i] !== M.slot || sb.vTag[i]) continue;
        unbevelPoint(X[i * 3] - R, X[i * 3 + 1], X[i * 3 + 2], M.half, was, g);
        bevelPoint(g[0], g[1], g[2], M.half, M.to, X, i * 3);
        X[i * 3] += R;
      }
    } else {
      const G = M.G;
      for (let j = 0; j < M.idx.length; j++) {
        const i = M.idx[j];
        bevelPoint(G[j * 3], G[j * 3 + 1], G[j * 3 + 2], M.half, M.cur, X, i * 3);
        X[i * 3] += R;
      }
    }
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

  // Jelly colour at a world point (the cube that's there: where it is in
  // its gradient, or which of its Rubik's stickers).
  flavorColorAt(x, y, z) {
    const sb = this.sb, r = sb.locate(x, y, z);
    if (!r) return this.color;
    const p = [0, 0, 0], T = sb.T;
    for (let q = 0; q < 4; q++) for (let c = 0; c < 3; c++) p[c] += sb.X[T[r.tet * 4 + q] * 3 + c] * r.bary[q];
    return this.flavorColorAtRest(p[0], p[1], p[2], sb.tCube[r.tet]);
  }

  // ...at a rest point of cube slot k (as the body keeps them: its slot's
  // offset in x)
  flavorColorAtRest(rx, ry, rz, k = this.cube?.slot ?? 0) {
    const sb = this.sb, cb = this.cubes.find((c) => c.slot === k) || this.cube;
    const f = resolveFlavor(cb.style), x = rx - k * REST_STEP;
    if (f.id === 'rubik') {
      const [face, cell] = rubikCellAt(x, ry, rz, sb.cSize[k]);
      return RUBIK_COLORS[f.state[face * 9 + cell]];
    }
    if (!f.layers) return flavorMainHex(f);
    const s = sb.cSize[k], [tx, ty, tz] = tileLocal(x, ry, rz, s, f.tiles);
    if (f.shape === 'free') return freeColorAt(f, tx, ty, tz, s);
    return gradColorAt(f, gradT(f.shape, tx, ty, tz, s));
  }

  // ...where vertex i, or tet t (its middle), sits
  flavorColorAtVertex(i) {
    const X = this.sb.X;
    return this.flavorColorAtRest(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], this.sb.vCube[i]);
  }

  flavorColorAtTet(t) {
    const sb = this.sb, T = sb.T, X = sb.X;
    let x = 0, y = 0, z = 0;
    for (let q = 0; q < 4; q++) {
      const i = T[t * 4 + q] * 3;
      x += X[i] / 4;
      y += X[i + 1] / 4;
      z += X[i + 2] / 4;
    }
    return this.flavorColorAtRest(x, y, z, sb.tCube[t]);
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
    if (this.healer.active || this.swapper?.active) return false;
    this.tool?.up?.();
    this._edgeMorphTick(0, true);
    this.healer.start(opts);
    return true;
  }

  // a deed for the record of the cube on show (see Cubby: healed, cuts, ...)
  tally(kind) {
    this.ui?.cubby?.tally(kind);
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
  // With the splash up, everything that would stutter the drop is done
  // behind it first (its show runs by itself, off the page's thread): the
  // whole job, not just its start - its rest, run during the drop, had that
  // at 30 frames a second - then the real cube's own code (a twin of it),
  // then the GPU's (_warmGPU). Only then does the splash leave: the drop is
  // its reveal. (9 s at most, however slow the device.)
  _introStep(dt) {
    const I = this.intro, behind = this.splashHold;
    I.t += dt;
    // (the surface maps' bake shaders compile meanwhile, out of the page's
    // way - see _warmGPU)
    if (behind && !I.gpu) {
      this.jelly.readyBakes();
      I.gpu = 1;
    }
    if (!I.jobReady && this._warmSlice(behind ? 12 : 9) === 'ready') I.jobReady = true;
    // then, behind the splash, the real cube's own code: a first visit's
    // fresh browser can still be compiling its fast tier, and the drop then
    // ran at a few frames a second for seconds - so step a twin of the cube
    // (same settings, same shapes) until its steps settle (at most ~6 s)
    if (I.jobReady && !I.ready) {
      if (!behind) I.ready = true;
      else if (!I.twinDone) I.twinDone = this._warmTwin() || I.t > 6;
      else if (I.job) this._warmSlice(12);
      else I.ready = this._warmGPU();
      if (performance.now() - this._bootAt > 9000) I.ready = true;
    }
    // (behind the splash the job just carries on: the drop is its reveal -
    // let go a moment after the splash starts to leave: the page's own work
    // to start that (its styles, the name's flight, a repaint) took a frame
    // of 50 ms, and the dark only starts to fall away 0.1 s in)
    const sp = this.splash, leaving = !sp?.leftAt || performance.now() - sp.leftAt > 120;
    if ((I.ready || I.t > 1.2) && !this.splashHold && leaving) I.done = true;
    if (I.done) this.introMs = I.t * 1000;
  }

  // The GPU's warm-up, behind the splash, a step a frame (true when done):
  // the surface maps' bake shaders (made ready in the background a few
  // seconds in, they landed in the drop), and a frame drawn with the floor's
  // effects as they are at rest and while it moves (each draws into its own
  // targets: first drawn mid-drop, or as it came to rest, they stalled the
  // frame) - the last as the drop's first frame will be. (Not the jelly's
  // shader with everything in it: it compiles aside, after, unseen - here it
  // held the splash up for seconds.)
  _warmGPU() {
    const I = this.intro, J = this.jelly;
    switch (I.gpu) {
      case 0:
        J.readyBakes();
        I.gpu = 1;
        return false;
      case 1:
        if (J.bakesReady) I.gpu = 3;
        return false;
      case 3:
      case 4:
        J.forceMoving = I.gpu === 4;
        J._fxSig = null;
        this.render();
        I.gpu++;
        return false;
      default:
        J.forceMoving = null;
        J._fxSig = null;
        return true;
    }
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
    const r = o.radius * (1 + (this._lift || 0) * 1.5) * (1 + (this.healZoom || 0)) * (this._frameR || 1);
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
    // (several cubes - a stack - the view rises and backs off to keep them in)
    let fy = 0.44, fr = 1;
    if (this.cubes.length > 1) {
      let top = 0;
      for (const pc of this.sb.pieces) top = Math.max(top, pc.bbox[4]);
      top = Math.min(top, this.sb.p.ceiling);
      fy = Math.max(0.44, top * 0.42);
      fr = Math.max(1, top / 1.7, this.sb.p.arenaRadius / (this._viewArena || this.sb.p.arenaRadius));
    }
    const kf = 1 - Math.exp(-dt * 2.5);
    this._frameY = (this._frameY ?? 0.44) + (fy - (this._frameY ?? 0.44)) * kf;
    this._frameR = (this._frameR ?? 1) + (fr - (this._frameR ?? 1)) * kf;
    this.orbit.target.y = this._frameY;
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
    this._viewArena = this.sb.p.arenaRadius;
    if (this.cubes && this.cubes.length > 1) this._arena();
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
    this.strands?.mat.uniforms.uInvRes.value.set(1 / pw, 1 / ph);
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

  // ...or, missing it, the jelly it passes close by - down a hole shot
  // through it along the line of sight, a hand still takes hold of its wall
  pickJellyNear(ray) {
    const hit = this.pickJelly(ray);
    if (hit) return hit;
    const o = ray.origin, d = ray.direction, sb = this.sb;
    return sb.pickNear(o.x, o.y, o.z, d.x, d.y, d.z, Math.max(0.09 * sb.p.size, 1.1 * sb.hCell));
  }

  _bindInput() {
    const el = this.canvas;
    const pointers = new Map();
    // (any finger or button held anywhere on the page - a slider's too - and
    // when the last came or went: the jelly's shaders are compiled only while
    // it's quiet, see JellyView.setFeatures)
    this._held = new Set();
    this._inputAt = 0;
    const press = (e) => {
      if (e.type === 'pointerdown') this._held.add(e.pointerId);
      else this._held.delete(e.pointerId);
      this._inputAt = performance.now();
    };
    for (const t of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(t, press, true);
    window.addEventListener('blur', () => this._held.clear());
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
          const hit = this.tool.id === 'hand' ? this.pickJellyNear(ray) : this.pickJelly(ray);
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
      if (this.healer.active || this.swapper.active) {
        mode = 'orbit';
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      const ray = this.rayFromClient(e.clientX, e.clientY);
      const hit = this.pickJelly(ray);
      // (several cubes: the one you touch is the one the panels edit)
      if (hit && this.cubes.length > 1) this.selectCube(this.sb.pieces[hit.piece]?.cube ?? this.cube.slot);
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
        // (a tool may want it: the googly eyes', over an eye, sizes it)
        if (this.tool?.wheel?.(e, this.rayFromClient(e.clientX, e.clientY))) return;
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
      this.swapper.update(sdt);
      this.tilt.update(dt);
      this._edgeMorphTick(dt);
      this._selRing(dt);
      this.room.update(dt);
      this.cubiplication.update(dt);
      const nS = Math.max(4, Math.min(24, Math.round(this.substepRate * sdt)));
      this.sb.p.substeps = nS;
      const p0 = performance.now();
      if (!this.intro.done) this._introStep(dt);
      else if (sdt > 0) {
        this.sb.step(sdt);
        this._stackHold(sdt);
      }
      const pm = performance.now() - p0;
      // the rest of the warm-up: a small slice a frame
      if (this.intro.done && this.intro.job) this._warmSlice(2);
      this.stats.physLast = pm;
      // adapt substep rate to the device (not to the intro's warm-up work)
      if (this.intro.done) this.stats.physMs = this.stats.physMs * 0.9 + pm * 0.1;
      if (this.intro.done && this.sb.anyAwake) {
        // (its share of the frame: more of a longer frame)
        const bud = 9.5 * Math.min(2, Math.max(1, dt * 60));
        // (far over - a pile of debris all at once - it backs off within a
        // few frames, not thirty, and a little further while it lasts)
        const over = this.stats.physLast / bud;
        if (over > 2) this.substepRate = Math.max(360, this.substepRate * 0.92);
        else if (this.stats.physMs > bud) this.substepRate = Math.max(420, this.substepRate * 0.985);
        else if (this.stats.physMs < bud * 0.63) this.substepRate = Math.min(720, this.substepRate * 1.004);
      }
      this.nails.update(sdt);
      this.droplets.update(sdt);
      this.fluid.update(sdt);
      this.flour.update(sdt);
      this.strands.update(sdt);
      this.bubbles.update();
      this.eyes.update(sdt);
      for (const k in this.tools) if (this.tools[k] !== this.tool && this.tools[k].background) this.tools[k].update(sdt, dt);
      this.particles.update(sdt);
      this._impactSounds();
      this._wobbleSounds();
      this._impactGlow();
    }
    this._themeTick(dt);
    this._placeTick(dt);
    // (a re-cube: the caustics fade out while it lasts - pieces flying about
    // spread their light thin and wild, and their passes cost the most just
    // then - and come back after; and a lot of bits are seen through each
    // other only two deep, the rest of the refraction layers' passes saved)
    const swarm = this.healer.active && this.sb.pieces.length > 6;
    const causGoal = this.healer.active ? 0 : 1, cl = this.jelly.causticLevel;
    this.jelly.causticLevel = cl + (causGoal - cl) * Math.min(1, dt * (causGoal < cl ? 6 : 2.5));
    this.jelly.layerCap = swarm ? 2 : Infinity;
    this._updateCamera(dt);
    this.overlay.draw(dt);
    const r0 = performance.now();
    // (nothing to draw under the splash, past the first frames that build
    // the GPU's state; its own animation gets the time - till just before it
    // leaves: the drop's first frames are then a run's next, not the first
    // after a long pause)
    const sp = this.splash;
    const covered = sp?.active && !sp.leaving && this.stats.frames > 2 && !(sp.leaveAt && performance.now() > sp.leaveAt - 250);
    if (!covered) this.render();
    if (this.benchSync) {
      const gl = this.renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._px);
    }
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
    if (this.opts.preserve || this.skip.adapt) return;
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

  // ------------------------------------------------------------ many cubes
  get cube() {
    return this.cubes[this.sel];
  }

  // a cube's rounding (each has its own edges), at the size they all are
  bevelOf(cb) {
    return (EDGES[cb.style.edges] || EDGES[DEFAULT_STYLE.edges]).bevel * this.sizeOf(cb);
  }

  // ---- sizes: each cube its own (the Size slider: the selected one's), and
  // the mesh's cells about the same size in every cube - how big, from how
  // much jelly there is: a budget of cells that grows slower than the count
  // (eight at full resolution took the physics 120 ms a frame)
  sizeOf(cb) {
    return resolveSettings(cb.tune || {}, TEXTURES[cb.style.texture] || TEXTURES.jello).size;
  }

  static cellFor(sizes) {
    const n = Math.max(1, sizes.length), V = sizes.reduce((a, s) => a + s * s * s, 0) || 1;
    return Math.cbrt(V / (1331 * Math.pow(n, 0.35)));
  }

  // (cells a side for a cube this size)
  static resAt(size, h) {
    return Math.max(4, Math.min(12, Math.round(size / h)));
  }

  resOf(cb, h = this.cell) {
    return App.resAt(this.sizeOf(cb), h);
  }

  // the selected cube's size, resolution and rounding, for what works with one
  _syncSel() {
    const sb = this.sb, k = this.cube?.slot ?? 0;
    sb.p.size = sb.cSize[k];
    sb.p.res = sb.cRes[k];
    sb.p.bevel = sb.cBevel[k];
  }

  // The cube in slot k is the one the panels edit now.
  selectCube(slot) {
    const i = this.cubes.findIndex((c) => c.slot === slot);
    if (i < 0 || i === this.sel) return;
    this.sel = i;
    this.style = this.cubes[i].style;
    this.tune = this.cubes[i].tune;
    this._syncSel();
    this.applyStyle();
    // (a glimmer through it, and a ping round it on the floor, so you see which)
    const sb = this.sb;
    for (let v = 0; v < sb.nV; v++) if (sb.vCube[v] === slot) sb.glow[v] = Math.max(sb.glow[v], 0.6);
    this.jelly.fxUniforms.selPing.value = 0;
    this.ui?.cubeSelected?.(slot);
  }

  // Towers that stand. Soft jelly stacked three high rocks over like an
  // upturned pendulum - its contacts give too much under this gravity, and
  // the smallest lean grows (a tower built dead straight fell in 2.5 s). So a
  // cube resting calm in a stack is lightly held where it settled: a soft
  // spring and a little damping on its middle - the whole cube, never its
  // wobble. A real push lets go (moving fast, grabbed, or shoved a few cm),
  // and down it comes.
  _stackHold(dt) {
    const sb = this.sb;
    if (this.cubes.length < 2 || this.healer.active || this.swapper.active || this.cubiplication.active) {
      this._holds = null;
      return;
    }
    const holds = this._holds || (this._holds = new Map());
    // each cube in one piece: that piece
    const main = [];
    for (const cb of this.cubes) {
      let only = null, n = 0;
      for (const pc of sb.pieces) if (pc.cube === cb.slot) (only = pc), n++;
      if (n === 1 && only.bbox[3] > only.bbox[0]) main.push({ slot: cb.slot, pc: only, s: sb.cSize[cb.slot], stacked: false });
    }
    // which rest on or carry another: overlapping from above, top to bottom within a touch
    for (let a = 0; a < main.length; a++)
      for (let b = 0; b < main.length; b++) {
        if (a === b) continue;
        const A = main[a].pc.bbox, B = main[b].pc.bbox, s = Math.min(main[a].s, main[b].s);
        const ox = Math.min(A[3], B[3]) - Math.max(A[0], B[0]), oz = Math.min(A[5], B[5]) - Math.max(A[2], B[2]);
        if (ox > 0.3 * s && oz > 0.3 * s && Math.abs(A[1] - B[4]) < 0.08 * s) main[a].stacked = main[b].stacked = true;
      }
    const seen = new Set(), x = sb.x, X = sb.X, m = sb.m;
    for (const M of main) {
      if (!M.stacked) continue;
      seen.add(M.slot);
      const pc = M.pc, v = pc.vel, speed = Math.hypot(v[0], v[1], v[2]);
      if (pc.asleep) continue;
      if (speed > 1.0 || sb.grabs.some((g) => g.piece === pc.id)) {
        holds.delete(M.slot);
        continue;
      }
      // which way its own up points now (where its rest heights went)
      let W = 0, cy = 0;
      for (const i of pc.verts) {
        W += m[i];
        cy += X[i * 3 + 1] * m[i];
      }
      cy /= W || 1;
      let ux = 0, uy = 0, uz = 0;
      for (const i of pc.verts) {
        const w = m[i] * (X[i * 3 + 1] - cy);
        ux += (x[i * 3] - pc.com[0]) * w;
        uy += (x[i * 3 + 1] - pc.com[1]) * w;
        uz += (x[i * 3 + 2] - pc.com[2]) * w;
      }
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      let h = holds.get(M.slot);
      if (!h) {
        if (speed < 0.3) holds.set(M.slot, { x: pc.com[0], z: pc.com[2], ux, uy, uz });
        continue;
      }
      const dx = pc.com[0] - h.x, dz = pc.com[2] - h.z;
      // (the tilt back to where it settled: about up x settled-up)
      const ex = uy * h.uz - uz * h.uy, ey = uz * h.ux - ux * h.uz, ez = ux * h.uy - uy * h.ux;
      if (dx * dx + dz * dz > (0.14 * M.s) ** 2 || ex * ex + ey * ey + ez * ez > 0.2 ** 2) {
        holds.delete(M.slot); // (shoved past it: over it goes)
        continue;
      }
      const ax = (-60 * dx - 12 * v[0]) * dt, az = (-60 * dz - 12 * v[2]) * dt;
      // (a turn back upright, its spin about up left alone)
      const w = pc.omega, wu = w[0] * ux + w[1] * uy + w[2] * uz;
      const tx = (60 * ex - 12 * (w[0] - wu * ux)) * dt, ty = (60 * ey - 12 * (w[1] - wu * uy)) * dt, tz = (60 * ez - 12 * (w[2] - wu * uz)) * dt;
      for (const i of pc.verts) {
        const rx = x[i * 3] - pc.com[0], ry = x[i * 3 + 1] - pc.com[1], rz = x[i * 3 + 2] - pc.com[2];
        sb.v[i * 3] += ax + (ty * rz - tz * ry);
        sb.v[i * 3 + 1] += tz * rx - tx * rz;
        sb.v[i * 3 + 2] += az + (tx * ry - ty * rx);
      }
    }
    for (const k of [...holds.keys()]) if (!seen.has(k)) holds.delete(k);
  }

  // The ring on the floor round the selected cube (several of them): round
  // its biggest piece, turned as that is; it eases in and out.
  _selRing(dt) {
    const fx = this.jelly.fxUniforms, sb = this.sb, on = this.cubes.length > 1 && this.intro.done;
    const a = fx.selCol.value;
    a.w += ((on ? 1 : 0) - a.w) * Math.min(1, dt * 8);
    fx.selPing.value += dt;
    if (!on || !this.cube) return;
    const slot = this.cube.slot;
    let main = null;
    for (const pc of sb.pieces) if (pc.cube === slot && (!main || pc.verts.length > main.verts.length)) main = pc;
    if (!main) return;
    let M = 0, cx = 0, cz = 0;
    for (const i of main.verts) {
      const m = sb.m[i];
      M += m;
      cx += sb.x[i * 3] * m;
      cz += sb.x[i * 3 + 2] * m;
    }
    if (!(M > 0)) return;
    const S = fx.sel.value;
    S.set(cx / M, cz / M, sb.cSize[slot] / 2, this.healer._yawOf(main));
    if (this._selHex !== this.color) {
      this._selHex = this.color;
      const col = new THREE.Color(this.color);
      a.x = col.r;
      a.y = col.g;
      a.z = col.b;
    }
  }

  // Another cube (c: a decoded CubeR cube, or none for a plain jelly in a
  // random flavour), dropped in from above on a clear spot. Its slot, or -1.
  addCube(c = null, { drop = true } = {}) {
    if (this.cubes.length >= MAX_CUBES) {
      this.ui?.hint('That is a full house: eight cubes', 1800);
      return -1;
    }
    // (not while they're re-forming, or one alone is being swapped out)
    if (this.healer.active || (this.swapper.active && !this.swapper.multi)) {
      this.ui?.hint('One sec - still re-cubing', 1400);
      return -1;
    }
    this._edgeMorphTick(0, true);
    const used = new Set(this.cubes.map((cb) => cb.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const flavors = ['cherry', 'lime', 'blue', 'grape', 'orange', 'lemon', 'watermelon', 'cola'];
    const style = c
      ? { flavor: c.flavor, layers: copyLayers(c.layers), texture: c.texture, edges: EDGES[c.edges] ? c.edges : DEFAULT_STYLE.edges, glitter: c.glitter, rubik: Number.isFinite(c.rubik) ? c.rubik : 1, ...(c.rubikState ? { rubikState: c.rubikState } : {}), trim: TRIM[c.trim] ? c.trim : 'none', eyes: copyEyes(c.eyes), surface: SURFACE[c.surface] ? c.surface : 'none' }
      : { flavor: flavors[Math.floor(Math.random() * flavors.length)], layers: copyLayers(DEFAULT_STYLE.layers), texture: 'jello', edges: DEFAULT_STYLE.edges, glitter: 'off', eyes: Math.random() < 0.12 ? copyEyes(EYE_FACES.pair) : [], surface: Math.random() < 0.2 ? SURFACES[1 + Math.floor(Math.random() * (SURFACES.length - 1))].id : 'none' };
    // (its own material sliders; the world's as everyone's)
    const tune = {};
    for (const k of Object.keys(this.tune)) if (!PER_CUBE(k)) tune[k] = this.tune[k];
    if (c) for (const k of Object.keys(c.tune)) if (PER_CUBE(k)) tune[k] = c.tune[k];
    const sb = this.sb, size = this.sizeOf({ style, tune });
    // (its own size; fewer cells a cube as they multiply; a bigger room)
    this._resolution([size]);
    this._arena(this.cubes.length + 1);
    const [x, z, top] = this._clearSpot({ size });
    const y = drop ? Math.max(this.swapper._dropHeight(size), top + 0.3) : top;
    // (a plain one gets a name of its own, made out of what it is - and so
    // does the one already here, if it hasn't one)
    const taken = () => this.cubes.map((x) => x.name || '');
    for (const x of this.cubes) if (!x.name) x.name = nameCube({ ...x.style, tune: x.tune }, { taken: taken(), ...this.nameCtx() });
    const named = c ? c.name || '' : nameCube({ ...style, tune }, { taken: taken(), ...this.nameCtx() });
    const cb = { slot, style, tune, name: named };
    sb.addCube(slot, x, y, z, (Math.random() - 0.5) * 0.8, this.bevelOf(cb), size, this.resOf(cb));
    sb.rebuild();
    if (drop) for (let v = 0; v < sb.nV; v++) if (sb.vCube[v] === slot) sb.v[v * 3 + 1] = -3;
    this.cubes.push(cb);
    this.stackOrder.push(slot);
    // (the new one is the one the panels edit now)
    this.sel = this.cubes.length - 1;
    this.style = style;
    this.tune = tune;
    this._syncSel();
    this.onTopologyChanged();
    this.applyStyle();
    if (drop) this.swapper.watchLanding(slot);
    this.ui?.cubesChanged?.();
    return slot;
  }

  // Cube k out of the room (the last one stays).
  removeCube(slot) {
    if (this.cubes.length <= 1) return false;
    const i = this.cubes.findIndex((c) => c.slot === slot);
    if (i < 0) return false;
    if (this.healer.active || this.swapper.active) {
      this.ui?.hint('One sec - still re-cubing', 1400);
      return false;
    }
    this.tool?.up?.();
    this._edgeMorphTick(0, true);
    this.nails.clearAll();
    this.sb.removeCube(slot);
    this.cubes.splice(i, 1);
    // (the last one left is cube 0 again: one cube alone is always that)
    const last = this.cubes.length === 1 ? this.cubes[0] : null;
    if (last && last.slot !== 0) {
      this.sb.moveCube(last.slot, 0);
      for (const w of this.swapper.watch) if (w.slot === last.slot) w.slot = 0;
      last.slot = 0;
    }
    this.sb.rebuild();
    this._resolution();
    this._arena(this.cubes.length);
    this.stackOrder = this.stackOrder.filter((s) => s !== slot);
    if (this.sel >= this.cubes.length || i === this.sel) this.sel = Math.min(i, this.cubes.length - 1);
    else if (i < this.sel) this.sel--;
    this.style = this.cube.style;
    this.tune = this.cube.tune;
    this._syncSel();
    this.onTopologyChanged();
    this.applyStyle();
    this.ui?.cubesChanged?.();
    return true;
  }

  // Where each cube goes in a stack, in stackOrder from the bottom: a tower
  // of up to four, then a 2x2 base with the rest on top (eight: one big cube).
  stackLayout(order = this.stackOrder) {
    const g = 0.008, n = order.length, out = [];
    // (each its own size: a level as tall as its biggest)
    const sz = (slot) => {
      const cb = this.cubes.find((c) => c.slot === slot);
      return cb ? this.sizeOf(cb) : this.sb.p.size;
    };
    let y = 0;
    if (n <= 4) {
      for (const slot of order) {
        out.push({ slot, x: 0, y, z: 0, yaw: 0 });
        y += sz(slot) + g;
      }
      return out;
    }
    for (let l = 0; l * 4 < n; l++) {
      const lv = order.slice(l * 4, l * 4 + 4), big = Math.max(...lv.map(sz));
      lv.forEach((slot, j) => out.push({ slot, x: (j & 1 ? 0.5 : -0.5) * (big + g), y, z: (j & 2 ? 0.5 : -0.5) * (big + g), yaw: 0 }));
      y += big + g;
    }
    return out;
  }

  // The glass room on or off (a see-through box instead of the open floor).
  setGlassRoom(on) {
    this.room.setOn(on);
    this.sb.wakeAll();
    try {
      localStorage.setItem('cube-sim-room', on ? '1' : '0');
    } catch (e) {
      /* private mode */
    }
  }

  // Re-cube just this one: it re-forms where it is, clear of the others,
  // and they stay just as they are (a careful stack too).
  recubeOne(slot) {
    if (this.cubes.length < 2) return this.heal();
    if (this.healer.active || this.swapper?.active || !this.cubes.some((c) => c.slot === slot)) return false;
    return this.heal({ only: slot });
  }

  // Stack them (each re-forms in its place: see Healer._startMulti).
  stack() {
    if (this.cubes.length < 2) return false;
    this._arena();
    return this.heal({ layout: this.stackLayout() });
  }

  // The stack's order (bottom to top), always every cube in the room and
  // only those: whatever came and went (a cube out, the last one left
  // made cube 0 again, a twin born), each once - a cube left out of it
  // was left behind by a stack, and lost when it re-formed.
  get stackOrder() {
    const have = this.cubes.map((c) => c.slot), here = new Set(have);
    const o = [...new Set((this._order || []).filter((s) => here.has(s)))];
    for (const s of have) if (!o.includes(s)) o.push(s);
    this._order = o;
    return o;
  }

  set stackOrder(order) {
    this._order = [...order];
  }

  setStackOrder(order) {
    const have = new Set(this.cubes.map((c) => c.slot));
    if (order.length !== have.size || !order.every((s) => have.has(s))) return;
    this.stackOrder = [...order];
    this.applyStyle(); // (saved with the room)
  }

  // Every cube's resolution, for the cubes there (and extra: the sizes of
  // ones about to join): any that changes, and every cube is built afresh
  // where it is, as it's turned.
  _resolution(extra = []) {
    const sb = this.sb, h = App.cellFor([...this.cubes.map((cb) => this.sizeOf(cb)), ...extra]);
    this.cell = h;
    if (this.cubes.every((cb) => sb.cRes[cb.slot] === this.resOf(cb, h) && Math.abs(sb.cSize[cb.slot] - this.sizeOf(cb)) < 1e-6)) return;
    // (from the vertices: a rebuild leaves the pieces' own centres blank
    // till the next step)
    const at = [];
    for (const cb of this.cubes) {
      let M = 0, x = 0, z = 0, y0 = Infinity, main = null;
      for (const pc of sb.pieces) {
        if (pc.cube !== cb.slot) continue;
        if (!main || pc.mass > main.mass) main = pc;
        for (const i of pc.verts) {
          const m = sb.m[i];
          M += m;
          x += sb.x[i * 3] * m;
          z += sb.x[i * 3 + 2] * m;
          y0 = Math.min(y0, sb.x[i * 3 + 1]);
        }
      }
      at.push({ slot: cb.slot, x: M > 0 ? x / M : 0, z: M > 0 ? z / M : 0, y: Number.isFinite(y0) ? Math.max(0, y0) : 0, yaw: main ? this.healer._yawOf(main) : 0, bevel: this.bevelOf(cb), size: this.sizeOf(cb), res: this.resOf(cb, h) });
    }
    this._edgeMorph = null; // (each built afresh with its own edges)
    sb.nV = 0;
    sb.nT = 0;
    sb.embeds.length = 0;
    sb.grabs.length = 0;
    this.nails.clearAll();
    for (const a of at) sb.addCube(a.slot, a.x, a.y, a.z, a.yaw, a.bevel, a.size, a.res);
    sb.rebuild();
    this._syncSel();
    this.onTopologyChanged();
    this.markHealed();
  }

  // the room's size for n cubes: room enough for them on the floor (the
  // view backs off to see it all - see _updateCamera)
  _arena(n = this.cubes.length) {
    const sb = this.sb, view = this._viewArena || sb.p.arenaRadius;
    this._viewArena = view;
    const mean = this.cubes?.length ? this.cubes.reduce((a, cb) => a + this.sizeOf(cb), 0) / this.cubes.length : sb.p.size;
    sb.p.arenaRadius = n > 1 ? Math.max(view, mean * (0.9 + 0.62 * Math.sqrt(n - 1))) : view;
    // (and high enough over the tallest stack they make: a cube re-formed
    // above the ceiling was crushed flat against it)
    let top = 0;
    for (const L of this.stackLayout()) {
      const cb = this.cubes.find((c) => c.slot === L.slot);
      top = Math.max(top, L.y + (cb ? this.sizeOf(cb) : sb.p.size));
    }
    sb.p.ceiling = Math.max(4.2, top + 1.2);
  }

  // A spot clear of the cubes there: [x, z, the height to set a cube down
  // at] - on the floor (0) out from the middle, or, with no room left on the
  // floor, on top of what's there (a cube set down inside another stayed
  // stuck in it, and the two drew as a mosaic)
  // (exclude: a cube not to keep clear of - it's the one going there; near:
  // [x, z] to try first and work out from; gap: how far apart their middles
  // must be, in cube sides - two turned cubes' corners reach ~1.41 apart)
  // (size: the one going there's - each cube its own)
  _clearSpot({ exclude = -1, near = null, gap = 1.25, size = this.sb.p.size } = {}) {
    const sb = this.sb, R = Math.max(0, sb.p.arenaRadius - size * 0.75);
    // (each cube's box from its vertices: a piece's own centre and box are
    // only filled in by the next step, and a rebuild has just made them new)
    const boxes = new Map();
    for (let i = 0; i < sb.nV; i++) {
      if (!sb.alive[i] || sb.vCube[i] === exclude) continue;
      let b = boxes.get(sb.vCube[i]);
      if (!b) boxes.set(sb.vCube[i], (b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]));
      for (let k = 0; k < 3; k++) {
        const q = sb.x[i * 3 + k];
        if (q < b[k]) b[k] = q;
        if (q > b[k + 3]) b[k + 3] = q;
      }
    }
    // (each with how far it reaches: its own size, near enough)
    const centres = [...boxes.values()].map((b) => [(b[0] + b[3]) / 2, (b[2] + b[5]) / 2, Math.max(b[3] - b[0], b[5] - b[2]) / 1.2]);
    let best = [0, 0], bestD = -1;
    const [nx, nz] = near || [0, 0];
    for (let k = 0; k < 96; k++) {
      const r = k === 0 ? 0 : near ? size * 0.12 * Math.ceil(k / 6) : Math.min(R, size * (0.6 + 0.25 * Math.floor(k / 8)) + Math.random() * 0.3);
      const a = Math.random() * Math.PI * 2;
      let x = nx + Math.cos(a) * r, z = nz + Math.sin(a) * r;
      const rr = Math.hypot(x, z);
      if (rr > R) {
        x *= R / rr;
        z *= R / rr;
      }
      // (how clear: the gap to the nearest, over the gap it needs)
      let d = Infinity;
      for (const [cx, cz, s2] of centres) d = Math.min(d, Math.hypot(x - cx, z - cz) / (((size + s2) / 2) * gap));
      if (d > 1) return [x, z, 0];
      if (d > bestD) {
        bestD = d;
        best = [x, z];
      }
    }
    // (no room on the floor: over the spot with the most, above whatever's under it)
    const [x, z] = best, h = size * 0.55;
    let top = 0;
    for (const b of boxes.values()) if (b[0] < x + h && b[3] > x - h && b[2] < z + h && b[5] > z - h) top = Math.max(top, b[4]);
    return [x, z, top + 0.04];
  }

  // The cubes saved with the room last time (the first one is built by now).
  _restoreScene() {
    let sc = null;
    try {
      sc = JSON.parse(localStorage.getItem('cube-sim-scene') || 'null');
    } catch (e) {
      sc = null;
    }
    const okLin = (l) => (l && typeof l.id === 'string' ? { id: l.id, parent: typeof l.parent === 'string' ? l.parent : null, gen: l.gen | 0 } : null);
    // (one cube: just its family)
    if (sc && Array.isArray(sc.cubes) && sc.cubes.length === 1 && this.cubes[0]) this.cubes[0].lin = okLin(sc.cubes[0]?.lin);
    if (!sc || !Array.isArray(sc.cubes) || sc.cubes.length < 2) return;
    const sb = this.sb, keepSel = Math.min(Math.max(0, sc.sel | 0), sc.cubes.length - 1);
    // the selected one is the cube already built (slot 0), the rest around it
    this.cubes = [{ slot: 0, style: this.style, tune: this.tune, name: String(sc.cubes[keepSel]?.name || ''), lin: okLin(sc.cubes[keepSel]?.lin) }];
    // (old slot -> new, for the stack's order)
    const was = new Map([[sc.cubes[keepSel]?.slot, 0]]);
    // (the rest first: their sizes set the cells)
    const more = [];
    for (const [j, c] of sc.cubes.entries()) {
      if (j === keepSel || 1 + more.length >= MAX_CUBES || !c || !c.style || !TEXTURES[c.style.texture]) continue;
      const style = { ...DEFAULT_STYLE, ...c.style, layers: copyLayers({ ...DEFAULT_STYLE.layers, ...(c.style.layers || {}) }), eyes: copyEyes(c.style.eyes), surface: SURFACE[c.style.surface] ? c.style.surface : 'none' };
      if (!EDGES[style.edges]) style.edges = DEFAULT_STYLE.edges;
      const tune = {};
      for (const k of Object.keys(this.tune)) if (!PER_CUBE(k)) tune[k] = this.tune[k];
      for (const k of Object.keys(c.tune || {})) if (PER_CUBE(k) && Number.isFinite(c.tune[k])) tune[k] = c.tune[k];
      more.push({ style, tune, name: String(c.name || ''), was: c.slot, lin: okLin(c.lin) });
    }
    this._resolution(more.map((m) => this.sizeOf(m)));
    this._arena(1 + more.length);
    for (const m of more) {
      const slot = this.cubes.length, cb = { slot, style: m.style, tune: m.tune, name: m.name, lin: m.lin }, size = this.sizeOf(cb);
      const [x, z, top] = this._clearSpot({ size });
      sb.addCube(slot, x, top, z, (Math.random() - 0.5) * 0.8, this.bevelOf(cb), size, this.resOf(cb));
      sb.rebuild();
      this.cubes.push(cb);
      was.set(m.was, slot);
    }
    this._syncSel();
    const order = (Array.isArray(sc.order) ? sc.order : []).map((s) => was.get(s)).filter((s) => s !== undefined);
    this.stackOrder = [...new Set([...order, ...this.cubes.map((cb) => cb.slot)])];
    this.ui?.cubesChanged?.();
  }

  // ------------------------------------------------------------ whole cubes
  // A saved or shared cube (a CubeR code, see cubecode.js): its flavour,
  // material, glitter, every tuned slider, tearing and the look, onto the
  // jelly as it is. Your sound levels stay yours. (Size and edges: the callers.)
  _wearStyle(c) {
    const s = this.style;
    s.flavor = c.flavor;
    s.layers = copyLayers(c.layers);
    s.texture = c.texture;
    s.glitter = c.glitter;
    if (Number.isFinite(c.rubik)) s.rubik = c.rubik;
    // (a Rubik's as it's been turned - or as its scramble left it)
    if (c.rubikState) s.rubikState = c.rubikState;
    else delete s.rubikState;
    s.trim = TRIM[c.trim] ? c.trim : 'none';
    // (its googly eyes come with it - or none)
    s.eyes = copyEyes(c.eyes);
    s.surface = SURFACE[c.surface] ? c.surface : 'none';
    const tune = { ...c.tune };
    for (const k of ['volume', 'impacts', 'wobble']) if (this.tune[k] !== undefined) tune[k] = this.tune[k];
    if (c.tear === false) tune.tear = false;
    // (its world - gravity, size, the Cubicle - is everyone's)
    for (const cb of this.cubes) {
      if (cb === this.cube) continue;
      for (const k of Object.keys(cb.tune)) if (!PER_CUBE(k) && !['volume', 'impacts', 'wobble'].includes(k)) delete cb.tune[k];
      for (const k of Object.keys(tune)) if (!PER_CUBE(k)) cb.tune[k] = tune[k];
    }
    this.tune = tune;
    this.cube.tune = tune;
    // (its name comes with it - a saved one's, the day's, a link's)
    this.cube.name = c.name || '';
    this.ui?.stack?.render();
    if (c.theme && c.theme !== this.theme) {
      this.setTheme(c.theme);
      this.ui?.setTheme(c.theme);
    }
    this.ui?.syncSwitches?.();
  }

  // Put a cube on right here (Undo uses this): a battered jelly re-forms as it.
  loadCube(c) {
    const s = this.style;
    this.swapper.stop();
    this._wearStyle(c);
    const size = this.settings.size;
    if (Math.abs(size - this.sb.cSize[this.cube.slot]) > 1e-6) {
      // (re-formed at the new size, with the new edges too)
      s.edges = c.edges;
      this._edgeMorph = null;
      this.setCubeSize(size);
      if (c.tune.size === undefined) delete this.tune.size;
    } else if (c.edges !== s.edges) this.setEdges(c.edges);
    else this.applyStyle();
    if (this.damaged && !this.healer.active) this.heal();
    else if (!this.healer.active) this.sb.impulse(0, 0.6, 0, 0, -1, 0, 3, 1.2); // (a jiggle: here it is)
  }

  // Put a cube on like picking a fighter: the one on show is pulled up out of
  // sight and the new one drops in (see Swapper). onLand(c) once it's down.
  swapCube(c, onLand = null) {
    if (this.reducedMotion || !this.intro.done) {
      this.loadCube(c);
      onLand?.(c);
      return;
    }
    this.swapper.start(c, onLand);
  }

  // A cube's portrait for the Cubby, the picture it's shared as (cube: as
  // decodeCube gives it - by default the selected one, as it would be kept):
  // a JPEG data URL, px square. See portrait.js.
  portrait(c = null, px = 288, framing = {}) {
    return this.portraits.take([c || captureCube(this)], px, framing)[0];
  }

  // ------------------------------------------------------------ looks
  _loadPlace(opts) {
    if (PLACE_BY_ID[opts.place]) return opts.place;
    try {
      const p = localStorage.getItem('cube-sim-place');
      if (PLACE_BY_ID[p]) return p;
    } catch (e) {}
    return 'studio';
  }

  // Where the cube is (a place: its sky, its floor, its light - in this look).
  // The picture dips, the place swaps in while it's dark and it comes back
  // up; and somewhere with a sky the camera tips down a little to show it.
  setPlace(id, animate = true) {
    if (!PLACE_BY_ID[id] || id === this.place) return;
    this.place = id;
    this.flour?.sweep(); // (a new place: a clean floor)
    try {
      localStorage.setItem('cube-sim-place', id);
    } catch (e) {}
    // (mid-switch of the looks, before its swap: that brings the place in)
    const TA = this._themeAnim;
    if (!TA || TA.swapped) {
      if (animate && !TA && !this.reducedMotion) this._placeAnim = { t: 0, swapped: false };
      else this._applyTheme(this.theme, this.theme === 'dark' ? 1 : 0, true);
    }
    if (animate && PLACE_BY_ID[id][this.theme]?.sky && this.orbitGoal.phi > 0.27) this.orbitGoal.phi = 0.26;
    this.ui?.placeChanged?.(id);
  }

  _placeTick(dt) {
    const A = this._placeAnim;
    if (!A) return;
    A.t += dt;
    const C = this.post.compositeMat.uniforms, OUT = 0.14, IN = 0.32;
    if (A.t < OUT) {
      C.uDim.value = 1 - 0.85 * (A.t / OUT);
      return;
    }
    if (!A.swapped) {
      A.swapped = true;
      this._applyTheme(this.theme, this.theme === 'dark' ? 1 : 0, true);
    }
    const k = Math.min(1, (A.t - OUT) / IN);
    C.uDim.value = 0.15 + 0.85 * k * (2 - k);
    if (k >= 1) this._placeAnim = null;
  }

  // the look for this theme somewhere (here, unless said): the studio's,
  // with the place's on top
  _look(name, place = this.place) {
    const P = PLACE_BY_ID[place] || PLACES[0], V = P[name] || {};
    // (its sky, floor pattern and light boxes are its own; the rest are the look's numbers)
    const { sky, floor, boxes, ink, ...rest } = V;
    return { name, T: { ...THEMES[name], ...rest }, V, P };
  }

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
    if (this._placeAnim) {
      this._placeAnim = null;
      this.post.compositeMat.uniforms.uDim.value = 1;
    }
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
    const L = this._look(name), { T, V } = L;
    this._applyLook(L, glow);
    const html = document.documentElement;
    if (ease) {
      html.classList.add('theming'); // (the chrome eases over too)
      clearTimeout(this._themingT);
      this._themingT = setTimeout(() => html.classList.remove('theming'), 700);
    }
    html.classList.toggle('dark', name === 'dark');
    html.dataset.place = this.place;
    html.classList.toggle('sky-dark', V.ink === 'light'); // (the wordmark, over a black sky)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', T.css);
    this.ui?.setTheme?.(name);
  }

  // A look into the renderer: the place's sky (seen, and - env - captured
  // into what everything reflects), its horizon the backdrop the floor
  // fades into, its floor's pattern, its light, the post's numbers.
  _applyLook({ name, T, V, P }, glow = 1, env = true) {
    if (V.sky) {
      if (env) this.env.setLook({ key: P.id + ':' + name, sky: V.sky, boxes: V.boxes || null });
      setSky(this.sky.userData.u, V.sky, this.lightDir);
      this.sky.userData.u.uGnd.value.copy(this.sky.userData.u.uHor.value); // (no seam where the floor ends)
      this.sky.visible = true;
      this.bg.setRGB(...V.sky.hor);
    } else {
      if (env) this.env.setLook(name);
      this.sky.visible = false;
      this.bg.setRGB(...T.bg);
    }
    const F = V.floor, fx = this.jelly.fxUniforms;
    fx.pat.value = F ? F.pat : 0;
    if (F) {
      fx.patA.value.set(...F.A);
      fx.patB.value.set(...F.B);
      fx.patScale.value = F.scale || 1;
    }
    fx.patGlow.value = F?.glow || 0;
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
    // (the studio's overhead softbox, as metal mirrors it - a place has its sky)
    this.jelly.frontMat.uniforms.uMetalCeil.value.setRGB(...(V.sky ? [0, 0, 0] : T.metalCeil || [0, 0, 0]));
    this.jelly.fxUniforms.reflAmount.value = T.refl;
    this.jelly.fxUniforms.reflLod.value = T.reflLod;
    const C = this.post.compositeMat.uniforms;
    C.uBloom.value = T.bloom;
    C.uVignette.value = T.vignette;
    this.post.preMat.uniforms.uThreshold.value = T.threshold;
    this.post.preMat.uniforms.uKnee.value = T.knee;
    this._setGlow(T.glow * glow);
  }

  _setGlow(e) {
    this.jelly.setEmit(e);
    this.jelly.fxUniforms.glowFloor.value = e * THEMES.dark.glowFloor;
    this.droplets.setGlow(e);
    this.fluid.setGlow(e);
    this.strands.setGlow(e);
    this.eyes?.setGlow(e);
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
      // (against the glass room's glass: a knock on the pane too)
      if (e.kind === 'wall' && this.room.on) this.audio.glassKnock(Math.min(1, e.dv / 6) * Math.min(1, size), this._pan(e.x, e.y, e.z));
      played++;
    }
  }

  // The jelly's own voice: the three pieces jiggling most (by how fast,
  // and how big they are) each blub once a swing - at the piece's own
  // wobble, its natural frequency set by its size and firmness - as loud as
  // it jiggles, so a smack sets off a run of blubs that dies away as the
  // piece settles (see Audio.wobble). Frozen: silent.
  _wobbleSounds() {
    const a = this.audio;
    if (!a.ctx) return;
    const sb = this.sb, st = this.settings;
    const list = [];
    if (!this.healer.active && a.wobbleLevel > 0.01) {
      for (const pc of sb.pieces) if (!pc.asleep && pc.vib > 0.015) list.push(pc);
      list.sort((p, q) => q.vib * Math.cbrt(q.volume) - p.vib * Math.cbrt(p.volume));
    }
    const out = [];
    for (const pc of list.slice(0, 3)) {
      const mat = this._impactMaterial(pc);
      if (mat.ice) continue;
      const L = Math.cbrt(Math.max(pc.volume, 1e-5));
      const fn = (6.7 * Math.sqrt(st.mu / 170 / sb.p.density)) / L;
      // (a poke jiggles it at ~0.07 m/s, a smack at ~0.3)
      const amp = 0.45 * Math.min(1, (pc.vib - 0.015) / 0.25) ** 1.1 * Math.min(1.4, 0.5 + L);
      out.push({ id: pc.id, f: fn, amp, size: L, firm: mat.firm, wet: mat.wet, pan: this._pan(pc.com[0], pc.com[1], pc.com[2]) });
    }
    a.wobble(out);
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
    this.sky.userData.u.uTime.value = this.clock.t;
    // fire light: torch sets fireGoal each frame, bombs spike it
    this.fireLevel += (this.fireGoal - this.fireLevel) * 0.35;
    this.fireGoal *= 0.6;
    const fl = this.fireLevel * (0.85 + Math.random() * 0.3);
    this.fireLight.intensity = fl * 3.2;
    this.jelly.frontMat.uniforms.uPLPos.value.copy(this.fireLight.position);
    this.jelly.frontMat.uniforms.uPLColor.value.setRGB(1.0 * fl, 0.55 * fl, 0.2 * fl);

    const skip = this.skip;
    if (!skip.floorFx) this.jelly.renderFloorFx(this.sb);
    if (!this.opts.nojelly && !skip.refl) this.jelly.renderReflection(this.camera, this.rtRefl);

    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.rtScene);
    r.setClearColor(this.bg, 1);
    r.clear(true, true, false);
    if (!skip.room) r.render(this.scene, this.camera);

    const copy = () => this.post.copy(this.rtScene.texture, this.rtTrans);
    copy();
    // (no one touching anything, nothing moving: see JellyView.setFeatures)
    this.jelly.quiet = !this._held?.size && performance.now() - this._inputAt > 500 && this.sb.pieces.every((p) => p.asleep);
    if (!this.opts.nojelly && !skip.jelly) this.jelly.renderPieces(this.camera, this.sb, this.rtScene, this.rtTrans, copy);
    // (the goo sees the jelly through itself: the room with the jelly in it -
    // and so do the bubbles, bending it)
    const bub = this.bubbles.mesh.count > 0 && this.fxScene && !skip.fx, BU = this.bubbles.mesh.material.uniforms;
    BU.uBgOn.value = bub ? 1 : 0;
    if (this.strands.mesh.visible || bub) {
      copy();
      this.strands.mat.uniforms.tBg.value = this.rtTrans.texture;
      BU.tBg.value = this.rtTrans.texture;
      BU.uRes.value.set(this.rtScene.width, this.rtScene.height);
    }

    this.glitter.update(this.clock.t);
    if (this.fxScene && !skip.fx) {
      const auto = r.autoClear;
      r.autoClear = false;
      r.setRenderTarget(this.rtScene);
      r.render(this.fxScene, this.camera);
      // (and last, the googly eyes in front of the jelly: over its glitter and
      // bubbles - drawn as though out in front of its skin, their glints
      // showed through an eye that's on it - in the room's light)
      const L = this.camera.layers.mask;
      this.camera.layers.set(LATE_LAYER);
      r.render(this.scene, this.camera);
      this.camera.layers.mask = L;
      r.autoClear = auto;
    }

    this.flash *= 0.86;
    this.post.compositeMat.uniforms.uFlash.value = this.flash;
    const bloom = skip.bloom ? this.post.rts[0].texture : this.post.bloom(this.rtScene.texture, this.size.pw, this.size.ph);
    if (this.rtAA && !skip.aa) {
      this.post.fxaa(this.rtScene.texture, this.rtAA);
      this.post.composite(this.rtAA.texture, bloom, this.clock.t);
    } else this.post.composite(this.rtScene.texture, bloom, this.clock.t);
    if (this.recording && this.markTex) {
      const cv = this.renderer.domElement;
      this.post.drawMark(this.markTex, cv.width, cv.height);
    }
  }
}
