// ─── PLUTO: статистика Bars / WS (телеметрия Glances) ───────────────────────
import { useMemo, useState } from 'react';
import { BarChart3, Waves, Activity, Download, Cpu, HardDrive, Thermometer, Wifi, Zap } from 'lucide-react';
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

type MetricKey = keyof Pick<GlancesPoint, 'cpu' | 'gpu' | 'ram' | 'rx' | 'tx' | 'cput' | 'ssdt' | 'diskUsed' | 'diskRead' | 'diskWrite'>;

const METRICS: { k: MetricKey; label: string; unit: string; color: string; icon: any; gradient: [string, string] }[] = [
  { k: 'cpu', label: 'CPU', unit: '%', color: '#8f7df0', icon: Cpu, gradient: ['#8f7df0', '#6d5dd1'] },
  { k: 'gpu', label: 'GPU', unit: '%', color: '#d98bb0', icon: Zap, gradient: ['#d98bb0', '#c47a9a'] },
  { k: 'ram', label: 'RAM', unit: '%', color: '#5fc6d8', icon: HardDrive, gradient: ['#5fc6d8', '#4ab0c2'] },
  { k: 'rx', label: 'RX', unit: 'КБ/с', color: '#55c795', icon: Wifi, gradient: ['#55c795', '#42b382'] },
  { k: 'tx', label: 'TX', unit: 'КБ/с', color: '#e0b65e', icon: Wifi, gradient: ['#e0b65e', '#cca34a'] },
  { k: 'cput', label: 't° CPU', unit: '°C', color: '#e07a80', icon: Thermometer, gradient: ['#e07a80', '#ca666c'] },
  { k: 'ssdt', label: 't° SSD', unit: '°C', color: '#e0945e', icon: Thermometer, gradient: ['#e0945e', '#ca804a'] },
  { k: 'diskUsed', label: 'Диск C', unit: '%', color: '#7ba4e6', icon: HardDrive, gradient: ['#7ba4e6', '#6790d2'] },
  { k: 'diskRead', label: 'Чтение', unit: 'Rps', color: '#a78bfa', icon: HardDrive, gradient: ['#a78bfa', '#9377e6'] },
  { k: 'diskWrite', label: 'Запись', unit: 'Wps', color: '#f472b6', icon: HardDrive, gradient: ['#f472b6', '#e05ea2'] },
];

const val = (p: GlancesPoint, k: MetricKey): number | null => p[k] ?? null;

/** Текущее значение метрики из снапшота (diskUsed берём из основной ФС). */
function curVal(cur: import('../lib/types').GlancesSnapshot | null | undefined, k: MetricKey): number | null {
  if (!cur) return null;
  if (k === 'diskUsed') return cur.disks?.[0]?.percent ?? null;
  const v = (cur as unknown as Record<string, number | null>)[k];
  return typeof v === 'number' ? v : null;
}

/** Волновой график (линия + область) с улучшенным дизайном. */
function WaveChart({ points, metric, color, gradient, range }: { points: GlancesPoint[]; metric: MetricKey; color: string; gradient: [string, string]; range: StatsRange }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 800, H = 220;
  const pad = { l: 50, r: 16, t: 16, b: 28 };
  const nums = points.map((p) => val(p, metric)).filter((v): v is number => v != null);
  const maxV = nums.length ? Math.max(...nums, 1) * 1.15 : 100;
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

  const gradId = `grad-${metric}-${range}`;

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
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={gradient[0]} stopOpacity="0.25" />
            <stop offset="100%" stopColor={gradient[1]} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.2, 0.4, 0.6, 0.8, 1].map((f, idx) => (
          <g key={idx}>
            <line x1={pad.l} x2={W - pad.r} y1={y(maxV * f)} y2={y(maxV * f)} stroke="#2a3152" strokeDasharray="4 6" strokeWidth="0.8" opacity="0.4" />
            <text x={pad.l - 8} y={y(maxV * f) + 4} textAnchor="end" fontSize="9" fill="#7d85a8" fontFamily="JetBrains Mono">{Math.round(maxV * f)}</text>
          </g>
        ))}
        {path && (
          <>
            <path d={`M${path} L${x(points[points.length - 1].t)},${H - pad.b} L${x(points[0].t)},${H - pad.b} Z`} fill={`url(#${gradId})`} />
            <path d={`M${path}`} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" className="drop-shadow-sm" />
          </>
        )}
        {hp && hv != null && (
          <>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={H - pad.b} stroke={color} strokeWidth="1" opacity="0.6" strokeDasharray="4 4" />
            <circle cx={x(hp.t)} cy={y(hv)} r="4.5" fill={color} stroke="#1a1f3a" strokeWidth="2" />
          </>
        )}
      </svg>
      {hp && hv != null && (
        <div className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-deep/98 px-3 py-2 font-mono text-[11px] shadow-xl backdrop-blur-sm"
          style={{ left: `${(x(hp.t) / W) * 100}%`, transform: `translateX(${hp.t > (points[0]?.t ?? 0) + 1 ? '-115%' : '15%'})` }}>
          <div className="text-dim mb-0.5">{new Date(hp.t).toLocaleString('ru-RU')}</div>
          <div className="font-bold" style={{ color }}>{metric === 'rx' || metric === 'tx' ? fmtNet(hv) : metric === 'diskRead' || metric === 'diskWrite' ? `${Math.round(hv)}` : `${Math.round(hv * 10) / 10}`}</div>
        </div>
      )}
    </div>
  );
}

/** Столбчатый график с улучшенным дизайном. */
function BarsChart({ points, metric, color, gradient, range }: { points: GlancesPoint[]; metric: MetricKey; color: string; gradient: [string, string]; range: StatsRange }) {
  const W = 800, H = 220;
  const pad = { l: 50, r: 16, t: 16, b: 28 };
  const nums = points.map((p) => val(p, metric)).filter((v): v is number => v != null);
  const maxV = nums.length ? Math.max(...nums, 1) * 1.15 : 100;
  const r = RANGES.find((r) => r.v === range)!;
  const from = Date.now() - r.ms;
  const bw = (W - pad.l - pad.r) / Math.max(1, points.length);
  
  const gradId = `grad-bar-${metric}-${range}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={gradient[0]} stopOpacity="0.95" />
          <stop offset="100%" stopColor={gradient[1]} stopOpacity="0.75" />
        </linearGradient>
      </defs>
      {[0.2, 0.4, 0.6, 0.8, 1].map((f, idx) => (
        <g key={idx}>
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + (1 - f) * (H - pad.t - pad.b)} y2={pad.t + (1 - f) * (H - pad.t - pad.b)} stroke="#2a3152" strokeDasharray="4 6" strokeWidth="0.8" opacity="0.4" />
          <text x={pad.l - 8} y={pad.t + (1 - f) * (H - pad.t - pad.b) + 4} textAnchor="end" fontSize="9" fill="#7d85a8" fontFamily="JetBrains Mono">{Math.round(maxV * f)}</text>
        </g>
      ))}
      {points.map((p, i) => {
        const v = val(p, metric);
        const bx = pad.l + ((p.t - from) / r.ms) * (W - pad.l - pad.r);
        const h = v == null ? 0 : (v / maxV) * (H - pad.t - pad.b);
        return v == null
          ? <rect key={i} x={bx} y={H - pad.b - 2} width={Math.max(2, bw * 0.7)} height={2} fill="#e07a80" opacity="0.5" />
          : <rect key={i} x={bx} y={H - pad.b - h} width={Math.max(2, bw * 0.7)} height={Math.max(2, h)} rx="2.5" fill={`url(#${gradId})`} opacity="0.9" />;
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
  const selectedMetric = METRICS.find((m) => m.k === metric)!;

  return (
    <div className="space-y-5">
      {/* Заголовок страницы */}
      <div className="rise flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-gradient-to-br from-panel to-panel/95 px-5 py-4 shadow-sm">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${mode === 'bars' ? 'from-vio/20 to-vio/10' : 'from-cyan/20 to-cyan/10'}`}>
          {mode === 'bars' ? <BarChart3 className="h-6 w-6 text-vio" /> : <Waves className="h-6 w-6 text-cyan" />}
        </div>
        <div>
          <div className="font-display text-[15px] font-bold text-ink">{mode === 'bars' ? 'Статистика Bars' : 'Статистика WS'}</div>
          <div className="text-[11px] text-dim">Телеметрия Glances · хранение 30 дней · интерактивные графики</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <select className="inp min-w-[180px] font-mono text-[12px]" value={agent?.id ?? ''} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.ip}</option>)}
            {!agents.length && <option value="">нет агентов</option>}
          </select>
          <div className="flex overflow-hidden rounded-xl border border-line bg-raised/60 shadow-inner">
            {RANGES.map((r) => (
              <button key={r.v} onClick={() => setRange(r.v)}
                className={cls('px-3 py-2 text-[11.5px] font-semibold transition-all duration-150', 
                  range === r.v ? 'bg-gradient-to-r from-vio/30 to-vio/20 text-ink shadow-sm' : 'text-dim hover:text-mut hover:bg-line/30')}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!agent ? (
        <Panel title="Нет источника данных">
          <EmptyState icon={<Activity className="h-7 w-7" />} title="В этой вкладке пока нет агентов"
            text={`Назначьте агента во вкладку «${mode === 'bars' ? 'Статистика Bars' : 'Статистика WS'}»: «Агенты → Изменить → Показывать в статистике».`}
            action={<button onClick={() => store.nav('agents')} className="rounded-xl border border-vio/50 bg-gradient-to-r from-vio/20 to-vio/10 px-5 py-2.5 text-[13px] font-bold text-ink transition-all hover:from-vio/30 hover:to-vio/20">К агентам</button>} />
        </Panel>
      ) : (
        <>
          {/* Карточки метрик */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
            {METRICS.map((m) => {
              const v = curVal(cur, m.k);
              const Icon = m.icon;
              return (
                <button key={m.k} onClick={() => setMetric(m.k)}
                  className={cls('group rise relative overflow-hidden rounded-2xl border p-3.5 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-md',
                    metric === m.k ? 'border-vio/60 bg-gradient-to-br from-vio/15 to-vio/5 shadow-vio/10' : 'border-line bg-panel/90 hover:border-line/80')}>
                  <div className={cls('absolute -right-2 -top-2 h-12 w-12 rounded-full opacity-10 transition-transform group-hover:scale-150', metric === m.k ? 'bg-vio' : 'bg-muted')} />
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className={cls('h-4 w-4', metric === m.k ? 'text-vio' : 'text-dim')} />
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-dim">{m.label}</span>
                  </div>
                  <div className="font-mono text-[17px] font-bold tabular-nums" style={{ color: metric === m.k ? m.color : '#8b93b8' }}>
                    {v == null ? '—' : m.k === 'rx' || m.k === 'tx' ? fmtNet(v) : `${Math.round(v * 10) / 10}${m.unit === '%' ? '%' : m.unit === '°C' ? '°' : ''}`}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Основной график */}
          <Panel
            title={
              <div className="flex items-center gap-2.5">
                <selectedMetric.icon className="h-4 w-4" style={{ color: selectedMetric.color }} />
                <span>{selectedMetric.label} · {agent.name}</span>
              </div>
            }
            right={
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10.5px] text-dim">{points.length} точек</span>
                <span className="font-mono text-[10.5px] text-dim">обновление <TimeAgo ts={cur?.t ?? 0} /></span>
              </div>
            }>
            {points.length ? (
              mode === 'bars'
                ? <BarsChart points={points} metric={metric} color={selectedMetric.color} gradient={selectedMetric.gradient} range={range} />
                : <WaveChart points={points} metric={metric} color={selectedMetric.color} gradient={selectedMetric.gradient} range={range} />
            ) : (
              <EmptyState icon={<Activity className="h-7 w-7" />} title="Нет данных за период"
                text="Убедитесь, что у агента указан адрес Glances и он в сети. Точки появятся после первых опросов." />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
