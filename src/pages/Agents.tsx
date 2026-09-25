// ─── PLUTO: relay-агенты (пинг через ПК + Glances) ──────────────────────────
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Star, Trash2, RefreshCw, Monitor, Search, BarChart3, Waves, Server, Activity,
} from 'lucide-react';
import { Panel, StatusDot, Modal, Field, EmptyState } from '../components/ui';
import { store, useCurrentUser, usePluto, visibleAgents } from '../lib/store';
import { cls, fmtMs, fmtUp, isIp, isTarget, expandTargets, uid } from '../lib/util';
import type { Agent, StatsView } from '../lib/types';

function StatsViewPicker({ value, onChange, compact }: { value: StatsView; onChange: (v: StatsView) => void; compact?: boolean }) {
  const opts: { v: StatsView; icon: React.ReactNode; label: string; on: string }[] = [
    { v: 'bars', icon: <BarChart3 className="h-4 w-4" />, label: 'Статистика Bars', on: 'text-vio border-vio/60 bg-vio/15' },
    { v: 'ws', icon: <Waves className="h-4 w-4" />, label: 'Статистика WS', on: 'text-blu border-blu/60 bg-blu/15' },
  ];
  return (
    <div className="space-y-2">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Показывать в статистике</span>
      <div className="flex gap-2">
        {opts.map((o) => (
          <button key={o.v} onClick={() => onChange(value === o.v ? '' : o.v)} title={o.label}
            className={cls('flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-semibold transition-all',
              value === o.v ? o.on : 'border-line bg-raised/50 text-dim hover:text-mut')}>
            {o.icon}{!compact && <span>{o.label}</span>}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-dim/80">{value ? `Агент попадёт во вкладку «${value === 'bars' ? 'Статистика Bars' : 'Статистика WS'}». Повторный клик снимает выбор.` : 'Ни одна вкладка не выбрана — агент останется только в «Агентах».'}</p>
    </div>
  );
}

interface PingTargetEntry {
  id: string;
  name: string;
  range: string;
}

function AgentModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Agent | null }) {
  const tags = usePluto((s) => s.tags);
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [pingTargets, setPingTargets] = useState<PingTargetEntry[]>([]);
  const [statsView, setStatsView] = useState<StatsView>('');
  const [selTags, setSelTags] = useState<string[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (initial) {
      setName(initial.name); setIp(initial.ip); setRelayUrl(initial.relayUrl);
      const targets = Array.isArray(initial.pingTargets) 
        ? initial.pingTargets.map((t: any, i: number) => ({
            id: `tgt-${i}-${Date.now()}`,
            name: typeof t === 'object' ? (t.name || '') : '',
            range: typeof t === 'object' ? (t.range || String(t)) : String(t),
          }))
        : [];
      setPingTargets(targets.length ? targets : [{ id: uid('tgt'), name: '', range: '' }]);
      setStatsView(initial.statsView); setSelTags(initial.tags);
    } else {
      setName(''); setIp(''); setRelayUrl('');
      setPingTargets([{ id: uid('tgt'), name: '', range: '' }]);
      setStatsView(''); setSelTags([]);
    }
  }, [open, initial]);

  const addTarget = () => setPingTargets((prev) => [...prev, { id: uid('tgt'), name: '', range: '' }]);
  const removeTarget = (id: string) => setPingTargets((prev) => prev.length > 1 ? prev.filter((t) => t.id !== id) : prev);
  const updateTarget = (id: string, field: 'name' | 'range', value: string) =>
    setPingTargets((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));

  const save = async () => {
    setErr('');
    if (!name.trim()) return setErr('Укажите имя');
    if (!isIp(ip.trim())) return setErr('IP-адрес ПК в формате 192.168.1.10');
    const targets = pingTargets
      .filter((t) => t.range.trim())
      .map((t) => ({ name: t.name.trim(), range: t.range.trim() }));
    const bad = targets.find((t) => !isTarget(t.range));
    if (bad) return setErr(`Некорректная цель: «${bad.range}». Форматы: 10.0.0.5, список через запятую 10.0.0.5,10.0.0.77, 10.0.0.1-20, 10.0.0.0/24, 10.0.0.0/24:5,77,100`);
    // Телеметрия (glancesUrl/netdataUrl/telemetryUrl/telemetrySource) намеренно не отправляется —
    // она перенесена в раздел «Мониторинг» и настраивается там.
    const body = {
      name: name.trim(),
      ip: ip.trim(),
      relayUrl: relayUrl.trim(),
      pingTargets: targets,
      tags: selTags,
      statsView
    };
    try {
      if (initial) await store.updateAgent(initial.id, body);
      else await store.addAgent(body);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Не удалось сохранить'); }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Изменить агента' : 'Новый relay-агент'}>
      <div className="space-y-4">
        <Field label="Имя"><input className="inp" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="Офис — ПК бухгалтера" /></Field>
        <Field label="IP-адрес ПК" hint="Сервер будет пинговать этот адрес: доступность и статистика uptime">
          <input className="inp font-mono" value={ip} onChange={(e) => { setIp(e.target.value); setErr(''); }} placeholder="192.168.1.10" />
        </Field>
        <Field label="Адрес pluto-relay" hint="HTTP-адрес relay на этом ПК, порт по умолчанию 8091. Нужен для пинга устройств внутри VLAN.">
          <input className="inp font-mono" value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} placeholder="http://192.168.1.10:8091" />
        </Field>

        <p className="rounded-lg border border-line/60 bg-raised/30 px-3 py-2 text-[11.5px] text-dim">
          Телеметрия (CPU, температуры, диски) и её источник настраиваются в отдельной вкладке <span className="font-semibold text-mut">«Мониторинг»</span>.
        </p>

        {/* Динамические поля: цели для пинга с кастомными именами */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Цели для пинга</span>
            <button onClick={addTarget} className="text-[11px] font-semibold text-vio hover:text-vio/80">+ Добавить группу</button>
          </div>
          <div className="space-y-2">
            {pingTargets.map((t, idx) => (
              <div key={t.id} className="flex items-center gap-2">
                <input
                  className="inp flex-1 font-mono text-[11px]"
                  placeholder="Имя группы (опционально)"
                  value={t.name}
                  onChange={(e) => updateTarget(t.id, 'name', e.target.value)}
                />
                <input
                  className="inp flex-[2] font-mono text-[11px]"
                  placeholder="IP / список через запятую / диапазон / подсеть / подсеть:хосты (10.0.0.5, 10.0.0.5,10.0.0.77, 10.0.0.1-20, 10.0.0.0/24, 10.0.0.0/24:5,77,100)"
                  value={t.range}
                  onChange={(e) => updateTarget(t.id, 'range', e.target.value)}
                />
                <button
                  onClick={() => removeTarget(t.id)}
                  disabled={pingTargets.length === 1}
                  className="rounded-md p-2 text-dim transition-colors hover:bg-raised hover:text-crit disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-dim">Каждая строка — отдельная группа целей. Имя опционально, диапазон обязателен. Можно перечислить адреса через запятую: <span className="font-mono">10.0.0.5,10.0.0.77</span>. Если нужны не все IP подсети, укажите их списком после двоеточия: <span className="font-mono">10.0.0.0/24:5,77,100</span>.</p>
        </div>

        <StatsViewPicker value={statsView} onChange={setStatsView} />

        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Теги</span>
          {tags.length === 0 ? (
            <p className="text-[11.5px] text-dim">Тегов пока нет — создайте их в «Настройки → Теги», затем присвойте здесь.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const on = selTags.includes(t.id);
                return (
                  <button key={t.id} onClick={() => setSelTags((s) => on ? s.filter((x) => x !== t.id) : [...s, t.id])}
                    className={cls('rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all', on ? 'text-void' : 'text-mut')}
                    style={{ borderColor: t.color, background: on ? t.color : 'transparent' }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {err && <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}
        <button onClick={save} className="btn-acc w-full justify-center"><Plus className="h-4 w-4" />{initial ? 'Сохранить' : 'Добавить агента'}</button>
      </div>
    </Modal>
  );
}

function AgentCard({ a, onEdit }: { a: Agent; onEdit: (a: Agent) => void }) {
  const tags = usePluto((s) => s.tags);
  const off = !a.online;
  // количество IP под пингом: по фактическим результатам, иначе по настроенным диапазонам
  const ipCount = useMemo(() => {
    const fromResults = a.targets.reduce((n, t) => n + (Array.isArray(t.results) ? t.results.length : 0), 0);
    if (fromResults > 0) return fromResults;
    return a.pingTargets.reduce((n, t) => {
      const expanded = expandTargets(t.range || '');
      return n + (expanded.length || 1);
    }, 0);
  }, [a.targets, a.pingTargets]);
  const rangesCount = Math.max(a.pingTargets.filter((t) => (t.range || '').trim()).length, a.targets.length);
  const tagObjs = a.tags.map((id) => tags.find((t) => t.id === id)).filter(Boolean) as { id: string; label: string; color: string }[];
  return (
    <div className="rise rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:border-vio/35 hover:shadow-[0_14px_40px_-16px_rgba(0,0,0,.8)]">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => onEdit(a)} className="min-w-0 text-left">
          <div className="text-[14px] font-semibold text-ink">
            <span className="truncate">{a.name}</span>
          </div>
          <div className="font-mono text-[11px] text-dim">{a.ip}</div>
          {tagObjs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">{tagObjs.map((t) => <span key={t.id} className="rounded-full border px-2 py-px text-[9.5px] font-semibold" style={{ borderColor: t.color, color: t.color }}>{t.label}</span>)}</div>
          )}
        </button>
        <div className="flex items-center gap-1">
          <button onClick={() => store.toggleAgentFav(a.id)} title="В избранное" className={cls('rounded-md p-1.5 transition-all hover:bg-raised', a.favorite ? 'text-warn' : 'text-dim/40 hover:text-dim')}>
            <Star className={cls('h-4 w-4', a.favorite && 'fill-warn')} strokeWidth={1.5} />
          </button>
          <button onClick={() => void store.pollAgentNow(a.id)} title="Опросить сейчас" className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-vio">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => onEdit(a)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-dim transition-colors hover:bg-raised hover:text-ink">Изм.</button>
          <button onClick={() => { if (window.confirm(`Удалить агента «${a.name}»?`)) void store.removeAgent(a.id); }} className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-crit">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* только пинг-данные: диапазоны под пингом, количество IP, пинг до хаба */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', 'text-mint')}>{rangesCount}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">диапазонов</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', 'text-vio')}>{ipCount}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">IP под пингом</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-blu')}>{fmtMs(a.latency)}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">пинг до хаба, мс</div></div>
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[10.5px] text-dim">
        <span className="flex items-center gap-1.5"><StatusDot status={a.online ? 'up' : 'down'} />{a.online ? `в сети ${fmtUp(Date.now() - (a.onlineSince || Date.now()))}` : 'офлайн'}</span>
        <button onClick={() => store.nav('monitoring', a.ip)} className="flex items-center gap-1 text-dim transition-colors hover:text-vio" title="Открыть телеметрию хаба во вкладке «Мониторинг»">
          <Activity className="h-3 w-3" /> телеметрия
        </button>
      </div>
    </div>
  );
}

export default function Agents() {
  const user = useCurrentUser();
  const agents = usePluto((s) => visibleAgents(s, user));
  const isAdmin = user?.role === 'admin';
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ open: boolean; initial: Agent | null }>({ open: false, initial: null });

  const list = useMemo(() => {
    const query = typeof q === 'string' ? q.trim().toLowerCase() : '';
    if (!query) return agents;
    return agents.filter((a) => a.name.toLowerCase().includes(query) || a.ip.includes(query));
  }, [agents, q]);

  const onEdit = (a: Agent) => setModal({ open: true, initial: a });

  // Упрощённый вид по умолчанию: хабы + диапазоны под пингом + количество пингуемых IP
  const summary = useMemo(() => {
    let totalPings = 0, totalRanges = 0;
    for (const a of agents) {
      for (const t of a.pingTargets) {
        if (!(t.range || '').trim()) continue;
        totalRanges++;
        const expanded = expandTargets(t.range || '');
        totalPings += expanded.length || 1;
      }
    }
    return { count: agents.length, pings: totalPings, ranges: totalRanges };
  }, [agents]);

  return (
    <div className="space-y-4">
      {/* Упрощённая сводка — вид по умолчанию */}
      <Panel title="Сводка · Хабы" icon={<Server className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-center">
            <div className="font-mono text-[28px] font-bold text-vio">{summary.count}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dim">Всего хабов</div>
          </div>
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-center">
            <div className="font-mono text-[28px] font-bold text-mint">{summary.ranges}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dim">Диапазонов под пингом</div>
          </div>
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-center">
            <div className="font-mono text-[28px] font-bold text-blu">{summary.pings}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dim">IP под пингом</div>
          </div>
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-center">
            <div className="font-mono text-[28px] font-bold text-ok">{agents.filter(a => a.online).length}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dim">В сети</div>
          </div>
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-center">
            <div className="font-mono text-[28px] font-bold text-crit">{agents.filter(a => !a.online && a.lastPoll > 0).length}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dim">Офлайн</div>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-dim">
          «Хабы» показывает только пинги: доступность хаба, диапазоны и количество IP под пингом. Вся телеметрия (CPU, температуры, диски, сеть) и её настройки — во вкладке{' '}
          <button onClick={() => store.nav('monitoring')} className="font-semibold text-vio underline-offset-2 hover:underline">«Мониторинг»</button>.
        </p>
      </Panel>

      <Panel title={`Relay-агенты · ${list.length}`} icon={<Monitor className="h-4 w-4" />}
        right={isAdmin ? <button onClick={() => setModal({ open: true, initial: null })} className="btn-acc"><Plus className="h-4 w-4" />Добавить агента</button> : undefined}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-raised/50 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или IP…" className="w-44 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-dim/70" />
          </div>
          <span className="text-[11.5px] text-dim">Агент = ПК с pluto-relay: пингует устройства внутри своей сети (VLAN/NAT). Телеметрия — во вкладке «Мониторинг».</span>
        </div>

        {list.length === 0 ? (
          <EmptyState icon={<Monitor className="h-6 w-6" />} title="Агентов пока нет"
            text="Добавьте ПК с запущенным pluto-relay — через него сервер будет пинговать устройства, недоступные напрямую."
            action={isAdmin ? <button onClick={() => setModal({ open: true, initial: null })} className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">Добавить агента</button> : undefined} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.map((a) => <AgentCard key={a.id} a={a} onEdit={onEdit} />)}
          </div>
        )}
      </Panel>

      <AgentModal open={modal.open} initial={modal.initial} onClose={() => setModal({ open: false, initial: null })} />
    </div>
  );
}
