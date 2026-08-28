// ─── PLUTO: агенты (IP + листинг AIDA64 + relay-пинги устройств в VLAN) ─────
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Star, Trash2, Pencil, Activity, Cpu, Thermometer, MemoryStick, HardDrive,
  Network, RefreshCw, ExternalLink, ChevronDown, X, LineChart, Radar,
} from 'lucide-react';
import { Drawer, EmptyState, Modal, Panel, StatusDot, TimeAgo, Field } from '../components/ui';
import { usePluto, useCurrentUser, visibleAgents, store, useToasts } from '../lib/store';
import { cls, fmtNet } from '../lib/util';
import type { Agent } from '../lib/types';

const LINE_COLORS = ['#8f7df0', '#7ba4e6', '#5fc6d8', '#55c795', '#dfa65e', '#e07a80', '#d98bb0', '#98a4c8', '#8bc46a', '#e0945e'];

function fmtUp(ms: number): string {
  if (!ms || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 1) return '< 1 мин';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин`;
  const d = Math.floor(h / 24);
  return `${d} д ${h % 24} ч`;
}

function fmtUpSec(sec: number | null): string {
  if (sec == null) return '—';
  return fmtUp(sec * 1000);
}

function availability(hist: { t: number; ms: number | null }[] | undefined): number | null {
  if (!hist || hist.length < 2) return null;
  const ok = hist.filter((p) => p.ms != null).length;
  return Math.round((ok / hist.length) * 100);
}

const isIp = (s: string) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
const isTarget = (s: string) =>
  isIp(s) || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}-\d{1,3}$/.test(s) || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(s);

// ─── Живой график задержек до агентов ────────────────────────────────────────

function LatencyChart({ agents }: { agents: Agent[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const { t0, t1, maxMs, series } = useMemo(() => {
    let mn = Infinity, mx = -Infinity, mm = 10;
    const series = agents
      .map((a, i) => ({
        agent: a,
        color: LINE_COLORS[i % LINE_COLORS.length],
        pts: (a.latHist || []).filter((p) => p.ms != null) as { t: number; ms: number }[],
      }))
      .filter((s) => s.pts.length > 1);
    for (const s of series) for (const p of s.pts) {
      if (p.t < mn) mn = p.t;
      if (p.t > mx) mx = p.t;
      if (p.ms > mm) mm = p.ms;
    }
    if (!isFinite(mn)) { mn = Date.now() - 60000; mx = Date.now(); }
    return { t0: mn, t1: Math.max(mx, mn + 1000), maxMs: Math.ceil(mm * 1.15), series };
  }, [agents]);

  const W = 1000, H = 250, PL = 8, PR = 8, PT = 10, PB = 22;
  const X = (t: number) => PL + ((t - t0) / (t1 - t0)) * (W - PL - PR);
  const Y = (v: number) => H - PB - (v / maxMs) * (H - PT - PB);

  const onMove = (e: React.MouseEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.min(W - PR, Math.max(PL, x)));
  };

  const hoverT = hover != null ? t0 + ((hover - PL) / (W - PL - PR)) * (t1 - t0) : null;
  const hoverVals = hoverT != null
    ? series.map((s) => {
        let best: { t: number; ms: number } | null = null;
        for (const p of s.pts) if (Math.abs(p.t - hoverT) < (t1 - t0) / 60) { if (!best || Math.abs(p.t - hoverT) < Math.abs(best.t - hoverT)) best = p; }
        return { name: s.agent.name, color: s.color, ms: best?.ms ?? null };
      })
    : [];

  return (
    <div>
      <div ref={boxRef} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 250 }} preserveAspectRatio="none">
          <defs>
            {series.map((s) => (
              <linearGradient key={s.agent.id} id={`ag-${s.agent.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity="0.22" />
                <stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={PL} x2={W - PR} y1={Y(maxMs * f)} y2={Y(maxMs * f)} stroke="#27304f" strokeWidth="1" strokeDasharray="3 6" />
              <text x={W - PR - 2} y={Y(maxMs * f) - 4} textAnchor="end" fontSize="11" fill="#5b6384" fontFamily="JetBrains Mono, monospace">
                {Math.round(maxMs * f)}
              </text>
            </g>
          ))}
          {series.map((s) => {
            const line = s.pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.ms).toFixed(1)}`).join(' ');
            const last = s.pts[s.pts.length - 1];
            return (
              <g key={s.agent.id}>
                <polygon
                  points={`${X(s.pts[0].t).toFixed(1)},${H - PB} ${line} ${X(last.t).toFixed(1)},${H - PB}`}
                  fill={`url(#ag-${s.agent.id})`}
                />
                <polyline points={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={X(last.t)} cy={Y(last.ms)} r="3.5" fill={s.color} stroke="#0b0e1a" strokeWidth="1.5">
                  <animate attributeName="r" values="3.5;5;3.5" dur="2.4s" repeatCount="indefinite" />
                </circle>
              </g>
            );
          })}
          {hover != null && <line x1={hover} x2={hover} y1={PT} y2={H - PB} stroke="#8f7df0" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />}
        </svg>
        {hover != null && hoverVals.length > 0 && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-panel/95 px-3 py-2 shadow-[0_10px_30px_-8px_rgba(0,0,0,.8)]"
            style={{ left: `${Math.max(2, Math.min(78, (hover / W) * 100))}%` }}
          >
            {hoverVals.map((v) => (
              <div key={v.name} className="flex items-center gap-2 py-0.5 font-mono text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.color }} />
                <span className="max-w-[140px] truncate text-mut">{v.name}</span>
                <span className="ml-auto font-bold" style={{ color: v.ms != null ? v.color : '#5b6384' }}>{v.ms != null ? `${v.ms} мс` : 'нет'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-dim">
        <span>{new Date(t0).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="uppercase tracking-wider">задержка, мс · окно ≈ {Math.max(1, Math.round((t1 - t0) / 60000))} мин</span>
        <span>{new Date(t1).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {series.map((s) => {
          const av = availability(s.agent.latHist);
          return (
            <div key={s.agent.id} className="flex items-center gap-2 rounded-lg border border-line bg-raised/40 px-2.5 py-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-[11.5px] font-semibold text-ink">{s.agent.name}</span>
              <span className="font-mono text-[11px] font-bold" style={{ color: s.color }}>{s.agent.latency != null ? `${s.agent.latency} мс` : '—'}</span>
              {av != null && <span className={cls('font-mono text-[10.5px]', av >= 95 ? 'text-ok' : av >= 80 ? 'text-warn' : 'text-crit')}>{av}%</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Мини-плитка статистики ──────────────────────────────────────────────────

function Stat({ icon, label, value, tone }: { icon?: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-raised/40 px-3 py-2">
      {icon && <span className="text-dim">{icon}</span>}
      <div className="min-w-0">
        <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-dim">{label}</div>
        <div className={cls('truncate font-mono text-[13px] font-bold tabular-nums', tone || 'text-ink')}>{value}</div>
      </div>
    </div>
  );
}

// ─── Карточка агента ─────────────────────────────────────────────────────────

function AgentCard({ a, onOpen, onFav }: { a: Agent; onOpen: () => void; onFav: () => void }) {
  const l = a.latest;
  return (
    <div className="group cursor-pointer rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40 hover:shadow-[0_16px_40px_-16px_rgba(0,0,0,.7)]" onClick={onOpen}>
      <div className="flex items-center gap-2">
        <StatusDot status={a.online ? 'up' : 'down'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-ink">{a.name}</div>
          <div className="font-mono text-[10.5px] text-dim">{a.ip}</div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onFav(); }} className={cls('transition-transform hover:scale-110', a.favorite ? 'text-warn' : 'text-dim opacity-0 group-hover:opacity-100')}>
          <Star className={cls('h-4 w-4', a.favorite && 'fill-warn')} strokeWidth={1.5} />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <div className="text-center">
          <div className={cls('font-mono text-[22px] font-bold tabular-nums leading-none', a.online ? 'text-vio' : 'text-dim')}>
            {a.latency != null ? a.latency : '—'}
          </div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.14em] text-dim">пинг, мс</div>
        </div>
        <div className="min-w-0 flex-1 border-l border-line-soft pl-4">
          <div className="flex justify-between font-mono text-[10.5px] text-dim">
            <span>в сети</span>
            <span className={a.online ? 'text-ok' : 'text-crit'}>{a.online ? fmtUp(a.onlineSince ? Date.now() - a.onlineSince : 0) : 'офлайн'}</span>
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10.5px] text-dim">
            <span>опрос</span>
            <span className="text-mut">{a.lastPoll ? <TimeAgo ts={a.lastPoll} /> : 'ещё не было'}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {[
          { v: l?.cpuTemp != null ? `${l.cpuTemp}°` : '—', t: 'ЦП °C', c: l && l.cpuTemp != null && l.cpuTemp > 75 ? 'text-crit' : 'text-warn' },
          { v: l?.cpuUsage != null ? `${l.cpuUsage}%` : '—', t: 'ЦП', c: 'text-vio' },
          { v: l?.ram != null ? `${l.ram}%` : '—', t: 'ОЗУ', c: 'text-blu' },
          { v: l?.ssdTemp != null ? `${l.ssdTemp}°` : '—', t: 'SSD °C', c: 'text-mint' },
        ].map((x) => (
          <div key={x.t} className="rounded-md border border-line-soft bg-raised/30 px-1.5 py-1.5 text-center">
            <div className={cls('font-mono text-[12.5px] font-bold tabular-nums', x.c)}>{x.v}</div>
            <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">{x.t}</div>
          </div>
        ))}
      </div>

      {a.targets.length > 0 && (
        <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[10px] text-dim">
          <Radar className="h-3 w-3 text-blu" />
          {a.targets.reduce((n, t) => n + t.results.length, 0)} устройств через relay
        </div>
      )}
    </div>
  );
}

// ─── Цель пинга (relay) ──────────────────────────────────────────────────────

function TargetRow({ a, target }: { a: Agent; target: string }) {
  const [open, setOpen] = useState(false);
  const info = a.targets.find((t) => t.target === target);
  const alive = info ? info.results.filter((r) => r.alive).length : 0;
  const total = info ? info.results.length : 0;
  const remove = () => store.updateAgent(a.id, { pingTargets: a.pingTargets.filter((t) => t !== target) });
  return (
    <div className="rounded-lg border border-line bg-raised/30">
      <div className="flex items-center gap-2 px-3 py-2">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
          <ChevronDown className={cls('h-3.5 w-3.5 shrink-0 text-dim transition-transform', open && 'rotate-180')} />
          <span className="truncate font-mono text-[12.5px] font-semibold text-ink">{target}</span>
          {info && (
            <span className={cls('ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10.5px] font-bold', alive === total && total > 0 ? 'bg-ok/10 text-ok' : alive === 0 ? 'bg-crit/10 text-crit' : 'bg-warn/10 text-warn')}>
              {alive}/{total}
            </span>
          )}
        </button>
        <button onClick={remove} className="shrink-0 rounded p-1 text-dim transition-colors hover:bg-crit/10 hover:text-crit" title="Убрать цель">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && info && (
        <div className="grid grid-cols-2 gap-1.5 border-t border-line-soft px-3 py-2.5 sm:grid-cols-3">
          {info.results.map((r) => (
            <div key={r.ip} className={cls('flex items-center justify-between rounded-md border px-2 py-1 font-mono text-[11px]', r.alive ? 'border-ok/25 bg-ok/5' : 'border-crit/25 bg-crit/5')}>
              <span className="text-mut">{r.ip}</span>
              <span className={r.alive ? 'font-bold text-ok' : 'text-crit'}>{r.alive ? `${r.latency ?? '?'} мс` : 'нет'}</span>
            </div>
          ))}
          {info.results.length === 0 && <p className="col-span-full py-1 text-[11.5px] text-dim">Результатов пока нет — нажмите «Опросить сейчас».</p>}
        </div>
      )}
      {open && !info && <p className="border-t border-line-soft px-3 py-2 text-[11.5px] text-dim">Ещё не опрошено. Нажмите «Опросить сейчас».</p>}
    </div>
  );
}

// ─── Модалка добавления ──────────────────────────────────────────────────────

function AddAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [aidaUrl, setAidaUrl] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [targets, setTargets] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setName(''); setIp(''); setAidaUrl(''); setRelayUrl(''); setTargets(''); setErr(''); }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) return setErr('Укажите имя');
    if (!isIp(ip.trim())) return setErr('IP-адрес в формате 192.168.1.10');
    if (aidaUrl.trim() && !/^https?:\/\//i.test(aidaUrl.trim())) return setErr('Ссылка AIDA64 должна начинаться с http://');
    if (relayUrl.trim() && !/^https?:\/\//i.test(relayUrl.trim())) return setErr('Адрес relay должен начинаться с http://');
    const list = targets.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const bad = list.find((t) => !isTarget(t));
    if (bad) return setErr(`Неверная цель пинга: «${bad}». Допустимо: IP, «IP-IP» или «IP/24»`);
    setBusy(true);
    const r = await store.addAgent({ name: name.trim(), ip: ip.trim(), aidaUrl: aidaUrl.trim(), relayUrl: relayUrl.trim(), pingTargets: list });
    setBusy(false);
    if (r) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Добавить агента">
      <div className="space-y-3.5">
        <Field label="Имя">
          <input className="inp" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} autoFocus />
        </Field>
        <Field label="IP-адрес" hint="Сервер будет пинговать этот адрес: доступность и статистика uptime.">
          <input className="inp font-mono" value={ip} onChange={(e) => { setIp(e.target.value); setErr(''); }} />
        </Field>
        <Field label="Ссылка на листинг AIDA64" hint="Сенсорная веб-страница AIDA64 (RemoteSensor). Строка листинга разбирается автоматически.">
          <input className="inp font-mono" value={aidaUrl} onChange={(e) => { setAidaUrl(e.target.value); setErr(''); }} />
        </Field>
        <Field label="Relay для пингов (необязательно)" hint="Адрес aida-monitor внутри VLAN агента — через него опрашиваются недоступные серверу устройства.">
          <input className="inp font-mono" value={relayUrl} onChange={(e) => { setRelayUrl(e.target.value); setErr(''); }} />
        </Field>
        <Field label="Устройства для пинга (необязательно)" hint="Через запятую: одиночные IP, диапазоны «192.168.1.10-20», подсети «192.168.1.0/24».">
          <textarea className="inp min-h-[64px] resize-y font-mono text-[12px]" value={targets} onChange={(e) => { setTargets(e.target.value); setErr(''); }} />
        </Field>
        {err && <p className="rounded-lg border border-crit/30 bg-crit/10 px-3 py-2 text-[12px] font-semibold text-crit">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-acc" onClick={submit} disabled={busy}>
            <Plus className="h-4 w-4" /> {busy ? 'Добавляем…' : 'Добавить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Модалка редактирования ──────────────────────────────────────────────────

function EditAgentModal({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [aidaUrl, setAidaUrl] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (agent) { setName(agent.name); setIp(agent.ip); setAidaUrl(agent.aidaUrl || ''); setRelayUrl(agent.relayUrl || ''); setErr(''); }
  }, [agent]);

  const submit = () => {
    if (!agent) return;
    if (!name.trim()) return setErr('Укажите имя');
    if (!isIp(ip.trim())) return setErr('IP-адрес в формате 192.168.1.10');
    store.updateAgent(agent.id, { name: name.trim(), ip: ip.trim(), aidaUrl: aidaUrl.trim(), relayUrl: relayUrl.trim() });
    useToasts.push('ok', 'Настройки агента сохранены');
    onClose();
  };

  return (
    <Modal open={!!agent} onClose={onClose} title="Настройки агента">
      <div className="space-y-3.5">
        <Field label="Имя"><input className="inp" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} /></Field>
        <Field label="IP-адрес"><input className="inp font-mono" value={ip} onChange={(e) => { setIp(e.target.value); setErr(''); }} /></Field>
        <Field label="Ссылка на листинг AIDA64"><input className="inp font-mono" value={aidaUrl} onChange={(e) => { setAidaUrl(e.target.value); setErr(''); }} /></Field>
        <Field label="Relay для пингов (необязательно)"><input className="inp font-mono" value={relayUrl} onChange={(e) => { setRelayUrl(e.target.value); setErr(''); }} /></Field>
        {err && <p className="rounded-lg border border-crit/30 bg-crit/10 px-3 py-2 text-[12px] font-semibold text-crit">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-acc" onClick={submit}><Pencil className="h-4 w-4" /> Сохранить</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Страница ────────────────────────────────────────────────────────────────

export default function Agents() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const allAgents = usePluto((s) => s.agents);
  const routeParam = usePluto((s) => s.routeParam);
  const nav = store.nav;
  const agents = useMemo(() => visibleAgents(allAgents, user), [allAgents, user]);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [newTarget, setNewTarget] = useState('');
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!routeParam) return;
    if (routeParam === 'new') { if (isAdmin) setAddOpen(true); return; }
    const a = agents.find((x) => x.ip === routeParam || x.name === routeParam);
    if (a) setDrawerId(a.id);
  }, [routeParam, isAdmin, agents]);

  const online = agents.filter((a) => a.online).length;
  const avgLat = useMemo(() => {
    const v = agents.map((a) => a.latency).filter((x): x is number => x != null);
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  }, [agents]);
  const drawerAgent = drawerId ? agents.find((a) => a.id === drawerId) : undefined;
  const l = drawerAgent?.latest ?? null;

  const addTarget = () => {
    if (!drawerAgent) return;
    const t = newTarget.trim();
    if (!isTarget(t)) { useToasts.push('warn', 'Формат: IP, «IP-IP» или «IP/24»'); return; }
    if (drawerAgent.pingTargets.includes(t)) { useToasts.push('warn', 'Такая цель уже есть'); return; }
    store.updateAgent(drawerAgent.id, { pingTargets: [...drawerAgent.pingTargets, t] });
    setNewTarget('');
    useToasts.push('ok', `Цель «${t}» добавлена`);
  };

  const pollNow = async () => {
    if (!drawerAgent) return;
    setPolling(true);
    await store.pollAgent(drawerAgent.id);
    setPolling(false);
  };

  return (
    <div className="space-y-4">
      {/* Пульс сети — живой график вместо инструкции подключения */}
      <Panel
        title="Пульс сети · задержка до агентов"
        icon={<LineChart className="h-4 w-4" />}
        delay={0}
        right={
          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span className={cls('flex items-center gap-1.5', online === agents.length && agents.length > 0 ? 'text-ok' : 'text-warn')}>
              <span className={cls('h-1.5 w-1.5 rounded-full', online === agents.length && agents.length > 0 ? 'bg-ok' : 'bg-warn')} />
              в сети {online}/{agents.length}
            </span>
            <span className="text-dim">ср. задержка <b className="text-vio">{avgLat != null ? `${avgLat} мс` : '—'}</b></span>
          </div>
        }
      >
        {agents.length === 0 || agents.every((a) => !(a.latHist && a.latHist.length > 1)) ? (
          <div className="flex items-center gap-3 py-6">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute h-full w-full animate-ping rounded-full bg-vio opacity-50" style={{ animationDuration: '2s' }} />
              <span className="relative h-2.5 w-2.5 rounded-full bg-vio" />
            </span>
            <p className="text-[12.5px] text-dim">
              График оживает после первых опросов: каждая линия — задержка пинга до агента, в легенде — доступность за период.
            </p>
          </div>
        ) : (
          <LatencyChart agents={agents} />
        )}
      </Panel>

      <Panel
        title={`Агенты · ${agents.length}`}
        icon={<Activity className="h-4 w-4" />}
        delay={60}
        right={isAdmin ? (
          <button className="btn-acc" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Добавить агента</button>
        ) : undefined}
      >
        {agents.length === 0 ? (
          <EmptyState
            icon={<Network className="h-6 w-6" />}
            title="Агентов пока нет"
            text="Агент — это IP-адрес машины и ссылка на листинг AIDA64. Сервер сам пингует адрес (uptime), читает листинг и через relay опрашивает устройства внутри VLAN."
            action={isAdmin ? <button className="btn-acc" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Добавить первого агента</button> : undefined}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((a) => (
              <AgentCard key={a.id} a={a} onOpen={() => setDrawerId(a.id)} onFav={() => store.toggleAgentFav(a.id)} />
            ))}
          </div>
        )}
      </Panel>

      {/* Детали агента */}
      <Drawer
        open={!!drawerAgent}
        onClose={() => setDrawerId(null)}
        title={drawerAgent ? (
          <div className="flex items-center gap-2.5">
            <StatusDot status={drawerAgent.online ? 'up' : 'down'} />
            <div>
              <div className="font-display text-[14px] font-bold text-ink">{drawerAgent.name}</div>
              <div className="font-mono text-[11px] text-dim">{drawerAgent.ip}</div>
            </div>
          </div>
        ) : null}
      >
        {drawerAgent && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={<Activity className="h-4 w-4" />} label="Пинг" value={drawerAgent.latency != null ? `${drawerAgent.latency} мс` : 'нет ответа'} tone={drawerAgent.online ? 'text-ok' : 'text-crit'} />
              <Stat icon={<Network className="h-4 w-4" />} label="В сети" value={drawerAgent.online ? fmtUp(drawerAgent.onlineSince ? Date.now() - drawerAgent.onlineSince : 0) : 'офлайн'} tone={drawerAgent.online ? 'text-ok' : 'text-crit'} />
              <Stat label="Uptime (AIDA)" value={fmtUpSec(l?.uptimeSec ?? null)} />
              <Stat label="Последний опрос" value={drawerAgent.lastPoll ? new Date(drawerAgent.lastPoll).toLocaleTimeString('ru-RU') : '—'} />
            </div>

            {drawerAgent.lastError && (
              <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] font-semibold text-warn">{drawerAgent.lastError}</p>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-dim">Показания AIDA64</h4>
                <button className="flex items-center gap-1 text-[11.5px] font-semibold text-vio transition-colors hover:text-ink" onClick={() => nav('telemetry', drawerAgent.id)}>
                  Журнал телеметрии <ExternalLink className="h-3 w-3" />
                </button>
              </div>
              {l ? (
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { v: l.cpuUsage != null ? `${l.cpuUsage}%` : '—', t: 'ЦП', c: 'text-vio', i: <Cpu className="h-3.5 w-3.5" /> },
                    { v: l.cpuTemp != null ? `${l.cpuTemp}°C` : '—', t: 't°C ЦП', c: 'text-warn', i: <Thermometer className="h-3.5 w-3.5" /> },
                    { v: l.ram != null ? `${l.ram}%` : '—', t: 'ОЗУ', c: 'text-blu', i: <MemoryStick className="h-3.5 w-3.5" /> },
                    { v: l.ssdTemp != null ? `${l.ssdTemp}°C` : '—', t: 't°C SSD', c: 'text-mint', i: <HardDrive className="h-3.5 w-3.5" /> },
                    { v: l.diskC != null ? `${l.diskC}%` : '—', t: 'Диск C', c: 'text-ink', i: <HardDrive className="h-3.5 w-3.5" /> },
                    { v: l.usedSpaceC != null ? `${l.usedSpaceC} ГБ` : '—', t: 'Занято C', c: 'text-ink', i: <HardDrive className="h-3.5 w-3.5" /> },
                    { v: fmtNet(l.tx), t: 'TX', c: 'text-blu', i: <Network className="h-3.5 w-3.5" /> },
                    { v: fmtNet(l.rx), t: 'RX', c: 'text-mint', i: <Network className="h-3.5 w-3.5" /> },
                  ].map((x) => (
                    <div key={x.t} className="rounded-lg border border-line bg-raised/30 px-2 py-2">
                      <div className="flex items-center gap-1 text-dim">{x.i}<span className="text-[8.5px] font-bold uppercase tracking-wider">{x.t}</span></div>
                      <div className={cls('mt-1 font-mono text-[13px] font-bold tabular-nums', x.c)}>{x.v}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-line bg-raised/20 px-3 py-3 text-[12px] text-dim">
                  Показаний пока нет{drawerAgent.aidaUrl ? ' — листинг ещё не прочитан.' : ' — не указана ссылка на листинг AIDA64.'}
                </p>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-dim">Устройства в сети агента · relay</h4>
                {isAdmin && (
                  <button className="btn-ghost !py-1" onClick={pollNow} disabled={polling}>
                    <RefreshCw className={cls('h-3.5 w-3.5', polling && 'animate-spin')} /> Опросить сейчас
                  </button>
                )}
              </div>
              {!drawerAgent.relayUrl && (
                <p className="mb-2 rounded-lg border border-blu/25 bg-blu/5 px-3 py-2 text-[11.5px] leading-relaxed text-blu">
                  Relay не настроен. Укажите адрес aida-monitor в настройках агента — и сервер сможет пинговать устройства
                  внутри VLAN, недоступные ему напрямую.
                </p>
              )}
              <div className="space-y-1.5">
                {drawerAgent.pingTargets.map((t) => <TargetRow key={t} a={drawerAgent} target={t} />)}
                {drawerAgent.pingTargets.length === 0 && (
                  <p className="rounded-lg border border-dashed border-line bg-raised/20 px-3 py-3 text-[12px] text-dim">Целей пока нет.</p>
                )}
              </div>
              {isAdmin && (
                <div className="mt-2 flex gap-2">
                  <input
                    className="inp font-mono text-[12px]"
                    placeholder="192.168.1.10 · 192.168.1.10-20 · 192.168.1.0/24"
                    value={newTarget}
                    onChange={(e) => setNewTarget(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTarget()}
                  />
                  <button className="btn-ghost shrink-0" onClick={addTarget}><Plus className="h-4 w-4" /> Цель</button>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="flex gap-2 border-t border-line-soft pt-4">
                <button className="btn-ghost flex-1" onClick={() => setEditAgent(drawerAgent)}><Pencil className="h-4 w-4" /> Изменить</button>
                <button className="btn-danger flex-1" onClick={() => setConfirmDel(drawerAgent.id)}><Trash2 className="h-4 w-4" /> Удалить</button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <AddAgentModal open={addOpen} onClose={() => setAddOpen(false)} />
      <EditAgentModal agent={editAgent} onClose={() => setEditAgent(null)} />

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Удалить агента?" width="max-w-sm">
        <p className="text-[13px] leading-relaxed text-mut">Агент, его история задержек и архив AIDA64 будут удалены из базы.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Отмена</button>
          <button className="btn-danger" onClick={() => { if (confirmDel) { store.removeAgent(confirmDel); setConfirmDel(null); setDrawerId(null); } }}>Удалить</button>
        </div>
      </Modal>
    </div>
  );
}
