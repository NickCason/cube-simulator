// A part cut pulled apart: a slice from the cube's top down to `depth`, then two fingers either side of it pulled
// apart (ang: the pull's slant on the screen) till it tears - did it tear on through the slit (two pieces, each
// 90% or more one side of the slit's plane at rest, no sliver under 150 points), and was the slit seen.
import { table } from './_common.mjs';
export const meta = { name: 'tear', params: { cube: 'plain', rig: 1, ang: 0, v: 0.3, gap: 0.2, depth: 0.5, u: 0.5, pull: 3, steps: 90 } };
export async function run(k, p) {
  await k.load(p.cube, { rigidity: p.rig });
  await k.knife([p.u, -0.3], [p.u, p.depth]);
  await k.frames(6);
  // the slit's plane at rest: its cut faces (a hollow's own skin aside)
  const slit = await k.app((a) => {
    const sb = a.sb, X = sb.X, F = sb.sTri, n = [0, 0, 0], c = [0, 0, 0];
    let A = 0, nf = 0;
    for (let f = 0; f < sb.nF; f++) {
      if (sb.sTag[f] !== 0 || (sb.sHollow && sb.sHollow[f] === 2)) continue;
      const i = [F[f * 3], F[f * 3 + 1], F[f * 3 + 2]], u = [0, 1, 2].map((q) => X[i[1] * 3 + q] - X[i[0] * 3 + q]), w = [0, 1, 2].map((q) => X[i[2] * 3 + q] - X[i[0] * 3 + q]);
      let m = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const ar = Math.hypot(...m) / 2;
      if (!(ar > 1e-9)) continue;
      m = m.map((q) => q / (2 * ar));
      if (nf && m[0] * n[0] + m[1] * n[1] + m[2] * n[2] < 0) m = m.map((q) => -q);
      for (let q = 0; q < 3; q++) (n[q] += m[q] * ar), (c[q] += ((X[i[0] * 3 + q] + X[i[1] * 3 + q] + X[i[2] * 3 + q]) / 3) * ar);
      A += ar; nf++;
    }
    const l = Math.hypot(...n) || 1;
    return { n: n.map((q) => q / l), c: c.map((q) => q / A), faces: nf };
  });
  await k.app((a) => {
    a.setTool('hand');
    const h = a.tool, log = (window.__tl = []), s0 = h._startTear.bind(h);
    h._startTear = (best) => { const r = s0(best); log.push({ slit: !!best.wk?.slit, pn: r?.pn || null }); return r; };
  });
  const b = await k.box(), asp = (b.x1 - b.x0) / (b.y1 - b.y0), an = (p.ang * Math.PI) / 180, ca = Math.cos(an), sa = Math.sin(an);
  let [ax, ay] = await k.at(0.5 - p.gap * ca, p.v - p.gap * sa * asp), [bx, by] = await k.at(0.5 + p.gap * ca, p.v + p.gap * sa * asp);
  const ptr = (type, id, x, y) => k.page.evaluate(([type, id, x, y]) => window.__kit.pointer(type, id, x, y), [type, id, x, y]);
  await ptr('pointerdown', 1, ax, ay);
  await k.frames(1);
  await ptr('pointerdown', 2, bx, by);
  await k.frames(2);
  let torn = false, frames = 0;
  for (let s = 0; s < p.steps && !torn; s++) {
    ax -= p.pull * ca; ay -= p.pull * sa; bx += p.pull * ca; by += p.pull * sa;
    await ptr('pointermove', 1, ax, ay);
    await ptr('pointermove', 2, bx, by);
    await k.frames(2);
    frames += 2;
    torn = await k.app((a) => a.sb.pieces.filter(Boolean).length >= 2 && !a.tool.tear);
  }
  await k.frames(10);
  const sides = await k.app((a, sl) => a.sb.pieces.filter(Boolean).map((pc) => {
    let pos = 0, neg = 0;
    for (const i of pc.verts) { const d = (a.sb.X[i * 3] - sl.c[0]) * sl.n[0] + (a.sb.X[i * 3 + 1] - sl.c[1]) * sl.n[1] + (a.sb.X[i * 3 + 2] - sl.c[2]) * sl.n[2]; if (d > 0.01) pos++; else if (d < -0.01) neg++; }
    return { verts: pc.verts.length, own: Math.round((100 * Math.max(pos, neg)) / Math.max(1, pos + neg)) };
  }), slit);
  await ptr('pointerup', 1, ax, ay);
  await ptr('pointerup', 2, bx, by);
  const tl = await k.app(() => window.__tl[0] || null);
  const big = sides.filter((s) => s.verts >= 150), small = sides.filter((s) => s.verts < 150);
  const outcome = !torn ? 'none' : big.length === 2 && big.every((s) => s.own >= 90) && !small.length ? 'good' : small.length ? 'sliver' : 'mixed';
  const off = tl?.pn ? +((Math.acos(Math.min(1, Math.abs(tl.pn[0] * slit.n[0] + tl.pn[1] * slit.n[1] + tl.pn[2] * slit.n[2]))) * 180) / Math.PI).toFixed(0) : null;
  return { outcome, torn, frames, pieces: sides.map((s) => `${s.verts}:${s.own}%`).join(' '), slitSeen: tl ? tl.slit : null, planeOffDeg: off };
}
export const row = (r) => `${r.outcome} | ${r.torn ? `torn after ${r.frames} frames` : 'not torn'} | pieces ${r.pieces} | slit seen ${r.slitSeen}, plane ${r.planeOffDeg} deg off it`;
export function summary(all) {
  const groups = new Map();
  for (const r of all) {
    const key = `${r.build}  ${Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(' ')}`;
    const g = groups.get(key) || groups.set(key, { good: 0, sliver: 0, mixed: 0, none: 0, err: 0 }).get(key);
    g[r.error ? 'err' : r.outcome]++;
  }
  return [...groups].map(([k, g]) => `${k}\n   good ${g.good}, sliver ${g.sliver}, mixed ${g.mixed}, no tear ${g.none}${g.err ? `, errors ${g.err}` : ''}`).join('\n');
}
