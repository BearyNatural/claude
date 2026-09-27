import { createServer, Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { guardedFetch } from '../net';

/**
 * Google sign-in for Sheets export, using the installed-app flow (RFC 8252): the system browser
 * opens Google's consent page and Google redirects to a temporary server on 127.0.0.1.
 * PKCE protects the exchange. Only the "drive.file" scope is requested — it lets Paperbark create
 * spreadsheets and edit only the files Paperbark itself created. No other Google data is accessible.
 */

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface GoogleClient {
  clientId: string;
  clientSecret: string | null;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export function authUrl(client: GoogleClient, redirectUri: string, challenge: string, state: string): string {
  const p = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SHEETS_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

const PAGE = (msg: string) => `<!doctype html><meta charset="utf-8"><title>Paperbark</title><body style="font-family:system-ui;padding:3rem;max-width:36rem"><h1>Paperbark</h1><p>${msg}</p><p>You can close this browser tab and return to Paperbark.</p></body>`;

/** Run the consent flow. `openBrowser` opens the URL in the user's default browser. */
export async function signIn(client: GoogleClient, openBrowser: (url: string) => Promise<void>, timeoutMs = 5 * 60 * 1000): Promise<GoogleTokens> {
  if (!client.clientId) throw new Error('Enter a Google OAuth client ID first (see Settings → Google Sheets).');
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(16));
  let server: Server | null = null;
  try {
    const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get('error');
        if (err) {
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE('Google sign-in was cancelled.'));
          reject(new Error('Google sign-in was cancelled.'));
          return;
        }
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(PAGE('This sign-in response did not match. Please try again from Paperbark.'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE('Google Sheets is now connected.'));
        const port = (server!.address() as AddressInfo).port;
        resolve({ code: url.searchParams.get('code') ?? '', redirectUri: `http://127.0.0.1:${port}` });
      });
      server.listen(0, '127.0.0.1', () => {
        const port = (server!.address() as AddressInfo).port;
        openBrowser(authUrl(client, `http://127.0.0.1:${port}`, challenge, state)).catch(reject);
      });
      setTimeout(() => reject(new Error('Google sign-in timed out.')), timeoutMs).unref();
    });
    return await exchange(client, { grant_type: 'authorization_code', code: code.code, redirect_uri: code.redirectUri, code_verifier: verifier });
  } finally {
    (server as Server | null)?.close();
  }
}

async function exchange(client: GoogleClient, params: Record<string, string>): Promise<GoogleTokens> {
  const body = new URLSearchParams({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), ...params });
  const res = await guardedFetch('https://oauth2.googleapis.com/token', { method: 'POST', purpose: params.grant_type === 'refresh_token' ? 'Refresh Google access' : 'Complete Google sign-in', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google sign-in failed${json.error_description ? `: ${json.error_description}` : ''}.`);
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? params.refresh_token ?? null, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000, scope: json.scope ?? SHEETS_SCOPE };
}

export async function validAccessToken(client: GoogleClient, tokens: GoogleTokens): Promise<GoogleTokens> {
  if (tokens.expiresAt - 60_000 > Date.now()) return tokens;
  if (!tokens.refreshToken) throw new Error('Google access has expired. Connect Google Sheets again.');
  return exchange(client, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
}

export async function revoke(tokens: GoogleTokens): Promise<void> {
  const token = tokens.refreshToken ?? tokens.accessToken;
  await guardedFetch('https://oauth2.googleapis.com/revoke', { method: 'POST', purpose: 'Disconnect Google', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => undefined);
}
