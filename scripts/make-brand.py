import struct
import zlib


def chunk(name, data):
    return struct.pack('!I', len(data)) + name + data + struct.pack('!I', zlib.crc32(name + data))


def distance(x, y, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    projection = max(0, min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / (dx * dx + dy * dy)))
    return ((x - start[0] - projection * dx) ** 2 + (y - start[1] - projection * dy) ** 2) ** .5


def pixel(x, y):
    if (x - min(105, max(23, x))) ** 2 + (y - min(105, max(23, y))) ** 2 > 23 ** 2:
        return (0, 0, 0, 0)
    strokes = [((27, 57), (54, 87)), ((54, 87), (98, 40)), ((98, 40), (76, 40)), ((98, 40), (98, 61))]
    if min(distance(x, y, start, end) for start, end in strokes) < 6.3:
        return (255, 248, 241, 255)
    return (243, int(123 - 37 * y / 128), int(47 - 25 * y / 128), 255)


width = 128
raw = bytearray()
for y in range(width):
    raw.append(0)
    for x in range(width):
        samples = [pixel(x + a, y + b) for a in (.25, .75) for b in (.25, .75)]
        raw.extend(round(sum(sample[channel] for sample in samples) / 4) for channel in range(4))

with open('public/marca.png', 'wb') as file:
    file.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', width, width, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
