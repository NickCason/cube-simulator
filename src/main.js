import './style.css';
import { App } from './app.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');
const app = new App(canvas, {
  preserve: params.has('shot'),
  msaa: params.has('nomsaa') ? 0 : 4,
  tm: params.get('tm') || undefined,
  exposure: params.has('exp') ? +params.get('exp') : undefined,
  color: params.get('color') ? '#' + params.get('color') : undefined,
  nojelly: params.has('nojelly'),
  light: params.get('light') || undefined,
});
if (params.has('density') || params.has('scatter')) {
  app.jelly.density = +(params.get('density') || 1);
  app.jelly.scatter = +(params.get('scatter') || 0.22);
  app.jelly.setColor(params.get('color') ? '#' + params.get('color') : '#e0102a');
}
if (params.has('dbg')) app.jelly.frontMat.uniforms.uDebug.value = +params.get('dbg');
window.__app = app;
app.start();
