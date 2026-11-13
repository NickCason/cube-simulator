// Builds to test against, each served by vite on its own port: 'work' (the working tree, the dev server on
// 5190) or any git ref ('head', a sha, a branch) - exported with git archive into /tmp/kit-builds/<sha> and
// served from there. Kept in a registry (/tmp/kit-builds.json) so a build started once is reused, and stopped
// by its process id (never pkill -f: a pattern matches the shell running it).
//
//   node tools/kit/builds.mjs serve head        -> prints its port
//   node tools/kit/builds.mjs serve 8e7b8c4
//   node tools/kit/builds.mjs list
//   node tools/kit/builds.mjs stop 8e7b8c4|all
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, openSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REG = '/tmp/kit-builds.json';
const BASE = '/tmp/kit-builds';
const WORK_PORT = 5190;

const readReg = () => (existsSync(REG) ? JSON.parse(readFileSync(REG, 'utf8')) : {});
const writeReg = (r) => writeFileSync(REG, JSON.stringify(r, null, 1));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
export const listening = (port) =>
  new Promise((ok) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.end(), ok(true)));
    s.once('error', () => ok(false));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitPort(port, ms = 20000) {
  for (let t = 0; t < ms; t += 250) {
    if (await listening(port)) return true;
    await sleep(250);
  }
  return false;
}
const git = (args) => execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const vite = join(ROOT, 'node_modules/.bin/vite');
function startVite(dir, port, log) {
  const out = openSync(log, 'a');
  const p = spawn('node', [vite, '--host', '0.0.0.0', '--port', String(port), '--strictPort'], { cwd: dir, detached: true, stdio: ['ignore', out, out] });
  p.unref();
  return p.pid;
}

// The port a build is served on - started if it isn't.
export async function serve(name = 'work') {
  if (name === 'work') {
    if (!(await listening(WORK_PORT))) {
      startVite(ROOT, WORK_PORT, '/tmp/kit-work-vite.log');
      if (!(await waitPort(WORK_PORT))) throw new Error('the dev server on 5190 did not start');
    }
    return { name, port: WORK_PORT, sha: 'work' };
  }
  const sha = git(`rev-parse --short ${name === 'head' ? 'HEAD' : name}`);
  const reg = readReg(), e = reg[sha];
  if (e && alive(e.pid) && (await listening(e.port))) return { name, port: e.port, sha };
  const dir = join(BASE, sha);
  if (!existsSync(join(dir, 'package.json'))) {
    mkdirSync(dir, { recursive: true });
    execSync(`git archive ${sha} | tar -x -C ${dir}`, { cwd: ROOT, shell: '/bin/bash' });
  }
  if (!existsSync(join(dir, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  const used = new Set(Object.values(reg).map((r) => r.port));
  let port = 5200;
  while (used.has(port) || (await listening(port))) port++;
  const pid = startVite(dir, port, join(BASE, `${sha}.log`));
  if (!(await waitPort(port))) throw new Error(`build ${sha} did not start on ${port} (see ${BASE}/${sha}.log)`);
  reg[sha] = { port, pid, dir, ref: name, at: new Date().toISOString() };
  writeReg(reg);
  return { name, port, sha };
}

export function stop(which = 'all') {
  const reg = readReg();
  for (const [sha, e] of Object.entries(reg)) {
    if (which !== 'all' && which !== sha && which !== e.ref) continue;
    if (alive(e.pid)) process.kill(e.pid);
    delete reg[sha];
    if (which !== 'all') rmSync(e.dir, { recursive: true, force: true });
  }
  writeReg(reg);
}

export async function list() {
  const reg = readReg(), out = [];
  for (const [sha, e] of Object.entries(reg)) out.push(`${sha.padEnd(9)} ${String(e.port).padEnd(6)} pid ${e.pid} ${alive(e.pid) && (await listening(e.port)) ? 'up' : 'down'}  (${e.ref}, ${e.at})`);
  out.push(`work      ${WORK_PORT}   ${(await listening(WORK_PORT)) ? 'up' : 'down'}  (working tree)`);
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'serve') console.log(JSON.stringify(await serve(arg || 'work')));
  else if (cmd === 'stop') (stop(arg || 'all'), console.log('stopped'));
  else console.log(await list());
}
