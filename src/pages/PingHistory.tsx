// ─── PLUTO: история пингов — месячный журнал онлайн/офлайн устройств ────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Wifi, WifiOff, RefreshCw, Search, CalendarDays, ArrowDownCircle, ArrowUpCircle, Download } from 'lucide-react';
import { Panel, EmptyState, Seg } from '../components/ui';
import { api } from '../lib/api';
import { cls } from '../lib/util';
import { useToasts } from '../lib/store';
import type { PingHistoryDevice, PingHistoryEvent, PingDailyRecord } from '../lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO-дата YYYY-MM-DD в локальном часовом поясе. */
function localDateStr(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Экспорт CSV: ячейки кавычкуются и экранируются, разделитель «;» (Excel/RU). */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, head: string[], rows: unknown[][]): void {
  const content = '\uFEFF' + [head.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))].join('\r\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Ключ устройства в истории: agentId|range|ip */
const devKey = (d: { agentId: string; range: string; ip: string }) => `${d.agentId}|${d.range}|${d.ip}`;

function fmtDateTime(ts: number): string {
  try {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return '—'; }
}

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return '0м';
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}д ${h % 24}ч`;
  if (h > 0) return `${h}ч ${min % 60}м`;
  return `${min}м`;
}

function fmtDate(iso: string): string {
  const [y, m, dd] = iso.split('-');
  return `${dd}.${m}.${y}`;
}

function uptimeColor(pct: number): string {
  if (pct >= 99.5) return 'text-ok';
  if (pct >= 97) return 'text-warn';
  return 'text-crit';
}

function uptimeBar(pct: number): string {
  if (pct >= 99.5) return 'bg-ok';
  if (pct >= 97) return 'bg-warn';
  return 'bg-crit';
}

export default function PingHistoryPage() {
  const [devices, setDevices] = useState<PingHistoryDevice[]>([]);
  const [events, setEvents] = useState<PingHistoryEvent[]>([]);
  const [daily, setDaily] = useState<PingDailyRecord[]>([]);
  const [days, setDays] = useState<'7' | '30'>('30');
  const [sel, setSel] = useState<string>(''); // выбранный ключ устройства ('' — все)
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastLoad, setLastLoad] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const dv = await api.pingHistoryDevices();
      setDevices(dv.devices);
      const selDev = sel ? dv.devices.find((d) => devKey(d) === sel) : undefined;
      const hist = await api.pingHistory({
        days: Number(days),
        agentId: selDev?.agentId,
        range: selDev ? selDev.range : undefined,
        ip: selDev?.ip,
      });
      setEvents(hist.events);
      setDaily(hist.daily);
      setLastLoad(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить историю');
    } finally {
      setLoading(false);
    }
  }, [days, sel]);

  useEffect(() => { void load(); }, [load]);
  // автообновление раз в минуту
  useEffect(() => {
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  // список устройств с группировкой по агентам
  const grouped = useMemo(() => {
    const byAgent = new Map<string, PingHistoryDevice[]>();
    for (const d of devices) {
      if (!byAgent.has(d.agentName)) byAgent.set(d.agentName, []);
      byAgent.get(d.agentName)!.push(d);
    }
    return [...byAgent.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [devices]);

  const filteredEvents = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return events;
    return events.filter((e) => e.ip.toLowerCase().includes(needle) || e.target.toLowerCase().includes(needle) || e.agentName.toLowerCase().includes(needle));
  }, [events, q]);

  // события по дням (для ленты)
  const eventsByDay = useMemo(() => {
    const map = new Map<string, PingHistoryEvent[]>();
    for (const e of filteredEvents) {
      const key = new Date(e.ts).toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filteredEvents]);

  // суточная доступность по устройствам (тепловая сетка дней)
  const dailyByKey = useMemo(() => {
    const map = new Map<string, Map<string, PingDailyRecord>>();
    for (const d of daily) {
      if (!map.has(d.key)) map.set(d.key, new Map());
      map.get(d.key)!.set(d.date, d);
    }
    return map;
  }, [daily]);

  const monthDates = useMemo(() => {
    const out: string[] = [];
    const n = Number(days);
    for (let i = n - 1; i >= 0; i--) {
      const t = Date.now() - i * DAY_MS;
      out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
  }, [days]);

  const selDev = sel ? devices.find((d) => devKey(d) === sel) : undefined;
  const summary = useMemo(() => {
    const down = filteredEvents.filter((e) => !e.up).length;
    const up = filteredEvents.filter((e) => e.up).length;
    return { down, up };
  }, [filteredEvents]);

  // ─── экспорт CSV: все входящие данные с учётом текущих фильтров ───────────
  const [exporting, setExporting] = useState(false);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      // при выбранном устройстве данные уже загружены; иначе тянем историю по всем
      let evs = filteredEvents;
      let dailies = daily;
      if (!sel) {
        const hist = await api.pingHistory({ days: Number(days) });
        evs = hist.events;
        dailies = hist.daily;
      }
      const period = `${localDateStr(Date.now() - Number(days) * DAY_MS)}..${localDateStr(Date.now())}`;
      const rows: unknown[][] = [];

      // 1) события смены состояния (журнал онлайн/офлайн)
      for (const e of [...evs].sort((a, b) => a.ts - b.ts)) {
        rows.push(['event', '', e.ts, fmtDateTime(e.ts), e.agentName, e.range, e.target, e.ip, e.up ? 'online' : 'offline', '', '', '']);
      }

      // 2) суточные агрегаты доступности
      for (const d of [...dailies].sort((a, b) => (a.date < b.date ? -1 : 1))) {
        rows.push(['daily', d.date, '', '', d.agentName, '', d.target, d.ip, '', d.uptimePct, d.uptimeMs, d.downCount]);
      }

      // 3) текущее состояние устройств (для выбранных диапазонов дат)
      for (const dv of devices) {
        if (sel && devKey(dv) !== sel) continue;
        const needle = q.trim().toLowerCase();
        if (needle && !dv.ip.toLowerCase().includes(needle) && !dv.target.toLowerCase().includes(needle) && !dv.agentName.toLowerCase().includes(needle)) continue;
        rows.push(['device', '', Date.now(), '', dv.agentName, dv.range, dv.target, dv.ip, dv.alive ? 'online' : 'offline', '', dv.latency ?? '', dv.offlineSince ?? '']);
      }

      const head = ['type', 'date', 'timestamp', 'datetime', 'agent', 'range', 'target', 'ip', 'state', 'uptime_pct', 'value_ms', 'down_count'];
      downloadCsv(`pluto-ping-history-${period.replace('..', '_')}.csv`, head, rows);
      useToasts.push('ok', `CSV-отчёт сформирован: ${rows.length} строк`);
    } catch (e) {
      useToasts.push('crit', e instanceof Error ? `Ошибка экспорта: ${e.message}` : 'Не удалось сформировать CSV-отчёт');
    } finally {
      setExporting(false);
    }
  }, [daily, days, devices, filteredEvents, q, sel]);

  return (
    <div className="space-y-4">
      {/* Панель фильтров */}
      <Panel title="История активности · месяц" icon={<History className="h-4 w-4 text-vio" />} delay={0}
        right={
          <div className="flex items-center gap-2">
            <Seg options={[{ v: '7', label: '7 дней' }, { v: '30', label: '30 дней' }]} value={days} onChange={(v) => { setDays(v as '7' | '30'); setSel(''); }} />
            <button onClick={() => void exportCsv()} disabled={exporting} title="Скачать CSV-отчёт со всеми данными (события, суточная доступность, текущее состояние)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raised/50 px-3 py-1.5 text-[12px] font-bold text-mut transition-all hover:border-vio/50 hover:text-ink disabled:opacity-50">
              <Download className={cls('h-3.5 w-3.5', exporting && 'animate-pulse')} /> CSV
            </button>
            <button onClick={() => void load()} title="Обновить" className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-vio">
              <RefreshCw className={cls('h-4 w-4', loading && 'animate-spin')} />
            </button>
          </div>
        }>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          {/* Список устройств */}
          <div className="w-full shrink-0 space-y-2 lg:w-72">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск IP / цели…"
                className="w-full rounded-lg border border-line bg-raised/50 py-1.5 pl-8 pr-2 font-mono text-[11.5px] text-ink outline-none transition-colors placeholder:text-dim/60 focus:border-vio/50" />
            </div>
            <button onClick={() => setSel('')}
              className={cls('w-full rounded-lg border px-3 py-2 text-left text-[12px] font-semibold transition-colors',
                !sel ? 'border-vio/50 bg-vio/10 text-ink' : 'border-line/60 bg-raised/30 text-mut hover:text-ink')}>
              Все устройства
              <span className="ml-2 font-mono text-[10px] text-dim">{devices.length}</span>
            </button>
            <div className="max-h-[420px] space-y-3 overflow-y-auto scroll-thin pr-1">
              {grouped.map(([agentName, list]) => (
                <div key={agentName}>
                  <div className="mb-1 px-1 font-mono text-[9.5px] font-bold uppercase tracking-wider text-dim">{agentName}</div>
                  <div className="space-y-1">
                    {list
                      .filter((d) => !q.trim() || d.ip.toLowerCase().includes(q.trim().toLowerCase()) || d.target.toLowerCase().includes(q.trim().toLowerCase()))
                      .map((d) => (
                        <button key={devKey(d)} onClick={() => setSel(devKey(d) === sel ? '' : devKey(d))}
                          className={cls('flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
                            sel === devKey(d) ? 'border-vio/50 bg-vio/10' : 'border-transparent hover:bg-raised/50')}>
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-[11.5px] text-ink">{d.ip}</span>
                            <span className="block truncate text-[9.5px] text-dim">{d.target}</span>
                          </span>
                          {d.alive
                            ? <Wifi className="h-3.5 w-3.5 shrink-0 text-ok" />
                            : <WifiOff className="h-3.5 w-3.5 shrink-0 text-crit" />}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
              {devices.length === 0 && <p className="px-1 text-[11px] text-dim">Нет пингуемых устройств. Добавьте цели в «Хабы → Изменить».</p>}
            </div>
          </div>

          {/* Основная область */}
          <div className="min-w-0 flex-1 space-y-4">
            {err && <div className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit">{err}</div>}

            {/* Тепловая карта доступности по дням */}
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-dim">
                <CalendarDays className="h-3.5 w-3.5" />
                Доступность по дням {selDev ? `· ${selDev.ip}` : '(все устройства)'}
              </div>
              <div className="overflow-x-auto scroll-thin rounded-lg border border-line/60 bg-raised/30 p-3">
                {devices.length === 0 ? (
                  <p className="text-[11.5px] text-dim">Нет данных.</p>
                ) : (
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr>
                        <th className="sticky left-0 bg-raised/30 px-2 py-1 text-left font-mono text-[9.5px] uppercase tracking-wider text-dim">Устройство</th>
                        {monthDates.map((dt) => (
                          <th key={dt} className="px-0.5 py-1 text-center font-mono text-[8.5px] text-dim" title={fmtDate(dt)}>
                            {dt.slice(8, 10)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {devices
                        .filter((d) => !selDev || devKey(d) === devKey(selDev))
                        .filter((d) => !q.trim() || d.ip.toLowerCase().includes(q.trim().toLowerCase()) || d.target.toLowerCase().includes(q.trim().toLowerCase()))
                        .slice(0, 60)
                        .map((d) => {
                          const byDate = dailyByKey.get(devKey(d));
                          return (
                            <tr key={devKey(d)}>
                              <td className="sticky left-0 whitespace-nowrap bg-panel/95 px-2 py-1 font-mono text-[10.5px] text-ink">
                                {d.ip}<span className="ml-1 text-[9px] text-dim">{d.target}</span>
                              </td>
                              {monthDates.map((dt) => {
                                const rec = byDate?.get(dt);
                                const pct = rec?.uptimePct ?? null;
                                return (
                                  <td key={dt} className="px-0.5 py-0.5">
                                    <div
                                      title={`${fmtDate(dt)} · ${pct != null ? pct + '%' : 'нет данных'}${rec ? ` · отключений: ${rec.downCount}` : ''}`}
                                      className={cls('h-4 w-full min-w-[10px] rounded-[3px]',
                                        pct == null ? 'bg-line/40' : pct >= 99.5 ? 'bg-ok/70' : pct >= 97 ? 'bg-warn/70' : pct > 0 ? 'bg-crit/70' : 'bg-crit')}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                )}
                <div className="mt-2 flex items-center gap-4 text-[9.5px] text-dim">
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[2px] bg-ok/70" /> ≥99.5%</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[2px] bg-warn/70" /> ≥97%</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[2px] bg-crit/70" /> &lt;97%</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[2px] bg-line/40" /> нет данных</span>
                </div>
              </div>
            </div>

            {/* Сводка по выбранному устройству */}
            {selDev && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(() => {
                  const recs = [...(dailyByKey.get(devKey(selDev))?.values() || [])];
                  const avg = recs.length ? Math.round((recs.reduce((s, r) => s + r.uptimePct, 0) / recs.length) * 10) / 10 : null;
                  const downs = recs.reduce((s, r) => s + r.downCount, 0);
                  const offlineMs = recs.reduce((s, r) => s + (DAY_MS - r.uptimeMs), 0);
                  return (
                    <>
                      <div className="rounded-lg border border-line/60 bg-raised/40 p-3 text-center">
                        <div className={cls('font-mono text-[18px] font-bold', avg == null ? 'text-dim' : uptimeColor(avg))}>{avg != null ? `${avg}%` : '—'}</div>
                        <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">ср. доступность</div>
                      </div>
                      <div className="rounded-lg border border-line/60 bg-raised/40 p-3 text-center">
                        <div className="font-mono text-[18px] font-bold text-crit">{downs}</div>
                        <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">отключений</div>
                      </div>
                      <div className="rounded-lg border border-line/60 bg-raised/40 p-3 text-center">
                        <div className="font-mono text-[18px] font-bold text-ink">{fmtDuration(offlineMs)}</div>
                        <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">всего офлайн</div>
                      </div>
                      <div className="rounded-lg border border-line/60 bg-raised/40 p-3 text-center">
                        <div className={cls('font-mono text-[18px] font-bold', selDev.alive ? 'text-ok' : 'text-crit')}>{selDev.alive ? 'онлайн' : 'офлайн'}</div>
                        <div className="text-[8.5px] font-bold uppercase tracking-wider text-dim">сейчас</div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Лента событий */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wider text-dim">
                  Журнал событий · {summary.down} ↓ / {summary.up} ↑
                </div>
                {lastLoad > 0 && <span className="font-mono text-[9.5px] text-dim">обновлено {fmtDateTime(lastLoad)}</span>}
              </div>
              {eventsByDay.length === 0 ? (
                <EmptyState icon={<History className="h-6 w-6" />} title="Событий нет"
                  text={`За последние ${days} дней изменений состояния не зафиксировано — все устройства стабильны.`} />
              ) : (
                <div className="max-h-[400px] space-y-3 overflow-y-auto scroll-thin pr-1">
                  {eventsByDay.map(([dateStr, list]) => (
                    <div key={dateStr}>
                      <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-dim">{fmtDate(dateStr)}</div>
                      <div className="space-y-1">
                        {list.map((e) => (
                          <div key={e.id} className="flex items-center gap-2.5 rounded-md border border-line/40 bg-raised/30 px-3 py-1.5">
                            {e.up
                              ? <ArrowUpCircle className="h-3.5 w-3.5 shrink-0 text-ok" />
                              : <ArrowDownCircle className="h-3.5 w-3.5 shrink-0 text-crit" />}
                            <span className="font-mono text-[11.5px] font-semibold text-ink">{e.ip}</span>
                            <span className="truncate text-[10.5px] text-mut">{e.target}</span>
                            <span className="hidden truncate text-[10px] text-dim sm:inline">{e.agentName}</span>
                            <span className="ml-auto shrink-0 font-mono text-[10px] text-dim">
                              {new Date(e.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span className={cls('shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase', e.up ? 'bg-ok/15 text-ok' : 'bg-crit/15 text-crit')}>
                              {e.up ? 'онлайн' : 'офлайн'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Таблица по дням для выбранного устройства */}
            {selDev && (
              <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-dim">Помесячно · {selDev.ip}</div>
                <div className="overflow-hidden rounded-lg border border-line/60">
                  <table className="w-full border-collapse text-[11.5px]">
                    <thead>
                      <tr className="bg-raised/50 text-left font-mono text-[9.5px] uppercase tracking-wider text-dim">
                        <th className="px-3 py-2">Дата</th>
                        <th className="px-3 py-2">Доступность</th>
                        <th className="px-3 py-2">Онлайн</th>
                        <th className="px-3 py-2">Офлайн</th>
                        <th className="px-3 py-2">Отключений</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(dailyByKey.get(devKey(selDev))?.values() || [])]
                        .sort((a, b) => (a.date < b.date ? 1 : -1))
                        .map((r) => (
                          <tr key={r.date} className="border-t border-line/40">
                            <td className="px-3 py-1.5 font-mono text-ink">{fmtDate(r.date)}</td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line/50">
                                  <div className={cls('h-full rounded-full', uptimeBar(r.uptimePct))} style={{ width: `${Math.min(100, r.uptimePct)}%` }} />
                                </div>
                                <span className={cls('font-mono text-[11px] font-bold', uptimeColor(r.uptimePct))}>{r.uptimePct}%</span>
                              </div>
                            </td>
                            <td className="px-3 py-1.5 font-mono text-mut">{fmtDuration(r.uptimeMs)}</td>
                            <td className="px-3 py-1.5 font-mono text-mut">{fmtDuration(DAY_MS - r.uptimeMs)}</td>
                            <td className={cls('px-3 py-1.5 font-mono font-bold', r.downCount ? 'text-crit' : 'text-dim')}>{r.downCount}</td>
                          </tr>
                        ))}
                      {(dailyByKey.get(devKey(selDev))?.size || 0) === 0 && (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-[11px] text-dim">Нет агрегированных данных за период.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
