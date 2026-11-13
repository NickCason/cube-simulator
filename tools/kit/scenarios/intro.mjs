// The first drop as he sees it: his cube saved, the page loaded afresh with the splash (cpu: the throttle, 4 ~ his
// phone), the app's own loop - when it's up, the reveal, the splash leaving, the drop; the liquid in it from when;
// the drop's frames (intervals: median, p95, max, the first few) and each part's ms in its first frames.
// prof=1: Chrome's profiler over the drop's first `secs` - the top functions by their own time.
import { table } from './_common.mjs';
export const meta = { name: 'intro', params: { cube: 'blueGold', cpu: 4, secs: 3, prof: 0, top: 30, parts: 0 } };
export async function run(k, p) {
  await k.load(p.cube, {}, { settle: 30 });
  await k.frames(10);
  const page = k.page, cdp = await k.ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  await page.addInitScript(() => {
    if (window.__ir) return;
    const R = (window.__ir = []), P = { cur: {} }, rows = (window.__ip = []);
    let wrapped = false;
    const wrap = (o, name, label) => {
      const f = o && o[name];
      if (typeof f !== 'function') return;
      o[name] = function (...args) { const t = performance.now(); try { return f.apply(this, args); } finally { P.cur[label] = (P.cur[label] || 0) + performance.now() - t; } };
    };
    const tick = () => {
      const a = window.__app, t = performance.now();
      if (a && !wrapped) {
        wrapped = true;
        wrap(a.sb, 'step', 'sb'); wrap(a.fluid, 'update', 'liquid'); wrap(a.fluid, 'stepPart', 'liquidPart'); wrap(a.fluid, '_remesh', 'surface');
        for (const m of ['_splat', '_splatWalls', '_splatCling', '_envelope', '_fillFull', '_march', '_clip', '_pushOut', '_snapWalls', '_frames', '_jellyCells', '_pressures', '_advance', '_contain', '_stillMark']) wrap(a.fluid, m, m);
        wrap(a.glitter, 'poolTick', 'glitter'); wrap(a.bubbles, 'poolTick', 'bubbles'); wrap(a, 'render', 'render'); wrap(a.spill, 'update', 'spill'); wrap(a.jelly, 'update', 'jellyView'); wrap(a, 'frame', 'frame');
      }
      R.push([t, a ? 1 : 0, a?.splash ? (a.splash.goAt ? 1 : 0) + (a.splash.leaving ? 2 : 0) : 0, a?.intro.done ? 1 : 0, a ? a.fluid.n : 0]);
      if (a) rows.push({ done: a.intro.done ? 1 : 0, ...Object.fromEntries(Object.entries(P.cur).map(([q, v]) => [q, +v.toFixed(1)])) });
      P.cur = {};
      if (R.length < 4000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`http://localhost:${k.build.port}/?splash`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__app && window.__app.intro.done, null, { timeout: 120000, polling: 100 });
  let prof = null;
  if (p.prof) prof = await k.profile(() => page.waitForTimeout(p.secs * 1000), p.top);
  else await page.waitForTimeout(p.secs * 1000);
  await page.waitForTimeout(400);
  const [R, PR] = await page.evaluate(() => [window.__ir, window.__ip]);
  await cdp.detach();
  const t0 = R[0][0], at = (f) => { const e = R.find(f); return e ? +((e[0] - t0) / 1000).toFixed(2) : null; };
  const d0 = R.findIndex((e) => e[3]), d1 = R.findIndex((e) => e[0] > R[d0][0] + p.secs * 1000);
  const drop = R.slice(d0, d1 < 0 ? undefined : d1), iv = drop.slice(1).map((e, i) => e[0] - drop[i][0]), s = [...iv].sort((a, b) => a - b);
  const q0 = PR.findIndex((r) => r.done), first = PR.slice(q0, q0 + 6).map(({ done, ...r }) => r);
  return {
    up: at((e) => e[1]), go: at((e) => e[2] & 1), leaves: at((e) => e[2] & 2), drops: at((e) => e[3]), liquidAt: at((e) => e[4] > 0),
    frames: iv.length, median: Math.round(s[s.length >> 1]), p95: Math.round(s[Math.floor(s.length * 0.95)]), max: Math.round(s[s.length - 1]), firstMs: iv.slice(0, 5).map(Math.round), first, ...(prof ? { prof } : {}),
  };
}
export const row = (r) =>
  `up ${r.up} s, splash leaves ${r.leaves}, drops ${r.drops}, liquid in from ${r.liquidAt} | the drop: ${r.frames} frames, ms median ${r.median} p95 ${r.p95} max ${r.max}, first ${r.firstMs.join(' ')}\n` +
  r.first.map((f, i) => `     frame ${i}: ${Object.entries(f).map(([q, v]) => `${q} ${v}`).join(', ')}`).join('\n') +
  (r.prof ? '\n' + r.prof.top.map((t) => `     ${String(t.pct).padStart(5)}%  ${String(t.ms).padStart(7)} ms  ${t.fn}  ${t.at}`).join('\n') : '');
export const summary = (all) => table(all, ['leaves', 'liquidAt', 'median', 'p95', 'max']);
