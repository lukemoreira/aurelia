#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Runs the assistant image the way TrueNAS will (read-only, no capabilities, user 568) and checks it,
# alone and behind the app image's nginx. It does not sign anyone in and never calls Anthropic.
# Usage: deploy/smoke-agent.sh <agent image> <app image>
set -euo pipefail

agent_image="${1:?usage: smoke-agent.sh <agent image> <app image>}"
app_image="${2:?usage: smoke-agent.sh <agent image> <app image>}"
id="$$"
net="aurelia-smoke-agent-net-$id"
vol="aurelia-smoke-agent-vol-$id"
agent_port=18083
app_port=18084
fail=0

cleanup() {
  docker logs aurelia-agent 2>&1 | tail -10 || true
  docker rm -f aurelia-agent "aurelia-app-$id" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  docker volume rm "$vol" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
expect() { # <label> <want status> <curl args...>
  local label="$1" want="$2"
  shift 2
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
  if [ "$got" = "$want" ]; then ok "$label -> $got"; else bad "$label -> $got (want $want)"; fi
}
wait_for() {
  for _ in $(seq 1 30); do curl -sf "$1" >/dev/null && return 0; sleep 1; done
  bad "no answer from $1"
}

docker volume create "$vol" >/dev/null
docker network create "$net" >/dev/null

# 1. Without the Access values the agent must refuse to start (fails closed).
out="$(docker run --rm "$agent_image" 2>&1)" && code=0 || code=$?
if [ "$code" -ne 0 ] && grep -q 'CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required' <<<"$out"; then
  ok "refuses to start without Access values (exit $code)"
else bad "agent started without Access values (exit $code): $out"; fi

# 2. The app without an agent: /agent/ answers 502 and the app still works.
docker run -d --name "aurelia-app-$id" --network "$net" --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges -p "127.0.0.1:$app_port:8080" "$app_image" >/dev/null
wait_for "http://127.0.0.1:$app_port/healthz"
expect "no agent: /agent/ is 502" 502 "http://127.0.0.1:$app_port/agent/status"
expect "no agent: the app works" 200 "http://127.0.0.1:$app_port/"

# 3. The agent, hardened: 401 everywhere without a valid login, except /agent/healthz.
docker run -d --name aurelia-agent --network "$net" --network-alias aurelia-agent --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges --mount "type=volume,src=$vol,dst=/data" \
  -e CF_ACCESS_TEAM_DOMAIN=smoke.cloudflareaccess.com -e CF_ACCESS_AUD=smoke \
  -e AURELIA_AGENT_SKIP_INSTALL=1 -p "127.0.0.1:$agent_port:8082" "$agent_image" >/dev/null
wait_for "http://127.0.0.1:$agent_port/agent/healthz"
docker exec aurelia-agent id -u | grep -qx 568 && ok "runs as 568" || bad "does not run as 568"
expect "healthz needs no login" 200 "http://127.0.0.1:$agent_port/agent/healthz"
expect "no token" 401 "http://127.0.0.1:$agent_port/agent/status"
expect "garbage token" 401 -H 'Cf-Access-Jwt-Assertion: a.b.c' "http://127.0.0.1:$agent_port/agent/status"
expect "ask without token" 401 -X POST --data '{}' "http://127.0.0.1:$agent_port/agent/ask"
if docker exec aurelia-agent sh -c 'test -e /data/claude/.local/bin/claude || ls /app | grep -qi claude'; then
  bad "Claude Code is in the image or installed despite the skip"
else ok "the image holds no Claude Code"; fi

# 4. Behind the app's nginx.
expect "through nginx: healthz" 200 "http://127.0.0.1:$app_port/agent/healthz"
expect "through nginx: no token" 401 "http://127.0.0.1:$app_port/agent/status"
expect "through nginx: wrong method" 405 -X DELETE "http://127.0.0.1:$app_port/agent/status"

exit "$fail"
