"""Prepare the night-light intensity map and overview waterways."""

import argparse
import gzip
import json
from pathlib import Path

from PIL import Image
import shapefile
from shapely.geometry import LineString

from tile_map import unwrap
from update_data import DATA_DIR


def lights(source):
    with Image.open(source) as image:
        if image.width != image.height * 2:
            raise ValueError('Expected a whole-world equirectangular night-light image')
        mask = image.convert('L').resize((4096, 2048), Image.Resampling.LANCZOS)
    curve = [round(255 * (max(0, value - 3) / 252) ** .82) for value in range(256)]
    mask.point(curve).save(DATA_DIR / 'night-lights.webp', quality=88, method=5)


def waterways(source):
    lines = []
    with shapefile.Reader(str(source), encodingErrors='replace') as data:
        for row in data.iterShapeRecords(fields=['scalerank', 'featurecla']):
            if row.record['scalerank'] > 6 or 'centerline' in row.record['featurecla'].lower():
                continue
            starts = [*row.shape.parts, len(row.shape.points)]
            for start, end in zip(starts, starts[1:]):
                points = row.shape.points[start:end]
                if len(points) < 2:
                    continue
                shape = LineString(unwrap(points)).simplify(.035)
                lines.append([[round((lon + 180) % 360 - 180, 4), round(lat, 4)] for lon, lat in shape.coords])
    body = json.dumps({'type': 'MultiLineString', 'coordinates': lines}, separators=(',', ':')).encode()
    (DATA_DIR / 'night-waterways.json.gz').write_bytes(gzip.compress(body, compresslevel=9, mtime=0))
    print(f'{len(lines):,} overview rivers')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('black_marble', type=Path)
    parser.add_argument('natural_earth_rivers', type=Path)
    args = parser.parse_args()
    lights(args.black_marble)
    waterways(args.natural_earth_rivers)
