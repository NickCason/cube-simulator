// Replay a ?stats report (v2): the scene as it was when its log starts (or at --from t),
// then every touch / click / drag on the canvas at the same times and screen places, the
// tools picked, settings changed, re-cubes - while timing the physics as the overlay does.
// Prints its own slow frames beside the report's.
//   node scratch/replay.mjs report.txt [--from 158.0] [--to 175] [--port 5190] [--shots /tmp/rp]
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = opt('--port', process.env.PORT || 5190), SHOTS = opt('--shots', '');
const text = fs.readFileSync(file, 'utf8').split('\n');

// ---- the report's header and scene
const find = (re) => {
  for (const l of text) {
    const m = l.match(re);
    if (m) return m;
  }
  return null;
};
const ua = text[1] || '';
const mobile = /iPhone|iPad|Android|Mobile/.test(ua);
const scr = find(/screen (\d+)x(\d+)/), dprM = find(/dpr ([\d.]+)/);
const W = scr ? +scr[1] : 430, H = scr ? +scr[2] : 775, DPR = dprM ? +dprM[1] : 2;
const view = find(/^view: .*theme (\S+)\s+place (\S+)\s+room (\S+)\s+tearing (\S+)\s+tool (\S+)/);
const camF = find(/^camera: (\S+) (\S+) (\S+) (\S+)/);
const cubesL = find(/^cubes \(\* selected\): (.*)$/);
const setL = find(/^settings: (.*)$/);
const finalCubes = new Map();
let selFinal = 0;
if (cubesL)
  for (const part of cubesL[1].trim().split(/\s{2,}/)) {
    const m = part.match(/^(\*?)(\d+) (\S+)/);
    if (!m) continue;
    finalCubes.set(+m[2], m[3]);
    if (m[1]) selFinal = +m[2];
  }
const parseVal = (v) => (v === '-' ? undefined : v === 'true' ? true : v === 'false' ? false : Number.isFinite(+v) ? +v : v);
const finalSet = {};
if (setL && !setL[1].startsWith('(')) for (const kv of setL[1].split(' ')) {
  const i = kv.indexOf('=');
  if (i > 0) finalSet[kv.slice(0, i)] = parseVal(kv.slice(i + 1));
}

// ---- the log
const log = [];
let inLog = false;
for (const l of text) {
  if (l.startsWith('log (')) { inLog = true; continue; }
  if (l.startsWith('slow / eventful')) { inLog = false; continue; }
  if (!inLog) continue;
  const m = l.match(/^\s*([\d.]+) (\S+)\s?(.*)$/);
  if (m) log.push({ t: +m[1], kind: m[2], rest: m[3] });
}
if (!log.length) throw new Error('no log in the report (a v2 report from ?stats is needed)');
// where to start: given, or the last re-cube's end (or the log's start) before the first big slow frame
let from = opt('--from', null);
if (from === null) {
  const firstSlow = log.find((e) => e.kind === 'SLOW' && /phys (\d+)/.test(e.rest) && +e.rest.match(/phys (\d+)/)[1] > 30);
  const lim = firstSlow ? firstSlow.t : log[log.length - 1].t;
  from = log[0].t;
  for (const e of log) if (e.t <= lim && ((e.kind === 'recube' && e.rest === 'end') || e.kind === 'start')) from = e.t;
}
from = +from;
const to = +opt('--to', log[log.length - 1].t + 1);

// ---- the scene as it was at `from`: the final one with what changed since undone
const set = { ...finalSet }, cubes = new Map(finalCubes);
let theme = view ? view[1] : 'light', place = view ? view[2] : null, tool = view ? view[5] : 'hand', sel = selFinal;
let camStart = camF ? camF.slice(1, 5).join(' ') : null;
for (let i = log.length - 1; i >= 0; i--) {
  const e = log[i];
  if (e.t < from) break;
  if (e.kind === 'set') {
    const m = e.rest.match(/^(\S+) (\S+) -> (\S+)$/);
    if (m) set[m[1]] = parseVal(m[2]);
  } else if (e.kind === 'cube') {
    const m = e.rest.match(/^(\d+) (\S+) -> (\S+)$/);
    if (m) (m[2] === 'new' ? cubes.delete(+m[1]) : cubes.set(+m[1], m[2]));
  }
}
for (const e of log) {
  if (e.t > from) break;
  if (e.kind === 'tool') tool = e.rest;
  if (e.kind === 'cam') camStart = e.rest;
  if (e.kind === 'theme') theme = e.rest;
  if (e.kind === 'place') place = e.rest;
  if (e.kind === 'sel') sel = +e.rest;
  if (e.kind === 'start') {
    const m = e.rest.match(/cam (.*)$/);
    if (m) camStart = m[1];
  }
}
console.log(`replay ${file}: ${W}x${H} dpr ${DPR} ${mobile ? 'touch' : 'mouse'}, from ${from}s to ${to}s, ${cubes.size} cube(s), tool ${tool}`);

// ---- go
const browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Math.min(DPR, 2), isMobile: mobile, hasTouch: mobile });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${PORT}/?nosplash`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__app && window.__app.intro.done, null, { timeout: 90000, polling: 300 });
await page.evaluate(
  async ([cubes, set, theme, place, sel]) => {
    localStorage.clear();
    const a = __app, { decodeCube } = await import('/src/cubecode.js');
    const list = [...cubes].sort((p, q) => p[0] - q[0]);
    if (list.length) a.loadCube(decodeCube(list[0][1]));
    for (const [, code] of list.slice(1)) a.addCube(decodeCube(code), { drop: false });
    for (const k in set) if (set[k] !== undefined && k !== 'tear') a.setSetting(k, set[k]);
    if (theme && a.theme !== theme) a.setTheme(theme, false);
    if (place && place !== 'null' && a.place !== place) a.setPlace(place, false);
    const idx = list.findIndex((c) => c[0] === sel);
    if (idx > 0) a.selectCube(a.cubes[idx]?.slot ?? sel);
  },
  [[...cubes], set, theme, place, sel],
);
const setCam = (c) =>
  page.evaluate((c) => {
    const [th, ph, r, tg] = c.split(' '), a = __app, [tx, ty, tz] = tg.split(',').map(Number);
    for (const o of [a.orbit, a.orbitGoal]) {
      o.theta = +th; o.phi = +ph; o.radius = +r;
      if (o.target) o.target.set(tx, ty, tz);
    }
  }, c);
await page.waitForTimeout(2500);
if (camStart) await setCam(camStart.split(' ').slice(0, 4).join(' '));
await page.evaluate((t) => __app.setTool(t), tool);
await page.waitForTimeout(800);

// the physics timed as the overlay does (SoftBody.profT), its slow frames kept
await page.evaluate(async () => {
  const { PROF_PHASES } = await import('/src/sim/softbody.js');
  const a = __app, PT = new Float64Array(PROF_PHASES.length), out = (window.__rp = { t0: performance.now(), slow: [], frames: 0 });
  const frame = a.frame.bind(a);
  let last = 0;
  a.frame = (dt) => {
    if (a.sb.profT !== PT) a.sb.profT = PT;
    PT.fill(0);
    const st = performance.now(), gap = last ? st - last : 16.7;
    last = st;
    frame(dt);
    out.frames++;
    const phys = a.stats.physLast;
    if (gap > 45 || phys > 30) {
      const parts = [];
      for (let k = 0; k < PROF_PHASES.length - 1; k++) if (PT[k] >= 1) parts.push([PROF_PHASES[k], Math.round(PT[k])]);
      parts.sort((p, q) => q[1] - p[1]);
      out.slow.push(`${((st - out.t0) / 1000).toFixed(2)} ${Math.round(gap)}ms phys ${Math.round(phys)} = ${parts.map((p) => p.join(' ')).join(' ')} | ${PT[PROF_PHASES.length - 1]} sub, ${a.sb.pieces.length} pcs, ${a.sb.nT} tets`);
    }
  };
});

// ---- the events, on their times
const cdp = mobile ? await ctx.newCDPSession(page) : null;
const touches = new Map(); // id -> [x, y] (px)
const px = (x, y) => [x * W, y * H];
const sendTouch = async (type) => {
  const tp = [...touches].map(([id, [x, y]]) => ({ x, y, id: id % 1000, radiusX: 4, radiusY: 4, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: tp.length || type === 'touchEnd' ? type : 'touchEnd', touchPoints: type === 'touchEnd' ? [] : tp });
};
const sched = [];
for (const e of log) {
  if (e.t < from || e.t > to) continue;
  if (e.kind === 'move') {
    const [id, ...ss] = e.rest.split(' ');
    for (const s of ss) {
      const [ms, xy] = s.split(':'), [x, y] = xy.split(',').map(Number);
      sched.push({ t: e.t + +ms / 1000, kind: 'move1', id: +id, x, y });
    }
  } else sched.push(e);
}
sched.sort((p, q) => p.t - q.t);
const t0 = Date.now();
const notes = [];
for (const e of sched) {
  const wait = (e.t - from) * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  const r = e.rest || '';
  if (e.kind === 'tool') await page.evaluate((t) => __app.setTool(t), r);
  else if (e.kind === 'down') {
    const [id, type, x, y] = r.split(' ');
    const [X, Y] = px(+x, +y);
    if (cdp && type !== 'mouse') {
      touches.set(+id, [X, Y]);
      await sendTouch('touchStart');
    } else {
      await page.mouse.move(X, Y);
      await page.mouse.down();
    }
  } else if (e.kind === 'move1') {
    const [X, Y] = px(e.x, e.y);
    if (cdp && touches.has(e.id)) {
      touches.set(e.id, [X, Y]);
      await sendTouch('touchMove');
    } else if (!cdp) await page.mouse.move(X, Y);
  } else if (e.kind === 'up' || e.kind === 'cancel') {
    const [id] = r.split(' ');
    if (cdp && touches.has(+id)) {
      touches.delete(+id);
      await sendTouch(touches.size ? 'touchMove' : 'touchEnd');
    } else if (!cdp) await page.mouse.up();
  } else if (e.kind === 'wheel') await page.mouse.wheel(0, +r);
  else if (e.kind === 'cam' && !touches.size) await setCam(r);
  else if (e.kind === 'set') {
    const m = r.match(/^(\S+) (\S+) -> (\S+)$/);
    if (m && m[1] !== 'tear') await page.evaluate(([k, v]) => __app.setSetting(k, v), [m[1], parseVal(m[3])]);
  } else if (e.kind === 'recube' && r === 'start') await page.evaluate(() => __app.heal());
  else if (e.kind === 'theme') await page.evaluate((t) => __app.setTheme(t, false), r);
  else if (e.kind === 'place') await page.evaluate((t) => __app.setPlace(t, false), r);
  else if (e.kind === 'MARK') notes.push(`${e.t.toFixed(2)} MARK`);
  else if (e.kind === 'topo') {
    const got = await page.evaluate(() => `${__app.sb.pieces.length} pieces ${__app.sb.nT} tets`);
    notes.push(`${e.t.toFixed(2)} topo: report ${r.replace(/ \[.*\]$/, '')}  here ${got}`);
  } else if (e.kind === 'SLOW') notes.push(`${e.t.toFixed(2)} report SLOW ${r}`);
  if (SHOTS && (e.kind === 'MARK' || (e.kind === 'SLOW' && /phys (\d+)/.test(r) && +r.match(/phys (\d+)/)[1] > 100)))
    await page.screenshot({ path: `${SHOTS}-${e.t.toFixed(1)}.png` });
}
await page.waitForTimeout(1500);
const rp = await page.evaluate(() => window.__rp);
console.log('-- the report, over the replayed span:');
console.log(notes.join('\n') || '(nothing)');
console.log(`-- here (${rp.frames} frames; t from the replay's start, ${from}s in the report):`);
console.log(rp.slow.map((s) => {
  const [t, ...rest] = s.split(' ');
  return `${(+t + from).toFixed(2)} ${rest.join(' ')}`;
}).join('\n') || '(no slow frames)');
console.log(errs.join(' | ') || 'no errors');
await browser.close();
