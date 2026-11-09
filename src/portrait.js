import * as THREE from 'three';
import { SoftBody } from './sim/softbody.js';
import { createStudioEnvironment } from './render/env.js';
import { CUBE_TEX_W } from './render/jellyView.js';
import { GRAD_N } from './render/jellyMaterials.js';
import { DEFAULT_STYLE, TEXTURES, EDGES, resolveFlavor, copyLayers } from './styles.js';
import { resolveSettings } from './settings.js';
import { copyEyes } from './eyes.js';
import { SURFACE } from './surfaces.js';

// A cube's portrait - its card in the Cubby, the picture it's shared as: a
// fresh one of it, whole and at rest, alone in the studio (lit up, if it was
// kept in glow mode), from a three-quarter view - not a crop of the screen
// the moment it was kept (squashed mid-wobble, half eaten, other cubes and
// a tool in the way, wherever it was).
//
// Taken with the app's own renderer, so it looks just as it does in the
// room: for a frame the jelly is this cube, the room the studio and the
// camera the portrait's; then everything's put back and the room drawn
// again, before the screen shows any of it. (Not the bubbles: they're
// anchored in the room's jelly. Its googly eyes, though: held on afresh.)

const THETA = 0.62, PHI = 0.4; // (the view: round from the front, up from the floor)
const SPAN = 24; // degrees the picture takes in, side to side
const FILL = 0.66; // (the cube's share of that)
const LEAN = 0.12; // (the view's middle off the cube toward its shadow, a share of its size: the two together, centred)

export class Portraits {
  constructor(app) {
    this.app = app;
    this.camera = new THREE.PerspectiveCamera(SPAN, 1, 0.05, 120);
    this.envs = {}; // the studio's environments, light and dark (captured when first wanted)
  }

  // the studio's environment in this look: the room's own if it's in the
  // studio in it, else one of the portraits' own
  _env(theme) {
    const app = this.app;
    if (app.env.look === 'studio:' + theme) return app.env.texture;
    if (!this.envs[theme]) this.envs[theme] = createStudioEnvironment(app.renderer, app.lightDir, theme);
    return this.envs[theme].texture;
  }

  // Portraits of cubes (as decodeCube gives them): an image URL each (null
  // where one couldn't be taken), px square; fill, lean: the framing (a
  // little card wants the cube bigger in it than a big picture does).
  take(list, px = 288, { fill = FILL, lean = LEAN } = {}) {
    const app = this.app, J = app.jelly, F = J.frontMat.uniforms, fx = J.fxUniforms, C = app.post.compositeMat.uniforms;
    const G = app.glitter;
    // what's put back after
    const S = {
      sb: app.sb, cubes: app.cubes, order: app._order, camera: app.camera, sel: app.sel,
      multi: J.multiCube, needRest: J.needRest, tintLocal: fx.tintLocal.value, row: J.cubeData.slice(0, CUBE_TEX_W * 4), surf: J.surfaceOfSlot(0),
      grad: J.gradData.slice(0, GRAD_N * 2 * 4), free: J.freeData.slice(0, J.freeSlab),
      emit: F.uEmit.value, pulse: F.uPulseAmp.value.slice(), cavN: F.uCavN.value, fire: [app.fireLevel, app.fireGoal], flash: app.flash,
      dim: C.uDim.value, wash: C.uWash.value, selA: fx.selCol.value.w,
      env: F.envMap.value, floorEnv: app.floor.material.envMap, glitterEnv: G?.uniforms.envMap.value,
      glitter: G && { mode: G.mode, count: G.count, size: G.size, sparkle: G.sparkle },
      vis: app.scene.children.map((o) => o.visible), fxVis: app.fxScene.children.map((o) => o.visible),
    };
    const urls = [];
    // (the shaders it takes: whatever's compiled that will do - none started
    // for a set only a portrait wants, see JellyView.setFeatures)
    J.portraits = true;
    try {
      // the room emptied: the floor and the lights (and, of the effects, the glitter)
      for (const o of app.scene.children) if (o !== app.floor && !o.isLight && o !== app.keyLight?.target && !o.userData.inPortrait) o.visible = false;
      for (const o of app.fxScene.children) if (o !== G?.mesh && o !== G?.meshCube && !o.userData.inPortrait) o.visible = false;
      // nothing else going on: no rings of light, no hollows (the room's
      // cut-open bubbles), no fire, no flash, no dimming between looks, no
      // ring round a selected cube
      F.uPulseAmp.value.fill(0);
      F.uCavN.value = 0;
      app.fireLevel = app.fireGoal = 0;
      app.flash = 0;
      C.uDim.value = 1;
      C.uWash.value = 0;
      fx.selCol.value.w = 0;
      J.multiCube = false;
      for (const c of list) {
        try {
          urls.push(c ? this._shoot(c, px, fill, lean) : null);
        } catch (e) {
          console.warn('portrait', e);
          urls.push(null);
        }
      }
    } finally {
      // all put back: the jelly, its look, the room's look, the effects
      J.portraits = false;
      app.sb = S.sb;
      app.cubes = S.cubes;
      app._order = S.order;
      app.sel = S.sel;
      app.camera = S.camera;
      J.topoVersion = -1;
      J.cubeData.set(S.row, 0);
      J.cubeTex.needsUpdate = true;
      // (and its surface map baked back onto it)
      J.restoreSurface(0, S.surf);
      J.gradData.set(S.grad, 0);
      J.gradTex.needsUpdate = true;
      J.freeData.set(S.free, 0);
      J.freeTex.needsUpdate = true;
      J.multiCube = S.multi;
      J.needRest = S.needRest;
      J.setStyle(resolveFlavor(app.style), { ...TEXTURES[app.style.texture], ...app.settings }, S.sb.p.size);
      fx.tintLocal.value = S.tintLocal;
      app._applyLook(app._look(app.theme), 1, false);
      app._setGlow(S.emit);
      F.envMap.value = S.env;
      app.floor.material.envMap = S.floorEnv;
      if (G) {
        G.uniforms.envMap.value = S.glitterEnv;
        G.topo = -1;
        G.configure(S.glitter);
      }
      for (let k = 0; k < S.pulse.length; k++) F.uPulseAmp.value[k] = S.pulse[k];
      F.uCavN.value = S.cavN;
      [app.fireLevel, app.fireGoal] = S.fire;
      app.flash = S.flash;
      C.uDim.value = S.dim;
      C.uWash.value = S.wash;
      fx.selCol.value.w = S.selA;
      app.scene.children.forEach((o, k) => (o.visible = S.vis[k] ?? o.visible));
      app.fxScene.children.forEach((o, k) => (o.visible = S.fxVis[k] ?? o.visible));
      // (and the room drawn again, so the screen never sees the studio - its
      // eyes back on its cubes)
      app.eyes?.update(0);
      try {
        app.render();
      } catch (e) {
        console.warn('portrait', e);
      }
    }
    return urls;
  }

  // one cube's: made fresh as addCube makes one from a code, its look into
  // the jelly's first row, the studio's look about it, the camera on it
  _shoot(c, px, fill, lean) {
    const app = this.app, J = app.jelly, F = J.frontMat.uniforms, G = app.glitter;
    const theme = c.theme === 'dark' ? 'dark' : 'light';
    const style = {
      flavor: c.flavor,
      layers: copyLayers(c.layers),
      texture: TEXTURES[c.texture] ? c.texture : DEFAULT_STYLE.texture,
      edges: EDGES[c.edges] ? c.edges : DEFAULT_STYLE.edges,
      glitter: c.glitter || 'off',
      rubik: Number.isFinite(c.rubik) ? c.rubik : 1,
      ...(c.rubikState ? { rubikState: c.rubikState } : {}),
      trim: c.trim || 'none',
      eyes: copyEyes(c.eyes),
      surface: SURFACE[c.surface] ? c.surface : 'none',
    };
    const tex = TEXTURES[style.texture], st = resolveSettings(c.tune || {}, tex);
    const size = st.size, A = app.constructor;
    const sb = new SoftBody({ size, bevel: EDGES[style.edges].bevel * size, res: A.resAt(size, A.cellFor([size])) });
    sb.loadCube(0, 0, 0, 0);
    const flavor = resolveFlavor(style), m = { ...tex, ...st, surface: style.surface, bevelRatio: EDGES[style.edges].bevel };
    J.setCubeLook(0, flavor, m, size);
    // (its surface map baked now, not when a slider's been let go)
    J.restoreSurface(0, J.surfaceOfSlot(0));
    J.setStyle(flavor, m, size);
    J.needRest = !!flavor.layers && flavor.shape !== 'up';
    J.fxUniforms.tintLocal.value = flavor.layers ? 1 : 0;
    app.sb = sb;
    app.cubes = [{ slot: 0, style, tune: c.tune || {}, name: c.name || '' }];
    app.sel = 0;
    J.topoVersion = -1;
    if (G) {
      G.topo = -1;
      G.configure({ mode: style.glitter, count: st.glitterAmount, size: st.glitterSize, sparkle: st.glitterSparkle });
    }
    // the studio, in the look it was kept in (its own reflections too)
    app._applyLook(app._look(theme, 'studio'), 1, false);
    const env = this._env(theme);
    F.envMap.value = env;
    app.floor.material.envMap = env;
    if (G) G.uniforms.envMap.value = env;
    // the camera: the cube a set share of the middle square of the screen
    const { pw, ph } = app.size, cam = this.camera, t = Math.tan((SPAN * Math.PI) / 360);
    cam.aspect = pw / ph;
    cam.fov = (Math.atan((t * ph) / Math.min(pw, ph)) * 360) / Math.PI;
    const d = (size * 0.9) / (fill * t), L = app.lightDir, h = Math.hypot(L.x, L.z) || 1;
    const tx = (-L.x / h) * lean * size, ty = size * 0.42, tz = (-L.z / h) * lean * size;
    cam.position.set(tx + d * Math.cos(PHI) * Math.sin(THETA), ty + d * Math.sin(PHI), tz + d * Math.cos(PHI) * Math.cos(THETA));
    cam.near = d * 0.05;
    cam.far = d + 80;
    cam.lookAt(tx, ty, tz);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    app.camera = cam;
    // (its googly eyes on it, still)
    app.eyes?.pose(sb, app.cubes);
    app.render();
    // the middle square of what's drawn, as a picture
    const cv = app.renderer.domElement, s = Math.min(cv.width, cv.height);
    const out = document.createElement('canvas');
    out.width = out.height = px;
    const g = out.getContext('2d');
    g.drawImage(cv, (cv.width - s) / 2, (cv.height - s) / 2, s, s, 0, 0, px, px);
    return out.toDataURL('image/jpeg', 0.86);
  }
}
