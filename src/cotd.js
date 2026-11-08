// Cube of the day: one a day, the same on every phone - worked out from the
// date alone (no server) - and off the menu: every one a special put
// together by hand (see specials.js). A day that's a day for something
// (Halloween week, Pancake Day, Pi Day, the longest night...) has its own;
// otherwise the season's menu, shuffled once a season, so nothing comes
// round again till everything's had its day. Each with a little of the
// day's own in it: which of its names, which of its materials, the way its
// pattern's turned. The app greets you with it once a day (see
// Cubby.daily) and the Cubby keeps it on a card of its own.

import { SPECIALS } from './specials.js';
import { FLAVORS } from './styles.js';
import { encodeCube, decodeCube } from './cubecode.js';
import { seeded, hashString } from './namegen.js';
import { freeNodesDefault, FREE_K_MIN, FREE_K_MAX } from './freeform.js';

// (today, where you are: 2026-11-07)
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// (whole days since 1970, by the calendar where you are)
const dayNumber = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);

// Easter Sunday (the Gregorian computus)
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
// (the days that move by the moon: month * 100 + day)
const LUNAR = { 2026: 217, 2027: 206, 2028: 126, 2029: 213, 2030: 203, 2031: 123, 2032: 211, 2033: 131, 2034: 219, 2035: 208 };
const DIWALI = { 2026: 1108, 2027: 1029, 2028: 1017, 2029: 1105, 2030: 1026 };

// What today's a day for - [tag, how likely it's that day's special: a week
// of Halloween is mostly Halloween, Halloween itself always]
export function eventsOn(d = new Date()) {
  const y = d.getFullYear(), md = (d.getMonth() + 1) * 100 + d.getDate(), out = [];
  const add = (tag, p) => out.push([tag, p]);
  if (md === 1231 || md === 101) add('newyear', 1);
  if (md === 314) add('piday', 1);
  if (md === 401) add('fools', 1);
  if (md === 422) add('earthday', 1);
  if (md === 621) add('midsummer', 1);
  if (md === 707) add('chocolate', 1);
  if (md === 1001) add('coffee', 1);
  if (md === 1221) add('midwinter', 1);
  if (LUNAR[y] === md) add('lunar', 1);
  if (DIWALI[y] === md) add('diwali', 1);
  const fromEaster = dayNumber(d) - dayNumber(easter(y));
  if (fromEaster >= -2 && fromEaster <= 1) add('easter', 1);
  if (fromEaster === -47) add('pancake', 1);
  if (d.getDate() === 13 && d.getDay() === 5) add('friday13', 1);
  if (md >= 210 && md <= 214) add('valentine', md === 214 ? 1 : 0.5);
  if (md >= 315 && md <= 317) add('paddy', md === 317 ? 1 : 0.5);
  if (md >= 1024 && md <= 1031) add('halloween', md === 1031 ? 1 : 0.7);
  if (md >= 1201 && md <= 1226) add('christmas', md >= 1224 ? 1 : 0.45);
  return out;
}

const SEASONS = ['winter', 'spring', 'summer', 'autumn'];

// The day's special (one of SPECIALS).
export function specialOn(d = new Date()) {
  const rnd = seeded(hashString('special:' + dayKey(d))), n = dayNumber(d);
  // a day for something: its own, round in turn (a different one each day
  // of Halloween week)
  for (const [tag, p] of eventsOn(d)) {
    const menu = SPECIALS.filter((s) => s.when === tag);
    if (menu.length && rnd() < p) return menu[(hashString(tag + ':' + d.getFullYear()) + n) % menu.length];
  }
  // the season's menu (any time's, and the season's own), shuffled once a
  // season: today, the next on it
  const m = d.getMonth() + 1, si = Math.floor((m % 12) / 3), season = SEASONS[si];
  const start = new Date(m === 12 || m > 2 ? d.getFullYear() : d.getFullYear() - 1, si === 0 ? 11 : si * 3 - 1, 1);
  const menu = SPECIALS.filter((s) => !s.when || s.when === season);
  const r = seeded(hashString(`menu:${start.getFullYear()}:${season}`));
  for (let i = menu.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [menu[i], menu[j]] = [menu[j], menu[i]];
  }
  return menu[(n - dayNumber(start)) % menu.length];
}

// (a freeform's points turned one of the cube's 48 ways round: the same
// pattern, another face of it to the front)
function turned(nodes, rnd) {
  const perm = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]][Math.floor(rnd() * 6)];
  const sg = [0, 1, 2].map(() => (rnd() < 0.5 ? -1 : 1));
  return nodes.map((q) => {
    const v = [q.x, q.y, q.z];
    return { x: v[perm[0]] * sg[0], y: v[perm[1]] * sg[1], z: v[perm[2]] * sg[2], k: q.k };
  });
}

// A special made into a cube (one of its materials, edges, glitters - and
// for freeform, its pattern turned - by the day's roll).
export function specialCube(sp, rnd) {
  const one = (v) => (Array.isArray(v) ? v[Math.floor(rnd() * v.length)] : v);
  const texture = one(sp.mat), edges = one(sp.edges || 'round'), glitter = one(sp.glitter || 'off');
  let flavor = 'cherry', layers = { colors: ['#e8102e', '#ffc814'], blur: 0, repeat: 1, bias: 0, shape: 'up' }, rubik = 1;
  const look = String(sp.look).trim();
  if (look === 'rubik') {
    flavor = 'rubik';
    rubik = 1 + Math.floor(rnd() * 65535);
  } else if (look.startsWith('#') || FLAVORS.some((f) => f.id === look && !f.layered && !f.rubik)) flavor = look;
  else {
    const parts = look.split(/\s+/), shape = parts.shift(), blur = parseFloat(parts.shift()) || 0;
    const L = { colors: [], blur, repeat: 1, bias: 0, shape, tiles: 1, stops: null }, ks = [];
    for (const p of parts) {
      if (/^r\d/.test(p)) L.repeat = +p.slice(1);
      else if (/^t\d/.test(p)) L.tiles = +p.slice(1);
      else if (/^b-?[\d.]/.test(p)) L.bias = +p.slice(1);
      else {
        const [hex, k] = p.split('*');
        L.colors.push(hex);
        ks.push(k ? +k : 1);
      }
    }
    if (shape === 'free') L.nodes = turned(freeNodesDefault(L.colors.length), rnd).map((q, i) => ({ ...q, k: Math.min(FREE_K_MAX, Math.max(FREE_K_MIN, ks[i])) }));
    flavor = 'layers';
    layers = L;
  }
  return { name: one(sp.names), flavor, layers, texture, edges, glitter, tune: { ...(sp.tune || {}) }, tear: true, rubik };
}

export function cubeOfTheDay(d = new Date()) {
  const day = dayKey(d), sp = specialOn(d);
  const c = specialCube(sp, seeded(hashString('cube-of-the-day:' + day)));
  // (through its code and back: exactly what a link to it would open)
  const out = decodeCube(encodeCube(c)) || c;
  out.day = day;
  out.note = sp.note;
  out.special = sp.id;
  return out;
}
