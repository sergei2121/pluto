// ─── PLUTO: статистика Bars / WS (телеметрия Glances) ───────────────────────
import { useMemo, useState } from 'react';
import { BarChart3, Waves, Activity, Download } from 'lucide-react';
import { Panel, EmptyState, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, visibleAgents } from '../lib/store';
import { cls, fmtNet, LINE_COLORS } from '../lib/util';
import type { Agent, GlancesPoint, StatsRange } from '../lib/types';

const RANGES: { v: StatsRange; label: string; ms: number }[] = [
  { v: '5m', label: '5 мин', ms: 5 * 60_000 },
  { v: '30m', label: '30 мин', ms: 30 * 60_000 },
  { v: '3h', label: '3 ч', ms: 3 * 3_600_000 },
  { v: '24h', label: '24 ч', ms: 24 * 3_600_000 },
  { v: '7d', label: '7 дн', ms: 7 * 86_400_000 },
  { v: '30d', label: '30 дн', ms: 30 * 86_400_000 },
];

type MetricKey = keyof Pick<GlancesPoint, 'cpu' | 'gpu' | 'ram' | 'rx' | 'tx' | 'cput' | 'ssdt' | 'diskUsed'>;

const METRICS: { k: MetricKey; label: string; unit: string; color: string }[] = [
  { k: 'cpu', label: 'CPU', unit: '%', color: '#8f7df0' },
  { k: 'gpu', label: 'GPU', unit: '%', color: '#d98bb0' },
  { k: 'ram', label: 'RAM', unit: '%', color: '#5fc6d8' },
  { k: 'rx', label: 'RX (сеть)', unit: 'КБ/с', color: '#55c795' },
  { k: 'tx', label: 'TX (сеть)', unit: 'КБ/с', color: '#e0b65e' },
  { k: 'cput', label: 't° CPU', unit: '°C', color: '#e07a80' },
  { k: 'ssdt', label: 't° SSD', unit: '°C', color: '#e0945e' },
  { k: 'diskUsed', label: 'Диск C', unit: '%', color: '#7ba4e6' },
];

const val = (p: GlancesPoint, k: MetricKey): number | null => p[k] ?? null;

/** Текущее значение метрики из снапшота (diskUsed берём из основной ФС). */
function curVal(cur: import('../lib/types').GlancesSnapshot | null | undefined, k: MetricKey): number | null {
  if (!cur) return null;
  if (k === 'diskUsed') return cur.disks?.[0]?.percent ?? null;
  const v = (cur as unknown as Record<string, number | null>)[k];
  return typeof v === 'number' ? v : null;
}

/** Волновой график (линия + область). */
function WaveChart({ points, metric, color, range }: { points: GlancesPoint[]; metric: MetricKey; color: string; range: StatsRange }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 160;
  const pad = { l: 40, r: 12, t: 10, b: 20 };
  const nums = points.map((p) => val(p, metric)).filter((v): v is number => v != null);
  const maxV = nums.length ? Math.max(...nums, 1) * 1.1 : 100;
  const x = (t: number) => {
    const r = RANGES.find((r) => r.v === range)!;
    const from = Date.now() - r.ms;
    return pad.l + Math.min(1, Math.max(0, (t - from) / r.ms)) * (W - pad.l - pad.r);
  };
  const y = (v: number) => pad.t + (1 - v / maxV) * (H - pad.t - pad.b);

  const path = points.map((p) => {
    const v = val(p, metric);
    return v == null ? null : `${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
  }).filter(Boolean).join(' L');

  const hp = hover != null ? points[hover] : null;
  const hv = hp ? val(hp, metric) : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}
        onMouseMove={(e) => {
          const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          let best = -1, bd = 1e9;
          points.forEach((p, i) => { const d = Math.abs(x(p.t) - px); if (d < bd) { bd = d; best = i; } });
          setHover(best >= 0 ? best : null);
        }}
        onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(maxV * f)} y2={y(maxV * f)} stroke="#242b4a" strokeDasharray="3 5" strokeWidth="0.6" />
            <text x={pad.l - 6} y={y(maxV * f) + 3} textAnchor="end" fontSize="8" fill="#8b93b8" fontFamily="JetBrains Mono">{Math.round(maxV * f)}</text>
          </g>
        ))}
        {path && (
          <>
            <path d={`M${path} L${x(points[points.length - 1].t)},${H - pad.b} L${x(points[0].t)},${H - pad.b} Z`} fill={color} opacity="0.12" />
            <path d={`M${path}`} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}
        {hp && hv != null && (
          <>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={H - pad.b} stroke={color} strokeWidth="0.8" opacity="0.5" />
            <circle cx={x(hp.t)} cy={y(hv)} r="3.5" fill={color} />
          </>
        )}
      </svg>
      {hp && hv != null && (
        <div className="pointer-events-none absolute top-1 z-10 rounded-md border border-line bg-deep/95 px-2.5 py-1.5 font-mono text-[10.5px] shadow-lg"
          style={{ left: `${(x(hp.t) / W) * 100}%`, transform: `translateX(${hp.t > (points[0]?.t ?? 0) + 1 ? '-110%' : '10%'})` }}>
          <div className="text-dim">{new Date(hp.t).toLocaleString('ru-RU')}</div>
          <div style={{ color }}>{metric === 'rx' || metric === 'tx' ? fmtNet(hv) : `${Math.round(hv * 10) / 10}`}</div>
        </div>
      )}
    </div>
  );
}

/** Столбчатый график. */
function BarsChart({ points, metric, color, range }: { points: GlancesPoint[]; metric: MetricKey; color: string; range: StatsRange }) {
  const W = 640, H = 160;
  const pad = { l: 40, r: 12, t: 10, b: 20 };
  const nums = points.map((p) => val(p, metric)).filter((v): v is number => v != null);
  const maxV = nums.length ? Math.max(...nums, 1) * 1.1 : 100;
  const r = RANGES.find((r) => r.v === range)!;
  const from = Date.now() - r.ms;
  const bw = (W - pad.l - pad.r) / Math.max(1, points.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + (1 - f) * (H - pad.t - pad.b)} y2={pad.t + (1 - f) * (H - pad.t - pad.b)} stroke="#242b4a" strokeDasharray="3 5" strokeWidth="0.6" />
          <text x={pad.l - 6} y={pad.t + (1 - f) * (H - pad.t - pad.b) + 3} textAnchor="end" fontSize="8" fill="#8b93b8" fontFamily="JetBrains Mono">{Math.round(maxV * f)}</text>
        </g>
      ))}
      {points.map((p, i) => {
        const v = val(p, metric);
        const bx = pad.l + ((p.t - from) / r.ms) * (W - pad.l - pad.r);
        const h = v == null ? 0 : (v / maxV) * (H - pad.t - pad.b);
        return v == null
          ? <rect key={i} x={bx} y={H - pad.b - 2} width={Math.max(1.5, bw * 0.6)} height={2} fill="#e07a80" opacity="0.5" />
          : <rect key={i} x={bx} y={H - pad.b - h} width={Math.max(1.5, bw * 0.6)} height={Math.max(1.5, h)} rx="1.5" fill={color} opacity="0.8" />;
      })}
    </svg>
  );
}

export default function Stats({ mode }: { mode: 'bars' | 'ws' }) {
  const user = useCurrentUser();
  const all = usePluto((s) => visibleAgents(s, user));
  // в каждую вкладку попадают только агенты, назначенные именно в неё
  const agents = useMemo(
    () => all.filter((a) => a.statsView === mode).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    [all, mode],
  );
  const [agentId, setAgentId] = useState<string | null>(null);
  const [range, setRange] = useState<StatsRange>('3h');
  const [metric, setMetric] = useState<MetricKey>('cpu');

  const agent: Agent | undefined = agents.find((a) => a.id === agentId) ?? agents[0];

  const points = useMemo(() => {
    if (!agent) return [];
    const r = RANGES.find((r) => r.v === range)!;
    const from = Date.now() - r.ms;
    return agent.glances.filter((p) => p.t >= from);
  }, [agent, range]);

  const cur = agent?.glancesLatest;

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel/90 px-4 py-3">
        <span className="text-vio">{mode === 'bars' ? <BarChart3 className="h-5 w-5" /> : <Waves className="h-5 w-5" />}</span>
        <div>
          <div className="font-display text-[14px] font-bold text-ink">{mode === 'bars' ? 'Статистика Bars' : 'Статистика WS'}</div>
          <div className="text-[10.5px] text-dim">телеметрия Glances · хранение 30 дней · только добавленные агенты</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="inp w-auto font-mono text-[12px]" value={agent?.id ?? ''} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.ip}</option>)}
            {!agents.length && <option value="">нет агентов</option>}
          </select>
          <div className="flex overflow-hidden rounded-lg border border-line bg-raised/50">
            {RANGES.map((r) => (
              <button key={r.v} onClick={() => setRange(r.v)}
                className={cls('px-2.5 py-1.5 text-[11.5px] font-semibold transition-all', range === r.v ? 'bg-vio/25 text-ink' : 'text-dim hover:text-mut')}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!agent ? (
        <Panel title="Нет источника данных">
          <EmptyState icon={<Activity className="h-6 w-6" />} title="В этой вкладке пока нет агентов"
            text={`Назначьте агента во вкладку «${mode === 'bars' ? 'Статистика Bars' : 'Статистика WS'}»: «Агенты → Изменить → Показывать в статистике».`}
            action={<button onClick={() => store.nav('agents')} className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">К агентам</button>} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {METRICS.map((m) => {
              const v = curVal(cur, m.k);
              return (
                <button key={m.k} onClick={() => setMetric(m.k)}
                  className={cls('rise rounded-xl border p-3 text-left transition-all duration-150 hover:-translate-y-0.5',
                    metric === m.k ? 'border-vio/60 bg-vio/10' : 'border-line bg-panel/90 hover:border-line/80')}>
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-dim">{m.label}</div>
                  <div className="mt-1 font-mono text-[16px] font-bold tabular-nums" style={{ color: m.color }}>
                    {v == null ? '—' : m.k === 'rx' || m.k === 'tx' ? fmtNet(v) : `${Math.round(v * 10) / 10}${m.unit === '%' ? '%' : m.unit === '°C' ? '°' : ''}`}
                  </div>
                </button>
              );
            })}
          </div>

          <Panel
            title={`${METRICS.find((m) => m.k === metric)?.label} · ${agent.name} · ${RANGES.find((r) => r.v === range)?.label}`}
            icon={mode === 'bars' ? <BarChart3 className="h-4 w-4" /> : <Waves className="h-4 w-4" />}
            right={<span className="font-mono text-[10.5px] text-dim">{points.length} точек · обновление {cur ? <TimeAgo ts={cur.t} /> : '—'}</span>}>
            {points.length ? (
              mode === 'bars'
                ? <BarsChart points={points} metric={metric} color={METRICS.find((m) => m.k === metric)!.color} range={range} />
                : <WaveChart points={points} metric={metric} color={METRICS.find((m) => m.k === metric)!.color} range={range} />
            ) : (
              <EmptyState icon={<Activity className="h-6 w-6" />} title="Нет данных за период"
                text="Убедитесь, что у агента указан адрес Glances и он в сети. Точки появятся после первых опросов." />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
