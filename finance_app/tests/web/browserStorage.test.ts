import { describe, expect, it, vi } from 'vitest';

// Run the real storage code on the browser build's shims, exactly as the website does.
vi.mock('node:fs', async () => await import('../../src/web/shims/fs'));
vi.mock('node:crypto', async () => await import('../../src/web/shims/crypto'));
vi.mock('node:path', async () => await import('../../src/web/shims/path'));

describe('storage on the browser shims', () => {
  it('sets up, saves, locks, unlocks, backs up and restores with the browser file system and crypto', async () => {
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const { createRequire } = await vi.importActual<typeof import('node:module')>('node:module');
    const initSqlJs = (await import('sql.js')).default;
    const { setSqlLoader } = await import('@main/db/database');
    const wasm = realFs.readFileSync(createRequire(`${process.cwd()}/`).resolve('sql.js/dist/sql-wasm.wasm'));
    setSqlLoader(() => initSqlJs({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer }));

    const { vfs } = await import('../../src/web/vfs');
    const { AppState } = await import('@main/app/state');
    const { unavailableProtector } = await import('@main/crypto/keyStore');
    const core = await import('@main/services/core');

    const state = new AppState('/vault', unavailableProtector(), '0.2.0', undefined, 2 ** 10);
    expect(state.status().osStoreAvailable).toBe(false);
    await expect(state.initialise()).rejects.toThrow(/password/i); // no OS keychain in a browser
    await state.initialise({ secret: 'a long test password', kind: 'password' });
    core.saveAccount(state.requireCtx(), { name: 'Everyday', type: 'transaction' });
    state.lock();

    const stored = vfs.read('/vault/geranium.db')!;
    expect(new TextDecoder().decode(stored.slice(0, 4))).toBe('PBDB');
    expect(new TextDecoder('latin1').decode(stored)).not.toContain('SQLite format');
    expect(new TextDecoder().decode(vfs.read('/vault/keystore.json')!)).not.toContain('a long test password');

    await expect(state.unlock('wrong password!')).rejects.toThrow();
    await state.unlock('a long test password');
    expect(core.listAccounts(state.requireCtx()).map((a) => a.name)).toEqual(['Everyday']);

    const { createBackup, openBackup } = await import('@main/services/backup');
    const { bytes } = await createBackup(state.requireCtx().db, null, 'backup password 1', '0.2.0', 2 ** 10);
    const restored = await openBackup(bytes, 'backup password 1');
    expect(restored.manifest.appVersion).toBe('0.2.0');
    state.lock();
  });
});
