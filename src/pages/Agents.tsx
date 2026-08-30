// ─── PLUTO: агенты = IP + Glances + relay-пинги (без установки ПО) ───────────
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Star, Trash2, Pencil, Activity, Cpu, Thermometer, MemoryStick, HardDrive,
  Network, RefreshCw, ExternalLink, Radar, Search, AlertTriangle, Gauge, BarChart3,
} from 'lucide-react';
import { Bar, Drawer, EmptyState, Field, Modal, Panel, StatusDot, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, visibleAgents } from '../lib/store';
import { api } from '../lib/api';
import { cls, fmtNet, fmtUp, fmtUpSec, LINE_COLORS } from '../lib/util';
import { GLANCES_FIELDS, type Agent, type SourceTestReport } from '../lib/types';

const isIp = (s: string) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
const isTarget = (s: string) =>
  isIp(s) || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}-\d{1,3}$/.test(s) || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(s);

function availability(hist: { t: number; ms: number | null }[] | undefined): number | null {
  if (!hist || hist.length < 2) return null;
  const ok = hist.filter((p) => p.ms != null).length;
  return Math.round((ok / hist.length) * 100);
}

// ─── Диагностика источника (Glances) ─────────────────────────────────────────

function TestSourcePanel({ agent }: { agent: Agent }) {
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState<SourceTestReport | null>(null);
  const url = agent.glancesUrl;
  const fields = GLANCES_FIELDS;

  const run = async () => {
    setBusy(true);
    try { setRep(await api.testAgentSource(agent.id)); }
    catch (e) { setRep({ ok: false, url, via: null, error: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <button className="btn-ghost !py-1" onClick={run} disabled={busy || !url}>
        <Search className={cls('h-3.5 w-3.5', busy && 'animate-pulse')} /> Проверить источник
      </button>

      {rep && (
        <div className={cls('rise rounded-lg border px-3 py-2.5', rep.ok ? 'border-ok/30 bg-ok/10' : 'border-crit/30 bg-crit/10')}>
          <div className="flex items-center gap-1.5">
            {rep.ok ? <Activity className="h-3.5 w-3.5 text-ok" /> : <AlertTriangle className="h-3.5 w-3.5 text-crit" />}
            <span className={cls('text-[12px] font-bold', rep.ok ? 'text-ok' : 'text-crit')}>
              {rep.ok
                ? `Распознано ${rep.recognized?.length ?? 0} из ${fields.length} полей · ${rep.via === 'relay' ? 'через relay' : 'напрямую'} · ${rep.bytes ?? 0} Б`
                : 'Источник недоступен'}
            </span>
          </div>

          {!rep.ok && rep.error && <p className="mt-1.5 text-[11.5px] leading-snug text-crit/90">{rep.error}</p>}

          {rep.ok && (
            <div className="mt-2 flex flex-wrap gap-1">
              {fields.map((f) => {
                const on = rep.recognized?.includes(String(f.k));
                const v = rep.values?.[String(f.k)];
                return (
                  <span key={String(f.k)} className={cls('rounded border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold', on ? 'border-ok/40 bg-ok/15 text-ok' : 'border-line bg-raised/40 text-dim')}>
                    {f.label}{on && v != null ? ` ${v}${f.unit === 'КБ/с' ? '' : f.unit}` : ''}
                  </span>
                );
              })}
            </div>
          )}

          {rep.sample && <pre className="scroll-thin mt-2 max-h-20 overflow-auto rounded bg-void/40 px-2 py-1.5 font-mono text-[10px] leading-snug text-mut">{rep.sample}</pre>}
        </div>
      )}
    </div>
  );
}

// ─── «Пульс сети»: задержка до каждого агента ───────────────────────────────

function PulseChart({ agents }: { agents: Agent[] }) {
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);
  const W = 900, H = 150, PAD = 8;
  const now = Date.now();
  const windowMs = 15 * 60000;

  const series = useMemo(() => agents.map((a, i) => ({
    a,
    color: LINE_COLORS[i % LINE_COLORS.length],
    pts: (a.latHist || []).filter((p) => p.t >= now - windowMs),
  })), [agents, now]);

  const maxMs = Math.max(60, ...series.flatMap((s) => s.pts.map((p) => p.ms ?? 0))) * 1.1;

  const x = (t: number) => PAD + ((t - (now - windowMs)) / windowMs) * (W - PAD * 2);
  const y = (ms: number) => H - PAD - (ms / maxMs) * (H - PAD * 2);

  const hoverInfo = hover
    ? series.map((s) => {
        const p = s.pts[hover.idx];
        return p ? { name: s.a.name, color: s.color, ms: p.ms } : null;
      }).filter(Boolean) as { name: string; color: string; ms: number | null }[]
    : [];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 190 }}
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          let best = -1, bestD = 1e9;
          for (const s of series) {
            s.pts.forEach((p, idx) => {
              const d = Math.abs(x(p.t) - px);
              if (d < bestD) { bestD = d; best = idx; }
            });
          }
          setHover(best >= 0 ? { x: px, idx: best } : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} stroke="#242b4a" strokeWidth="1" strokeDasharray="4 6" />
        ))}
        {series.map((s) => {
          if (s.pts.length < 2) return null;
          const d = s.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.ms ?? 0).toFixed(1)}`).join(' ');
          const last = s.pts[s.pts.length - 1];
          return (
            <g key={s.a.id}>
              <path d={d} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" opacity="0.9" />
              {last.ms != null && <circle cx={x(last.t)} cy={y(last.ms)} r="3.2" fill={s.color} className="dot-live" />}
            </g>
          );
        })}
        {hover && <line x1={hover.x} x2={hover.x} y1={PAD} y2={H - PAD} stroke="#8b93b8" strokeWidth="1" opacity="0.5" />}
      </svg>

      {hover && hoverInfo.length > 0 && (
        <div className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-panel/95 px-3 py-2 shadow-xl" style={{ left: `${(hover.x / W) * 100}%`, transform: hover.x > W * 0.6 ? 'translateX(-105%)' : 'translateX(8px)' }}>
          {hoverInfo.map((h) => (
            <div key={h.name} className="flex items-center gap-2 py-0.5 font-mono text-[11px]">
              <span className="h-2 w-2 rounded-full" style={{ background: h.color }} />
              <span className="max-w-[140px] truncate text-mut">{h.name}</span>
              <span className="ml-auto font-bold text-ink">{h.ms != null ? `${h.ms} мс` : 'сбой'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s) => {
          const avail = availability(s.a.latHist);
          const last = s.pts[s.pts.length - 1];
          return (
            <div key={s.a.id} className="flex items-center gap-1.5 font-mono text-[10.5px] text-dim">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="max-w-[130px] truncate text-mut">{s.a.name}</span>
              <span className={last && last.ms != null ? 'text-ink' : 'text-crit'}>{last && last.ms != null ? `${last.ms} мс` : '—'}</span>
              {avail != null && <span className={avail > 95 ? 'text-ok' : avail > 80 ? 'text-warn' : 'text-crit'}>· {avail}%</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Карточка агента ────────────────────────────────────────────────────────

/** Мини-ячейка карточки: значение + подпись + индикатор-полоса */
function Cell({ v, t, c, bar, icon }: { v: string; t: string; c: string; bar?: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line/60 bg-raised/30 px-1.5 py-1.5 text-center transition-colors hover:border-line">
      <div className="flex items-center justify-center gap-1 text-dim">
        {icon}
        <span className={cls('font-mono text-[12.5px] font-bold tabular-nums leading-tight', c)}>{v}</span>
      </div>
      <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wider text-dim">{t}</div>
      {bar != null && <Bar value={bar} className="mt-1 h-[3px]" />}
    </div>
  );
}

/** Мини-диаграмма дисков: количество + полоски заполненности каждой ФС */
function DisksCell({ a }: { a: Agent }) {
  const gl = a.glancesLatest;
  const disks = a.glancesDisks || [];
  return (
    <div className="rounded-md border border-line/60 bg-raised/30 px-1.5 py-1.5 text-center">
      <div className="flex items-center justify-center gap-1 text-dim">
        <HardDrive className="h-3 w-3" />
        <span className="font-mono text-[12.5px] font-bold tabular-nums leading-tight text-ink">
          {gl?.diskCount != null ? gl.diskCount : disks.length || '—'}
          <span className="text-[8.5px] font-semibold text-dim"> ФС</span>
        </span>
      </div>
      <div className="mt-1 space-y-[3px]">
        {(disks.length ? disks.slice(0, 3) : [null, null, null]).map((d, i) => (
          <div key={i} className="h-[3px] overflow-hidden rounded-full bg-line/50">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${d?.percent ?? 0}%`,
                background: (d?.percent ?? 0) > 85 ? '#e07a80' : (d?.percent ?? 0) > 65 ? '#dfa65e' : '#7ba4e6',
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wider text-dim">
        дисков{disks.length > 3 ? ` · ещё ${disks.length - 3}` : ''}
      </div>
    </div>
  );
}

function AgentCard({ a, onOpen, onFav }: { a: Agent; onOpen: () => void; onFav: () => void }) {
  const gl = a.glancesLatest;
  const hot = (v: number | null, warn: number, crit: number) =>
    v == null ? 'text-dim' : v >= crit ? 'text-crit' : v >= warn ? 'text-warn' : 'text-ok';

  return (
    <div className="group cursor-pointer rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40 hover:shadow-[0_16px_40px_-16px_rgba(0,0,0,.7)]" onClick={onOpen}>
      <div className="flex items-center gap-2">
        <StatusDot status={a.online ? 'up' : 'down'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-ink">{a.name}</div>
          <div className="font-mono text-[10.5px] text-dim">{a.ip}{a.glancesNetIface ? ` · ${a.glancesNetIface}` : ''}</div>
        </div>
        {a.glancesUrl && (
          <span className="rounded border border-blu/40 bg-blu/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-blu" title="Собирается Glances">GL</span>
        )}
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
        <div className="min-w-0 flex-1 border-l border-line/60 pl-4">
          <div className="flex justify-between font-mono text-[10.5px] text-dim">
            <span>в сети</span>
            <span className={a.online ? 'text-ok' : 'text-crit'}>{a.online ? fmtUp(a.onlineSince ? Date.now() - a.onlineSince : 0) : 'офлайн'}</span>
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10.5px] text-dim">
            <span>Glances</span>
            <span className="text-mut">{a.lastGlances ? <TimeAgo ts={a.lastGlances} /> : 'ещё не было'}</span>
          </div>
        </div>
      </div>

      {/* 8 ячеек в 2 ряда: ЦП, t°C ЦП, диск C:, t°C SSD, ОЗУ, диски, RX, TX */}
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <Cell icon={<Gauge className="h-3 w-3" />} v={gl?.cpu != null ? `${gl.cpu}%` : '—'} t="ЦП" c="text-vio" bar={gl?.cpu ?? undefined} />
        <Cell icon={<Thermometer className="h-3 w-3" />} v={gl?.pkg != null ? `${gl.pkg}°` : '—'} t="t°C ЦП" c={hot(gl?.pkg ?? null, 70, 85)} />
        <Cell icon={<HardDrive className="h-3 w-3" />} v={gl?.diskUsed != null ? `${gl.diskUsed}%` : '—'} t="диск C:" c={hot(gl?.diskUsed != null ? gl.diskUsed - 20 : null, 70, 88)} bar={gl?.diskUsed ?? undefined} />
        <Cell icon={<Thermometer className="h-3 w-3" />} v={gl?.ssdTemp != null ? `${gl.ssdTemp}°` : '—'} t="t°C SSD" c={hot(gl?.ssdTemp ?? null, 60, 70)} />
        <Cell icon={<MemoryStick className="h-3 w-3" />} v={gl?.mem != null ? `${gl.mem}%` : '—'} t="ОЗУ" c="text-blu" bar={gl?.mem ?? undefined} />
        <DisksCell a={a} />
        <Cell icon={<Network className="h-3 w-3" />} v={gl?.rx != null ? fmtNet(gl.rx) : '—'} t="RX" c="text-mint" />
        <Cell icon={<Network className="h-3 w-3" />} v={gl?.tx != null ? fmtNet(gl.tx) : '—'} t="TX" c="text-blu" />
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

// ─── Формы добавления / редактирования ──────────────────────────────────────

function AgentForm({ initial, onClose }: { initial: Agent | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [glancesUrl, setGlancesUrl] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [targets, setTargets] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (initial) {
      setName(initial.name); setIp(initial.ip);
      setGlancesUrl(initial.glancesUrl || ''); setRelayUrl(initial.relayUrl || '');
      setTargets((initial.pingTargets || []).join('\n')); setErr('');
    }
  }, [initial]);

  const submit = async () => {
    setErr('');
    if (!name.trim()) return setErr('Укажите имя');
    if (!isIp(ip.trim())) return setErr('IP-адрес в формате 192.168.1.10');
    if (glancesUrl.trim() && !/^https?:\/\//i.test(glancesUrl.trim())) return setErr('Адрес Glances должен начинаться с http://');
    if (relayUrl.trim() && !/^https?:\/\//i.test(relayUrl.trim())) return setErr('Адрес relay должен начинаться с http://');
    const list = targets.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const bad = list.find((t) => !isTarget(t));
    if (bad) return setErr(`Некорректная цель пинга: «${bad}». Форматы: 1.2.3.4, 1.2.3.10-20, 1.2.3.0/24`);

    if (initial) {
      store.updateAgent(initial.id, { name: name.trim(), ip: ip.trim(), glancesUrl: glancesUrl.trim(), relayUrl: relayUrl.trim(), pingTargets: list });
      onClose();
    } else {
      await store.addAgent({ name: name.trim(), ip: ip.trim(), glancesUrl: glancesUrl.trim(), relayUrl: relayUrl.trim(), pingTargets: list });
      onClose();
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Имя">
        <input className="inp" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} />
      </Field>
      <Field label="IP-адрес ПК" hint="Сервер будет пинговать этот адрес: доступность и статистика uptime">
        <input className="inp font-mono" value={ip} onChange={(e) => { setIp(e.target.value); setErr(''); }} />
      </Field>
      <Field label="Адрес Glances" hint="Glances (glances -w, порт 61208): данные через REST API — ЦП по ядрам, ОЗУ, swap, диски, сеть, датчики. Хранение — 30 дней.">
        <input className="inp font-mono" value={glancesUrl} onChange={(e) => { setGlancesUrl(e.target.value); setErr(''); }} placeholder="http://192.168.1.10:61208/" />
      </Field>
      <Field label="Relay для пингов и loopback (необязательно)" hint="Адрес pluto-relay внутри сети агента (по умолчанию :8091). Через него сервер пингует недоступные себе устройства и открывает локальные страницы (127.0.0.1).">
        <input className="inp font-mono" value={relayUrl} onChange={(e) => { setRelayUrl(e.target.value); setErr(''); }} placeholder="http://192.168.1.10:8091/" />
      </Field>
      <Field label="Цели пинга через relay (необязательно)" hint="По строке на цель: одиночный IP, диапазон 1.2.3.10-20 или подсеть 1.2.3.0/24. Пингуются изнутри VLAN агента.">
        <textarea className="inp min-h-[70px] resize-y font-mono text-[12px]" value={targets} onChange={(e) => { setTargets(e.target.value); setErr(''); }} />
      </Field>

      {err && <p className="rounded-lg border border-crit/35 bg-crit/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-crit">{err}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn-acc" onClick={submit}>
          <Plus className="h-4 w-4" /> {initial ? 'Сохранить' : 'Добавить агента'}
        </button>
      </div>
    </div>
  );
}

// ─── Детали агента ──────────────────────────────────────────────────────────

function AgentDrawer({ agent, onClose, onEdit, isAdmin }: { agent: Agent | null; onClose: () => void; onEdit: () => void; isAdmin: boolean }) {
  const [polling, setPolling] = useState(false);
  const [newTarget, setNewTarget] = useState('');
  const [targetErr, setTargetErr] = useState('');

  if (!agent) return <Drawer open={false} onClose={onClose} title=""><div /></Drawer>;
  const gl = agent.glancesLatest;

  const pollNow = async () => {
    setPolling(true);
    await store.pollAgentNow(agent.id);
    setPolling(false);
  };

  const addTarget = () => {
    const t = newTarget.trim();
    if (!t) return;
    if (!isTarget(t)) return setTargetErr('Форматы: 1.2.3.4, 1.2.3.10-20, 1.2.3.0/24');
    if ((agent.pingTargets || []).includes(t)) return setTargetErr('Такая цель уже есть');
    store.updateAgent(agent.id, { pingTargets: [...(agent.pingTargets || []), t] });
    setNewTarget('');
    setTargetErr('');
  };

  return (
    <Drawer
      open={!!agent}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <StatusDot status={agent.online ? 'up' : 'down'} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-bold text-ink">{agent.name}</div>
            <div className="font-mono text-[10.5px] text-dim">
              {agent.ip}
              {agent.glancesUrl && <span className="ml-2 rounded border border-blu/40 bg-blu/10 px-1 py-0.5 text-[8.5px] font-bold text-blu">GLANCES</span>}
              {agent.glancesNetIface && <span className="ml-1.5 rounded border border-mint/40 bg-mint/10 px-1 py-0.5 text-[8.5px] font-bold text-mint">{agent.glancesNetIface}</span>}
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-line bg-raised/40 p-3">
            <div className={cls('font-mono text-[20px] font-bold tabular-nums', agent.online ? 'text-vio' : 'text-dim')}>{agent.latency != null ? agent.latency : '—'}</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-dim">пинг, мс</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/40 p-3">
            <div className="font-mono text-[20px] font-bold tabular-nums text-ok">{agent.online ? fmtUp(agent.onlineSince ? Date.now() - agent.onlineSince : 0) : '—'}</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-dim">в сети</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/40 p-3">
            <div className="font-mono text-[20px] font-bold tabular-nums text-ink">{fmtUpSec(gl?.uptimeSec ?? null)}</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-dim">uptime (Glances)</div>
          </div>
        </div>

        {agent.lastError && (
          <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] font-semibold text-warn">{agent.lastError}</p>
        )}

        {/* Glances: полная детализация */}
        {agent.glancesUrl && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-dim">Показания Glances · 30 дней</h4>
              <button className="flex items-center gap-1 text-[11.5px] font-semibold text-blu transition-colors hover:text-ink" onClick={() => store.nav('telemetry', agent.id)}>
                Журнал телеметрии <ExternalLink className="h-3 w-3" />
              </button>
            </div>
            {gl ? (
              <>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { v: gl.cpu != null ? `${gl.cpu}%` : '—', t: 'CPU', c: 'text-vio', i: <Gauge className="h-3.5 w-3.5" /> },
                    { v: gl.user != null ? `${gl.user}%` : '—', t: 'user', c: 'text-blu', i: <Cpu className="h-3.5 w-3.5" /> },
                    { v: gl.system != null ? `${gl.system}%` : '—', t: 'system', c: 'text-blu', i: <Cpu className="h-3.5 w-3.5" /> },
                    { v: gl.iowait != null ? `${gl.iowait}%` : '—', t: 'iowait', c: 'text-warn', i: <Cpu className="h-3.5 w-3.5" /> },
                    { v: gl.idle != null ? `${gl.idle}%` : '—', t: 'idle', c: 'text-dim', i: <Cpu className="h-3.5 w-3.5" /> },
                    { v: gl.pkg != null ? `${gl.pkg}°C` : '—', t: 't°C ЦП', c: (gl.pkg ?? 0) > 78 ? 'text-crit' : 'text-warn', i: <Thermometer className="h-3.5 w-3.5" /> },
                    { v: gl.ssdTemp != null ? `${gl.ssdTemp}°C` : '—', t: 't°C SSD', c: 'text-mint', i: <Thermometer className="h-3.5 w-3.5" /> },
                    { v: gl.mem != null ? `${gl.mem}%` : '—', t: 'ОЗУ', c: 'text-mint', i: <MemoryStick className="h-3.5 w-3.5" /> },
                    { v: gl.memUsed != null ? `${gl.memUsed}/${gl.memTotal ?? '—'} ГБ` : '—', t: 'ОЗУ исп/всего', c: 'text-ink', i: <MemoryStick className="h-3.5 w-3.5" /> },
                    { v: gl.swap != null ? `${gl.swap}%` : '—', t: 'swap', c: 'text-dim', i: <MemoryStick className="h-3.5 w-3.5" /> },
                    { v: fmtNet(gl.rx), t: 'Rx/s', c: 'text-blu', i: <Network className="h-3.5 w-3.5" /> },
                    { v: fmtNet(gl.tx), t: 'Tx/s', c: 'text-mint', i: <Network className="h-3.5 w-3.5" /> },
                    { v: fmtNet(gl.diskRead), t: 'диск чтение', c: 'text-blu', i: <HardDrive className="h-3.5 w-3.5" /> },
                    { v: fmtNet(gl.diskWrite), t: 'диск запись', c: 'text-warn', i: <HardDrive className="h-3.5 w-3.5" /> },
                    { v: gl.load1 != null ? gl.load1 : '—', t: 'load 1м', c: 'text-ink', i: <Activity className="h-3.5 w-3.5" /> },
                    { v: gl.load5 != null ? gl.load5 : '—', t: 'load 5м', c: 'text-ink', i: <Activity className="h-3.5 w-3.5" /> },
                  ].map((x) => (
                    <div key={x.t} className="rounded-lg border border-line bg-raised/30 px-2 py-2">
                      <div className="flex items-center gap-1 text-dim">{x.i}<span className="text-[8.5px] font-bold uppercase tracking-wider">{x.t}</span></div>
                      <div className={cls('mt-1 font-mono text-[13px] font-bold tabular-nums', x.c)}>{x.v}</div>
                    </div>
                  ))}
                </div>

                {/* загрузка по ядрам */}
                {agent.glancesCores.length > 0 && (
                  <div className="mt-2 rounded-lg border border-line bg-raised/30 p-2.5">
                    <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-dim">Загрузка по ядрам · {agent.glancesCores.length} шт</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                      {agent.glancesCores.map((c, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="w-5 shrink-0 font-mono text-[9.5px] text-dim">#{i}</span>
                          <Bar value={c} color="#8f7df0" className="flex-1" />
                          <span className="w-8 shrink-0 text-right font-mono text-[9.5px] font-bold tabular-nums text-mut">{Math.round(c)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* все датчики */}
                {agent.glancesSensors.length > 0 && (
                  <div className="mt-2 rounded-lg border border-line bg-raised/30 p-2.5">
                    <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-dim">Датчики · {agent.glancesSensors.length} шт</div>
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                      {agent.glancesSensors.map((s) => (
                        <div key={s.label} className="flex items-center justify-between gap-1 rounded bg-raised/40 px-1.5 py-1">
                          <span className="truncate font-mono text-[9.5px] text-dim" title={s.label}>{s.label}</span>
                          <span className={cls('font-mono text-[10px] font-bold tabular-nums', s.unit === 'RPM' ? 'text-blu' : 'text-warn')}>
                            {s.value != null ? `${s.value}${s.unit === 'RPM' ? '' : '°'}` : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* файловые системы */}
                {agent.glancesDisks.length > 0 && (
                  <div className="mt-2 space-y-1.5 rounded-lg border border-line bg-raised/30 p-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-dim">Файловые системы · {agent.glancesDisks.length} шт</div>
                    {agent.glancesDisks.map((d) => (
                      <div key={d.mnt} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 truncate font-mono text-[10.5px] text-dim" title={d.mnt}>{d.mnt}</span>
                        <Bar value={d.percent ?? 0} color="#8f7df0" className="flex-1" />
                        <span className={cls('w-11 shrink-0 text-right font-mono text-[10.5px] font-bold tabular-nums', (d.percent ?? 0) > 85 ? 'text-crit' : (d.percent ?? 0) > 65 ? 'text-warn' : 'text-mut')}>
                          {d.percent != null ? `${d.percent}%` : '—'}
                        </span>
                        <span className="w-20 shrink-0 text-right font-mono text-[9.5px] text-dim">
                          {d.usedGB != null && d.sizeGB ? `${d.usedGB}/${d.sizeGB} ГБ` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {agent.glancesNetIface && (
                  <div className="mt-2 flex items-center gap-1.5 font-mono text-[10.5px] text-dim">
                    <Network className="h-3 w-3 text-mint" />
                    <span>сетевой трафик — реальный адаптер:</span>
                    <span className="max-w-[180px] truncate rounded bg-raised/60 px-1.5 py-px text-mint">{agent.glancesNetIface}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-line bg-raised/20 px-3 py-3 text-[12px] text-dim">Показаний Glances пока нет — страница ещё не прочитана.</p>
            )}
            {isAdmin && <div className="mt-2"><TestSourcePanel agent={agent} /></div>}
          </div>
        )}

        {/* Relay: устройства в сети агента */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-dim">Устройства в сети агента · relay</h4>
            {isAdmin && (
              <button className="btn-ghost !py-1" onClick={pollNow} disabled={polling}>
                <RefreshCw className={cls('h-3.5 w-3.5', polling && 'animate-spin')} /> Опросить сейчас
              </button>
            )}
          </div>

          {!agent.relayUrl ? (
            <p className="rounded-lg border border-dashed border-line bg-raised/20 px-3 py-3 text-[12px] leading-relaxed text-dim">
              Relay не настроен. Запустите <span className="font-mono text-mut">aida-monitor</span> на машине агента и укажите его адрес
              (по умолчанию <span className="font-mono text-mut">http://{agent.ip}:8091/</span>) в настройках агента — тогда сервер сможет
              пинговать устройства внутри VLAN и читать локальные страницы AIDA64/Glances.
            </p>
          ) : (
            <div className="space-y-2">
              {(agent.targets || []).map((t) => {
                const alive = t.results.filter((r) => r.alive).length;
                return (
                  <details key={t.target} className="rounded-lg border border-line bg-raised/30">
                    <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 font-mono text-[12px] text-mut transition-colors hover:text-ink">
                      <Radar className="h-3.5 w-3.5 text-blu" />
                      <span className="font-semibold">{t.target}</span>
                      <span className={cls('ml-auto', alive === t.results.length ? 'text-ok' : alive === 0 ? 'text-crit' : 'text-warn')}>
                        {alive}/{t.results.length} живы
                      </span>
                    </summary>
                    <ul className="border-t border-line/60 px-3 py-2">
                      {t.results.length === 0 && <li className="py-1 text-[11.5px] text-dim">Результатов пока нет</li>}
                      {t.results.map((r) => (
                        <li key={r.ip} className="flex items-center gap-2 py-0.5 font-mono text-[11.5px]">
                          <StatusDot status={r.alive ? 'up' : 'down'} pulse={false} />
                          <span className="text-mut">{r.ip}</span>
                          <span className={cls('ml-auto', r.alive ? 'text-ok' : 'text-crit')}>{r.alive ? `${r.latency ?? '—'} мс` : 'нет ответа'}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}

              {isAdmin && (
                <div className="flex gap-2">
                  <input
                    className="inp flex-1 font-mono text-[12px]"
                    value={newTarget}
                    placeholder="1.2.3.4 · 1.2.3.10-20 · 1.2.3.0/24"
                    onChange={(e) => { setNewTarget(e.target.value); setTargetErr(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && addTarget()}
                  />
                  <button className="btn-acc !py-1.5" onClick={addTarget}><Plus className="h-3.5 w-3.5" /> Цель</button>
                </div>
              )}
              {targetErr && <p className="text-[11.5px] font-semibold text-crit">{targetErr}</p>}

              {isAdmin && (agent.pingTargets || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(agent.pingTargets || []).map((t) => (
                    <button key={t} className="flex items-center gap-1 rounded border border-line bg-raised/50 px-2 py-1 font-mono text-[10.5px] text-mut transition-colors hover:border-crit/40 hover:text-crit"
                      onClick={() => store.updateAgent(agent.id, { pingTargets: (agent.pingTargets || []).filter((x) => x !== t) })}>
                      {t} <Trash2 className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="flex gap-2 border-t border-line/60 pt-4">
            <button className="btn-ghost" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Изменить</button>
            <button className="btn-danger ml-auto" onClick={() => {
              if (window.confirm(`Удалить агента «${agent.name}»? История и архивы будут стёрты.`)) {
                store.removeAgent(agent.id);
                onClose();
              }
            }}>
              <Trash2 className="h-3.5 w-3.5" /> Удалить
            </button>
          </div>
        )}
      </div>
    </Drawer>
  );
}

// ─── Страница ───────────────────────────────────────────────────────────────

export default function Agents() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const agents = usePluto((s) => visibleAgents(s, user));
  const routeParam = usePluto((s) => s.routeParam);

  const [addOpen, setAddOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  useEffect(() => {
    if (routeParam === 'new') { setAddOpen(true); store.nav('agents'); }
    else if (routeParam) {
      const a = agents.find((x) => x.ip === routeParam || x.name === routeParam);
      if (a) setDrawerId(a.id);
      store.nav('agents');
    }
  }, [routeParam, agents]);

  const drawerAgent = drawerId ? agents.find((a) => a.id === drawerId) ?? null : null;
  const onlineCount = agents.filter((a) => a.online).length;
  const avgMs = useMemo(() => {
    const xs = agents.map((a) => a.latency).filter((x): x is number => x != null);
    return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
  }, [agents]);

  return (
    <div className="space-y-4">
      {agents.length > 0 && (
        <Panel
          title="Пульс сети · задержка до агентов за 15 минут"
          icon={<Activity className="h-4 w-4" />}
          right={
            <span className="font-mono text-[11px] text-dim">
              в сети <span className={onlineCount === agents.length ? 'text-ok' : 'text-warn'}>{onlineCount}/{agents.length}</span>
              {avgMs != null && <> · средняя <span className="text-vio">{avgMs} мс</span></>}
            </span>
          }
        >
          <PulseChart agents={agents} />
        </Panel>
      )}

      <Panel
        title="Агенты"
        icon={<BarChart3 className="h-4 w-4" />}
        right={isAdmin ? (
          <button className="btn-acc" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Добавить агента
          </button>
        ) : undefined}
        bodyClass="p-4"
      >
        {agents.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title="Агентов пока нет"
            text="Агент — это IP машины плюс источники данных: листинг AIDA64 и страница Glances. Ничего устанавливать не нужно — сервер опрашивает их сам. Relay (aida-monitor) понадобится только для пингов внутри VLAN и loopback-страниц."
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

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Новый агент">
        <AgentForm initial={null} onClose={() => setAddOpen(false)} />
      </Modal>

      <Modal open={!!editAgent} onClose={() => setEditAgent(null)} title={`Агент: ${editAgent?.name ?? ''}`}>
        {editAgent && <AgentForm initial={editAgent} onClose={() => setEditAgent(null)} />}
      </Modal>

      <AgentDrawer agent={drawerAgent} onClose={() => setDrawerId(null)} onEdit={() => drawerAgent && setEditAgent(drawerAgent)} isAdmin={isAdmin} />
    </div>
  );
}
