#!/usr/bin/env bash
# Temporary diagnostic (not for merging): puts Ubuntu's own jq package on PATH
# without root -- the package the proposed worker-image fix installs with apt --
# then runs the diagnostic driver, so the run shows what fails once jq exists.
set -uo pipefail
root="$HOME/jq-root"; lists="$HOME/apt-lists"; cache="$HOME/apt-cache"
mkdir -p "$lists/partial" "$cache/archives/partial" "$root"
opts=(-o "Dir::State::Lists=$lists" -o "Dir::Cache=$cache" -o Debug::NoLocking=1 -o "APT::Sandbox::User=$(id -un)")
if ! apt-get "${opts[@]}" update -qq >/dev/null 2>"$HOME/apt.err"; then setup="upd:$(tail -c 60 "$HOME/apt.err" | tr '\n' ' ')"
elif ! (cd "$cache" && apt-get "${opts[@]}" download jq libjq1 libonig5 >/dev/null 2>"$HOME/apt.err"); then setup="dl:$(tail -c 60 "$HOME/apt.err" | tr '\n' ' ')"
else
  for deb in "$cache"/*.deb; do dpkg -x "$deb" "$root"; done
  export PATH="$root/usr/bin:$PATH"
  export LD_LIBRARY_PATH="$root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  setup=$(jq --version 2>&1 | head -1)
fi
JQ_SETUP="${setup:0:70}" node tests/consistency/fly-diag-run.mjs
