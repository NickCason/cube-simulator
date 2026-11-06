// The opening splash (markup and look in index.html, so it shows before any
// script has loaded): the cube's dark silhouette while the app boots, then -
// once it has drawn its first frames, so nothing stalls the show - the rim
// lights up and the name comes in. When that has played and the physics is
// warm, the dark falls away and the name settles into the logotype at the
// top. The cube is held up until then (see App._introStep), so the reveal is
// the cube dropping in. A tap or a key skips it.

const REVEAL = 2.05; // s: the reveal's length (index.html)

export class Splash {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('splash');
    this.active = !!this.el && document.documentElement.classList.contains('splashing');
    this.leaving = false;
    this.goAt = 0;
    if (!this.active) {
      this.el?.remove();
      return;
    }
    this.el.classList.add('on'); // (shown now by itself, not by the page's class)
    app.splashHold = true;
    const skip = () => this.leave(true);
    window.addEventListener('keydown', skip, { once: true });
    this._skip = skip;
  }

  // the app has booted and drawn: the reveal
  go() {
    if (!this.active || this.goAt) return;
    this.goAt = performance.now();
    this.el.classList.add('go');
  }

  // the physics has warmed up: leave once the reveal has played
  ready() {
    if (!this.active || this.leaving || this._timer || !this.goAt) return;
    const wait = Math.max(0, this.goAt + REVEAL * 1000 - performance.now());
    this._timer = setTimeout(() => this.leave(false), wait);
  }

  leave(fast) {
    if (!this.active || this.leaving) return;
    this.leaving = true;
    clearTimeout(this._timer);
    window.removeEventListener('keydown', this._skip);
    this.app.splashHold = false;
    const el = this.el, root = document.documentElement;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const word = el.querySelector('.sp-word');
    const target = document.querySelector('.brand .word');
    if (fast || reduced || !word || !target) {
      el.classList.add('out-fast');
      root.classList.remove('splashing');
      setTimeout(() => this._done(), 400);
      return;
    }
    // the name flies to where the logotype's is
    const a = word.getBoundingClientRect(), b = target.getBoundingClientRect();
    const s = b.width / a.width;
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    el.classList.add('out');
    word.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    setTimeout(() => {
      root.classList.remove('splashing');
      el.classList.add('gone');
    }, 900);
    setTimeout(() => this._done(), 1150);
  }

  _done() {
    this.active = false;
    this.el.remove();
  }
}
