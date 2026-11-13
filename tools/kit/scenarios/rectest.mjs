// His Rec test's workload as a perf test: his cube (blueGold: Water, gold glitter, 146 bubbles, ultrathin, full)
// wobbled as ?stats' Rec test does it - every 15 frames each point given 0.15 m/s up or down by sin(6x + 7t), all
// woken - `secs` long, stepped as a phone runs (fps), each frame and its parts timed (ms; --cpu 4 for about his
// phone). prof=1: Chrome's profiler over it too - the top functions by their own time.
import { table } from './_common.mjs';
export const meta = { name: 'rectest', params: { cube: 'blueGold', secs: 8, fps: 30, settle: 90, prof: 0, top: 25 } };
export async function run(k, p) {
  k.dt = 1 / p.fps;
  await k.load(p.cube, {}, { settle: p.settle });
  const n = Math.round(p.secs * p.fps);
  const go = async () => {
    await k.app(() => window.__kit.perfStart());
    for (let f = 0; f < n; f += 15)
      await k.app((a, [f, m, dt]) => {
        for (let j = 0; j < m; j++) {
          if ((f + j) % 15 === 0) {
            const sb = a.sb, t = a.clock.t;
            for (let i = 0; i < sb.nV; i++) sb.v[i * 3 + 1] += 0.15 * Math.sin(sb.x[i * 3] * 6 + t * 7);
            sb.wakeAll();
          }
          a.frame(dt);
        }
      }, [f, Math.min(15, n - f), k.dt]);
    return await k.app(() => window.__kit.perfStop());
  };
  let r, prof = null;
  if (p.prof) {
    let out;
    prof = await k.profile(async () => (out = await go()), p.top);
    r = out;
  } else r = await go();
  return { frames: r.frames, ...r.parts, worst: r.worst, ...(prof ? { prof } : {}) };
}
const f = (v) => (v ? `${v.mean}/${v.p90}/${v.max}` : '-');
export const row = (r) =>
  `${r.frames} frames | ms mean/p90/max: frame ${f(r.total)} | sim ${f(r.sim)} | liquid ${f(r.liquid)} | glitter ${f(r.glitterPool)}+${f(r.glitter)} | bubbles ${f(r.bubblesPool)} | render ${f(r.render)} (jelly ${f(r.jellyView)})` +
  (r.prof ? '\n' + r.prof.top.map((t) => `     ${String(t.pct).padStart(5)}%  ${String(t.ms).padStart(7)} ms  ${t.fn}  ${t.at}`).join('\n') : '');
export const summary = (all) => table(all, [(r) => `frame ${f(r.total)}`, (r) => `sim ${f(r.sim)}`, (r) => `liquid ${f(r.liquid)}`, (r) => `render ${f(r.render)}`]);
