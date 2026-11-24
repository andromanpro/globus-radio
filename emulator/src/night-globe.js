import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { radians } from './geo';

export const nightSurface = /* glsl */ `
  vec3 paintNight(vec2 uv, vec4 map, vec3 normal) {
    vec3 day = texture2D(relief, uv).rgb;
    float tone = dot(day, vec3(.28, .57, .15));
    float adjacent = dot(texture2D(relief, uv + vec2(-.00073, .00082)).rgb, vec3(.28, .57, .15));
    float reliefShade = clamp((tone - adjacent) * 2.9, -.35, .43);
    vec3 water = mix(vec3(.007, .020, .052), vec3(.035, .088, .165), tone * .54);
    vec3 land = mix(vec3(.024, .049, .092), vec3(.126, .185, .260), pow(tone, .85));
    land *= 1.0 + reliefShade;
    float key = max(0.0, dot(normal, normalize(vec3(-.46, .70, .86))));
    vec3 ink = mix(water, land, map.r) * (.63 + key * .44);
    ink += vec3(.02, .67, .91) * pow(map.g, 1.10) * (.47 + key * .53);

    float value = map.b;
    float spill = value;
    if (hasNightLights) {
      value = texture2D(nightLights, uv).r;
      spill = (
        texture2D(nightLights, uv + vec2(.00075, .00044)).r +
        texture2D(nightLights, uv + vec2(-.00071, .00063)).r +
        texture2D(nightLights, uv + vec2(.00012, -.00093)).r
      ) / 3.0;
    }
    ink += vec3(.72, .344, .09) * pow(spill, .87) * .30;
    vec3 lamp = mix(vec3(1.0, .56, .19), vec3(1.0, .91, .60), smoothstep(.25, .89, value));
    ink += lamp * pow(value, .83) * 1.11;

    float limb = 1.0 - max(0.0, normal.z);
    float rising = smoothstep(-.72, .55, normal.y + normal.x * .48);
    vec3 spectrum = mix(vec3(.045, .32, .84), vec3(.10, .80, 1.0), smoothstep(-.1, .87, normal.y));
    spectrum = mix(spectrum, vec3(.65, .22, 1.0), smoothstep(.30, .99, normal.x) * .94);
    ink += spectrum * (pow(limb, 5.5) * .14 + pow(limb, 16.0) * (.30 + .44 * rising));
    return ink;
  }
`;

const curtainVertex = /* glsl */ `
  uniform float time;
  uniform float band;
  varying vec2 curtain;

  void main() {
    float lon = (uv.x - .5) * 6.2831853;
    float lat = 1.165 + band * .085 + .092 * cos(lon + 1.12)
      + .069 * sin(lon * 3.0 + .95 + band * 1.7 + time * .21)
      + .030 * sin(lon * 6.0 - time * .29 + band * .62)
      + .012 * sin(lon * 11.0 + time * .34);
    float height = .079 + .028 * sin(lon * 4.0 + band - time * .40) + .015 * sin(lon * 9.0 + 1.7);
    float radius = 1.013 + uv.y * height;
    lat += uv.y * (.018 + .014 * sin(lon * 5.0 + time * .26));
    vec3 vertex = radius * vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    curtain = vec2(lon, uv.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vertex, 1.0);
  }
`;

const curtainFragment = /* glsl */ `
  uniform float time;
  uniform float band;
  uniform float opacity;
  varying vec2 curtain;

  void main() {
    float lon = curtain.x;
    float height = curtain.y;
    float fold = .24 * sin(lon * 31.0 + height * 4.0 - time * .77 + band);
    float fibres = .51 + .21 * sin(lon * 103.0 + fold + height * 3.0 + time * .8)
      + .16 * sin(lon * 53.0 - height * 3.0 - time * 1.1)
      + .12 * sin(lon * 157.0 + height + time * 1.27);
    float envelope = .13 + .87 * smoothstep(-.63, .84, sin(lon * 3.0 + time * .34 + band) + .41 * cos(lon * 7.0 + .5));
    float profile = smoothstep(0.0, .09, height) * pow(1.0 - height, 1.63);
    vec3 green = mix(vec3(.012, .92, .35), vec3(.26, 1.0, .67), fibres);
    vec3 tint = mix(green, vec3(.11, .77, .93), smoothstep(.28, .93, height));
    gl_FragColor = vec4(tint, opacity * (1.0 - band * .45) * envelope * profile * (.30 + fibres * .72));
  }
`;

export function createNightEffects() {
  const group = new Group();
  const time = { value: 0 };
  const opacity = { value: .75 };
  // The shader positions the grid in the rotating Earth's coordinate system.
  const columns = 288;
  const rows = 5;
  const uv = [];
  const index = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      uv.push(column / columns, row / rows);
      if (row === rows || column === columns) continue;
      const cell = row * (columns + 1) + column;
      const next = cell + columns + 1;
      index.push(cell, cell + 1, next, cell + 1, next + 1, next);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(uv.length * 1.5), 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  for (const band of [0, 1]) {
    const curtain = new Mesh(geometry, new ShaderMaterial({
      uniforms: { time, band: { value: band }, opacity },
      vertexShader: curtainVertex,
      fragmentShader: curtainFragment,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      forceSinglePass: true,
    }));
    curtain.frustumCulled = false;
    group.add(curtain);
  }
  const halo = new Mesh(new PlaneGeometry(2.28, 2.28), new ShaderMaterial({
    uniforms: { opacity },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    vertexShader: `
      varying vec2 plane;
      void main() {
        plane = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float opacity;
      varying vec2 plane;
      void main() {
        float radius = length(plane);
        vec2 direction = plane / max(radius, .001);
        float up = smoothstep(-.54, .90, direction.y);
        float east = smoothstep(.34, .91, direction.x) * smoothstep(-.90, .10, direction.y);
        vec3 hue = mix(vec3(.075, .28, .74), vec3(.13, .85, 1.0), up);
        hue = mix(hue, vec3(.73, .23, 1.0), east);
        float core = exp(-abs(radius - 1.0) * 195.0);
        float haze = exp(-abs(radius - 1.0) * 31.0) * smoothstep(.973, 1.003, radius);
        gl_FragColor = vec4(hue, opacity * (.25 + .64 * max(up, east)) * (.82 * core + .24 * haze));
      }
    `,
  }));
  halo.renderOrder = 4;
  return {
    group,
    halo,
    paint(now, amount) {
      group.visible = halo.visible = amount > 0;
      time.value = now / 1000;
      opacity.value = amount;
    },
  };
}

const polarBand = {
  type: 'LineString',
  coordinates: Array.from({ length: 181 }, (_, i) => {
    const lon = i * 2 - 180;
    const angle = lon * radians;
    return [lon, 68 + 5.4 * Math.cos(angle + 1.12) + 4.6 * Math.sin(angle * 3 + .95) + 1.6 * Math.sin(angle * 6)];
  }),
};

export function drawCanvasAurora(context, path, radius, amount) {
  context.save();
  context.globalCompositeOperation = 'screen';
  context.globalAlpha = amount;
  context.beginPath();
  path(polarBand);
  context.lineJoin = context.lineCap = 'round';
  for (const [width, color] of [[.086, '#4affab21'], [.042, '#44ebac66'], [.012, '#53ffb393']]) {
    context.lineWidth = radius * width;
    context.strokeStyle = color;
    context.stroke();
  }
  context.restore();
}
