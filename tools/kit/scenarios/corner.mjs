// A corner edge sliced off a cube full of liquid (pull: the wedge taken away by hand): its pieces' fits and the
// liquid's labels (cutDiag), its surface out past the jelly's box, and in the jelly - 3 frames on and 18.
import { cut, table } from './_common.mjs';
export const meta = { name: 'corner', params: { cube: 'fluorescentFilled', skin: 0, pull: 1 } };
export async function run(k, p) {
  await k.load(p.cube, { liqSkin: p.skin }, { settle: 150 });
  await cut(k, p.pull ? 'corner' : 'cornerCut');
  await k.frames(3);
  const a = { ...(await k.probe('outside')), diag: await k.probe('cutDiag') };
  await k.frames(15);
  const b = { ...(await k.probe('outside')), diag: await k.probe('cutDiag') };
  const own = (d) => (d.labels['1'] || 0) / Math.max(1, d.surface);
  return { pieces: b.diag.pieces.join('/'), walls: b.diag.walls.length, ownPct3: Math.round(100 * own(a.diag)), ownPct18: Math.round(100 * own(b.diag)), past3: a.past, past18: b.past, worstCm18: b.worstCm, surface18: b.surface };
}
export const row = (r) => `pieces ${r.pieces}, walled ${r.walls} | liquid its own ${r.ownPct3}% -> ${r.ownPct18}% | past the jelly's box ${r.past3} -> ${r.past18} (worst ${r.worstCm18} cm) | surface ${r.surface18}`;
export const summary = (all) => table(all, ['walls', 'ownPct18', 'past18', 'surface18']);
