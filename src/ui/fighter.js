// The fighter card: a picked cube's name slammed across the screen, its
// stats as bars of little cubes, and its record - how many times it's been
// healed, picked, cut, torn, shot and blown up.

import { cubeSummary, cubeStats } from '../cubecode.js';
import { resolveFlavor, flavorSwatchCSS, flavorMainHex } from '../styles.js';

const RECORD = [
  ['healed', 'Re-cubed'],
  ['picked', 'Picked'],
  ['cuts', 'Cuts'],
  ['tears', 'Tears'],
  ['diced', 'Diced'],
  ['shots', 'Shots'],
  ['booms', 'Booms'],
];

export class FighterCard {
  constructor(root, app) {
    this.app = app;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="fighter" hidden role="status" aria-live="polite">
        <div class="f-kicker"></div>
        <div class="f-name"><span></span></div>
        <div class="f-sub"></div>
        <div class="f-stats"></div>
        <div class="f-foot"><div class="f-rec"></div><div class="f-acts"></div></div>
      </div>`,
    );
    this.el = root.querySelector('.fighter');
    this.el.addEventListener('click', (e) => {
      if (!e.target.closest('.f-acts button')) this.hide();
    });
    this._timers = [];
  }

  // c: a decoded cube; kicker: the line above the name; rec: its record (null:
  // not in the Cubby); actions: [{ label, run }] (Undo, Save)
  show(c, { kicker = 'Cube select', rec = null, actions = [], ms = 0 } = {}) {
    const app = this.app, el = this.el;
    this._clear();
    const f = resolveFlavor({ flavor: c.flavor, layers: c.layers });
    el.style.setProperty('--f-col', flavorMainHex(f));
    el.style.setProperty('--f-grad', f.layers ? flavorSwatchCSS({ ...f, blur: 1 }).replace('180deg', '90deg') : f.hex);
    el.querySelector('.f-kicker').textContent = kicker;
    el.querySelector('.f-name span').textContent = c.name || 'Mystery cube';
    el.querySelector('.f-sub').textContent = cubeSummary(c, true);
    const stats = el.querySelector('.f-stats');
    stats.textContent = '';
    cubeStats(c).forEach(([label, v], i) => {
      const row = document.createElement('div');
      row.className = 'f-stat';
      const on = Math.round(v / 10);
      let pips = '';
      for (let k = 0; k < 10; k++) pips += `<i${k < on ? ` class="on" style="--d:${260 + i * 110 + k * 28}"` : ''}></i>`;
      row.innerHTML = `<span class="f-lbl"></span><span class="f-bar">${pips}</span><b>${v}</b>`;
      row.querySelector('.f-lbl').textContent = label;
      stats.appendChild(row);
      this._timers.push(setTimeout(() => app.audio?.tick(i * 2), 260 + i * 110));
    });
    const recEl = el.querySelector('.f-rec');
    recEl.textContent = '';
    if (!rec) {
      const s = document.createElement('span');
      s.className = 'f-fresh';
      s.textContent = 'Fresh out of the box';
      recEl.appendChild(s);
    } else {
      for (const [k, label] of RECORD) {
        const n = rec[k] || 0;
        if (!n && k !== 'healed') continue;
        const s = document.createElement('span');
        s.innerHTML = `<b>${n}</b> `;
        s.append(label.toLowerCase());
        recEl.appendChild(s);
      }
    }
    const acts = el.querySelector('.f-acts');
    acts.textContent = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        app.audio?.ui();
        this.hide();
        a.run();
      });
      acts.appendChild(b);
    }
    el.hidden = false;
    el.classList.remove('show', 'leave');
    void el.offsetWidth;
    el.classList.add('show');
    app.audio?.stinger();
    this._timers.push(setTimeout(() => this.hide(), ms || (actions.length ? 6500 : 4800)));
  }

  hide() {
    const el = this.el;
    if (el.hidden || el.classList.contains('leave')) return;
    this._clear();
    el.classList.remove('show');
    el.classList.add('leave');
    this._timers.push(setTimeout(() => (el.hidden = true), 320));
  }

  _clear() {
    for (const t of this._timers) clearTimeout(t);
    this._timers.length = 0;
  }
}
