// Exhibition modes - the cube made in the lab put to use. The dock's Exhibit button opens a card of them (Drop, so
// far); in one, the dock gives way to that mode's own bar. Drop's: its height, Drop / Let go, the fall's height and
// speed as it goes, back to the lab (see drop.js).
import { DROP_MIN, DROP_MAX } from '../drop.js';

const EXHIBIT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M10 8.6v6.8l5.6-3.4Z" fill="currentColor"/></svg>`;
const DROP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2.5" width="8" height="8" rx="2.2"/><path d="M12 13v5M9.5 15.6 12 18.1l2.5-2.5M4 21.5h16"/></svg>`;

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
    pop.innerHTML = `<div class="ex-title">Exhibit</div><button class="ex-mode" data-mode="drop">${DROP_ICON}<span><b>Drop</b><em>Up into the sky &middot; let it fall</em></span></button>`;
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
  }

  enterDrop() {
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
    if (phase === 'land') this.ui.hint(`Hit the ground at ${D.hitV.toFixed(0)} m/s · from ${D.height} m`, 3200);
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
