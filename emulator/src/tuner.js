import { distanceKm } from './geo';
import { createFavorites } from './favorites';
import { fmStations, inFmRange, loadFmStations } from './coverage';
import { number, onLanguageChange, t } from './i18n';
import { placeName } from './place-names';
import {
  countryStations, createRadio, createStationIndex, loadStationMap, loadStreamGroups,
  isAreaEstimate, nearestStation, programmeKey, scanStations, searchKey,
} from './radio';

const listPageSize = { nearby: 20, fm: 50, country: 50 };
const activePlayback = new Set(['playing', 'connecting', 'retrying']);
const radiusSteps = [[1, 50, 1], [55, 250, 5], [260, 500, 10], [525, 1000, 25], [1050, 2500, 50]]
  .flatMap(([start, end, step]) => Array.from({ length: (end - start) / step + 1 }, (_, index) => start + index * step));

export function createTuner(dataUrl, curated, onRadiusChange, onFmChange, onBroadcastChange) {
  const byId = id => document.getElementById(id);
  const play = byId('play');
  const list = byId('stations');
  const scopeButtons = { nearby: byId('nearby'), fm: byId('fm'), country: byId('countrywide') };
  const radiusInput = byId('radius');
  const radiusSlider = byId('radius-slider');
  const nameInput = byId('station-search');
  const more = byId('more-stations');
  const areaEstimates = byId('area-estimates');
  const message = byId('list-message');
  const fmDetails = byId('fm-details');
  const fmRange = byId('fm-range');
  const fmSource = byId('fm-source');

  let location;
  let previewPoint = null;
  let scope = 'nearby';
  let radius = Number(radiusInput.value);
  let selection = '';
  let activeKey;
  let controller;
  let pendingSearch;
  let stationMap;
  let stationSource;
  let locatedProgrammes;
  let streamGroups = new Map();
  let fmIndex = createStationIndex(fmStations);
  let fmLoadFailed = false;
  let mapLoadFailed = false;
  let matches = [];
  let showAreaEstimates = false;
  let areaEstimateCount = 0;
  let localCount = 0;
  let stationRows = new Map();
  let displayed = listPageSize[scope];
  let nextOffset = null;
  let notice;
  let loading = false;
  let selected = null;
  let favoritePlayback = false;
  let state = 'empty';
  let wantsPlayback = false;
  const radio = createRadio(nextState => {
    state = nextState;
    if (state === 'blocked') wantsPlayback = false;
    renderPlayer();
  });
  const favorites = createFavorites(station => programmeKey(station, streamGroups), station => chooseStation(station, true));

  function renderPlayer() {
    const canPause = activePlayback.has(state);
    const label = t(canPause ? 'pause' : 'play');
    play.disabled = !selected;
    play.title = label;
    play.setAttribute('aria-label', label);
    play.dataset.action = canPause ? 'pause' : 'play';
    play.closest('.player').dataset.state = state;
    byId('station-name').textContent = selected?.name ?? t('silent');
    byId('status').textContent = t(`status.${state}`);
    favorites.update(selected);
    for (const button of list.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(Boolean(selected) && button.dataset.programme === programmeKey(selected, streamGroups)));
    }
    const transmitter = scope === 'fm' && !favoritePlayback && selected?.fm ? selected : null;
    fmDetails.hidden = !transmitter;
    if (transmitter) {
      const { mhz, minKm, maxKm, power, height, source, sourceName, contour, estimate } = transmitter.fm;
      const range = contour ? t('fmContour') : minKm === undefined
        ? t('fmDistance', { distance: number(maxKm) })
        : t('fmPlan', { min: number(minKm), max: number(maxKm) });
      const powerLabel = estimate === 'transmitter' ? t('transmitterPower') : 'ERP';
      const technical = power ? ` · ${powerLabel} ${number(power, 3)} ${t('kw')} · ${t('antennaHeight', { height: number(height) })}` : '';
      fmRange.textContent = `${number(mhz)} ${t('mhz')} · ${range}${technical}.`;
      fmSource.href = source;
      fmSource.textContent = `${sourceName ?? t('sourceNMHH')} ↗`;
    }
    onFmChange(transmitter);
    const source = state === 'playing' && Number.isFinite(selected?.lat) && Number.isFinite(selected?.lon) && !isAreaEstimate(selected)
      ? selected : null;
    onBroadcastChange(source);
  }

  function chooseStation(station, fromFavorites = false) {
    selected = station;
    favoritePlayback = fromFavorites;
    wantsPlayback = true;
    radio.start(station, streamGroups.get(station.url));
  }

  function clearStation() {
    selected = null;
    favoritePlayback = false;
    state = 'empty';
    radio.stop();
  }

  function listItem(station) {
    const key = programmeKey(station, streamGroups);
    let row = stationRows.get(key);
    if (!row) {
      row = createListItem(key);
    }
    row.station = station;
    row.button.dataset.url = station.url;
    const locationHint = t(`hint.${station.locationHint}`);
    const city = placeName(station.city);
    const frequency = station.fm ? `${number(station.fm.mhz)} ${t('mhz')}` : '';
    const category = station.fm ? frequency : t(`genre.${station.detail}`) || station.detail;
    row.button.title = station.fm && city ? `${station.name} · ${t('transmitter')}: ${city}`
      : station.relay ? `${station.name} · ${city} · ${category}`
      : locationHint ? `${station.name} · ${city ? `${city} · ` : ''}${locationHint}`
      : city ? `${station.name} · ${t('cityCentre', { city })}` : station.name;
    if (streamGroups.has(station.url)) row.button.title += ` · ${t('cityStreams', { n: streamGroups.get(station.url).length })}`;
    if (row.name.textContent !== station.name) row.name.textContent = station.name;
    const locationLabel = station.fm ? t('transmitter') : station.relay === 'network' ? t('network') : station.relay === 'region' ? t('regional')
      : locationHint ? t(`label.${station.locationHint}`) || t('approximately') : city ? t('byCity') : '';
    const distance = `${number(station.distance)} ${t('km')}`;
    const detail = scope === 'fm'
      ? `${frequency} · ${distance}`
      : station.distance === undefined ? category ?? '' : `${distance}${locationLabel ? ` · ${locationLabel}` : ''}`;
    if (row.detail.textContent !== detail) row.detail.textContent = detail;
    return row;
  }

  function createListItem(key) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    const name = document.createElement('span');
    const detail = document.createElement('small');
    button.type = 'button';
    button.dataset.programme = key;
    button.append(name, detail);
    li.append(button);
    const row = { li, button, name, detail, station: null };
    button.addEventListener('click', () => chooseStation(row.station));
    return row;
  }

  function renderList(resetScroll = false, previewing = false) {
    list.setAttribute('aria-busy', String(loading));
    const scrollTop = resetScroll ? 0 : list.scrollTop;
    const rows = matches.slice(0, displayed);
    const items = rows.map(listItem);
    stationRows = new Map(items.map(row => [row.button.dataset.programme, row]));
    if (items.length !== list.children.length || items.some((row, index) => row.li !== list.children[index])) {
      list.replaceChildren(...items.map(row => row.li));
    }
    list.scrollTop = scrollTop;
    more.hidden = displayed >= matches.length && nextOffset === null;
    more.disabled = loading;
    const showingEstimates = scope === 'nearby' && showAreaEstimates;
    areaEstimates.hidden = scope !== 'nearby' || loading || !areaEstimateCount;
    if (!areaEstimates.hidden) {
      areaEstimates.textContent = showingEstimates
        ? t('localCount', { n: number(localCount, 0) })
        : t('estimateCount', { n: number(areaEstimateCount, 0) });
      areaEstimates.title = t(showingEstimates ? 'showLocal' : 'showEstimated');
    }
    const heading = t(showingEstimates ? 'estimates' : `heading.${scope}`);
    const n = number(matches.length, 0);
    byId('station-heading').textContent = `${heading} · ${n}${nextOffset === null ? '' : '+'}`;
    const mapStatus = showingEstimates ? `${heading} · ${n}` : t({ nearby: 'nearbyMap', fm: 'coverageMap', country: 'sight' }[scope], { n });
    byId('map-stations').textContent = loading ? t('stationsSearching') : mapStatus;
    message.textContent = loading ? t('stationsLoading') : notice ? t(notice.key, {
      distance: number(notice.distance ?? 0), city: placeName(notice.city),
    }) : '';
    message.hidden = !message.textContent;

    if (!previewing && !showingEstimates && !selected && matches.length) {
      selected = matches.find(station => !station.city && !station.locationHint) ?? matches[0];
      state = 'ready';
      if (scope === 'fm' && wantsPlayback) radio.start(selected, streamGroups.get(selected.url));
    }
    renderPlayer();
  }

  function renderLocal(point, previewing = false, aimedStation = null) {
    const name = nameInput.value.trim();
    const byCoverage = scope === 'fm' || !point.onLand;
    const options = { ...point, radius: scope === 'fm' ? Infinity : radius, name, byCoverage };
    const source = byCoverage ? fmIndex : stationSource;
    const found = scanStations(source, options);
    const firstEstimate = byCoverage ? -1 : found.findIndex(isAreaEstimate);
    localCount = firstEstimate < 0 ? found.length : firstEstimate;
    areaEstimateCount = found.length - localCount;
    if (!areaEstimateCount) showAreaEstimates = false;
    matches = showAreaEstimates ? found.slice(localCount) : found.slice(0, localCount);
    if (aimedStation) {
      const key = programmeKey(aimedStation, streamGroups);
      matches = [{ ...aimedStation, distance: 0 }, ...matches.filter(station => programmeKey(station, streamGroups) !== key
        && !(aimedStation.relay && station.relay && station.id === aimedStation.id))];
      localCount = matches.length;
    } else if (selected && !favoritePlayback && (!previewing || byCoverage)) {
      const key = programmeKey(selected, streamGroups);
      const binding = found.find(station => programmeKey(station, streamGroups) === key);
      if (binding && (binding.lat !== selected.lat || binding.lon !== selected.lon || binding.fm !== selected.fm)) {
        selected = binding;
      } else if (!inScan(selected, point)) {
        clearStation();
      }
    }
    notice = null;
    if (!matches.length) {
      if (areaEstimateCount) {
        notice = { key: name ? 'onlyEstimateSearch' : 'onlyEstimateArea' };
      } else if (name && scanStations(source, { ...options, name: '' }).length) {
        notice = { key: 'otherNames' };
      } else if (byCoverage && fmLoadFailed) {
        notice = { key: 'fmDirectoryError' };
      } else if (byCoverage && point.onLand && !source.countries.has(point.code)) {
        notice = { key: 'noFmData' };
      } else if (byCoverage) {
        notice = { key: 'noFmSignal' };
      } else if (mapLoadFailed) {
        notice = { key: 'mapDirectoryError' };
      } else if (!previewing) {
        const nearest = nearestStation(stationSource, point, { includeAreaEstimates: false });
        if (nearest) {
          const key = nearest.station.fm ? 'nearestTransmitter' : nearest.station.city ? 'nearestCity' : 'nearestStation';
          notice = { key, distance: nearest.distance, city: nearest.station.city };
        } else {
          notice = { key: 'noNearby' };
        }
      }
    }
    loading = false;
    renderList(true, previewing);
  }

  function preview(point) {
    if (scope === 'country') return;
    previewPoint = point;
    if (!stationSource) return;
    displayed = listPageSize[scope];
    renderLocal(point, true);
  }

  function inScan(station, point = location) {
    if (!station) return false;
    if (scope === 'country') return station.country === point.code;
    if (scope === 'fm') return inFmRange(station, point);
    if (!point.onLand && !inFmRange(station, point)) return false;
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return false;
    return distanceKm(point.lat, point.lon, station.lat, station.lon) <= radius;
  }

  function appendStations(rows) {
    const programmes = new Set(matches.map(station => programmeKey(station, streamGroups)));
    const networks = new Set(matches.filter(station => station.relay).map(station => station.id));
    for (const station of rows) {
      const key = programmeKey(station, streamGroups);
      if (programmes.has(key) || (station.relay && networks.has(station.id))) continue;
      programmes.add(key);
      if (station.relay) networks.add(station.id);
      matches.push(station);
    }
  }

  async function loadCountry(offset, request) {
    try {
      const result = await countryStations(location.code, selection, offset, request.signal);
      if (request.signal.aborted) return;
      appendStations(result.stations);
      nextOffset = result.next;
      if (!matches.length) notice = { key: 'noCountryMatch' };
    } catch {
      if (request.signal.aborted) return;
      if (!offset) activeKey = undefined;
      notice = { key: 'countryDirectoryError' };
    }
    loading = false;
    renderList(offset === 0);
  }

  function loadSources() {
    if (stationMap) return stationMap;
    stationMap = Promise.allSettled([
      loadStationMap(`${dataUrl}radio-geo.json.gz`),
      loadFmStations(`${dataUrl}radio-fm.json.gz`),
      loadStreamGroups(`${dataUrl}radio-stream-groups.json.gz`),
    ]).then(([directory, transmitters, groups]) => {
      mapLoadFailed = directory.status !== 'fulfilled';
      fmLoadFailed = transmitters.status !== 'fulfilled';
      const local = directory.value ?? fmStations;
      const added = transmitters.value ?? [];
      streamGroups = groups.value ?? streamGroups;
      fmIndex = createStationIndex([...fmStations, ...added.filter(station => station.fm.maxKm)], streamGroups);
      stationSource = createStationIndex([...local, ...added], streamGroups);
    });
    return stationMap;
  }

  async function locatedStations() {
    await loadSources();
    if (locatedProgrammes) return locatedProgrammes;
    const stations = stationSource.stations.filter(station => {
      const { lat, lon, url } = station;
      return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180
        && url?.startsWith('https://') && !isAreaEstimate(station);
    });
    const networksByProgramme = new Map(stations.filter(station => station.relay)
      .map(station => [programmeKey(station, streamGroups), station.id]));
    locatedProgrammes = new Map();
    for (const station of stations) {
      const { lat, lon } = station;
      const programme = programmeKey(station, streamGroups);
      const key = networksByProgramme.get(programme) ?? programme;
      if (!locatedProgrammes.has(key)) locatedProgrammes.set(key, []);
      const locations = locatedProgrammes.get(key);
      if (!locations.some(place => distanceKm(lat, lon, place.lat, place.lon) < 2)) locations.push(station);
    }
    return locatedProgrammes;
  }

  async function refresh() {
    if (!location) return;
    selection = nameInput.value.trim();
    const area = scope === 'country' ? location.code : `${location.lat}/${location.lon}`;
    const key = `${scope}/${area}/${scope === 'nearby' ? radius : ''}/${selection}`;
    if (key === activeKey) return;
    activeKey = key;
    controller?.abort();
    const request = new AbortController();
    controller = request;

    if (selected && !favoritePlayback && scope === 'country' && !inScan(selected)) clearStation();
    matches = [];
    displayed = listPageSize[scope];
    nextOffset = null;
    notice = null;

    if (scope === 'country' && (!location.code || location.code === 'AQ')) {
      loading = false;
      notice = { key: 'chooseCountry' };
      renderList(true);
      return;
    }

    loading = true;
    if (!stationSource) {
      renderList(true);
      await loadSources();
      if (request.signal.aborted) return;
    }
    if (scope === 'country') {
      const term = searchKey(selection);
      const regional = (stationSource.countries.get(location.code) ?? []).filter(station => station.source
        && (searchKey(station.name).includes(term) || searchKey(station.city ?? '').includes(term)));
      regional.sort((left, right) => distanceKm(location.lat, location.lon, left.lat, left.lon)
        - distanceKm(location.lat, location.lon, right.lat, right.lon));
      appendStations([...(curated.get(location.code) ?? []).filter(station => searchKey(station.name).includes(term)), ...regional]);
      renderList(true);
      await loadCountry(0, request);
      return;
    }

    renderLocal(previewPoint ?? location, Boolean(previewPoint));
  }

  function scheduleRefresh() {
    clearTimeout(pendingSearch);
    pendingSearch = setTimeout(refresh, 250);
  }

  function setScope(nextScope, aimedStation = null) {
    if (scope !== nextScope) showAreaEstimates = false;
    scope = nextScope;
    previewPoint = null;
    for (const [mode, button] of Object.entries(scopeButtons)) button.setAttribute('aria-pressed', String(mode === scope));
    byId('radius-control').hidden = scope !== 'nearby';
    byId('fm-hint').hidden = scope !== 'fm';
    onRadiusChange(scope === 'nearby' ? radius : null);
    if (aimedStation) {
      selection = '';
      activeKey = `${scope}/${location.lat}/${location.lon}/${radius}/${selection}`;
      displayed = listPageSize[scope];
      nextOffset = null;
      renderLocal(location, false, aimedStation);
    } else refresh();
  }

  function setRadius(value) {
    radius = value;
    radiusSlider.setAttribute('aria-valuetext', `${number(radius)} ${t('km')}`);
    onRadiusChange(radius);
    if (scope === 'nearby' && location && stationSource) {
      displayed = listPageSize[scope];
      renderLocal(previewPoint ?? location, true);
    }
    scheduleRefresh();
  }

  function syncSlider(value) {
    const upper = radiusSteps.findIndex(step => step >= value);
    const index = upper > 0 && value - radiusSteps[upper - 1] < radiusSteps[upper] - value ? upper - 1 : upper;
    radiusSlider.value = String(index);
  }

  function updateRadius() {
    if (!radiusInput.value || !radiusInput.validity.valid) return;
    const value = radiusInput.valueAsNumber;
    syncSlider(value);
    setRadius(value);
  }

  for (const [mode, button] of Object.entries(scopeButtons)) button.addEventListener('click', () => setScope(mode));
  radiusInput.addEventListener('input', updateRadius);
  radiusSlider.max = String(radiusSteps.length - 1);
  syncSlider(radius);
  radiusSlider.addEventListener('input', () => {
    const value = radiusSteps[radiusSlider.valueAsNumber];
    radiusInput.value = String(value);
    setRadius(value);
  });
  radiusSlider.addEventListener('change', () => {
    clearTimeout(pendingSearch);
    refresh();
  });
  radiusInput.addEventListener('change', () => {
    if (!radiusInput.value || !radiusInput.validity.valid) {
      radiusInput.value = String(Math.min(2500, Math.max(1, Math.round(radiusInput.valueAsNumber || radius))));
      updateRadius();
    }
  });
  nameInput.addEventListener('input', scheduleRefresh);
  areaEstimates.addEventListener('click', () => {
    showAreaEstimates = !showAreaEstimates;
    displayed = listPageSize[scope];
    renderLocal(previewPoint ?? location, Boolean(previewPoint));
  });
  more.addEventListener('click', () => {
    if (loading) return;
    if (displayed < matches.length) {
      displayed += listPageSize[scope];
      renderList();
    } else if (nextOffset !== null) {
      displayed += listPageSize[scope];
      notice = null;
      loading = true;
      renderList();
      loadCountry(nextOffset, controller);
    }
  });
  play.addEventListener('click', () => {
    if (!selected) return;
    if (activePlayback.has(state)) {
      wantsPlayback = false;
      radio.stop();
      state = 'paused';
      renderPlayer();
    } else {
      chooseStation(selected, favoritePlayback);
    }
  });
  const volume = byId('volume');
  volume.addEventListener('input', () => radio.setVolume(Number(volume.value)));
  onLanguageChange(() => {
    radiusSlider.setAttribute('aria-valuetext', `${number(radius)} ${t('km')}`);
    renderList(false, true);
  });
  radiusSlider.setAttribute('aria-valuetext', `${number(radius)} ${t('km')}`);
  onRadiusChange(radius);

  return {
    preview,
    async heatLocations() {
      return [...(await locatedStations()).values()].flat();
    },
    async randomStation(latitudeLimit) {
      const eligible = [];
      for (const locations of (await locatedStations()).values()) {
        const reachable = locations.filter(station => Math.abs(station.lat) <= latitudeLimit);
        if (reachable.length) eligible.push(reachable);
      }
      if (!eligible.length) return null;
      const locations = eligible[Math.floor(Math.random() * eligible.length)];
      return locations[Math.floor(Math.random() * locations.length)];
    },
    aimAtStation(point, station) {
      clearTimeout(pendingSearch);
      controller?.abort();
      location = point;
      nameInput.value = '';
      showAreaEstimates = false;
      selected = station;
      favoritePlayback = false;
      setScope('nearby', station);
      chooseStation(station);
    },
    locate(point) {
      if (previewPoint) activeKey = undefined;
      previewPoint = null;
      location = point;
      refresh();
    },
  };
}
