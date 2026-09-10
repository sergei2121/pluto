// ─── PLUTO: Топология v2.0.1 ────────────────────────────────────────────────
// Две вкладки: "Карта сети" и "Топология сводка"
import { useMemo, useState, useEffect } from 'react';
import { store, useCurrentUser, usePluto, visibleAgents, visibleDevices } from '../lib/store';
import { cls, fmtMs, pingStats } from '../lib/util';
import type { Agent, Device, Tag, RelayPingResult } from '../lib/types';
import { Wifi, WifiOff, Globe, ChevronDown, Filter, Activity, Clock, Network } from 'lucide-react';

interface IpStatusEvent {
  id: string;
  ip: string;
  agentName: string;
  alive: boolean;
  ts: number;
  latency: number | null;
  repeated: boolean;
}

interface LeafNode {
  key: string;
  label: string;
  alive: boolean;
  latency: number | null;
  agentName: string;
}

function buildGraph(devices: Device[], agents: Agent[]) {
  const hubs = agents.map((a) => {
    const st = pingStats(a.targets);
    const leaves: LeafNode[] = [];
    for (const t of a.targets) {
      for (const r of t.results) {
        leaves.push({ 
          key: `${a.id}:${r.ip}`, 
          label: r.ip, 
          alive: r.alive, 
          latency: r.latency,
          agentName: a.name 
        });
      }
    }
    return { agent: a, online: st.offline === 0 && st.total > 0, leaves };
  });
  const standalone = devices.map((d) => ({ device: d }));
  return { hubs, standalone };
}

function TopologySummaryTab() {
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const allAgents = usePluto((s) => visibleAgents(s, user));
  const tags = usePluto((s) => s.tags);
  const events = usePluto((s) => s.events);
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [showTagFilter, setShowTagFilter] = useState(false);
  
  const [prevIpStatuses, setPrevIpStatuses] = useState<Map<string, { alive: boolean; lastEventTs: number }>>(new Map());
  const [ipEvents, setIpEvents] = useState<IpStatusEvent[]>([]);

  const agents = useMemo(() => {
    if (selectedTag === 'all') return allAgents;
    return allAgents.filter(a => a.tags.includes(selectedTag));
  }, [allAgents, selectedTag]);

  const graph = useMemo(() => buildGraph(devices, agents), [devices, agents]);

  const getTagObj = (id: string) => tags.find(t => t.id === id);
  const selectedTagObj = selectedTag !== 'all' ? getTagObj(selectedTag) : null;

  const allIpResults = useMemo(() => {
    const results: Array<{ ip: string; alive: boolean; latency: number | null; agentName: string; agentId: string }> = [];
    for (const hub of graph.hubs) {
      for (const leaf of hub.leaves) {
        results.push({
          ip: leaf.label,
          alive: leaf.alive,
          latency: leaf.latency,
          agentName: leaf.agentName,
          agentId: hub.agent.id
        });
      }
    }
    return results;
  }, [graph.hubs]);

  useEffect(() => {
    const now = Date.now();
    const newEvents: IpStatusEvent[] = [];
    const newPrevStatuses = new Map<string, { alive: boolean; lastEventTs: number }>();
    
    const pollInterval = 60000;
    
    for (const result of allIpResults) {
      const key = `${result.agentId}:${result.ip}`;
      const prev = prevIpStatuses.get(key);
      
      if (!prev) {
        newEvents.push({
          id: `${now}-${key}`,
          ip: result.ip,
          agentName: result.agentName,
          alive: result.alive,
          ts: now,
          latency: result.latency,
          repeated: false
        });
        newPrevStatuses.set(key, { alive: result.alive, lastEventTs: now });
      } else if (prev.alive !== result.alive) {
        newEvents.push({
          id: `${now}-${key}`,
          ip: result.ip,
          agentName: result.agentName,
          alive: result.alive,
          ts: now,
          latency: result.latency,
          repeated: false
        });
        newPrevStatuses.set(key, { alive: result.alive, lastEventTs: now });
      } else {
        const timeSinceLastEvent = now - prev.lastEventTs;
        if (timeSinceLastEvent >= pollInterval) {
          newEvents.push({
            id: `${now}-${key}-repeat`,
            ip: result.ip,
            agentName: result.agentName,
            alive: result.alive,
            ts: now,
            latency: result.latency,
            repeated: true
          });
          newPrevStatuses.set(key, { alive: result.alive, lastEventTs: now });
        } else {
          newPrevStatuses.set(key, prev);
        }
      }
    }
    
    for (const [key, value] of prevIpStatuses.entries()) {
      if (!allIpResults.some(r => `${r.agentId}:${r.ip}` === key)) {
        // IP исчез
      }
    }
    
    if (newEvents.length > 0) {
      setIpEvents(prev => [...newEvents, ...prev].slice(0, 50));
    }
    
    setPrevIpStatuses(newPrevStatuses);
  }, [allIpResults]);

  const totalUniqueIps = new Set(allIpResults.map(r => `${r.agentId}:${r.ip}`)).size;
  const onlineIps = allIpResults.filter(r => r.alive).length;
  const offlineIps = totalUniqueIps - onlineIps;

  return (
    <div className="space-y-4">
      <div className="rise relative overflow-hidden rounded-xl border border-line bg-panel/90 p-5">
        <div className="pointer-events-none absolute inset-0 nebula" />
        <div className="pointer-events-none absolute inset-0 stars" />
        <div className="relative flex items-center justify-between">
          <div>
            <h2 className="font-display text-[15px] font-bold text-ink">Топология · сводка v2.0.1</h2>
            <p className="text-[11.5px] text-dim">пингуемые IP через агентов{selectedTagObj && ` · тег: ${selectedTagObj.label}`}</p>
          </div>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Activity className="h-4 w-4 text-blu" />
              <div className="text-[22px] font-bold text-blu">{totalUniqueIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">IP целей</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Wifi className="h-4 w-4 text-ok" />
              <div className="text-[22px] font-bold text-ok">{onlineIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">онлайн</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <WifiOff className="h-4 w-4 text-crit" />
              <div className="text-[22px] font-bold text-crit">{offlineIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">офлайн</div>
          </div>
        </div>

        <div className="mt-5">
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-dim">Пингуемые IP</h3>
          <div className="max-h-[400px] overflow-y-auto space-y-1.5 pr-2">
            {graph.hubs.map((hub) => (
              <div key={hub.agent.id} className="mb-3">
                <div className="sticky top-0 z-10 flex items-center gap-2 rounded-md bg-panel/95 px-2 py-1.5 backdrop-blur">
                  <span className={cls('h-2 w-2 shrink-0 rounded-full', hub.online ? 'bg-blu' : 'bg-crit')} />
                  <span className="text-[11.5px] font-bold text-ink">{hub.agent.name}</span>
                  <span className="font-mono text-[10px] text-dim">{hub.agent.ip}</span>
                </div>
                <div className="space-y-1">
                  {hub.leaves.map((leaf) => (
                    <div 
                      key={leaf.key} 
                      className={cls(
                        "flex items-center justify-between rounded-md border px-3 py-2 text-[11.5px] transition-colors",
                        leaf.alive ? "border-ok/30 bg-ok/5" : "border-crit/30 bg-crit/5"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cls("h-1.5 w-1.5 rounded-full", leaf.alive ? "bg-ok" : "bg-crit")} />
                        <span className="font-mono font-semibold text-ink">{leaf.label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {leaf.latency != null && (
                          <span className="font-mono text-[10px] text-blu">{leaf.latency} мс</span>
                        )}
                        <span className={cls("text-[9px] font-semibold uppercase", leaf.alive ? "text-ok" : "text-crit")}>
                          {leaf.alive ? 'онлайн' : 'офлайн'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {graph.hubs.length === 0 && (
              <p className="py-6 text-center text-[12.5px] text-dim">
                {selectedTag !== 'all' ? `Агентов с тегом "${selectedTagObj?.label}" не найдено.` : 'Агентов пока нет — добавьте их на странице «Агенты».'}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rise relative overflow-hidden rounded-xl border border-line bg-panel/90 p-5">
        <div className="pointer-events-none absolute inset-0 nebula" />
        <div className="relative flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-[15px] font-bold text-ink">События статусов IP</h2>
            <p className="text-[11.5px] text-dim">появление / пропадание пинга</p>
          </div>
          <Clock className="h-5 w-5 text-dim" />
        </div>
        <div className="max-h-[500px] overflow-y-auto space-y-2 pr-2">
          {ipEvents.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-dim">Ожидание событий...</p>
          ) : (
            ipEvents.map((evt) => (
              <div 
                key={evt.id} 
                className={cls(
                  "flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors",
                  evt.repeated ? "bg-raised/30" : "bg-raised/60",
                  evt.alive ? "border-ok/30" : "border-crit/30"
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className={cls(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    evt.alive ? "bg-ok/15" : "bg-crit/15"
                  )}>
                    {evt.alive ? (
                      <Wifi className="h-4 w-4 text-ok" />
                    ) : (
                      <WifiOff className="h-4 w-4 text-crit" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-bold text-ink truncate">{evt.ip}</span>
                      {evt.repeated && (
                        <span className="rounded bg-vio/15 px-1.5 py-px text-[8px] font-semibold text-vio">повтор</span>
                      )}
                    </div>
                    <div className="text-[10px] text-dim truncate">агент: {evt.agentName}</div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={cls(
                    "text-[10px] font-bold uppercase",
                    evt.alive ? "text-ok" : "text-crit"
                  )}>
                    {evt.alive ? 'онлайн' : 'офлайн'}
                  </span>
                  <span className="text-[9px] text-dim font-mono">
                    {new Date(evt.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function NetworkMapTab() {
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const allAgents = usePluto((s) => visibleAgents(s, user));
  const tags = usePluto((s) => s.tags);
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [showTagFilter, setShowTagFilter] = useState(false);

  const agents = useMemo(() => {
    if (selectedTag === 'all') return allAgents;
    return allAgents.filter(a => a.tags.includes(selectedTag));
  }, [allAgents, selectedTag]);

  const graph = useMemo(() => buildGraph(devices, agents), [devices, agents]);

  const getTagObj = (id: string) => tags.find(t => t.id === id);
  const selectedTagObj = selectedTag !== 'all' ? getTagObj(selectedTag) : null;

  const allIpResults = useMemo(() => {
    const results: Array<{ ip: string; alive: boolean; latency: number | null; agentName: string; agentId: string }> = [];
    for (const hub of graph.hubs) {
      for (const leaf of hub.leaves) {
        results.push({
          ip: leaf.label,
          alive: leaf.alive,
          latency: leaf.latency,
          agentName: leaf.agentName,
          agentId: hub.agent.id
        });
      }
    }
    return results;
  }, [graph.hubs]);

  const W = 960, H = 640, cx = W / 2, cy = H / 2;
  const hubR = 210;
  const leafR = 92;

  const hubPos = graph.hubs.map((h, i) => {
    const ang = (i / Math.max(1, graph.hubs.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...h, x: cx + Math.cos(ang) * hubR, y: cy + Math.sin(ang) * hubR, ang };
  });

  const totalUniqueIps = new Set(allIpResults.map(r => `${r.agentId}:${r.ip}`)).size;
  const onlineIps = allIpResults.filter(r => r.alive).length;
  const offlineIps = totalUniqueIps - onlineIps;

  return (
    <div className="space-y-4">
      <div className="rise relative overflow-hidden rounded-xl border border-line bg-panel/90 p-5">
        <div className="pointer-events-none absolute inset-0 nebula" />
        <div className="pointer-events-none absolute inset-0 stars" />
        <div className="relative flex items-center justify-between">
          <div>
            <h2 className="font-display text-[15px] font-bold text-ink">Карта сети v2.0.1</h2>
            <p className="text-[11.5px] text-dim">визуализация топологии{selectedTagObj && ` · тег: ${selectedTagObj.label}`}</p>
          </div>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Activity className="h-4 w-4 text-blu" />
              <div className="text-[22px] font-bold text-blu">{totalUniqueIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">IP целей</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Wifi className="h-4 w-4 text-ok" />
              <div className="text-[22px] font-bold text-ok">{onlineIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">онлайн</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <WifiOff className="h-4 w-4 text-crit" />
              <div className="text-[22px] font-bold text-crit">{offlineIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim">офлайн</div>
          </div>
        </div>

        <div className="mt-5 flex justify-center">
          <svg width={W} height={H} className="max-w-full">
            {hubPos.map((h) => (
              <line
                key={`line-${h.agent.id}`}
                x1={cx}
                y1={cy}
                x2={h.x}
                y2={h.y}
                stroke={h.online ? '#22c55e' : '#ef4444'}
                strokeWidth="1.5"
                strokeDasharray="4 4"
                opacity="0.6"
              />
            ))}

            <circle cx={cx} cy={cy} r="32" fill="#7c3aed20" stroke="#7c3aed" strokeWidth="2" />
            <text x={cx} y={cy + 4} textAnchor="middle" className="fill-ink text-[11px] font-bold">ЯДРО</text>

            {hubPos.map((h) => {
              const leafPositions = h.leaves.map((l, i) => {
                const ang = (i / Math.max(1, h.leaves.length)) * Math.PI * 2;
                return {
                  x: h.x + Math.cos(ang) * leafR,
                  y: h.y + Math.sin(ang) * leafR,
                  leaf: l
                };
              });

              return (
                <g key={h.agent.id}>
                  {leafPositions.map((lp) => (
                    <line
                      key={`leaf-line-${lp.leaf.key}`}
                      x1={h.x}
                      y1={h.y}
                      x2={lp.x}
                      y2={lp.y}
                      stroke={lp.leaf.alive ? '#22c55e' : '#ef4444'}
                      strokeWidth="1"
                      opacity="0.4"
                    />
                  ))}

                  <circle
                    cx={h.x}
                    cy={h.y}
                    r="18"
                    fill={h.online ? '#22c55e20' : '#ef444420'}
                    stroke={h.online ? '#22c55e' : '#ef4444'}
                    strokeWidth="2"
                  />
                  <text x={h.x} y={h.y + 4} textAnchor="middle" className="fill-ink text-[9px] font-semibold">
                    {h.agent.name.length > 8 ? h.agent.name.substring(0, 6) + '..' : h.agent.name}
                  </text>

                  {leafPositions.map((lp) => (
                    <g key={lp.leaf.key}>
                      <circle
                        cx={lp.x}
                        cy={lp.y}
                        r="6"
                        fill={lp.leaf.alive ? '#22c55e30' : '#ef444430'}
                        stroke={lp.leaf.alive ? '#22c55e' : '#ef4444'}
                        strokeWidth="1.5"
                      />
                      <title>{`${lp.leaf.label}: ${lp.leaf.alive ? 'онлайн' : 'офлайн'}${lp.leaf.latency != null ? `, ${lp.leaf.latency} мс` : ''}`}</title>
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="mt-4 flex justify-center gap-6 text-[10px] text-dim">
          <div className="flex items-center gap-1.5">
            <circle cx="4" cy="4" r="4" className="fill-blu" />
            <span>Агент онлайн</span>
          </div>
          <div className="flex items-center gap-1.5">
            <circle cx="4" cy="4" r="4" className="fill-crit" />
            <span>Агент офлайн</span>
          </div>
          <div className="flex items-center gap-1.5">
            <circle cx="4" cy="4" r="3" className="fill-ok" />
            <span>IP онлайн</span>
          </div>
          <div className="flex items-center gap-1.5">
            <circle cx="4" cy="4" r="3" className="fill-crit" />
            <span>IP офлайн</span>
          </div>
        </div>

        {graph.hubs.length === 0 && (
          <p className="py-12 text-center text-[12.5px] text-dim">
            {selectedTag !== 'all' ? `Агентов с тегом "${selectedTagObj?.label}" не найдено.` : 'Агентов пока нет — добавьте их на странице «Агенты».'}
          </p>
        )}
      </div>
    </div>
  );
}

export default function Topology() {
  const route = usePluto((s) => s.route);
  const [activeTab, setActiveTab] = useState<'map' | 'summary'>(route === 'topology-map' ? 'map' : 'summary');

  useEffect(() => {
    if (route === 'topology-map') setActiveTab('map');
    else if (route === 'topology-summary') setActiveTab('summary');
  }, [route]);

  const handleTabChange = (tab: 'map' | 'summary') => {
    setActiveTab(tab);
    store.nav(tab === 'map' ? 'topology-map' : 'topology-summary');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleTabChange('map')}
          className={cls(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-all",
            activeTab === 'map' 
              ? "bg-vio/20 text-vio ring-1 ring-vio/30" 
              : "text-dim hover:bg-raised hover:text-ink"
          )}
        >
          <Network className="h-4 w-4" />
          Карта сети
        </button>
        <button
          onClick={() => handleTabChange('summary')}
          className={cls(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-all",
            activeTab === 'summary' 
              ? "bg-vio/20 text-vio ring-1 ring-vio/30" 
              : "text-dim hover:bg-raised hover:text-ink"
          )}
        >
          <Activity className="h-4 w-4" />
          Топология сводка
        </button>
      </div>

      {activeTab === 'map' ? <NetworkMapTab /> : <TopologySummaryTab />}
    </div>
  );
}
