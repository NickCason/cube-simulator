// Bubbles riding a cube full of liquid: against its liquid's drawn surface and the hollow's walls - settled, and
// (slosh: frames) while it's poked about, the worst frame.
import { table } from './_common.mjs';
export const meta = { name: 'bubbles', params: { cube: 'plain', skin: 0, fill: 1, count: 146, size: 1.729, wait: 240, slosh: 0 } };
export async function run(k, p) {
  await k.load(p.cube, { liquid: 0 }, { settle: 10 });
  await k.set({ bubbles: p.count, bubbleSize: p.size, liqSkin: p.skin, liquid: 1, liqFill: p.fill });
  await k.frames(p.wait);
  const rest = await k.probe('bubbles');
  if (!p.slosh) return { ...rest };
  let worst = { pokeOut: 0, worstOutCm: 0, inWall: 0 };
  for (let f = 0; f < p.slosh; f++) {
    await k.app((a, f) => { if (f % 10 === 0) a.sb.impulse(0, 0.6, 0, 0.8 * Math.cos(f), -1, 0.8 * Math.sin(f), 3, 0.5); a.frame(1 / 30); a.render(); }, f);
    const b = await k.probe('bubbles');
    worst = { pokeOut: Math.max(worst.pokeOut, b.pokeOut), worstOutCm: Math.max(worst.worstOutCm, b.worstOutCm), inWall: Math.max(worst.inWall, b.inWall) };
  }
  return { ...rest, sloshPokeOut: worst.pokeOut, sloshWorstOutCm: worst.worstOutCm, sloshInWall: worst.inWall };
}
export const row = (r) => `bubbles ${r.n} | out of the liquid ${r.pokeOut} (worst ${r.worstOutCm} cm) | in the wall ${r.inWall}` + (r.sloshPokeOut !== undefined ? ` | sloshing: out ${r.sloshPokeOut} (${r.sloshWorstOutCm} cm), in the wall ${r.sloshInWall}` : '');
export const summary = (all) => table(all, ['pokeOut', 'inWall', 'sloshPokeOut', 'sloshWorstOutCm']);
