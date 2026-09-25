/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { weatherAlerts } from '../src/domain/alerts';
import { assessWeather } from '../src/domain/weather';
import { GardenRepository } from '../src/services/storage/gardenRepository';
import { MemoryStore } from '../src/services/storage/keyValueStore';
import { WeatherService } from '../src/services/weather/weatherService';
import { GardenStore } from '../src/state/gardenStore';
import { NOW_ISO, profile, snapshot } from './helpers';

const TODAY = '2026-09-24';
const NOW = new Date(NOW_ISO);
const home = { id: 'home', name: 'Strathpine' };

describe('weather alerts while the app is closed', () => {
  it('warns about frost, heat and heavy rain today or tomorrow, once per garden and day', () => {
    const w = assessWeather(
      snapshot(TODAY, [
        { minC: 1, maxC: 18 },
        { minC: 12, maxC: 38, precipitationMm: 45 },
        { minC: 0, maxC: 15 },
      ]),
      TODAY,
      NOW,
    );
    const alerts = weatherAlerts(w, TODAY, home);
    assert.deepEqual(alerts.map((a) => a.key), ['home:frost:2026-09-24', 'home:heat:2026-09-25', 'home:rain:2026-09-25']);
    assert.match(alerts[0].title, /Frost risk today — Strathpine/);
    assert.match(alerts[1].body, /38°C/);
    assert.ok(!alerts.some((a) => a.key.includes('2026-09-26')), 'the frost two days away waits for a later check');
  });

  it('says nothing without usable weather', () => {
    assert.deepEqual(weatherAlerts(assessWeather(null, TODAY, NOW), TODAY, home), []);
  });

  it('saving reminders while another garden is shown leaves the home location alone', async () => {
    const kv = new MemoryStore();
    const store = new GardenStore(new GardenRepository(kv, () => NOW), new WeatherService(kv, { fetch: async () => { throw new Error('offline'); }, now: () => NOW }), () => NOW);
    await store.init();
    const { createdAt: _c, updatedAt: _u, id: _i, ...p } = profile();
    await store.saveProfile(p);
    const homeLoc = store.state.data.profile!.location;
    const plot = await store.saveGarden({ name: 'Plot', location: { ...homeLoc, suburb: 'Hobart', timezone: 'Australia/Hobart' } });
    await store.setActiveGarden(plot.id);
    await store.updateProfile({ reminders: { ...store.state.data.profile!.reminders, enabled: false } });
    assert.deepEqual(store.state.data.profile!.location, homeLoc);
    assert.equal(store.state.data.profile!.reminders.enabled, false);
  });
});
