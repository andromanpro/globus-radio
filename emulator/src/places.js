export const cities = [
  {
    name: 'Сан-Франциско', enName: 'San Francisco', country: 'US', lat: 37.7749, lon: -122.4194, zone: 'America/Los_Angeles',
    enFact: ['A cable under the street', 'San Francisco tested its first cable car in 1873. A moving steel cable still runs under the street, and each car grips it to move.'],
    fact: ['Трамвай на тросе', 'В 1873 году в Сан-Франциско испытали канатный трамвай. Под улицей до сих пор движется стальной трос, за который вагон цепляется, чтобы ехать.', 'https://www.sfmta.com/getting-around/muni/cable-cars/cable-car-history'],
    stations: [
      ['KQED', 'Новости и культура', 'https://kqed-live.streamguys1.com/kqedradio'],
      ['KALW', 'Музыка и эфиры', 'https://kalw-ice.streamguys1.com/kalw'],
    ],
  },
  {
    name: 'Лондон', enName: 'London', country: 'GB', lat: 51.5074, lon: -0.1278, zone: 'Europe/London',
    enFact: ['The first underground railway', 'The world’s first underground railway opened between Paddington and Farringdon in 1863. Its trains were pulled by steam locomotives.'],
    fact: ['Первое метро', 'В 1863 году между Паддингтоном и Фаррингдоном открылась первая в мире подземная железная дорога. Составы тянули паровозы.', 'https://www.londonmuseum.org.uk/collections/london-stories/building-victorian-underground-railway/'],
    stations: [
      ['Smooth Chill', 'Чилаут', 'https://media-ssl.musicradio.com/ChillMP3'],
      ['BBC World Service', 'Новости', 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service'],
      ['Heart 80s', 'Поп 80-х', 'https://media-ssl.musicradio.com/Heart80sMP3'],
    ],
  },
  {
    name: 'Париж', enName: 'Paris', country: 'FR', lat: 48.8566, lon: 2.3522, zone: 'Europe/Paris',
    enFact: ['A taller tower', 'The Eiffel Tower reached 330 metres after a digital radio antenna was fitted in March 2022. It was previously 324 metres tall.'],
    fact: ['Башня выросла', 'В марте 2022 года на Эйфелевой башне установили новую цифровую радиоантенну. Высота башни увеличилась с 324 до 330 метров.', 'https://www.toureiffel.paris/en/news/events/eiffel-tower-grows-330-meters-tall'],
    stations: [
      ['FIP', 'Эклектика', 'https://icecast.radiofrance.fr/fip-midfi.mp3'],
      ['France Inter', 'Разговорное радио', 'https://icecast.radiofrance.fr/franceinter-midfi.mp3'],
      ['Europe 1', 'Новости', 'https://europe1.lmn.fm/europe1.mp3'],
    ],
  },
  {
    name: 'Берлин', enName: 'Berlin', country: 'DE', lat: 52.52, lon: 13.405, zone: 'Europe/Berlin',
    enFact: ['The tower at Alexanderplatz', 'The Berlin TV Tower opened in 1969. Including its antenna, it stands 368 metres tall and is Germany’s tallest structure.'],
    fact: ['Телебашня на Александерплац', 'Берлинская телебашня открылась в 1969 году. Вместе с антенной она достигает 368 метров и остаётся самым высоким сооружением Германии.', 'https://www.visitberlin.de/en/berlin-television-tower'],
    stations: [
      ['radioeins', 'Музыка и культура', 'https://dispatcher.rndfnk.com/rbb/radioeins/live/mp3/mid'],
      ['Deutschlandfunk', 'Новости', 'https://st01.sslstream.dlf.de/dlf/01/128/mp3/stream.mp3'],
    ],
  },
  {
    name: 'Рейкьявик', enName: 'Reykjavík', country: 'IS', lat: 64.1466, lon: -21.9426, zone: 'Atlantic/Reykjavik',
    enFact: ['Swimming by the ocean', 'At Nauthólsvík beach, hot geothermal water is piped into a lagoon and mixed with seawater.'],
    fact: ['Купание у океана', 'На пляже Наутхольсвик горячую геотермальную воду подают в лагуну, где она смешивается с морской.', 'https://www.reykjavik.is/en/nautholsvik-geothermal-beach'],
    stations: [
      ['Útvarp Saga', 'Разговорное радио', 'https://stream.utvarpsaga.is/Hljodver'],
      ['Suðurland FM', 'Музыка', 'https://ice-11.spilarinn.is/xsudurlandfm'],
    ],
  },
  {
    name: 'Москва', enName: 'Moscow', country: 'RU', lat: 55.7558, lon: 37.6176, zone: 'Europe/Moscow',
    enFact: ['A metro with 13 stations', 'The Moscow Metro opened on 15 May 1935. Its first 13 stations included Sokolniki and the station now called Park Kultury.'],
    fact: ['Метро из 13 станций', 'Московское метро открылось 15 мая 1935 года. В первый день пассажиры могли проехать по 13 станциям, включая «Сокольники» и нынешний «Парк культуры».', 'https://www.mosmetro.ru/about/history'],
    stations: [
      ['Радио Маяк', 'Разговорное радио', 'https://icecast-vgtrk.cdnvideo.ru/mayakfm_mp3_192kbps'],
      ['Русское Радио', 'Поп', 'https://rusradio.hostingradio.ru/rusradio96.aacp'],
      ['Mixadance FM', 'Электронная музыка', 'https://stream.mixadance.fm/mixadance'],
    ],
  },
  {
    name: 'Токио', enName: 'Tokyo', country: 'JP', lat: 35.6895, lon: 139.6917, zone: 'Asia/Tokyo',
    enFact: ['634 metres above Tokyo', 'The digits in Tokyo Skytree’s height can be read as mu-sa-shi, the name of the historic province where Tokyo stands.'],
    fact: ['634 метра над Токио', 'Высоту Tokyo Skytree можно прочесть как «му-са-си». Так называлась историческая провинция, на территории которой стоит Токио.', 'https://www.tokyo-skytree.jp/about/spec/'],
    stations: [
      ['SOUND UP STATION NFRS', 'Музыка и эфиры', 'https://stream2.rcast.net/70945'],
      ['Retro-Ko Radio', 'Японская музыка', 'https://radio.retroko.com/listen/retroko/radio.mp3'],
    ],
  },
  {
    name: 'Кингстон', enName: 'Kingston', country: 'JM', lat: 18.0179, lon: -76.8099, zone: 'America/Jamaica',
    enFact: ['A city of music', 'Kingston helped shape ska and reggae. It has been a UNESCO Creative City of Music since 2015.'],
    fact: ['Город музыки', 'Кингстон, где сформировались ска и регги, входит в сеть творческих городов ЮНЕСКО как Город музыки с 2015 года.', 'https://www.unesco.org/en/creative-cities/kingston'],
    stations: [
      ['Irie FM', 'Регги', 'https://stream.iriefm.net:8008/stream'],
      ['Newstalk 93 FM', 'Разговорное радио', 'https://newstalk93fm.radioca.st/stream'],
    ],
  },
  {
    name: 'Буэнос-Айрес', enName: 'Buenos Aires', country: 'AR', lat: -34.6037, lon: -58.3816, zone: 'America/Argentina/Buenos_Aires',
    enFact: ['Tango on both banks', 'Argentina and Uruguay jointly inscribed tango on UNESCO’s intangible heritage list in 2009. It emerged in Buenos Aires and Montevideo, on opposite sides of the Río de la Plata.'],
    fact: ['Танго по обе стороны реки', 'Аргентина и Уругвай вместе внесли танго в список нематериального наследия ЮНЕСКО в 2009 году. Оно возникло в Буэнос-Айресе и Монтевидео, по разные стороны Ла-Платы.', 'https://ich.unesco.org/en/RL/tango-00258'],
    stations: [
      ['La 100', 'Поп', 'https://playerservices.streamtheworld.com/api/livestream-redirect/FM999_56.mp3'],
      ['Radio Nacional', 'Разговорное радио', 'https://sa.mp3.icecast.magma.edge-access.net/sc_rad1'],
    ],
  },
  {
    name: 'Кейптаун', enName: 'Cape Town', country: 'ZA', lat: -33.9249, lon: 18.4241, zone: 'Africa/Johannesburg',
    enFact: ['The city by Table Mountain', 'The Cape Peninsula and surrounding areas are known for their botanical diversity. Table Mountain is part of one of the region’s national parks.'],
    fact: ['Город у Столовой горы', 'Флористическая область Капского полуострова и соседних территорий известна разнообразием растений. Столовая гора входит в один из национальных парков этой области.', 'https://whc.unesco.org/en/list/1007/'],
    stations: [
      ['Kfm 94.5', 'Поп', 'https://playerservices.streamtheworld.com/api/livestream-redirect/KFM.mp3'],
      ['Power 98.7', 'Разговорное радио', 'https://edge.iono.fm/xice/65_medium.aac'],
      ['Hot 102.7', 'Поп и рок', 'https://edge.iono.fm/xice/57_high.aac'],
    ],
  },
  {
    name: 'Сидней', enName: 'Sydney', country: 'AU', lat: -33.8688, lon: 151.2093, zone: 'Australia/Sydney',
    enFact: ['Roofs from a single sphere', 'Danish architect Jørn Utzon designed the Sydney Opera House roofs as parts of a single sphere, so the different sails could be made from pieces with the same curvature.'],
    fact: ['Крыши из одной сферы', 'Датский архитектор Йорн Утзон придумал форму крыш Сиднейской оперы как сегменты одной сферы. Это позволило собирать разные «паруса» из элементов одинаковой кривизны.', 'https://www.sydneyoperahouse.com/our-story/the-spherical-solution'],
    stations: [
      ['SBS PopAsia', 'Азиатская поп-музыка', 'https://sbs-ice.streamguys1.com/sbs-popasia-sbs-web'],
      ['Gold 104.3', 'Классические хиты', 'https://ais-arn.streamguys1.com/au_004_icy'],
    ],
  },
];
