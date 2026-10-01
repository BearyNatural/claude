import type { GoogleClient, GoogleTokens } from '../main/google/oauth';
import { UserError } from '../main/services/core';
import { guardedFetch } from '../main/net';

/**
 * Google sign-in for the browser build (swapped in for src/main/google/oauth.ts).
 *
 * Uses Google's browser flow for a public "Web application" client: a pop-up goes to Google,
 * which returns a short-lived access token to `oauth.html` on this site. That page passes it to
 * the app over a BroadcastChannel (same site, this browser only) and closes. No client secret,
 * no refresh token: after about an hour, exporting asks you to connect again. Only the
 * `drive.file` scope is requested.
 */

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export type { GoogleClient, GoogleTokens };

/** Where `oauth.html` lives — the folder the app was loaded from (set by the worker at start-up). */
let appBase = '';
export function setAppBase(base: string): void {
  appBase = base;
}

export function redirectUri(): string {
  return new URL('oauth.html', appBase).href;
}

function randomState(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function authUrl(client: GoogleClient, state: string): string {
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SHEETS_SCOPE,
    state,
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Parse what Google sent back to oauth.html. */
export function tokensFromRedirect(hash: string, expectedState: string, now = Date.now()): GoogleTokens | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (p.get('state') !== expectedState) return null;
  if (p.get('error')) throw new UserError(p.get('error') === 'access_denied' ? 'Google access was not allowed.' : `Google sign-in failed: ${p.get('error')}.`);
  const token = p.get('access_token');
  if (!token) throw new UserError('Google did not complete the sign-in.');
  const scope = p.get('scope') ?? SHEETS_SCOPE;
  if (!scope.split(' ').includes(SHEETS_SCOPE)) throw new UserError('Google sign-in did not include access to spreadsheets created by Geranium. Please allow it and try again.');
  return { accessToken: token, refreshToken: null, expiresAt: now + (Number(p.get('expires_in')) || 3600) * 1000, scope };
}

export async function signIn(client: GoogleClient, openBrowser: (url: string) => Promise<void>, timeoutMs = 5 * 60 * 1000): Promise<GoogleTokens> {
  if (!client.clientId) throw new UserError('Google Sheets is not set up for this website.');
  const state = randomState();
  const channel = new BroadcastChannel('geranium-oauth');
  try {
    const result = new Promise<GoogleTokens>((resolve, reject) => {
      const timer = setTimeout(() => reject(new UserError('Google sign-in timed out. Please try again.')), timeoutMs);
      channel.onmessage = (e: MessageEvent<{ hash?: string }>) => {
        try {
          const tokens = tokensFromRedirect(String(e.data?.hash ?? ''), state);
          if (!tokens) return; // a different sign-in
          clearTimeout(timer);
          resolve(tokens);
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      };
    });
    await openBrowser(authUrl(client, state));
    return await result;
  } finally {
    channel.close();
  }
}

export async function validAccessToken(_client: GoogleClient, tokens: GoogleTokens): Promise<GoogleTokens> {
  if (tokens.expiresAt - 60_000 > Date.now()) return tokens;
  throw new UserError('Google access has expired (it lasts about an hour in the browser). Connect Google Sheets again.');
}

export async function revoke(tokens: GoogleTokens): Promise<void> {
  await guardedFetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    purpose: 'Disconnect Google',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: tokens.accessToken }),
  }).catch(() => undefined);
}
