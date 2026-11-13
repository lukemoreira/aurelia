#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Runs the store image the way TrueNAS will (read-only, no capabilities, user 568) and checks it,
# alone and behind the app image's nginx.
# Usage: deploy/smoke-store.sh <store image> <app image>
set -euo pipefail

store_image="${1:?usage: smoke-store.sh <store image> <app image>}"
app_image="${2:?usage: smoke-store.sh <store image> <app image>}"
id="$$"
net="aurelia-smoke-net-$id"
vol="aurelia-smoke-vol-$id"
store_port=18081
app_port=18082
fail=0

cleanup() {
  docker logs "aurelia-store" 2>&1 | tail -10 || true
  docker rm -f aurelia-store "aurelia-app-$id" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  docker volume rm "$vol" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
# expect <label> <want status> <curl args...>
expect() {
  local label="$1" want="$2"
  shift 2
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
  if [ "$got" = "$want" ]; then ok "$label -> $got"; else bad "$label -> $got (want $want)"; fi
}
body_is() { # <label> <want> <curl args...>
  local label="$1" want="$2"
  shift 2
  local got
  got="$(curl -s "$@")"
  if [ "$got" = "$want" ]; then ok "$label"; else bad "$label (got '$got', want '$want')"; fi
}
wait_for() {
  for _ in $(seq 1 30); do curl -sf "$1" >/dev/null && return 0; sleep 1; done
  bad "no answer from $1"
}

docker volume create "$vol" >/dev/null
docker network create "$net" >/dev/null

# 1. Without the Access values the store must refuse to start (fails closed).
out="$(docker run --rm "$store_image" 2>&1)" && code=0 || code=$?
if [ "$code" -ne 0 ] && grep -q 'CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required' <<<"$out"; then
  ok "refuses to start without Access values (exit $code)"
else bad "store started without Access values (exit $code): $out"; fi

# 2. With the Access values and no token: 401 everywhere except /healthz.
docker run -d --name aurelia-store --network "$net" --network-alias aurelia-store --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges --mount "type=volume,src=$vol,dst=/data" \
  -e CF_ACCESS_TEAM_DOMAIN=smoke.cloudflareaccess.com -e CF_ACCESS_AUD=smoke \
  -p "127.0.0.1:$store_port:8081" "$store_image" >/dev/null
wait_for "http://127.0.0.1:$store_port/healthz"
expect "healthz needs no login" 200 "http://127.0.0.1:$store_port/healthz"
expect "no token" 401 "http://127.0.0.1:$store_port/dav/"
expect "garbage token" 401 -H 'Cf-Access-Jwt-Assertion: a.b.c' -X PROPFIND -H 'Depth: 0' "http://127.0.0.1:$store_port/dav/"
docker rm -f aurelia-store >/dev/null

# 3. Test mode (no login), same hardening: the protocol round trip.
docker run -d --name aurelia-store --network "$net" --network-alias aurelia-store --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges --mount "type=volume,src=$vol,dst=/data" \
  -e AURELIA_STORE_INSECURE_NO_AUTH=1 -p "127.0.0.1:$store_port:8081" "$store_image" >/dev/null
wait_for "http://127.0.0.1:$store_port/healthz"
docker exec aurelia-store id -u | grep -qx 568 && ok "runs as 568" || bad "does not run as 568"

round_trip() { # <base url>
  local base="$1" etag
  expect "MKCOL" 201 -X MKCOL "$base/dav/Book"
  expect "PUT creates" 201 -X PUT --data-binary 'one' -H 'If-None-Match: *' "$base/dav/Book/a.md"
  expect "PUT create twice" 412 -X PUT --data-binary 'x' -H 'If-None-Match: *' "$base/dav/Book/a.md"
  etag="$(curl -s -D - -o /dev/null "$base/dav/Book/a.md" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')"
  [ -n "$etag" ] && ok "GET has an ETag" || bad "GET has no ETag"
  expect "PUT with stale If-Match" 412 -X PUT --data-binary 'x' -H 'If-Match: "nope"' "$base/dav/Book/a.md"
  expect "PUT with current If-Match" 204 -X PUT --data-binary 'two' -H "If-Match: $etag" "$base/dav/Book/a.md"
  body_is "GET returns the new text" two "$base/dav/Book/a.md"
  body="$(curl -s -X PROPFIND -H 'Depth: 1' "$base/dav/Book/")"
  grep -q '<D:href>/dav/Book/a.md</D:href>' <<<"$body" && ok "PROPFIND lists the file" || bad "PROPFIND: $body"
  expect "PROPFIND infinity" 403 -X PROPFIND -H 'Depth: infinity' "$base/dav/"
  expect "MOVE" 201 -X MOVE -H "Destination: $base/dav/Book/b.md" "$base/dav/Book/a.md"
  expect "DELETE" 204 -X DELETE "$base/dav/Book"
}
round_trip "http://127.0.0.1:$store_port"
expect "path traversal" 400 --path-as-is "http://127.0.0.1:$store_port/dav/%2e%2e/etc/passwd"

# 4. Behind the app's nginx: the same round trip on the app's own port.
docker run -d --name "aurelia-app-$id" --network "$net" --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges -p "127.0.0.1:$app_port:8080" "$app_image" >/dev/null
wait_for "http://127.0.0.1:$app_port/healthz"
round_trip "http://127.0.0.1:$app_port"
expect "app page still works" 200 "http://127.0.0.1:$app_port/"
expect "app still read-only" 405 -X PUT --data-binary x "http://127.0.0.1:$app_port/index.html"
head -c $((65 * 1024 * 1024)) /dev/zero >"/tmp/aurelia-smoke-big-$id"
expect "body over 64 MiB through nginx" 413 -X PUT --data-binary "@/tmp/aurelia-smoke-big-$id" "http://127.0.0.1:$app_port/dav/big"
rm -f "/tmp/aurelia-smoke-big-$id"

exit "$fail"
