// ─── PLUTO: агенты на Windows-машинах ────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { I } from '../components/icons';
import { AreaChart, Bar, CopyBlock, Drawer, EmptyState, Panel, Ring, StatusDot, TimeAgo } from '../components/ui';
import { useStore, useToasts, useCurrentUser, visibleAgents } from '../lib/store';
import { setAgentOffline, setAgentOnline } from '../lib/engine';
import { cls, fmtBytes, fmtGb, pct, timeAgo } from '../lib/util';
import type { Agent } from '../lib/types';

// ─── Карточка агента ─────────────────────────────────────────────────────────

function AgentCard({ a, onOpen, delay }: { a: Agent; onOpen: () => void; delay: number }) {
  const toggleFav = useStore((s) => s.toggleAgentFav);
  return (
    <div
      className="rise group cursor-pointer rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40 hover:shadow-[0_16px_44px_-16px_rgba(0,0,0,.85)]"
      style={{ animationDelay: `${delay}ms` }}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2.5">
        <StatusDot status={a.online ? 'up' : 'down'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-[13.5px] font-semibold text-ink">{a.hostname}</span>
            {a.emulated && <span className="rounded border border-blu/40 bg-blu/10 px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-blu">эмуляция</span>}
          </div>
          <div className="font-mono text-[11px] text-dim">{a.ip} · {a.os.split(' ').slice(0, 2).join(' ')}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); toggleFav(a.id); }}
          className={cls('transition-all hover:scale-110', a.favorite ? 'text-warn' : 'text-dim hover:text-mut')}
          title={a.favorite ? 'Убрать из избранного' : 'В избранное'}
        >
          <I n="star" className={cls('h-4.5 w-4.5', a.favorite && 'fill-warn')} />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <Ring value={a.online ? a.cpuLoad : 0} size={66} label="ЦП" color={a.cpuLoad > 85 ? '#e07a80' : '#8f7df0'} />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div>
            <div className="mb-1 flex justify-between font-mono text-[10.5px] text-dim">
              <span>ОЗУ {fmtGb(a.ramTotal)}</span>
              <span className="text-mut">{a.online ? `${pct(a.ramUsed, a.ramTotal)}%` : '—'}</span>
            </div>
            <Bar value={a.online ? pct(a.ramUsed, a.ramTotal) : 0} color="#7ba4e6" />
          </div>
          <div>
            <div className="mb-1 flex justify-between font-mono text-[10.5px] text-dim">
              <span>Диски · {a.disks.length}</span>
              <span className="text-mut">{a.disks.map((d) => d.letter).join(' ')}</span>
            </div>
            <Bar value={a.disks.length ? pct(a.disks.reduce((s, d) => s + d.used, 0), a.disks.reduce((s, d) => s + d.total, 0)) : 0} color="#5fc6d8" />
          </div>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-line-soft pt-3 font-mono text-[10.5px]">
        <span className="flex items-center gap-1.5 text-dim"><I n="thermo" className="h-3.5 w-3.5 text-warn" /><span className="text-mut">{a.online ? `${Math.round(a.cpuTemp)}°C` : '—'}</span></span>
        <span className="flex items-center gap-1.5 text-dim"><I n="activity" className="h-3.5 w-3.5 text-blu" /><span className="text-mut">{a.online ? `${Math.round(a.rxRate + a.txRate)} КБ/с` : '—'}</span></span>
        <span className="flex items-center gap-1.5 text-dim"><I n="clock" className="h-3.5 w-3.5" /><span className="text-mut">{a.online ? <TimeAgo ts={a.lastSeen} /> : 'офлайн'}</span></span>
      </div>
    </div>
  );
}

// ─── Детальная панель агента ─────────────────────────────────────────────────

function AgentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const a = useStore((s) => s.agents.find((x) => x.id === id));
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const removeAgent = useStore((s) => s.removeAgent);
  const addDevice = useStore((s) => s.addDevice);
  const devices = useStore((s) => s.devices);
  const settings = useStore((s) => s.settings);
  const regenToken = useStore((s) => s.regenAgentToken);
  const toast = useToasts((s) => s.push);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showToken, setShowToken] = useState(false);
  useEffect(() => { setConfirmDel(false); setShowToken(false); }, [id]);

  if (!a) return null;

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <StatusDot status={a.online ? 'up' : 'down'} />
          <div>
            <div className="flex items-center gap-2 font-display text-[14px] font-semibold text-ink">
              {a.hostname}
              {a.emulated && <span className="rounded border border-blu/40 bg-blu/10 px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-blu">эмуляция</span>}
            </div>
            <div className="font-mono text-[11px] text-dim">{a.ip} · agent v{a.version}</div>
          </div>
          <span className={cls('ml-2 rounded-md px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase', a.online ? 'text-ok' : 'text-crit')} style={{ background: 'rgba(143,125,240,.08)' }}>
            {a.online ? 'в сети' : 'офлайн'}
          </span>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Телеметрия */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-line bg-raised/40 p-3.5">
            <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-dim">
              <span className="flex items-center gap-1.5"><I n="zap" className="h-3.5 w-3.5 text-vio" /> ЦП · {a.cpuCores} ядер</span>
              <span className="font-mono text-mut">{a.online ? `${Math.round(a.cpuLoad)}%` : '—'}</span>
            </div>
            <AreaChart values={a.history.map((h) => h.cpu)} max={100} unit="%" color="#8f7df0" height={80} />
          </div>
          <div className="rounded-lg border border-line bg-raised/40 p-3.5">
            <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-dim">
              <span className="flex items-center gap-1.5"><I n="box" className="h-3.5 w-3.5 text-blu" /> ОЗУ · {fmtGb(a.ramTotal)}</span>
              <span className="font-mono text-mut">{a.online ? `${fmtBytes(a.ramUsed)}` : '—'}</span>
            </div>
            <AreaChart values={a.history.map((h) => h.ram)} max={100} unit="%" color="#7ba4e6" height={80} />
          </div>
          <div className="rounded-lg border border-line bg-raised/40 p-3.5">
            <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-dim">
              <span className="flex items-center gap-1.5"><I n="net" className="h-3.5 w-3.5 text-[#5fc6d8]" /> Сеть · {a.netIface}</span>
              <span className="font-mono text-mut">{a.online ? `${Math.round(a.rxRate)}↓ / ${Math.round(a.txRate)}↑ КБ/с` : '—'}</span>
            </div>
            <AreaChart values={a.history.map((h) => h.rx)} unit=" КБ/с" color="#5fc6d8" height={80} />
          </div>
          <div className="rounded-lg border border-line bg-raised/40 p-3.5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-dim">Температуры</div>
            <div className="space-y-2.5 pt-1">
              <TempRow label="ЦП" value={a.cpuTemp} max={95} />
              <TempRow label="ОЗУ" value={a.ramTemp} max={85} />
              {a.disks.slice(0, 2).map((d) => <TempRow key={d.letter} label={`Диск ${d.letter}`} value={d.temp} max={70} />)}
              {!a.online && <p className="font-mono text-[11px] text-dim">телеметрия недоступна</p>}
            </div>
          </div>
        </div>

        {/* Диски */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-dim">
            <I n="hdd" className="h-3.5 w-3.5" /> Диски · {a.disks.length}
          </div>
          <div className="space-y-2">
            {a.disks.map((d) => (
              <div key={d.letter} className="rounded-lg border border-line bg-raised/40 px-3.5 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[12.5px] font-bold text-ink">{d.letter}: <span className="font-sans text-[11.5px] font-medium text-dim">{d.label}</span></span>
                  <span className="font-mono text-[11px] text-mut">{fmtBytes(d.used)} / {fmtBytes(d.total)} · {pct(d.used, d.total)}%</span>
                </div>
                <Bar className="mt-1.5" value={pct(d.used, d.total)} color="#5fc6d8" />
              </div>
            ))}
          </div>
        </div>

        {/* Счётчики сети */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-line bg-raised/40 p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Получено (RX)</div>
            <div className="mt-1 font-mono text-[17px] font-bold text-ink">{fmtBytes(a.rxBytes)}</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/40 p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Отправлено (TX)</div>
            <div className="mt-1 font-mono text-[17px] font-bold text-ink">{fmtBytes(a.txBytes)}</div>
          </div>
        </div>

        {/* Локальные сети */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-dim">
              <I n="radar" className="h-3.5 w-3.5" /> Локальные сети (ARP-скан агента)
            </span>
            <span className="font-mono text-[10.5px] text-dim">интервал: {settings.lanScan} с</span>
          </div>
          {a.networks.map((n) => (
            <div key={n.cidr} className="mb-3 overflow-hidden rounded-lg border border-line">
              <div className="flex items-center justify-between border-b border-line-soft bg-raised/50 px-3.5 py-2">
                <span className="font-mono text-[12px] font-bold text-ink">{n.cidr}</span>
                <span className="font-mono text-[10.5px] text-dim">{n.iface} · {n.hosts.filter((h) => h.online).length}/{n.hosts.length} в сети</span>
              </div>
              <ul>
                {n.hosts.map((h) => {
                  const monitored = devices.some((d) => d.address === h.ip);
                  return (
                    <li key={h.ip} className="flex items-center gap-2.5 border-b border-line-soft/50 px-3.5 py-1.5 last:border-0">
                      <span className={cls('h-1.5 w-1.5 rounded-full', h.online ? 'bg-ok' : 'bg-dim/50')} />
                      <span className="w-32 font-mono text-[11.5px] text-mut">{h.ip}</span>
                      <span className="hidden w-36 font-mono text-[10px] text-dim sm:block">{h.mac}</span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim">{h.hint ?? '—'}</span>
                      {isAdmin && (
                        monitored ? (
                          <span className="flex items-center gap-1 font-mono text-[10px] font-bold text-ok"><I n="check" className="h-3 w-3" /> в мониторинге</span>
                        ) : (
                          <button
                            className="rounded border border-vio/35 bg-vio/10 px-2 py-0.5 text-[10.5px] font-semibold text-vio transition-all hover:border-vio/60 hover:bg-vio/20"
                            onClick={() => {
                              addDevice({ name: h.hint ?? h.ip, type: 'ping', address: h.ip, interval: settings.intervals.ping, tags: [] });
                              toast('ok', `${h.ip} добавлен в мониторинг (ping)`);
                            }}>
                            + в мониторинг
                          </button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {!a.online && <p className="text-[11.5px] text-dim">Сканирование недоступно, пока агент офлайн.</p>}
        </div>

        {/* Управление */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
          {isAdmin && a.emulated && (
            a.online ? (
              <button className="btn-ghost" onClick={() => setAgentOffline(a)}><I n="power" className="h-4 w-4" /> Остановить агента</button>
            ) : (
              <button className="btn-ghost" onClick={() => setAgentOnline(a)}><I n="play" className="h-4 w-4" /> Запустить агента</button>
            )
          )}
          {isAdmin && (
            <button className="btn-ghost" onClick={() => setShowToken((v) => !v)}><I n="lock" className="h-4 w-4" /> Токен</button>
          )}
          {isAdmin && (
            <div className="ml-auto">
              {confirmDel ? (
                <span className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-crit">Удалить агента?</span>
                  <button className="btn-danger" onClick={() => { removeAgent(a.id); onClose(); }}>Да</button>
                  <button className="btn-ghost" onClick={() => setConfirmDel(false)}>Нет</button>
                </span>
              ) : (
                <button className="btn-danger" onClick={() => setConfirmDel(true)}><I n="trash" className="h-4 w-4" /> Удалить</button>
              )}
            </div>
          )}
        </div>

        {showToken && isAdmin && (
          <div className="space-y-2">
            <CopyBlock label={`Токен агента ${a.hostname}`} code={a.token} />
            <button className="btn-ghost" onClick={() => { regenToken(a.id); toast('ok', 'Новый токен выпущен'); }}>
              <I n="refresh" className="h-4 w-4" /> Перевыпустить токен
            </button>
          </div>
        )}

        <p className="font-mono text-[10.5px] text-dim">
          Подключён {timeAgo(a.connectedAt)} · heartbeat {timeAgo(a.lastSeen)} · {a.os}
        </p>
      </div>
    </Drawer>
  );
}

function TempRow({ label, value, max }: { label: string; value: number; max: number }) {
  const c = value > max * 0.85 ? '#e07a80' : value > max * 0.65 ? '#dfa65e' : '#55c795';
  return (
    <div>
      <div className="mb-1 flex justify-between font-mono text-[10.5px]">
        <span className="text-dim">{label}</span>
        <span style={{ color: c }}>{Math.round(value)}°C</span>
      </div>
      <Bar value={(value / max) * 100} color={c} />
    </div>
  );
}

// ─── Страница ────────────────────────────────────────────────────────────────

export default function Agents() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const allAgents = useStore((s) => s.agents);
  const agents = useMemo(() => visibleAgents(allAgents, user), [allAgents, user]);
  const addEmulated = useStore((s) => s.addEmulatedAgent);
  const toast = useToasts((s) => s.push);
  const nav = useStore((s) => s.nav);

  const [drawer, setDrawer] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const consumed = useRef(false);
  const routeParam = useStore((s) => s.routeParam);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    if (routeParam) {
      const a = useStore.getState().agents.find((x) => x.hostname === routeParam);
      if (a) setDrawer(a.id);
      nav('agents', '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const online = agents.filter((a) => a.online).length;

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-4 rounded-lg border border-line bg-raised/60 px-4 py-2.5">
          <span className="font-mono text-[12px] text-mut"><span className="font-bold text-ok">{online}</span> / {agents.length} в сети</span>
          <span className="h-4 w-px bg-line" />
          <span className="font-mono text-[12px] text-dim">телеметрия каждые {useStore.getState().settings.metrics} с</span>
        </div>

        <div className="ml-auto flex gap-2">
          {isAdmin && (
            <>
              <button className="btn-ghost" onClick={() => setShowInstall((v) => !v)}>
                <I n="terminal" className="h-4 w-4" /> Установка на Windows
              </button>
              <button className="btn-acc" onClick={() => { const a = addEmulated(); toast('ok', `Тестовый агент ${a.hostname} подключён`); setDrawer(a.id); }}>
                <I n="plus" className="h-4 w-4" /> Подключить тестового агента
              </button>
            </>
          )}
        </div>
      </div>

      {showInstall && isAdmin && (
        <Panel title="Подключение реального агента (Windows)" icon="terminal" delay={40}>
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-mut">
              Агент — один исполняемый файл на Go, без зависимостей. Ставится одной командой PowerShell, регистрируется как служба Windows
              и подключается к ядру по WebSocket с токеном. Токен выдаётся на этой странице или в <span className="text-vio">docker compose</span> при развёртывании.
            </p>
            <CopyBlock label="powershell · установка" code={`powershell -ExecutionPolicy Bypass -Command "irm https://get.pluto.mon/agent.ps1 | iex"`} />
            <CopyBlock label="powershell · регистрация службы и запуск" code={`pluto-agent.exe install --server wss://pluto.example.com:8443/ws --token <ТОКЕН_АГЕНТА>\nnet start pluto-agent`} />
            <p className="text-[11.5px] text-dim">Агент собирает: ЦП, ОЗУ, диски и температуры (WMI/OpenHardwareMonitor), сетевые счётчики, ARP-скан доступных локальных сетей. Подробнее — в разделе «Развёртывание».</p>
          </div>
        </Panel>
      )}

      {agents.length === 0 ? (
        <Panel title="Реестр агентов" icon="agents" delay={80}>
          <EmptyState
            icon="agents"
            title="Агентов пока нет"
            text="Подключите Windows-машину по токену или поднимите тестового агента, чтобы увидеть телеметрию: ЦП, ОЗУ, диски, температуры, сеть и LAN-скан."
            action={isAdmin ? (
              <button className="btn-acc" onClick={() => { const a = addEmulated(); toast('ok', `Тестовый агент ${a.hostname} подключён`); }}>
                <I n="plus" className="h-4 w-4" /> Подключить тестового агента
              </button>
            ) : undefined}
          />
        </Panel>
      ) : (
        <div className="grid gap-3.5 md:grid-cols-2 2xl:grid-cols-3">
          {agents.map((a, i) => (
            <AgentCard key={a.id} a={a} delay={Math.min(i * 60, 360)} onOpen={() => setDrawer(a.id)} />
          ))}
        </div>
      )}

      <AgentDrawer id={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
