/**
 * Maps task responses to garden updates, so ticking a job off also records
 * what happened (e.g. "Transplant tomato" → a transplanted event).
 */
import { addDays, nextWeekday } from '../domain/dates';
import type { GardenTask, ISODate, Weekday } from '../domain/types';
import type { GardenStore } from '../state/gardenStore';

export async function completeTask(store: GardenStore, task: GardenTask, today: ISODate) {
  if (task.kind === 'succession-sow' && task.successionPlanId !== undefined && task.successionBatchIndex !== undefined) {
    await store.acceptSuccessionBatch(task.successionPlanId, task.successionBatchIndex, today);
  } else if ((task.kind === 'system-step' || task.kind === 'sow') && task.id.startsWith('planned:') && task.plantingId) {
    await store.markStarted(task.plantingId, today);
  } else if (task.kind === 'transplant' && task.plantingId) {
    await store.addEvent(task.plantingId, 'transplanted', today);
  } else if (task.kind === 'harvest' && task.plantingId) {
    const p = store.state.data.plantings.find((x) => x.id === task.plantingId);
    const first = !p?.events.some((e) => e.type === 'first-harvest');
    await store.addEvent(task.plantingId, first ? 'first-harvest' : 'harvest', today);
  }
  await store.respondToTask(task.id, 'done');
}

export function snoozeTask(store: GardenStore, task: GardenTask, today: ISODate, days = 2) {
  return store.respondToTask(task.id, 'snoozed', addDays(today, days));
}

/** "Remind me on my next gardening day" — hides the task until that day. */
export function deferToGardeningDay(store: GardenStore, task: GardenTask, today: ISODate, gardeningDays: Weekday[]) {
  const next = nextWeekday(today, gardeningDays, false) ?? addDays(today, 7);
  return store.respondToTask(task.id, 'snoozed', next);
}
