import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLine } from '../src/ui/buildline.js';

test('the build time shown where you are', () => {
  assert.equal(buildLine('4af540f 2026-11-13 14:25Z', 'America/Los_Angeles'), 'Build 4af540f 2026-11-13 06:25 PST');
  assert.equal(buildLine('4af540f 2026-11-13 14:25Z', 'America/New_York'), 'Build 4af540f 2026-11-13 09:25 EST');
  assert.equal(buildLine('4af540f 2026-07-04 03:10Z', 'America/Los_Angeles'), 'Build 4af540f 2026-07-03 20:10 PDT');
});

test("Pacific when where you are can't be told", () => {
  assert.equal(buildLine('4af540f 2026-11-13 14:25Z', null), 'Build 4af540f 2026-11-13 06:25 PST');
  assert.equal(buildLine('4af540f 2026-11-13 14:25Z', 'Not/AZone'), 'Build 4af540f 2026-11-13 06:25 PST');
});

test('anything else as it is', () => {
  assert.equal(buildLine('dev'), 'Build dev');
  assert.equal(buildLine(''), '');
});
