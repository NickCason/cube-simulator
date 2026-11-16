// The ideas box: Cube Simulator's suggestions and bug reports (a Cloudflare Worker + D1, at ideas.rellm.net).
//  POST /api/report             anyone (the app): { kind: idea|bug|tool, text, name?, credit?, context?, shot? } -> { id, token }
//  POST /api/status             the reporter (the app): { reports: [{ id, token }] } -> their status, note, sha
//  /api/admin/*                 the automation: Authorization: Bearer <ADMIN_TOKEN>
//  /admin, /admin/api/*         the triage page - behind Cloudflare Access; its token checked here too (JWT, RS256)
// Limits: 6 reports an hour and 25 a day from one address (hashed, salted), 600 a day in all; text 2000 chars; a
// screenshot under 300 KB. Report text is stored as text - never run, never trusted (see tools/inbox/AUTOMATION.md).
// Bindings: DB (D1), ADMIN_TOKEN, SALT (secrets), ACCESS_AUD, TEAM (vars).

const ORIGINS = ['https://nickcason.github.io'];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|100\.\d+\.\d+\.\d+)(:\d+)?$/;
const KINDS = ['idea', 'bug', 'tool'];
const STATUSES = ['new', 'triaged', 'needs-approval', 'approved', 'building', 'shipped', 'declined', 'duplicate'];
const COLS = 'id, created, updated, kind, text, name, credit, context, status, note, plan, sha, dup_of, ua, (shot IS NOT NULL) AS has_shot';

const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);
const rid = (n) => {
  const a = new Uint8Array(n), A = 'abcdefghjkmnpqrstuvwxyz23456789';
  crypto.getRandomValues(a);
  return [...a].map((b) => A[b % A.length]).join('');
};
async function hash(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
function cors(req) {
  const o = req.headers.get('origin') || '';
  if (!ORIGINS.includes(o) && !LOCAL.test(o)) return {};
  return { 'access-control-allow-origin': o, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' };
}

// (a Cloudflare Access token: signed by the team's keys, for this app, not expired)
let JWKS = null, JWKS_AT = 0;
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function accessOK(req, env) {
  const tok = req.headers.get('cf-access-jwt-assertion');
  if (!tok || !env.ACCESS_AUD || !env.TEAM) return false;
  const [h, p, sig] = tok.split('.');
  if (!h || !p || !sig) return false;
  const head = JSON.parse(new TextDecoder().decode(b64u(h))), body = JSON.parse(new TextDecoder().decode(b64u(p)));
  const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (!aud.includes(env.ACCESS_AUD) || !(body.exp * 1000 > Date.now())) return false;
  if (!JWKS || Date.now() - JWKS_AT > 3600e3) {
    JWKS = (await (await fetch(`https://${env.TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`)).json()).keys || [];
    JWKS_AT = Date.now();
  }
  const jwk = JWKS.find((k) => k.kid === head.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(sig), new TextEncoder().encode(`${h}.${p}`));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname, C = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: C });
    try {
      // ---- a report in, from the app
      if (p === '/api/report' && req.method === 'POST') {
        if ((+req.headers.get('content-length') || 0) > 400000) return json({ error: 'That is too big to send.' }, 413, C);
        const b = await req.json().catch(() => null);
        if (!b || typeof b !== 'object') return json({ error: 'That did not come through - try again?' }, 400, C);
        if (b.website) return json({ ok: true, id: rid(10), token: rid(16) }, 200, C); // (the honeypot: a bot's, thanked and dropped)
        const kind = KINDS.includes(b.kind) ? b.kind : null, text = clean(b.text, 2000);
        const name = clean(b.name, 32).replace(/[^\p{L}\p{N} ._'-]/gu, '').trim();
        if (!kind || text.length < 4) return json({ error: 'Say a little more?' }, 400, C);
        if ((text.match(/https?:\/\//gi) || []).length > 3) return json({ error: 'Fewer links, please.' }, 400, C);
        const now = Date.now(), ih = await hash((req.headers.get('cf-connecting-ip') || '') + env.SALT);
        const count = async (where, ...args) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM reports WHERE ${where}`).bind(...args).first()).n;
        if ((await count('ip_hash = ? AND created > ?', ih, now - 3600e3)) >= 6) return json({ error: 'That is plenty for now - try again in an hour.' }, 429, C);
        if ((await count('ip_hash = ? AND created > ?', ih, now - 86400e3)) >= 25) return json({ error: 'That is a lot for one day - thank you! Try tomorrow.' }, 429, C);
        if ((await count('created > ?', now - 86400e3)) >= 600) return json({ error: 'The box is full today - try tomorrow.' }, 429, C);
        let context = '';
        try {
          context = JSON.stringify(b.context ?? {}).slice(0, 12000);
        } catch (e) {}
        const shot = typeof b.shot === 'string' && b.shot.length < 300000 && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(b.shot) ? b.shot : null;
        const id = rid(10), token = rid(16);
        await env.DB.prepare('INSERT INTO reports (id, token, created, updated, kind, text, name, credit, context, shot, status, ip_hash, ua) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .bind(id, token, now, now, kind, text, name || null, b.credit && name ? 1 : 0, context, shot, 'new', ih, clean(req.headers.get('user-agent'), 200))
          .run();
        return json({ ok: true, id, token }, 200, C);
      }
      // ---- a reporter's own, by the tokens they were given
      if (p === '/api/status' && req.method === 'POST') {
        const b = await req.json().catch(() => null), out = [];
        for (const r of (Array.isArray(b?.reports) ? b.reports : []).slice(0, 50)) {
          const row = await env.DB.prepare('SELECT id, kind, status, note, sha, created, updated FROM reports WHERE id = ? AND token = ?').bind(String(r?.id || ''), String(r?.token || '')).first();
          if (row) out.push(row);
        }
        return json({ reports: out }, 200, C);
      }
      // ---- the automation's (a bearer token) and the triage page's (Cloudflare Access)
      const auto = p.startsWith('/api/admin/'), page = p.startsWith('/admin/api/');
      if (auto || page) {
        if (auto && (!env.ADMIN_TOKEN || req.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`)) return json({ error: 'no' }, 401);
        if (page && !(await accessOK(req, env))) return json({ error: 'no' }, 401);
        const sub = p.replace(/^\/(api\/admin|admin\/api)\//, '');
        if (sub === 'reports' && req.method === 'GET') {
          const st = url.searchParams.get('status'), lim = Math.min(200, Math.max(1, +url.searchParams.get('limit') || 100));
          const q = st ? env.DB.prepare(`SELECT ${COLS} FROM reports WHERE status = ? ORDER BY created DESC LIMIT ?`).bind(st, lim) : env.DB.prepare(`SELECT ${COLS} FROM reports ORDER BY created DESC LIMIT ?`).bind(lim);
          return json({ reports: (await q.all()).results });
        }
        const m = sub.match(/^report\/([a-z0-9]+)(\/shot)?$/);
        if (m && m[2] && req.method === 'GET') {
          const row = await env.DB.prepare('SELECT shot FROM reports WHERE id = ?').bind(m[1]).first();
          if (!row?.shot) return json({ error: 'none' }, 404);
          const [, type, data] = row.shot.match(/^data:([^;]+);base64,(.*)$/) || [];
          return new Response(b64u(data || ''), { headers: { 'content-type': type || 'image/jpeg', 'cache-control': 'private, max-age=600' } });
        }
        if (m && !m[2] && req.method === 'POST') {
          const b = await req.json().catch(() => ({})), set = [], args = [];
          if (b.status !== undefined) {
            if (!STATUSES.includes(b.status)) return json({ error: 'status?' }, 400);
            set.push('status = ?');
            args.push(b.status);
          }
          // (note: what the reporter's told, in the app; plan: for Nick only - what it'd build, for his yes)
          for (const [k, n] of [['note', 600], ['plan', 4000], ['sha', 40], ['dup_of', 16]])
            if (b[k] !== undefined) {
              set.push(`${k} = ?`);
              args.push(b[k] === null ? null : clean(b[k], n));
            }
          if (!set.length) return json({ error: 'nothing to change' }, 400);
          set.push('updated = ?');
          args.push(Date.now());
          const r = await env.DB.prepare(`UPDATE reports SET ${set.join(', ')} WHERE id = ?`).bind(...args, m[1]).run();
          return json({ ok: r.meta.changes === 1 });
        }
        return json({ error: 'not found' }, 404);
      }
      if (p === '/admin' || p === '/admin/') {
        if (!(await accessOK(req, env))) return new Response('Not for you, sorry.', { status: 401 });
        return new Response(TRIAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      }
      if (p === '/') return new Response('The Cube Simulator ideas box. Send ideas from the app: ⋯ → Suggest or report.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      return json({ error: 'not found' }, 404, C);
    } catch (e) {
      return json({ error: 'Something went wrong on our side - try again?' }, 500, C);
    }
  },
};

// The triage page: everything sent, newest first - by status; each with what was said, who (if they'd like credit),
// where they were (the app's context), their picture; set its status, a note back to them
const TRIAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ideas box · Cube Simulator</title><style>
body{margin:0;font:15px/1.45 -apple-system,Inter,Segoe UI,Roboto,sans-serif;background:#f4efe9;color:#1c1c1f}
header{position:sticky;top:0;background:#fffcf8ee;backdrop-filter:blur(10px);padding:12px 16px;border-bottom:1px solid #0001;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
h1{font-size:18px;margin:0 12px 0 0}button,select,input,textarea{font:inherit}
.f{padding:6px 12px;border-radius:999px;border:1px solid #0002;background:#fff;cursor:pointer}.f.on{background:#1c1c1f;color:#fff}
main{max-width:860px;margin:0 auto;padding:12px}.r{background:#fff;border-radius:16px;padding:14px 16px;margin:10px 0;box-shadow:0 2px 10px #0001}
.k{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.idea{background:#e3f2ff;color:#185a99}.bug{background:#ffe3e0;color:#9a2a1c}.tool{background:#efe6ff;color:#5b31a6}
.m{color:#0008;font-size:13px}.t{white-space:pre-wrap;margin:8px 0}.s{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.s button{padding:5px 10px;border-radius:10px;border:1px solid #0002;background:#f6f4f1;cursor:pointer}.s button.on{background:#1c1c1f;color:#fff}
img{max-width:220px;border-radius:10px;display:block;margin:8px 0}details{font-size:13px;color:#0009}textarea{width:100%;box-sizing:border-box;border-radius:10px;border:1px solid #0002;padding:8px;margin-top:6px}
</style></head><body><header><h1>Ideas box</h1><span id="fs"></span></header><main id="list">Loading…</main><script>
const S=['new','triaged','needs-approval','approved','building','shipped','declined','duplicate'];let cur='';
const fs=document.getElementById('fs');for(const s of ['',...S]){const b=document.createElement('button');b.className='f';b.textContent=s||'all';b.onclick=()=>{cur=s;load()};fs.appendChild(b)}
async function load(){[...fs.children].forEach(b=>b.classList.toggle('on',b.textContent===(cur||'all')));const r=await fetch('/admin/api/reports'+(cur?'?status='+cur:''));const d=await r.json();const L=document.getElementById('list');L.textContent='';
if(!d.reports?.length){L.textContent='Nothing here.';return}
for(const x of d.reports){const e=document.createElement('div');e.className='r';let ctx={};try{ctx=JSON.parse(x.context||'{}')}catch(_){}
e.innerHTML='<span class="k '+x.kind+'"></span> <span class="m"></span><div class="t"></div>'+(x.plan?'<details open><summary>The plan (for your yes)</summary><div class="t pl"></div></details>':'')+(x.has_shot?'<img loading="lazy">':'')+'<details><summary>Where they were</summary><pre></pre></details><textarea placeholder="A note back to them (they see it in the app)"></textarea><div class="s"></div>';
if(x.plan)e.querySelector('.pl').textContent=x.plan;
e.querySelector('.k').textContent=x.kind;e.querySelector('.m').textContent=new Date(x.created).toLocaleString()+(x.name?' · '+x.name+(x.credit?' (would like credit)':''):'')+' · '+x.id+(x.sha?' · shipped '+x.sha:'');
e.querySelector('.t').textContent=x.text;if(x.has_shot)e.querySelector('img').src='/admin/api/report/'+x.id+'/shot';e.querySelector('pre').textContent=JSON.stringify(ctx,null,1);
const n=e.querySelector('textarea');n.value=x.note||'';const sb=e.querySelector('.s');
for(const s of S){const b=document.createElement('button');b.textContent=s==='approved'?'approve':s;b.className=s===x.status?'on':'';b.onclick=async()=>{await fetch('/admin/api/report/'+x.id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:s,note:n.value})});load()};sb.appendChild(b)}
L.appendChild(e)}}
load();
</script></body></html>`;
