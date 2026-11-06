import * as THREE from 'three';

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

function buildScene(lightDir, look) {
  const scene = new THREE.Scene();
  const [t, h, f] = [look.top, look.hor, look.flo].map((c) => `vec3(${c.map((x) => x.toFixed(4)).join(', ')})`);
  scene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(30, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            float y = vDir.y;
            vec3 c = y > 0.0 ? mix(${h}, ${t}, pow(y, 0.55)) : mix(${h}, ${f}, pow(-y, 0.35));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    ),
  );
  const k = lightDir ? lightDir.clone().multiplyScalar(14) : { x: -7, y: 11, z: 7 };
  for (const [w, hh, intensity, pos, at, color] of look.boxes(k)) {
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
  const capture = (name, target) => {
    const scene = buildScene(lightDir, LOOKS[name]);
    const cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
    new THREE.CubeCamera(0.1, 100, cube).update(renderer, scene);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const out = pmrem.fromCubemap(cube.texture, target);
    pmrem.dispose();
    cube.dispose();
    disposeScene(scene);
    return out;
  };
  const target = capture(look, null);
  const tex = target.texture;
  const maxLod = tex.mipmaps && tex.mipmaps.length ? tex.mipmaps.length - 1 : Math.log2(256) - 3;
  return {
    texture: tex,
    maxLod,
    target,
    look,
    setLook(name) {
      if (name === this.look) return;
      this.look = name;
      capture(name, target);
    },
  };
}
