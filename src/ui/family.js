// The family tree (the Cubby's): every cube that's cubiplied and what came
// of it, generation under generation - each with its picture, its name,
// what mutated in it when it was born, and whether it's in the room or in
// the Cubby. Tap one to put it on, drop it in too, or keep it.

import { familyTrees } from '../family.js';
import { decodeCube } from '../cubecode.js';
import { TIER } from '../genetics.js';
import { cubeArt } from './cubby.js';

export const TREE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="5" rx="1.2"/><rect x="2.5" y="16.5" width="6" height="5" rx="1.2"/><rect x="15.5" y="16.5" width="6" height="5" rx="1.2"/><path d="M12 7.5v4.5M5.5 16.5V12h13v4.5"/></svg>`;

export class FamilyView {
  constructor(cubby, app, root) {
    this.cubby = cubby;
    this.app = app;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="modal family" hidden role="dialog" aria-modal="true" aria-labelledby="fam-title">
        <div class="modal-card fam-card">
          <h2 id="fam-title">Family tree</h2>
          <p class="fam-sub">Every cube that's cubiplied, and what came of it</p>
          <div class="fam-trees"></div>
          <div class="modal-actions"><button class="primary fam-done">Done</button></div>
        </div>
      </div>`,
    );
    this.el = root.querySelector('.modal.family');
    this.treesEl = this.el.querySelector('.fam-trees');
    this.el.querySelector('.fam-done').addEventListener('click', () => this.close());
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
    this.pics = new Map(); // (portraits taken this time round, by id)
  }

  get any() {
    return familyTrees().length > 0;
  }

  open() {
    this.cubby.openModal(this.el);
    this.render();
  }

  close() {
    this.cubby.closeModal(this.el);
    cancelAnimationFrame(this._raf);
  }

  render() {
    const trees = familyTrees(), app = this.app;
    const saved = new Map(this.cubby.items.filter((it) => it.lin?.id).map((it) => [it.lin.id, it]));
    const inRoom = new Set(app.cubes.map((cb) => cb.lin?.id).filter(Boolean));
    this.treesEl.textContent = '';
    const want = [];
    const node = (t) => {
      const r = t.rec, li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'fam-row';
      const c = r.code ? decodeCube(r.code) : null;
      const top = (r.changes || []).reduce((a, x) => (x.tier > a.tier ? x : a), { tier: -1 });
      row.innerHTML = `<span class="fam-pic"></span><span class="fam-who"><b></b><span class="fam-meta"></span></span><span class="fam-tags"></span>`;
      const pic = row.querySelector('.fam-pic'), it = saved.get(r.id);
      const known = (it && it.thumb) || this.pics.get(r.id);
      if (known) pic.innerHTML = `<img alt="" src="${known}">`;
      else {
        if (c) pic.innerHTML = cubeArt(c);
        if (c) want.push({ id: r.id, c, pic });
      }
      row.querySelector('b').textContent = r.name || 'A cube';
      row.querySelector('.fam-meta').textContent = r.gen ? `Generation ${r.gen}` : 'The first';
      const tags = row.querySelector('.fam-tags');
      if (top.tier >= TIER.MUTATION) tags.insertAdjacentHTML('beforeend', `<span class="fam-tag t${top.tier}"></span>`);
      if (top.tier >= TIER.MUTATION) tags.lastElementChild.textContent = top.label;
      if (inRoom.has(r.id)) tags.insertAdjacentHTML('beforeend', '<span class="fam-tag here">In the room</span>');
      else if (it) tags.insertAdjacentHTML('beforeend', '<span class="fam-tag kept">Saved</span>');
      if (r.split && !inRoom.has(r.id)) tags.insertAdjacentHTML('beforeend', '<span class="fam-tag gone">Cubiplied</span>');
      // (tapped: what you can do with it)
      if (c) {
        const acts = document.createElement('div');
        acts.className = 'fam-acts';
        acts.hidden = true;
        const lin = { id: r.id, parent: r.parent || null, gen: r.gen | 0 };
        const add = (label, run) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            app.audio.ui();
            run();
          });
          acts.appendChild(b);
        };
        add('Put on', () => {
          this.close();
          this.cubby.tryMember(c, lin, it);
        });
        add('Drop in', () => {
          this.close();
          const slot = app.addCube(c);
          const cb = app.cubes.find((x) => x.slot === slot);
          if (cb) cb.lin = lin;
          app.ui.cubesChanged();
        });
        if (!it) add('Save', () => {
          this.cubby.add(c, false, { lin });
          this.render();
        });
        row.addEventListener('click', () => {
          app.audio.ui();
          const was = !acts.hidden;
          for (const a of this.treesEl.querySelectorAll('.fam-acts')) a.hidden = true;
          acts.hidden = was;
        });
        li.append(row, acts);
      } else li.append(row);
      if (t.kids.length) {
        const ul = document.createElement('ul');
        for (const k of t.kids) ul.appendChild(node(k));
        li.appendChild(ul);
      }
      return li;
    };
    for (const t of trees) {
      const ul = document.createElement('ul');
      ul.className = 'fam-tree';
      ul.appendChild(node(t));
      this.treesEl.appendChild(ul);
    }
    if (!trees.length) this.treesEl.innerHTML = '<p class="fam-none">Feed a cube with the ladle till it cubiplies, and its family starts here.</p>';
    // (portraits for those without, one a frame)
    cancelAnimationFrame(this._raf);
    const next = () => {
      if (this.el.hidden) return;
      const w = want.shift();
      if (!w) return;
      const url = app.portrait(w.c, 120, { fill: 0.8, lean: 0.07 });
      if (url) {
        this.pics.set(w.id, url);
        w.pic.innerHTML = `<img alt="" src="${url}">`;
      }
      this._raf = requestAnimationFrame(next);
    };
    this._raf = requestAnimationFrame(next);
  }
}
