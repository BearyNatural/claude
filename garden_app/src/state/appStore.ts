/** Wires the production store: AsyncStorage + Open-Meteo. */
import { ENV } from '../services/env';
import { asyncStorageStore } from '../services/storage/asyncStorageStore';
import { GardenRepository } from '../services/storage/gardenRepository';
import { WeatherService } from '../services/weather/weatherService';
import { GardenStore } from './gardenStore';

export const appStore = new GardenStore(
  new GardenRepository(asyncStorageStore),
  new WeatherService(asyncStorageStore, {
    fetch: (url, init) => fetch(url, init),
    now: () => new Date(),
    config: { apiKey: ENV.openMeteoApiKey },
  }),
);
