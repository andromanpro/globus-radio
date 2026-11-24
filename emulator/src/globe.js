import { geoCircle, geoEquirectangular, geoGraticule, geoOrthographic, geoPath } from 'd3-geo';
import {
  CanvasTexture, Euler, Mesh, OrthographicCamera, RepeatWrapping, Scene,
  ShaderMaterial, SphereGeometry, Texture, Vector3, WebGLRenderer,
} from 'three';
import { createAtlasDetails, drawAtlasDetails } from './atlas-details';
import { earthRadiusKm, radians, viewportAngle, visibleTiles } from './geo';
import { number, t } from './i18n';
import { loadMapData } from './map-data';
import { createNightEffects, drawCanvasAurora, nightSurface } from './night-globe';
import { createRadioHeatPainter } from './radio-heat';
import { createSatelliteClouds, loadCloudDensity } from './satellite-clouds';
import { createSettlementLabels } from './settlements';

const graticule = geoGraticule().step([15, 15])();
const sphere = { type: 'Sphere' };
const regionalDistanceKm = 2350;
const detailDistanceKm = 450;
const mapStyles = {
  atlas: {
    water: '#76a5a3', land: '#deca9e', grid: '#395e564b', coast: '#42665eae', border: '#865c499e',
    countries: ['#ebd9a4', '#cdd3a7', '#e0bda1', '#d7d9b5', '#d6bc9e', '#d9c9a8', '#b9c9ae', '#f0d8ae'],
    detailWater: '#a4c4b7', detailLand: '#e9d9b3', light: [.82, .23], rim: [.10, .14, .11], relief: .23,
    built: '#bb8270', builtOutline: '#915843a1', lakes: '#8cb2ad', rivers: '#507f82', roads: '#9e753c', roadWidth: 1.12,
    fmFill: '#49895c28', fmOutline: '#448258',
  },
  night: {
    water: '#071429', land: '#17273d', grid: '#8db7cb22', coast: '#51bfe9ad', border: '#58aeb960',
    detailWater: '#0d2642', detailLand: '#131d33', light: [.65, .41], rim: [.066, .20, .33], relief: .31,
    overviewInset: .030,
    built: '#42314e', builtOutline: '#d49dec86', lakes: '#1b4f67', rivers: '#67cbdc', roads: '#edab82', roadWidth: 1.30,
    fmFill: '#ab4b8b22', fmOutline: '#f5a0d6',
  },
  satellite: {
    water: '#132d47', detailWater: '#123246', land: '#677355', detailLand: '#3b4c41',
    grid: '#a5d5de24', coast: '#96dbdb98', border: '#eff1beb0',
    light: [.70, .35], rim: [.13, .26, .38], relief: 0,
    built: '#74807390', builtOutline: '#cfdecaa2', lakes: '#245978bd', rivers: '#94dbebe0', roads: '#eae4b9b8', roadWidth: 1.06,
    fmFill: '#7acdd325', fmOutline: '#94d7d8',
  },
};

function surface(lat, lon, point) {
  const latitude = lat * radians;
  const longitude = lon * radians;
  return point.set(
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
    Math.cos(latitude) * Math.cos(longitude),
  );
}

function drawLine(context, path, shape, color, width) {
  context.beginPath();
  path(shape);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function fillShape(context, path, shape, color) {
  context.beginPath();
  path(shape);
  context.fillStyle = color;
  context.fill();
}

function drawCountries(context, path, groups, colors) {
  colors.forEach((color, index) => fillShape(context, path, groups[index], color));
}

function drawCityLights(context, path, lights, size) {
  if (!lights) return;
  fillShape(context, path.pointRadius(size * 3.4), lights, '#eeb47724');
  fillShape(context, path.pointRadius(size * 1.7), lights, '#f8c58c6e');
  fillShape(context, path.pointRadius(size), lights, '#fff0d1');
}

function webGlSurface(image, geography, style) {
  const { borders, land, countryGroups } = geography;
  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 2048;
  const context = canvas.getContext('2d');
  const projection = geoEquirectangular().scale(canvas.width / (2 * Math.PI))
    .translate([canvas.width / 2, canvas.height / 2]).precision(0.25);
  const path = geoPath(projection, context);

  const relief = new Texture(image);
  relief.wrapS = RepeatWrapping;
  relief.needsUpdate = true;
  const lines = new CanvasTexture(canvas);
  lines.wrapS = RepeatWrapping;
  relief.anisotropy = 4;
  lines.anisotropy = 4;

  const material = new ShaderMaterial({
    uniforms: {
      relief: { value: relief }, satelliteImage: { value: relief }, mapLayer: { value: lines }, satellite: { value: false },
      night: { value: false }, nightLights: { value: null }, hasNightLights: { value: false },
      lightLevels: { value: mapStyles[style].light }, rimColor: { value: mapStyles[style].rim },
      reliefAmount: { value: 0 },
    },
    vertexShader: `
      varying vec2 mapUv;
      varying vec3 viewNormal;
      void main() {
        mapUv = uv;
        viewNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D relief;
      uniform sampler2D satelliteImage;
      uniform sampler2D mapLayer;
      uniform sampler2D nightLights;
      uniform bool hasNightLights;
      uniform bool night;
      uniform bool satellite;
      uniform vec2 lightLevels;
      uniform vec3 rimColor;
      uniform float reliefAmount;
      varying vec2 mapUv;
      varying vec3 viewNormal;
      ${nightSurface}
      void main() {
        vec4 overlay = texture2D(mapLayer, mapUv);
        vec3 n = normalize(viewNormal);
        if (night) {
          gl_FragColor = vec4(paintNight(mapUv, overlay, n), 1.0);
          return;
        }
        vec3 color = overlay.rgb;
        if (satellite) {
          vec3 pixel = texture2D(satelliteImage, mapUv).rgb;
          float brightness = dot(pixel, vec3(.24, .56, .20));
          vec3 surfaceColor = mix(vec3(brightness), pixel, .88) * vec3(1.06, 1.08, 1.10);
          color = mix(surfaceColor, overlay.rgb, overlay.a * .46);
        } else if (reliefAmount > 0.) {
          float grey = dot(texture2D(relief, mapUv).rgb, vec3(.24, .56, .20));
          color *= 1.0 + reliefAmount * (grey - .4);
        }
        float light = lightLevels.x + lightLevels.y * max(0.0, dot(n, normalize(vec3(-.43, .62, .83))));
        float rim = pow(1.0 - n.z, 5.0);
        gl_FragColor = vec4(color * light + rim * rimColor, 1.0);
      }
    `,
  });
  const geometry = new SphereGeometry(1, 128, 80).rotateY(-Math.PI / 2);
  const earth = new Mesh(geometry, material);
  const scene = new Scene();
  scene.add(earth);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 3;
  let pixelRatio;
  let canvasWidth;
  let canvasHeight;
  let paintedStyle;
  let cityLights;
  let waterways;
  let nightEffects;
  let clouds;

  function paintNightMask() {
    context.fillStyle = '#000000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    fillShape(context, path, land, '#ff0000');
    // Separate channels carry land, cartography and fallback lighting.
    context.globalCompositeOperation = 'screen';
    drawLine(context, path, land, '#00de00', 2.05);
    drawLine(context, path, borders, '#005000', 1.25);
    if (waterways) drawLine(context, path, waterways, '#008000', 1.61);
    if (!material.uniforms.hasNightLights.value && cityLights) {
      fillShape(context, path.pointRadius(4), cityLights, '#000019');
      fillShape(context, path.pointRadius(1.75), cityLights, '#000091');
    }
    context.globalCompositeOperation = 'source-over';
  }

  function paintMap() {
    const palette = mapStyles[style];
    const satellite = style === 'satellite';
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (style === 'night') paintNightMask();
    else if (!satellite) {
      context.fillStyle = palette.water;
      context.fillRect(0, 0, canvas.width, canvas.height);
      fillShape(context, path, land, palette.land);
      if (palette.countries) drawCountries(context, path, countryGroups, palette.countries);
    }
    if (style !== 'night') {
      drawLine(context, path, graticule, palette.grid, 1.25);
      drawLine(context, path, land, palette.coast, 1.6);
      drawLine(context, path, borders, palette.border, 2.3);
    }
    lines.needsUpdate = true;
    material.uniforms.satellite.value = satellite;
    material.uniforms.night.value = style === 'night';
    material.uniforms.lightLevels.value = palette.light;
    material.uniforms.rimColor.value = palette.rim;
    material.uniforms.reliefAmount.value = palette.relief;
    paintedStyle = style;
  }

  function renderScene(time, glow, cloudAmount) {
    if (!nightEffects && glow > 0) {
      nightEffects = createNightEffects();
      earth.add(nightEffects.group);
      scene.add(nightEffects.halo);
    }
    nightEffects?.paint(time, glow);
    clouds?.paint(time, cloudAmount);
    renderer.render(scene, camera);
  }

  return {
    canvas: renderer.domElement,
    resize(width, height, radius) {
      camera.right = width / (2 * radius);
      camera.left = -camera.right;
      camera.top = height / (2 * radius);
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
      const density = Math.min(window.devicePixelRatio, style === 'night' ? 1.5 : 2);
      if (canvasWidth !== width || canvasHeight !== height || pixelRatio !== density) {
        canvasWidth = width;
        canvasHeight = height;
        if (pixelRatio !== density) renderer.setPixelRatio(density);
        pixelRatio = density;
        renderer.setSize(width, height, false);
      }
    },
    setStyle(value) { style = value; },
    setCityLights(lights) { cityLights = lights; paintedStyle = undefined; },
    setWaterways(value) { waterways = value; paintedStyle = undefined; },
    setSatelliteImage(image) {
      const texture = new Texture(image);
      texture.wrapS = RepeatWrapping;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      material.uniforms.satelliteImage.value = texture;
    },
    setCloudDensity(data) {
      clouds = createSatelliteClouds(geometry, data);
      earth.add(clouds.mesh);
    },
    setNightLights(image) {
      const texture = new Texture(image);
      texture.wrapS = RepeatWrapping;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      material.uniforms.nightLights.value = texture;
      material.uniforms.hasNightLights.value = true;
      paintedStyle = undefined;
    },
    draw(lat, lon, time, glow, clouds) {
      if (style !== paintedStyle) paintMap();
      earth.rotation.set(lat * radians, -lon * radians, 0, 'XYZ');
      renderScene(time, glow, clouds);
    },
    drawEffects: renderScene,
  };
}

function canvasSurface(geography, style, atlases) {
  const { borders, land, countryGroups } = geography;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const projection = geoOrthographic().precision(0.45);
  const path = geoPath(projection, context);
  let width;
  let height;
  let radius;
  let tiles;
  let regionKey;
  let region;
  let cityLights;

  function localGeometry(lat, lon) {
    const ids = visibleTiles(lat, lon, viewportAngle(width, height, radius));
    const key = ids.join(',');
    if (key !== regionKey) {
      regionKey = key;
      const cells = ids.map(id => tiles[id]).filter(Boolean);
      region = [
        { type: 'MultiPolygon', coordinates: cells.flatMap(cell => cell[0]) },
        { type: 'MultiLineString', coordinates: cells.flatMap(cell => cell[1]) },
        { type: 'MultiLineString', coordinates: cells.flatMap(cell => cell[2]) },
      ];
    }
    return region;
  }

  return {
    canvas,
    resize(nextWidth, nextHeight, nextRadius) {
      width = nextWidth;
      height = nextHeight;
      radius = nextRadius;
      const density = Math.min(window.devicePixelRatio, 2);
      const pixelWidth = Math.round(width * density);
      const pixelHeight = Math.round(height * density);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(density, 0, 0, density, 0, 0);
      projection.scale(radius).translate([width / 2, height / 2]).clipExtent([[0, 0], [width, height]]);
    },
    setTiles(nextTiles) { tiles = nextTiles; },
    setStyle(value) { style = value; },
    setCityLights(lights) { cityLights = lights; },
    draw(lat, lon, _time, glow, terrain = 0) {
      projection.rotate([-lon, -lat]);
      context.clearRect(0, 0, width, height);
      const [visibleLand, coast, visibleBorders] = tiles ? localGeometry(lat, lon) : [land, null, borders];
      const palette = mapStyles[style];
      if (atlases) {
        const angle = viewportAngle(width, height, radius);
        const detailed = angle * earthRadiusKm <= detailDistanceKm ? atlases.detail(lat, lon, angle, true) : null;
        const layers = detailed ?? atlases.regional(lat, lon, angle);
        context.globalAlpha = 1 - terrain;
        fillShape(context, path, sphere, palette.detailWater);
        fillShape(context, path, visibleLand, palette.detailLand);
        context.globalAlpha = 1;
        drawAtlasDetails(context, projection, layers, palette, lat, lon, angle);
        if (coast) drawLine(context, path, coast, style === 'satellite' ? '#85aaa074' : palette.coast, 0.9);
        drawLine(context, path, visibleBorders, style === 'satellite' ? '#e8d7a67f' : palette.border, 1);
        return;
      }
      fillShape(context, path, sphere, palette.water);
      fillShape(context, path, visibleLand, palette.land);
      if (palette.countries) drawCountries(context, path, countryGroups, palette.countries);
      drawLine(context, path, graticule, palette.grid, 0.65);
      if (style !== 'satellite') drawLine(context, path, land, palette.coast, 0.75);
      drawLine(context, path, borders, palette.border, 0.75);

      const shade = context.createRadialGradient(width / 2 - radius * 0.34, height / 2 - radius * 0.45, radius * 0.16,
        width / 2 + radius * 0.09, height / 2 + radius * 0.04, radius * 1.1);
      shade.addColorStop(0, '#00000000');
      shade.addColorStop(0.72, '#06111c2e');
      shade.addColorStop(0.94, '#06111c94');
      shade.addColorStop(1, style === 'satellite' ? '#4d94ad86' : `${palette.coast.slice(0, 7)}66`);
      fillShape(context, path, sphere, shade);
      if (style === 'night') {
        drawCityLights(context, path, cityLights, 1);
        if (glow > 0) drawCanvasAurora(context, path, radius, glow);
      }
    },
  };
}

export function createGlobe(element, image, { borders, land, countries }, dataUrl, style, onSelectSettlement) {
  const countryGroups = mapStyles.atlas.countries.map(() => ({ type: 'FeatureCollection', features: [] }));
  countries.forEach((country, index) => {
    const slot = (Number(country.id) || index) % countryGroups.length;
    countryGroups[slot].features.push(country);
  });
  const geography = { borders, land, countryGroups };
  let view;
  try {
    view = image ? webGlSurface(image, geography, style) : canvasSurface(geography, style);
  } catch {
    view = canvasSurface(geography, style);
  }

  const canvas = view.canvas;
  canvas.className = 'earth';
  canvas.setAttribute('aria-hidden', 'true');
  element.querySelector('.stars').after(canvas);
  const heatCanvas = document.createElement('canvas');
  heatCanvas.className = 'radio-heat-layer';
  heatCanvas.setAttribute('aria-hidden', 'true');
  heatCanvas.hidden = true;
  element.querySelector('.settlements').before(heatCanvas);
  const heatContext = heatCanvas.getContext('2d');

  let width = 0;
  let height = 0;
  let radius = 0;
  let zoom = 1;
  let scanRadius = null;
  let fmCoverage = null;
  let fmShape = null;
  let broadcast = null;
  let lat = 0;
  let lon = 0;
  let frame = 0;
  let viewDirty = true;
  let regionView;
  let showRegion = false;
  let terrain = 0;
  let heat = null;
  let drawHeat;
  let spinPoint = null;
  let displayZoom = 1;
  const rotation = new Euler();
  const inverse = new Euler(0, 0, 0, 'ZYX');
  const projected = new Vector3();
  const scanCircle = element.querySelector('.scan-circle');
  const broadcastSignal = element.querySelector('.broadcast-signal');
  const scale = element.querySelector('#map-scale');
  const atlasLegend = element.querySelector('#atlas-legend');
  const north = element.querySelector('#atlas-north');
  const labelsToggle = element.querySelector('#satellite-labels');
  let satelliteLabels = true;
  labelsToggle.addEventListener('click', () => {
    satelliteLabels = !satelliteLabels;
    labelsToggle.setAttribute('aria-pressed', String(satelliteLabels));
    scheduleRender();
  });
  const fmCanvas = element.querySelector('.fm-coverage');
  const fmContext = fmCanvas.getContext('2d');
  const fmProjection = geoOrthographic().precision(0.4);
  const fmPath = geoPath(fmProjection, fmContext);
  const renderLabels = createSettlementLabels(element.querySelector('.settlements'), dataUrl, onSelectSettlement, scheduleRender);
  let nightRequested = false;
  let satelliteRequested = false;
  let cloudsReady = false;
  let effectsFrame = 0;
  let lastEffectPaint = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function auroraAmount() {
    return style === 'night' && !showRegion && !element.hidden
      ? Math.max(0, Math.min(1, (1.48 - displayZoom) / .32)) : 0;
  }

  function cloudAmount() {
    if (style !== 'satellite' || !cloudsReady || element.hidden) return 0;
    const opacity = Math.max(0, Math.min(1, (2.6 - displayZoom) / 1.4));
    return opacity * opacity * (3 - 2 * opacity);
  }

  function animateEffects() {
    const animate = view.drawEffects && radius && (auroraAmount() || cloudAmount()) && !document.hidden && !reducedMotion.matches;
    if (animate && !effectsFrame) effectsFrame = requestAnimationFrame(paintEffects);
    if (!animate && effectsFrame) {
      cancelAnimationFrame(effectsFrame);
      effectsFrame = 0;
    }
  }

  function paintEffects(now) {
    effectsFrame = 0;
    const glow = auroraAmount();
    const clouds = cloudAmount();
    if (!(glow || clouds) || document.hidden || reducedMotion.matches) return;
    if (!spinPoint && !viewDirty && now - lastEffectPaint >= (glow ? 38 : 100)) {
      lastEffectPaint = now;
      view.drawEffects(now, glow, clouds);
    }
    animateEffects();
  }

  document.addEventListener('visibilitychange', animateEffects);
  reducedMotion.addEventListener('change', () => {
    if (style === 'night' || style === 'satellite') scheduleRender();
    animateEffects();
  });

  function loadNightView() {
    if (nightRequested) return;
    nightRequested = true;
    if (view.setNightLights) {
      const image = new Image();
      image.src = `${dataUrl}night-lights.webp`;
      image.decode().then(() => {
        view.setNightLights(image);
        if (style === 'night') scheduleRender();
      }).catch(() => {});
      loadMapData(dataUrl, 'night-waterways.json.gz').then(waterways => {
        view.setWaterways(waterways);
        if (style === 'night') scheduleRender();
      }).catch(() => {});
    }
    loadMapData(dataUrl, 'major-places.json.gz').then(places => {
      view.setCityLights({ type: 'MultiPoint', coordinates: places
        .filter(([, , , , population, rank]) => population >= 250000 || rank >= 2)
        .map(([, , latitude, longitude]) => [longitude, latitude]) });
      if (style === 'night') scheduleRender();
    }).catch(() => {});
  }

  function loadSatelliteView() {
    if (satelliteRequested || !view.setSatelliteImage) return;
    satelliteRequested = true;
    const image = new Image();
    image.src = `${dataUrl}earth-satellite.webp`;
    image.decode().then(() => {
      view.setSatelliteImage(image);
      if (style === 'satellite') scheduleRender();
    }).catch(() => {});
    loadCloudDensity().then(data => {
      view.setCloudDensity(data);
      cloudsReady = true;
      if (style === 'satellite') {
        scheduleRender();
        animateEffects();
      }
    }).catch(() => {});
  }

  if (style === 'night') loadNightView();
  if (style === 'satellite') loadSatelliteView();

  function detailedView() {
    if (regionView) return regionView;
    regionView = canvasSurface(geography, style, {
      detail: createAtlasDetails(dataUrl, scheduleRender),
      regional: createAtlasDetails(dataUrl, scheduleRender, 'regional-atlas', 10),
    });
    regionView.canvas.className = 'earth earth-region';
    regionView.canvas.setAttribute('aria-hidden', 'true');
    canvas.after(regionView.canvas);
    loadMapData(dataUrl, 'map-10m-tiles.json.gz').then(tiles => {
      regionView.setTiles(tiles);
      scheduleRender();
    }).catch(() => {});
    return regionView;
  }

  function resize() {
    displayZoom = spinPoint ? 1 : zoom;
    const margin = (mapStyles[style].overviewInset ?? 0) * Math.max(0, 1 - (displayZoom - 1) * 2.5);
    radius = Math.min(width, height) * (.455 - margin) * displayZoom;
    if (!radius) {
      animateEffects();
      return;
    }
    element.style.setProperty('--diameter', `${2 * radius}px`);
    element.classList.toggle('zoomed', displayZoom >= 1.5);
    const rangeKm = viewportAngle(width, height, radius) * earthRadiusKm;
    showRegion = rangeKm <= regionalDistanceKm;
    terrain = 0;
    if (showRegion && view.setSatelliteImage) {
      if (style === 'night') terrain = Math.max(0, Math.min(.94, (rangeKm - 275) / 680));
      if (style === 'satellite') terrain = Math.min(.97, .20 + rangeKm / 720);
    }
    canvas.hidden = showRegion && !terrain;
    if (!canvas.hidden) view.resize(width, height, radius);
    if (showRegion) detailedView().resize(width, height, radius);
    if (regionView) regionView.canvas.hidden = !showRegion;
    if (fmCanvas.width !== Math.ceil(width) || fmCanvas.height !== Math.ceil(height)) {
      fmCanvas.width = Math.ceil(width);
      fmCanvas.height = Math.ceil(height);
    }
    fmProjection.scale(radius).translate([width / 2, height / 2]).clipExtent([[0, 0], [width, height]]);
    scheduleRender();
    animateEffects();
  }

  function render() {
    frame = 0;
    if (!radius || element.hidden) return;
    if (viewDirty) {
      viewDirty = false;
      const glow = auroraAmount();
      const clouds = cloudAmount();
      const viewLat = spinPoint?.lat ?? lat;
      const viewLon = spinPoint?.lon ?? lon;
      if (!canvas.hidden) view.draw(viewLat, viewLon, (glow || clouds) && !reducedMotion.matches ? performance.now() : 0, glow, clouds);
      if (showRegion) regionView.draw(lat, lon, 0, 0, terrain);
      paintHeat(viewLat, viewLon);
      if (!spinPoint) {
        renderLabels(zoom, lat, lon, width, height, radius, (pointLat, pointLon) => {
          const { x, y, z } = surface(pointLat, pointLon, projected).applyEuler(rotation);
          return { x: width / 2 + x * radius, y: height / 2 - y * radius, z };
        }, style !== 'satellite' || satelliteLabels);
        updateAccessories();
      }
    }
    if (spinPoint) return;
    const scanDiameter = scanRadius ? 2 * radius * Math.sin(scanRadius / earthRadiusKm) : 0;
    scanCircle.hidden = scanDiameter < 15 || scanDiameter > Math.hypot(width, height);
    if (!scanCircle.hidden) scanCircle.style.setProperty('--circle-diameter', `${scanDiameter}px`);
    drawFmCoverage();
    drawBroadcast();
  }

  function paintHeat(lat, lon) {
    heatCanvas.hidden = !heat;
    if (!heat) return;
    drawHeat ??= createRadioHeatPainter();
    const layer = drawHeat(heat, lat, lon, width, height, radius);
    if (heatCanvas.width !== layer.width) heatCanvas.width = layer.width;
    if (heatCanvas.height !== layer.height) heatCanvas.height = layer.height;
    heatContext.clearRect(0, 0, layer.width, layer.height);
    heatContext.save();
    heatContext.beginPath();
    heatContext.ellipse(layer.width / 2, layer.height / 2, radius * layer.width / width,
      radius * layer.height / height, 0, 0, 2 * Math.PI);
    heatContext.clip();
    heatContext.drawImage(layer, 0, 0);
    heatContext.restore();
  }

  function updateAccessories() {
    const atlas = style === 'atlas';
    const satellite = style === 'satellite';
    north.hidden = !atlas;
    atlasLegend.hidden = !atlas || !showRegion;
    labelsToggle.hidden = !satellite || zoom < 1.5;
    scale.hidden = !atlas && !satellite;
    if (scale.hidden) return;
    const target = Math.asin(Math.min(.87, Math.min(108, width * .28) / radius)) * earthRadiusKm;
    const exponent = 10 ** Math.floor(Math.log10(target));
    const distance = exponent * (target >= exponent * 5 ? 5 : target >= exponent * 2 ? 2 : 1);
    scale.textContent = `${number(distance)} ${t('km')}`;
    scale.style.setProperty('--scale-width', `${Math.sin(distance / earthRadiusKm) * radius}px`);
  }

  function drawBroadcast() {
    if (style !== 'night' || !broadcast) {
      broadcastSignal.hidden = true;
      return;
    }
    const { x, y, z } = surface(broadcast.lat, broadcast.lon, projected).applyEuler(rotation);
    const left = width / 2 + x * radius;
    const top = height / 2 - y * radius;
    if (z <= .035 || left < 0 || left > width || top < 0 || top > height) {
      broadcastSignal.hidden = true;
      return;
    }
    broadcastSignal.style.left = `${left}px`;
    broadcastSignal.style.top = `${top}px`;
    broadcastSignal.style.setProperty('--direction', `${Math.atan2(-y, x)}rad`);
    broadcastSignal.style.setProperty('--depth', String(Math.max(.16, z)));
    broadcastSignal.hidden = false;
  }

  function drawFmCoverage() {
    fmCanvas.hidden = !fmShape || 2 * radius * Math.sin(fmCoverage.fm.maxKm / earthRadiusKm) < 15;
    if (fmCanvas.hidden) return;
    fmContext.clearRect(0, 0, width, height);
    fmProjection.rotate([-lon, -lat]);
    fmContext.beginPath();
    fmPath(fmShape);
    const palette = mapStyles[style];
    fmContext.fillStyle = palette.fmFill;
    fmContext.fill();
    fmContext.strokeStyle = '#102833b8';
    fmContext.lineWidth = 2.8;
    fmContext.stroke();
    fmContext.strokeStyle = palette.fmOutline;
    fmContext.lineWidth = 1;
    fmContext.stroke();
  }

  function scheduleRender(redrawView = true) {
    if (redrawView) viewDirty = true;
    if (!frame) frame = requestAnimationFrame(render);
  }

  new ResizeObserver(([entry]) => {
    ({ width, height } = entry.contentRect);
    resize();
  }).observe(element);

  return {
    showSpin(lat, lon) {
      const starting = !spinPoint;
      spinPoint = { lat, lon };
      if (starting) {
        element.classList.add('spinning');
        resize();
      } else scheduleRender();
    },
    endSpin() {
      if (!spinPoint) return;
      spinPoint = null;
      element.classList.remove('spinning');
      resize();
    },
    setHeat(value) {
      if (heat === value) return;
      heat = value;
      scheduleRender();
    },
    look(nextLat, nextLon) {
      lat = nextLat;
      lon = nextLon;
      rotation.set(lat * radians, -lon * radians, 0, 'XYZ');
      inverse.set(-lat * radians, lon * radians, 0, 'ZYX');
      scheduleRender();
    },
    setZoom(value) {
      zoom = value;
      resize();
    },
    setStyle(value) {
      if (style === value) return;
      style = value;
      view.setStyle(style);
      regionView?.setStyle(style);
      if (style === 'night') loadNightView();
      if (style === 'satellite') loadSatelliteView();
      resize();
    },
    setScanRadius(value) {
      scanRadius = value;
      scheduleRender(false);
    },
    setFmCoverage(station) {
      if (fmCoverage === station) return;
      fmCoverage = station;
      fmShape = station && (station.fm.contour ?? geoCircle()
        .center([station.lon, station.lat]).radius(station.fm.maxKm / earthRadiusKm / radians).precision(5)());
      scheduleRender(false);
    },
    setBroadcast(station) {
      if (broadcast === station) return;
      broadcast = station;
      if (style === 'night') scheduleRender(false);
    },
    locationAt(clientX, clientY) {
      const rect = element.getBoundingClientRect();
      const x = (clientX - rect.left - width / 2) / radius;
      const y = (height / 2 - clientY + rect.top) / radius;
      const zSquared = 1 - x * x - y * y;
      if (zSquared < 0 || !radius) return null;
      const point = new Vector3(x, y, Math.sqrt(zSquared)).applyEuler(inverse);
      return { lat: Math.asin(Math.max(-1, Math.min(1, point.y))) / radians, lon: Math.atan2(point.x, point.z) / radians };
    },
  };
}
