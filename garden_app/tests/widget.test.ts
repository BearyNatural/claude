/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GardenTask } from '../src/domain/types';
import { buildWidgetSnapshot } from '../src/widget/snapshot';
import { mildWeather, noWeather } from './helpers';

const TODAY = '2026-09-25';
const task = (id: string, priority: GardenTask['priority'], dueDate: string, title = id): GardenTask =>
  ({ id, kind: 'care', section: 'care', priority, title, why: '', dueDate, minutes: 10 }) as unknown as GardenTask;

describe('home-screen widget summary', () => {
  it('asks the gardener to set up first', () => {
    const s = buildWidgetSnapshot({ today: TODAY, hasProfile: false, seasonLabel: 'Spring', weather: noWeather(TODAY), tasks: [], plantNowNames: [] });
    assert.equal(s.needsSetup, true);
  });

  it('shows the most important jobs for the coming week first, and how many more', () => {
    const s = buildWidgetSnapshot({
      today: TODAY,
      hasProfile: true,
      seasonLabel: 'Spring',
      suburb: 'Strathpine',
      zoneName: 'Subtropical',
      weather: mildWeather(TODAY),
      tasks: [task('later', 'important', '2026-10-20'), task('optional', 'optional', TODAY), task('water', 'important', '2026-09-27'), task('sow', 'soon', TODAY), task('feed', 'soon', '2026-09-28')],
      plantNowNames: ['Basil', 'Beans', 'Zucchini', 'Corn', 'Pumpkin'],
    });
    assert.equal(s.title, 'Spring in Strathpine');
    assert.deepEqual(s.tasks, ['water', 'sow', 'feed']);
    assert.equal(s.moreTasks, 1, 'the job a month away is not counted');
    assert.deepEqual(s.plantNow, ['Basil', 'Beans', 'Zucchini', 'Corn']);
    assert.match(s.weather ?? '', /^Today \d+°–\d+°C/);
  });

  it('leaves weather out when only seasonal advice is available', () => {
    const s = buildWidgetSnapshot({ today: TODAY, hasProfile: true, seasonLabel: 'Spring', weather: noWeather(TODAY), tasks: [], plantNowNames: [] });
    assert.equal(s.weather, undefined);
  });
});
