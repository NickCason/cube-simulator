// Drop, the exhibition mode, as he'd play it: Exhibit -> Drop, its height, Drop (up on the hook), a tap to let it go,
// and the fall - the hook's way up, how it hangs (stretched), the fall's fastest and as it hit, how squashed and
// spread by the air (its box: wide over tall, most), its liquid out of it falling, the camera on it (its middle on
// the screen, worst), the time to land; pictures (pics=1) going up, hanging, falling, hitting, after.
import { join } from 'node:path';
export const meta = { name: 'drop', dpr: 1, params: { cube: 'plain', height: 15, pics: 0, maxFrames: 900 } };
export async function run(k, p, ctx) {
  k.dt = 1 / 30;
  await k.load(p.cube, {}, { settle: 60 });
  const page = k.page, shots = [];
  const shot = async (tag) => p.pics && shots.push(await k.shot(join(ctx.out, `drop-${ctx.build}-s${ctx.seed}-${p.cube}-${tag}.png`)));
  // (through the UI: the dock's Exhibit, its card's Drop)
  await page.click('.exhibit-btn');
  await page.click('.ex-mode[data-mode="drop"]');
  await page.evaluate((h) => { const i = document.querySelector('.db-h input'); i.value = String(h); i.dispatchEvent(new Event('input')); }, p.height);
  await page.click('.db-go');
  const look = () => k.app((a) => {
    const D = a.drop, sb = a.sb, pc = D._piece()?.pc, fl = a.fluid;
    if (!pc) return { phase: D.phase };
    const b = pc.bbox, w = Math.max(b[3] - b[0], b[5] - b[2]), h = b[4] - b[1];
    // (its liquid out of its box, more than 5 cm)
    let out = 0;
    for (let i = 0; i < fl.n; i++) { const x = fl.x[i * 3], y = fl.x[i * 3 + 1], z = fl.x[i * 3 + 2]; if (x < b[0] - 0.05 || x > b[3] + 0.05 || y < b[1] - 0.05 || y > b[4] + 0.05 || z < b[2] - 0.05 || z > b[5] + 0.05) out++; }
    // (its middle on the screen: 0 the middle, 1 the edge)
    const v = new a.camera.position.constructor(pc.com[0], pc.com[1], pc.com[2]).project(a.camera);
    return { phase: D.phase, y: +pc.com[1].toFixed(2), alt: +D.alt.toFixed(2), v: +D.speed.toFixed(1), wh: +(w / Math.max(1e-6, h)).toFixed(2), h: +h.toFixed(2), out, drops: fl.n, scr: +Math.max(Math.abs(v.x), Math.abs(v.y)).toFixed(2) };
  });
  const R = { liftFrames: 0, hangH: 0, peakV: 0, hitV: 0, maxWH: 0, minWHfall: 9, outFallMax: 0, scrWorst: 0, landFrames: 0, errors: 0 };
  let f = 0, s0 = null, tapped = false, fallAt = -1, pic = {};
  for (; f < p.maxFrames; f++) {
    await k.frames(1);
    const s = await look();
    if (!s0) s0 = s;
    if (s.phase === 'lift') R.liftFrames++;
    if (s.phase === 'lift' && !pic.lift && s.alt > p.height * 0.5) (pic.lift = 1), await shot('lift');
    if (s.phase === 'hang') {
      R.hangH = Math.max(R.hangH, s.h);
      if (!pic.hang && (pic.hang = (pic.hang || 0) + 1) && f % 1 === 0) await shot('hang');
      if (!tapped) {
        // (a moment hanging, then a tap anywhere)
        await k.frames(20);
        const [x, y] = [200, 300];
        await page.mouse.click(x, y);
        tapped = true;
      }
    }
    if (s.phase === 'fall') {
      if (fallAt < 0) fallAt = f;
      R.peakV = Math.max(R.peakV, s.v);
      R.outFallMax = Math.max(R.outFallMax, s.out);
      if (s.alt > 0.05) (R.minWHfall = Math.min(R.minWHfall, s.wh)), (R.maxWH = Math.max(R.maxWH, s.wh));
      R.scrWorst = Math.max(R.scrWorst, s.scr);
      if (!pic.fall && s.alt < p.height * 0.5) (pic.fall = 1), await shot('fall');
      if (!pic.low && s.alt < Math.max(2.5, p.height * 0.2)) (pic.low = 1), await shot('low');
      if (!pic.hit && s.alt < 0.03) (pic.hit = 1), await shot('hit');
    }
    if (s.phase === 'land') {
      R.landFrames = f - fallAt;
      await k.frames(30);
      await shot('after');
      break;
    }
  }
  R.hitV = await k.app((a) => +a.drop.hitV.toFixed(1));
  const ui = await page.evaluate(() => ({ bar: !document.querySelector('.drop-bar').hidden, go: document.querySelector('.db-go').textContent, read: document.querySelector('.db-read').textContent }));
  return { ...R, startWH: s0?.wh, frames: f, ui: `${ui.go} | ${ui.read}`, errs: k.errs.length, ...(shots.length ? { shots: shots.join(' ') } : {}) };
}
export const row = (r) => `lift ${r.liftFrames} frames, hung ${r.hangH} m tall | fall: peak ${r.peakV} m/s, hit ${r.hitV} | wide/tall ${r.startWH} at rest, ${r.minWHfall}..${r.maxWH} falling | liquid out falling ${r.outFallMax} | on screen worst ${r.scrWorst} | landed in ${r.landFrames} frames | bar: ${r.ui} | errors ${r.errs}`;
