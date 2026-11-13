import { GLITTERS, GLITTER_KINDS, GLITTER_SHAPES, MAX_GLITTER_MIX, glitterPart, copyGlitterMix, glitterMixWords } from '../styles.js';
import { SETTINGS, settingWord, settingNum } from '../settings.js';

// The glitter studio: a cube's own glitter (Custom, in the Glitter row), made under the row - up to four makings,
// each one of the six or a colour of its own (metallic or iridescent), a shape, a size and a share of the flakes.
// Every change is on the cube as it's made (App.setGlitterMix), the flakes where they are; let go, a jiggle.

// (each shape, small: the studio's buttons and its makings' chips)
const SHAPE_SVG = {
  hex: '<path d="M10 2.6 16.4 6.3v7.4L10 17.4 3.6 13.7V6.3Z"/>',
  cube: '<path d="M10 2.8 16.2 6.3v7.4L10 17.2 3.8 13.7V6.3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3.8 6.3 10 9.8l6.2-3.5M10 9.8v7.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  star: '<path d="M10 2.3l2.3 5 5.5.6-4.1 3.7 1.2 5.4L10 14.2 5.1 17l1.2-5.4-4.1-3.7 5.5-.6Z"/>',
  heart: '<path d="M10 16.8S3.4 12.7 3.4 8.2A3.5 3.5 0 0 1 10 6.4a3.5 3.5 0 0 1 6.6 1.8c0 4.5-6.6 8.6-6.6 8.6Z"/>',
  sequin: '<path fill-rule="evenodd" d="M10 3.4a6.6 6.6 0 1 1 0 13.2 6.6 6.6 0 1 1 0-13.2Zm0 4.7a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 1 0 0-3.8Z"/>',
  square: '<rect x="4.4" y="4.4" width="11.2" height="11.2" rx="1.2"/>',
  sliver: '<rect x="2.4" y="8.5" width="15.2" height="3" rx="1.2" transform="rotate(-32 10 10)"/>',
};
const shapeSVG = (id) => `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">${SHAPE_SVG[id] || SHAPE_SVG.hex}</svg>`;
const KIND_NAME = { silver: 'Silver', gold: 'Gold', holo: 'Holo', rose: 'Rose', cubic: 'Cubic', snow: 'Snow', color: 'Colour' };
const SIZE = SETTINGS.find((s) => s.key === 'glitterSize');

// (a making's swatch: one of the six as its own dot; a colour, shining - or, iridescent, its colour turning)
function dotOf(g) {
  if (g.kind !== 'color') return GLITTERS.find((x) => x.id === g.kind)?.dot || '#ccc';
  return g.iri ? `conic-gradient(from 20deg, ${g.color}, #ff8ad8, #8ad6ff, #c8ff9a, ${g.color})` : `radial-gradient(circle at 34% 30%, #ffffff 0, ${g.color} 48%, ${g.color})`;
}

export class GlitterStudio {
  // host: the Glitter section; readout: the panel's word-and-number setter
  constructor(app, host, readout) {
    this.app = app;
    this.readout = readout;
    this.sel = 0;
    const el = (this.el = document.createElement('div'));
    el.className = 'gstudio';
    el.hidden = true;
    el.innerHTML = `
      <div class="gs-parts" role="radiogroup" aria-label="What its glitter's made of"></div>
      <div class="seg gs-kind" role="group" aria-label="Made of"></div>
      <div class="gs-colour" hidden>
        <label class="free-col gs-col" title="Its colour"><i></i><input type="color" aria-label="Its colour"></label>
        <div class="seg gs-finish" role="group" aria-label="Its finish"><button class="opt" data-iri="0">Metallic</button><button class="opt" data-iri="1">Iridescent</button></div>
      </div>
      <div class="seg gs-shape" role="group" aria-label="Its shape"></div>
      <label class="row gs-size"><span class="name">Size</span><input type="range" min="0" max="1" step="0.001" aria-label="How big these flakes are"><span class="word"></span></label>
      <label class="row gs-share"><span class="name">Share</span><input type="range" min="0" max="1" step="0.001" aria-label="How much of the glitter these are"><span class="word"></span></label>
      <div class="gs-foot"><span class="gs-what"></span><button class="gs-del">Remove</button></div>
      <div class="gs-all"></div>`;
    host.appendChild(el);
    this.partsEl = el.querySelector('.gs-parts');
    this.colourEl = el.querySelector('.gs-colour');
    this.colIn = el.querySelector('.gs-col input');
    this.whatEl = el.querySelector('.gs-what');
    this.delEl = el.querySelector('.gs-del');
    // what it's made of: one of the six, or a colour of its own
    const kindSeg = el.querySelector('.gs-kind');
    for (const kind of GLITTER_KINDS) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.dataset.kind = kind;
      b.innerHTML = `<i class="gdot"></i>${KIND_NAME[kind]}`;
      if (kind !== 'color') b.firstChild.style.background = dotOf({ kind });
      b.addEventListener('click', () => {
        app.audio.ui();
        const g = this._part();
        // (a colour's picked from where it is - the cubic's its cubes, the rest flakes, as they come; a shape you
        // chose stays yours)
        const shape = g.shape === (g.kind === 'cubic' ? 'cube' : 'hex') ? (kind === 'cubic' ? 'cube' : 'hex') : g.shape;
        this._edit({ kind, shape }, true);
        if (kind === 'color') this.colIn.click();
      });
      kindSeg.appendChild(b);
    }
    this.colIn.addEventListener('input', () => this._edit({ kind: 'color', color: this.colIn.value }));
    this.colIn.addEventListener('change', () => this._edit({ kind: 'color', color: this.colIn.value }, true));
    for (const b of el.querySelectorAll('.gs-finish .opt'))
      b.addEventListener('click', () => {
        app.audio.ui();
        this._edit({ iri: b.dataset.iri === '1' }, true);
      });
    // its shape
    const shapeSeg = el.querySelector('.gs-shape');
    for (const s of GLITTER_SHAPES) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.dataset.shape = s.id;
      b.title = s.name;
      b.setAttribute('aria-label', s.name);
      b.innerHTML = `${shapeSVG(s.id)}<span>${s.name}</span>`;
      b.addEventListener('click', () => {
        app.audio.ui();
        // (a shape's for seeing: a hexagon's size, a heart's a speck - made chunky, the first time, if it's small)
        const g = this._part();
        this._edit(s.id !== 'hex' && g.shape === 'hex' && g.size < 1.5 ? { shape: s.id, size: 1.8 } : { shape: s.id }, true);
      });
      shapeSeg.appendChild(b);
    }
    // its size (the Size setting's words, times it) and its share
    this.sizeIn = el.querySelector('.gs-size input');
    this.sizeWord = el.querySelector('.gs-size .word');
    this.shareIn = el.querySelector('.gs-share input');
    this.shareWord = el.querySelector('.gs-share .word');
    const slide = (input, f) => {
      input.addEventListener('input', () => this._edit(f(+input.value)));
      input.addEventListener('change', () => this._edit(f(+input.value), true));
    };
    slide(this.sizeIn, (t) => ({ size: SIZE.to(t) }));
    slide(this.shareIn, (t) => ({ share: 0.02 + 0.98 * t }));
    this.delEl.addEventListener('click', () => {
      const m = this._mix();
      if (m.length < 2) return;
      app.audio.ui();
      m.splice(this.sel, 1);
      this.sel = Math.min(this.sel, m.length - 1);
      app.setGlitterMix(m, true);
    });
    // and, for all of its glitter (Settings > Glitter's own): how much, how sparkly
    this.rows = [];
    const all = el.querySelector('.gs-all');
    for (const key of ['glitterAmount', 'glitterSparkle']) {
      const st = SETTINGS.find((x) => x.key === key), row = document.createElement('label');
      row.className = 'row';
      row.innerHTML = `<span class="name">${st.label}</span><input type="range" min="0" max="1" step="0.001" aria-label="Glitter: ${st.label}"><span class="word"></span>`;
      const input = row.querySelector('input'), word = row.querySelector('.word');
      input.addEventListener('input', () => {
        const v = st.to(+input.value);
        readout(word, settingWord(st, v), settingNum(st, v));
        input.style.setProperty('--p', `${input.value * 100}%`);
        app.setSetting(key, v, false);
      });
      input.addEventListener('change', () => app.setSetting(key, st.to(+input.value), true));
      all.appendChild(row);
      this.rows.push({ st, input, word, row });
    }
  }

  _mix() {
    return copyGlitterMix(this.app.style.glitterMix);
  }

  _part() {
    const m = this._mix();
    return m[Math.min(this.sel, m.length - 1)];
  }

  // (the picked making changed: on the cube as it is - let go, a jiggle)
  _edit(patch, final = false) {
    const m = this._mix(), i = Math.min(this.sel, m.length - 1);
    m[i] = { ...m[i], ...patch };
    this.app.setGlitterMix(m, final);
  }

  // A making more: one it hasn't got, in a shape it hasn't got - picked, to be made
  _add() {
    const m = this._mix();
    if (m.length >= MAX_GLITTER_MIX) return;
    const kind = GLITTER_KINDS.find((k) => k !== 'color' && k !== 'snow' && !m.some((g) => g.kind === k)) || 'color';
    const shape = ['star', 'heart', 'sequin', 'sliver', 'square'].find((s) => !m.some((g) => g.shape === s)) || 'star';
    m.push(glitterPart(kind, { shape: kind === 'cubic' ? 'cube' : shape, size: 1.8, share: 0.35, color: '#ff4fa3' }));
    this.sel = m.length - 1;
    this.app.setGlitterMix(m, true);
  }

  // As the cube's glitter is now (see Ui's palette): shown only for its own
  render(style) {
    const on = style.glitter === 'custom';
    this.el.hidden = !on;
    if (!on) return;
    const m = copyGlitterMix(style.glitterMix);
    this.sel = Math.min(this.sel, m.length - 1);
    const g = m[this.sel];
    // the makings, each a chip (its swatch, its shape) - and one more
    const sig = JSON.stringify([m, this.sel]);
    if (sig !== this._sig) {
      this._sig = sig;
      this.partsEl.innerHTML = '';
      const total = m.reduce((s, q) => s + q.share, 0);
      m.forEach((q, i) => {
        const b = document.createElement('button');
        b.className = 'gs-part' + (i === this.sel ? ' active' : '');
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(i === this.sel));
        b.setAttribute('aria-label', `${KIND_NAME[q.kind]} ${GLITTER_SHAPES.find((s) => s.id === q.shape)?.name || ''}, ${Math.round((100 * q.share) / total)}%`);
        b.innerHTML = `<i style="background:${dotOf(q)}"></i>${shapeSVG(q.shape)}<em>${Math.round((100 * q.share) / total)}%</em>`;
        b.addEventListener('click', () => {
          this.app.audio.ui();
          this.sel = i;
          this.render(this.app.style);
        });
        this.partsEl.appendChild(b);
      });
      if (m.length < MAX_GLITTER_MIX) {
        const add = document.createElement('button');
        add.className = 'gs-part gs-add';
        add.setAttribute('aria-label', 'Another kind of glitter in it');
        add.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        add.addEventListener('click', () => {
          this.app.audio.ui();
          this._add();
        });
        this.partsEl.appendChild(add);
      }
    }
    // the picked one: what it's made of, its colour, its shape, its size and share
    for (const b of this.el.querySelectorAll('.gs-kind .opt')) b.classList.toggle('active', b.dataset.kind === g.kind);
    const colBtn = this.el.querySelector('.gs-kind .opt[data-kind="color"] .gdot');
    colBtn.style.background = dotOf(g.kind === 'color' ? g : { kind: 'color', color: '#ff4fa3', iri: true });
    this.colourEl.hidden = g.kind !== 'color';
    if (g.kind === 'color') {
      if (document.activeElement !== this.colIn) this.colIn.value = g.color;
      this.el.querySelector('.gs-col i').style.background = g.color;
      for (const b of this.el.querySelectorAll('.gs-finish .opt')) b.classList.toggle('active', (b.dataset.iri === '1') === g.iri);
    }
    for (const b of this.el.querySelectorAll('.gs-shape .opt')) b.classList.toggle('active', b.dataset.shape === g.shape);
    const ts = Math.min(1, Math.max(0, SIZE.from(g.size))), th = (g.share - 0.02) / 0.98;
    if (document.activeElement !== this.sizeIn) this.sizeIn.value = ts;
    if (document.activeElement !== this.shareIn) this.shareIn.value = th;
    this.sizeIn.style.setProperty('--p', `${ts * 100}%`);
    this.shareIn.style.setProperty('--p', `${th * 100}%`);
    this.readout(this.sizeWord, settingWord(SIZE, g.size), null);
    const total = m.reduce((s, q) => s + q.share, 0);
    this.readout(this.shareWord, `${Math.round((100 * g.share) / total)}% of it`, null);
    this.whatEl.textContent = glitterMixWords(m);
    this.delEl.hidden = m.length < 2;
  }

  // (Settings changed - a whole cube put on, a slider elsewhere: its own two rows as they are)
  setSettings(st) {
    for (const { st: def, input, word } of this.rows) {
      const v = st[def.key], t = Math.min(1, Math.max(0, def.from(v)));
      if (document.activeElement !== input) input.value = t;
      input.style.setProperty('--p', `${t * 100}%`);
      this.readout(word, settingWord(def, v), settingNum(def, v));
    }
  }
}
