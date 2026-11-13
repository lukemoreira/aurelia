#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Runs the image the way TrueNAS will (read-only, no capabilities) and checks it.
# Usage: deploy/smoke-test.sh <image>
set -euo pipefail

image="${1:?usage: smoke-test.sh <image>}"
name="aurelia-smoke-$$"
port=18080
fail=0

docker run --rm -d --name "$name" --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges -p "127.0.0.1:$port:8080" "$image" >/dev/null
trap 'docker logs "$name" 2>&1 | tail -20; docker stop "$name" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$port/healthz" >/dev/null && break
  sleep 1
done

# check <label> <path> <expected status> [curl args...]: prints the headers to $headers.
headers=""
check() {
  local label="$1" path="$2" want="$3"
  shift 3
  headers="$(curl -s -o /dev/null -D - "$@" "http://127.0.0.1:$port$path")"
  local got
  got="$(head -1 <<<"$headers" | awk '{print $2}')"
  if [ "$got" = "$want" ]; then echo "ok   $label $path -> $got"; else echo "FAIL $label $path -> $got (want $want)"; fail=1; fi
}

# has <header-name> <expected substring>: looks in $headers.
has() {
  if grep -iq "^$1:.*$2" <<<"$headers"; then return 0; fi
  echo "FAIL header '$1' with '$2' missing"; fail=1
}

security_headers() {
  has content-security-policy "frame-ancestors 'none'"
  has x-frame-options DENY
  has x-content-type-options nosniff
  has referrer-policy no-referrer
  has cross-origin-opener-policy same-origin
  has cross-origin-resource-policy same-origin
  has permissions-policy "camera=()"
  has strict-transport-security "max-age=31536000"
}

asset="$(curl -s "http://127.0.0.1:$port/" | grep -o '/assets/[A-Za-z0-9._-]*\.js' | head -1 || true)"
[ -n "$asset" ] || { echo "FAIL no /assets/*.js in index.html"; exit 1; }

check page / 200;                  security_headers; has cache-control no-cache
check deep-link /write 200;        security_headers
check asset "$asset" 200;          security_headers; has cache-control immutable
check missing-asset /assets/nope.js 404; security_headers; has cache-control no-store
check sw /sw.js 200;               security_headers; has cache-control no-cache
check manifest /manifest.webmanifest 200; has content-type manifest+json
check post / 405 -X POST;          security_headers

# No store runs here: /dav/ must answer 502 when asked (the app still booted), never 404 or a page.
# The methods the store needs get through nginx; anything else is 405.
for m in OPTIONS PUT PROPFIND GET; do
  check "dav-$m" /dav/x 502 -X "$m"; security_headers; has cache-control no-store
done
check dav-post /dav/x 405 -X POST;   security_headers

exit "$fail"
