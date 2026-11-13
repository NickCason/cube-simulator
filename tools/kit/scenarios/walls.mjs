// Liquid kept out of the jelly: a cube full of liquid cut one way (scen: bowl | slices | dice | drop | corner |
// cornerCut | none) - its liquid's drawn surface in the jelly over the next frames (1 cm and 3 cm deep or more).
import { cut, table } from './_common.mjs';
export const meta = { name: 'walls', params: { cube: 'plainLiquid', scen: 'bowl', skin: 0.5, fill: 1, rig: 0, wait: 90, frames: 30 } };
export async function run(k, p) {
  await k.load(p.cube, { bubbles: 0, rigidity: p.rig, liqSkin: p.skin, liquid: 1, liqFill: p.fill });
  await cut(k, p.scen);
  await k.frames(p.wait);
  const d = await k.probe('depth', { frames: p.frames }), pc = await k.probe('pieces');
  return { pieces: pc.n, ...d };
}
export const row = (r) => `pieces ${r.pieces} | in the jelly >=1 cm: mean ${r.d1mean} worst ${r.d1worst} | >=3 cm: mean ${r.d3mean} worst ${r.d3worst} | deepest ${r.deepestCm} cm`;
export const summary = (all) => table(all, ['pieces', 'd3mean', 'd3worst', 'deepestCm']);
