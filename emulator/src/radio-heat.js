import { radians, viewportAngle, visibleTiles, wrapLongitude } from './geo';

const rounding = [5, 1, .2, .04];
const hue = [[255, 215, 67], [255, 135, 45], [239, 40, 64]];
const denseStationCount = [600, 140, 50, 24];

export function indexRadioHeat(stations) {
  return rounding.map(step => {
    const bins = new Map();
    for (const { lat, lon: longitude } of stations) {
      const lon = wrapLongitude(longitude);
      const row = Math.floor((lat + 90) / step);
      const col = Math.floor((lon + 180) / step);
      const key = `${row}/${col}`;
      if (!bins.has(key)) bins.set(key, { lat: 0, lon: 0, count: 0 });
      const bin = bins.get(key);
      bin.lat += lat;
      bin.lon += lon;
      bin.count++;
    }
    const regions = new Map();
    const points = [...bins.values()].map(({ lat, lon, count }) => ({ lat: lat / count, lon: lon / count, count }));
    for (const point of points) {
      const id = visibleTiles(point.lat, point.lon, 0)[0];
      if (!regions.has(id)) regions.set(id, []);
      regions.get(id).push(point);
    }
    return { points, regions };
  });
}

function gradientCanvas() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  let field;
  let image;
  return {
    draw(width, height, maximum, stamp) {
      if (!field || canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        field = new Float32Array(width * height);
        image = context.createImageData(width, height);
      }
      field.fill(0);
      stamp((x, y, radius, count) => {
        const bottom = Math.min(height - 1, Math.floor(y + radius));
        const right = Math.min(width - 1, Math.floor(x + radius));
        const inverseRadiusSquared = 1 / (radius * radius);
        for (let row = Math.max(0, Math.ceil(y - radius)); row <= bottom; row++) {
          const dy = row - y;
          for (let col = Math.max(0, Math.ceil(x - radius)); col <= right; col++) {
            const dx = col - x;
            const weight = 1 - (dx * dx + dy * dy) * inverseRadiusSquared;
            if (weight > 0) field[row * width + col] += count * weight ** 3;
          }
        }
      });
      const pixels = image.data;
      const logMax = Math.log1p(maximum);
      for (let index = 0; index < field.length; index++) {
        const offset = index * 4;
        const total = field[index];
        if (total < .035) {
          pixels[offset + 3] = 0;
          continue;
        }
        const intensity = Math.min(1, Math.log1p(total) / logMax);
        const band = intensity < .62 ? 0 : 1;
        const mix = band ? (intensity - .62) / .38 : intensity / .62;
        for (let channel = 0; channel < 3; channel++) {
          pixels[offset + channel] = hue[band][channel] * (1 - mix) + hue[band + 1][channel] * mix;
        }
        pixels[offset + 3] = Math.round(182 * intensity ** .78 * Math.min(1, total));
      }
      context.putImageData(image, 0, 0);
      return canvas;
    },
  };
}

export function createRadioHeatPainter() {
  const buffer = gradientCanvas();
  return function drawHeat(index, lat, lon, width, height, radius) {
    const angle = viewportAngle(width, height, radius);
    const degrees = angle / radians;
    const level = degrees > 27 ? 0 : degrees > 7 ? 1 : degrees > 1.65 ? 2 : 3;
    const { points, regions } = index[level];
    const visible = level === 0 ? points : visibleTiles(lat, lon, angle + .6 * radians).flatMap(id => regions.get(id) ?? []);
    const sinLat = Math.sin(lat * radians);
    const cosLat = Math.cos(lat * radians);
    const w = Math.max(1, Math.ceil(width / 3));
    const h = Math.max(1, Math.ceil(height / 3));
    const stencil = Math.max(5, Math.min(9, Math.min(w, h) * .036));
    return buffer.draw(w, h, denseStationCount[level], mark => {
      for (const point of visible) {
        const phi = point.lat * radians;
        const lambda = (point.lon - lon) * radians;
        const cos = Math.cos(phi);
        const sin = Math.sin(phi);
        const facing = sinLat * sin + cosLat * cos * Math.cos(lambda);
        if (facing <= .015) continue;
        const x = w / 2 + cos * Math.sin(lambda) * radius * w / width;
        const y = h / 2 - (cosLat * sin - sinLat * cos * Math.cos(lambda)) * radius * h / height;
        if (x < -stencil || x > w + stencil || y < -stencil || y > h + stencil) continue;
        mark(x, y, stencil, point.count * Math.sqrt(facing));
      }
    });
  };
}

export function radioHeatTexture(index) {
  const width = 720;
  const height = 360;
  const buffer = gradientCanvas();
  return buffer.draw(width, height, denseStationCount[0], mark => {
    for (const { lat, lon, count } of index[0].points) {
      const x = (lon + 180) * width / 360;
      const y = (90 - lat) * height / 180;
      const radius = 12;
      mark(x, y, radius, count);
      if (x < radius) mark(x + width, y, radius, count);
      if (x > width - radius) mark(x - width, y, radius, count);
    }
  });
}
