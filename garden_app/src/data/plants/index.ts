import type { PlantRecord } from '../../domain/plantTypes';
import { withFertiliser } from '../fertilisers';
import { FLOWERS } from './flowers';
import { FRUIT } from './fruit';
import { HERBS } from './herbs';
import { VEGETABLES } from './vegetables';

/** The bundled starter catalogue. Static data — never included in backups. */
export const PLANTS: PlantRecord[] = [...VEGETABLES, ...HERBS, ...FRUIT, ...FLOWERS].map(withFertiliser);

/** Bump when catalogue content changes meaningfully (shown on the About screen). */
export const CATALOGUE_VERSION = '2026.10.1';
