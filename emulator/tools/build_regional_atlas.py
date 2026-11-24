"""Generalize the local atlas for regional views of the globe."""

import argparse
import gzip
import json
from collections import defaultdict
from math import cos, radians
from pathlib import Path

from shapely.geometry import LineString, Polygon

from build_lens_atlas import encode_feature, write_tile
from tile_map import parts
from update_data import DATA_DIR


def select_features(tile):
    for layer in ('built', 'lakes', 'rivers', 'roads'):
        result = []
        polygon = layer in ('built', 'lakes')
        for west, south, east, north, paths, width in tile.get(layer, []):
            longitude_scale = max(.10, cos(radians((south + north) / 2)))
            km_per_degree = 111.2
            if polygon:
                minimum = 11 if layer == 'built' else 22
                area_scale = km_per_degree ** 2 * longitude_scale
                if (east - west) * (north - south) * area_scale < minimum:
                    continue
                shell, *holes = [list(zip(path[::2], path[1::2])) for path in paths]
                geometry = Polygon(shell, holes)
                if geometry.area * area_scale < minimum:
                    continue
                simplified = geometry.simplify(.014)
            else:
                if layer == 'rivers' and width < 105:
                    continue
                coordinates = list(zip(paths[0][::2], paths[0][1::2]))
                simplified = LineString(coordinates).simplify(.017)
            for feature in parts(simplified, 'Polygon' if polygon else 'LineString'):
                west, south, east, north, coordinates, measure = encode_feature(feature, width)
                result.append([round(west, 4), round(south, 4), round(east, 4), round(north, 4),
                               [[round(value, 4) for value in ring] for ring in coordinates], measure])
        if result:
            yield layer, result


def build(source, output):
    with gzip.open(source / 'index.json.gz') as entry:
        ids = json.load(entry)
    cells = defaultdict(lambda: defaultdict(list))
    for tile_id in ids:
        with gzip.open(source / f'{tile_id}.json.gz') as entry:
            tile = json.load(entry)
        row, column = divmod(tile_id, 72)
        regional_id = (row // 2) * 36 + column // 2
        for layer, features in select_features(tile):
            cells[regional_id][layer].extend(features)
    output.mkdir(parents=True, exist_ok=True)
    size = 0
    for tile_id, features in cells.items():
        target = output / f'{tile_id}.json.gz'
        write_tile(target, {'longitude': tile_id % 36 * 10 - 175, **features})
        size += target.stat().st_size
    write_tile(output / 'index.json.gz', sorted(cells))
    print(f'{len(cells):,} regional cells, {size:,} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=DATA_DIR / 'lens-atlas')
    parser.add_argument('--output', type=Path, default=DATA_DIR / 'regional-atlas')
    args = parser.parse_args()
    build(args.source, args.output)
