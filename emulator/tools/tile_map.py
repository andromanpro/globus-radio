"""Clip the Natural Earth 1:10m map into 5-degree cells for the zoomed globe."""

import argparse
import json
from collections import Counter
from functools import lru_cache
from math import floor
from pathlib import Path

from shapely import STRtree, make_valid
from shapely.affinity import translate
from shapely.geometry import LineString, Polygon, box
from shapely.geometry.polygon import orient

from update_data import read_source, write_data


ATLAS = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-10m.json'
SIZE = 5
COLUMNS = 360 // SIZE
ROWS = 180 // SIZE


def polygon_rings(geometry):
    return [geometry['arcs']] if geometry['type'] == 'Polygon' else geometry['arcs']


def unwrap(points):
    line = [points[0]]
    for lon, lat in points[1:]:
        line.append((lon + 360 * round((line[-1][0] - lon) / 360), lat))
    return line


def planar_ring(points):
    line = unwrap(points)
    start, end = line[0], line[-1]
    if abs(end[0] - start[0]) > 180:
        # A ring running all the way around a pole closes along the edge of the map.
        pole = -90 if start[1] < 0 else 90
        line.extend([(end[0], pole), (start[0], pole), start])
    return line


def align_hole(hole, center):
    offset = 360 * round((center - hole[0][0]) / 360)
    return [(lon + offset, lat) for lon, lat in hole]


def world_copies(geometry):
    west, _, east, _ = geometry.bounds
    for zone in range(floor((west + 180) / 360), floor((east + 180) / 360) + 1):
        yield translate(geometry, xoff=-360 * zone) if zone else geometry


def atlas_features(atlas):
    scale_x, scale_y = atlas['transform']['scale']
    offset_x, offset_y = atlas['transform']['translate']

    @lru_cache(maxsize=None)
    def arc(number):
        if number < 0:
            return arc(~number)[::-1]
        x = y = 0
        points = []
        for dx, dy in atlas['arcs'][number]:
            x += dx
            y += dy
            points.append((x * scale_x + offset_x, y * scale_y + offset_y))
        return points

    def ring(numbers):
        points = [point for number in numbers for point in arc(number)[:-1]] + [arc(numbers[-1])[-1]]
        return planar_ring(points)

    land = []
    coastal_arcs = set()
    for geometry in atlas['objects']['land']['geometries']:
        for rings in polygon_rings(geometry):
            shell, *holes = [ring(edge) for edge in rings]
            if len(shell) < 4:
                continue
            longitudes = [lon for lon, _ in shell]
            center = (min(longitudes) + max(longitudes)) / 2
            polygon = Polygon(shell, [align_hole(hole, center) for hole in holes if len(hole) >= 4])
            for part in parts(make_valid(polygon), 'Polygon'):
                land.extend(world_copies(part))
            coastal_arcs.update(number if number >= 0 else ~number for edge in rings for number in edge)

    border_owners = Counter()
    for geometry in atlas['objects']['countries']['geometries']:
        borders = {number if number >= 0 else ~number
                   for polygon in polygon_rings(geometry) for edge in polygon for number in edge}
        border_owners.update(borders)

    def lines(numbers):
        return [shape for number in numbers for shape in world_copies(LineString(unwrap(arc(number))))]

    coastline = lines(sorted(coastal_arcs))
    boundaries = lines(number for number, owners in border_owners.items() if owners > 1)
    return land, coastline, boundaries


def parts(geometry, kind):
    if geometry.is_empty:
        return
    if geometry.geom_type == kind:
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for child in geometry.geoms:
            yield from parts(child, kind)


def coordinates(line):
    return [(round(x, 5), round(y, 5)) for x, y in line.coords]


def land_coordinates(polygon):
    polygon = orient(polygon, sign=-1)
    return [coordinates(polygon.exterior), *(coordinates(hole) for hole in polygon.interiors)]


def tile_map(features):
    trees = [STRtree(geometries) for geometries in features]
    kinds = ['Polygon', 'LineString', 'LineString']
    encode = [land_coordinates, coordinates, coordinates]
    tiles = {}
    for row in range(ROWS):
        south = row * SIZE - 90
        for column in range(COLUMNS):
            west = column * SIZE - 180
            cell = box(west, south, west + SIZE, south + SIZE)
            layers = []
            for tree, kind, to_coordinates in zip(trees, kinds, encode):
                shapes = []
                for index in sorted(tree.query(cell, predicate='intersects')):
                    geometry = tree.geometries[index]
                    clipped = geometry if cell.covers(geometry) else geometry.intersection(cell)
                    shapes.extend(to_coordinates(part) for part in parts(clipped, kind))
                layers.append(shapes)
            if any(layers):
                tiles[row * COLUMNS + column] = layers
    return tiles


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--atlas', type=Path, help='use a downloaded countries-10m.json')
    args = parser.parse_args()
    data = tile_map(atlas_features(json.loads(read_source(args.atlas, ATLAS))))
    write_data('map-10m-tiles.json.gz', data)
    print(f'{len(data):,} map cells')
