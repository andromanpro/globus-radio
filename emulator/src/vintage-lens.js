import { geoCircle, geoDistance, geoGraticule, geoOrthographic, geoPath } from 'd3-geo';
import { earthRadiusKm, radians, visibleTiles } from './geo';
import { number, t } from './i18n';
import { createRadioHeatPainter } from './radio-heat';
import { createAtlasDetails, drawAtlasDetails } from './atlas-details';
import { loadMapData } from './map-data';
import { placeName } from './place-names';

const colours = {
  water: '#ead69e', land: '#cba974', coast: '#796044', border: '#977347', grid: '#98744949',
};
const detail = { built: '#b58a62', rivers: '#829b96', lakes: '#8ea7a2', roads: '#f7dfaf' };
const detailLimitKm = 180;
const width = 384;
const centre = width / 2;
const aperture = centre - 3;

export function createVintageLens(canvas, scaleLabel, geography, dataUrl, redraw) {
  const map = document.createElement('canvas');
  map.width = map.height = width;
  const context = map.getContext('2d');
  const preview = canvas.getContext('2d');
  const projection = geoOrthographic().translate([centre, centre]).precision(.35);
  const path = geoPath(projection, context);
  const graticules = [5, 15].map(step => geoGraticule().step([step, step])());
  const detailAt = createAtlasDetails(dataUrl, redraw);
  let major = [];
  let detailed;
  let tiles;
  let tileKey;
  let local;
  let viewAngle = 0;
  let mapCentre;

  function load(name, assign) {
    loadMapData(dataUrl, name).then(data => { assign(data); redraw(); }).catch(() => {});
  }

  load('major-places.json.gz', data => { major = data; tileKey = undefined; });
  load('settlements.json.gz', data => { detailed = data; tileKey = undefined; });
  load('map-10m-tiles.json.gz', data => { tiles = data; tileKey = undefined; });
  new ResizeObserver(redraw).observe(canvas);

  function shapes(lat, lon, highDetail) {
    const ids = visibleTiles(lat, lon, viewAngle);
    const key = `${highDetail}/${ids.join()}`;
    if (key === tileKey) return local;
    tileKey = key;
    const terrain = highDetail && tiles;
    const cells = terrain ? ids.map(id => tiles[id]).filter(Boolean) : [];
    local = {
      land: terrain ? { type: 'MultiPolygon', coordinates: cells.flatMap(cell => cell[0]) } : geography.land,
      coast: terrain ? { type: 'MultiLineString', coordinates: cells.flatMap(cell => cell[1]) } : geography.land,
      borders: terrain ? { type: 'MultiLineString', coordinates: cells.flatMap(cell => cell[2]) } : geography.borders,
      places: highDetail && detailed ? ids.flatMap(id => detailed[id] ?? []) : major,
    };
    return local;
  }

  function draw(shape, stroke, size, fill, dash = []) {
    context.beginPath();
    path(shape);
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    if (!stroke) return;
    context.strokeStyle = stroke;
    context.lineWidth = size;
    context.setLineDash(dash);
    context.stroke();
    context.setLineDash([]);
  }

  function drawPlaces(rows, windowKm) {
    const minimum = windowKm < 70 ? 1500 : windowKm < 200 ? 15000 : windowKm < 700 ? 65000 : 300000;
    const candidates = [];
    for (const [id, name, lat, lon, population, rank] of rows) {
      if (population < minimum && !rank) continue;
      const point = [lon, lat];
      const angle = geoDistance(mapCentre, point);
      if (angle > viewAngle) continue;
      candidates.push({ id, name, angle, point, rank, population });
    }
    candidates.sort((a, b) => b.rank - a.rank || b.population - a.population || a.angle - b.angle);

    const labels = [];
    const fontSize = Math.max(17, Math.ceil(11 * width / (canvas.clientWidth || width)));
    context.font = `600 ${fontSize}px system-ui, sans-serif`;
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    for (const { id, name: rawName, point } of candidates) {
      if (labels.length >= 12) break;
      const name = placeName(rawName, id);
      const [x, y] = projection(point);
      const central = Math.hypot(x - centre, y - centre) <= 10;
      const textWidth = Math.min(central ? 286 : 192, context.measureText(name).width);
      const left = central ? x - textWidth / 2 : x + 6 + textWidth > width - 6 ? x - textWidth - 6 : x + 6;
      const right = left + textWidth;
      const baseline = central ? y + fontSize + 12 : y;
      if (Math.hypot(left - centre, baseline - centre) > aperture - 7
        || Math.hypot(right - centre, baseline - centre) > aperture - 7) continue;
      if (labels.some(other => Math.abs(other.y - baseline) < fontSize + 5 && left < other.right + 3 && right > other.left - 3)) continue;
      labels.push({ left, right, y: baseline });
      context.fillStyle = '#39291e';
      context.beginPath();
      context.arc(x, y, 2.7, 0, 2 * Math.PI);
      context.fill();
      context.strokeStyle = '#fff1ce';
      context.lineWidth = 3.2;
      context.strokeText(name, left, baseline, textWidth);
      context.fillText(name, left, baseline, textWidth);
    }
  }

  let drawHeat;

  function paint(lat, lon, radius, fm, heat) {
    const windowKm = radius ? Math.max(18, radius * 1.4) : fm ? Math.min(1200, Math.max(70, fm.fm.maxKm * 1.5)) : 160;
    viewAngle = windowKm / earthRadiusKm;
    mapCentre = [lon, lat];
    projection.scale(aperture / Math.sin(viewAngle)).clipAngle(viewAngle / radians).rotate([-lon, -lat]);
    const closeMap = windowKm <= detailLimitKm;
    const { land, coast, borders, places } = shapes(lat, lon, windowKm < 500);
    context.clearRect(0, 0, width, width);
    context.save();
    context.beginPath();
    context.arc(centre, centre, aperture, 0, 2 * Math.PI);
    context.clip();
    context.fillStyle = closeMap ? '#8ea7a2' : colours.water;
    context.fillRect(0, 0, width, width);
    draw(land, null, 0, closeMap ? '#dbc08c' : colours.land);
    if (closeMap) drawAtlasDetails(context, projection, detailAt(lat, lon, viewAngle), detail, lat, lon, viewAngle);
    if (windowKm >= 300) draw(graticules[windowKm < 1700 ? 0 : 1], colours.grid, 1);
    draw(coast, colours.coast, 1.15);
    draw(borders, colours.border, 1.2);
    if (heat) {
      drawHeat ??= createRadioHeatPainter();
      context.drawImage(drawHeat(heat, lat, lon, width, width, projection.scale()), 0, 0, width, width);
    }
    if (radius) {
      const shape = geoCircle().center(mapCentre).radius(radius / earthRadiusKm / radians)();
      draw(shape, '#743720', 2.25, '#fdec972e', [6, 4]);
    } else if (fm) {
      const shape = fm.fm.contour ?? geoCircle().center([fm.lon, fm.lat]).radius(fm.fm.maxKm / earthRadiusKm / radians)();
      draw(shape, '#2c694e', 2.6, '#47825224');
    }
    drawPlaces(places, windowKm);
    context.restore();

    preview.clearRect(0, 0, width, width);
    preview.drawImage(map, 0, 0);
    preview.strokeStyle = '#503023';
    preview.lineWidth = 1.7;
    preview.beginPath();
    for (let index = 0; index < 4; index++) {
      const angle = index * Math.PI / 2;
      preview.moveTo(centre + 8 * Math.cos(angle), centre + 8 * Math.sin(angle));
      preview.lineTo(centre + 21 * Math.cos(angle), centre + 21 * Math.sin(angle));
    }
    preview.stroke();
    preview.beginPath();
    preview.arc(centre, centre, 4, 0, 2 * Math.PI);
    preview.stroke();
    scaleLabel.textContent = t(radius ? 'radiusCaption' : 'lensEdge', { distance: number(radius ?? windowKm) });
  }

  return {
    map,
    paint,
    pointAt(x, y) {
      if (!mapCentre || Math.hypot(x * width - centre, y * width - centre) > aperture) return null;
      const [lon, lat] = projection.invert([x * width, y * width]);
      return { lat, lon };
    },
  };
}
