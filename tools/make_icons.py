"""Gera os ícones do PWA (docs/icons/*.png) sem dependências. Uso: python tools/make_icons.py"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"


def dist_seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def render(size, maskable=False, ss=3):
    scale = 0.74 if maskable else 1.0  # maskable: conteúdo na zona segura
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            r = g = b = a = 0
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    u, v = (x + (sx + .5) / ss) / size, (y + (sy + .5) / ss) / size
                    # fundo (quadrado arredondado, ou total se maskable)
                    if maskable:
                        inside = True
                    else:
                        qx, qy = max(abs(u - .5) - (.5 - .22), 0), max(abs(v - .5) - (.5 - .22), 0)
                        inside = math.hypot(qx, qy) <= .22
                    if not inside:
                        continue
                    t = (u + v) / 2
                    col = (255 + (179 - 255) * t, 63 + (0 - 63) * t + 0 * t, 164 + (95 - 164) * t)
                    # símbolos (coordenadas em torno do centro, escaladas)
                    pu, pv = (u - .5) / scale + .5, (v - .5) / scale + .5
                    ring = abs(math.hypot(pu - .45, pv - .45) - .2) <= .036
                    handle = dist_seg(pu, pv, .6, .6, .77, .77) <= .047
                    dot = math.hypot(pu - .73, pv - .27) <= .1
                    if ring or handle:
                        col = (255, 255, 255)
                    elif dot:
                        col = (255, 213, 74)
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 1
            n = ss * ss
            if acc[3]:
                r, g, b = (int(acc[i] / acc[3]) for i in range(3))
                a = int(255 * acc[3] / n)
            raw += bytes((r, g, b, a))
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, mask in (("icon-192.png", 192, False), ("icon-512.png", 512, False),
                             ("maskable-512.png", 512, True), ("apple-touch-icon.png", 180, False),
                             ("favicon-32.png", 32, False)):
        (OUT / name).write_bytes(render(size, mask, ss=2 if size >= 512 else 3))
        print("gerado", name)
