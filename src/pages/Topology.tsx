// ─── PLUTO: топология сети v2.0.1 ────────────────────────────────────────────
// Информативный вид с расширенной статистикой и фильтрацией по тегам.
import { useMemo, useState } from 'react';
import { store, useCurrentUser, usePluto, visibleAgents, visibleDevices } from '../lib/store';
import { STATUS_META } from '../components/ui';
import { cls, fmtMs, pingStats } from '../lib/util';
import type { Agent, Device, Tag } from '../lib/types';
import { Wifi, WifiOff, Activity, Server, Network, Globe, ChevronDown, Filter } from 'lucide-react';

interface LeafNode {
  key: string;
  label: string;
  alive: boolean;
  latency: number | null;
  kind: 'target' | 'device' | 'glances';
}

function buildGraph(devices: Device[], agents: Agent[]) {
  // ядро → агенты; агент → цели пинга + glances; ядро → одиночные устройства
  const hubs = agents.map((a) => {
    const st = pingStats(a.targets);
    const leaves: LeafNode[] = [];
    for (const t of a.targets) for (const r of t.results) {
      leaves.push({ key: `${a.id}:${r.ip}`, label: r.ip, alive: r.alive, latency: r.latency, kind: 'target' });
    }
    if (a.glancesUrl) leaves.push({ key: `${a.id}:gl`, label: 'glances', alive: a.online, latency: null, kind: 'glances' });
    return { agent: a, online: st.offline === 0 && st.total > 0, leaves };
  });
  const standalone = devices.map((d) => ({ device: d }));
  return { hubs, standalone };
}

export default function Topology() {
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const allAgents = usePluto((s) => visibleAgents(s, user));
  const tags = usePluto((s) => s.tags);
  const [showMap, setShowMap] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [showTagFilter, setShowTagFilter] = useState(false);

  // Фильтрация агентов по тегу
  const agents = useMemo(() => {
    if (selectedTag === 'all') return allAgents;
    return allAgents.filter(a => a.tags.includes(selectedTag));
  }, [allAgents, selectedTag]);

  const graph = useMemo(() => buildGraph(devices, agents), [devices, agents]);

  const W = 960, H = 640, cx = W / 2, cy = H / 2;
  const hubR = 210; // орбита агентов
  const leafR = 92; // радиус листьев вокруг хаба

  const hubPos = graph.hubs.map((h, i) => {
    const ang = (i / Math.max(1, graph.hubs.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...h, x: cx + Math.cos(ang) * hubR, y: cy + Math.sin(ang) * hubR, ang };
  });

  // Сводная статистика для упрощённого вида
  const totalAgents = agents.length;
  const totalIps = agents.reduce((sum, a) => sum + a.pingTargets.length, 0);
  const onlineAgents = agents.filter(a => a.online).length;
  const offlineAgents = totalAgents - onlineAgents;
  
  // Дополнительная статистика
  const totalTargets = agents.reduce((sum, a) => sum + pingStats(a.targets).total, 0);
  const onlineTargets = agents.reduce((sum, a) => sum + pingStats(a.targets).online, 0);
  const offlineTargets = totalTargets - onlineTargets;
  const avgLatency = useMemo(() => {
    const latencies = agents.filter(a => a.latency != null).map(a => a.latency!);
    if (latencies.length === 0) return null;
    return Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  }, [agents]);

  // Получение объекта тега по ID
  const getTagObj = (id: string) => tags.find(t => t.id === id);
  const selectedTagObj = selectedTag !== 'all' ? getTagObj(selectedTag) : null;

  return (
    <div className="space-y-4">
      {/* Упрощённый вид по умолчанию */}
      <div className="rise relative overflow-hidden rounded-xl border border-line bg-panel/90 p-5">
        <div className="pointer-events-none absolute inset-0 nebula" />
        <div className="pointer-events-none absolute inset-0 stars" />
        <div className="relative flex items-center justify-between">
          <div>
            <h2 className="font-display text-[15px] font-bold text-ink">Топология · сводка v2.0.1</h2>
            <p className="text-[11.5px] text-dim">агенты, пинги и фильтрация по тегам{selectedTagObj && ` · ${selectedTagObj.label}`}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Выпадающий список с тегами для фильтрации "пинги агента" */}
            <div className="relative">
              <button 
                onClick={() => setShowTagFilter(!showTagFilter)}
                className="flex items-center gap-1.5 rounded-lg border border-vio/30 bg-vio/10 px-3 py-1.5 text-[11.5px] font-semibold text-vio transition-colors hover:bg-vio/20"
              >
                <Filter className="h-3.5 w-3.5" />
                {selectedTag === 'all' ? 'Все теги' : selectedTagObj?.label || 'Теги'}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTagFilter ? 'rotate-180' : ''}`} />
              </button>
              {showTagFilter && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-line bg-panel shadow-xl">
                  <button
                    onClick={() => { setSelectedTag('all'); setShowTagFilter(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] transition-colors hover:bg-raised ${selectedTag === 'all' ? 'bg-vio/10 text-vio' : 'text-ink'}`}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Все агенты
                  </button>
                  {tags.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setSelectedTag(t.id); setShowTagFilter(false); }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] transition-colors hover:bg-raised ${selectedTag === t.id ? 'bg-vio/10 text-vio' : 'text-ink'}`}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                      <span style={{ color: t.color }}>{t.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowMap(!showMap)} className="rounded-lg border border-vio/30 bg-vio/10 px-3 py-1.5 text-[11.5px] font-semibold text-vio transition-colors hover:bg-vio/20">
              {showMap ? 'Скрыть карту' : 'Показать карту'}
            </button>
          </div>
        </div>

        {/* Расширенная статистика */}
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Server className="h-4 w-4 text-ink" />
              <div className="text-[22px] font-bold text-ink">{totalAgents}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">агентов</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Network className="h-4 w-4 text-blu" />
              <div className="text-[22px] font-bold text-blu">{totalIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">IP целей</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Activity className="h-4 w-4 text-ok" />
              <div className="text-[22px] font-bold text-ok">{onlineAgents}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">в сети</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <WifiOff className="h-4 w-4 text-crit" />
              <div className="text-[22px] font-bold text-crit">{offlineAgents}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">офлайн</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Wifi className="h-4 w-4 text-mint" />
              <div className="text-[22px] font-bold text-mint">{onlineTargets}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">устр. онлайн</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="text-[22px] font-bold text-blu">{avgLatency ?? '—'}</div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">ср. пинг мс</div>
          </div>
        </div>

        {/* Список агентов с IP и тегами */}
        <div className="mt-5 space-y-2">
          {agents.map((a) => {
            const st = pingStats(a.targets);
            const agentTags = a.tags.map(id => getTagObj(id)).filter(Boolean) as { id: string; label: string; color: string }[];
            return (
              <button key={a.id} onClick={() => store.nav('agents', a.name)}
                className="flex w-full flex-col items-stretch gap-2 rounded-lg border border-line bg-raised/40 px-4 py-3 text-left transition-all hover:border-vio/40 hover:bg-raised/70 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className={cls('h-2.5 w-2.5 shrink-0 rounded-full', a.online ? 'bg-blu' : 'bg-crit')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-bold text-ink">{a.name}</span>
                      {a.glancesUrl && (
                        <span className="rounded border border-blu/40 bg-blu/10 px-1 py-px text-[8px] font-bold text-blu" title="Телеметрия Glances">GL</span>
                      )}
                    </div>
                    <div className="font-mono text-[10.5px] text-dim">{a.ip} · пинг {a.latency != null ? `${a.latency} мс` : '—'}</div>
                    {agentTags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {agentTags.map(t => (
                          <span key={t.id} className="rounded-full border px-2 py-px text-[9px] font-semibold" style={{ borderColor: t.color, color: t.color }}>
                            {t.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className={cls('font-mono text-[13px] font-bold', st.offline ? 'text-warn' : 'text-ok')}>{st.online}/{st.total}</div>
                    <div className="font-mono text-[9.5px] text-dim">устр.</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[13px] font-bold text-mut">{a.pingTargets.length}</div>
                    <div className="font-mono text-[9.5px] text-dim">IP целей</div>
                  </div>
                </div>
              </button>
            );
          })}
          {agents.length === 0 && (
            <p className="py-6 text-center text-[12.5px] text-dim">
              {selectedTag !== 'all' ? `Агентов с тегом "${selectedTagObj?.label}" не найдено.` : 'Агентов пока нет — добавьте их на странице «Агенты».'}
            </p>
          )}
        </div>
      </div>

      {/* Полная карта — показывается по клику */}
      {showMap && (
        <div className="rise relative overflow-hidden rounded-xl border border-line bg-panel/90">
          <div className="pointer-events-none absolute inset-0 nebula" />
          <div className="pointer-events-none absolute inset-0 stars" />
          <div className="relative flex items-center justify-between px-5 pt-4">
            <div>
              <h2 className="font-display text-[15px] font-bold text-ink">Карта инфраструктуры</h2>
              <p className="text-[11.5px] text-dim">ядро → агенты-хабы → локальные устройства · клик по узлу открывает его страницу</p>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-mut">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-vio" /> ядро</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blu" /> агент</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ok" /> онлайн</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-crit" /> офлайн</span>
            </div>
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="relative mx-auto block w-full max-w-[960px]">
            <defs>
              <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#8f7df0" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#8f7df0" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* связи ядро → хабы */}
            {hubPos.map((h) => (
              <line key={`l-${h.agent.id}`} x1={cx} y1={cy} x2={h.x} y2={h.y}
                stroke={h.agent.online ? 'rgba(143,125,240,.5)' : 'rgba(224,122,128,.5)'} strokeWidth={h.agent.online ? 2 : 1.2}
                strokeDasharray={h.agent.online ? undefined : '5 5'} />
            ))}
            {/* связи хаб → листья */}
            {hubPos.map((h) =>
              h.leaves.map((lf, i) => {
                const la = h.ang + ((i - (h.leaves.length - 1) / 2) * 0.5);
                const lx = h.x + Math.cos(la) * leafR, ly = h.y + Math.sin(la) * leafR;
                return <line key={`ll-${lf.key}`} x1={h.x} y1={h.y} x2={lx} y2={ly}
                  stroke={lf.alive ? 'rgba(85,199,149,.4)' : 'rgba(224,122,128,.35)'} strokeWidth={1} />;
              }),
            )}
            {/* связи ядро → одиночные устройства (по нижней дуге) */}
            {graph.standalone.map((sd, i) => {
              const ang = Math.PI * 0.15 + (i / Math.max(1, graph.standalone.length)) * Math.PI * 0.7;
              const x = cx + Math.cos(ang) * (hubR + 120), y = cy + Math.sin(ang) * 120 + 60;
              return <line key={`ls-${sd.device.id}`} x1={cx} y1={cy} x2={x} y2={y}
                stroke={sd.device.status === 'up' ? 'rgba(85,199,149,.3)' : sd.device.status === 'down' ? 'rgba(224,122,128,.4)' : 'rgba(139,147,184,.25)'} strokeWidth={1} />;
            })}

            {/* листья */}
            {hubPos.map((h) =>
              h.leaves.map((lf, i) => {
                const la = h.ang + ((i - (h.leaves.length - 1) / 2) * 0.5);
                const lx = h.x + Math.cos(la) * leafR, ly = h.y + Math.sin(la) * leafR;
                const color = lf.alive ? '#55c795' : '#e07a80';
                return (
                  <g key={lf.key} className="cursor-default">
                    <circle cx={lx} cy={ly} r={6} fill={color} opacity={lf.alive ? 0.9 : 0.8} />
                    <text x={lx} y={ly + 16} textAnchor="middle" fontSize="9" fill="#8b93b8" fontFamily="JetBrains Mono">{lf.label}</text>
                    {lf.latency != null && <text x={lx} y={ly + 26} textAnchor="middle" fontSize="8" fill="#5fc6d8" fontFamily="JetBrains Mono">{lf.latency} мс</text>}
                  </g>
                );
              }),
            )}

            {/* хабы-агенты */}
            {hubPos.map((h) => (
              <g key={h.agent.id} className="cursor-pointer" onClick={() => store.nav('agents', h.agent.name)}>
                <circle cx={h.x} cy={h.y} r={30} fill="rgba(123,164,230,.12)" stroke={h.agent.online ? '#7ba4e6' : '#e07a80'} strokeWidth={2} />
                <circle cx={h.x} cy={h.y} r={5} fill={h.agent.online ? '#7ba4e6' : '#e07a80'} />
                <text x={h.x} y={h.y + 46} textAnchor="middle" fontSize="11" fontWeight="600" fill="#dfe3f5">{h.agent.name}</text>
                <text x={h.x} y={h.y + 59} textAnchor="middle" fontSize="9" fill="#8b93b8" fontFamily="JetBrains Mono">
                  {pingStats(h.agent.targets).online}/{pingStats(h.agent.targets).total} · {h.agent.latency ?? '—'} мс
                </text>
              </g>
            ))}

            {/* одиночные устройства */}
            {graph.standalone.map((sd, i) => {
              const ang = Math.PI * 0.15 + (i / Math.max(1, graph.standalone.length)) * Math.PI * 0.7;
              const x = cx + Math.cos(ang) * (hubR + 120), y = cy + Math.sin(ang) * 120 + 60;
              const m = STATUS_META[sd.device.status];
              return (
                <g key={sd.device.id} className="cursor-pointer" onClick={() => store.nav('devices', sd.device.address)}>
                  <rect x={x - 7} y={y - 7} width={14} height={14} rx={3} fill="rgba(18,22,42,.9)" stroke={m.dot.replace('bg-', '#')} strokeWidth={1.5} />
                  <text x={x} y={y + 22} textAnchor="middle" fontSize="9" fill="#aeb6d8">{sd.device.name.slice(0, 16)}</text>
                </g>
              );
            })}

            {/* ядро в центре */}
            <g className="cursor-pointer" onClick={() => store.nav('dashboard')}>
              <circle cx={cx} cy={cy} r={70} fill="url(#coreGlow)" />
              <circle cx={cx} cy={cy} r={34} fill="rgba(143,125,240,.15)" stroke="#8f7df0" strokeWidth={2.5} />
              <circle cx={cx} cy={cy} r={7} fill="#8f7df0" className="dot-live" />
              <text x={cx} y={cy + 52} textAnchor="middle" fontSize="13" fontWeight="700" fill="#8f7df0" letterSpacing="3">PLUTO</text>
              <text x={cx} y={cy + 66} textAnchor="middle" fontSize="9" fill="#8b93b8">ядро · {agents.length} аг. · {devices.length} устр.</text>
            </g>
          </svg>
        </div>
      )}

      {/* сводка по хабам с тегами */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {hubPos.map((h) => {
          const st = pingStats(h.agent.targets);
          const agentTags = h.agent.tags.map(id => getTagObj(id)).filter(Boolean) as { id: string; label: string; color: string }[];
          return (
            <button key={h.agent.id} onClick={() => store.nav('agents', h.agent.name)}
              className="rise flex flex-col items-stretch gap-3 rounded-xl border border-line bg-panel/90 px-4 py-3 text-left transition-all hover:border-vio/40 hover:bg-raised/60">
              <div className="flex items-center gap-3">
                <span className={cls('h-2.5 w-2.5 shrink-0 rounded-full', h.agent.online ? 'bg-blu' : 'bg-crit')} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-bold text-ink">{h.agent.name}</span>
                    {h.agent.glancesUrl && (
                      <span className="rounded border border-blu/40 bg-blu/10 px-1 py-px text-[8px] font-bold text-blu">GL</span>
                    )}
                  </div>
                  <div className="font-mono text-[10.5px] text-dim">{h.agent.ip} · пинг {h.agent.latency != null ? `${h.agent.latency} мс` : '—'}</div>
                </div>
              </div>
              {agentTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {agentTags.map(t => (
                    <span key={t.id} className="rounded-full border px-2 py-px text-[9px] font-semibold" style={{ borderColor: t.color, color: t.color }}>
                      {t.label}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between border-t border-line/40 pt-2">
                <div className="text-[10.5px] text-dim">{h.leaves.length} узлов</div>
                <div className={cls('font-mono text-[13px] font-bold', st.offline ? 'text-warn' : 'text-ok')}>{st.online}/{st.total} устр.</div>
              </div>
            </button>
          );
        })}
        {hubPos.length === 0 && (
          <p className="col-span-full py-6 text-center text-[12.5px] text-dim">
            {selectedTag !== 'all' ? `Агентов с тегом "${selectedTagObj?.label}" не найдено.` : 'Агентов пока нет — добавьте их на странице «Агенты», и здесь появится карта сети.'}
          </p>
        )}
      </div>
    </div>
  );
}
