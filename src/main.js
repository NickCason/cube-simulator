import './style.css';
import { App } from './app.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');
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
    blend: params.has('blend') ? +params.get('blend') : undefined,
  });
} catch (err) {
  console.error(err);
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
app.start();
