"""Build bilingual search metadata for the emulator's existing GeoNames place records."""

import argparse
import gzip
from io import BytesIO
import json
from pathlib import Path
import re
from zipfile import ZipFile

from network_catalog import ADMIN_AREAS
from update_data import DATA_DIR, GEONAMES, read_source, write_data


def build(cities_raw, areas_raw, places):
    areas = {}
    for line in areas_raw.decode('utf-8-sig').splitlines():
        fields = line.split('\t')
        if len(fields) >= 3:
            areas[fields[0]] = fields[2] or fields[1]

    names = {}
    with ZipFile(BytesIO(cities_raw)) as archive, archive.open('cities500.txt') as rows:
        for row in rows:
            fields = row.decode('utf-8').rstrip('\r\n').split('\t')
            place_id = int(fields[0])
            if place_id not in places:
                continue
            local = places[place_id]
            english = fields[2] if re.search(r'[А-Яа-яЁё]', local) else ''
            region = fields[10] if f'{fields[8]}.{fields[10]}' in areas else ''
            alternates = [name for name in fields[3].split(',') if name not in (local, english)
                          and 2 <= len(name) <= 72 and re.search(r'[А-Яа-яЁё]', name)][:6]
            names[place_id] = [fields[8], region, english, *alternates]
    return {'names': names, 'regions': areas}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--geonames', type=Path, help='local cities500.zip')
    parser.add_argument('--admin-areas', type=Path, help='local admin1CodesASCII.txt')
    args = parser.parse_args()
    with gzip.open(DATA_DIR / 'settlements.json.gz') as source:
        places = {row[0]: row[1] for cell in json.load(source).values() for row in cell}
    data = build(read_source(args.geonames, GEONAMES), read_source(args.admin_areas, ADMIN_AREAS), places)
    write_data('city-search.json.gz', data)
    print(f'{len(data["names"]):,} place records with search metadata')
