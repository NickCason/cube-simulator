// A tool picked acts - once, about a second: its icon plays its own little scene, the way the mallet's always read: a
// wind-up, the act, a wobble settling - and what it does, drawn round it for a moment: the knife's slash streaking
// across and its blade glinting, the guns' muzzle flash and what they fire, the bomb's fuse spitting sparks till it
// pops, the torch's embers, the cryo's frost, the acid's bubbles, the ladle's jelly dropping... (the icon's own parts
// move too - the googly eyes' pupils, the sieve's flour, the shotgun's pump). Drawn in the icon's own 24-unit space,
// put where it is in its box (a phone's dock pill, a wide screen's tool button) - and the box popped out to 1.45 its
// size the while, a halo in its kind's colour flashing behind it on the beat: in a 24 px icon, in its 40 px box, the
// first of these (all of it in place) read as twitches - the knife's, not at all. Reduced motion: none of it.

import { motion } from './motion.js';

const E = {
  out: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
  in: 'cubic-bezier(0.55, 0, 0.9, 0.45)',
  io: 'cubic-bezier(0.45, 0, 0.55, 1)',
  snap: 'cubic-bezier(0.1, 0.95, 0.25, 1)',
  back: 'cubic-bezier(0.3, 1.5, 0.5, 1)',
};
const FLASH = '#ffd84d', SPARK = '#ffa53d', FIRE = '#ff6f2b', ICE = '#8fe3ff', ACID = '#8be04e', GEL = '#6fd65c';
const rnd = (a, b) => a + Math.random() * (b - a);

// (one act: its box, its icon; what it draws - made, moved, gone)
class Act {
  constructor(box, svg, color) {
    this.box = box;
    this.svg = svg;
    this.color = color; // (its kind's colour: the halo's)
    this.anims = [];
    this.made = [];
    this.total = 0; // (the act's length: the pop's)
    const b = box.getBoundingClientRect(), s = svg.getBoundingClientRect();
    this.ox = s.left - b.left;
    this.oy = s.top - b.top;
    this.u = s.width / 24; // (px a unit of the icon)
  }
  _run(el, frames, opts) {
    const a = el.animate(frames, opts);
    this.anims.push(a);
    return a;
  }
  // (the icon itself)
  icon(frames, duration, origin = '50% 50%', extra = {}) {
    this.svg.style.transformOrigin = origin;
    this.total = Math.max(this.total, duration);
    return this._run(this.svg, frames, { duration, ...extra });
  }
  // (the beat - the act's moment: a halo in its colour flashing out behind the icon)
  beat(t, k = 1) {
    this.mark(12, 12, 26, 26, { borderRadius: '50%', background: `radial-gradient(circle, ${this.color} 0%, ${this.color} 38%, transparent 70%)`, zIndex: '0' }, [{ transform: 'scale(0.3)', opacity: 0.95 }, { transform: `scale(${1.25 * k})`, opacity: 0.55, offset: 0.35, easing: E.out }, { transform: `scale(${1.6 * k})`, opacity: 0 }], 520, t);
  }
  // (the box popped out the while - springing up, held, back in its place)
  pop(k = 1.45) {
    const T = this.total || 1000, box = this.box;
    box.style.zIndex = '2'; // (over its neighbours, popped out)
    this._run(box, [{ transform: 'scale(1)' }], { duration: T }).finished.catch(() => {}).then(() => (box.style.zIndex = ''));
    this._run(this.box, [{ transform: 'scale(1)' }, { transform: `scale(${k})`, offset: Math.min(0.2, 180 / T), easing: E.back }, { transform: `scale(${k})`, offset: 0.72 }, { transform: 'scale(1)', easing: E.io }], { duration: T, composite: 'add' });
  }
  // (a part of it - its own middle the origin)
  part(sel, i, frames, duration, delay = 0, origin = 'center') {
    const el = this.svg.querySelectorAll(sel)[i];
    if (!el) return null;
    el.style.transformBox = 'fill-box';
    el.style.transformOrigin = origin;
    return this._run(el, frames, { duration, delay });
  }
  // (the box: squashed by an impact)
  squash(at, duration, k = 1) {
    return this._run(this.box, [{ transform: 'scale(1)' }, { transform: 'scale(1)', offset: at }, { transform: `scale(${1 + 0.12 * k}, ${1 - 0.18 * k})`, offset: Math.min(0.99, at + 0.06), easing: E.back }, { transform: 'scale(1)' }], { duration, composite: 'add' });
  }
  // (a mark over it, at icon point x, y: a dot, a bar, a ring, a star - css its look; moved by frames; gone after)
  mark(x, y, w, h, css, frames, duration, delay = 0) {
    const e = document.createElement('i');
    e.className = 'act-fx';
    const W = w * this.u, H = h * this.u;
    // (hidden till its moment - waiting on its delay it sat there, still, where it starts)
    Object.assign(e.style, { left: `${this.ox + x * this.u - W / 2}px`, top: `${this.oy + y * this.u - H / 2}px`, width: `${W}px`, height: `${H}px`, opacity: '0', ...css });
    this.box.appendChild(e);
    this.made.push(e);
    const a = this._run(e, frames, { duration, delay, fill: 'forwards' });
    a.finished.catch(() => {}).then(() => e.remove());
    return a;
  }
  dot(x, y, d, color, frames, duration, delay) {
    d *= 1.4;
    return this.mark(x, y, d, d, { borderRadius: '50%', background: color }, frames, duration, delay);
  }
  ring(x, y, d, color, frames, duration, delay, wpx = 2) {
    return this.mark(x, y, d, d, { borderRadius: '50%', border: `${wpx}px solid ${color}`, boxSizing: 'border-box' }, frames, duration, delay);
  }
  star(x, y, d, color, duration, delay, spin = 90) {
    d *= 1.4;
    return this.mark(x, y, d, d, { background: color, clipPath: 'polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%)' }, [{ transform: 'scale(0) rotate(0deg)', opacity: 1 }, { transform: `scale(1.25) rotate(${spin * 0.6}deg)`, opacity: 1, offset: 0.45, easing: E.out }, { transform: `scale(0) rotate(${spin}deg)`, opacity: 0.6 }], duration, delay);
  }
  // (a short bar from x, y at angle deg, length l units - drawn out from its start)
  bar(x, y, l, t, deg, color, frames, duration, delay) {
    t *= 1.35;
    return this.mark(x + l / 2, y, l, t, { background: color, borderRadius: `${t}px`, transformOrigin: '0 50%' }, frames(deg), duration, delay);
  }
  // (lines flying out of a point, all round it: an impact, a flash)
  burst(x, y, n, len, color, delay, duration = 420, spread = 360, dir = 0) {
    for (let i = 0; i < n; i++) {
      const a = dir + (spread === 360 ? (i / n) * 360 : -spread / 2 + (spread * i) / Math.max(1, n - 1)) + rnd(-8, 8);
      this.bar(x, y, len * 1.4, 1.8, a, color, (deg) => [
        { transform: `rotate(${deg}deg) translateX(${1.5 * this.u}px) scaleX(0.2)`, opacity: 1 },
        { transform: `rotate(${deg}deg) translateX(${4.5 * this.u}px) scaleX(1)`, opacity: 1, offset: 0.35, easing: E.out },
        { transform: `rotate(${deg}deg) translateX(${10 * this.u}px) scaleX(0.4)`, opacity: 0 },
      ], duration, delay);
    }
  }
  // (sparks thrown off a point - in a cone round dir, each its own way, falling a little)
  sparks(x, y, n, color, delay, duration = 520, dir = -60, cone = 90, dist = 10) {
    for (let i = 0; i < n; i++) {
      const a = ((dir + rnd(-cone / 2, cone / 2)) * Math.PI) / 180, r = rnd(0.6, 1) * dist * 1.5 * this.u, dx = Math.cos(a) * r, dy = Math.sin(a) * r;
      this.dot(x, y, rnd(1.8, 2.6), color, [{ transform: 'translate(0, 0) scale(1)', opacity: 1 }, { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(1)`, opacity: 1, offset: 0.6, easing: E.out }, { transform: `translate(${dx}px, ${dy + 3 * this.u}px) scale(0.4)`, opacity: 0 }], duration, delay + rnd(0, 120));
    }
  }
  cancel() {
    for (const a of this.anims) a.cancel();
    for (const e of this.made) e.remove();
    this.box.style.zIndex = '';
  }
}

// The acts, by tool (keyframes: offsets 0..1 of each one's duration)
const ACTS = {
  // a wave, three times over, from the wrist - lines of the motion either side
  hand(c) {
    c.beat(140);
    c.icon([{ transform: 'none' }, { transform: 'rotate(-26deg) translateY(-1px)', offset: 0.14, easing: E.io }, { transform: 'rotate(22deg)', offset: 0.32, easing: E.io }, { transform: 'rotate(-20deg)', offset: 0.5, easing: E.io }, { transform: 'rotate(15deg)', offset: 0.67, easing: E.io }, { transform: 'rotate(-6deg)', offset: 0.83, easing: E.io }, { transform: 'none' }], 1150, '38% 92%');
    for (const [x, d, t] of [[2, 210, 120], [22, -30, 330], [2, 210, 520]])
      c.bar(x, 7, 4, 1.4, d, 'currentColor', (deg) => [{ transform: `rotate(${deg}deg) scaleX(0)`, opacity: 0.9 }, { transform: `rotate(${deg}deg) scaleX(1)`, opacity: 0.9, offset: 0.5, easing: E.out }, { transform: `rotate(${deg}deg) translateX(${2 * c.u}px) scaleX(0.3)`, opacity: 0 }], 320, t);
  },
  // drawn back over the shoulder, then the slash - a streak across the box after the blade - and the blade's glint
  knife(c) {
    c.beat(400);
    c.icon([{ transform: 'none' }, { transform: 'translate(1px, -2px) rotate(34deg) scale(1.06)', offset: 0.3, easing: E.in }, { transform: 'translate(-2px, 3px) rotate(-24deg) scale(1.1)', offset: 0.42, easing: E.out }, { transform: 'rotate(7deg)', offset: 0.62, easing: E.io }, { transform: 'rotate(-2deg)', offset: 0.8 }, { transform: 'none' }], 1000, '76% 29%');
    c.bar(1, 1, 31, 2.2, 45, 'linear-gradient(90deg, transparent, currentColor 30%, currentColor 70%, transparent)', (deg) => [{ transform: `rotate(${deg}deg) scaleX(0)`, opacity: 1 }, { transform: `rotate(${deg}deg) scaleX(1)`, opacity: 1, offset: 0.4, easing: E.snap }, { transform: `rotate(${deg}deg) scaleX(1) translateY(1px)`, opacity: 0 }], 420, 330);
    c.star(9, 15, 7, 'currentColor', 420, 640, 120);
  },
  // chop, chop, CHOP - little cubes off it each time
  dicer(c) {
    c.beat(660, 1.1);
    const chop = (k) => [{ transform: `scale(${1 + 0.1 * k}, ${1 - 0.26 * k}) translateY(2px)`, easing: E.out }, { transform: 'scale(0.96, 1.06)', easing: E.io }];
    c.icon([{ transform: 'none' }, { ...chop(0.9)[0], offset: 0.12 }, { ...chop(0.9)[1], offset: 0.24 }, { ...chop(0.9)[0], offset: 0.36 }, { ...chop(0.9)[1], offset: 0.48 }, { ...chop(1.2)[0], offset: 0.6 }, { transform: 'scale(0.94, 1.08)', offset: 0.74, easing: E.io }, { transform: 'scale(1.02, 0.98)', offset: 0.88 }, { transform: 'none' }], 1150, '50% 100%');
    for (const [t, s] of [[130, -1], [400, 1], [680, -1], [680, 1]]) {
      const dx = s * rnd(9, 13) * c.u;
      c.mark(12 + s * 6, 19, 3, 3, { background: 'currentColor', borderRadius: '1px' }, [{ transform: 'translate(0, 0) rotate(0)', opacity: 1 }, { transform: `translate(${dx * 0.6}px, ${-6 * c.u}px) rotate(${s * 120}deg)`, opacity: 1, offset: 0.45, easing: E.out }, { transform: `translate(${dx}px, ${4 * c.u}px) rotate(${s * 260}deg)`, opacity: 0 }], 560, t);
    }
  },
  // fired - kick, flash, a nail flying off - and again
  nailgun(c) {
    c.beat(0);
    c.beat(420, 0.8);
    c.icon([{ transform: 'none' }, { transform: 'translateX(-5px) rotate(-16deg)', offset: 0.08, easing: E.out }, { transform: 'translateX(1px) rotate(3deg)', offset: 0.3, easing: E.io }, { transform: 'none', offset: 0.42 }, { transform: 'translateX(-5px) rotate(-16deg)', offset: 0.5, easing: E.out }, { transform: 'translateX(1px) rotate(3deg)', offset: 0.72, easing: E.io }, { transform: 'none' }], 1000, '28% 62%');
    for (const t of [0, 420]) {
      c.star(22.5, 9.8, 8, FLASH, 220, t, 45);
      c.bar(22, 9.8, 6, 1.6, 0, 'currentColor', (deg) => [{ transform: `rotate(${deg}deg) translateX(0)`, opacity: 1 }, { transform: `rotate(${deg}deg) translateX(${16 * c.u}px)`, opacity: 0, easing: E.out }], 380, t + 20);
    }
  },
  // fired - its shot, a ring, punched out ahead of it
  holegun(c) {
    c.beat(0, 1.1);
    c.icon([{ transform: 'none' }, { transform: 'translateX(-6px) rotate(-18deg)', offset: 0.1, easing: E.out }, { transform: 'translateX(1px) rotate(4deg)', offset: 0.4, easing: E.io }, { transform: 'rotate(-2deg)', offset: 0.6 }, { transform: 'none' }], 950, '28% 62%');
    c.star(21, 9.5, 9, FLASH, 240, 0, 45);
    c.ring(24, 9.5, 6, 'currentColor', [{ transform: 'translateX(0) scale(0.3)', opacity: 1 }, { transform: `translateX(${8 * c.u}px) scale(1.4)`, opacity: 0.9, offset: 0.6, easing: E.out }, { transform: `translateX(${10 * c.u}px) scale(1.8)`, opacity: 0 }], 520, 40);
  },
  // spun up and let rip: kick after kick, a flash at the barrels each time, its shells thrown out
  autogun(c) {
    c.beat(60);
    c.beat(480, 0.8);
    const f = [{ transform: 'none' }];
    for (let i = 0; i < 6; i++) {
      const o = 0.08 + i * 0.12;
      f.push({ transform: `translateX(-3px) rotate(${i % 2 ? -6 : -9}deg)`, offset: o, easing: E.out }, { transform: 'translateX(0) rotate(-2deg)', offset: o + 0.06 });
    }
    f.push({ transform: 'rotate(2deg)', offset: 0.9, easing: E.io }, { transform: 'none' });
    c.icon(f, 1100, '24% 60%');
    c.part('path', 0, [{ transform: 'none' }, { transform: 'translateY(-1px)' }, { transform: 'translateY(1px)' }, { transform: 'none' }], 120);
    for (let i = 0; i < 6; i++) {
      const t = 80 + i * 132;
      c.star(21.5, 12, 6.5, i % 2 ? FLASH : SPARK, 150, t, 45);
      c.mark(9, 14, 2.4, 1.2, { background: SPARK, borderRadius: '1px' }, [{ transform: 'translate(0, 0) rotate(0)', opacity: 1 }, { transform: `translate(${-4 * c.u}px, ${-3 * c.u}px) rotate(-200deg)`, opacity: 1, offset: 0.4, easing: E.out }, { transform: `translate(${-7 * c.u}px, ${6 * c.u}px) rotate(-420deg)`, opacity: 0 }], 520, t);
    }
  },
  // racked - the pump back and forth - then BOOM: a big kick, a big flash, the pellets spreading
  shotgun(c) {
    c.beat(560, 1.25);
    c.part('path', 1, [{ transform: 'none' }, { transform: 'translateX(-3px)', offset: 0.18, easing: E.io }, { transform: 'none', offset: 0.36, easing: E.back }, { transform: 'none' }], 1150);
    c.part('path', 2, [{ transform: 'none' }, { transform: 'translateX(-3px)', offset: 0.18, easing: E.io }, { transform: 'none', offset: 0.36, easing: E.back }, { transform: 'none' }], 1150);
    c.icon([{ transform: 'none' }, { transform: 'rotate(-3deg)', offset: 0.2 }, { transform: 'none', offset: 0.38 }, { transform: 'none', offset: 0.46 }, { transform: 'translateX(-7px) rotate(-22deg)', offset: 0.52, easing: E.out }, { transform: 'translateX(1px) rotate(5deg)', offset: 0.78, easing: E.io }, { transform: 'none' }], 1150, '18% 60%');
    c.star(22.5, 9.2, 12, FLASH, 260, 520, 45);
    c.star(22.5, 9.2, 7, SPARK, 220, 560, -45);
    for (const a of [-14, -4, 6, 15]) c.dot(23, 9.4, 1.8, 'currentColor', [{ transform: 'translate(0, 0)', opacity: 1 }, { transform: `translate(${Math.cos((a * Math.PI) / 180) * 14 * c.u}px, ${Math.sin((a * Math.PI) / 180) * 14 * c.u}px)`, opacity: 0, easing: E.out }], 380, 540);
  },
  // drawn back, and SMACK - the box takes it, lines flying off where it hit - and the wobble after
  mallet(c) {
    c.beat(440, 1.2);
    c.icon([{ transform: 'none' }, { transform: 'rotate(30deg)', offset: 0.3, easing: E.io }, { transform: 'rotate(-28deg)', offset: 0.4, easing: E.in }, { transform: 'rotate(-17deg)', offset: 0.47, easing: E.out }, { transform: 'rotate(-25deg)', offset: 0.55, easing: E.io }, { transform: 'rotate(6deg)', offset: 0.78, easing: E.io }, { transform: 'rotate(-2deg)', offset: 0.9 }, { transform: 'none' }], 1150, '72% 86%');
    c.squash(0.4, 1150, 1);
    c.burst(3, 15, 6, 4.5, 'currentColor', 450);
    c.star(4, 15, 9, FLASH, 300, 450, 45);
  },
  // the fuse lit: sparks spitting off it, the bomb shaking harder and harder - then it pops, a flash ring off it
  bomb(c) {
    c.beat(880, 1.35);
    const f = [{ transform: 'none' }];
    for (let i = 1; i <= 8; i++) f.push({ transform: `rotate(${(i % 2 ? -1 : 1) * (2 + i * 1.3)}deg) scale(${1 + i * 0.012})`, offset: i * 0.08 });
    f.push({ transform: 'scale(1.32)', offset: 0.72, easing: E.out }, { transform: 'scale(0.88)', offset: 0.82, easing: E.io }, { transform: 'scale(1.04)', offset: 0.92 }, { transform: 'none' });
    c.icon(f, 1250, '45% 58%');
    for (let k = 0; k < 4; k++) c.sparks(21.8, 2.6, 2, k % 2 ? FLASH : SPARK, k * 170, 460, -70, 120, 8);
    c.ring(10.5, 14, 16, FIRE, [{ transform: 'scale(0.4)', opacity: 1 }, { transform: 'scale(1.7)', opacity: 0, easing: E.out }], 520, 880, 3);
    c.burst(10.5, 14, 8, 4, SPARK, 880, 460);
  },
  // the flame flaring up and flickering, glowing - embers rising off it
  torch(c) {
    c.beat(120);
    c.icon([{ transform: 'none', filter: 'drop-shadow(0 0 0 transparent)' }, { transform: 'scale(1.06, 1.26)', filter: `drop-shadow(0 0 6px ${FIRE})`, offset: 0.12, easing: E.out }, { transform: 'scale(0.94, 0.88) skewX(4deg)', offset: 0.24 }, { transform: 'scale(1.05, 1.18) skewX(-5deg)', filter: `drop-shadow(0 0 5px ${SPARK})`, offset: 0.38 }, { transform: 'scale(0.97, 0.93) skewX(3deg)', offset: 0.52 }, { transform: 'scale(1.03, 1.1)', filter: `drop-shadow(0 0 4px ${FIRE})`, offset: 0.66 }, { transform: 'scale(0.99, 0.97)', offset: 0.82 }, { transform: 'none', filter: 'drop-shadow(0 0 0 transparent)' }], 1250, '50% 100%');
    for (let i = 0; i < 5; i++) {
      const dx = rnd(-4, 4) * c.u;
      c.dot(12 + rnd(-3, 3), 7, rnd(1.6, 2.4), i % 2 ? SPARK : FLASH, [{ transform: 'translate(0, 0) scale(1)', opacity: 0 }, { transform: `translate(${dx * 0.5}px, ${-5 * c.u}px) scale(1)`, opacity: 1, offset: 0.35 }, { transform: `translate(${dx}px, ${-13 * c.u}px) scale(0.3)`, opacity: 0, easing: E.out }], 700, 120 + i * 140);
    }
  },
  // a turn and a shiver, icy - frost rings off it, flakes drifting out
  freeze(c) {
    c.beat(380);
    c.icon([{ transform: 'none', filter: 'drop-shadow(0 0 0 transparent)' }, { transform: 'rotate(60deg) scale(1.18)', filter: `drop-shadow(0 0 5px ${ICE})`, offset: 0.36, easing: E.back }, { transform: 'rotate(60deg) scale(1.05) translateX(-1.2px)', offset: 0.5 }, { transform: 'rotate(60deg) scale(1.05) translateX(1.2px)', offset: 0.56 }, { transform: 'rotate(60deg) scale(1.03) translateX(-1px)', offset: 0.62 }, { transform: 'rotate(60deg) scale(1.02) translateX(0.8px)', offset: 0.68 }, { transform: 'rotate(60deg)', filter: `drop-shadow(0 0 3px ${ICE})`, offset: 0.8 }, { transform: 'rotate(60deg)', filter: 'drop-shadow(0 0 0 transparent)' }], 1200, '50% 50%');
    c.ring(12, 12, 18, ICE, [{ transform: 'scale(0.4)', opacity: 0.9 }, { transform: 'scale(1.5)', opacity: 0, easing: E.out }], 620, 300, 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd(-0.3, 0.3), r = rnd(9, 13) * c.u;
      c.star(12, 12, rnd(3.6, 5), ICE, 700, 280 + i * 40, 90).effect?.setKeyframes?.([{ transform: 'translate(0, 0) scale(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * r * 0.6}px, ${Math.sin(a) * r * 0.6}px) scale(1)`, opacity: 1, offset: 0.4, easing: E.out }, { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r + 2 * c.u}px) scale(0.5) rotate(90deg)`, opacity: 0 }]);
    }
  },
  // sloshed - its bubbles rising out of its neck and popping
  acid(c) {
    c.beat(200);
    c.icon([{ transform: 'none', filter: 'drop-shadow(0 0 0 transparent)' }, { transform: 'rotate(-14deg)', filter: `drop-shadow(0 0 4px ${ACID})`, offset: 0.2, easing: E.io }, { transform: 'rotate(11deg)', offset: 0.4, easing: E.io }, { transform: 'rotate(-7deg)', offset: 0.58, easing: E.io }, { transform: 'rotate(3deg)', offset: 0.76 }, { transform: 'none', filter: 'drop-shadow(0 0 0 transparent)' }], 1150, '50% 92%');
    c.part('circle', 0, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-7px) scale(1.3)', opacity: 0, offset: 0.5 }, { transform: 'none', opacity: 0, offset: 0.51 }, { transform: 'none', opacity: 1 }], 1100);
    c.part('circle', 1, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-8px) scale(1.4)', opacity: 0, offset: 0.62 }, { transform: 'none', opacity: 0, offset: 0.63 }, { transform: 'none', opacity: 1 }], 1100, 120);
    for (let i = 0; i < 4; i++) {
      const d = rnd(2.6, 4), dx = rnd(-3, 3) * c.u;
      c.ring(12, 3, d, ACID, [{ transform: 'translate(0, 0) scale(0.4)', opacity: 0 }, { transform: `translate(${dx * 0.5}px, ${-5 * c.u}px) scale(1)`, opacity: 1, offset: 0.4 }, { transform: `translate(${dx}px, ${-10 * c.u}px) scale(1.5)`, opacity: 0, easing: E.out }], 640, 150 + i * 170, 1.5);
    }
  },
  // a double take - its pupils darting left, right, up - and a blink
  eyes(c) {
    c.beat(140);
    const look = [{ transform: 'none' }, { transform: 'translate(-2.6px, -0.6px)', offset: 0.12, easing: E.snap }, { transform: 'translate(-2.6px, -0.6px)', offset: 0.3 }, { transform: 'translate(2.6px, -1.2px)', offset: 0.38, easing: E.snap }, { transform: 'translate(2.6px, -1.2px)', offset: 0.55 }, { transform: 'translate(0, -3px)', offset: 0.62, easing: E.snap }, { transform: 'translate(0, -3px)', offset: 0.7 }, { transform: 'none', offset: 0.78, easing: E.back }, { transform: 'none' }];
    c.part('circle', 2, look, 1300);
    c.part('circle', 3, look, 1300);
    c.icon([{ transform: 'none' }, { transform: 'none', offset: 0.8 }, { transform: 'scaleY(0.1)', offset: 0.85, easing: E.in }, { transform: 'scaleY(1.08)', offset: 0.92, easing: E.out }, { transform: 'none' }], 1300, '50% 50%');
  },
  // shaken over the box - flour sifting out of it, falling
  flour(c) {
    c.beat(100);
    const f = [{ transform: 'none' }];
    for (let i = 1; i <= 7; i++) f.push({ transform: `translate(${(i % 2 ? -1 : 1) * 3}px, ${i % 2 ? 1 : -1}px) rotate(${(i % 2 ? -1 : 1) * 9}deg)`, offset: i * 0.11, easing: E.io });
    f.push({ transform: 'none' });
    c.icon(f, 1100, '42% 35%');
    for (let i = 0; i < 4; i++) c.part('circle', i + 1, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(5px)', opacity: 0, offset: 0.7 }, { transform: 'none', opacity: 0, offset: 0.71 }, { transform: 'none', opacity: 1 }], 900, i * 110);
    for (let i = 0; i < 9; i++) c.dot(10 + rnd(-4, 4), 15, rnd(1, 1.6), 'currentColor', [{ transform: 'translate(0, 0)', opacity: 0 }, { transform: `translate(${rnd(-1, 1) * c.u}px, ${3 * c.u}px)`, opacity: 0.9, offset: 0.2 }, { transform: `translate(${rnd(-2, 2) * c.u}px, ${12 * c.u}px)`, opacity: 0, easing: E.in }], 700, 80 + i * 90);
  },
  // scooped - its ball popped up out of it and bouncing back in
  baller(c) {
    c.beat(600);
    c.icon([{ transform: 'none' }, { transform: 'rotate(-30deg)', offset: 0.3, easing: E.io }, { transform: 'rotate(16deg)', offset: 0.48, easing: E.out }, { transform: 'rotate(-5deg)', offset: 0.66 }, { transform: 'none' }], 1150, '80% 28%');
    c.part('circle', 0, [{ transform: 'none' }, { transform: 'none', offset: 0.44 }, { transform: 'translate(-1px, -9px)', offset: 0.58, easing: E.out }, { transform: 'none', offset: 0.72, easing: E.in }, { transform: 'translateY(-3px)', offset: 0.8, easing: E.out }, { transform: 'none', offset: 0.88, easing: E.in }, { transform: 'none' }], 1150);
  },
  // scooped - its cube popped up out of it, spinning, and dropped back
  cuber(c) {
    c.beat(600);
    c.icon([{ transform: 'none' }, { transform: 'rotate(-30deg)', offset: 0.3, easing: E.io }, { transform: 'rotate(16deg)', offset: 0.48, easing: E.out }, { transform: 'rotate(-5deg)', offset: 0.66 }, { transform: 'none' }], 1150, '80% 28%');
    c.part('rect', 0, [{ transform: 'none' }, { transform: 'none', offset: 0.44 }, { transform: 'translate(-1px, -10px) rotate(-180deg)', offset: 0.62, easing: E.out }, { transform: 'rotate(-360deg)', offset: 0.8, easing: E.in }, { transform: 'translateY(-2px) rotate(-360deg)', offset: 0.88 }, { transform: 'rotate(-360deg)' }], 1150);
  },
  // the plunger pushed home - a squirt off the needle
  syringe(c) {
    c.beat(450);
    c.icon([{ transform: 'none' }, { transform: 'translate(2px, -2px)', offset: 0.25, easing: E.io }, { transform: 'translate(-3px, 3px)', offset: 0.42, easing: E.in }, { transform: 'translate(-2px, 2px)', offset: 0.58 }, { transform: 'none', easing: E.back }], 1000, '50% 50%');
    c.part('path', 0, [{ transform: 'none' }, { transform: 'none', offset: 0.36 }, { transform: 'translate(-3px, 3px)', offset: 0.55, easing: E.in }, { transform: 'none' }], 1000);
    c.part('path', 1, [{ transform: 'none' }, { transform: 'none', offset: 0.36 }, { transform: 'translate(-3px, 3px)', offset: 0.55, easing: E.in }, { transform: 'none' }], 1000);
    for (let i = 0; i < 3; i++) c.dot(2.5, 21.5, rnd(1.8, 2.6), ACID, [{ transform: 'translate(0, 0)', opacity: 1 }, { transform: `translate(${-rnd(4, 8) * c.u}px, ${rnd(2, 6) * c.u}px)`, opacity: 0, easing: E.out }], 420, 440 + i * 50);
  },
  // tipped - two blobs of jelly (its own colour) dropping from the ladle; its steam rising
  feed(c) {
    c.beat(380);
    c.icon([{ transform: 'none' }, { transform: 'rotate(-34deg)', offset: 0.32, easing: E.io }, { transform: 'rotate(-30deg)', offset: 0.58 }, { transform: 'rotate(6deg)', offset: 0.8, easing: E.back }, { transform: 'none' }], 1250, '86% 18%');
    c.part('path', 2, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-4px)', opacity: 0, offset: 0.6 }, { transform: 'none', opacity: 0, offset: 0.61 }, { transform: 'none', opacity: 1 }], 1250);
    for (const t of [380, 560]) c.mark(5, 13, 4, 4, { borderRadius: '50%', background: 'var(--jelly)' }, [{ transform: 'translate(0, 0) scale(0.4, 0.4)', opacity: 1 }, { transform: `translate(0, ${6 * c.u}px) scale(0.85, 1.3)`, opacity: 1, offset: 0.6, easing: E.in }, { transform: `translate(0, ${13 * c.u}px) scale(1.5, 0.5)`, opacity: 0 }], 520, t);
  },
  // fired - a glob of jelly wobbling away
  gelgun(c) {
    c.beat(90);
    c.icon([{ transform: 'none' }, { transform: 'translateX(-4px) rotate(-12deg)', offset: 0.12, easing: E.out }, { transform: 'translateX(1px) rotate(3deg)', offset: 0.42, easing: E.io }, { transform: 'none' }], 950, '28% 62%');
    c.part('path', 1, [{ transform: 'none', opacity: 1 }, { transform: 'translateX(7px) scale(1.3, 0.75)', opacity: 1, offset: 0.25, easing: E.out }, { transform: 'translateX(12px) scale(0.8, 1.25)', opacity: 0, offset: 0.45 }, { transform: 'scale(0)', opacity: 0, offset: 0.46 }, { transform: 'scale(1.2)', opacity: 1, offset: 0.75, easing: E.back }, { transform: 'none', opacity: 1 }], 950);
    c.mark(22, 10.5, 4.5, 4.5, { borderRadius: '50%', background: GEL }, [{ transform: 'translateX(0) scale(0.5)', opacity: 0 }, { transform: `translateX(${8 * c.u}px) scale(1.3, 0.8)`, opacity: 1, offset: 0.35, easing: E.out }, { transform: `translateX(${13 * c.u}px) scale(0.85, 1.2)`, opacity: 1, offset: 0.65 }, { transform: `translateX(${16 * c.u}px) scale(1)`, opacity: 0 }], 620, 60);
  },
  // pulling - lines of its pull closing in on its poles, a nail snapped onto it
  magnet(c) {
    c.beat(560);
    c.icon([{ transform: 'none' }, { transform: 'scale(1.16) translateY(-1px)', offset: 0.22, easing: E.out }, { transform: 'scale(0.94)', offset: 0.38 }, { transform: 'translateY(-2px)', offset: 0.6, easing: E.out }, { transform: 'translateY(1px) scale(1.04, 0.95)', offset: 0.68, easing: E.back }, { transform: 'none' }], 1150, '50% 60%');
    for (const [i, t] of [[0, 0], [1, 160], [2, 320]]) c.mark(12, 2, 16 - i * 2, 7, { borderRadius: '50% 50% 0 0', borderTop: '2px solid currentColor', borderLeft: '2px solid transparent', borderRight: '2px solid transparent', boxSizing: 'border-box' }, [{ transform: `translateY(${-6 * c.u}px) scale(1.5)`, opacity: 0 }, { transform: `translateY(${-3 * c.u}px) scale(1.1)`, opacity: 0.85, offset: 0.4 }, { transform: 'translateY(0) scale(0.6)', opacity: 0, easing: E.in }], 520, t);
    c.bar(12, -10, 6, 1.6, 90, 'currentColor', (deg) => [{ transform: `rotate(${deg}deg) translateX(0)`, opacity: 0 }, { transform: `rotate(${deg}deg) translateX(${2 * c.u}px)`, opacity: 1, offset: 0.2 }, { transform: `rotate(${deg}deg) translateX(${8 * c.u}px)`, opacity: 1, offset: 0.55, easing: E.in }, { transform: `rotate(${deg}deg) translateX(${8 * c.u}px)`, opacity: 1, offset: 0.85 }, { transform: `rotate(${deg}deg) translateX(${8 * c.u}px)`, opacity: 0 }], 900, 300);
  },
  // wound back and spun right round, its middle turning the other way
  twist(c) {
    c.beat(420);
    c.icon([{ transform: 'none' }, { transform: 'rotate(-28deg) scale(0.92)', offset: 0.2, easing: E.io }, { transform: 'rotate(380deg) scale(1.12)', offset: 0.62, easing: E.out }, { transform: 'rotate(352deg)', offset: 0.76, easing: E.io }, { transform: 'rotate(363deg)', offset: 0.88 }, { transform: 'rotate(360deg)' }], 1200, '50% 50%');
    c.part('rect', 0, [{ transform: 'none' }, { transform: 'none', offset: 0.2 }, { transform: 'rotate(-180deg)', offset: 0.62, easing: E.out }, { transform: 'rotate(-180deg)' }], 1200);
  },
  // a breath in, and out: each gust drawn across, one after another
  blow(c) {
    c.beat(280);
    c.icon([{ transform: 'none' }, { transform: 'scale(0.9, 1.06)', offset: 0.2, easing: E.io }, { transform: 'scale(1.14, 0.94) translateX(1px)', offset: 0.4, easing: E.out }, { transform: 'none' }], 1100, '0 50%');
    c.svg.querySelectorAll('path').forEach((p, i) => {
      const L = p.getTotalLength?.() || 20;
      c.anims.push(p.animate([{ strokeDasharray: `${L} ${L}`, strokeDashoffset: L }, { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0, offset: 0.45, easing: E.out }, { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0, offset: 0.7 }, { strokeDasharray: `${L} ${L}`, strokeDashoffset: -L, easing: E.in }], { duration: 760, delay: 200 + i * 110 }));
    });
  },
};

// (play tool id's act on its icon in box, color its kind's - the one playing there now, stopped)
export function act(box, id, color = '#8c8c96') {
  if (motion.reduced || !box) return;
  const svg = box.querySelector(':scope > svg') || box.querySelector('svg');
  const fn = ACTS[id];
  if (!svg || !fn || !box.isConnected) return;
  box._act?.cancel();
  const c = new Act(box, svg, color);
  box._act = c;
  try {
    fn(c);
    c.pop();
  } catch (e) {
    c.cancel();
  }
}
