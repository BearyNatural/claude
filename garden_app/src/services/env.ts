/**
 * Build-time configuration. Only EXPO_PUBLIC_* variables are embedded in the
 * app bundle — never put secrets here that must stay private.
 */
export const ENV = {
  /** Optional Open-Meteo commercial API key (required for commercial use). */
  openMeteoApiKey: process.env.EXPO_PUBLIC_OPEN_METEO_API_KEY || undefined,
  /**
   * Read-only token for the private plant list repository, supplied at build
   * time from the PLANT_DATA_READ_TOKEN Actions secret. It can only read that
   * repository's plant data. Absent in local builds: updates are then skipped.
   */
  plantDataToken: process.env.EXPO_PUBLIC_PLANT_DATA_TOKEN || undefined,
  appVersion: '1.5.1',
};
