// a session on a phone-sized touch screen with ?stats - tap to dice, drag a piece about with a finger,
// Mark - and its report saved (for replay.mjs to replay)
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/report.txt';
const browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const ctx = await browser.newContext({ viewport: { width: 430, height: 775 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5190/?nosplash&stats', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__app && window.__app.intro.done && window.__statsReport, null, { timeout: 90000, polling: 300 });
await page.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(page);
const touch = (type, ps) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: ps.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
const scr = (x, y, z) => page.evaluate(([x, y, z]) => { const a = __app, V = a.camera.position.constructor, v = new V(x, y, z).project(a.camera); return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]; }, [x, y, z]);
// pick the dicer from the dock, as a person would
await page.evaluate(() => document.querySelector('.tool[data-id="dicer"], .tools button[data-id="dicer"]')?.click() || __app.setTool('dicer'));
const c = await scr(0, 0.5, 0);
await touch('touchStart', [c]); await page.waitForTimeout(60); await touch('touchEnd', []);
await page.waitForFunction(() => __app.sb.pieces.length >= 8 && !__app.tools.dicer.job, null, { timeout: 20000, polling: 200 });
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('.tool[data-id="hand"], .tools button[data-id="hand"]')?.click() || __app.setTool('hand'));
const g = await page.evaluate(() => { let b = null; for (const p of __app.sb.pieces) if (!b || p.com[1] > b.com[1]) b = p; return b.com; });
const p0 = await scr(g[0], g[1], g[2]);
await touch('touchStart', [p0]);
for (let k = 0; k < 70; k++) {
  const a = k * 0.13;
  await touch('touchMove', [[p0[0] + Math.cos(a) * 90, p0[1] + 40 + Math.sin(a) * 60]]);
  await page.waitForTimeout(40);
  if (k === 40) await page.evaluate(() => document.querySelector('.stats .mark')?.click());
}
await touch('touchEnd', []);
await page.waitForTimeout(1200);
const rep = await page.evaluate(() => window.__statsReport());
fs.writeFileSync(OUT, rep);
const lines = rep.split('\n');
console.log(lines.slice(0, 12).join('\n'));
console.log('...', lines.length, 'lines,', rep.length, 'chars; log lines:', lines.filter((l) => /^\s*\d+\.\d+ /.test(l)).length);
console.log(lines.filter((l) => / (down|up|tool|topo|MARK|recube) /.test(l)).slice(0, 12).join('\n'));
console.log(errs.join(' | ') || 'no errors');
await browser.close();
