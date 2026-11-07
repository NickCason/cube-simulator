// Share as picture: one image, made to be sent - the cube's photo, its name
// and what it's made of, its stats as bars of little cubes, and its CubeR
// code as a QR to scan, on a card in its own colour. (A PNG, 1080 x 1350:
// what a phone's messages show whole.)

import { cubeStats, cubeSummary } from '../cubecode.js';
import { resolveFlavor, flavorMainHex } from '../styles.js';
import { qrEncode } from './qr.js';
import { cubeArt } from './cubby.js';

const W = 1080, H = 1350;

function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// a little isometric cube, its three faces in shades of col
function isoCube(g, cx, cy, s, col) {
  const top = mix(col, [255, 255, 255], 0.35), left = col, right = mix(col, [0, 0, 0], 0.25);
  const h = s * 0.5;
  g.fillStyle = css(top);
  g.beginPath();
  g.moveTo(cx, cy - s);
  g.lineTo(cx + s * 0.87, cy - h);
  g.lineTo(cx, cy);
  g.lineTo(cx - s * 0.87, cy - h);
  g.closePath();
  g.fill();
  g.fillStyle = css(left);
  g.beginPath();
  g.moveTo(cx - s * 0.87, cy - h);
  g.lineTo(cx, cy);
  g.lineTo(cx, cy + s);
  g.lineTo(cx - s * 0.87, cy + h);
  g.closePath();
  g.fill();
  g.fillStyle = css(right);
  g.beginPath();
  g.moveTo(cx + s * 0.87, cy - h);
  g.lineTo(cx, cy);
  g.lineTo(cx, cy + s);
  g.lineTo(cx + s * 0.87, cy + h);
  g.closePath();
  g.fill();
}

// (c: a decoded cube; thumb: its photo, a data URL, or none; link: its CubeR link)
export async function cubePicture(c, { thumb = null, link = '' } = {}) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'system-ui, sans-serif';
  const f = resolveFlavor({ flavor: c.flavor, layers: c.layers });
  const col = rgb(flavorMainHex(f)), white = [255, 255, 255], ink = [24, 24, 28];
  // the card: a wash of its colour, a faint lattice of little squares
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, css(mix(col, white, 0.9)));
  bg.addColorStop(1, css(mix(col, white, 0.74)));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = css(col, 0.06);
  for (let y = 18; y < H; y += 54) for (let x = 18 + ((y / 54) % 2) * 27; x < W; x += 54) {
    roundRect(g, x, y, 14, 14, 4);
    g.fill();
  }
  // its maker's mark
  isoCube(g, 102, 92, 26, col);
  g.fillStyle = css(ink);
  g.font = `900 46px ${font}`;
  g.textBaseline = 'alphabetic';
  g.fillText('CUBE', 146, 104);
  g.font = `700 15px ${font}`;
  g.fillStyle = css(ink, 0.6);
  const sim = 'S I M U L A T O R';
  g.fillText(sim, 148, 126);
  g.font = `650 22px ${font}`;
  g.textAlign = 'right';
  g.fillStyle = css(ink, 0.55);
  g.fillText('All is cube · Cube is all', W - 72, 104);
  g.textAlign = 'left';
  // the photo (or its little drawing), in a rounded frame with a shadow
  const px = 120, py = 160, ps = 840;
  g.save();
  g.shadowColor = css(mix(col, [0, 0, 0], 0.5), 0.35);
  g.shadowBlur = 50;
  g.shadowOffsetY = 18;
  roundRect(g, px, py, ps, ps, 56);
  g.fillStyle = css(white);
  g.fill();
  g.restore();
  g.save();
  roundRect(g, px, py, ps, ps, 56);
  g.clip();
  const photo = thumb ? await loadImage(thumb) : null;
  if (photo) g.drawImage(photo, px, py, ps, ps);
  else {
    const art = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(cubeArt(c).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')));
    const sh = g.createRadialGradient(px + ps / 2, py + ps * 0.4, 40, px + ps / 2, py + ps / 2, ps * 0.7);
    sh.addColorStop(0, css(mix(col, white, 0.92)));
    sh.addColorStop(1, css(mix(col, white, 0.7)));
    g.fillStyle = sh;
    g.fillRect(px, py, ps, ps);
    if (art) g.drawImage(art, px + ps * 0.18, py + ps * 0.18, ps * 0.64, ps * 0.64);
  }
  g.restore();
  // its name (as big as fits) and what it is
  const name = c.name || 'A brand-new cube';
  let fs = 74;
  g.font = `900 ${fs}px ${font}`;
  while (g.measureText(name).width > W - 240 && fs > 38) g.font = `900 ${(fs -= 2)}px ${font}`;
  g.fillStyle = css(ink);
  g.fillText(name, 120, 1078);
  g.font = `600 30px ${font}`;
  g.fillStyle = css(ink, 0.55);
  g.fillText(cubeSummary(c, true), 122, 1122);
  // its stats: bars of little cubes
  const stats = cubeStats(c), on = mix(col, [0, 0, 0], 0.08), off = css(ink, 0.08);
  stats.forEach(([label, v], i) => {
    const y = 1152 + i * 25;
    g.font = `800 17px ${font}`;
    g.fillStyle = css(ink, 0.62);
    g.fillText(label.toUpperCase(), 122, y + 16);
    const k = Math.round(v / 10);
    for (let p = 0; p < 10; p++) {
      roundRect(g, 232 + p * 26, y + 1, 20, 20, 5);
      g.fillStyle = p < k ? css(on) : off;
      g.fill();
    }
    g.font = `800 17px ${font}`;
    g.fillStyle = css(ink, 0.7);
    g.fillText(String(v), 502, y + 16);
  });
  // its code: a QR to scan, on a white card, with where it goes
  if (link) {
    const qr = qrEncode(link, { level: 'M' }), qs = 150, qx = W - 120 - qs, qy = 1150;
    g.save();
    g.shadowColor = 'rgba(0, 0, 0, 0.14)';
    g.shadowBlur = 24;
    g.shadowOffsetY = 8;
    roundRect(g, qx - 14, qy - 14, qs + 28, qs + 28, 22);
    g.fillStyle = '#ffffff';
    g.fill();
    g.restore();
    const m = qs / qr.size;
    g.fillStyle = '#18181c';
    for (let y = 0; y < qr.size; y++)
      for (let x = 0; x < qr.size; x++) if (qr.modules[y * qr.size + x]) g.fillRect(qx + x * m, qy + y * m, Math.ceil(m), Math.ceil(m));
    g.font = `750 19px ${font}`;
    g.textAlign = 'center';
    g.fillStyle = css(ink, 0.6);
    g.fillText('Scan for this cube', qx + qs / 2, qy + qs + 40);
    g.textAlign = 'left';
  }
  return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'));
}
