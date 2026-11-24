const tau = 2 * Math.PI;
export const satelliteFrames = 24;
const planes = [
  { radius: 1.37, flatten: .43, bearing: -.40, color: '#75d7df', phase: .36, speed: .26 },
  { radius: 1.23, flatten: .62, bearing: .58, color: '#e2ae77', phase: 2.35, speed: -.21 },
  { radius: 1.32, flatten: .31, bearing: 1.39, color: '#9baad8', phase: .98, speed: .17 },
];

export function createDysonSwarm(element, dataUrl) {
  const back = document.createElement('canvas');
  const front = document.createElement('canvas');
  back.className = 'orbit orbit-back';
  front.className = 'orbit orbit-front';
  for (const canvas of [back, front]) {
    canvas.hidden = true;
    canvas.setAttribute('aria-hidden', 'true');
  }
  element.querySelector('.stars').after(back);
  element.querySelector('.settlements').before(front);
  const backContext = back.getContext('2d');
  const frontContext = front.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let scene;
  let last = 0;
  let elapsed = 0;
  const satellites = new Image();
  satellites.addEventListener('load', () => { if (scene) paint(); });
  satellites.src = `${dataUrl}dyson-satellites.webp`;

  function renderPlane(context, plane, row, near) {
    const { width, height, radius } = scene;
    const satelliteSize = Math.min(109, Math.max(48, radius * .48));
    const sine = Math.sin(plane.bearing);
    const cosine = Math.cos(plane.bearing);
    const r = Math.min(radius * plane.radius,
      (width / 2 - satelliteSize * .51) / Math.hypot(cosine, plane.flatten * sine),
      (height / 2 - satelliteSize * .42) / Math.hypot(sine, plane.flatten * cosine));
    if (r <= 0) return;
    const minor = r * plane.flatten;
    const start = near ? 0 : Math.PI;
    const end = near ? Math.PI : tau;
    const color = plane.color;
    context.save();
    context.translate(width / 2, height / 2);
    context.rotate(plane.bearing);

    function arc(offset, from, to) {
      context.beginPath();
      context.ellipse(0, 0, r + offset, minor + offset * plane.flatten, 0, from, to);
      context.stroke();
    }

    context.lineWidth = 1;
    context.strokeStyle = `${color}${near ? '44' : '5a'}`;
    arc(0, start, end);
    for (let i = 0; i < 3; i++) {
      const angle = start + .32 + i * Math.PI / 3;
      context.lineWidth = 1.15;
      context.strokeStyle = `${color}5c`;
      context.setLineDash([3, 4]);
      arc(4, angle, angle + .16);
      context.setLineDash([]);
    }

    for (let i = 0; i < 2; i++) {
      const travel = plane.phase + i * 2.69 + elapsed * plane.speed;
      const angle = (travel % tau + tau) % tau;
      if ((angle < Math.PI) !== near) continue;
      const direction = Math.sign(plane.speed);
      for (let segment = 0; segment < 4; segment++) {
        const head = angle - direction * segment * .05;
        const tail = head - direction * .05;
        const from = Math.max(start, Math.min(head, tail));
        const to = Math.min(end, Math.max(head, tail));
        if (from >= to) continue;
        context.lineWidth = 1.45 - segment * .21;
        context.strokeStyle = `${color}${['a0', '72', '42', '26'][segment]}`;
        arc(0, from, to);
      }

      context.save();
      context.translate(r * Math.cos(angle), minor * Math.sin(angle));
      context.rotate(-plane.bearing * .66 + .37 * Math.cos(angle) - .13);
      const depth = Math.sin(angle);
      context.globalAlpha = near ? 1 : .87 + .18 * depth;
      const size = satelliteSize * (.91 + .20 * depth);
      if (satellites.naturalWidth) {
        const frameWidth = satellites.naturalWidth / satelliteFrames;
        const frameHeight = satellites.naturalHeight / planes.length;
        const frameNumber = (Math.floor(angle / tau * satelliteFrames + i * 9 + row * 4)) % satelliteFrames;
        const height = size * frameHeight / frameWidth;
        context.drawImage(satellites, frameNumber * frameWidth, row * frameHeight, frameWidth, frameHeight,
          -size / 2, -height / 2, size, height);
      } else {
        context.fillStyle = color;
        context.fillRect(-2.2, -2.8, 4.4, 5.6);
        context.fillStyle = `${color}a0`;
        context.fillRect(-7, -1.2, 4, 2.4);
        context.fillRect(3, -1.2, 4, 2.4);
      }
      context.restore();
    }
    context.restore();
  }

  function paint() {
    backContext.clearRect(0, 0, scene.width, scene.height);
    frontContext.clearRect(0, 0, scene.width, scene.height);
    for (const [row, plane] of planes.entries()) {
      renderPlane(backContext, plane, row, false);
      renderPlane(frontContext, plane, row, true);
    }
  }

  function syncAnimation() {
    const running = scene && !element.hidden && !document.hidden && !reduceMotion.matches;
    if (running && !frame) frame = requestAnimationFrame(tick);
    if (!running && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    }
  }

  function tick(now) {
    frame = 0;
    if (!scene || element.hidden || document.hidden || reduceMotion.matches) {
      last = 0;
      return;
    }
    if (!last || now - last >= 32) {
      if (last) elapsed += Math.min(now - last, 100) / 1000;
      last = now;
      paint();
    }
    syncAnimation();
  }

  document.addEventListener('visibilitychange', syncAnimation);
  reduceMotion.addEventListener('change', syncAnimation);

  return function update(active, width, height, radius) {
    const visible = active && width > 0 && height > 0 && !element.hidden;
    back.hidden = front.hidden = !visible;
    if (!visible) scene = undefined;
    else if (!scene || width !== scene.width || height !== scene.height || radius !== scene.radius) {
      scene = { width, height, radius };
      const density = Math.min(devicePixelRatio, 1.5);
      for (const context of [backContext, frontContext]) {
        context.canvas.width = Math.round(width * density);
        context.canvas.height = Math.round(height * density);
        context.setTransform(density, 0, 0, density, 0, 0);
      }
      paint();
    }
    syncAnimation();
  };
}
