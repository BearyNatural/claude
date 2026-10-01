/**
 * Cloud sync controller: keeps this device's garden and the gardener's own
 * Dropbox or Google Drive copy in step, so the phone app and the browser show
 * the same garden. Each run downloads the sync file, merges it record by
 * record (domain/sync.ts), saves the result here, and uploads it if the other
 * copy was missing anything. Photos stay on the device that took them.
 *
 * The connection (tokens) is kept on this device only. When it runs:
 * cloudSyncHooks.ts.
 */
import { CATALOGUE_VERSION } from '../data/plants';
import { createBackup, serialiseBackup } from '../domain/backup/format';
import { parseBackup } from '../domain/backup/restore';
import { mergeGardenData } from '../domain/sync';
import type { CloudProviderId } from '../services/cloud/config';
import { CloudAuthError, downloadSyncFile, freshTokens, uploadSyncFile, type CloudConnection, type CloudFetch, type CloudTokens } from '../services/cloud/providers';
import { ENV } from '../services/env';
import type { KeyValueStore } from '../services/storage/keyValueStore';
import type { GardenStore } from './gardenStore';

const KEY = 'sbs:local:cloudSync';

/** Sign-in steps (services/cloud/signIn), passed in so the controller can be tested without a phone. */
export interface CloudSignIn {
  signIn(provider: CloudProviderId, fetchImpl: CloudFetch): Promise<CloudTokens | null>;
  finishWebSignIn(fetchImpl: CloudFetch): Promise<{ provider: CloudProviderId; tokens: CloudTokens } | null>;
}

export interface CloudSyncState {
  connection: CloudConnection | null;
  lastSyncAt?: string;
  lastError?: string;
  /** The provider wants the gardener to sign in again. */
  needsReconnect?: boolean;
  /** What the last sync brought in, for a short message. */
  lastResult?: string;
  busy: boolean;
}

export class CloudSyncController {
  private listeners = new Set<() => void>();
  private loaded = false;
  private again = false;
  state: CloudSyncState = { connection: null, busy: false };

  constructor(private garden: GardenStore, private local: KeyValueStore, private fetchImpl: CloudFetch, private auth: CloudSignIn) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  private patch(p: Partial<CloudSyncState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }
  private async persist() {
    const { busy: _b, ...rest } = this.state;
    await this.local.setItem(KEY, JSON.stringify(rest)).catch(() => undefined);
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await this.local.getItem(KEY);
      if (raw) this.patch({ ...(JSON.parse(raw) as CloudSyncState), busy: false });
    } catch {
      // start disconnected
    }
    // Back from a browser sign-in?
    try {
      const done = await this.auth.finishWebSignIn(this.fetchImpl);
      if (done) {
        this.patch({ connection: { provider: done.provider, tokens: done.tokens, fileId: this.state.connection?.provider === done.provider ? this.state.connection.fileId : undefined }, needsReconnect: false, lastError: undefined });
        await this.persist();
      }
    } catch (e) {
      this.patch({ lastError: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Sign in to a provider (in the browser this leaves the page and comes back). */
  async connect(provider: CloudProviderId) {
    try {
      const tokens = await this.auth.signIn(provider, this.fetchImpl);
      if (!tokens) return;
      this.patch({ connection: { provider, tokens }, needsReconnect: false, lastError: undefined, lastResult: undefined });
      await this.persist();
      await this.run();
    } catch (e) {
      this.patch({ lastError: e instanceof Error ? e.message : String(e) });
    }
  }

  async disconnect() {
    this.state = { connection: null, busy: false };
    await this.local.removeItem(KEY).catch(() => undefined);
    this.listeners.forEach((l) => l());
  }

  async run(): Promise<void> {
    const conn = this.state.connection;
    if (!conn || this.state.needsReconnect || this.garden.state.status !== 'ready') return;
    if (this.state.busy) {
      this.again = true;
      return;
    }
    this.patch({ busy: true });
    try {
      const tokens = await freshTokens(conn, this.fetchImpl);
      const working: CloudConnection = { ...conn, tokens };
      const before = this.garden.exportData();
      const remote = await downloadSyncFile(working, tokens, this.fetchImpl);
      let merged = before;
      let upload = !remote;
      let result = remote ? 'Up to date.' : 'Saved your garden to the cloud.';
      if (remote) {
        const parsed = parseBackup(remote.text);
        if (!parsed.ok) throw new Error(`The sync file in your cloud storage couldn't be read (${parsed.message}).`);
        const m = mergeGardenData(before, parsed.data, new Date());
        merged = m.data;
        upload = m.summary.remoteNeedsUpdate;
        if (m.summary.fromRemote || m.summary.deletedHere) {
          // Something changed here while downloading: start again rather than lose it.
          if (this.garden.exportData() !== before) {
            this.again = true;
            return;
          }
          await this.garden.applySynced(merged);
          result = `Brought in ${m.summary.fromRemote + m.summary.deletedHere} change${m.summary.fromRemote + m.summary.deletedHere === 1 ? '' : 's'} from your other device.`;
        }
        if (remote.fileId) working.fileId = remote.fileId;
      }
      if (upload) {
        const text = serialiseBackup(createBackup(merged, { now: new Date(), appVersion: ENV.appVersion, catalogueVersion: CATALOGUE_VERSION }));
        const fileId = await uploadSyncFile(working, tokens, text, this.fetchImpl);
        if (fileId) working.fileId = fileId;
      }
      this.patch({ connection: working, lastSyncAt: new Date().toISOString(), lastError: undefined, lastResult: result });
    } catch (e) {
      if (e instanceof CloudAuthError) this.patch({ needsReconnect: true, lastError: undefined });
      else this.patch({ lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      this.patch({ busy: false });
      await this.persist();
      if (this.again) {
        this.again = false;
        setTimeout(() => void this.run(), 1000);
      }
    }
  }
}
