// ─── PLUTO: SLA-отчёт — доступность устройств за период ─────────────────────
import { useMemo, useState } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import { Panel, STATUS_META, TypeBadge, Seg } from '../components/ui';
import { useCurrentUser, usePluto, visibleDevices } from '../lib/store';
import { cls, fmtMs } from '../lib/util';
import { DEVICE_TYPE_META } from '../lib/types';

interface SlaRowLocal {
  id: string;
  name: string;
  type: string;
  address: string;
  uptimePct: number;
  downCount: number;
  checks: number;
  avgLatency: number | null;
}

function computeSla(history: number[], latency: number | null): { uptimePct: number; downCount: number; checks: number; avgLatency: number | null } {
  const checks = history.length;
  if (!checks) return { uptimePct: 100, downCount: 0, checks: 0, avgLatency: latency };
  const down = history.filter((v) => v < 0).length;
  const ups = history.filter((v) => v >= 0);
  const avg = ups.length ? Math.round(ups.reduce((a, b) => a + b, 0) / ups.length) : null;
  return { uptimePct: Math.round(((checks - down) / checks) * 1000) / 10, downCount: down, checks, avgLatency: avg };
}

function slaColor(pct: number): string {
  if (pct >= 99.5) return '#55c795';
  if (pct >= 97) return '#dfa65e';
  return '#e07a80';
}

export default function Sla() {
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const [days, setDays] = useState<'7' | '30'>('30');

  const rows: SlaRowLocal[] = useMemo(() => {
    // история устройств — скользящее окно последних проверок;
    // ограничиваем выборку пропорционально периоду
    const maxPoints = days === '7' ? 400 : 1500;
    return devices.map((d) => {
      const h = d.history.slice(-maxPoints);
      const s = computeSla(h, d.latency);
      return { id: d.id, name: d.name, type: d.type, address: d.address, ...s };
    }).sort((a, b) => a.uptimePct - b.uptimePct); // худшие сверху
  }, [devices, days]);

  const overall = rows.length
    ? Math.round((rows.reduce((a, r) => a + r.uptimePct, 0) / rows.length) * 100) / 100
    : 100;

  const exportCsv = () => {
    const head = 'name;type;address;uptime_pct;down_count;checks;avg_latency_ms';
    const body = rows.map((r) => [r.name, r.type, r.address, r.uptimePct, r.downCount, r.checks, r.avgLatency ?? ''].join(';'));
    const blob = new Blob(['\uFEFF' + [head, ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pluto-sla-${days}d.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel/90 px-4 py-3">
        <span className="text-vio"><FileBarChart className="h-5 w-5" /></span>
        <div>
          <div className="font-display text-[14px] font-bold text-ink">Доступность за {days} дней</div>
          <div className="text-[10.5px] text-dim">средняя по парку: <span className="font-mono font-bold" style={{ color: slaColor(overall) }}>{overall}%</span> · {rows.length} устройств</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Seg options={[{ v: '7' as const, label: '7 дней' }, { v: '30' as const, label: '30 дней' }]} value={days} onChange={setDays} />
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raised/50 px-3 py-1.5 text-[12px] font-bold text-mut transition-all hover:border-vio/50 hover:text-ink">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      <Panel title={`Устройства · ${rows.length}`} bodyClass="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-dim">Устройств пока нет — добавьте их на странице «Устройства».</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line/60 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">
                  <th className="py-2.5 pl-4 pr-3">Устройство</th>
                  <th className="py-2.5 pr-3">Тип</th>
                  <th className="py-2.5 pr-3 w-[38%]">Доступность</th>
                  <th className="py-2.5 pr-3">Сбои</th>
                  <th className="py-2.5 pr-3">Проверок</th>
                  <th className="py-2.5 pr-4">Ср. задержка</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/30 transition-colors hover:bg-raised/40">
                    <td className="py-2.5 pl-4 pr-3">
                      <div className="text-[13px] font-semibold text-ink">{r.name}</div>
                      <div className="font-mono text-[11px] text-dim">{r.address}</div>
                    </td>
                    <td className="py-2.5 pr-3"><TypeBadge t={r.type} /></td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, r.uptimePct)}%`, background: slaColor(r.uptimePct) }} />
                        </div>
                        <span className="w-14 text-right font-mono text-[12px] font-bold tabular-nums" style={{ color: slaColor(r.uptimePct) }}>{r.uptimePct}%</span>
                      </div>
                    </td>
                    <td className={cls('py-2.5 pr-3 font-mono text-[12.5px] tabular-nums', r.downCount ? 'text-crit' : 'text-dim')}>{r.downCount}</td>
                    <td className="py-2.5 pr-3 font-mono text-[12.5px] tabular-nums text-mut">{r.checks}</td>
                    <td className="py-2.5 pr-4 font-mono text-[12.5px] tabular-nums text-mint">{fmtMs(r.avgLatency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-[11px] leading-relaxed text-dim">
        Доступность считается по журналу проверок: доля ответов без сбоя. Полоса зелёная ≥ 99.5%, янтарная ≥ 97%, красная ниже.
        Тип {DEVICE_TYPE_META.ping.label} — базовый; остальные типы учитывают успешность запроса.
      </p>
    </div>
  );
}
