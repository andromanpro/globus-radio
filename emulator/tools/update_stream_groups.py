"""Check plausible Radio Browser mirrors and build the player's failover catalogue."""

import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.client import HTTPException
import ipaddress
import json
from pathlib import Path
import socket
from threading import BoundedSemaphore, Lock
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from station_hints import distance_km, point, shared_page, station_version
from locate_stations import locality_key
from update_data import RADIO_BROWSER, read_source, write_data


def candidates(rows):
    groups = defaultdict(dict)
    for row in rows:
        url = row.get('url_resolved') or ''
        if (not url.startswith('https://') or not row['countrycode'] or not row.get('lastcheckok')
                or not (version := station_version(row)) or not (page := shared_page(row))):
            continue
        key = page, version[2], locality_key(row.get('state') or ''), row.get('iso_3166_2') or ''
        previous = groups[key].get(url)
        if previous is None or row['clickcount'] > previous['clickcount']:
            groups[key][url] = row
    for by_url in groups.values():
        if len(by_url) < 2:
            continue
        places = [coords for row in by_url.values() if (coords := point(row))]
        if any(distance_km(left, right) > 25 for i, left in enumerate(places) for right in places[i + 1:]):
            continue
        yield list(by_url.values())


def check_public(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None:
        raise ValueError('Expected a public HTTPS stream')
    addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    for entry in addresses:
        address = ipaddress.ip_address(entry[4][0])
        if not address.is_global or address.is_multicast or address.is_reserved:
            raise ValueError('Non-public stream address')
    return parsed.hostname


class PublicRedirects(HTTPRedirectHandler):
    max_redirections = 4

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        check_public(newurl)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def save_checks(path, checked):
    pending = path.with_suffix(path.suffix + '.tmp')
    pending.write_text(json.dumps(checked), encoding='utf-8')
    pending.replace(path)


def check_streams(urls, checked, snapshot):
    limits = {}
    lock = Lock()

    def probe(url):
        try:
            host = check_public(url)
            with lock:
                limit = limits.setdefault(host, BoundedSemaphore(2))
            request = Request(url, headers={'User-Agent': 'Globusradio/0.2 (local emulator)', 'Icy-MetaData': '1'})
            with limit, build_opener(PublicRedirects()).open(request, timeout=7) as response:
                mime = response.headers.get_content_type()
                payload = response.read(256)
                hls = payload.lstrip().startswith(b'#EXTM3U')
                if len(payload) < 16 or not (mime.startswith('audio/') or hls):
                    return url, None
                name = locality_key(response.headers.get('icy-name', ''))
                return url, [response.geturl(), name, int(hls)]
        except (OSError, ValueError, HTTPException):
            return url, None

    pending = [url for url in urls if url not in checked]
    with ThreadPoolExecutor(max_workers=16) as pool:
        tasks = [pool.submit(probe, url) for url in pending]
        for index, task in enumerate(as_completed(tasks), 1):
            url, evidence = task.result()
            checked[url] = evidence
            if index % 100 == 0:
                print(f'Checked {index:,} of {len(pending):,} pending addresses', flush=True)
                if snapshot:
                    save_checks(snapshot, checked)
    if pending and snapshot:
        save_checks(snapshot, checked)


def confirmed_groups(groups, checked):
    claimed = set()
    for group in groups:
        verified = [(row, checked[row['url_resolved']]) for row in group if checked.get(row['url_resolved'])]
        by_identity = defaultdict(list)
        for row, evidence in verified:
            final_url, name, _ = evidence
            by_identity['endpoint', final_url].append((row, evidence))
            if len(name) >= 5 and name not in {'radio', 'online', 'live stream', 'stream', 'icecast', 'shoutcast'}:
                by_identity['programme', name].append((row, evidence))
        for matches in sorted(by_identity.values(), key=len, reverse=True):
            if len(matches) < 2 or any(row['url_resolved'] in claimed for row, _ in matches):
                continue
            matches.sort(key=lambda item: (bool(item[0].get('ssl_error')),
                                           -item[0]['clickcount'], item[0]['url_resolved']))
            yield [[row['url_resolved'], evidence[2]] for row, evidence in matches]
            claimed.update(row['url_resolved'] for row, _ in matches)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--radio-browser', type=Path, help='use a downloaded Radio Browser snapshot')
    parser.add_argument('--checks', type=Path, help='reuse a local HTTP check snapshot or write one when absent')
    args = parser.parse_args()
    rows = json.loads(read_source(args.radio_browser, RADIO_BROWSER))
    groups = sorted(candidates(rows), key=lambda group: -max(row['clickcount'] for row in group))
    urls = list(dict.fromkeys(row['url_resolved'] for group in groups for row in group))
    checked = json.loads(args.checks.read_bytes()) if args.checks and args.checks.exists() else {}
    print(f'{len(groups):,} candidate programme groups, {len(urls):,} URLs', flush=True)
    check_streams(urls, checked, args.checks)
    confirmed = list(confirmed_groups(groups, checked))
    if not confirmed:
        raise SystemExit('No mirror groups confirmed. The current catalogue was kept.')
    write_data('radio-stream-groups.json.gz', confirmed)
    print(f'{sum(bool(result) for result in checked.values()):,} audio responses, '
          f'{len(confirmed):,} groups with {sum(map(len, confirmed)):,} verified addresses')


if __name__ == '__main__':
    main()
