// The build as Settings shows it: its commit, and when it was made in the time where you are - Pacific, if that
// can't be told. (__BUILD__ is "<commit> YYYY-MM-DD HH:MMZ", UTC - as ?stats reports keep it.)
export const BUILD_ZONE_FALLBACK = 'America/Los_Angeles';

export function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch (e) {
    return null;
  }
}

export function buildLine(b, zone = deviceZone()) {
  const m = /^(\S+) (\d{4}-\d\d-\d\d) (\d\d:\d\d)Z$/.exec(b || '');
  if (!m) return b ? 'Build ' + b : '';
  const t = new Date(`${m[2]}T${m[3]}:00Z`);
  for (const z of [zone, BUILD_ZONE_FALLBACK]) {
    if (!z) continue;
    try {
      const p = {};
      for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).formatToParts(t)) p[type] = value;
      return `Build ${m[1]} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`;
    } catch (e) {}
  }
  return 'Build ' + b;
}
