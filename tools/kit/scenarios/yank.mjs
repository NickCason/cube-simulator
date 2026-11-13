// "Shoot cube in middle, watch it dribble. Normal. Yank the dribbling cube up and a sheet of liquid escapes the
// bottom face." Shot through its middle (gun), left to dribble (wait), then grabbed (at [gu, gv]) and yanked up
// (rise px over `over` frames), held: each frame, the liquid's drops that crossed its bottom face inside its
// footprint (not out of the hole and down), and the drawn surface under it - and pictures at the yank (pics=1).
// (The gun's shot tips down from the eye: out through its bottom face - the dribble's out of that, and some of
// what's over that hole goes out of it as the floor's yanked up past it: a few a frame, not a sheet)
import { join } from 'node:path';
import { table } from './_common.mjs';
// (shake=N: instead, shaken side to side N times, rise px each way, `over` frames a stroke - out through its sides too)
export const meta = { name: 'yank', params: { cube: 'blueGold', gun: 'holegun', wait: 60, gu: 0.5, gv: 0.2, rise: 320, over: 4, hold: 30, pics: 0, shake: 0 } };
export async function run(k, p, ctx) {
  await k.load(p.cube, {}, { settle: 120 });
  await k.shoot(p.gun, [0.5, 0.55]);
  await k.frames(p.wait);
  await k.app((a) => {
    // (each frame: the jelly's box - its biggest piece - and each drop: in its footprint, over its bottom then, under it now)
    const W = (window.__yk = { prevIn: new Uint8Array(a.fluid.max || 8192), crossed: 0, sides: 0, worst: 0, frames: 0, under: 0 });
    W.look = () => {
      const sb = a.sb, fl = a.fluid, big = sb.pieces.filter(Boolean).reduce((m, q) => (!m || q.verts.length > m.verts.length ? q : m), null);
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const i of big.verts) for (let c = 0; c < 3; c++) (lo[c] = Math.min(lo[c], sb.x[i * 3 + c])), (hi[c] = Math.max(hi[c], sb.x[i * 3 + c]));
      let now = 0;
      for (let i = 0; i < fl.n; i++) {
        const x = fl.x[i * 3], y = fl.x[i * 3 + 1], z = fl.x[i * 3 + 2], foot = x > lo[0] + 0.03 && x < hi[0] - 0.03 && z > lo[2] + 0.03 && z < hi[2] - 0.03;
        const inside = foot && y > lo[1] && y < hi[1];
        if (W.prevIn[i] && foot && y < lo[1] - 0.02) (W.crossed++, now++);
        // (out through a side: off its box across by 2 cm, between its bottom and top)
        else if (W.prevIn[i] && y > lo[1] + 0.03 && y < hi[1] && (x < lo[0] - 0.02 || x > hi[0] + 0.02 || z < lo[2] - 0.02 || z > hi[2] + 0.02)) W.sides++;
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
    // (and each time its liquid's kept in: drops let go out of its skin more than 30 cm from any cut face - none of
    // them by an opening: through a wall)
    const fl = a.fluid, oc = fl._contain;
    W.far = 0;
    W.near = 0;
    fl._contain = function () {
      const n = this.n, EIpre = this.envIn.slice(0, n);
      oc.call(this);
      const sb = a.sb, S = sb.sTri, X = sb.x, HF = sb.sHollow, cf = [];
      for (let f = 0; f < sb.nF; f++) if (sb.sTag[f] === 0 && !(HF && HF[f] === 2)) cf.push((X[S[f * 3] * 3] + X[S[f * 3 + 1] * 3] + X[S[f * 3 + 2] * 3]) / 3, (X[S[f * 3] * 3 + 1] + X[S[f * 3 + 1] * 3 + 1] + X[S[f * 3 + 2] * 3 + 1]) / 3, (X[S[f * 3] * 3 + 2] + X[S[f * 3 + 1] * 3 + 2] + X[S[f * 3 + 2] * 3 + 2]) / 3);
      for (let i = 0; i < n; i++) {
        if (!(EIpre[i] === 1 && this.envIn[i] === 0)) continue;
        const o = i * 3;
        let d2 = Infinity;
        for (let c = 0; c < cf.length; c += 3) d2 = Math.min(d2, (cf[c] - this.x[o]) ** 2 + (cf[c + 1] - this.x[o + 1]) ** 2 + (cf[c + 2] - this.x[o + 2]) ** 2);
        if (d2 > 0.09) W.far++;
        else W.near++;
      }
    };
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
  if (p.shake)
    for (let c = 0; c < p.shake * 2; c++)
      for (let i = 1; i <= p.over; i++) {
        const to = c % 2 ? -1 : 1, from = c === 0 ? 0 : -to;
        await k.page.mouse.move(x + p.rise * 0.5 * (from + ((to - from) * i) / p.over), y);
        await step(1);
      }
  else
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
  // (and at the end, how many of its drops are still in its box, +3 cm)
  const kept = await k.app((a) => {
    const sb = a.sb, fl = a.fluid, big = sb.pieces.filter(Boolean).reduce((m, q) => (!m || q.verts.length > m.verts.length ? q : m), null), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const i of big.verts) for (let c = 0; c < 3; c++) (lo[c] = Math.min(lo[c], sb.x[i * 3 + c])), (hi[c] = Math.max(hi[c], sb.x[i * 3 + c]));
    let n = 0;
    for (let i = 0; i < fl.n; i++) { let ok = true; for (let c = 0; c < 3; c++) if (fl.x[i * 3 + c] < lo[c] - 0.03 || fl.x[i * 3 + c] > hi[c] + 0.03) ok = false; if (ok) n++; }
    return n;
  });
  const r = await k.app(() => ({ letGoFar: window.__yk.far, letGoNear: window.__yk.near, crossed: window.__yk.crossed, sides: window.__yk.sides, worstFrame: window.__yk.worst, underMax: window.__yk.under, frames: window.__yk.frames }));
  return { ...r, kept, ...(await k.probe('pieces')), ...(shots.length ? { shots: shots.join(' ') } : {}) };
}
export const row = (r) => `let go through a wall (30 cm+ from a cut) ${r.letGoFar}, by an opening ${r.letGoNear} | drops through its bottom face ${r.crossed} (worst frame ${r.worstFrame}), its sides ${r.sides} | drawn surface under it ${r.underMax} points | pieces ${r.n}`;
export const summary = (all) => table(all, ['letGoFar', 'letGoNear', 'kept', 'crossed', 'sides', 'underMax']);
