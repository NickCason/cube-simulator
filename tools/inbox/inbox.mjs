#!/usr/bin/env node
// The ideas box from here (tools/inbox/AUTOMATION.md): the reports, a report, its picture; a report's status, the note
// its sender sees, the plan Nick says yes to, the build it shipped in. The admin token: ~/.cube-ideas-token.
//   node tools/inbox/inbox.mjs list [status]          (new | triaged | needs-approval | approved | building | shipped | declined | duplicate)
//   node tools/inbox/inbox.mjs show <id>
//   node tools/inbox/inbox.mjs shot <id> <file.jpg>
//   node tools/inbox/inbox.mjs set <id> <status> [--note "..."] [--plan "..."] [--sha abc1234] [--dup <id>]
import fs from 'fs';
import os from 'os';

const BOX = 'https://ideas.rellm.net/api/admin';
const TOKEN = fs.readFileSync(`${os.homedir()}/.cube-ideas-token`, 'utf8').trim();
const H = { authorization: `Bearer ${TOKEN}` };
const [cmd, ...args] = process.argv.slice(2);

async function get(path) {
  const r = await fetch(`${BOX}/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r;
}
const brief = (r) => {
  let c = {};
  try {
    c = JSON.parse(r.context || '{}');
  } catch (e) {}
  return { id: r.id, when: new Date(r.created).toISOString().slice(0, 16), kind: r.kind, status: r.status, name: r.name || '', credit: !!r.credit, text: r.text, build: c.build, where: `${c.mode || '?'} / ${c.tool || '?'} / ${c.screen || '?'}${c.touch ? ' touch' : ''}`, errors: (c.errors || []).length, shot: !!r.has_shot, note: r.note || '', plan: r.plan || '', sha: r.sha || '' };
};

if (cmd === 'list') {
  const d = await (await get(`reports${args[0] ? `?status=${encodeURIComponent(args[0])}` : ''}`)).json();
  for (const r of d.reports) console.log(JSON.stringify(brief(r)));
  if (!d.reports.length) console.log('(none)');
} else if (cmd === 'show') {
  const d = await (await get('reports?limit=200')).json(), r = d.reports.find((x) => x.id === args[0]);
  if (!r) throw new Error(`no report ${args[0]}`);
  try {
    r.context = JSON.parse(r.context || '{}');
  } catch (e) {}
  console.log(JSON.stringify(r, null, 1));
} else if (cmd === 'shot') {
  const r = await get(`report/${args[0]}/shot`);
  fs.writeFileSync(args[1], Buffer.from(await r.arrayBuffer()));
  console.log(`saved ${args[1]}`);
} else if (cmd === 'set') {
  const [id, status, ...rest] = args, body = { status };
  for (let i = 0; i < rest.length; i += 2) {
    const k = { '--note': 'note', '--plan': 'plan', '--sha': 'sha', '--dup': 'dup_of' }[rest[i]];
    if (!k) throw new Error(`what's ${rest[i]}?`);
    body[k] = rest[i + 1];
  }
  const r = await fetch(`${BOX}/report/${id}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  console.log(r.status, await r.text());
} else {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 8).join('\n'));
}
