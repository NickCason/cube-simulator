import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mp4Facts, mp4Line } from '../src/ui/mp4facts.js';

// (an mp4 made by hand: ftyp, then moov with one track per [kind, scale, stts runs] - or fragmented: an empty
// stts, mvex/trex, then a moof with a tfdt and trun per [kind, start, durations])
const box = (type, ...parts) => {
  const body = parts.flatMap((p) => [...p]);
  const n = 8 + body.length;
  return Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...[...type].map((c) => c.charCodeAt(0)), ...body]);
};
const u32 = (...v) => Uint8Array.from(v.flatMap((x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]));
const trak = (id, kind, scale, runs) =>
  box('trak', box('tkhd', u32(0, 0, 0, id)), box('mdia', box('mdhd', u32(0, 0, 0, scale, 0)), box('hdlr', u32(0, 0), [...kind].map((c) => c.charCodeAt(0))), box('minf', box('stbl', box('stts', u32(0, runs.length, ...runs.flat()))))));
const file = (...parts) => {
  const all = [box('ftyp', [...'isom'].map((c) => c.charCodeAt(0))), ...parts], n = all.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
  let o = 0;
  for (const p of all) out.set(p, o), (o += p.length);
  return out;
};

test('a plain mp4: a picture that stops short of its sound', () => {
  const f = mp4Facts(file(box('moov', trak(1, 'vide', 600, [[300, 20]]), trak(2, 'soun', 48000, [[1000, 960]]))));
  const v = f.find((t) => t.kind === 'vide'), s = f.find((t) => t.kind === 'soun');
  assert.equal(v.n, 300);
  assert.ok(Math.abs(v.end - 10) < 1e-9);
  assert.ok(Math.abs(s.end - 20) < 1e-9);
  assert.match(mp4Line(f), /picture 300 frames, 0\.0-10\.0 s.*sound 0\.0-20\.0 s/);
});

test('a plain mp4: a picture held - one frame on for 3 s - is its longest wait', () => {
  const f = mp4Facts(file(box('moov', trak(1, 'vide', 30, [[120, 1], [1, 90], [100, 1]]))));
  assert.equal(f[0].n, 221);
  assert.ok(Math.abs(f[0].gap - 3) < 1e-9 && Math.abs(f[0].gapAt - 4) < 1e-9);
});

test('a fragmented mp4: runs, and a jump between them, read', () => {
  const traf = (id, t, durs) => box('traf', box('tfhd', u32(0, id)), box('tfdt', u32(0, t)), box('trun', u32(0x100, durs.length), u32(...durs)));
  const f = mp4Facts(file(box('moov', trak(1, 'vide', 30, []), box('mvex', box('trex', u32(0, 1, 1, 1, 0, 0)))), box('moof', traf(1, 0, Array(60).fill(1))), box('moof', traf(1, 150, Array(30).fill(1)))));
  assert.equal(f[0].n, 90);
  assert.ok(Math.abs(f[0].gap - 3) < 1e-9 && Math.abs(f[0].gapAt - 2) < 1e-9, JSON.stringify(f[0]));
  assert.ok(Math.abs(f[0].end - 6) < 1e-9);
});

test('not an mp4: nothing said', () => {
  assert.equal(mp4Facts(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), null);
  assert.equal(mp4Line(null), 'not an mp4 I can read');
});
