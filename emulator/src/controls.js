import { radians, wrapLongitude } from './geo';

function pointerSpeed(previous, delta, interval) {
  const elapsed = Math.max(8, interval);
  // Use the motion samples only. Releasing the control never adds movement.
  const speed = Math.abs(delta) * 1000 / elapsed;
  return previous + (speed - previous) * (1 - Math.exp(-elapsed / 42));
}

export function wireDial(button, turn, commit, { keyStep = 5, pointerGain } = {}) {
  let drag;

  function pointerPosition(event, rect) {
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    return { angle: Math.atan2(y, x) / radians, insideHub: Math.hypot(x, y) < rect.width * .23,
      x: event.clientX, y: event.clientY, time: event.timeStamp };
  }

  button.addEventListener('pointerdown', event => {
    if (button.disabled || event.button !== 0 || drag) return;
    const rect = button.getBoundingClientRect();
    const position = pointerPosition(event, rect);
    drag = { id: event.pointerId, rect, linear: position.insideHub, speed: 0, ...position };
    button.setPointerCapture(event.pointerId);
  });

  button.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const next = pointerPosition(event, drag.rect);
    const throughHub = pointerGain && !drag.linear && (next.insideHub || drag.insideHub);
    const delta = drag.linear ? (next.x - drag.x + drag.y - next.y) * 1.4 : wrapLongitude(next.angle - drag.angle);
    const elapsed = next.time - drag.time;
    Object.assign(drag, next);
    if (throughHub) {
      drag.speed = 0;
      return;
    }
    if (pointerGain) drag.speed = pointerSpeed(drag.speed, delta, elapsed);
    if (delta) turn(delta * (pointerGain?.(drag.speed) ?? 1));
  });

  function end(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    commit();
  }

  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, end);

  button.addEventListener('keydown', event => {
    const direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[event.key];
    if (!direction) return;
    event.preventDefault();
    turn(direction * keyStep);
    commit();
  });
}

export function wireLever(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  let drag;

  input.addEventListener('pointerdown', event => {
    if (input.disabled || event.button !== 0 || drag) return;
    event.preventDefault();
    input.focus({ preventScroll: true });
    drag = { id: event.pointerId, y: event.clientY, time: event.timeStamp, speed: 0,
      position: input.valueAsNumber, changed: false };
    input.setPointerCapture(event.pointerId);
  });

  input.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const delta = drag.y - event.clientY;
    drag.speed = pointerSpeed(drag.speed, delta, event.timeStamp - drag.time);
    drag.y = event.clientY;
    drag.time = event.timeStamp;
    const pace = Math.max(0, Math.min(1, (drag.speed - 28) / 260));
    drag.position = Math.max(min, Math.min(max, drag.position + delta * (.08 + 1.17 * pace ** 2)));
    const previous = input.value;
    input.valueAsNumber = drag.position;
    if (input.value === previous) return;
    drag.changed = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  function end(event) {
    if (drag?.id !== event.pointerId) return;
    const { changed } = drag;
    drag = null;
    if (changed) input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) input.addEventListener(event, end);
}
