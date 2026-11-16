// The dock on a phone (ui.js builds the rest; a wide screen keeps the old dock - all its tools fit): what you're
// holding - its picture and its name - tapped for all of them, the tool tray, by kind and named; the last two you
// had; Make; Play. Over it, only while they mean something: Re-cube (it's cut, burned, dented) and the room's cubes
// (more than one - their panel). The rest - places, glow, sound, a clip, another cube, the settings - in the ⋯ menu,
// top right. Measured before (scratch/UI-AUDIT.md): 3 of the 22 tools fit the old phone dock, 2 with a stack.

import { Sheet, asSheet } from './sheet.js';
import { fly, motion } from './motion.js';

export const TOOL_GROUPS = [
  { name: 'Hands', color: '#3b9cf5', ids: ['hand', 'blow', 'twist', 'magnet'] },
  { name: 'Cut', color: '#f0643c', ids: ['knife', 'dicer', 'baller', 'cuber'] },
  { name: 'Shoot', color: '#8b5cf6', ids: ['nailgun', 'holegun', 'autogun', 'shotgun', 'gelgun'] },
  { name: 'Smash', color: '#e3a008', ids: ['mallet', 'bomb'] },
  { name: 'Elements', color: '#e5484d', ids: ['torch', 'freeze', 'acid'] },
  { name: 'Dress up & grow', color: '#e04f9c', ids: ['eyes', 'flour', 'syringe', 'feed'] },
];
const RECENT_KEY = 'cube-sim-recents';
const RECENT_N = 2; // (shown: two, and the one in hand named - three and a long name ran off a phone)
const DEFAULT_RECENTS = ['knife', 'mallet', 'eyes', 'torch'];

const svg = (inner, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${extra}>${inner}</svg>`;
const I = {
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2.5l1.9 6.1 6.1 1.9-6.1 1.9L12 18.5l-1.9-6.1-6.1-1.9 6.1-1.9z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
  stack: svg('<rect x="6" y="3.5" width="12" height="7" rx="2"/><rect x="4" y="13.5" width="16" height="7" rx="2"/>'),
  places: svg('<path d="M3 19 9 9l4 6 3-4 5 8Z"/><circle cx="17" cy="6" r="2"/>'),
  glow: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>'),
  sound: svg('<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>'),
  rec: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="#e5333f"/></svg>',
  add: svg('<rect x="3.5" y="7" width="11" height="11" rx="2.6"/><path d="M18.5 3.5v6M15.5 6.5h6"/>'),
  tune: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
};

export class PhoneDock {
  // (icons, tools: ui.js's ICONS and TOOL_DEFS - handed in, ui.js importing this)
  constructor(ui, app, root, { icons, tools }) {
    this.ui = ui;
    this.app = app;
    this.icons = icons;
    this.defs = tools;
    this.cur = null;
    this.recents = [];
    this._quakeT = 0;
    this._flying = false; // (a tool on its way down from the tray: it acts once it lands)
    this._chipT = new WeakMap();
    try {
      const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      if (Array.isArray(r)) this.recents = r.filter((x) => icons[x]);
    } catch (e) {}
    const dock = (this.dock = root.querySelector('.dock'));
    // what's in hand: its picture, its name - all of them, tapped
    const hold = (this.holdBtn = document.createElement('button'));
    hold.className = 'holding';
    hold.innerHTML = '<span class="hd-ic"></span><span class="hd-nm"><b></b><span>Tools ▴</span></span>';
    this.holdIc = hold.querySelector('.hd-ic');
    this.holdNm = hold.querySelector('.hd-nm');
    hold.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      app.audio.ui();
      this.tray.toggle();
    });
    this.recentEl = document.createElement('div');
    this.recentEl.className = 'recents';
    dock.prepend(hold, this.recentEl);
    // Make and Play, named
    root.querySelector('.swatch-btn')?.insertAdjacentHTML('beforeend', '<span class="dk-lbl">Make</span>');
    root.querySelector('.exhibit-btn')?.insertAdjacentHTML('beforeend', '<span class="dk-lbl">Play</span>');
    // over the dock, while they mean something
    const chips = (this.chipsEl = document.createElement('div'));
    chips.className = 'ui-chips';
    chips.innerHTML = `<button class="ui-chip recube" hidden>${I.spark}<span>Re-cube</span></button><button class="ui-chip alt cubes" hidden aria-haspopup="dialog">${I.stack}<span></span></button>`;
    root.appendChild(chips);
    this.recubeChip = chips.querySelector('.recube');
    this.cubesChip = chips.querySelector('.cubes');
    this.recubeChip.addEventListener('click', () => {
      app.audio.init();
      if (app.heal()) ui.cubby?.tally('healed');
    });
    this.cubesChip.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      app.audio.ui();
      ui.stack.toggle();
    });
    // the menu's button, top right
    const mb = (this.menuBtn = document.createElement('button'));
    mb.className = 'menu-btn';
    mb.setAttribute('aria-label', 'Menu: places, glow, sound, a clip, another cube, settings');
    mb.setAttribute('aria-haspopup', 'dialog');
    mb.innerHTML = I.dots;
    mb.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      app.audio.ui();
      this.menu.toggle();
    });
    root.appendChild(mb);
    this.tray = new Sheet(root, { cls: 'tray', title: 'Tools', sub: `${tools.length} to play with`, onOpen: () => this._opening('tray') });
    // the panels: sheets too, on a phone - a handle each (see asSheet; the rest is CSS)
    asSheet(ui.paletteEl, () => ui.closePalette());
    asSheet(ui.tuneEl, () => ui.closeTune());
    asSheet(ui.cubby?.el, () => ui.cubby.close());
    asSheet(ui.stack?.el, () => ui.stack.close());
    asSheet(ui.places?.el, () => ui.places.close());
    asSheet(ui.exhibit?.pop, () => ((ui.exhibit.pop.hidden = true), ui.exhibit.btn.classList.remove('open')));
    this.menu = new Sheet(root, { cls: 'menu-sheet', title: 'Cube Simulator', onOpen: () => this._opening('menu') });
  }

  // (a sheet coming up: the panels down - and its contents as things are now)
  _opening(which) {
    const ui = this.ui;
    ui.closePalette?.();
    ui.closeTune?.();
    ui.places?.close?.();
    ui.stack?.close?.();
    ui.cubby?.close?.();
    if (which === 'tray') this._renderTray();
    else this._renderMenu();
  }

  // ------------------------------------------------------------------ in hand

  // (the tool in hand now: named in the dock; the one it was, first of the recents)
  setTool(id) {
    if (!id || id === this.cur || !this.icons[id]) return;
    const prev = this.cur;
    this.cur = id;
    if (prev) {
      this.recents = [prev, ...this.recents.filter((x) => x !== prev && x !== id)].slice(0, 4);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(this.recents));
      } catch (e) {}
    }
    this._renderDock(prev);
  }

  _renderDock(prev) {
    const id = this.cur, d = this.defs.find((t) => t.id === id);
    this.holdIc.classList.remove('tk'); // (else the new icon, under .tk still, acted at once - in flight, hidden)
    this.holdIc.innerHTML = this.icons[id] || '';
    this.holdIc.dataset.anim = id;
    // (picked: it acts - the knife slashes, the mallet bonks, the torch flickers... see .tk in style.css. Flown in
    // from the tray: once it's landed - it played hidden under the one flying)
    if (prev && !this._flying) this._act();
    this.holdNm.querySelector('b').textContent = d?.label || id;
    this.holdBtn.setAttribute('aria-label', `${d?.label || id} in hand - all the tools`);
    if (prev && !motion.reduced) {
      this.holdNm.classList.remove('swap');
      void this.holdNm.offsetWidth;
      this.holdNm.classList.add('swap');
    }
    const show = [...this.recents, ...DEFAULT_RECENTS].filter((x, i, a) => x !== id && this.icons[x] && a.indexOf(x) === i).slice(0, RECENT_N);
    this.recentEl.textContent = '';
    for (const x of show) {
      const b = document.createElement('button'), dx = this.defs.find((t) => t.id === x);
      b.className = 'recent' + (x === prev ? ' new' : '');
      b.innerHTML = this.icons[x];
      b.title = dx?.label || x;
      b.setAttribute('aria-label', dx?.label || x);
      b.addEventListener('click', () => {
        this.app.audio.init();
        this.app.audio.ui();
        this.app.setTool(x);
      });
      this.recentEl.appendChild(b);
    }
  }

  _act() {
    if (motion.reduced) return;
    this.holdIc.classList.remove('tk');
    void this.holdIc.offsetWidth;
    this.holdIc.classList.add('tk');
  }

  // ------------------------------------------------------------------ the tray

  _renderTray() {
    const body = this.tray.body, seen = new Set();
    body.textContent = '';
    let i = 0;
    const groups = TOOL_GROUPS.map((g) => ({ ...g, ids: g.ids.filter((x) => this.defs.some((t) => t.id === x)) }));
    // (one not in a group yet: with the last)
    const rest = this.defs.map((t) => t.id).filter((x) => !groups.some((g) => g.ids.includes(x)));
    if (rest.length) groups[groups.length - 1].ids.push(...rest);
    for (const g of groups) {
      if (!g.ids.length) continue;
      const sec = document.createElement('div');
      sec.className = 'tt-grp';
      sec.style.setProperty('--g', g.color);
      sec.innerHTML = '<h3><i></i><span></span></h3><div class="tt-grid"></div>';
      sec.querySelector('h3 span').textContent = g.name;
      const grid = sec.querySelector('.tt-grid');
      for (const id of g.ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const d = this.defs.find((t) => t.id === id), t = document.createElement('button');
        t.className = 'tt-tile' + (id === this.cur ? ' cur' : '');
        t.style.setProperty('--i', i++);
        t.innerHTML = `<span class="tt-ic">${this.icons[id] || ''}</span><span class="tt-nm"></span>`;
        t.querySelector('.tt-nm').textContent = d?.label || id;
        t.title = d?.hint?.split(' · ')[0] || '';
        t.addEventListener('click', () => this.pick(id, t.querySelector('.tt-ic')));
        grid.appendChild(t);
      }
      body.appendChild(sec);
    }
  }

  // (picked from the tray: in hand - its picture flown down into the dock as the tray goes)
  pick(id, from) {
    const app = this.app, r = from?.getBoundingClientRect();
    app.audio.init();
    app.audio.ui();
    this.tray.close();
    const flies = !!r && !motion.reduced && id !== this.cur;
    this._flying = flies;
    if (id !== this.cur) app.setTool(id);
    this._flying = false;
    if (!flies) return;
    this.holdIc.style.visibility = 'hidden';
    fly(r, this.holdIc, this.icons[id], 'flyer').then(() => {
      this.holdIc.style.visibility = '';
      this._act();
    });
  }

  // ------------------------------------------------------------------ over the dock

  setDamaged(d) {
    this._chip(this.recubeChip, d);
  }

  cubes(n) {
    this.cubesChip.querySelector('span').textContent = `${n} cubes`;
    this._chip(this.cubesChip, n > 1);
  }

  // (a chip in - bouncing - or out)
  _chip(el, show) {
    clearTimeout(this._chipT.get(el));
    if (show) {
      if (!el.hidden && !el.classList.contains('out')) return;
      el.classList.remove('out');
      el.hidden = false;
      el.classList.remove('in');
      void el.offsetWidth;
      el.classList.add('in');
    } else if (!el.hidden) {
      el.classList.add('out');
      this._chipT.set(el, setTimeout(() => ((el.hidden = true), el.classList.remove('out', 'in')), 320));
    }
  }

  // (a hard hit: the dock feels it - a jolt, turning and settling, as much as the hit; not under a sheet)
  quake(a) {
    if (motion.reduced || a < 0.012 || document.documentElement.classList.contains('sheeted')) return;
    const now = performance.now(), dock = this.dock;
    if (now - this._quakeT < 260 || !dock || !dock.offsetParent) return;
    this._quakeT = now;
    if (a >= 0.025) this.ui.jiggleBrand?.(); // (a big one: the logo wobbles too)
    const k = Math.min(1, a / 0.04), r = 2.4 * k, y = 4 * k, base = 'translateX(-50%)';
    dock.animate(
      [{ transform: base }, { transform: `${base} translateY(${y}px) rotate(${-r}deg)`, offset: 0.12 }, { transform: `${base} rotate(${r * 0.6}deg)`, offset: 0.36 }, { transform: `${base} rotate(${-r * 0.3}deg)`, offset: 0.62 }, { transform: base }],
      { duration: 560, easing: 'ease-out' },
    );
  }

  // ------------------------------------------------------------------ the menu

  _renderMenu() {
    const app = this.app, ui = this.ui, B = this.menu.body;
    B.textContent = '';
    const rows = [
      { label: 'Places', icon: I.places, acc: '›', run: () => ui.places?.toggle() },
      { label: 'Glow mode', icon: I.glow, sw: () => app.theme === 'dark', run: () => ui.toggleTheme() },
      { label: 'Sound', icon: I.sound, sw: () => !app.audio.muted, run: () => ui.setMuted(!app.audio.muted) },
      ui.clips?.able && !ui.clips.recording && { label: 'Record a clip', icon: I.rec, run: () => ui.clips.start() },
      app.cubes.length < 8 && { label: 'Add a cube', icon: I.add, run: () => app.addCube() },
      { label: 'Settings', icon: I.tune, acc: '›', run: () => ui.tuneBtn?.click() },
    ].filter(Boolean);
    rows.forEach((r, i) => {
      const b = document.createElement('button');
      b.className = 'mrow';
      b.style.setProperty('--i', i);
      b.innerHTML = `<span class="mr-ic">${r.icon}</span><span class="mr-lb"></span>${r.sw ? '<i class="mr-sw" aria-hidden="true"></i>' : `<em>${r.acc || ''}</em>`}`;
      b.querySelector('.mr-lb').textContent = r.label;
      const sync = () => {
        if (!r.sw) return;
        const on = r.sw();
        b.querySelector('.mr-sw').classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      };
      if (r.sw) b.setAttribute('role', 'switch');
      sync();
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        app.audio.init();
        app.audio.ui();
        if (r.sw) {
          r.run();
          sync();
          return;
        }
        this.menu.close();
        r.run();
      });
      B.appendChild(b);
    });
  }
}
