import * as THREE from 'three';

// Procedural tool models. All are modelled along +Y unless noted.
export function makeMaterials(env) {
  const std = (o) => new THREE.MeshStandardMaterial({ envMap: env.texture, ...o });
  return {
    steel: std({ color: 0xcfd3d9, metalness: 1, roughness: 0.22, envMapIntensity: 1.2 }),
    darkSteel: std({ color: 0x6b6f76, metalness: 1, roughness: 0.35 }),
    brass: std({ color: 0xd9a54a, metalness: 1, roughness: 0.28 }),
    rubber: std({ color: 0x1e1f22, metalness: 0, roughness: 0.62, envMapIntensity: 0.6 }),
    wood: std({ color: 0xb98552, metalness: 0, roughness: 0.55 }),
    red: std({ color: 0xc8121e, metalness: 0.1, roughness: 0.3 }),
    bombRed: std({ color: 0x9b0d14, metalness: 0.0, roughness: 0.42 }),
    fuse: std({ color: 0x8a6a3a, metalness: 0, roughness: 0.9 }),
    plastic: std({ color: 0xf4f4f2, metalness: 0, roughness: 0.25, transparent: true, opacity: 0.55 }),
    orange: std({ color: 0xff6a00, metalness: 0, roughness: 0.4 }),
    blue: std({ color: 0x2f7dff, metalness: 0.1, roughness: 0.35 }),
  };
}

function shadowed(obj) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  return obj;
}

// Rubber mallet: head axis along X, handle along -Y from the head centre.
export function makeMallet(M) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 32, 1), M.rubber);
  head.rotation.z = Math.PI / 2;
  g.add(head);
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.1, 0.012, 32), M.rubber);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = s * 0.156;
    g.add(cap);
  }
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 16), M.darkSteel);
  ferrule.position.y = -0.11;
  g.add(ferrule);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.72, 16), M.wood);
  handle.position.y = -0.47;
  g.add(handle);
  return shadowed(g);
}

// Nozzle tools (torch / cryo): tip at origin, body extends along +Y.
export function makeTorch(M) {
  const g = new THREE.Group();
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.07, 20, 1, true), M.brass);
  tip.position.y = 0.035;
  g.add(tip);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.32, 16), M.steel);
  tube.position.y = 0.23;
  g.add(tube);
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 20), M.brass);
  valve.position.y = 0.42;
  g.add(valve);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 6), M.red);
  knob.position.set(0.05, 0.42, 0);
  knob.rotation.z = Math.PI / 2;
  g.add(knob);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.5, 28), M.blue);
  tank.position.y = 0.72;
  g.add(tank);
  return shadowed(g);
}

export function makeSpray(M) {
  const g = new THREE.Group();
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.05, 16), M.darkSteel);
  nozzle.position.y = 0.025;
  g.add(nozzle);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 24), M.plastic);
  cap.position.y = 0.08;
  g.add(cap);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 32), M.steel);
  can.position.y = 0.33;
  g.add(can);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0765, 0.0765, 0.2, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x8fd3ff, roughness: 0.4, envMap: M.steel.envMap }));
  label.position.y = 0.33;
  g.add(label);
  return shadowed(g);
}

// Melon baller: cup opening along -Y at origin, handle along +Y.
export function makeBaller(M) {
  const g = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.steel);
  cup.material = M.steel.clone();
  cup.material.side = THREE.DoubleSide;
  g.add(cup);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.22, 12), M.steel);
  neck.position.y = 0.3;
  g.add(neck);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.4, 16), M.wood);
  handle.position.y = 0.6;
  g.add(handle);
  return shadowed(g);
}

// Cherry bomb: sphere at origin with a fuse along +Y.
export function makeBomb(M) {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 20), M.bombRed);
  g.add(ball);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.02, 12), M.darkSteel);
  cap.position.y = 0.077;
  g.add(cap);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.08, 0),
    new THREE.Vector3(0.012, 0.12, 0),
    new THREE.Vector3(0.035, 0.15, 0.01),
    new THREE.Vector3(0.06, 0.16, 0.012),
  ]);
  const fuse = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.0055, 8), M.fuse);
  g.add(fuse);
  g.userData.fuseTip = new THREE.Vector3(0.06, 0.16, 0.012);
  return shadowed(g);
}

// Syringe: needle tip at origin, barrel along +Y.
export function makeSyringe(M) {
  const g = new THREE.Group();
  const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.004, 0.22, 8), M.steel);
  needle.position.y = 0.11;
  g.add(needle);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.03, 16), M.orange);
  hub.position.y = 0.235;
  g.add(hub);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 24, 1, true), M.plastic);
  barrel.position.y = 0.42;
  g.add(barrel);
  const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 20), new THREE.MeshStandardMaterial({ color: 0xdff4ff, roughness: 0.1, transparent: true, opacity: 0.35, envMap: M.steel.envMap }));
  fluid.position.y = 0.41;
  g.add(fluid);
  const flange = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 0.05), M.plastic);
  flange.position.y = 0.59;
  g.add(flange);
  const plunger = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 8), M.plastic);
  rod.position.y = 0.15;
  plunger.add(rod);
  const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 24), M.plastic);
  thumb.position.y = 0.3;
  plunger.add(thumb);
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.02, 20), M.rubber);
  plunger.add(seal);
  plunger.position.y = 0.3;
  g.add(plunger);
  g.userData.plunger = plunger;
  g.userData.fluid = fluid;
  return shadowed(g);
}

// Pneumatic nail gun, muzzle at origin pointing -Z (camera-space viewmodel).
export function makeNailGun(M) {
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2b211, roughness: 0.38, metalness: 0.05, envMap: M.steel.envMap });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.32), yellow);
  body.position.set(0, 0.02, 0.17);
  g.add(body);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 24), M.darkSteel);
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 0.06, 0.05);
  g.add(head);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.09, 16), M.steel);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.0, -0.01);
  g.add(nose);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.3), M.darkSteel);
  mag.position.set(0, -0.045, 0.16);
  mag.rotation.x = -0.12;
  g.add(mag);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.17, 0.065), M.rubber);
  grip.position.set(0, -0.06, 0.32);
  grip.rotation.x = 0.35;
  g.add(grip);
  return shadowed(g);
}

// A pistol (the hole gun): muzzle toward -Z, like the nail gun.
export function makeHoleGun(M) {
  const g = new THREE.Group();
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.26), M.darkSteel);
  slide.position.set(0, 0.05, 0.11);
  g.add(slide);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.04, 0.22), M.rubber);
  frame.position.set(0, 0.005, 0.13);
  g.add(frame);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 18), M.steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.05, -0.04);
  g.add(barrel);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.012, 0.2), M.blue);
  stripe.position.set(0, 0.065, 0.12);
  g.add(stripe);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.16, 0.07), M.rubber);
  grip.position.set(0, -0.07, 0.21);
  grip.rotation.x = 0.28;
  g.add(grip);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 20, Math.PI), M.darkSteel);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.02, 0.13);
  g.add(guard);
  return shadowed(g);
}

// Horseshoe magnet: poles pointing -Y at origin.
export function makeMagnet(M) {
  const g = new THREE.Group();
  const R = 0.11, r = 0.036;
  const arc = new THREE.Mesh(new THREE.TorusGeometry(R, r, 16, 40, Math.PI), M.red);
  arc.position.y = 0.16;
  g.add(arc);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 16), M.red);
    leg.position.set(s * R, 0.1, 0);
    g.add(leg);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 16), M.steel);
    pole.position.set(s * R, 0.02, 0);
    g.add(pole);
  }
  return shadowed(g);
}

const _up = new THREE.Vector3(0, 1, 0);
// Orient a +Y-modelled object so that +Y points along `dir`.
export function orient(obj, pos, dir) {
  obj.position.copy(pos);
  obj.quaternion.setFromUnitVectors(_up, dir.clone().normalize());
}
