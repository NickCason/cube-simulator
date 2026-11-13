// "Go wild": a cube full of liquid with glitter (as he tests it on ?stats), shaken by its top, squeezed, sliced,
// shot, its pieces shaken - each frame timed, and its parts (the sim's step, the liquid, glitter, bubbles,
// spill, particles, the render and the jelly's drawing). --cpu 4 for about a phone's CPU. ms per frame.
import { table } from './_common.mjs';
export const meta = { name: 'perf', params: { cube: 'aqua', fill: 1, glitter: 'holo', fps: 60, settle: 90 } };
const SHAKE = [[-40, 0], [-80, -10], [-40, 0], [0, 0], [40, 0], [80, -10], [40, 0], [0, 0], [0, -40], [0, -80], [0, -40], [0, 0]];
export async function run(k, p) {
  k.dt = 1 / p.fps;
  await k.load(p.cube, { liqFill: p.fill }, { settle: p.settle });
  if (p.glitter) await k.app((a, g) => a.setGlitter(g), p.glitter);
  await k.frames(30);
  await k.app(() => window.__kit.perfStart());
  await k.drag([0.5, 0.1], SHAKE, 3);
  await k.frames(20);
  await k.touch2([0.2, 0.5], [0.8, 0.5], Array.from({ length: 12 }, () => [4, 0, -4, 0]), 2);
  await k.frames(20);
  await k.knife([0.47, -0.25], [0.53, 1.25]);
  await k.frames(40);
  await k.shoot('holegun', [0.3, 0.55]);
  await k.frames(30);
  await k.drag([0.75, 0.3], SHAKE, 3);
  await k.frames(60);
  const r = await k.app(() => window.__kit.perfStop());
  return { frames: r.frames, ...Object.fromEntries(Object.entries(r.parts).map(([q, v]) => [q, v])), worst: r.worst };
}
const f = (v) => (v ? `${v.mean}/${v.p90}/${v.max}` : '-');
export const row = (r) => `${r.frames} frames | ms mean/p90/max: frame ${f(r.total)} | sim ${f(r.sim)} | liquid ${f(r.liquid)} | glitter ${f(r.glitterPool)}+${f(r.glitter)} | bubbles ${f(r.bubblesPool)} | render ${f(r.render)} (jelly ${f(r.jellyView)})`;
export const summary = (all) => table(all, [(r) => `frame ${f(r.total)}`, (r) => `sim ${f(r.sim)}`, (r) => `liquid ${f(r.liquid)}`, (r) => `glitter ${f(r.glitterPool)}`, (r) => `render ${f(r.render)}`]);
