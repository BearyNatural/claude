/** Browser version: websites can't run weather checks while closed. */
export const WEATHER_ALERTS_TASK = 'sow-by-season-weather-alerts';
export const runWeatherAlertCheck = async (): Promise<number> => 0;
export const syncWeatherAlerts = async (_enabled: boolean): Promise<'on' | 'off' | 'unavailable'> => 'unavailable';
