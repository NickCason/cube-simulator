#!/usr/bin/env node
// Run a scenario (tools/kit/scenarios/<name>.mjs) over builds x param grid x seeds, one at a time (runs side by
// side load the CPU: knife strokes miss, timings lie), each in its own page of one browser. A line a run as it
// finishes (for Monitor / tail), every result appended to a JSONL file, then a table: each build and params, the
// seeds' numbers side by side.
//
//   node tools/kit/run.mjs walls --builds head,work --grid scen=bowl:dice,skin=0:0.5 --seeds 1-2
//   node tools/kit/run.mjs tear --set cube=plainLiquid,rig=1 --grid ang=0:35 --seeds 1-4 --builds work
//   node tools/kit/run.mjs perf --set cube=aqua --cpu 4 --builds head,work
//   flags: --builds a,b (work | head | any git ref)  --seeds 1-4 | 1,3  --set k=v,..  --grid k=a:b,..
//          --cpu N (CPU throttle)  --dpr N  --theme light|dark  --out file.jsonl  --quiet (no table)
//          --engine webkit (Safari's JSC, as on his iPhone; no --cpu, no prof there)
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, closeAll } from './kit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), name = argv[0];
const flag = (f, d) => {
  const i = argv.indexOf('--' + f);
  return i < 0 ? d : argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1];
};
const num = (v) => (v !== '' && !isNaN(+v) ? +v : v);
const kv = (s) => Object.fromEntries((s || '').split(',').filter(Boolean).map((e) => { const i = e.indexOf('='); return [e.slice(0, i), num(e.slice(i + 1))]; }));
const range = (s) => String(s).split(',').flatMap((p) => { const [a, b] = p.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });

if (!name) {
  console.log('usage: run.mjs <scenario> [--builds work,head] [--seeds 1-4] [--set k=v,..] [--grid k=a:b,..] [--cpu 4]');
  process.exit(1);
}
const sc = await import(join(HERE, 'scenarios', name + '.mjs'));
const builds = String(flag('builds', 'work')).split(',');
const seeds = range(flag('seeds', '1'));
const base = { ...(sc.meta?.params || {}), ...kv(flag('set', '')) };
// (the grid: every combination of each k's values)
let combos = [{}];
for (const [k, v] of Object.entries(kv(flag('grid', '')))) combos = combos.flatMap((c) => String(v).split(':').map((x) => ({ ...c, [k]: num(x) })));
const out = flag('out', `/tmp/kit-runs/${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
mkdirSync(dirname(out), { recursive: true });
const opt = { cpu: +flag('cpu', 1), dpr: +flag('dpr', sc.meta?.dpr || 1), theme: flag('theme', sc.meta?.theme || 'light'), engine: flag('engine', 'chromium') };

const all = [];
const short = (p) => Object.entries(p).filter(([k]) => !(k in (sc.meta?.params || {})) || sc.meta.params[k] !== p[k] || combos.some((c) => k in c)).map(([k, v]) => `${k}=${v}`).join(' ');
for (const build of builds)
  for (const c of combos)
    for (const seed of seeds) {
      const p = { ...base, ...c }, t0 = Date.now();
      let res, k;
      try {
        // (params named __something are the app's test switches - globals set before its code loads)
        const globals = Object.fromEntries(Object.entries(p).filter(([q]) => q.startsWith('__')));
        k = await open({ build, seed, ...opt, ...(Object.keys(globals).length ? { globals } : {}) });
        res = await sc.run(k, p, { build, seed, out: dirname(out) });
        if (k.errs.length) res.pageErrors = k.errs.slice(0, 3);
      } catch (e) {
        res = { error: String(e.message || e).split('\n')[0] };
      }
      if (k) await k.close().catch(() => {});
      const rec = { scenario: name, build, sha: k?.build?.sha, seed, params: p, ms: Date.now() - t0, ...res };
      all.push(rec);
      appendFileSync(out, JSON.stringify(rec) + '\n');
      console.log(`> ${name} ${build}${short(p) ? ' ' + short(p) : ''} seed ${seed}: ${res.error ? 'ERROR ' + res.error : sc.row ? sc.row(res) : JSON.stringify(res)}`);
    }
await closeAll();
if (!flag('quiet', false) && sc.summary) console.log('\n' + sc.summary(all));
console.log(`(${all.length} runs -> ${out})`);
