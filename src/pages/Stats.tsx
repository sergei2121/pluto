// ─── PLUTO: журнал телеметрии Glances (Статистика Bars / WS) ─────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Waves, Activity, Cpu, HardDrive, Network, Thermometer, Gauge } from 'lucide-react';
import { Panel, EmptyState } from '../components/ui';
import { store, useCurrentUser, usePluto, visibleAgents } from '../lib/store';
import { api } from '../lib/api';
import { cls, fmtNet, LINE_COLORS } from '../lib/util';
import type { Agent, GlancesPoint, StatsRange } from '../lib/types';

const RANGES: { v: StatsRange; label: string; ms: number }[] = [
  { v: '5m', label: '5 мин', ms: 3e5 },
  { v: '30m', label: '30 мин', ms: 18e5 },
  { v: '3h', label: '3 часа', ms: 108e5 },
  { v: '24h', label: '24 часа', ms: 864e5 },
  { v: '7d', label: '7 дней', ms: 6048e5 },
  { v: '30d', label: '30 дней', ms: 2592e6 },
];

type MetricKey = 'cpu' | 'gpu' | 'ram' | 'diskUsed' | 'cput' | 'ssdt' | 'rx' | 'tx';

const METRICS: { k: MetricKey; label: string; unit: string; color: string; icon: React.ReactNode }[] = [
  { k: 'cpu', label: 'CPU', unit: '%', color: '#8f7df0', icon: <Cpu className="h-3.5 w-3.5" /> },
  { k: 'gpu', label: 'GPU', unit: '%', color: '#7ba4e6', icon: <Gauge className="h-3.5 w-3.5" /> },
  { k: 'ram', label: 'RAM', unit: '%', color: '#5fc6d8', icon: <Activity className="h-3.5 w-3.5" /> },
  { k: 'diskUsed', label: 'Диск', unit: '%', color: '#e0b65e', icon: <HardDrive className="h-3.5 w-3.5" /> },
  { k: 'cput', label: 'CPU t°', unit: '°C', color: '#e07a80', icon: <Thermometer className="h-3.5 w-3.5" /> },
  { k: 'ssdt', label: 'SSD t°', unit: '°C', color: '#d98bb0', icon: <Thermometer className="h-3.5 w-3.5" /> },
  { k: 'rx', label: 'RX', unit: 'КБ/с', color: '#55c795', icon: <Network className="h-3.5 w-3.5" /> },
  { k: 'tx', label: 'TX', unit: 'КБ/с', color: '#8bc46a', icon: <Network className="h-3.5 w-3.5" /> },
];

const val = (p: GlancesPoint, k: MetricKey): number | null => (p[k] as number | null) ?? null;
const fmtVal = (v: number | null, unit: string) =>
  v == null ? '—' : unit === 'КБ/с' ? fmtNet(v) : `${Math.round(v * 10) / 10}${unit}`;

function timeLabel(t: number, range: StatsRange): string {
  const d = new Date(t);
  return range === '5m' || range === '30m' || range === '3h'
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Волновой график (area) с hover-тултипом. */
function WaveChart({ points, metric, range, height = 150 }: { points: GlancesPoint[]; metric: MetricKey; range: StatsRange; height?: number }) {
  const meta = METRICS.find((m) => m.k === metric)!;
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const pad = { l: 40, r: 12, t: 10, b: 22 };

  const { path, area, coords, maxV } = useMemo(() => {
    const vals = points.map((p) => val(p, metric));
    const nums = vals.filter((v): v is number => v != null);
    const maxV = nums.length ? Math.max(...nums, metric === 'cpu' || metric === 'gpu' || metric === 'ram' || metric === 'diskUsed' ? 100 : 1) * 1.08 : 100;
    const x = (t: number) => pad.l + ((t - (points[0]?.t ?? 0)) / Math.max(1, (points[points.length - 1]?.t ?? 1) - (points[0]?.t ?? 0))) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - v / maxV) * (height - pad.t - pad.b);
    const coords = points.map((p, i) => ({ x: x(p.t), y: val(p, metric) != null ? y(val(p, metric)!) : null, p }));
    const segs: string[] = [];
    let cur = '';
    for (const c of coords) {
      if (c.y == null) { if (cur) { segs.push(cur); cur = ''; } continue; }
      cur += (cur ? ' L' : 'M') + c.x.toFixed(1) + ',' + c.y.toFixed(1);
    }
    if (cur) segs.push(cur);
    const path = segs.join(' ');
    const area = segs.map((s) => `${s} L${s.split(' ').pop()!.split(',')[0]},${height - pad.b} L${s.split(' ')[0].slice(1).split(',')[0]},${height - pad.b} Z`).join(' ');
    return { path, area, coords, maxV };
  }, [points, metric, height]);

  if (!points.length) return <div className="flex h-[150px] items-center justify-center font-mono text-[11px] text-dim">нет данных</div>;

  const hp = hover != null ? coords[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
          const mx = ((e.clientX - rect.left) / rect.width) * W;
          let best = -1, bd = 1e9;
          coords.forEach((c, i) => { const d = Math.abs(c.x - mx); if (d < bd) { bd = d; best = i; } });
          setHover(best >= 0 ? best : null);
        }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={pad.t + (1 - f) * (height - pad.t - pad.b)} y2={pad.t + (1 - f) * (height - pad.t - pad.b)} stroke="#242b4a" strokeDasharray="3 5" strokeWidth="0.6" />
            <text x={pad.l - 6} y={pad.t + (1 - f) * (height - pad.t - pad.b) + 3} textAnchor="end" fontSize="8" fill="#8b93b8" fontFamily="JetBrains Mono">{Math.round(maxV * f)}</text>
          </g>
        ))}
        <path d={area} fill={meta.color} opacity="0.12" />
        <path d={path} fill="none" stroke={meta.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        {hp && hp.y != null && (
          <g>
            <line x1={hp.x} x2={hp.x} y1={pad.t} y2={height - pad.b} stroke={meta.color} strokeWidth="0.8" opacity="0.5" />
            <circle cx={hp.x} cy={hp.y} r="3.5" fill={meta.color} stroke="#0b0e1a" strokeWidth="1.5" />
          </g>
        )}
      </svg>
      {hp && hp.p && (
        <div className="pointer-events-none absolute top-1 z-10 rounded-md border border-line bg-deep/95 px-2.5 py-1.5 font-mono text-[10.5px] shadow-lg"
          style={{ left: `${(hp.x / W) * 100}%`, transform: `translateX(${hp.x > W / 2 ? '-110%' : '10%'})` }}>
          <div className="text-dim">{timeLabel(hp.p.t, range)}</div>
          <div style={{ color: meta.color }}>{meta.label}: <b>{fmtVal(val(hp.p, metric), meta.unit)}</b></div>
        </div>
      )}
    </div>
  );
}

/** Столбчатый график выбранной метрики. */
function BarsChart({ points, metric, range }: { points: GlancesPoint[]; metric: MetricKey; range: StatsRange }) {
  const meta = METRICS.find((m) => m.k === metric)!;
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 180;
  const pad = { l: 40, r: 12, t: 12, b: 22 };
  const nums = points.map((p) => val(p, metric)).filter((v): v is number => v != null);
  const maxV = nums.length ? Math.max(...nums, 1) * 1.08 : 100;
  const bw = (W - pad.l - pad.r) / Math.max(1, points.length);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={pad.t + (1 - f) * (H - pad.t - pad.b)} y2={pad.t + (1 - f) * (H - pad.t - pad.b)} stroke="#242b4a" strokeDasharray="3 5" strokeWidth="0.6" />
            <text x={pad.l - 6} y={pad.t + (1 - f) * (H - pad.t - pad.b) + 3} textAnchor="end" fontSize="8" fill="#8b93b8" fontFamily="JetBrains Mono">{Math.round(maxV * f)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const v = val(p, metric);
          const x = pad.l + i * bw;
          const h = v == null ? 0 : (v / maxV) * (H - pad.t - pad.b);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={pad.t} width={bw} height={H - pad.t - pad.b} fill={hover === i ? '#181d36' : 'transparent'} />
              {v == null ? (
                <rect x={x + bw * 0.2} y={H - pad.b - 2} width={bw * 0.6} height={2} rx={1} fill="#e07a80" opacity={hover === i ? 0.9 : 0.5} />
              ) : (
                <rect x={x + bw * 0.14} y={H - pad.b - h} width={bw * 0.72} height={Math.max(1.5, h)} rx={1.5}
                  fill={meta.color} opacity={hover === i ? 1 : 0.72} className="transition-opacity" />
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && points[hover] && (
        <div className="pointer-events-none absolute top-1 z-10 rounded-md border border-line bg-deep/95 px-2.5 py-1.5 font-mono text-[10.5px] shadow-lg"
          style={{ left: `${((pad.l + hover * bw) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? '-110%' : '10%'})` }}>
          <div className="text-dim">{timeLabel(points[hover].t, range)}</div>
          <div style={{ color: meta.color }}>{meta.label}: <b>{fmtVal(val(points[hover], metric), meta.unit)}</b></div>
        </div>
      )}
    </div>
  );
}

/** Сводная панель текущих значений (последняя точка). */
function CurrentStrip({ points }: { points: GlancesPoint[] }) {
  const last = points[points.length - 1];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      {METRICS.map((m) => {
        const v = last ? val(last, m.k) : null;
        return (
          <div key={m.k} className="rise rounded-lg border border-line bg-raised/40 px-2.5 py-2 transition-colors hover:border-line/80">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-dim">
              <span style={{ color: m.color }}>{m.icon}</span>{m.label}
            </div>
            <div className="mt-1 font-mono text-[15px] font-bold tabular-nums text-ink">{fmtVal(v, m.unit)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function Stats({ mode }: { mode: 'bars' | 'ws' }) {
  const user = useCurrentUser();
  const agents = usePluto((s) => visibleAgents(s, user));
  const [agentId, setAgentId] = useState<string | null>(null);
  const [range, setRange] = useState<StatsRange>('3h');
  const [metric, setMetric] = useState<MetricKey>('cpu');
  const [points, setPoints] = useState<GlancesPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const agent = useMemo(() => agents.find((a) => a.id === agentId) ?? agents[0] ?? null, [agents, agentId]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!agent || !agent.glancesUrl) { setPoints([]); return; }
      setLoading(true);
      try {
        const r = await api.agentGlances(agent.id, range);
        if (alive) setPoints(r.points || []);
      } catch { if (alive) setPoints([]); }
      finally { if (alive) setLoading(false); }
    };
    void load();
    // короткие диапазоны обновляем чаще
    const fast = range === '5m' || range === '30m' || range === '3h';
    const t = window.setInterval(() => void load(), fast ? 10000 : 60000);
    return () => { alive = false; window.clearInterval(t); };
  }, [agent, range]);

  const hasGlances = agents.filter((a) => a.glancesUrl);

  return (
    <div className="space-y-4">
      {/* панель управления */}
      <div className="rise flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel/90 px-4 py-3">
        <span className="flex items-center gap-2 text-vio">{mode === 'bars' ? <BarChart3 className="h-5 w-5" /> : <Waves className="h-5 w-5" />}</span>
        <div>
          <div className="font-display text-[14px] font-bold text-ink">{mode === 'bars' ? 'Статистика Bars' : 'Статистика WS'}</div>
          <div className="text-[10.5px] text-dim">телеметрия Glances · хранение 30 дней</div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="inp w-auto font-mono text-[12px]" value={agent?.id ?? ''} onChange={(e) => setAgentId(e.target.value)}>
            {hasGlances.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.ip}</option>)}
            {!hasGlances.length && <option value="">нет агентов с Glances</option>}
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

      {!agent || !agent.glancesUrl ? (
        <Panel title="Нет источника данных">
          <EmptyState icon={<Activity className="h-6 w-6" />} title="Glances не подключён"
            text="Добавьте агенту адрес Glances (glances -w, порт 61208) в «Агенты → Изменить», и здесь появится телеметрия."
            action={<button onClick={() => store.nav('agents')} className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink hover:bg-vio/30">К агентам</button>} />
        </Panel>
      ) : (
        <>
          <CurrentStrip points={points} />

          {mode === 'bars' ? (
            <Panel title={`Столбцы · ${METRICS.find((m) => m.k === metric)?.label}`} icon={<BarChart3 className="h-4 w-4" />}
              right={<span className="font-mono text-[10.5px] text-dim">{points.length} точек{loading ? ' · загрузка…' : ''}</span>}>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {METRICS.map((m) => (
                  <button key={m.k} onClick={() => setMetric(m.k)}
                    className={cls('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition-all',
                      metric === m.k ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                    <span style={{ color: m.color }}>{m.icon}</span>{m.label}
                  </button>
                ))}
              </div>
              {points.length ? <BarsChart points={points} metric={metric} range={range} />
                : <div className="flex h-[180px] items-center justify-center font-mono text-[11px] text-dim">нет данных за период</div>}
            </Panel>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {METRICS.map((m) => (
                <Panel key={m.k} title={`${m.label} · ${m.unit}`} icon={<span style={{ color: m.color }}>{m.icon}</span>}>
                  {points.length ? <WaveChart points={points} metric={m.k} range={range} height={130} />
                    : <div className="flex h-[130px] items-center justify-center font-mono text-[11px] text-dim">нет данных</div>}
                </Panel>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
