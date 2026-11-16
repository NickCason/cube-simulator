// The Cubby's pictures (portrait.js), taken with a room behind them - as the Cubby takes them, the room as it is:
// room = plain (a whole cube) | full (a whole cube full of liquid) | spill (one cut across, its top lifted off, its
// liquid out) | pair (two cubes side by side) | stack (two, stacked); of = the cube pictured (a name from cubes.mjs,
// a code, or 'room': the one on show, as keeping it does). The picture saved, and the room after it (put back?).
import { writeFileSync } from 'node:fs';
import { cut, table } from './_common.mjs';
import { CUBES } from '../kit.mjs';
export const meta = { name: 'portrait', params: { room: 'spill', of: 'plainLiquid', px: 320 } };
export async function run(k, p, ctx) {
  const liquid = p.room === 'full' || p.room === 'spill';
  await k.load(liquid ? 'plainLiquid' : 'plain', {}, { settle: 60 });
  if (p.room === 'spill') (await cut(k, 'bowl'), await k.frames(150));
  if (p.room === 'pair' || p.room === 'stack') {
    await k.app(async (a, code) => a.addCube((await import('/src/cubecode.js')).decodeCube(code), { drop: false }), CUBES.plainLiquid);
    await k.frames(60);
    if (p.room === 'stack') (await k.app((a) => a.stack()), await k.frames(150));
  }
  await k.shot(`${ctx.out}/portrait-${ctx.build}-${p.room}-${p.of}-room.png`);
  const url = await k.app(
    async (a, [of, px]) => {
      const m = await import('/src/cubecode.js');
      return a.portrait(of === 'room' ? null : m.decodeCube(of), px, { fill: 0.8, lean: 0.07 });
    },
    [p.of === 'room' ? 'room' : CUBES[p.of] || p.of, p.px],
  );
  if (url) writeFileSync(`${ctx.out}/portrait-${ctx.build}-${p.room}-${p.of}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  await k.frames(2);
  await k.shot(`${ctx.out}/portrait-${ctx.build}-${p.room}-${p.of}-after.png`);
  return { ok: url ? 1 : 0, errors: k.errs.length };
}
export const row = (r) => `picture ${r.ok ? 'taken' : 'none'}, ${r.errors} page errors`;
export const summary = (all) => table(all, ['ok', 'errors']);
