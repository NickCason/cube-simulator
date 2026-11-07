// Families: cubiplication's lineage. A cube can carry { id, parent, gen };
// when it cubiplies its two children get ids of their own, its id as their
// parent and a generation more. The family store keeps everyone who's been
// part of a cubiplication - the parent as it was when it divided, each
// child as it was born and what mutated in it - so the Cubby can draw the
// family tree, with the ancestors that are gone from the room in it too.

const KEY = 'cube-sim-family';
const MAX = 400; // (records kept: past that, the oldest childless ones go)

export const newId = () => Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);

// a room cube's lineage (a cube no one cubiplied: a family of its own)
export function linOf(cb) {
  if (!cb.lin || !cb.lin.id) cb.lin = { id: newId(), parent: null, gen: 0 };
  return cb.lin;
}

export function loadFamily() {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || '{}');
    return m && typeof m === 'object' ? m : {};
  } catch (e) {
    return {};
  }
}

function saveFamily(m) {
  // (too many: the oldest who've no children go first)
  const ids = Object.keys(m);
  if (ids.length > MAX) {
    const parents = new Set(ids.map((id) => m[id].parent).filter(Boolean));
    const spare = ids.filter((id) => !parents.has(id)).sort((a, b) => (m[a].at || 0) - (m[b].at || 0));
    for (const id of spare.slice(0, ids.length - MAX)) delete m[id];
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
    return true;
  } catch (e) {
    return false;
  }
}

// A cubiplication: the parent as it was ({ id, parent, gen, name, code }),
// its two children as they're born (the same, and changes: what mutated)
export function recordBirth(parent, kids) {
  const m = loadFamily(), at = Date.now();
  m[parent.id] = { ...(m[parent.id] || {}), ...parent, at: m[parent.id]?.at || at, split: at };
  for (const k of kids) m[k.id] = { ...k, at };
  saveFamily(m);
}

// a family member's name or look since (a child kept, renamed, edited)
export function touchMember(id, patch) {
  const m = loadFamily();
  if (!m[id]) return;
  Object.assign(m[id], patch);
  saveFamily(m);
}

// The trees: each family's first cube, its children under it, theirs under
// them - { rec, kids: [...] } - newest family first (only families with a
// cubiplication in them)
export function familyTrees() {
  const m = loadFamily(), kids = {};
  for (const r of Object.values(m)) if (r.parent && m[r.parent]) (kids[r.parent] = kids[r.parent] || []).push(r);
  const build = (r) => ({ rec: r, kids: (kids[r.id] || []).sort((a, b) => (a.at || 0) - (b.at || 0)).map(build) });
  const roots = Object.values(m).filter((r) => !r.parent || !m[r.parent]);
  const newest = (t) => Math.max(t.rec.split || t.rec.at || 0, ...t.kids.map(newest));
  return roots.map(build).filter((t) => t.kids.length).sort((a, b) => newest(b) - newest(a));
}
