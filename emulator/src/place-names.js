import { currentLanguage } from './i18n';
import { loadMapData } from './map-data';
import { cities } from './places';

const featured = new Map(cities.flatMap(city => [[city.name, city], [city.enName, city]]));
const regions = { ru: new Intl.DisplayNames('ru', { type: 'region' }), en: new Intl.DisplayNames('en', { type: 'region' }) };
const shortNames = { US: 'США', GB: 'Великобритания' };
let metadata;

export function regionName(code, language = currentLanguage()) {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return (language === 'ru' && shortNames[code]) || regions[language].of(code);
}

export async function loadPlaceNames(dataUrl) {
  metadata ??= await loadMapData(dataUrl, 'city-search.json.gz');
  return metadata;
}

export function placeName(name, id) {
  const city = featured.get(name);
  if (currentLanguage() === 'en') return city?.enName ?? (metadata?.names[id]?.[2] || name);
  return city?.name ?? name;
}
