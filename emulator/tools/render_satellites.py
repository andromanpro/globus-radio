"""Render the original satellite models to a sprite atlas using the local Vite server."""

import argparse
from base64 import b64decode
from pathlib import Path

from playwright.sync_api import sync_playwright


def render(origin):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=['--enable-unsafe-swiftshader'])
        page = browser.new_page()
        url = f'{origin.rstrip("/")}/satellite-renderer'
        page.route(url, lambda route: route.fulfill(body='<!doctype html>', content_type='text/html'))
        page.goto(url)
        image = page.evaluate('''async () => {
            const { renderSatelliteAtlas } = await import('/tools/satellite-art.js');
            const { satelliteFrames } = await import('/src/dyson-swarm.js');
            return renderSatelliteAtlas(satelliteFrames).toDataURL('image/webp', .92);
        }''')
        browser.close()
    prefix, data = image.split(',', 1)
    if prefix != 'data:image/webp;base64':
        raise RuntimeError('Chromium did not encode the atlas as WebP')
    return b64decode(data, validate=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='http://127.0.0.1:4173')
    atlas = render(parser.parse_args().origin)
    target = Path(__file__).resolve().parents[2] / 'docs' / 'radio-globe-satellites.webp'
    temporary = target.with_suffix('.tmp')
    temporary.write_bytes(atlas)
    temporary.replace(target)
    print(f'{target.name}: {len(atlas):,} bytes')
