# Test kit

What the scratch harnesses did by hand (900 of them, nearly all the same 30 lines of setup), once: a phone-sized,
seeded, headless page on any build; cubes, settings, camera, finger gestures, pictures; measurements run in the
page; scenarios run over builds x params x seeds; and the ship routine.

## Run a scenario

```sh
node tools/kit/run.mjs <scenario> [flags]
  --builds work,head,8e7b8c4   work = the working tree (dev server, 5190); any git ref is archived and served
  --seeds 1-4 | 1,3             Math.random seeded per run (runs aren't fully deterministic: use several)
  --set k=v,k=v                 the scenario's params (see its meta)
  --grid k=a:b,k2=c:d           every combination (':' between alternatives - '|' would be a shell pipe)
  --cpu 4                       Chrome's CPU throttle (4 ~ a phone)     --dpr 2 (pictures)    --theme dark
  --engine webkit               Safari's engine (JSC) - the app crashes its renderer here, headless: not usable yet
  --set __fluidIter=2           params named __x are the app's test switches, set as globals before its code
                                loads: __fluidIter, __fluidStep, __fillN (fluid.js, spill.js), __fluidEps, __splatR
  --out file.jsonl              (default /tmp/kit-runs/<scenario>-<time>.jsonl)   --quiet (no table)
```

Runs go one at a time (side by side, the CPU's shared: knife strokes miss and timings lie). Each prints a line
when done (`> scenario build params seed N: ...`, for Monitor), then a table of the seeds side by side.

| scenario | what | params (defaults) |
|---|---|---|
| `walls` | liquid's drawn surface in the jelly after a cut | cube=plainLiquid scen=bowl\|slices\|dice\|drop\|corner\|cornerCut\|none skin=0.5 fill=1 rig=0 wait=90 frames=30 |
| `bubbles` | bubbles out of the drawn liquid / in the wall, settled and sloshing | cube=plain skin=0 fill=1 count=146 size=1.729 wait=240 slosh=0 |
| `tear` | a part cut pulled apart by two fingers: through the slit? | cube=plain rig=1 ang=0 v=0.3 gap=0.2 depth=0.5 u=0.5 pull=3 steps=90 |
| `corner` | a corner edge sliced off a full cube (pulled away): fits, labels, liquid outside | cube=fluorescentFilled skin=0 pull=1 |
| `dice` | the dicer: dice faces kept flat or smoothed | cube=fluorescent liquid=0 |
| `hollow` | the hollow as drawn against its shape | cube=plainLiquid skin=0 edges= |
| `look` | pictures: views `+z/-x/app` x skips `all/liquid/jelly`, tiled | cube views=+z skips=all cut=none place=diner skin fill radius phi |
| `perf` | "go wild" on a liquid+glitter cube: each frame and its parts timed | cube=aqua fill=1 glitter=holo fps=60 |
| `yank` | shot through (the shot exits its bottom), left to dribble, yanked up by its top: drops through its bottom face | cube=blueGold gun=holegun wait=60 gu=0.5 gv=0.2 rise=320 over=4 hold=30 pics=0 |
| `rectest` | his ?stats Rec test's workload: his cube wobbled as it does it, each frame's parts timed (prof=1: Chrome's profiler, top functions) | cube=blueGold secs=8 fps=30 prof=0 top=25 |
| `intro` | the first drop as he sees it: page loaded afresh with the splash at a phone's speed, the app's own loop - reveal, splash leaving, when the liquid's in, the drop's frames and their parts | cube=blueGold cpu=4 secs=3 prof=0 |
| `slit` | slit from the top, kept in one piece: held open (drains) or dragged round (stays in): drops out of its box | cube=plainLiquid skin=0.5 depth=0.5 hold=open\|drag\|none pull=1.5 steps=20 frames=90 r=80 |

Examples:

```sh
node tools/kit/run.mjs walls --builds head,work --grid scen=bowl:dice:corner,skin=0:0.5
node tools/kit/run.mjs tear --set cube=plainLiquid --grid ang=0:35 --seeds 1-4
node tools/kit/run.mjs perf --cpu 4 --builds head,work
node tools/kit/run.mjs look --set cube=aqua,views=+z/-z/+x/-x,skips=all/jelly,cut=corner --dpr 2
```

Cubes by name (`cubes.mjs`): `plain`, `plainLiquid`, `plainSharp`, `aqua`, `fluorescent` (empty, as shared),
`fluorescentFilled`, `blueGold` (soft, blue, gold glitter, full) - or any share code. In a code `lk` is the liquid's skin, `lf` its fill; `sk` is NOT skin.

## Builds

```sh
node tools/kit/builds.mjs serve head|<ref>    # archived to /tmp/kit-builds/<sha>, served from port 5200 up
node tools/kit/builds.mjs list
node tools/kit/builds.mjs stop <ref>|all      # by process id, never pkill -f
```

`run.mjs` serves what it needs itself; builds stay up for the next run until stopped.

## Write a scenario

`tools/kit/scenarios/<name>.mjs`:

```js
import { cut, table } from './_common.mjs';
export const meta = { name: 'mine', params: { cube: 'plainLiquid', skin: 0.5 } };   // dpr: 2 for pictures
export async function run(k, p, ctx) {           // ctx: { build, seed, out (folder) }
  await k.load(p.cube, { liqSkin: p.skin });      // any Settings keys, applied in order; then settles
  await cut(k, 'bowl');                           // bowl | slices | dice | drop | corner | cornerCut
  await k.frames(60);                             // k.dt = 1/60 to step as a phone runs
  return { ...(await k.probe('depth', { frames: 30 })) };   // plain numbers
}
export const row = (r) => `deepest ${r.deepestCm} cm`;
export const summary = (all) => table(all, ['d3worst', 'deepestCm']);
```

The kit (`kit.mjs`) - `k = await open({ build, seed, theme, viewport, dpr, cpu, query, manual })`:

- `k.load(cube, settings, { place, settle })`, `k.set({...})`, `k.style({ texture, color, edges, trim, place })`
- `k.frames(n, dt)` - steps the app (its own loop is off) and draws
- `k.camera({ face: '+z', phi, radius })` square on to a face of the cube as it stands, or `{ theta, phi, radius, target }`
- points on screen are `[u, v]` in the cube's screen box (0..1 across, down): `k.box()`, `k.at(u, v)`
- gestures: `k.knife(from, to)`, `k.drag(p, [[dx, dy]...], framesEach)`, `k.touch2(a, b, [[dax, day, dbx, dby]...])`,
  `k.tap('dicer')`, `k.shoot('holegun', p)`, `k.pull('small'|'big'|'top', [dx, dy])` (a piece taken away by hand)
- `k.shot(path, { skip: { liquid, jelly }, crop })`
- `k.app((a, arg) => ..., arg)` - anything on the app (the function's sent as source: no closures)
- `k.profile(fn, n)` - Chrome's sampling profiler round fn: the top n functions by their own time
- `k.probe(name, arg)` - `probes.js`, in the page: `pieces`, `fit`, `screenBox`, `depth({ frames })`, `bubbles`,
  `outside`, `cutDiag`, `hollowFit`, `cutKinds`, `perfStart`/`perfStop`

## Pictures

`python3 tools/kit/tile.py out.png a.png b.png ... --cols 2 --crop x0,y0,x1,y1 --scale 0.45` - side by side,
small enough to look at.

## Ship

```sh
git add <files>        # staged only - scratch is never swept in
tools/kit/ship.sh /tmp/msg.txt "Cube Sim <sha> live" "what changed"
```

Tests (stops if any fail) -> trial build -> commit (Co-Authored-By added) -> push (retried) -> the Pages run for
that commit -> the live bundle carries its build stamp -> Pushover. Stops at the first failure.
