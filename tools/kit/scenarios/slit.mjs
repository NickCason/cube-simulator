// A liquid cube slit from its top (a part cut, `depth` down) and kept in one piece, then hold='open' - two fingers
// either side pull the slit a little open and hold it (it should drain out of the slit), 'drag' - one finger drags
// the cube round in circles (its liquid should stay in but out of the slit), or 'none'. Its drops out of its box
// (+3 cm) each frame - most, at the end - and out by its bottom (under it, in its footprint: through the floor).
import { table } from './_common.mjs';
export const meta = { name: 'slit', params: { cube: 'plainLiquid', skin: 0.5, depth: 0.5, u: 0.5, hold: 'open', gap: 0.2, v: 0.3, pull: 1.5, steps: 20, frames: 90, r: 80 } };
export async function run(k, p) {
  await k.load(p.cube, { liqSkin: p.skin }, { settle: 90 });
  await k.knife([p.u, -0.3], [p.u, p.depth]);
  await k.frames(6);
  await k.app((a) => {
    const W = (window.__sl = { most: 0, under: 0, prevIn: new Uint8Array(20000) });
    W.look = () => {
      const sb = a.sb, fl = a.fluid, big = sb.pieces.filter(Boolean).reduce((m, q) => (!m || q.verts.length > m.verts.length ? q : m), null);
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const i of big.verts) for (let c = 0; c < 3; c++) (lo[c] = Math.min(lo[c], sb.x[i * 3 + c])), (hi[c] = Math.max(hi[c], sb.x[i * 3 + c]));
      let out = 0;
      for (let i = 0; i < fl.n; i++) {
        const x = fl.x[i * 3], y = fl.x[i * 3 + 1], z = fl.x[i * 3 + 2], m = 0.03;
        const foot = x > lo[0] + m && x < hi[0] - m && z > lo[2] + m && z < hi[2] - m, inside = x > lo[0] - m && x < hi[0] + m && y > lo[1] - m && y < hi[1] + m && z > lo[2] - m && z < hi[2] + m;
        if (!inside) out++;
        if (W.prevIn[i] && foot && y < lo[1] - 0.02) W.under++;
        W.prevIn[i] = foot && y > lo[1] && y < hi[1] ? 1 : 0;
      }
      W.most = Math.max(W.most, out);
      W.out = out;
      W.n = fl.n;
      W.pieces = sb.pieces.filter(Boolean).length;
    };
    W.look();
  });
  const step = async (n) => { for (let i = 0; i < n; i++) await k.app((a) => { a.frame(1 / 30); window.__sl.look(); }); };
  const ptr = (type, id, x, y) => k.page.evaluate(([type, id, x, y]) => window.__kit.pointer(type, id, x, y), [type, id, x, y]);
  await k.app((a) => a.setTool('hand'));
  if (p.hold === 'open') {
    let [ax, ay] = await k.at(p.u - p.gap, p.v), [bx, by] = await k.at(p.u + p.gap, p.v);
    await ptr('pointerdown', 1, ax, ay);
    await step(1);
    await ptr('pointerdown', 2, bx, by);
    await step(2);
    for (let s = 0; s < p.steps; s++) {
      ax -= p.pull; bx += p.pull;
      await ptr('pointermove', 1, ax, ay);
      await ptr('pointermove', 2, bx, by);
      await step(1);
    }
    await step(p.frames);
    await ptr('pointerup', 1, ax, ay);
    await ptr('pointerup', 2, bx, by);
  } else if (p.hold === 'drag') {
    const [x, y] = await k.at(0.5, 0.6);
    await ptr('pointerdown', 1, x, y);
    await step(2);
    const n = Math.max(1, Math.round(p.frames / 2));
    for (let s = 1; s <= n; s++) {
      const t = (s / 24) * 2 * Math.PI;
      await ptr('pointermove', 1, x + p.r * Math.sin(t), y - p.r * (1 - Math.cos(t)));
      await step(2);
    }
    await ptr('pointerup', 1, x, y);
  } else await step(p.frames);
  await step(20);
  return await k.app(() => { const W = window.__sl; return { out: W.out, most: W.most, under: W.under, drops: W.n, pieces: W.pieces }; });
}
export const row = (r) => `drops out of its box ${r.out} (most ${r.most}) of ${r.drops} | through its floor ${r.under} | pieces ${r.pieces}`;
export const summary = (all) => table(all, ['out', 'most', 'under', 'pieces']);
