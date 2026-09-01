// ─── PLUTO: «Пинги агентов» — только ping-статистика relay-агентов ──────────
import { memo, useMemo, useState } from 'react';
import { Crosshair, Star, Eye, RefreshCw, Search, ChevronDown, Wifi, WifiOff, Activity } from 'lucide-react';
import { Panel, StatusDot, EmptyState } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts, visibleAgents } from '../lib/store';
import { cls, fmtMs, pingStats, timeAgo } from '../lib/util';
import type { Agent, RelayPingResult } from '../lib/types';

/** Полоска задержки одного устройства (относительно максимума по агенту). */
function LatencyBar({ r, max }: { r: RelayPingResult; max: number }) {
  const w = max > 0 && r.latency != null ? Math.max(4, (r.latency / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className={cls('h-1.5 w-1.5 shrink-0 rounded-full', r.alive ? 'bg-ok' : 'bg-crit')} />
      <span className="w-28 shrink-0 truncate font-mono text-[11px] text-mut" title={r.ip}>{r.ip}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised/70">
        {r.alive && r.latency != null ? (
          <div
            className={cls('h-full rounded-full transition-all duration-500',
              r.latency > 250 ? 'bg-warn' : 'bg-vio/80')}
            style={{ width: `${w}%` }}
          />
        ) : (
          <div className="h-full rounded-full bg-crit/40" style={{ width: '100%' }} />
        )}
      </div>
      <span className={cls('w-16 shrink-0 text-right font-mono text-[11px] tabular-nums',
        !r.alive ? 'text-crit' : r.latency != null && r.latency > 250 ? 'text-warn' : 'text-ink')}>
        {r.alive ? fmtMs(r.latency) : 'нет'}
      </span>
    </div>
  );
}

const AgentPingCard = memo(function AgentPingCard({ a }: { a: Agent }) {
  const [expanded, setExpanded] = useState(false);
  const st = useMemo(() => pingStats(a.targets), [a.targets]);

  const devices = useMemo(() => a.targets.flatMap((t) => t.results), [a.targets]);
  const lastCheck = a.targets.reduce((m, t) => Math.max(m, t.lastCheck || 0), 0);

  const onFav = () => store.toggleAgentPingsFav(a.id);
  const onShowcase = () => store.toggleAgentPingsShowcase(a.id);
  const onPoll = () => { void store.pollAgentNow(a.id); useToasts.push('info', `Опрашиваю «${a.name}»…`); };

  return (
    <div className={cls('rise rounded-xl border bg-panel/90 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_rgba(0,0,0,.7)]',
      a.online ? 'border-line hover:border-vio/40' : 'border-crit/40 hover:border-crit/60')}>
      {/* шапка */}
      <div className="flex items-start justify-between gap-2">
        <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => setExpanded((v) => !v)}>
          <StatusDot status={a.online ? 'up' : 'down'} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-ink">{a.name}</div>
            <div className="font-mono text-[11px] text-dim">{a.ip}{lastCheck ? ` · ${timeAgo(lastCheck)}` : ''}</div>
          </div>
          <ChevronDown className={cls('h-4 w-4 shrink-0 text-dim transition-transform duration-200', expanded && 'rotate-180')} />
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onFav} title={a.pingsFavorite ? 'Убрать с главной' : 'На главную'}
            className={cls('rounded-md p-1.5 transition-all hover:bg-raised', a.pingsFavorite ? 'text-warn' : 'text-dim/40 hover:text-dim')}>
            <Star className={cls('h-4 w-4', a.pingsFavorite && 'fill-warn')} strokeWidth={1.5} />
          </button>
          <button onClick={onShowcase} title={a.pingsShowcase ? 'Убрать с витрины' : 'На публичную витрину'}
            className={cls('rounded-md p-1.5 transition-all hover:bg-raised', a.pingsShowcase ? 'text-mint' : 'text-dim/40 hover:text-dim')}>
            <Eye className={cls('h-4 w-4', a.pingsShowcase && 'fill-mint/40')} strokeWidth={1.5} />
          </button>
          <button onClick={onPoll} title="Опросить сейчас"
            className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-vio">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* сводка */}
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <div className="rounded-lg border border-line bg-raised/40 px-2 py-2">
          <div className="font-mono text-[16px] font-bold tabular-nums text-ink">{st.total}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">всего</div>
        </div>
        <div className="rounded-lg border border-ok/30 bg-ok/10 px-2 py-2">
          <div className="font-mono text-[16px] font-bold tabular-nums text-ok">{st.online}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">онлайн</div>
        </div>
        <div className={cls('rounded-lg border px-2 py-2', st.offline > 0 ? 'border-crit/40 bg-crit/10' : 'border-line bg-raised/40')}>
          <div className={cls('font-mono text-[16px] font-bold tabular-nums', st.offline > 0 ? 'text-crit' : 'text-dim')}>{st.offline}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">офлайн</div>
        </div>
        <div className="rounded-lg border border-line bg-raised/40 px-2 py-2">
          <div className="font-mono text-[16px] font-bold tabular-nums text-blu">{fmtMs(st.avg)}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">ср. пинг</div>
        </div>
      </div>

      {/* прогресс доступности */}
      {st.total > 0 && (
        <div className="mt-3">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-raised/70">
            <div className="bg-ok transition-all duration-500" style={{ width: `${(st.online / st.total) * 100}%` }} />
            {st.offline > 0 && <div className="bg-crit transition-all duration-500" style={{ width: `${(st.offline / st.total) * 100}%` }} />}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9.5px] text-dim">
            <span>доступно {st.total ? Math.round((st.online / st.total) * 100) : 0}%</span>
            <span>макс {fmtMs(st.max)}</span>
          </div>
        </div>
      )}

      {/* список устройств */}
      {expanded && (
        <div className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
          {devices.length === 0 ? (
            <p className="py-2 text-center text-[12px] text-dim">Цели ещё не опрошены — добавьте IP в «Агенты → Изменить».</p>
          ) : (
            devices.map((r, i) => <LatencyBar key={r.ip + i} r={r} max={st.max ?? 1} />)
          )}
        </div>
      )}
    </div>
  );
});

export default function AgentPings() {
  const user = useCurrentUser();
  const agents = usePluto((s) => visibleAgents(s, user));
  const [q, setQ] = useState('');

  // показываем только агентов, у которых настроены цели пинга
  const withTargets = useMemo(() => agents.filter((a) => a.pingTargets.length > 0), [agents]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return withTargets;
    return withTargets.filter((a) => a.name.toLowerCase().includes(query) || a.ip.includes(query));
  }, [withTargets, q]);

  const agg = useMemo(() => {
    let total = 0, online = 0;
    for (const a of withTargets) {
      const s = pingStats(a.targets);
      total += s.total; online += s.online;
    }
    return { total, online, offline: total - online };
  }, [withTargets]);

  return (
    <div className="space-y-4">
      {/* шапка-сводка */}
      <div className="rise flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel/90 px-4 py-3">
        <span className="flex items-center gap-2 text-vio"><Crosshair className="h-5 w-5" /></span>
        <div>
          <div className="font-display text-[14px] font-bold text-ink">Пинги агентов</div>
          <div className="text-[10.5px] text-dim">устройства, доступные только через relay-агентов (NAT/VLAN)</div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-[12px]">
            <span className="text-dim">{withTargets.length} агентов</span>
            <span className="text-ok">{agg.online} онлайн</span>
            {agg.offline > 0 && <span className="text-crit">{agg.offline} офлайн</span>}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
            <input className="inp w-44 pl-8 text-[12px]" placeholder="Имя или IP…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          <button onClick={() => { for (const a of list) void store.pollAgentNow(a.id); useToasts.push('info', 'Опрашиваю всех…'); }}
            className="btn-ghost text-[12px]"><RefreshCw className="h-3.5 w-3.5" /> Опросить все</button>
        </div>
      </div>

      {withTargets.length === 0 ? (
        <Panel title="Нет целей для пинга">
          <EmptyState icon={<WifiOff className="h-6 w-6" />} title="Агенты без настроенных целей"
            text="Добавьте агенту IP-адреса локальных устройств в «Агенты → Изменить → Цели для пинга», и здесь появится их ping-статистика."
            action={<button onClick={() => store.nav('agents')} className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink hover:bg-vio/30">К агентам</button>} />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {list.map((a) => <AgentPingCard key={a.id} a={a} />)}
        </div>
      )}

      {/* легенда */}
      {withTargets.length > 0 && (
        <div className="rise flex flex-wrap items-center gap-4 rounded-xl border border-line/60 bg-panel/60 px-4 py-2.5 text-[11px] text-dim">
          <span className="flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-warn" /> — на главную</span>
          <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5 text-mint" /> — на публичную витрину</span>
          <span className="flex items-center gap-1.5"><Wifi className="h-3.5 w-3.5 text-ok" /> устройство отвечает</span>
          <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-warn" /> полоска — задержка относительно максимума</span>
        </div>
      )}
    </div>
  );
}
