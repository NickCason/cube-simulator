// Cubiplied! The card for a cubiplication: the cube it came from, and the
// two that came out of it side by side - each one's portrait, name and
// stats (what went up or down against its parent), and what mutated in it,
// the biggest changes sparkling. Save one, the other or both.

import { cubeSummary, cubeStats } from '../cubecode.js';
import { TIER, topTier } from '../genetics.js';
import { resolveFlavor, flavorSwatchCSS } from '../styles.js';
import { cubeArt } from './cubby.js';

const TIER_CLASS = ['t0', 't1', 't2', 't3'];

export class CubipliedCard {
  constructor(root, app) {
    this.app = app;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="cubiplied" hidden role="dialog" aria-label="Cubiplied">
        <div class="cp-card">
          <button class="cp-x" aria-label="Close">&times;</button>
          <div class="cp-kicker">Cubiplied!</div>
          <div class="cp-from"></div>
          <div class="cp-kids"></div>
          <div class="cp-acts"><button class="cp-both">Save both</button></div>
        </div>
      </div>`,
    );
    this.el = root.querySelector('.cubiplied');
    this.kidsEl = this.el.querySelector('.cp-kids');
    this.el.querySelector('.cp-x').addEventListener('click', () => this.hide());
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.hide();
    });
    this.el.querySelector('.cp-both').addEventListener('click', () => {
      app.audio.ui();
      for (let k = 0; k < (this.kids || []).length; k++) this._save(k);
    });
  }

  hide() {
    this.el.hidden = true;
    cancelAnimationFrame(this._raf);
  }

  // parent: the cube it came from (as decodeCube gives one, + gen); kids:
  // [{ c, changes, lin }]
  show({ parent, kids }) {
    const app = this.app;
    this.kids = kids;
    this.saved = kids.map(() => false);
    const both = this.el.querySelector('.cp-both');
    both.textContent = 'Save both';
    both.disabled = false;
    this.el.querySelector('.cp-from').innerHTML = `from <b></b> · generation ${parent.gen + 1}`;
    this.el.querySelector('.cp-from b').textContent = parent.name || 'a cube';
    const before = Object.fromEntries(cubeStats(parent));
    this.kidsEl.textContent = '';
    kids.forEach((k, i) => {
      const tier = topTier(k.changes);
      const el = document.createElement('div');
      el.className = `cp-kid ${TIER_CLASS[tier]}`;
      el.innerHTML = `<div class="cp-pic"></div>
        ${tier >= TIER.MAJOR ? `<div class="cp-badge">${tier >= TIER.LEGENDARY ? 'Legendary!' : 'Mutation!'}</div>` : ''}
        <div class="cp-name"></div><div class="cp-sub"></div>
        <div class="cp-stats"></div><div class="cp-chips"></div>
        <button class="cp-save">Save</button>`;
      el.querySelector('.cp-pic').innerHTML = cubeArt(k.c);
      el.querySelector('.cp-name').textContent = k.c.name || 'Mystery cube';
      el.querySelector('.cp-sub').textContent = cubeSummary(k.c);
      // its stats, and which way each went from its parent's
      const stats = el.querySelector('.cp-stats');
      cubeStats(k.c).forEach(([label, v]) => {
        const d = v - (before[label] ?? v), row = document.createElement('div');
        row.className = 'cp-stat';
        const on = Math.round(v / 10);
        let pips = '';
        for (let q = 0; q < 10; q++) pips += `<i${q < on ? ' class="on"' : ''}></i>`;
        row.innerHTML = `<span class="cp-lbl"></span><span class="cp-bar">${pips}</span><b>${v}</b><em class="${d > 0 ? 'up' : d < 0 ? 'dn' : ''}">${d > 0 ? '+' + d : d < 0 ? '−' + -d : ''}</em>`;
        row.querySelector('.cp-lbl').textContent = label;
        stats.appendChild(row);
      });
      // what mutated (the big ones first; a drift or two)
      const chips = el.querySelector('.cp-chips');
      const list = [...k.changes].sort((a, b) => b.tier - a.tier);
      const shown = [...list.filter((c) => c.tier > 0), ...list.filter((c) => c.tier === 0).slice(0, 2)];
      for (const c of shown) {
        const chip = document.createElement('span');
        chip.className = `cp-chip ${TIER_CLASS[c.tier]}`;
        if (c.color) chip.innerHTML = `<i style="background:${c.color}"></i>`;
        chip.append(c.label);
        chips.appendChild(chip);
      }
      el.style.setProperty('--k-col', flavorSwatchCSS(resolveFlavor({ flavor: k.c.flavor, layers: k.c.layers })));
      el.querySelector('.cp-save').addEventListener('click', () => {
        app.audio.ui();
        this._save(i);
      });
      this.kidsEl.appendChild(el);
    });
    this.el.hidden = false;
    app.audio?.stinger?.();
    // (their portraits, one a frame: a placeholder first)
    let n = 0;
    const next = () => {
      if (this.el.hidden || n >= kids.length) return;
      const url = app.portrait(kids[n].c, 240);
      const box = this.kidsEl.children[n]?.querySelector('.cp-pic');
      if (url && box) box.innerHTML = `<img alt="" src="${url}">`;
      n++;
      this._raf = requestAnimationFrame(next);
    };
    this._raf = requestAnimationFrame(next);
  }

  // into the Cubby (its family with it)
  _save(i) {
    if (this.saved[i]) return;
    const k = this.kids[i], cubby = this.app.ui?.cubby;
    if (!cubby) return;
    cubby.add(k.c, false, { lin: k.lin });
    this.saved[i] = true;
    const b = this.kidsEl.children[i]?.querySelector('.cp-save');
    if (b) {
      b.textContent = 'Saved';
      b.disabled = true;
    }
    if (this.saved.every(Boolean)) {
      const both = this.el.querySelector('.cp-both');
      both.textContent = 'Saved both';
      both.disabled = true;
    }
  }
}
