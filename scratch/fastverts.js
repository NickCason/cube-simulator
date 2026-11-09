// the fastest vertices (relative to their piece) - what they belong to: their tets' size and shape, how many, their mass
await new Promise((r) => requestAnimationFrame(r));
const sb = __app.sb, v = sb.v, nV = sb.nV, h = sb.hCell;
const pv = new Float64Array(sb.pieces.length * 3), pm = new Float64Array(sb.pieces.length);
for (let i = 0; i < nV; i++) { const k = sb.vPiece[i]; if (k < 0 || !sb.w[i]) continue; for (let c = 0; c < 3; c++) pv[k * 3 + c] += v[i * 3 + c] * sb.m[i]; pm[k] += sb.m[i]; }
for (let k = 0; k < sb.pieces.length; k++) for (let c = 0; c < 3; c++) pv[k * 3 + c] /= pm[k] || 1;
const rel = [];
for (let i = 0; i < nV; i++) { const k = sb.vPiece[i]; if (k < 0) continue; rel.push([Math.hypot(v[i * 3] - pv[k * 3], v[i * 3 + 1] - pv[k * 3 + 1], v[i * 3 + 2] - pv[k * 3 + 2]), i]); }
rel.sort((a, b) => b[0] - a[0]);
const vtS = sb.vtStart, vtL = sb.vtList, T = sb.T, typ = sb.p.size ** 3 / sb.nT;
const out = [];
for (const [s, i] of rel.slice(0, 12)) {
  const tets = [];
  for (let e = vtS[i]; e < vtS[i + 1]; e++) { const t = vtL[e]; tets.push(sb.vol0[t] / (h ** 3 / 6)); }
  out.push({ v: i, speed: +s.toFixed(2), m: +(sb.m[i] / (sb.p.size ** 3 / sb.nV)).toFixed(3), w: sb.w[i] > 0, tets: tets.length, vol: tets.map((x) => +x.toFixed(3)).slice(0, 6), dmg: 0 });
}
let fast = 0; for (const [s] of rel) if (s > 5) fast++;
return { nV, over5ms: fast, median: +rel[Math.floor(rel.length / 2)][0].toFixed(3), top: out };
