/**
 * Build-time configuration. Only EXPO_PUBLIC_* variables are embedded in the
 * app bundle — never put secrets here that must stay private.
 */
export const ENV = {
  /** Optional Open-Meteo commercial API key (required for commercial use). */
  openMeteoApiKey: process.env.EXPO_PUBLIC_OPEN_METEO_API_KEY || undefined,
  /**
   * Fine-grained token for the private plant data repository only, supplied at
   * build time from the PLANT_DATA_READ_TOKEN Actions secret: Contents read-only
   * (plant list, update notices) and Issues read/write (plant sharing). It can't
   * change the plant list. Absent in local builds: these features are skipped.
   */
  plantDataToken: process.env.EXPO_PUBLIC_PLANT_DATA_TOKEN || undefined,
  appVersion: '1.8.0',
};
