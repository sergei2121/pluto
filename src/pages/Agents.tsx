// ─── PLUTO: relay-агенты (пинг через ПК) ─────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Plus, Star, Trash2, RefreshCw, Monitor, Search, X, Check, Minus, Cpu, Thermometer, HardDrive, Network, Gauge, BarChart3 } from 'lucide-react';
import { Panel, StatusDot, Modal, Drawer, Field, EmptyState, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts, visibleAgents } from '../lib/store';
import { cls, fmtMs, fmtUp, fmtNet, isIp, isTarget } from '../lib/util';
import type { Agent, RelayTargetResult } from '../lib/types';

function AgentModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Agent | null }) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [glancesUrl, setGlancesUrl] = useState('');
  const [targetsText, setTargetsText] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (initial) {
      setName(initial.name); setIp(initial.ip); setRelayUrl(initial.relayUrl); setGlancesUrl(initial.glancesUrl || '');
      setTargetsText(initial.pingTargets.join('\n'));
    } else {
      setName(''); setIp(''); setRelayUrl(''); setGlancesUrl(''); setTargetsText('');
    }
  }, [open, initial]);

  const save = async () => {
    setErr('');
    if (!name.trim()) return setErr('Укажите имя');
    if (!isIp(ip.trim())) return setErr('IP-адрес ПК в формате 192.168.1.10');
    const targets = targetsText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const bad = targets.find((t) => !isTarget(t));
    if (bad) return setErr(`Некорректная цель: «${bad}». Форматы: 10.0.0.5, 10.0.0.1-20, 10.0.0.0/24`);
    const body = { name: name.trim(), ip: ip.trim(), relayUrl: relayUrl.trim(), glancesUrl: glancesUrl.trim(), pingTargets: targets };
    try {
      if (initial) await store.updateAgent(initial.id, body);
      else await store.addAgent(body);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Изменить агента' : 'Новый relay-агент'}>
      <div className="space-y-4">
        <div className="rounded-lg border border-vio/25 bg-vio/5 px-4 py-3 text-[12px] leading-relaxed text-mut">
          <span className="font-bold text-vio">pluto-relay</span> — «кусок PLUTO», который ставится на ПК и пингует
          устройства, доступные только этой машине (NAT/VLAN). Только пинг — ничего больше.
        </div>

        <Field label="Имя">
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Офис — ПК админа" />
        </Field>

        <Field label="IP-адрес ПК" hint="Ядро пингует его, чтобы понять, на связи ли relay">
          <input className="inp font-mono" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.10" />
        </Field>

        <Field label="Адрес pluto-relay" hint="HTTP-адрес relay на этом ПК, порт по умолчанию 8091">
          <input className="inp font-mono" value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} placeholder="http://192.168.1.10:8091" />
        </Field>

        <Field label="Адрес Glances (телеметрия)" hint="«glances -w», порт по умолчанию 61208. CPU, GPU, RAM, диски, сеть, температуры — в «Статистика Bars/WS» и карточке агента">
          <input className="inp font-mono" value={glancesUrl} onChange={(e) => setGlancesUrl(e.target.value)} placeholder="http://192.168.1.10:61208" />
        </Field>

        <Field label="Цели для пинга (по одной в строке)" hint="IP, диапазон 10.0.0.1-20 или подсеть 10.0.0.0/24 — устройства, доступные только этому ПК">
          <textarea className="inp font-mono" rows={5} value={targetsText} onChange={(e) => setTargetsText(e.target.value)}
            placeholder={'10.0.0.5\n10.0.0.1-20'} />
        </Field>

        {err && <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg border border-line bg-raised/50 px-4 py-2 text-[13px] font-semibold text-dim transition-colors hover:text-mut">Отмена</button>
          <button onClick={save} className="rounded-lg border border-vio/60 bg-vio/25 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/35">
            {initial ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TargetBlock({ t, online }: { t: RelayTargetResult; online: boolean }) {
  const alive = t.results.filter((r) => r.alive).length;
  return (
    <div className="rounded-lg border border-line bg-raised/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[12px] font-semibold text-ink">{t.target}</span>
        <span className={cls('font-mono text-[11px] font-bold', alive === t.results.length ? 'text-ok' : alive === 0 ? 'text-crit' : 'text-warn')}>
          {alive}/{t.results.length} живо
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {t.results.map((r) => (
          <div key={r.ip} className="flex items-center gap-1.5 rounded border border-line/60 bg-panel/60 px-2 py-1">
            {r.alive ? <Check className="h-3 w-3 shrink-0 text-ok" /> : <Minus className="h-3 w-3 shrink-0 text-crit" />}
            <span className="truncate font-mono text-[10.5px] text-mut">{r.ip}</span>
            <span className="ml-auto font-mono text-[10px] text-dim">{r.alive ? `${r.latency}мс` : '—'}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right font-mono text-[10px] text-dim">
        {online ? <TimeAgo ts={t.lastCheck} /> : 'relay офлайн — пинг не выполнялся'}
      </div>
    </div>
  );
}

/** Мини-ячейка показателя. */
function MiniCell({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="rounded-lg border border-line/60 bg-raised/40 px-2 py-1.5 text-center transition-colors hover:border-line">
      <div className={cls('font-mono text-[14px] font-bold leading-tight tabular-nums', color || 'text-ink')}>{value}</div>
      <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">{label}</div>
    </div>
  );
}

function AgentCard({ a, onEdit, onOpen }: { a: Agent; onEdit: (a: Agent) => void; onOpen: (a: Agent) => void }) {
  const g = a.glancesLatest;
  const off = !a.online;
  return (
    <div className="rise cursor-pointer rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40 hover:shadow-[0_10px_30px_-12px_rgba(0,0,0,.7)]"
      onClick={() => onOpen(a)}>
      <div className="flex items-start justify-between gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex min-w-0 items-center gap-2.5" onClick={() => onOpen(a)}>
          <StatusDot status={a.online ? 'up' : 'down'} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
              <span className="truncate">{a.name}</span>
              {g && <span className="rounded border border-blu/40 bg-blu/10 px-1 py-px text-[8px] font-bold text-blu" title="Телеметрия Glances">GL</span>}
            </div>
            <div className="font-mono text-[11px] text-dim">{a.ip}{g?.mainAdapter ? ` · ${g.mainAdapter}` : ''}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => store.toggleAgentFav(a.id)} title="В избранное"
            className={cls('rounded-md p-1.5 transition-all hover:bg-raised', a.favorite ? 'text-warn' : 'text-dim/40 hover:text-dim')}>
            <Star className={cls('h-4 w-4', a.favorite && 'fill-warn')} strokeWidth={1.5} />
          </button>
          <button onClick={() => void store.pollAgentNow(a.id)} title="Опросить сейчас"
            className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-vio">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => onEdit(a)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-dim transition-colors hover:bg-raised hover:text-ink">Изм.</button>
          <button onClick={() => { if (window.confirm(`Удалить агента «${a.name}»?`)) void store.removeAgent(a.id); }}
            className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-crit">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* мини-окно: только основная информация */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniCell value={off ? '—' : (g?.cpu != null ? `${Math.round(g.cpu)}%` : '—')} label="CPU" color={off ? 'text-dim' : 'text-vio'} />
        <MiniCell value={off ? '—' : (g?.cput != null ? `${Math.round(g.cput)}°` : '—')} label="t°C CPU" color={off ? 'text-dim' : g && g.cput != null && g.cput > 75 ? 'text-crit' : 'text-warn'} />
        <MiniCell value={a.latency != null ? `${a.latency}` : '—'} label="пинг, мс" color={off ? 'text-dim' : 'text-blu'} />
        <MiniCell value={off ? '—' : (g?.ram != null ? `${Math.round(g.ram)}%` : '—')} label="RAM" color={off ? 'text-dim' : 'text-mint'} />
        <MiniCell value={off || !g ? '—' : `↓${fmtNet(g.rx ?? null)}`} label="сеть RX" color={off ? 'text-dim' : 'text-ok'} />
        <MiniCell value={off ? '—' : (g?.ssdt != null ? `${Math.round(g.ssdt)}°` : '—')} label="t° SSD" color={off ? 'text-dim' : 'text-[#d98bb0]'} />
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-dim">
        <span className="truncate">{a.online ? `в сети ${fmtUp(Date.now() - (a.onlineSince || Date.now()))}` : 'офлайн'}</span>
        <span className={a.online ? 'text-ok' : 'text-crit'}>{a.online ? 'на связи' : 'нет ответа'}</span>
      </div>
    </div>
  );
}

// ─── Полная карточка агента (drawer) ────────────────────────────────────────

function SectionTitle({ icon, text, extra }: { icon: React.ReactNode; text: string; extra?: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-vio">{icon}</span>
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-mut">{text}</span>
      {extra && <span className="ml-auto font-mono text-[10px] text-dim">{extra}</span>}
    </div>
  );
}

function AgentDrawer({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (a: Agent) => void }) {
  const a = usePluto((s) => s.agents.find((x) => x.id === id) ?? null);
  if (!a) return null;
  const g = a.glancesLatest;
  const alive = a.targets.reduce((n, t) => n + t.results.filter((r) => r.alive).length, 0);
  const total = a.targets.reduce((n, t) => n + t.results.length, 0);

  return (
    <Drawer open onClose={onClose} title={
      <div className="flex items-center gap-2.5">
        <StatusDot status={a.online ? 'up' : 'down'} />
        <div>
          <div className="font-display text-[14px] font-bold text-ink">{a.name}</div>
          <div className="font-mono text-[10.5px] text-dim">{a.ip}{g ? ` · Glances ${g.via}` : ''}</div>
        </div>
      </div>
    }>
      <div className="space-y-5">
        {/* действия */}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void store.pollAgentNow(a.id)} className="btn-ghost text-[12px]"><RefreshCw className="h-3.5 w-3.5" /> Опросить сейчас</button>
          <button onClick={() => { onEdit(a); }} className="btn-ghost text-[12px]">Изменить</button>
          <button onClick={() => store.toggleAgentFav(a.id)} className={cls('btn-ghost text-[12px]', a.favorite && 'text-warn')}>
            <Star className={cls('h-3.5 w-3.5', a.favorite && 'fill-warn')} /> {a.favorite ? 'В избранном' : 'В избранное'}
          </button>
          <button onClick={() => store.nav('stats-ws')} className="btn-ghost text-[12px]"><BarChart3 className="h-3.5 w-3.5" /> Статистика</button>
        </div>

        {a.glancesError && (
          <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">{a.glancesError}</div>
        )}

        {!a.glancesUrl ? (
          <div className="rounded-lg border border-line bg-raised/40 px-4 py-3 text-[12.5px] text-dim">
            Адрес Glances не задан — телеметрия недоступна. Укажите его в «Изменить» (glances -w, порт 61208).
          </div>
        ) : !g ? (
          <div className="rounded-lg border border-line bg-raised/40 px-4 py-3 text-[12.5px] text-dim">
            Данные Glances ещё не получены — нажмите «Опросить сейчас».
          </div>
        ) : (
          <>
            {/* CPU / GPU / RAM */}
            <div>
              <SectionTitle icon={<Cpu className="h-4 w-4" />} text="Процессор и память"
                extra={g.uptimeSec != null ? `аптайм ${fmtUp(g.uptimeSec * 1000)}` : undefined} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniCell value={g.cpu != null ? `${g.cpu}%` : '—'} label="CPU" color="text-vio" />
                <MiniCell value={g.gpu != null ? `${g.gpu}%` : '—'} label="GPU" color="text-blu" />
                <MiniCell value={g.ram != null ? `${g.ram}%` : '—'} label="RAM" color="text-mint" />
                <MiniCell value={g.swap != null ? `${g.swap}%` : '—'} label="Swap" color="text-dim" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px] text-dim">
                <div>RAM: <span className="text-mut">{g.ramUsedGB != null ? `${g.ramUsedGB} / ${g.ramTotalGB} ГБ` : '—'}</span></div>
                <div>Load: <span className="text-mut">{g.load1 ?? '—'} / {g.load5 ?? '—'}</span></div>
              </div>
              {g.cpuCores.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-dim">Загрузка по ядрам · {g.cpuCores.length} шт</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {g.cpuCores.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-7 shrink-0 font-mono text-[10px] text-dim">#{i}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
                          <div className="h-full rounded-full bg-vio transition-all duration-500" style={{ width: `${c ?? 0}%` }} />
                        </div>
                        <span className="w-9 shrink-0 text-right font-mono text-[10px] text-mut">{c != null ? `${Math.round(c)}%` : '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Диски */}
            <div>
              <SectionTitle icon={<HardDrive className="h-4 w-4" />} text="Диски" extra={`${g.disks.length} шт`} />
              {g.disks.length === 0 ? <p className="text-[12px] text-dim">нет данных</p> : (
                <div className="space-y-2">
                  {g.disks.map((d) => (
                    <div key={d.mnt} className="rounded-lg border border-line/60 bg-raised/40 px-3 py-2">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="text-mut">{d.mnt}</span>
                        <span className="text-dim">{d.usedGB != null ? `${d.usedGB} / ${d.sizeGB} ГБ` : ''}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
                        <div className={cls('h-full rounded-full transition-all duration-500', (d.percent ?? 0) > 85 ? 'bg-crit' : (d.percent ?? 0) > 65 ? 'bg-warn' : 'bg-mint')}
                          style={{ width: `${d.percent ?? 0}%` }} />
                      </div>
                      <div className="mt-1 text-right font-mono text-[10px] text-dim">{d.percent != null ? `${Math.round(d.percent)}% занято` : '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Сетевые адаптеры */}
            <div>
              <SectionTitle icon={<Network className="h-4 w-4" />} text="Сетевые адаптеры" extra={`${g.adapters.length} шт · основной: ${g.mainAdapter ?? '—'}`} />
              {g.adapters.length === 0 ? <p className="text-[12px] text-dim">нет данных</p> : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {g.adapters.map((n) => (
                    <div key={n.name} className={cls('rounded-lg border px-3 py-2', n.name === g.mainAdapter ? 'border-vio/40 bg-vio/5' : 'border-line/60 bg-raised/40')}>
                      <div className="flex items-center justify-between">
                        <span className="truncate font-mono text-[11px] text-mut">{n.name}</span>
                        {n.name === g.mainAdapter && <span className="rounded bg-vio/20 px-1 py-px text-[8px] font-bold text-vio">основной</span>}
                      </div>
                      <div className="mt-1 flex justify-between font-mono text-[11px]">
                        <span className="text-ok">↓ {fmtNet(n.rx)}</span>
                        <span className="text-blu">↑ {fmtNet(n.tx)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Температуры и датчики */}
            <div>
              <SectionTitle icon={<Thermometer className="h-4 w-4" />} text="Температуры и датчики" extra={`${g.sensors.length} шт`} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <MiniCell value={g.cput != null ? `${g.cput}°C` : '—'} label="CPU" color={g.cput != null && g.cput > 75 ? 'text-crit' : 'text-warn'} />
                <MiniCell value={g.gpuTemp != null ? `${g.gpuTemp}°C` : '—'} label="GPU" color={g.gpuTemp != null && g.gpuTemp > 80 ? 'text-crit' : 'text-warn'} />
                <MiniCell value={g.ssdt != null ? `${g.ssdt}°C` : '—'} label="SSD" color="text-[#d98bb0]" />
                {g.sensors.filter((s) => !/package|^cpu|gpu|ssd|nvme/i.test(s.label)).map((s, i) => (
                  <MiniCell key={i} value={`${s.value} ${s.unit}`} label={s.label} color={s.kind === 'fan' ? 'text-blu' : 'text-warn'} />
                ))}
              </div>
            </div>
          </>
        )}

        {/* relay-цели */}
        {a.targets.length > 0 && (
          <div>
            <SectionTitle icon={<Gauge className="h-4 w-4" />} text="Локальные устройства (relay)" extra={`${alive}/${total || '—'} живо`} />
            <div className="space-y-2">
              {a.targets.map((t) => <TargetBlock key={t.target} t={t} online={a.online} />)}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

export default function Agents() {
  const user = useCurrentUser();
  const agents = usePluto((s) => visibleAgents(s, user));
  const isAdmin = user?.role === 'admin';
  const routeParam = usePluto((s) => s.routeParam);

  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ open: boolean; initial: Agent | null }>({ open: false, initial: null });
  const [drawer, setDrawer] = useState<string | null>(null);

  useEffect(() => {
    if (routeParam === 'new') { setModal({ open: true, initial: null }); store.nav('agents'); }
  }, [routeParam]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter((a) => a.name.toLowerCase().includes(query) || a.ip.includes(query));
  }, [agents, q]);

  return (
    <div className="space-y-4">
      <Panel title={`Relay-агенты · ${agents.length}`} icon={<Monitor className="h-4 w-4" />}
        right={isAdmin ? (
          <button onClick={() => setModal({ open: true, initial: null })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-vio/50 bg-vio/20 px-3 py-1.5 text-[12.5px] font-bold text-ink transition-all hover:bg-vio/30">
            <Plus className="h-4 w-4" /> Добавить агента
          </button>
        ) : undefined}>
        <div className="mb-4 flex min-w-[220px] items-center gap-2 rounded-lg border border-line bg-raised/70 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени или IP…"
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-dim/80" />
          {q && <button onClick={() => setQ('')} className="text-dim hover:text-ink"><X className="h-3.5 w-3.5" /></button>}
        </div>

        {list.length === 0 ? (
          <EmptyState icon={<Monitor className="h-6 w-6" />} title={agents.length ? 'Ничего не найдено' : 'Relay-агентов пока нет'}
            text={agents.length ? 'Попробуйте другой запрос.' : 'Добавьте ПК с pluto-relay, чтобы пинговать устройства в его локальной сети (NAT/VLAN).'}
            action={isAdmin && !agents.length ? (
              <button onClick={() => setModal({ open: true, initial: null })}
                className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">
                Добавить агента
              </button>
            ) : undefined} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.map((a) => (
              <AgentCard key={a.id} a={a}
                onEdit={(ag) => setModal({ open: true, initial: ag })}
                onOpen={(ag) => setDrawer(ag.id)} />
            ))}
          </div>
        )}
      </Panel>

      <AgentModal open={modal.open} initial={modal.initial} onClose={() => setModal({ open: false, initial: null })} />
      {drawer && <AgentDrawer id={drawer} onClose={() => setDrawer(null)} onEdit={(ag) => { setDrawer(null); setModal({ open: true, initial: ag }); }} />}
    </div>
  );
}
