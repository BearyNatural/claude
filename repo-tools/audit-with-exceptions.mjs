#!/usr/bin/env node
// npm audit (production dependencies, high and critical) that honours the
// project's own narrow, time-limited exceptions — the same [[IgnoredVulns]]
// list OSV-Scanner reads from <project>/osv-scanner.toml. Each exception needs
// an advisory id, a reason and an expiry (ignoreUntil); expired ones count again.
// Anything not listed still fails the check.
// Run from the project folder: node ../repo-tools/audit-with-exceptions.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const now = Date.now();
const allowed = new Map();
if (existsSync('osv-scanner.toml')) {
  for (const block of readFileSync('osv-scanner.toml', 'utf8').split('[[IgnoredVulns]]').slice(1)) {
    const id = block.match(/^\s*id\s*=\s*"([^"]+)"/m)?.[1];
    const until = block.match(/^\s*ignoreUntil\s*=\s*(\S+)/m)?.[1];
    const reason = block.match(/^\s*reason\s*=\s*"([^"]+)"/m)?.[1];
    if (!id || !until || !reason) continue; // must be explained and time-limited
    if (Date.parse(until) > now) allowed.set(id, { until, reason });
  }
}

let out;
try {
  out = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  out = e.stdout; // npm audit exits non-zero when it finds anything
}
const report = JSON.parse(out);
const advisories = new Map();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via === 'object' && ['high', 'critical'].includes(via.severity)) {
      const id = String(via.url ?? '').split('/').pop();
      advisories.set(id, `${via.severity} · ${via.name} · ${via.title} (${via.url})`);
    }
  }
}
let failed = 0;
for (const [id, text] of advisories) {
  const ex = allowed.get(id);
  if (ex) console.log(`allowed until ${ex.until}: ${text}\n  reason: ${ex.reason}`);
  else {
    console.log(`NOT ALLOWED: ${text}`);
    failed++;
  }
}
console.log(failed ? `${failed} high/critical advisor${failed === 1 ? 'y' : 'ies'} without an exception.` : 'No high/critical advisories without an exception.');
process.exit(failed ? 1 : 0);
