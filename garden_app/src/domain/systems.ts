/**
 * Structured planting systems (Three Sisters now; guilds, rotations,
 * pollinator strips, intercropping later).
 *
 * A system is data: members with roles and functions, plus sequencing rules
 * that say when each member is started relative to another member — either a
 * fixed offset or a biological trigger ("when the corn is ~15 cm tall") with
 * an approximate day range. The planner turns that into dated steps, checks
 * each step against the member's planting window for the gardener's zone and
 * explains any problems.
 */
import { addDays, formatApproxRange, formatDay } from './dates';
import type { PlantRecord } from './plantTypes';
import type { ClimateZoneId, ISODate } from './types';
import { inWindow, primaryWindow, windowEndFrom } from './windows';

export interface SystemMember {
  role: string;
  roleLabel: string;
  plantId: string;
  /** What this member does for the system. */
  functions: string[];
  /** Relative start: omitted for the anchor member. */
  after?: {
    role: string;
    /** Approximate days after that member is sown. */
    days: [number, number];
    /** The biological trigger to watch for, in plain language. */
    trigger?: string;
  };
  perUnit?: string;
}

export interface PlantingSystem {
  id: string;
  name: string;
  summary: string;
  culturalNote?: string;
  members: SystemMember[];
  layout: string[];
  cautions: string[];
  sourceIds: string[];
}

export interface SystemStep {
  role: string;
  roleLabel: string;
  plant: PlantRecord;
  earliest: ISODate;
  latest: ISODate;
  /** Suggested single date (earliest + a little). */
  suggested: ISODate;
  trigger?: string;
  functions: string[];
  inWindow: boolean | null;
  warnings: string[];
}

export interface SystemPlanResult {
  ok: boolean;
  steps: SystemStep[];
  warnings: string[];
}

/**
 * Plan a system starting with the anchor member on `startDate`.
 * Steps are ordered by dependency; a member can only follow a member already placed.
 */
export function planSystem(
  system: PlantingSystem,
  startDate: ISODate,
  zone: ClimateZoneId | null,
  getPlant: (id: string) => PlantRecord | undefined,
): SystemPlanResult {
  const steps: SystemStep[] = [];
  const warnings: string[] = [];
  const placed = new Map<string, SystemStep>();
  const pending = [...system.members];
  let guard = 0;
  while (pending.length && guard++ < 50) {
    const idx = pending.findIndex((m) => !m.after || placed.has(m.after.role));
    if (idx < 0) {
      warnings.push('This system has a sequencing loop and cannot be planned.');
      break;
    }
    const m = pending.splice(idx, 1)[0];
    const plant = getPlant(m.plantId);
    if (!plant) {
      warnings.push(`Missing plant data for ${m.roleLabel}.`);
      continue;
    }
    let earliest: ISODate;
    let latest: ISODate;
    if (!m.after) {
      earliest = latest = startDate;
    } else {
      const anchor = placed.get(m.after.role)!;
      earliest = addDays(anchor.suggested, m.after.days[0]);
      latest = addDays(anchor.suggested, m.after.days[1]);
    }
    const suggested = earliest;
    const stepWarnings: string[] = [];
    let ok: boolean | null = null;
    const win = primaryWindow(plant, zone);
    if (win) {
      ok = inWindow(win.months, suggested);
      if (!ok) {
        const lateOk = inWindow(win.months, latest);
        stepWarnings.push(
          lateOk
            ? `${plant.commonName} would be early for your area on ${formatDay(suggested)}; closer to ${formatDay(latest)} is inside its window.`
            : `${plant.commonName} would be outside its recommended window for your area around ${formatApproxRange(earliest, latest)}.`,
        );
      } else if (!m.after) {
        const end = windowEndFrom(win.months, suggested);
        if (end) {
          // Make sure followers can still be sown before the anchor's window closes.
          const maxFollow = Math.max(0, ...system.members.filter((x) => x.after?.role === m.role).map((x) => x.after!.days[1]));
          if (maxFollow > 0 && addDays(suggested, maxFollow) > end) {
            stepWarnings.push(`Starting this late leaves little time for the following steps before the planting season ends.`);
          }
        }
      }
    } else {
      stepWarnings.push(`No planting window is recorded for ${plant.commonName} in your zone.`);
    }
    const step: SystemStep = {
      role: m.role,
      roleLabel: m.roleLabel,
      plant,
      earliest,
      latest,
      suggested,
      trigger: m.after?.trigger,
      functions: m.functions,
      inWindow: ok,
      warnings: stepWarnings,
    };
    placed.set(m.role, step);
    steps.push(step);
    warnings.push(...stepWarnings);
  }
  return { ok: steps.length === system.members.length && steps.every((s) => s.inWindow !== false), steps, warnings };
}
