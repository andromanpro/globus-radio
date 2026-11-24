"""Join regulator transmitter exports to playable Radio Browser streams."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import csv
from dataclasses import dataclass
from io import BytesIO, TextIOWrapper
import json
from math import asin, cos, isfinite, radians, sin, sqrt
from pathlib import Path
import re
import unicodedata
from urllib.parse import quote
from urllib.request import urlopen
from zipfile import ZipFile

from update_data import RADIO_BROWSER, read_source, write_data


CANADA = 'https://www.ic.gc.ca/engineering/SMS_TAFL_Files/TAFL_Broadcast-LTAF_RadioDiff.zip'
AUSTRALIA = 'https://www.acma.gov.au/sites/default/files/2026-10/BroadcastTransmitterExcel.zip'
BRAZIL = 'https://s3.mcom.gov.br/radcom/SCR_DADOS_RADIODIFUSAO_TV_GTVD_RTV_RTVD_FM_OM.csv'
BRAZIL_LICENSES = 'https://s3.mcom.gov.br/radcom/SCR_DADOS_LIC_TV_GTVD_RTV_RTVD_FM_OM.csv'
FCC_CDBS = 'https://transition.fcc.gov/Bureaus/MB/Databases/cdbs/'
FCC_CONTOURS = 'https://transition.fcc.gov/bureaus/mb/databases/map/FM_service_contour_current.zip'
FCC_API = 'https://geo.fcc.gov/api/contours/fm/callsign/'
OFCOM = ('https://web.archive.org/web/20261015084753id_/https://www.ofcom.org.uk/siteassets/'
         'resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsvhf.csv')
CZECH = 'https://ctu.gov.cz/en/vyhledavaci-databaze/prehled-rozhlasovych-vysilacu/opravneni'
CZECH_CSV = CZECH + '?show_all=0&export=1&use_pager=0&format=csv'
SWISS = ('https://data.geo.admin.ch/ch.bakom.radio-fernsehsender/radio-fernsehsender/'
         'radio-fernsehsender_2056_de.json')
REFERENCES = Path(__file__).with_name('fm_reference.json')
REGIONAL_STREAMS = Path(__file__).with_name('regional_streams.json')
SOURCES = {
    'CA': ('ISED', 'https://ised-isde.canada.ca/site/spectrum-management-system/en/broadcasting-services/download-broadcasting-data-files'),
    'AU': ('ACMA · CC BY 2.5 AU', 'https://www.acma.gov.au/list-transmitters-licence-broadcast'),
    'BR': ('MCom / Anatel', 'https://www.gov.br/mcom/pt-br/acesso-a-informacao/dados-abertos/bases-abertas'),
    'US': ('FCC', 'https://geo.fcc.gov/api/contours/'),
    'GB': ('Ofcom · OGL', 'https://www.ofcom.org.uk/tv-radio-and-on-demand/coverage-and-transmitters/radio-tech-parameters'),
    'CZ': ('ČTÚ', CZECH),
    'CH': ('BAKOM', 'https://www.bakom.admin.ch/en/location-of-radio-transmitters'),
}
OFCOM_REGIONS = {'GB', 'IM', 'JE', 'GG'}

CALL_PATTERN = {
    'CA': re.compile(r'\b(C(?:B[A-Z]{1,2}|[FHIJKL][A-Z]{2}))(?:[ -]?FM)?(?:[ -]?([0-9]{1,2}))?\b'),
    'AU': re.compile(r'\b[1-8][A-Z]{2,5}\b'),
    'BR': re.compile(r'\bZY[A-Z][0-9]{3}\b'),
    'US': re.compile(r'\b[KW][A-Z]{2,3}\b'),
}
FREQUENCY = re.compile(r'(?<![\d.])(?:8[7-9]|9\d|10[0-8])[,.]\d(?!\d)')


def number(value):
    try:
        result = float(str(value).strip().replace(',', '.'))
        return result if isfinite(result) else 0
    except ValueError:
        return 0


def key(value):
    text = unicodedata.normalize('NFKD', value.casefold())
    return ' '.join(re.findall(r'[^\W_]+', ''.join(x for x in text if not unicodedata.combining(x))))


def call_keys(value, country):
    # Use explicit upper-case tokens, and keep relay suffixes where the directory supplies them.
    for match in CALL_PATTERN[country].finditer(value):
        if country == 'CA':
            base, relay = match.groups()
            yield f'{base}-{relay}' if relay else base
        else:
            yield match[0]


def great_circle(lat, lon, other_lat, other_lon):
    lat, lon, other_lat, other_lon = map(radians, (lat, lon, other_lat, other_lon))
    h = sin((other_lat - lat) / 2) ** 2 + cos(lat) * cos(other_lat) * sin((other_lon - lon) / 2) ** 2
    return 12742.0176 * asin(sqrt(min(1, h)))


def valid_point(lat, lon):
    return -90 <= lat <= 90 and -180 <= lon <= 180 and (lat != 0 or lon != 0)


def coverage_km(erp_kw, height_m):
    if erp_kw <= 0 or height_m <= 0:
        return 0
    # 60 dBµV/m with a 12 dB loss allowance, capped by the 4/3-Earth radio horizon.
    # Height above ground substitutes for effective height where the registry supplies only AGL.
    field_limit = 10 ** ((106.92 - 60 - 12) / 20) * sqrt(erp_kw)
    horizon = 4.12 * (sqrt(height_m) + sqrt(1.5))
    return round(min(field_limit, horizon), 1)


@dataclass(frozen=True)
class Transmitter:
    country: str
    call: str
    city: str
    lat: float
    lon: float
    mhz: float
    erp: float = 0
    height: float = 0
    state: str = ''
    brand: str = ''
    source: tuple | None = None
    stream_id: str | None = None
    contour: dict | None = None
    estimate: str | None = None


def canada(raw):
    with ZipFile(BytesIO(raw)) as archive:
        filename = next(name for name in archive.namelist() if name.endswith('.csv'))
        with TextIOWrapper(archive.open(filename), encoding='utf-8-sig', errors='replace') as file:
            for row in csv.reader(file):
                # ISED SMS Authorization Data Extract, field descriptions 1–61.
                mhz = number(row[1])
                if not 87.5 <= mhz <= 108 or row[0] != 'TX' or row[56] != 'OP' or row[35] != 'BC':
                    continue
                if row[60].strip():
                    continue
                call = next(call_keys(row[33], 'CA'), '')
                erp_dbw = row[14].strip()
                erp = max(number(row[58]), number(row[59])) / 1000
                if not erp and erp_dbw:
                    erp = 10 ** ((number(erp_dbw) - 30) / 10)
                yield Transmitter('CA', call, row[31], number(row[40]), number(row[41]),
                                  mhz, erp, number(row[28]), row[39])


def dms(value):
    match = re.fullmatch(r'(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)([NSEW])', str(value).strip())
    if not match:
        return 0
    degrees, minutes, seconds, direction = match.groups()
    return (int(degrees) + int(minutes) / 60 + float(seconds) / 3600) * (-1 if direction in 'SW' else 1)


def australia(raw):
    from openpyxl import load_workbook

    with ZipFile(BytesIO(raw)) as archive:
        filename = next(name for name in archive.namelist() if name.endswith('.xlsx'))
        workbook = load_workbook(BytesIO(archive.read(filename)), read_only=True, data_only=True)
    try:
        rows = workbook['FM'].values
        header = next(rows)
        for values in rows:
            row = dict(zip(header, values))
            if row['Status'] != 'Issued':
                continue
            mhz = number(row['Frequency(MHz)'])
            if 87.5 <= mhz <= 108:
                yield Transmitter('AU', str(row['Callsign'] or '').strip(), str(row['Area Served'] or ''),
                                  dms(row['Latitude']), dms(row['Longitude']), mhz,
                                  number(row['Maximum ERP (W)']) / 1000, number(row['Antenna Height (m)']),
                                  str(row['State'] or ''))
    finally:
        workbook.close()


def brazil(raw, licenses):
    def records(data):
        return csv.DictReader(TextIOWrapper(BytesIO(data), encoding='cp1252', errors='replace'), delimiter=';')

    sites = {}
    for row in records(licenses):
        if row['IndStatusEstacao'] == 'L' and row['CodSituacaoLicenca'] != 'N':
            point = number(row['MedLatitudeDecimal']), number(row['MedLongitudeDecimal'])
            if valid_point(*point):
                sites[row['IdtEstacao'], row['NomeIndicativo']] = point
    for row in records(raw):
        if row['SiglaServico'] not in {'FM', 'RTRFM'} or row['Status_descricao'] != 'Canal Licenciado':
            continue
        mhz = number(row['licenca_frequency'])
        call = row['licenca_estacao_NomeIndicativo'].strip()
        point = sites.get((row['IdtEstacao'], call))
        if point and 87.5 <= mhz <= 108:
            yield Transmitter('BR', call, row['municipio_NomeMunicipio'], *point, mhz,
                              number(row['licenca_erp']), number(row['licenca_antena_principal_MedHCI']),
                              row['municipio_SiglaUF'], row['licenca_entidade_NomeFantasia'])


def ofcom(raw):
    rows = csv.DictReader(TextIOWrapper(BytesIO(raw), encoding='cp1252'))
    for row in rows:
        mhz = number(row['Frequency'])
        if not 87.5 <= mhz <= 108:
            continue
        lat, lon = number(row['Lat']), number(row['Long'])
        country = 'GB'
        if row['Licence '].startswith('IOM'):
            country = 'IM'
        elif 48.9 <= lat <= 49.8 and -2.9 <= lon <= -1.8:
            country = 'JE' if lat < 49.3 else 'GG'
        erp = max(number(row[field].replace(',', '')) for field in ('In-UseERP/HP', 'In-Use ERP/VP'))
        brand = {'BBC_Ulst': 'BBC Radio Ulster', 'BBC_Fyle': 'BBC Radio Foyle',
                 'BBCSussx': 'BBC Radio Sussex', 'BBCSurry': 'BBC Radio Surrey'}.get(row['RDS PS'], row['Station'])
        yield Transmitter(country, row['Licence '], row['Site'], lat, lon, mhz, erp,
                          number(row['In-Use Aerial Ht']), row['Area'], brand, SOURCES['GB'])


def czechia(raw):
    rows = csv.DictReader(TextIOWrapper(BytesIO(raw), encoding='utf-8-sig'))
    for row in rows:
        mhz = number(row['Frequency MHz'])
        if row['Type'] == 'FM Final Lic' and 87.5 <= mhz <= 108:
            yield Transmitter('CZ', row['ANT_ID'], row['Transmitter'], number(row['Latitude']),
                              number(row['Longitude']), mhz, number(row['ERP W']) / 1000,
                              brand=row['Program'])


def swiss_point(easting, northing):
    # swisstopo's approximate LV95 to WGS84 transformation, result in degrees.
    east = (easting - 2600000) / 1000000
    north = (northing - 1200000) / 1000000
    lat = (16.9023892 + 3.238272 * north - 0.270978 * east ** 2 - 0.002528 * north ** 2
           - 0.0447 * east ** 2 * north - 0.0140 * north ** 3)
    lon = 2.6779094 + 4.728982 * east + 0.791484 * east * north + 0.1306 * east * north ** 2 - 0.0436 * east ** 3
    return lat * 100 / 36, lon * 100 / 36


def switzerland(raw):
    for entry in json.loads(raw)['features']:
        props = entry['properties']
        programs = (props.get('program') or '').split(',')
        frequencies = (props.get('freqchan') or '').split(',')
        services = (props.get('service') or '').split(',')
        if not len(programs) == len(frequencies) == len(services):
            continue
        point = swiss_point(*entry['geometry']['coordinates'])
        for program, frequency, service in zip(programs, frequencies, services):
            mhz = number(frequency.removesuffix(' MHz'))
            if service == 'RADIO' and 87.5 <= mhz <= 108:
                yield Transmitter('CH', props['code'], props['name'], *point, mhz, brand=program.strip())


def pipe_rows(raw):
    with ZipFile(BytesIO(raw)) as archive:
        with TextIOWrapper(archive.open(archive.namelist()[0]), encoding='cp1252', errors='replace') as file:
            yield from csv.reader(file, delimiter='|', quoting=csv.QUOTE_NONE)


def contour_polygon(ring, center_lon):
    projected = [((lon - center_lon + 180) % 360 - 180, lat) for lon, lat in ring]
    signed = sum(a * d - b * c for (a, b), (c, d) in zip(projected, projected[1:]))
    if signed > 0:
        ring.reverse()
    return {'type': 'MultiPolygon', 'coordinates': [[ring]]}


def fcc_facilities(raw):
    licensed = {}
    for row in pipe_rows(raw):
        mhz = number(row[9])
        if row[8] == 'US' and row[10] in {'FM', 'FL'} and row[16] == 'LICEN' and 87.5 <= mhz <= 108:
            licensed[row[14]] = (row[5].strip(), row[7].title(), row[11], mhz, row[6])
    return licensed


def save_snapshot(path, data):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data), encoding='utf-8')
    temporary.replace(path)


def fcc_api_snapshot(path, facilities, directory):
    snapshot = json.loads(path.read_bytes()) if path.exists() else []
    cached = {row[0] for row in snapshot}
    candidates = {}
    for facility, (call, city, state, mhz, _) in facilities.items():
        if call not in cached and directory.match(Transmitter('US', call.split('-')[0], city, 0, 0, mhz, state=state)):
            candidates[call] = facility, city, state
    if not candidates:
        return snapshot

    def download(item):
        call, (facility, city, state) = item
        try:
            with urlopen(FCC_API + quote(call) + '.json', timeout=15) as response:
                result = json.load(response)
        except (OSError, ValueError) as error:
            return call, facility, city, state, str(error)
        return call, facility, city, state, {'features': [
            {'properties': entry['properties']} for entry in result.get('features', ())
        ]}

    print(f'Looking up {len(candidates)} US callsigns in FCC Contours API', flush=True)
    with ThreadPoolExecutor(max_workers=5) as pool:
        snapshot.extend(pool.map(download, candidates.items()))
    if not any(isinstance(row[-1], dict) and row[-1]['features'] for row in snapshot):
        raise ValueError('The FCC Contours API returned no station information')
    save_snapshot(path, snapshot)
    return snapshot


def united_states(facilities, engineering, contours, snapshot):
    applications = {}
    for row in pipe_rows(engineering):
        facility = facilities.get(row[20])
        # Only the archived current main license, with the same station channel.
        if facility and row[19] == 'C' and row[21] == 'LIC' and row[7] in {'FM', 'FL'} and row[62] == facility[4]:
            call, city, state, mhz, _ = facility
            applications[row[6]] = (call, city, state, mhz, None)
    for call, facility, city, state, result in snapshot:
        if not isinstance(result, dict):
            continue
        for feature in result.get('features', ()):
            props = feature['properties']
            if (props['country'] != 'US' or props['service'] not in {'FM', 'FL'}
                    or props['callsign'] != call or str(props['facility_id']) != facility):
                continue
            mhz = round(87.9 + (props['channel'] - 200) * 0.2, 1)
            if 87.5 <= mhz <= 108:
                site = props['station_lat'], props['station_lon']
                applications[str(props['application_id'])] = (call, city, state, mhz, site)
    for row in pipe_rows(contours):
        if len(row) < 365 or row[1].strip() not in {'FM', 'FL'}:
            continue
        facility = applications.get(row[0].strip())
        if not facility:
            continue
        call, city, state, mhz, site = facility
        try:
            lat, lon = map(float, row[4].split(','))
            # The FCC supplies a boundary point for each degree of bearing.
            ring = [list(reversed(tuple(map(float, point.split(','))))) for point in row[5:365:5]]
        except ValueError:
            continue
        if (len(ring) != 72 or not all(valid_point(y, x) for x, y in ring)
                or (site and great_circle(lat, lon, *site) > 1)):
            continue
        contour = None
        if len({tuple(point) for point in ring}) >= 3:
            ring.append(ring[0])
            contour = contour_polygon(ring, lon)
        yield Transmitter('US', call.split('-')[0], city, lat, lon, mhz,
                          state=state, contour=contour)


def ofcom_name(value):
    value = re.sub(r'\s*\((?:fm|mp3|aac\+?|\d+\s*(?:kbps|kbit/s|mp3|aac)(?:\s+(?:mp3|aac\+?))?)\)', '', value,
                   flags=re.IGNORECASE)
    value = key(FREQUENCY.sub(' ', value))
    if value.startswith('bbc '):
        value = value.removeprefix('bbc ').removeprefix('radio ')
        return 'bbc ' + {'one': '1', 'two': '2', 'three': '3', 'four': '4'}.get(value, value)
    return ' '.join(token for token in value.split() if token != 'fm')


def canonical_brand(value):
    tokens = key(FREQUENCY.sub(' ', value)).split()
    return ' '.join(token for token in tokens if token not in {'radio', 'fm', 'am', 'ltda', 'web', 'de', 'da', 'do'})


def program_name(value, country):
    value = ofcom_name(value)
    if country == 'CZ':
        value = value.replace('cesky rozhlas ', 'cro ').replace('cro region ', 'cro ')
        value = re.sub(r' (?:128mp3|aac|mp3|actve|flac|zive|128)$', '', value)
        value = ' '.join(token for token in value.split() if token != 'radio')
        return {'cro 1': 'cro radiozurnal', 'cro 2': 'cro dvojka', 'cro 3': 'cro vltava',
                'impuls raaaaradio': 'impuls', 'color music': 'color', 'dance cz': 'dance'}.get(value, value)
    return value


class Directory:
    def __init__(self, response):
        self.by_id = {}
        self.by_call = defaultdict(list)
        self.by_frequency = defaultdict(list)
        self.by_brand = defaultdict(list)
        self.ofcom_names = defaultdict(list)
        self.program_names = defaultdict(list)
        self.australian_networks = {}
        for row in sorted(json.loads(response), key=lambda row: row.get('clickcount', 0), reverse=True):
            name = row.get('name', '').strip()
            url = row.get('url_resolved') or ''
            if not name or not url.startswith('https://'):
                continue
            country = row.get('countrycode', '')
            self.by_id[row['stationuuid']] = row
            if country in CALL_PATTERN:
                for call in set(call_keys(name, country)):
                    self.by_call[country, call].append(row)
            if country == 'BR':
                brand = canonical_brand(name)
                if len(brand) >= 5:
                    self.by_brand[brand].append(row)
                for frequency in set(FREQUENCY.findall(name)):
                    self.by_frequency[number(frequency)].append(row)
            elif country == 'AU':
                self.add_australian_network(row)
            elif country in OFCOM_REGIONS:
                self.add_ofcom_name(row)
            elif country in {'CZ', 'CH'}:
                program = program_name(name, country)
                if country == 'CZ' and program.startswith('cro ') and 'radiozurnal_sport' in url and 'sport' not in program:
                    continue
                self.program_names[country, program].append(row)

        for row in json.loads(REGIONAL_STREAMS.read_text(encoding='utf-8')):
            self.add_stream(row)

    def add_stream(self, row):
        stream = {
            'stationuuid': row['id'], 'name': row['name'], 'countrycode': row.get('country', 'RU'),
            'url_resolved': row['url'],
        }
        self.by_id[row['id']] = stream
        country = stream['countrycode']
        if country in CALL_PATTERN:
            for call in set(call_keys(stream['name'], country)):
                self.by_call[country, call].insert(0, stream)
        if country in OFCOM_REGIONS:
            self.add_ofcom_name(stream, verified=True)

    def add_ofcom_name(self, row, verified=False):
        name = ofcom_name(row['name'])
        if len(name) < 3:
            return
        if name.startswith('bbc ') and 'bbci.co.uk/' not in row['url_resolved']:
            return
        choices = self.ofcom_names[row['countrycode'], name]
        if verified:
            choices.insert(0, row)
        else:
            choices.append(row)

    def match_ofcom(self, transmitter):
        name = ofcom_name(transmitter.brand)
        area = ofcom_name(transmitter.state)
        # Shared commercial brands can carry different regional programmes.
        choices = self.ofcom_names.get((transmitter.country, f'{name} {area}'), ())
        if not choices and name not in {'heart', 'capital', 'smooth radio', 'nation radio', 'greatest hits radio',
                                       'hits radio', 'more radio', 'energy radio'}:
            choices = (self.ofcom_names.get((transmitter.country, name), ())
                       or self.ofcom_names.get(('GB', name), ()))
        for row in choices:
            frequencies = {number(value) for value in FREQUENCY.findall(row['name'])}
            if not frequencies or transmitter.mhz in frequencies:
                return row

    def add_australian_network(self, row):
        url = row['url_resolved']
        if 'streaming.abc-cdn.net.au/' in url:
            match = re.search(r'/hls/(triplej|classicfm|rn)(nsw|nt|qld|sa|tas|vic|wa|act)\.m3u8', url)
            if match:
                network, region = match.groups()
                self.australian_networks.setdefault((network, region.upper()), row)
            if '/hls/newsradio.m3u8' in url:
                self.australian_networks.setdefault(('newsradio', ''), row)
        if 'sbs-ice.streamguys1.com/sbs1-sbs-web' in url:
            self.australian_networks.setdefault(('sbs', ''), row)

    def match(self, transmitter):
        if transmitter.stream_id:
            return self.by_id.get(transmitter.stream_id)
        country, call = transmitter.country, transmitter.call
        if country in OFCOM_REGIONS:
            return self.match_ofcom(transmitter)
        if country in {'CZ', 'CH'}:
            program = program_name(transmitter.brand, country)
            for row in self.program_names.get((country, program), ()):
                frequencies = {number(value) for value in FREQUENCY.findall(row['name'])}
                if not frequencies or transmitter.mhz in frequencies:
                    return row
            return None
        candidates = self.by_call.get((country, call), ())
        relay = False
        if country == 'CA' and not candidates and '-' in call:
            candidates = self.by_call.get((country, call.split('-')[0]), ())
            relay = True
        if candidates:
            candidates = [row for row in candidates if not re.search(
                r'\b(?:HD[- ]?[2-9]|AM|Q2 Stream)\b', row['name'], re.IGNORECASE)]
            for row in candidates:
                frequencies = {number(value) for value in FREQUENCY.findall(row['name'])}
                if transmitter.mhz in frequencies:
                    return row
            for row in candidates:
                if not FREQUENCY.search(row['name']):
                    return row
            if relay and candidates:
                return candidates[0]
        if country == 'AU':
            network = {'JJJ': 'triplej', 'ABCFM': 'classicfm', 'ABCRN': 'rn', 'PNN': 'newsradio',
                       'SBSFM': 'sbs'}.get(call[1:])
            return (self.australian_networks.get((network, transmitter.state))
                    or self.australian_networks.get((network, '')))
        if country == 'BR':
            return self.match_brazil(transmitter)

    def match_brazil(self, transmitter):
        city = key(transmitter.city)
        options = {}
        for row in self.by_frequency.get(transmitter.mhz, ()):
            state = key(row.get('state') or '')
            name = key(row['name'])
            if city and (city == state or f' {city} ' in f' {name} '):
                options[row['url_resolved']] = row
        if len(options) == 1:
            return next(iter(options.values()))
        brand = canonical_brand(transmitter.brand)
        for row in self.by_brand.get(brand, ()):
            frequencies = {number(value) for value in FREQUENCY.findall(row['name'])}
            if frequencies and transmitter.mhz not in frequencies:
                continue
            lat, lon = row.get('geo_lat'), row.get('geo_long')
            if (key(row.get('state') or '') == city and city
                    or isinstance(lat, (int, float)) and isinstance(lon, (int, float))
                    and great_circle(lat, lon, transmitter.lat, transmitter.lon) <= 15):
                return row


def references(directory):
    data = json.loads(REFERENCES.read_text(encoding='utf-8'))
    for stream in data.get('streams', ()):
        directory.add_stream(stream)
    if bbc := data.get('bbc_streams'):
        for name, slug in bbc['stations'].items():
            directory.add_stream({'id': slug, 'name': name, 'country': 'GB', 'url': bbc['url'].format(slug)})
    for country, stream, mhz, lat, lon, erp, height, city, source, *power in data['transmitters']:
        yield Transmitter(country, '', city, lat, lon, mhz, erp, height,
                          stream_id=stream, source=tuple(data['sources'][source]),
                          estimate=power[0] if power else None)


def make_catalog(transmitters, directory):
    sources, streams, rows = {}, {}, []
    counts, matched = Counter(), Counter()
    seen = set()
    # Process the richer coverage types first if two candidates describe the same facility.
    for tx in transmitters:
        if not valid_point(tx.lat, tx.lon):
            continue
        signature = tx.country, tx.call or tx.stream_id, tx.mhz, round(tx.lat, 5), round(tx.lon, 5)
        if signature in seen:
            continue
        seen.add(signature)
        counts[tx.country] += 1
        stream = directory.match(tx)
        if not stream:
            continue
        source = tx.source or SOURCES[tx.country]
        source_index = sources.setdefault(source, len(sources))
        row = [stream['stationuuid'], stream['name'].strip(), stream['url_resolved'], tx.country,
               int(bool(stream.get('hls')) or '.m3u8' in stream['url_resolved']), stream.get('clickcount', 0)]
        stream_index = streams.setdefault(tuple(row), len(streams))
        maximum = coverage_km(tx.erp, tx.height)
        if tx.contour:
            rings = [ring for polygon in tx.contour['coordinates'] for ring in polygon]
            maximum = max(great_circle(tx.lat, tx.lon, lat, lon) for ring in rings for lon, lat in ring)
            maximum = round(maximum + 0.15, 1)
        location = [stream_index, round(tx.lat, 6), round(tx.lon, 6), tx.mhz, tx.city,
                    source_index, maximum, round(tx.erp, 4), round(tx.height, 1)]
        if tx.contour or tx.estimate:
            location.append(tx.contour)
        if tx.estimate:
            location.append(tx.estimate)
        rows.append(location)
        matched[tx.country, bool(maximum)] += 1
    data = {'streams': list(streams), 'sources': list(sources), 'transmitters': rows}
    for country, count in sorted(counts.items()):
        fm = matched[country, True]
        print(f'{country}: {count} transmitter records, {fm} with a matched stream and coverage, '
              f'{matched[country, False]} location-only stream matches')
    print(f'{len(rows)} linked transmitters, {len({row[2] for row in streams})} distinct HTTPS streams')
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('radio-browser', 'canada', 'australia', 'brazil', 'brazil-licenses',
                 'ofcom', 'czech', 'swiss', 'fcc-facilities', 'fcc-engineering', 'fcc-contours'):
        parser.add_argument(f'--{flag}', type=Path)
    parser.add_argument('--fcc-api', type=Path, help='reuse or create a local FCC callsign lookup snapshot')
    args = parser.parse_args()
    directory = Directory(read_source(args.radio_browser, RADIO_BROWSER))
    manual = list(references(directory))
    facilities = fcc_facilities(read_source(args.fcc_facilities, FCC_CDBS + 'facility.zip'))
    snapshot = fcc_api_snapshot(args.fcc_api, facilities, directory) if args.fcc_api else ()
    transmitters = [
        *manual,
        *canada(read_source(args.canada, CANADA)),
        *australia(read_source(args.australia, AUSTRALIA)),
        *brazil(read_source(args.brazil, BRAZIL), read_source(args.brazil_licenses, BRAZIL_LICENSES)),
        *ofcom(read_source(args.ofcom, OFCOM)),
        *czechia(read_source(args.czech, CZECH_CSV)),
        *switzerland(read_source(args.swiss, SWISS)),
        *united_states(facilities, read_source(args.fcc_engineering, FCC_CDBS + 'fm_eng_data.zip'),
                       read_source(args.fcc_contours, FCC_CONTOURS), snapshot),
    ]
    data = make_catalog(transmitters, directory)
    if not data['transmitters']:
        raise ValueError('No transmitters matched the radio directory')
    write_data('radio-fm.json.gz', data)


if __name__ == '__main__':
    main()
