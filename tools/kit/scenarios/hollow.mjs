// A cube full of liquid's hollow as drawn against its shape as drawn (rounded at least a third of a cell): how
// far its points are off it, by corner set.
import { table } from './_common.mjs';
export const meta = { name: 'hollow', params: { cube: 'plainLiquid', skin: 0, edges: '' } };
export async function run(k, p) {
  await k.load(p.cube, { liquid: 0 }, { settle: 10 });
  if (p.edges) await k.style({ edges: p.edges });
  await k.set({ liqSkin: p.skin, liquid: 1, liqFill: 1 });
  await k.frames(40);
  return await k.probe('hollowFit');
}
export const row = (r) => (r.none ? 'no hollow drawn as its own' : `rounding ${r.roundingCm} cm | points ${r.points}, worst off ${r.worstCm} cm, past 5 mm ${r.past5mm} | corners even ${r.evenCm}, odd ${r.oddCm} cm`);
export const summary = (all) => table(all, ['worstCm', 'past5mm', 'evenCm', 'oddCm']);
