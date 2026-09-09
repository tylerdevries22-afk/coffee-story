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

# shellcheck source=scripts/lib/launch-simulators-lib.sh
source "$REPO/scripts/lib/launch-simulators-lib.sh"

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
ORIGINAL_CUSTOMER_PORT="$CUSTOMER_PORT"; ORIGINAL_OPERATOR_PORT="$OPERATOR_PORT"
CUSTOMER_PORT="$(free_port "$CUSTOMER_PORT")"
OPERATOR_PORT="$(free_port "$OPERATOR_PORT" "$CUSTOMER_PORT")"
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
start_metro "$REPO" apps/customer "$CUSTOMER_PORT" "Customer" "$CUSTOMER_PORT" "$OPERATOR_PORT"
start_metro "$REPO" apps/operator "$OPERATOR_PORT" "Operator" "$CUSTOMER_PORT" "$OPERATOR_PORT"

# 7. Expo Go onto each device, then open each app on its own device.
#
#    Nothing here downloads Expo Go: @expo/cli fetches it when you press `i`
#    or pass --ios, and `expo start` on its own never does. So the previous
#    version of this loop sat for seven minutes waiting for a file that no
#    one had asked for, then printed the fallback anyway. Check briefly, in
#    case a Metro window is mid-download, then say what to do about it.
GO_APP=""; waited=0
while [ "$waited" -lt 30 ]; do
  GO_APP="$(find "$HOME/.expo/ios-simulator-app-cache" -maxdepth 1 -type d -name '*.app' \
    -exec stat -f '%m %N' {} + 2>/dev/null | sort -nr | sed 's/^[0-9]* //' | sed -n 1p)"
  [ -n "$GO_APP" ] && break
  sleep 5; waited=$((waited + 5))
done
if [ -z "$GO_APP" ]; then
  say ""
  say "• Expo Go isn't on this Mac yet, and only the Metro windows can fetch it."
  say "  Press i in the Customer window once; when it lands, run this script"
  say "  again and both apps will open on their own devices."
fi

# Loopback, because an iOS simulator shares this machine's network stack:
# 127.0.0.1 inside the device is this Mac's loopback, which is where `expo
# start` is listening by default. (An earlier revision used the LAN address
# here after a CI run showed apps opening onto nothing -- that run's real
# problem was the dev server exiting, and pointing the device at a LAN
# interface was the wrong correction. A physical device on the same Wi-Fi is
# the case that needs the LAN address, not a simulator.)
HOST_IP="127.0.0.1"

open_app "$GO_APP" "$HOST_IP" "$CUSTOMER_UDID" "$CUSTOMER_PORT" "Customer app"
open_app "$GO_APP" "$HOST_IP" "$OPERATOR_UDID" "$OPERATOR_PORT" "Operator app"

say ""
say "──────────────────────────────────────────────"
say " Customer app → $CUSTOMER_SIM (Metro :$CUSTOMER_PORT)"
say " Operator app → $OPERATOR_SIM (Metro :$OPERATOR_PORT)"
say " Rotate the operator iPad to landscape with Cmd+←"
say " First bundle takes a minute or two per app."
say " Both open in Demo mode; live mode is docs/PRODUCTION.md."
say "──────────────────────────────────────────────"
