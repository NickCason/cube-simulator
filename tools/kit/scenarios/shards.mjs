// "Stretched shards" (his screenshot: a corner cut on a rubbery ultrathin cube - long thin spikes out of the cube
// and the piece): a cube cut (corner: sliced off and pulled away; cornerCut: left), then frames - the jelly as
// drawn against the jelly as it is (probe spikes): drawn points past 3 / 6 cm off its surface, the worst, each
// look; and pictures (pics=1) at the worst look, whole and with the liquid hidden.
import { join } from 'node:path';
import { cut, table } from './_common.mjs';
// (scen 'knife': a slice from [u0, v0] to [u1, v1] on the screen box, the smaller side pulled away by hand if pull=1)
export const meta = { name: 'shards', dpr: 1, params: { cube: 'plainLiquid', texture: 'rubber', edges: '', faces: '', skin: 0, fill: 1, scen: 'corner', u0: -0.25, v0: 0.3, u1: 0.3, v1: -0.25, pull: 1, frames: 150, every: 10, pics: 0 } };
export async function run(k, p, ctx) {
  await k.load(p.cube, { liqSkin: p.skin, liqFill: p.fill }, { settle: 90 });
  if (p.texture) await k.style({ texture: p.texture });
  if (p.edges) await k.style({ edges: p.edges });
  if (p.faces !== '') await k.set({ faces: p.faces });
  await k.frames(60);
  if (p.scen === 'knife') {
    await k.knife([p.u0, p.v0], [p.u1, p.v1]);
    await k.frames(4);
    if (p.pull) await k.pull('small', [-140, -70], 12);
  } else await cut(k, p.scen);
  let worst = { worstCm: 0 }, sum3 = 0, looks = 0, worstAt = 0, st = { worst: 0 };
  for (let f = 0; f < p.frames; f += p.every) {
    await k.frames(p.every);
    const r = await k.probe('spikes'), s2 = await k.probe('stretch');
    if (s2.worst > st.worst) st = { ...s2, f: f + p.every };
    looks++;
    sum3 += r.over3 || 0;
    if ((r.worstCm || 0) > worst.worstCm) (worst = r), (worstAt = f + p.every);
  }
  const shots = [];
  if (p.pics) for (const s of ['all', 'liquid']) shots.push(await k.shot(join(ctx.out, `shards-${ctx.build}-s${ctx.seed}-${p.texture}-${p.scen}-${s}.png`), { skip: s === 'liquid' ? { liquid: true } : {} }));
  return { stretch: st.worst, stretchOver18: st.over18, stretchOver3: st.over3, stretchAt: st.at, worstCm: worst.worstCm, worstAt, over3max: worst.over3, over6: worst.over6, meanOver3: +(sum3 / looks).toFixed(1), kind: worst.at?.kind, where: worst.at?.p, kinds: worst.kinds, ...(await k.probe('pieces')), ...(shots.length ? { shots: shots.join(' ') } : {}) };
}
export const row = (r) => `pieces ${r.n} | stretched ${r.stretch}x (tets past 1.8x ${r.stretchOver18}, past 3x ${r.stretchOver3}; ${JSON.stringify(r.stretchAt)}) | drawn off the jelly: worst ${r.worstCm} cm (frame ${r.worstAt}, a ${r.kind} point at ${JSON.stringify(r.where)}), past 3 cm ${r.over3max} (${JSON.stringify(r.kinds)}), past 6 cm ${r.over6}, mean past 3 cm ${r.meanOver3}`;
export const summary = (all) => table(all, ['stretch', 'stretchOver18', 'stretchOver3', 'worstCm', 'over3max']);
