"""Place unmatched programmes at their named city or an administrative centre."""

from collections import defaultdict
from io import BytesIO
import re
from zipfile import ZipFile

from locate_stations import locality_key
from station_hints import COUNTRY_ALIASES, Location, distance_km


COUNTRY_INFO = 'https://download.geonames.org/export/dump/countryInfo.txt'
ENGLISH_NAMES = 'https://download.geonames.org/export/dump/alternateNamesV2.zip'
EMPTY_STATES = {'', 'n a', 'none', 'unknown', 'online', 'internet', 'web', 'world', 'global'}
REGION_QUALIFIER = re.compile(r'^(?:state|province|region) of (.+)$|^(.+) (?:state|province|region|oblast|prefecture)$')


def geographical_aliases(raw, wanted, native):
    aliases = defaultdict(set)
    with ZipFile(BytesIO(raw)) as archive:
        with archive.open('alternateNamesV2.txt') as entries:
            for line in entries:
                parts = line.split(b'\t', 3)
                if len(parts) < 4:
                    continue
                _, place, language, rest = parts
                if language != b'en' and language not in native.get(place, ()):
                    continue
                fields = rest.rstrip(b'\r\n').split(b'\t')
                if b'1' in fields[3:5]:
                    continue
                place_id = int(place)
                if place_id in wanted:
                    key = locality_key(fields[0].decode('utf-8'))
                    if key:
                        aliases[place_id].add(key)
    return aliases


def country_records(raw):
    return [line.split('\t') for line in raw.decode('utf-8-sig').splitlines()
            if line.strip() and not line.startswith('#')]


def region_records(raw):
    return {int(row[3]): row[:3] for line in raw.decode('utf-8-sig').splitlines()
            if line.strip() and len(row := line.split('\t')) >= 4}


class CapitalLocations:
    def __init__(self, cities, hints, country_raw, regions_raw, english_raw):
        self.cities = cities
        self.hints = hints
        self.countries = {}
        self.country_names = defaultdict(set)
        self.city_names = defaultdict(set)
        self.region_names = defaultdict(set)
        self.capitals = {}
        self.centres = {}
        self.national = defaultdict(list)
        regions = region_records(regions_raw)
        area_codes = {row[0] for row in regions.values()}
        records = country_records(country_raw)
        country_places = {int(row[16]) for row in records if row[16].isdecimal()}
        languages = {
            row[0]: {name.split('-', 1)[0].encode() for name in row[15].split(',') if name}
            for row in records
        }
        native = {str(place_id).encode(): languages.get(code.split('.', 1)[0], ())
                  for place_id, (code, _, _) in regions.items()}
        aliases = geographical_aliases(english_raw, set(cities.places) | set(regions) | country_places, native)

        for place_id, (country, place) in cities.places.items():
            for alias in aliases.get(place_id, ()):
                self.city_names[country, alias].add(place_id)
            area = cities.areas[place_id]
            if place[5] == 2:
                self.national[country].append(place)
            if area not in area_codes:
                continue
            old = self.centres.get(area)
            if not old or self.seat_priority(place) > self.seat_priority(old):
                self.centres[area] = place
        for place_id, (code, name, ascii_name) in regions.items():
            country = code.split('.', 1)[0]
            for key in {locality_key(name), locality_key(ascii_name), *aliases.get(place_id, ())}:
                self.region_names[country, key].add(code)

        for row in records:
            code, alpha3, _, _, country, capital = row[:6]
            self.countries[code] = (country, capital)
            alternate = aliases.get(int(row[16]), ()) if row[16].isdecimal() else ()
            for name in (code, alpha3, country, *alternate, *COUNTRY_ALIASES.get(code, ())):
                self.country_names[locality_key(name)].add(code)
            key = locality_key(capital)
            if not key:
                continue
            names = self.places(code, key)
            actual = [place for place in names if place[5] == 2]
            national = self.national[code]
            if len(actual) == 1:
                self.capitals[code] = actual[0]
            elif len(names) == 1:
                self.capitals[code] = names[0]
            elif len(national) == 1:
                self.capitals[code] = national[0]

    @staticmethod
    def seat_priority(place):
        return place[5] == 1, place[5] == 2, place[4], -place[0]

    def country_code(self, row):
        code = (row.get('countrycode') or '').upper()
        if code in self.countries:
            return code
        names = self.country_names.get(locality_key(row.get('country') or ''), ())
        if len(names) == 1:
            return next(iter(names))
        return ''

    def places(self, country, name, areas=()):
        ids = set(self.cities.localities[country].get(name, ()))
        ids.update(self.city_names.get((country, name), ()))
        if not ids and (alias := self.cities.aliases[country].get(name)) is not None:
            ids.add(alias)
        return [self.cities.places[i][1] for i in ids if not areas or self.cities.areas[i] in areas]

    def regions(self, country, name):
        return self.region_names.get((country, name)) or self.hints.regions.get((country, name), set())

    @staticmethod
    def location(place, reason):
        _, name, lat, lon, _, _ = place
        return Location(lat, lon, reason, name)

    def estimate(self, row):
        country = row['countrycode']
        if not country:
            return None
        state = locality_key(row.get('state') or '')
        if state in EMPTY_STATES:
            if capital := self.capitals.get(country):
                return self.location(capital, 'country-capital')
            return None

        region = self.regions(country, state)
        qualifier = REGION_QUALIFIER.fullmatch(state)
        if not region and qualifier:
            region = self.regions(country, qualifier[1] or qualifier[2])
        city = [] if qualifier and region else self.places(country, state)
        if region and city:
            # Ignore small homonyms in other states when the field names a first-level region.
            city = [place for place in city if self.cities.areas[place[0]] in region or place[4] >= 100000]
        if not city and not region:
            town, region = self.hints.state_parts(row)
            city = self.places(country, town, region) if town else []
            if town and not city:
                return None

        if city and region:
            named = self.hints.named_locations(row)
            cities_named = [place for place in city if any(distance_km(place[2:4], coords) <= 5 for coords in named)]
            if len(cities_named) == 1:
                return self.location(cities_named[0], 'catalog-city')
            code = (row.get('iso_3166_2') or '').upper()
            prefix, _, suffix = code.partition('-')
            regions_from_iso = self.regions(country, suffix.lower()) | {f'{country}.{suffix}'}
            if prefix == country and (matching := region & regions_from_iso):
                region = matching
            elif len(city) == 1 and any(
                    (seat := self.centres.get(code)) and seat[0] == city[0][0] for code in region):
                return self.location(city[0], 'catalog-city')
            else:
                return None
        elif len(city) == 1:
            named = self.hints.named_locations(row)
            if not named or min(distance_km(city[0][2:4], coords) for coords in named) <= 50:
                return self.location(city[0], 'catalog-city')
            return None
        elif city:
            return None

        if len(region) == 1 and (centre := self.centres.get(next(iter(region)))):
            return self.location(centre, 'regional-capital' if centre[5] else 'regional-largest-city')
        return None
