import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, CanvasTexture, CylinderGeometry, DirectionalLight,
  DoubleSide, Group, LatheGeometry, Mesh, MeshStandardMaterial, OrthographicCamera, PlaneGeometry,
  PMREMGenerator, Scene, SRGBColorSpace, TorusGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const alloy = new MeshStandardMaterial({ color: '#bccbd3', metalness: .64, roughness: .34 });
const brass = new MeshStandardMaterial({ color: '#df9d48', metalness: .69, roughness: .34 });
const dark = new MeshStandardMaterial({ color: '#1b2839', metalness: .46, roughness: .50 });
const porcelain = new MeshStandardMaterial({ color: '#e1e9e8', metalness: .31, roughness: .44, side: DoubleSide });
const beacon = new MeshStandardMaterial({ color: '#a7ffe9', emissive: '#59ded1', emissiveIntensity: 1.25 });

function part(parent, geometry, material, x, y, z) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function box(parent, material, x, y, z, width, height, depth, radius = 0) {
  const geometry = radius ? new RoundedBoxGeometry(width, height, depth, 2, radius) : new BoxGeometry(width, height, depth);
  return part(parent, geometry, material, x, y, z);
}

function strut(parent, material, from, to, width) {
  const direction = new Vector3(...to).sub(new Vector3(...from));
  const centre = new Vector3(...from).addScaledVector(direction, .5);
  const mesh = part(parent, new CylinderGeometry(width, width, direction.length(), 8), material, ...centre);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
}

function solarCells(base, highlight) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  context.fillStyle = '#101e30';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const cell = context.createLinearGradient(0, 0, 42, 54);
  cell.addColorStop(0, highlight);
  cell.addColorStop(.66, base);
  cell.addColorStop(1, '#0b1f34');
  for (let y = 8; y < 184; y += 44) {
    for (let x = 8; x < 376; x += 46) {
      context.save();
      context.translate(x, y);
      context.fillStyle = cell;
      context.fillRect(0, 0, 42, 40);
      context.fillStyle = '#bed9ed46';
      context.fillRect(2, 2, 38, 1.2);
      context.fillRect(2, 19, 38, .8);
      context.restore();
    }
  }
  context.fillStyle = '#91b3cb';
  context.fillRect(6, 94, 370, 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return new MeshStandardMaterial({ map: texture, metalness: .35, roughness: .38 });
}

function wings(model, options) {
  const cells = solarCells(options.cell, options.highlight);
  for (const side of [-1, 1]) {
    const arm = new Group();
    arm.position.set(side * .72, options.height, -.16);
    arm.rotation.set(options.pitch, side * .20, side * options.sweep);
    model.add(arm);
    box(arm, alloy, side * 2.08, 0, 0, 4.05, .12, .15);
    box(arm, brass, side * .30, 0, .02, .45, .46, .20, .05);
    for (let index = 0; index < 2; index++) {
      const x = side * (1.40 + index * 1.71);
      const height = options.panel - index * options.taper;
      box(arm, alloy, x, 0, 0, 1.60, height, .16, .042);
      box(arm, dark, x, 0, .072, 1.48, height - .13, .06);
      part(arm, new PlaneGeometry(1.45, height - .17), cells, x, 0, .106);
      box(arm, brass, x - side * .69, 0, .116, .046, height - .11, .04);
    }
    strut(arm, alloy, [side * 3.91, -.26, 0], [side * 4.45, -.44, .03], .028);
  }
}

function fuselage(model) {
  box(model, brass, 0, 0, -.07, 1.72, 1.63, .90, .18);
  box(model, dark, 0, 0, .38, 1.49, 1.37, .26, .10);
  for (const side of [-1, 1]) {
    box(model, alloy, side * .78, 0, .27, .20, 1.70, .34, .062);
    for (let index = 0; index < 3; index++) {
      box(model, porcelain, side * .55, -.31 + index * .20, .53, .26, .085, .05);
    }
  }
  box(model, alloy, 0, -.81, .03, .86, .25, .50, .06);
  box(model, beacon, .34, -.60, .53, .22, .08, .055);
}

function collector() {
  const model = new Group();
  fuselage(model);
  wings(model, { cell: '#226096', highlight: '#8fbedf', height: -.12, pitch: .21, sweep: .10, panel: 1.67, taper: -.18 });
  const lens = part(model, new CylinderGeometry(.42, .48, .22, 10), alloy, 0, .10, .57);
  lens.rotation.x = Math.PI / 2;
  const glass = part(model, new CylinderGeometry(.31, .31, .075, 16), dark, 0, .10, .72);
  glass.rotation.x = Math.PI / 2;
  part(model, new TorusGeometry(.23, .022, 8, 32), beacon, 0, .10, .766);
  strut(model, alloy, [.35, .66, .19], [.67, 1.43, .23], .039);
  return model;
}

function parabolicDish(model, x, y, scale, tilt) {
  const dish = new Group();
  dish.position.set(x, y, .49);
  dish.rotation.set(-.18, tilt, 0);
  dish.scale.setScalar(scale);
  model.add(dish);
  const profile = Array.from({ length: 13 }, (_, index) => {
    const radius = index / 12;
    return new Vector2(radius, .38 * radius ** 2);
  });
  const reflector = part(dish, new LatheGeometry(profile, 42), porcelain, 0, 0, 0);
  reflector.rotation.x = Math.PI / 2;
  part(dish, new TorusGeometry(1, .058, 10, 54), alloy, 0, 0, .38);
  for (let index = 0; index < 3; index++) {
    const angle = (index * 2 + .5) * Math.PI / 3;
    strut(dish, dark, [.88 * Math.cos(angle), .88 * Math.sin(angle), .31], [0, 0, .79], .027);
  }
  const feed = part(dish, new CylinderGeometry(.15, .10, .20, 12), brass, 0, 0, .79);
  feed.rotation.x = Math.PI / 2;
}

function relay() {
  const model = new Group();
  fuselage(model);
  wings(model, { cell: '#34538f', highlight: '#a0b1ed', height: -.42, pitch: -.28, sweep: -.11, panel: 1.39, taper: .09 });
  parabolicDish(model, .06, .36, 1.08, -.15);
  strut(model, brass, [-.4, .55, .08], [-.67, 1.48, .09], .032);
  return model;
}

function surveyor() {
  const model = new Group();
  fuselage(model);
  wings(model, { cell: '#284c7b', highlight: '#84bddb', height: .28, pitch: .29, sweep: .28, panel: 1.35, taper: .33 });
  box(model, alloy, 0, .10, .58, .80, 1.54, .38, .082);
  box(model, dark, 0, .32, .80, .52, .59, .10, .045);
  box(model, beacon, 0, .30, .862, .32, .11, .035);
  parabolicDish(model, -.31, -.54, .44, .47);
  strut(model, alloy, [.37, .51, .19], [.66, 1.45, .33], .031);
  strut(model, brass, [-.08, .61, .19], [-.14, 1.14, .31], .030);
  return model;
}

export function renderSatelliteAtlas(frames) {
  const width = 256;
  const height = 160;
  const sheet = document.createElement('canvas');
  sheet.width = width * frames;
  sheet.height = height * 3;
  const context = sheet.getContext('2d');
  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(width, height, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .65;
  for (const [color, intensity, x, y, z] of [
    ['#fff0d6', 3.3, -4, 7, 8], ['#8de2f8', 1.7, 5, 1, -3], ['#7564b9', 1.1, -6, -4, -6],
  ]) {
    const light = new DirectionalLight(color, intensity);
    light.position.set(x, y, z);
    scene.add(light);
  }
  scene.add(new AmbientLight('#626680', .5));
  const camera = new OrthographicCamera(-5.67, 5.67, 3.54, -3.54, .1, 100);
  camera.position.z = 18;

  for (const [row, model] of [collector(), relay(), surveyor()].entries()) {
    scene.add(model);
    for (let frame = 0; frame < frames; frame++) {
      const angle = frame / frames * Math.PI * 2;
      model.rotation.set(-.34 + .19 * Math.sin(angle), -.36 + .68 * Math.cos(angle), -.09 + .13 * Math.sin(angle));
      renderer.render(scene, camera);
      context.drawImage(renderer.domElement, frame * width, row * height);
    }
    scene.remove(model);
  }
  environment.dispose();
  room.dispose();
  pmrem.dispose();
  renderer.dispose();
  return sheet;
}
