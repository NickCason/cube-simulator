#!/usr/bin/env python3
"""Deploy the ideas box (tools/inbox/worker.js) to Cloudflare - idempotent: run it again after changing the worker.

The D1 database `cube-ideas` and its table; the admin token (~/.cube-ideas-token) and the address salt
(~/.cube-ideas-salt), both 0600, made once; the Access app for ideas.rellm.net/admin (the household's reusable
policy, the one-time-PIN login - as blue, read, spin); the Worker `cube-ideas` with its bindings; ideas.rellm.net
on it. Uses this host's ~/.cloudflare-token (see the fleet memory's CF API token note).
"""
import json, os, secrets, sys, urllib.request, urllib.error, uuid

ACC = 'da4bd7361b0d8c485d54efac38a2b67f'
ZONE = '1b7c70b506bb5bf789a94bd574273fdc'  # rellm.net
TEAM = 'casonteam'
HOST = 'ideas.rellm.net'
NAME = 'cube-ideas'
POLICY = 'a13b8015-0fdc-4ea5-86a4-d421edd6dda1'  # "Household Allow" (reusable)
IDP = '40eff886-07e5-4a67-82c8-9afac4d6f724'  # one-time PIN
HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = open(os.path.expanduser('~/.cloudflare-token')).read().strip()
API = f'https://api.cloudflare.com/client/v4/accounts/{ACC}'

SCHEMA = """
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, token TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL, name TEXT, credit INTEGER DEFAULT 0, context TEXT, shot TEXT,
  status TEXT NOT NULL DEFAULT 'new', note TEXT, plan TEXT, sha TEXT, dup_of TEXT, ip_hash TEXT, ua TEXT
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created);
CREATE INDEX IF NOT EXISTS reports_ip ON reports(ip_hash, created);
"""


def call(method, url, body=None, headers=None, raw=None):
    h = {'Authorization': f'Bearer {TOKEN}'}
    data = None
    if raw is not None:
        data = raw
    elif body is not None:
        data = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        out = json.load(e)
        if not out.get('success'):
            raise SystemExit(f'{method} {url}: {out.get("errors")}')
        return out


def secret_file(path, n):
    p = os.path.expanduser(path)
    if not os.path.exists(p):
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.write(fd, secrets.token_urlsafe(n).encode())
        os.close(fd)
        print(f'made {path}')
    return open(p).read().strip()


# the database and its table
dbs = call('GET', f'{API}/d1/database?name={NAME}')['result']
db = next((d for d in dbs if d['name'] == NAME), None) or call('POST', f'{API}/d1/database', {'name': NAME})['result']
DB = db['uuid']
call('POST', f'{API}/d1/database/{DB}/query', {'sql': SCHEMA})
# (columns added since)
cols = [c['name'] for c in call('POST', f'{API}/d1/database/{DB}/query', {'sql': 'PRAGMA table_info(reports)'})['result'][0]['results']]
if 'plan' not in cols:
    call('POST', f'{API}/d1/database/{DB}/query', {'sql': 'ALTER TABLE reports ADD COLUMN plan TEXT'})
    print('added column plan')
print('d1', DB)

ADMIN = secret_file('~/.cube-ideas-token', 32)
SALT = secret_file('~/.cube-ideas-salt', 24)

# the triage page's Access app
apps = call('GET', f'{API}/access/apps?per_page=100')['result']
app = next((a for a in apps if a.get('domain') == f'{HOST}/admin'), None)
if not app:
    app = call('POST', f'{API}/access/apps', {
        'name': 'ideas box triage', 'domain': f'{HOST}/admin', 'type': 'self_hosted', 'session_duration': '720h',
        'allowed_idps': [IDP], 'auto_redirect_to_identity': True, 'policies': [{'id': POLICY, 'precedence': 1}],
    })['result']
    print('access app made')
AUD = app['aud']
print('access aud', AUD[:12] + '…')

# the worker
meta = {
    'main_module': 'worker.js', 'compatibility_date': '2025-01-01',
    'bindings': [
        {'type': 'd1', 'name': 'DB', 'id': DB},
        {'type': 'secret_text', 'name': 'ADMIN_TOKEN', 'text': ADMIN},
        {'type': 'secret_text', 'name': 'SALT', 'text': SALT},
        {'type': 'plain_text', 'name': 'ACCESS_AUD', 'text': AUD},
        {'type': 'plain_text', 'name': 'TEAM', 'text': TEAM},
    ],
}
code = open(os.path.join(HERE, 'worker.js'), 'rb').read()
b = uuid.uuid4().hex
parts = [
    f'--{b}\r\nContent-Disposition: form-data; name="metadata"; filename="metadata.json"\r\nContent-Type: application/json\r\n\r\n'.encode() + json.dumps(meta).encode() + b'\r\n',
    f'--{b}\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode() + code + b'\r\n',
    f'--{b}--\r\n'.encode(),
]
call('PUT', f'{API}/workers/scripts/{NAME}', raw=b''.join(parts), headers={'Content-Type': f'multipart/form-data; boundary={b}'})
print('worker uploaded')

# its address
call('PUT', f'{API}/workers/domains', {'hostname': HOST, 'service': NAME, 'zone_id': ZONE, 'environment': 'production'})
print('domain', HOST)
