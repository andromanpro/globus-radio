"""Match explicit city names in radio entries to GeoNames city centres."""

from collections import defaultdict
import re
from unicodedata import combining, normalize


WORDS = re.compile(r'[^\W_]+')
FREQUENCY = re.compile(r'\b\d{2,3}[.,]\d{1,2}\s*(?:fm|мгц|mhz)?\b', re.IGNORECASE)
BRACKETS = re.compile(r'\(([^()]*)\)|\[([^\[\]]*)\]')
SEPARATORS = re.compile(r'\s+[-–—/:]\s+|\|')
CYRILLIC = re.compile(r'[а-яё]', re.IGNORECASE)
LOOKALIKES = str.maketrans('aceopxykmtbhACEOPXYKMTBH', 'асеорхукмтвнАСЕОРХУКМТВН')
SETTLEMENT_SUFFIX = re.compile(r'\s+п\.?\s*г\.?\s*т\.?$', re.IGNORECASE)


def words(text):
    return WORDS.findall(normalize('NFKC', text).casefold().replace('ё', 'е'))


def city_text(text):
    tokens = words(FREQUENCY.sub(' ', text))
    while tokens and tokens[-1] in {'fm', 'мгц', 'mhz'}:
        tokens.pop()
    return ' '.join(tokens)


def locality_key(text):
    if not CYRILLIC.search(text):
        text = ''.join(char for char in normalize('NFKD', text) if not combining(char))
    return ' '.join(words(text))


def broadcast_name(text):
    name = SETTLEMENT_SUFFIX.sub('', BRACKETS.sub(' ', text).strip())
    if CYRILLIC.search(name):
        name = name.translate(LOOKALIKES)
    return ' '.join(words(name))


class CityIndex:
    def __init__(self):
        self.places = {}
        self.aliases = defaultdict(dict)
        self.broadcast_names = defaultdict(lambda: defaultdict(set))
        self.broadcast_primary = defaultdict(lambda: defaultdict(set))
        self.areas = {}
        self.localities = defaultdict(lambda: defaultdict(list))

    def add(self, place, country, aliases, area=None, primary=()):
        self.places[place[0]] = (country, place)
        self.areas[place[0]] = area
        for name in {locality_key(name) for name in primary if name}:
            if len(name) >= 3 and not name.isdecimal():
                self.localities[country][name].append(place[0])
        if country in {'RU', 'KZ', 'BY'}:
            for alias in aliases:
                key = broadcast_name(alias)
                if len(key) >= 3 and not key.isdecimal():
                    self.broadcast_names[country][key].add(place[0])
            for name in primary:
                self.broadcast_primary[country][broadcast_name(name)].add(place[0])
        if not place[5] and place[4] < 10000:
            return
        for alias in aliases:
            name = ' '.join(words(alias))
            if len(name) < 3 or name.isdecimal():
                continue
            index = self.aliases[country]
            previous = index.setdefault(name, place[0])
            if previous != place[0]:
                index[name] = None

    def broadcast_place(self, name, country, region_codes=()):
        key = broadcast_name(name)
        candidates = self.broadcast_names[country].get(key, set())
        if region_codes:
            candidates = {place_id for place_id in candidates if self.areas[place_id] in region_codes}
        preferred = candidates & self.broadcast_primary[country].get(key, set())
        candidates = preferred or candidates
        if len(candidates) == 1:
            return self.places[next(iter(candidates))][1]
        return None

    def estimate(self, name, country, area=''):
        index = self.aliases.get(country)
        if not index:
            return None
        name = FREQUENCY.sub(' ', name)
        bracketed = [left or right for left, right in BRACKETS.findall(name)]
        sections = [*bracketed, *SEPARATORS.split(BRACKETS.sub(' ', name))]
        matches = set()
        for section in sections:
            city = city_text(section.split(',', 1)[0])
            if city not in index:
                continue
            if index[city] is None:
                return None
            matches.add(index[city])
        if len(matches) == 1:
            return self.places[matches.pop()][1]
        if matches:
            return None

        tokens = city_text(BRACKETS.sub(' ', name).split(',', 1)[0]).split()
        area_city = index.get(city_text(area))
        for size in range(min(len(tokens), 5), 0, -1):
            city = ' '.join(tokens[-size:])
            if len(city) >= 6 and city in index:
                place_id = index[city]
                if place_id is not None and area_city in (None, place_id):
                    return self.places[place_id][1]
                return None
        return None
