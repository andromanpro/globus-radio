import {
  ACESFilmicToneMapping, CanvasTexture, CircleGeometry, DirectionalLight, HemisphereLight, Mesh,
  MeshBasicMaterial, PerspectiveCamera, PMREMGenerator, PointLight, Quaternion, Raycaster, Scene,
  SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { wireDial, wireLever } from './controls';
import { radians, wrapLongitude } from './geo';
import { number, onLanguageChange, t } from './i18n';
import { radioHeatTexture } from './radio-heat';
import { createVintageLens } from './vintage-lens';

export const maxVintageLatitude = 65;

function spinGain(degreesPerSecond) {
  const speed = Math.max(0, Math.min(1, (degreesPerSecond - 24) / (250 - 24)));
  return .12 + 1.23 * speed * speed * (3 - 2 * speed);
}

export async function createVintage(element, dataUrl, geography, onAim, onPick) {
  const stage = element.querySelector('#vintage-stage');
  const lensCanvas = element.querySelector('#lens-map');
  const spin = element.querySelector('#spin-dial');
  const lever = element.querySelector('#lens-lever');
  const lightSwitch = element.querySelector('#vintage-light');
  const lensScale = element.querySelector('#lens-scale');
  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  let model;
  try {
    model = await new GLTFLoader().loadAsync(`${dataUrl}radio-globe-vintage.glb`);
  } catch (error) {
    renderer.dispose();
    throw error;
  }

  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  const labelModel = () => renderer.domElement.setAttribute('aria-label', t('modelHelp'));
  labelModel();
  onLanguageChange(labelModel);
  stage.replaceChildren(renderer.domElement);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, .06).texture;
  scene.environmentIntensity = .51;
  pmrem.dispose();
  room.dispose();
  const key = new DirectionalLight('#ffe1bb', 2.15);
  key.position.set(-.38, 1.15, .64);
  const rim = new DirectionalLight('#ffda9e', .92);
  rim.position.set(.46, .37, -.42);
  const lamp = new PointLight('#ffad43', .085, .5);
  lamp.position.set(.01, .22, .065);
  scene.add(model.scene, key, rim, lamp, new HemisphereLight('#ffebcc', '#795136', .59));

  const ball = model.scene.getObjectByName('Шар');
  const carriage = model.scene.getObjectByName('Лупа_и_каретка');
  const optic = model.scene.getObjectByName('Латунное_кольцо_лупы');
  const gears = [1, 2, 3].map(index => model.scene.getObjectByName(`Шестерня_${index}`));
  const phases = gears.map(gear => gear.rotation.z);
  const ratios = [-2, 3.2, 32 / 11];
  const origin = optic.position;
  const meridianRadius = Math.hypot(origin.x, origin.y);
  const tiltFactor = meridianRadius / origin.length();
  const bearing = Math.atan2(origin.y, origin.x);
  const front = new Vector3(0, 0, 1).applyQuaternion(ball.quaternion);
  const initialYaw = Math.atan2(front.x, front.z);
  const north = new Vector3(0, 1, 0);
  const northInOptic = new Vector3();
  const globeFrame = new Quaternion();
  const lensFrame = new Quaternion();

  const camera = new PerspectiveCamera(32, 1, .02, 9);
  camera.position.set(-.30, .35, .73);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, .179, .009);
  orbit.enablePan = false;
  orbit.minDistance = .48;
  orbit.maxDistance = 1.05;
  orbit.minPolarAngle = .45;
  orbit.maxPolarAngle = Math.PI * .483;

  let latitude = 0;
  let longitude = 0;
  let yaw = initialYaw;
  let radius;
  let fm;
  let heat;
  let heatMaterial;
  const heatPanels = [];
  let spinning = false;
  let dirtyMap = true;
  let frame;
  let canvasWidth = 0;
  let canvasHeight = 0;
  const lens = createVintageLens(lensCanvas, lensScale, geography, dataUrl, redrawMap);
  const lensTexture = new CanvasTexture(lens.map);
  lensTexture.colorSpace = SRGBColorSpace;
  lensTexture.anisotropy = 4;
  const image = new Mesh(new CircleGeometry(1.96, 64), new MeshBasicMaterial({ map: lensTexture, toneMapped: false }));
  image.position.z = .467;
  optic.add(image);

  function schedule() {
    if (!frame && !element.hidden) frame = requestAnimationFrame(draw);
  }

  function redrawMap() {
    dirtyMap = true;
    schedule();
  }

  function draw() {
    frame = 0;
    if (element.hidden || !canvasWidth || !canvasHeight) return;
    if (dirtyMap && !spinning) {
      lens.paint(latitude, longitude, radius, fm, heat);
      lensTexture.needsUpdate = true;
      dirtyMap = false;
    }
    renderer.render(scene, camera);
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height || (width === canvasWidth && height === canvasHeight)) return;
    canvasWidth = width;
    canvasHeight = height;
    camera.aspect = width / height;
    camera.zoom = Math.min(1, camera.aspect / .84);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    schedule();
  }

  function carriageAt(lat) {
    return Math.PI - Math.asin(Math.sin(lat * radians) / tiltFactor);
  }

  function lensLongitude(lat) {
    return Math.atan2(meridianRadius * Math.cos(carriageAt(lat)), origin.z) / radians;
  }

  function poseMechanism(lat, angle) {
    ball.rotation.set(0, angle, 0);
    carriage.rotation.set(0, 0, carriageAt(lat) - bearing);
    gears.forEach((gear, index) => { gear.rotation.z = phases[index] + (angle - initialYaw) * ratios[index]; });
  }

  function pose() {
    poseMechanism(latitude, yaw);
    northInOptic.copy(north).applyQuaternion(carriage.parent.getWorldQuaternion(globeFrame));
    northInOptic.applyQuaternion(optic.getWorldQuaternion(lensFrame).invert());
    image.rotation.z = Math.atan2(-northInOptic.x, northInOptic.y);
    const degrees = Math.round(wrapLongitude(yaw / radians));
    spin.style.setProperty('--turn', `${degrees}deg`);
    spin.setAttribute('aria-valuenow', String(degrees));
    spin.setAttribute('aria-valuetext', `${degrees}°`);
    lever.value = String(latitude);
    lever.setAttribute('aria-valuetext', `${number(Math.abs(latitude), 2)}° ${t(latitude < 0 ? 'latitude.S' : 'latitude.N')}`);
    redrawMap();
  }

  function adjust(commit = false) {
    longitude = wrapLongitude(lensLongitude(latitude) - yaw / radians);
    pose();
    onAim(latitude, longitude, commit);
  }

  wireDial(spin, degrees => { yaw += degrees * radians; adjust(); }, () => adjust(true), { pointerGain: spinGain });
  wireLever(lever);
  lever.addEventListener('input', () => { latitude = lever.valueAsNumber; adjust(); });
  lever.addEventListener('change', () => adjust(true));

  const emitters = new Map();
  model.scene.traverse(object => {
    if (object.isMesh && object.material.emissiveIntensity > 1) emitters.set(object.material, object.material.emissiveIntensity);
  });
  lightSwitch.addEventListener('change', () => {
    for (const [material, intensity] of emitters) material.emissiveIntensity = lightSwitch.checked ? intensity : 0;
    lamp.visible = lightSwitch.checked;
    stage.classList.toggle('unlit', !lightSwitch.checked);
    schedule();
  });

  function pick(x, y) {
    const point = lens.pointAt(x, y);
    if (!point) return;
    if (Math.abs(point.lat) > maxVintageLatitude) {
      lensScale.textContent = t('lensLimit');
      return;
    }
    onPick(point);
  }

  lensCanvas.addEventListener('click', event => {
    const bounds = lensCanvas.getBoundingClientRect();
    pick((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  });
  lensCanvas.addEventListener('keydown', event => {
    const offset = { ArrowUp: [0, -.14], ArrowDown: [0, .14], ArrowLeft: [-.14, 0], ArrowRight: [.14, 0] }[event.key];
    if (!offset) return;
    event.preventDefault();
    pick(.5 + offset[0], .5 + offset[1]);
  });

  const ray = new Raycaster();
  const pointer = new Vector2();
  let press;
  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button === 0) press = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener('pointercancel', () => { press = null; });
  renderer.domElement.addEventListener('pointerup', event => {
    const start = press;
    press = null;
    if (event.pointerId !== start?.id || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObject(image, false)[0];
    if (!hit) return;
    const obstructed = ray.intersectObject(ball, true)[0];
    if (!obstructed || obstructed.distance > hit.distance) pick(hit.uv.x, 1 - hit.uv.y);
  });

  orbit.addEventListener('change', schedule);
  orbit.update();
  new ResizeObserver(resize).observe(stage);
  resize();
  spin.disabled = lever.disabled = lightSwitch.disabled = false;
  element.setAttribute('aria-busy', 'false');

  return {
    showSpin(lat, lon) {
      if (!spinning) {
        spinning = true;
        element.classList.add('spinning');
        image.visible = false;
      }
      const angle = yaw + (lensLongitude(lat) - lensLongitude(latitude) - (lon - longitude)) * radians;
      poseMechanism(lat, angle);
      schedule();
    },
    endSpin(keepPhase) {
      if (!spinning) return;
      if (keepPhase) yaw = ball.rotation.y;
      spinning = false;
      element.classList.remove('spinning');
      image.visible = true;
      pose();
    },
    look(lat, lon) {
      latitude = Math.max(-maxVintageLatitude, Math.min(maxVintageLatitude, lat));
      longitude = lon;
      yaw += wrapLongitude(lensLongitude(latitude) - longitude - yaw / radians) * radians;
      pose();
    },
    setScanRadius(value) {
      if (radius === value) return;
      radius = value;
      redrawMap();
    },
    setFmCoverage(station) {
      if (fm === station) return;
      fm = station;
      redrawMap();
    },
    setHeat(value) {
      if (heat === value) return;
      heat = value;
      if (heat && !heatMaterial) {
        const texture = new CanvasTexture(radioHeatTexture(heat));
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        heatMaterial = new MeshBasicMaterial({
          map: texture, transparent: true, depthWrite: false, toneMapped: false,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        });
        ball.traverse(object => {
          if (object.isMesh && object.name.startsWith('Сегмент')) {
            heatPanels.push([object, new Mesh(object.geometry, heatMaterial)]);
          }
        });
        for (const [panel, overlay] of heatPanels) panel.add(overlay);
      }
      for (const [, overlay] of heatPanels) overlay.visible = Boolean(heat);
      redrawMap();
    },
  };
}
