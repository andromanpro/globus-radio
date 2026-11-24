import { wrapLongitude } from './geo';

const idleDelay = 12000;
const randomDuration = 3200;
const minimumFrameGap = 32;

export function createGlobeMotion({ getView, getPosition, randomStation, tuneStation, onRandom, onUnavailable, randomButton }) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const pointers = new Set();
  let auto = false;
  let timer;
  let frame;
  let previewView;
  let request = 0;
  let random = false;

  function scheduleIdle() {
    clearTimeout(timer);
    if (auto && !random && !previewView && !document.hidden && !pointers.size) {
      timer = setTimeout(startIdle, idleDelay);
    }
  }

  function stop(keepPhase = false) {
    cancelAnimationFrame(frame);
    previewView?.endSpin(keepPhase);
    previewView = null;
    request++;
    if (random) {
      random = false;
      onRandom(false);
    }
    scheduleIdle();
  }

  function animate(view, draw) {
    previewView = view;
    let lastPaint = -Infinity;
    const start = performance.now();
    function step(now) {
      if (now - lastPaint >= minimumFrameGap) {
        lastPaint = now;
        if (!draw(now - start)) return;
      }
      frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
  }

  function startIdle() {
    const view = getView();
    if (!view || document.activeElement?.matches('input[type=search], input[type=number]')) {
      scheduleIdle();
      return;
    }
    const { lat, lon } = getPosition();
    animate(view, elapsed => {
      view.showSpin(lat, lon + 17 * (elapsed / 1000));
      return true;
    });
  }

  async function pick() {
    const cancel = random;
    stop();
    const view = getView();
    if (cancel || !view) return;
    random = true;
    scheduleIdle();
    onRandom(true);
    const ticket = request;
    let station;
    try { station = await randomStation(); } catch { /* Report catalogue failure below. */ }
    if (ticket !== request) return;
    if (!station) {
      stop();
      onUnavailable();
      return;
    }

    function finish() {
      stop(true);
      tuneStation(station);
    }

    if (reducedMotion.matches) {
      finish();
      return;
    }
    const { lat, lon } = getPosition();
    const travel = 720 + wrapLongitude(station.lon - lon);
    animate(view, elapsed => {
      const progress = Math.min(elapsed / randomDuration, 1);
      if (progress === 1) {
        finish();
        return false;
      }
      const ease = 1 - (1 - progress) ** 3;
      view.showSpin(lat + (station.lat - lat) * ease, lon + travel * ease);
      return true;
    });
  }

  function interact(event) {
    if (!randomButton.contains(event.target)) stop();
  }

  document.addEventListener('pointerdown', event => {
    pointers.add(event.pointerId);
    interact(event);
  }, true);
  for (const type of ['pointerup', 'pointercancel']) {
    window.addEventListener(type, event => {
      pointers.delete(event.pointerId);
      scheduleIdle();
    }, true);
  }
  for (const type of ['keydown', 'wheel', 'input', 'change', 'click', 'focusin', 'focusout']) {
    document.addEventListener(type, interact, { capture: true, passive: true });
  }
  window.addEventListener('blur', () => { pointers.clear(); stop(); });
  document.addEventListener('visibilitychange', () => { pointers.clear(); stop(); });
  randomButton.addEventListener('click', pick);

  return {
    stop,
    setAuto(enabled) {
      auto = enabled;
      stop();
    },
  };
}
