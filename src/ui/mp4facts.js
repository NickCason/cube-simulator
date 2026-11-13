// What an mp4 holds, track by track - for the recorder's check (see Clips._check): each track's kind ('vide' the
// picture, 'soun' the sound), how many samples, how long, where it starts and ends, and its longest gap between two
// samples (and where). Frames that stopped coming show as a picture track that ends early, or one with a gap, under
// a sound track that goes on. Plain (moov's sample tables) or fragmented (moof/traf/trun, as MediaRecorder writes
// with a timeslice - or Chrome always); null when it isn't an mp4 at all.
export function mp4Facts(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < 16) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u32 = (o) => dv.getUint32(o);
  const u64 = (o) => dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4);
  const name = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  // (each box in [o, end): its type, where its insides start and where it ends)
  const boxes = (o, end, fn) => {
    while (o + 8 <= end) {
      let size = u32(o), hdr = 8;
      const type = name(o + 4);
      if (size === 1) (size = u64(o + 8)), (hdr = 16);
      else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) break;
      fn(type, o + hdr, o + size);
      o += size;
    }
  };
  const tracks = new Map(); // track_ID -> { kind, scale, durs: [], start }
  const track = (id) => tracks.get(id) || tracks.set(id, { id, kind: '?', scale: 0, durs: [], start: NaN, defDur: 0, t: NaN }).get(id);
  let isMp4 = false;
  boxes(0, u8.length, (type, a, b) => {
    if (type === 'ftyp') isMp4 = true;
    if (type === 'moov')
      boxes(a, b, (t1, a1, b1) => {
        if (t1 === 'trak') {
          let id = 0, kind = '?', scale = 0;
          const durs = [];
          boxes(a1, b1, (t2, a2, b2) => {
            if (t2 === 'tkhd') id = u32(a2 + (u8[a2] === 1 ? 20 : 12));
            if (t2 === 'mdia')
              boxes(a2, b2, (t3, a3, b3) => {
                if (t3 === 'mdhd') scale = u32(a3 + (u8[a3] === 1 ? 20 : 12));
                if (t3 === 'hdlr') kind = name(a3 + 8);
                if (t3 === 'minf')
                  boxes(a3, b3, (t4, a4, b4) => {
                    if (t4 === 'stbl')
                      boxes(a4, b4, (t5, a5) => {
                        if (t5 !== 'stts') return;
                        // (runs of samples each this long: count, delta)
                        for (let e = 0, n = u32(a5 + 4), o = a5 + 8; e < n && o + 8 <= b4; e++, o += 8) for (let c = u32(o), d = u32(o + 4); c > 0; c--) durs.push(d);
                      });
                  });
              });
          });
          const T = track(id);
          T.kind = kind;
          T.scale = scale;
          if (durs.length) (T.durs = durs), (T.start = 0);
        }
        if (t1 === 'mvex')
          boxes(a1, b1, (t2, a2) => {
            if (t2 === 'trex') track(u32(a2 + 4)).defDur = u32(a2 + 12);
          });
      });
    if (type === 'moof')
      boxes(a, b, (t1, a1, b1) => {
        if (t1 !== 'traf') return;
        let T = null, defDur = 0;
        boxes(a1, b1, (t2, a2) => {
          const flags = u32(a2) & 0xffffff;
          if (t2 === 'tfhd') {
            T = track(u32(a2 + 4));
            let o = a2 + 8;
            if (flags & 0x1) o += 8;
            if (flags & 0x2) o += 4;
            defDur = flags & 0x8 ? u32(o) : T.defDur;
          }
          // (where this run starts in the track's time: a jump past where the last left off is a gap)
          if (t2 === 'tfdt' && T) {
            const t = u8[a2] === 1 ? u64(a2 + 4) : u32(a2 + 4);
            if (Number.isNaN(T.start)) T.start = t;
            else if (Number.isFinite(T.t) && t > T.t) T.durs.push(-(t - T.t)); // (a gap, marked as negative)
            T.t = t;
          }
          if (t2 === 'trun' && T) {
            const n = u32(a2 + 4);
            let o = a2 + 8;
            if (flags & 0x1) o += 4;
            if (flags & 0x4) o += 4;
            const step = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
            for (let i = 0; i < n; i++, o += step) {
              const d = flags & 0x100 ? u32(o) : defDur;
              T.durs.push(d);
              if (Number.isFinite(T.t)) T.t += d;
            }
          }
        });
      });
  });
  if (!isMp4 || !tracks.size) return null;
  const out = [];
  for (const T of tracks.values()) {
    if (!T.scale) continue;
    // its samples one after another: how long, and the longest wait from one to the next (a gap's samples
    // are the wait itself)
    let t = (Number.isFinite(T.start) ? T.start : 0) / T.scale, n = 0, gap = 0, gapAt = 0;
    const t0 = t;
    for (const d of T.durs) {
      const s = Math.abs(d) / T.scale;
      if (s > gap) (gap = s), (gapAt = t);
      if (d >= 0) n++;
      t += s;
    }
    out.push({ kind: T.kind, n, start: t0, end: t, dur: t - t0, gap, gapAt });
  }
  return out.length ? out : null;
}

// ("picture 343 frames, 0.0-21.9 s, longest wait 0.2 s at 8.4 s; sound 0.0-22.0 s")
export function mp4Line(facts) {
  if (!facts) return 'not an mp4 I can read';
  const f = (x) => x.toFixed(1);
  return facts
    .map((T) => (T.kind === 'vide' ? `picture ${T.n} frames, ${f(T.start)}-${f(T.end)} s, longest wait ${f(T.gap)} s at ${f(T.gapAt)} s` : T.kind === 'soun' ? `sound ${f(T.start)}-${f(T.end)} s` : `${T.kind} ${T.n} samples, ${f(T.start)}-${f(T.end)} s`))
    .join('; ');
}
