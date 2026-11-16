// The ideas box, in the app: suggest something, report a bug, dream up a tool - sent to Nick's box (ideas.rellm.net,
// tools/inbox) with where you were: the build, the device, the tool and the mode, the cube you're on (its code), the
// page's last few errors - and, if you like, a picture of the screen. Nothing about you but a name, if you give one:
// to be credited if it ships. Then what came of it, under Your reports (each report's own token asks); and the
// ideas that shipped, with their senders' names on (src/credits.js).

import { Sheet } from './sheet.js';
import { captureCube, encodeCube } from '../cubecode.js';
import { CREDITS } from '../credits.js';

const BOX = 'https://ideas.rellm.net';
const KEY = 'cube-sim-reports', NAME = 'cube-sim-reporter';

// (the last few errors in the page - from the start: see main.js)
export const ERRORS = [];
export function watchErrors() {
  const keep = (m) => {
    ERRORS.push({ m: String(m).slice(0, 300), t: Math.round(performance.now() / 1000) });
    if (ERRORS.length > 8) ERRORS.shift();
  };
  window.addEventListener('error', (e) => keep(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e) => keep(`unhandled: ${e.reason?.stack?.split('\n').slice(0, 2).join(' / ') || e.reason}`));
}

const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
export const IDEA_ICON = svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>');
const KINDS = [
  { id: 'idea', label: 'Idea', icon: IDEA_ICON, ask: 'What would make it better?' },
  { id: 'bug', label: 'Bug', icon: svg('<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 11v9M7 12H3M21 12h-4M7.5 17 4 19M16.5 17l3.5 2M8.5 8 6 5M15.5 8 18 5M9 7a3 3 0 0 1 6 0"/>'), ask: 'What happened - and what did you expect?' },
  { id: 'tool', label: 'New tool', icon: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.3-.4-.4-2.3z"/>'), ask: 'What would it do to the jelly?' },
];
const STATUS = {
  new: ['Sent', 's-new'],
  triaged: ['Being looked at', 's-look'],
  'needs-approval': ['Waiting on Nick', 's-wait'],
  approved: ['Approved - on its way', 's-go'],
  building: ['Being built', 's-go'],
  shipped: ['Shipped!', 's-done'],
  declined: ['Not this time', 's-no'],
  duplicate: ['Already suggested', 's-no'],
};

export class IdeasBox {
  constructor(ui, app, root) {
    this.ui = ui;
    this.app = app;
    this.kind = 'idea';
    this.sending = false;
    this.form = new Sheet(root, { cls: 'ideas', title: 'Suggest or report', sub: 'Straight to Nick', onOpen: () => this._renderForm() });
    this.mine = new Sheet(root, { cls: 'ideas-mine', title: 'Your reports', onOpen: () => this._renderMine() });
    this.credits = new Sheet(root, { cls: 'ideas-credits', title: 'Ideas from you all', sub: 'Shipped, with thanks', onOpen: () => this._renderCredits() });
  }

  // (the ones sent from here: { id, token, kind, text, at })
  get reports() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(r) ? r : [];
    } catch (e) {
      return [];
    }
  }

  // ------------------------------------------------------------------ the form

  _renderForm() {
    const B = this.form.body, name = localStorage.getItem(NAME) || '';
    B.innerHTML = `<div class="ib-kinds" role="radiogroup" aria-label="What is it?"></div>
      <textarea class="ib-text" maxlength="2000" rows="5"></textarea>
      <div class="ib-count"></div>
      <input class="ib-name" maxlength="32" autocomplete="nickname" placeholder="Your name - to credit you if it ships (optional)">
      <label class="ib-row"><input type="checkbox" class="ib-shot"><span>Add a picture of the screen</span></label>
      <input class="ib-web" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="ib-err" role="alert" hidden></div>
      <button class="ib-send">Send</button>
      <p class="ib-small">Goes with it: the build, your device and screen size, the tool and mode you're in, the cube's code and any recent errors - nothing about you but the name, if you give one.</p>
      <div class="ib-links"></div>`;
    const kinds = B.querySelector('.ib-kinds'), text = B.querySelector('.ib-text'), count = B.querySelector('.ib-count'), shot = B.querySelector('.ib-shot');
    const pick = (id) => {
      this.kind = id;
      for (const b of kinds.children) {
        const on = b.dataset.kind === id;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
      text.placeholder = KINDS.find((k) => k.id === id).ask;
      shot.checked = id === 'bug';
    };
    for (const k of KINDS) {
      const b = document.createElement('button');
      b.className = 'ib-kind';
      b.dataset.kind = k.id;
      b.setAttribute('role', 'radio');
      b.innerHTML = `${k.icon}<span>${k.label}</span>`;
      b.addEventListener('click', () => (this.app.audio?.ui?.(), pick(k.id)));
      kinds.appendChild(b);
    }
    pick(this.kind);
    B.querySelector('.ib-name').value = name;
    const left = () => (count.textContent = text.value.length > 1700 ? `${2000 - text.value.length} left` : '');
    text.addEventListener('input', left);
    B.querySelector('.ib-send').addEventListener('click', () => this._send());
    this._links(B.querySelector('.ib-links'));
  }

  _links(el) {
    el.textContent = '';
    const add = (label, sheet) => {
      const b = document.createElement('button');
      b.className = 'ib-link';
      b.textContent = label;
      b.addEventListener('click', () => (this.app.audio?.ui?.(), sheet.open()));
      el.appendChild(b);
    };
    if (this.reports.length) add(`Your reports (${this.reports.length})`, this.mine);
    if (CREDITS.length) add('Ideas from you all', this.credits);
  }

  // (where you were: what a bug needs to be found again)
  _context() {
    const app = this.app, mode = ['drop', 'press', 'collider', 'cublinko', 'cublication'].find((m) => app[m]?.on) || 'lab';
    let cube = '';
    try {
      cube = encodeCube(captureCube(app, app.cube?.name || ''));
    } catch (e) {}
    return {
      build: typeof __BUILD__ === 'string' ? __BUILD__ : 'dev',
      ua: navigator.userAgent,
      lang: navigator.language,
      screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
      touch: 'ontouchstart' in window,
      theme: app.theme,
      place: app.place,
      tool: app.tool?.id || '',
      mode,
      cubes: app.cubes?.length || 1,
      damaged: !!app.damaged,
      cube,
      bigText: document.documentElement.classList.contains('big-text'),
      reducedMotion: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      errors: ERRORS.slice(),
    };
  }

  // (the scene as it's drawn now - no panels over it - a JPEG at most 640 across)
  _shot() {
    try {
      const app = this.app, src = app.renderer?.domElement;
      if (!src) return null;
      app.render?.();
      const k = Math.min(1, 640 / src.width), c = document.createElement('canvas');
      c.width = Math.round(src.width * k);
      c.height = Math.round(src.height * k);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.72);
      return url.length < 290000 ? url : c.toDataURL('image/jpeg', 0.5);
    } catch (e) {
      return null;
    }
  }

  async _send() {
    if (this.sending) return;
    const B = this.form.body, err = B.querySelector('.ib-err'), btn = B.querySelector('.ib-send');
    const text = B.querySelector('.ib-text').value.trim(), name = B.querySelector('.ib-name').value.trim();
    const say = (m) => ((err.textContent = m), (err.hidden = !m));
    if (text.length < 4) return say('Say a little more?');
    say('');
    this.sending = true;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      localStorage.setItem(NAME, name);
    } catch (e) {}
    const body = { kind: this.kind, text, name, credit: !!name, context: this._context(), shot: B.querySelector('.ib-shot').checked ? this._shot() : null, website: B.querySelector('.ib-web').value };
    try {
      const r = await fetch(`${BOX}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || `The box said ${r.status}`);
      const list = this.reports;
      list.unshift({ id: d.id, token: d.token, kind: this.kind, text: text.slice(0, 140), at: Date.now() });
      try {
        localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
      } catch (e) {}
      this._thanks();
    } catch (e) {
      say(e.message && !/fetch|network/i.test(e.message) ? e.message : "Couldn't reach the box - are you online? Try again in a moment.");
      btn.disabled = false;
      btn.textContent = 'Send';
    }
    this.sending = false;
  }

  // (sent: thanks - a jelly cube bouncing - and where to see what happens to it)
  _thanks() {
    const B = this.form.body;
    B.innerHTML = `<div class="ib-thanks"><div class="ib-cube" aria-hidden="true"></div><h3>Got it - thank you!</h3><p>Nick (and his helper) will look at it soon. You can see what happens to it under Your reports.</p><div class="ib-links"></div><button class="ib-again">Send another</button></div>`;
    this._links(B.querySelector('.ib-links'));
    B.querySelector('.ib-again').addEventListener('click', () => (this.app.audio?.ui?.(), this._renderForm()));
    this.app.audio?.pop?.(0.5);
  }

  // ------------------------------------------------------------------ yours, and what came of them

  async _renderMine() {
    const B = this.mine.body, list = this.reports;
    if (!list.length) {
      B.innerHTML = '<p class="ib-empty">Nothing sent from here yet.</p>';
      return;
    }
    const draw = (st) => {
      B.textContent = '';
      for (const r of list) {
        const s = st?.[r.id], [label, cls] = STATUS[s?.status || 'new'] || STATUS.new, k = KINDS.find((x) => x.id === r.kind) || KINDS[0];
        const el = document.createElement('div');
        el.className = 'ib-item';
        el.innerHTML = `<span class="ib-ico">${k.icon}</span><div class="ib-body"><div class="ib-what"></div><div class="ib-meta"><span class="ib-st ${cls}"></span><span class="ib-when"></span></div><div class="ib-note" hidden></div></div>`;
        el.querySelector('.ib-what').textContent = r.text;
        el.querySelector('.ib-st').textContent = label;
        el.querySelector('.ib-when').textContent = new Date(r.at).toLocaleDateString();
        const note = [s?.note, s?.status === 'shipped' && s?.sha ? `In build ${s.sha.slice(0, 7)}.` : ''].filter(Boolean).join(' ');
        if (note) {
          const n = el.querySelector('.ib-note');
          n.hidden = false;
          n.textContent = note;
        }
        B.appendChild(el);
      }
    };
    draw(null);
    try {
      const r = await fetch(`${BOX}/api/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reports: list.map(({ id, token }) => ({ id, token })) }) });
      const d = await r.json();
      draw(Object.fromEntries((d.reports || []).map((x) => [x.id, x])));
    } catch (e) {}
  }

  _renderCredits() {
    const B = this.credits.body;
    if (!CREDITS.length) {
      B.innerHTML = '<p class="ib-empty">Nothing from the box has shipped yet - yours could be the first.</p>';
      return;
    }
    B.textContent = '';
    for (const c of [...CREDITS].reverse()) {
      const el = document.createElement('div');
      el.className = 'ib-item';
      el.innerHTML = `<span class="ib-ico">${IDEA_ICON}</span><div class="ib-body"><div class="ib-what"></div><div class="ib-meta"><span class="ib-by"></span><span class="ib-when"></span></div></div>`;
      el.querySelector('.ib-what').textContent = c.what;
      el.querySelector('.ib-by').textContent = `Idea by ${c.name}`;
      el.querySelector('.ib-when').textContent = c.date || '';
      B.appendChild(el);
    }
  }
}
