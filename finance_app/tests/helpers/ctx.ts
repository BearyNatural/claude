import { AppDatabase } from '@main/db/database';
import { migrate } from '@main/db/schema';
import { Ctx, makeCtx, seedDefaults } from '@main/services/core';

/** A fresh in-memory database with the schema and defaults, and a fixed "today". */
export async function testCtx(today = '2026-09-27'): Promise<Ctx> {
  const db = await AppDatabase.openMemory();
  migrate(db);
  const ctx = makeCtx(db, { today: () => today });
  seedDefaults(ctx);
  return ctx;
}

export const enc = (s: string) => new TextEncoder().encode(s);
