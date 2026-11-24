import { number, onLanguageChange, t } from './i18n';
import { placeName, regionName } from './place-names';

const storageKey = 'globus-radio:favorites';

function readFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(stored)) return stored.filter(station =>
      typeof station?.name === 'string' && typeof station.url === 'string' && station.url.startsWith('https://'));
  } catch { /* The current tab can still keep its favorites in memory. */ }
  return [];
}

export function createFavorites(keyOf, playStation) {
  const star = document.getElementById('favorite-station');
  const toggle = document.getElementById('show-favorites');
  const panel = document.getElementById('favorites-panel');
  const list = document.getElementById('favorites-list');
  const empty = document.getElementById('favorites-empty');
  const count = document.getElementById('favorites-count');
  let stations = readFavorites();
  let selected;

  function update(station) {
    selected = station;
    const key = selected && keyOf(selected);
    const saved = Boolean(key && stations.some(entry => keyOf(entry) === key));
    const label = t(saved ? 'removeFavorite' : 'addFavorite');
    star.disabled = !key;
    star.setAttribute('aria-pressed', String(saved));
    star.setAttribute('aria-label', label);
    star.title = label;
    star.firstElementChild.textContent = saved ? '★' : '☆';
    for (const button of list.querySelectorAll('[data-stream]')) {
      button.setAttribute('aria-pressed', String(key === keyOf({ url: button.dataset.stream })));
    }
  }

  function render() {
    count.hidden = !stations.length;
    count.textContent = number(stations.length, 0);
    empty.hidden = Boolean(stations.length);
    if (!panel.hidden) {
      list.replaceChildren(...stations.map(station => {
        const item = document.createElement('li');
        const play = document.createElement('button');
        play.type = 'button';
        play.dataset.stream = station.url;
        play.textContent = station.name;
        const place = placeName(station.city) ?? (station.country && regionName(station.country));
        if (place) {
          const location = document.createElement('small');
          location.textContent = place;
          play.append(location);
        }
        play.addEventListener('click', () => playStation(station));
        const remove = document.createElement('button');
        remove.className = 'favorite-remove';
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = t('removeFavorite');
        remove.setAttribute('aria-label', t('removeFavoriteStation', { name: station.name }));
        remove.addEventListener('click', () => {
          const nextUrl = (item.nextElementSibling ?? item.previousElementSibling)?.firstElementChild.dataset.stream;
          save(stations.filter(entry => keyOf(entry) !== keyOf(station)));
          ([...list.querySelectorAll('[data-stream]')].find(button => button.dataset.stream === nextUrl) ?? toggle).focus();
        });
        item.append(play, remove);
        return item;
      }));
    }
    update(selected);
  }

  function save(entries) {
    stations = entries;
    try { localStorage.setItem(storageKey, JSON.stringify(entries)); } catch { /* Keep the list for this session. */ }
    render();
  }

  star.addEventListener('click', () => {
    if (!selected) return;
    const key = keyOf(selected);
    const other = stations.filter(entry => keyOf(entry) !== key);
    if (other.length === stations.length) {
      const { id, name, url, hls, country, city, lat, lon, locationHint } = selected;
      other.push({ id, name, url, hls, country, city, lat, lon, locationHint });
    }
    save(other);
  });

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    render();
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    setOpen(false);
    toggle.focus();
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    stations = readFavorites();
    render();
  });
  onLanguageChange(render);
  render();
  return { update };
}
