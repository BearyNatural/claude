/**
 * Opt-in sharing of plants the gardener adds, so they can be checked and added
 * to the Sow by Season plant list for everyone. A suggestion is filed in the
 * private plant data repository's suggestions inbox (a GitHub issue).
 *
 * Sent: the plant's details, the gardener's notes about it and their climate
 * zone (e.g. "subtropical", to help check planting months). Never sent:
 * photos, garden areas, plantings, location, name or anything else.
 * Nothing is added to the plant list automatically — each suggestion is checked
 * against reliable sources first.
 */
import type { ClimateZoneId, CustomPlant } from '../../domain/types';
import type { HeaderFetch } from '../catalogue/catalogueUpdates';

export const SUGGESTIONS_URL = 'https://api.github.com/repos/BearyNatural/sow-by-season-plant-data/issues';
export const SUGGESTION_LABEL = 'plant-suggestion';

type PostFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => ReturnType<HeaderFetch>;

/** Exactly what is shared — built from an explicit list of plant fields. */
export function suggestionPayload(c: CustomPlant, zone: ClimateZoneId | null, appVersion: string) {
  return {
    kind: 'sow-by-season-plant-suggestion',
    formatVersion: 1,
    appVersion,
    climateZone: zone ?? undefined,
    plant: {
      commonName: c.commonName,
      botanicalName: c.botanicalName,
      familyName: c.familyName,
      alaGuid: c.alaGuid,
      categories: c.categories,
      lifecycle: c.lifecycle,
      startMethods: c.startMethods,
      plantMonths: c.plantMonths,
      sun: c.sun,
      frost: c.frost,
      support: c.support,
      potOk: c.potOk,
      notes: c.notes,
    },
  };
}

export function suggestionIssue(c: CustomPlant, zone: ClimateZoneId | null, appVersion: string) {
  const payload = suggestionPayload(c, zone, appVersion);
  const title = `Plant suggestion: ${c.commonName}${c.botanicalName ? ` (${c.botanicalName})` : ''}`.slice(0, 200);
  const body = [
    'Suggested from the Sow by Season app. **Unverified** — check against reliable sources before adding to the plant list.',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n');
  return { title, body, labels: [SUGGESTION_LABEL] };
}

/** File a suggestion; returns its number. Throws if it couldn't be sent (e.g. offline). */
export async function submitSuggestion(c: CustomPlant, zone: ClimateZoneId | null, deps: { fetch: PostFetch; token?: string; appVersion: string }): Promise<number> {
  if (!deps.token) throw new Error('Sharing isn\'t available in this copy of the app.');
  const res = await deps.fetch(SUGGESTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deps.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify(suggestionIssue(c, zone, deps.appVersion)),
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error('The plant list inbox didn\'t accept it: this copy of the app isn\'t allowed to share plants yet. It will try again after the next app update.');
  if (!res.ok) throw new Error(`The plant list inbox is unavailable right now (${res.status}). It will try again next time you open the app.`);
  const json = (await res.json()) as { number?: unknown };
  return typeof json.number === 'number' ? json.number : 0;
}

export type SuggestionSender = (c: CustomPlant, zone: ClimateZoneId | null) => Promise<number>;
