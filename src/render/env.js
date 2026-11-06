import * as THREE from 'three';

// Procedural photo-studio environment: a soft gradient sweep with a few
// rectangular softboxes. Captured into a PMREM cube for reflections.
export function createStudioEnvironment(renderer) {
  const scene = new THREE.Scene();

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(30, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
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
          vec3 top = vec3(0.30, 0.31, 0.33);
          vec3 hor = vec3(0.86, 0.85, 0.83);
          vec3 flo = vec3(0.62, 0.60, 0.58);
          vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.55)) : mix(hor, flo, pow(-y, 0.35));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  const box = (w, h, intensity, pos, look, color = 0xffffff) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(...look);
    scene.add(m);
  };
  // key softbox (matches the key light), overhead panel, strips, back panel
  box(9, 6, 9, [-7, 11, 7], [0, 0, 0], 0xfff6ec);
  box(14, 9, 1.6, [0, 16, 0], [0, 0, 0], 0xf4f7ff);
  box(2.2, 12, 5.5, [12, 4, 2], [0, 2, 0], 0xeef3ff);
  box(8, 2.6, 2.6, [-3, 5, -12], [0, 1, 0], 0xffffff);
  box(1.8, 9, 4.5, [-10, 3.5, 5], [0, 2, 0], 0xfff0e6);
  box(12, 3, 1.1, [0, 1.2, 12], [0, 1, 0], 0xffffff);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.0, 0.1, 100, { size: 256 });
  pmrem.dispose();
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  const tex = target.texture;
  const maxLod = tex.mipmaps && tex.mipmaps.length ? tex.mipmaps.length - 1 : Math.log2(256) - 3;
  return { texture: tex, maxLod, target };
}
