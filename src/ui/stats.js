// ?stats - a small performance overlay for checking the sim on a device:
// frame rate and a frame-time graph, physics / render / other time per
// frame, resolution and physics substeps, and a log of slow frames with what
// happened in them (new GPU shaders compiled, the jelly cut and rebuilt, the
// resolution changed) - each slow one's physics broken down into its parts.
// And a log of what was done, enough to do it again (scratch/replay.mjs):
// the scene (every cube's code, the settings, the view), then every touch
// and click on the jelly - where on the screen, what it landed on, the
// camera - each drag's path, the tools picked, settings changed, re-cubes,
// cuts. "Mark" puts a marker in it (it lagged here). "Copy report" puts it
// all on the clipboard as text.

import { captureCube, encodeCube } from '../cubecode.js';
import { PROF_PHASES } from '../sim/softbody.js';

const SLOW_MS = 45;
const LOG_S = 120; // (s of the log the report keeps)
const SAMPLE_MS = 100; // (a drag's path: a point this often)

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
  const now = () => (performance.now() - t0) / 1000;
  const programs = () => r.info.programs?.length || 0;
  const f2 = (v) => (Math.round(v * 100) / 100).toString();
  const f3 = (v) => (Math.round(v * 1000) / 1000).toString();

  // ---- the log: [t, text], the last LOG_S seconds
  const log = [];
  const say = (text, t = now()) => {
    log.push([t, text]);
    while (log.length && (log[0][0] < t - LOG_S || log.length > 6000)) log.shift();
  };
  app.statsSay = (text) => say(text);

  // ---- the scene: every cube's code, the settings, the view
  const cubeCode = (cb) => {
    try {
      return encodeCube(captureCube({ style: cb.style, tune: cb.tune, theme: app.theme }));
    } catch (e) {
      return '?';
    }
  };
  const cam = () => {
    const o = app.orbit, t = o.target;
    return `${f3(o.theta)} ${f3(o.phi)} ${f3(o.radius)} ${f3(t.x)},${f3(t.y)},${f3(t.z)}`;
  };
  // (the jelly's shader: the parts compiled into the one it's drawn with -
  // and what's wanted, while that's still compiling: see JellyView.setFeatures)
  const featParts = (k) => (k === undefined ? '-' : ['irid', 'metal', 'opal', 'surf', 'coat', 'glow', 'dyn', 'dbg', 'holes'].filter((_, b) => k & (1 << b)).join('+') || 'plain');
  const shader = () => {
    const J = app.jelly, k = J._featKey, w = J._wantFeatures?.(app.sb);
    return `${featParts(k)}${w !== undefined && w !== k ? ` (want ${featParts(w)})` : ''}`;
  };
  const sceneLines = () => {
    const sel = app.cube?.slot;
    const set = Object.keys(app.tune)
      .sort()
      .map((k) => `${k}=${typeof app.tune[k] === 'number' ? f3(app.tune[k]) : app.tune[k]}`)
      .join(' ');
    return [
      `view: canvas ${app.canvas.clientWidth}x${app.canvas.clientHeight} css  res ${app.pixelRatio.toFixed(2)}x ${app.size.pw}x${app.size.ph}  theme ${app.theme}  place ${app.place}  room ${app.room?.on ? 'on' : 'off'}  tearing ${app.tearing ? 'on' : 'off'}  tool ${app.tool?.id || '-'}  shader ${shader()}`,
      `camera: ${cam()}   (theta phi radius target)`,
      `cubes (* selected): ${app.cubes.map((cb) => `${cb.slot === sel ? '*' : ''}${cb.slot} ${cubeCode(cb)}`).join('   ')}`,
      `settings: ${set || '(all as made)'}`,
    ];
  };

  // ---- what's done on the jelly: touches and clicks on the canvas
  // (x, y: 0..1 across and down the canvas; what it landed on - its piece,
  // where, and where that is in the jelly at rest - and the camera then)
  const pts = new Map(); // pointerId -> { t, samples: [[ms, x, y]], last }
  const xy = (e) => {
    const rc = app.canvas.getBoundingClientRect();
    return [(e.clientX - rc.left) / rc.width, (e.clientY - rc.top) / rc.height];
  };
  const onCanvas = (e) => e.target === app.canvas;
  const hitText = (e) => {
    try {
      const ray = app.rayFromClient(e.clientX, e.clientY).clone();
      const h = app.pickJelly(ray) || app.pickJellyNear(ray);
      if (!h) return 'miss';
      // (where that is at rest: the hit triangle's corners, its barycentrics)
      const sb = app.sb, F = sb.sTri, X = sb.X, rest = [0, 0, 0];
      if (h.face >= 0 && h.bary?.length === 3) for (let q = 0; q < 3; q++) for (let c = 0; c < 3; c++) rest[c] += X[F[h.face * 3 + q] * 3 + c] * h.bary[q];
      return `hit ${h.piece} ${h.point.map(f3).join(',')} rest ${rest.map(f3).join(',')}${h.near ? ' near' : ''}`;
    } catch (err) {
      return 'hit ?';
    }
  };
  const flush = (id, p) => {
    if (!p.samples.length) return;
    say(`move ${id} ${p.samples.map(([ms, x, y]) => `${ms}:${f3(x)},${f3(y)}`).join(' ')}`, p.t);
    p.samples = [];
  };
  addEventListener(
    'pointerdown',
    (e) => {
      if (!onCanvas(e)) return;
      const [x, y] = xy(e);
      say(`down ${e.pointerId} ${e.pointerType} ${f3(x)} ${f3(y)} ${hitText(e)} cam ${cam()}`);
      pts.set(e.pointerId, { t: now(), samples: [], last: 0 });
    },
    { capture: true, passive: true },
  );
  addEventListener(
    'pointermove',
    (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const t = now(), ms = Math.round((t - p.t) * 1000);
      if (ms - p.last < SAMPLE_MS) return;
      p.last = ms;
      const [x, y] = xy(e);
      p.samples.push([ms, x, y]);
      // (a line a second or so, each its own start time)
      if (ms > 1000) {
        flush(e.pointerId, p);
        p.t = t;
        p.last = 0;
      }
    },
    { capture: true, passive: true },
  );
  const end = (kind) => (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    flush(e.pointerId, p);
    pts.delete(e.pointerId);
    const [x, y] = xy(e);
    say(`${kind} ${e.pointerId} ${f3(x)} ${f3(y)}`);
  };
  addEventListener('pointerup', end('up'), { capture: true, passive: true });
  addEventListener('pointercancel', end('cancel'), { capture: true, passive: true });
  addEventListener(
    'wheel',
    (e) => {
      if (onCanvas(e)) say(`wheel ${Math.round(e.deltaY)}`);
    },
    { capture: true, passive: true },
  );

  // ---- what changes, looked at each frame (or now and then): the tool,
  // cuts, re-cubes, the camera, the cubes and the settings
  let tool = app.tool?.id || '', topo = -1, healing = false, camAt = 0, camLast = '', sceneAt = 0;
  let codes = new Map(app.cubes.map((cb) => [cb.slot, cubeCode(cb)]));
  let tune = { ...app.tune }, theme = app.theme, place = app.place, sel = app.cube?.slot;
  const watch = () => {
    const t = now(), sb = app.sb;
    const id = app.tool?.id || '';
    if (id !== tool) say(`tool ${(tool = id)}`);
    if (sb.topoVersion !== topo) {
      if (topo >= 0) say(`topo ${sb.pieces.length} pieces ${sb.nT} tets [${id}]`);
      topo = sb.topoVersion;
    }
    const h = !!app.healer?.active;
    if (h !== healing) say(`recube ${(healing = h) ? 'start' : 'end'}`);
    if (t - camAt > 0.25) {
      camAt = t;
      const c = cam();
      if (c !== camLast) say(`cam ${(camLast = c)}`);
    }
    if (t - sceneAt > 0.5) {
      sceneAt = t;
      const seen = new Set();
      for (const cb of app.cubes) {
        seen.add(cb.slot);
        const c = cubeCode(cb), was = codes.get(cb.slot);
        if (c !== was) say(`cube ${cb.slot} ${was || 'new'} -> ${c}`);
        codes.set(cb.slot, c);
      }
      for (const [k, c] of codes) if (!seen.has(k)) (say(`cube ${k} ${c} -> gone`), codes.delete(k));
      for (const k of new Set([...Object.keys(tune), ...Object.keys(app.tune)]))
        if (tune[k] !== app.tune[k]) say(`set ${k} ${tune[k] ?? '-'} -> ${app.tune[k] ?? '-'}`);
      tune = { ...app.tune };
      if (app.theme !== theme) say(`theme ${(theme = app.theme)}`);
      if (app.place !== place) say(`place ${(place = app.place)}`);
      if (app.cube?.slot !== sel) say(`sel ${(sel = app.cube?.slot)}`);
    }
  };

  // ---- per-frame measurements
  let lastStart = 0, phys = 0, rend = 0, rebuildMs = 0, rebuilds = 0, progs = programs(), slowSaid = -1;
  let ratio = app.pixelRatio;
  const gaps = new Float32Array(240); // frame intervals (ms), ring buffer
  const cpus = new Float32Array(240);
  let head = 0, frames = 0;
  const slow = []; // { at, gap, cpu, phys, rend, rebuild, shaders, res, tool, pieces, parts }
  const all = []; // every interval this session, for percentiles (capped)
  const PT = new Float64Array(PROF_PHASES.length);
  // (the physics' own timing of its parts - see SoftBody.profT; the body
  // can be a new one after some changes: it's given the same array)
  const prof = () => {
    if (app.sb.profT !== PT) app.sb.profT = PT;
  };
  prof();
  // (its parts, the biggest first, for a slow frame)
  const parts = () => {
    const out = [];
    for (let k = 0; k < PROF_PHASES.length - 1; k++) if (PT[k] >= 1) out.push([PROF_PHASES[k], PT[k]]);
    out.sort((a, b) => b[1] - a[1]);
    const sb = app.sb;
    return `${out.map(([n, v]) => `${n} ${Math.round(v)}`).join(' ')} | ${PT[PROF_PHASES.length - 1]} sub, ${sb.pieces.length} pcs (${sb.pieces.filter((p) => !p.asleep).length} awake), ${sb.nT} tets`;
  };

  // (the app records physics/render time and the body its rebuilds and its
  // parts' times, so nothing in the hot simulation code needs wrapping -
  // wrapping methods changes the objects' shape, which costs Safari seconds
  // of slow code)
  const frame = app.frame.bind(app);
  app.frame = (dt) => {
    const start = performance.now();
    const gap = lastStart ? start - lastStart : 16.7;
    lastStart = start;
    prof();
    PT.fill(0);
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
    watch();
    // this frame took long, or something heavy happened in it or just before it
    if (gap > SLOW_MS || cpu > SLOW_MS || newProgs > 0 || rebuilds > 0 || resChanged) {
      const s = {
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
        parts: phys > 4 ? parts() : '',
      };
      slow.push(s);
      if (slow.length > 60) slow.shift();
      // (into the log too, beside what was being done - the really slow
      // ones, a few a second at most: a phone at 20 fps filled it)
      if ((gap > 80 || phys > 40 || rebuilds > 0) && s.at - slowSaid > 0.25) {
        slowSaid = s.at;
        say(`SLOW ${fmtSlow(s, false)}`, s.at);
      }
    }
    last = { cpu, phys, rend };
  };
  let last = { cpu: 0, phys: 0, rend: 0 };

  // ---- overlay
  const el = document.createElement('div');
  el.className = 'stats';
  el.innerHTML = `<canvas width="200" height="44"></canvas><pre></pre><div class="stats-btns"><button class="copy">Copy report</button><button class="mark">Mark</button><button class="bench">Bench</button>${app.ui?.clips?.able ? '<button class="rectest">Rec test</button>' : ''}<button class="close" aria-label="Hide stats">×</button></div>`;
  document.body.appendChild(el);
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const pre = el.querySelector('pre');
  // (× folds it away to a small tab - tapped, it's back; it went for good, the record button under it)
  const fold = el.querySelector('.close');
  fold.addEventListener('click', () => {
    const min = el.classList.toggle('min');
    fold.textContent = min ? 'stats' : '×';
    fold.setAttribute('aria-label', min ? 'Show stats' : 'Hide stats');
  });
  el.querySelector('.mark').addEventListener('click', (e) => {
    say('MARK');
    const b = e.currentTarget;
    b.textContent = 'Marked ✓';
    setTimeout(() => (b.textContent = 'Mark'), 1200);
  });
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

  // ---- bench: what each part of the drawing costs this GPU. Each left out
  // in turn, the frame timed from the start of its drawing to when the GPU's
  // done with it (made to wait for that: App.benchSync) - still (the
  // physics paused), then wobbling (the shadows, the caustics and the
  // light's views of the jelly drawn every frame), then the whole frame at
  // a lower resolution. Hands off while it runs (~30 s).
  const BENCH = [
    ['still', 'all'], ['still', 'no room', 'room'], ['still', 'no jelly', 'jelly'], ['still', 'no glitter/bubbles', 'fx'],
    ['still', 'no mirror', 'refl'], ['still', 'no bloom', 'bloom'], ['still', 'no edge pass', 'aa'], ['still', 'flakes only', 'whole'],
    ['moving', 'all'], ['moving', 'no caustics', 'caustics'], ['moving', 'no floor effects', 'floorFx'],
    ['moving', 'no room', 'room'], ['moving', 'no jelly', 'jelly'], ['moving', 'no mirror', 'refl'],
    // (a cube full of liquid: its far walls through its hollow, the liquid itself - see JellyView.renderFar, Fluid)
    ['moving', 'no far walls', 'far'], ['moving', 'no liquid', 'liquid'],
  ];
  let benchLines = [], benching = false;
  const median = (v) => {
    const q = [...v].sort((a, b) => a - b);
    return q[q.length >> 1] || 0;
  };
  // (n frames' drawing times, after a few to settle; each() before each)
  const timeFrames = async (n, each) => {
    const out = [];
    let seen = app.stats.frames, k = 0;
    while (out.length < n) {
      await new Promise((res) => requestAnimationFrame(res));
      if (each) each(k);
      k++;
      if (app.stats.frames !== seen) {
        seen = app.stats.frames;
        if (k > 8) out.push(app.stats.renderLast);
      }
    }
    return median(out);
  };
  const wobble = (k) => {
    if (k % 15) return;
    const sb = app.sb, t = performance.now() / 1000;
    for (let i = 0; i < sb.nV; i++) sb.v[i * 3 + 1] += 0.15 * Math.sin(sb.x[i * 3] * 6 + t * 7);
    sb.wakeAll();
  };
  const runBench = async (btn) => {
    if (benching) return;
    benching = true;
    const skip = app.skip, J = app.jelly, pr = app.pixelRatio, paused = app.paused;
    const out = [`bench (ms a frame, drawing start to GPU done; each part left out in turn; res ${pr.toFixed(2)}x ${app.size.pw}x${app.size.ph}, shader ${shader()}):`];
    benchLines = out;
    skip.adapt = true;
    app.benchSync = true;
    try {
      let base = { still: 0, moving: 0 };
      for (let i = 0; i < BENCH.length; i++) {
        const [phase, label, key] = BENCH[i];
        btn.textContent = `Bench ${i + 1}/${BENCH.length + 1}…`;
        app.paused = phase === 'still';
        if (key === 'caustics') J.skipCaustics = true;
        else if (key) skip[key] = true;
        const ms = await timeFrames(phase === 'still' ? 30 : 45, phase === 'moving' ? wobble : null);
        if (key === 'caustics') J.skipCaustics = false;
        else if (key) skip[key] = false;
        if (!key) base[phase] = ms;
        out.push(`  ${phase.padEnd(7)} ${label.padEnd(20)} ${ms.toFixed(1).padStart(6)}${key ? `  (${(ms - base[phase]).toFixed(1)})` : ''}`);
      }
      // (and the whole frame, still, at a lower resolution: how much of it
      // goes with the pixels)
      btn.textContent = `Bench ${BENCH.length + 1}/${BENCH.length + 1}…`;
      app.paused = true;
      const lo = Math.max(0.75, Math.min(1, pr - 0.5));
      if (lo < pr - 0.01) {
        app.pixelRatio = lo;
        app._resizePending = true;
        const ms = await timeFrames(30);
        out.push(`  still   all at ${lo.toFixed(2)}x ${app.size.pw}x${app.size.ph}`.padEnd(37) + `${ms.toFixed(1).padStart(6)}  (${(ms - base.still).toFixed(1)})`);
      }
    } finally {
      app.pixelRatio = pr;
      app._resizePending = true;
      for (const k in skip) skip[k] = false;
      J.skipCaustics = false;
      app.benchSync = false;
      app.paused = paused;
      benching = false;
      btn.textContent = 'Bench ✓';
      setTimeout(() => (btn.textContent = 'Bench'), 2500);
    }
    say(`BENCH ${out.slice(1).map((l) => l.trim().replace(/\s+/g, ' ')).join(' | ')}`);
  };
  el.querySelector('.bench').addEventListener('click', (e) => runBench(e.currentTarget));

  // ---- rec test: a clip recorded each way there is (see Clips.mode) - the screen's own picture and the copied
  // one, each with its sound and without - each 26 s of a wobbling jelly, and each looked at after (Clips._check:
  // second by second, did the picture move?). Which way's clip freezes on this phone, and whether the sound's
  // to blame. Each way's line goes in the report as it's done. Hands off (~2 min).
  let recLines = [], recTesting = false;
  const runRecTest = async (btn) => {
    const C = app.ui?.clips;
    if (!C?.able || C.recording || recTesting || benching) return;
    recTesting = true;
    app.audio?.init?.();
    const was = { mode: C.mode, sound: C.sound }, ways = [['gl', true], ['copy', true], ['gl', false], ['copy', false]], out = [];
    recLines = ['rec test (each 26 s of a wobbling jelly; the clip looked at after - did its picture move, second by second):'];
    // (the app sent away mid-clip - an iPhone stops its sound then - is said on that clip's line)
    let away = false;
    const gone = () => document.hidden && (away = true);
    document.addEventListener('visibilitychange', gone);
    try {
      for (let i = 0; i < ways.length; i++) {
        const [mode, sound] = ways[i];
        btn.textContent = `Rec test ${i + 1}/${ways.length}…`;
        C.mode = mode;
        C.sound = sound;
        const way = `${mode}${sound ? '' : ', no sound'}`, line = (l) => (out.push(l), recLines.push(`  ${l}`));
        app.audio?.init?.();
        C.start();
        if (!C.recording) {
          line(`${way}: didn't start`);
          continue;
        }
        away = false;
        const t0 = performance.now();
        for (let k = 0; performance.now() - t0 < 26000; k++) {
          await new Promise((res) => requestAnimationFrame(res));
          wobble(k);
        }
        C.stop();
        // (till it's looked at - or nothing came out)
        const t1 = performance.now();
        while (!(C.diag?.moved || (C.diag?.over && !C.diag.file)) && performance.now() - t1 < 75000) await new Promise((res) => setTimeout(res, 250));
        const D = C.diag;
        line(`${way}: sound ${D?.sound || '?'}${away ? ', the app went away mid-clip' : ''}; ${D?.copies || 0} frames in, ${D?.file || 'nothing made'}; moved ${D?.moved || '(not looked at)'}`);
        C._close?.();
        await new Promise((res) => setTimeout(res, 600));
      }
    } finally {
      document.removeEventListener('visibilitychange', gone);
      C.mode = was.mode;
      C.sound = was.sound;
      recTesting = false;
      btn.textContent = 'Rec test ✓';
      setTimeout(() => (btn.textContent = 'Rec test'), 2500);
    }
    say(`RECTEST ${out.join(' | ')}`);
  };
  el.querySelector('.rectest')?.addEventListener('click', (e) => runRecTest(e.currentTarget));

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
  function fmtSlow(s, at = true) {
    return (
      (at ? `${s.at.toFixed(1).padStart(5)}s ` : '') +
      `${Math.round(s.gap).toString().padStart(4)}ms cpu ${Math.round(s.cpu)}` +
      (s.phys > 4 ? ` phys ${Math.round(s.phys)}` : '') +
      (s.rend > 4 ? ` rend ${Math.round(s.rend)}` : '') +
      (s.shaders ? ` +${s.shaders} shader${s.shaders > 1 ? 's' : ''}` : '') +
      (s.rebuild ? ` rebuild ${Math.round(s.rebuild)}` : '') +
      (s.res ? ` res→${s.res.toFixed(2)}x` : '') +
      (s.tool ? ` [${s.tool}]` : '') +
      (s.parts ? `  = ${s.parts}` : '')
    );
  }
  const report = () => {
    const w = app.warmStats;
    for (const [id, p] of pts) flush(id, p);
    // (frame pacing - App._drawNow: what's drawn, held back for the GPU, left still; how often the browser
    // gives frames while busy and while still; the fence's check, and the longest step a frame may take)
    const pacingLine = () => {
      const P = app.pacing, T = Math.max(1, now());
      if (!P) return '';
      const r = (n) => (n / T).toFixed(1);
      return `pacing: drawn ${r(P.drawn)}/s${P.lite ? ` (${r(P.lite)}/s flakes only)` : ''}, held back ${r(P.heldBack)}/s, still ${r(P.still)}/s${P.present ? `, still frames re-shown (${P.presents})` : ''} | browser frames ${(P.gapBusy * 1000).toFixed(0)} ms busy, ${(P.gapStill * 1000).toFixed(0)} ms still | fence ${P.fence ? 'on' : 'off'} (check ${(P.waitMs / Math.max(1, P.waits)).toFixed(2)} ms) | step up to ${((app._dtCap || 1 / 30) * 1000).toFixed(0)} ms`;
    };
    return [
      `Cube Simulator stats v2   build ${typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'}`,
      `${navigator.userAgent}`,
      `gpu: ${gpu}   dpr ${window.devicePixelRatio}   cores ${navigator.hardwareConcurrency || '?'}   screen ${innerWidth}x${innerHeight}`,
      w ? `warm-up at load: ${Math.round(w.ms)} ms, ${w.programs} shaders; intro hold ${Math.round(app.introMs || 0)} ms` : '',
      `session ${now().toFixed(0)} s, ${frames} frames: median ${pct(all, 0.5).toFixed(1)} ms, 95th ${pct(all, 0.95).toFixed(1)} ms, 99th ${pct(all, 0.99).toFixed(1)} ms`,
      pacingLine(),
      app.ui?.clips?.diagLine?.() || '',
      ...summary(),
      ...sceneLines(),
      `log (the last ${LOG_S} s; t = s since load; x y = 0..1 across and down the canvas; move: ms:x,y from the line's t):`,
      ...log.map(([t, s]) => `${t.toFixed(2)} ${s}`),
      'slow / eventful frames (time, interval, what happened = the physics\' parts, ms):',
      ...slow.map((s) => fmtSlow(s)),
      ...benchLines,
      ...recLines,
    ]
      .filter(Boolean)
      .join('\n');
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
    pre.textContent = [...summary(), ...(benchLines.length ? benchLines : slow.slice(-5).reverse().map((s) => fmtSlow(s)))].join('\n');
  };
  setInterval(draw, 250);
  // (for a harness: the report without the clipboard, and the bench)
  window.__statsReport = report;
  window.__statsBench = () => runBench(el.querySelector('.bench'));
  say(`start  ${app.cubes.length} cube${app.cubes.length === 1 ? '' : 's'}: ${[...codes.values()].join('   ')}  cam ${cam()}`);
}
