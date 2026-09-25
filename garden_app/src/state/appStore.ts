/** Wires the production store: AsyncStorage + Open-Meteo + photo files + plant list updates. */
import { CATALOGUE_VERSION } from '../data/plants';
import { SOURCES } from '../data/sources';
import { CatalogueUpdates } from '../services/catalogue/catalogueUpdates';
import { ENV } from '../services/env';
import { asyncStorageStore } from '../services/storage/asyncStorageStore';
import { devicePhotoFiles } from '../services/photos/devicePhotoFiles';
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
  () => new Date(),
  devicePhotoFiles,
  new CatalogueUpdates(asyncStorageStore, { version: CATALOGUE_VERSION, sources: { ...SOURCES } }, { fetch: (url, init) => fetch(url, init), now: () => new Date() }),
);
