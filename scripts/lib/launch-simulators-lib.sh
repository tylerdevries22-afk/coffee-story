#!/usr/bin/env bash

# Resolve a simulator by name, ignoring spaces, hyphens, and case.
find_sim() {
  xcrun simctl list -j devices available 2>/dev/null | /usr/bin/python3 -c '
import json, re, sys
def norm(value): return re.sub(r"[^a-z0-9]", "", value.lower())
want = norm(sys.argv[1])
try:
    devices_by_runtime = json.load(sys.stdin)["devices"]
except Exception:
    # Let the caller describe an unusable simctl response as a missing device.
    raise SystemExit
for _runtime, devices in devices_by_runtime.items():
    for device in devices:
        if device.get("isAvailable") and norm(device["name"]) == want:
            print(device["udid"])
            raise SystemExit
' "$1"
}

free_port() {
  local port="$1" reserved="${2:-}" tries=0
  while lsof -ti "tcp:$port" >/dev/null 2>&1 || [ "$port" = "$reserved" ]; do
    port=$((port + 1)); tries=$((tries + 1))
    [ "$tries" -ge 20 ] && fail "No free port near $1. Close something, or set CUSTOMER_PORT/OPERATOR_PORT."
  done
  printf '%s' "$port"
}

start_metro() {
  local repo="$1" dir="$2" port="$3" label="$4"
  local customer_port="$5" operator_port="$6" waited=0
  # Driving Terminal needs Automation permission. A denied first-run prompt
  # exits immediately, so report that instead of waiting for a dead port.
  if ! osascript -e "tell application \"Terminal\" to do script \"cd '$repo/$dir' && npx expo start --port $port\"" >/dev/null 2>&1; then
    fail "Couldn't open a Terminal window for $label Metro.
   macOS asks for Automation permission the first time; if you dismissed it,
   allow it under System Settings → Privacy & Security → Automation, or start
   the two servers yourself:
     (cd '$repo/apps/customer' && npx expo start --port $customer_port)
     (cd '$repo/apps/operator' && npx expo start --port $operator_port)"
  fi
  until curl -fs --max-time 2 "http://localhost:$port/status" >/dev/null 2>&1; do
    waited=$((waited + 2))
    [ "$waited" -ge 240 ] && fail "$label Metro never answered on port $port. Its Terminal window has the error."
    sleep 2
  done
  say "✅ $label Metro is up on :$port"
}

open_app() {
  local go_app="$1" host_ip="$2" udid="$3" port="$4" name="$5"
  local pid waited
  if [ -z "$go_app" ]; then
    say "⚠️  Expo Go isn't cached yet — in the $name Metro window press shift+i and pick the simulator."
    return
  fi
  xcrun simctl install "$udid" "$go_app" >/dev/null 2>&1 || true
  sleep 2
  # Launch by bundle id first so LaunchServices registers the exp:// scheme
  # before the deep link is handed to a freshly installed Expo Go.
  xcrun simctl launch "$udid" host.exp.Exponent >/dev/null 2>&1 || true
  sleep 3
  # macOS has no GNU timeout, so bound each potentially wedged openurl call.
  for _ in 1 2 3; do
    xcrun simctl openurl "$udid" "exp://$host_ip:$port" >/dev/null 2>&1 &
    pid=$!
    waited=0
    while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 45 ]; do
      sleep 2; waited=$((waited + 2))
    done
    if kill -0 "$pid" 2>/dev/null; then
      say "• $name: the open call is stuck (${waited}s) — retrying"
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    elif wait "$pid"; then
      say "✅ $name opening"
      return
    fi
    sleep 4
  done
  say "⚠️  Couldn't open $name automatically — press shift+i in its Metro window and pick the simulator."
}
