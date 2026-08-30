// ─── PLUTO: Журнал телеметрии Bars — Glances-серверы (Rocky Linux и др.) ────
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Download, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { EmptyState, Field, Modal, Panel, StatusDot, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts, visibleGlances } from '../lib/store';
import { api } from '../lib/api';
import { cls, fmtDate, LINE_COLORS } from '../lib/util';
import { GLANCES_FIELDS, GLANCES_RANGES, type GlancesDevice, type GlancesPoint, type GlancesRange } from '../lib/types';

const getVal = (p: GlancesPoint, k: string): number | null => {
  const v = (p as unknown as Record<string, unknown>)[k];
  return typeof v === 'number' && isFinite(v) ? v : null;
};

function fmtVal(v: number | null, unit: string): string {
  if (v == null) return '—';
  if (unit === 'КБ/с') return v >= 1024 ? `${(v / 1024).toFixed(1)} МБ/с` : `${Math.round(v)} КБ/с`;
  return `${v}${unit === '%' ? '%' : unit === '°C' ? '°C' : unit === 'ГБ' ? ' ГБ' : ''}`;
}

function MiniSpark({ points, metric, color }: { points: GlancesPoint[]; metric: string; color: string }) {
  const view = points.slice(-40);
  const nums = view.map((p) => getVal(p, metric)).filter((v): v is number => v != null);
  if (nums.length < 2) return <div className="h-[26px] w-full rounded border border-dashed border-line/70" />;
  const W = 140, H = 26;
  const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
  const vals = view.map((p) => getVal(p, metric));
  const d = vals
    .map((v, i) => (v == null ? null : `${i === 0 || vals[i - 1] == null ? 'M' : 'L'}${((i / (view.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 5)).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[26px] w-full" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BigChart({ points, metric, unit, color }: { points: GlancesPoint[]; metric: string; unit: string; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900, H = 220, PL = 46, PR = 12, PT = 14, PB = 26;
  const nums = points.map((p) => getVal(p, metric)).filter((v): v is number => v != null);

  if (points.length < 2 || !nums.length) {
    return <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-line bg-raised/20 font-mono text-[12px] text-dim">недостаточно данных</div>;
  }

  const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
  const t0 = points[0].t, t1 = points[points.length - 1].t, tSpan = t1 - t0 || 1;
  const x = (t: number) => PL + ((t - t0) / tSpan) * (W - PL - PR);
  const y = (v: number) => H - PB - ((v - min) / span) * (H - PT - PB);
  const vals = points.map((p) => getVal(p, metric));
  const path = vals
    .map((v, i) => (v == null ? null : `${i === 0 || vals[i - 1] == null ? 'M' : 'L'}${x(points[i].t).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
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
          points.forEach((p, i) => { const d = Math.abs(x(p.t) - px); if (d < bestD) { bestD = d; best = i; } });
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[min, min + span / 2, max].map((v, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#242b4a" strokeWidth="1" strokeDasharray="4 6" />
            <text x={PL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#8b93b8" fontFamily="JetBrains Mono">{v >= 100 ? Math.round(v) : v.toFixed(1)}</text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={x(t0 + f * tSpan)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#8b93b8" fontFamily="JetBrains Mono">
            {new Date(t0 + f * tSpan).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </text>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hoverPt && hoverVal != null && (
          <g>
            <line x1={x(hoverPt.t)} x2={x(hoverPt.t)} y1={PT} y2={H - PB} stroke="#8b93b8" strokeWidth="1" opacity="0.4" />
            <circle cx={x(hoverPt.t)} cy={y(hoverVal)} r="4" fill={color} stroke="#0b0e1a" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hoverPt && (
        <div className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-panel/95 px-3 py-2 shadow-xl"
          style={{ left: `${(x(hoverPt.t) / W) * 100}%`, transform: x(hoverPt.t) > W * 0.65 ? 'translateX(-105%)' : 'translateX(8px)' }}>
          <div className="font-mono text-[10px] text-dim">{fmtDate(hoverPt.t)}</div>
          <div className="mt-0.5 font-mono text-[13px] font-bold" style={{ color }}>{fmtVal(hoverVal, unit)}</div>
        </div>
      )}
    </div>
  );
}

function AddGlancesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) { setName(''); setUrl(''); setLink(''); setErr(''); }
  }, [open]);

  const submit = async () => {
    setErr('');
    if (!name.trim()) return setErr('Укажите имя сервера');
    if (!/^https?:\/\//i.test(url.trim())) return setErr('Адрес мониторинга должен начинаться с http:// (обычно http://<IP>:61208)');
    if (link.trim() && !/^https?:\/\//i.test(link.trim())) return setErr('Ссылка на сервер должна начинаться с http:// или https://');
    const res = store.addGlancesDevice({ name: name.trim(), url: url.trim(), serverLink: link.trim() });
    if (res) return setErr(res);
    useToasts.push('ok', `«${name.trim()}» добавлен — первый опрос уже идёт`);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Новое устройство Glances">
      <div className="space-y-4">
        <Field label="Имя">
          <input className="inp" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="Rocky-DB" />
        </Field>
        <Field label="Адрес мониторинга" hint="Glances (glances -w, порт 61208). Ядро берёт JSON из REST API /api/4 и /api/3 — CPU, MEM, сеть, температуру Package; разбор HTML — запасной.">
          <input className="inp font-mono" value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} placeholder="http://192.168.1.20:61208/" />
        </Field>
        <Field label="Ссылка на физ. сервер" hint="Будет кликабельной в карточке — например, SSH-консоль, iDRAC или страница управления.">
          <input className="inp font-mono" value={link} onChange={(e) => { setLink(e.target.value); setErr(''); }} placeholder="https://rocky-db.local/" />
        </Field>

        {err && <p className="rounded-lg border border-crit/35 bg-crit/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-crit">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-acc" onClick={submit}><Plus className="h-4 w-4" /> Добавить</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Bars() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const glances = usePluto((s) => visibleGlances(s, user));
  const routeParam = usePluto((s) => s.routeParam);

  const [addOpen, setAddOpen] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [range, setRange] = useState<GlancesRange>('3h');
  const [metric, setMetric] = useState('cpu');
  const [points, setPoints] = useState<GlancesPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const sel = glances.find((g) => g.id === selId) ?? null;

  useEffect(() => {
    if (routeParam) {
      const g = glances.find((x) => x.name === routeParam || x.id === routeParam);
      if (g) setSelId(g.id);
      store.nav('bars');
    } else if (!selId && glances.length) {
      setSelId(glances[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParam, glances.length]);

  // загрузка архива выбранного устройства
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const r = await api.glancesHistory(sel.id, range);
        if (alive) setPoints(r.points || []);
      } catch {
        if (alive) setPoints([]);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const fast = range === '5m' || range === '30m' || range === '3h';
    const t = window.setInterval(() => void load(), fast ? 10000 : 60000);
    return () => { alive = false; window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.id, range]);

  const field = GLANCES_FIELDS.find((f) => f.k === metric) ?? GLANCES_FIELDS[0];
  const stats = useMemo(() => {
    const nums = points.map((p) => getVal(p, String(field.k))).filter((v): v is number => v != null);
    if (!nums.length) return null;
    return { min: Math.min(...nums), max: Math.max(...nums), avg: nums.reduce((s, v) => s + v, 0) / nums.length, n: nums.length };
  }, [points, field]);

  const exportCsv = () => {
    if (!sel || !points.length) return;
    const rows = [
      ['time', ...GLANCES_FIELDS.map((f) => String(f.k))].join(';'),
      ...points.map((p) => [new Date(p.t).toISOString(), ...GLANCES_FIELDS.map((f) => { const v = getVal(p, String(f.k)); return v != null ? String(v) : ''; })].join(';')),
    ].join('\n');
    const blob = new Blob(['\uFEFF' + rows], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pluto-bars-${sel.name}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Устройства Glances"
        icon={<BarChart3 className="h-4 w-4" />}
        right={isAdmin ? (
          <button className="btn-acc" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Добавить устройство
          </button>
        ) : undefined}
        bodyClass="p-4"
      >
        {glances.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" />}
            title="Glances-устройств пока нет"
            text="Добавьте сервер с запущенным Glances (glances -w): укажите имя, адрес мониторинга и ссылку на физический сервер. Показания хранятся 30 дней с автоочисткой."
            action={isAdmin ? <button className="btn-acc" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Добавить первое устройство</button> : undefined}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {glances.map((g: GlancesDevice) => {
              const l = g.latest;
              return (
                <div key={g.id}
                  className={cls('group cursor-pointer rounded-xl border bg-panel/90 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-16px_rgba(0,0,0,.7)]', selId === g.id ? 'border-blu/50' : 'border-line hover:border-blu/40')}
                  onClick={() => setSelId(g.id)}
                >
                  <div className="flex items-center gap-2">
                    <StatusDot status={g.online ? 'up' : 'down'} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-ink">{g.name}</div>
                      <div className="truncate font-mono text-[10.5px] text-dim">{g.url}</div>
                    </div>
                    {g.serverLink && (
                      <a href={g.serverLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                        className="rounded-md border border-line bg-raised/60 p-1.5 text-dim transition-colors hover:border-blu/50 hover:text-blu" title="Открыть ссылку на физ. сервер">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {isAdmin && (
                      <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Удалить «${g.name}» и всю историю?`)) { store.removeGlancesDevice(g.id); if (selId === g.id) setSelId(null); } }}
                        className="rounded-md p-1.5 text-dim opacity-0 transition-all hover:text-crit group-hover:opacity-100">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
                    {[
                      { v: l?.cpu != null ? `${l.cpu}%` : '—', t: 'CPU', c: 'text-vio' },
                      { v: l?.mem != null ? `${l.mem}%` : '—', t: 'MEM', c: 'text-blu' },
                      { v: l?.pkg != null ? `${l.pkg}°` : '—', t: 'Pkg °C', c: 'text-warn' },
                      { v: l?.rx != null ? (l.rx >= 1024 ? `${(l.rx / 1024).toFixed(1)}M` : `${Math.round(l.rx)}K`) : '—', t: 'Rx/s', c: 'text-mint' },
                    ].map((x) => (
                      <div key={x.t} className="rounded-md border border-line/60 bg-raised/30 px-1 py-1.5">
                        <div className={cls('font-mono text-[12px] font-bold tabular-nums', x.c)}>{x.v}</div>
                        <div className="text-[8px] font-bold uppercase tracking-wider text-dim">{x.t}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2.5">
                    <MiniSpark points={(g.history || []).length ? (g.history as GlancesPoint[]) : (l ? [{ ...l } as GlancesPoint] : [])} metric="cpu" color="#7ba4e6" />
                  </div>

                  <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-dim">
                    <span>опрос: {g.lastScrape ? <TimeAgo ts={g.lastScrape} /> : 'ещё не было'}</span>
                    <span className={g.online ? 'text-ok' : 'text-crit'}>{g.online ? 'доступен' : (g.lastError || 'недоступен')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {sel && (
        <Panel
          title={`Архив показаний · ${sel.name} · 30 дней`}
          icon={<BarChart3 className="h-4 w-4" />}
          right={
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button className="btn-ghost !py-1" onClick={() => store.scrapeGlancesNow(sel.id)}>
                  <RefreshCw className={cls('h-3.5 w-3.5', loading && 'animate-spin')} /> Опросить сейчас
                </button>
              )}
              <button className="btn-ghost !py-1" onClick={exportCsv} disabled={!points.length}>
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
            </div>
          }
          bodyClass="p-4"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1">
                {GLANCES_RANGES.map((r) => (
                  <button key={r.v} onClick={() => setRange(r.v)}
                    className={cls('rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-all', range === r.v ? 'border-blu/50 bg-blu/15 text-ink' : 'border-line bg-raised/40 text-dim hover:text-mut')}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {GLANCES_FIELDS.map((f, i) => (
                <button key={String(f.k)} onClick={() => setMetric(String(f.k))}
                  className={cls('rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all', metric === f.k ? 'text-ink' : 'border-line bg-raised/40 text-dim hover:text-mut')}
                  style={metric === f.k ? { borderColor: LINE_COLORS[i % LINE_COLORS.length], background: `${LINE_COLORS[i % LINE_COLORS.length]}22` } : undefined}>
                  {f.label}{f.unit !== 'с' ? ` ${f.unit}` : ''}
                </button>
              ))}
            </div>

            <BigChart points={points} metric={String(field.k)} unit={field.unit} color="#7ba4e6" />

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { l: 'Точек', v: stats ? String(stats.n) : '—' },
                { l: 'Минимум', v: stats ? fmtVal(Math.round(stats.min * 10) / 10, field.unit) : '—' },
                { l: 'Среднее', v: stats ? fmtVal(Math.round(stats.avg * 10) / 10, field.unit) : '—' },
                { l: 'Максимум', v: stats ? fmtVal(Math.round(stats.max * 10) / 10, field.unit) : '—' },
                { l: 'Последняя', v: points.length ? fmtDate(points[points.length - 1].t) : '—' },
              ].map((s) => (
                <div key={s.l} className="rounded-lg border border-line bg-raised/30 px-3 py-2.5">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-dim">{s.l}</div>
                  <div className="mt-1 truncate font-mono text-[13px] font-bold text-ink">{s.v}</div>
                </div>
              ))}
            </div>

            {sel.lastError && (
              <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] font-semibold text-warn">{sel.lastError}</p>
            )}
          </div>
        </Panel>
      )}

      <AddGlancesModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
