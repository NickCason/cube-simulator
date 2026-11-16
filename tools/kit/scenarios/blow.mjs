// The blow tool on liquid out in the room: a cube full of liquid cut across, its top lifted off - its liquid out on
// the floor - left to settle, a few drops of jelly put down by the puddle's edge; then a gust held on the puddle where
// it's furthest from the jelly (the side the camera's on, clear of the dock: pressed there, as a finger would) for
// `hold` frames and let go. How far the puddle's drops within 40 cm of there went - on average, their middle - how
// many moved more than 3 cm, whether it slept before, whether the tool blew at all; and the jelly drops'.
import { cut, table } from './_common.mjs';
// (pin=1: the jelly held still while it blows - what the gust does to the liquid itself, not the jelly it shoves
// sweeping the puddle along)
export const meta = { name: 'blow', params: { cube: 'plainLiquid', settle: 600, hold: 45, after: 30, drops: 6, blow: 1, pin: 0, pics: 0 } };
export async function run(k, p, ctx) {
  await k.load(p.cube, {}, { settle: 90 });
  await cut(k, 'bowl');
  await k.frames(p.settle);
  // (the tool picked first: the view settles where it frames the cube for it, before it's aimed)
  await k.app((a) => a.setTool('blow'));
  await k.frames(30);
  // (the drops out of any cube's hollow - its own puddle - and a few jelly drops on the floor by it)
  const before = await k.app((a, n) => {
    const fl = a.fluid, sb = a.sb, cam = a.camera.position, r = a.canvas.getBoundingClientRect(), V = cam.constructor, v = new V();
    // the drop furthest from the jelly, on the camera's side, on screen above the dock
    let best = -1, bd = -1;
    for (let i = 0; i < fl.n; i++) {
      if (fl.dIn[i] !== 0) continue;
      const x = fl.x[i * 3], z = fl.x[i * 3 + 2];
      v.set(x, fl.x[i * 3 + 1], z).project(a.camera);
      const sy = (-v.y * 0.5 + 0.5) * r.height, sx = (v.x * 0.5 + 0.5) * r.width;
      if (sy > r.height * 0.7 || sy < r.height * 0.15 || sx < 30 || sx > r.width - 30) continue;
      if ((x - cam.x) ** 2 + (z - cam.z) ** 2 > (sb.x[0] - cam.x) ** 2 + (sb.x[2] - cam.z) ** 2 + 4) continue;
      let dj = Infinity;
      for (let j = 0; j < sb.nV; j += 3) if (sb.alive[j]) dj = Math.min(dj, (sb.x[j * 3] - x) ** 2 + (sb.x[j * 3 + 2] - z) ** 2);
      if (dj > bd) (bd = dj), (best = i);
    }
    if (best < 0) return { out: 0 };
    const ax = fl.x[best * 3], az = fl.x[best * 3 + 2], near = [];
    for (let i = 0; i < fl.n; i++) if (fl.dIn[i] === 0 && (fl.x[i * 3] - ax) ** 2 + (fl.x[i * 3 + 2] - az) ** 2 < 0.4 * 0.4) near.push(i);
    for (let j = 0; j < n; j++) a.droplets.spawn(new V(ax + (j - n / 2) * 0.05, 0.03, az), new V(0, 0, 0), 0.025, 0xff3355);
    window.__bl = { idx: near, X: near.map((i) => [fl.x[i * 3], fl.x[i * 3 + 1], fl.x[i * 3 + 2]]), D: a.droplets.items.slice(-n).map((d) => [d.p.x, d.p.z]), n: fl.n, vmax: 0, level: 0 };
    return { out: near.length, asleep: fl.asleep, at: [ax, fl.x[best * 3 + 1], az], fromJellyCm: Math.round(100 * Math.sqrt(bd)) };
  }, p.drops);
  if (!before.out) return { out: 0 };
  await k.frames(10);
  if (p.pics) await k.shot(`${ctx.out}/blow-${ctx.build}-s${ctx.seed}-b${p.blow}-before.png`);
  // pressed on the puddle's middle, held, let go (blow=0: left be as long - what it does on its own)
  const [x, y] = await k.probe('screenOf', before.at);
  await k.page.mouse.move(x, y);
  if (p.blow) await k.page.mouse.down();
  if (p.pin) await k.app((a) => (window.__bl.w = a.sb.w.slice(), a.sb.w.fill(0, 0, a.sb.nV)));
  for (let f = 0; f < p.hold + (p.pin ? p.after : 0); f++) {
    if (f === p.hold && p.blow) await k.page.mouse.up();
    await k.app((a, pin) => {
      if (pin) a.sb.v.fill(0, 0, a.sb.nV * 3);
      a.frame(1 / 30);
      const fl = a.fluid, B = window.__bl;
      for (const i of B.idx) B.vmax = Math.max(B.vmax, Math.hypot(fl.v[i * 3], fl.v[i * 3 + 1], fl.v[i * 3 + 2]));
      B.level = Math.max(B.level, a.tools.blow?.level || 0);
    }, p.pin);
    if (p.pics && f === Math.floor(p.hold / 2)) (await k.app((a) => a.render()), await k.shot(`${ctx.out}/blow-${ctx.build}-s${ctx.seed}-b${p.blow}-during.png`));
  }
  if (p.pin) await k.app((a) => a.sb.w.set(window.__bl.w));
  else {
    if (p.blow) await k.page.mouse.up();
    await k.frames(p.after);
  }
  if (p.pics) await k.shot(`${ctx.out}/blow-${ctx.build}-s${ctx.seed}-b${p.blow}-after.png`);
  const r = await k.app((a) => {
    const fl = a.fluid, B = window.__bl;
    if (fl.n !== B.n) return { out: B.idx.length, error: `drops ${B.n} -> ${fl.n}` };
    let moved = 0, sum = 0, cx0 = 0, cz0 = 0, cx1 = 0, cz1 = 0;
    B.idx.forEach((i, j) => {
      const d = Math.hypot(fl.x[i * 3] - B.X[j][0], fl.x[i * 3 + 2] - B.X[j][2]);
      sum += d;
      if (d > 0.03) moved++;
      cx0 += B.X[j][0]; cz0 += B.X[j][2]; cx1 += fl.x[i * 3]; cz1 += fl.x[i * 3 + 2];
    });
    const n = B.idx.length, D = a.droplets.items.slice(-B.D.length);
    const dropCm = D.length ? (100 * D.reduce((s, d, j) => s + Math.hypot(d.p.x - B.D[j][0], d.p.z - B.D[j][1]), 0)) / D.length : 0;
    return { out: n, movedPct: Math.round((100 * moved) / n), meanCm: +((100 * sum) / n).toFixed(1), shiftCm: +((100 * Math.hypot(cx1 - cx0, cz1 - cz0)) / n).toFixed(1), vmax: +B.vmax.toFixed(2), dropCm: +dropCm.toFixed(1), blew: +B.level.toFixed(2) };
  });
  return { ...r, slept: before.asleep ? 1 : 0, fromJellyCm: before.fromJellyCm };
}
export const row = (r) => `${r.out} near (${r.fromJellyCm} cm from jelly, slept ${r.slept}, blew ${r.blew}), ${r.movedPct}% moved >3cm, mean ${r.meanCm} cm, middle ${r.shiftCm} cm, fastest ${r.vmax} m/s; jelly drops ${r.dropCm} cm`;
export const summary = (all) => table(all, ['out', 'fromJellyCm', 'slept', 'blew', 'movedPct', 'meanCm', 'shiftCm', 'vmax', 'dropCm']);
