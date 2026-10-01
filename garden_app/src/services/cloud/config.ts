/**
 * Cloud sync: the gardener's own Dropbox or Google Drive. These are public app
 * identifiers (they're in every copy of the app) — never put client secrets
 * here; sign-in uses PKCE, which doesn't need one.
 */
import { WEB_BASE } from '../webBase';

export type CloudProviderId = 'dropbox' | 'google';

export const CLOUD = {
  dropbox: { appKey: '87s09553k7twxfh' },
  google: {
    webClientId: '757296531892-7eulnqfu03p1jm21q14f2vo2t2d7op84.apps.googleusercontent.com',
    androidClientId: '757296531892-293ik2bgrk4tfopvbctvlamsha9ar2md.apps.googleusercontent.com',
  },
} as const;

/** The one file each provider keeps (in Dropbox's app folder, or created by the app in Google Drive). */
export const SYNC_FILE = 'SowBySeason-Sync.json';

export const WEB_ORIGIN = 'https://daydreaminginthecloud.bearynatural.dev';
/** Where providers send the browser back after sign-in (a small static page). */
export const WEB_REDIRECT = `${WEB_ORIGIN}${WEB_BASE}/auth.html`;
/** Where providers send the phone app back after sign-in. */
export const APP_REDIRECT = 'sowbyseason://cloud-auth';
/** Google's Android sign-in returns to the app through its reversed client id. */
export const GOOGLE_APP_REDIRECT = `com.googleusercontent.apps.${CLOUD.google.androidClientId.split('.apps.')[0]}:/oauth2redirect`;

export const PROVIDER_NAMES: Record<CloudProviderId, string> = { dropbox: 'Dropbox', google: 'Google Drive' };
