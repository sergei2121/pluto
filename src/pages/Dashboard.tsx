// ─── PLUTO: главная ──────────────────────────────────────────────────────────
import { memo, useMemo, useState } from 'react';
import { Globe, AlertTriangle, Activity, Monitor, Star, Server, Rocket, LayoutGrid, Check, Bell, Crosshair } from 'lucide-react';
import { Panel, StatusDot, STATUS_META, Sparkbar, Seg, TypeBadge, EmptyState, TimeAgo } from '../components/ui';
import { FAVORITES_LIMIT, store, useCurrentUser, usePluto, visibleAgents, visibleDevices } from '../lib/store';
import { cls, fmtMs, fmtUp, fmtNet, pingStats } from '../lib/util';
import type { Agent, Device, EventItem, Severity } from '../lib/types';

const SEV_META: Record<Severity, { icon: React.ReactNode; cls: string; bar: string }> = {
  ok: { icon: <Check className="h-3.5 w-3.5" />, cls: 'text-ok', bar: 'bg-ok' },
  warn: { icon: <AlertTriangle className="h-3.5 w-3.5" />, cls: 'text-warn', bar: 'bg-warn' },
  crit: { icon: <AlertTriangle className="h-3.5 w-3.5" />, cls: 'text-crit', bar: 'bg-crit' },
  info: { icon: <Bell className="h-3.5 w-3.5" />, cls: 'text-mut', bar: 'bg-vio' },
};

const EventRow = memo(function EventRow({ e }: { e: EventItem }) {
  const m = SEV_META[e.sev];
  return (
    <li className="ev-in relative flex gap-3 border-b border-line/40 py-2.5 pl-3 pr-1 last:border-0">
      <span className={cls('absolute bottom-2 left-0 top-2 w-[2.5px] rounded-full', m.bar, e.sev === 'crit' && 'animate-pulse')} />
      <span className={cls('mt-0.5 shrink-0', m.cls)}>{m.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-snug text-mut">{e.text}</p>
        <TimeAgo ts={e.ts} className="mt-0.5 block font-mono text-[10px] text-dim/80" />
      </div>
    </li>
  );
});

function KpiTile({ label, value, sub, accent, icon, delay, onClick }: {
  label: string; value: string | number; sub: string; accent: string; icon: React.ReactNode; delay: number; onClick?: () => void;
}) {
  return (
    <button onClick={onClick}
      className="rise group relative overflow-hidden rounded-xl border border-line bg-panel/90 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-line/80 hover:shadow-[0_14px_40px_-14px_rgba(0,0,0,.8)]"
      style={{ animationDelay: `${delay}ms` }}>
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[0.13] blur-2xl transition-opacity group-hover:opacity-25" style={{ background: accent }} />
      <div className="flex items-start justify-between">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-dim">{label}</span>
        <span style={{ color: accent }}>{icon}</span>
      </div>
      <div className="mt-2 font-display text-[30px] font-bold leading-none tabular-nums text-ink">{value}</div>
      <div className="mt-1.5 text-[11.5px] text-dim">{sub}</div>
    </button>
  );
}

const FavDeviceCard = memo(function FavDeviceCard({ id }: { id: string }) {
  const d = usePluto((s) => s.devices.find((x) => x.id === id));
  if (!d) return null;
  const m = STATUS_META[d.status];
  return (
    <div className="group cursor-pointer rounded-lg border border-line bg-raised/50 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40 hover:bg-raised/80"
      onClick={() => store.nav('devices', d.address)}>
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
        </span>
      </div>
      <div className="mt-2.5"><Sparkbar data={d.history} height={22} width={168} /></div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-dim">
        <span>{d.address}</span><span className={m.text}>{m.label}</span>
      </div>
    </div>
  );
});

const FavAgentCard = memo(function FavAgentCard({ id }: { id: string }) {
  const a = usePluto((s) => s.agents.find((x) => x.id === id));
  if (!a) return null;
  const g = a.glancesLatest;
  const off = !a.online;
  return (
    <div className="group cursor-pointer rounded-lg border border-line bg-raised/50 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40 hover:bg-raised/80"
      onClick={() => store.nav('agents', a.ip)}>
      <div className="flex items-center gap-2">
        <StatusDot status={a.online ? 'up' : 'down'} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{a.name}</span>
        <button onClick={(e) => { e.stopPropagation(); store.toggleAgentFav(a.id); }} className="text-warn transition-transform hover:scale-110" title="Убрать из избранного">
          <Star className="h-4 w-4 fill-warn" strokeWidth={1.4} />
        </button>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-vio')}>{off || g?.cpu == null ? '—' : `${Math.round(g.cpu)}%`}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">CPU</div>
        </div>
        <div>
          <div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : g?.cput != null && g.cput > 75 ? 'text-crit' : 'text-warn')}>{off || g?.cput == null ? '—' : `${Math.round(g.cput)}°`}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">t°C CPU</div>
        </div>
        <div>
          <div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-blu')}>{a.latency != null ? `${a.latency}` : '—'}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">пинг, мс</div>
        </div>
        <div>
          <div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-mint')}>{off || g?.ram == null ? '—' : `${Math.round(g.ram)}%`}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">RAM</div>
        </div>
        <div>
          <div className={cls('font-mono text-[13px] font-bold leading-[19px]', off ? 'text-dim' : 'text-ok')}>{off || !g ? '—' : `↓${fmtNet(g.rx ?? null)}`}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">сеть RX</div>
        </div>
        <div>
          <div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-[#d98bb0]')}>{off || g?.ssdt == null ? '—' : `${Math.round(g.ssdt)}°`}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">t° SSD</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between font-mono text-[10px] text-dim">
        <span>{a.ip}</span>
        <span className={a.online ? 'text-ok' : 'text-crit'}>{a.online ? `в сети ${fmtUp(Date.now() - (a.onlineSince || Date.now()))}` : 'офлайн'}</span>
      </div>
    </div>
  );
});

/** Компактное окно «Пинги агентов» для избранного на главной. */
const FavAgentPingsCard = memo(function FavAgentPingsCard({ id }: { id: string }) {
  const a = usePluto((s) => s.agents.find((x) => x.id === id));
  if (!a) return null;
  const st = pingStats(a.targets);
  const pct = st.total ? Math.round((st.online / st.total) * 100) : 0;
  return (
    <div className="group cursor-pointer rounded-lg border border-line bg-raised/50 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40 hover:bg-raised/80"
      onClick={() => store.nav('agent-pings')}>
      <div className="flex items-center gap-2">
        <span className="text-vio"><Crosshair className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{a.name} · пинги</span>
        <button onClick={(e) => { e.stopPropagation(); store.toggleAgentPingsFav(a.id); }} className="text-warn transition-transform hover:scale-110" title="Убрать с главной">
          <Star className="h-4 w-4 fill-warn" strokeWidth={1.4} />
        </button>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="font-mono text-[15px] font-bold text-ink">{st.total}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">всего</div>
        </div>
        <div>
          <div className={cls('font-mono text-[15px] font-bold', st.offline > 0 ? 'text-warn' : 'text-ok')}>{st.online}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">онлайн</div>
        </div>
        <div>
          <div className="font-mono text-[15px] font-bold text-blu">{fmtMs(st.avg)}</div>
          <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">ср. пинг</div>
        </div>
      </div>
      <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-raised/70">
        <div className="bg-ok transition-all duration-500" style={{ width: `${pct}%` }} />
        {st.offline > 0 && <div className="bg-crit transition-all duration-500" style={{ width: `${100 - pct}%` }} />}
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-dim">
        <span>{a.ip}</span>
        <span className={st.offline > 0 ? 'text-warn' : 'text-ok'}>{st.total ? `доступно ${pct}%` : 'нет целей'}</span>
      </div>
    </div>
  );
});

function Onboarding() {
  const steps = [
    { icon: <Server className="h-4 w-4" />, title: 'Добавьте устройство', text: 'PING, HTTP, API, RTSP или SIP — с тегами, интервалом и диапазоном IP.', act: () => store.nav('devices', 'new'), label: 'Добавить устройство' },
    { icon: <Monitor className="h-4 w-4" />, title: 'Поставьте relay на ПК', text: 'pluto-relay пингует устройства, доступные только этой машине (NAT/VLAN).', act: () => store.nav('agents', 'new'), label: 'Добавить агента' },
    { icon: <LayoutGrid className="h-4 w-4" />, title: 'Соберите витрину', text: 'Публичный статус без входа — на отдельном порту, только список.', act: () => store.nav('showcase'), label: 'Открыть витрину' },
    { icon: <Rocket className="h-4 w-4" />, title: 'Разверните ядро', text: 'docker compose up -d --build на Ubuntu; консоль подключится сама.', act: () => store.nav('deploy'), label: 'Инструкция' },
  ];
  return (
    <Panel title="Первый запуск · чистая база" icon={<Activity className="h-4 w-4" />} delay={80}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.title} className="rise flex flex-col rounded-lg border border-line bg-raised/40 p-4" style={{ animationDelay: `${140 + i * 70}ms` }}>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-vio/15 text-vio ring-1 ring-vio/25">{s.icon}</span>
              <span className="font-mono text-[10px] font-bold text-dim">ШАГ {i + 1}</span>
            </div>
            <h3 className="mt-3 text-[14px] font-bold text-ink">{s.title}</h3>
            <p className="mt-1 flex-1 text-[12px] leading-relaxed text-dim">{s.text}</p>
            <button onClick={s.act} className="mt-3.5 inline-flex items-center self-start rounded-md border border-vio/35 bg-vio/10 px-3 py-1.5 text-[12px] font-semibold text-vio transition-all hover:border-vio/60 hover:bg-vio/20">
              {s.label}
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default function Dashboard() {
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const agents = usePluto((s) => visibleAgents(s, user));
  const events = usePluto((s) => s.events);
  const [evFilter, setEvFilter] = useState<'all' | 'crit' | 'warn'>('all');

  const favD = devices.filter((d: Device) => d.favorite);
  const favA = agents.filter((a: Agent) => a.favorite);
  const favAP = agents.filter((a: Agent) => a.pingsFavorite);

  const down = devices.filter((d) => d.status === 'down').length;
  const degraded = devices.filter((d) => d.status === 'degraded').length;
  const up = devices.filter((d) => d.status === 'up').length;
  const agentsOnline = agents.filter((a) => a.online).length;
  const clean = devices.length === 0 && agents.length === 0;

  const evList = useMemo(() => events.filter((e) => evFilter === 'all' || e.sev === evFilter), [events, evFilter]);

  return (
    <div className="space-y-4">
      {clean && <Onboarding />}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile label="Устройства в сети" value={devices.length} accent="#8f7df0" delay={0}
          icon={<Globe className="h-[18px] w-[18px]" />}
          sub={devices.length ? `${up} доступно · ${devices.length - up} прочее` : 'устройства ещё не добавлены'}
          onClick={() => store.nav('devices')} />
        <KpiTile label="В аварии" value={down} accent="#e07a80" delay={60}
          icon={<AlertTriangle className="h-[18px] w-[18px]" />}
          sub={down ? 'потеря связи · нажмите для списка' : 'потерь связи нет'}
          onClick={() => store.nav('devices', 'down')} />
        <KpiTile label="Деградация связи" value={degraded} accent="#dfa65e" delay={120}
          icon={<Activity className="h-[18px] w-[18px]" />}
          sub={degraded ? 'пинг выше нормы в разы' : 'задержки в пределах нормы'} />
        <KpiTile label="Relay-агенты" value={`${agentsOnline}/${agents.length}`} accent="#7ba4e6" delay={180}
          icon={<Monitor className="h-[18px] w-[18px]" />}
          sub={agents.length ? `${agentsOnline} ПК на связи` : 'агенты не добавлены'}
          onClick={() => store.nav('agents')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_330px]">
        <div className="space-y-4">
          <Panel title="Избранное" icon={<Star className="h-4 w-4" />} delay={140}
            right={<span className="font-mono text-[11px] text-dim">{favD.length + favA.length + favAP.length} / {FAVORITES_LIMIT}</span>}>
            {favD.length + favA.length + favAP.length === 0 ? (
              <EmptyState icon={<Star className="h-6 w-6" />} title="Закрепите важное"
                text="Отмечайте звёздочкой устройства, relay-агентов и их пинги — до 15 элементов с краткой сводкой статуса будут жить здесь." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {favA.map((a) => <FavAgentCard key={a.id} id={a.id} />)}
                {favAP.map((a) => <FavAgentPingsCard key={`ap-${a.id}`} id={a.id} />)}
                {favD.map((d) => <FavDeviceCard key={d.id} id={d.id} />)}
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Журнал событий" icon={<Activity className="h-4 w-4" />} delay={220}
          right={<Seg options={[{ v: 'all' as const, label: 'Все' }, { v: 'crit' as const, label: 'Аварии' }, { v: 'warn' as const, label: 'Предупр.' }]} value={evFilter} onChange={setEvFilter} />}
          bodyClass="p-0" className="xl:max-h-[640px] xl:flex xl:flex-col xl:overflow-hidden">
          {evList.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-dim">Событий этой категории пока нет</p>
          ) : (
            <ul className="scroll-thin max-h-[520px] overflow-y-auto px-3 py-1 xl:flex-1">
              {evList.slice(0, 60).map((e) => <EventRow key={e.id} e={e} />)}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
