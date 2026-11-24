import '@fontsource-variable/manrope';
import './style.css';
import './globe-themes.css';
import { geoBounds, geoContains } from 'd3-geo';
import { iso31661NumericToAlpha2 } from 'iso-3166';
import { feature, mesh } from 'topojson-client';
import { createCityPicker } from './city-picker';
import { wireDial } from './controls';
import { distanceKm, wrapLongitude } from './geo';
import { createGlobeMotion } from './globe-motion';
import { currentLanguage, initLanguage, number, onLanguageChange, t } from './i18n';
import { loadPlaceNames, placeName, regionName } from './place-names';
import { cities } from './places';
import { indexRadioHeat } from './radio-heat';
import { createTuner } from './tuner';

const element = id => document.getElementById(id);
const globeElement = element('globe');
const vintageElement = element('vintage');
const globeStyle = element('globe-style');
const mapCard = globeElement.closest('.map-card');
const styleKey = 'globus-radio:map-view';
const radiusControl = element('radius-control');
const radiusHome = radiusControl.parentElement;
const radiusSlider = element('radius-slider');
const radiusDial = element('radius-dial');
const jump = element('jump');
const zoomIn = element('zoom-in');
const zoomOut = element('zoom-out');
const zoomReset = element('zoom-value');
const [home] = cities;
const dataUrl = `${import.meta.env.BASE_URL}data/`;
const maxZoomLevel = 9;
const heatButton = element('radio-heat');
const autoButton = element('auto-spin');
const randomButton = element('random-radio');
const randomTip = element('random-tip');
const actionStatus = element('map-action-status');
const mapActions = element('map-actions');
const mapToolbar = mapCard.querySelector('.map-toolbar');
const mapIndicator = mapToolbar.querySelector('.map-indicator');
const heatAction = element('heat-action');
const motionActions = [element('auto-action'), element('random-action')];

const curated = new Map(cities.map(city => [city.country,
  city.stations.map(([name, detail, url]) => ({ name, detail, url, country: city.country }))]));

let globe;
let vintage;
let vintageLimit = 65;
let vintageRequest;
let globeRequest;
let countries;
let geography;
let latitude = home.lat;
let longitude = home.lon;
let zoomLevel = 0;
let zoom = 1;
let scanRadius;
let fmCoverage = null;
let broadcast = null;
let tiltTimer;
let previewTimer;
let animation = 0;
let pointer = null;
let clock;
let settlement;
let radiusDialPosition = 0;
let radiusDialInput = false;
let heat = null;
let heatRequest;
let actionMessage;

const isVintage = () => globeStyle.value === 'vintage';
const activeView = () => isVintage() ? vintage : globe;

initLanguage();
const cityPicker = createCityPicker(element('city-picker'), dataUrl, async place => {
  if (isVintage() && Math.abs(place.lat) > vintageLimit) {
    globeStyle.value = 'atlas';
    await activateMap();
    if (isVintage()) return;
  }
  flyTo(place.lat, place.lon, place);
}, (lat, lon) => countryAt(lat, lon).code);

try {
  const saved = localStorage.getItem(styleKey);
  if (saved === 'desk') {
    globeStyle.value = 'vintage';
    localStorage.setItem(styleKey, globeStyle.value);
  } else if ([...globeStyle.options].some(option => option.value === saved)) globeStyle.value = saved;
} catch { /* Storage can be unavailable in private or embedded contexts. */ }
const tuner = createTuner(dataUrl, curated, radius => {
  scanRadius = radius;
  activeView()?.setScanRadius(radius);
  if (!radiusDialInput) radiusDialPosition = radiusSlider.valueAsNumber;
  radiusDial.style.setProperty('--turn', `${radiusSlider.valueAsNumber / Number(radiusSlider.max) * 270 - 135}deg`);
  radiusDial.setAttribute('aria-valuenow', String(element('radius').valueAsNumber));
  radiusDial.setAttribute('aria-valuetext', `${number(element('radius').valueAsNumber)} ${t('km')}`);
}, station => {
  fmCoverage = station;
  activeView()?.setFmCoverage(station);
}, station => {
  broadcast = station;
  globe?.setBroadcast(station);
});

function reportAction(message) {
  actionMessage = message;
  actionStatus.textContent = message ? t(message) : '';
}

const motion = createGlobeMotion({
  getView: activeView,
  getPosition: () => ({ lat: latitude, lon: longitude }),
  randomStation: () => tuner.randomStation(isVintage() ? vintageLimit : 89.9),
  tuneStation: station => {
    cityPicker.clear();
    if (!isVintage()) setZoom(0);
    showPosition(station.lat, station.lon);
    settlement = station.city ? { name: station.city } : null;
    const point = sightLocation();
    showPlace(point);
    tuner.aimAtStation(point, station);
  },
  onRandom: busy => {
    if (busy) {
      clearTimeout(tiltTimer);
      clearTimeout(previewTimer);
      previewTimer = undefined;
      cancelAnimationFrame(animation);
      reportAction(null);
    }
    const label = busy ? 'cancelSpin' : 'randomRadio';
    const tip = busy ? 'cancelSpin' : 'randomHelp';
    randomButton.toggleAttribute('data-spinning', busy);
    randomButton.dataset.i18nAriaLabel = label;
    randomButton.setAttribute('aria-label', t(label));
    randomTip.dataset.i18n = tip;
    randomTip.textContent = t(tip);
  },
  onUnavailable: () => reportAction('randomUnavailable'),
  randomButton,
});

autoButton.addEventListener('click', () => {
  const enabled = autoButton.getAttribute('aria-pressed') !== 'true';
  autoButton.setAttribute('aria-pressed', String(enabled));
  motion.setAuto(enabled);
});

heatButton.addEventListener('click', async () => {
  const enabled = heatButton.getAttribute('aria-pressed') !== 'true';
  heatButton.setAttribute('aria-pressed', String(enabled));
  reportAction(null);
  if (!enabled) {
    heatButton.removeAttribute('aria-busy');
    element('heat-key').hidden = true;
    activeView()?.setHeat(null);
    return;
  }
  heatButton.setAttribute('aria-busy', 'true');
  try {
    heatRequest ??= tuner.heatLocations().then(indexRadioHeat);
    heat = await heatRequest;
    if (heatButton.getAttribute('aria-pressed') !== 'true') return;
    element('heat-key').hidden = false;
    activeView()?.setHeat(heat);
  } catch {
    heatRequest = null;
    heatButton.setAttribute('aria-pressed', 'false');
    reportAction('heatUnavailable');
  } finally {
    heatButton.removeAttribute('aria-busy');
  }
});

wireDial(radiusDial, degrees => {
  const max = Number(radiusSlider.max);
  radiusDialPosition = Math.min(max, Math.max(0, radiusDialPosition + degrees * max / 270));
  const index = Math.round(radiusDialPosition);
  if (radiusSlider.valueAsNumber === index) return;
  radiusSlider.value = String(index);
  radiusDialInput = true;
  radiusSlider.dispatchEvent(new Event('input'));
  radiusDialInput = false;
}, () => radiusSlider.dispatchEvent(new Event('change')), { keyStep: 3 });

function updateClock() {
  const localTime = element('local-time');
  localTime.hidden = !clock;
  if (clock) localTime.textContent = clock.format();
}

function renderPlace(country, city) {
  element('country').textContent = country ?? '';
  const place = settlement ?? city;
  element('place').textContent = place ? placeName(place.name, place.id) : country ?? t('openWater');
  element('country').hidden = !city && !settlement;
  clock = city && new Intl.DateTimeFormat(currentLanguage(), { timeZone: city.zone, hour: '2-digit', minute: '2-digit' });
  updateClock();
  element('fact').hidden = !city;
  if (city) {
    const [title, text] = currentLanguage() === 'en' ? city.enFact : city.fact;
    element('fact-title').textContent = title;
    element('fact-text').textContent = text;
    element('fact-source').href = city.fact[2];
  }
}

function countryAt(lat, lon) {
  const point = [lon, lat];
  const entry = countries?.find(({ south, north, country }) => lat >= south && lat <= north && geoContains(country, point));
  const place = entry?.country;
  const code = iso31661NumericToAlpha2[place?.id] ?? (!countries ? home.country : undefined);
  return { onLand: Boolean(entry) || !countries, place, code };
}

function sightLocation() {
  return { lat: latitude, lon: longitude, ...countryAt(latitude, longitude) };
}

function showPlace({ place, code } = sightLocation()) {
  const country = code ? regionName(code) : place?.properties.name;
  const city = cities.find(item => item.country === code
    && distanceKm(latitude, longitude, item.lat, item.lon) < (settlement ? 5 : 10));
  renderPlace(country, city);
}

function tune(place) {
  settlement = place;
  const point = sightLocation();
  showPlace(point);
  tuner.locate(point);
}

function updateMapText() {
  element('map-hint').textContent = t(isVintage() ? 'lensAim' : 'globeHelp');
  const scale = `${number(zoom)}×`;
  zoomReset.textContent = scale;
  zoomReset.setAttribute('aria-label', t('zoomValue', { zoom: scale }));
}

function updatePlaceNames() {
  if (currentLanguage() !== 'en') return;
  loadPlaceNames(dataUrl).then(() => {
    if (currentLanguage() !== 'en') return;
    showPlace();
    activeView()?.look(latitude, longitude);
  }).catch(() => {});
}

onLanguageChange(() => {
  showPlace();
  reportAction(actionMessage);
  updateMapText();
  radiusDial.setAttribute('aria-valuetext', `${number(element('radius').valueAsNumber)} ${t('km')}`);
  activeView()?.look(latitude, longitude);
  updatePlaceNames();
});

function updateCoordinates() {
  const precision = isVintage() || zoom >= 16 ? 4 : zoom >= 4 ? 3 : 2;
  element('coords').textContent = `${Math.abs(latitude).toFixed(precision)}° ${latitude < 0 ? 'S' : 'N'} · ${Math.abs(longitude).toFixed(precision)}° ${longitude < 0 ? 'W' : 'E'}`;
}

function showPosition(lat, lon) {
  const limit = isVintage() ? vintageLimit : 89.9;
  latitude = Math.max(-limit, Math.min(limit, lat));
  longitude = wrapLongitude(lon);
  activeView()?.look(latitude, longitude);
  updateCoordinates();
}

function setZoom(level) {
  zoomLevel = Math.max(0, Math.min(maxZoomLevel, level));
  zoom = 2 ** zoomLevel;
  globe?.setZoom(zoom);
  updateMapText();
  zoomReset.disabled = zoomLevel <= 0;
  zoomOut.disabled = zoomLevel <= 0;
  zoomIn.disabled = zoomLevel >= maxZoomLevel;
  updateCoordinates();
}

function queueTune() {
  clearTimeout(tiltTimer);
  tiltTimer = setTimeout(finishTuning, 180);
}

function queuePreview() {
  if (previewTimer !== undefined) return;
  previewTimer = setTimeout(() => {
    previewTimer = undefined;
    tuner.preview(sightLocation());
  }, 65);
}

function finishTuning() {
  clearTimeout(previewTimer);
  previewTimer = undefined;
  tune();
}

function flyTo(lat, lon, settlement) {
  clearTimeout(tiltTimer);
  clearTimeout(previewTimer);
  previewTimer = undefined;
  cancelAnimationFrame(animation);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showPosition(lat, lon);
    tune(settlement);
    return;
  }
  const startLat = latitude;
  const startLon = longitude;
  const deltaLon = wrapLongitude(lon - startLon);
  const startTime = performance.now();

  function step(now) {
    const progress = Math.min((now - startTime) / 500, 1);
    const eased = 1 - (1 - progress) ** 3;
    showPosition(startLat + (lat - startLat) * eased, startLon + deltaLon * eased);
    if (progress < 1) animation = requestAnimationFrame(step);
    else tune(settlement);
  }
  animation = requestAnimationFrame(step);
}

function wireGlobe() {
  globeElement.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer || event.target.closest('.map-overlay-control')) return;
    clearTimeout(tiltTimer);
    cancelAnimationFrame(animation);
    const label = event.target.closest('.settlement');
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lat: latitude, lon: longitude, moved: false, label };
    if (!label) globeElement.setPointerCapture(event.pointerId);
  });
  globeElement.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer?.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      pointer.moved = true;
      globeElement.setPointerCapture(event.pointerId);
    }
    globeElement.classList.add('dragging');
    cityPicker.clear();
    const degreesPerPixel = 175 / (Math.min(globeElement.clientHeight, globeElement.clientWidth) * zoom);
    showPosition(pointer.lat + dy * degreesPerPixel, pointer.lon - dx * degreesPerPixel);
    queuePreview();
  });

  function endGesture(event) {
    if (event.pointerId !== pointer?.id) return;
    const clicked = !pointer.moved && event.type === 'pointerup';
    const label = pointer.label;
    pointer = null;
    globeElement.classList.remove('dragging');
    if (clicked && label) return;
    const point = clicked && globe.locationAt(event.clientX, event.clientY);
    if (point) {
      cityPicker.clear();
      flyTo(point.lat, point.lon);
    } else {
      finishTuning();
    }
  }

  globeElement.addEventListener('pointerup', endGesture);
  globeElement.addEventListener('pointercancel', endGesture);
  globeElement.addEventListener('lostpointercapture', endGesture);
  globeElement.addEventListener('wheel', event => {
    event.preventDefault();
    const step = Math.min(0.6, Math.abs(event.deltaY) / (event.deltaMode === 0 ? 160 : 6));
    setZoom(zoomLevel - Math.sign(event.deltaY) * step);
  }, { passive: false });
  zoomIn.addEventListener('click', () => setZoom(zoomLevel + 1));
  zoomOut.addEventListener('click', () => setZoom(zoomLevel - 1));
  zoomReset.addEventListener('click', () => setZoom(0));
  const arrows = { ArrowUp: [4, 0], ArrowDown: [-4, 0], ArrowLeft: [0, -4], ArrowRight: [0, 4] };
  globeElement.addEventListener('keydown', event => {
    if (event.target !== globeElement) return;
    if (event.key === 'Home') {
      event.preventDefault();
      setZoom(0);
      return;
    }
    if (['+', '=', '-', '−'].includes(event.key)) {
      event.preventDefault();
      setZoom(zoomLevel + (event.key === '+' || event.key === '=' ? 1 : -1));
      return;
    }
    const offset = arrows[event.key];
    if (!offset) return;
    event.preventDefault();
    cancelAnimationFrame(animation);
    cityPicker.clear();
    showPosition(latitude + offset[0] / zoom, longitude + offset[1] / zoom);
    queuePreview();
    queueTune();
  });

  globeElement.setAttribute('aria-busy', 'false');
}

async function loadClassic() {
  const image = new Image();
  image.src = `${dataUrl}earth.jpg`;
  const [relief, { createGlobe }] = await Promise.all([image.decode().then(() => image).catch(() => null), import('./globe')]);
  globe = createGlobe(globeElement, relief, geography, dataUrl, isVintage() ? 'atlas' : globeStyle.value, place => {
    cityPicker.clear();
    flyTo(place.lat, place.lon, place);
  });
  wireGlobe();
  return globe;
}

async function loadVintage() {
  const { createVintage, maxVintageLatitude } = await import('./vintage');
  vintageLimit = maxVintageLatitude;
  vintage = await createVintage(vintageElement, dataUrl, geography, (lat, lon, commit) => {
    cancelAnimationFrame(animation);
    cityPicker.clear();
    latitude = lat;
    longitude = lon;
    updateCoordinates();
    if (commit) finishTuning();
    else queuePreview();
  }, point => {
    cityPicker.clear();
    flyTo(point.lat, point.lon);
  });
  return vintage;
}

function placeControls() {
  const mechanical = isVintage();
  mapCard.dataset.mapStyle = globeStyle.value;
  document.documentElement.dataset.globeView = globeStyle.value;
  vintageElement.hidden = !mechanical;
  globeElement.hidden = mechanical;
  element('map-zoom').hidden = mechanical;
  radiusSlider.hidden = mechanical;
  radiusDial.hidden = !mechanical;
  element('radius-label').htmlFor = mechanical ? 'radius-dial' : 'radius-slider';
  if (mechanical) {
    mapIndicator.append(mapActions);
    element('vintage-switches').append(...motionActions);
    element('vintage-radius').append(radiusControl);
  } else {
    mapToolbar.after(mapActions);
    heatAction.after(...motionActions);
    radiusHome.insertBefore(radiusControl, radiusHome.querySelector('.name-control'));
  }
  updateMapText();
  updateCoordinates();
}

async function activateMap() {
  motion.stop();
  randomButton.disabled = true;
  clearTimeout(tiltTimer);
  clearTimeout(previewTimer);
  previewTimer = undefined;
  cancelAnimationFrame(animation);
  const style = globeStyle.value;
  placeControls();
  try {
    const view = isVintage() ? await (vintageRequest ??= loadVintage()) : await (globeRequest ??= loadClassic());
    if (style !== globeStyle.value) return;
    if (!isVintage()) {
      view.setStyle(style);
      setZoom(zoomLevel);
    }
    view.setScanRadius(scanRadius);
    view.setFmCoverage(fmCoverage);
    view.setBroadcast?.(broadcast);
    view.setHeat(heatButton.getAttribute('aria-pressed') === 'true' ? heat : null);
    if (isVintage() && Math.abs(latitude) > vintageLimit) {
      cityPicker.clear();
      settlement = null;
    }
    showPosition(latitude, longitude);
    jump.disabled = false;
    randomButton.disabled = false;
    tune(settlement);
  } catch {
    if (style !== globeStyle.value) return;
    if (!isVintage()) {
      globeRequest = null;
      globeElement.setAttribute('aria-busy', 'false');
      element('map-error').hidden = false;
      return;
    }
    vintageRequest = null;
    globeStyle.value = 'atlas';
    await activateMap();
  }
}

setInterval(updateClock, 10000);
placeControls();
tune();
updatePlaceNames();

const atlas = await fetch(`${dataUrl}countries-50m.json`).then(response => response.ok ? response.json() : null).catch(() => null);

if (atlas) {
  const shapes = feature(atlas, atlas.objects.countries).features;
  countries = shapes.map(country => {
    const [[, south], [, north]] = geoBounds(country);
    return { country, south, north };
  });
  const borders = mesh(atlas, atlas.objects.countries, (left, right) => left !== right);
  const land = feature(atlas, atlas.objects.land);
  geography = { borders, land, countries: shapes };
  globeStyle.addEventListener('change', () => {
    try { localStorage.setItem(styleKey, globeStyle.value); } catch { /* Keep the choice for this page. */ }
    setZoom(0);
    activateMap();
  });
  await activateMap();
} else {
  globeStyle.disabled = true;
  vintageElement.hidden = true;
  globeElement.hidden = false;
  globeElement.setAttribute('aria-busy', 'false');
  element('map-error').hidden = false;
}
