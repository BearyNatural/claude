/**
 * AsyncStorage-backed KeyValueStore (iOS, Android and web — on web
 * AsyncStorage uses localStorage).
 *
 * Note: Android's AsyncStorage has a default total size limit (historically
 * 6 MB). Garden data is small, but see docs/ARCHITECTURE.md for the planned
 * move to SQLite if records grow (e.g. photos, sensor data).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from './keyValueStore';

export const asyncStorageStore: KeyValueStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
  getAllKeys: () => AsyncStorage.getAllKeys(),
  multiGet: async (keys) => (await AsyncStorage.multiGet([...keys])) as readonly (readonly [string, string | null])[],
  multiSet: (pairs) => AsyncStorage.multiSet(pairs.map(([k, v]) => [k, v] as [string, string])),
  multiRemove: (keys) => AsyncStorage.multiRemove([...keys]),
};
