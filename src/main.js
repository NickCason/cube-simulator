import './style.css';
import { App } from './app.js';
import { Splash } from './ui/splash.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');

function boot() {
  let app;
  try {
    app = new App(canvas, {
      preserve: params.has('shot'),
      msaa: params.has('nomsaa') ? 0 : params.has('msaa') ? 4 : undefined,
      tm: params.get('tm') || undefined,
      exposure: params.has('exp') ? +params.get('exp') : undefined,
      color: params.get('color') ? '#' + params.get('color') : undefined,
      nojelly: params.has('nojelly'),
      light: params.get('light') || undefined,
      flavor: params.get('flavor') || undefined,
      texture: params.get('texture') || undefined,
      edges: params.get('edges') || undefined,
      layers: params.get('layers') || undefined,
      glitter: params.get('glitter') || undefined,
      blend: params.has('blend') ? +params.get('blend') : undefined,
      repeat: params.has('repeat') ? +params.get('repeat') : undefined,
      bias: params.has('bias') ? +params.get('bias') : undefined,
    });
  } catch (err) {
    console.error(err);
    document.documentElement.classList.remove('splashing');
    document.getElementById('splash')?.remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="nogl"><b>Cube Simulator</b><span>Your browser could not start WebGL 2, which this jelly needs. Try a recent Chrome, Edge, Firefox or Safari.</span></div>',
    );
    throw err;
  }
  if (params.has('density') || params.has('scatter')) {
    if (params.has('density')) app.jelly.density = +params.get('density');
    if (params.has('scatter')) app.jelly.scatter = +params.get('scatter');
    app.applyStyle();
  }
  if (params.has('dbg')) app.jelly.frontMat.uniforms.uDebug.value = +params.get('dbg');
  window.__app = app;
  app.splash = new Splash(app);
  if (params.has('stats')) import('./ui/stats.js').then((m) => m.attachStats(app));
  app.start();
}

// With the splash up, let it paint first: its animations then run on the
// compositor while building the app keeps the main thread busy.
if (document.documentElement.classList.contains('splashing')) requestAnimationFrame(() => requestAnimationFrame(boot));
else boot();

// offline play and install: the service worker caches the app (built site only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
