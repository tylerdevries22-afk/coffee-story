#!/usr/bin/env python3
"""Pick a runtime, a phone and a tablet from `xcrun simctl list -j`.

Prints three lines: runtime identifier, iPhone device type, iPad device type.
A GitHub macOS image ships whatever Xcode it ships, and its device list moves
every few weeks, so nothing here names a model: it takes the newest available
iOS runtime and the newest iPhone and iPad device types that runtime accepts.

Reads the runtimes JSON and the devicetypes JSON from two files rather than
stdin so the caller can gather both once, and so this is testable off a Mac.

    xcrun simctl list -j runtimes > r.json
    xcrun simctl list -j devicetypes > d.json
    scripts/ci/simulator-devices.py r.json d.json
"""
import json
import sys

IOS_RUNTIME_PREFIX = 'com.apple.CoreSimulator.SimRuntime.iOS'


def version_key(value: str) -> list[int]:
    parts: list[int] = []
    for piece in value.split('.'):
        try:
            parts.append(int(piece))
        except ValueError:
            parts.append(0)
    return parts


def newest_ios_runtime(runtimes: list[dict]) -> dict:
    available = [
        runtime for runtime in runtimes
        if runtime.get('isAvailable') and str(runtime.get('identifier', '')).startswith(IOS_RUNTIME_PREFIX)
    ]
    if not available:
        raise SystemExit('No available iOS simulator runtime on this machine.')
    available.sort(key=lambda runtime: version_key(str(runtime.get('version', '0'))))
    return available[-1]


def newest_device_type(device_types: list[dict], keyword: str, supported: set[str] | None) -> dict:
    def usable(device_type: dict) -> bool:
        if keyword.lower() not in str(device_type.get('name', '')).lower():
            return False
        # `supportedDeviceTypes` on the runtime is the authoritative pairing;
        # an iPhone 8 offered by the image is not necessarily runnable on the
        # newest runtime, and `simctl create` fails on a mismatch.
        return supported is None or device_type.get('identifier') in supported

    matches = [device_type for device_type in device_types if usable(device_type)]
    if not matches:
        raise SystemExit(f'No {keyword} device type this runtime supports.')
    # The list arrives oldest-to-newest, which is the only ordering simctl
    # offers; the last entry is the newest model.
    return matches[-1]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit('usage: simulator-devices.py <runtimes.json> <devicetypes.json>')
    with open(sys.argv[1], encoding='utf-8') as handle:
        runtimes = json.load(handle).get('runtimes', [])
    with open(sys.argv[2], encoding='utf-8') as handle:
        device_types = json.load(handle).get('devicetypes', [])

    runtime = newest_ios_runtime(runtimes)
    supported = runtime.get('supportedDeviceTypes')
    identifiers = (
        {entry.get('identifier') for entry in supported}
        if isinstance(supported, list) and supported else None
    )
    print(runtime['identifier'])
    print(newest_device_type(device_types, 'iPhone', identifiers)['identifier'])
    print(newest_device_type(device_types, 'iPad', identifiers)['identifier'])


if __name__ == '__main__':
    main()
