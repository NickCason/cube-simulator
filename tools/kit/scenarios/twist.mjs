// The Rubik's twist, as a finger plays it: n drags at random places on the cube on the screen, each `len` px a
// random way. A drag should turn the row under the finger the way it went - the sticker touched moving with the
// finger. For each turn the tool made: the touched point turned a little that way round that axis, on the screen -
// along the drag (cos > 0.5: 'with'), against it ('against'), or across it ('across', the other row turned).
import { table } from './_common.mjs';
export const meta = { name: 'twist', params: { code: '1~nRubik~frubik~mjello~esharp', n: 40, len: 40, phi: 0 } };
export async function run(k, p) {
  await k.load(p.code, {}, { settle: 40 });
  if (p.phi) await k.camera({ phi: p.phi });
  await k.app((a) => a.setTool('twist'));
  await k.frames(10);
  const out = { with: 0, against: 0, across: 0, none: 0 };
  for (let m = 0; m < p.n; m++) {
    const [x, y] = await k.at(0.18 + 0.64 * Math.random(), 0.18 + 0.64 * Math.random());
    const th = Math.random() * Math.PI * 2, dx = Math.cos(th) * p.len, dy = Math.sin(th) * p.len;
    // where the finger lands on the cube (as the tool will find it)
    const hit = await k.app((a, [x, y]) => {
      const r = a.canvas.getBoundingClientRect(), V = a.camera.position.constructor;
      const o = a.camera.position.clone(), d = new V(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1, 0.5).unproject(a.camera).sub(o).normalize();
      const h = a.sb.raycast(o.x, o.y, o.z, d.x, d.y, d.z);
      return h ? Array.from(h.point) : null;
    }, [x, y]);
    if (!hit) {
      out.none++;
      continue;
    }
    await k.page.mouse.move(x, y);
    await k.page.mouse.down();
    await k.page.mouse.move(x + dx, y + dy, { steps: 4 });
    await k.page.mouse.up();
    const r = await k.app(
      async (a, [hit, dx, dy]) => {
        const T = a.tools.twist.turn || a.tools.twist.queue[0];
        if (!T) return 'none';
        const f = await window.__kit.fit(T.slot), R = f.R, ax = [R[T.a], R[3 + T.a], R[6 + T.a]];
        // (the touched point turned a little about the cube's axis through its middle, the right-hand way x dir)
        const V = a.camera.position.constructor, P = new V(hit[0] - f.xm[0], hit[1] - f.xm[1], hit[2] - f.xm[2]);
        const Q = P.clone().applyAxisAngle(new V(ax[0], ax[1], ax[2]).normalize(), 0.05 * T.dir);
        const sc = (v) => {
          const s = v.clone().add(new V(f.xm[0], f.xm[1], f.xm[2])).project(a.camera), r = a.canvas.getBoundingClientRect();
          return [(s.x * r.width) / 2, (-s.y * r.height) / 2];
        };
        const s0 = sc(P), s1 = sc(Q), mx = s1[0] - s0[0], my = s1[1] - s0[1];
        const cos = (mx * dx + my * dy) / (Math.hypot(mx, my) * Math.hypot(dx, dy) || 1);
        return cos > 0.5 ? 'with' : cos < -0.5 ? 'against' : 'across';
      },
      [hit, dx, dy],
    );
    out[r]++;
    // (the turn done before the next)
    for (let f = 0; f < 40; f++) if (await k.app((a) => (a.frame(1 / 30), !a.tools.twist.turn && !a.tools.twist.queue.length))) break;
  }
  return out;
}
export const row = (r) => `with ${r.with}, against ${r.against}, across ${r.across} (missed ${r.none})`;
export const summary = (all) => table(all, ['with', 'against', 'across', 'none']);
