// ─── PLUTO: Журнал телеметрии — архив Glances (30 дней) ──────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Radio } from 'lucide-react';
import { EmptyState, Panel, StatusDot, TimeAgo } from '../components/ui';
import { api } from '../lib/api';
import { store, useCurrentUser, usePluto } from '../lib/store';
import { cls, fmtDate, LINE_COLORS } from '../lib/util';
import {
  GLANCES_FIELDS, GLANCES_RANGES,
  type Agent, type GlancesPoint, type GlancesRange,
} from '../lib/types';

function getVal(p: GlancesPoint, k: string): number | null {
  const v = (p as unknown as Record<string, number | null>)[k];
  return v == null || !isFinite(v) ? null : v;
}

function fmtVal(v: number | null, unit: string): string {
  if (v == null) return '—';
  return `${v >= 1000 ? Math.round(v) : v}${unit ? ' ' + unit : ''}`;
}

// ─── График ──────────────────────────────────────────────────────────────────

function Chart({ points, metric, unit, color }: { points: GlancesPoint[]; metric: string; unit: string; color: string }) {
  const W = 900, H = 240;
  const padL = 46, padR = 14, padT = 12, padB = 26;
  const [hover, setHover] = useState<number | null>(null);

  const vals = points.map((p) => getVal(p, metric));
  const nums = vals.filter((v): v is number => v != null);
  if (!points.length || !nums.length) {
    return <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-line bg-raised/20 font-mono text-[12px] text-dim">нет данных за выбранный период</div>;
  }

  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min + span * 0.05) / (span * 1.1)) * (H - padT - padB);

  const path = points
    .map((p, i) => {
      const v = getVal(p, metric);
      if (v == null) return null;
      return `${i === 0 || vals[i - 1] == null ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');

  const area = `${path} L${x(t1).toFixed(1)},${H - padB} L${x(t0).toFixed(1)},${H - padB} Z`;

  const gridY = [0, 0.25, 0.5, 0.75, 1].map((f) => min + span * f);
  const hoverPt = hover != null ? points[hover] : null;
  const hoverVal = hoverPt ? getVal(hoverPt, metric) : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`} className="w-full cursor-crosshair"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = -1, bd = 1e9;
          points.forEach((p, i) => {
            const d = Math.abs(x(p.t) - px);
            if (d < bd) { bd = d; best = i; }
          });
          setHover(best >= 0 ? best : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="tel-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridY.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#242b4a" strokeWidth="0.7" strokeDasharray="3 6" />
            <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#8b93b8" fontFamily="JetBrains Mono">
              {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 100 ? Math.round(v) : v.toFixed(1)}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const t = t0 + (t1 - t0) * f;
          return (
            <text key={f} x={x(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="#8b93b8" fontFamily="JetBrains Mono">
              {new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </text>
          );
        })}
        <path d={area} fill="url(#tel-fill)" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        {hoverPt && (
          <g>
            <line x1={x(hoverPt.t)} x2={x(hoverPt.t)} y1={padT} y2={H - padB} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            {hoverVal != null && <circle cx={x(hoverPt.t)} cy={y(hoverVal)} r="4" fill={color} stroke="#0b0e1a" strokeWidth="1.5" />}
          </g>
        )}
      </svg>
      {hoverPt && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-panel/95 px-3 py-2 font-mono text-[11px] shadow-xl"
          style={{ left: `${(x(hoverPt.t) / W) * 100}%`, transform: x(hoverPt.t) > W * 0.6 ? 'translateX(-105%)' : 'translateX(8px)' }}
        >
          <div className="text-dim">{fmtDate(hoverPt.t)} · {new Date(hoverPt.t).toLocaleTimeString('ru-RU')}</div>
          <div className="mt-0.5 font-bold" style={{ color }}>{fmtVal(hoverVal, unit)}</div>
        </div>
      )}
    </div>
  );
}

// ─── Страница ────────────────────────────────────────────────────────────────

export default function Telemetry() {
  const user = useCurrentUser();
  const agents = usePluto((s) => (user?.role === 'admin' || user?.scope.includes('agent') ? s.agents : []));
  const withGl = agents.filter((a: Agent) => a.glancesUrl);

  const param = usePluto((s) => s.routeParam);
  const [agentId, setAgentId] = useState<string>('');
  const [range, setRange] = useState<GlancesRange>('5m');
  const [metric, setMetric] = useState<string>('cpu');
  const [points, setPoints] = useState<GlancesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // первичный выбор агента
  useEffect(() => {
    if (agentId) return;
    const first = withGl.find((a) => a.id === param) || withGl[0];
    if (first) setAgentId(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withGl.length, param]);

  const agent = withGl.find((a) => a.id === agentId) || null;

  // загрузка архива + автообновление
  useEffect(() => {
    if (!agent) return;
    const load = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const r = await api.agentGlances(agent.id, range);
        setPoints(r.points || []);
        setErr(null);
      } catch (e) {
        if (!silent) setErr(e instanceof Error ? e.message : 'Не удалось загрузить архив');
      } finally {
        if (!silent) setLoading(false);
      }
    };
    void load();
    const iv = range === '5m' || range === '30m' ? 10000 : 60000;
    timerRef.current = window.setInterval(() => void load(true), iv);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [agent, range]);

  const field = GLANCES_FIELDS.find((f) => f.k === metric) || GLANCES_FIELDS[0];
  const color = LINE_COLORS[GLANCES_FIELDS.indexOf(field) % LINE_COLORS.length];

  const stats = useMemo(() => {
    const nums = points.map((p) => getVal(p, metric)).filter((v): v is number => v != null);
    if (!nums.length) return null;
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return {
      avg: Math.round(avg * 10) / 10,
      min: Math.round(Math.min(...nums) * 10) / 10,
      max: Math.round(Math.max(...nums) * 10) / 10,
      n: nums.length,
    };
  }, [points, metric]);

  const exportCsv = () => {
    if (!agent || !points.length) return;
    const fields = GLANCES_FIELDS;
    const csv = [
      ['time', ...fields.map((f) => `${f.k}${f.unit ? '_' + f.unit : ''}`)].join(';'),
      ...points.map((p) => [
        new Date(p.t).toISOString(),
        ...fields.map((f) => {
          const v = getVal(p, String(f.k));
          return v != null ? String(v) : '';
        }),
      ].join(';')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `pluto-glances-${agent.ip || agent.name}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Журнал телеметрии · Glances"
        icon={<Radio className="h-4 w-4" />}
        delay={0}
        right={
          <div className="flex items-center gap-2">
            <select className="inp w-auto py-1.5 text-[12px]" value={range} onChange={(e) => setRange(e.target.value as GlancesRange)}>
              {GLANCES_RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>
            <button className="btn-ghost !py-1.5" onClick={exportCsv} disabled={!points.length} title="Экспорт CSV">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </div>
        }
      >
        {withGl.length === 0 ? (
          <EmptyState
            icon={<Radio className="h-6 w-6" />}
            title="Нет агентов с Glances"
            text="Добавьте агента и укажите адрес Glances (glances -w, порт 61208) — архив показаний за 30 дней появится здесь."
            action={<button className="btn-acc" onClick={() => store.nav('agents', 'new')}>Добавить агента</button>}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {withGl.map((a: Agent) => (
              <button
                key={a.id}
                onClick={() => setAgentId(a.id)}
                className={cls(
                  'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-all',
                  a.id === agentId ? 'border-blu/50 bg-blu/10 text-ink' : 'border-line bg-raised/40 text-mut hover:border-blu/30 hover:text-ink',
                )}
              >
                <StatusDot status={a.online ? 'up' : 'down'} />
                {a.name}
              </button>
            ))}
            {agent && (
              <span className="ml-auto font-mono text-[11px] text-dim">
                {agent.glancesUrl} · опрос: {agent.lastGlances ? <TimeAgo ts={agent.lastGlances} /> : 'ещё не было'}
              </span>
            )}
          </div>
        )}
      </Panel>

      {agent && (
        <Panel
          title={`${field.label}${field.unit ? ', ' + field.unit : ''} · ${GLANCES_RANGES.find((r) => r.v === range)?.label}`}
          icon={<Radio className="h-4 w-4" />}
          delay={60}
          right={
            stats && (
              <span className="font-mono text-[11px] text-dim">
                ср. <b className="text-ink">{stats.avg}</b> · мин <b className="text-ink">{stats.min}</b> · макс <b className="text-ink">{stats.max}</b> · {stats.n} тчк
              </span>
            )
          }
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {GLANCES_FIELDS.map((f, i) => (
              <button
                key={f.k}
                onClick={() => setMetric(String(f.k))}
                className={cls(
                  'rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold transition-all',
                  metric === f.k ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/40 text-dim hover:text-mut',
                )}
              >
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} />
                {f.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-line bg-raised/20 font-mono text-[12px] text-dim">загрузка архива…</div>
          ) : err ? (
            <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-crit/40 bg-crit/5 font-mono text-[12px] text-crit">{err}</div>
          ) : (
            <Chart points={points} metric={String(field.k)} unit={field.unit} color={color} />
          )}
        </Panel>
      )}
    </div>
  );
}
