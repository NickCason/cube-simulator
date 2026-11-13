// The test kit: a phone-sized, seeded, headless page on a build, and what every harness did by hand - load a
// cube, change its settings, step frames, point the camera, cut/drag/pull/tap the way a finger does, take
// pictures with the liquid or the jelly hidden, and measure (probes.js, injected as window.__kit).
//
//   import { open } from './kit.mjs';
//   const k = await open({ build: 'work', seed: 1 });
//   await k.load('fluorescent', { liqFill: 1 });
//   await k.knife([-0.25, 0.6], [0.6, -0.25]);
//   await k.frames(18);
//   console.log(await k.probe('cutDiag'));
//   await k.shot('/tmp/gs/x.png', { skip: { jelly: true } });
//   await k.close();
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './builds.mjs';
import { CUBES } from './cubes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBES = readFileSync(join(HERE, 'probes.js'), 'utf8');
const ARGS = ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];

// One browser for a whole run (pages are cheap, launches aren't)
let shared = null;
async function browserOnce() {
  if (!shared) shared = await chromium.launch({ args: ARGS, headless: true });
  return shared;
}
export async function closeAll() {
  if (shared) await shared.close();
  shared = null;
}

// open({ build, seed, theme, viewport, dpr, cpu, query, manual })
//  build: 'work' | 'head' | a ref - served on its own port (builds.mjs)
//  seed: Math.random seeded (null: the real one)      theme: 'light' | 'dark'
//  cpu: Chrome's CPU throttle (4 = about a phone)       manual: the app's own loop off, stepped by frames()
export async function open(o = {}) {
  const { build = 'work', seed = 1, theme = 'light', viewport = [390, 664], dpr = 1, cpu = 1, query = '', manual = true } = o;
  const b = await serve(build);
  const browser = await browserOnce();
  const ctx = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: dpr, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((t) => localStorage.setItem('cube-sim-theme', t), theme);
  if (seed !== null)
    await page.addInitScript((s) => {
      let a = s >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, seed);
  await page.addInitScript(PROBES);
  await page.goto(`http://localhost:${b.port}/?nosplash${query ? '&' + query : ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__app && window.__app.intro.done && !window.__app.intro.job, null, { timeout: 180000, polling: 300 });
  if (cpu > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  }
  if (manual) await page.evaluate(() => ((__app._loop = () => {}), (__app.opts.noidle = true)));
  return new Kit(page, ctx, errs, b, { dpr, seed });
}

class Kit {
  constructor(page, ctx, errs, build, o) {
    this.page = page;
    this.ctx = ctx;
    this.errs = errs;
    this.build = build;
    this.dpr = o.dpr;
    this.seed = o.seed;
    this.dt = 1 / 30; // (a frame's time, stepped by frames(): 1/60 as a phone runs)
    this._box = null;
  }
  async close() {
    await this.ctx.close();
  }
  // (fn(app, arg) in the page)
  app(fn, arg) {
    return this.page.evaluate(([src, arg]) => new Function('a', 'arg', `return (${src})(a, arg)`)(window.__app, arg), [fn.toString(), arg]);
  }
  probe(name, arg) {
    return this.page.evaluate(([n, arg]) => window.__kit[n](arg), [name, arg]);
  }
  frames(n = 1, dt = this.dt) {
    return this.page.evaluate(([n, dt]) => window.__kit.frames(n, dt), [n, dt]);
  }

  // A cube: a name from cubes.mjs ('plain', 'aqua', 'fluorescent', ...) or a share code; then settings - any
  // Settings key (liquid, liqFill, liqSkin, bubbles, rigidity, gravity, faces, ...) - and style (texture, color,
  // edges, trim, place). Settled by `settle` frames.
  async load(cube = 'plain', settings = {}, o = {}) {
    const code = CUBES[cube] || cube;
    await this.page.evaluate(([code]) => window.__kit.load(code), [code]);
    await this.set(settings);
    if (o.place) await this.app((a, p) => a.setPlace(p, false), o.place);
    await this.frames(o.settle ?? 60);
    this._box = null;
  }
  set(settings = {}) {
    return this.page.evaluate((s) => window.__kit.set(s), settings);
  }
  style(s = {}) {
    return this.page.evaluate((s) => window.__kit.style(s), s);
  }

  // The camera: { theta, phi, radius, target } as the orbit has them, or face: '+z' (square on to that face of
  // the cube as it stands), and it's drawn
  async camera(c = {}) {
    await this.page.evaluate((c) => window.__kit.camera(c), c);
    this._box = null;
  }
  // (the cube's box on the screen, CSS px; a point in it: [u, v] across and down, 0..1)
  async box() {
    if (!this._box) this._box = await this.probe('screenBox');
    return this._box;
  }
  async at(u, v) {
    const b = await this.box();
    return [b.x0 + u * (b.x1 - b.x0), b.y0 + v * (b.y1 - b.y0)];
  }

  // Gestures, the way a finger makes them: points [u, v] in the cube's screen box
  async knife(from, to, steps = 12) {
    await this.app((a) => a.setTool('knife'));
    const [ax, ay] = await this.at(...from), [bx, by] = await this.at(...to);
    await this.page.mouse.move(ax, ay);
    await this.page.mouse.down();
    await this.page.mouse.move(bx, by, { steps });
    await this.page.mouse.up();
    await this.frames(4);
    this._box = null;
  }
  // (one hand: hold at p, moved through offsets [dx, dy] px, frames each, then let go)
  async drag(p, path, each = 2, tool = 'hand') {
    await this.app((a, t) => a.setTool(t), tool);
    const [x, y] = await this.at(...p);
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.frames(2);
    for (const [dx, dy] of path) {
      await this.page.mouse.move(x + dx, y + dy);
      await this.frames(each);
    }
    await this.page.mouse.up();
    this._box = null;
  }
  // (two fingers: at a and b, each moved by its own offsets per step, frames each - pulled apart, squeezed)
  async touch2(a, b, steps, each = 2, tool = 'hand') {
    await this.app((a, t) => a.setTool(t), tool);
    let [ax, ay] = await this.at(...a), [bx, by] = await this.at(...b);
    const ptr = (type, id, x, y) => this.page.evaluate(([type, id, x, y]) => window.__kit.pointer(type, id, x, y), [type, id, x, y]);
    await ptr('pointerdown', 1, ax, ay);
    await this.frames(1);
    await ptr('pointerdown', 2, bx, by);
    await this.frames(2);
    for (const [dax, day, dbx, dby] of steps) {
      ax += dax; ay += day; bx += dbx; by += dby;
      await ptr('pointermove', 1, ax, ay);
      await ptr('pointermove', 2, bx, by);
      await this.frames(each);
    }
    await ptr('pointerup', 1, ax, ay);
    await ptr('pointerup', 2, bx, by);
    this._box = null;
  }
  // (a tool's tap: the dicer, a gun - at [u, v], or the cube's middle)
  async tap(tool, p = null) {
    await this.app((a, t) => a.setTool(t), tool);
    const [x, y] = p ? await this.at(...p) : await this.probe('screenOf', [0, 0.5, 0]);
    await this.page.evaluate(([x, y]) => (window.__kit.pointer('pointerdown', 1, x, y), window.__kit.pointer('pointerup', 1, x, y)), [x, y]);
    this._box = null;
  }
  async shoot(gun = 'holegun', p = [0.5, 0.55]) {
    await this.app((a, t) => a.setTool(t), gun);
    const [x, y] = await this.at(...p);
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.frames(3);
    await this.page.mouse.up();
    this._box = null;
  }
  // (a piece - 'small' or 'big', or its index - taken by hand where it is and pulled by [dx, dy] px over n steps)
  async pull(which = 'small', [dx, dy] = [-140, -70], n = 12) {
    await this.app((a) => a.setTool('hand'));
    const [x, y] = await this.probe('pieceScreen', which);
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    for (let k = 1; k <= n; k++) {
      await this.page.mouse.move(x + (dx * k) / n, y + (dy * k) / n);
      await this.frames(2);
    }
    await this.page.mouse.up();
    this._box = null;
  }

  // A picture (dpr as opened): skip { liquid, jelly } hides them for it; crop [x0, y0, x1, y1] in its pixels
  async shot(path, o = {}) {
    mkdirSync(dirname(path), { recursive: true });
    await this.page.evaluate((s) => window.__kit.skip(s), o.skip || {});
    const clip = o.crop ? { x: o.crop[0] / this.dpr, y: o.crop[1] / this.dpr, width: (o.crop[2] - o.crop[0]) / this.dpr, height: (o.crop[3] - o.crop[1]) / this.dpr } : undefined;
    await this.page.screenshot({ path, clip });
    await this.page.evaluate(() => window.__kit.skip({}));
    return path;
  }
}

export { CUBES };
