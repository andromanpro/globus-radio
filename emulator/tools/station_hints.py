"""Estimate station locations from Radio Browser metadata and known streams."""

from collections import ChainMap, defaultdict
from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt
import re
from urllib.parse import unquote, urlsplit, urlunsplit

from locate_stations import FREQUENCY, locality_key


QUALIFIERS = re.compile(r'[,();/]|\s+[-–—|]\s+')
CITY_PREFIX = re.compile(r'^(?:г\.|город|city of)\s+', re.IGNORECASE)
FORMAT_SUFFIX = re.compile(
    r'\s*[-–—(\[]\s*(?:(?:\d+\s*(?:kbps|kbit/s|k)?)\s*)?'
    r'(?:aac\+?|mp3|flac|ogg|opus|hls)(?:\s*\d+(?:\s*kbps)?)?\s*[)\]]?\s*$', re.IGNORECASE
)
GENERIC = {'online', 'world', 'global', 'internet', 'unknown', 'radio', 'live', 'web', 'fm', 'am', 'n a'}
DIRECTORIES = {'onlineradiobox.com', 'radio.garden', 'radios.com.br', 'radoxo.com', 'streema.com',
               'tunein.com', 'zeno.fm'}
SHARED_PLATFORMS = DIRECTORIES | {'facebook.com', 'instagram.com', 'laut.fm', 'mytuner-radio.com',
                                'radio.net', 'radio.de', 'top-radio.ru', 'youtube.com'}
COUNTRY_ALIASES = {
    'US': {'us', 'usa', 'u s a', 'eua', 'united states', 'united states of america'},
    'GB': {'gb', 'uk', 'u k', 'united kingdom', 'great britain'},
    'RU': {'ru', 'russia', 'russian federation', 'россия', 'рф'},
}
# GeoNames uses FIPS-style subdivision codes in these countries.
REGION_CODES = {
    'AU': {'ACT': '01', 'NSW': '02', 'NT': '03', 'QLD': '04', 'SA': '05', 'TAS': '06', 'VIC': '07', 'WA': '08'},
    'CA': {'AB': '01', 'BC': '02', 'MB': '03', 'NB': '04', 'NL': '05', 'NS': '07', 'ON': '08',
           'PE': '09', 'QC': '10', 'SK': '11', 'YT': '12', 'NT': '13', 'NU': '14'},
    'BR': {'AC': '01', 'AL': '02', 'AP': '03', 'AM': '04', 'BA': '05', 'CE': '06', 'DF': '07', 'ES': '08',
           'MA': '13', 'MT': '14', 'MG': '15', 'MS': '11', 'PA': '16', 'PB': '17',
           'PR': '18', 'PI': '20', 'RJ': '21', 'RN': '22', 'RS': '23', 'RO': '24',
           'RR': '25', 'SC': '26', 'SP': '27', 'SE': '28', 'GO': '29', 'PE': '30', 'TO': '31'},
}


def point(row):
    lat, lon = row.get('geo_lat'), row.get('geo_long')
    if (isinstance(lat, (int, float)) and isinstance(lon, (int, float))
            and -90 <= lat <= 90 and -180 <= lon <= 180 and (lat != 0 or lon != 0)):
        return lat, lon
    return None


def distance_km(left, right):
    lat, lon, other_lat, other_lon = map(radians, (*left, *right))
    delta = sin((other_lat - lat) / 2) ** 2 + cos(lat) * cos(other_lat) * sin((other_lon - lon) / 2) ** 2
    return 12742.0176 * asin(sqrt(min(1, delta)))


def web_url(value):
    try:
        url = urlsplit(value or '')
        return url if url.scheme in {'http', 'https'} and url.hostname else None
    except ValueError:
        return None


def stream_keys(row):
    for value in (row.get('url_resolved'), row.get('url')):
        url = web_url(value)
        if url:
            yield urlunsplit((url.scheme, url.netloc.lower(), url.path, url.query, ''))


def station_version(row):
    url = web_url(row.get('homepage'))
    name = locality_key(FORMAT_SUFFIX.sub('', row['name']))
    if url and len(name) >= 6 and name not in GENERIC:
        return url.hostname.removeprefix('www.'), url.path.rstrip('/'), name
    return None


def shared_page(row):
    page = web_url(row.get('homepage'))
    if not page or any(page.hostname == domain or page.hostname.endswith('.' + domain)
                       for domain in SHARED_PLATFORMS):
        return None
    for value in (row.get('url'), row.get('url_resolved')):
        stream = web_url(value)
        if stream and (page.hostname, page.path) == (stream.hostname, stream.path):
            return None
    return row['countrycode'], page.netloc.lower().removeprefix('www.'), page.path.rstrip('/'), page.query


def city_mentions(text, cities):
    tokens = locality_key(text).split()
    return {
        phrase for start in range(len(tokens)) for end in range(start + 1, min(start + 5, len(tokens)) + 1)
        if len(phrase := ' '.join(tokens[start:end])) >= 4 and phrase not in GENERIC and phrase in cities
    }


@dataclass(frozen=True)
class Location:
    lat: float
    lon: float
    reason: str
    city: str = ''


class StationHints:
    def __init__(self, rows, cities, areas):
        rows = tuple(rows)
        self.cities = cities
        self.regions = defaultdict(set)
        self.streams = defaultdict(set)
        self.versions = defaultdict(set)
        self.shared_pages = {}
        for (country, name), codes in areas.items():
            self.regions[country, locality_key(name)].update(codes)
            if country == 'US':
                for code in codes:
                    self.regions[country, code.split('.', 1)[1].lower()].add(code)
        for country, regions in REGION_CODES.items():
            for key, suffix in regions.items():
                self.regions[country, key.lower()].add(f'{country}.{suffix}')
        by_page = defaultdict(set)
        for row in rows:
            coords = point(row)
            country = row.get('countrycode')
            if not coords or not country:
                continue
            for key in stream_keys(row):
                self.streams[row['countrycode'], key].add(coords)
            if version := station_version(row):
                self.versions[country, version].add(coords)
                if page := shared_page(row):
                    by_page[page].add((version[2], row['url_resolved'], coords))

        for page, witnesses in by_page.items():
            names = {name for name, _, _ in witnesses}
            if len(names) < 2 or len({stream for _, stream, _ in witnesses}) < 2:
                continue
            points = {coords for _, _, coords in witnesses}
            if location := self.from_anchors(points, 'shared-website'):
                self.shared_pages[page] = names, location

        page_regions = defaultdict(set)
        for row in rows:
            if row.get('state') and (page := shared_page(row)) in self.shared_pages:
                page_regions[page].update(self.state_parts(row)[1])
        for page, regions in page_regions.items():
            if len(regions) > 1:
                # Networks can share a homepage across several regional studios.
                self.shared_pages.pop(page)

    def place(self, country, name, regions):
        ids = self.cities.localities[country].get(name, ())
        if not ids and (alias := self.cities.aliases[country].get(name)) is not None:
            ids = (alias,)
        candidates = [i for i in ids if not regions or self.cities.areas[i] in regions]
        if len(candidates) == 1:
            return self.cities.places[candidates[0]][1]
        return None

    def state_parts(self, row):
        country = row['countrycode']
        aliases = {locality_key(row.get('country') or ''), country.lower()} | COUNTRY_ALIASES.get(country, set())
        parts = [locality_key(CITY_PREFIX.sub('', part.strip())) for part in QUALIFIERS.split(row.get('state') or '')]
        parts = [part for part in parts if part and part not in aliases and part not in GENERIC]
        regions = set()
        towns = []
        for part in parts:
            if codes := self.regions.get((country, part)):
                regions.update(codes)
            else:
                towns.append(part)
        if len(towns) == 1:
            town = towns[0]
            tokens = town.split()
            for split in range(1, len(tokens)):
                if codes := self.regions.get((country, ' '.join(tokens[split:]))):
                    prefix = ' '.join(tokens[:split])
                    if self.place(country, prefix, codes):
                        regions.update(codes)
                        town = prefix
                        break
            return town, regions
        return '', regions

    def named_locations(self, row):
        country = row['countrycode']
        places = []
        for section in QUALIFIERS.split(FREQUENCY.sub(' ', row['name'])):
            name = locality_key(section)
            if len(name) >= 4 and name not in GENERIC and (place := self.place(country, name, ())):
                places.append((place[2], place[3]))
        return places

    @staticmethod
    def from_anchors(anchors, reason):
        if not anchors:
            return None
        # A national programme can have several different local origins for one URL.
        if any(distance_km(left, right) > 25 for left in anchors for right in anchors):
            return None
        lat, lon = min(anchors, key=lambda p: (sum(distance_km(p, q) for q in anchors), p))
        return Location(lat, lon, reason)

    def estimate(self, row):
        country = row['countrycode']
        if not country or country not in self.cities.localities:
            return None
        anchors = set().union(*(self.streams.get((country, key), ()) for key in stream_keys(row)))
        version = station_version(row)
        if anchors:
            return self.from_anchors(anchors, 'same-stream')

        town, regions = self.state_parts(row)
        town_place = self.place(country, town, regions) if town else None
        explicit = self.named_locations(row)
        if known := self.versions.get((country, version)):
            guess = self.from_anchors(known, 'same-station')
            if guess and (not town_place or distance_km((guess.lat, guess.lon), town_place[2:4]) <= 50):
                return guess
            return None

        index = ChainMap(self.cities.localities[country], self.cities.aliases[country])
        named = city_mentions(row['name'], index)
        if town_place:
            _, name, lat, lon, population, rank = town_place
            if town in named or rank or population >= 10000:
                if not explicit or min(distance_km((lat, lon), coords) for coords in explicit) <= 50:
                    return Location(lat, lon, 'catalog-city', name)
                return None

        url = web_url(row.get('homepage'))
        if not url or any(url.hostname == domain or url.hostname.endswith('.' + domain) for domain in DIRECTORIES):
            return None
        website = city_mentions(f'{url.hostname} {unquote(url.path[:240])}', index)
        matches = {}
        for name in named & website:
            place = self.place(country, name, regions)
            if place and (place[4] >= 10000 or place[5]):
                matches[place[0]] = (name, place)
        # A multiword city name is more specific than a matching substring of that name.
        possible = [place for name, place in matches.values()
                    if not any(f' {name} ' in f' {other} ' for other, _ in matches.values() if other != name)]
        if len(possible) == 1 and (not town_place or possible[0][0] == town_place[0]):
            _, name, lat, lon, _, _ = possible[0]
            if not explicit or min(distance_km((lat, lon), coords) for coords in explicit) <= 50:
                return Location(lat, lon, 'name-and-website', name)
            return None

        if not possible and version and (shared := self.shared_pages.get(shared_page(row))):
            names, guess = shared
            coords = (guess.lat, guess.lon)
            if (version[2] not in names and (not town_place or distance_km(coords, town_place[2:4]) <= 50)
                    and (not explicit or min(distance_km(coords, place) for place in explicit) <= 50)):
                return guess
        return None
