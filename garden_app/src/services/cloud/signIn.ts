/**
 * Phone app sign-in: opens the provider's page in a browser sheet and returns
 * to the app through its link (PKCE, so no secret is ever in the app).
 */
import * as WebBrowser from 'expo-web-browser';
import { APP_REDIRECT, GOOGLE_APP_REDIRECT, type CloudProviderId } from './config';
import { pkcePair, randomToken } from './pkce';
import { authUrl, exchangeCode, type CloudFetch, type CloudTokens } from './providers';

/** Sign in and return tokens, or null if the gardener closed the page. */
export async function signIn(provider: CloudProviderId, fetchImpl: CloudFetch): Promise<CloudTokens | null> {
  const { verifier, challenge } = await pkcePair();
  const state = randomToken(16);
  const redirect = provider === 'google' ? GOOGLE_APP_REDIRECT : APP_REDIRECT;
  const result = await WebBrowser.openAuthSessionAsync(authUrl(provider, { web: false, redirect, state, challenge }), redirect);
  if (result.type !== 'success') return null;
  const params = new URL(result.url.replace(/^[a-z.0-9-]+:\/*/i, 'https://x/')).searchParams;
  if (params.get('state') !== state) throw new Error('Sign-in was interrupted. Please try again.');
  const code = params.get('code');
  if (!code) throw new Error(params.get('error_description') ?? 'Sign-in was cancelled.');
  return exchangeCode(provider, code, verifier, redirect, fetchImpl);
}

/** Browser-only step; nothing to finish in the app. */
export async function finishWebSignIn(_fetchImpl: CloudFetch): Promise<{ provider: CloudProviderId; tokens: CloudTokens } | null> {
  return null;
}
