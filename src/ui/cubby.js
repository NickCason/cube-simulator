// The Cubby: a shelf of saved cubes. Save the cube on show (a name and a
// little picture of it), tap one to put it back on, share one as a CubeR
// code (a link and a QR code), and open the codes other people send - from a
// link, or pasted in (an installed iPhone app doesn't get links: Safari does).

import { captureCube, encodeCube, decodeCube, cubeLink, cubeSummary, cleanName } from '../cubecode.js';
import { cubeName } from '../puns.js';
import { qrEncode, qrSVG } from './qr.js';
import { FighterCard } from './fighter.js';
import { resolveFlavor, layerBands, TEXTURES } from '../styles.js';

const KEY = 'cube-sim-cubby';
const ON_KEY = 'cube-sim-cubby-on'; // which saved cube is on show, and the record of one that isn't saved

const svg = (inner, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${inner}</svg>`;

const ICON = {
  cubby: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3.2"/><path d="M12 3.5v17M3.5 12h17"/><rect x="6.2" y="14.7" width="3.4" height="3.4" rx=".9" fill="currentColor" stroke="none"/><rect x="14.4" y="6.2" width="3.4" height="3.4" rx=".9" fill="currentColor" stroke="none"/>'),
  plus: svg('<path d="M12 5.5v13M5.5 12h13"/>'),
  die: svg('<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4"/><circle cx="8.6" cy="8.6" r="1.25" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="15.4" cy="15.4" r="1.25" fill="currentColor" stroke="none"/>'),
  more: svg('<circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
  share: svg('<path d="M12 15V4"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M6 11.5H5a1.5 1.5 0 0 0-1.5 1.5v5.5A1.5 1.5 0 0 0 5 20h14a1.5 1.5 0 0 0 1.5-1.5V13a1.5 1.5 0 0 0-1.5-1.5h-1"/>'),
  rename: svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 3 3"/>'),
  update: svg('<path d="M5 12.5 9.5 17 19 7.5"/>'),
  // (Re-cube's sparkle: a plus here read as one more "+ add")
  heal: svg('<path d="M11 3.5 12.7 8l4.6 1.7-4.6 1.7L11 16l-1.7-4.6-4.6-1.7L9.3 8z"/><path d="m18.5 14.5.8 2.1 2.2.8-2.2.8-.8 2.3-.8-2.3-2.2-.8 2.2-.8z"/>', ' fill="currentColor" stroke-width="1.2"'),
  qr: svg('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2"/>'),
};

const GLINT = { silver: ['#ffffff', '#dfe6ee'], gold: ['#fff1b8', '#ffd25f'], holo: ['#ff8fc0', '#7fe3ff', '#c2ff8f', '#d6a8ff'], rose: ['#ffe0dc', '#ffb3a8'] };

// A little cube in the cube's colours (layers as bands, glitter as glints):
// for shelf cards with no picture yet, and for codes that arrive.
export function cubeArt(c) {
  const f = resolveFlavor({ flavor: c.flavor, layers: c.layers });
  const bands = f.layers ? layerBands(f.layers, f.repeat, f.bias) : [{ color: f.hex, h0: 0, h1: 1 }];
  const t = TEXTURES[c.texture] || TEXTURES.jello;
  const solid = Math.min(1, t.opacity + t.milk * 0.6);
  let L = '', R = '';
  for (const b of bands) {
    const a0 = (46 - 28 * b.h0).toFixed(2), a1 = (46 - 28 * b.h1).toFixed(2), d0 = (58 - 28 * b.h0).toFixed(2), d1 = (58 - 28 * b.h1).toFixed(2);
    L += `<path d="M8 ${a0} 32 ${d0} 32 ${d1} 8 ${a1}Z" fill="${b.color}" stroke="${b.color}" stroke-width=".35"/>`;
    R += `<path d="M32 ${d0} 56 ${a0} 56 ${a1} 32 ${d1}Z" fill="${b.color}" stroke="${b.color}" stroke-width=".35"/>`;
  }
  const top = bands[bands.length - 1].color;
  let glints = '';
  const g = GLINT[c.glitter];
  if (g) {
    const spots = [[14, 30], [22, 41], [12, 44], [27, 50], [38, 36], [46, 29], [42, 47], [51, 40], [30, 17], [40, 15], [24, 14]];
    spots.forEach(([x, y], i) => (glints += `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.9 : 1.3}" fill="${g[i % g.length]}"/>`));
  }
  return (
    `<svg viewBox="4 3 56 58" aria-hidden="true"><g opacity="${(0.8 + 0.2 * solid).toFixed(2)}">` +
    `<path d="M32 6 56 18 32 30 8 18Z" fill="${top}"/><path d="M32 6 56 18 32 30 8 18Z" fill="#fff" opacity=".3"/>` +
    `${L}<path d="M8 18 32 30V58L8 46Z" fill="#fff" opacity="${(0.12 * (1 - solid)).toFixed(2)}"/>` +
    `${R}<path d="M56 18 32 30V58L56 46Z" fill="#000" opacity=".2"/></g>${glints}` +
    `<path d="M16.5 17.6 32 9.8l11.6 5.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".8"/></svg>`
  );
}

const isTouch = () => matchMedia('(pointer: coarse)').matches;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // (no clipboard API off https: the old way)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e2) {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export class Cubby {
  constructor(ui, app) {
    this.ui = ui;
    this.app = app;
    this.items = this._load();
    // the cube on show: a saved one (its id), or a loose one with its own record
    this.activeId = null;
    this.loose = {};
    try {
      const on = JSON.parse(localStorage.getItem(ON_KEY) || '{}');
      if (this.items.some((it) => it.id === on.id)) this.activeId = on.id;
      if (on.loose && typeof on.loose === 'object') this.loose = on.loose;
    } catch (e) {
      /* (fresh) */
    }
    const root = ui.root;
    root.insertAdjacentHTML(
      'beforeend',
      `<button class="cubby-btn" aria-label="Cubby: your saved cubes" title="Cubby (B)">${ICON.cubby}<span>Cubby</span></button>
      <div class="palette cubby" hidden role="dialog" aria-label="Cubby">
        <div class="cubby-head">
          <div class="cubby-title"><b>Cubby</b><span class="cubby-count"></span></div>
          <div class="cubby-head-acts">
            <button class="cubby-random" aria-label="Random cube" title="Random cube">${ICON.die}</button>
            <button class="cubby-save">${ICON.plus}<span>Save this cube</span></button>
          </div>
        </div>
        <form class="cubby-new" hidden>
          <div class="new-thumb"></div>
          <div class="new-side">
            <label class="lbl" for="cubby-name">Name it</label>
            <div class="new-name">
              <input id="cubby-name" maxlength="40" autocomplete="off" autocapitalize="words" enterkeyhint="done" spellcheck="false">
              <button type="button" class="dice" aria-label="Roll another name" title="Roll another name">${ICON.die}</button>
            </div>
            <div class="new-actions"><button type="button" class="ghost cancel">Cancel</button><button type="submit" class="primary">Cube it</button></div>
          </div>
        </form>
        <div class="cubby-scroll">
          <div class="cubby-grid"></div>
          <div class="cubby-empty" hidden>
            <div class="empty-art"></div>
            <b>Nothing in your Cubby yet</b>
            <span>Save the cube you've made and it waits here, picture and all. Someone sent you a CubeR code? Paste it below.</span>
          </div>
        </div>
        <form class="cubby-paste">
          <input placeholder="Paste a CubeR code or link" aria-label="CubeR code or link" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">
          <button type="submit">Open</button>
        </form>
      </div>
      <div class="card-menu" hidden role="menu">
        <button data-act="update" role="menuitem">${ICON.update}<span>Save changes</span></button>
        <button data-act="dropin" role="menuitem">${ICON.plus}<span>Drop in too</span></button>
        <button data-act="share" role="menuitem">${ICON.qr}<span>Share as CubeR code</span></button>
        <button data-act="rename" role="menuitem">${ICON.rename}<span>Rename</span></button>
        <button data-act="dice" role="menuitem" class="danger">${ICON.die}<span>Dice it</span></button>
      </div>
      <div class="toast" role="status" aria-live="polite"><span class="toast-msg"></span><span class="toast-acts"></span></div>
      <div class="modal cubed" hidden role="dialog" aria-modal="true" aria-labelledby="cubed-title">
        <div class="modal-card">
          <div class="cubed-art"></div>
          <h2 id="cubed-title">You've been cubed!</h2>
          <p class="cubed-name"></p>
          <p class="cubed-meta"></p>
          <div class="modal-actions">
            <button class="ghost later">Not now</button>
            <button class="soft keep">Save it</button>
            <button class="primary try">Try it</button>
          </div>
          <p class="cubed-app" hidden>Got Cube Simulator on your home screen? <button class="linkish copy">Copy this link</button> and paste it into the Cubby there.</p>
        </div>
      </div>
      <div class="modal share" hidden role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div class="modal-card">
          <button class="modal-x" aria-label="Close">${svg('<path d="M6 6l12 12M18 6 6 18"/>')}</button>
          <div class="share-head"><span class="share-art"></span><div><h2 id="share-title"></h2><span class="share-sub">CubeR code</span></div></div>
          <div class="share-qr"></div>
          <p class="share-tip">Point a phone camera at it, or send the link.</p>
          <div class="modal-actions">
            <button class="soft copy">Copy link</button>
            <button class="primary send">${ICON.share}<span>Send…</span></button>
          </div>
        </div>
      </div>`,
    );
    const $ = (s) => root.querySelector(s);
    this.btn = $('.cubby-btn');
    this.el = $('.palette.cubby');
    this.countEl = $('.cubby-count');
    this.newForm = $('.cubby-new');
    this.nameInput = $('#cubby-name');
    this.gridEl = $('.cubby-grid');
    this.emptyEl = $('.cubby-empty');
    this.pasteForm = $('.cubby-paste');
    this.pasteInput = this.pasteForm.querySelector('input');
    this.menuEl = $('.card-menu');
    this.toastEl = $('.toast');
    this.cubedEl = $('.modal.cubed');
    this.shareEl = $('.modal.share');
    this.randomBtn = $('.cubby-random');
    this.fighter = new FighterCard(root, app);
    this.emptyEl.querySelector('.empty-art').innerHTML = cubeArt({ flavor: 'layers', layers: { colors: ['#b39ddb', '#90caf9', '#a5d6a7', '#fff59d', '#ffcc80', '#f48fb1'], blur: 0.45, repeat: 1, bias: 0 }, texture: 'gummy', glitter: 'holo' });

    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      if (this.el.hidden) this.open();
      else this.close();
    });
    $('.cubby-save').addEventListener('click', () => {
      app.audio.ui();
      this.startSave();
    });
    this.randomBtn.addEventListener('click', () => {
      app.audio.ui();
      this.randomBtn.classList.remove('roll');
      void this.randomBtn.offsetWidth;
      this.randomBtn.classList.add('roll');
      const pool = this.items.filter((it) => it.id !== this.activeId);
      if (pool.length) this.wear(pool[Math.floor(Math.random() * pool.length)], 'Random select!');
    });
    this.newForm.querySelector('.dice').addEventListener('click', (e) => {
      app.audio.ui();
      const d = e.currentTarget;
      d.classList.remove('roll');
      void d.offsetWidth;
      d.classList.add('roll');
      this.nameInput.value = this._suggest(this.nameInput.value);
    });
    this.newForm.querySelector('.cancel').addEventListener('click', () => this.endSave());
    this.newForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.commitSave();
    });
    this.pasteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = decodeCube(this.pasteInput.value);
      if (!c) {
        this.pasteInput.classList.remove('bad');
        void this.pasteInput.offsetWidth;
        this.pasteInput.classList.add('bad');
        this.toast("That isn't a CubeR code - try the whole link");
        return;
      }
      this.pasteInput.value = '';
      this.pasteInput.blur();
      this.offer(c, null);
    });
    this.pasteInput.addEventListener('input', () => this.pasteInput.classList.remove('bad'));
    this.menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const item = this.items.find((it) => it.id === this._menuFor);
      this.closeMenu();
      if (!item) return;
      app.audio.ui();
      if (b.dataset.act === 'dropin') this.dropIn(item);
      else if (b.dataset.act === 'update') this.update(item);
      else if (b.dataset.act === 'share') this.share(item);
      else if (b.dataset.act === 'rename') this.rename(item);
      else if (b.dataset.act === 'dice') this.remove(item);
    });
    // the "you've been cubed" card
    this.cubedEl.querySelector('.later').addEventListener('click', () => this.closeModal(this.cubedEl));
    this.cubedEl.querySelector('.try').addEventListener('click', () => {
      app.audio.ui();
      const c = this._offered;
      this.closeModal(this.cubedEl);
      if (!c) return;
      const back = this._state();
      this._setOn(null, {});
      this._swapTo(c, 'A new challenger approaches!', null, [
        { label: 'Save', run: () => this.add(c, true) },
        { label: 'Undo', run: () => this._restore(back) },
      ]);
    });
    this.cubedEl.querySelector('.keep').addEventListener('click', () => {
      app.audio.ui();
      const c = this._offered;
      this.closeModal(this.cubedEl);
      if (c) this.add(c, false);
    });
    this.cubedEl.querySelector('.copy').addEventListener('click', async () => {
      const ok = await copyText(this._offeredLink || cubeLink(this._offered));
      this.toast(ok ? 'Link copied - now paste it into the app’s Cubby' : "Couldn't copy - press and hold the address bar instead");
    });
    // the share card
    this.shareEl.querySelector('.modal-x').addEventListener('click', () => this.closeModal(this.shareEl));
    this.shareEl.querySelector('.copy').addEventListener('click', async () => {
      app.audio.ui();
      const ok = await copyText(this._shareLink);
      this.toast(ok ? 'Link copied - send it to someone who needs a cube' : "Couldn't copy the link here");
    });
    this.shareEl.querySelector('.send').addEventListener('click', async () => {
      app.audio.ui();
      try {
        await navigator.share({ title: `${this._shareName} · Cube Simulator`, text: `I made you a cube: “${this._shareName}”`, url: this._shareLink });
      } catch (e) {
        /* (dismissed) */
      }
    });
    for (const m of [this.cubedEl, this.shareEl]) {
      m.addEventListener('pointerdown', (e) => {
        if (e.target === m) this.closeModal(m);
      });
    }
    document.addEventListener('pointerdown', (e) => {
      if (!this.menuEl.hidden && !this.menuEl.contains(e.target) && !e.target.closest('.card-more')) this.closeMenu();
      if (this.el.hidden || this.el.contains(e.target) || this.btn.contains(e.target)) return;
      if (this.menuEl.contains(e.target) || this.toastEl.contains(e.target) || e.target.closest('.modal, .fighter')) return;
      this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!this.shareEl.hidden) this.closeModal(this.shareEl);
        else if (!this.cubedEl.hidden) this.closeModal(this.cubedEl);
        else if (!this.menuEl.hidden) this.closeMenu();
        else if (!this.newForm.hidden) this.endSave();
        else if (!this.el.hidden) this.close();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'b' || e.key === 'B') && !e.repeat) {
        if (this.el.hidden) this.open();
        else this.close();
      }
    });
    // (records are written a moment after they change, and as the page goes)
    window.addEventListener('pagehide', () => this._flush());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this._flush());
    this.render();
    // a link with a code in it (now, or pasted into the address bar later)
    this._incoming();
    window.addEventListener('hashchange', () => this._incoming());
  }

  // ---- the shelf
  _load() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(a)) return [];
      const ok = a.filter((it) => it && typeof it.code === 'string' && decodeCube(it.code));
      for (const it of ok) if (!it.rec || typeof it.rec !== 'object') it.rec = {};
      return ok;
    } catch (e) {
      return [];
    }
  }

  _store() {
    clearTimeout(this._st);
    this._st = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.items.map(({ id, code, thumb, at, rec }) => ({ id, code, thumb, at, rec }))));
      localStorage.setItem(ON_KEY, JSON.stringify({ id: this.activeId, loose: this.loose }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // (a burst of nail shots writes once)
  _soon() {
    if (!this._st) this._st = setTimeout(() => this._store(), 1500);
  }

  _flush() {
    if (this._st) this._store();
  }

  get active() {
    return this.items.find((it) => it.id === this.activeId) || null;
  }

  _setOn(id, loose) {
    this.activeId = id;
    this.loose = loose;
  }

  // what Undo puts back: the cube, which one it was, its loose record
  _state() {
    return { cube: captureCube(this.app, this.active ? decodeCube(this.active.code)?.name : ''), id: this.activeId, loose: { ...this.loose } };
  }

  _restore(st) {
    this.app.loadCube(st.cube);
    this._setOn(this.items.some((it) => it.id === st.id) ? st.id : null, st.loose);
    this._store();
    this.render();
  }

  // A deed for the record of the cube on show.
  tally(kind) {
    const it = this.active;
    const rec = it ? it.rec : this.loose;
    rec[kind] = (rec[kind] || 0) + 1;
    this._soon();
    if (kind === 'healed' && it && !this.el.hidden) this.render();
  }

  // the cube on show differs from its saved self (a slider moved, ...)
  _edited(it) {
    const c = decodeCube(it.code);
    return encodeCube(captureCube(this.app, c.name)) !== encodeCube({ ...c, version: undefined });
  }

  get names() {
    return this.items.map((it) => decodeCube(it.code)?.name || '');
  }

  _suggest(not = '') {
    const c = captureCube(this.app);
    const taken = [...this.names, not];
    return cubeName(c, taken);
  }

  open() {
    this.ui.closePalette();
    this.ui.closeTune();
    this.ui.stack?.close();
    this.fighter.hide();
    this.el.hidden = false;
    this.btn.classList.add('open');
    this.render();
  }

  close() {
    this.el.hidden = true;
    this.btn.classList.remove('open');
    this.endSave();
    this.closeMenu();
  }

  render() {
    const n = this.items.length;
    this.countEl.textContent = n ? `${n} ${n === 1 ? 'cube' : 'cubes'}` : '';
    this.emptyEl.hidden = n > 0;
    this.gridEl.hidden = false;
    this.gridEl.textContent = '';
    // (first: another cube into the room, a plain jelly in a random flavour)
    const add = document.createElement('div');
    add.className = 'cube-card add-card';
    add.innerHTML = `<button class="card-main"><span class="card-thumb">${ICON.plus}</span><span class="card-name">Jelly cube</span><span class="card-sub">Drop one in</span></button>`;
    add.querySelector('.card-main').setAttribute('aria-label', 'Drop another jelly cube into the room');
    add.querySelector('.card-main').addEventListener('click', () => {
      this.app.audio.ui();
      if (this.app.addCube() >= 0 && window.innerWidth <= 720) this.close();
    });
    this.gridEl.appendChild(add);
    for (const it of this.items) this.gridEl.appendChild(this._card(it));
    this.randomBtn.hidden = this.items.filter((it) => it.id !== this.activeId).length < 2;
  }

  _card(it) {
    const c = decodeCube(it.code);
    const card = document.createElement('div');
    card.className = it.id === this.activeId ? 'cube-card on' : 'cube-card';
    card.dataset.id = it.id;
    card.innerHTML = `<button class="card-main"><span class="card-thumb"></span><span class="card-name"></span><span class="card-sub"></span></button><button class="card-more">${ICON.more}</button><button class="card-drop" title="Drop it into the room too">${ICON.plus}</button>`;
    if (it.id === this.activeId) card.insertAdjacentHTML('beforeend', '<span class="card-on">On</span>');
    if (it.rec.healed) card.insertAdjacentHTML('beforeend', `<span class="card-healed" title="Times re-cubed">${ICON.heal}${it.rec.healed}</span>`);
    const main = card.querySelector('.card-main'), thumb = card.querySelector('.card-thumb');
    if (it.thumb) {
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.src = it.thumb;
      thumb.appendChild(img);
    } else thumb.innerHTML = cubeArt(c);
    card.querySelector('.card-name').textContent = c.name || 'Untitled cube';
    card.querySelector('.card-sub').textContent = cubeSummary(c);
    main.setAttribute('aria-label', `Put on ${c.name || 'this cube'}`);
    main.addEventListener('click', () => {
      this.app.audio.ui();
      this.wear(it);
    });
    // (+: this one into the room too, beside what's there)
    const drop = card.querySelector('.card-drop');
    drop.setAttribute('aria-label', `Drop ${c.name || 'this cube'} into the room too`);
    drop.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.audio.ui();
      this.dropIn(it);
    });
    const more = card.querySelector('.card-more');
    more.setAttribute('aria-label', `More for ${c.name || 'this cube'}`);
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.audio.ui();
      if (!this.menuEl.hidden && this._menuFor === it.id) this.closeMenu();
      else this.openMenu(it, more);
    });
    return card;
  }

  // ---- saving
  startSave() {
    this.closeMenu();
    const shot = this.app.snapshot();
    const box = this.newForm.querySelector('.new-thumb');
    box.textContent = '';
    if (shot) {
      const img = new Image();
      img.alt = '';
      img.src = shot;
      box.appendChild(img);
    } else box.innerHTML = cubeArt(captureCube(this.app));
    this._shot = shot;
    this.nameInput.value = this._suggest();
    this.newForm.hidden = false;
    this.emptyEl.hidden = true;
    if (!isTouch()) {
      this.nameInput.focus();
      this.nameInput.select();
    }
  }

  endSave() {
    this.newForm.hidden = true;
    this.emptyEl.hidden = this.items.length > 0;
    this._shot = null;
    if (document.activeElement === this.nameInput) this.nameInput.blur();
  }

  commitSave() {
    const name = cleanName(this.nameInput.value) || this._suggest();
    const c = captureCube(this.app, name);
    const thumb = this._shot;
    this.endSave();
    // (the cube on show is this one now; an unsaved cube's record comes with it)
    this._put({ id: this._id(), code: encodeCube(c), thumb, at: Date.now(), rec: { ...this.loose } }, `Cubed! “${name}” is in your Cubby`, null, true);
  }

  // keep a cube that came in a code (a picture of it now, and the record of
  // its time on show so far, if it's the one on show)
  add(c, onShow) {
    const name = cleanName(c.name) || this._suggest();
    const item = { id: this._id(), code: encodeCube({ ...c, name }), thumb: onShow ? this.app.snapshot() : null, at: Date.now(), rec: onShow ? { ...this.loose } : {} };
    this._put(item, `Saved “${name}” to your Cubby`, onShow ? null : [{ label: 'Open', run: () => this.open() }], onShow);
  }

  _put(item, msg, actions = null, onShow = false) {
    const was = { id: this.activeId, loose: this.loose };
    this.items.unshift(item);
    if (onShow) this._setOn(item.id, {});
    if (!this._store()) {
      // (storage full: try without the picture, else give up)
      item.thumb = null;
      if (!this._store()) {
        this.items.shift();
        this._setOn(was.id, was.loose);
        this.toast('Your Cubby is full - dice a few cubes to make room');
        return;
      }
    }
    this.render();
    this.gridEl.firstElementChild?.classList.add('fresh');
    this.btn.classList.remove('bump');
    void this.btn.offsetWidth;
    this.btn.classList.add('bump');
    this.toast(msg, actions);
  }

  _id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---- a card's actions
  // Pick a cube like a fighter: the one on show leaves, this one drops in,
  // and its card goes up. (The one already on show: just its card.)
  wear(it, kicker = 'Cube select') {
    const c = decodeCube(it.code);
    if (!c) return;
    if (it.id === this.activeId && !this.app.swapper.active && !this._edited(it)) {
      this.fighter.show(c, { kicker: 'On show', rec: it.rec });
      return;
    }
    const back = this._state();
    it.rec.picked = (it.rec.picked || 0) + 1;
    this._setOn(it.id, {});
    this.app.cube.name = c.name || ''; // (its name in the stack)
    this._store();
    this.render();
    this._swapTo(c, kicker, it.rec, [{ label: 'Undo', run: () => this._restore(back) }], it);
  }

  // the swap itself, then the card (on a phone, the shelf steps aside for it)
  _swapTo(c, kicker, rec, actions, it = null) {
    if (window.innerWidth <= 720) this.close();
    this.fighter.hide();
    this._hideToast();
    this.app.swapCube(c, () => {
      this.fighter.show(c, { kicker, rec, actions });
      // (a cube kept from a code gets its picture once it's been on show)
      if (it && !it.thumb) {
        setTimeout(() => {
          if (!this.items.includes(it) || it.thumb || this.app.swapper.active) return;
          it.thumb = this.app.snapshot();
          if (it.thumb && this._store()) this.render();
        }, 1300);
      }
    });
  }

  // another cube into the room: this one, dropped in beside the others
  dropIn(it) {
    const c = decodeCube(it.code);
    if (!c) return;
    const slot = this.app.addCube(c);
    if (slot < 0) return;
    const cb = this.app.cubes.find((x) => x.slot === slot);
    if (cb) cb.name = c.name || '';
    this.app.ui.cubesChanged();
    if (window.innerWidth <= 720) this.close();
  }

  // the cube on show, as it is now, into its saved slot (record kept)
  update(it) {
    const c = decodeCube(it.code);
    it.code = encodeCube(captureCube(this.app, c.name));
    it.thumb = this.app.snapshot() || it.thumb;
    this._store();
    this.render();
    this.toast(`Saved changes to “${c.name || 'this cube'}”`);
  }

  openMenu(it, anchor) {
    this._menuFor = it.id;
    this.menuEl.querySelector('[data-act="update"]').hidden = !(it.id === this.activeId && this._edited(it));
    this.menuEl.hidden = false;
    const r = anchor.getBoundingClientRect(), m = this.menuEl.getBoundingClientRect();
    const x = Math.min(window.innerWidth - m.width - 8, Math.max(8, r.right - m.width));
    const below = r.bottom + 6 + m.height < window.innerHeight - 8;
    this.menuEl.style.left = `${x}px`;
    this.menuEl.style.top = `${below ? r.bottom + 6 : r.top - 6 - m.height}px`;
  }

  closeMenu() {
    this.menuEl.hidden = true;
    this._menuFor = null;
  }

  rename(it) {
    const card = this.gridEl.querySelector(`.cube-card[data-id="${it.id}"]`);
    if (!card) return;
    const c = decodeCube(it.code);
    const nameEl = card.querySelector('.card-name');
    const input = document.createElement('input');
    input.className = 'card-rename';
    input.maxLength = 40;
    input.value = c.name;
    input.setAttribute('aria-label', 'New name');
    input.setAttribute('enterkeyhint', 'done');
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const name = cleanName(input.value);
      if (keep && name && name !== c.name) {
        it.code = encodeCube({ ...c, name });
        this._store();
      }
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  remove(it) {
    const i = this.items.indexOf(it);
    if (i < 0) return;
    const was = { id: this.activeId, loose: this.loose };
    this.items.splice(i, 1);
    // (diced while on show: it stays on, unsaved, with its record)
    if (it.id === this.activeId) this._setOn(null, { ...it.rec });
    this._store();
    this.render();
    const name = decodeCube(it.code)?.name || 'that cube';
    this.toast(`Diced “${name}”`, [
      {
        label: 'Undo',
        run: () => {
          this.items.splice(Math.min(i, this.items.length), 0, it);
          this._setOn(was.id, was.loose);
          this._store();
          this.render();
        },
      },
    ]);
  }

  share(it) {
    const c = decodeCube(it.code);
    this._shareLink = cubeLink(c);
    this._shareName = c.name || 'A cube';
    this.shareEl.querySelector('#share-title').textContent = this._shareName;
    const art = this.shareEl.querySelector('.share-art');
    art.textContent = '';
    if (it.thumb) {
      const img = new Image();
      img.alt = '';
      img.src = it.thumb;
      art.appendChild(img);
    } else art.innerHTML = cubeArt(c);
    this.shareEl.querySelector('.share-qr').innerHTML = qrSVG(qrEncode(this._shareLink, { level: 'M' }));
    this.shareEl.querySelector('.share-qr svg').setAttribute('aria-label', `CubeR code for ${this._shareName}`);
    this.shareEl.querySelector('.send').hidden = !navigator.share;
    this.openModal(this.shareEl);
  }

  // ---- codes coming in
  _incoming() {
    const c = decodeCube(location.hash);
    if (!c) return;
    const link = location.href;
    // (opened once: a reload shouldn't ask again)
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
      /* (sandboxed) */
    }
    this.offer(c, link);
  }

  // "You've been cubed!": try it, keep it, or not now (shown once the intro's done)
  offer(c, link) {
    this._offered = c;
    this._offeredLink = link || cubeLink(c);
    const show = () => {
      if (!this.app.intro?.done || document.documentElement.classList.contains('splashing')) {
        setTimeout(show, 250);
        return;
      }
      this.cubedEl.querySelector('.cubed-art').innerHTML = cubeArt(c);
      this.cubedEl.querySelector('.cubed-name').textContent = c.name ? `“${c.name}”` : 'A brand-new cube';
      this.cubedEl.querySelector('.cubed-meta').textContent = cubeSummary(c, true);
      // (an iPhone opens links in Safari, never in the home-screen app)
      this.cubedEl.querySelector('.cubed-app').hidden = !link || standalone() || !isTouch();
      this.openModal(this.cubedEl);
    };
    show();
  }

  openModal(m) {
    this.closeMenu();
    m.hidden = false;
    this.app.audio.init();
    requestAnimationFrame(() => m.querySelector('.primary:not([hidden])')?.focus({ preventScroll: true }));
  }

  closeModal(m) {
    m.hidden = true;
  }

  // ---- a note at the top, with a button or two (Undo, Save)
  toast(msg, actions = null, ms = 5200) {
    const el = this.toastEl;
    el.querySelector('.toast-msg').textContent = msg;
    const acts = el.querySelector('.toast-acts');
    acts.textContent = '';
    for (const a of actions || []) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        this.app.audio.ui();
        this._hideToast();
        a.run();
      });
      acts.appendChild(b);
    }
    el.classList.toggle('has-acts', !!actions?.length);
    el.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this._hideToast(), actions?.length ? ms + 1800 : ms);
  }

  _hideToast() {
    clearTimeout(this._tt);
    this.toastEl.classList.remove('show');
  }

  // fraction of the screen a bottom sheet covers (phones)
  get cover() {
    if (this.el.hidden || window.innerWidth > 720) return 0;
    const r = this.el.getBoundingClientRect();
    return Math.max(0, (window.innerHeight - r.top) / window.innerHeight);
  }
}
