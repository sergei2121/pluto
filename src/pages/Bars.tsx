// ─── PLUTO: журнал телеметрии Bars · Glances ─────────────────────────────────
// Ядро само опрашивает веб-страницы Glances (агент не нужен — Rocky Linux и т.п.).
// Разбираются столбцы CPU (+детали), MEM, Rx/s, Tx/s и строка Package (температура ЦП).
// Хранение — 30 дней с автоочисткой по расписанию.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ChevronDown, ExternalLink, Link2, Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import { Panel, EmptyState, StatusDot, Field, Modal, Seg, TimeAgo } from '../components/ui';
import { usePluto, useCurrentUser, store, useToasts } from '../lib/store';
import { api } from '../lib/api';
import { cls, fmtClock, fmtDate, fmtNet } from '../lib/util';
import type { GlancesDevice, GlancesPoint, GlancesRange } from '../lib/types';

// ─── Справочник метрик (пункт меню ↔ столбец Glances) ───────────────────────

type Metric = {
  key: keyof GlancesPoint;
  label: string;
  unit: string;
  color: string;
  fmt?: (v: number) => string;
};

const RANGES: { v: GlancesRange; label: string }[] = [
  { v: '5m', label: '5 минут' },
  { v: '30m', label: '30 минут' },
  { v: '3h', label: '3 часа' },
  { v: '24h', label: '24 часа' },
  { v: '7d', label: '7 дней' },
  { v: '30d', label: '30 дней' },
];

const METRICS: Metric[] = [
  { key: 'cpu', label: 'CPU', unit: '%', color: '#8f7df0' },
  { key: 'mem', label: 'MEM', unit: '%', color: '#7ba4e6' },
  { key: 'pkg', label: 'Package', unit: '°C', color: '#e0945e' },
  { key: 'rx', label: 'Rx/s', unit: 'КБ/с', color: '#55c795', fmt: (v) => fmtNet(v) },
  { key: 'tx', label: 'Tx/s', unit: 'КБ/с', color: '#8bc46a', fmt: (v) => fmtNet(v) },
  { key: 'user', label: 'user', unit: '%', color: '#a48ff0' },
  { key: 'system', label: 'system', unit: '%', color: '#b9a4f5' },
  { key: 'iowait', label: 'iowait', unit: '%', color: '#5fc6d8' },
  { key: 'idle', label: 'idle', unit: '%', color: '#98a4c8' },
  { key: 'irq', label: 'irq', unit: '%', color: '#dfa65e' },
  { key: 'nice', label: 'nice', unit: '%', color: '#d98bb0' },
  { key: 'steal', label: 'steal', unit: '%', color: '#e07a80' },
  { key: 'memUsed', label: 'MEM used', unit: 'ГБ', color: '#6fa8e8' },
  { key: 'memFree', label: 'MEM free', unit: 'ГБ', color: '#8fd0a8' },
  { key: 'memTotal', label: 'MEM total', unit: 'ГБ', color: '#9aa8d8' },
];

function fmtVal(m: Metric, v: number | null): string {
  if (v == null || !isFinite(v)) return '—';
  if (m.fmt) return m.fmt(v);
  return `${Math.round(v * 10) / 10}${m.unit}`;
}

// ─── Большой график с наведением ────────────────────────────────────────────

function GlChart({ points, metric }: { points: GlancesPoint[]; metric: Metric }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const coords = useMemo(
    () => points.map((p, i) => ({ i, v: p[metric.key] })).filter((c): c is { i: number; v: number } => c.v != null && isFinite(c.v as number)),
    [points, metric],
  );

  if (coords.length < 2) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-line bg-raised/30 font-mono text-[12px] text-dim">
        недостаточно точек для графика — добавьте устройство и дождитесь первого опроса
      </div>
    );
  }

  const W = 1000, H = 280;
  const maxV = Math.max(...coords.map((c) => c.v), 0.001) * 1.08;
  const X = (i: number) => (i / (points.length - 1)) * W;
  const Y = (v: number) => H - 8 - (v / maxV) * (H - 30);
  const line = coords.map((c, j) => `${j ? 'L' : 'M'}${X(c.i).toFixed(1)},${Y(c.v).toFixed(1)}`).join(' ');
  const area =
    `M${X(coords[0].i).toFixed(1)},${H} ` +
    coords.map((c) => `L${X(c.i).toFixed(1)},${Y(c.v).toFixed(1)}`).join(' ') +
    ` L${X(coords[coords.length - 1].i).toFixed(1)},${H} Z`;
  const gid = 'bg-' + metric.key;
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
      <div ref={wrapRef} className="relative ml-14 h-[260px] cursor-crosshair select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <div className="absolute -left-14 top-0 h-full w-13">
          {ticks.map((t, i) => (
            <span key={i} className="absolute right-1 -translate-y-1/2 font-mono text-[9.5px] text-dim" style={{ top: `${(t.y / H) * 100}%` }}>
              {metric.fmt ? metric.fmt(t.v) : `${Math.round(t.v)}${metric.unit}`}
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
          {hover != null && hp && hp[metric.key] != null && (
            <line x1={X(hover)} x2={X(hover)} y1="0" y2={H} stroke="#98a4c8" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>
      {hp && (
        <div className="pointer-events-none absolute -top-1 left-16 rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-[11px] text-mut shadow-lg">
          <span className="text-dim">{fmtDate(hp.t)} {fmtClock(hp.t)}</span>
          <span className="ml-2 font-bold" style={{ color: metric.color }}>{fmtVal(metric, hp[metric.key])}</span>
        </div>
      )}
    </div>
  );
}

// ─── Плитка показателя (текущее значение + мини-спарк) ──────────────────────

function Tile({ metric, points, latest }: { metric: Metric; points: GlancesPoint[]; latest: number | null }) {
  const spark = useMemo(
    () => points.map((p) => p[metric.key]).filter((v): v is number => v != null && isFinite(v)).slice(-40),
    [points, metric],
  );
  const max = Math.max(...spark, 0.001);
  return (
    <div className="rounded-lg border border-line bg-raised/40 p-3 transition-colors hover:border-line/80">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-dim">{metric.label}</span>
        <span className="font-mono text-[15px] font-bold tabular-nums" style={{ color: metric.color }}>
          {fmtVal(metric, latest)}
        </span>
      </div>
      <svg viewBox="0 0 120 26" className="mt-2 h-[26px] w-full" preserveAspectRatio="none">
        {spark.length >= 2 && (
          <polyline
            points={spark.map((v, i) => `${(i / (spark.length - 1)) * 120},${24 - (v / max) * 20}`).join(' ')}
            fill="none" stroke={metric.color} strokeWidth="1.6" strokeLinejoin="round" opacity="0.85"
          />
        )}
      </svg>
    </div>
  );
}

// ─── Страница ───────────────────────────────────────────────────────────────

export default function Bars() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const list = usePluto((s) => s.glances);
  const toast = (k: Parameters<typeof useToasts.push>[0], t: string) => useToasts.push(k, t);

  const [addOpen, setAddOpen] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [range, setRange] = useState<GlancesRange>('5m');
  const [metricKey, setMetricKey] = useState<keyof GlancesPoint>('cpu');
  const [points, setPoints] = useState<GlancesPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const sel = useMemo(() => list.find((g) => g.id === selId) ?? list[0] ?? null, [list, selId]);
  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0];

  // авто-выбор первого устройства
  useEffect(() => {
    if (!selId && list.length) setSelId(list[0].id);
  }, [list, selId]);

  // загрузка истории при смене устройства/периода
  useEffect(() => {
    if (!sel) { setPoints([]); return; }
    let alive = true;
    setLoading(true);
    api.glancesHistory(sel.id, range)
      .then((r) => { if (alive) setPoints(r.points || []); })
      .catch(() => { if (alive) setPoints([]); })
      .finally(() => { if (alive) setLoading(false); });
    const t = setInterval(() => {
      api.glancesHistory(sel.id, range).then((r) => { if (alive) setPoints(r.points || []); }).catch(() => {});
    }, range === '5m' || range === '30m' ? 10_000 : 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [sel?.id, range]);

  const latest = sel?.latest ?? null;

  return (
    <div className="space-y-4">
      {/* Шапка с действиями */}
      <div className="rise flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-[17px] font-bold text-ink">Glances · удалённые веб-страницы</h2>
          <p className="text-[12px] text-dim">Ядро опрашивает страницы Glances напрямую — агент на сервере не требуется. Хранение 30 дней.</p>
        </div>
        <div className="ml-auto flex gap-2">
          {sel && isAdmin && (
            <button
              className="btn-ghost"
              onClick={() => store.scrapeGlances(sel.id).then((r) => {
                if (!r) return;
                toast(r.error ? 'warn' : 'ok', r.error ? `Опрос: ${r.error}` : 'Показатели обновлены');
              }).catch((e) => toast('warn', e?.message || 'Не удалось опросить'))}
            >
              <RefreshCw className={cls('h-4 w-4', loading && 'animate-spin')} /> Опросить сейчас
            </button>
          )}
          {isAdmin && (
            <button className="btn-acc" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Добавить устройство
            </button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" />}
            title="Устройств Glances пока нет"
            text="Добавьте адрес веб-страницы Glances (обычно http://<IP>:61208) — ядро начнёт собирать CPU, MEM, сеть и температуру Package."
            action={isAdmin ? (
              <button className="btn-acc" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Добавить первое устройство
              </button>
            ) : undefined}
          />
        </Panel>
      ) : (
        <>
          {/* Список устройств */}
          <div className="rise flex flex-wrap gap-2">
            {list.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelId(g.id)}
                className={cls(
                  'flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-left transition-all duration-150',
                  sel?.id === g.id
                    ? 'border-vio/60 bg-vio/10 shadow-[0_0_0_3px_rgba(143,125,240,.08)]'
                    : 'border-line bg-raised/50 hover:border-line/80 hover:bg-raised/80',
                )}
              >
                <StatusDot status={g.online ? 'up' : 'down'} />
                <span>
                  <span className="block text-[13px] font-semibold text-ink">{g.name}</span>
                  <span className="block font-mono text-[10.5px] text-dim">{g.url.replace(/^https?:\/\//, '')}</span>
                </span>
              </button>
            ))}
          </div>

          {sel && (
            <>
              {/* Сводка устройства */}
              <Panel
                title={sel.name}
                right={
                  <div className="flex items-center gap-2">
                    {sel.serverLink && (
                      <a
                        href={/^https?:\/\//.test(sel.serverLink) ? sel.serverLink : `http://${sel.serverLink}`}
                        target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-md border border-line bg-raised/60 px-2.5 py-1.5 text-[11.5px] font-semibold text-blu transition-colors hover:border-blu/50 hover:text-ink"
                        title="Ссылка на физ. сервер"
                      >
                        <Link2 className="h-3.5 w-3.5" /> физ. сервер <ExternalLink className="h-3 w-3 opacity-60" />
                      </a>
                    )}
                    <span className={cls('font-mono text-[11px]', sel.online ? 'text-ok' : 'text-crit')}>
                      {sel.online ? 'в сети' : 'недоступен'}
                    </span>
                    {isAdmin && (
                      <button
                        className="rounded-md p-1.5 text-dim transition-colors hover:bg-crit/10 hover:text-crit"
                        title="Удалить устройство"
                        onClick={() => {
                          if (!window.confirm(`Удалить «${sel.name}» и всю его историю?`)) return;
                          store.removeGlances(sel.id);
                          setSelId(null);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                }
                delay={60}
              >
                <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11.5px] text-dim">
                  <span className="flex items-center gap-1.5"><Server className="h-3.5 w-3.5" />{sel.url}</span>
                  <span>опрос: {sel.lastScrape ? <TimeAgo ts={sel.lastScrape} /> : 'ещё не было'}</span>
                  {sel.lastError && <span className="text-warn">{sel.lastError}</span>}
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                  {METRICS.slice(0, 5).map((m) => (
                    <Tile key={m.key} metric={m} points={points} latest={latest ? (latest[m.key] as number | null) : null} />
                  ))}
                </div>
              </Panel>

              {/* История */}
              <Panel
                title="Архив показаний"
                delay={120}
                right={
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <select
                        value={metricKey as string}
                        onChange={(e) => setMetricKey(e.target.value as keyof GlancesPoint)}
                        className="appearance-none rounded-md border border-line bg-raised/70 py-1.5 pl-2.5 pr-7 text-[12px] font-semibold text-ink outline-none transition-colors hover:border-line/80"
                      >
                        {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
                    </div>
                    <Seg options={RANGES.map((r) => ({ v: r.v, label: r.label }))} value={range} onChange={setRange} />
                  </div>
                }
              >
                <div className="relative">
                  {loading && points.length === 0 && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                      <RefreshCw className="h-5 w-5 animate-spin text-vio" />
                    </div>
                  )}
                  <GlChart points={points} metric={metric} />
                </div>
                <p className="mt-3 text-[11px] text-dim">
                  Точек в выборке: <span className="font-mono text-mut">{points.length}</span> · период: {RANGES.find((r) => r.v === range)?.label} ·
                  хранение 30 дней с автоочисткой
                </p>
              </Panel>
            </>
          )}
        </>
      )}

      {/* Модалка добавления */}
      <AddGlancesModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

// ─── Модалка добавления устройства ──────────────────────────────────────────

function AddGlancesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setName(''); setUrl(''); setLink(''); setErr(null); setBusy(false); }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) { setErr('Укажите имя сервера'); return; }
    if (!url.trim()) { setErr('Укажите адрес мониторинга'); return; }
    setBusy(true);
    try {
      const res = store.addGlances({ name: name.trim(), url: url.trim(), serverLink: link.trim() });
      if (res) { setErr(res); setBusy(false); return; }
      useToasts.push('ok', `Устройство «${name.trim()}» добавлено — первый опрос через минуту`);
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Не удалось добавить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Устройство мониторинга Glances">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Имя" hint="Произвольное имя сервера, под которым он появится в списке.">
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Адрес мониторинга" hint="Веб-страница Glances с портом, напр. http://10.0.0.5:61208">
          <input className="inp font-mono text-[12.5px]" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Ссылка на физ. сервер" hint="Будет кликабельной в карточке устройства.">
          <input className="inp font-mono text-[12.5px]" value={link} onChange={(e) => setLink(e.target.value)} />
        </Field>
        {err && <p className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-acc" disabled={busy}>
            {busy ? 'Добавляем…' : 'Добавить'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
