// The flavours as they look: the cube in each (ids, '/' between - default all the single-colour ones) on a phone,
// its default view, a picture each (and the Cubimizer open on its flavour chips, pics of it at the end).
import { table } from './_common.mjs';
export const meta = { name: 'flavors', params: { ids: '', texture: 'jello' } };
export async function run(k, p, ctx) {
  await k.load('plain', {}, { settle: 30 });
  if (p.texture !== 'jello') await k.style({ texture: p.texture });
  const ids = p.ids ? String(p.ids).split('/') : await k.app(async () => (await import('/src/styles.js')).FLAVORS.filter((f) => !f.layered && !f.rubik).map((f) => f.id));
  const shots = [];
  for (const id of ids) {
    await k.app((a, id) => a.setFlavor(id), id);
    await k.frames(8);
    shots.push(await k.shot(`${ctx.out}/flavor-${ctx.build}-${p.texture}-${id}.png`, { crop: [40, 150, 350, 520] }));
  }
  // the Cubimizer's flavour chips, as a phone shows them
  await k.page.evaluate(() => document.querySelector('.swatch-btn')?.click());
  await k.frames(20);
  await k.page.waitForTimeout(600);
  shots.push(await k.shot(`${ctx.out}/flavor-${ctx.build}-panel.png`));
  return { n: ids.length, errors: k.errs.length };
}
export const row = (r) => `${r.n} flavours, ${r.errors} page errors`;
export const summary = (all) => table(all, ['n', 'errors']);
