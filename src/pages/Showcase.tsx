// ─── PLUTO: публичная витрина ────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { LayoutGrid, ExternalLink, Eye, EyeOff, Server, Crosshair } from 'lucide-react';
import { Panel, StatusDot, STATUS_META, TypeBadge, EmptyState } from '../components/ui';
import { store, usePluto } from '../lib/store';
import { cls, fmtMs, pingStats } from '../lib/util';

export default function Showcase() {
  const devices = usePluto((s) => s.devices);
  const agents = usePluto((s) => s.agents);
  const settings = usePluto((s) => s.settings);
  const [portDraft, setPortDraft] = useState<string | null>(null);

  const shown = useMemo(() => devices.filter((d) => d.showcase), [devices]);
  const shownAP = useMemo(() => agents.filter((a) => a.pingsShowcase), [agents]);
  const port = settings.showcase.port || 8081;
  const publicUrl = `http://${window.location.hostname || 'IP-СЕРВЕРА'}:${port}`;

  const applyPort = () => {
    const newPort = portDraft != null ? parseInt(portDraft, 10) : port;
    if (!newPort || newPort < 1024 || newPort > 65535) return;
    void store.saveSettings({ ...settings, showcase: { port: newPort } });
    setPortDraft(null);
  };

  return (
    <div className="space-y-4">
      <Panel title="Публичная витрина" icon={<LayoutGrid className="h-4 w-4" />}
        right={<a href={publicUrl} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-mint/50 bg-mint/15 px-3 py-1.5 text-[12.5px] font-bold text-mint transition-all hover:bg-mint/25">
          <ExternalLink className="h-4 w-4" /> Открыть витрину
        </a>}>
        <div className="rounded-lg border border-mint/25 bg-mint/5 px-4 py-3 text-[12.5px] leading-relaxed text-mut">
          Витрина доступна <span className="font-bold text-mint">без входа</span> по адресу{' '}
          <code className="rounded bg-void/50 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">{publicUrl}</code>.
          Это отдельный порт ядра: только список устройств и пингов — без меню, настроек и управления.
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Порт витрины</span>
            <input className="inp w-28 font-mono" type="number" min={1024} max={65535} value={portDraft ?? port} onChange={(e) => setPortDraft(e.target.value)} />
          </label>
          <button onClick={applyPort} className="btn-acc">Применить порт</button>
          <span className="text-[11.5px] text-dim">В серверном режиме не забудьте пробросить порт (<code className="font-mono">PLUTO_SHOWCASE_PORT</code>).</span>
        </div>
      </Panel>

      <Panel title={`Пинги агентов на витрине · ${shownAP.length} из ${agents.length}`} icon={<Crosshair className="h-4 w-4" />}>
        {agents.length === 0 ? (
          <p className="py-2 text-center text-[12.5px] text-dim">Relay-агентов пока нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line/60 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">
                  <th className="py-2 pr-3">На витрине</th><th className="py-2 pr-3">Агент</th><th className="py-2 pr-3">Устройств</th><th className="py-2 pr-3">Онлайн</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const st = pingStats(a.targets);
                  return (
                    <tr key={a.id} className={cls('border-b border-line/30 transition-colors', a.pingsShowcase ? 'bg-mint/[0.04]' : 'hover:bg-raised/40')}>
                      <td className="py-2.5 pr-3">
                        <button onClick={() => store.toggleAgentPingsShowcase(a.id)} title={a.pingsShowcase ? 'Убрать с витрины' : 'Показать на витрине'}
                          className={cls('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-bold transition-all',
                            a.pingsShowcase ? 'border-mint/50 bg-mint/15 text-mint' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                          {a.pingsShowcase ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{a.pingsShowcase ? 'Видно' : 'Скрыто'}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3"><div className="text-[13px] font-semibold text-ink">{a.name}</div><div className="font-mono text-[11px] text-dim">{a.ip}</div></td>
                      <td className="py-2.5 pr-3 font-mono text-[13px] tabular-nums text-mut">{st.total}</td>
                      <td className="py-2.5 pr-3"><span className={cls('font-mono text-[13px] tabular-nums', st.offline > 0 ? 'text-warn' : 'text-ok')}>{st.online}/{st.total}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={`Устройства на витрине · ${shown.length} из ${devices.length}`} icon={<Server className="h-4 w-4" />}>
        {devices.length === 0 ? (
          <EmptyState icon={<LayoutGrid className="h-6 w-6" />} title="Устройств пока нет"
            text="Сначала добавьте устройства на странице «Устройства», затем отметьте здесь те, что должны быть видны публично." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line/60 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">
                  <th className="py-2 pr-3">На витрине</th><th className="py-2 pr-3">Устройство</th><th className="py-2 pr-3">Тип</th><th className="py-2 pr-3">Статус</th><th className="py-2 pr-3">Задержка</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const m = STATUS_META[d.status];
                  return (
                    <tr key={d.id} className={cls('border-b border-line/30 transition-colors', d.showcase ? 'bg-mint/[0.04]' : 'hover:bg-raised/40')}>
                      <td className="py-2.5 pr-3">
                        <button onClick={() => store.toggleDeviceShowcase(d.id)} title={d.showcase ? 'Убрать с витрины' : 'Показать на витрине'}
                          className={cls('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-bold transition-all',
                            d.showcase ? 'border-mint/50 bg-mint/15 text-mint' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                          {d.showcase ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{d.showcase ? 'Видно' : 'Скрыто'}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3"><div className="text-[13px] font-semibold text-ink">{d.name}</div><div className="font-mono text-[11px] text-dim">{d.address}</div></td>
                      <td className="py-2.5 pr-3"><TypeBadge t={d.type} /></td>
                      <td className="py-2.5 pr-3"><span className="flex items-center gap-2"><StatusDot status={d.status} pulse={d.showcase} /><span className={cls('text-[12px] font-semibold', m.text)}>{m.label}</span></span></td>
                      <td className="py-2.5 pr-3 font-mono text-[13px] tabular-nums text-mut">{d.status === 'down' ? '—' : fmtMs(d.latency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
