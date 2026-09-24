import type { StartMethod } from '../domain/types';

export const METHOD_LABELS: Record<StartMethod, string> = {
  'direct-sow': 'Sow seed in the ground',
  'seed-tray': 'Sow seed in trays/pots',
  seedling: 'Plant a seedling',
  cutting: 'Cutting / slip',
  tuber: 'Seed potato / tuber',
  'clove-or-bulb': 'Clove or bulb',
  'runner-or-crown': 'Runner or crown',
  tree: 'Young tree',
};
