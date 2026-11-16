// Motion: the UI's one way of moving. Real springs - a damped spring's step response, sampled into a CSS linear()
// easing, so what moves overshoots and settles the way the jelly does - three of them: bouncy (a press let go, a
// chip, a tile), gentle (a sheet), snappy (small things). And jelly: whatever you press squashes while it's held and
// wobbles back as it's let go. Asked for less motion (prefers-reduced-motion): short plain eases, no wobble.

export const SPRINGS = { bouncy: [260, 13], gentle: [190, 21], snappy: [420, 32] };
const FALLBACK = { bouncy: ['cubic-bezier(0.3, 1.6, 0.5, 1)', 700], gentle: ['cubic-bezier(0.25, 1.2, 0.4, 1)', 600], snappy: ['cubic-bezier(0.2, 1, 0.3, 1)', 350] };
export const SP = {}; // ({ ease, ms } each - see initMotion)
export const motion = { reduced: false };

// (a spring of stiffness k and damping c, unit mass, from 0 to 1: n+1 samples over its time to settle)
export function spring(k, c, n = 56) {
  const w0 = Math.sqrt(k), z = c / (2 * Math.sqrt(k)), wd = w0 * Math.sqrt(Math.max(1e-6, 1 - z * z));
  const T = Math.min(2.2, z < 1 ? -Math.log(0.002) / (z * w0) : 6 / w0), pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * T;
    const x = z < 1 ? 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t)) : 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    pts.push(+x.toFixed(4));
  }
  pts[n] = 1;
  return { ease: `linear(${pts.join(', ')})`, ms: Math.round(T * 1000) };
}

export function initMotion() {
  const R = document.documentElement.style, mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  motion.reduced = !!mq?.matches;
  const ok = !!window.CSS?.supports?.('transition-timing-function', 'linear(0, 1)');
  for (const [name, [k, c]] of Object.entries(SPRINGS)) {
    const s = motion.reduced ? { ease: 'ease', ms: 140 } : ok ? spring(k, c) : { ease: FALLBACK[name][0], ms: FALLBACK[name][1] };
    SP[name] = s;
    R.setProperty(`--sp-${name}`, s.ease);
    R.setProperty(`--t-${name}`, `${s.ms}ms`);
  }
  if (!motion.reduced) jelly();
}

// (jelly: pressed, it squashes - wide and low, less so the bigger it is; let go, it springs back past itself and
// settles. On the compositor, over its own transform - none where that places it: a translate, a turn)
function jelly() {
  let held = null, anim = null, squash = '';
  const placed = (b) => {
    const t = getComputedStyle(b).transform;
    if (!t || t === 'none') return false;
    const m = t.match(/matrix\(([^)]+)\)/);
    if (!m) return true;
    const [a, bb, c, d, e, f] = m[1].split(',').map(Number);
    return Math.abs(e) > 0.5 || Math.abs(f) > 0.5 || Math.abs(bb) > 0.01 || Math.abs(c) > 0.01 || a < 0.8 || d < 0.8;
  };
  const down = (e) => {
    const b = e.target.closest?.('button, [data-jelly]');
    if (!b || b.disabled || b.closest('[data-nojelly]') || placed(b)) return;
    const r = b.getBoundingClientRect(), kx = Math.min(1, 64 / Math.max(1, r.width)), ky = Math.min(1, 64 / Math.max(1, r.height));
    squash = `scale(${(1 + 0.08 * kx).toFixed(3)}, ${(1 - 0.12 * ky).toFixed(3)})`;
    held = b;
    anim?.cancel();
    anim = b.animate([{ transform: 'none' }, { transform: squash }], { duration: 90, easing: 'ease-out', fill: 'forwards' });
  };
  const up = () => {
    if (!held) return;
    const b = held;
    held = null;
    anim?.cancel();
    anim = b.animate([{ transform: squash }, { transform: 'none' }], { duration: SP.bouncy.ms, easing: SP.bouncy.ease });
  };
  document.addEventListener('pointerdown', down, { capture: true, passive: true });
  document.addEventListener('pointerup', up, { capture: true, passive: true });
  document.addEventListener('pointercancel', up, { capture: true, passive: true });
}

// (something flown from one place on the screen to another - a tool picked, into your hand: html drawn in a box the
// size of `to`, from the middle of rect `from` (scaled to it) to `to`'s, on the bouncy spring. Done: resolved)
export function fly(from, to, html, cls = 'flyer') {
  if (motion.reduced || !from || !to) return Promise.resolve();
  const b = to.getBoundingClientRect(), f = document.createElement('div');
  f.className = cls;
  f.innerHTML = html;
  Object.assign(f.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
  document.body.appendChild(f);
  const dx = from.left + from.width / 2 - (b.left + b.width / 2), dy = from.top + from.height / 2 - (b.top + b.height / 2), s = from.width / Math.max(1, b.width);
  return f
    .animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], { duration: SP.bouncy.ms, easing: SP.bouncy.ease })
    .finished.catch(() => {})
    .then(() => f.remove());
}
