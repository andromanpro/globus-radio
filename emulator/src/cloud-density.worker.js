const width = 1024;
const height = 512;
const tau = 2 * Math.PI;
const density = new Uint8Array(width * height * 4);

function lattice(x, y, z) {
  const seed = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  const mixed = Math.imul(seed ^ (seed >>> 13), 1274126177);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967295;
}

const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const ramp = (a, b, x) => smooth(Math.max(0, Math.min(1, (x - a) / (b - a))));

function noise(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const a = smooth(x - ix);
  const b = smooth(y - iy);
  const c = smooth(z - iz);
  return mix(
    mix(mix(lattice(ix, iy, iz), lattice(ix + 1, iy, iz), a),
      mix(lattice(ix, iy + 1, iz), lattice(ix + 1, iy + 1, iz), a), b),
    mix(mix(lattice(ix, iy, iz + 1), lattice(ix + 1, iy, iz + 1), a),
      mix(lattice(ix, iy + 1, iz + 1), lattice(ix + 1, iy + 1, iz + 1), a), b),
    c);
}

function cloudAt(x, y, z, offset) {
  // Sample on the sphere so the weather fields join at both the seam and poles.
  const dx = x + .26 * (noise(x * 3 + 9, y * 5, z * 3) - .5);
  const dy = y + .24 * (noise(x * 4, y * 3 + 7, z * 4) - .5);
  const dz = z + .26 * (noise(x * 3, y * 5, z * 3 + 9) - .5);
  const fronts = noise(dx * 5, dy * 12, dz * 5);
  const weather = noise(x * 3 + 26, y * 4, z * 3 + 5);
  const small = noise(dx * 17 + 8, dy * 23, dz * 17);
  const fine = noise(dx * 42, dy * 49 + 8, dz * 42);
  const grain = noise(dx * 95, dy * 106, dz * 95 + 4);
  const tropics = 1 - ramp(.05, .23, Math.abs(dy));
  const dryBelt = ramp(.18, .35, Math.abs(dy)) * (1 - ramp(.43, .62, Math.abs(dy)));
  const shape = .32 * fronts + .27 * weather + .22 * small + .12 * fine + .07 * grain;
  density[offset] = Math.round(255 * ramp(.48, .685, shape + .065 * tropics - .074 * dryBelt));
  const filaments = noise(dx * 12, dy * 49, dz * 12 + 12);
  density[offset + 1] = Math.round(255 * ramp(.51, .72, .47 * filaments + .25 * small + .28 * weather));
  density[offset + 3] = 255;
}

for (let row = 0; row < height; row++) {
  const latitude = ((row + .5) / height - .5) * Math.PI;
  const y = Math.sin(latitude);
  const ring = Math.cos(latitude);
  for (let col = 0; col < width; col++) {
    const lon = ((col + .5) / width - .5) * tau;
    cloudAt(ring * Math.sin(lon), y, ring * Math.cos(lon), (row * width + col) * 4);
  }
}

self.postMessage({ density, width, height }, [density.buffer]);
