// Exhibition modes - the cube made in the lab put to use. The dock's Exhibit button opens a card of them (Drop, so
// far); in one, the dock gives way to that mode's own bar. Drop's: its height, Drop / Let go, the fall's height and
// speed as it goes, back to the lab (see drop.js).
import { DROP_MIN, DROP_MAX } from '../drop.js';
import { PRESS_SPEED, PRESS_DEPTH } from '../press.js';

const EXHIBIT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M10 8.6v6.8l5.6-3.4Z" fill="currentColor"/></svg>`;
const DROP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2.5" width="8" height="8" rx="2.2"/><path d="M12 13v5M9.5 15.6 12 18.1l2.5-2.5M4 21.5h16"/></svg>`;

const PRESS_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21.5V3.5M20 21.5V3.5M3 3.5h18M12 3.5v4.5"/><rect x="6.5" y="8" width="11" height="2.6" rx="0.8" fill="currentColor"/><rect x="8.5" y="15" width="7" height="6.5" rx="1.6"/></svg>`;

export class Exhibit {
  constructor(ui, app, root) {
    this.ui = ui;
    this.app = app;
    this._raf = 0;
    // the dock's button, before Settings
    const btn = (this.btn = document.createElement('button'));
    btn.className = 'exhibit-btn';
    btn.title = 'Exhibit: put the cube to use';
    btn.setAttribute('aria-label', 'Exhibit');
    btn.innerHTML = EXHIBIT_ICON;
    root.querySelector('.dock .tune-btn').before(btn);
    // its card of modes
    const pop = (this.pop = document.createElement('div'));
    pop.className = 'exhibit-pop';
    pop.hidden = true;
    pop.innerHTML = `<div class="ex-title">Exhibit</div><button class="ex-mode" data-mode="drop">${DROP_ICON}<span><b>Drop</b><em>Up into the sky &middot; let it fall</em></span></button>
      <button class="ex-mode" data-mode="press">${PRESS_ICON}<span><b>Press</b><em>A hydraulic press &middot; squash it flat</em></span></button>`;
    root.appendChild(pop);
    // Drop's bar
    const bar = (this.bar = document.createElement('div'));
    bar.className = 'drop-bar';
    bar.hidden = true;
    bar.innerHTML = `<button class="db-exit" aria-label="Back to the lab" title="Back to the lab">&times;</button>
      <label class="db-h"><span>Height</span><input type="range" min="${DROP_MIN}" max="${DROP_MAX}" step="1" aria-label="How high it's taken"><b></b></label>
      <div class="db-read" aria-live="polite" hidden></div>
      <button class="db-go">Drop</button>`;
    root.appendChild(bar);
    this.hIn = bar.querySelector('.db-h input');
    this.hOut = bar.querySelector('.db-h b');
    this.hRow = bar.querySelector('.db-h');
    this.read = bar.querySelector('.db-read');
    this.go = bar.querySelector('.db-go');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      app.audio.init();
      app.audio.ui();
      const open = pop.hidden;
      ui.closePalette();
      ui.closeTune?.();
      pop.hidden = !open;
      btn.classList.toggle('open', open);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) (pop.hidden = true), btn.classList.remove('open');
    });
    pop.querySelector('[data-mode="drop"]').addEventListener('click', () => {
      app.audio.ui();
      this.enterDrop();
    });
    bar.querySelector('.db-exit').addEventListener('click', () => {
      app.audio.ui();
      this.exitDrop();
    });
    this.hIn.addEventListener('input', () => {
      app.drop.setHeight(+this.hIn.value);
      this._height();
    });
    this.go.addEventListener('click', () => {
      app.audio.init();
      const ph = app.drop.phase;
      if (!ph || ph === 'land') app.drop.start();
      else if (ph === 'lift' || ph === 'hang') app.drop.letGo();
    });
    app.drop.onChange = (phase) => this._sync(phase);
    // the Press's bar: how fast, how far down - then Press, its gauge as it goes, Release
    const pb = (this.pbar = document.createElement('div'));
    pb.className = 'drop-bar press-bar';
    pb.hidden = true;
    pb.innerHTML = `<button class="db-exit" aria-label="Back to the lab" title="Back to the lab">&times;</button>
      <div class="ps-sets">
        <label class="db-h ps-speed"><span>Speed</span><input type="range" min="0" max="1" step="0.01" aria-label="How fast the plate comes down"><b></b></label>
        <label class="db-h ps-depth"><span>Down to</span><input type="range" min="0" max="1" step="0.01" aria-label="How far down it goes"><b></b></label>
      </div>
      <div class="db-read" aria-live="polite" hidden></div>
      <button class="db-go">Press</button>`;
    root.appendChild(pb);
    this.ps = { sets: pb.querySelector('.ps-sets'), sp: pb.querySelector('.ps-speed input'), spOut: pb.querySelector('.ps-speed b'), dp: pb.querySelector('.ps-depth input'), dpOut: pb.querySelector('.ps-depth b'), read: pb.querySelector('.db-read'), go: pb.querySelector('.db-go') };
    pop.querySelector('[data-mode="press"]').addEventListener('click', () => {
      app.audio.ui();
      this.enterPress();
    });
    pb.querySelector('.db-exit').addEventListener('click', () => {
      app.audio.ui();
      this.exitPress();
    });
    // (speed on a log scale - slow presses are the good ones; depth as the gap left, a share of its height)
    const [s0, s1] = PRESS_SPEED, [d0, d1] = PRESS_DEPTH;
    this.ps.sp.addEventListener('input', () => {
      app.press.set({ speed: s0 * Math.pow(s1 / s0, +this.ps.sp.value) });
      this._pressSets();
    });
    this.ps.dp.addEventListener('input', () => {
      app.press.set({ depth: d1 - (d1 - d0) * +this.ps.dp.value });
      this._pressSets();
    });
    this.ps.go.addEventListener('click', () => {
      app.audio.init();
      const ph = app.press.phase;
      if (!ph) app.press.start();
      else if (ph === 'down' || ph === 'hold') app.press.release();
    });
    app.press.onChange = (phase) => this._syncPress(phase);
  }

  enterPress() {
    this.pop.hidden = true;
    this.btn.classList.remove('open');
    this.ui.closePalette();
    this.ui.closeTune?.();
    if (this.app.drop.on) this.exitDrop();
    this.app.press.enter();
    document.documentElement.classList.add('drop-on');
    this.pbar.hidden = false;
    const P = this.app.press, [s0, s1] = PRESS_SPEED, [d0, d1] = PRESS_DEPTH;
    this.ps.sp.value = String(Math.log(P.speed / s0) / Math.log(s1 / s0));
    this.ps.dp.value = String((d1 - P.depth) / (d1 - d0));
    this._pressSets();
    this.ui.hint('Press · how fast, how flat - then Press', 2400);
  }

  exitPress() {
    this.app.press.exit();
    document.documentElement.classList.remove('drop-on');
    this.pbar.hidden = true;
  }

  _pressSets() {
    const P = this.app.press;
    this.ps.spOut.textContent = P.speed < 0.1 ? `${Math.round(P.speed * 100)} cm/s` : `${P.speed.toFixed(2)} m/s`;
    this.ps.dpOut.textContent = `${Math.round(P.depth * 100)}%`;
    for (const i of [this.ps.sp, this.ps.dp]) i.style.setProperty('--p', `${+i.value * 100}%`);
  }

  // (as it goes: the big button's word, the settings or the gauge)
  _syncPress(phase) {
    const P = this.app.press, busy = phase === 'down' || phase === 'hold' || phase === 'up', go = this.ps.go;
    go.textContent = !phase ? 'Press' : phase === 'up' ? 'Rising' : 'Release';
    go.disabled = phase === 'up';
    go.classList.toggle('let', phase === 'down' || phase === 'hold');
    this.ps.sets.hidden = busy;
    this.ps.read.hidden = !busy;
    if (phase === 'hold') this.ui.hint(P.stalled ? `Stalled at ${P.peakTonnes.toFixed(0)} t - it won't go further` : `Down to ${Math.round(P.squash * 100)}% of its height · ${P.peakTonnes.toFixed(0)} t at most`, 3200);
    cancelAnimationFrame(this._praf);
    if (busy) {
      const tick = () => {
        this.ps.read.textContent = `${P.tonnes < 10 ? P.tonnes.toFixed(1) : P.tonnes.toFixed(0)} t · ${Math.round(P.squash * 100)}%`;
        if (P.phase === 'down' || P.phase === 'hold' || P.phase === 'up') this._praf = requestAnimationFrame(tick);
      };
      tick();
    }
  }

  enterDrop() {
    if (this.app.press.on) this.exitPress();
    this.pop.hidden = true;
    this.btn.classList.remove('open');
    this.ui.closePalette();
    this.ui.closeTune?.();
    this.app.drop.enter();
    document.documentElement.classList.add('drop-on');
    this.bar.hidden = false;
    this.hIn.value = String(this.app.drop.height);
    this._height();
    this.ui.hint('Drop · how high, then Drop', 2400);
  }

  exitDrop() {
    this.app.drop.exit();
    document.documentElement.classList.remove('drop-on');
    this.bar.hidden = true;
  }

  _height() {
    this.hOut.textContent = `${this.app.drop.height} m`;
    this.hIn.style.setProperty('--p', `${((this.app.drop.height - DROP_MIN) / (DROP_MAX - DROP_MIN)) * 100}%`);
  }

  // (as it goes: the big button's word, the height or the fall's numbers)
  _sync(phase) {
    const D = this.app.drop, busy = phase === 'lift' || phase === 'hang' || phase === 'fall';
    this.go.textContent = !phase ? 'Drop' : phase === 'land' ? 'Again' : phase === 'fall' ? 'Falling' : 'Let go';
    this.go.disabled = phase === 'fall';
    this.go.classList.toggle('let', phase === 'lift' || phase === 'hang');
    this.hRow.hidden = busy;
    this.read.hidden = !busy;
    if (phase === 'hang') this.ui.hint('Tap anywhere to let it go', 2200);
    if (phase === 'land') this.ui.hint(D.shards > 1 ? `Shattered at ${D.hitV.toFixed(0)} m/s · ${D.shards} pieces · from ${D.height} m` : `Hit the ground at ${D.hitV.toFixed(0)} m/s · from ${D.height} m`, 3200);
    cancelAnimationFrame(this._raf);
    if (busy) {
      const tick = () => {
        this.read.textContent = D.phase === 'fall' ? `${D.alt.toFixed(1)} m · ${D.speed.toFixed(0)} m/s` : `${D.alt.toFixed(1)} m`;
        if (D.phase === 'lift' || D.phase === 'hang' || D.phase === 'fall') this._raf = requestAnimationFrame(tick);
      };
      tick();
    }
    if (!phase) this.read.hidden = true;
  }
}
