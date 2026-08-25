// ─── PLUTO: главная страница ─────────────────────────────────────────────────
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Globe, AlertTriangle, Activity, Monitor, Star, Check, Bell, Server, Rocket, Plus } from 'lucide-react';
import { Bar, Panel, Ring, Sparkbar, StatusDot, STATUS_META, Seg, TypeBadge, EmptyState, TimeAgo } from '../components/ui';
import { usePluto, useCurrentUser, visibleDevices, visibleAgents, store, FAVORITES_LIMIT } from '../lib/store';
import { cls, fmtMs, pct } from '../lib/util';
import type { EventItem, Severity } from '../lib/types';

function KpiTile({ label, value, sub, accent, icon, extra, delay }: { label: string; value: string | number; sub: string; accent: string; icon: ReactNode; extra?: ReactNode; delay: number }) {
  return (
    <div className="rise group relative overflow-hidden rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-14px_rgba(0,0,0,.8)]" style={{ animationDelay: `${delay}ms` }}>
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[0.13] blur-2xl transition-opacity group-hover:opacity-25" style={{ background: accent }} />
      <div className="flex items-start justify-between">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-dim">{label}</span>
        <span style={{ color: accent }}>{icon}</span>
      </div>
      <div className="mt-2 font-display text-[30px] font-bold leading-none tabular-nums text-ink">{value}</div>
      <div className="mt-1.5 text-[11.5px] text-dim">{sub}</div>
      {extra && <div className="mt-3">{extra}</div>}
    </div>
  );
}

const SEV_META: Record<Severity, { icon: ReactNode; bar: string }> = {
  ok: { icon: <Check className="h-3.5 w-3.5 text-ok" />, bar: 'bg-ok' },
  warn: { icon: <AlertTriangle className="h-3.5 w-3.5 text-warn" />, bar: 'bg-warn' },
  crit: { icon: <AlertTriangle className="h-3.5 w-3.5 text-crit" />, bar: 'bg-crit' },
  info: { icon: <Bell className="h-3.5 w-3.5 text-mut" />, bar: 'bg-vio' },
};

const EventRow = memo(function EventRow({ e }: { e: EventItem }) {
  const m = SEV_META[e.sev];
  return (
    <li className="ev-in relative flex gap-3 border-b border-line-soft/60 py-2.5 pl-3 pr-1 last:border-0">
      <span className={cls('absolute bottom-2 left-0 top-2 w-[2.5px] rounded-full', m.bar, e.sev === 'crit' && 'animate-pulse')} />
      <span className="mt-0.5 shrink-0">{m.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-snug text-mut">{e.text}</p>
        <TimeAgo ts={e.ts} className="mt-0.5 block font-mono text-[10px] text-dim/80" />
      </div>
    </li>
  );
});

const FavDeviceCard = memo(function FavDeviceCard({ id }: { id: string }) {
  const d = usePluto((s) => s.devices.find((x) => x.id === id));
  if (!d) return null;
  const m = STATUS_META[d.status];
  return (
    <div className="group cursor-pointer rounded-lg border border-line bg-raised/50 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40 hover:bg-raised/80" onClick={() => store.nav('devices', d.address)}>
      <div className="flex items-center gap-2">
        <StatusDot status={d.status} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{d.name}</span>
        <button onClick={(e) => { e.stopPropagation(); store.toggleDeviceFav(d.id); }} className="text-warn transition-transform hover:scale-110" title="Убрать из избранного">
          <Star className="h-4 w-4 fill-warn" strokeWidth={1.4} />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <TypeBadge t={d.type} />
        <span className={cls('font-mono text-[15px] font-bold tabular-nums', m.text)}>
          {d.status === 'down' ? 'СБОЙ' : fmtMs(d.latency)}
          {d.approx && d.status !== 'down' && <span className="ml-0.5 text-[10px] text-dim">≈</span>}
        </span>
      </div>
      <div className="mt-2.5"><Sparkbar data={d.history} height={22} width={168} /></div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-dim">
        <span>{d.address}</span>
        <span className={m.text}>{m.label}</span>
      </div>
    </div>
  );
});

const FavAgentCard = memo(function FavAgentCard({ id }: { id: string }) {
  const a = usePluto((s) => s.agents.find((x) => x.id === id));
  if (!a) return null;
  return (
    <div className="group cursor-pointer rounded-lg border border-line bg-raised/50 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40 hover:bg-raised/80" onClick={() => store.nav('agents', a.hostname || a.name)}>
      <div className="flex items-center gap-2">
        <StatusDot status={a.online ? 'up' : 'down'} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{a.name}</span>
        <button onClick={(e) => { e.stopPropagation(); store.toggleAgentFav(a.id); }} className="text-warn transition-transform hover:scale-110" title="Убрать из избранного">
          <Star className="h-4 w-4 fill-warn" strokeWidth={1.4} />
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <Ring value={a.online ? a.cpuLoad : 0} size={52} label="ЦП" color={a.cpuLoad > 85 ? '#e07a80' : '#8f7df0'} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="mb-1 flex justify-between font-mono text-[10px] text-dim">
              <span>ОЗУ</span><span className="text-mut">{a.online ? `${pct(a.ramUsed, a.ramTotal)}%` : '—'}</span>
            </div>
            <Bar value={a.online ? pct(a.ramUsed, a.ramTotal) : 0} color="#7ba4e6" />
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] text-dim">
            <span className="flex items-center gap-1 text-warn"><Activity className="h-3 w-3" />{a.online ? `${Math.round(a.cpuTemp)}°C` : '—'}</span>
            <span className="flex items-center gap-1 text-blu"><Activity className="h-3 w-3" />{a.online ? `${Math.round(a.rxRate)} КБ/с` : '—'}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-dim">
        <span>{a.ip}</span>
        <span className={a.online ? 'text-ok' : 'text-crit'}>{a.online ? 'в сети' : 'офлайн'}</span>
      </div>
    </div>
  );
});

function FleetSpark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-full w-full rounded border border-dashed border-line/70" />;
  const w = 140, h = 30;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / 100) * (h - 6)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="none">
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="rgba(143,125,240,.14)" />
      <polyline points={pts} fill="none" stroke="#8f7df0" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Onboarding({ isServer, isAdmin }: { isServer: boolean; isAdmin: boolean }) {
  const steps = [
    {
      icon: <Server className="h-4 w-4" />, title: 'Добавьте первое устройство',
      text: 'Ping, HTTP, API-команда, RTSP или SIP — с кастомным интервалом опроса и тегами.',
      act: () => store.nav('devices', 'new'), label: 'Добавить устройство', show: isAdmin,
    },
    {
      icon: <Monitor className="h-4 w-4" />, title: 'Подключите агента',
      text: isServer
        ? 'Создайте токен в разделе «Агенты» и запустите одну команду на Windows-машине — телеметрия появится в течение секунд.'
        : 'Реальные Windows-машины подключаются токеном после развёртывания сервера.',
      act: () => store.nav('agents', 'new'), label: isServer ? 'Получить токен агента' : 'Раздел агентов', show: isAdmin,
    },
    {
      icon: <Rocket className="h-4 w-4" />, title: isServer ? 'Агенты для Windows' : 'Разверните ядро и агенты',
      text: isServer
        ? 'Ядро уже работает. Осталось поставить агенты: одна команда PowerShell на каждой машине.'
        : 'docker compose up -d --build на Ubuntu и одна команда PowerShell на каждой Windows-машине.',
      act: () => store.nav('deploy'), label: 'Инструкция по развёртыванию', show: true,
    },
  ].filter((s) => s.show);

  return (
    <Panel title="Первый запуск · чистая база" icon={<Activity className="h-4 w-4" />} delay={80}>
      <div className="grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="rise flex flex-col rounded-lg border border-line bg-raised/40 p-4" style={{ animationDelay: `${140 + i * 70}ms` }}>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-vio-deep/30 text-vio ring-1 ring-vio/25">{s.icon}</span>
              <span className="font-mono text-[10px] font-bold text-dim">ШАГ {i + 1}</span>
            </div>
            <h3 className="mt-3 text-[14px] font-bold text-ink">{s.title}</h3>
            <p className="mt-1 flex-1 text-[12px] leading-relaxed text-dim">{s.text}</p>
            <button onClick={s.act} className="mt-3.5 inline-flex items-center gap-1.5 self-start rounded-md border border-vio/35 bg-vio/10 px-3 py-1.5 text-[12px] font-semibold text-vio transition-all hover:border-vio/60 hover:bg-vio/20">
              {s.label} <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default function Dashboard() {
  const user = useCurrentUser();
  const allDevices = usePluto((s) => s.devices);
  const allAgents = usePluto((s) => s.agents);
  const events = usePluto((s) => s.events);
  const apiMode = usePluto((s) => s.apiMode);
  const devices = useMemo(() => visibleDevices(allDevices, user), [allDevices, user]);
  const agents = useMemo(() => visibleAgents(allAgents, user), [allAgents, user]);

  const [evFilter, setEvFilter] = useState<'all' | 'crit' | 'warn'>('all');

  const favD = devices.filter((d) => d.favorite);
  const favA = agents.filter((a) => a.favorite);
  const down = devices.filter((d) => d.status === 'down').length;
  const degraded = devices.filter((d) => d.status === 'degraded').length;
  const up = devices.filter((d) => d.status === 'up').length;
  const agentsOnline = agents.filter((a) => a.online).length;
  const isAdmin = user?.role === 'admin';
  const clean = devices.length === 0 && agents.length === 0;

  const fleetSpark = useMemo(() => {
    const withHist = devices.filter((d) => d.history.length > 0);
    if (withHist.length === 0) return [];
    const len = Math.max(...withHist.map((d) => d.history.length));
    const out: number[] = [];
    for (let i = 0; i < Math.min(len, 30); i++) {
      let ok = 0, tot = 0;
      for (const d of withHist) {
        const idx = d.history.length - (Math.min(len, 30) - i);
        if (idx >= 0) { tot++; if (d.history[idx] >= 0) ok++; }
      }
      out.push(tot ? (ok / tot) * 100 : 0);
    }
    return out;
  }, [devices]);

  const evList = useMemo(() => {
    return events.filter((e) => {
      if (evFilter !== 'all' && e.sev !== evFilter) return false;
      if (isAdmin) return true;
      if (e.source === 'agent') return user?.scope.includes('agent') ?? false;
      if (e.source === 'device') return devices.some((d) => e.text.includes(d.address) || e.text.includes(d.name));
      return true;
    });
  }, [events, evFilter, isAdmin, user, devices]);

  return (
    <div className="space-y-4">
      {clean && <Onboarding isServer={apiMode === 'server'} isAdmin={!!isAdmin} />}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-[1.35fr_1fr_1fr_1.15fr]">
        <KpiTile label="Устройства в сети" value={devices.length} accent="#8f7df0" delay={0}
          icon={<Globe className="h-[18px] w-[18px]" />}
          sub={devices.length ? `${up} доступно · ${devices.length - up} прочее` : 'устройства ещё не добавлены'}
          extra={<div className="flex items-end gap-2"><div className="h-[30px] flex-1"><FleetSpark values={fleetSpark} /></div><span className="pb-0.5 font-mono text-[10px] text-dim">доступность</span></div>} />
        <button onClick={() => store.nav('devices', 'down')} className="cursor-pointer text-left">
          <KpiTile label="В аварии" value={down} accent="#e07a80" delay={60}
            icon={<AlertTriangle className="h-[18px] w-[18px]" />}
            sub={down ? 'потеря связи · нажмите для списка' : 'потерь связи нет'}
            extra={down > 0 ? <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-crit"><span className="dot-crit h-1.5 w-1.5 rounded-full bg-crit" />требует внимания</span> : <span className="font-mono text-[10.5px] text-ok">все каналы отвечают</span>} />
        </button>
        <KpiTile label="Деградация связи" value={degraded} accent="#dfa65e" delay={120}
          icon={<Activity className="h-[18px] w-[18px]" />}
          sub={degraded ? 'пинг выше нормы в разы' : 'задержки в пределах нормы'} />
        <KpiTile label="Агенты в сети" value={`${agentsOnline}/${agents.length}`} accent="#7ba4e6" delay={180}
          icon={<Monitor className="h-[18px] w-[18px]" />}
          sub={agents.length ? `телеметрия ${agentsOnline} машин(ы)` : 'агенты не подключены'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_330px]">
        <Panel title="Избранное" icon={<Star className="h-4 w-4" />} delay={140}
          right={<span className="font-mono text-[11px] text-dim">{favD.length + favA.length} / {FAVORITES_LIMIT}</span>}>
          {favD.length + favA.length === 0 ? (
            <EmptyState title="Закрепите важное"
              text="Отмечайте звёздочкой агентов и устройства в общих списках — до 15 элементов с краткой сводкой статуса будут жить здесь." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {favA.map((a) => <FavAgentCard key={a.id} id={a.id} />)}
              {favD.map((d) => <FavDeviceCard key={d.id} id={d.id} />)}
            </div>
          )}
        </Panel>

        <Panel title="Журнал событий" icon={<Activity className="h-4 w-4" />} delay={200}
          right={<Seg options={[{ v: 'all' as const, label: 'Все' }, { v: 'crit' as const, label: 'Аварии' }, { v: 'warn' as const, label: 'Предупр.' }]} value={evFilter} onChange={setEvFilter} />}
          bodyClass="p-0" className="xl:flex xl:max-h-[640px] xl:flex-col xl:overflow-hidden">
          {evList.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-dim">Событий этой категории пока нет</p>
          ) : (
            <ul className="max-h-[520px] overflow-y-auto px-3 py-1 scroll-thin xl:flex-1">
              {evList.slice(0, 60).map((e) => <EventRow key={e.id} e={e} />)}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
