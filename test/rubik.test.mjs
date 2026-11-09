// a Rubik's: every scramble one that can be solved, turns undone by their opposites
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rubikScramble, rubikScrambleMoves, rubikTurn, rubikSolved, rubikStateOf, RUBIK_SLOTS, RUBIK_FACE } from '../src/styles.js';

// (the solved cube's pieces: each corner's three colours, each edge's two - as sets)
const key = (cols) => [...cols].sort().join('');
function pieces(state) {
  const by = new Map();
  RUBIK_SLOTS.forEach((s, i) => {
    const k = s.p.join(',');
    (by.get(k) || by.set(k, []).get(k)).push(state[i]);
  });
  return [...by.values()];
}
const SOLVED = rubikScramble(0);
const GOOD = new Set(pieces(SOLVED).map(key));

test('0 is solved; every scramble can be solved - nine of each colour, every piece a real one', () => {
  assert.ok(rubikSolved(SOLVED));
  assert.deepEqual(SOLVED.filter((_, i) => i % 9 === 4), RUBIK_FACE);
  for (let seed = 1; seed <= 300; seed++) {
    const s = rubikScramble(seed);
    assert.ok(!rubikSolved(s), `seed ${seed} came out solved`);
    for (let c = 0; c < 6; c++) assert.equal(s.filter((v) => v === c).length, 9, `seed ${seed}: colour ${c}`);
    for (const p of pieces(s)) assert.ok(GOOD.has(key(p)), `seed ${seed}: no such piece ${p}`);
  }
  // (the same seed, the same scramble; a code's state wins over its seed)
  assert.deepEqual(rubikScramble(77), rubikScramble(77));
  assert.deepEqual(rubikStateOf({ rubik: 5, rubikState: SOLVED.join('') }), SOLVED);
});

test('a turn and its opposite undo each other; four the same way go all the way round', () => {
  let s = rubikScramble(9);
  for (let a = 0; a < 3; a++)
    for (const at of [-1, 0, 1]) {
      assert.deepEqual(rubikTurn(rubikTurn(s, a, at, 1), a, at, -1), s);
      let t = s;
      for (let n = 0; n < 4; n++) t = rubikTurn(t, a, at, 1);
      assert.deepEqual(t, s);
    }
  // (a whole cube turned - all three layers - is as solved as it was)
  let w = SOLVED;
  for (const at of [-1, 0, 1]) w = rubikTurn(w, 1, at, 1);
  assert.ok(rubikSolved(w));
});

test('a scramble undone, turn by turn, is solved', () => {
  for (const seed of [1, 42, 65535]) {
    let s = rubikScramble(seed);
    for (const [a, at, dir] of rubikScrambleMoves(seed).reverse()) s = rubikTurn(s, a, at, -dir);
    assert.ok(rubikSolved(s), `seed ${seed}`);
  }
});
