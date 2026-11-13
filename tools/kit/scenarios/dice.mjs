// The dicer through a cube (solid: liquid off): its pieces and how the dice's cut faces are drawn - kept flat,
// a plane's edge, rim, smoothed (a die's faces smoothed: pebbles).
import { table } from './_common.mjs';
export const meta = { name: 'dice', params: { cube: 'fluorescent', liquid: 0, skin: -1, pics: 0 } };
export async function run(k, p, ctx) {
  await k.load(p.cube, { liquid: p.liquid, ...(p.skin >= 0 ? { liqSkin: p.skin } : {}) });
  await k.tap('dicer');
  await k.frames(60);
  const shots = [];
  if (p.pics) for (const s of ['all', 'liquid']) shots.push(await k.shot(`${ctx.out}/dice-${ctx.build}-s${ctx.seed}-${p.cube}-sk${p.skin}-${s}.png`, { skip: s === 'liquid' ? { liquid: true } : {} }));
  return { pieces: (await k.probe('pieces')).n, ...(await k.probe('cutKinds')), ...(shots.length ? { shots: shots.join(' ') } : {}) };
}
export const row = (r) => `pieces ${r.pieces} | planes ${r.planes} | cut-face points ${r.points}: flat ${r.flat}, edge ${r.edge}, rim ${r.rim} (flat ${r.rimFlat}), smoothed ${r.smooth} | hollow's own ${r.hollow}`;
export const summary = (all) => table(all, ['pieces', 'planes', 'flat', 'smooth']);
