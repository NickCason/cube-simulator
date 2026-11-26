// Typing in the app's boxes, as he did: the ideas box opened from the ⋯ menu (a wide screen: its button, top right),
// a sentence typed into it key by key - does it all get in, spaces too, and does the room keep out of it (no tool
// picked by a letter, no slow motion for a space, no theme flipped, no sound off, no panel opened, no heal)?
// box=ideas (the textarea) | name (the ideas box's name line, an <input>, as a control)
import { table } from './_common.mjs';
export const meta = { name: 'typing', dpr: 1, params: { box: 'ideas', desk: 0, text: 'Coordinated explosions like we can place multiple then blow them up all at once' } };

export async function run(k, p) {
  const page = k.page;
  if (p.desk) (await page.setViewportSize({ width: 1440, height: 900 }), await k.frames(5));
  await k.load('plain', {}, { settle: 30 });
  const state = () => k.app((a) => ({
    tool: a.tool?.id,
    theme: a.theme,
    muted: !!a.audio.muted,
    slow: a.slowGoal !== 1,
    healing: !!a.healer?.active,
    panels: ['.places-panel', '.cubby', '.stack-panel'].filter((s) => { const el = document.querySelector(s); return el && !el.hidden && el.offsetParent; }).length,
  }));
  const before = await state();
  if (p.desk) await page.click('.idea-btn');
  else {
    await page.click('.menu-btn');
    await page.locator('.mrow', { hasText: 'Suggest or report' }).click();
  }
  const sel = p.box === 'name' ? '.ideas .ib-name' : '.ideas .ib-text';
  await page.waitForSelector(sel, { state: 'visible', timeout: 10000 });
  await page.click(sel);
  // (key by key, a frame between - the room's loop runs as he types)
  for (const ch of p.text) {
    await page.keyboard.type(ch);
    await k.frames(1);
  }
  const got = await page.$eval(sel, (el) => el.value);
  const after = await state();
  return {
    typed: got === p.text ? 1 : 0,
    spaces: (got.match(/ /g) || []).length,
    want: (p.text.match(/ /g) || []).length,
    tool: after.tool,
    toolKept: after.tool === before.tool ? 1 : 0,
    themeKept: after.theme === before.theme ? 1 : 0,
    soundKept: after.muted === before.muted ? 1 : 0,
    slow: after.slow ? 1 : 0,
    panels: after.panels,
    healing: after.healing ? 1 : 0,
    errors: k.errs.length,
    got: got.slice(0, 60),
  };
}

export const row = (r) => `typed ${r.typed} (spaces ${r.spaces}/${r.want}) tool ${r.tool} kept ${r.toolKept} theme ${r.themeKept} sound ${r.soundKept} slow ${r.slow} panels ${r.panels} errors ${r.errors} "${r.got}"`;
export const summary = (all) => table(all, ['typed', 'spaces', 'tool', 'toolKept', 'themeKept', 'soundKept', 'slow', 'panels', 'errors']);
