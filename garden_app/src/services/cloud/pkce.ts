/** PKCE (sign-in without a client secret): a random verifier and its SHA-256 challenge, base64url-encoded. */
import * as Crypto from 'expo-crypto';

const toBase64Url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function randomToken(bytes = 32): string {
  return toBase64Url(bytesToBase64(Crypto.getRandomBytes(bytes)));
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  return { verifier, challenge: toBase64Url(digest) };
}
