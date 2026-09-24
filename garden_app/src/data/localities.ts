/**
 * Offline reference localities.
 *
 * A compact list of Australian cities and regional towns with approximate
 * coordinates (2 d.p., ≈1 km) and a *suggested* gardening climate zone and
 * typical frost exposure. This lets the app work offline and gives the
 * nearest-town climate inference something to compare against.
 *
 * IMPORTANT — data quality:
 *  - Zone assignments follow the example towns given by Australian gardening
 *    references (ABC Organic Gardener "Understanding climate zones";
 *    The Seed Collection "Climate zones") and, for towns not named there, the
 *    developer's judgement based on general climate knowledge. Those are marked
 *    in docs/DATA_REVIEW.md as needing review.
 *  - Frost exposure is a coarse, typical value. Local frost varies enormously
 *    with elevation, slope and distance to the coast; gardeners can override it.
 *  - Coordinates are approximate town centres, used only for weather requests
 *    and nearest-town matching. They are not precise enough to locate a home.
 */
import type { Locality } from '../domain/location';
import type { AustralianState, ClimateZoneId, FrostRisk } from '../domain/types';

type Row = [string, string, AustralianState, number, number, ClimateZoneId, FrostRisk, boolean?];

const T = 'tropical' as const;
const S = 'subtropical' as const;
const W = 'warm-temperate' as const;
const C = 'cool-temperate' as const;
const A = 'arid' as const;

const ROWS: Row[] = [
  // Queensland
  ['Brisbane', '4000', 'QLD', -27.47, 153.03, S, 'light', true],
  ['Southport (Gold Coast)', '4215', 'QLD', -27.97, 153.4, S, 'none', true],
  ['Maroochydore (Sunshine Coast)', '4558', 'QLD', -26.66, 153.09, S, 'none', true],
  ['Ipswich', '4305', 'QLD', -27.61, 152.76, S, 'light'],
  ['Logan Central', '4114', 'QLD', -27.64, 153.11, S, 'light'],
  ['Redcliffe', '4020', 'QLD', -27.23, 153.1, S, 'none'],
  ['Caboolture', '4510', 'QLD', -27.08, 152.95, S, 'light'],
  ['Gatton', '4343', 'QLD', -27.56, 152.28, S, 'moderate'],
  ['Toowoomba', '4350', 'QLD', -27.56, 151.95, W, 'moderate', true],
  ['Warwick', '4370', 'QLD', -28.21, 152.03, W, 'heavy'],
  ['Stanthorpe', '4380', 'QLD', -28.65, 151.93, C, 'heavy'],
  ['Dalby', '4405', 'QLD', -27.18, 151.26, W, 'moderate'],
  ['Kingaroy', '4610', 'QLD', -26.54, 151.84, W, 'moderate'],
  ['Gympie', '4570', 'QLD', -26.19, 152.66, S, 'light'],
  ['Maryborough', '4650', 'QLD', -25.54, 152.7, S, 'light'],
  ['Hervey Bay', '4655', 'QLD', -25.29, 152.85, S, 'none'],
  ['Bundaberg', '4670', 'QLD', -24.87, 152.35, S, 'none'],
  ['Gladstone', '4680', 'QLD', -23.84, 151.25, S, 'none'],
  ['Rockhampton', '4700', 'QLD', -23.38, 150.51, S, 'light'],
  ['Emerald', '4720', 'QLD', -23.53, 148.16, A, 'light'],
  ['Mackay', '4740', 'QLD', -21.14, 149.19, S, 'none', true],
  ['Bowen', '4805', 'QLD', -20.01, 148.25, T, 'none'],
  ['Ayr', '4807', 'QLD', -19.57, 147.4, T, 'none'],
  ['Townsville', '4810', 'QLD', -19.26, 146.82, T, 'none', true],
  ['Charters Towers', '4820', 'QLD', -20.08, 146.26, T, 'light'],
  ['Ingham', '4850', 'QLD', -18.65, 146.16, T, 'none'],
  ['Innisfail', '4860', 'QLD', -17.52, 146.03, T, 'none'],
  ['Cairns', '4870', 'QLD', -16.92, 145.77, T, 'none', true],
  ['Port Douglas', '4877', 'QLD', -16.48, 145.46, T, 'none'],
  ['Mareeba', '4880', 'QLD', -17.0, 145.42, T, 'light'],
  ['Atherton', '4883', 'QLD', -17.27, 145.48, S, 'light'],
  ['Weipa', '4874', 'QLD', -12.63, 141.87, T, 'none'],
  ['Thursday Island', '4875', 'QLD', -10.58, 142.22, T, 'none'],
  ['Mount Isa', '4825', 'QLD', -20.73, 139.49, A, 'light'],
  ['Longreach', '4730', 'QLD', -23.44, 144.25, A, 'light'],
  ['Roma', '4455', 'QLD', -26.57, 148.79, A, 'moderate'],
  ['Charleville', '4470', 'QLD', -26.4, 146.24, A, 'moderate'],
  ['St George', '4487', 'QLD', -28.04, 148.58, A, 'light'],
  ['Goondiwindi', '4390', 'QLD', -28.55, 150.31, A, 'moderate'],

  // New South Wales
  ['Sydney', '2000', 'NSW', -33.87, 151.21, W, 'none', true],
  ['Parramatta', '2150', 'NSW', -33.81, 151.0, W, 'light'],
  ['Penrith', '2750', 'NSW', -33.75, 150.69, W, 'moderate'],
  ['Campbelltown', '2560', 'NSW', -34.07, 150.82, W, 'light'],
  ['Hornsby', '2077', 'NSW', -33.7, 151.1, W, 'light'],
  ['Cronulla', '2230', 'NSW', -34.05, 151.15, W, 'none'],
  ['Gosford (Central Coast)', '2250', 'NSW', -33.43, 151.34, W, 'light'],
  ['Newcastle', '2300', 'NSW', -32.93, 151.78, W, 'none', true],
  ['Maitland', '2320', 'NSW', -32.73, 151.55, W, 'light'],
  ['Wollongong', '2500', 'NSW', -34.42, 150.89, W, 'none', true],
  ['Nowra', '2541', 'NSW', -34.88, 150.6, W, 'light'],
  ['Batemans Bay', '2536', 'NSW', -35.71, 150.18, W, 'light'],
  ['Bega', '2550', 'NSW', -36.67, 149.84, W, 'moderate'],
  ['Katoomba', '2780', 'NSW', -33.71, 150.31, C, 'moderate'],
  ['Lithgow', '2790', 'NSW', -33.48, 150.16, C, 'heavy'],
  ['Bowral', '2576', 'NSW', -34.48, 150.42, C, 'moderate'],
  ['Goulburn', '2580', 'NSW', -34.75, 149.72, C, 'heavy'],
  ['Bathurst', '2795', 'NSW', -33.42, 149.58, C, 'heavy'],
  ['Orange', '2800', 'NSW', -33.28, 149.1, C, 'heavy'],
  ['Cooma', '2630', 'NSW', -36.24, 149.12, C, 'heavy'],
  ['Jindabyne', '2627', 'NSW', -36.42, 148.62, C, 'heavy'],
  ['Armidale', '2350', 'NSW', -30.51, 151.67, C, 'heavy'],
  ['Glen Innes', '2370', 'NSW', -29.74, 151.74, C, 'heavy'],
  ['Tenterfield', '2372', 'NSW', -29.05, 152.02, C, 'heavy'],
  ['Tamworth', '2340', 'NSW', -31.09, 150.93, W, 'moderate'],
  ['Port Macquarie', '2444', 'NSW', -31.43, 152.91, W, 'none'],
  ['Kempsey', '2440', 'NSW', -31.08, 152.84, W, 'light'],
  ['Taree', '2430', 'NSW', -31.91, 152.46, W, 'light'],
  ['Coffs Harbour', '2450', 'NSW', -30.3, 153.11, S, 'none', true],
  ['Grafton', '2460', 'NSW', -29.69, 152.93, S, 'light'],
  ['Lismore', '2480', 'NSW', -28.81, 153.28, S, 'light'],
  ['Byron Bay', '2481', 'NSW', -28.64, 153.61, S, 'none'],
  ['Ballina', '2478', 'NSW', -28.87, 153.56, S, 'none'],
  ['Tweed Heads', '2485', 'NSW', -28.18, 153.54, S, 'none'],
  ['Albury', '2640', 'NSW', -36.08, 146.92, A, 'moderate', true],
  ['Wagga Wagga', '2650', 'NSW', -35.12, 147.37, A, 'moderate', true],
  ['Griffith', '2680', 'NSW', -34.29, 146.05, A, 'moderate'],
  ['Deniliquin', '2710', 'NSW', -35.53, 144.96, A, 'moderate'],
  ['Hay', '2711', 'NSW', -34.51, 144.84, A, 'moderate'],
  ['Dubbo', '2830', 'NSW', -32.25, 148.6, A, 'moderate', true],
  ['Parkes', '2870', 'NSW', -33.14, 148.18, A, 'moderate'],
  ['Cobar', '2835', 'NSW', -31.5, 145.84, A, 'light'],
  ['Broken Hill', '2880', 'NSW', -31.95, 141.47, A, 'light'],
  ['Moree', '2400', 'NSW', -29.47, 149.84, A, 'light'],
  ['Narrabri', '2390', 'NSW', -30.33, 149.78, A, 'moderate'],

  // Australian Capital Territory
  ['Canberra', '2600', 'ACT', -35.28, 149.13, C, 'heavy', true],
  ['Belconnen', '2617', 'ACT', -35.24, 149.07, C, 'heavy'],
  ['Tuggeranong', '2900', 'ACT', -35.42, 149.07, C, 'heavy'],

  // Victoria
  ['Melbourne', '3000', 'VIC', -37.81, 144.96, C, 'light', true],
  ['Dandenong', '3175', 'VIC', -37.99, 145.21, C, 'light'],
  ['Frankston', '3199', 'VIC', -38.14, 145.12, C, 'light'],
  ['Mornington', '3931', 'VIC', -38.22, 145.04, C, 'light'],
  ['Geelong', '3220', 'VIC', -38.15, 144.36, C, 'light'],
  ['Healesville', '3777', 'VIC', -37.65, 145.52, C, 'moderate'],
  ['Ballarat', '3350', 'VIC', -37.56, 143.85, C, 'heavy', true],
  ['Daylesford', '3460', 'VIC', -37.35, 144.14, C, 'heavy'],
  ['Bendigo', '3550', 'VIC', -36.76, 144.28, C, 'moderate', true],
  ['Shepparton', '3630', 'VIC', -36.38, 145.4, C, 'moderate'],
  ['Wangaratta', '3677', 'VIC', -36.36, 146.31, C, 'moderate'],
  ['Wodonga', '3690', 'VIC', -36.12, 146.89, A, 'moderate', true],
  ['Echuca', '3564', 'VIC', -36.13, 144.75, A, 'moderate'],
  ['Swan Hill', '3585', 'VIC', -35.34, 143.55, A, 'moderate'],
  ['Mildura', '3500', 'VIC', -34.19, 142.16, A, 'light', true],
  ['Horsham', '3400', 'VIC', -36.71, 142.2, C, 'moderate'],
  ['Warrnambool', '3280', 'VIC', -38.38, 142.49, C, 'light'],
  ['Traralgon', '3844', 'VIC', -38.2, 146.54, C, 'moderate'],
  ['Sale', '3850', 'VIC', -38.11, 147.07, C, 'moderate'],
  ['Bairnsdale', '3875', 'VIC', -37.83, 147.61, C, 'light'],

  // Tasmania
  ['Hobart', '7000', 'TAS', -42.88, 147.33, C, 'light', true],
  ['Kingston', '7050', 'TAS', -42.98, 147.31, C, 'light'],
  ['Huonville', '7109', 'TAS', -43.03, 147.05, C, 'moderate'],
  ['Launceston', '7250', 'TAS', -41.44, 147.14, C, 'moderate', true],
  ['Devonport', '7310', 'TAS', -41.18, 146.35, C, 'light'],
  ['Burnie', '7320', 'TAS', -41.05, 145.91, C, 'light'],
  ['St Helens', '7216', 'TAS', -41.32, 148.24, C, 'light'],
  ['Queenstown', '7467', 'TAS', -42.08, 145.56, C, 'moderate'],

  // South Australia
  ['Adelaide', '5000', 'SA', -34.93, 138.6, W, 'light', true],
  ['Elizabeth', '5112', 'SA', -34.72, 138.67, W, 'light'],
  ['Victor Harbor', '5211', 'SA', -35.55, 138.62, W, 'light'],
  ['Mount Barker', '5251', 'SA', -35.07, 138.86, C, 'moderate'],
  ['Tanunda (Barossa)', '5352', 'SA', -34.52, 138.96, W, 'moderate'],
  ['Clare', '5453', 'SA', -33.83, 138.61, W, 'moderate'],
  ['Murray Bridge', '5253', 'SA', -35.12, 139.27, A, 'moderate'],
  ['Renmark', '5341', 'SA', -34.17, 140.75, A, 'moderate'],
  ['Mount Gambier', '5290', 'SA', -37.83, 140.78, C, 'moderate'],
  ['Port Lincoln', '5606', 'SA', -34.73, 135.86, W, 'none'],
  ['Port Pirie', '5540', 'SA', -33.19, 138.02, A, 'light'],
  ['Whyalla', '5600', 'SA', -33.03, 137.58, A, 'light'],
  ['Port Augusta', '5700', 'SA', -32.49, 137.77, A, 'light'],
  ['Coober Pedy', '5723', 'SA', -29.01, 134.75, A, 'light'],

  // Western Australia
  ['Perth', '6000', 'WA', -31.95, 115.86, W, 'none', true],
  ['Joondalup', '6027', 'WA', -31.74, 115.77, W, 'none'],
  ['Armadale', '6112', 'WA', -32.15, 116.01, W, 'light'],
  ['Fremantle', '6160', 'WA', -32.06, 115.75, W, 'none'],
  ['Mandurah', '6210', 'WA', -32.53, 115.72, W, 'none'],
  ['Bunbury', '6230', 'WA', -33.33, 115.64, W, 'light'],
  ['Busselton', '6280', 'WA', -33.65, 115.35, W, 'light'],
  ['Margaret River', '6285', 'WA', -33.95, 115.07, W, 'light'],
  ['Manjimup', '6258', 'WA', -34.24, 116.15, C, 'moderate'],
  ['Albany', '6330', 'WA', -35.02, 117.88, C, 'light'],
  ['Esperance', '6450', 'WA', -33.86, 121.89, W, 'light'],
  ['Northam', '6401', 'WA', -31.65, 116.67, W, 'moderate'],
  ['Merredin', '6415', 'WA', -31.48, 118.28, A, 'moderate'],
  ['Kalgoorlie', '6430', 'WA', -30.75, 121.47, A, 'light'],
  ['Geraldton', '6530', 'WA', -28.78, 114.61, W, 'none'],
  ['Carnarvon', '6701', 'WA', -24.88, 113.66, A, 'none'],
  ['Exmouth', '6707', 'WA', -21.93, 114.13, T, 'none', true],
  ['Karratha', '6714', 'WA', -20.74, 116.85, T, 'none'],
  ['Port Hedland', '6721', 'WA', -20.31, 118.61, T, 'none'],
  ['Broome', '6725', 'WA', -17.96, 122.24, T, 'none'],
  ['Kununurra', '6743', 'WA', -15.77, 128.74, T, 'none'],

  // Northern Territory
  ['Darwin', '0800', 'NT', -12.46, 130.84, T, 'none', true],
  ['Palmerston', '0830', 'NT', -12.48, 130.98, T, 'none'],
  ['Katherine', '0850', 'NT', -14.47, 132.26, T, 'none'],
  ['Nhulunbuy', '0880', 'NT', -12.18, 136.78, T, 'none'],
  ['Tennant Creek', '0860', 'NT', -19.65, 134.19, A, 'none'],
  ['Alice Springs', '0870', 'NT', -23.7, 133.88, A, 'moderate', true],
];

export const LOCALITIES: Locality[] = ROWS.map(([name, postcode, state, lat, lon, zone, frost, ref]) => ({
  name,
  postcode,
  state,
  lat,
  lon,
  zone,
  frost,
  zoneFromReference: ref === true,
}));
