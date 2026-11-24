import { geoContains } from 'd3-geo';
import { distanceKm, loadGzipJson } from './geo';

// Sites and stereo ranges are reference values from the regulator's frequency plans.
export const fmStations = [
  {
    id: 'ab11f775-dadf-4614-8b61-f9ea3654d65d', name: 'Rádió 1 Miskolc',
    url: 'https://icast.connectmedia.hu/5211/live.mp3', detail: 'FM · 96,3 МГц', country: 'HU',
    lat: 48.099444, lon: 20.776667, hls: false, popularity: 0,
    fm: { mhz: 96.3, minKm: 4, maxKm: 23, source: 'https://nmhh.hu/dokumentum/154607/webJKV20121010.pdf' },
  },
  {
    id: '2b4c964d-360f-444f-aaa9-d0086f91f47d', name: 'Európa Rádió Miskolc',
    url: 'https://europaradio.hu/miskolc', detail: 'FM · 90,4 МГц', country: 'HU',
    lat: 48.099444, lon: 20.775556, hls: false, popularity: 0,
    fm: { mhz: 90.4, minKm: 1, maxKm: 10, source: 'https://nmhh.hu/cikk/210288/Miskolc_904_MHz__a_Mediatanacs_942020_II_11_szamu_hatarozata_alapjan_palyaztatasra_kerulo_mediaszolgaltatasi_lehetoseg_frekvenciaterve' },
  },
];

export const fmStationsById = new Map(fmStations.map(station => [station.id, station]));

export async function loadFmStations(url) {
  const { streams, sources, transmitters } = await loadGzipJson(url);
  return transmitters.map(([stream, lat, lon, mhz, city, source, maxKm, power, height, contour, estimate]) => {
    const [id, name, url, country, hls, popularity] = streams[stream];
    const [sourceName, sourceUrl] = sources[source];
    return {
      id, name, url, country, hls: Boolean(hls), popularity, lat, lon, city,
      source: sourceUrl,
      fm: { mhz, maxKm, power, height, source: sourceUrl, sourceName, contour, estimate },
    };
  });
}

export function inFmRange(station, { lat, lon }, distance) {
  const fm = station.fm;
  if (!fm?.maxKm) return false;
  const actual = distance ?? distanceKm(lat, lon, station.lat, station.lon);
  return actual <= fm.maxKm && (!fm.contour || geoContains(fm.contour, [lon, lat]));
}
