// Cube of the day: one cube a day, the same on every phone - worked out from
// the date alone (no server): a flavour (or a layered palette, or a colour of
// its own), a material, edges, maybe glitter, a slider or two nudged, and a
// name from the generator. The app greets you with it once a day (see
// Cubby.daily) and the Cubby keeps it on a card of its own.

import { FLAVORS, LAYER_PRESETS, TEXTURES, EDGES, GLITTERS } from './styles.js';
import { SETTINGS } from './settings.js';
import { encodeCube, decodeCube } from './cubecode.js';
import { nameCube, seeded, hashString } from './namegen.js';

// (today, where you are: 2026-11-07)
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// a lively colour: any hue, mostly saturated, never muddy
function liveColour(rnd) {
  const h = rnd() * 360, s = 0.62 + rnd() * 0.33, v = 0.62 + rnd() * 0.36;
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

// the sliders a day's cube may nudge (its feel and look - never the room's)
const NUDGE = ['mu', 'damping', 'bounce', 'goo', 'grip', 'opacity', 'glow', 'depth', 'irid', 'metal', 'opal'];

export function cubeOfTheDay(d = new Date()) {
  const day = dayKey(d);
  const rnd = seeded(hashString('cube-of-the-day:' + day));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const plain = FLAVORS.filter((f) => !f.layered);
  const r = rnd();
  let flavor, layers = { colors: ['#e8102e', '#ffc814'], blur: 0, repeat: 1, bias: 0 };
  if (r < 0.5) flavor = pick(plain).id;
  else if (r < 0.78) {
    const P = pick(LAYER_PRESETS);
    flavor = 'layers';
    layers = { colors: [...P.colors], blur: P.blur || 0, repeat: P.repeat || 1, bias: P.bias || 0 };
  } else flavor = liveColour(rnd);
  // (the finishes and the oddballs a little rarer than the jellies)
  const rare = new Set(['prism', 'holo', 'pearl', 'opal', 'chrome', 'syrup', 'water', 'putty', 'tofu']);
  const mats = Object.keys(TEXTURES);
  let texture = pick(mats);
  if (rare.has(texture) && rnd() < 0.45) texture = pick(mats);
  const edges = pick(Object.keys(EDGES));
  const glitter = rnd() < 0.62 ? 'off' : pick(GLITTERS.filter((g) => g.id !== 'off')).id;
  // a slider or two nudged off the material's own, within reason
  const tune = {};
  const n = rnd() < 0.4 ? 0 : rnd() < 0.7 ? 1 : 2;
  for (let k = 0; k < n; k++) {
    const key = pick(NUDGE), S = SETTINGS.find((s) => s.key === key);
    if (!S) continue;
    const base = TEXTURES[texture][key] ?? S.def;
    const t0 = Number.isFinite(base) ? Math.min(1, Math.max(0, S.from(base))) : 0.5;
    tune[key] = S.to(Math.min(0.95, Math.max(0.05, t0 + (rnd() - 0.5) * 0.6)));
  }
  const c = { name: '', flavor, layers, texture, edges, glitter, tune, tear: true, rubik: flavor === 'rubik' ? 1 + Math.floor(rnd() * 65535) : 1 };
  c.name = nameCube(c, { rnd });
  // (through its code and back: exactly what a link to it would open)
  const out = decodeCube(encodeCube(c)) || c;
  out.day = day;
  return out;
}
