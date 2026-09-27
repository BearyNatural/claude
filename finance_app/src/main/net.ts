/**
 * The only way the main process talks to the network. Paperbark makes no network requests
 * of its own; this exists solely for Google Sheets export, which the user starts.
 * Requests are limited to Google's OAuth and Sheets endpoints and each one is recorded
 * (time, host, purpose, status — never content) so the Privacy screen can show them.
 */

const ALLOWED_HOSTS = new Set(['oauth2.googleapis.com', 'sheets.googleapis.com', 'www.googleapis.com']);

export interface NetworkLogEntry {
  at: string;
  host: string;
  method: string;
  purpose: string;
  status: number | 'failed';
}

const log: NetworkLogEntry[] = [];

export function networkLog(): NetworkLogEntry[] {
  return [...log];
}

export class NetworkBlockedError extends Error {}

export async function guardedFetch(url: string, init: RequestInit & { purpose: string }): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new NetworkBlockedError(`Blocked a request to ${u.hostname}: Paperbark only contacts Google when you export to Google Sheets.`);
  }
  const entry: NetworkLogEntry = { at: new Date().toISOString(), host: u.hostname, method: init.method ?? 'GET', purpose: init.purpose, status: 'failed' };
  log.push(entry);
  if (log.length > 500) log.shift();
  const { purpose: _purpose, ...rest } = init;
  void _purpose;
  const res = await fetch(url, { ...rest, redirect: 'error' });
  entry.status = res.status;
  return res;
}
