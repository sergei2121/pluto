// ─── PLUTO: журнал телеметрии агента — AIDA64 (60 дн) и Glances (30 дн) ─────
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Download, RefreshCw } from 'lucide-react';
import { EmptyState, Panel, StatusDot } from '../components/ui';
import { store, useCurrentUser, usePluto, visibleAgents } from '../lib/store';
import { api } from '../lib/api';
import { cls, fmtDate, LINE_COLORS } from '../lib/util';
import {
  AIDA_FIELDS, AIDA_RANGES, GLANCES_FIELDS, GLANCES_RANGES,
  type Agent, type AidaPoint, type AidaRange, type GlancesPoint, type GlancesRange,
} from '../lib/types';

type Source = 'aida' | 'glances';
type AnyPoint = (AidaPoint | GlancesPoint) & { t: number };

const getVal = (p: AnyPoint, k: string): number | null => {
  const v = (p as unknown as Record<string, unknown>)[k];
  return typeof v === 'number' && isFinite(v) ? v : null;
};

function fmtVal(v: number | null, unit: string): string {
  if (v == null) return '—';
  if (unit === 'КБ/с') {
    if (v >= 1024) return `${(v / 1024).toFixed(1)} МБ/с`;
    return `${Math.round(v)} КБ/с`;
  }
  if (unit === 'с') {
    const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60);
    return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
  }
  return `${v}${unit === '%' ? '%' : unit === '°C' ? '°C' : unit === 'ГБ' ? ' ГБ' : ''}`;
}

// ─── Интерактивный график ───────────────────────────────────────────────────

function LineChart({ points, metric, unit, color }: { points: AnyPoint[]; metric: string; unit: string; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900, H = 220, PL = 46, PR = 12, PT = 14, PB = 26;

  const vals = points.map((p) => getVal(p, metric));
  const nums = vals.filter((v): v is number => v != null);

  if (points.length < 2 || nums.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-line bg-raised/20 font-mono text-[12px] text-dim">
        недостаточно данных для графика
      </div>
    );
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const tSpan = t1 - t0 || 1;

  const x = (t: number) => PL + ((t - t0) / tSpan) * (W - PL - PR);
  const y = (v: number) => H - PB - ((v - min) / span) * (H - PT - PB);

  const path = points
    .map((p, i) => {
      const v = getVal(p, metric);
      if (v == null) return null;
      return `${i === 0 || vals[i - 1] == null ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');

  const gridVals = [min, min + span / 2, max];
  const hoverPt = hover != null ? points[hover] : null;
  const hoverVal = hoverPt ? getVal(hoverPt, metric) : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 260 }}
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0, bestD = 1e9;
          points.forEach((p, i) => {
            const d = Math.abs(x(p.t) - px);
            if (d < bestD) { bestD = d; best = i; }
          });
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#242b4a" strokeWidth="1" strokeDasharray="4 6" />
            <text x={PL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#8b93b8" fontFamily="JetBrains Mono">
              {v >= 100 ? Math.round(v) : v.toFixed(1)}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const t = t0 + f * tSpan;
          return (
            <text key={f} x={x(t)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#8b93b8" fontFamily="JetBrains Mono">
              {new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </text>
          );
        })}
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hoverPt && hoverVal != null && (
          <g>
            <line x1={x(hoverPt.t)} x2={x(hoverPt.t)} y1={PT} y2={H - PB} stroke="#8b93b8" strokeWidth="1" opacity="0.4" />
            <circle cx={x(hoverPt.t)} cy={y(hoverVal)} r="4" fill={color} stroke="#0b0e1a" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hoverPt && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-panel/95 px-3 py-2 shadow-xl"
          style={{ left: `${(x(hoverPt.t) / W) * 100}%`, transform: x(hoverPt.t) > W * 0.65 ? 'translateX(-105%)' : 'translateX(8px)' }}
        >
          <div className="font-mono text-[10px] text-dim">{fmtDate(hoverPt.t)}</div>
          <div className="mt-0.5 font-mono text-[13px] font-bold" style={{ color }}>
            {fmtVal(hoverVal, unit)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Страница ───────────────────────────────────────────────────────────────

export default function Telemetry() {
  const user = useCurrentUser();
  const agents = usePluto((s) => visibleAgents(s, user));
  const routeParam = usePluto((s) => s.routeParam);

  const [agentId, setAgentId] = useState<string | null>(null);
  const [source, setSource] = useState<Source>('aida');
  const [range, setRange] = useState<'5m' | '30m' | '3h' | '24h' | '7d' | '30d' | '60d'>('3h');
  const [points, setPoints] = useState<AnyPoint[]>([]);
  const [metric, setMetric] = useState('cpuTemp');
  const [loading, setLoading] = useState(false);
  const fetchedFor = useRef('');

  const cur = agents.find((a) => a.id === agentId) ?? null;

  useEffect(() => {
    if (routeParam) {
      const a = agents.find((x) => x.id === routeParam || x.ip === routeParam || x.name === routeParam);
      if (a) setAgentId(a.id);
      store.nav('telemetry');
    } else if (!agentId && agents.length) {
      const first = agents.find((a) => a.latest) || agents.find((a) => a.online) || agents[0];
      setAgentId(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParam, agents.length]);

  const ranges = source === 'aida' ? AIDA_RANGES : GLANCES_RANGES;
  const fields = source === 'aida' ? AIDA_FIELDS : GLANCES_FIELDS;

  // при смене источника выбираем первую доступную метрику и допустимый диапазон
  useEffect(() => {
    setMetric(source === 'aida' ? 'cpuTemp' : 'cpu');
    if (source === 'glances' && range === '60d') setRange('30d');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // загрузка архива
  useEffect(() => {
    if (!cur) return;
    const key = `${cur.id}:${source}:${range}`;
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const r = source === 'aida'
          ? await api.agentAida(cur.id, range)
          : await api.agentGlances(cur.id, range);
        if (alive) setPoints((r.points || []) as AnyPoint[]);
      } catch {
        if (alive) setPoints([]);
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchedFor.current = key;
    void load();
    // короткие диапазоны обновляем каждые 10 с, длинные — раз в минуту
    const fast = range === '5m' || range === '30m' || range === '3h';
    const t = window.setInterval(() => void load(), fast ? 10000 : 60000);
    return () => { alive = false; window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, source, range]);

  const field = fields.find((f) => f.k === metric) ?? fields[0];
  const unit = field.unit;
  const color = source === 'aida' ? '#8f7df0' : '#7ba4e6';

  const stats = useMemo(() => {
    const nums = points.map((p) => getVal(p, metric)).filter((v): v is number => v != null);
    if (!nums.length) return null;
    const sum = nums.reduce((s, v) => s + v, 0);
    return { min: Math.min(...nums), max: Math.max(...nums), avg: sum / nums.length, n: nums.length };
  }, [points, metric]);

  const exportCsv = () => {
    if (!cur || !points.length) return;
    const rows = [
      ['time', ...fields.map((f) => String(f.k))].join(';'),
      ...points.map((p) => [
        new Date(p.t).toISOString(),
        ...fields.map((f) => {
          const v = getVal(p, String(f.k));
          return v != null ? String(v) : '';
        }),
      ].join(';')),
    ].join('\n');
    const blob = new Blob(['\uFEFF' + rows], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pluto-${source}-${cur.ip || cur.name}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!agents.length) {
    return (
      <Panel title="Журнал телеметрии" icon={<Activity className="h-4 w-4" />}>
        <EmptyState
          icon={<Activity className="h-6 w-6" />}
          title="Нет агентов с телеметрией"
          text="Добавьте агента (IP + ссылка на листинг AIDA64 и/или адрес Glances) — архив показаний появится здесь."
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
      {/* список агентов */}
      <Panel title="Агенты" icon={<Activity className="h-4 w-4" />} bodyClass="p-2">
        <ul className="space-y-1">
          {agents.map((a: Agent) => (
            <li key={a.id}>
              <button
                onClick={() => setAgentId(a.id)}
                className={cls(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all',
                  a.id === agentId ? 'bg-raised shadow-[inset_0_0_0_1px_rgba(143,125,240,.3)]' : 'hover:bg-raised/50',
                )}
              >
                <StatusDot status={a.online ? 'up' : 'down'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{a.name}</span>
                  <span className="block truncate font-mono text-[10px] text-dim">{a.ip || 'нет данных'}</span>
                </span>
                <span className="flex gap-1">
                  {a.aidaUrl && <span className="rounded border border-vio/40 bg-vio/10 px-1 py-0.5 font-mono text-[8.5px] font-bold text-vio">AI</span>}
                  {a.glancesUrl && <span className="rounded border border-blu/40 bg-blu/10 px-1 py-0.5 font-mono text-[8.5px] font-bold text-blu">GL</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      {/* архив */}
      <Panel
        title={cur ? `Архив показаний · ${cur.name}` : 'Архив показаний'}
        icon={<Activity className="h-4 w-4" />}
        right={
          <div className="flex items-center gap-2">
            <button className="btn-ghost !py-1" onClick={exportCsv} disabled={!points.length}>
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-dim" />}
          </div>
        }
        bodyClass="p-4"
      >
        {!cur ? (
          <p className="py-10 text-center text-[13px] text-dim">Выберите агента слева</p>
        ) : (
          <div className="space-y-4">
            {/* источник + период */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-line bg-raised/70 p-0.5">
                <button
                  onClick={() => setSource('aida')}
                  disabled={!cur.aidaUrl}
                  className={cls('rounded-md px-3 py-1.5 text-[11.5px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40', source === 'aida' ? 'bg-vio/30 text-ink' : 'text-dim hover:text-mut')}
                  title={cur.aidaUrl ? 'Данные AIDA64 (хранение 60 дней)' : 'У агента не задан листинг AIDA64'}
                >
                  AIDA64 · 60 дн
                </button>
                <button
                  onClick={() => setSource('glances')}
                  disabled={!cur.glancesUrl}
                  className={cls('rounded-md px-3 py-1.5 text-[11.5px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40', source === 'glances' ? 'bg-blu/30 text-ink' : 'text-dim hover:text-mut')}
                  title={cur.glancesUrl ? 'Данные Glances (хранение 30 дней)' : 'У агента не задан адрес Glances'}
                >
                  Glances · 30 дн
                </button>
              </div>

              <div className="ml-auto flex flex-wrap gap-1">
                {ranges.map((r) => (
                  <button
                    key={r.v}
                    onClick={() => setRange(r.v as typeof range)}
                    className={cls('rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-all', range === r.v ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/40 text-dim hover:text-mut')}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* выбор показателя */}
            <div className="flex flex-wrap gap-1.5">
              {fields.map((f, i) => (
                <button
                  key={String(f.k)}
                  onClick={() => setMetric(String(f.k))}
                  className={cls('rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all', metric === f.k ? 'text-ink' : 'border-line bg-raised/40 text-dim hover:text-mut')}
                  style={metric === f.k ? { borderColor: LINE_COLORS[i % LINE_COLORS.length], background: `${LINE_COLORS[i % LINE_COLORS.length]}22` } : undefined}
                >
                  {f.label}{f.unit !== 'с' ? ` ${f.unit}` : ''}
                </button>
              ))}
            </div>

            <LineChart points={points} metric={String(field.k)} unit={unit} color={color} />

            {/* сводка */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { l: 'Точек', v: stats ? String(stats.n) : '—' },
                { l: 'Минимум', v: stats ? fmtVal(Math.round(stats.min * 10) / 10, unit) : '—' },
                { l: 'Среднее', v: stats ? fmtVal(Math.round(stats.avg * 10) / 10, unit) : '—' },
                { l: 'Максимум', v: stats ? fmtVal(Math.round(stats.max * 10) / 10, unit) : '—' },
                { l: 'Последняя', v: points.length ? fmtDate(points[points.length - 1].t) : '—' },
              ].map((s) => (
                <div key={s.l} className="rounded-lg border border-line bg-raised/30 px-3 py-2.5">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-dim">{s.l}</div>
                  <div className="mt-1 truncate font-mono text-[13px] font-bold text-ink">{s.v}</div>
                </div>
              ))}
            </div>

            {points.length === 0 && (
              <p className="rounded-lg border border-dashed border-line bg-raised/20 px-3 py-3 text-center text-[12px] text-dim">
                Данных за выбранный период нет.
                {source === 'aida' && !cur.aidaUrl && ' У агента не задан листинг AIDA64.'}
                {source === 'glances' && !cur.glancesUrl && ' У агента не задан адрес Glances.'}
                {' '}Проверить источник можно в карточке агента («Проверить источник»).
              </p>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
