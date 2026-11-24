import { distanceKm, earthRadiusKm, loadGzipJson, visibleTiles } from './geo';
import { fmStations, fmStationsById, inFmRange } from './coverage';

const directoryHosts = ['de1.api.radio-browser.info', 'nl1.api.radio-browser.info'];
const pageSize = 60;

function stationInfo(id, name, url, detail, country, lat, lon, hls, popularity, codec, city, source, relay, locationHint) {
  const transmitter = fmStationsById.get(id);
  if (transmitter) return { ...transmitter, popularity };
  if (!name || !url?.startsWith('https://')) return null;
  return {
    id, name, url, detail: detail || codec, country, lat, lon, popularity, city, source, relay, locationHint,
    hls: Boolean(hls) || /\.m3u8(?:[?#]|$)/i.test(url),
  };
}

export const searchKey = value => value.toLocaleLowerCase().normalize('NFKC');

export async function loadStreamGroups(url) {
  const index = new Map();
  for (const rows of await loadGzipJson(url)) {
    const group = rows.map(([url, hls]) => ({ url, hls: Boolean(hls) }));
    for (const stream of group) index.set(stream.url, group);
  }
  return index;
}

export function programmeKey(station, groups) {
  return groups.get(station.url)?.[0].url ?? station.url;
}

const placementPriority = { 'regional-capital': 1, 'regional-largest-city': 1, 'country-capital': 2 };
export const isAreaEstimate = station => Object.hasOwn(placementPriority, station.locationHint);

export async function loadStationMap(url) {
  const rows = (await loadGzipJson(url)).map(row => stationInfo(...row)).filter(Boolean);
  const stations = new Map([...fmStations, ...rows].map(station => [
    station.relay ? `${station.id}/${station.country}/${station.lat}/${station.lon}` : station.id, station,
  ]));
  return [...stations.values()];
}

export function createStationIndex(stations, groups = new Map()) {
  const tiles = new Map();
  const countries = new Map();
  let maxRange = 0;
  for (const station of stations) {
    const { lat, lon, country } = station;
    const tile = visibleTiles(lat, lon, 0)[0];
    if (!tiles.has(tile)) tiles.set(tile, []);
    tiles.get(tile).push(station);
    if (!countries.has(country)) countries.set(country, []);
    countries.get(country).push(station);
    maxRange = Math.max(maxRange, station.fm?.maxKm ?? 0);
  }
  return {
    stations, countries, maxRange, groups,
    *near(lat, lon, radius) {
      for (const tile of visibleTiles(lat, lon, radius / earthRadiusKm)) {
        yield* tiles.get(tile) ?? [];
      }
    },
  };
}

export function scanStations(source, { lat, lon, radius, name, byCoverage = false }) {
  const search = searchKey(name);
  const matches = [];
  const searchRadius = byCoverage ? Math.min(source.maxRange, radius) : radius;
  for (const station of source.near(lat, lon, searchRadius)) {
    if (byCoverage && !station.fm?.maxKm) continue;
    const limit = byCoverage ? Math.min(station.fm.maxKm, radius) : radius;
    // One degree of latitude is over 111 km. This bound avoids unnecessary trigonometry.
    if (Math.abs(station.lat - lat) > limit / 110 || (search && !searchKey(station.name).includes(search))) continue;
    const distance = distanceKm(lat, lon, station.lat, station.lon);
    if (distance <= limit && (!byCoverage || inFmRange(station, { lat, lon }, distance))) {
      matches.push({ ...station, distance });
    }
  }
  matches.sort((left, right) => (placementPriority[left.locationHint] ?? 0) - (placementPriority[right.locationHint] ?? 0)
    || left.distance - right.distance || right.popularity - left.popularity);
  const programmes = new Set();
  const networks = new Set();
  return matches.filter(station => {
    const programme = programmeKey(station, source.groups);
    if (programmes.has(programme) || (station.relay && networks.has(station.id))) return false;
    programmes.add(programme);
    if (station.relay) networks.add(station.id);
    return true;
  });
}

export function nearestStation(source, { lat, lon }, { includeAreaEstimates = true } = {}) {
  let nearest = null;
  let distance = Infinity;
  for (const station of source.stations) {
    if (!includeAreaEstimates && isAreaEstimate(station)) continue;
    if (Math.abs(station.lat - lat) * 110 >= distance) continue;
    const candidate = distanceKm(lat, lon, station.lat, station.lon);
    if (candidate >= distance) continue;
    nearest = station;
    distance = candidate;
  }
  return nearest && { station: nearest, distance };
}

export async function countryStations(code, name, offset, signal) {
  const query = new URLSearchParams({
    countrycode: code, name, offset, limit: pageSize, hidebroken: 'true',
    is_https: 'true', order: 'clickcount', reverse: 'true',
  });
  for (const host of directoryHosts) {
    try {
      const response = await fetch(`https://${host}/json/stations/search?${query}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(6500)]),
      });
      if (!response.ok) continue;
      const rows = await response.json();
      const stations = rows.map(row => stationInfo(
        row.stationuuid, row.name?.trim(), row.url_resolved, row.tags?.split(',').find(Boolean)?.trim(),
        row.countrycode, row.geo_lat, row.geo_long, row.hls, row.clickcount, row.codec,
      )).filter(Boolean);
      return { stations, next: rows.length === pageSize ? offset + rows.length : null };
    } catch {
      if (signal.aborted) throw signal.reason;
    }
  }
  throw new Error('Radio Browser unavailable');
}

export function createRadio(onState) {
  let audio = null;
  let hls = null;
  let timeout;
  let volume = 0.55;

  function stop() {
    clearTimeout(timeout);
    timeout = undefined;
    const previous = audio;
    audio = null;
    hls?.destroy();
    hls = null;
    if (!previous) return;
    previous.pause();
    previous.removeAttribute('src');
    previous.load();
  }

  return {
    stop,
    setVolume(value) {
      volume = value;
      if (audio) audio.volume = value;
    },
    start(station, mirrors = []) {
      const choices = [station, ...mirrors.filter(candidate => candidate.url !== station.url)].values();
      attempt();

      function attempt() {
        stop();
        const source = choices.next().value;
        if (!source) {
          onState('error');
          return;
        }

        const stream = new Audio();
        audio = stream;
        stream.volume = volume;

        function failed(state = 'error') {
          if (audio !== stream) return;
          if (state === 'blocked') {
            stop();
            onState(state);
          } else {
            attempt();
          }
        }

        function buffering() {
          if (audio !== stream) return;
          if (!timeout) timeout = setTimeout(() => failed(), 12000);
          onState(source === station ? 'connecting' : 'retrying');
        }

        stream.addEventListener('playing', () => {
          if (audio !== stream) return;
          clearTimeout(timeout);
          timeout = undefined;
          onState('playing');
        });
        stream.addEventListener('waiting', buffering);
        stream.addEventListener('error', () => failed());
        stream.addEventListener('ended', () => failed());
        buffering();
        function playStream() {
          if (audio !== stream) return;
          stream.play().catch(error => failed(error.name === 'NotAllowedError' ? 'blocked' : 'error'));
        }

        if (!source.hls || stream.canPlayType('application/vnd.apple.mpegurl')) {
          stream.src = source.url;
          playStream();
          return;
        }
        import('hls.js/light').then(({ default: Hls }) => {
          if (audio !== stream) return;
          if (!Hls.isSupported()) {
            failed();
            return;
          }
          hls = new Hls({ enableWorker: false, maxBufferLength: 10 });
          hls.on(Hls.Events.ERROR, (_, error) => { if (error.fatal) failed(); });
          hls.on(Hls.Events.MANIFEST_PARSED, playStream);
          hls.on(Hls.Events.MEDIA_ATTACHED, () => { if (audio === stream) hls.loadSource(source.url); });
          hls.attachMedia(stream);
        }).catch(() => failed());
      }
    },
  };
}
