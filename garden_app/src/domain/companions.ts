/**
 * Companion planting — handled carefully.
 *
 * Every relationship states *why* (functional reasons) and *how well
 * supported* the claim is. Traditional/folklore associations are labelled as
 * such rather than presented as established science.
 */
import type { PlantCategory, PlantRecord } from './plantTypes';
import { isInArea } from './plantingAreas';
import type { Planting } from './types';
import { isActive } from './space';

export type CompanionEvidence = 'established' | 'plausible' | 'traditional';

export type CompanionReason =
  | 'compatible-water'
  | 'compatible-soil'
  | 'root-zones'
  | 'shade'
  | 'ground-cover'
  | 'vertical-support'
  | 'nitrogen-fixation'
  | 'pollinators'
  | 'beneficial-insects'
  | 'biodiversity'
  | 'space-efficiency'
  | 'shared-pests'
  | 'traditional';

export const REASON_LABELS: Record<CompanionReason, string> = {
  'compatible-water': 'Similar water needs',
  'compatible-soil': 'Similar soil conditions',
  'root-zones': 'Roots use different soil depths',
  shade: 'Provides useful shade',
  'ground-cover': 'Ground cover',
  'vertical-support': 'Vertical support',
  'nitrogen-fixation': 'Nitrogen fixation',
  pollinators: 'Attracts pollinators',
  'beneficial-insects': 'Supports beneficial insects',
  biodiversity: 'Adds biodiversity',
  'space-efficiency': 'Efficient use of space',
  'shared-pests': 'Share pests and diseases',
  traditional: 'Traditional association',
};

export const EVIDENCE_LABELS: Record<CompanionEvidence, string> = {
  established: 'Well supported',
  plausible: 'Plausible (practical reasoning)',
  traditional: 'Traditional — limited evidence',
};

/** A side of a relationship: a specific plant, or every plant in a category. */
export type CompanionTarget = { plantId: string } | { category: PlantCategory };

export interface CompanionRelation {
  id: string;
  a: CompanionTarget;
  b: CompanionTarget;
  effect: 'beneficial' | 'avoid';
  reasons: CompanionReason[];
  evidence: CompanionEvidence;
  note: string;
  sourceIds: string[];
}

function matches(t: CompanionTarget, p: PlantRecord): boolean {
  return 'plantId' in t ? t.plantId === p.id : p.categories.includes(t.category);
}

export interface CompanionMatch {
  other: PlantRecord;
  relation: CompanionRelation;
}

/** All companions (and plants to avoid) for a plant. */
export function companionsFor(plant: PlantRecord, all: readonly PlantRecord[], relations: readonly CompanionRelation[]): CompanionMatch[] {
  const out: CompanionMatch[] = [];
  const seen = new Set<string>();
  for (const rel of relations) {
    let otherSide: CompanionTarget | null = null;
    if (matches(rel.a, plant)) otherSide = rel.b;
    else if (matches(rel.b, plant)) otherSide = rel.a;
    if (!otherSide) continue;
    for (const other of all) {
      if (other.id === plant.id || !matches(otherSide, other)) continue;
      const key = `${rel.id}:${other.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ other, relation: rel });
    }
  }
  const rank = { established: 0, plausible: 1, traditional: 2 };
  return out.sort(
    (x, y) =>
      (x.relation.effect === y.relation.effect ? 0 : x.relation.effect === 'beneficial' ? -1 : 1) ||
      rank[x.relation.evidence] - rank[y.relation.evidence] ||
      x.other.commonName.localeCompare(y.other.commonName),
  );
}

export interface AreaCompanionNote {
  plants: [PlantRecord, PlantRecord];
  relation: CompanionRelation;
}

/** Companion notes for plants currently growing together in the same area. */
export function areaCompanionNotes(
  areaId: string,
  plantings: readonly Planting[],
  getPlant: (id: string) => PlantRecord | undefined,
  relations: readonly CompanionRelation[],
): AreaCompanionNote[] {
  const plants = [
    ...new Set(plantings.filter((p) => isInArea(p, areaId) && isActive(p)).map((p) => p.plantId)),
  ]
    .map(getPlant)
    .filter((p): p is PlantRecord => !!p);
  const notes: AreaCompanionNote[] = [];
  for (let i = 0; i < plants.length; i++) {
    for (let j = i + 1; j < plants.length; j++) {
      const [x, y] = [plants[i], plants[j]];
      for (const rel of relations) {
        if ((matches(rel.a, x) && matches(rel.b, y)) || (matches(rel.a, y) && matches(rel.b, x))) {
          notes.push({ plants: [x, y], relation: rel });
        }
      }
    }
  }
  return notes;
}

export function describeRelation(rel: CompanionRelation): string {
  const reasons = rel.reasons.map((r) => REASON_LABELS[r].toLowerCase()).join(', ');
  return `${rel.effect === 'beneficial' ? 'Good together' : 'Better kept apart'}: ${reasons}. ${EVIDENCE_LABELS[rel.evidence]}.`;
}
