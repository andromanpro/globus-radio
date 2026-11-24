import { viewportAngle, visibleTiles } from './geo';
import { loadMapData } from './map-data';
import { placeName } from './place-names';

const detailZoom = 8;
const labelLimit = 42;
const byImportance = (left, right) => right[5] - left[5] || right[4] - left[4];

function minimumPopulation(zoom) {
  if (zoom < 2.5) return 450000;
  if (zoom < 4) return 170000;
  if (zoom < detailZoom) return 60000;
  if (zoom < 16) return 15000;
  if (zoom < 32) return 4000;
  if (zoom < 55) return 1000;
  return 0;
}

export function createSettlementLabels(element, dataUrl, onSelect, redraw) {
  const buttons = new Map();
  let major;
  let detailed;
  let neighborhoodKey;
  let neighborhood;
  const requested = new Set();

  function load(filename, assign) {
    if (requested.has(filename)) return;
    requested.add(filename);
    loadMapData(dataUrl, filename).then(places => {
      assign(places);
      redraw();
    }).catch(() => {});
  }

  function placeButton(id, name, lat, lon) {
    let button = buttons.get(id);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'settlement';
      button.dataset.placeId = id;
      button.addEventListener('click', () => onSelect({ id, name, lat, lon }));
      element.append(button);
      buttons.set(id, button);
    }
    const label = placeName(name, id);
    if (button.textContent !== label) button.textContent = label;
    return button;
  }

  return function render(zoom, lat, lon, width, height, radius, project, enabled = true) {
    element.hidden = !enabled || zoom < 1.5;
    if (element.hidden) return;
    load('major-places.json.gz', places => { major = places.sort(byImportance); });
    if (zoom >= detailZoom) load('settlements.json.gz', index => { detailed = index; });
    let places = major ?? [];
    if (zoom >= detailZoom && detailed) {
      const tiles = visibleTiles(lat, lon, viewportAngle(width, height, radius));
      const key = tiles.join(',');
      if (key !== neighborhoodKey) {
        neighborhoodKey = key;
        neighborhood = tiles.flatMap(id => detailed[id] ?? []).sort(byImportance);
      }
      places = neighborhood;
    }
    const minimum = minimumPopulation(zoom);
    const limit = Math.min(labelLimit, Math.max(8, Math.floor(width * height / (zoom < 16 ? 21000 : 11000))));
    const visible = new Set();
    const occupied = [];
    for (const row of places) {
      if (occupied.length >= limit) break;
      const [id, name, pointLat, pointLon, population, rank] = row;
      if (!rank && population < minimum) continue;
      const point = project(pointLat, pointLon);
      if (point.z <= 0 || point.x < 12 || point.x > width - 25 || point.y < 15 || point.y > height - 12) continue;
      const textWidth = Math.min(175, 14 + placeName(name, id).length * 6.9);
      const onLeft = point.x + textWidth > width - 6;
      const left = onLeft ? point.x - textWidth : point.x;
      const right = left + textWidth;
      if (occupied.some(other => Math.abs(other.y - point.y) < 22 && left < other.right && right > other.left)) continue;
      occupied.push({ y: point.y, left, right });
      const button = placeButton(id, name, pointLat, pointLon);
      button.style.translate = `${Math.round(point.x)}px ${Math.round(point.y)}px`;
      button.classList.toggle('align-left', onLeft);
      visible.add(id);
    }
    for (const [id, button] of buttons) {
      if (visible.has(id)) continue;
      button.remove();
      buttons.delete(id);
    }
  };
}
