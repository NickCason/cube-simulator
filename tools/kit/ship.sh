#!/bin/bash
# Ship what's staged - stopping at the first thing that fails (a failing test is never pushed):
#   tools/kit/ship.sh <message-file> ["pushover title" "pushover message"]
# tests -> trial build -> commit (the staged changes only; the Co-Authored-By line added) -> push (retried) ->
# the Pages run for this commit watched -> the live bundle carries this commit's build stamp -> Pushover.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
MSG="${1:?message file}"; PT="${2:-}"; PM="${3:-}"
URL=https://nickcason.github.io/cube-simulator/
fail() { echo "SHIP STOPPED: $*" >&2; exit 1; }
[ -f "$MSG" ] || fail "no message file $MSG"
git diff --cached --quiet && fail "nothing staged"
echo "== tests"
T=$(npm test 2>&1); echo "$T" | grep -E "^# (tests|pass|fail)"
echo "$T" | grep -q "^# fail 0" || { echo "$T" | grep -B2 -A12 "^not ok" | head -40; fail "tests failed"; }
echo "== trial build"
npx vite build --outDir dist-trial > /tmp/ship-build.log 2>&1 || { tail -20 /tmp/ship-build.log; rm -rf dist-trial; fail "build failed"; }
rm -rf dist-trial
echo "== commit"
{ cat "$MSG"; echo; echo "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"; } > /tmp/ship-msg.txt
git commit -q -F /tmp/ship-msg.txt || fail "commit failed"
SHA=$(git rev-parse --short HEAD); echo "$SHA $(git log -1 --format=%s)"
echo "== push"
ok=0; for i in 1 2 3 4 5; do git push -q origin main && { ok=1; break; }; sleep $((2 ** i)); done
[ $ok = 1 ] || fail "push failed (committed locally as $SHA)"
echo "== deploy"
FULL=$(git rev-parse HEAD); RID=""
for i in $(seq 1 30); do RID=$(gh run list --branch main --limit 5 --json databaseId,headSha -q ".[] | select(.headSha == \"$FULL\") | .databaseId" | head -1); [ -n "$RID" ] && break; sleep 4; done
[ -n "$RID" ] || fail "no Pages run for $SHA"
gh run watch "$RID" --exit-status > /tmp/ship-watch.log 2>&1 || { tail -5 /tmp/ship-watch.log; fail "deploy run $RID failed"; }
echo "== live"
live=""
for i in $(seq 1 24); do
  JS=$(curl -s "$URL?v=$(date +%s)" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
  [ -n "$JS" ] && live=$(curl -s "$URL$JS" | grep -o "$SHA 20[0-9-]* [0-9:]*Z" | head -1)
  [ -n "$live" ] && break; sleep 5
done
[ -n "$live" ] || fail "the live bundle doesn't carry $SHA yet"
echo "live: $live"
if [ -n "$PT" ]; then bash scratch/push.sh "$PT" "$PM" "$URL" > /dev/null 2>&1 && echo "pushover sent" || echo "pushover failed"; fi
echo "SHIPPED $SHA"
