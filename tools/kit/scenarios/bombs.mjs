// The cherry bombs, as he'd have them: n planted by tapping over the cube (taps off its sides land on the floor),
// then Boom from its button over the dock - the bomb in hand, or tool=hand: the hand by then. What the frames cost
// (the worst one, the blast's), the jelly blasted out, its pieces and blobs after, the fastest it moves, how much of
// it is still on the screen after; pictures (pics=1): planted, lit, the blast, after.
// A build without Boom (theirs went off by themselves 1.9 s after planting, six at most): planted the same and
// left to go - the time each one's blast took, for comparison.
import { join } from 'node:path';
import { table } from './_common.mjs';
import { CUBES } from '../kit.mjs';
export const meta = { name: 'bombs', dpr: 1, params: { cube: 'plain', n: 6, tool: 'bomb', desk: 0, pics: 0, after: 45, spread: 1, prof: 0, go: 'boom', warm: 1, trace: 0, cubes: 1 } };

export async function run(k, p, ctx) {
  const page = k.page;
  if (p.desk) (await page.setViewportSize({ width: 1440, height: 900 }), await k.frames(5));
  await k.load(p.cube, {}, { settle: 60 });
  // (cubes=2...: more in the room - go=remove takes the second away, bombs planted)
  if (p.cubes > 1) {
    await k.app(async (a, [n, code]) => {
      const m = await import('/src/cubecode.js');
      for (let i = 1; i < n; i++) a.addCube(m.decodeCube(code), { drop: false });
    }, [p.cubes, CUBES[p.cube] || p.cube]);
    await k.frames(60);
  }
  await k.app((a) => a.setTool('bomb'));
  await k.frames(2);
  const B = await k.box();
  // (taps: a grid over the cube's box on the screen; spread=1 a little past its sides - those land on the floor)
  const pts = [], cols = Math.ceil(Math.sqrt(p.n)), e = p.spread ? -0.08 : 0.15;
  for (let i = 0; i < p.n; i++) {
    const c = i % cols, r = Math.floor(i / cols) % cols;
    pts.push([B.x0 + (B.x1 - B.x0) * (e + (1 - 2 * e) * (c + 0.5) / cols), B.y0 + (B.y1 - B.y0) * (0.12 + 0.76 * (r + 0.5) / cols)]);
  }
  const tap = async ([x, y]) => (p.desk ? page.mouse.click(x, y) : page.touchscreen.tap(x, y));
  const look = () => k.app((a) => {
    const sb = a.sb, T = a.tools.bomb;
    let vol = 0, vmax = 0, on = 0, alive = 0;
    for (const pc of sb.pieces) vol += pc.volume || 0;
    const V3 = a.camera.position.constructor, v = new V3();
    for (let i = 0; i < sb.nV; i++) {
      if (!sb.alive[i]) continue;
      alive++;
      vmax = Math.max(vmax, Math.hypot(sb.v[i * 3], sb.v[i * 3 + 1], sb.v[i * 3 + 2]));
      v.set(sb.x[i * 3], sb.x[i * 3 + 1], sb.x[i * 3 + 2]).project(a.camera);
      if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) on++;
    }
    const row = document.querySelector('.bomb-row');
    return { bombs: T.bombs.length, queue: T.blasting?.length ?? 0, tool: T.__last || 0, crMs: T.__ms || 0, crN: T.__n || 0, onJelly: T.bombs.filter((b) => b.a1).length, lit: T.lit ?? -1, vol, pieces: sb.pieces.filter((pc) => pc && pc.verts.length).length, drops: a.droplets.items.length, vmax, on: alive ? on / alive : 0, row: row && !row.hidden ? 1 : 0, count: +(document.querySelector('.bomb-n')?.textContent || 0) };
  });
  // (a frame: the app's step - the sim, the tools, the blast - timed apart from its drawing, which a software GPU
  // makes slow and lumpy: shaders first used, compiled - the sim's what a phone feels here)
  const frame = () => page.evaluate((dt) => { const a = window.__app, t = performance.now(); a.frame(dt); const t1 = performance.now(); a.render(); return t1 - t; }, k.dt);
  const pic = async (tag) => p.pics && (await k.shot(join(ctx.out, `bombs-${ctx.build}-s${ctx.seed}-n${p.n}${p.desk ? '-desk' : ''}-${p.tool}-${tag}.png`)));
  // (warm=1: one bomb set off and the cube made again first - a software GPU's first blast spends seconds making
  // its shaders, on any build)
  if (p.warm) {
    await tap(pts[Math.floor(pts.length / 2)]);
    await frame();
    if ((await page.$('.bomb-go')) !== null) await k.app((a) => a.tools.bomb.detonate());
    for (let i = 0; i < 120; i++) { await frame(); if (i > 70 && !(await look()).bombs) break; }
    await k.app((a) => a.heal());
    for (let i = 0; i < 150; i++) await frame();
  }
  // (the bombs' own time, apart from drawing: the tool's update - where they go off, their craters made - frame by
  // frame, while any's going off)
  await k.app((a) => {
    const T = a.tools.bomb, f = T.update.bind(T);
    T.__ms = 0;
    T.__n = 0;
    T.update = (dt) => { const n0 = T.bombs.length + (T.blasting?.length || 0), t = performance.now(); f(dt); const ms = performance.now() - t; T.__last = ms; if (n0 > T.bombs.length + (T.blasting?.length || 0) || T.blasting?.length) T.__ms += ms; T.__n += Math.max(0, n0 - T.bombs.length - (T.blasting?.length || 0)); };
  });
  for (const q of pts) {
    await tap(q);
    await frame();
  }
  await k.frames(8);
  const s0 = await look();
  await pic('planted');
  const hasBoom = (await page.$('.bomb-go')) !== null;
  if (p.tool !== 'bomb') {
    await k.app((a, t) => a.setTool(t), p.tool);
    await k.frames(2);
  }
  const s1 = await look();
  const R = { planted: s0.bombs, onJelly: s0.onJelly, rowUp: s1.row, count: s1.count, boom: hasBoom ? 1 : 0, vol0: +s0.vol.toFixed(4) };
  // (go=boom: Boom tapped; enter: the Enter key; heal: Re-cube instead - they should fizzle, Boom's row go)
  if (hasBoom && p.go === 'boom') {
    // (a real tap where it is - it breathes, never still enough for Playwright's own tap)
    const bb = await page.$eval('.bomb-go', (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await tap(bb);
  } else if (p.go === 'enter') {
    await page.keyboard.press('Enter');
  } else if (p.go === 'heal' || p.go === 'remove') {
    if (p.go === 'heal') await k.app((a) => a.heal());
    else await k.app((a) => a.removeCube(a.cubes[a.cubes.length - 1].slot));
    for (let i = 0; i < 20; i++) await frame();
    const h = await look();
    await pic('healed');
    return { ...R, afterHeal: h.bombs, rowAfter: h.row, errors: k.errs.length, err: k.errs.slice(0, 2).join(' | ').slice(0, 200) };
  }
  // (to the blast and after it: each frame's time; the worst, and the blast's own)
  const trace = [];
  let worst = 0, blastMs = 0, blastSum = 0, blastF = -1, endF = -1, f = 0, last = s1, vmax = 0, booms = 0;
  // (prof=1: Chrome's profiler over the flare and the blast, to the last crater - the top functions by their own time)
  if (p.prof) {
    const pr = await k.profile(async () => { for (let i = 0; i < 40; i++) { await frame(); const q = await look(); if (!q.bombs && !q.queue && i > 10) break; } }, 25);
    return { prof: pr.top.map((t) => `${t.pct}% ${t.ms}ms ${t.fn} ${t.at}`).join('\n'), ms: pr.ms };
  }
  for (; f < 400; f++) {
    const ms = await frame();
    const s = await look();
    if (s.bombs < last.bombs) {
      booms++;
      if (blastF < 0) blastF = f;
      if (booms === 1) await pic('blast');
    }
    // (the blast's frames: from the first to go till the last crater's made)
    if (blastF >= 0 && endF < 0) {
      if (p.trace) trace.push(`${Math.round(ms)}/${Math.round(s.tool)}`);
      blastMs = Math.max(blastMs, ms);
      blastSum += ms;
      if (!s.bombs && !s.queue) endF = f;
    }
    if (f === 2) await pic('lit');
    if (blastF >= 0) vmax = Math.max(vmax, s.vmax);
    worst = Math.max(worst, ms);
    last = s;
    if (endF >= 0 && f - endF >= p.after) break;
  }
  const s2 = await look();
  await pic('after');
  return {
    ...R,
    frames: f,
    blastAt: blastF,
    booms,
    ripple: endF >= 0 ? endF - blastF + 1 : -1,
    craterMs: +(s2.crMs / Math.max(1, s2.crN)).toFixed(1),
    toolMs: +s2.crMs.toFixed(0),
    trace: trace.join(' '),
    craters: s2.crN,
    blastMs: +blastMs.toFixed(0),
    blastSum: +blastSum.toFixed(0),
    worstMs: +worst.toFixed(0),
    out: +(R.vol0 - s2.vol).toFixed(4),
    pieces: s2.pieces,
    drops: s2.drops,
    vmax: +vmax.toFixed(1),
    on: +s2.on.toFixed(2),
    rowAfter: s2.row,
    errors: k.errs.length,
    err: k.errs.slice(0, 2).join(' | ').slice(0, 200),
  };
}

export const row = (r) => r.prof ? `\n${r.prof}` : r.afterHeal !== undefined ? `planted ${r.planted} row ${r.rowUp} count ${r.count} | Re-cube / a cube taken away: bombs left ${r.afterHeal}, row after ${r.rowAfter}, errors ${r.errors} ${r.err}` : `planted ${r.planted} (on jelly ${r.onJelly}) row ${r.rowUp} count ${r.count} boom ${r.boom} | blast at f${r.blastAt} in ${r.booms} go(es) over ${r.ripple} frames, worst blast step ${r.blastMs} ms, all its steps ${r.blastSum} ms (worst step ${r.worstMs}), the bombs' own ${r.toolMs} ms (${r.craterMs} each, x${r.craters}) | out ${r.out} m3, ${r.pieces} pieces, ${r.drops} drops, vmax ${r.vmax} m/s, on screen ${r.on} | row after ${r.rowAfter} errors ${r.errors} ${r.err}${r.trace ? `\n   steps/bombs' ms: ${r.trace}` : ''}`;
export const summary = (all) => table(all, ['planted', 'onJelly', 'booms', 'ripple', 'blastMs', 'blastSum', 'toolMs', 'craterMs', 'out', 'pieces', 'drops', 'vmax', 'on', 'errors']);
