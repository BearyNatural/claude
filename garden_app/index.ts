/**
 * App entry: expo-router, plus (Android only) the home-screen widget's handler,
 * which Android runs even when the app itself isn't open.
 */
import 'expo-router/entry';
import { Platform } from 'react-native';

if (Platform.OS === 'android') {
  // Defines the background weather-alert task (it must exist before Android runs it).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./src/services/alerts/backgroundAlerts');
  // Defines the background "new version available" check.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./src/services/updates/updateTask');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { widgetTaskHandler } = require('./src/widget/widgetTaskHandler');
  registerWidgetTaskHandler(widgetTaskHandler);
}
