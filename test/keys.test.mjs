// keys pressed in a box being typed in are the typing's, not the room's hotkeys
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typing } from '../src/ui/keys.js';

test('a key typed into a text box, a text area, a list or an editable bit is the typing\'s', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(typing({ target: { tagName } }), true, tagName);
  assert.equal(typing({ target: { tagName: 'DIV', isContentEditable: true } }), true);
});

test('a key anywhere else is the room\'s', () => {
  for (const tagName of ['BODY', 'CANVAS', 'BUTTON', 'DIV']) assert.equal(typing({ target: { tagName } }), false, tagName);
  assert.equal(typing({ target: { tagName: 'DIV', isContentEditable: false } }), false);
  assert.equal(typing({ target: {} }), false); // (window, document)
  assert.equal(typing({ target: null }), false);
  assert.equal(typing({}), false);
});
