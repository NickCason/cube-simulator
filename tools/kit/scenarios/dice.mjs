// The dicer through a cube (solid: liquid off): its pieces and how the dice's cut faces are drawn - kept flat,
// a plane's edge, rim, smoothed (a die's faces smoothed: pebbles).
import { table } from './_common.mjs';
export const meta = { name: 'dice', params: { cube: 'fluorescent', liquid: 0 } };
export async function run(k, p) {
  await k.load(p.cube, { liquid: p.liquid });
  await k.tap('dicer');
  await k.frames(60);
  return { pieces: (await k.probe('pieces')).n, ...(await k.probe('cutKinds')) };
}
export const row = (r) => `pieces ${r.pieces} | planes ${r.planes} | cut-face points ${r.points}: flat ${r.flat}, edge ${r.edge}, rim ${r.rim}, smoothed ${r.smooth}`;
export const summary = (all) => table(all, ['pieces', 'planes', 'flat', 'smooth']);
