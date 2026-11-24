import { geoEquirectangular, geoGraticule, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import {
  AnimationClip, BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide,
  ExtrudeGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial,
  Shape, SphereGeometry, SRGBColorSpace, Vector2, Vector3, VectorKeyframeTrack,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export { arcGeometry, grain, group, material, part, spindle, texture };

const radius = 12;
const axis = new Vector3(0, 1, 0);
const degree = Math.PI / 180;

function texture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'));
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  map.userData.mimeType = 'image/jpeg';
  return map;
}

function grain(context, width, height, strength) {
  let seed = 4129;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  }
  for (let index = 0; index < height * 1.15; index++) {
    const y = random() * height;
    const slope = (random() - .5) * height * .10;
    const wave = random() * 27;
    context.beginPath();
    context.moveTo(-4, y);
    context.bezierCurveTo(width * .30, y + wave, width * .57, y - wave, width + 4, y + slope);
    context.lineWidth = .4 + random() * 1.6;
    context.strokeStyle = random() > .57 ? '#fff4d3' : '#362016';
    context.globalAlpha = strength * (.12 + random() * .88);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function mapTexture(atlas) {
  const width = 1024;
  const height = 512;
  const land = feature(atlas, atlas.objects.land);
  const borders = mesh(atlas, atlas.objects.countries, (left, right) => left !== right);
  const projection = geoEquirectangular().scale(width / (2 * Math.PI)).translate([width / 2, height / 2]);
  return texture(width, height, context => {
    const path = geoPath(projection, context);
    context.fillStyle = '#304a49';
    context.fillRect(0, 0, width, height);
    context.beginPath();
    path(land);
    context.fillStyle = '#daa776';
    context.fill();
    grain(context, width, height, .14);
    function stroke(shape, color, lineWidth) {
      context.beginPath();
      path(shape);
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.stroke();
    }
    stroke(geoGraticule().step([15, 15])(), '#e8cea54a', .95);
    stroke(borders, '#50362e79', .65);
    stroke(land, '#624135', 1.05);
  });
}

function material(color, options = {}) {
  return new MeshStandardMaterial({ color, roughness: .68, ...options });
}

function part(parent, name, geometry, surface, x = 0, y = 0, z = 0) {
  const object = new Mesh(geometry, surface);
  object.name = name;
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}

function group(parent, name) {
  const object = new Group();
  object.name = name;
  parent.add(object);
  return object;
}

function spindle(parent, name, r, length, surface, center, direction = axis, segments = 24) {
  const object = part(parent, name, new CylinderGeometry(r, r, length, segments), surface, ...center.toArray());
  object.quaternion.setFromUnitVectors(axis, direction);
  return object;
}

function ringShape(outer, inner, start, end, sections) {
  const points = [];
  for (let index = 0; index <= sections; index++) {
    const angle = start + (end - start) * index / sections;
    points.push(new Vector2(outer * Math.cos(angle), outer * Math.sin(angle)));
  }
  for (let index = sections; index >= 0; index--) {
    const angle = start + (end - start) * index / sections;
    points.push(new Vector2(inner * Math.cos(angle), inner * Math.sin(angle)));
  }
  return new Shape(points);
}

function arcGeometry(outer, inner, length, start = 0, end = 2 * Math.PI, sections = 40) {
  return new ExtrudeGeometry(ringShape(outer, inner, start, end, sections), {
    depth: length, bevelEnabled: false, curveSegments: 1,
  }).translate(0, 0, -length / 2);
}

function roundedShape(width, height, radius) {
  const x = width / 2;
  const y = height / 2;
  const shape = new Shape();
  shape.moveTo(-x + radius, -y);
  shape.lineTo(x - radius, -y);
  shape.quadraticCurveTo(x, -y, x, -y + radius);
  shape.lineTo(x, y - radius);
  shape.quadraticCurveTo(x, y, x - radius, y);
  shape.lineTo(-x + radius, y);
  shape.quadraticCurveTo(-x, y, -x, y - radius);
  shape.lineTo(-x, -y + radius);
  shape.quadraticCurveTo(-x, -y, -x + radius, -y);
  return shape;
}

function blockGeometry(width, depth, thickness, corner, bevel = .12) {
  const geometry = new ExtrudeGeometry(roundedShape(width, depth, corner), {
    depth: thickness - 2 * bevel, steps: 1, curveSegments: 5,
    bevelEnabled: Boolean(bevel), bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2).translate(0, bevel, 0);
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const normals = geometry.attributes.normal;
  for (let index = 0; index < positions.count; index++) {
    uv.setXY(index, .5 + positions.getX(index) / (width + .5), Math.abs(normals.getY(index)) > .7
      ? .5 + positions.getZ(index) / (depth + .5)
      : .5 + positions.getY(index) / Math.max(1, thickness * 2));
  }
  return geometry;
}

function location(latitude, longitude) {
  const lat = latitude * degree;
  const lon = longitude * degree;
  return new Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)).multiplyScalar(radius);
}

function makePanel(south, north, west, east) {
  const middleLongitude = (west + east) / 2;
  const corners = south === -90 ? [[south, middleLongitude], [north, east], [north, west]]
    : north === 90 ? [[south, west], [south, east], [north, middleLongitude]]
      : [[south, west], [south, east], [north, east], [north, west]];
  const points = corners.map(([lat, lon]) => location(lat, lon));
  const center = points.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(points.length);
  const uvCenter = new Vector2((middleLongitude + 180) / 360, ((south + north) / 2 + 90) / 180);
  const uv = corners.map(([lat, lon]) => new Vector2((lon + 180) / 360, (lat + 90) / 180).lerp(uvCenter, .017));
  const direction = center.clone().normalize();
  const face = points.map(point => point.clone().lerp(center, .017));
  const side = points.map(point => point.clone().lerp(center, .008).addScaledVector(direction, -.075));
  const layers = [face, side, side.map(point => point.clone().addScaledVector(direction, -.16)),
    side.map(point => point.clone().addScaledVector(direction, -.39))];
  const positions = [];
  const coordinates = [];
  const geometry = new BufferGeometry();
  function triangle(a, b, c, uvA = new Vector2(), uvB = uvA, uvC = uvA) {
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    coordinates.push(...uvA.toArray(), ...uvB.toArray(), ...uvC.toArray());
  }
  for (let index = 1; index < face.length - 1; index++) {
    triangle(face[0], face[index], face[index + 1], uv[0], uv[index], uv[index + 1]);
  }
  geometry.addGroup(0, positions.length / 3, 0);
  for (let layer = 0; layer < layers.length - 1; layer++) {
    const offset = positions.length / 3;
    for (let index = 0; index < face.length; index++) {
      const next = (index + 1) % face.length;
      triangle(layers[layer][index], layers[layer + 1][index], layers[layer + 1][next]);
      triangle(layers[layer][index], layers[layer + 1][next], layers[layer][next]);
    }
    geometry.addGroup(offset, positions.length / 3 - offset, layer + 1);
  }
  const inside = layers.at(-1);
  const offset = positions.length / 3;
  for (let index = 1; index < inside.length - 1; index++) triangle(inside[0], inside[index + 1], inside[index]);
  geometry.addGroup(offset, positions.length / 3 - offset, 4);
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(coordinates, 2));
  geometry.computeVertexNormals();
  return { geometry, direction };
}

function labelTexture() {
  return texture(288, 96, context => {
    context.fillStyle = '#1a211e';
    context.fillRect(0, 0, 288, 96);
    context.fillStyle = '#efc17f';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '600 30px Georgia, serif';
    context.fillText('ГЛОБУС РАДИО', 144, 49);
  });
}

function baseAssembly(root, surfaces, move) {
  const { brass, dark, walnut, edge, board, metal } = surfaces;
  const base = group(root, 'Основание');
  const bottom = group(base, 'Нижняя крышка');
  part(bottom, 'Поддон', blockGeometry(29.8, 21, .75, 1.8), dark, 0, .48);
  for (const x of [-11.7, 11.7]) {
    for (const z of [-7.5, 7.5]) spindle(bottom, 'Опора', .89, .48, dark, new Vector3(x, .24, z));
  }
  move(bottom, 0, -3.6, 0);

  const walls = group(base, 'Стенки основания');
  for (const z of [-9.98, 9.98]) part(walls, 'Длинная стенка', blockGeometry(29.2, 1.15, 2.80, .3), walnut, 0, 1.10, z);
  for (const x of [-14.05, 14.05]) part(walls, 'Боковина', blockGeometry(1.30, 18.8, 2.80, .3), walnut, x, 1.10);
  move(walls, 0, -1.8, 0);
  const lid = group(base, 'Верхняя крышка');
  part(lid, 'Крышка из ореха', blockGeometry(30.1, 21.3, .68, 1.9), walnut, 0, 3.78);
  part(lid, 'Фанерный слой', blockGeometry(29.85, 21.04, .24, 1.85, .035), edge, 0, 3.57);
  for (const x of [-12.65, 12.65]) {
    for (const z of [-8.1, 8.1]) spindle(lid, 'Винт крышки', .19, .075, brass, new Vector3(x, 4.478, z), axis, 12);
  }
  move(lid, 0, 2.75, -5.0);

  const face = group(base, 'Лицевая панель');
  const screen = part(face, 'Панель управления', blockGeometry(27.1, 2.43, .23, .45, .035), dark, 0, 2.55, 10.65);
  screen.rotation.x = Math.PI / 2;
  const grille = group(face, 'Решётка динамика');
  for (let column = 0; column < 11; column++) {
    part(grille, 'Ребро решётки', new BoxGeometry(.115, 1.2, .13), edge, -12.05 + column * .39, 2.61, 10.95);
  }
  const display = material('#ffffff', { map: labelTexture(), emissive: '#594126', emissiveIntensity: .25 });
  part(face, 'Табличка', new BoxGeometry(9.7, 1.20, .13), display, -.85, 2.57, 10.94);
  const front = new Vector3(0, 0, 1);
  spindle(face, 'Окантовка ручки', 1.11, .31, brass, new Vector3(10.35, 2.55, 10.98), front, 32);
  spindle(face, 'Ручка громкости', .94, .65, metal, new Vector3(10.35, 2.55, 11.28), front, 32);
  part(face, 'Риска ручки', new BoxGeometry(.09, .39, .09), brass, 10.35, 3.04, 11.62);
  move(face, 0, -1.8, 5.0);

  const components = group(base, 'Радиомодуль и динамик');
  part(components, 'Плата радиомодуля', new BoxGeometry(7.2, .16, 4.35), board, 3.8, 1.77, .45);
  part(components, 'Экран радиомодуля', new BoxGeometry(2.75, .27, 2.68), metal, 3.9, 1.98, -.1);
  part(components, 'Разъём питания', new BoxGeometry(1.32, .5, 1.07), brass, 3.9, 2.02, 2.3);
  for (const x of [.85, 6.78]) {
    for (let row = 0; row < 7; row++) part(components, 'Контакт', new BoxGeometry(.28, .09, .18), brass, x, 1.92, -1 + row * .45);
  }
  spindle(components, 'Корпус динамика', 2.75, 1.35, metal, new Vector3(-9.9, 2.5, 6.2));
  spindle(components, 'Диффузор', 2.27, .22, dark, new Vector3(-9.9, 3.26, 6.2));
  move(components, -9.6, .2, 6.4);
}

export async function buildKitModel(atlas) {
  const root = new Group();
  root.name = 'Глобус Радио';
  root.scale.setScalar(.01);
  const tracks = [];
  function move(object, x, y, z) {
    const start = object.position.toArray();
    tracks.push(new VectorKeyframeTrack(`${object.uuid}.position`, [0, 1], [
      ...start, start[0] + x, start[1] + y, start[2] + z,
    ]));
  }

  const brass = material('#c49656', { metalness: .70, roughness: .34 });
  const metal = material('#424c48', { metalness: .48, roughness: .54 });
  const dark = material('#252422');
  const edge = material('#b9814b');
  const birch = material('#c39966');
  const ply = material('#815234');
  const board = material('#375646');
  const walnut = material('#ffffff', { map: texture(512, 256, context => {
    context.fillStyle = '#855031';
    context.fillRect(0, 0, 512, 256);
    grain(context, 512, 256, .20);
  }) });
  baseAssembly(root, { brass, dark, walnut, edge, board, metal }, move);
  part(root, 'Стойка оси', blockGeometry(7.10, 5.9, 1.15, .8), ply, 1.58, 4.47);

  const assembly = group(root, 'Полярные опоры');
  assembly.position.y = 17.85;
  assembly.rotation.z = 13 * degree;
  const polarRod = spindle(assembly, 'Вал вращения', .47, 25.5, metal, new Vector3());
  move(polarRod, 0, 8.6, 0);
  for (const side of [-1, 1]) {
    const mount = spindle(assembly, side === 1 ? 'Северная втулка' : 'Южная втулка', 1.17, 1.18, brass, new Vector3(0, side * 12.27, 0));
    move(mount, 0, side * 2.7, 0);
  }
  const sensor = part(assembly, 'Датчик оси (макет)', new BoxGeometry(1.40, .24, 1.31), board, 0, -13.03);
  move(sensor, -.7, -3.0, -2.6);

  const skin = group(assembly, 'Фанерные панели шара');
  // Aim the front face of the atlas towards Europe and Africa in the default view.
  skin.rotation.y = 18 * degree;
  const globeSurface = material('#ffffff', { map: mapTexture(atlas), roughness: .83 });
  const panelSurfaces = [globeSurface, edge, ply, edge, birch];
  for (let south = -90; south < 90; south += 30) {
    for (let west = -180; west < 180; west += 22.5) {
      const { geometry, direction } = makePanel(south, south + 30, west, west + 22.5);
      const name = `Панель ${south + 90}/${west + 180}`;
      const panel = part(skin, name, geometry, panelSurfaces);
      const frontHalf = direction.z > .52;
      const spreadX = frontHalf ? Math.sign(direction.x) * 6.9 : 0;
      move(panel, direction.x * 3.7 + spreadX, direction.y * 3.05, direction.z * 4.2);
    }
  }

  const ribs = group(assembly, 'Внутренние рёбра и кольца');
  const ribGeometry = arcGeometry(11.10, 9.0, .46, -Math.PI / 2, Math.PI / 2, 32);
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    const rib = part(ribs, `Ребро ${index + 1}`, ribGeometry, birch);
    rib.rotation.y = angle;
    move(rib, Math.cos(angle) * 1.09, 0, -Math.sin(angle) * 1.09);
  }
  const beltGeometry = arcGeometry(10.40, 7.0, .47);
  for (const side of [-1, 1]) {
    const belt = part(ribs, 'Поперечное кольцо', beltGeometry, edge, 0, side * 3.3);
    belt.rotation.x = Math.PI / 2;
    move(belt, 0, side * 1.4, 0);
  }

  const meridian = group(assembly, 'Меридианная опора и направляющая');
  meridian.rotation.y = -.45;
  const yoke = group(meridian, 'Деревянная дуга');
  yoke.rotation.y = .67;
  const yokeGeometry = arcGeometry(14.0, 12.67, .84, Math.PI / 2, Math.PI * 1.50, 54);
  part(yoke, 'Средний слой дуги', yokeGeometry, ply);
  const yokeFace = arcGeometry(13.92, 12.73, .20, Math.PI / 2, Math.PI * 1.50, 54);
  for (const side of [-1, 1]) part(yoke, 'Наружный слой дуги', yokeFace, birch, 0, 0, side * .48);
  part(yoke, 'Латунная полоска дуги', arcGeometry(13.91, 13.75, .038, Math.PI * .56, Math.PI * 1.44, 47), brass, 0, 0, .60);
  move(yoke, -4.9, .35, -.15);

  const rail = group(meridian, 'Направляющая лупы');
  part(rail, 'Дуга направляющей', arcGeometry(13.45, 12.95, .55, -Math.PI / 2, Math.PI / 2, 52), metal);
  part(rail, 'Кромка направляющей', arcGeometry(13.51, 13.36, .17, -Math.PI / 2, Math.PI / 2, 52), brass, 0, 0, .20);
  const tick = new BoxGeometry(.28, .078, .065);
  for (let latitude = -70; latitude <= 70; latitude += 10) {
    const angle = latitude * degree;
    const mark = part(rail, 'Градусная риска', tick, brass, 13.2 * Math.cos(angle), 13.2 * Math.sin(angle), .29);
    mark.rotation.z = angle;
  }
  move(rail, 4.0, .75, 1.15);

  const lens = group(meridian, 'Лупа с кареткой');
  const lensLatitude = 28 * degree;
  const normal = new Vector3(Math.cos(lensLatitude), Math.sin(lensLatitude), 0);
  const ring = group(lens, 'Латунная оправа');
  ring.position.copy(normal).multiplyScalar(13.85);
  ring.position.z = 2.2;
  ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
  part(ring, 'Обод лупы', arcGeometry(2.34, 1.89, .69, 0, 2 * Math.PI, 48), brass);
  part(ring, 'Кольцо линзы', arcGeometry(1.97, 1.84, .13, 0, 2 * Math.PI, 48), metal, 0, 0, .37);
  const glass = material('#c5e9df', { transparent: true, opacity: .18, roughness: .11, side: DoubleSide, depthWrite: false });
  const optic = part(ring, 'Прозрачная линза', new SphereGeometry(1.88, 30, 14), glass, 0, 0, .15);
  optic.scale.z = .13;
  const carriage = part(lens, 'Каретка направляющей', new BoxGeometry(.75, 1.24, 1.30), dark, 13.37 * normal.x, 13.37 * normal.y, .43);
  carriage.rotation.z = lensLatitude;
  const carriageSensor = part(lens, 'Датчик каретки (макет)', new BoxGeometry(.46, .63, .14), board, 13.37 * normal.x, 13.37 * normal.y, -.27);
  carriageSensor.rotation.z = lensLatitude;
  spindle(lens, 'Винт каретки', .26, .38, brass, new Vector3(13.81 * normal.x, 13.81 * normal.y, .49), normal, 14);
  move(lens, 5.8, 2.75, 4.8);

  const animation = new AnimationClip('Разборка', 1, tracks);
  return new GLTFExporter().parseAsync(root, { binary: true, animations: [animation], maxTextureSize: 1024 });
}
