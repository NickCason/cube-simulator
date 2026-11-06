import { chromium } from 'playwright';
const [url = 'http://localhost:5190/?shot', out = 'shots/a.png', wait = '5000', script = ''] = process.argv.slice(2);
const gpu = process.env.GPU === '1';
const args = gpu
  ? ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-webgpu']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args, headless: true });
const page = await browser.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 800) }, deviceScaleFactor: +(process.env.DPR || 1) });
page.on('console', (m) => { if (m.type() !== 'debug') console.log('[console]', m.type(), m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(+wait);
if (script) {
  const r = await page.evaluate(script);
  if (r !== undefined) console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r));
  await page.waitForTimeout(+(process.env.AFTER || 1500));
}
const info = await page.evaluate(() => {
  const a = window.__app;
  if (!a) return 'no app';
  const gl = a.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { frames: a.stats.frames, physMs: +a.stats.physMs.toFixed(2), frameMs: +a.stats.frameMs.toFixed(2), gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?', pieces: a.sb.pieces.length, nT: a.sb.nT };
});
console.log('[info]', JSON.stringify(info));
await page.screenshot({ path: out });
await browser.close();
