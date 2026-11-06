import { FLAVORS, TEXTURES, EDGES, GLITTERS, LAYER_PRESETS, MIN_LAYERS, MAX_LAYERS, flavorSwatchCSS, flavorMainHex, materialSwatchCSS } from '../styles.js';
import { SETTINGS, settingWord } from '../settings.js';

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  hand: svg(
    '<path d="M7 11.5V5.8a1.4 1.4 0 0 1 2.8 0V11"/><path d="M9.8 10.5V4.4a1.4 1.4 0 0 1 2.8 0v6.1"/><path d="M12.6 10.6V5.6a1.4 1.4 0 0 1 2.8 0v5.8"/><path d="M15.4 11.2V8.2a1.4 1.4 0 0 1 2.8 0v6.3c0 4-2.9 7-6.6 7h-.9c-2.2 0-3.7-.8-5-2.4L3.4 15.3a1.3 1.3 0 0 1 2-1.6L7 15.4V11"/>',
  ),
  knife: svg('<path d="M13 11 3 21c4.5-.4 9.2-2.6 13-7z"/><path d="m13 11 6.6-6.6a1.9 1.9 0 0 1 2.7 2.7L16 14"/>'),
  nailgun: svg(
    '<path d="M2.5 7.5h13a2 2 0 0 1 2 2V11a1 1 0 0 1-1 1H9l-1.4 7a1.2 1.2 0 0 1-1.2 1H4.6a1 1 0 0 1-1-1.2L5 12H2.5z"/><path d="M19.2 9.8h3.3"/><path d="M19.2 8.4v2.8"/><path d="M9.6 12v1.4a1 1 0 0 1-1 1"/>',
  ),
  mallet: svg('<g transform="rotate(-32 12 12)"><rect x="4.5" y="2.5" width="15" height="6.5" rx="1.8"/><rect x="10.8" y="9" width="2.4" height="13" rx="1.2"/></g>'),
  torch: svg(
    '<path d="M12 21.5c-3.6 0-6-2.4-6-5.7 0-3.6 2.8-5.4 3.6-8.9 1.6 1.2 2.4 3 2.3 4.6 1.4-.9 2.2-2.4 2.3-4.2 2.5 2 3.8 5.1 3.8 8.3 0 3.4-2.4 5.9-6 5.9z"/><path d="M12 21.5c-1.6 0-2.7-1.1-2.7-2.6 0-1.7 1.4-2.6 2.1-4.2 1.9 1.3 3.3 2.6 3.3 4.4 0 1.4-1.1 2.4-2.7 2.4z"/>',
  ),
  freeze: svg(
    '<path d="M12 2.5v19"/><path d="m3.8 7.25 16.4 9.5"/><path d="m3.8 16.75 16.4-9.5"/><path d="m9.6 4.2 2.4 1.8 2.4-1.8"/><path d="m9.6 19.8 2.4-1.8 2.4 1.8"/><path d="m4.1 10.4 2.8-1.2-.4-3"/><path d="m19.9 13.6-2.8 1.2.4 3"/><path d="m4.1 13.6 2.8 1.2-.4 3"/><path d="m19.9 10.4-2.8-1.2.4-3"/>',
  ),
  baller: svg(
    '<circle cx="8" cy="16" r="4.8"/><path d="M5.6 15.2a2.6 2.6 0 0 1 2.9-1.9"/><path d="m11.5 12.5 6.4-6.4a1.8 1.8 0 0 1 2.5 2.5L14 15"/>',
  ),
  bomb: svg(
    '<circle cx="10.5" cy="14" r="6.5"/><path d="m14.6 9 1.6-1.6"/><path d="M16.2 7.4c.4-2.2 2-3.5 4-3.4"/><path d="M21.5 1.8v1.1"/><path d="M23 3.4h-1.1"/><path d="m22.4 2.2-.6.6"/><path d="M7.4 11.4a3.6 3.6 0 0 1 2.4-1.7"/>',
  ),
  syringe: svg(
    '<path d="m18.5 2.5 3 3"/><path d="m20 4-3.3 3.3"/><path d="M17.8 8.4 8.6 17.6a1.4 1.4 0 0 1-2 0l-2.2-2.2a1.4 1.4 0 0 1 0-2l9.2-9.2z"/><path d="m4.5 19.5-2 2"/><path d="m9.2 11.6 1.6 1.6"/><path d="m11.4 9.4 1.6 1.6"/>',
  ),
  magnet: svg('<path d="M6 3h3.6v8.2a2.4 2.4 0 0 0 4.8 0V3H18v8.2a6 6 0 0 1-12 0z"/><path d="M6 7.2h3.6"/><path d="M14.4 7.2H18"/>'),
  heal: svg(
    '<path d="M11 3.5 12.7 8l4.6 1.7-4.6 1.7L11 16l-1.7-4.6-4.6-1.7L9.3 8z"/><path d="m18.5 14.5.8 2.1 2.2.8-2.2.8-.8 2.3-.8-2.3-2.2-.8 2.2-.8z"/>',
  ),
  tune: svg('<path d="M4 7h9"/><path d="M17 7h3"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  sound: svg('<path d="M11 5 6.5 8.5H3.5v7h3L11 19z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/><path d="M18.4 6.2a8.4 8.4 0 0 1 0 11.6"/>'),
  mute: svg('<path d="M11 5 6.5 8.5H3.5v7h3L11 19z"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>'),
};

export const TOOL_DEFS = [
  { id: 'hand', label: 'Hand', hint: 'Drag to grab & throw · tap to poke', key: '1' },
  { id: 'knife', label: 'Knife', hint: 'Swipe across the jelly to slice it', key: '2' },
  { id: 'nailgun', label: 'Nail gun', hint: 'Click to fire · hold for auto', key: '3' },
  { id: 'mallet', label: 'Mallet', hint: 'Click to smack · hit on its beat to build resonance · frozen jelly shatters', key: '4' },
  { id: 'torch', label: 'Torch', hint: 'Hold over the jelly to melt it', key: '5' },
  { id: 'freeze', label: 'Cryo spray', hint: 'Hold to freeze it solid', key: '6' },
  { id: 'baller', label: 'Melon baller', hint: 'Click to scoop out a ball', key: '7' },
  { id: 'bomb', label: 'Cherry bomb', hint: 'Click to plant · stand back', key: '8' },
  { id: 'syringe', label: 'Syringe', hint: 'Hold to pump it up', key: '9' },
  { id: 'magnet', label: 'Magnet', hint: 'Hold near nails to pull them out (and drag the jelly with them)', key: '0' },
];

const blendWord = (b) => (b < 0.12 ? 'Crisp' : b < 0.38 ? 'Soft' : b < 0.7 ? 'Blended' : 'Gradient');

export class UI {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.root.innerHTML = `
      <header class="brand" aria-label="Cube Simulator">
        <svg class="mark" viewBox="4 3 56 58" aria-hidden="true">
          <path class="ft" d="M32 6 56 18 32 30 8 18Z" />
          <path class="fl" d="M8 18 32 30V58L8 46Z" />
          <path class="fr" d="M56 18 32 30V58L56 46Z" />
          <path class="gl" d="M16.5 17.6 32 9.8l11.6 5.8" />
        </svg>
        <svg class="word" viewBox="0 0 146 60" aria-hidden="true">
          <use href="#bl-c" /><use href="#bl-u" /><use href="#bl-b" /><use href="#bl-e" />
          <text x="0" y="58" textLength="146" lengthAdjust="spacing">SIMULATOR</text>
        </svg>
      </header>
      <div class="hint" aria-live="polite"></div>
      <nav class="dock" role="toolbar" aria-label="Tools">
        <div class="tools"></div>
        <div class="sep"></div>
        <div class="colors">
          <button class="swatch-btn" aria-label="Jelly style" title="Flavor, material & edges"><span class="swatch"></span></button>

        </div>
        <button class="tune-btn" aria-label="Settings" title="Settings">${ICONS.tune}</button>
        <button class="heal" title="Heal (H)">${ICONS.heal}<span>Heal</span></button>
        <button class="mute" title="Sound (M)" aria-label="Toggle sound">${ICONS.sound}</button>
      </nav>
      <div class="palette style-panel" hidden>
        <div class="sec"><span class="lbl">Flavor</span><div class="chips"></div></div>
        <div class="sec layers-sec" hidden>
          <div class="lbl-row">
            <span class="lbl">Layers <em>tap a band to recolour</em></span>
            <div class="stepper">
              <button class="minus" aria-label="Fewer layers">&minus;</button><span class="n"></span><button class="plus" aria-label="More layers">+</button>
            </div>
          </div>
          <div class="stack" role="group" aria-label="Layer colours, top to bottom"></div>
          <div class="presets"></div>
          <label class="row blend"><span class="name">Blend</span><input type="range" min="0" max="1" step="0.01" aria-label="Blend between layers"><span class="word"></span></label>
        </div>
        <div class="sec"><span class="lbl">Material</span><div class="mats" role="group" aria-label="Material"></div></div>
        <div class="sec"><span class="lbl">Glitter</span><div class="seg glit"></div></div>
        <div class="sec"><span class="lbl">Edges</span><div class="seg edges"></div></div>
      </div>
      <div class="palette tune" hidden>
        <div class="tune-scroll"></div>
        <div class="tune-foot"><button class="reset"></button></div>
      </div>`;
    this.toolsEl = root.querySelector('.tools');
    this.hintEl = root.querySelector('.hint');
    this.healEl = root.querySelector('.heal');
    this.muteEl = root.querySelector('.mute');
    this.swatchBtn = root.querySelector('.swatch-btn');
    this.paletteEl = root.querySelector('.style-panel');
    this.buttons = {};
    for (const d of TOOL_DEFS) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = d.id;
      b.innerHTML = `${ICONS[d.id]}<span class="tip">${d.label}<kbd>${d.key}</kbd></span>`;
      b.setAttribute('aria-label', d.label);
      b.addEventListener('click', () => {
        app.audio.init();
        app.audio.ui();
        app.setTool(d.id);
      });
      this.toolsEl.appendChild(b);
      this.buttons[d.id] = b;
    }
    const chips = this.paletteEl.querySelector('.chips');
    for (const f of FLAVORS) {
      const b = document.createElement('button');
      b.className = 'chip' + (f.layered ? ' layered' : '');
      b.dataset.flavor = f.id;
      b.style.setProperty('--c', flavorSwatchCSS(f));
      b.title = f.name;
      b.setAttribute('aria-label', f.name);
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setFlavor(f.id);
      });
      chips.appendChild(b);
    }
    // ---- layer editor
    this.layersSec = this.paletteEl.querySelector('.layers-sec');
    this.stackEl = this.layersSec.querySelector('.stack');
    this.nEl = this.layersSec.querySelector('.n');
    this.minusEl = this.layersSec.querySelector('.minus');
    this.plusEl = this.layersSec.querySelector('.plus');
    this.blendEl = this.layersSec.querySelector('.blend input');
    this.blendWord = this.layersSec.querySelector('.blend .word');
    this.minusEl.addEventListener('click', () => {
      app.audio.ui();
      app.setLayerCount(app.style.layers.colors.length - 1);
    });
    this.plusEl.addEventListener('click', () => {
      app.audio.ui();
      app.setLayerCount(app.style.layers.colors.length + 1);
    });
    this.blendEl.addEventListener('input', () => {
      this.blendWord.textContent = blendWord(+this.blendEl.value);
      this.blendEl.style.setProperty('--p', `${this.blendEl.value * 100}%`);
      app.setLayerBlur(+this.blendEl.value);
    });
    const presets = this.layersSec.querySelector('.presets');
    for (const p of LAYER_PRESETS) {
      const b = document.createElement('button');
      b.className = 'preset';
      b.dataset.preset = p.id;
      b.innerHTML = `<i style="background:${flavorSwatchCSS({ layers: p.colors })}"></i>${p.name}`;
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setLayerPreset(p.id);
      });
      presets.appendChild(b);
    }

    const custom = document.createElement('label');
    custom.className = 'chip custom';
    custom.title = 'Custom colour';
    custom.innerHTML = '<input type="color" value="#d4102a" aria-label="Custom colour">';
    custom.querySelector('input').addEventListener('input', (e) => app.setFlavor(e.target.value));
    chips.appendChild(custom);
    this.matsEl = this.paletteEl.querySelector('.mats');
    for (const [id, t] of Object.entries(TEXTURES)) {
      const b = document.createElement('button');
      b.className = 'mat';
      b.dataset.tex = id;
      b.innerHTML = `<i class="msw"></i><span>${t.label || t.name}</span>`;
      b.setAttribute('aria-label', t.name);
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setTexture(id);
      });
      this.matsEl.appendChild(b);
    }
    const glitSeg = this.paletteEl.querySelector('.seg.glit');
    for (const gl of GLITTERS) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.dataset.glit = gl.id;
      b.innerHTML = gl.id === 'off' ? gl.name : `<i class="gdot" style="background:${gl.dot}"></i>${gl.name}`;
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setGlitter(gl.id);
      });
      glitSeg.appendChild(b);
    }
    const edgeSeg = this.paletteEl.querySelector('.seg.edges');
    for (const [id, e] of Object.entries(EDGES)) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.dataset.edges = id;
      const rx = Math.round(e.bevel * 36);
      b.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="${rx}" fill="none" stroke="currentColor" stroke-width="1.7"/></svg><span>${e.name}</span>`;
      b.addEventListener('click', () => {
        app.audio.ui();
        app.setEdges(id);
      });
      edgeSeg.appendChild(b);
    }

    // ---- settings panel
    this.tuneBtn = root.querySelector('.tune-btn');
    this.tuneEl = root.querySelector('.palette.tune');
    this.rows = {};
    const scroll = this.tuneEl.querySelector('.tune-scroll');
    let group = null;
    for (const st of SETTINGS) {
      if (st.group !== group) {
        group = st.group;
        const h = document.createElement('div');
        h.className = 'lbl';
        h.textContent = group;
        scroll.appendChild(h);
      }
      const row = document.createElement('label');
      row.className = 'row';
      row.innerHTML = `<span class="name">${st.label}</span><input type="range" min="0" max="1" step="${st.int ? 1 / 240 : 0.001}"><span class="word"></span>`;
      const input = row.querySelector('input');
      const word = row.querySelector('.word');
      const valueOf = () => {
        const v = st.to(+input.value);
        return st.int ? Math.round(v) : v;
      };
      input.addEventListener('input', () => {
        const v = valueOf();
        word.textContent = settingWord(st, v);
        input.style.setProperty('--p', `${input.value * 100}%`);
        app.setSetting(st.key, v, !st.release);
      });
      if (st.release) input.addEventListener('change', () => app.setSetting(st.key, valueOf(), true));
      scroll.appendChild(row);
      this.rows[st.key] = { st, input, word };
    }
    this.tuneEl.querySelector('.reset').addEventListener('click', () => {
      app.audio.ui();
      app.resetSettings();
    });
    this.tuneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      const open = this.tuneEl.hidden;
      this.closePalette();
      this.tuneEl.hidden = !open;
      this.tuneBtn.classList.toggle('open', open);
    });

    this.swatchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      if (this.paletteEl.hidden) this.openPalette();
      else this.closePalette();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.paletteEl.hidden && !this.paletteEl.contains(e.target) && !this.swatchBtn.contains(e.target)) this.closePalette();
      if (!this.tuneEl.hidden && !this.tuneEl.contains(e.target) && !this.tuneBtn.contains(e.target)) this.closeTune();
    });
    this.healEl.addEventListener('click', () => {
      app.audio.init();
      app.heal();
    });
    this.muteEl.addEventListener('click', () => {
      app.audio.init();
      this.setMuted(!app.audio.muted);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') app.setSlowMo(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) app.setSlowMo(true);
        return;
      }
      const d = TOOL_DEFS.find((t) => t.key === e.key);
      if (d) app.setTool(d.id);
      else if (e.key === 'h' || e.key === 'H') app.heal();
      else if (e.key === 'm' || e.key === 'M') this.setMuted(!app.audio.muted);
    });
  }

  openPalette() {
    this.closeTune();
    this.paletteEl.hidden = false;
    this.swatchBtn.classList.add('open');
    // (the chosen material in view)
    const a = this.matsEl.querySelector('.active');
    if (a) this.matsEl.scrollLeft = a.offsetLeft - (this.matsEl.clientWidth - a.offsetWidth) / 2;
  }

  closeTune() {
    if (!this.tuneEl) return;
    this.tuneEl.hidden = true;
    this.tuneBtn.classList.remove('open');
  }

  // Fraction of the screen height covered by an open panel (bottom sheet on phones).
  get panelCover() {
    if (window.innerWidth > 720) return 0;
    const el = !this.tuneEl.hidden ? this.tuneEl : !this.paletteEl.hidden ? this.paletteEl : null;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, (window.innerHeight - r.top) / window.innerHeight);
  }

  setSettings(st, tex) {
    for (const key in this.rows) {
      const { st: def, input, word } = this.rows[key];
      const v = st[key];
      const t = Math.min(1, Math.max(0, def.from(v)));
      if (document.activeElement !== input) input.value = t;
      input.style.setProperty('--p', `${t * 100}%`);
      word.textContent = settingWord(def, v);
    }
    this.tuneEl.querySelector('.reset').textContent = `Reset to ${tex.name}`;
  }

  closePalette() {
    this.paletteEl.hidden = true;
    this.swatchBtn.classList.remove('open');
  }

  setMuted(m) {
    this.app.audio.setMuted(m);
    this.muteEl.innerHTML = m ? ICONS.mute : ICONS.sound;
    this.muteEl.classList.toggle('off', m);
  }

  setTool(id) {
    for (const k in this.buttons) this.buttons[k].classList.toggle('active', k === id);
    const d = TOOL_DEFS.find((t) => t.id === id);
    const touch = this.app.isTouch || window.matchMedia?.('(pointer: coarse)').matches;
    if (d) this.hint(touch ? d.hint.replace(/\bClick\b/g, 'Tap').replace(/\bclick\b/g, 'tap') : d.hint);
  }

  // Layer editor: bands top -> bottom; the stack background shows the
  // actual blend, the bands are transparent tap targets with colour inputs.
  renderLayers(L) {
    const cols = L.colors;
    const n = cols.length;
    this.nEl.textContent = n;
    this.minusEl.disabled = n <= MIN_LAYERS;
    this.plusEl.disabled = n >= MAX_LAYERS;
    if (this.stackEl.children.length !== n) {
      this.stackEl.innerHTML = '';
      for (let j = 0; j < n; j++) {
        const k = n - 1 - j; // top band first
        const bar = document.createElement('label');
        bar.className = 'bar';
        bar.title = k === n - 1 ? 'Top layer' : k === 0 ? 'Bottom layer' : `Layer ${k + 1}`;
        bar.innerHTML = '<input type="color" aria-label="Layer colour">';
        bar.querySelector('input').addEventListener('input', (e) => this.app.setLayerColor(k, e.target.value));
        this.stackEl.appendChild(bar);
      }
    }
    for (let j = 0; j < n; j++) {
      const input = this.stackEl.children[j].querySelector('input');
      const c = cols[n - 1 - j];
      if (input.value.toLowerCase() !== c.toLowerCase()) input.value = c;
    }
    this.stackEl.style.background = flavorSwatchCSS({ layers: cols, blur: L.blur });
    if (document.activeElement !== this.blendEl) this.blendEl.value = L.blur;
    this.blendEl.style.setProperty('--p', `${L.blur * 100}%`);
    this.blendWord.textContent = blendWord(L.blur);
    const key = cols.join(',').toLowerCase();
    for (const b of this.layersSec.querySelectorAll('.preset')) {
      const p = LAYER_PRESETS.find((q) => q.id === b.dataset.preset);
      b.classList.toggle('active', p.colors.join(',').toLowerCase() === key);
    }
  }

  setStyle(style, flavor) {
    const css = flavorSwatchCSS(flavor);
    // (on the page, for the logotype's cube too)
    document.documentElement.style.setProperty('--jelly', flavor.layers ? flavor.layers[flavor.layers.length - 1] : flavor.hex);
    this.swatchBtn.querySelector('.swatch').style.background = css;
    const layerChip = this.paletteEl.querySelector('.chip.layered');
    if (layerChip) layerChip.style.setProperty('--c', flavorSwatchCSS({ layers: style.layers.colors, blur: style.layers.blur }));
    this.layersSec.hidden = !flavor.layers;
    if (flavor.layers) this.renderLayers(style.layers);
    for (const b of this.paletteEl.querySelectorAll('.chip[data-flavor]')) b.classList.toggle('active', b.dataset.flavor === style.flavor);
    this.paletteEl.querySelector('.chip.custom').classList.toggle('active', String(style.flavor).startsWith('#'));
    // material tiles in this flavour (layered: its middle colour)
    const hex = flavorMainHex(flavor);
    if (hex !== this._matHex) {
      this._matHex = hex;
      for (const b of this.matsEl.children) b.firstChild.style.background = materialSwatchCSS(TEXTURES[b.dataset.tex], hex);
    }
    for (const b of this.matsEl.children) b.classList.toggle('active', b.dataset.tex === style.texture);
    for (const b of this.paletteEl.querySelectorAll('.opt[data-edges]')) b.classList.toggle('active', b.dataset.edges === style.edges);
    for (const b of this.paletteEl.querySelectorAll('.opt[data-glit]')) b.classList.toggle('active', b.dataset.glit === style.glitter);
  }

  setDamaged(d) {
    this.healEl.classList.toggle('pulse', d);
  }

  hint(text, ms = 2600) {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    clearTimeout(this._ht);
    this._ht = setTimeout(() => this.hintEl.classList.remove('show'), ms);
  }
}
