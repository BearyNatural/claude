/**
 * What to feed: a fertiliser profile for each kind of plant — the nutrient
 * balance it wants, natural/organic options, and what to avoid. Plants are
 * mapped by id; your own plants (and anything unmapped) fall back by type.
 * Sources are in src/data/sources.ts.
 */
import type { PlantRecord } from '../domain/plantTypes';

export type FertiliserProfileId = 'leafy' | 'fruiting' | 'root' | 'legume' | 'general' | 'herbs' | 'citrus' | 'acid' | 'fruit-tree' | 'native' | 'flowers';

export interface FertiliserProfile {
  id: FertiliserProfileId;
  name: string;
  /** One line for the "Feed …" job on This Week. */
  use: string;
  /** The nutrient balance, in plain words (N = leaves, P = roots, K = flowers and fruit). */
  balance: string;
  organic: string[];
  avoid?: string;
  when?: string;
  sourceIds: string[];
}

export const FERTILISER_PROFILES: Record<FertiliserProfileId, FertiliserProfile> = {
  leafy: {
    id: 'leafy',
    name: 'Leafy greens — nitrogen for leaves',
    use: 'Use a nitrogen-rich feed, such as fish emulsion, worm tea or a little pelletised chicken manure.',
    balance: 'Higher in nitrogen (N), which drives leafy growth.',
    organic: ['Compost and aged manure dug in before planting', 'Blood and bone, chicken manure or pelletised manure (fast, high in nitrogen)', 'Worm tea or fish emulsion as a liquid feed every few weeks'],
    avoid: 'Fresh "hot" manure against the plants — age it first.',
    sourceIds: ['ga-fertilisers', 'sga-fertility'],
  },
  fruiting: {
    id: 'fruiting',
    name: 'Fruiting crops — potassium once flowering',
    use: 'Once flowering, use a potassium-rich feed (sulphate of potash, or a tomato / flower-and-fruit food); seaweed and fish liquid monthly.',
    balance: 'Balanced at planting, then higher in potassium (K) for flowers and fruit.',
    organic: ['Compost at planting', 'Sulphate of potash, about 10 g per square metre, at planting and as fruit sets', 'A 50/50 mix of liquid seaweed (kelp) and fish emulsion once a month'],
    avoid: 'High-nitrogen feeds once flowering — lots of leaves, little fruit.',
    sourceIds: ['ga-crazy-for-tomatoes', 'ga-fertilisers'],
  },
  root: {
    id: 'root',
    name: 'Root crops — go easy on nitrogen',
    use: 'Root crops need little feeding; dig compost in before sowing. No blood and bone or pelletised manure.',
    balance: 'Low in nitrogen (N); potassium (K) is fine.',
    organic: ['Compost dug in well before sowing', 'Beds that were well fed for the previous crop'],
    avoid: 'Blood and bone, pelletised or fresh manure — they give leafy tops and forked, distorted roots.',
    sourceIds: ['ga-carrot-tips'],
  },
  legume: {
    id: 'legume',
    name: 'Peas and beans — little or no nitrogen',
    use: 'Peas and beans make their own nitrogen; compost at planting is usually enough.',
    balance: 'Little or no nitrogen (N) — they fix their own and leave the soil richer.',
    organic: ['Compost at planting', 'Liquid seaweed if growth is slow'],
    avoid: 'Nitrogen-rich fertilisers and manures.',
    sourceIds: ['ga-crop-rotation'],
  },
  general: {
    id: 'general',
    name: 'Vegetables — complete, balanced feeding',
    use: 'Use a balanced complete fertiliser or pelletised manure, or a liquid seaweed and fish feed.',
    balance: 'Balanced nitrogen, phosphorus and potassium (a complete vegetable food).',
    organic: ['Compost and aged manure at planting', 'Pelletised manure or blood and bone as a side dressing', 'Liquid seaweed or fish emulsion for a quick boost'],
    avoid: 'Overdoing it — extra fertiliser washes into waterways.',
    sourceIds: ['ga-fertilisers', 'sga-fertility'],
  },
  herbs: {
    id: 'herbs',
    name: 'Herbs — light feeding',
    use: 'Herbs need only light feeding: a little liquid seaweed or worm tea.',
    balance: 'Light and balanced.',
    organic: ['Compost at planting', 'Occasional liquid seaweed or worm tea'],
    avoid: 'Heavy feeding — soft, sappy growth with less flavour (Mediterranean herbs like poor soil).',
    sourceIds: ['sga-fertility', 'general-knowledge'],
  },
  citrus: {
    id: 'citrus',
    name: 'Citrus — citrus food at the right times',
    use: 'Use a citrus fertiliser (complete, with trace elements).',
    balance: 'Complete, with nitrogen and trace elements.',
    when: 'Main feed a few weeks before flowering in late winter, a second in late summer. Young trees: split into winter, spring and late summer.',
    organic: ['Compost or aged manure under the mulch, out to the drip line', 'A citrus or complete fertiliser watered in well'],
    avoid: 'Too much nitrogen late in the season (poorer fruit, more leafminer).',
    sourceIds: ['nsw-dpi-young-citrus', 'nsw-dpi-citrus-garden', 'sga-pests'],
  },
  acid: {
    id: 'acid',
    name: 'Acid-loving — azalea and camellia food',
    use: 'Use an acid-plant fertiliser (azalea or camellia food).',
    balance: 'For acid soil; low in phosphorus.',
    organic: ['Pine-bark or leaf-litter mulch', 'An azalea/camellia fertiliser'],
    avoid: 'Lime, dolomite and mushroom compost — they raise soil pH.',
    sourceIds: ['abga-blueberries', 'general-knowledge'],
  },
  'fruit-tree': {
    id: 'fruit-tree',
    name: 'Fruit trees and vines — feed as growth starts',
    use: 'Use a complete fertiliser as growth starts, and potash as fruit sets.',
    balance: 'Complete in late winter–spring; extra potassium (K) for fruit.',
    when: 'Late winter to early spring, as new growth starts; potash again as fruit sets.',
    organic: ['Compost or aged manure under the mulch, out to the drip line', 'Pelletised manure or a complete fruit-tree fertiliser', 'Sulphate of potash as fruit sets'],
    avoid: 'Heavy nitrogen — lots of leaf, less fruit.',
    sourceIds: ['ga-fertilisers', 'general-knowledge'],
  },
  native: {
    id: 'native',
    name: 'Australian natives — low phosphorus',
    use: 'Use a native-plant fertiliser low in phosphorus, lightly.',
    balance: 'Low phosphorus (P) — roughly N 14 : P 4 : K 8 or lower in P.',
    organic: ['Leaf-litter or bark mulch', 'A fertiliser made for Australian plants'],
    avoid: 'Ordinary fertilisers, manures and blood and bone — too much phosphorus can kill banksias, grevilleas and some wattles.',
    sourceIds: ['anpsa-phosphorus', 'ga-fertilisers'],
  },
  flowers: {
    id: 'flowers',
    name: 'Flowers — light feeding, potassium for blooms',
    use: 'Use a light potassium-rich feed (flower-and-fruit food or liquid seaweed).',
    balance: 'Light; potassium (K) helps flowering.',
    organic: ['Compost at planting', 'Liquid seaweed or a little sulphate of potash'],
    avoid: 'Lots of nitrogen — leaves instead of flowers.',
    sourceIds: ['ga-fertilisers'],
  },
};

const BY_PLANT: Record<string, FertiliserProfileId> = {
  tomato: 'fruiting', 'cherry-tomato': 'fruiting', capsicum: 'fruiting', chilli: 'fruiting', eggplant: 'fruiting',
  zucchini: 'fruiting', pumpkin: 'fruiting', cucumber: 'fruiting', strawberry: 'fruiting', passionfruit: 'fruiting',
  carrot: 'root', radish: 'root', beetroot: 'root', potato: 'root', 'sweet-potato': 'root',
  lettuce: 'leafy', spinach: 'leafy', silverbeet: 'leafy', kale: 'leafy', 'pak-choy': 'leafy', rocket: 'leafy',
  broccoli: 'leafy', cauliflower: 'leafy', cabbage: 'leafy', 'warrigal-greens': 'leafy',
  'bean-bush': 'legume', 'bean-climbing': 'legume', 'broad-bean': 'legume', pea: 'legume',
  'sweet-corn': 'general', onion: 'general', garlic: 'general', 'spring-onion': 'general', leek: 'general',
  basil: 'herbs', parsley: 'herbs', coriander: 'herbs', rosemary: 'herbs', thyme: 'herbs', mint: 'herbs', chives: 'herbs', oregano: 'herbs', lavender: 'herbs',
  lemon: 'citrus', blueberry: 'acid',
  fig: 'fruit-tree', mango: 'fruit-tree', avocado: 'fruit-tree', grape: 'fruit-tree', 'dragon-fruit': 'fruit-tree', mulberry: 'fruit-tree',
  peachcot: 'fruit-tree', plumcot: 'fruit-tree', plum: 'fruit-tree', peach: 'fruit-tree', nectarine: 'fruit-tree', apricot: 'fruit-tree', apple: 'fruit-tree', pear: 'fruit-tree',
  sunflower: 'flowers', calendula: 'flowers', cosmos: 'flowers', borage: 'flowers', alyssum: 'flowers', marigold: 'flowers',
};

/** The fertiliser profile for a plant: its own mapping, else by family and type. */
export function fertiliserProfileFor(plant: Pick<PlantRecord, 'id' | 'family' | 'categories' | 'fertiliser'>): FertiliserProfile {
  const id = (plant.fertiliser?.profile as FertiliserProfileId | undefined) ?? BY_PLANT[plant.id];
  if (id && FERTILISER_PROFILES[id]) return FERTILISER_PROFILES[id];
  const c = plant.categories;
  if (plant.family === 'Rutaceae') return FERTILISER_PROFILES.citrus;
  if (plant.family === 'Fabaceae' && c.includes('vegetable')) return FERTILISER_PROFILES.legume;
  if (c.includes('native') && !c.includes('vegetable')) return FERTILISER_PROFILES.native;
  if (c.includes('fruit') && (c.includes('tree') || c.includes('perennial'))) return FERTILISER_PROFILES['fruit-tree'];
  if (c.includes('flower')) return FERTILISER_PROFILES.flowers;
  if (c.includes('herb') && !c.includes('vegetable')) return FERTILISER_PROFILES.herbs;
  return FERTILISER_PROFILES.general;
}

/** Adds each catalogue plant's fertiliser profile (and its one-line advice) to the record. */
export function withFertiliser(p: PlantRecord): PlantRecord {
  const profile = fertiliserProfileFor(p);
  return { ...p, fertiliser: { profile: profile.id, use: profile.use } };
}

/** Every catalogue plant id that has an explicit mapping (for tests). */
export const MAPPED_PLANT_IDS = Object.keys(BY_PLANT);
