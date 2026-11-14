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

// The jelly ladle (Add jelly): a deep steel bowl (its rim at the origin,
// open along +Y) on a long handle that rises away from it.
export function makeLadle(M) {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.steel.clone());
  bowl.material.side = THREE.DoubleSide;
  g.add(bowl);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.008, 8, 48), M.steel);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.62, 12), M.steel);
  handle.position.set(0.3, 0.2, 0);
  handle.rotation.z = -1.05;
  g.add(handle);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.2, 16), M.wood);
  grip.position.set(0.53, 0.33, 0);
  grip.rotation.z = -1.05;
  g.add(grip);
  return shadowed(g);
}

// Cube cuber: a melon baller with a square cup (open side down, its rim at
// the origin) on a neck and handle along +Y.
export function makeCuber(M) {
  const g = new THREE.Group();
  const steel = M.steel.clone();
  steel.side = THREE.DoubleSide;
  const s = 0.26, t = 0.007, h = 0.24;
  for (const [w, d, x, z] of [[s, t, 0, s / 2 - t / 2], [s, t, 0, t / 2 - s / 2], [t, s, s / 2 - t / 2, 0], [t, s, t / 2 - s / 2, 0]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), steel);
    wall.position.set(x, h / 2, z);
    g.add(wall);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(s, t, s), steel);
  top.position.y = h - t / 2;
  g.add(top);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.2, 12), M.steel);
  neck.position.y = h + 0.1;
  g.add(neck);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.4, 16), M.wood);
  handle.position.y = h + 0.4;
  g.add(handle);
  return shadowed(g);
}

// Dicer: a grid of blades - as many as it dices a side (userData.setDice(n):
// n - 1 each way, evenly spread, 2 to 5) - their edges at y = 0, spanning x, z
// in -0.5..0.5 and y 0..1 (userData.blades, scaled to whatever it dices),
// under a square frame with two grips (userData.frame, set on the blades' backs).
export function makeDicer(M) {
  const g = new THREE.Group();
  const blades = new THREE.Group(), frame = new THREE.Group();
  const steel = M.steel.clone();
  steel.side = THREE.DoubleSide;
  steel.roughness = 0.12;
  const t = 0.006, across = [], along = [];
  for (let i = 0; i < 4; i++) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, t), steel);
    a.position.y = 0.5;
    blades.add(a);
    across.push(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(t, 1, 1), steel);
    b.position.y = 0.5;
    blades.add(b);
    along.push(b);
  }
  g.userData.setDice = (n) => {
    n = Math.max(2, Math.min(5, Math.round(n) || 3));
    for (let i = 0; i < 4; i++) {
      const on = i < n - 1, o = -0.5 + (i + 1) / n;
      across[i].visible = along[i].visible = on;
      across[i].position.z = o;
      along[i].position.x = o;
    }
  };
  g.userData.setDice(3);
  const bar = 0.04;
  for (const [w, d, x, z] of [[1 + bar, bar, 0, 0.5], [1 + bar, bar, 0, -0.5], [bar, 1 + bar, 0.5, 0], [bar, 1 + bar, -0.5, 0]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, bar, d), M.darkSteel);
    f.position.set(x, bar / 2, z);
    frame.add(f);
  }
  for (const x of [-0.6, 0.6]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 12), M.wood);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(x, bar / 2, 0);
    frame.add(grip);
  }
  g.add(blades, frame);
  g.userData.blades = blades;
  g.userData.frame = frame;
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

// Full auto: a little rotary gun - six barrels round its axis (they spin:
// the group named 'spin'), pointing -Z, a drum and a grip under it.
export function makeAutoGun(M) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  spin.name = 'spin';
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 10), M.darkSteel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(Math.cos(a) * 0.022, Math.sin(a) * 0.022, -0.17);
    spin.add(barrel);
  }
  for (const z of [-0.29, -0.12]) {
    const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.016, 20), M.steel);
    clamp.rotation.x = Math.PI / 2;
    clamp.position.z = z;
    spin.add(clamp);
  }
  g.add(spin);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.16, 24), M.darkSteel);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.04;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.046, 0.04, 24), M.orange);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.14;
  g.add(cap);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 24), M.brass);
  drum.rotation.z = Math.PI / 2;
  drum.position.set(0.075, -0.03, 0.03);
  g.add(drum);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05), M.rubber);
  grip.position.set(0, -0.09, 0.09);
  grip.rotation.x = 0.3;
  g.add(grip);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 8, 20, Math.PI), M.steel);
  handle.rotation.set(Math.PI / 2, 0, 0);
  handle.position.set(0, 0.05, 0.02);
  g.add(handle);
  return shadowed(g);
}

// Pump shotgun: its barrel along -Z (the muzzle at z -0.45, y 0.018), the magazine tube under it, the fore-end on
// that (the group named 'pump': it slides back +Z to work the action), the receiver, a wooden stock behind.
export function makeShotgun(M) {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 18), M.darkSteel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.018, -0.235);
  g.add(barrel);
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 14), M.rubber);
  bore.rotation.x = Math.PI / 2;
  bore.position.set(0, 0.018, -0.447);
  g.add(bore);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), M.brass);
  bead.position.set(0, 0.032, -0.43);
  g.add(bead);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.33, 14), M.darkSteel);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, -0.007, -0.19);
  g.add(tube);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.012, 14), M.steel);
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, -0.007, -0.36);
  g.add(cap);
  // (the fore-end: ribbed, round the tube - what the pump slides)
  const pump = new THREE.Group();
  pump.name = 'pump';
  const fe = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.017, 0.12, 18), M.rubber);
  fe.rotation.x = Math.PI / 2;
  pump.add(fe);
  for (let i = 0; i < 6; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.0188, 0.0022, 6, 18), M.rubber);
    rib.position.z = -0.045 + i * 0.018;
    pump.add(rib);
  }
  pump.position.set(0, -0.005, -0.17);
  g.add(pump);
  const recv = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.06, 0.17), M.darkSteel);
  recv.position.set(0, 0.006, 0.05);
  g.add(recv);
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.022, 0.05), M.rubber);
  port.position.set(0.024, 0.016, 0.03);
  g.add(port);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.006, 0.15), M.steel);
  rail.position.set(0, 0.038, 0.05);
  g.add(rail);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 8, 20, Math.PI), M.darkSteel);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.026, 0.1);
  g.add(guard);
  const trig = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.02, 0.006), M.steel);
  trig.position.set(0, -0.032, 0.1);
  g.add(trig);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.07, 0.24), M.wood);
  stock.position.set(0, -0.03, 0.25);
  stock.rotation.x = 0.16;
  g.add(stock);
  const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.05, 0.08), M.wood);
  wrist.position.set(0, -0.012, 0.15);
  wrist.rotation.x = 0.28;
  g.add(wrist);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.08, 0.018), M.rubber);
  pad.position.set(0, -0.05, 0.372);
  pad.rotation.x = 0.16;
  g.add(pad);
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

// Acid bottle: a glass flask of glowing green acid, a yellow hazard label;
// along +Y from its base at the origin, its mouth at userData.lip.
export function makeAcidBottle(M) {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0xe6f7ee, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.32, envMap: M.steel.envMap, envMapIntensity: 1.4, depthWrite: false });
  const acid = new THREE.MeshStandardMaterial({ color: 0x86ff2e, emissive: 0x3cbf00, emissiveIntensity: 0.9, roughness: 0.15, transparent: true, opacity: 0.88 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.064, 0.15, 28), glass);
  body.position.y = 0.075;
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.058, 0.05, 28, 1, true), glass);
  shoulder.position.y = 0.175;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.06, 20, 1, true), glass);
  neck.position.y = 0.23;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 8, 24), glass);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.26;
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.11, 28), acid);
  liquid.position.y = 0.06;
  liquid.name = 'acid';
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0655, 0.0655, 0.06, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.45, envMap: M.steel.envMap }));
  label.position.y = 0.08;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.012, 28, 1, true), M.rubber);
  band.position.y = 0.08;
  g.add(liquid, body, shoulder, neck, lip, label, band);
  g.userData.lip = new THREE.Vector3(0, 0.262, 0);
  return g;
}

// A flour sieve: a steel rim over a fine mesh (a heap of flour in it), a
// handle out to the side. Its mesh is at y 0, centred; the handle along +x.
export function makeSieve(M) {
  const g = new THREE.Group();
  const R = 0.14;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.97, 0.06, 56, 1, true), M.steel);
  rim.position.y = 0.03;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0045, 8, 56), M.steel);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.06;
  // (the mesh: a fine grid of wires, see through)
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c2 = cv.getContext('2d');
  c2.clearRect(0, 0, 128, 128);
  c2.strokeStyle = 'rgba(70,72,78,0.95)';
  c2.lineWidth = 1.4;
  for (let k = 0; k <= 128; k += 8) {
    c2.beginPath(); c2.moveTo(k, 0); c2.lineTo(k, 128); c2.stroke();
    c2.beginPath(); c2.moveTo(0, k); c2.lineTo(128, k); c2.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(R * 0.985, 56), new THREE.MeshStandardMaterial({ map: tex, transparent: true, metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide, depthWrite: false, envMap: M.steel.envMap }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  // (the flour in it: a soft heap)
  const heap = new THREE.Mesh(new THREE.SphereGeometry(R * 0.9, 36, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 1, metalness: 0 }));
  heap.scale.y = 0.24;
  heap.position.y = 0.003;
  heap.name = 'heap';
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.2, 12), M.wood);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(R + 0.1, 0.045, 0);
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.028, 12), M.steel);
  ferrule.rotation.z = Math.PI / 2;
  ferrule.position.set(R + 0.008, 0.045, 0);
  g.add(rim, lip, mesh, heap, handle, ferrule);
  g.userData.radius = R;
  return g;
}
