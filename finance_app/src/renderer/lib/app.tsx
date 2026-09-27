import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppSettings } from '../../shared/types';
import type { AppStatus } from '../../main/app/state';

/** App-wide UI state: navigation, privacy mode, settings, status and toasts. */

export type Route =
  | 'dashboard' | 'accounts' | 'transactions' | 'import' | 'inbox' | 'categories' | 'recurring'
  | 'spending' | 'budgets' | 'bills' | 'calendar' | 'goals' | 'forecast' | 'loans' | 'term-deposits'
  | 'calculators' | 'income' | 'tax' | 'investments' | 'super' | 'net-worth' | 'reports' | 'documents'
  | 'settings' | 'backup';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

interface AppCtx {
  route: Route;
  params: Record<string, string>;
  navigate(route: Route, params?: Record<string, string>): void;
  privacy: boolean;
  setPrivacy(v: boolean): void;
  settings: AppSettings | null;
  setSettings(s: AppSettings): void;
  status: AppStatus | null;
  setStatus(s: AppStatus): void;
  toasts: Toast[];
  toast(message: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>('dashboard');
  const [params, setParams] = useState<Record<string, string>>({});
  const [privacy, setPrivacy] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const navigate = useCallback((r: Route, p: Record<string, string> = {}) => {
    setRoute(r);
    setParams(p);
  }, []);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useEffect(() => {
    if (settings) setPrivacy((p) => p || settings.privacyModeDefault);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.privacyModeDefault]);

  const value = useMemo(
    () => ({ route, params, navigate, privacy, setPrivacy, settings, setSettings, status, setStatus, toasts, toast, dismissToast }),
    [route, params, navigate, privacy, settings, status, toasts, toast, dismissToast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}
