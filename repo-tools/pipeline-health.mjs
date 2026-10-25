#!/usr/bin/env node
// Weekly pipeline health check (run by the weekly maintenance workflow).
//
// 1. Reads every workflow run in this repository from the past week (DAYS, default 7):
//    failed runs, and the warnings GitHub attached to their jobs (for example
//    "Node.js 20 is deprecated … actions/upload-artifact@v4"). A failure whose jobs all
//    passed in a later run of the same workflow (same branch) is reported as fixed since.
// 2. Looks at every action the workflows use (.github/workflows, repo-tools/github/workflows
//    and each project's ci/ copies) and finds ones that run on a deprecated Node.js runtime.
// 3. For those, picks the smallest newer major version that runs on Node.js 24 and, with
//    --apply, updates every workflow file that uses it (the projects' copies stay in sync).
// 4. Writes a Markdown report (--report <file>) and sets outputs for the workflow:
//    changed=true|false, fixes=<n>, problems=<n> (runs still failing + warnings that need a person).
//
// Needs GITHUB_TOKEN (actions: read, checks: read) and GITHUB_REPOSITORY. Only reads from
// GitHub; the only files it changes are workflow files, and only with --apply.
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.github.com';
const DEPRECATED = new Set(['node12', 'node16', 'node20']);
const CURRENT = /^node(2[4-9]|[3-9]\d)$/; // node24 and later

/* ------------------------------ pure helpers (exported for checking) ------------------------------ */

/** Action references with a major-version tag: "actions/upload-artifact@v4", "gradle/actions/setup-gradle@v5". */
export function parseUses(text) {
  const out = [];
  const re = /^\s*-?\s*uses:\s*["']?([\w.-]+\/[\w.-]+(?:\/[\w./-]+)?)@v(\d+)["']?\s*(?:#.*)?$/gm;
  for (const m of text.matchAll(re)) out.push({ action: m[1], major: Number(m[2]) });
  return out;
}

/** The actions named in a runtime deprecation warning. */
export function parseRuntimeWarning(message) {
  const m = message.match(/Node\.js (\d+) (?:actions )?(?:is|are) deprecated[\s\S]*?:\s*([^\n]+?)\.\s*(?:For more|$)/i);
  if (!m) return null;
  const refs = m[2].split(',').map((s) => s.trim()).map((s) => s.match(/^([\w.-]+\/[\w.-]+(?:\/[\w./-]+)?)@v(\d+)$/)).filter(Boolean);
  return { node: Number(m[1]), refs: refs.map((r) => ({ action: r[1], major: Number(r[2]) })) };
}

/** Replace "<action>@v<from>" with "<action>@v<to>" in a workflow file, leaving everything else alone. */
export function bumpInText(text, action, from, to) {
  const esc = action.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return text.replace(new RegExp(`(uses:\\s*["']?${esc}@)v${from}(?=["'\\s]|$)`, 'gm'), `$1v${to}`);
}

/* ------------------------------ GitHub ------------------------------ */

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const repo = process.env.GITHUB_REPOSITORY || '';

async function gh(path, accept = 'application/vnd.github+json') {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    headers: { Accept: accept, Authorization: token ? `Bearer ${token}` : '', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'pipeline-health' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return accept.includes('raw') ? res.text() : res.json();
}

const runtimeCache = new Map();
/** The runtime ("node20", "composite", "docker"…) of an action at a tag, or null if not found. */
async function runtimeOf(action, major) {
  const key = `${action}@v${major}`;
  if (runtimeCache.has(key)) return runtimeCache.get(key);
  const [owner, name, ...sub] = action.split('/');
  const dir = sub.length ? `${sub.join('/')}/` : '';
  let text = null;
  for (const file of ['action.yml', 'action.yaml']) {
    text = await gh(`/repos/${owner}/${name}/contents/${dir}${file}?ref=v${major}`, 'application/vnd.github.raw+json').catch(() => null);
    if (text) break;
  }
  const using = text?.match(/^\s*using:\s*["']?([\w-]+)["']?/m)?.[1] ?? null;
  runtimeCache.set(key, using);
  return using;
}

async function latestMajor(action) {
  const [owner, name] = action.split('/');
  const rel = await gh(`/repos/${owner}/${name}/releases/latest`).catch(() => null);
  const m = rel?.tag_name?.match(/^v?(\d+)/);
  return m ? Number(m[1]) : null;
}

/** The smallest newer major that runs on Node.js 24 or later. */
async function upgradeFor(action, major) {
  const latest = await latestMajor(action);
  if (!latest || latest <= major) return null;
  for (let m = major + 1; m <= latest; m++) {
    const using = await runtimeOf(action, m);
    if (using && CURRENT.test(using)) return { to: m, using };
  }
  return null;
}

/* ------------------------------ main ------------------------------ */

function workflowFiles() {
  const dirs = ['.github/workflows', 'repo-tools/github/workflows'];
  for (const d of readdirSync('.', { withFileTypes: true })) {
    if (d.isDirectory() && existsSync(join(d.name, 'project.json')) && existsSync(join(d.name, 'ci'))) dirs.push(join(d.name, 'ci'));
  }
  return dirs.filter((d) => existsSync(d)).flatMap((d) => readdirSync(d).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(d, f)));
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
  const days = Number(process.env.DAYS || 7);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set.');

  // 1. Last week's runs, their failures and warnings.
  const runs = [];
  for (let page = 1; page <= 10; page++) {
    const r = await gh(`/repos/${repo}/actions/runs?created=%3E%3D${since}&per_page=100&page=${page}`);
    runs.push(...(r?.workflow_runs ?? []));
    if (!r || r.workflow_runs.length < 100) break;
  }
  const self = process.env.GITHUB_RUN_ID;
  const checked = runs.filter((r) => String(r.id) !== self && r.status === 'completed');
  const failed = [];
  const warnings = new Map(); // message → { count, example }
  const latest = new Map(); // workflow · branch · job → its newest result
  const jobKey = (run, job) => `${run.workflow_id}|${run.head_branch}|${job.name}`;
  for (const run of checked) {
    const jobs = (await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`))?.jobs ?? [];
    for (const job of jobs) {
      if (!['success', 'failure', 'timed_out'].includes(job.conclusion)) continue;
      const prev = latest.get(jobKey(run, job));
      if (!prev || prev.at < run.created_at) latest.set(jobKey(run, job), { at: run.created_at, ok: job.conclusion === 'success' });
    }
    if (run.conclusion === 'failure') {
      const bad = jobs.filter((j) => j.conclusion === 'failure');
      failed.push({ name: run.name, at: run.created_at, url: run.html_url, keys: bad.map((j) => jobKey(run, j)), jobs: bad.map((j) => `${j.name}${j.steps?.some((s) => s.conclusion === 'failure') ? ` (${j.steps.filter((s) => s.conclusion === 'failure').map((s) => s.name).join(', ')})` : ''}`) });
    }
    for (const job of jobs) {
      const notes = (await gh(`/repos/${repo}/check-runs/${job.id}/annotations`).catch(() => [])) ?? [];
      for (const a of notes) {
        if (a.annotation_level !== 'warning') continue;
        const msg = String(a.message).replace(/\s+/g, ' ').trim();
        const w = warnings.get(msg) ?? { count: 0, example: `${run.name} — ${run.html_url}` };
        w.count++;
        warnings.set(msg, w);
      }
    }
  }
  // A failure is fixed once every job that failed has passed in a later run of the same
  // workflow on the same branch. Those are reported but need nobody.
  const open = failed.filter((f) => !f.keys.length || !f.keys.every((k) => latest.get(k)?.ok));
  const fixedSince = failed.filter((f) => !open.includes(f));

  // 2. Actions on a deprecated runtime: from the warnings and from the workflow files themselves.
  const files = workflowFiles();
  const used = new Map();
  for (const f of files) for (const u of parseUses(readFileSync(f, 'utf8'))) used.set(`${u.action}@v${u.major}`, u);
  const flagged = new Map();
  for (const msg of warnings.keys()) for (const r of parseRuntimeWarning(msg)?.refs ?? []) flagged.set(`${r.action}@v${r.major}`, r);
  for (const [key, u] of used) {
    if (flagged.has(key)) continue;
    const using = await runtimeOf(u.action, u.major);
    if (using && DEPRECATED.has(using)) flagged.set(key, u);
  }

  // 3. Fixes.
  const fixes = [];
  const stuck = [];
  for (const [key, u] of flagged) {
    if (!used.has(key)) continue; // no longer used anywhere
    const up = await upgradeFor(u.action, u.major);
    if (up) fixes.push({ ...u, ...up });
    else stuck.push(`${key}: no newer version runs on Node.js 24 yet`);
  }
  let changed = false;
  if (apply && fixes.length) {
    for (const f of files) {
      const before = readFileSync(f, 'utf8');
      let after = before;
      for (const x of fixes) after = bumpInText(after, x.action, x.major, x.to);
      if (after !== before) { writeFileSync(f, after); changed = true; }
    }
  }

  // Warnings that are not runtime deprecations (or could not be fixed) need a person.
  // A runtime warning is dealt with when every action it names is being updated or is no longer used.
  const manual = [...warnings.entries()].filter(([msg]) => {
    const p = parseRuntimeWarning(msg);
    return !p || p.refs.some((r) => used.has(`${r.action}@v${r.major}`) && !fixes.some((x) => x.action === r.action && x.major === r.major));
  });

  // 4. Report.
  const lines = [`## Pipelines: past ${days} days`, '', `${checked.length} workflow run(s) checked, ${failed.length} failed${fixedSince.length ? ` (${fixedSince.length} fixed since)` : ''}, ${warnings.size} distinct warning(s).`, ''];
  const runLine = (f) => `- **${f.name}** (${f.at.slice(0, 16).replace('T', ' ')} UTC): ${f.jobs.join('; ') || 'see run'} — ${f.url}`;
  if (open.length) {
    lines.push('### Failed runs', '');
    for (const f of open) lines.push(runLine(f));
    lines.push('');
  }
  if (fixedSince.length) {
    lines.push('### Fixed since (a later run passed)', '');
    for (const f of fixedSince) lines.push(runLine(f));
    lines.push('');
  }
  if (fixes.length) {
    lines.push(`### Actions updated to run on Node.js 24${apply ? '' : ' (not applied: dry run)'}`, '', '| Action | From | To |', '|---|---|---|');
    for (const x of fixes) lines.push(`| \`${x.action}\` | v${x.major} | v${x.to} (${x.using}) |`);
    lines.push('');
  }
  if (manual.length || stuck.length) {
    lines.push('### Warnings that need a person', '');
    for (const [msg, w] of manual) lines.push(`- ${msg} (${w.count}×, e.g. ${w.example})`);
    for (const s of stuck) lines.push(`- ${s}`);
    lines.push('');
  }
  const dealtWith = [...warnings.entries()].filter((e) => !manual.includes(e));
  if (dealtWith.length) {
    lines.push('### Warnings already dealt with (the actions they name are updated or no longer used)', '');
    for (const [msg, w] of dealtWith) lines.push(`- ${msg} (${w.count}×)`);
    lines.push('');
  }
  if (!open.length && !fixes.length && !manual.length && !stuck.length) lines.push('Nothing needs a person. ✅', '');
  const report = lines.join('\n');
  console.log(report);
  if (reportPath) writeFileSync(reportPath, report);
  const problems = open.length + manual.length + stuck.length;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nfixes=${fixes.length}\nproblems=${problems}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`::error title=Pipeline health::${e.message}`); process.exit(1); });
}
