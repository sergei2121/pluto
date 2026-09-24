// ─── PLUTO: история пингов — месячный журнал онлайн/офлайн устройств ────────
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { History, Wifi, WifiOff, RefreshCw, Search, CalendarDays, ArrowDownCircle, ArrowUpCircle, Download, ChevronDown, ChevronRight, Server } from 'lucide-react';
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
  // раскрытые хабы в списке устройств (по умолчанию — все свёрнуты)
  const [openHubs, setOpenHubs] = useState<Set<string>>(new Set());
  const toggleHub = (name: string) => {
    setOpenHubs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };
  // раскрытые диапазоны (цели) внутри хабов — ключ «хаб|диапазон»
  const [openRanges, setOpenRanges] = useState<Set<string>>(new Set());
  const toggleRange = (key: string) => {
    setOpenRanges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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

  // список устройств с группировкой по агентам (хабам) и диапазонам внутри хабов
  const grouped = useMemo(() => {
    const byAgent = new Map<string, Map<string, PingHistoryDevice[]>>();
    for (const d of devices) {
      if (!byAgent.has(d.agentName)) byAgent.set(d.agentName, new Map());
      const ranges = byAgent.get(d.agentName)!;
      const rk = d.range || d.target;
      if (!ranges.has(rk)) ranges.set(rk, []);
      ranges.get(rk)!.push(d);
    }
    return [...byAgent.entries()]
      .map(([agentName, ranges]) => ({
        agentName,
        list: [...ranges.values()].flat(),
        ranges: [...ranges.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      }))
      .sort((a, b) => a.agentName.localeCompare(b.agentName));
  }, [devices]);

  // при поиске автоматически раскрываем хабы, в которых есть совпадения;
  // по умолчанию все хабы свёрнуты, раскрыт только выбранный вручную хаб или хаб выбранного устройства
  const searchActive = !!q.trim();
  const needle = q.trim().toLowerCase();
  const devMatches = (d: PingHistoryDevice) =>
    d.ip.toLowerCase().includes(needle) || d.target.toLowerCase().includes(needle);
  const hubOpen = (name: string, list: PingHistoryDevice[]) => {
    if (searchActive) return list.some(devMatches);
    if (sel && list.some((d) => devKey(d) === sel)) return true;
    return openHubs.has(name);
  };
  // диапазон внутри хабa: при поиске раскрываем только совпавшие;selected-устройство тоже раскрывает свой диапазон
  const rangeOpen = (hubName: string, rangeKey: string, list: PingHistoryDevice[]) => {
    if (searchActive) return list.some(devMatches);
    if (sel && list.some((d) => devKey(d) === sel)) return true;
    return openRanges.has(`${hubName}|${rangeKey}`);
  };

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

  // лента событий: внутри дня группируем по хабам, хабы сворачиваются по клику
  const dayHubs = useMemo(() => {
    return eventsByDay.map(([dateStr, list]) => {
      const byHub = new Map<string, PingHistoryEvent[]>();
      for (const e of list) {
        if (!byHub.has(e.agentName)) byHub.set(e.agentName, []);
        byHub.get(e.agentName)!.push(e);
      }
      const hubs = [...byHub.entries()]
        .map(([agentName, evs]) => ({ agentName, evs, downs: evs.filter((e) => !e.up).length }))
        .sort((a, b) => a.agentName.localeCompare(b.agentName));
      return { dateStr, hubs };
    });
  }, [eventsByDay]);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const toggleDay = (d: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  };
  const [openHubDays, setOpenHubDays] = useState<Set<string>>(new Set());
  const toggleHubDay = (key: string) => {
    setOpenHubDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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
            <div className="max-h-[420px] space-y-2 overflow-y-auto scroll-thin pr-1">
              {grouped.map(({ agentName, list, ranges }) => {
                if (searchActive && !list.some(devMatches)) return null;
                const open = hubOpen(agentName, list);
                const onlineCount = list.filter((d) => d.alive).length;
                return (
                  <div key={agentName}>
                    {/* Заголовок хаба — клик раскрывает/сворачивает список диапазонов и IP */}
                    <button onClick={() => toggleHub(agentName)}
                      className={cls('flex w-full items-center gap-1 rounded-lg border px-1.5 py-2.5 text-left transition-colors',
                        open ? 'border-vio/30 bg-vio/5' : 'border-line/60 bg-raised/30 hover:text-ink')}>
                      {/* Хитбокс стрелки свернуть/развернуть — увеличенная зона клика */}
                      <span role="button" aria-label={open ? 'Свернуть' : 'Развернуть'} title={open ? 'Свернуть' : 'Развернуть'}
                        onClick={(e) => { e.stopPropagation(); toggleHub(agentName); }}
                        className="-my-1 -ml-0.5 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-dim transition-colors hover:bg-vio/15 hover:text-vio">
                        {open
                          ? <ChevronDown className="h-4 w-4" />
                          : <ChevronRight className="h-4 w-4" />}
                      </span>
                      <Server className="h-3 w-3 shrink-0 text-dim" />
                      <span className={cls('min-w-0 flex-1 truncate font-mono text-[10px] font-bold uppercase tracking-wider', open ? 'text-vio' : 'text-dim')}>
                        {agentName}
                      </span>
                      <span className="shrink-0 font-mono text-[9.5px] text-dim">{onlineCount}/{list.length}</span>
                    </button>
                    {open && (
                      <div className="mt-1 space-y-1 border-l border-line/50 pl-2">
                        {ranges.map(([rangeKey, rlist]) => {
                          const visible = rlist.filter((d) => !searchActive || devMatches(d));
                          if (searchActive && visible.length === 0) return null;
                          const rOpen = rangeOpen(agentName, rangeKey, rlist);
                          const rOnline = rlist.filter((d) => d.alive).length;
                          const rTarget = rlist[0]?.target || '';
                          const rKey = `${agentName}|${rangeKey}`;
                          return (
                            <div key={rKey}>
                              {/* Заголовок диапазона (цели) — клик раскрывает список IP */}
                              <button onClick={() => toggleRange(rKey)}
                                className={cls('flex w-full items-center gap-1 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-raised/50',
                                  rOpen ? 'text-ink' : 'text-mut')}>
                                {/* Хитбокс стрелки свернуть/развернуть — увеличенная зона клика */}
                                <span role="button" aria-label={rOpen ? 'Свернуть' : 'Развернуть'} title={rOpen ? 'Свернуть' : 'Развернуть'}
                                  onClick={(e) => { e.stopPropagation(); toggleRange(rKey); }}
                                  className="-my-0.5 -ml-0.5 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-vio/15 hover:text-vio">
                                  {rOpen
                                    ? <ChevronDown className="h-4 w-4 text-mut" />
                                    : <ChevronRight className="h-4 w-4 text-dim" />}
                                </span>
                                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-mut">{rangeKey}</span>
                                {rTarget && rTarget !== rangeKey && <span className="hidden max-w-[80px] truncate text-[9px] text-dim lg:inline">{rTarget}</span>}
                                <span className="shrink-0 font-mono text-[9px] text-dim">{rOnline}/{rlist.length}</span>
                              </button>
                              {rOpen && (
                                <div className="ml-3 mt-0.5 space-y-1 border-l border-line/40 pl-2">
                                  {visible.map((d) => (
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
                                  {visible.length === 0 && <p className="px-2 py-1 text-[10.5px] text-dim">Ничего не найдено.</p>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
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
                      {grouped.map(({ agentName, list }) => {
                        const rows = list
                          .filter((d) => !selDev || devKey(d) === devKey(selDev))
                          .filter((d) => !searchActive || devMatches(d))
                          .slice(0, 60);
                        if (rows.length === 0) return null;
                        return (
                          <Fragment key={agentName}>
                            {/* Строка-заголовок хаба */}
                            <tr>
                              <td colSpan={monthDates.length + 1} className="sticky left-0 px-2 pt-2 pb-0.5">
                                <span className="inline-flex items-center gap-1 font-mono text-[9.5px] font-bold uppercase tracking-wider text-vio/80">
                                  <Server className="h-3 w-3" />{agentName}
                                </span>
                              </td>
                            </tr>
                            {rows.map((d) => {
                              const byDate = dailyByKey.get(devKey(d));
                              return (
                                <tr key={devKey(d)}>
                                  <td className="sticky left-0 whitespace-nowrap bg-panel/95 px-2 py-1 pl-5 font-mono text-[10.5px] text-ink">
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
                          </Fragment>
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
                  {dayHubs.map(({ dateStr, hubs }) => {
                    const dayTotal = hubs.reduce((n, h) => n + h.evs.length, 0);
                    // по умолчанию раскрыт только первый (самый свежий) день; при поиске — все дни с совпадениями
                    const dayOpen = searchActive || openDays.has(dateStr) || (!openDays.size && dateStr === dayHubs[0]?.dateStr);
                    return (
                      <div key={dateStr}>
                        <button onClick={() => toggleDay(dateStr)}
                          className="mb-1 flex w-full items-center gap-1 rounded-md py-1.5 pl-1 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-dim transition-colors hover:text-ink">
                          {/* Хитбокс стрелки свернуть/развернуть — увеличенная зона клика */}
                          <span role="button" aria-label={dayOpen ? 'Свернуть' : 'Развернуть'} title={dayOpen ? 'Свернуть' : 'Развернуть'}
                            onClick={(e) => { e.stopPropagation(); toggleDay(dateStr); }}
                            className="-my-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-vio/15 hover:text-vio">
                            {dayOpen
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />}
                          </span>
                          {fmtDate(dateStr)}
                          <span className="font-normal normal-case text-dim/70">· {dayTotal} событ.</span>
                        </button>
                        {dayOpen && (
                          <div className="space-y-1.5 border-l border-line/50 pl-2">
                            {hubs.map(({ agentName, evs, downs }) => {
                              const hdKey = `${dateStr}|${agentName}`;
                              const hdOpen = searchActive || sel !== '' || openHubDays.has(hdKey);
                              return (
                                <div key={hdKey}>
                                  {/* Заголовок хаба в ленте — клик раскрывает события этого хаба */}
                                  <button onClick={() => toggleHubDay(hdKey)}
                                    className={cls('flex w-full items-center gap-1 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-raised/50',
                                      hdOpen ? 'text-vio' : 'text-dim')}>
                                    {/* Хитбокс стрелки свернуть/развернуть — увеличенная зона клика */}
                                    <span role="button" aria-label={hdOpen ? 'Свернуть' : 'Развернуть'} title={hdOpen ? 'Свернуть' : 'Развернуть'}
                                      onClick={(e) => { e.stopPropagation(); toggleHubDay(hdKey); }}
                                      className="-my-0.5 -ml-0.5 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-vio/15 hover:text-vio">
                                      {hdOpen
                                        ? <ChevronDown className="h-4 w-4" />
                                        : <ChevronRight className="h-4 w-4" />}
                                    </span>
                                    <Server className="h-3 w-3 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-bold uppercase tracking-wider">{agentName}</span>
                                    {downs > 0 && <span className="shrink-0 rounded bg-crit/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-crit">↓{downs}</span>}
                                    <span className="shrink-0 font-mono text-[9px] text-dim">{evs.length}</span>
                                  </button>
                                  {hdOpen && (
                                    <div className="ml-4 mt-0.5 space-y-1 border-l border-line/40 pl-2">
                                      {evs.map((e) => (
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
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
