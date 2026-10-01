/**
 * Browser sign-in: the page goes to the provider and comes back through
 * auth.html, which hands the result to the app on its next load.
 */
import { type CloudProviderId, WEB_REDIRECT } from './config';
import { pkcePair, randomToken } from './pkce';
import { authUrl, exchangeCode, type CloudFetch, type CloudTokens } from './providers';

const PENDING = 'sbs:local:pendingSignIn';
const RESULT = 'sbs:auth:result'; // written by public/auth.html

/** Leaves the page for the provider's sign-in; finishWebSignIn() completes it when the app opens again. */
export async function signIn(provider: CloudProviderId, _fetchImpl: CloudFetch): Promise<CloudTokens | null> {
  const { verifier, challenge } = await pkcePair();
  const state = randomToken(16);
  localStorage.setItem(PENDING, JSON.stringify({ provider, verifier, state, at: Date.now() }));
  window.location.assign(authUrl(provider, { web: true, redirect: WEB_REDIRECT, state, challenge }));
  return null;
}

/** After returning from sign-in: the provider and its tokens, or null if there's nothing to finish. */
export async function finishWebSignIn(fetchImpl: CloudFetch): Promise<{ provider: CloudProviderId; tokens: CloudTokens } | null> {
  let pending: { provider: CloudProviderId; verifier: string; state: string; at: number } | null = null;
  let result: { search: string; hash: string } | null = null;
  try {
    pending = JSON.parse(localStorage.getItem(PENDING) ?? 'null');
    result = JSON.parse(localStorage.getItem(RESULT) ?? 'null');
  } catch {
    // fall through
  }
  localStorage.removeItem(RESULT);
  if (!pending || !result) return null;
  localStorage.removeItem(PENDING);
  if (Date.now() - pending.at > 15 * 60_000) throw new Error('Sign-in took too long. Please try again.');
  const params = new URLSearchParams(result.hash.replace(/^#/, '') || result.search.replace(/^\?/, ''));
  if (params.get('state') !== pending.state) throw new Error('Sign-in was interrupted. Please try again.');
  if (params.get('error')) throw new Error(params.get('error_description') ?? 'Sign-in was cancelled.');
  if (pending.provider === 'google') {
    const token = params.get('access_token');
    if (!token) throw new Error('Google didn\'t complete the sign-in.');
    const secs = Number(params.get('expires_in')) || 3600;
    return { provider: 'google', tokens: { accessToken: token, expiresAt: Date.now() + (secs - 60) * 1000 } };
  }
  const code = params.get('code');
  if (!code) throw new Error('Dropbox didn\'t complete the sign-in.');
  // Dropbox's browser sign-in uses the same app key with PKCE.
  return { provider: 'dropbox', tokens: await exchangeCode('dropbox', code, pending.verifier, WEB_REDIRECT, fetchImpl) };
}
