// ─── PLUTO: пинги агентов (локальные устройства через relay) ────────────────
import { memo, useMemo, useState } from 'react';
import { Crosshair, Star, Eye, RefreshCw, Search, Wifi, WifiOff, Activity, LayoutGrid, ChevronDown, ChevronUp } from 'lucide-react';
import { Panel, EmptyState, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts, agentsWithPings } from '../lib/store';
import { cls, pingStats, targetDisplayName } from '../lib/util';
import type { Agent } from '../lib/types';

const AgentPingsCard = memo(function AgentPingsCard({ a }: { a: Agent }) {
  const allTargets = Array.isArray(a.targets) ? a.targets : [];
  
  // Считаем общую статистику по всем целям
  const st = pingStats(allTargets);
  
  const onFav = () => store.toggleAgentPingsFav(a.id);
  const onShowcase = () => store.toggleAgentPingsShowcase(a.id);
  const onPoll = () => { void store.pollAgentNow(a.id); useToasts.push('info', `Опрашиваю «${a.name}»…`); };

  // Состояние для раскрытия каждой цели
  const [expandedTargets, setExpandedTargets] = useState<Record<string, boolean>>({});

  const toggleTarget = (key: string) => {
    setExpandedTargets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Сколько целей раскрыто — влияет на плотность карточки (компактный режим при 2+)
  const expandedCount = allTargets.reduce((acc, t) => acc + ((expandedTargets[t.target || t.name || t.range || 'Без имени'] ?? false) ? 1 : 0), 0);
  const dense = expandedCount >= 2;

  return (
    <div className={cls('rise rounded-xl border border-line bg-panel/90 transition-all duration-200 hover:border-mint/35 hover:shadow-[0_14px_40px_-16px_rgba(0,0,0,.8)]', dense ? 'p-3' : 'p-4')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cls('flex items-center gap-1.5 font-semibold text-ink', dense ? 'text-[13px]' : 'text-[14px]')}>
            <Crosshair className={cls('shrink-0 text-mint', dense ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
            <span className="truncate">{a.name}</span>
          </div>
          <div className={cls('font-mono text-dim', dense ? 'text-[10px]' : 'text-[11px]')}>
            {a.ip} · <span className={a.online ? 'text-ok' : 'text-crit'}>{a.online ? 'хаб онлайн' : 'хаб офлайн'}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button onClick={onFav} title="На главную (избранное)" className={cls('rounded-md p-1 transition-all hover:bg-raised', a.pingsFavorite ? 'text-warn' : 'text-dim/40 hover:text-dim')}>
            <Star className={cls(dense ? 'h-3.5 w-3.5' : 'h-4 w-4', a.pingsFavorite && 'fill-warn')} strokeWidth={1.5} />
          </button>
          <button onClick={onShowcase} title="На публичную витрину" className={cls('rounded-md p-1 transition-all hover:bg-raised', a.pingsShowcase ? 'text-mint' : 'text-dim/40 hover:text-dim')}>
            <Eye className={cls(dense ? 'h-3.5 w-3.5' : 'h-4 w-4', a.pingsShowcase && 'fill-mint/40')} strokeWidth={1.5} />
          </button>
          <button onClick={onPoll} title="Опросить сейчас" className="rounded-md p-1 text-dim transition-colors hover:bg-raised hover:text-vio">
            <RefreshCw className={cls(dense ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
          </button>
        </div>
      </div>

      {/* Сводка статистики: компактная строка вместо трёх плиток — экономит ширину без потери данных */}
      <div className={cls('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line/60 bg-raised/40 font-mono', dense ? 'mt-2 px-2.5 py-1 text-[11px]' : 'mt-3 px-3 py-1.5 text-[12.5px]')}>
        <span className="flex items-baseline gap-1"><b className="text-[14px] text-ink tabular-nums">{st.total}</b><span className={cls('font-bold uppercase tracking-wider text-dim', dense ? 'text-[8px]' : 'text-[8.5px]')}>всего</span></span>
        <span className="flex items-baseline gap-1"><b className="text-[14px] text-ok tabular-nums">{st.online}</b><span className={cls('font-bold uppercase tracking-wider text-dim', dense ? 'text-[8px]' : 'text-[8.5px]')}>онлайн</span></span>
        <span className="flex items-baseline gap-1"><b className={cls('text-[14px] tabular-nums', st.offline ? 'text-crit' : 'text-dim')}>{st.offline}</b><span className={cls('font-bold uppercase tracking-wider text-dim', dense ? 'text-[8px]' : 'text-[8.5px]')}>офлайн</span></span>
      </div>

      {allTargets.length === 0 ? (
        <p className="mt-3 text-[12px] text-dim">Цели не заданы. Добавьте IP/диапазоны в «Хабы → Изменить».</p>
      ) : (
        <div className={cls('space-y-2', dense && 'mt-2 space-y-1.5')}>
          {allTargets.map((target) => {
            const targetStats = pingStats([target]);
            // Имя цели: кастомное имя группы; если имени нет — свёрнутый вид диапазона/списка,
            // а не полный перечень IP через запятую (иначе заголовок не читается)
            const displayName = targetDisplayName(target);
            const fullRange = (target.range || target.target || '').trim();
            const hasResults = Array.isArray(target.results) && target.results.length > 0;
            const targetKey = target.target || displayName;
            const isExpanded = expandedTargets[targetKey] ?? false; // По умолчанию закрыто
            
            return (
              <div key={targetKey} className="overflow-hidden rounded-lg border border-line/40 bg-raised/30 transition-all">
                {/* Заголовок подгруппы - всегда виден, кликабельный */}
                <button 
                  onClick={() => toggleTarget(targetKey)}
                  className={cls('flex w-full items-center justify-between border-b border-line/30 bg-raised/50 px-3 transition-colors hover:bg-raised/70', dense ? 'py-1.5' : 'py-2.5')}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-raised/70">
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-mut" /> : <ChevronDown className="h-4 w-4 text-mut" />}
                    </div>
                    <LayoutGrid className={cls('shrink-0 text-mut', dense ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
                    <span className={cls('truncate font-mono font-bold text-ink', dense ? 'text-[11px]' : 'text-[12px]')} title={fullRange || undefined}>{displayName}</span>
                    {!dense && target.range && !target.name && <span className="shrink-0 font-mono text-[10px] text-dim" title={fullRange}>({target.range.split(',').length > 1 ? `${target.range.split(',').length} адресов` : target.range})</span>}
                  </div>
                  <div className={cls('flex shrink-0 items-center gap-2 font-mono', dense ? 'text-[9.5px]' : 'text-[10.5px]')}>
                    <span className={cls(targetStats.offline > 0 ? 'text-crit' : 'text-ok')}>
                      {targetStats.online}/{targetStats.total}
                    </span>
                    <span className="text-dim">{hasResults ? target.results!.length : 0} устр.</span>
                  </div>
                </button>
                
                {/* Список устройств в подгруппе - раскрывающийся */}
                {isExpanded && hasResults ? (
                  <div className={cls('space-y-1 overflow-y-auto scroll-thin p-2', dense ? 'max-h-56' : 'max-h-48')}>
                    {(target.results || []).map((r) => {
                      // Форматирование времени в офлайне за 30 дней
                      const formatOfflineDuration = (ms?: number | null) => {
                        if (!ms || ms <= 0) return '—';
                        const minutes = Math.floor(ms / 60000);
                        const hours = Math.floor(minutes / 60);
                        const days = Math.floor(hours / 24);
                        if (days > 0) return `${days}д ${hours % 24}ч`;
                        if (hours > 0) return `${hours}ч ${minutes % 60}м`;
                        return `${minutes}м`;
                      };
                      const offlineDuration = formatOfflineDuration(r.offlineDuration30d);
                      
                      // Форматирование последнего успешного пинга в формате ДД.ММ.ГГГГ ЧЧ:ММ:СС
                      const formatLastSuccess = (ts?: number | null) => {
                        if (ts == null || ts <= 0) return '—';
                        try {
                          const date = new Date(ts);
                          const dd = String(date.getDate()).padStart(2, '0');
                          const mm = String(date.getMonth() + 1).padStart(2, '0');
                          const yyyy = date.getFullYear();
                          const hh = String(date.getHours()).padStart(2, '0');
                          const min = String(date.getMinutes()).padStart(2, '0');
                          const ss = String(date.getSeconds()).padStart(2, '0');
                          return `${dd}.${mm}.${yyyy} ${hh}:${min}:${ss}`;
                        } catch {
                          return '—';
                        }
                      };
                      const lastSuccessStr = formatLastSuccess(r.lastSuccess);
                      
                      return (
                        <div key={r.ip} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-line/40 bg-panel/50 px-2.5 transition-colors hover:bg-raised/60" style={{ padding: dense ? '3px 8px' : '6px 10px' }}>
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                            {r.alive ? <Wifi className="h-3.5 w-3.5 shrink-0 text-ok" /> : <WifiOff className="h-3.5 w-3.5 shrink-0 text-crit" />}
                            <span className={cls('font-mono text-mut', dense ? 'text-[10.5px]' : 'text-[11.5px]')}>{r.ip}</span>
                            {/* Потери серии пакетов — только статусные метрики, задержки в «Хабах» не показываем */}
                            {r.alive && r.lossPct != null && r.lossPct > 0 && (
                              <span className="font-mono text-[9px] text-crit" title={`Потери: ${r.received ?? 0}/${r.sent ?? '?'} пакетов серии`}>потери {r.lossPct}%</span>
                            )}
                            <span className="w-full font-mono text-[9px] md:w-auto md:inline" style={{ fontWeight: 600 }}>
                              последний успех: <span className={lastSuccessStr === '—' ? 'text-crit' : 'text-dim'}>{lastSuccessStr}</span>
                            </span>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-0.5">
                            {/* Статус устройства вместо задержки (RTTrelay даёт одинаковый для всех IP) */}
                            <span className={cls('font-mono font-semibold', dense ? 'text-[10.5px]' : 'text-[11.5px]', r.alive ? 'text-ok' : 'text-crit')}>
                              {r.alive ? 'онлайн' : 'офлайн'}
                            </span>
                            {/* Счётчик серии ICMP: отправлено/принято. Жёлтый — потеряно 2 из 10, красный — 3 и больше. */}
                            {(() => {
                              const sent = typeof r.sent === 'number' && r.sent > 0 ? r.sent : null;
                              if (sent == null) return null;
                              const recv = typeof r.received === 'number' ? Math.min(r.received, sent) : (r.alive ? sent : 0);
                              const lost = sent - recv;
                              const color = lost >= 3 ? 'text-crit' : lost >= 2 ? 'text-warn' : 'text-dim';
                              return (
                                <span className={cls('font-mono text-[9px] tabular-nums', color)}
                                  title={`Серия ICMP на агенте: отправлено ${sent}, принято ${recv}, потеряно ${lost}${r.lossPct != null ? ` (${r.lossPct}%)` : ''}. Жёлтый — потеряно 2 из 10, красный — 3 и больше из 10`}>
                                  ↑{sent} ↓{recv}
                                </span>
                              );
                            })()}
                            {r.offlineSince != null && r.offlineSince > 0 && (
                              <span className="font-mono text-[9px] text-dim">офлайн с: {formatLastSuccess(r.offlineSince)}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : isExpanded ? (
                  <p className="p-3 text-[11.5px] text-dim">Нет данных</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between font-mono text-[10.5px] text-dim">
        <span>{st.offline === 0 ? 'все устройства в сети' : `есть офлайн: ${st.offline}`}</span>
        {a.lastPoll > 0 && <TimeAgo ts={a.lastPoll} />}
      </div>
    </div>
  );
});

export default function AgentPings() {
  const user = useCurrentUser();
  const agents = usePluto((s) => agentsWithPings(s, user));
  const [q, setQ] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);

  const list = useMemo(() => {
    const query = typeof q === 'string' ? q.trim().toLowerCase() : '';
    return agents.filter((a) => {
      if (query && !a.name.toLowerCase().includes(query) && !a.ip.includes(query)) return false;
      const targetsList = Array.isArray(a.targets) ? a.targets : [];
      if (onlyIssues && pingStats(targetsList).offline === 0) return false;
      return true;
    });
  }, [agents, q, onlyIssues]);

  const totalDevices = useMemo(() => agents.reduce((acc, a) => {
    const targetsList = Array.isArray(a.targets) ? a.targets : [];
    return acc + pingStats(targetsList).total;
  }, 0), [agents]);
  
  const totalOnline = useMemo(() => agents.reduce((acc, a) => {
    const targetsList = Array.isArray(a.targets) ? a.targets : [];
    return acc + pingStats(targetsList).online;
  }, 0), [agents]);

  return (
    <div className="space-y-4">
      <Panel title={`Активность хабов · ${totalOnline}/${totalDevices} устройств онлайн`} icon={<Crosshair className="h-4 w-4" />}>
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
            text="Добавьте агенту цели для пинга (IP, диапазон или подсеть) в «Хабы → Изменить» — результаты появятся здесь."
            action={<button onClick={() => store.nav('agents')} className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">К агентам</button>} />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(clamp(280px,100%,560px),1fr))] lg:[grid-template-columns:repeat(auto-fill,minmax(400px,1fr))]">
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
