"""Compile local atlas cells from public geodata archives in the source directory."""

import argparse
import gzip
import json
from collections import Counter
from pathlib import Path
from shutil import copyfileobj
from tempfile import TemporaryDirectory
from zipfile import ZipFile

import shapefile
from pyproj import Transformer
from shapely import STRtree, make_valid, transform
from shapely.geometry import LineString, Polygon, box, shape

from tile_map import COLUMNS, ROWS, SIZE, align_hole, parts, unwrap, world_copies
from update_data import DATA_DIR


def read_shapes(archive, kind, tolerance, attributes, converter=None, fields=None):
    with TemporaryDirectory() as directory, ZipFile(archive) as source:
        # Extract only the named components. Use ordinary files for seekable SHP access.
        member = next(name for name in source.namelist() if name.lower().endswith('.shp'))
        stem = member[:-4]
        target = Path(directory) / 'layer.shp'
        for extension in ('.shp', '.shx', '.dbf'):
            with source.open(stem + extension) as data, target.with_suffix(extension).open('wb') as output:
                copyfileobj(data, output, 1024 * 1024)

        with shapefile.Reader(str(target), encodingErrors='replace') as reader:
            for record in reader.iterRecords(fields=fields):
                weight = attributes(record)
                if weight is None:
                    continue
                raw = reader.shape(record.oid)
                if not raw.points:
                    continue
                geometry = shape(raw.__geo_interface__)
                if converter is not None:
                    geometry = transform(geometry.simplify(tolerance), converter.transform, interleaved=False)
                for part in parts(geometry, kind):
                    west, _, east, _ = part.bounds
                    if east - west > 180:
                        if kind == 'LineString':
                            part = LineString(unwrap(list(part.coords)))
                        else:
                            shell = unwrap(list(part.exterior.coords))
                            part = Polygon(shell, [align_hole(unwrap(list(ring.coords)), shell[0][0])
                                                   for ring in part.interiors])
                    if not part.is_valid:
                        part = make_valid(part)
                    if converter is None:
                        part = part.simplify(tolerance)
                    for feature in parts(part, kind):
                        yield from ((copy, weight) for copy in world_copies(feature))


def river_width(record):
    width = record['width_med_']
    return round(width) if record['lakeFlag'] != 1 and width is not None and width >= 25 else None


def layer_data(source_dir):
    def areas(_):
        return 0

    built = read_shapes(source_dir / 'GUE2025.zip', 'Polygon', 125, areas,
                        Transformer.from_crs('ESRI:54009', 'EPSG:4326', always_xy=True), fields=[])
    lakes = read_shapes(source_dir / 'HydroLAKES_polys_v10_shp.zip', 'Polygon', .0013,
                         lambda row: 0 if row['Lake_area'] >= .8 else None, fields=['Lake_area'])
    rivers = read_shapes(source_dir / 'GRWL_summaryStats_V01.02.zip', 'LineString', .001,
                         river_width, fields=['width_med_', 'lakeFlag'])
    roads = read_shapes(source_dir / 'ne_10m_roads.zip', 'LineString', .0012,
                        lambda row: 0 if 'ferry' not in row['type'].lower() else None, fields=['type'])
    return {'built': built, 'lakes': lakes, 'rivers': rivers, 'roads': roads}


def encode_feature(feature, weight):
    def path(line):
        return [round(component, 5) for point in line.coords for component in point[:2]]

    if feature.geom_type == 'Polygon':
        paths = [path(feature.exterior), *(path(hole) for hole in feature.interiors)]
    else:
        paths = [path(feature)]
    return [*(round(value, 5) for value in feature.bounds), paths, weight]


def write_tile(destination, value):
    body = json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
    temporary = destination.with_suffix('.tmp')
    temporary.write_bytes(gzip.compress(body, compresslevel=6, mtime=0))
    temporary.replace(destination)


def build_atlas(sources, destination):
    trees = {}
    for name, entries in layer_data(sources).items():
        shapes, weights = zip(*entries)
        trees[name] = STRtree(shapes), weights
        print(f'{name}: {len(shapes):,} source features', flush=True)

    destination.mkdir(parents=True, exist_ok=True)
    ids = []
    totals = Counter()
    for row in range(ROWS):
        south = row * SIZE - 90
        for column in range(COLUMNS):
            west = column * SIZE - 180
            cell = box(west, south, west + SIZE, south + SIZE)
            tile = {}
            for name, (tree, weights) in trees.items():
                layer = []
                for index in sorted(tree.query(cell, predicate='intersects')):
                    geometry = tree.geometries[index]
                    clipped = geometry if cell.covers(geometry) else geometry.intersection(cell)
                    layer.extend(encode_feature(part, weights[index]) for part in parts(clipped, geometry.geom_type))
                if layer:
                    tile[name] = layer
                    totals[name] += len(layer)
            if tile:
                tile_id = row * COLUMNS + column
                write_tile(destination / f'{tile_id}.json.gz', {'longitude': west + SIZE / 2, **tile})
                ids.append(tile_id)
    write_tile(destination / 'index.json.gz', ids)
    print(f'{len(ids):,} cells, {dict(totals)}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sources', type=Path, help='directory containing the original ZIP files')
    parser.add_argument('--output', type=Path, default=DATA_DIR / 'lens-atlas')
    args = parser.parse_args()
    build_atlas(args.sources, args.output)
