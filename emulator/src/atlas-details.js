import { earthRadiusKm, loadGzipJson, radians, visibleTiles } from './geo';
import { loadMapData } from './map-data';

const cacheSize = 32;

function indexHoles(tile) {
  for (const layer of ['built', 'lakes']) {
    for (const shape of tile[layer] ?? []) {
      const rings = shape[4];
      if (rings.length === 1) continue;
      const holes = rings.splice(1).map(ring => {
        let west = Infinity;
        let south = Infinity;
        let east = -Infinity;
        let north = -Infinity;
        for (let index = 0; index < ring.length; index += 2) {
          west = Math.min(west, ring[index]);
          south = Math.min(south, ring[index + 1]);
          east = Math.max(east, ring[index]);
          north = Math.max(north, ring[index + 1]);
        }
        return [west, south, east, north, ring];
      });
      shape.push(holes);
    }
  }
  return tile;
}

export function createAtlasDetails(dataUrl, redraw, name = 'lens-atlas', tileSize = 5) {
  const directory = `${dataUrl}${name}/`;
  const cache = new Map();
  const requests = new Set();
  let available;
  let visible = [];

  loadMapData(directory, 'index.json.gz').then(ids => {
    available = new Set(ids);
    redraw();
  }).catch(() => {});

  function load(id) {
    if (!available.has(id) || requests.has(id) || cache.has(id)) return;
    requests.add(id);
    loadGzipJson(`${directory}${id}.json.gz`).then(indexHoles).catch(() => null).then(tile => {
      requests.delete(id);
      cache.set(id, tile);
      if (cache.size > cacheSize) {
        const oldest = [...cache.keys()].find(key => !visible.includes(key));
        if (oldest !== undefined) cache.delete(oldest);
      }
      if (tile && visible.includes(id)) redraw();
    });
  }

  return function detailAt(lat, lon, angle, complete = false) {
    if (!available) return complete ? null : [];
    visible = visibleTiles(lat, lon, angle, tileSize);
    const tiles = [];
    for (const id of visible) {
      load(id);
      const tile = cache.get(id);
      if (tile) {
        cache.delete(id);
        cache.set(id, tile);
        tiles.push(tile);
      }
    }
    for (const id of visibleTiles(lat, lon, angle + .5 * radians, tileSize)) load(id);
    if (complete && visible.some(id => available.has(id) && !cache.get(id))) return null;
    return tiles;
  };
}

export function drawAtlasDetails(context, projection, tiles, palette, lat, lon, angle) {
  const latitudeSpan = angle / radians;
  const cosLat = Math.cos(lat * radians);
  const crossesPole = Math.abs(lat) + latitudeSpan >= 90;
  const longitudeScale = crossesPole ? Math.sin(angle) : cosLat;
  const longitudeSpan = crossesPole ? Infinity : Math.asin(Math.sin(angle) / cosLat) / radians;
  const tileBounds = tiles.map(tile => {
    const centre = lon + 360 * Math.round((tile.longitude - lon) / 360);
    return { tile, west: centre - longitudeSpan, east: centre + longitudeSpan };
  });
  const south = lat - latitudeSpan;
  const north = lat + latitudeSpan;
  const degreesPerPixel = 1 / (projection.scale() * radians);
  const wide = angle * earthRadiusKm >= 80;
  const minArea = (degreesPerPixel * (wide ? 4 : 1)) ** 2;
  const minStep = degreesPerPixel * (wide ? 1.5 : .7);

  function trace(ring, closed, omitTileEdges = false) {
    let longitude = ring[0];
    let latitude = ring[1];
    const [x, y] = projection([longitude, latitude]);
    context.moveTo(x, y);
    for (let index = 2; index < ring.length; index += 2) {
      const nextLongitude = ring[index];
      const nextLatitude = ring[index + 1];
      const cut = omitTileEdges && ((nextLongitude === ring[index - 2] && Number.isInteger(nextLongitude / 5))
        || (nextLatitude === ring[index - 1] && Number.isInteger(nextLatitude / 5)));
      if (!cut && index + 2 < ring.length
        && Math.abs(nextLongitude - longitude) * longitudeScale + Math.abs(nextLatitude - latitude) < minStep) continue;
      longitude = nextLongitude;
      latitude = nextLatitude;
      const [left, top] = projection([longitude, latitude]);
      if (cut) context.moveTo(left, top);
      else context.lineTo(left, top);
    }
    if (closed) context.closePath();
  }

  function layer(group, lineWidth, scaleWidth = 0) {
    const outline = group === 'built' && palette.builtOutline;
    if (lineWidth) context.strokeStyle = palette[group];
    else context.fillStyle = palette[group];
    for (const { tile, west, east } of tileBounds) {
      for (const [left, bottom, right, top, paths, metres, holes] of tile[group] ?? []) {
        if (right < west || left > east || top < south || bottom > north) continue;
        const spanX = (right - left) * longitudeScale;
        const spanY = top - bottom;
        if (lineWidth ? Math.max(spanX, spanY) < degreesPerPixel : spanX * spanY < minArea) continue;
        context.beginPath();
        for (const ring of paths) trace(ring, !lineWidth);
        if (holes) {
          for (const [left, bottom, right, top, ring] of holes) {
            if (right < west || left > east || top < south || bottom > north) continue;
            if ((right - left) * longitudeScale * (top - bottom) >= minArea) trace(ring, true);
          }
        }
        if (lineWidth) {
          context.lineWidth = Math.max(lineWidth, metres * scaleWidth);
          context.stroke();
        } else {
          context.fill();
          if (outline) {
            // Preserve the perimeter of split features while dropping their synthetic straight edges.
            if ([left, bottom, right, top].some(value => Number.isInteger(value / 5))) {
              context.beginPath();
              for (const ring of paths) trace(ring, false, true);
            }
            context.strokeStyle = outline;
            context.lineWidth = .72;
            context.stroke();
          }
        }
      }
    }
  }

  context.save();
  context.lineJoin = context.lineCap = 'round';
  layer('built');
  layer('rivers', 1, projection.scale() / (earthRadiusKm * 1000));
  layer('lakes');
  layer('roads', palette.roadWidth ?? 1.6);
  context.restore();
}
