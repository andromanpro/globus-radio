import { geoDistance } from 'd3-geo';

export const earthRadiusKm = 6371.0088;
export const radians = Math.PI / 180;
export const wrapLongitude = longitude => ((longitude + 180) % 360 + 360) % 360 - 180;
export const distanceKm = (lat, lon, pointLat, pointLon) => geoDistance([lon, lat], [pointLon, pointLat]) * earthRadiusKm;
export const viewportAngle = (width, height, radius) => Math.asin(Math.min(1, Math.hypot(width, height) / (radius * 2)));

export function visibleTiles(lat, lon, angle, tileSize = 5) {
  const columns = 360 / tileSize;
  const delta = angle / radians;
  const south = Math.max(0, Math.min(180 / tileSize - 1, Math.floor((lat - delta + 90) / tileSize)));
  const north = Math.min(180 / tileSize - 1, Math.floor((lat + delta + 90) / tileSize));
  const span = delta + Math.abs(lat) >= 90 ? 180 : Math.asin(Math.min(1, Math.sin(angle) / Math.cos(lat * radians))) / radians;
  const west = Math.floor((lon - span + 180) / tileSize);
  const count = Math.min(columns, Math.floor((lon + span + 180) / tileSize) - west + 1);
  const ids = [];
  for (let row = south; row <= north; row++) {
    for (let index = 0; index < count; index++) {
      ids.push(row * columns + (west + index + columns) % columns);
    }
  }
  return ids;
}

export async function loadGzipJson(url) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Failed to load ${url}`);
  if (response.headers.get('Content-Encoding')?.includes('gzip')) return response.json();
  const source = response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(source).json();
}
