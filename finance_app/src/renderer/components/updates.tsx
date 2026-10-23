import { Fragment, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { api, IS_WEB, useAction, useApi } from '../lib/api';
import { useApp } from '../lib/app';
import { Badge, Callout, Card, Checkbox, Dialog, ErrorText, Icon } from './ui';
import { CHANGELOG_URL } from '@domain/updates';
import { formatDate } from '@domain/dates';
import type { ApiOutput } from '../../main/api';

/**
 * The version number and "a new version is available". The check runs at most once a day and
 * can be switched off in Settings › Preferences › About & updates; the banner can be closed and
 * stays closed until a newer version comes out.
 */

type Updates = ApiOutput<'app.updates'>;
type Latest = NonNullable<Updates['latest']>;

/** Release notes are Markdown-style lines; shown as text (bold and bullets only), never as HTML. */
function NotesText({ notes }: { notes: string }) {
  const inline = (s: string): ReactNode[] => s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part.replace(/`/g, '').replace(/\*([^*\n]+)\*/g, '$1')}</Fragment>));
  const lines = notes.split('\n').filter((l) => l.trim());
  return (
    <ul className="whats-new">
      {lines.map((l, i) => {
        const depth = (l.match(/^\s*/)?.[0].length ?? 0) >= 2 ? 1 : 0;
        const text = l.replace(/^\s*[-*]\s*/, '');
        return <li key={i} className={depth ? 'sub' : undefined}>{inline(text)}</li>;
      })}
    </ul>
  );
}

const reloadToUpdate = async (version: string) => {
  // Save first, then load the new version of the page (the query string skips any cached copy).
  try { await api('app.saveNow'); } catch { /* locked: nothing to save */ }
  window.location.replace(`${window.location.pathname}?v=${encodeURIComponent(version)}`);
};

function WhatsNew({ u, latest, onClose }: { u: Updates; latest: Latest; onClose: () => void }) {
  const open = (url: string) => api('app.openReleaseLink', { url }).catch(() => undefined);
  // Drawn at the top of the page: the banner sits below the content's layer.
  return createPortal(
    <Dialog title={`What’s new in Geranium ${latest.version}`} onClose={onClose} footer={(
      <>
        <button className="btn" onClick={onClose}>Close</button>
        {u.kind === 'reload'
          ? <button className="btn btn-primary" onClick={() => void reloadToUpdate(latest.version)}>Reload to update</button>
          : <button className="btn btn-primary" onClick={() => void open(latest.url)}><Icon name="download" size={16} /> Download</button>}
      </>
    )}>
      <p className="small muted">You have {u.current}.{latest.publishedAt ? ` Released ${formatDate(latest.publishedAt.slice(0, 10))}.` : ''}</p>
      {latest.notes ? <NotesText notes={latest.notes} /> : <p>Maintenance and dependency updates.</p>}
      <div className="row">
        {latest.releaseUrl && <button className="btn btn-sm btn-ghost" onClick={() => void open(latest.releaseUrl!)}>Release page</button>}
        <button className="btn btn-sm btn-ghost" onClick={() => void open(CHANGELOG_URL)}>Full change log</button>
      </div>
    </Dialog>,
    document.body,
  );
}

/** Shown above the top bar when a newer version is available and the banner hasn't been closed for it. */
export function UpdateBanner() {
  const { status } = useApp();
  const q = useApi('app.updates', undefined, [status?.unlocked], !!status?.unlocked && !status?.demo);
  const [notes, setNotes] = useState(false);
  const u = q.data;
  const latest = u?.latest;
  if (!u || !latest || u.dismissed || status?.demo) return null;
  return (
    <div className="update-banner" role="status">
      <span><Icon name="info" size={16} /> <strong>Geranium {latest.version} is available.</strong> You have {u.current}.{u.kind === 'reload' ? ' Reloading the page updates it — your data is kept.' : ''}</span>
      <span className="row">
        <button className="btn btn-sm btn-ghost" onClick={() => setNotes(true)}>What’s new</button>
        {u.kind === 'reload'
          ? <button className="btn btn-sm btn-primary" onClick={() => void reloadToUpdate(latest.version)}>Reload to update</button>
          : <button className="btn btn-sm btn-primary" onClick={() => void api('app.openReleaseLink', { url: latest.url })}>Download</button>}
        <button className="icon-btn" aria-label="Dismiss — remind me when there is a newer version" title="Dismiss" onClick={() => void api('app.dismissUpdate', { version: latest.version })}><Icon name="x" size={16} /></button>
      </span>
      {notes && <WhatsNew u={u} latest={latest} onClose={() => setNotes(false)} />}
    </div>
  );
}

/** "Geranium 0.8.0" at the foot of the sidebar, with a dot when a newer version is waiting. */
export function VersionTag({ onOpen }: { onOpen: () => void }) {
  const { status } = useApp();
  const q = useApi('app.updates', undefined, [status?.unlocked], !!status?.unlocked && !status?.demo);
  const newer = q.data?.latest;
  return (
    <button className="version-tag" onClick={onOpen} title="About Geranium and updates">
      Geranium {status?.appVersion ?? ''}{newer && <span className="version-dot" aria-label={`Version ${newer.version} is available`} />}
    </button>
  );
}

/** Settings › Preferences: the version, the update check switch, and "Check now". */
export function AboutUpdates() {
  const { settings, setSettings, status } = useApp();
  const q = useApi('app.updates', undefined, []);
  const [notes, setNotes] = useState(false);
  const check = useAction(async () => { await api('app.updates', { force: true }); q.reload(); });
  const u = q.data;
  if (!settings) return null;
  const where = IS_WEB ? 'the Geranium website' : 'GitHub, where Geranium’s releases are published';
  return (
    <Card title="About & updates" sub={`Geranium ${status?.appVersion ?? ''}${status?.demo ? ' · demo mode' : ''}`}>
      <div className="stack">
        <Checkbox label="Check for a new version once a day" checked={settings.updates.check}
          onChange={async (v) => setSettings(await api('settings.update', { updates: { ...settings.updates, check: v } }))}
          hint={`Asks ${where} for the latest version number. Nothing about you or your money is sent.${IS_WEB ? '' : ' Each check is listed in Privacy & security › Network log.'}`} />
        <div className="row">
          <button className="btn btn-sm" disabled={check.pending} onClick={() => check.run()}>{check.pending ? 'Checking…' : 'Check now'}</button>
          {u?.latest ? <Badge kind="info">Geranium {u.latest.version} is available</Badge> : u?.checkedAt && !u.error ? <Badge kind="ok">Up to date</Badge> : null}
          {u?.latest && <button className="btn btn-sm btn-ghost" onClick={() => setNotes(true)}>What’s new</button>}
        </div>
        {u?.checkedAt && <p className="small muted">Last checked {formatDate(u.checkedAt.slice(0, 10))}.</p>}
        {u?.error && <Callout kind="warn">{u.error}</Callout>}
        <ErrorText error={check.error} />
        <p className="small muted">{IS_WEB ? 'The website always has the newest version: reloading the page updates it, and your data stays in this browser.' : 'Updates are never installed by themselves. Download the new version and install it over this one — your data is kept.'}</p>
      </div>
      {notes && u?.latest && <WhatsNew u={u} latest={u.latest} onClose={() => setNotes(false)} />}
    </Card>
  );
}
