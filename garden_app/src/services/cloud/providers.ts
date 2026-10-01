/**
 * Dropbox and Google Drive: sign-in addresses, tokens, and reading/writing the
 * one sync file. Plain fetch calls, so the same code runs in the app and the
 * browser. Dropbox keeps the file in its "Apps/Sow by Season Garden" folder;
 * Google Drive only lets the app see files it created itself (drive.file).
 */
import { CLOUD, GOOGLE_APP_REDIRECT, SYNC_FILE, type CloudProviderId } from './config';

export interface CloudTokens {
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
  /** Absent for Google in the browser, which signs in again (one click) when it expires. */
  refreshToken?: string;
}

export interface CloudConnection {
  provider: CloudProviderId;
  tokens: CloudTokens;
  /** Google Drive file id of the sync file, once known. */
  fileId?: string;
}

export type CloudFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** The provider no longer accepts the sign-in (expired or disconnected) — the gardener needs to connect again. */
export class CloudAuthError extends Error {}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

export function authUrl(provider: CloudProviderId, o: { web: boolean; redirect: string; state: string; challenge?: string }): string {
  if (provider === 'dropbox') {
    return `https://www.dropbox.com/oauth2/authorize?${form({
      client_id: CLOUD.dropbox.appKey,
      response_type: 'code',
      redirect_uri: o.redirect,
      state: o.state,
      code_challenge: o.challenge ?? '',
      code_challenge_method: 'S256',
      token_access_type: 'offline',
    })}`;
  }
  // Google: the browser gets a short-lived access token directly (web clients can't use PKCE without a secret);
  // the app uses PKCE with its Android client and gets a refresh token.
  return `https://accounts.google.com/o/oauth2/v2/auth?${form(
    o.web
      ? { client_id: CLOUD.google.webClientId, response_type: 'token', redirect_uri: o.redirect, scope: GOOGLE_SCOPE, state: o.state, include_granted_scopes: 'true' }
      : { client_id: CLOUD.google.androidClientId, response_type: 'code', redirect_uri: GOOGLE_APP_REDIRECT, scope: GOOGLE_SCOPE, state: o.state, code_challenge: o.challenge ?? '', code_challenge_method: 'S256' },
  )}`;
}

function tokensFrom(json: unknown, previousRefresh?: string): CloudTokens {
  const j = json as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown };
  if (typeof j?.access_token !== 'string') throw new Error('The sign-in response had no access token.');
  const secs = typeof j.expires_in === 'number' ? j.expires_in : Number(j.expires_in) || 3600;
  return { accessToken: j.access_token, expiresAt: Date.now() + (secs - 60) * 1000, refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : previousRefresh };
}

const TOKEN_URL: Record<CloudProviderId, string> = { dropbox: 'https://api.dropboxapi.com/oauth2/token', google: 'https://oauth2.googleapis.com/token' };
const NATIVE_CLIENT: Record<CloudProviderId, string> = { dropbox: CLOUD.dropbox.appKey, google: CLOUD.google.androidClientId };

/** Swap the code from sign-in for tokens (PKCE: no client secret). */
export async function exchangeCode(provider: CloudProviderId, code: string, verifier: string, redirect: string, fetchImpl: CloudFetch): Promise<CloudTokens> {
  const res = await fetchImpl(TOKEN_URL[provider], {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ code, grant_type: 'authorization_code', client_id: NATIVE_CLIENT[provider], code_verifier: verifier, redirect_uri: provider === 'google' ? GOOGLE_APP_REDIRECT : redirect }),
  });
  if (!res.ok) throw new Error(`Sign-in couldn't be completed (${res.status}).`);
  return tokensFrom(await res.json());
}

/** A usable access token, refreshing it if it has expired. */
export async function freshTokens(conn: CloudConnection, fetchImpl: CloudFetch, now = Date.now()): Promise<CloudTokens> {
  if (conn.tokens.expiresAt > now) return conn.tokens;
  if (!conn.tokens.refreshToken) throw new CloudAuthError('Sign-in has expired.');
  const res = await fetchImpl(TOKEN_URL[conn.provider], {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'refresh_token', refresh_token: conn.tokens.refreshToken, client_id: NATIVE_CLIENT[conn.provider] }),
  });
  if (res.status === 400 || res.status === 401) throw new CloudAuthError('Sign-in has expired or was disconnected.');
  if (!res.ok) throw new Error(`Couldn't renew the sign-in (${res.status}).`);
  return tokensFrom(await res.json(), conn.tokens.refreshToken);
}

const auth = (t: CloudTokens) => ({ Authorization: `Bearer ${t.accessToken}` });
const authFail = (status: number) => {
  if (status === 401) throw new CloudAuthError('Sign-in has expired or was disconnected.');
};

/** Read the sync file. Returns null when there isn't one yet. */
export async function downloadSyncFile(conn: CloudConnection, t: CloudTokens, fetchImpl: CloudFetch): Promise<{ text: string; fileId?: string } | null> {
  if (conn.provider === 'dropbox') {
    const res = await fetchImpl('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { ...auth(t), 'Dropbox-API-Arg': JSON.stringify({ path: `/${SYNC_FILE}` }) },
    });
    authFail(res.status);
    if (res.status === 409) return null; // path/not_found
    if (!res.ok) throw new Error(`Dropbox didn't send the sync file (${res.status}).`);
    return { text: await res.text() };
  }
  const fileId = conn.fileId ?? (await findGoogleFile(t, fetchImpl));
  if (!fileId) return null;
  const res = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: auth(t) });
  authFail(res.status);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Google Drive didn't send the sync file (${res.status}).`);
  return { text: await res.text(), fileId };
}

/** Write (overwrite) the sync file. Returns the Google Drive file id, when there is one. */
export async function uploadSyncFile(conn: CloudConnection, t: CloudTokens, text: string, fetchImpl: CloudFetch): Promise<string | undefined> {
  if (conn.provider === 'dropbox') {
    const res = await fetchImpl('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: { ...auth(t), 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: `/${SYNC_FILE}`, mode: 'overwrite', mute: true }) },
      body: text,
    });
    authFail(res.status);
    if (!res.ok) throw new Error(`Dropbox didn't accept the sync file (${res.status}).`);
    return undefined;
  }
  const existing = conn.fileId ?? (await findGoogleFile(t, fetchImpl));
  if (existing) {
    const res = await fetchImpl(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing)}?uploadType=media`, {
      method: 'PATCH',
      headers: { ...auth(t), 'Content-Type': 'application/json' },
      body: text,
    });
    authFail(res.status);
    if (res.ok) return existing;
    if (res.status !== 404) throw new Error(`Google Drive didn't accept the sync file (${res.status}).`);
  }
  const boundary = `sbs${Date.now()}`;
  const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ name: SYNC_FILE, mimeType: 'application/json' }), `--${boundary}`, 'Content-Type: application/json', '', text, `--${boundary}--`, ''].join('\r\n');
  const res = await fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { ...auth(t), 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  authFail(res.status);
  if (!res.ok) throw new Error(`Google Drive didn't accept the sync file (${res.status}).`);
  const json = (await res.json()) as { id?: unknown };
  return typeof json.id === 'string' ? json.id : undefined;
}

async function findGoogleFile(t: CloudTokens, fetchImpl: CloudFetch): Promise<string | undefined> {
  const q = encodeURIComponent(`name = '${SYNC_FILE}' and trashed = false`);
  const res = await fetchImpl(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime%20desc&fields=files(id)`, { headers: auth(t) });
  authFail(res.status);
  if (!res.ok) throw new Error(`Google Drive couldn't be searched (${res.status}).`);
  const json = (await res.json()) as { files?: { id?: unknown }[] };
  const id = json.files?.[0]?.id;
  return typeof id === 'string' ? id : undefined;
}
