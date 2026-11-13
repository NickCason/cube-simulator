// Shared by the scenarios: the cuts made over and over, and a table of a run's results.

// A cut, as a finger makes it, then what's cut off moved away: 'bowl' (across at 0.42, its top lifted off to the
// side), 'slices' (three top to bottom), 'dice' (the dicer), 'drop' (lifted by its top and let fall), 'corner'
// (its top left edge sliced off, the wedge pulled away), 'cornerCut' (sliced off, left), 'none'
export async function cut(k, scen) {
  if (scen === 'bowl') {
    await k.knife([-0.25, 0.42], [1.25, 0.4]);
    await k.pull('top', [-150, -110], 16);
  } else if (scen === 'slices') {
    for (const u of [0.32, 0.5, 0.68]) (await k.knife([u + 0.02, -0.25], [u - 0.02, 1.25]), await k.frames(6));
  } else if (scen === 'dice') {
    await k.tap('dicer');
    await k.frames(60);
  } else if (scen === 'drop') {
    await k.drag([0.5, 0.08], [[10, -60], [20, -130], [30, -200], [40, -260], [40, -260]], 3);
  } else if (scen === 'corner' || scen === 'cornerCut') {
    await k.knife([-0.25, 0.6], [0.6, -0.25]);
    if (scen === 'corner') (await k.frames(4), await k.pull('small', [-140, -70], 12));
  }
}

// Results grouped by build and params (seeds side by side): cols, the numbers to show
export function table(all, cols) {
  const groups = new Map();
  for (const r of all) {
    const key = `${r.build}  ${Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(' ')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const lines = [];
  for (const [key, rs] of groups) {
    lines.push(key);
    lines.push('   ' + cols.map((c) => `${c} ${rs.map((r) => (r.error ? 'ERR' : (typeof c === 'function' ? c(r) : r[c]) ?? '-')).join('/')}`).join(' | '));
  }
  return lines.join('\n');
}
