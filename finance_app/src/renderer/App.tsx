import { useCallback, useEffect, useRef, useState } from 'react';
import { api, clearShared, onDataChanged, useApi } from './lib/api';
import { Route, useApp } from './lib/app';
import { Icon } from './components/ui';
import { Setup, Unlock, Onboarding } from './screens/Setup';
import { Dashboard } from './screens/Dashboard';
import { Accounts } from './screens/Accounts';
import { Transactions } from './screens/Transactions';
import { ImportScreen } from './screens/Import';
import { Inbox } from './screens/Inbox';
import { Categories } from './screens/Categories';
import { Recurring } from './screens/Recurring';
import { Spending } from './screens/Spending';
import { Budgets } from './screens/Budgets';
import { Bills } from './screens/Bills';
import { CalendarScreen } from './screens/Calendar';
import { Goals } from './screens/Goals';
import { Forecast } from './screens/Forecast';
import { Loans } from './screens/Loans';
import { TermDeposits } from './screens/TermDeposits';
import { Calculators } from './screens/Calculators';
import { Income } from './screens/Income';
import { Tax } from './screens/Tax';
import { Investments } from './screens/Investments';
import { Super } from './screens/Super';
import { NetWorth } from './screens/NetWorth';
import { Reports } from './screens/Reports';
import { Documents } from './screens/Documents';
import { Settings } from './screens/Settings';
import { Backup } from './screens/Backup';

const NAV: { title: string; items: { route: Route; label: string; icon: string }[] }[] = [
  { title: 'Overview', items: [{ route: 'dashboard', label: 'Dashboard', icon: 'home' }, { route: 'calendar', label: 'Cash-flow calendar', icon: 'calendar' }, { route: 'net-worth', label: 'Net worth', icon: 'scale' }] },
  { title: 'Money', items: [
    { route: 'accounts', label: 'Accounts', icon: 'bank' }, { route: 'transactions', label: 'Transactions', icon: 'list' }, { route: 'import', label: 'Import', icon: 'upload' },
    { route: 'inbox', label: 'Review inbox', icon: 'inbox' }, { route: 'categories', label: 'Categories & rules', icon: 'tag' }, { route: 'recurring', label: 'Recurring & subscriptions', icon: 'repeat' },
  ] },
  { title: 'Budgeting', items: [{ route: 'spending', label: 'Spending & cost of living', icon: 'pie' }, { route: 'budgets', label: 'Budgets', icon: 'chart' }, { route: 'bills', label: 'Bills & sinking funds', icon: 'receipt' }] },
  { title: 'Planning', items: [
    { route: 'goals', label: 'Savings goals', icon: 'target' }, { route: 'forecast', label: 'Forecast & scenarios', icon: 'trend' }, { route: 'loans', label: 'Mortgage & debts', icon: 'home' },
    { route: 'term-deposits', label: 'Term deposits', icon: 'clock' }, { route: 'calculators', label: 'Calculators', icon: 'calc' },
  ] },
  { title: 'Tax & investments', items: [
    { route: 'income', label: 'Income & payslips', icon: 'wallet' }, { route: 'tax', label: 'Tax estimate & GST', icon: 'receipt' }, { route: 'investments', label: 'Investments', icon: 'trend' }, { route: 'super', label: 'Super', icon: 'umbrella' },
  ] },
  { title: 'Output', items: [{ route: 'reports', label: 'Reports & export', icon: 'sheet' }, { route: 'documents', label: 'Documents', icon: 'file' }] },
  { title: 'Settings', items: [{ route: 'settings', label: 'Settings & privacy', icon: 'settings' }, { route: 'backup', label: 'Backup & restore', icon: 'shield' }] },
];

function Screen({ route }: { route: Route }) {
  switch (route) {
    case 'dashboard': return <Dashboard />;
    case 'accounts': return <Accounts />;
    case 'transactions': return <Transactions />;
    case 'import': return <ImportScreen />;
    case 'inbox': return <Inbox />;
    case 'categories': return <Categories />;
    case 'recurring': return <Recurring />;
    case 'spending': return <Spending />;
    case 'budgets': return <Budgets />;
    case 'bills': return <Bills />;
    case 'calendar': return <CalendarScreen />;
    case 'goals': return <Goals />;
    case 'forecast': return <Forecast />;
    case 'loans': return <Loans />;
    case 'term-deposits': return <TermDeposits />;
    case 'calculators': return <Calculators />;
    case 'income': return <Income />;
    case 'tax': return <Tax />;
    case 'investments': return <Investments />;
    case 'super': return <Super />;
    case 'net-worth': return <NetWorth />;
    case 'reports': return <Reports />;
    case 'documents': return <Documents />;
    case 'settings': return <Settings />;
    case 'backup': return <Backup />;
  }
}

function Shell() {
  const { route, navigate, privacy, setPrivacy, status, setStatus, settings } = useApp();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const inboxQ = useApi('inbox.list', undefined, []);
  const inboxCount = inboxQ.data?.count ?? 0;

  const lock = useCallback(async () => {
    const s = await api('app.lock');
    setStatus(s);
  }, [setStatus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); setPrivacy(!privacy); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [privacy, setPrivacy]);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to main content</a>
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">P</div>
          <div>
            <div className="brand-name">Paperbark</div>
            <div className="brand-sub">Your data stays on this computer</div>
          </div>
        </div>
        {NAV.map((g) => (
          <div className="nav-group" key={g.title}>
            <div className="nav-group-title">{g.title}</div>
            {g.items.map((it) => (
              <button key={it.route} className="nav-item" aria-current={route === it.route ? 'page' : undefined} onClick={() => navigate(it.route)}>
                <span className="row" style={{ gap: 8 }}><Icon name={it.icon} size={16} />{it.label}</span>
                {it.route === 'inbox' && inboxCount > 0 && <span className="nav-count" aria-label={`${inboxCount} to review`}>{inboxCount}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="main">
        {status?.demo && (
          <div className="demo-banner" role="status">
            <span><strong>Demo mode.</strong> Everything shown is fictional sample data held only in memory. Nothing you do here is saved.</span>
            <button className="btn btn-sm" onClick={async () => setStatus(await api('app.exitDemo'))}>Leave demo</button>
          </div>
        )}
        <header className="topbar">
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); navigate('transactions', { search: query }); }}>
            <Icon name="search" size={16} />
            <input ref={searchRef} aria-label="Search transactions" placeholder='Search, e.g. "electricity last 3 years", "over $500", "tag:property"  (Ctrl+K)' value={query} onChange={(e) => setQuery(e.target.value)} />
          </form>
          <div className="spacer" />
          <button className="icon-btn" aria-pressed={privacy} onClick={() => setPrivacy(!privacy)} title="Hide amounts (Ctrl+Shift+H)" aria-label={privacy ? 'Show amounts' : 'Hide amounts'}>
            <Icon name={privacy ? 'eyeOff' : 'eye'} />
          </button>
          {status?.protection === 'password' && !status.demo && (
            <button className="icon-btn" onClick={lock} title="Lock Paperbark (Ctrl+L)" aria-label="Lock Paperbark"><Icon name="lock" /></button>
          )}
          {settings && !status?.demo && status?.protection !== 'password' && (
            <button className="btn btn-sm btn-ghost" onClick={() => navigate('settings')} title="Set a password to be able to lock Paperbark">Set up app lock</button>
          )}
        </header>
        <main id="main" className="content" tabIndex={-1}>
          <Screen route={route} />
        </main>
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" aria-live="polite" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast-error' : ''}`}>
          <span style={{ flex: 1 }}>{t.message}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss"><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const { status, setStatus, settings, setSettings, navigate } = useApp();
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api('app.status');
      clearShared();
      setStatus(s);
      if (s.unlocked) setSettings(await api('settings.get'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [setStatus, setSettings]);

  useEffect(() => {
    void refreshStatus();
    const offLocked = window.paperbark.on('app:locked', () => void refreshStatus());
    const offNav = window.paperbark.on('navigate', (r) => navigate(r as Route));
    const onLocked = () => void refreshStatus();
    window.addEventListener('paperbark:locked', onLocked);
    const offChanged = onDataChanged((areas) => {
      if (areas.includes('settings') || areas.includes('all')) void api('settings.get').then(setSettings).catch(() => undefined);
    });
    // Activity pings for the optional inactivity lock (throttled).
    let last = 0;
    const ping = () => {
      if (Date.now() - last > 20_000) {
        last = Date.now();
        window.paperbark.activity();
      }
    };
    window.addEventListener('keydown', ping);
    window.addEventListener('mousemove', ping);
    return () => {
      offLocked();
      offNav();
      offChanged();
      window.removeEventListener('paperbark:locked', onLocked);
      window.removeEventListener('keydown', ping);
      window.removeEventListener('mousemove', ping);
    };
  }, [refreshStatus, navigate, setSettings]);

  useEffect(() => {
    const root = document.documentElement;
    if (!settings || settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
    if (settings?.highContrast) root.setAttribute('data-contrast', 'high');
    else root.removeAttribute('data-contrast');
    root.style.fontSize = `${Math.round(16 * (settings?.textScale ?? 1))}px`;
  }, [settings]);

  if (error) return <div className="lock-wrap"><div className="card lock-card"><h1>Paperbark could not start</h1><p>{error}</p></div></div>;
  if (!status) return <div className="lock-wrap"><div className="muted" role="status">Starting…</div></div>;
  let body;
  if (!status.initialised && !status.unlocked) body = <Setup onDone={refreshStatus} />;
  else if (!status.unlocked) body = <Unlock onDone={refreshStatus} />;
  else if (!status.demo && settings && !settings.onboardingComplete) body = <Onboarding onDone={refreshStatus} />;
  else body = <Shell />;
  return (
    <>
      {body}
      <Toasts />
    </>
  );
}
