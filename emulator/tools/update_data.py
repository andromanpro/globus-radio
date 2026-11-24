"""Build the compact map data used by the local emulator."""

import argparse
from collections import Counter
import gzip
from io import BytesIO, TextIOWrapper
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import Request, urlopen
from zipfile import ZipFile

from capital_locations import COUNTRY_INFO, ENGLISH_NAMES, CapitalLocations
from locate_stations import CityIndex
from network_catalog import ADMIN_AREAS, area_codes, network_stations
from station_hints import StationHints, point


DATA_DIR = Path(__file__).resolve().parents[1] / 'public' / 'data'
REGIONAL_STREAMS = Path(__file__).with_name('regional_streams.json')
GEONAMES = 'https://download.geonames.org/export/dump/cities500.zip'
GEONAMES_NAMES = 'https://download.geonames.org/export/dump/alternatenames/'
RADIO_BROWSER = (
    'https://de1.api.radio-browser.info/json/stations/search'
    '?hidebroken=true&is_https=true&limit=100000'
)


def read_source(path, url):
    if path:
        return path.read_bytes()
    request = Request(url, headers={'User-Agent': 'Globusradio/0.2 (local emulator)'})
    with urlopen(request, timeout=45) as response:
        return response.read()


def write_data(filename, data):
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    with NamedTemporaryFile(dir=DATA_DIR, delete=False) as temp:
        temp.write(gzip.compress(payload, compresslevel=8, mtime=0))
    Path(temp.name).replace(DATA_DIR / filename)


def localized_names(raw):
    names = {}
    with ZipFile(BytesIO(raw)) as archive:
        filename = next(name for name in archive.namelist() if name.endswith('.txt') and name != 'readme.txt')
        with TextIOWrapper(archive.open(filename), encoding='utf-8') as lines:
            for line in lines:
                fields = line.rstrip('\n').split('\t')
                if fields[2] != 'ru' or fields[6] == '1' or fields[7] == '1':
                    continue
                place_id = int(fields[1])
                priority = (fields[4] == '1', fields[5] != '1')
                if place_id not in names or priority > names[place_id][0]:
                    names[place_id] = (priority, fields[3])
    return {place_id: name for place_id, (_, name) in names.items()}


def geonames_data(raw, localized):
    settlements = {}
    major = []
    cities = CityIndex()
    with ZipFile(BytesIO(raw)) as archive:
        with TextIOWrapper(archive.open('cities500.txt'), encoding='utf-8') as lines:
            for line in lines:
                fields = line.rstrip('\n').split('\t')
                feature = fields[7]
                if feature in {'PPLH', 'PPLQ', 'PPLW', 'PPLX'}:
                    continue
                lat = round(float(fields[4]), 5)
                lon = round((float(fields[5]) + 180) % 360 - 180, 5)
                population = int(fields[14])
                rank = {'PPLC': 2, 'PPLA': 1}.get(feature, 0)
                place_id = int(fields[0])
                place = [place_id, localized.get(place_id, fields[1]), lat, lon, population, rank]
                aliases = (name for name in fields[3].split(',') if len(name) >= 4 and not name.isupper())
                primary = (place[1], fields[1], fields[2])
                cities.add(place, fields[8], (*primary, *aliases), f'{fields[8]}.{fields[10]}', primary)
                tile = min(int((lat + 90) // 5), 35) * 72 + min(int((lon + 180) // 5), 71)
                settlements.setdefault(tile, []).append(place)
                if rank or population >= 60000:
                    major.append(place)
    return major, settlements, cities


def station_row(row, lat, lon):
    label = next((tag.strip() for tag in row['tags'].split(',') if tag.strip()), '')
    return [row['stationuuid'], row['name'].strip(), row['url_resolved'], label, row['countrycode'], lat, lon,
            int(bool(row['hls'])), row['clickcount'], row['codec']]


def stations_data(rows, cities):
    stations = []
    for row in rows:
        city = None
        coords = point(row)
        if coords is None:
            place = cities.estimate(row['name'], row['countrycode'], row.get('state') or '')
            if place is None:
                continue
            _, city, lat, lon, _, _ = place
            coords = lat, lon
        entry = station_row(row, *coords)
        if city:
            entry.append(city)
        stations.append(entry)
    return stations


def regional_stations(cities, regional_rows):
    stations = []
    for row in regional_rows:
        country, (_, city, lat, lon, _, _) = cities.places[row['placeId']]
        if not row['url'].startswith('https://'):
            raise ValueError(f"Expected an HTTPS stream for {row['name']}")
        network = row.get('networkId')
        station_id = f'network-{network}' if network else row['id']
        station = [station_id, row['name'], row['url'], row['detail'], country, lat, lon,
                   int(bool(row.get('hls'))), 0, '', city, row['source']]
        if hint := row.get('locationHint'):
            station.extend(['region' if network else None, hint])
        elif network:
            station.append('region')
        stations.append(station)
    return stations


def inferred_stations(rows, cities, areas, stations, geography=None):
    ids = {row[0] for row in stations}
    urls = {row[2] for row in stations}
    if (fm_file := DATA_DIR / 'radio-fm.json.gz').exists():
        with gzip.open(fm_file) as file:
            for station in json.load(file)['streams']:
                ids.add(station[0])
                urls.add(station[2])
    locator = StationHints(rows, cities, areas)
    fallback = CapitalLocations(cities, locator, *geography) if geography else None
    programme_by_url = {}
    if fallback and (groups_file := DATA_DIR / 'radio-stream-groups.json.gz').exists():
        with gzip.open(groups_file) as file:
            for group in json.load(file):
                for url, _ in group:
                    programme_by_url[url] = group[0][0]
    added = []
    counts = Counter()
    pending = []
    for row in sorted(rows, key=lambda row: (point(row) is None, -row['clickcount'])):
        id_, url = row['stationuuid'], row['url_resolved']
        if id_ in ids or url in urls:
            continue
        if coords := point(row):
            entry = station_row(row, *coords)
            reason = 'coordinates'
        elif location := locator.estimate(row):
            entry = station_row(row, location.lat, location.lon) + [location.city, None, None, location.reason]
            reason = location.reason
        else:
            pending.append(row)
            continue
        added.append(entry)
        ids.add(id_)
        urls.add(url)
        counts[reason] += 1
    if fallback:
        placed_programmes = {programme_by_url.get(url, url) for url in urls}
        for row in pending:
            id_, url = row['stationuuid'], row['url_resolved']
            programme = programme_by_url.get(url, url)
            if id_ in ids or programme in placed_programmes:
                continue
            country = fallback.country_code(row)
            candidate = row if country == row['countrycode'] else {**row, 'countrycode': country}
            if location := fallback.estimate(candidate):
                added.append(station_row(candidate, location.lat, location.lon)
                             + [location.city, None, None, location.reason])
                ids.add(id_)
                placed_programmes.add(programme)
                counts[location.reason] += 1
        print(f'GeoNames: {len(fallback.capitals):,} national capitals, {len(fallback.centres):,} regional centres')
    print(f'{len(added):,} additional locations')
    for reason, count in counts.most_common():
        print(f'  {reason}: {count:,}')
    return added


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--geonames', type=Path, help='use a downloaded cities500.zip')
    parser.add_argument('--alternate-names', type=Path, action='append', help='use downloaded GeoNames alternate-name archives')
    parser.add_argument('--radio-browser', type=Path, help='use a downloaded search response')
    parser.add_argument('--admin-areas', type=Path, help='use a downloaded GeoNames admin1CodesASCII.txt')
    parser.add_argument('--country-info', type=Path, help='use a downloaded GeoNames countryInfo.txt')
    parser.add_argument('--english-names', type=Path, help='use a downloaded GeoNames alternateNamesV2.zip')
    parser.add_argument('--enrich-stations', action='store_true', help='add inferred locations to the existing radio catalogue')
    args = parser.parse_args()
    name_archives = (path.read_bytes() for path in args.alternate_names) if args.alternate_names else (
        read_source(None, f'{GEONAMES_NAMES}{code}.zip') for code in ('RU', 'BY')
    )
    localized = {}
    for archive in name_archives:
        localized.update(localized_names(archive))
    major, settlements, cities = geonames_data(read_source(args.geonames, GEONAMES), localized)
    rows = [row for row in json.loads(read_source(args.radio_browser, RADIO_BROWSER))
            if (row.get('url_resolved') or '').startswith('https://') and row['name'].strip()]
    region_data = read_source(args.admin_areas, ADMIN_AREAS)
    areas = area_codes(region_data, localized)
    geography = read_source(args.country_info, COUNTRY_INFO), region_data, read_source(args.english_names, ENGLISH_NAMES)
    regional_rows = json.loads(REGIONAL_STREAMS.read_text(encoding='utf-8'))
    located = [row for row in rows if point(row)]
    direct_ids = {row['stationuuid'] for row in located}
    direct_urls = {row['url_resolved'] for row in located}
    regional_rows = [row for row in regional_rows if row.get('locationHint') != 'website-city'
                     or (row['id'] not in direct_ids and row['url'] not in direct_urls)]
    if args.enrich_stations:
        with gzip.open(DATA_DIR / 'radio-geo.json.gz') as file:
            stations = [row for row in json.load(file) if len(row) <= 13]
        known_ids = {row[0] for row in stations}
        known_urls = {row[2] for row in stations}
        website_rows = [row for row in regional_rows if row.get('locationHint') == 'website-city'
                        and row['id'] not in known_ids and row['url'] not in known_urls]
        stations.extend(regional_stations(cities, website_rows))
        print(f'{len(website_rows):,} locations confirmed on broadcaster websites')
        stations.extend(inferred_stations(rows, cities, areas, stations, geography))
        write_data('radio-geo.json.gz', stations)
        raise SystemExit(0)

    stations = stations_data(rows, cities)
    overrides = {row['url'] for row in regional_rows if 'networkId' in row}
    stations = [row for row in stations if row[2] not in overrides]
    inferred = sum(len(row) > 10 for row in stations)
    regional = regional_stations(cities, regional_rows)
    networks = network_stations(cities, areas, regional_rows)
    stations.extend(regional)
    stations.extend(networks)
    stations.extend(inferred_stations(rows, cities, areas, stations, geography))
    write_data('major-places.json.gz', major)
    write_data('settlements.json.gz', settlements)
    write_data('radio-geo.json.gz', stations)
    print(f'{len(stations):,} location records ({inferred:,} estimated by city, '
          f'{len(regional):,} verified regional streams, {len(networks):,} network city bindings), {len(major):,} major places, '
          f'{sum(map(len, settlements.values())):,} settlements')
