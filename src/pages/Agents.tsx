// ─── PLUTO: relay-агенты (пинг через ПК + Glances) ──────────────────────────
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Star, Trash2, RefreshCw, Monitor, Search, Pencil, Cpu, Thermometer, HardDrive, Network, Gauge, BarChart3, Waves,
} from 'lucide-react';
import { Panel, StatusDot, Modal, Drawer, Field, EmptyState, Ring, Bar, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts, visibleAgents } from '../lib/store';
import { cls, fmtMs, fmtUp, fmtNet, isIp, isTarget, expandTargets, pingStats } from '../lib/util';
import type { Agent, GlancesSensor, StatsView } from '../lib/types';

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

function AgentModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Agent | null }) {
  const tags = usePluto((s) => s.tags);
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [glancesUrl, setGlancesUrl] = useState('');
  const [targetsText, setTargetsText] = useState('');
  const [statsView, setStatsView] = useState<StatsView>('');
  const [selTags, setSelTags] = useState<string[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (initial) {
      setName(initial.name); setIp(initial.ip); setRelayUrl(initial.relayUrl); setGlancesUrl(initial.glancesUrl || '');
      setTargetsText(initial.pingTargets.join('\n')); setStatsView(initial.statsView); setSelTags(initial.tags);
    } else {
      setName(''); setIp(''); setRelayUrl(''); setGlancesUrl(''); setTargetsText(''); setStatsView(''); setSelTags([]);
    }
  }, [open, initial]);

  const save = async () => {
    setErr('');
    if (!name.trim()) return setErr('Укажите имя');
    if (!isIp(ip.trim())) return setErr('IP-адрес ПК в формате 192.168.1.10');
    const targets = targetsText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const bad = targets.find((t) => !isTarget(t));
    if (bad) return setErr(`Некорректная цель: «${bad}». Форматы: 10.0.0.5, 10.0.0.1-20, 10.0.0.0/24`);
    const body = { name: name.trim(), ip: ip.trim(), relayUrl: relayUrl.trim(), glancesUrl: glancesUrl.trim(), pingTargets: targets, tags: selTags, statsView };
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
        <Field label="Адрес Glances (телеметрия)" hint="«glances -w», порт по умолчанию 61208. CPU, GPU, RAM, диски, сеть, температуры — в «Статистике» и карточке агента.">
          <input className="inp font-mono" value={glancesUrl} onChange={(e) => setGlancesUrl(e.target.value)} placeholder="http://192.168.1.10:61208" />
        </Field>
        <Field label="Цели для пинга (по одной в строке)" hint="IP, диапазон 10.0.0.1-20 или подсеть 10.0.0.0/24 — устройства, доступные только этому ПК">
          <textarea className="inp font-mono" rows={5} value={targetsText} onChange={(e) => setTargetsText(e.target.value)} placeholder={'10.0.0.5\n10.0.0.1-20'} />
        </Field>

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

function AgentCard({ a, onEdit, onOpen }: { a: Agent; onEdit: (a: Agent) => void; onOpen: (a: Agent) => void }) {
  const tags = usePluto((s) => s.tags);
  const g = a.glancesLatest;
  const off = !a.online;
  const st = pingStats(a.targets);
  const tagObjs = a.tags.map((id) => tags.find((t) => t.id === id)).filter(Boolean) as { id: string; label: string; color: string }[];
  return (
    <div className="rise rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:border-vio/35 hover:shadow-[0_14px_40px_-16px_rgba(0,0,0,.8)]">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => onOpen(a)} className="min-w-0 text-left">
          <div className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            <span className="truncate">{a.name}</span>
            {g && <span className="rounded border border-blu/40 bg-blu/10 px-1 py-px text-[8px] font-bold text-blu" title="Телеметрия Glances">GL</span>}
          </div>
          <div className="font-mono text-[11px] text-dim">{a.ip}{g?.mainAdapter ? ` · ${g.mainAdapter}` : ''}</div>
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

      {/* мини-окно: 6 основных показателей */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-vio')}>{off || g?.cpu == null ? '—' : `${Math.round(g.cpu)}%`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">загр. CPU</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : g?.cput != null && g.cput > 75 ? 'text-crit' : 'text-warn')}>{off || g?.cput == null ? '—' : `${Math.round(g.cput)}°`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">t° CPU</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-blu')}>{a.latency != null ? a.latency : '—'}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">пинг, мс</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-mint')}>{off || g?.ram == null ? '—' : `${Math.round(g.ram)}%`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">загр. RAM</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[13px] font-bold leading-[19px]', off ? 'text-dim' : 'text-ok')}>{off || !g ? '—' : `↓${fmtNet(g.rx)} ↑${fmtNet(g.tx)}`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">сеть</div></div>
        <div className="rounded-lg border border-line/60 bg-raised/40 py-2"><div className={cls('font-mono text-[15px] font-bold', off ? 'text-dim' : 'text-[#d98bb0]')}>{off || g?.ssdt == null ? '—' : `${Math.round(g.ssdt)}°`}</div><div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">t° SSD</div></div>
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[10.5px] text-dim">
        <span className="flex items-center gap-1.5"><StatusDot status={a.online ? 'up' : 'down'} />{a.online ? `в сети ${fmtUp(Date.now() - (a.onlineSince || Date.now()))}` : 'офлайн'}</span>
        {st.total > 0 && <span>{st.online}/{st.total} пинг</span>}
      </div>
    </div>
  );
}

/** Все сенсоры Glances, сгруппированные по типу: t°C, RPM, %, прочее. */
function SensorGroups({ sensors }: { sensors: GlancesSensor[] }) {
  if (!sensors.length) {
    return (
      <Panel title="Датчики · 0" icon={<Thermometer className="h-4 w-4" />}>
        <p className="text-[12px] text-dim">Датчики не найдены — Glances видит их, только если запущен от администратора и установлены psutil/batinfo.</p>
      </Panel>
    );
  }
  const temps = sensors.filter((s) => /temp|thermal/i.test(s.kind) || s.unit === 'C' || s.unit === '°C');
  const fans = sensors.filter((s) => /fan/i.test(s.kind) || /rpm/i.test(s.unit));
  const batts = sensors.filter((s) => /batt/i.test(s.kind) || s.unit === '%');
  const rest = sensors.filter((s) => !temps.includes(s) && !fans.includes(s) && !batts.includes(s));

  const Chip = ({ s, color }: { s: GlancesSensor; color: string }) => (
    <div className="flex items-center justify-between rounded-lg border border-line/60 bg-raised/30 px-2.5 py-1.5 transition-colors hover:border-line">
      <span className="truncate pr-2 font-mono text-[11px] text-mut" title={`${s.label} (${s.kind || s.unit})`}>{s.label}</span>
      <span className={cls('shrink-0 font-mono text-[12px] font-bold', color)}>
        {Math.round(s.value * 10) / 10}<span className="ml-0.5 text-[9px] font-normal text-dim">{s.unit}</span>
      </span>
    </div>
  );

  return (
    <Panel title={`Датчики · ${sensors.length}`} icon={<Thermometer className="h-4 w-4" />}>
      <div className="space-y-3">
        {temps.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">Температуры</p>
            <div className="grid grid-cols-2 gap-1.5">
              {temps.map((s, i) => <Chip key={`t${i}`} s={s} color={s.value > 75 ? 'text-crit' : s.value > 60 ? 'text-warn' : 'text-ok'} />)}
            </div>
          </div>
        )}
        {fans.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">Вентиляторы</p>
            <div className="grid grid-cols-2 gap-1.5">
              {fans.map((s, i) => <Chip key={`f${i}`} s={s} color="text-blu" />)}
            </div>
          </div>
        )}
        {batts.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">Батареи</p>
            <div className="grid grid-cols-2 gap-1.5">
              {batts.map((s, i) => <Chip key={`b${i}`} s={s} color={s.value < 20 ? 'text-crit' : 'text-mint'} />)}
            </div>
          </div>
        )}
        {rest.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">Прочее</p>
            <div className="grid grid-cols-2 gap-1.5">
              {rest.map((s, i) => <Chip key={`r${i}`} s={s} color="text-mut" />)}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function AgentDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (a: Agent) => void }) {
  const a = usePluto((s) => s.agents.find((x) => x.id === id));
  if (!a) return null;
  const g = a.glancesLatest;
  const st = pingStats(a.targets);

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
          <button onClick={() => onEdit(a)} className="btn-ghost text-[12px]"><Pencil className="h-3.5 w-3.5" /> Изменить</button>
          <button onClick={() => store.toggleAgentFav(a.id)} className={cls('btn-ghost text-[12px]', a.favorite && 'text-warn')}>
            <Star className={cls('h-3.5 w-3.5', a.favorite && 'fill-warn')} /> {a.favorite ? 'В избранном' : 'В избранное'}
          </button>
        </div>

        {/* системная строка */}
        {(g?.os || g?.hostname) && (
          <div className="rise flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line/60 bg-raised/30 px-3.5 py-2.5 font-mono text-[11px] text-dim">
            {g.hostname && <span className="text-mut">{g.hostname}</span>}
            {g.os && <span>{g.os}</span>}
            {g.procCount != null && <span>{g.procCount} процессов</span>}
            {g.uptimeSec != null && <span>аптайм {fmtUp(g.uptimeSec * 1000)}</span>}
            <span className="ml-auto text-[9.5px] uppercase tracking-wider text-dim/70">Glances {g.via}</span>
          </div>
        )}

        <Panel title="Сводка" icon={<Gauge className="h-4 w-4" />} bodyClass="grid grid-cols-2 gap-3 p-4">
          <div className="flex items-center gap-3"><Ring value={g?.cpu ?? 0} size={56} label="CPU" /><div className="font-mono text-[11px] leading-snug text-mut">{g?.cpu != null ? `${g.cpu}%` : '—'}{g?.cput != null && <><br /><span className="text-warn">{g.cput}°C</span></>}</div></div>
          <div className="flex items-center gap-3"><Ring value={g?.ram ?? 0} size={56} color="#5fc6d8" label="RAM" /><div className="font-mono text-[11px] leading-snug text-mut">{g?.ramUsedGB != null && g?.ramTotalGB != null ? `${g.ramUsedGB}/${g.ramTotalGB} ГБ` : '—'}{g?.swap != null && <><br />swap {g.swap}%</>}</div></div>
          <div className="flex items-center gap-3"><Ring value={g?.gpu ?? 0} size={56} color="#8f7df0" label="GPU" /><div className="font-mono text-[11px] leading-snug text-mut">{g?.gpu != null ? `${g.gpu}%` : '—'}{g?.gpuTemp != null && <><br /><span className="text-warn">{g.gpuTemp}°C</span></>}</div></div>
          <div className="flex items-center gap-3"><Ring value={g?.disks?.[0]?.percent ?? 0} size={56} color="#e0b65e" label="Диск" /><div className="font-mono text-[11px] leading-snug text-mut">{g?.disks?.length ? `${g.disks.length} шт.` : '—'}{g?.disks?.[0]?.percent != null && <><br />{g.disks[0].mnt} {Math.round(g.disks[0].percent)}%</>}</div></div>
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
          ) : <p className="text-[12px] text-dim">Нет данных по ядрам{a.glancesUrl ? '' : ' — укажите адрес Glances в «Изменить»'}</p>}
          {g?.load1 != null && <p className="mt-2 font-mono text-[11px] text-dim">LA 1м {g.load1} · 5м {g.load5 ?? '—'} · 15м {g.load15 ?? '—'}</p>}
        </Panel>

        <Panel title={`Диски · ${g?.disks?.length ?? 0}`} icon={<HardDrive className="h-4 w-4" />}>
          {g?.disks?.length ? (
            <div className="space-y-2.5">
              {g.disks.map((d) => (
                <div key={d.mnt} className="rounded-lg border border-line/50 bg-raised/30 px-3 py-2">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="truncate font-mono text-[11.5px] font-semibold text-mut" title={d.mnt}>{d.mnt}</span>
                    {d.temp != null && <span className={cls('font-mono text-[10.5px]', d.temp > 60 ? 'text-crit' : 'text-warn')}>{d.temp}°C</span>}
                    <span className="ml-auto font-mono text-[11px] text-dim">
                      {d.usedGB != null && d.sizeGB != null ? `${Math.round(d.usedGB)}/${Math.round(d.sizeGB)} ГБ` : d.percent != null ? `${Math.round(d.percent)}%` : '—'}
                    </span>
                  </div>
                  <Bar value={d.percent ?? 0} color="#e0b65e" />
                  {(d.readKBs != null || d.writeKBs != null) && (
                    <div className="mt-1 flex justify-between font-mono text-[10px] text-dim">
                      <span className="text-ok">↓ чтение {fmtNet(d.readKBs)}</span>
                      <span className="text-blu">↑ запись {fmtNet(d.writeKBs)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="text-[12px] text-dim">Нет данных о дисках</p>}
        </Panel>

        <Panel title={`Сеть · адаптеры · ${g?.adapters?.length ?? 0}`} icon={<Network className="h-4 w-4" />}>
          {g?.adapters?.length ? (
            <div className="space-y-1.5">
              {g.adapters.map((ad) => (
                <div key={ad.name} className={cls('flex items-center justify-between rounded-lg border px-2.5 py-1.5',
                  ad.name === g.mainAdapter ? 'border-mint/40 bg-mint/5' : ad.virtual ? 'border-line/30 bg-raised/20 opacity-60' : 'border-line/60 bg-raised/30')}>
                  <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px] text-mut">
                    <span className="truncate">{ad.name}</span>
                    {ad.name === g.mainAdapter && <span className="shrink-0 rounded bg-mint/15 px-1 py-0.5 text-[8.5px] font-bold uppercase text-mint">основной</span>}
                    {ad.virtual && <span className="shrink-0 rounded bg-line/40 px-1 py-0.5 text-[8.5px] font-bold uppercase text-dim">вирт</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ok">↓{fmtNet(ad.rx)} <span className="text-blu">↑{fmtNet(ad.tx)}</span></span>
                </div>
              ))}
            </div>
          ) : <p className="text-[12px] text-dim">Нет данных об адаптерах</p>}
        </Panel>

        <SensorGroups sensors={g?.sensors ?? []} />

        <Panel title={`Пинги локальных устройств · ${st.online}/${st.total} онлайн`} icon={<Monitor className="h-4 w-4" />}>
          {a.targets.length === 0 ? (
            <p className="text-[12px] text-dim">Цели не заданы. Добавьте IP/диапазоны в «Изменить» и укажите адрес relay.</p>
          ) : (
            <div className="space-y-3">
              {a.targets.map((t) => (
                <div key={t.target}>
                  <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-dim">
                    <span>{t.target} · {t.results.length} устр.</span>
                    <TimeAgo ts={t.lastCheck} />
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto scroll-thin">
                    {t.results.map((r) => (
                      <div key={r.ip} className="flex items-center justify-between rounded border border-line/40 bg-raised/30 px-2.5 py-1">
                        <span className="flex items-center gap-2 font-mono text-[11.5px] text-mut"><StatusDot status={r.alive ? 'up' : 'down'} pulse={false} />{r.ip}</span>
                        <span className={cls('font-mono text-[11.5px]', r.alive ? 'text-ok' : 'text-crit')}>{r.alive ? `${r.latency ?? 0} мс` : 'нет ответа'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </Drawer>
  );
}

export default function Agents() {
  const user = useCurrentUser();
  const agents = usePluto((s) => visibleAgents(s, user));
  const isAdmin = user?.role === 'admin';
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ open: boolean; initial: Agent | null }>({ open: false, initial: null });
  const [drawer, setDrawer] = useState<string | null>(null);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter((a) => a.name.toLowerCase().includes(query) || a.ip.includes(query));
  }, [agents, q]);

  const onEdit = (a: Agent) => setModal({ open: true, initial: a });

  return (
    <div className="space-y-4">
      <Panel title={`Relay-агенты · ${list.length}`} icon={<Monitor className="h-4 w-4" />}
        right={isAdmin ? <button onClick={() => setModal({ open: true, initial: null })} className="btn-acc"><Plus className="h-4 w-4" />Добавить агента</button> : undefined}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-raised/50 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или IP…" className="w-44 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-dim/70" />
          </div>
          <span className="text-[11.5px] text-dim">Агент = ПК с pluto-relay: пингует устройства внутри своей сети (VLAN/NAT) и отдаёт телеметрию Glances.</span>
        </div>

        {list.length === 0 ? (
          <EmptyState icon={<Monitor className="h-6 w-6" />} title="Агентов пока нет"
            text="Добавьте ПК с запущенным pluto-relay — через него сервер будет пинговать устройства, недоступные напрямую."
            action={isAdmin ? <button onClick={() => setModal({ open: true, initial: null })} className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">Добавить агента</button> : undefined} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.map((a) => <AgentCard key={a.id} a={a} onEdit={onEdit} onOpen={(ag) => setDrawer(ag.id)} />)}
          </div>
        )}
      </Panel>

      <AgentModal open={modal.open} initial={modal.initial} onClose={() => setModal({ open: false, initial: null })} />
      {drawer && <AgentDrawer id={drawer} onClose={() => setDrawer(null)} onEdit={onEdit} />}
    </div>
  );
}
