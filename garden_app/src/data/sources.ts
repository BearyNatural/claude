/**
 * Registry of information sources used by the plant catalogue.
 *
 * Every plant field group references one or more of these ids so the app can
 * show "where does this come from?" and so horticultural reviewers can see
 * which values still need checking.
 */
import type { SourceRef } from '../domain/plantTypes';

const ACCESSED = '2026-09-24';

export const SOURCES: Record<string, SourceRef> = {
  'ga-vegie-guide': {
    id: 'ga-vegie-guide',
    title: 'Vegie Guide — monthly planting lists by climate zone',
    publisher: 'ABC Gardening Australia',
    url: 'https://www.abc.net.au/gardening/vegie-guide-zones/9796680',
    accessed: ACCESSED,
    kind: 'broadcaster',
    notes:
      'Monthly "what to plant" lists for the Tropical, Subtropical, Temperate, Cool and Arid zones were captured for all 12 months and converted to month sets (see data-sources/gardening-australia). GA Temperate → warm-temperate; GA Cool → cool-temperate.',
  },
  'seed-collection-chart': {
    id: 'seed-collection-chart',
    title: 'Sowing Chart (vegetables, herbs, flowers)',
    publisher: 'The Seed Collection (Australian seed supplier)',
    url: 'https://www.theseedcollection.com.au/assets/files/TheSeedCollection-%20Sowing%20Chart.pdf',
    accessed: ACCESSED,
    kind: 'seed-supplier',
    notes:
      'General (not variety-specific) sowing depth, row and plant spacing, frost tolerance, germination days, days to maturity and sowing months for Cool, Temperate, Subtropical and Tropical zones. No arid-zone column.',
  },
  'osu-soil-temp': {
    id: 'osu-soil-temp',
    title: 'Soil temperature conditions for vegetable seed germination',
    publisher: 'Oregon State University Extension Service (data: J. F. Harrington, UC Davis)',
    url: 'https://extension.oregonstate.edu/gardening/soil-compost/soil-temperature-conditions-vegetable-seed-germination',
    accessed: ACCESSED,
    kind: 'university',
    notes: 'Germination soil temperature thresholds are physiological and apply in Australia. Converted from °F to °C and rounded.',
  },
  'organic-gardener-zones': {
    id: 'organic-gardener-zones',
    title: 'Understanding climate zones',
    publisher: 'ABC Organic Gardener Magazine',
    url: 'https://www.organicgardener.com.au/understanding-climate-zones/',
    accessed: ACCESSED,
    kind: 'broadcaster',
  },
  'seed-collection-zones': {
    id: 'seed-collection-zones',
    title: 'Climate zones for Australian gardeners',
    publisher: 'The Seed Collection',
    url: 'https://www.theseedcollection.com.au/climate-zones',
    accessed: ACCESSED,
    kind: 'seed-supplier',
  },
  'sga-strawberries': {
    id: 'sga-strawberries',
    title: 'Growing strawberries',
    publisher: 'Sustainable Gardening Australia',
    url: 'https://www.sgaonline.org.au/strawberries/',
    accessed: ACCESSED,
    kind: 'horticultural-org',
  },
  'sga-potatoes': {
    id: 'sga-potatoes',
    title: 'Growing potatoes',
    publisher: 'Sustainable Gardening Australia',
    url: 'https://www.sgaonline.org.au/potatoes/',
    accessed: ACCESSED,
    kind: 'horticultural-org',
  },
  'sga-sweet-potato': {
    id: 'sga-sweet-potato',
    title: 'Growing sweet potato',
    publisher: 'Sustainable Gardening Australia',
    url: 'https://www.sgaonline.org.au/sweet-potato/',
    accessed: ACCESSED,
    kind: 'horticultural-org',
  },
  'sga-figs': {
    id: 'sga-figs',
    title: 'Grow and prune fig trees',
    publisher: 'Sustainable Gardening Australia',
    url: 'https://www.sgaonline.org.au/figs/',
    accessed: ACCESSED,
    kind: 'horticultural-org',
  },
  'nsw-dpi-citrus-garden': {
    id: 'nsw-dpi-citrus-garden',
    title: 'Citrus in the garden',
    publisher: 'NSW Department of Primary Industries and Regional Development',
    url: 'https://www.dpird.nsw.gov.au/agriculture/horticulture/citrus/content/crop-management/orchard-management-factsheets/garden',
    accessed: ACCESSED,
    kind: 'government',
  },
  'ga-passionfruit': {
    id: 'ga-passionfruit',
    title: 'Passionfruit Professional (fact sheet)',
    publisher: 'ABC Gardening Australia',
    url: 'https://www.abc.net.au/gardening/factsheets/passionfruit-professional/10312208',
    accessed: ACCESSED,
    kind: 'broadcaster',
  },
  'ga-garlic': {
    id: 'ga-garlic',
    title: 'Guide to Garlic',
    publisher: 'ABC Gardening Australia',
    url: 'https://www.abc.net.au/gardening/how-to/guide-to-garlic/13286000',
    accessed: ACCESSED,
    kind: 'broadcaster',
  },
  'nt-gov-mango': {
    id: 'nt-gov-mango',
    title: 'Mango — growing fruit and vegetables at home',
    publisher: 'Northern Territory Government',
    url: 'https://nt.gov.au/environment/home-gardens/growing-vegetables-at-home/mango',
    accessed: ACCESSED,
    kind: 'government',
  },
  'abga-blueberries': {
    id: 'abga-blueberries',
    title: 'Grow your own blueberries',
    publisher: 'Australian Blueberry Growers\' Association',
    url: 'https://australianblueberries.com.au/is-good/grow-your-own/',
    accessed: ACCESSED,
    kind: 'industry',
  },
  'cornell-three-sisters': {
    id: 'cornell-three-sisters',
    title: 'How to plant the Three Sisters',
    publisher: 'Cornell Garden-Based Learning, Cornell University',
    url: 'https://gardening.cals.cornell.edu/lessons/curriculum-classics/the-three-sisters-exploring-an-iroquois-garden/how-to-plant-the-three-sisters/',
    accessed: ACCESSED,
    kind: 'university',
  },
  'msstate-companion': {
    id: 'msstate-companion',
    title: 'Companion planting: myth or truth?',
    publisher: 'Mississippi State University Extension',
    url: 'https://extension.msstate.edu/blogs/extension-for-real-life/companion-planting-myth-or-truth',
    accessed: ACCESSED,
    kind: 'university',
  },
  'bn-heuristic': {
    id: 'bn-heuristic',
    title: 'BearyNatural planning heuristic',
    publisher: 'Sow by Season',
    accessed: ACCESSED,
    kind: 'heuristic',
    notes:
      'Household quantities, succession intervals, workload minutes and weather thresholds are planning heuristics designed for this app. They are starting points for estimates, not horticultural measurements, and should be reviewed by an experienced horticulturist.',
  },
  'general-knowledge': {
    id: 'general-knowledge',
    title: 'Developer-compiled general horticultural knowledge',
    publisher: 'Sow by Season (unverified)',
    accessed: ACCESSED,
    kind: 'heuristic',
    notes:
      'Widely-repeated general gardening knowledge (e.g. "tomatoes need staking", "coriander bolts in heat") entered without a specific citation. Flagged for horticultural review before commercial release.',
  },
};

export function sourceById(id: string): SourceRef | undefined {
  return SOURCES[id];
}
