/**
 * Build-time configuration. Only EXPO_PUBLIC_* variables are embedded in the
 * app bundle — never put secrets here that must stay private.
 */
export const ENV = {
  /** Optional Open-Meteo commercial API key (required for commercial use). */
  openMeteoApiKey: process.env.EXPO_PUBLIC_OPEN_METEO_API_KEY || undefined,
  appVersion: '1.5.0',
};
