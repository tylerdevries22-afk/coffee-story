#!/usr/bin/env bash
#
# Launch the customer and operator apps, each on its own iOS simulator.
#
#   ./scripts/launch-simulators.sh
#   CUSTOMER_SIM="my iphone" OPERATOR_SIM="my ipad" ./scripts/launch-simulators.sh
#
# macOS only: iOS simulators need the full Xcode app, so this cannot run in
# CI or in a Linux dev container. It is checked in because "get both apps
# running side by side" is a thing every contributor does on their first day
# and it has a surprising number of ways to go quietly wrong.
#
# What it does that pressing `i` in Metro does not:
#   - boots each device BEFORE opening anything, which is what avoids the
#     `simctl openurl` timeout that @expo/cli reports as "Expo crashed";
#   - pins each app to its OWN simulator, instead of both landing on
#     "whatever is booted" and the second replacing the first;
#   - matches simulator names loosely, so "coffee story ops",
#     "Coffee-Story-Ops" and "coffeestoryops" are the same device;
#   - touches only its own two ports, leaving anything else you are running
#     alone;
#   - reports which step failed, with the remedy, instead of a wall of red.
#
# Both apps open in Demo mode and need no backend. For live mode see
# docs/PRODUCTION.md.
set -u

CUSTOMER_SIM="${CUSTOMER_SIM:-coffee story cust}"
OPERATOR_SIM="${OPERATOR_SIM:-coffee story ops}"
CUSTOMER_PORT="${CUSTOMER_PORT:-8081}"
OPERATOR_PORT="${OPERATOR_PORT:-8083}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say()  { printf '%s\n' "$*"; }
fail() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "iOS simulators are macOS only; this is $(uname -s)."

# 1. Xcode, not just the command-line tools — simulators do not exist without it.
DEV_DIR="$(xcode-select -p 2>/dev/null || true)"
case "$DEV_DIR" in
  *Xcode*.app*) ;;
  *) fail "Xcode isn't installed or isn't selected (current: ${DEV_DIR:-none}).
   1) Install Xcode from the Mac App Store
   2) Open it once and let 'Installing components…' finish
   3) sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" ;;
esac
xcrun simctl list devices available >/dev/null 2>&1 \
  || fail "Xcode is installed but its simulators aren't ready. Open Xcode once and finish first-run setup."

# 2. Resolve each simulator by name, ignoring spaces, hyphens and case.
find_sim() {
  xcrun simctl list -j devices available 2>/dev/null | /usr/bin/python3 -c '
import json, re, sys
def norm(value): return re.sub(r"[^a-z0-9]", "", value.lower())
want = norm(sys.argv[1])
try:
    devices_by_runtime = json.load(sys.stdin)["devices"]
except Exception:
    # simctl produced nothing usable. Print no udid and let the caller say so
    # in its own words; a traceback here reads as "no such simulator".
    raise SystemExit
for runtime, devices in devices_by_runtime.items():
    for device in devices:
        if device.get("isAvailable") and norm(device["name"]) == want:
            print(device["udid"])
            raise SystemExit
' "$1"
}
command -v /usr/bin/python3 >/dev/null 2>&1 \
  || fail "/usr/bin/python3 is missing, so simulator names cannot be matched.
   It ships with the Xcode command-line tools: xcode-select --install"

CUSTOMER_UDID="$(find_sim "$CUSTOMER_SIM")"
OPERATOR_UDID="$(find_sim "$OPERATOR_SIM")"
if [ -z "$CUSTOMER_UDID" ] || [ -z "$OPERATOR_UDID" ]; then
  say "Simulators available on this Mac:"
  xcrun simctl list devices available | grep -E '^[[:space:]]+[^[:space:]]' | sed 's/^/   /'
  [ -z "$CUSTOMER_UDID" ] && say "   (nothing matches \"$CUSTOMER_SIM\")"
  [ -z "$OPERATOR_UDID" ] && say "   (nothing matches \"$OPERATOR_SIM\")"
  fail "Create the missing simulator(s) in Simulator → File → New Simulator.
   \"$CUSTOMER_SIM\" wants an iPhone; \"$OPERATOR_SIM\" wants an iPad (the operator app is iPad-first).
   Or point this at devices you already have:
     CUSTOMER_SIM='iPhone 16' OPERATOR_SIM='iPad Air 11-inch' $0"
fi
say "✅ Customer → $CUSTOMER_SIM"
say "✅ Operator → $OPERATOR_SIM"

# 3. Find two free ports. 8081 is the Expo DEFAULT, not ours -- on any machine
#    with a second React Native project it is usually someone else's Metro, and
#    the first version of this script killed whatever it found there. Stepping
#    aside is both safer and faster than explaining what we just terminated.
free_port() {
  local port="$1" tries=0
  while lsof -ti "tcp:$port" >/dev/null 2>&1; do
    port=$((port + 1)); tries=$((tries + 1))
    [ "$tries" -ge 20 ] && fail "No free port near $1. Close something, or set CUSTOMER_PORT/OPERATOR_PORT."
  done
  printf '%s' "$port"
}
ORIGINAL_CUSTOMER_PORT="$CUSTOMER_PORT"; ORIGINAL_OPERATOR_PORT="$OPERATOR_PORT"
CUSTOMER_PORT="$(free_port "$CUSTOMER_PORT")"
OPERATOR_PORT="$(free_port "$OPERATOR_PORT")"
[ "$CUSTOMER_PORT" = "$ORIGINAL_CUSTOMER_PORT" ] \
  || say "• Port $ORIGINAL_CUSTOMER_PORT is busy (left alone) — customer Metro on $CUSTOMER_PORT"
[ "$OPERATOR_PORT" = "$ORIGINAL_OPERATOR_PORT" ] \
  || say "• Port $ORIGINAL_OPERATOR_PORT is busy (left alone) — operator Metro on $OPERATOR_PORT"

# 4. Dependencies. Cheap when they are already installed.
cd "$REPO" || fail "Couldn't enter $REPO"
say "• Installing dependencies…"
npx -y pnpm@10 install >/dev/null || fail "pnpm install failed — run it directly to see why."

# 5. Boot both devices first. This is the ordering that matters: opening a
#    deep link on a device that is still booting is what times out.
for pair in "$CUSTOMER_UDID|$CUSTOMER_SIM" "$OPERATOR_UDID|$OPERATOR_SIM"; do
  udid="${pair%%|*}"; name="${pair##*|}"
  say "• Booting $name…"
  xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 \
    || fail "$name failed to boot. Try: xcrun simctl shutdown $udid && $0"
done
open -a Simulator
say "✅ Both simulators booted"

# 6. A Metro server per app, each in its own Terminal window so its output
#    stays readable.
start_metro() {
  local dir="$1" port="$2" label="$3" waited=0
  # Driving Terminal needs Automation permission, and the first run pops a
  # prompt. Denied, osascript exits non-zero and nothing ever starts -- which
  # used to surface four minutes later as "Metro never answered".
  if ! osascript -e "tell application \"Terminal\" to do script \"cd '$REPO/$dir' && npx expo start --port $port\"" >/dev/null 2>&1; then
    fail "Couldn't open a Terminal window for $label Metro.
   macOS asks for Automation permission the first time; if you dismissed it,
   allow it under System Settings → Privacy & Security → Automation, or start
   the two servers yourself:
     (cd '$REPO/apps/customer' && npx expo start --port $CUSTOMER_PORT)
     (cd '$REPO/apps/operator' && npx expo start --port $OPERATOR_PORT)"
  fi
  until curl -fs --max-time 2 "http://localhost:$port/status" >/dev/null 2>&1; do
    waited=$((waited + 2))
    [ "$waited" -ge 240 ] && fail "$label Metro never answered on port $port. Its Terminal window has the error."
    sleep 2
  done
  say "✅ $label Metro is up on :$port"
}
start_metro apps/customer "$CUSTOMER_PORT" "Customer"
start_metro apps/operator "$OPERATOR_PORT" "Operator"

# 7. Expo Go onto each device, then open each app on its own device.
#
#    Nothing here downloads Expo Go: @expo/cli fetches it when you press `i`
#    or pass --ios, and `expo start` on its own never does. So the previous
#    version of this loop sat for seven minutes waiting for a file that no
#    one had asked for, then printed the fallback anyway. Check briefly, in
#    case a Metro window is mid-download, then say what to do about it.
GO_APP=""; waited=0
while [ "$waited" -lt 30 ]; do
  GO_APP="$(ls -td "$HOME"/.expo/ios-simulator-app-cache/*.app 2>/dev/null | head -1)"
  [ -n "$GO_APP" ] && break
  sleep 5; waited=$((waited + 5))
done
if [ -z "$GO_APP" ]; then
  say ""
  say "• Expo Go isn't on this Mac yet, and only the Metro windows can fetch it."
  say "  Press i in the Customer window once; when it lands, run this script"
  say "  again and both apps will open on their own devices."
fi

open_app() {
  local udid="$1" port="$2" name="$3" try
  if [ -z "$GO_APP" ]; then
    say "⚠️  Expo Go isn't cached yet — in the $name Metro window press shift+i and pick the simulator."
    return
  fi
  xcrun simctl install "$udid" "$GO_APP" >/dev/null 2>&1 || true
  sleep 2
  # Each attempt is bounded by hand. `simctl openurl` is the call that reports
  # code 60 on a busy CoreSimulator -- the failure @expo/cli surfaces as "Expo
  # crashed" -- but it does not always report anything: on a GitHub macOS
  # runner it blocked for seven minutes with no output, which is why the CI
  # version of this grew the same bound. Retrying a call that never returns is
  # not retrying, it is hanging, and a hang here looks like a stuck terminal
  # rather than a failure worth reading. macOS has no GNU `timeout`.
  local pid waited
  for try in 1 2 3; do
    xcrun simctl openurl "$udid" "exp://127.0.0.1:$port" >/dev/null 2>&1 &
    pid=$!
    waited=0
    while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 45 ]; do
      sleep 2; waited=$((waited + 2))
    done
    if kill -0 "$pid" 2>/dev/null; then
      say "• $name: the open call is stuck (${waited}s) — retrying"
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    else
      if wait "$pid"; then
        say "✅ $name opening"
        return
      fi
    fi
    sleep 4
  done
  say "⚠️  Couldn't open $name automatically — press shift+i in its Metro window and pick the simulator."
}
open_app "$CUSTOMER_UDID" "$CUSTOMER_PORT" "Customer app"
open_app "$OPERATOR_UDID" "$OPERATOR_PORT" "Operator app"

say ""
say "──────────────────────────────────────────────"
say " Customer app → $CUSTOMER_SIM (Metro :$CUSTOMER_PORT)"
say " Operator app → $OPERATOR_SIM (Metro :$OPERATOR_PORT)"
say " Rotate the operator iPad to landscape with Cmd+←"
say " First bundle takes a minute or two per app."
say " Both open in Demo mode; live mode is docs/PRODUCTION.md."
say "──────────────────────────────────────────────"
