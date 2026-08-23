"""Render a simulator screenshot as a coarse brightness map.

The screenshots this job uploads are the only direct evidence of what is on
each device, and they are unreachable from an agent sandbox: the artifact host
answers 403 to CONNECT through a filtering proxy. A PNG cannot be read from a
job log either -- but a 56x20 brightness map can, and that is enough to tell a
rendered app apart from a blank screen, a crash dialog, or Expo Go's own home
screen. 40x14 was not: at that size a sign-in form and an error dialog are
the same two smudges. Each cell is the mean of a 6x6 sub-grid rather than one
pixel, so thin text reads as ink coverage instead of aliasing to whatever the
one sampled pixel happened to be.

BMP because `simctl io ... --type=bmp` writes it uncompressed, so this needs
no image library on the runner.
"""
import struct
import sys

CHARS = " .:-=+*#%@"  # dark -> light


def read_bmp(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:2] != b"BM":
        raise SystemExit(f"{path}: not a BMP")
    pixel_offset = struct.unpack_from("<I", data, 10)[0]
    header_size = struct.unpack_from("<I", data, 14)[0]
    width, height = struct.unpack_from("<ii", data, 18)
    bits = struct.unpack_from("<H", data, 28)[0]
    if bits not in (24, 32):
        raise SystemExit(f"{path}: {bits}-bit BMP unsupported")
    return data, pixel_offset, width, abs(height), height > 0, bits // 8


SUB = 6  # sub-samples per cell edge


def sample(path, cols=56, rows=20):
    data, offset, width, height, bottom_up, step = read_bmp(path)
    row_bytes = ((width * step * 8 + 31) // 32) * 4
    out = []
    for r in range(rows):
        line = []
        for c in range(cols):
            total = 0.0
            taken = 0
            for sy in range(SUB):
                y = min(height - 1, int((r + (sy + 0.5) / SUB) * height / rows))
                src_y = (height - 1 - y) if bottom_up else y
                base = offset + src_y * row_bytes
                for sx in range(SUB):
                    x = min(width - 1, int((c + (sx + 0.5) / SUB) * width / cols))
                    i = base + x * step
                    if i + 2 >= len(data):
                        continue
                    b, g, r_ = data[i], data[i + 1], data[i + 2]
                    total += 0.299 * r_ + 0.587 * g + 0.114 * b
                    taken += 1
            if not taken:
                line.append(" ")
                continue
            lum = total / taken / 255
            line.append(CHARS[min(len(CHARS) - 1, int(lum * len(CHARS)))])
        out.append("".join(line))
    return out, width, height


if __name__ == "__main__":
    lines, w, h = sample(sys.argv[1])
    print(f"  [{sys.argv[2] if len(sys.argv) > 2 else sys.argv[1]}] {w}x{h}")
    for line in lines:
        print(f"  |{line}|")
