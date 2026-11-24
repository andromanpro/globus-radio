import { DataTexture, LinearFilter, Mesh, RepeatWrapping, ShaderMaterial } from 'three';

const driftPeriodMs = 130000;
const windPeriodMs = 42000;

export function loadCloudDensity() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cloud-density.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      resolve(data);
    };
    worker.onerror = error => {
      worker.terminate();
      reject(error);
    };
  });
}

export function createSatelliteClouds(geometry, { density, width, height }) {
  const map = new DataTexture(density, width, height);
  map.wrapS = RepeatWrapping;
  map.minFilter = map.magFilter = LinearFilter;
  map.needsUpdate = true;
  const material = new ShaderMaterial({
    uniforms: {
      map: { value: map },
      amount: { value: 0 },
      drift: { value: 0 },
      windPhase: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 cloudUv;
      varying vec3 viewNormal;
      void main() {
        cloudUv = uv;
        viewNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float amount;
      uniform float drift;
      uniform float windPhase;
      varying vec2 cloudUv;
      varying vec3 viewNormal;
      void main() {
        vec3 n = normalize(viewNormal);
        float latitude = (cloudUv.y - .5) * 3.14159265;
        float windShift = .014 * sin(3.0 * latitude) * sin(windPhase + 2.0 * latitude);
        vec2 uv = cloudUv + vec2(drift + windShift, 0.);
        vec2 density = texture2D(map, uv).rg;
        float neighbour = texture2D(map, uv + vec2(-.0031, .0023)).r;
        float relief = clamp(.72 + .80 * (density.r - neighbour), .28, 1.0);
        float sun = max(0.0, dot(n, normalize(vec3(-.43, .62, .83))));
        vec3 cloud = mix(vec3(.52, .66, .78), vec3(1., .995, .97), (.4 + .6 * sun) * relief);
        float edge = smoothstep(.05, .34, n.z);
        float opacity = max(.79 * density.r, .23 * density.g);
        gl_FragColor = vec4(cloud, amount * edge * opacity);
      }
    `,
  });
  const mesh = new Mesh(geometry, material);
  mesh.scale.setScalar(1.009);
  return {
    mesh,
    paint(time, amount) {
      mesh.visible = amount > 0;
      material.uniforms.amount.value = amount;
      material.uniforms.drift.value = (time % driftPeriodMs) / driftPeriodMs;
      material.uniforms.windPhase.value = 2 * Math.PI * (time % windPeriodMs) / windPeriodMs;
    },
  };
}
