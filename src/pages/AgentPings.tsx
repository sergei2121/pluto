// ─── PLUTO: пинги агентов (локальные устройства через relay) ────────────────
import { memo, useMemo, useState } from 'react';
import { Crosshair, Star, Eye, RefreshCw, Search, Wifi, WifiOff, Activity, LayoutGrid } from 'lucide-react';
import { Panel, StatusDot, EmptyState, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts, visibleAgents } from '../lib/store';
import { cls, fmtMs, pingStats } from '../lib/util';
import type { Agent } from '../lib/types';

const AgentPingsCard = memo(function AgentPingsCard({ a }: { a: Agent }) {
  const st = pingStats(a.targets);
  const all = a.targets.flatMap((t) => t.results);
  const onFav = () => store.toggleAgentPingsFav(a.id);
  const onShowcase = () => store.toggleAgentPingsShowcase(a.id);
  const onPoll = () => { void store.pollAgentNow(a.id); useToasts.push('info', `Опрашиваю «${a.name}»…`); };

  return (
    <div className="rise rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:border-mint/35 hover:shadow-[0_14px_40px_-16px_rgba(0,0,0,.8)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            <Crosshair className="h-4 w-4 shrink-0 text-mint" />
            <span className="truncate">{a.name}</span>
          </div>
          <div className="font-mono text-[11px] text-dim">{a.ip} · пинг до ПК {a.latency != null ? `${a.latency} мс` : '—'}</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onFav} title="На главную (избранное)" className={cls('rounded-md p-1.5 transition-all hover:bg-raised', a.pingsFavorite ? 'text-warn' : 'text-dim/40 hover:text-dim')}>
            <Star className={cls('h-4 w-4', a.pingsFavorite && 'fill-warn')} strokeWidth={1.5} />
          </button>
          <button onClick={onShowcase} title="На публичную витрину" className={cls('rounded-md p-1.5 transition-all hover:bg-raised', a.pingsShowcase ? 'text-mint' : 'text-dim/40 hover:text-dim')}>
            <Eye className={cls('h-4 w-4', a.pingsShowcase && 'fill-mint/40')} strokeWidth={1.5} />
          </button>
          <button onClick={onPoll} title="Опросить сейчас" className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-vio">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className="font-mono text-[17px] font-bold text-ink">{st.total}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">всего</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className="font-mono text-[17px] font-bold text-ok">{st.online}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">онлайн</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[17px] font-bold', st.offline ? 'text-crit' : 'text-dim')}>{st.offline}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">офлайн</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className="font-mono text-[17px] font-bold text-blu">{st.avg != null ? st.avg : '—'}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">ср. мс</div></div>
      </div>

      {st.total === 0 ? (
        <p className="mt-3 text-[12px] text-dim">Цели не заданы или ещё не опрошены. Добавьте IP/диапазоны в «Агенты → Изменить».</p>
      ) : (
        <div className="mt-3 max-h-56 space-y-1 overflow-y-auto scroll-thin">
          {all.map((r) => (
            <div key={r.ip} className="flex items-center justify-between rounded border border-line/40 bg-raised/30 px-2.5 py-1.5 transition-colors hover:bg-raised/60">
              <span className="flex items-center gap-2 font-mono text-[11.5px] text-mut">
                {r.alive ? <Wifi className="h-3.5 w-3.5 text-ok" /> : <WifiOff className="h-3.5 w-3.5 text-crit" />}{r.ip}
              </span>
              <span className={cls('font-mono text-[11.5px] font-semibold', r.alive ? 'text-ok' : 'text-crit')}>{r.alive ? `${r.latency ?? 0} мс` : 'нет ответа'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between font-mono text-[10.5px] text-dim">
        <span>макс {st.max != null ? `${st.max} мс` : '—'}</span>
        {a.lastPoll > 0 && <TimeAgo ts={a.lastPoll} />}
      </div>
    </div>
  );
});

export default function AgentPings() {
  const user = useCurrentUser();
  const agents = usePluto((s) => visibleAgents(s, user));
  const [q, setQ] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return agents.filter((a) => {
      if (query && !a.name.toLowerCase().includes(query) && !a.ip.includes(query)) return false;
      if (onlyIssues && pingStats(a.targets).offline === 0) return false;
      return true;
    });
  }, [agents, q, onlyIssues]);

  const totalDevices = useMemo(() => agents.reduce((acc, a) => acc + pingStats(a.targets).total, 0), [agents]);
  const totalOnline = useMemo(() => agents.reduce((acc, a) => acc + pingStats(a.targets).online, 0), [agents]);

  return (
    <div className="space-y-4">
      <Panel title={`Пинги агентов · ${totalOnline}/${totalDevices} устройств онлайн`} icon={<Crosshair className="h-4 w-4" />}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-raised/50 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или IP агента…" className="w-44 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-dim/70" />
          </div>
          <button onClick={() => setOnlyIssues((v) => !v)}
            className={cls('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-all',
              onlyIssues ? 'border-crit/50 bg-crit/15 text-crit' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
            <Activity className="h-3.5 w-3.5" />Только с офлайн
          </button>
          <span className="text-[11.5px] text-dim">Устройства, которые агенты пингуют внутри своих сетей (VLAN/NAT).</span>
        </div>

        {list.length === 0 ? (
          <EmptyState icon={<Crosshair className="h-6 w-6" />} title="Пингов пока нет"
            text="Добавьте агенту цели для пинга (IP, диапазон или подсеть) в «Агенты → Изменить» — результаты появятся здесь."
            action={<button onClick={() => store.nav('agents')} className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">К агентам</button>} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.map((a) => <AgentPingsCard key={a.id} a={a} />)}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line/40 pt-3 font-mono text-[10.5px] text-dim">
          <span className="flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-warn" /> — на главную</span>
          <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5 text-mint" /> — на публичную витрину</span>
          <span className="flex items-center gap-1.5"><Wifi className="h-3.5 w-3.5 text-ok" /> устройство отвечает</span>
          <span className="flex items-center gap-1.5"><WifiOff className="h-3.5 w-3.5 text-crit" /> нет ответа</span>
        </div>
      </Panel>
    </div>
  );
}
