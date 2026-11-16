// Cublication's screen (see cublication.js): its bar - how wild its mutations, the family tree, Start / Pause / Go on
// from here; over it the line - a strip of the generations in their colours, the one on show marked, dragged along to
// go back through them; over the dish its generation, counted up with each one kept, ringed with how far it is to
// dividing; the two of them as they're born, a card to keep one from (left be, the one it'd keep is kept as its time
// runs out); and the tree - the line from the first down, each generation with the twin that went, the branches it
// left where it was gone back to and gone on from.

import { MUTATION } from '../cublication.js';
import { settingWord } from '../settings.js';
import { TIER, topTier } from '../genetics.js';
import { resolveFlavor, flavorMainHex } from '../styles.js';
import { cubeArt } from './cubby.js';
import { TREE_ICON } from './family.js';

export const CUBL_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="17.5" rx="9.5" ry="3.2"/><rect x="4.6" y="7.5" width="6" height="6" rx="1.7"/><rect x="13.4" y="7.5" width="6" height="6" rx="1.7"/><path d="M10.6 10.5h2.8M12 4v1.6"/></svg>`;

const TIER_CLASS = ['t0', 't1', 't2', 't3'];
const RING = 2 * Math.PI * 26; // (the generation's ring: its circumference, r 26)
const PICK_T = 3.4; // (as the mode's: its countdown drawn)
const BUSY = ['divide', 'pick', 'part'];

// (a cube's main colour, as CSS)
const colOf = (c) => flavorMainHex(resolveFlavor({ flavor: c.flavor, layers: c.layers }));
// (what mutated, biggest first - the drifts only if there's nothing else, two of them)
function chipsOf(changes, max = 3) {
  const L = [...(changes || [])].sort((a, b) => b.tier - a.tier), big = L.filter((x) => x.tier > TIER.DRIFT);
  return (big.length ? big : L.slice(0, 2)).slice(0, max);
}
function chipEl(c) {
  const el = document.createElement('span'), t = document.createElement('span');
  el.className = `cu-chip ${TIER_CLASS[c.tier] || 't0'}`;
  if (c.color) el.innerHTML = `<i style="background:${c.color}"></i>`;
  t.textContent = c.label;
  el.appendChild(t);
  return el;
}

export class CublicationBar {
  constructor(exhibit, app, root) {
    this.app = app;
    this._raf = 0;
    this._lastGen = -1;
    this._showAt = 0;
    this._want = -1;
    this._drag = false;
    this._lineSig = '';
    const M = app.cublication;
    // the bar
    const bar = (this.bar = document.createElement('div'));
    bar.className = 'drop-bar cubl-bar';
    bar.hidden = true;
    bar.innerHTML = `<button class="db-exit" aria-label="Back to the lab" title="Back to the lab">&times;</button>
      <div class="ps-sets">
        <label class="cu-mut"><span class="cu-cap">Mutation <b></b></span><input type="range" min="0" max="1" step="0.01" aria-label="How much each child's changed from its parent"></label>
      </div>
      <button class="cu-tree" aria-label="The family tree" title="The family tree">${TREE_ICON}</button>
      <button class="db-go">Start</button>`;
    root.appendChild(bar);
    this.mut = bar.querySelector('.cu-mut input');
    this.mutOut = bar.querySelector('.cu-cap b');
    this.go = bar.querySelector('.db-go');
    this.treeBtn = bar.querySelector('.cu-tree');
    bar.querySelector('.db-exit').addEventListener('click', () => {
      app.audio.ui();
      exhibit.exitCublication();
    });
    this.mut.addEventListener('input', () => {
      M.setMutation(MUTATION.to(+this.mut.value));
      this._sets();
    });
    this.go.addEventListener('click', () => {
      app.audio.init();
      app.audio.ui();
      if (M.running) M.pause();
      else M.go();
    });
    this.treeBtn.addEventListener('click', () => {
      app.audio.ui();
      this.openTree();
    });
    // over the bar, the line; over the dish, its generation; the card; the tree
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="cubl-line" hidden>
        <div class="cl-segs" role="slider" tabindex="0" aria-label="The generations - drag back through them"></div>
        <span class="cl-knob" aria-hidden="true"></span>
      </div>
      <div class="cubl-hud" hidden aria-live="polite">
        <div class="ch-gen"><svg viewBox="0 0 60 60" aria-hidden="true"><circle class="ch-bg" cx="30" cy="30" r="26"/><circle class="ch-fg" cx="30" cy="30" r="26"/></svg><span class="ch-k">GEN</span><b class="ch-n">0</b></div>
        <div class="ch-name"></div>
        <div class="ch-chips"></div>
      </div>
      <div class="cubl-pick" hidden role="dialog" aria-label="Keep one">
        <div class="cpk-kicker"></div>
        <div class="cpk-kids"></div>
        <div class="cpk-timer"><i></i></div>
      </div>
      <div class="modal cubl-tree" hidden role="dialog" aria-modal="true" aria-labelledby="ct-title">
        <div class="modal-card ct-card">
          <h2 id="ct-title">Family tree</h2>
          <p class="ct-sub"></p>
          <div class="ct-list"></div>
          <div class="modal-actions"><button class="primary ct-done">Done</button></div>
        </div>
      </div>`,
    );
    this.line = root.querySelector('.cubl-line');
    this.segs = this.line.querySelector('.cl-segs');
    this.knob = this.line.querySelector('.cl-knob');
    this.hud = root.querySelector('.cubl-hud');
    this.ring = this.hud.querySelector('.ch-fg');
    this.ring.style.strokeDasharray = `${RING}`;
    this.hudN = this.hud.querySelector('.ch-n');
    this.hudGen = this.hud.querySelector('.ch-gen');
    this.hudName = this.hud.querySelector('.ch-name');
    this.hudChips = this.hud.querySelector('.ch-chips');
    this.pickEl = root.querySelector('.cubl-pick');
    this.pickKids = this.pickEl.querySelector('.cpk-kids');
    this.pickTimer = this.pickEl.querySelector('.cpk-timer i');
    this.tree = root.querySelector('.modal.cubl-tree');
    this.treeList = this.tree.querySelector('.ct-list');
    this.tree.querySelector('.ct-done').addEventListener('click', () => this.closeTree());
    this.tree.addEventListener('pointerdown', (e) => {
      if (e.target === this.tree) this.closeTree();
    });
    // the line dragged along (or tapped, or stepped with the arrow keys): back through the generations - each one's
    // look eased into, no more than one so often while it's dragged, the last where it's let go
    const at = (e) => {
      const r = this.segs.getBoundingClientRect(), n = M.gens.length;
      return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * n)));
    };
    this.segs.addEventListener('pointerdown', (e) => {
      if (BUSY.includes(M.phase) || M.gens.length < 2) return;
      this._drag = true;
      this.segs.setPointerCapture?.(e.pointerId);
      this._wantGen(at(e));
    });
    this.segs.addEventListener('pointermove', (e) => {
      if (this._drag) this._wantGen(at(e));
    });
    const up = () => {
      if (!this._drag) return;
      this._drag = false;
      this._showWanted();
    };
    this.segs.addEventListener('pointerup', up);
    this.segs.addEventListener('pointercancel', up);
    this.segs.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (!d || BUSY.includes(M.phase)) return;
      e.preventDefault();
      this._wantGen(Math.max(0, Math.min(M.gens.length - 1, (this._want >= 0 ? this._want : M.view) + d)));
      this._showWanted();
    });
    M.onChange = (phase) => this._sync(phase);
    M.onBirth = (P) => this._born(P);
  }

  show() {
    const M = this.app.cublication;
    this.bar.hidden = false;
    this.hud.hidden = false;
    this.mut.value = String(MUTATION.from(M.mutation));
    this._lastGen = -1;
    this._lineSig = '';
    this._sets();
    this._sync(M.phase);
    cancelAnimationFrame(this._raf);
    const tick = () => {
      if (!M.on) return;
      this._tick();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  hide() {
    this.bar.hidden = true;
    this.hud.hidden = true;
    this.line.hidden = true;
    this.pickEl.hidden = true;
    this.closeTree();
    cancelAnimationFrame(this._raf);
  }

  _wantGen(i) {
    this._want = i;
    this._knob(i);
    if (performance.now() - this._showAt > 110) this._showWanted();
  }

  _showWanted() {
    const M = this.app.cublication;
    if (this._want < 0) return;
    this._showAt = performance.now();
    M.showGen(this._want);
    this._want = -1;
    this._knob(M.view);
  }

  _sets() {
    const M = this.app.cublication, t = +this.mut.value;
    this.mutOut.textContent = settingWord(MUTATION, M.mutation);
    this.mut.style.setProperty('--p', `${t * 100}%`);
  }

  // (the bar as the mode is now: its button, its line, what can be touched)
  _sync(phase) {
    const M = this.app.cublication;
    if (!M.on) return;
    const n = M.gens.length - 1;
    this.go.textContent = M.running ? 'Pause' : M.view < n ? 'Go from here' : n > 0 || phase === 'feed' ? 'Go on' : 'Start';
    this.go.classList.toggle('let', !M.running && M.view < n);
    if (phase !== 'pick' && !this.pickEl.hidden && !this.pickEl.classList.contains('done')) this._picked();
    this._line();
    this._hud();
  }

  // (the line: a strip of the generations in their colours - those past the one on show dimmed, as they'd be left for
  // a branch going on from it - and its knob on that one)
  _line() {
    const M = this.app.cublication, G = M.gens, n = G.length, sig = G.map((g) => g.id).join(',');
    if (sig !== this._lineSig) {
      this._lineSig = sig;
      this.segs.textContent = '';
      this.segs.classList.toggle('dense', n > 24);
      for (const g of G) {
        const d = document.createElement('i'), tier = topTier(g.changes || []);
        d.className = `cl-seg${tier >= TIER.MAJOR ? ' t' + tier : ''}`;
        d.style.background = colOf(g.c);
        this.segs.appendChild(d);
      }
    }
    [...this.segs.children].forEach((d, i) => d.classList.toggle('after', i > M.view));
    this.line.hidden = n < 2 || !this.pickEl.hidden;
    this.line.classList.toggle('busy', BUSY.includes(M.phase));
    this.segs.setAttribute('aria-valuemin', '0');
    this.segs.setAttribute('aria-valuemax', String(n - 1));
    this.segs.setAttribute('aria-valuenow', String(M.view));
    this._knob(this._want >= 0 ? this._want : M.view);
  }

  _knob(i) {
    const d = this.segs.children[i];
    if (!d) return;
    this.knob.style.transform = `translateX(${d.offsetLeft + d.offsetWidth / 2}px)`;
    this.knob.style.background = d.style.background;
  }

  // (over the dish: the generation on show - counted up, a flip, when it's a new one)
  _hud() {
    const M = this.app.cublication, G = M.shown;
    if (!G || G.gen === this._lastGen) return;
    this.hudN.textContent = String(G.gen);
    if (this._lastGen >= 0) {
      this.hudGen.classList.remove('flip');
      void this.hudGen.offsetWidth;
      this.hudGen.classList.add('flip');
    }
    this._lastGen = G.gen;
    this.hudName.textContent = G.name || 'A cube';
    this.hudChips.textContent = '';
    chipsOf(G.changes).forEach((c, j) => {
      const el = chipEl(c);
      el.style.animationDelay = `${0.15 + j * 0.12}s`;
      this.hudChips.appendChild(el);
    });
    this.hud.style.setProperty('--cu-col', colOf(G.c));
  }

  // (a frame: the ring - fed so far, then dividing - and the card's countdown)
  _tick() {
    const M = this.app.cublication, p = M.phase === 'divide' ? 1 : M.progress;
    this.ring.style.strokeDashoffset = `${RING * (1 - p)}`;
    this.hudGen.classList.toggle('dividing', M.phase === 'divide');
    const P = M.pick;
    if (P && !this.pickEl.hidden) this.pickTimer.style.transform = `scaleX(${M.running ? Math.max(0, 1 - P.t / PICK_T) : 1})`;
    this.pickTimer.parentElement.classList.toggle('held', !M.running);
  }

  // The two of them, born: a card to keep one from - the two in the order they're seen
  _born(P) {
    const M = this.app.cublication, app = this.app;
    clearTimeout(this._hideT);
    this.pickEl.classList.remove('done');
    this.pickEl.querySelector('.cpk-kicker').textContent = `Generation ${P.kids[0].lin?.gen ?? M.gens.length} · keep one`;
    this.pickKids.textContent = '';
    const tiles = [];
    for (const i of P.order || [0, 1]) {
      const c = P.born[i], b = document.createElement('button'), tier = topTier(P.changes[i]);
      b.className = `cpk-kid ${TIER_CLASS[tier] || 't0'}${i === P.pref ? ' pref' : ''}`;
      b.dataset.i = String(i);
      b.style.setProperty('--k-col', colOf(c));
      b.innerHTML = `<span class="cpk-pic"></span><span class="cpk-txt"><b></b>${tier >= TIER.MAJOR ? `<em>${tier >= TIER.LEGENDARY ? 'Legendary!' : 'Mutation!'}</em>` : ''}<span class="cpk-chips"></span></span>`;
      b.querySelector('.cpk-pic').innerHTML = cubeArt(c);
      b.querySelector('b').textContent = c.name || 'A cube';
      const ch = b.querySelector('.cpk-chips');
      for (const x of chipsOf(P.changes[i], 2)) ch.appendChild(chipEl(x));
      b.addEventListener('click', () => {
        app.audio.ui();
        M.keep(i);
      });
      this.pickKids.appendChild(b);
      tiles.push({ i, b });
    }
    this.pickEl.hidden = false;
    this.line.hidden = true;
    this.pickEl.classList.remove('in');
    void this.pickEl.offsetWidth;
    this.pickEl.classList.add('in');
    // (their portraits, once the snap's slow motion is by: one a frame)
    clearTimeout(this._picT);
    this._picT = setTimeout(() => {
      let n = 0;
      const next = () => {
        if (this.pickEl.hidden || n >= tiles.length || M.pick !== P) return;
        const { i, b } = tiles[n], url = app.portrait(P.born[i], 160, { fill: 0.8, lean: 0.07 }), box = b.querySelector('.cpk-pic');
        if (url && box) box.innerHTML = `<img alt="" src="${url}">`;
        n++;
        requestAnimationFrame(next);
      };
      requestAnimationFrame(next);
    }, 1300);
  }

  // (one's been kept: it lights up, the other goes - then the card, and the line back)
  _picked() {
    const M = this.app.cublication;
    this.pickEl.classList.add('done');
    for (const b of this.pickKids.children) {
      const kept = +b.dataset.i === M.lastKept;
      b.classList.toggle('kept', kept);
      b.classList.toggle('gone', !kept);
    }
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => {
      this.pickEl.hidden = true;
      this.pickEl.classList.remove('done', 'in');
      this._line();
    }, 900);
  }

  // ---------------------------------------------------------------- the family tree

  openTree() {
    const cubby = this.app.ui?.cubby;
    if (cubby?.openModal) cubby.openModal(this.tree);
    else this.tree.hidden = false;
    this._renderTree();
  }

  closeTree() {
    if (this.tree.hidden) return;
    const cubby = this.app.ui?.cubby;
    if (cubby?.closeModal) cubby.closeModal(this.tree);
    else this.tree.hidden = true;
  }

  // The line from the first down - each generation's cube, its name, what it was born with, the twin that went beside
  // it; where the line was gone back to and gone on from, the other way it went, a branch to go over to
  _renderTree() {
    const M = this.app.cublication, L = M.lineage(), list = this.treeList;
    list.textContent = '';
    const G = M.gens, mut = G.reduce((a, g) => a + (g.changes || []).filter((x) => x.tier > TIER.DRIFT).length, 0);
    let branches = 0;
    this.tree.querySelector('.ct-sub').textContent = `${G[G.length - 1]?.gen - G[0]?.gen || 0} generations from ${G[0]?.name || 'the first'} · ${mut} mutation${mut === 1 ? '' : 's'}`;
    // (a branch off the line, kept down to its end - the newest way, where it went more than one)
    const tipOf = (id) => {
      let n = L.nodes.get(id);
      for (;;) {
        const k = n.kids.map((x) => L.nodes.get(x)).filter((x) => x?.kept).pop();
        if (!k) return n;
        n = k;
      }
    };
    const busy = BUSY.includes(M.phase);
    G.forEach((g, i) => {
      const row = document.createElement('div');
      row.className = `ct-row${i === M.view ? ' shown' : ''}${i === 0 ? ' first' : ''}${i === G.length - 1 ? ' last' : ''}`;
      const top = (g.changes || []).reduce((a, x) => (x.tier > a.tier ? x : a), { tier: -1 });
      row.innerHTML = `<span class="ct-spine"><i></i></span>
        <button class="ct-me"><span class="ct-pic"></span><span class="ct-who"><b></b><em></em></span></button>
        <span class="ct-twin"></span>`;
      row.style.setProperty('--k-col', colOf(g.c));
      row.querySelector('.ct-pic').innerHTML = cubeArt(g.c);
      row.querySelector('b').textContent = g.name || 'A cube';
      row.querySelector('em').textContent = `Gen ${g.gen}${top.tier > TIER.DRIFT ? ' · ' + top.label : i === 0 ? ' · the first' : ''}`;
      if (top.tier >= TIER.MAJOR) row.classList.add(TIER_CLASS[top.tier]);
      const me = row.querySelector('.ct-me');
      me.disabled = busy;
      me.addEventListener('click', () => {
        this.app.audio.ui();
        if (M.showGen(i)) this.closeTree();
      });
      if (g.twin?.c) {
        const tw = row.querySelector('.ct-twin');
        tw.innerHTML = `<span class="ct-pic sm"></span>`;
        tw.querySelector('.ct-pic').innerHTML = cubeArt(g.twin.c);
        tw.title = `${g.twin.name || 'Its twin'} - went`;
      }
      list.appendChild(row);
      // (the other ways it went from here: a branch each)
      const node = L.nodes.get(g.id), next = G[i + 1]?.id;
      for (const kid of node?.kids || []) {
        const k = L.nodes.get(kid);
        if (!k?.kept || kid === next) continue;
        const tip = tipOf(kid), b = document.createElement('button');
        branches++;
        b.className = 'ct-branch';
        b.disabled = busy;
        b.innerHTML = `<span class="ct-pic sm"></span><span>Another line: <b></b> · Gen ${tip.gen}</span>`;
        b.querySelector('.ct-pic').innerHTML = cubeArt(tip.c);
        b.querySelector('b').textContent = tip.name || 'a cube';
        b.addEventListener('click', () => {
          this.app.audio.ui();
          if (M.toNode(tip.id)) this.closeTree();
        });
        list.appendChild(b);
      }
    });
    if (branches) this.tree.querySelector('.ct-sub').append(` · ${branches} other line${branches === 1 ? '' : 's'}`);
    requestAnimationFrame(() => list.querySelector('.ct-row.shown')?.scrollIntoView({ block: 'center' }));
  }
}
