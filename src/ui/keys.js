// Keys pressed in a box being typed in are the typing's, not the room's: a letter doesn't pick a tool, a space
// doesn't slow time, an arrow doesn't tip the table. (Only <input>s were let be - the ideas box writes in a
// <textarea>, and every letter typed in it picked a tool, flipped the theme, healed, muted; its spaces never got in.)
export function typing(e) {
  const t = e?.target;
  return !!t && (t.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
}
