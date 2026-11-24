import { onLanguageChange, t } from './i18n';
import { loadMapData } from './map-data';
import { loadPlaceNames, placeName, regionName } from './place-names';
import { cities } from './places';

const maxResults = 9;
const normalize = text => text.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function keys(names) {
  return [...new Set(names.filter(Boolean).map(normalize))];
}

const featured = cities.map(city => ({ ...city, rank: 3, aliases: keys([city.name, city.enName]) }));

function match(place, term) {
  if (place.aliases.includes(term)) return 3;
  if (place.aliases.some(name => name.startsWith(term))) return 2;
  return place.aliases.some(name => name.includes(term)) ? 1 : 0;
}

function samePlace(left, right) {
  return Math.abs(left.lat - right.lat) < .08 && Math.abs(left.lon - right.lon) < .08
    && (!left.country || !right.country || left.country === right.country)
    && left.aliases.some(name => right.aliases.includes(name));
}

export function createCityPicker(root, dataUrl, locate, countryAt) {
  const input = root.querySelector('input');
  const popup = root.querySelector('.city-menu');
  const list = root.querySelector('[role="listbox"]');
  const status = root.querySelector('.city-message');
  const announce = root.querySelector('.city-announcement');
  let rows = [];
  let active = -1;
  let selected;
  let directory;
  let request;
  let revision = 0;

  function close() {
    ++revision;
    popup.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    announce.textContent = '';
  }

  function show(items, message) {
    rows = items;
    active = items.length ? 0 : -1;
    popup.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    list.replaceChildren(...items.map((item, index) => {
      const option = document.createElement('li');
      const name = document.createElement('span');
      const context = document.createElement('small');
      const country = item.country || countryAt(item.lat, item.lon);
      name.textContent = placeName(item.name, item.id);
      context.textContent = [...new Set([item.region, regionName(country)].filter(Boolean))].join(' · ');
      if (!context.textContent) context.textContent = `${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°`;
      option.id = `city-option-${index}`;
      option.dataset.index = index;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === active));
      option.append(name, context);
      return option;
    }));
    status.hidden = !message;
    status.textContent = message ?? '';
    announce.textContent = message ?? t('cityCount', { n: items.length });
    if (active >= 0) input.setAttribute('aria-activedescendant', list.children[active].id);
    else input.removeAttribute('aria-activedescendant');
  }

  function loadDirectory() {
    request ??= Promise.allSettled([
      loadPlaceNames(dataUrl),
      loadMapData(dataUrl, 'settlements.json.gz'),
    ]).then(async ([names, settlements]) => {
      const details = names.value;
      const places = settlements.value ? Object.values(settlements.value).flat() : await loadMapData(dataUrl, 'major-places.json.gz');
      directory = places.map(([id, name, lat, lon, population, rank]) => {
        const [country, area, english, ...alternates] = details?.names[id] ?? [];
        const region = details?.regions[`${country}.${area}`];
        return { id, name, lat, lon, country, region, population, rank, aliases: keys([name, english, ...alternates]), area };
      });
    }).catch(error => {
      request = null;
      throw error;
    });
    return request;
  }

  function candidates(term, qualifier) {
    const found = [];
    for (const place of featured) {
      const score = match(place, term);
      if (score) found.push({ place, score });
    }
    for (const place of directory ?? []) {
      const score = match(place, term);
      if (score) found.push({ place, score });
    }
    found.sort((a, b) => b.score - a.score || b.place.rank - a.place.rank || b.place.population - a.place.population);
    const accepted = [];
    for (const { place } of found) {
      if (accepted.length >= maxResults) break;
      if (qualifier) {
        const code = place.country || countryAt(place.lat, place.lon);
        if (!keys([place.region, place.area, code, regionName(code, 'en'), regionName(code, 'ru')])
          .some(key => key.includes(qualifier))) continue;
      }
      if (!accepted.some(other => samePlace(place, other))) accepted.push(place);
    }
    return accepted;
  }

  async function search() {
    const version = ++revision;
    const [rawName, rawRegion] = input.value.split(/,(.*)/s);
    const term = normalize(rawName);
    const qualifier = normalize(rawRegion ?? '');
    if (!term || (selected && input.value === placeName(selected.name, selected.id))) {
      show(featured.slice(0, maxResults));
      return;
    }
    const initial = candidates(term, qualifier);
    if (initial.length || directory) show(initial, initial.length ? '' : t('cityMissing'));
    else show([], t('cityLoading'));
    if (directory) return;
    try {
      await loadDirectory();
      if (revision !== version) return;
      const items = candidates(term, qualifier);
      show(items, items.length ? '' : t('cityMissing'));
    } catch {
      if (revision === version && !initial.length) show([], t('cityError'));
    }
  }

  function pick(index) {
    selected = rows[index];
    if (!selected) return;
    input.value = placeName(selected.name, selected.id);
    close();
    locate(selected);
  }

  input.addEventListener('focus', () => { input.select(); search(); });
  input.addEventListener('click', () => { if (popup.hidden) search(); });
  input.addEventListener('input', () => { selected = null; search(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!popup.hidden) event.preventDefault();
      close();
    } else if (event.key === 'Enter' && !popup.hidden) {
      event.preventDefault();
      pick(active);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (popup.hidden) { search(); return; }
      if (!rows.length) return;
      list.children[active]?.setAttribute('aria-selected', 'false');
      active = Math.max(0, Math.min(rows.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
      list.children[active].setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    }
  });
  list.addEventListener('pointerdown', event => { if (event.target.closest('[role="option"]')) event.preventDefault(); });
  list.addEventListener('click', event => {
    const option = event.target.closest('[role="option"]');
    if (option) pick(Number(option.dataset.index));
  });
  for (const event of ['pointerdown', 'focusin']) {
    document.addEventListener(event, event => { if (!root.contains(event.target) && !popup.hidden) close(); });
  }
  onLanguageChange(() => {
    if (selected) input.value = placeName(selected.name, selected.id);
    if (!popup.hidden) search();
  });

  return {
    clear() { selected = null; input.value = ''; close(); },
  };
}
