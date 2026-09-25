/** Wires the production store: AsyncStorage + Open-Meteo + photo files + plant list and app updates. */
import { Platform } from 'react-native';
import { CATALOGUE_VERSION } from '../data/plants';
import { SOURCES } from '../data/sources';
import { CatalogueUpdates } from '../services/catalogue/catalogueUpdates';
import { ENV } from '../services/env';
import { asyncStorageStore } from '../services/storage/asyncStorageStore';
import { devicePhotoFiles } from '../services/photos/devicePhotoFiles';
import { GardenRepository } from '../services/storage/gardenRepository';
import { submitSuggestion } from '../services/plants/plantSuggestions';
import { AppUpdates } from '../services/updates/appUpdates';
import { WeatherService } from '../services/weather/weatherService';
import { AutoBackupController } from './autoBackup';
import { GardenStore } from './gardenStore';

const netFetch = (url: string, init?: { headers?: Record<string, string> }) => fetch(url, init);

export const appStore = new GardenStore(
  new GardenRepository(asyncStorageStore),
  new WeatherService(asyncStorageStore, {
    fetch: (url, init) => fetch(url, init),
    now: () => new Date(),
    config: { apiKey: ENV.openMeteoApiKey },
  }),
  () => new Date(),
  devicePhotoFiles,
  new CatalogueUpdates(asyncStorageStore, { version: CATALOGUE_VERSION, sources: { ...SOURCES } }, { fetch: netFetch, now: () => new Date(), token: ENV.plantDataToken }),
  // The browser version is always current (it updates with the website), so it doesn't check.
  Platform.OS === 'web' ? null : new AppUpdates(asyncStorageStore, ENV.appVersion, { fetch: netFetch, now: () => new Date(), token: ENV.plantDataToken }),
  // Sharing needs the app's private token, which only phone builds have.
  ENV.plantDataToken ? (c, zone) => submitSuggestion(c, zone, { fetch: (url, init) => fetch(url, init), token: ENV.plantDataToken, appVersion: ENV.appVersion }) : null,
);

/** Keeps an automatic backup in the gardener's chosen folder (Android; off until they choose one). */
export const autoBackup = new AutoBackupController(appStore, asyncStorageStore);
