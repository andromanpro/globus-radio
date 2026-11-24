const strings = {
  title: ['Глобус Радио', 'Globus Radio'],
  language: ['Язык', 'Language'],
  globe: ['Глобус', 'Globe'],
  mapView: ['Вид глобуса', 'Globe style'],
  vintage: ['Светящийся глобус', 'Illuminated globe'],
  atlas: ['Радиоатлас', 'Radio atlas'],
  night: ['Ночной эфир', 'Night broadcast'],
  satellite: ['Спутниковый', 'Satellite'],
  heatMap: ['Теплокарта', 'Heat map'],
  heatHelp: ['Теплокарта плотности станций', 'Station density heat map'],
  heatFew: ['Мало', 'Fewer'],
  heatMany: ['Много', 'More'],
  heatUnavailable: ['Не удалось загрузить теплокарту.', 'Could not load the heat map.'],
  autoSpin: ['Автовращение', 'Auto-rotate'],
  autoShort: ['Авто', 'Auto'],
  autoSpinHelp: ['Автовращение через 12 секунд без действий', 'Auto-rotate after 12 seconds of inactivity'],
  randomRadio: ['Случайное радио', 'Random station'],
  randomShort: ['Случайно', 'Random'],
  randomHelp: ['Настроиться на случайную станцию', 'Tune in to a random station'],
  cancelSpin: ['Остановить поиск', 'Cancel spin'],
  randomUnavailable: ['Не удалось подобрать станцию.', 'Could not find a station.'],
  zoom: ['Масштаб глобуса', 'Globe zoom'],
  zoomReset: ['Показать глобус целиком', 'Show the whole globe'],
  zoomValue: ['Масштаб {zoom}. Показать глобус целиком', '{zoom} zoom. Show the whole globe'],
  zoomIn: ['Приблизить', 'Zoom in'],
  zoomOut: ['Отдалить', 'Zoom out'],
  citySearch: ['Поиск города', 'Find a city'],
  cityPlaceholder: ['Найти город…', 'Find a city…'],
  cityResults: ['Найденные города', 'City results'],
  cityLoading: ['Ищем города…', 'Searching cities…'],
  cityMissing: ['Город не найден', 'No matching cities'],
  cityError: ['Список городов не загрузился. Попробуйте ещё раз.', 'The city list could not be loaded. Try again.'],
  cityCount: ['Найдено: {n}', 'Matches: {n}'],
  nearbyMap: ['Станций рядом: {n}', 'Nearby stations: {n}'],
  coverageMap: ['В зоне FM: {n}', 'Within FM coverage: {n}'],
  sight: ['Прицел настройки', 'Tuning sight'],
  globeLoading: ['Загружаем глобус…', 'Loading the globe…'],
  physicalGlobe: ['Светящийся деревянный глобус', 'Illuminated wooden globe'],
  modelHelp: ['Деревянный глобус. Перетаскивание меняет ракурс. Нажатие на лупу наводит прицел.', 'Wooden globe. Drag to change the angle. Click the lens to aim.'],
  lensHelp: ['Карта в лупе. Нажатие на карте наводит прицел. Стрелки перемещают прицел.', 'Lens map. Click the map to aim. Use the arrow keys to move the sight.'],
  lensScale: ['Масштаб карты в лупе', 'Lens map scale'],
  spin: ['Вращение шара', 'Globe rotation'],
  lever: ['Ход лупы', 'Lens travel'],
  lensShort: ['Лупа', 'Lens'],
  lighting: ['Подсветка', 'Lighting'],
  lightShort: ['Свет', 'Light'],
  placeLabels: ['Населённые пункты', 'Places'],
  placeToggle: ['Подписи', 'Labels'],
  mapScale: ['Масштаб у прицела', 'Scale at the sight'],
  mapNorth: ['Север', 'North'],
  mapLegend: ['Условные обозначения карты', 'Map legend'],
  legendUrban: ['Застройка', 'Built-up areas'],
  legendWater: ['Вода', 'Water'],
  legendRoad: ['Дороги', 'Roads'],
  mapError: ['Не удалось загрузить карту.', 'Could not load the map.'],
  coordinates: ['Координаты прицела', 'Sight coordinates'],
  lensAim: ['Нажмите на карту в лупе для точного наведения', 'Click the lens map to aim precisely'],
  globeHelp: ['Колесо и +/− приближают · Нажмите на масштаб для общего вида', 'Zoom with the wheel or +/− · Click the zoom value to see the globe'],
  lensLimit: ['Ход лупы ограничен 65°', 'Lens travel is limited to 65°'],
  'latitude.N': ['с. ш.', 'N'],
  'latitude.S': ['ю. ш.', 'S'],
  radioPlace: ['Радио и местность', 'Radio and location'],
  time: ['Местное время', 'Local time'],
  play: ['Включить радио', 'Play radio'],
  pause: ['Приостановить радио', 'Pause radio'],
  radio: ['Радио', 'Radio'],
  silent: ['Радио молчит', 'No station playing'],
  volume: ['Громкость', 'Volume'],
  favorites: ['Избранное', 'Favorites'],
  favoritesEmpty: ['Нажмите звёздочку у названия станции, чтобы сохранить её.', 'Click the star by the station name to save it.'],
  addFavorite: ['Добавить в избранное', 'Add to favorites'],
  removeFavorite: ['Убрать из избранного', 'Remove from favorites'],
  removeFavoriteStation: ['Убрать «{name}» из избранного', 'Remove “{name}” from favorites'],
  scope: ['Область поиска станций', 'Station search area'],
  nearby: ['В радиусе', 'Nearby'],
  fm: ['FM-покрытие', 'FM coverage'],
  country: ['По стране', 'By country'],
  radius: ['Радиус поиска', 'Search radius'],
  radiusShort: ['Радиус', 'Range'],
  exactRadius: ['Точный радиус поиска в километрах', 'Exact search radius in kilometres'],
  km: ['км', 'km'],
  mhz: ['МГц', 'MHz'],
  kw: ['кВт', 'kW'],
  metre: ['м', 'm'],
  radiusCaption: ['Радиус {distance} км', 'Radius {distance} km'],
  lensEdge: ['До края {distance} км', '{distance} km to the edge'],
  stationName: ['Название станции', 'Station name'],
  fmHint: ['Доступность рассчитывается по контурам и параметрам передатчиков. Звук идёт из интернет-потока.', 'FM coverage is estimated from transmitter contours and parameters. Audio is streamed online.'],
  source: ['Источник', 'Source'],
  stations: ['Станции', 'Stations'],
  estimates: ['Условные привязки', 'Estimated locations'],
  estimateCount: ['Условные · {n}', 'Estimated · {n}'],
  localCount: ['Местные · {n}', 'Local · {n}'],
  showLocal: ['Показать местные станции', 'Show local stations'],
  showEstimated: ['Показать станции с привязкой по региону или стране', 'Show stations located by region or country'],
  'heading.nearby': ['Станции в радиусе', 'Stations within range'],
  'heading.fm': ['Возможен FM-приём', 'Estimated FM reception'],
  'heading.country': ['Станции страны', 'Stations in this country'],
  more: ['Показать ещё', 'Show more'],
  aboutPlace: ['О местности', 'About this place'],
  credits: ['Источники', 'Credits'],
  textureCredit: ['Дневная текстура Земли, адаптирована по цвету', 'Earth Day Map, colour adjusted'],
  citiesCredit: ['Справочник населённых пунктов, отфильтрован и разбит на области', 'Place data, filtered and divided into tiles'],
  mapCredit: ['Картография, общественное достояние', 'Map data, public domain'],
  lensMapCredit: ['Геометрия упрощена и разбита на области', 'Geometry simplified and divided into tiles'],
  radioCredit: ['Каталог станций, общественное достояние', 'Station directory, public domain'],
  openWater: ['Открытая вода', 'Open water'],
  'status.ready': ['Готово к запуску', 'Ready to play'],
  'status.paused': ['На паузе', 'Paused'],
  'status.connecting': ['Подключаемся к эфиру…', 'Connecting to the stream…'],
  'status.retrying': ['Подключаем резервный адрес…', 'Trying an alternative stream…'],
  'status.playing': ['В эфире', 'On air'],
  'status.error': ['Эфир недоступен. Попробуйте другую станцию.', 'The stream is unavailable. Try another station.'],
  'status.blocked': ['Для запуска нажмите ▶', 'Press ▶ to start'],
  'status.empty': ['Станция не выбрана', 'No station selected'],
  transmitter: ['передатчик', 'transmitter'],
  network: ['сетевой эфир', 'network feed'],
  regional: ['региональный эфир', 'regional feed'],
  approximately: ['примерно', 'approx.'],
  byCity: ['по городу', 'city location'],
  cityCentre: ['ориентир — центр города {city}', 'approximate location: {city} city centre'],
  cityStreams: ['Адресов эфира: {n}', 'Stream URLs: {n}'],
  'hint.same-stream': ['координаты из записи того же потока', 'coordinates from another listing of the same stream'],
  'hint.same-station': ['координаты из другой записи этой станции', 'coordinates from another listing of this station'],
  'hint.catalog-city': ['город из поля местности Radio Browser', 'city from the Radio Browser location field'],
  'hint.name-and-website': ['город совпал в названии станции и адресе сайта', 'city matched in the station name and website'],
  'hint.shared-website': ['местность определена по программам с общим сайтом', 'location inferred from stations with the same website'],
  'hint.website-city': ['город подтверждён на сайте вещателя', 'city verified on the broadcaster website'],
  'hint.regional-capital': ['привязка по столице региона', 'located at the regional capital'],
  'hint.regional-largest-city': ['привязка по крупнейшему городу региона', 'located at the largest city in the region'],
  'hint.country-capital': ['привязка по столице страны', 'located at the national capital'],
  'label.regional-capital': ['столица региона', 'regional capital'],
  'label.regional-largest-city': ['город региона', 'regional city'],
  'label.country-capital': ['столица страны', 'national capital'],
  fmContour: ['контур регулятора', 'regulator’s coverage contour'],
  fmDistance: ['оценка до {distance} км', 'estimated range up to {distance} km'],
  fmPlan: ['{min}–{max} км по частотному плану', '{min}–{max} km per frequency plan'],
  transmitterPower: ['справочная мощность передатчика', 'reported transmitter power'],
  antennaHeight: ['высота {height} м', 'height {height} m'],
  sourceNMHH: ['План NMHH', 'NMHH frequency plan'],
  stationsSearching: ['Поиск станций…', 'Finding stations…'],
  stationsLoading: ['Загружаем станции…', 'Loading stations…'],
  onlyEstimateSearch: ['По этому названию есть только условные привязки.', 'Only estimated locations match this name.'],
  onlyEstimateArea: ['В этом радиусе есть только условные привязки.', 'Only estimated locations are available within this radius.'],
  otherNames: ['Рядом есть станции. Очистите поиск по названию, чтобы их увидеть.', 'There are stations nearby. Clear the name filter to see them.'],
  fmDirectoryError: ['Каталог FM недоступен. Показаны передатчики из встроенных частотных планов.', 'The FM directory is unavailable. Showing transmitters from built-in frequency plans.'],
  noFmData: ['Для этой местности пока нет данных о FM-покрытии.', 'FM coverage data is not yet available for this area.'],
  noFmSignal: ['В этой точке нет расчётного приёма от известных передатчиков.', 'Known transmitters are not expected to reach this point.'],
  mapDirectoryError: ['Основная карта станций недоступна. Доступны позиции передатчиков и поиск по стране.', 'The main station map is unavailable. Transmitter locations and country search are available.'],
  nearestTransmitter: ['До ближайшего передатчика {distance} км. Увеличьте радиус или переместите прицел.', 'The nearest transmitter is {distance} km away. Increase the radius or move the sight.'],
  nearestCity: ['До центра города {city} {distance} км. Увеличьте радиус или переместите прицел.', '{city} city centre is {distance} km away. Increase the radius or move the sight.'],
  nearestStation: ['До ближайшей станции {distance} км. Увеличьте радиус или переместите прицел.', 'The nearest station is {distance} km away. Increase the radius or move the sight.'],
  noNearby: ['В этом радиусе станций нет.', 'There are no stations within this radius.'],
  noCountryMatch: ['В каталоге нет станций по этому запросу.', 'No stations in the directory match your search.'],
  countryDirectoryError: ['Каталог недоступен. Повторите поиск чуть позже.', 'The directory is unavailable. Try again shortly.'],
  chooseCountry: ['Наведите прицел на страну или выберите поиск в радиусе.', 'Aim at a country or switch to nearby search.'],
  'genre.Новости и культура': ['Новости и культура', 'News and culture'],
  'genre.Музыка и эфиры': ['Музыка и эфиры', 'Music and shows'],
  'genre.Чилаут': ['Чилаут', 'Chillout'],
  'genre.Новости': ['Новости', 'News'],
  'genre.Поп 80-х': ['Поп 80-х', '1980s pop'],
  'genre.Эклектика': ['Эклектика', 'Eclectic'],
  'genre.Разговорное радио': ['Разговорное радио', 'Talk radio'],
  'genre.Поп': ['Поп', 'Pop'],
  'genre.Электронная музыка': ['Электронная музыка', 'Electronic music'],
  'genre.Японская музыка': ['Японская музыка', 'Japanese music'],
  'genre.Регги': ['Регги', 'Reggae'],
  'genre.Поп и рок': ['Поп и рок', 'Pop and rock'],
  'genre.Азиатская поп-музыка': ['Азиатская поп-музыка', 'Asian pop'],
  'genre.Классические хиты': ['Классические хиты', 'Classic hits'],
};

const storageKey = 'globus-radio:language';
const changes = new EventTarget();
const formats = new Map();
let language = 'ru';

export const currentLanguage = () => language;
export const onLanguageChange = callback => changes.addEventListener('change', callback);

export function t(key, values = {}) {
  return (strings[key]?.[language === 'en' ? 1 : 0] ?? '').replace(/\{(\w+)\}/g, (_, name) => values[name]);
}

export function number(value, maximumFractionDigits = 1) {
  const key = `${language}/${maximumFractionDigits}`;
  if (!formats.has(key)) formats.set(key, new Intl.NumberFormat(language, { maximumFractionDigits }));
  return formats.get(key).format(value);
}

export function initLanguage() {
  const select = document.getElementById('language');
  function apply(value) {
    language = value === 'en' ? 'en' : 'ru';
    document.documentElement.lang = language;
    document.title = t('title');
    select.value = language;
    for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
    for (const attribute of ['aria-label', 'placeholder', 'title']) {
      const marker = `data-i18n-${attribute}`;
      for (const node of document.querySelectorAll(`[${marker}]`)) node.setAttribute(attribute, t(node.getAttribute(marker)));
    }
  }
  try { language = localStorage.getItem(storageKey) ?? language; } catch { /* Storage is optional. */ }
  const requested = new URLSearchParams(location.search).get('lang');
  if (requested === 'ru' || requested === 'en') language = requested;
  apply(language);
  select.addEventListener('change', () => {
    apply(select.value);
    try { localStorage.setItem(storageKey, language); } catch { /* Keep the language for this page. */ }
    changes.dispatchEvent(new Event('change'));
  });
}
