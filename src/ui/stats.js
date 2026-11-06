// ?stats - a small performance overlay for checking the sim on a device:
// frame rate and a frame-time graph, physics / render / other time per
// frame, resolution and physics substeps, and a log of slow frames with what
// happened in them (new GPU shaders compiled, the jelly cut and rebuilt, the
// resolution changed). "Copy report" puts it all on the clipboard as text.

const SLOW_MS = 45;

export function attachStats(app) {
  const r = app.renderer;
  const gl = r.getContext();
  let gpu = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) {
    gpu = '?';
  }
  const t0 = performance.now();
  const programs = () => r.info.programs?.length || 0;

  // ---- per-frame measurements
  let lastStart = 0, phys = 0, rend = 0, rebuildMs = 0, rebuilds = 0, progs = programs();
  let ratio = app.pixelRatio;
  const gaps = new Float32Array(240); // frame intervals (ms), ring buffer
  const cpus = new Float32Array(240);
  let head = 0, frames = 0;
  const slow = []; // { at, gap, cpu, phys, rend, rebuild, shaders, res, tool, pieces }
  const all = []; // every interval this session, for percentiles (capped)

  // (the app records physics/render time and the body its rebuilds, so
  // nothing in the hot simulation code needs wrapping - wrapping methods
  // changes the objects' shape, which costs Safari seconds of slow code)
  const frame = app.frame.bind(app);
  app.frame = (dt) => {
    const start = performance.now();
    const gap = lastStart ? start - lastStart : 16.7;
    lastStart = start;
    frame(dt);
    phys = app.stats.physLast;
    rend = app.stats.renderLast;
    rebuildMs = app.sb.rebuildMs;
    rebuilds = app.sb.rebuilds;
    app.sb.rebuildMs = 0;
    app.sb.rebuilds = 0;
    const cpu = performance.now() - start;
    const p = programs();
    const newProgs = p - progs;
    progs = p;
    const resChanged = app.pixelRatio !== ratio;
    ratio = app.pixelRatio;
    gaps[head] = gap;
    cpus[head] = cpu;
    head = (head + 1) % gaps.length;
    frames++;
    if (all.length < 20000) all.push(gap);
    // this frame took long, or something heavy happened in it or just before it
    if (gap > SLOW_MS || cpu > SLOW_MS || newProgs > 0 || rebuilds > 0 || resChanged) {
      slow.push({
        at: (start - t0) / 1000,
        gap,
        cpu,
        phys,
        rend,
        rebuild: rebuilds ? rebuildMs : 0,
        shaders: newProgs,
        res: resChanged ? ratio : 0,
        tool: app.tool?.id || '',
        pieces: app.sb.pieces.length,
      });
      if (slow.length > 40) slow.shift();
    }
    last = { cpu, phys, rend };
  };
  let last = { cpu: 0, phys: 0, rend: 0 };

  // ---- overlay
  const el = document.createElement('div');
  el.className = 'stats';
  el.innerHTML = `<canvas width="200" height="44"></canvas><pre></pre><div class="stats-btns"><button class="copy">Copy report</button><button class="close" aria-label="Hide stats">×</button></div>`;
  document.body.appendChild(el);
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const pre = el.querySelector('pre');
  el.querySelector('.close').addEventListener('click', () => el.remove());
  el.querySelector('.copy').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'Copied ✓';
    } catch (err) {
      // no clipboard (insecure context / old browser): show it to select by hand
      pre.textContent = text;
      b.textContent = 'Select & copy';
    }
    setTimeout(() => (b.textContent = 'Copy report'), 1800);
  });

  const recent = (arr) => {
    const n = Math.min(frames, arr.length);
    const out = [];
    for (let k = 0; k < n; k++) out.push(arr[(head - 1 - k + arr.length) % arr.length]);
    return out;
  };
  const pct = (v, q) => {
    if (!v.length) return 0;
    const s = [...v].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  };
  const summary = () => {
    const g = recent(gaps).slice(0, 120);
    const fps = g.length ? 1000 / (g.reduce((a, b) => a + b, 0) / g.length) : 0;
    const sb = app.sb;
    const awake = sb.pieces.filter((p) => !p.asleep).length;
    return [
      `${fps.toFixed(0)} fps   frame ${pct(g, 0.5).toFixed(1)} ms (worst ${Math.max(0, ...g).toFixed(0)})`,
      `cpu ${last.cpu.toFixed(1)}  physics ${last.phys.toFixed(1)}  render ${last.rend.toFixed(1)} ms`,
      `substeps ${Math.round(app.substepRate)}/s   res ${app.pixelRatio.toFixed(2)}x ${app.size.pw}x${app.size.ph}`,
      `${sb.nT} tets  ${sb.pieces.length} piece${sb.pieces.length === 1 ? '' : 's'} (${awake} awake)  shaders ${programs()}`,
    ];
  };
  const fmtSlow = (s) =>
    `${s.at.toFixed(1).padStart(5)}s ${Math.round(s.gap).toString().padStart(4)}ms cpu ${Math.round(s.cpu)}` +
    (s.phys > 4 ? ` phys ${Math.round(s.phys)}` : '') +
    (s.rend > 4 ? ` rend ${Math.round(s.rend)}` : '') +
    (s.shaders ? ` +${s.shaders} shader${s.shaders > 1 ? 's' : ''}` : '') +
    (s.rebuild ? ` rebuild ${Math.round(s.rebuild)}` : '') +
    (s.res ? ` res→${s.res.toFixed(2)}x` : '') +
    (s.tool ? ` [${s.tool}]` : '');
  const report = () => {
    const w = app.warmStats;
    return [
      'Cube Simulator stats',
      `${navigator.userAgent}`,
      `gpu: ${gpu}   dpr ${window.devicePixelRatio}   cores ${navigator.hardwareConcurrency || '?'}   screen ${innerWidth}x${innerHeight}`,
      w ? `warm-up at load: ${Math.round(w.ms)} ms, ${w.programs} shaders; intro hold ${Math.round(app.introMs || 0)} ms` : '',
      `session ${((performance.now() - t0) / 1000).toFixed(0)} s, ${frames} frames: median ${pct(all, 0.5).toFixed(1)} ms, 95th ${pct(all, 0.95).toFixed(1)} ms, 99th ${pct(all, 0.99).toFixed(1)} ms`,
      ...summary(),
      'slow / eventful frames (time, interval, what happened):',
      ...slow.map(fmtSlow),
    ].filter(Boolean).join('\n');
  };

  const draw = () => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    const g = recent(gaps).slice(0, 100).reverse();
    const c = recent(cpus).slice(0, 100).reverse();
    const H = cv.height, sx = cv.width / 100, sy = H / 66;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, H - 16.7 * sy, cv.width, 1);
    ctx.fillRect(0, H - 33.3 * sy, cv.width, 1);
    for (let k = 0; k < g.length; k++) {
      const v = Math.min(66, g[k]);
      ctx.fillStyle = g[k] > SLOW_MS ? '#ff5d5d' : g[k] > 20 ? '#ffc64d' : '#6fdc8c';
      ctx.fillRect(k * sx, H - v * sy, Math.max(1, sx - 0.5), v * sy);
      ctx.fillStyle = 'rgba(120,170,255,0.75)';
      const cv2 = Math.min(66, c[k]);
      ctx.fillRect(k * sx, H - cv2 * sy, Math.max(1, sx - 0.5), 1.5);
    }
    pre.textContent = [...summary(), ...slow.slice(-5).reverse().map(fmtSlow)].join('\n');
  };
  setInterval(draw, 250);
}
