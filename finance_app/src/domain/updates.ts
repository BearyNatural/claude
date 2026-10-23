/**
 * "A new version of Geranium is available." The desktop app reads the public list of
 * Geranium releases on GitHub; the browser version reads the small version.json published
 * with the website. Only a well-formed, newer release is offered, and only links to
 * Geranium's own release and download pages are accepted.
 */

export interface LatestRelease {
  version: string;
  /** Where to get it: the download page (desktop) or the website itself (browser). */
  url: string;
  /** The release's own page (release notes and files), when known. */
  releaseUrl: string | null;
  publishedAt: string | null;
  /** "What's new" for this version, as plain text (Markdown-style lines). */
  notes: string | null;
}

export type DesktopPlatform = 'linux' | 'win' | 'mac';

export const DOWNLOAD_PAGE = 'https://daydreaminginthecloud.bearynatural.dev/geranium/download.html';
export const RELEASES_API = 'https://api.github.com/repos/BearyNatural/claude/releases?per_page=50';
export const CHANGELOG_URL = 'https://github.com/BearyNatural/claude/blob/main/finance_app/CHANGELOG.md';

const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;
const TAG = /^finance_app-v(\d{1,3}\.\d{1,3}\.\d{1,4})-build\d+$/;
const RELEASE_PAGE = /^https:\/\/github\.com\/BearyNatural\/claude\/releases\/tag\/finance_app-v[\w.-]+$/;
const ASSET: Record<DesktopPlatform, RegExp> = { linux: /\.(deb|AppImage)$/i, win: /\.exe$/i, mac: /\.dmg$/i };
const MAX_NOTES = 3000;

/** Compare "0.10.2"-style versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const cleanNotes = (s: string | null | undefined): string | null => {
  const t = (s ?? '').replace(/\r/g, '').trim();
  return t ? t.slice(0, MAX_NOTES) : null;
};

/** The "## What's new in …" section of a release description. */
export function notesFromReleaseBody(body: string): string | null {
  const m = body.replace(/\r/g, '').match(/^## What[’']s new[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  return cleanNotes(m?.[1]);
}

/** The section for one version from CHANGELOG.md ("## 0.8.0 — 23 October 2026"). */
export function changelogSection(changelog: string, version: string): string | null {
  const hit = changelog.replace(/\r/g, '').split(/^(?=## )/m).find((x) => x.startsWith(`## ${version} `) || x.startsWith(`## ${version}\n`));
  return cleanNotes(hit?.replace(/^## [^\n]*\n/, ''));
}

/**
 * The newest Geranium release on GitHub that has a download for this computer's system.
 * The repository also holds other projects' releases; those are ignored.
 */
export function latestFromReleases(json: unknown, platform: DesktopPlatform): LatestRelease | null {
  if (!Array.isArray(json)) return null;
  let best: LatestRelease | null = null;
  for (const r of json as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || r.draft) continue;
    const m = typeof r.tag_name === 'string' ? r.tag_name.match(TAG) : null;
    if (!m) continue;
    const assets = Array.isArray(r.assets) ? (r.assets as Record<string, unknown>[]) : [];
    if (!assets.some((a) => typeof a?.name === 'string' && ASSET[platform].test(a.name))) continue;
    const version = m[1];
    if (best && compareVersions(version, best.version) <= 0) continue;
    const page = typeof r.html_url === 'string' && RELEASE_PAGE.test(r.html_url) ? r.html_url : null;
    best = {
      version,
      url: DOWNLOAD_PAGE,
      releaseUrl: page,
      publishedAt: typeof r.published_at === 'string' ? r.published_at.slice(0, 40) : null,
      notes: typeof r.body === 'string' ? notesFromReleaseBody(r.body) : null,
    };
  }
  return best;
}

/** The website's version.json, for the browser version (its "download" is a reload). */
export function latestFromVersionFile(json: unknown, siteUrl: string): LatestRelease | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (typeof o.version !== 'string' || !VERSION.test(o.version)) return null;
  return {
    version: o.version,
    url: siteUrl,
    releaseUrl: null,
    publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt.slice(0, 40) : null,
    notes: typeof o.notes === 'string' ? cleanNotes(o.notes) : null,
  };
}

/** A release is only offered when it is newer than the running version. */
export function newerThan(latest: LatestRelease | null, current: string): LatestRelease | null {
  return latest && VERSION.test(current) && compareVersions(latest.version, current) > 0 ? latest : null;
}
