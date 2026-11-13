// "Shoot cube in middle, watch it dribble. Normal. Yank the dribbling cube up and a sheet of liquid escapes the
// bottom face." Shot through its middle (gun), left to dribble (wait), then grabbed (at [gu, gv]) and yanked up
// (rise px over `over` frames), held: each frame, the liquid's drops that crossed its bottom face inside its
// footprint (not out of the hole and down), and the drawn surface under it - and pictures at the yank (pics=1).
// (The gun's shot tips down from the eye: out through its bottom face - the dribble's out of that, and some of
// what's over that hole goes out of it as the floor's yanked up past it: a few a frame, not a sheet)
import { join } from 'node:path';
import { table } from './_common.mjs';
export const meta = { name: 'yank', params: { cube: 'blueGold', gun: 'holegun', wait: 60, gu: 0.5, gv: 0.2, rise: 320, over: 4, hold: 30, pics: 0 } };
export async function run(k, p, ctx) {
  await k.load(p.cube, {}, { settle: 120 });
  await k.shoot(p.gun, [0.5, 0.55]);
  await k.frames(p.wait);
  await k.app((a) => {
    // (each frame: the jelly's box - its biggest piece - and each drop: in its footprint, over its bottom then, under it now)
    const W = (window.__yk = { prevIn: new Uint8Array(a.fluid.max || 8192), crossed: 0, worst: 0, frames: 0, under: 0 });
    W.look = () => {
      const sb = a.sb, fl = a.fluid, big = sb.pieces.filter(Boolean).reduce((m, q) => (!m || q.verts.length > m.verts.length ? q : m), null);
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const i of big.verts) for (let c = 0; c < 3; c++) (lo[c] = Math.min(lo[c], sb.x[i * 3 + c])), (hi[c] = Math.max(hi[c], sb.x[i * 3 + c]));
      let now = 0;
      for (let i = 0; i < fl.n; i++) {
        const x = fl.x[i * 3], y = fl.x[i * 3 + 1], z = fl.x[i * 3 + 2], foot = x > lo[0] + 0.03 && x < hi[0] - 0.03 && z > lo[2] + 0.03 && z < hi[2] - 0.03;
        const inside = foot && y > lo[1] && y < hi[1];
        if (W.prevIn[i] && foot && y < lo[1] - 0.02) (W.crossed++, now++);
        W.prevIn[i] = inside ? 1 : 0;
      }
      // (the drawn surface under its bottom, inside its footprint)
      let under = 0;
      const P = fl.pos, cnt = fl.geo.drawRange.count;
      for (let v = 0; v < cnt; v++) if (P[v * 3] > lo[0] + 0.03 && P[v * 3] < hi[0] - 0.03 && P[v * 3 + 2] > lo[2] + 0.03 && P[v * 3 + 2] < hi[2] - 0.03 && P[v * 3 + 1] < lo[1] - 0.02) under++;
      W.under = Math.max(W.under, under);
      W.worst = Math.max(W.worst, now);
      W.frames++;
    };
    W.look();
  });
  const step = async (n) => { for (let i = 0; i < n; i++) await k.app((a) => { a.frame(1 / 30); window.__yk.look(); }); };
  await k.app((a) => a.setTool('hand'));
  const [x, y] = await k.at(p.gu, p.gv);
  await k.page.mouse.move(x, y);
  await k.page.mouse.down();
  await step(1);
  // (pictures - pics=1 - as it's yanked and after: frames `over`, +2, +4, +8 - each whole and with the jelly hidden)
  const at = p.pics ? [p.over, p.over + 2, p.over + 4, p.over + 8] : [], shots = [];
  const snap = async (f) => {
    if (!at.includes(f)) return;
    for (const s of ['all', 'jelly']) shots.push(await k.shot(join(ctx.out, `yank-${ctx.build}-s${ctx.seed}-f${f}-${s}.png`), { skip: s === 'jelly' ? { jelly: true } : {} }));
  };
  for (let i = 1; i <= p.over; i++) {
    await k.page.mouse.move(x, y - (p.rise * i) / p.over);
    await step(1);
    await snap(i);
  }
  for (let i = 1; i <= p.hold; i++) {
    await step(1);
    await snap(p.over + i);
  }
  await k.page.mouse.up();
  const r = await k.app(() => ({ crossed: window.__yk.crossed, worstFrame: window.__yk.worst, underMax: window.__yk.under, frames: window.__yk.frames }));
  return { ...r, ...(await k.probe('pieces')), ...(shots.length ? { shots: shots.join(' ') } : {}) };
}
export const row = (r) => `drops through its bottom face ${r.crossed} (worst frame ${r.worstFrame}) | drawn surface under it ${r.underMax} points | pieces ${r.n}`;
export const summary = (all) => table(all, ['crossed', 'worstFrame', 'underMax']);
