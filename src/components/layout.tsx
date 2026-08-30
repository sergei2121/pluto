// ─── PLUTO: каркас интерфейса ────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  LayoutDashboard, Server, Monitor, Activity, BarChart3, Rocket, Settings as SettingsIcon, LogOut, Search, X,
  AlertTriangle, Bell, Check, Globe, Orbit,
} from 'lucide-react';
import { cls, fmtClock, CONSOLE_VERSION } from '../lib/util';
import { store, useCurrentUser, usePluto, useToastList, useToasts, visibleAgents, visibleDevices, visibleGlances } from '../lib/store';
import { StatusDot } from './ui';
import type { Route } from '../lib/types';

// ─── Живой фон: звёздное небо + туманности ───────────────────────────────────

export function Starfield() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div className="nebula absolute inset-0" />
      <div className="stars absolute inset-0" />
      <div className="stars stars-2 absolute inset-0" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(7,10,22,.55)_100%)]" />
    </div>
  );
}

// ─── Тосты ───────────────────────────────────────────────────────────────────

const TOAST_META = {
  ok: { icon: <Check className="h-4 w-4" />, cls: 'border-ok/40 text-ok' },
  warn: { icon: <AlertTriangle className="h-4 w-4" />, cls: 'border-warn/40 text-warn' },
  crit: { icon: <AlertTriangle className="h-4 w-4" />, cls: 'border-crit/40 text-crit' },
  info: { icon: <Bell className="h-4 w-4" />, cls: 'border-vio/40 text-vio' },
};

export function ToastHost() {
  const list = useToastList();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[min(360px,90vw)] flex-col gap-2">
      {list.map((t) => {
        const m = TOAST_META[t.kind];
        return (
          <div key={t.id} className={cls('toast-in pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-panel px-3.5 py-3 shadow-[0_12px_40px_-8px_rgba(0,0,0,.8)]', m.cls)}>
            <span className="mt-0.5 shrink-0">{m.icon}</span>
            <p className="flex-1 text-[13px] leading-snug text-ink">{t.text}</p>
            <button onClick={() => useToasts.drop(t.id)} className="text-dim transition-colors hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Боковое меню ────────────────────────────────────────────────────────────

const NAV: { route: Route; label: string; icon: ReactNode; adminOnly?: boolean; needAgent?: boolean; needGlances?: boolean }[] = [
  { route: 'dashboard', label: 'Главная', icon: <LayoutDashboard className="h-[17px] w-[17px]" /> },
  { route: 'devices', label: 'Устройства', icon: <Server className="h-[17px] w-[17px]" /> },
  { route: 'agents', label: 'Агенты', icon: <Monitor className="h-[17px] w-[17px]" />, needAgent: true },
  { route: 'telemetry', label: 'Журнал телеметрии', icon: <Activity className="h-[17px] w-[17px]" />, needAgent: true },
  { route: 'bars', label: 'Журнал телеметрии Bars', icon: <BarChart3 className="h-[17px] w-[17px]" />, needGlances: true },
  { route: 'deploy', label: 'Развёртывание', icon: <Rocket className="h-[17px] w-[17px]" /> },
  { route: 'settings', label: 'Настройки системы', icon: <SettingsIcon className="h-[17px] w-[17px]" />, adminOnly: true },
];

export function Sidebar() {
  const route = usePluto((s) => s.route);
  const apiMode = usePluto((s) => s.apiMode);
  const user = useCurrentUser();
  const critCount = usePluto((s) => s.devices.filter((d) => d.status === 'down').length + s.agents.filter((a) => !a.online).length);

  const items = NAV.filter((n) => {
    if (!user) return false;
    if (n.adminOnly && user.role !== 'admin') return false;
    if (n.needAgent && user.role !== 'admin' && !user.scope.includes('agent')) return false;
    if (n.needGlances && user.role !== 'admin' && !user.scope.includes('glances')) return false;
    return true;
  });

  return (
    <aside className="relative z-10 hidden h-screen w-[228px] shrink-0 flex-col border-r border-line bg-deep/95 md:flex">
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <span className="text-vio drop-shadow-[0_0_12px_rgba(143,125,240,.45)]">
          <Orbit className="h-9 w-9" strokeWidth={1.6} />
        </span>
        <div>
          <div className="font-display text-[17px] font-bold leading-none tracking-[0.22em] text-ink">PLUTO</div>
          <div className="mt-1 text-[9.5px] font-medium uppercase tracking-[0.18em] text-dim">центр мониторинга</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {items.map((n) => {
          const active = route === n.route;
          return (
            <button
              key={n.route}
              onClick={() => store.nav(n.route)}
              className={cls(
                'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] font-semibold transition-all duration-150',
                active ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_rgba(143,125,240,.25)]' : 'text-mut hover:bg-raised/60 hover:text-ink',
              )}
            >
              <span className={cls('absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-vio transition-all duration-200', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40')} />
              <span className={cls('transition-colors', active ? 'text-vio' : 'text-dim group-hover:text-mut')}>{n.icon}</span>
              <span className="min-w-0 flex-1 truncate">{n.label}</span>
              {n.route === 'dashboard' && critCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-crit/15 px-1.5 font-mono text-[10.5px] font-bold text-crit ring-1 ring-crit/30">
                  {critCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-line/60 p-4">
        <div className="rounded-lg border border-line bg-raised/50 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="dot-live h-2 w-2 shrink-0 rounded-full bg-ok" />
            <span className="text-[11px] font-semibold text-mut">
              {apiMode === 'server' ? 'Ядро: серверное' : 'Ядро: встроенное'}
            </span>
            <span className="ml-auto font-mono text-[10px] text-dim">v{CONSOLE_VERSION}</span>
          </div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-dim">
            {apiMode === 'server' ? 'реальные проверки · опрос каждые 2.5 с' : 'браузерный режим · синтетические данные'}
          </p>
        </div>

        {user && (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-vio/20 font-display text-[12px] font-bold text-vio ring-1 ring-vio/30">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink">{user.name}</div>
              <div className="text-[10.5px] text-dim">{user.role === 'admin' ? 'администратор' : 'наблюдатель'}</div>
            </div>
            <button onClick={store.logout} title="Выйти" className="rounded-md p-1.5 text-dim transition-all hover:bg-raised hover:text-crit">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Верхняя панель с быстрым поиском ────────────────────────────────────────

const TITLES: Record<Route, string> = {
  dashboard: 'Обзор инфраструктуры',
  devices: 'Устройства',
  agents: 'Агенты: IP + AIDA64 + Glances',
  telemetry: 'Журнал телеметрии',
  bars: 'Журнал телеметрии Bars · Glances',
  settings: 'Настройки системы',
  deploy: 'Развёртывание и документация',
};

function Clock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="font-mono text-[12px] tabular-nums text-dim">{fmtClock(now)}</span>;
}

/** Индикатор режима ядра */
function ModeChip() {
  const apiMode = usePluto((s) => s.apiMode);
  const coreVersion = usePluto((s) => s.coreVersion);
  const server = apiMode === 'server';
  return (
    <div
      className={cls(
        'hidden items-center gap-2 rounded-lg border px-3 py-1.5 lg:flex',
        server ? 'border-ok/35 bg-ok/10' : 'border-warn/35 bg-warn/10',
      )}
      title={
        server
          ? 'Консоль подключена к серверному ядру: проверки и телеметрия реальные.'
          : 'Серверное ядро не найдено — работает встроенный движок (синтетика). Разверните сервер: git pull && docker compose up -d --build.'
      }
    >
      <span className={cls('h-1.5 w-1.5 rounded-full', server ? 'dot-live bg-ok' : 'bg-warn')} />
      <span className={cls('text-[11px] font-bold uppercase tracking-[0.1em]', server ? 'text-ok' : 'text-warn')}>
        {server
          ? coreVersion === 'legacy'
            ? 'ядро: сервер · старая сборка'
            : `ядро: сервер · v${coreVersion ?? '?'}`
          : 'ядро: эмуляция'}
      </span>
      <span className="border-l border-line pl-2 font-mono text-[10px] font-normal normal-case tracking-normal text-dim">
        консоль v{CONSOLE_VERSION}
      </span>
    </div>
  );
}

export function Topbar() {
  const route = usePluto((s) => s.route);
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const agents = usePluto((s) => visibleAgents(s, user));
  const glancesDevs = usePluto((s) => visibleGlances(s, user));
  const tags = usePluto((s) => s.tags);

  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocus(false);
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return { devs: [], ags: [], gls: [] };
    const tagIds = tags.filter((t) => t.label.toLowerCase().includes(query)).map((t) => t.id);
    const devs = devices
      .filter((d) => d.name.toLowerCase().includes(query) || d.address.toLowerCase().includes(query) || d.tags.some((t) => tagIds.includes(t)))
      .slice(0, 6);
    const ags = agents.filter((a) => a.name.toLowerCase().includes(query) || (a.ip || '').includes(query)).slice(0, 4);
    const gls = glancesDevs.filter((g) => g.name.toLowerCase().includes(query) || g.url.toLowerCase().includes(query)).slice(0, 4);
    return { devs, ags, gls };
  }, [q, devices, agents, glancesDevs, tags]);

  const hasResults = results.devs.length > 0 || results.ags.length > 0 || results.gls.length > 0;

  return (
    <header className="relative z-10 flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-deep/80 px-4 md:gap-4 md:px-6">
      <span className="flex shrink-0 items-center gap-2 md:hidden">
        <Orbit className="h-5 w-5 text-vio" />
        <span className="font-display text-[13px] font-bold tracking-[0.18em] text-ink">PLUTO</span>
      </span>
      <h1 className="hidden truncate font-display text-[15px] font-semibold tracking-wide text-ink md:block">{TITLES[route]}</h1>

      <div ref={boxRef} className="relative ml-auto hidden w-[340px] max-w-[44vw] sm:block">
        <div className={cls('flex items-center gap-2 rounded-lg border bg-raised/70 px-3 py-2 transition-all duration-200', focus ? 'border-vio/60 shadow-[0_0_0_3px_rgba(143,125,240,.12)]' : 'border-line')}>
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setFocus(true); }}
            onFocus={() => setFocus(true)}
            placeholder="Быстрый поиск: IP, имя или тег…"
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-dim/80"
          />
          {q && (
            <button onClick={() => setQ('')} className="text-dim hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {focus && q.trim() && (
          <div className="pop absolute left-0 right-0 top-[calc(100%+6px)] overflow-hidden rounded-lg border border-line bg-panel shadow-[0_24px_60px_-12px_rgba(0,0,0,.85)]">
            {!hasResults && <p className="px-4 py-4 text-center text-[12.5px] text-dim">Ничего не найдено по запросу «{q}»</p>}
            {results.devs.length > 0 && (
              <div>
                <div className="px-3.5 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-dim">Устройства</div>
                {results.devs.map((d) => (
                  <button key={d.id} onClick={() => { store.nav('devices', d.address); setQ(''); setFocus(false); }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-raised/70">
                    <StatusDot status={d.status} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{d.name}</span>
                    <span className="font-mono text-[11px] text-mut">{d.address}</span>
                    <span className="font-mono text-[9.5px] uppercase text-dim">{d.type}</span>
                  </button>
                ))}
              </div>
            )}
            {results.ags.length > 0 && (
              <div className="border-t border-line/60">
                <div className="px-3.5 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-dim">Агенты</div>
                {results.ags.map((a) => (
                  <button key={a.id} onClick={() => { store.nav('agents', a.ip || a.name); setQ(''); setFocus(false); }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-raised/70">
                    <StatusDot status={a.online ? 'up' : 'down'} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{a.name}</span>
                    <span className="font-mono text-[11px] text-mut">{a.ip}</span>
                  </button>
                ))}
              </div>
            )}
            {results.gls.length > 0 && (
              <div className="border-t border-line/60">
                <div className="px-3.5 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-dim">Glances</div>
                {results.gls.map((g) => (
                  <button key={g.id} onClick={() => { store.nav('bars', g.name); setQ(''); setFocus(false); }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-raised/70">
                    <StatusDot status={g.online ? 'up' : 'down'} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{g.name}</span>
                    <span className="font-mono text-[11px] text-mut">{g.url}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ModeChip />
      <div className="hidden items-center gap-2 rounded-lg border border-line bg-raised/50 px-3 py-1.5 md:flex">
        <Globe className="h-3.5 w-3.5 text-vio" />
        <span className="text-[11px] font-semibold text-mut">опрос активен</span>
      </div>
      <Clock />
    </header>
  );
}

// ─── Плашка эмуляционного режима ────────────────────────────────────────────

function EmuBanner() {
  const apiMode = usePluto((s) => s.apiMode);
  if (apiMode === 'server') return null;
  return (
    <div className="flex items-start gap-3 border-b border-warn/30 bg-warn/10 px-6 py-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
      <p className="text-[12px] leading-relaxed text-warn">
        <span className="font-bold">Работа без серверного ядра — задержки и телеметрия синтетические.</span>{' '}
        На сервере выполните <code className="rounded bg-void/50 px-1.5 py-0.5 font-mono text-[11px] text-ink">git pull &amp;&amp; docker compose up -d --build</code>{' '}
        и обновите страницу (Ctrl+Shift+R) — плашка исчезнет, данные станут реальными.
      </p>
    </div>
  );
}

// ─── Нижняя навигация для мобильных ─────────────────────────────────────────

export function MobileNav() {
  const route = usePluto((s) => s.route);
  const user = useCurrentUser();
  const critCount = usePluto((s) => s.devices.filter((d) => d.status === 'down').length + s.agents.filter((a) => !a.online).length);

  const items = NAV.filter((n) => {
    if (!user) return false;
    if (n.adminOnly && user.role !== 'admin') return false;
    if (n.needAgent && user.role !== 'admin' && !user.scope.includes('agent')) return false;
    if (n.needGlances && user.role !== 'admin' && !user.scope.includes('glances')) return false;
    return true;
  });

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-deep/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      {items.map((n) => {
        const active = route === n.route;
        const isDash = n.route === 'dashboard';
        return (
          <button
            key={n.route}
            onClick={() => store.nav(n.route)}
            className={cls(
              'relative flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 transition-colors',
              active ? 'text-vio' : 'text-dim hover:text-mut',
            )}
          >
            {isDash && critCount > 0 && (
              <span className="absolute right-1/2 top-1.5 translate-x-4 rounded-full bg-crit px-1.5 py-px font-mono text-[9px] font-bold leading-tight text-void">
                {critCount}
              </span>
            )}
            <span className={cls('transition-transform', active && 'scale-110')}>{n.icon}</span>
            <span className="max-w-full truncate px-1 text-[9.5px] font-semibold leading-none">{n.label}</span>
            <span className={cls('absolute top-0 h-[2.5px] w-8 rounded-b-full bg-vio transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
          </button>
        );
      })}
    </nav>
  );
}

// ─── Оболочка страниц ────────────────────────────────────────────────────────

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-screen overflow-hidden bg-void text-ink">
      <Starfield />
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar />
        <EmuBanner />
        <main className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-[72px] md:pb-0">
          <div className="mx-auto max-w-[1500px] p-4 md:p-6">{children}</div>
        </main>
      </div>
      <MobileNav />
      <ToastHost />
    </div>
  );
}
