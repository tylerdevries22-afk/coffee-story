#!/usr/bin/env python3
"""Print the iOS simulator Expo Go download URL for one SDK version.

`https://api.expo.dev/v2/versions/latest` lists a client build per SDK. Taking
the URL from there rather than pressing `i` in Metro is what lets CI install
Expo Go on a simulator unattended -- @expo/cli only fetches it in response to
an interactive keypress or `--ios`.

The SDK is pinned (see AGENTS.md), so the version is passed in rather than
guessed: silently installing a client for a different SDK would fail at the
point the app tries to open, which is the least legible place for it.

    scripts/ci/expo-go-url.py versions.json 54.0.0
"""
import json
import sys

CANDIDATE_KEYS = ('iosClientUrl', 'iosSimulatorUrl')


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit('usage: expo-go-url.py <versions.json> <sdk-version>')
    with open(sys.argv[1], encoding='utf-8') as handle:
        payload = json.load(handle)
    sdk_version = sys.argv[2]

    # The endpoint has served the versions map both at the top level and under
    # `data`; accept either rather than pinning the shape of someone else's API.
    root = payload.get('data') if isinstance(payload.get('data'), dict) else payload
    versions = root.get('sdkVersions') if isinstance(root, dict) else None
    if not isinstance(versions, dict):
        raise SystemExit('Could not find sdkVersions in the Expo versions payload.')
    entry = versions.get(sdk_version)
    if not isinstance(entry, dict):
        available = ', '.join(sorted(versions)[-6:])
        raise SystemExit(f'Expo lists no client for SDK {sdk_version}. Latest listed: {available}')

    for key in CANDIDATE_KEYS:
        url = entry.get(key)
        if isinstance(url, str) and url.startswith('https://'):
            print(url)
            return
    raise SystemExit(f'SDK {sdk_version} has no iOS simulator client URL ({", ".join(CANDIDATE_KEYS)}).')


if __name__ == '__main__':
    main()
