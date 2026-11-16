// Re-cube's weld - the seams burning in as the pieces fuse - on n cubes (1..8) of a kind, solid or full of liquid:
// each cut across twice (two knife strokes over all of them), re-cubed, and as it burns: whether the weld's on,
// how many cubes have seams for the shader, whether its distances are for the topology drawn (a cube full of
// liquid is made hollow just after it's made: that ended it), how many cubes are hollow, and the burn on screen -
// the pixels that change with the weld on and off, all told and the least on any cube that was cut. pics=1: the
// burn at 0.35 s (scorch, embers) and 1.2 s (the healing wave).
import { table } from './_common.mjs';
import { CUBES } from '../kit.mjs';
export const meta = { name: 'weld', params: { cube: 'plain', n: 1, pics: 1 } };

// (in the page: the pixels that differ, the weld on and off - all, and in each cube's screen box)
function burn(a) {
  const U = a.jelly.frontMat.uniforms, t = U.uWeldT.value, gl = a.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const grab = () => {
    a.render();
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const on = grab();
  U.uWeldT.value = 99;
  const off = grab();
  U.uWeldT.value = t;
  a.render();
  const sb = a.sb, r = a.canvas.getBoundingClientRect(), V = a.camera.position.constructor, v = new V(), boxes = new Map();
  for (let i = 0; i < sb.nV; i++) {
    if (!sb.alive[i]) continue;
    v.set(sb.x[i * 3], sb.x[i * 3 + 1], sb.x[i * 3 + 2]).project(a.camera);
    const x = (v.x * 0.5 + 0.5) * w, y = (v.y * 0.5 + 0.5) * h, k = sb.vCube[i];
    const b = boxes.get(k) || [1e9, 1e9, -1e9, -1e9];
    boxes.set(k, [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]);
  }
  let all = 0;
  const per = {};
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (Math.abs(on[o] - off[o]) + Math.abs(on[o + 1] - off[o + 1]) + Math.abs(on[o + 2] - off[o + 2]) < 40) continue;
      all++;
      for (const [k, b] of boxes) if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) per[k] = (per[k] || 0) + 1;
    }
  return { all, per, w: r.width };
}

export async function run(k, p, ctx) {
  await k.load(p.cube, {}, { settle: 30 });
  if (p.n > 1) {
    await k.app(
      async (a, arg) => {
        const m = await import('/src/cubecode.js');
        for (let i = 1; i < arg.n; i++) a.addCube(m.decodeCube(arg.code), { drop: false });
      },
      { n: p.n, code: CUBES[p.cube] || p.cube },
    );
    await k.frames(120);
  }
  if (p.pics) await k.shot(`${ctx.out}/weld-${ctx.build}-${p.cube}-n${p.n}-0.png`);
  // each cube cut across twice - strokes over its own middle on the screen, a little up and a little down (one
  // stroke over them all missed most of several)
  const boxes = await k.app((a) => {
    const sb = a.sb, r = a.canvas.getBoundingClientRect(), V = a.camera.position.constructor, v = new V(), B = {};
    for (let i = 0; i < sb.nV; i++) {
      if (!sb.alive[i]) continue;
      v.set(sb.x[i * 3], sb.x[i * 3 + 1], sb.x[i * 3 + 2]).project(a.camera);
      const x = r.left + (v.x * 0.5 + 0.5) * r.width, y = r.top + (-v.y * 0.5 + 0.5) * r.height, b = B[sb.vCube[i]] || (B[sb.vCube[i]] = [1e9, 1e9, -1e9, -1e9]);
      b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
    }
    return Object.values(B).filter((b) => (b[0] + b[2]) / 2 > 10 && (b[0] + b[2]) / 2 < r.width - 10 && (b[1] + b[3]) / 2 > 70 && (b[1] + b[3]) / 2 < r.height * 0.78);
  });
  await k.app((a) => a.setTool('knife'));
  for (const b of boxes)
    for (const [v0, v1] of [[0.4, 0.52], [0.66, 0.54]]) {
      const w = b[2] - b[0], h = b[3] - b[1];
      await k.page.mouse.move(b[0] - 0.25 * w, b[1] + v0 * h);
      await k.page.mouse.down();
      await k.page.mouse.move(b[2] + 0.25 * w, b[1] + v1 * h, { steps: 12 });
      await k.page.mouse.up();
      await k.frames(6);
    }
  await k.frames(20);
  const cut = await k.app((a) => {
    const n = {};
    for (const pc of a.sb.pieces) if (pc) n[pc.cube] = (n[pc.cube] || 0) + 1;
    return Object.keys(n).filter((c) => n[c] > 1).map(Number);
  });
  await k.app((a) => a.heal());
  // (till it's made again)
  for (let f = 0; f < 200; f++) if (!(await k.app((a) => (a.frame(1 / 30), a.healer.active)))) break;
  const state = (a) => {
    const sb = a.sb, w = sb.weld, c = w?.near?.cells;
    let seams = 0, hollow = 0;
    if (c) for (let q = 0; q < 8; q++) if (c[q * 4 + 2] > 0) seams++;
    for (const cb of a.cubes) if (sb.cHollow[cb.slot]) hollow++;
    return { t: a.healer.weldT, u: a.jelly.frontMat.uniforms.uWeldT.value, seams, follows: !!w && w.topo === sb.topoVersion, hollow, liquid: a.fluid.n };
  };
  const stepTo = async (t) => {
    for (let f = 0; f < 240; f++) {
      const s = await k.app((a, t) => (a.frame(1 / 30), a.healer.weldT === undefined || a.healer.weldT >= t), t);
      if (s) break;
    }
    await k.frames(1, 0);
  };
  const fused = await k.app(state, 0);
  await stepTo(0.35);
  const s1 = await k.app(state);
  const b1 = await k.app(burn);
  if (p.pics) await k.shot(`${ctx.out}/weld-${ctx.build}-${p.cube}-n${p.n}-a.png`);
  await stepTo(1.2);
  if (p.pics) await k.shot(`${ctx.out}/weld-${ctx.build}-${p.cube}-n${p.n}-b.png`);
  const b2 = await k.app(burn);
  await stepTo(5.5);
  const s3 = await k.app(state);
  const least = cut.length ? Math.min(...cut.map((c) => b1.per[c] || 0)) : 0;
  return {
    cut: cut.length,
    onAtFuse: fused.t !== undefined ? 1 : 0,
    on: s1.t !== undefined ? 1 : 0,
    seams: s1.seams,
    follows: s1.follows ? 1 : 0,
    hollow: s1.hollow,
    burnPx: b1.all,
    leastPx: least,
    wavePx: b2.all,
    ended: s3.u >= 5 ? 1 : 0,
  };
}
export const row = (r) => `cut ${r.cut}: weld on ${r.on} (at fuse ${r.onAtFuse}), seams on ${r.seams} cubes, follows ${r.follows}, hollow ${r.hollow}, burn ${r.burnPx} px (least ${r.leastPx}), wave ${r.wavePx} px, ended ${r.ended}`;
export const summary = (all) => table(all, ['cut', 'on', 'seams', 'follows', 'hollow', 'burnPx', 'leastPx', 'wavePx', 'ended']);
