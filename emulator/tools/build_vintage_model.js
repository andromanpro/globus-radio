import { geoEquirectangular, geoGraticule, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import {
  AnimationClip, BoxGeometry, DoubleSide, ExtrudeGeometry, Group, Path, Shape, SphereGeometry,
  Quaternion, QuaternionKeyframeTrack, Vector2, Vector3, VectorKeyframeTrack,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { arcGeometry, grain, group, material, part, spindle, texture } from './build_kit_model.js';

const degree = Math.PI / 180;
const turn = Math.PI * 2;
const radius = 11.5;
const axis = new Vector3(0, 1, 0);
const front = new Vector3(0, 0, 1);
const lensRadial = 13.15;
const lensForward = 4.7;
const mountAngle = 163 * degree;
const latitudeLimit = 65 * degree;
// GeoNames 3451190. The lens begins over Rio de Janeiro.
const initialLatitude = -22.90642 * degree;
const initialLongitude = -43.18223 * degree;

function carriageAngle(latitude) {
  return Math.PI - Math.asin(Math.sin(latitude) * Math.hypot(lensRadial, lensForward) / lensRadial);
}

function parchment(atlas) {
  const width = 2048;
  const height = 1024;
  const land = feature(atlas, atlas.objects.land);
  const borders = mesh(atlas, atlas.objects.countries, (a, b) => a !== b);
  const projection = geoEquirectangular().scale(width / turn).translate([width / 2, height / 2]);
  return texture(width, height, context => {
    const path = geoPath(projection, context);
    const paper = context.createLinearGradient(0, 0, 0, height);
    paper.addColorStop(0, '#ad7334');
    paper.addColorStop(.28, '#f3cf79');
    paper.addColorStop(.54, '#ffdc80');
    paper.addColorStop(.81, '#f2c46d');
    paper.addColorStop(1, '#ae7536');
    context.fillStyle = paper;
    context.fillRect(0, 0, width, height);
    context.beginPath();
    path(land);
    context.fillStyle = '#c37833';
    context.fill();
    function stroke(shape, color, lineWidth) {
      context.beginPath();
      path(shape);
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.stroke();
    }
    stroke(geoGraticule().step([15, 15])(), '#79442675', 1.4);
    stroke(borders, '#67351eae', 1.2);
    stroke(land, '#753b22', 1.7);
    context.font = 'italic 16px Georgia, serif';
    context.textAlign = 'center';
    context.fillStyle = '#643c24';
    for (const [label, lon, lat] of [['АТЛАНТИЧЕСКИЙ ОКЕАН', -42, 14], ['ИНДИЙСКИЙ ОКЕАН', 81, -23], ['ТИХИЙ ОКЕАН', -136, -6]]) {
      context.fillText(label, ...projection([lon, lat]));
    }
  });
}

function engravedScale() {
  const size = 768;
  return texture(512, 512, context => {
    context.scale(512 / size, 512 / size);
    context.fillStyle = '#b9804b';
    context.fillRect(0, 0, size, size);
    grain(context, size, size, .11);
    context.translate(size / 2, size / 2);
    context.strokeStyle = '#56351f';
    context.fillStyle = '#4a2c1c';
    for (const circle of [345, 365, 378]) {
      context.beginPath();
      context.arc(0, 0, circle, 0, turn);
      context.lineWidth = circle === 378 ? 2.4 : 1.7;
      context.stroke();
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '600 17px Georgia, serif';
    for (let angle = 0; angle < 360; angle += 2) {
      const major = angle % 10 === 0;
      const theta = -angle * degree;
      context.save();
      context.rotate(theta + Math.PI / 2);
      context.beginPath();
      context.moveTo(0, -365);
      context.lineTo(0, major ? -346 : -356);
      context.lineWidth = major ? 2 : 1.2;
      context.stroke();
      if (angle % 30 === 0) {
        const latitude = Math.round(Math.abs(Math.asin(Math.sin(theta)) / degree));
        context.fillText(`${latitude}°`, 0, -329);
      }
      context.restore();
    }
  });
}

function plateName() {
  return texture(280, 96, context => {
    context.fillStyle = '#6a4127';
    context.fillRect(0, 0, 280, 96);
    context.strokeStyle = '#c39657';
    context.lineWidth = 3;
    context.strokeRect(8, 8, 264, 80);
    context.fillStyle = '#eed19b';
    context.font = 'bold 29px Georgia, serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('ГЛОБУС РАДИО', 140, 50);
  });
}

function mappedRing(outer, inner, depth) {
  const geometry = arcGeometry(outer, inner, depth, 0, turn, 116);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let index = 0; index < pos.count; index++) {
    uv.setXY(index, .5 + pos.getX(index) / (2 * outer), .5 + pos.getY(index) / (2 * outer));
  }
  return geometry;
}

function gearGeometry(radius, teeth, thickness) {
  const outline = [];
  for (let tooth = 0; tooth < teeth; tooth++) {
    for (const [offset, height] of [[0, .83], [.20, .84], [.28, 1], [.62, 1], [.70, .84], [.85, .83]]) {
      const angle = (tooth + offset) / teeth * turn;
      outline.push(new Vector2(radius * height * Math.cos(angle), radius * height * Math.sin(angle)));
    }
  }
  const shape = new Shape(outline);
  function cut(x, y, r) {
    const opening = new Path();
    opening.absarc(x, y, r, 0, turn, true);
    shape.holes.push(opening);
  }
  cut(0, 0, .23);
  for (let index = 0; index < 5; index++) {
    const angle = index / 5 * turn;
    cut(.51 * radius * Math.cos(angle), .51 * radius * Math.sin(angle), .18 * radius);
  }
  return new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 7 })
    .translate(0, 0, -thickness / 2);
}

function bearingStand() {
  const shape = new Shape();
  shape.moveTo(-3.25, 0);
  shape.lineTo(3.25, 0);
  shape.quadraticCurveTo(2.15, .7, 1.60, 2.3);
  shape.quadraticCurveTo(1.1, 3.1, 2.15, 4.4);
  shape.quadraticCurveTo(1.15, 5.35, 0, 5.65);
  shape.quadraticCurveTo(-1.15, 5.35, -2.15, 4.4);
  shape.quadraticCurveTo(-1.1, 3.1, -1.60, 2.3);
  shape.quadraticCurveTo(-2.15, .7, -3.25, 0);
  const cut = new Path();
  cut.absarc(0, 3.75, .65, 0, turn, true);
  shape.holes.push(cut);
  return new ExtrudeGeometry(shape, { depth: .62, bevelEnabled: true, bevelThickness: .065, bevelSize: .07, bevelSegments: 1, curveSegments: 12 });
}

function buildBase(root, surfaces, move) {
  const { brass, walnut, char, birch, steel } = surfaces;
  const base = group(root, 'Круглое основание');
  const bottom = group(base, 'Нижний диск с ножками');
  spindle(bottom, 'Диск основания', 9.83, .53, walnut, new Vector3(0, .83, 0), axis, 88);
  spindle(bottom, 'Кромка основания', 9.95, .15, brass, new Vector3(0, 1.13, 0), axis, 88);
  for (let count = 0; count < 3; count++) {
    const angle = count / 3 * turn + .72;
    const foot = group(bottom, `Фигурная ножка ${count + 1}`);
    foot.rotation.y = -angle;
    foot.position.set(8.25 * Math.cos(angle), 0, 8.25 * Math.sin(angle));
    part(foot, 'Галтель', new BoxGeometry(1.7, .25, 1.19), walnut, 0, .58, 0);
    spindle(foot, 'Опорный башмак', .67, .40, char, new Vector3(.38, .22, 0));
  }
  move(bottom, 0, -3.5, 0);

  const slats = group(base, 'Реечная обечайка');
  const batten = new BoxGeometry(.39, 2.48, .44);
  for (let index = 0; index < 92; index++) {
    const angle = index / 92 * turn;
    if (Math.abs(angle - Math.PI / 2) < .38) continue;
    const strip = part(slats, 'Рейка', batten, index % 3 === 0 ? birch : walnut, Math.cos(angle) * 9.48, 2.40, Math.sin(angle) * 9.48);
    strip.rotation.y = Math.PI / 2 - angle;
  }
  move(slats, 0, -1.5, 0);

  const deck = group(base, 'Крышка с круглой шкалой');
  spindle(deck, 'Крышка', 9.98, .63, walnut, new Vector3(0, 3.94, 0), axis, 96);
  spindle(deck, 'Обод крышки', 10.01, .14, brass, new Vector3(0, 4.28, 0), axis, 96);
  const trim = part(deck, 'Вставка со шкалой', mappedRing(8.86, 7.58, .13), surfaces.scale, 0, 4.37, 0);
  trim.rotation.x = -Math.PI / 2;
  const label = material('#ffffff', { map: plateName() });
  part(deck, 'Табличка', new BoxGeometry(6.1, .98, .18), label, 0, 2.65, 9.44);
  spindle(deck, 'Ручка громкости', .82, .64, brass, new Vector3(4.07, 2.35, 8.9), new Vector3(.42, 0, .907).normalize());
  move(deck, 0, 1.1, -5.8);

  const board = group(base, 'Радиомодуль и динамик');
  part(board, 'Плата радиомодуля', new BoxGeometry(4.9, .16, 3.9), material('#4e6a4d'), -3.0, 1.42, -.7);
  part(board, 'Корпус радиомодуля', new BoxGeometry(2.6, .26, 2.5), steel, -2.75, 1.62, -.7);
  spindle(board, 'Динамик', 2.2, 1.15, steel, new Vector3(3.3, 1.95, -1.72));
  spindle(board, 'Диффузор', 1.84, .19, char, new Vector3(3.3, 2.58, -1.72));
  move(board, 9.7, -.9, 4.7);

  const support = group(root, 'Стойка и привод');
  spindle(support, 'Пята стойки', 4.38, .55, walnut, new Vector3(0, 4.53, 0), axis, 64);
  spindle(support, 'Фланец стойки', 3.63, .31, brass, new Vector3(0, 4.95, 0), axis, 56);
  const pillar = bearingStand();
  for (const z of [-1.2, 1.2]) part(support, 'Фигурная щёка', pillar, [birch, char], 0, 5.08, z);
  part(support, 'Поперечная связка', new BoxGeometry(2.75, .65, 2.66), walnut, 0, 7.85, 0);
  spindle(support, 'Цапфа кольца', .72, 3.52, brass, new Vector3(0, 8.24, .07), front);
  const visibleGears = group(support, 'Наружные шестерни');
  const gears = [];
  for (const [index, [x, y, r, teeth, phase]] of [
    [-1.53, 6.9, 2.15, 16, .09], [-3.70, 9.13, 1.37, 10, .20], [1.52, 7.77, 1.42, 11, .1],
  ].entries()) {
    const gear = part(visibleGears, `Шестерня ${index + 1}`, gearGeometry(r, teeth, .55), [birch, char], x, y, 2.85);
    gear.rotation.z = phase;
    gears.push(gear);
    spindle(visibleGears, 'Ось шестерни', .32, .96, brass, new Vector3(x, y, 2.88), front, 24);
  }
  move(visibleGears, -5.0, .5, 3.0);
  return gears;
}

function buildGlobe(mount, map, surfaces, move) {
  const { walnut, brass, steel, birch } = surfaces;
  const sphere = group(mount, 'Шар');
  sphere.rotation.y = Math.atan2(lensRadial * Math.cos(carriageAngle(initialLatitude)), lensForward) - initialLongitude;
  const shell = group(sphere, 'Светорассеивающие сегменты');
  const paper = material('#bf945f', {
    map, emissiveMap: map, emissive: '#ffb14e', emissiveIntensity: 1.46, roughness: .77, side: DoubleSide,
  });
  paper.name = 'Подсвечиваемая карта';
  for (let band = 0; band < 2; band++) {
    for (let longitude = 0; longitude < 12; longitude++) {
      const phi = turn * longitude / 12;
      const width = turn / 12;
      const geometry = new SphereGeometry(radius, 7, 22, phi + .002, width - .004, band * Math.PI / 2, Math.PI / 2)
        .rotateY(-Math.PI / 2);
      const uv = geometry.attributes.uv;
      for (let index = 0; index < uv.count; index++) {
        uv.setXY(index, (phi + .002 + (width - .004) * uv.getX(index)) / turn, (uv.getY(index) + 1 - band) / 2);
      }
      const panel = part(shell, `Сегмент ${band + 1}/${longitude + 1}`, geometry, paper);
      const angle = phi + width / 2;
      const x = -Math.sin(angle);
      const z = -Math.cos(angle);
      const open = z > .36 ? 5.4 * Math.sign(x) : 0;
      move(panel, x * 3.0 + open, band === 0 ? 3.8 : -2.25, z * 3.25);
    }
  }

  const frame = group(sphere, 'Рёбра и экваториальный пояс');
  const ribShape = arcGeometry(radius + .10, radius - .10, .14, -Math.PI / 2, Math.PI / 2, 60);
  const crossbar = arcGeometry(radius + .35, radius + .03, .44, -.35, .35, 18);
  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * turn;
    const rib = part(frame, 'Меридианное ребро', ribShape, birch);
    rib.rotation.y = angle;
    const brace = part(frame, 'Рамка экваториального пояса', crossbar, walnut);
    brace.rotation.y = angle;
    if (index % 2 === 0) {
      const normal = new Vector3(Math.cos(angle), 0, -Math.sin(angle));
      const mount = normal.clone().multiplyScalar(radius + .49);
      spindle(frame, 'Шестигранная накладка', .75, .27, walnut, mount, normal, 6);
      spindle(frame, 'Винт накладки', .22, .29, brass, mount.clone().addScaledVector(normal, .14), normal, 14);
    }
  }
  const lat = .352;
  for (const side of [-1, 1]) {
    const edges = part(frame, 'Обод экваториального пояса', arcGeometry(radius * Math.cos(lat) + .36, radius * Math.cos(lat) - .02, .33, 0, turn, 84),
      walnut, 0, side * radius * Math.sin(lat));
    edges.rotation.x = Math.PI / 2;
  }
  move(frame, 0, -1.2, -3.5);

  const lamp = group(mount, 'Внутренняя подсветка');
  const lampSurface = material('#ffcd8b', { emissive: '#ff9433', emissiveIntensity: 1.7, roughness: .43 });
  lampSurface.name = 'Рассеиватель подсветки';
  spindle(lamp, 'Стойка рассеивателя', .43, 11.1, steel, new Vector3(0, -5.5, 0));
  const diffuser = part(lamp, 'Рассеиватель', new SphereGeometry(2.50, 24, 18), lampSurface, 0, -.55, 0);
  diffuser.scale.y = 1.4;
  spindle(lamp, 'Держатель рассеивателя', 1.58, .61, brass, new Vector3(0, -3.85, 0));
  move(lamp, -.7, -1.4, 1.35);
  return sphere;
}

function buildMeridian(mount, surfaces, move) {
  const { brass, walnut, birch, char, steel, scale } = surfaces;
  const ring = group(mount, 'Меридианное кольцо');
  part(ring, 'Задний слой', arcGeometry(14.71, 12.62, .45, 0, turn, 104), walnut, 0, 0, -.48);
  part(ring, 'Фанерная проставка', arcGeometry(14.48, 12.82, .85, 0, turn, 104), char, 0, 0, .04);
  part(ring, 'Гравированная шкала', mappedRing(14.89, 12.74, .40), [scale, walnut], 0, 0, .65);
  part(ring, 'Внутренняя латунная кромка', arcGeometry(12.89, 12.71, .12, 0, turn, 100), brass, 0, 0, .89);
  for (let index = 0; index < 8; index++) {
    const angle = (index / 8) * turn + .175;
    const lug = part(ring, 'Накладка кольца', new BoxGeometry(1.36, .71, .24), birch,
      14.77 * Math.cos(angle), 14.77 * Math.sin(angle), .72);
    lug.rotation.z = angle + Math.PI / 2;
    spindle(ring, 'Крепёжный винт', .16, .13, char, new Vector3(lug.position.x, lug.position.y, .88), front, 16);
  }
  for (let angle = 215; angle < 264; angle += 2.9) {
    const theta = angle * degree;
    const tooth = part(ring, 'Зубец сектора', new BoxGeometry(.58, .29, .48), walnut,
      14.92 * Math.cos(theta), 14.92 * Math.sin(theta), -.12);
    tooth.rotation.z = theta;
  }
  move(ring, 2.3, 1.05, -4.45);

  const pivots = group(mount, 'Полярные втулки');
  for (const side of [-1, 1]) {
    spindle(pivots, 'Опорная цапфа', .63, 3.3, steel, new Vector3(0, side * 12.65, 0));
    spindle(pivots, 'Шайба опоры', 1.54, .26, walnut, new Vector3(0, side * 11.42, 0));
    spindle(pivots, 'Гайка', .94, .45, brass, new Vector3(0, side * 14.87, 0), axis, 10);
  }
  move(pivots, 0, 1.25, -2.6);

  const lens = group(mount, 'Лупа и каретка');
  const angle = mountAngle;
  const radial = new Vector3(Math.cos(angle), Math.sin(angle), 0);
  const tangent = new Vector3(-radial.y, radial.x, 0);
  const seat = radial.clone().multiplyScalar(13.83).setZ(1.10);
  const carriage = part(lens, 'Каретка меридианной дуги', new BoxGeometry(1.29, 1.68, .77), walnut, ...seat.toArray());
  carriage.rotation.z = angle;
  for (const side of [-1, 1]) {
    const screw = seat.clone().addScaledVector(tangent, side * .51).setZ(1.54);
    spindle(lens, 'Винт каретки', .15, .14, brass, screw, front, 16);
  }

  const optic = group(lens, 'Латунное кольцо лупы');
  optic.position.copy(radial).multiplyScalar(lensRadial).setZ(lensForward);
  // The optical axis points at the centre of the globe, leaving room for the raised wooden belt.
  const normal = optic.position.clone().normalize();
  optic.quaternion.setFromUnitVectors(front, normal);
  part(optic, 'Деревянная оправа', arcGeometry(2.50, 1.97, .63, 0, turn, 48), walnut);
  part(optic, 'Латунный обод', arcGeometry(2.47, 2.07, .22, 0, turn, 48), brass, 0, 0, .31);
  part(optic, 'Стопорное кольцо стекла', arcGeometry(2.10, 1.96, .09, 0, turn, 48), steel, 0, 0, .43);
  const glass = material('#e2edf0', { transparent: true, opacity: .13, roughness: .09, side: DoubleSide, depthWrite: false });
  const lensGlass = part(optic, 'Линза', new SphereGeometry(1.99, 30, 16), glass, 0, 0, .26);
  lensGlass.scale.z = .10;
  const reticleHeight = .49;
  for (const side of [-1, 1]) {
    part(optic, 'Горизонтальная риска', new BoxGeometry(.52, .042, .028), char, side * 1.39, 0, reticleHeight);
    part(optic, 'Вертикальная риска', new BoxGeometry(.042, .52, .028), char, 0, side * 1.39, reticleHeight);
  }
  part(optic, 'Кольцо прицела', arcGeometry(.16, .128, .028, 0, turn, 24), char, 0, 0, reticleHeight);

  const lensSide = front.clone().projectOnPlane(normal).normalize();
  const rimMount = optic.position.clone().addScaledVector(lensSide, -2.37).addScaledVector(normal, -.16);
  const bracketStart = seat.clone().setZ(1.35);
  const span = rimMount.clone().sub(bracketStart);
  const bracket = part(lens, 'Выносная скоба лупы', new BoxGeometry(.88, span.length() + .25, .48), brass,
    ...bracketStart.addScaledVector(span, .5).toArray());
  bracket.quaternion.setFromUnitVectors(axis, span.normalize());
  lens.rotation.z = carriageAngle(initialLatitude) - mountAngle;
  move(lens, -4.1, 2.4, 3.4);
  return lens;
}

function rotationTrack(object, axis, stops) {
  const rotation = new Quaternion();
  const values = stops.flatMap(([, offset]) => rotation.setFromAxisAngle(axis, offset).premultiply(object.quaternion).toArray());
  return new QuaternionKeyframeTrack(`${object.uuid}.quaternion`, stops.map(([time]) => time), values);
}

export async function buildVintageModel(atlas) {
  const root = new Group();
  root.name = 'Светящийся Глобус Радио';
  root.scale.setScalar(.01);
  const tracks = [];
  function move(object, x, y, z) {
    const start = object.position.toArray();
    tracks.push(new VectorKeyframeTrack(`${object.uuid}.position`, [0, 1], [
      ...start, start[0] + x, start[1] + y, start[2] + z,
    ]));
  }

  const surfaces = {
    walnut: material('#704221', { roughness: .74 }),
    char: material('#432c1c'),
    birch: material('#ba905d', { roughness: .74 }),
    brass: material('#c69a5b', { metalness: .52, roughness: .37 }),
    steel: material('#413a32', { metalness: .45, roughness: .52 }),
    scale: material('#ffffff', { map: engravedScale(), roughness: .76 }),
  };
  const gears = buildBase(root, surfaces, move);
  const gimbal = group(root, 'Шар и меридианная направляющая');
  gimbal.position.set(0, 22.13, 0);
  // The ring rests on the pedestal while the polar axis tilts inside it.
  gimbal.rotation.y = -.10;
  const tilted = group(gimbal, 'Наклон полярной оси');
  tilted.rotation.z = -21 * degree;
  const sphere = buildGlobe(tilted, parchment(atlas), surfaces, move);
  const lens = buildMeridian(tilted, surfaces, move);

  // Intermediate keys preserve the direction of complete turns during quaternion interpolation.
  const ratios = [-2, 3.2, 32 / 11];
  const steps = Array.from({ length: 41 }, (_, index) => [index / 5, index / 40 * turn]);
  const spin = new AnimationClip('Вращение шара и шестерён', 8, [
    rotationTrack(sphere, axis, steps),
    ...gears.map((gear, index) => rotationTrack(gear, front, steps.map(([time, angle]) => [time, angle * ratios[index]]))),
  ]);
  const start = carriageAngle(initialLatitude);
  const travel = new AnimationClip('Ход лупы по дуге', 6, [rotationTrack(lens, front, [
    [0, 0], [2, carriageAngle(latitudeLimit) - start], [4, carriageAngle(-latitudeLimit) - start], [6, 0],
  ])]);

  const animation = new AnimationClip('Разборка', 1, tracks);
  return new GLTFExporter().parseAsync(root, { binary: true, animations: [animation, spin, travel], maxTextureSize: 2048 });
}
