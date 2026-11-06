import { SoftBody } from '../src/sim/softbody.js';
for (const res of [10, 11, 12]) {
  const sb = new SoftBody({ res });
  sb.loadCube(0, 0.4, 0);
  const v0 = sb.totalVolume();
  let t0 = performance.now(), frames = 0, minY = 9, maxSpeed = 0;
  const log = [];
  for (let f = 0; f < 240; f++) {
    sb.step(1 / 60); frames++;
    const pc = sb.pieces[0];
    if (f % 20 === 0) log.push(`${(f/60).toFixed(2)}s com.y=${pc.com[1].toFixed(3)} KE=${sb.kineticEnergy().toExponential(2)}`);
  }
  const ms = (performance.now() - t0) / frames;
  let nan = 0; for (let i = 0; i < sb.nV * 3; i++) if (!Number.isFinite(sb.x[i])) nan++;
  console.log(`res=${res} nV=${sb.nV} nT=${sb.nT} nF=${sb.nF} rCount=${sb.rCount} ms/frame=${ms.toFixed(2)} nan=${nan} vol0=${v0.toFixed(4)} volNow=${sb.currentVolume().toFixed(4)} pieces=${sb.pieces.length}`);
  if (res === 11) console.log(log.join('\n'));
}
