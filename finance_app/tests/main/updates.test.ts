import { describe, expect, it } from 'vitest';
import { testCtx } from '../helpers/ctx';
import { changelogSection, compareVersions, latestFromReleases, latestFromVersionFile, newerThan, notesFromReleaseBody, DOWNLOAD_PAGE } from '@domain/updates';
import { dismissUpdate, updateStatus, UpdateSource } from '@main/services/updates';
import { updateSettings } from '@main/services/core';

const release = (tag: string, assets: string[], extra: Record<string, unknown> = {}) => ({
  tag_name: tag, draft: false, prerelease: true, html_url: `https://github.com/BearyNatural/claude/releases/tag/${tag}`,
  published_at: '2026-10-20T01:02:03Z', assets: assets.map((name) => ({ name })),
  body: '**Project:** `finance_app`\n\n## What’s new in 0.8.0\n- **Update banner.** A thing.\n  - A detail.\n\n## Install\n- Windows…',
  ...extra,
});

describe('versions and releases', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.7.2', '0.7.2')).toBe(0);
    expect(compareVersions('0.7.2', '0.8.0')).toBeLessThan(0);
  });

  it('picks the newest Geranium release with a download for this system, ignoring other projects', () => {
    const list = [
      release('garden_app-v9.9.9-build99', ['app.apk']),
      release('finance_app-v0.9.0-build20', ['Geranium-0.9.0-win-x64.exe']), // no Linux files yet
      release('finance_app-v0.8.0-build14', ['Geranium-0.8.0-linux-amd64.deb', 'Geranium-0.8.0-win-x64.exe']),
      release('finance_app-v0.8.1-build15', ['Geranium-0.8.1-linux-amd64.deb'], { draft: true }),
      release('finance_app-v0.7.2-build12', ['Geranium-0.7.2-linux-amd64.deb']),
    ];
    const linux = latestFromReleases(list, 'linux');
    expect(linux).toMatchObject({ version: '0.8.0', url: DOWNLOAD_PAGE, releaseUrl: 'https://github.com/BearyNatural/claude/releases/tag/finance_app-v0.8.0-build14' });
    expect(linux?.notes).toBe('- **Update banner.** A thing.\n  - A detail.');
    expect(latestFromReleases(list, 'win')?.version).toBe('0.9.0');
    expect(latestFromReleases(list, 'mac')).toBeNull();
    expect(latestFromReleases({ message: 'rate limited' }, 'linux')).toBeNull();
  });

  it('does not trust links that are not Geranium release pages', () => {
    const r = latestFromReleases([release('finance_app-v0.8.0-build14', ['x.deb'], { html_url: 'https://example.com/evil' })], 'linux');
    expect(r?.releaseUrl).toBeNull();
    expect(r?.url).toBe(DOWNLOAD_PAGE);
  });

  it('reads the website version file and the change log', () => {
    expect(latestFromVersionFile({ version: '0.8.0', notes: '- New' }, 'https://example.test/geranium/')).toMatchObject({ version: '0.8.0', notes: '- New' });
    expect(latestFromVersionFile({ version: 'latest' }, 'x')).toBeNull();
    const log = '# Changelog\n\n## 0.8.0 — 23 October 2026\n\n- Banner\n\n## 0.7.0 — 12 October 2026\n\n- Older\n';
    expect(changelogSection(log, '0.8.0')).toBe('- Banner');
    expect(changelogSection(log, '0.7.1')).toBeNull();
    expect(notesFromReleaseBody('no notes here')).toBeNull();
  });

  it('only offers newer versions', () => {
    const r = latestFromVersionFile({ version: '0.8.0' }, 'x');
    expect(newerThan(r, '0.7.2')?.version).toBe('0.8.0');
    expect(newerThan(r, '0.8.0')).toBeNull();
    expect(newerThan(r, '0.9.0')).toBeNull();
  });
});

describe('checking for updates', () => {
  const source = (version: string | null, calls = { n: 0 }): UpdateSource => ({
    kind: 'download',
    async fetchLatest() { calls.n++; return version ? { version, url: DOWNLOAD_PAGE, releaseUrl: null, publishedAt: null, notes: null } : null; },
  });

  it('checks at most once a day, and the banner can be dismissed for one version', async () => {
    const ctx = await testCtx();
    const calls = { n: 0 };
    const first = await updateStatus(ctx, '0.7.2', source('0.8.0', calls));
    expect(first).toMatchObject({ current: '0.7.2', enabled: true, dismissed: false, latest: { version: '0.8.0' } });
    await updateStatus(ctx, '0.7.2', source('0.8.0', calls));
    expect(calls.n).toBe(1); // cached for the day
    dismissUpdate(ctx, '0.8.0');
    expect((await updateStatus(ctx, '0.7.2', source('0.8.0', calls))).dismissed).toBe(true);
    // A newer version shows the banner again.
    const next = await updateStatus(ctx, '0.7.2', source('0.8.1', calls), { force: true });
    expect(next).toMatchObject({ dismissed: false, latest: { version: '0.8.1' } });
    expect(calls.n).toBe(2);
  });

  it('does not look when switched off, unless asked to check now', async () => {
    const ctx = await testCtx();
    updateSettings(ctx, { updates: { check: false, dismissedVersion: null } });
    const calls = { n: 0 };
    expect(await updateStatus(ctx, '0.7.2', source('0.8.0', calls))).toMatchObject({ enabled: false, latest: null });
    expect(calls.n).toBe(0);
    expect((await updateStatus(ctx, '0.7.2', source('0.8.0', calls), { force: true })).latest?.version).toBe('0.8.0');
    expect(calls.n).toBe(1);
  });

  it('copes with the update service being unreachable', async () => {
    const ctx = await testCtx();
    const failing: UpdateSource = { kind: 'download', async fetchLatest() { throw new Error('offline'); } };
    expect(await updateStatus(ctx, '0.7.2', failing)).toMatchObject({ latest: null, error: expect.stringMatching(/could not reach/) });
  });
});
