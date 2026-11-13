// Pictures of a cube, the way he looks at it: from views ('+z/-x/...' square on to a face, 'app' as the app has
// it), each as skips ('all' / 'liquid' hidden / 'jelly' hidden), after a cut if any - and all of a run's tiled
// into one (tile.py). Files in the run's folder.
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cut } from './_common.mjs';
const TILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'tile.py');
export const meta = { name: 'look', dpr: 2, params: { cube: 'plain', views: '+z', skips: 'all', cut: 'none', place: 'diner', settle: 120, skin: -1, fill: -1, radius: 4, phi: 0.05 } };
export async function run(k, p, ctx) {
  const set = {};
  if (p.skin >= 0) set.liqSkin = p.skin;
  if (p.fill >= 0) set.liqFill = p.fill;
  await k.load(p.cube, set, { place: p.place, settle: p.settle });
  if (p.cut !== 'none') (await cut(k, p.cut), await k.frames(15));
  const files = [];
  for (const v of String(p.views).split('/')) {
    if (v !== 'app') await k.camera({ face: v, radius: p.radius, phi: p.phi });
    for (const s of String(p.skips).split('/')) {
      const f = join(ctx.out, `look-${ctx.build}-s${ctx.seed}-${p.cube}-${p.cut}-${v.replace(/[+]/, 'p').replace(/-/, 'm')}-${s}.png`);
      await k.shot(f, { skip: s === 'liquid' ? { liquid: true } : s === 'jelly' ? { jelly: true } : {} });
      files.push(f);
    }
  }
  const tile = join(ctx.out, `look-${ctx.build}-s${ctx.seed}-${p.cube}-${p.cut}.png`);
  execFileSync('python3', [TILE, tile, '--cols', String(String(p.skips).split('/').length), '--scale', '0.45', ...files]);
  return { files: files.length, tile };
}
export const row = (r) => `${r.files} pictures -> ${r.tile}`;
