// ─── PLUTO: журнал телеметрии AIDA64 — полный архив показаний ────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, History, RefreshCw } from 'lucide-react';
import { Panel, EmptyState, StatusDot, TimeAgo } from '../components/ui';
import { usePluto, useCurrentUser, visibleAgents, store, useToasts, getState } from '../lib/store';
import { api } from '../lib/api';
import { cls, fmtBytes, fmtClock, fmtDate } from '../lib/util';
import type { Agent, AidaPoint, AidaRange } from '../lib/types';

// ─── Справочник метрик (пункт меню ↔ пункт AIDA64) ──────────────────────────

type Metric = {
  key: keyof AidaPoint;
  label: string;
  src: string;
  unit: string;
  color: string;
  fmt?: (v: number) => string;
};

const RANGES: { v: AidaRange; label: string; span: number }[] = [
  { v: '5m', label: '5 минут', span: 5 * 60_000 },
  { v: '30m', label: '30 минут', span: 30 * 60_000 },
  { v: '3h', label: '3 часа', span: 3 * 3_600_000 },
  { v: '24h', label: '24 часа', span: 24 * 3_600_000 },
  { v: '7d', label: '7 дней', span: 7 * 86_400_000 },
  { v: '30d', label: '30 дней', span: 30 * 86_400_000 },
  { v: '60d', label: '60 дней', span: 60 * 86_400_000 },
];

const METRICS: Metric[] = [
  { key: 'cpuUsage', label: 'cpu usage', src: 'CPUu', unit: '%', color: '#8f7df0' },
  { key: 'cpuTemp', label: 'cpu temp', src: 'CPU', unit: '°C', color: '#e0945e' },
  { key: 'ram', label: 'RAM', src: 'RAM', unit: '%', color: '#7ba4e6' },
  { key: 'ssdTemp', label: 'ssd temp', src: 'SSD', unit: '°C', color: '#dfa65e' },
  { key: 'diskC', label: 'DiskC', src: 'UseC', unit: '%', color: '#5fc6d8' },
  { key: 'tx', label: 'TX', src: 'TX', unit: 'КБ/с', color: '#55c795' },
  { key: 'rx', label: 'RX', src: 'RX', unit: 'КБ/с', color: '#8bc46a' },
  { key: 'uptimeSec', label: 'UpTime', src: 'Uptime', unit: '', color: '#98a4c8', fmt: fmtUptime },
];

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (d > 0) return `${d}д ${h}ч ${m}м`;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${sec}с`;
  return `${sec}с`;
}

function fmtVal(m: Metric, v: number | null): string {
  if (v == null || !isFinite(v)) return '—';
  if (m.key === 'tx' || m.key === 'rx') return `${fmtBytes(v * 1024)}/с`;
  if (m.fmt) return m.fmt(v);
  return `${Math.round(v * 10) / 10}${m.unit}`;
}

function fmtTs(t: number, long: boolean): string {
  return long ? `${fmtDate(t)} ${fmtClock(t)}` : fmtClock(t);
}

// ─── Большой график с наведением ────────────────────────────────────────────

function BigChart({ points, metric, spanMs }: { points: AidaPoint[]; metric: Metric; spanMs: number }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const coords = useMemo(
    () => points.map((p, i) => ({ i, v: p[metric.key] })).filter((c): c is { i: number; v: number } => c.v != null),
    [points, metric],
  );

  if (coords.length < 2) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-line bg-raised/30 font-mono text-[12px] text-dim">
        недостаточно точек для графика
      </div>
    );
  }

  const W = 1000, H = 300;
  const maxV = Math.max(...coords.map((c) => c.v), 0.001) * 1.08;
  const X = (i: number) => (i / (points.length - 1)) * W;
  const Y = (v: number) => H - 8 - (v / maxV) * (H - 30);
  const line = coords.map((c, j) => `${j ? 'L' : 'M'}${X(c.i).toFixed(1)},${Y(c.v).toFixed(1)}`).join(' ');
  const area =
    `M${X(coords[0].i).toFixed(1)},${H} ` +
    coords.map((c) => `L${X(c.i).toFixed(1)},${Y(c.v).toFixed(1)}`).join(' ') +
    ` L${X(coords[coords.length - 1].i).toFixed(1)},${H} Z`;
  const gid = 'tg-' + metric.key;
  const longTs = spanMs > 24 * 3_600_000;
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => ({ y: Y(maxV * f), v: maxV * f }));

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
  };

  const hp = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <div ref={wrapRef} className="relative ml-14 h-[280px] cursor-crosshair select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* шкала Y */}
        <div className="absolute -left-14 top-0 h-full w-13">
          {ticks.map((t, i) => (
            <span key={i} className="absolute right-1 -translate-y-1/2 font-mono text-[9.5px] text-dim" style={{ top: `${(t.y / H) * 100}%` }}>
              {metric.key === 'uptimeSec' ? fmtUptime(t.v) : `${Math.round(t.v)}${metric.unit}`}
            </span>
          ))}
        </div>

        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={metric.color} stopOpacity="0.34" />
              <stop offset="1" stopColor={metric.color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <line key={i} x1="0" x2={W} y1={t.y} y2={t.y} stroke="#27304f" strokeWidth="1" strokeDasharray="4 7" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke={metric.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hover != null && (
            <line x1={X(hover)} x2={X(hover)} y1="0" y2={H} stroke="#dfe3f5" strokeWidth="1" strokeDasharray="3 4" opacity="0.55" vectorEffect="non-scaling-stroke" />
          )}
          {hover != null && hp && hp[metric.key] != null && (
            <circle cx={X(hover)} cy={Y(hp[metric.key] as number)} r="4.5" fill={metric.color} stroke="#0b0e1a" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {/* подсказка под курсором */}
        {hp && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-md border border-line bg-panel px-2.5 py-1.5 shadow-[0_10px_30px_-8px_rgba(0,0,0,.8)]"
            style={{ left: `${Math.max(2, Math.min(76, (hover! / (points.length - 1)) * 100))}%` }}
          >
            <div className="font-mono text-[10px] text-dim">{fmtTs(hp.t, longTs)}</div>
            <div className="font-mono text-[13px] font-bold" style={{ color: metric.color }}>
              {fmtVal(metric, hp[metric.key])}
            </div>
          </div>
        )}
      </div>

      {/* шкала X */}
      <div className="ml-14 mt-1.5 flex justify-between font-mono text-[10px] text-dim">
        <span>{fmtTs(points[0].t, longTs)}</span>
        <span>{fmtTs(points[Math.floor(points.length / 2)].t, longTs)}</span>
        <span>{fmtTs(points[points.length - 1].t, longTs)}</span>
      </div>
    </div>
  );
}

// ─── Мини-искра для списка метрик ───────────────────────────────────────────

function Spark({ points, metric }: { points: AidaPoint[]; metric: Metric }) {
  const coords = points.map((p, i) => ({ i, v: p[metric.key] })).filter((c): c is { i: number; v: number } => c.v != null);
  if (coords.length < 2) return <div className="h-7 w-[104px] rounded border border-dashed border-line/60" />;
  const W = 104, H = 28;
  const maxV = Math.max(...coords.map((c) => c.v), 0.001);
  const pts = coords.map((c) => `${((c.i / (points.length - 1)) * W).toFixed(1)},${(H - 2 - (c.v / maxV) * (H - 6)).toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={H} className="shrink-0">
      <polygon points={`${(coords[0].i / (points.length - 1)) * W},${H} ${pts} ${(coords[coords.length - 1].i / (points.length - 1)) * W},${H}`} fill={metric.color} opacity="0.14" />
      <polyline points={pts} fill="none" stroke={metric.color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Выпадающий список агентов ──────────────────────────────────────────────

function AgentPicker({ agents, value, onPick }: { agents: Agent[]; value: string | null; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);
  const cur = agents.find((a) => a.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[220px] items-center gap-2.5 rounded-lg border border-line bg-raised/60 px-3 py-2 text-left transition-all hover:border-vio/50"
      >
        <StatusDot status={cur?.online ? 'up' : 'down'} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{cur ? cur.name : '—'}</span>
          <span className="block truncate font-mono text-[10px] text-dim">{cur ? cur.ip || 'выберите агента' : 'выберите агента'}</span>
        </span>
        <ChevronDown className={cls('h-4 w-4 text-dim transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="pop absolute left-0 top-[calc(100%+6px)] z-20 w-full min-w-[260px] overflow-hidden rounded-lg border border-line bg-panel shadow-[0_24px_60px_-12px_rgba(0,0,0,.85)]">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => { onPick(a.id); setOpen(false); }}
              className={cls(
                'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-raised/70',
                a.id === value && 'bg-vio/10',
              )}
            >
              <StatusDot status={a.online ? 'up' : 'down'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{a.name}</span>
                <span className="block truncate font-mono text-[10px] text-dim">{a.ip || 'нет данных'}</span>
              </span>
              <span className="font-mono text-[9.5px] uppercase text-dim">{(a.aida || []).length || (a.latest ? 1 : 0)} тчк</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Страница ───────────────────────────────────────────────────────────────

export default function Telemetry() {
  const user = useCurrentUser();
  const apiMode = usePluto((s) => s.apiMode);
  const allAgents = usePluto((s) => s.agents);
  const agents = useMemo(() => visibleAgents(allAgents, user), [allAgents, user]);

  const [agentId, setAgentId] = useState<string | null>(null);
  const [range, setRange] = useState<AidaRange>('5m');
  const [points, setPoints] = useState<AidaPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [metricKey, setMetricKey] = useState<keyof AidaPoint>('cpuUsage');
  const [tableRows, setTableRows] = useState(250);

  const metric = METRICS.find((m) => m.key === metricKey) || METRICS[0];
  const rangeMeta = RANGES.find((r) => r.v === range) || RANGES[0];

  // выбор агента по умолчанию: с данными → в сети → первый
  useEffect(() => {
    if (agentId && agents.some((a) => a.id === agentId)) return;
    const first = agents.find((a) => a.latest) || agents.find((a) => a.online) || agents[0];
    setAgentId(first ? first.id : null);
  }, [agents, agentId]);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      if (apiMode === 'server') {
        const r = await api.agentAida(agentId, range);
        setPoints(r.points || []);
      } else {
        const a = getState().agents.find((x) => x.id === agentId);
        const cutoff = Date.now() - rangeMeta.span;
        setPoints(((a?.aida as AidaPoint[]) || []).filter((p) => p.t >= cutoff));
      }
      setUpdatedAt(Date.now());
      setTableRows(250);
    } catch (e) {
      useToasts.push('warn', e instanceof Error ? e.message : 'Не удалось загрузить архив телеметрии');
    } finally {
      setLoading(false);
    }
  }, [agentId, range, apiMode, rangeMeta.span]);

  useEffect(() => { void load(); }, [load]);

  // автообновление: короткие окна чаще, глубокие — реже
  useEffect(() => {
    const iv = rangeMeta.span <= 3 * 3_600_000 ? 10_000 : rangeMeta.span <= 7 * 86_400_000 ? 60_000 : 300_000;
    const t = window.setInterval(() => void load(), iv);
    return () => window.clearInterval(t);
  }, [load, rangeMeta.span]);

  const agent = agents.find((a) => a.id === agentId);
  const latest = points.length ? points[points.length - 1] : null;

  const exportCsv = () => {
    if (!points.length || !agent) return;
    const head = ['время', ...METRICS.map((m) => m.label)].join(';');
    const rows = points.map((p) =>
      [new Date(p.t).toLocaleString('ru-RU'), ...METRICS.map((m) => (p[m.key] != null ? String(p[m.key]) : ''))].join(';'),
    );
    const blob = new Blob(['\uFEFF' + [head, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pluto-aida-${agent.ip || agent.name}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    useToasts.push('ok', `Экспортировано ${points.length} точек в CSV`);
  };

  if (agents.length === 0) {
    return (
      <Panel title="Журнал телеметрии" icon={<History className="h-4 w-4" />}>
        <EmptyState
          icon={<History className="h-6 w-6" />}
          title="Нет агентов для просмотра"
          text="Журнал телеметрии хранит архив показаний AIDA64, которые собирают агенты на Windows-машинах. Подключите хотя бы одного агента."
          action={
            <button className="btn-acc" onClick={() => store.nav('agents')}>
              К агентам
            </button>
          }
        />
      </Panel>
    );
  }

  const reversed = useMemo(() => [...points].reverse(), [points]);
  const shown = reversed.slice(0, tableRows);

  return (
    <div className="space-y-4">
      {/* Панель управления */}
      <Panel
        title="Журнал телеметрии · архив AIDA64"
        icon={<History className="h-4 w-4" />}
        delay={0}
        right={
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10.5px] text-dim md:block">
              {updatedAt ? <>обновлено <TimeAgo ts={updatedAt} /></> : '…'}
            </span>
            <button
              onClick={() => void load()}
              className="btn-ghost"
              title="Обновить данные"
            >
              <RefreshCw className={cls('h-4 w-4', loading && 'animate-spin')} />
            </button>
            <button onClick={exportCsv} disabled={!points.length} className={cls('btn-ghost', !points.length && 'cursor-not-allowed opacity-40')}>
              <Download className="h-4 w-4" /> CSV
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <AgentPicker agents={agents} value={agentId} onPick={setAgentId} />

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setRange('5m')}
              className={cls(
                'rounded-lg border px-3 py-2 text-[12px] font-bold transition-all',
                range === '5m' ? 'border-vio/60 bg-vio/15 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut',
              )}
            >
              5 мин
            </button>
            <div className="relative">
              <select
                value={range === '5m' ? '' : range}
                onChange={(e) => { if (e.target.value) setRange(e.target.value as AidaRange); }}
                className="appearance-none rounded-lg border border-line bg-raised/60 py-2 pl-3 pr-8 text-[12px] font-semibold text-ink outline-none transition-all focus:border-vio/60"
              >
                <option value="" disabled>глубже…</option>
                {RANGES.filter((r) => r.v !== '5m').map((r) => (
                  <option key={r.v} value={r.v}>{r.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
            </div>
          </div>

          <span className="ml-auto font-mono text-[11px] text-dim">
            {points.length > 0 ? `${points.length} точек · хранение 60 дней` : 'нет точек в окне'}
          </span>
        </div>
      </Panel>

      {/* Сводка окна */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Точек в окне', value: String(points.length), sub: rangeMeta.label },
          { label: 'Начало окна', value: points.length ? fmtClock(points[0].t) : '—', sub: points.length ? fmtDate(points[0].t) : '' },
          { label: 'Конец окна', value: latest ? fmtClock(latest.t) : '—', sub: latest ? fmtDate(latest.t) : '' },
          { label: 'Источник', value: agent?.aidaUrl ? 'AIDA64' : 'не задан', sub: agent?.aidaUrl || 'укажите адрес в карточке агента' },
        ].map((s, i) => (
          <div key={s.label} className="rise rounded-xl border border-line bg-panel/90 p-3.5" style={{ animationDelay: `${40 + i * 40}ms` }}>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-dim">{s.label}</div>
            <div className="mt-1.5 font-mono text-[16px] font-bold text-ink">{s.value}</div>
            <div className="mt-0.5 truncate text-[10.5px] text-dim">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* График + список метрик */}
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Panel
          title={`${metric.label} · ${rangeMeta.label}`}
          icon={<span className="h-2.5 w-2.5 rounded-full" style={{ background: metric.color }} />}
          delay={120}
          right={
            <span className="font-mono text-[12px] font-bold" style={{ color: metric.color }}>
              {latest ? fmtVal(metric, latest[metric.key]) : '—'}
            </span>
          }
        >
          {loading && !points.length ? (
            <div className="flex h-[280px] items-center justify-center font-mono text-[12px] text-dim">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> загрузка архива…
            </div>
          ) : (
            <BigChart points={points} metric={metric} spanMs={rangeMeta.span} />
          )}
        </Panel>

        <Panel title="Показатели" icon={<History className="h-4 w-4" />} delay={180} bodyClass="p-2">
          <div className="space-y-1">
            {METRICS.map((m) => {
              const active = m.key === metricKey;
              return (
                <button
                  key={m.key}
                  onClick={() => setMetricKey(m.key)}
                  className={cls(
                    'group flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all',
                    active ? 'border-vio/50 bg-vio/10' : 'border-transparent hover:border-line hover:bg-raised/60',
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold leading-tight text-ink">{m.label}</span>
                    <span className="block font-mono text-[9px] uppercase text-dim">aida64: {m.src}</span>
                  </span>
                  <Spark points={points} metric={m} />
                  <span className="w-[74px] shrink-0 text-right font-mono text-[11.5px] font-bold" style={{ color: m.color }}>
                    {latest ? fmtVal(m, latest[m.key]) : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Полный архив */}
      <Panel
        title="Архив показаний"
        icon={<History className="h-4 w-4" />}
        delay={240}
        right={<span className="font-mono text-[10.5px] text-dim">показано {shown.length} из {points.length} · новые сверху</span>}
        bodyClass="p-0"
      >
        {points.length === 0 ? (
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="Архив пуст для этого окна"
            text={
              agent?.aidaUrl
                ? `Данных за последние ${rangeMeta.label.toLowerCase()} нет. Убедитесь, что AIDA64 отдаёт сенсорную страницу (${agent.aidaUrl}) и агент в сети.`
                : 'У агента не задан адрес сенсорной страницы AIDA64. Откройте карточку агента → «Изменить» и укажите адрес (RemoteSensor, по умолчанию http://127.0.0.1:8090/).'
            }
          />
        ) : (
          <div className="max-h-[560px] overflow-auto scroll-thin">
            <table className="w-full border-collapse font-mono text-[11.5px]">
              <thead className="sticky top-0 z-10 bg-panel">
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-dim">Время</th>
                  {METRICS.map((m) => (
                    <th key={m.key} className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider" style={{ color: m.color }}>
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.t} className="border-b border-line-soft/50 transition-colors hover:bg-raised/50">
                    <td className="whitespace-nowrap px-4 py-1.5 text-mut">{fmtDate(p.t)} {fmtClock(p.t)}</td>
                    {METRICS.map((m) => (
                      <td key={m.key} className={cls('whitespace-nowrap px-3 py-1.5 text-right', p[m.key] != null ? 'text-ink' : 'text-dim/60')}>
                        {fmtVal(m, p[m.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {reversed.length > tableRows && (
              <div className="flex justify-center p-3">
                <button className="btn-ghost" onClick={() => setTableRows((r) => r + 250)}>
                  Показать ещё 250
                </button>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
