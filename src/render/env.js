import * as THREE from 'three';
import { makeSkyMaterial, skyUniforms, setSky } from './sky.js';

// Glow mode's studio is dark: a black sweep, a dim key, and coloured strip
// lights that draw neon lines along the jelly's edges and the glossy floor.
const LOOKS = {
  light: {
    top: [0.3, 0.31, 0.33],
    hor: [0.86, 0.85, 0.83],
    flo: [0.62, 0.6, 0.58],
    // key softbox (matches the key light), overhead panel, strips, back panel
    boxes: (k) => [
      [9, 6, 9, [k.x, k.y, k.z], [0, 0, 0], 0xfff6ec],
      [14, 9, 1.6, [0, 16, 0], [0, 0, 0], 0xf4f7ff],
      [2.2, 12, 5.5, [12, 4, 2], [0, 2, 0], 0xeef3ff],
      [8, 2.6, 2.6, [-3, 5, -12], [0, 1, 0], 0xffffff],
      [1.8, 9, 4.5, [-10, 3.5, 5], [0, 2, 0], 0xfff0e6],
      [12, 3, 1.1, [0, 1.2, 12], [0, 1, 0], 0xffffff],
    ],
  },
  dark: {
    top: [0.004, 0.004, 0.007],
    hor: [0.018, 0.017, 0.026],
    flo: [0.003, 0.003, 0.004],
    boxes: (k) => [
      [5, 3.4, 3.2, [k.x, k.y, k.z], [0, 0, 0], 0xe8eeff],
      [14, 9, 0.1, [0, 16, 0], [0, 0, 0], 0xf4f7ff],
      [1, 12, 8, [12, 4, 2], [0, 2, 0], 0x4fb4ff],
      [8, 1.2, 1.6, [-3, 5, -12], [0, 1, 0], 0x9d7bff],
      [0.9, 9, 7, [-10, 3.5, 5], [0, 2, 0], 0xff4fc3],
      [12, 1.4, 0.35, [0, 1.2, 12], [0, 1, 0], 0xbfd4ff],
    ],
  },
};

// (neon strips: a diner after dark)
const NEON = (k) => [
  [4, 3, 2.6, [k.x, k.y, k.z], [0, 0, 0], 0xffd0f0],
  [1, 12, 9, [12, 4, 2], [0, 2, 0], 0x3ff0ff],
  [0.9, 9, 8, [-10, 3.5, 5], [0, 2, 0], 0xff3fb4],
  [10, 0.8, 5, [-3, 5, -12], [0, 1, 0], 0xff5fd0],
  [12, 1.2, 0.4, [0, 1.2, 12], [0, 1, 0], 0x8fe8ff],
];
const BOXES = { studio: LOOKS.light.boxes, 'studio-dark': LOOKS.dark.boxes, neon: NEON };

// the studio's own look, as a place's
export function studioLook(name) {
  const L = LOOKS[name] || LOOKS.light;
  return { sky: { zen: L.top, hor: L.hor, gnd: L.flo }, boxes: L.boxes };
}

function buildScene(lightDir, look) {
  const scene = new THREE.Scene();
  const u = skyUniforms();
  setSky(u, look.sky, lightDir || new THREE.Vector3(-0.45, 0.8, 0.4));
  const mat = makeSkyMaterial(u);
  mat.depthTest = true;
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(30, 48, 24), mat));
  const k = lightDir ? lightDir.clone().multiplyScalar(14) : { x: -7, y: 11, z: 7 };
  const boxes = typeof look.boxes === 'function' ? look.boxes : BOXES[look.boxes];
  for (const [w, hh, intensity, pos, at, color] of boxes ? boxes(k) : []) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, hh),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(...at);
    scene.add(m);
  }
  return scene;
}

function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

// Procedural photo-studio environment: a soft gradient sweep with a few
// rectangular softboxes, captured into a PMREM cube for reflections.
// setLook() recaptures into the same texture, so everything that reflects
// it follows without being told.
export function createStudioEnvironment(renderer, lightDir, look = 'light') {
  // (look: 'light' or 'dark' - the studio's - or { key, sky, boxes }: a place's)
  const resolve = (L) => (typeof L === 'string' ? { key: 'studio:' + L, ...studioLook(L) } : L);
  const capture = (L, target) => {
    const scene = buildScene(lightDir, L);
    const cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
    new THREE.CubeCamera(0.1, 100, cube).update(renderer, scene);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const out = pmrem.fromCubemap(cube.texture, target);
    pmrem.dispose();
    cube.dispose();
    disposeScene(scene);
    return out;
  };
  const first = resolve(look);
  const target = capture(first, null);
  const tex = target.texture;
  const maxLod = tex.mipmaps && tex.mipmaps.length ? tex.mipmaps.length - 1 : Math.log2(256) - 3;
  return {
    texture: tex,
    maxLod,
    target,
    look: first.key,
    setLook(L) {
      const R = resolve(L);
      if (R.key === this.look) return;
      this.look = R.key;
      capture(R, target);
    },
  };
}
