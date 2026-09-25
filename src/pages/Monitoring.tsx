// ─── PLUTO: Мониторинг — телеметрия хабов (Glances/Netdata/Telegraf/Prometheus) ─
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, RefreshCw, Search, Cpu, Thermometer, HardDrive, Network, Gauge, Server, Activity,
} from 'lucide-react';
import { Panel, StatusDot, Modal, Drawer, Field, EmptyState, Ring, Bar, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, visibleAgents } from '../lib/store';
import { cls, fmtUp, fmtNet } from '../lib/util';
import type { Agent, TelemetrySource } from '../lib/types';

/** Настройка источника телеметрии хаба. */
function TelemetryModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Agent | null }) {
  const [glancesUrl, setGlancesUrl] = useState('');
  const [netdataUrl, setNetdataUrl] = useState('');
  const [telemetryUrl, setTelemetryUrl] = useState('');
  const [telemetrySource, setTelemetrySource] = useState<TelemetrySource>('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (initial) {
      setGlancesUrl(initial.glancesUrl || '');
      setNetdataUrl(initial.netdataUrl || '');
      setTelemetryUrl(initial.telemetryUrl || '');
      // Автоматически определяем источник телеметрии по наличию URL
      const source = initial.telemetrySource || (initial.netdataUrl ? 'netdata' : initial.glancesUrl ? 'glances' : '');
      setTelemetrySource(source as TelemetrySource);
    } else {
      setGlancesUrl(''); setNetdataUrl(''); setTelemetryUrl(''); setTelemetrySource('');
    }
  }, [open, initial]);

  const save = async () => {
    setErr('');
    if (!initial) return;
    const body = {
      glancesUrl: telemetrySource === 'glances' ? (glancesUrl.trim() || '') : '',
      netdataUrl: telemetrySource === 'netdata' ? (netdataUrl.trim() || undefined) : undefined,
      telemetryUrl: (telemetrySource === 'telegraf' || telemetrySource === 'prometheus') ? (telemetryUrl.trim() || undefined) : undefined,
      telemetrySource,
    };
    try {
      await store.updateAgent(initial.id, body);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Не удалось сохранить'); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Телеметрия · ${initial?.name ?? ''}`}>
      <div className="space-y-4">
        <p className="text-[12px] text-dim">Хаб «{initial?.name}» ({initial?.ip}). Здесь настраивается только источник телеметрии — пинги и цели редактируются в «Хабы → Изменить».</p>

        {/* Выбор источника телеметрии */}
        <div>
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Источник телеметрии</span>
          <div className="flex flex-wrap gap-2">
            {[
              { v: '', label: 'Нет' },
              { v: 'glances', label: 'Glances' },
              { v: 'netdata', label: 'Netdata' },
              { v: 'telegraf', label: 'Telegraf' },
              { v: 'prometheus', label: 'Prometheus' },
            ].map((opt) => (
              <button
                key={opt.v}
                onClick={() => setTelemetrySource(opt.v as TelemetrySource)}
                className={cls(
                  'rounded-lg border px-3 py-2 text-[12px] font-semibold transition-all',
                  telemetrySource === opt.v
                    ? 'border-vio/60 bg-vio/15 text-vio'
                    : 'border-line bg-raised/50 text-dim hover:text-mut'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Поля для разных источников телеметрии */}
        {telemetrySource === 'glances' && (
          <Field label="Адрес Glances" hint="«glances -w», порт по умолчанию 61208. CPU, GPU, RAM, диски, сеть, температуры — здесь и в «Статистике».">
            <input className="inp font-mono" value={glancesUrl} onChange={(e) => setGlancesUrl(e.target.value)} placeholder="http://192.168.1.10:61208" />
          </Field>
        )}

        {telemetrySource === 'netdata' && (
          <Field label="Адрес Netdata" hint="Netdata API, порт по умолчанию 19999. Метрики в реальном времени через WebSocket.">
            <input className="inp font-mono" value={netdataUrl} onChange={(e) => setNetdataUrl(e.target.value)} placeholder="http://192.168.1.10:19999" />
          </Field>
        )}

        {(telemetrySource === 'telegraf' || telemetrySource === 'prometheus') && (
          <Field label={telemetrySource === 'telegraf' ? "Адрес Telegraf HTTP" : "Адрес Prometheus"} hint={telemetrySource === 'telegraf' ? "Telegraf с плагином http_listener_v2, порт по умолчанию 8186. Формат: InfluxDB Line Protocol." : "Prometheus endpoint, порт по умолчанию 9090. Формат: Prometheus text format."}>
            <input className="inp font-mono" value={telemetryUrl} onChange={(e) => setTelemetryUrl(e.target.value)} placeholder={telemetrySource === 'telegraf' ? "http://192.168.1.10:8186/write" : "http://192.168.1.10:9090/metrics"} />
          </Field>
        )}

        {err && <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}
        <button onClick={save} className="btn-acc w-full justify-center"><Plus className="h-4 w-4" />Сохранить</button>
      </div>
    </Modal>
  );
}

/** Карточка хаба с основной телеметрией (перенесена из «Хабы»). */
function TelemetryCard({ a, onOpen, onEdit }: { a: Agent; onOpen: (a: Agent) => void; onEdit: (a: Agent) => void }) {
  const g = a.glancesLatest;
  const off = !a.online;
  return (
    <div className="rise rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:border-vio/35 hover:shadow-[0_14px_40px_-16px_rgba(0,0,0,.8)]">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => onOpen(a)} className="min-w-0 text-left">
          <div className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            <span className="truncate">{a.name}</span>
            {g && <span className="rounded border border-blu/40 bg-blu/10 px-1 py-px text-[8px] font-bold text-blu" title="Телеметрия Glances">GL</span>}
          </div>
          <div className="font-mono text-[11px] text-dim">{a.ip}{g?.mainAdapter ? ` · ${g.mainAdapter}` : ''}</div>
        </button>
        <div className="flex items-center gap-1">
          <button onClick={() => void store.pollAgentNow(a.id)} title="Опросить сейчас" className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-vio">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => onEdit(a)} title="Настроить источник телеметрии" className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-ink">
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* мини-окно: 6 основных показателей */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-vio')}>{off || g?.cpu == null ? '—' : `${Math.round(g.cpu)}%`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">загр. CPU</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : g?.cput != null && g.cput > 75 ? 'text-crit' : 'text-warn')}>{off || g?.cput == null ? '—' : `${Math.round(g.cput)}°`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">t° CPU</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-blu')}>{off || g?.ram == null ? '—' : `${Math.round(g.ram)}%`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">загр. RAM</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[13px] font-bold leading-[19px]', off ? 'text-dim' : 'text-ok')}>{off || !g ? '—' : `↓${fmtNet(g.rx)} ↑${fmtNet(g.tx)}`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">сеть</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-[#d98bb0]')}>{off || g?.ssdt == null ? '—' : `${Math.round(g.ssdt)}°`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">t° SSD</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-mint')}>{off || g?.gpu == null ? '—' : `${Math.round(g.gpu)}%`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">GPU</div></div>
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[10.5px] text-dim">
        <span className="flex items-center gap-1.5"><StatusDot status={a.online ? 'up' : 'down'} />{a.online ? `в сети ${fmtUp(Date.now() - (a.onlineSince || Date.now()))}` : 'офлайн'}</span>
        <span>{a.lastGlances ? <TimeAgo ts={a.lastGlances} /> : 'нет данных'}</span>
      </div>
    </div>
  );
}

/** Подробная телеметрия хаба (перенесённый drawer из «Хабы», без пингов локальных устройств). */
function TelemetryDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (a: Agent) => void }) {
  const a = usePluto((s) => s.agents.find((x) => x.id === id));
  if (!a) return null;
  const g = a.glancesLatest;
  const tempSensors = g?.sensors.filter((s) => s.unit === 'C') ?? [];

  return (
    <Drawer open onClose={onClose} title={
      <div className="flex items-center gap-2">
        <StatusDot status={a.online ? 'up' : 'down'} />
        <span className="font-display text-[15px] font-semibold text-ink">{a.name}</span>
      </div>
    }>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void store.pollAgentNow(a.id)} className="btn-ghost text-[12px]"><RefreshCw className="h-3.5 w-3.5" /> Опросить сейчас</button>
          <button onClick={() => onEdit(a)} className="btn-ghost text-[12px]"><Pencil className="h-3.5 w-3.5" /> Источник телеметрии</button>
        </div>

        <Panel title="Сводка" icon={<Gauge className="h-4 w-4" />} bodyClass="grid grid-cols-2 gap-3 p-4">
          <div className="flex items-center gap-3"><Ring value={g?.cpu ?? 0} size={56} label="CPU" /><div className="font-mono text-[12px] text-mut">{g?.cpu != null ? `${g.cpu}%` : '—'}</div></div>
          <div className="flex items-center gap-3"><Ring value={g?.ram ?? 0} size={56} color="#5fc6d8" label="RAM" /><div className="font-mono text-[12px] text-mut">{g?.ramUsedGB != null && g?.ramTotalGB != null ? `${g.ramUsedGB}/${g.ramTotalGB} ГБ` : '—'}</div></div>
        </Panel>

        {a.glancesError && <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">{a.glancesError}</p>}

        <Panel title="CPU · по ядрам" icon={<Cpu className="h-4 w-4" />}>
          {g?.cpuCores?.length ? (
            <div className="space-y-1.5">
              {g.cpuCores.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-10 font-mono text-[10.5px] text-dim">ядро {i}</span>
                  <Bar value={v} className="flex-1" /><span className="w-10 text-right font-mono text-[11px] text-mut">{Math.round(v)}%</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[12px] text-dim">Нет данных по ядрам{a.glancesUrl ? '' : ' — укажите адрес Glances в настройках телеметрии'}</p>}
          {g?.load1 != null && <p className="mt-2 font-mono text-[11px] text-dim">LA 1м {g.load1} · 5м {g.load5 ?? '—'}{g.gpu != null ? ` · GPU ${g.gpu}%` : ''}</p>}
        </Panel>

        <Panel title="Диски" icon={<HardDrive className="h-4 w-4" />}>
          {g?.disks?.length ? (
            <div className="space-y-2">
              {g.disks.map((d) => (
                <div key={d.mnt} className="flex items-center gap-2">
                  <span className="w-20 truncate font-mono text-[11px] text-mut" title={d.mnt}>{d.mnt}</span>
                  <Bar value={d.percent ?? 0} className="flex-1" color="#e0b65e" />
                  <span className="w-24 text-right font-mono text-[11px] text-dim">{d.percent != null ? `${Math.round(d.percent)}%` : '—'}{d.sizeGB != null ? ` · ${Math.round(d.sizeGB)}ГБ` : ''}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[12px] text-dim">Нет данных о дисках</p>}
          {(g?.diskRead != null || g?.diskWrite != null) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-line/60 bg-raised/40 p-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-dim">Чтение диска</div>
                <div className="font-mono text-[14px] font-bold text-blu">{g.diskRead != null ? `${Math.round(g.diskRead)} Rps` : '—'}</div>
              </div>
              <div className="rounded-lg border border-line/60 bg-raised/40 p-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-dim">Запись диска</div>
                <div className="font-mono text-[14px] font-bold text-purp">{g.diskWrite != null ? `${Math.round(g.diskWrite)} Wps` : '—'}</div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Сеть · адаптеры" icon={<Network className="h-4 w-4" />}>
          {g?.adapters?.length ? (
            <div className="space-y-1.5">
              {g.adapters.map((ad) => (
                <div key={ad.name} className={cls('flex items-center justify-between rounded-lg border px-2.5 py-1.5', ad.name === g.mainAdapter ? 'border-mint/40 bg-mint/5' : 'border-line/60 bg-raised/30')}>
                  <span className="font-mono text-[11.5px] text-mut">{ad.name}{ad.name === g.mainAdapter && <span className="ml-1.5 text-[9px] font-bold text-mint">основной</span>}</span>
                  <span className="font-mono text-[11px] text-ok">↓{fmtNet(ad.rx)} <span className="text-blu">↑{fmtNet(ad.tx)}</span></span>
                </div>
              ))}
            </div>
          ) : <p className="text-[12px] text-dim">Нет данных об адаптерах</p>}
        </Panel>

        <Panel title="Температуры · все датчики" icon={<Thermometer className="h-4 w-4" />}>
          {tempSensors.length ? (
            <div className="grid grid-cols-2 gap-2">
              {tempSensors.map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-line/60 bg-raised/30 px-2.5 py-1.5">
                  <span className="truncate font-mono text-[11px] text-mut" title={s.label}>{s.label}</span>
                  <span className={cls('font-mono text-[12px] font-bold', s.value > 75 ? 'text-crit' : s.value > 60 ? 'text-warn' : 'text-ok')}>{Math.round(s.value)}°C</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[12px] text-dim">Датчики температуры не найдены</p>}
        </Panel>
      </div>
    </Drawer>
  );
}

export default function Monitoring() {
  const user = useCurrentUser();
  const agents = usePluto((s) => visibleAgents(s, user));
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; initial: Agent | null }>({ open: false, initial: null });

  const list = useMemo(() => {
    const query = typeof q === 'string' ? q.trim().toLowerCase() : '';
    if (!query) return agents;
    return agents.filter((a) => a.name.toLowerCase().includes(query) || a.ip.includes(query));
  }, [agents, q]);

  const withTelemetry = useMemo(() => agents.filter((a) => a.glancesUrl || a.netdataUrl || a.telemetryUrl || a.telemetrySource), [agents]);
  const avgCpu = useMemo(() => {
    const vals = withTelemetry.map((a) => a.glancesLatest?.cpu).filter((v): v is number => v != null);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  }, [withTelemetry]);
  const hotCount = useMemo(() => withTelemetry.filter((a) => {
    const g = a.glancesLatest;
    return g && ((g.cput != null && g.cput > 75) || (g.ssdt != null && g.ssdt > 70));
  }).length, [withTelemetry]);

  return (
    <div className="space-y-4">
      <Panel title="Телеметрия · сводка" icon={<Server className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-center">
            <div className="font-mono text-[28px] font-bold text-vio">{withTelemetry.length}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dim">Хабов с телеметрией</div>
          </div>
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-center">
            <div className="font-mono text-[28px] font-bold text-blu">{avgCpu != null ? `${avgCpu}%` : '—'}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dim">Средняя загрузка CPU</div>
          </div>
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-center">
            <div className={cls('font-mono text-[28px] font-bold', hotCount > 0 ? 'text-crit' : 'text-ok')}>{hotCount}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dim">Перегрев (t° &gt; 75)</div>
          </div>
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-center">
            <div className="font-mono text-[28px] font-bold text-warn">{withTelemetry.filter((a) => a.glancesError).length}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dim">Ошибок опроса</div>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-dim">
          Телеметрия хабов (CPU, память, диски, сеть, температуры) и её настройки. Пинги до устройств и количество IP — в разделе «Хабы».
        </p>
      </Panel>

      <Panel title={`Телеметрия хабов · ${list.length}`} icon={<Activity className="h-4 w-4" />}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-raised/50 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или IP…" className="w-44 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-dim/70" />
          </div>
          <span className="text-[11.5px] text-dim">Источник телеметрии настраивается кнопкой ✎ на карточке хаба.</span>
        </div>

        {list.length === 0 ? (
          <EmptyState icon={<Activity className="h-6 w-6" />} title="Нет хабов"
            text="Добавьте хабы в разделе «Хабы» — их телеметрия появится здесь." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.map((a) => <TelemetryCard key={a.id} a={a} onOpen={(ag) => setDrawer(ag.id)} onEdit={(ag) => setModal({ open: true, initial: ag })} />)}
          </div>
        )}
      </Panel>

      <TelemetryModal open={modal.open} initial={modal.initial} onClose={() => setModal({ open: false, initial: null })} />
      {drawer && <TelemetryDrawer id={drawer} onClose={() => setDrawer(null)} onEdit={(ag) => setModal({ open: true, initial: ag })} />}
    </div>
  );
}
