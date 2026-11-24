"""Refresh the published broadcast-city lists used by the emulator."""

import argparse
import json
import re
from pathlib import Path
from tempfile import NamedTemporaryFile

from bs4 import BeautifulSoup

from network_catalog import NETWORK_CITIES
from update_data import read_source


EUROPA = 'https://europaplus.ru/cities'
EUROPA_API = 'https://admin.europaplus.ru/api/cities?limit=1000&page=1'
DOROGNOE = 'https://dorognoe.ru/radiostation/broadcast-cities'
RETRO = 'https://retrofm.ru/'
AVTORADIO = 'https://www.avtoradio.ru/city-selector-by-region'
ENERGY = 'https://www.energyfm.ru/'


def page(raw):
    return BeautifulSoup(raw.decode('utf-8'), 'html.parser')


def city_row(name, frequency, **details):
    return {'name': ' '.join(name.split()), 'country': 'RU', 'frequency': ' '.join(frequency.split()), **details}


def europa_cities(raw):
    document = json.loads(raw)
    rows = document['data']
    if document['pagination']['pages'] != 1 or document['pagination']['total'] != len(rows):
        raise ValueError('Europe Plus response did not include every page')
    return [city_row(row['name'], row['frequency'] or '') for row in rows]


def emg_cities(raw, common_links):
    payload = json.loads(page(raw).find('script', id='__NUXT_DATA__').string)

    def value(index):
        return payload[index] if isinstance(index, int) and index >= 0 else None

    def regional_stream(region):
        if not isinstance(region, dict):
            return None
        streams = [value(index) for index in value(region.get('streams')) or []]
        ordered = sorted(streams, key=lambda stream: bool(value(stream.get('main'))), reverse=True)
        for stream in ordered:
            href = value(stream.get('link'))
            if href and href.startswith('https://') and href not in common_links:
                return href
        return None

    cities = []
    for row in payload:
        if not isinstance(row, dict) or not {'name', 'frequency', 'active', 'region'} <= row.keys():
            continue
        name, frequency = value(row['name']), value(row['frequency'])
        if not name or not frequency or not value(row['active']):
            continue
        stream = regional_stream(value(row['region']))
        cities.append(city_row(name, frequency, **({'stream': stream} if stream else {})))
    return cities


def hls(raw):
    match = re.search(r'https://hls-01-gpm\.hostingradio\.ru/avtoradio\d+/playlist\.m3u8', raw.decode('utf-8'))
    if not match:
        raise ValueError('Avtoradio player URL is missing')
    return match.group()


def avtoradio_cities(raw, city_pages):
    cities = []
    for anchor in page(raw).select('#city_select-black ul.h1000 a[href^="/radio/city/"]'):
        label = anchor.select_one('.small')
        if label is None:
            continue
        frequency = label.get_text(' ', strip=True)
        label.extract()
        region = anchor.find_parent('div', class_='grey')
        area = region.find('span', recursive=False) if region else None
        href = anchor['href']
        details = {'region': area.get_text(' ', strip=True)} if area else {}
        if href in city_pages:
            details.update(stream=city_pages[href], source=f'https://www.avtoradio.ru{href}')
        cities.append(city_row(anchor.get_text(' ', strip=True), frequency, **details))
    return cities


def energy_cities(raw, common):
    cities = []
    for button in page(raw).select('button.city-list__btn[data-playlist]'):
        label = button.select_one('.city-list__btn-inner')
        letters = label.find_all(recursive=False)
        name = ''.join(letter.get_text() for letter in letters) if letters else label.get_text()
        frequency = button.select_one('.city-list__fm').get_text('', strip=True)
        href = button['data-playlist']
        details = {'stream': href} if href.startswith('https://') and href != common else {}
        cities.append(city_row(name, f'{frequency} FM', **details))
    return cities


def network(network_id, name, source, stream, cities, minimum):
    rows = list({(row['country'], row['name'], row.get('region', '')): row for row in cities}.values())
    if len(rows) < minimum or not stream.startswith('https://'):
        raise ValueError(f'Unexpected city list for {name}: {len(rows)} records')
    print(f'{name}: {len(rows):,} published places')
    return {'id': network_id, 'name': name, 'source': source, 'stream': stream, 'cities': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, help='use saved globus-network-*.html source responses')
    args = parser.parse_args()

    def source(key, url):
        path = args.source_dir / f'globus-network-{key}.html' if args.source_dir else None
        return read_source(path, url)

    auto_stream = hls(source('autohome', 'https://www.avtoradio.ru/'))
    auto_local = {path: hls(source(key, 'https://www.avtoradio.ru' + path)) for path, key in (
        ('/radio/city/141', 'autoreg'), ('/radio/city/34', 'arvlad'),
    )}
    energy_stream = 'https://hls-01-gpm.hostingradio.ru/energyfm7/playlist.m3u8'
    rows = [
        network('europa-plus', 'Европа Плюс', EUROPA,
                'https://ep256.hostingradio.ru:8052/europaplus256.mp3', europa_cities(source('epall', EUROPA_API)), 250),
        network('dorognoe', 'Дорожное радио', DOROGNOE, 'https://dorognoe.hostingradio.ru/dorognoe',
                emg_cities(source('dr', DOROGNOE), {'https://hls-01-dorognoe.emgsound.ru/15/playlist.m3u8'}), 250),
        network('retro-fm', 'Ретро FM', RETRO, 'https://retro.hostingradio.ru:8043/retro256.mp3',
                emg_cities(source('retrohome', RETRO), {'https://hls-01-retro.emgsound.ru/12/playlist.m3u8'}), 175),
        network('avtoradio', 'Авторадио', AVTORADIO, auto_stream, avtoradio_cities(source('auto', AVTORADIO), auto_local), 200),
        network('energy', 'Радио ENERGY', ENERGY, energy_stream, energy_cities(source('energyhome', ENERGY), energy_stream), 100),
    ]
    with NamedTemporaryFile(dir=NETWORK_CITIES.parent, mode='w', encoding='utf-8', delete=False) as output:
        json.dump(rows, output, ensure_ascii=False, separators=(',', ':'))
        output.write('\n')
    Path(output.name).replace(NETWORK_CITIES)
