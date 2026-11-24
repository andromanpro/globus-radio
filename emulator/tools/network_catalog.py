"""Attach broadcaster-published city lists to streams and GeoNames localities."""

from collections import Counter, defaultdict
import json
from pathlib import Path

from locate_stations import BRACKETS, words


NETWORK_CITIES = Path(__file__).with_name('network_cities.json')
ADMIN_AREAS = 'https://download.geonames.org/export/dump/admin1CodesASCII.txt'
AREA_WORDS = {'oblast', 'krai', 'republic', 'region', 'область', 'край', 'республика', 'округ', 'автономный'}


def area_key(text):
    return ' '.join(token for token in words(text) if token not in AREA_WORDS)


def area_codes(raw, localized):
    aliases = defaultdict(set)
    for line in raw.decode('utf-8').splitlines():
        code, name, ascii_name, place_id = line.split('\t')
        country = code.split('.', 1)[0]
        for alias in (name, ascii_name, localized.get(int(place_id), '')):
            for part in (alias, BRACKETS.sub(' ', alias)):
                key = area_key(part)
                if key:
                    aliases[country, key].add(code)
    return aliases


def network_stations(cities, areas, regional_rows):
    overrides = {(row['networkId'], row['placeId']) for row in regional_rows if 'networkId' in row}
    stations = []
    for network in json.loads(NETWORK_CITIES.read_text(encoding='utf-8')):
        places = {}
        skipped = []
        common = network['stream']
        for location in network['cities']:
            country = location['country']
            qualifier = BRACKETS.search(location['name'])
            area = location.get('region') or (next(part for part in qualifier.groups() if part is not None) if qualifier else '')
            region = areas.get((country, area_key(area)), ())
            place = cities.broadcast_place(location['name'], country, region)
            if place is None:
                skipped.append(location['name'])
                continue
            if (network['id'], place[0]) not in overrides:
                places[place[0]] = (country, place, location)

        links = Counter(location.get('stream') or common for location in network['cities'])
        for country, (_, city, lat, lon, _, _), location in places.values():
            url = location.get('stream') or common
            kind = 'region' if url != common and links[url] == 1 else 'network'
            description = 'Региональный эфир' if kind == 'region' else 'Сетевой эфир'
            detail = ' · '.join(filter(None, (location.get('frequency'), description)))
            stations.append([f"network-{network['id']}", network['name'], url, detail, country, lat, lon, 0, 0, '',
                             city, location.get('source') or network['source'], kind])
        print(f"{network['name']}: {len(places):,} city bindings, {len(skipped):,} without an unambiguous match")
        if skipped:
            print('  ' + ', '.join(skipped[:12]))
    return stations
