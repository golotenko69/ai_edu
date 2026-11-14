"""Сборка icon.ico (16–256 px) из фирменной матрицы 3×3 — только стандартная библиотека."""
import os
import struct
import zlib

BG = (11, 11, 12, 255)
FG = (245, 245, 242, 255)
DIM = (63, 63, 68, 255)


def matrix_png(size):
    # сетка 3×3: квадраты занимают ~70% холста, промежутки ~9% стороны квадрата
    pad = round(size * 0.14)
    gap = max(1, round(size * 0.055))
    cell = (size - 2 * pad - 2 * gap) / 3
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            color = BG
            cx, cy = x - pad, y - pad
            if 0 <= cx < size - 2 * pad and 0 <= cy < size - 2 * pad:
                col = int(cx // (cell + gap))
                rw = int(cy // (cell + gap))
                inx = cx - col * (cell + gap) < cell
                iny = cy - rw * (cell + gap) < cell
                if col < 3 and rw < 3 and inx and iny:
                    color = DIM if (col == 1 and rw in (0, 2)) else FG
            row += bytes(color)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def build_ico(path, sizes=(16, 24, 32, 48, 64, 128, 256)):
    images = [matrix_png(s) for s in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    for s, data in zip(sizes, images):
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    with open(path, "wb") as f:
        f.write(header + entries + b"".join(images))


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    build_ico(os.path.join(here, "icon.ico"))
    with open(os.path.join(here, "icon-256.png"), "wb") as f:
        f.write(matrix_png(256))
    print("icon.ico готов")
