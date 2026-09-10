// ─── PLUTO: Карта сети v2.1.0 ────────────────────────────────────────────────
// Визуальная карта сети с агентами и пингуемыми IP
// Улучшенная визуализация с динамическими связями
import { useMemo, useState } from 'react';
import { store, useCurrentUser, usePluto, visibleAgents, visibleDevices } from '../lib/store';
import { cls, fmtMs, pingStats } from '../lib/util';
import type { Agent, Device, Tag } from '../lib/types';
import { Wifi, WifiOff, Globe, ChevronDown, Filter, Activity, Network, Zap, Server } from 'lucide-react';

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

export default function NetworkMap() {
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

  const W = 1100, H = 700, cx = W / 2, cy = H / 2;
  const hubR = 260;
  const leafR = 100;

  // Позиции хабов (агентов) по кругу
  const hubPos = graph.hubs.map((h, i) => {
    const ang = (i / Math.max(1, graph.hubs.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...h, x: cx + Math.cos(ang) * hubR, y: cy + Math.sin(ang) * hubR, ang };
  });

  // Генерация путей для связей между хабами и листьями
  const getConnectionPath = (x1: number, y1: number, x2: number, y2: number) => {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  };

  const totalUniqueIps = new Set(allIpResults.map(r => `${r.agentId}:${r.ip}`)).size;
  const onlineIps = allIpResults.filter(r => r.alive).length;
  const offlineIps = totalUniqueIps - onlineIps;

  return (
    <div className="space-y-4">
      <div className="rise relative overflow-hidden rounded-xl border border-line bg-panel/90 p-5">
        {/* Фоновые эффекты */}
        <div className="pointer-events-none absolute inset-0 nebula" />
        <div className="pointer-events-none absolute inset-0 stars" />
        
        {/* Декоративная сетка */}
        <div 
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(rgba(124, 58, 237, 0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(124, 58, 237, 0.1) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
          }}
        />
        
        <div className="relative flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink flex items-center gap-2">
              <Network className="h-5 w-5 text-vio" />
              Карта сети v2.1.0
            </h2>
            <p className="text-[11.5px] text-dim mt-1">
              визуализация топологии{selectedTagObj && ` · тег: ${selectedTagObj.label}`}
            </p>
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

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="group rounded-lg border border-line bg-raised/50 p-3 text-center hover:bg-raised transition-colors">
            <div className="flex items-center justify-center gap-1.5">
              <Activity className="h-4 w-4 text-blu group-hover:scale-110 transition-transform" />
              <div className="text-[22px] font-bold text-blu">{totalUniqueIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim mt-1">IP целей</div>
          </div>
          <div className="group rounded-lg border border-line bg-raised/50 p-3 text-center hover:bg-raised transition-colors">
            <div className="flex items-center justify-center gap-1.5">
              <Wifi className="h-4 w-4 text-ok group-hover:scale-110 transition-transform" />
              <div className="text-[22px] font-bold text-ok">{onlineIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim mt-1">онлайн</div>
          </div>
          <div className="group rounded-lg border border-line bg-raised/50 p-3 text-center hover:bg-raised transition-colors">
            <div className="flex items-center justify-center gap-1.5">
              <WifiOff className="h-4 w-4 text-crit group-hover:scale-110 transition-transform" />
              <div className="text-[22px] font-bold text-crit">{offlineIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-dim mt-1">офлайн</div>
          </div>
        </div>

        {/* SVG карта сети */}
        <div className="mt-6 flex justify-center">
          <svg width={W} height={H} className="max-w-full" style={{ overflow: 'visible' }}>
            {/* Связи от ядра к агентам */}
            {hubPos.map((h) => (
              <path
                key={`line-${h.agent.id}`}
                d={getConnectionPath(cx, cy, h.x, h.y)}
                stroke={h.online ? '#22c55e' : '#ef4444'}
                strokeWidth="2"
                strokeDasharray="4 4"
                opacity="0.5"
                className="transition-all duration-300"
              >
                <title>{h.agent.name}: {h.online ? 'онлайн' : 'офлайн'}</title>
              </path>
            ))}

            {/* Ядро системы в центре */}
            <defs>
              <radialGradient id="coreGradient" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.1" />
              </radialGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
            
            <circle 
              cx={cx} 
              cy={cy} 
              r="38" 
              fill="url(#coreGradient)" 
              stroke="#7c3aed" 
              strokeWidth="2.5"
              filter="url(#glow)"
            />
            <Zap className="h-6 w-6 text-vio" x={cx - 12} y={cy - 12} />
            <text x={cx} y={cy + 55} textAnchor="middle" className="fill-ink text-[11px] font-bold">ЯДРО СИСТЕМЫ</text>

            {/* Агенты и их цели */}
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
                  {/* Связи от агента к целям */}
                  {leafPositions.map((lp) => (
                    <path
                      key={`leaf-line-${lp.leaf.key}`}
                      d={getConnectionPath(h.x, h.y, lp.x, lp.y)}
                      stroke={lp.leaf.alive ? '#22c55e' : '#ef4444'}
                      strokeWidth="1.5"
                      opacity="0.4"
                      className="transition-all duration-300"
                    >
                      <title>{`${lp.leaf.label}: ${lp.leaf.alive ? 'онлайн' : 'офлайн'}${lp.leaf.latency != null ? `, ${lp.leaf.latency} мс` : ''}`}</title>
                    </path>
                  ))}

                  {/* Узел агента */}
                  <circle
                    cx={h.x}
                    cy={h.y}
                    r="20"
                    fill={h.online ? '#22c55e25' : '#ef444425'}
                    stroke={h.online ? '#22c55e' : '#ef4444'}
                    strokeWidth="2.5"
                    className="transition-all duration-300 hover:scale-110"
                    style={{ cursor: 'pointer' }}
                  >
                    <title>{`${h.agent.name}\n${h.online ? 'Онлайн' : 'Офлайн'}\nЦелей: ${h.leaves.length}`}</title>
                  </circle>
                  
                  {/* Иконка сервера для агента */}
                  <Server className="h-4 w-4" 
                    x={h.x - 8} 
                    y={h.y - 8}
                    style={{ 
                      color: h.online ? '#22c55e' : '#ef4444',
                      pointerEvents: 'none'
                    }} 
                  />
                  
                  <text 
                    x={h.x} 
                    y={h.y + 38} 
                    textAnchor="middle" 
                    className="fill-ink text-[9px] font-semibold"
                    style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                  >
                    {h.agent.name.length > 12 ? h.agent.name.substring(0, 10) + '..' : h.agent.name}
                  </text>

                  {/* Цели (IP адреса) */}
                  {leafPositions.map((lp) => (
                    <g key={lp.leaf.key}>
                      <circle
                        cx={lp.x}
                        cy={lp.y}
                        r="7"
                        fill={lp.leaf.alive ? '#22c55e35' : '#ef444435'}
                        stroke={lp.leaf.alive ? '#22c55e' : '#ef4444'}
                        strokeWidth="2"
                        className="transition-all duration-300 hover:scale-125"
                        style={{ cursor: 'pointer' }}
                      >
                        <title>{`${lp.leaf.label}\n${lp.leaf.alive ? 'Онлайн' : 'Офлайн'}\nАгент: ${lp.leaf.agentName}${lp.leaf.latency != null ? `\n${lp.leaf.latency} мс` : ''}`}</title>
                      </circle>
                      {/* Точка в центре для IP */}
                      <circle
                        cx={lp.x}
                        cy={lp.y}
                        r="3"
                        fill={lp.leaf.alive ? '#22c55e' : '#ef4444'}
                        opacity="0.8"
                      />
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Легенда */}
        <div className="mt-5 flex flex-wrap justify-center gap-4 text-[10px] text-dim">
          <div className="flex items-center gap-2 rounded bg-raised/50 px-3 py-1.5 border border-line">
            <circle cx="4" cy="4" r="4" className="fill-blu" />
            <span>Агент онлайн</span>
          </div>
          <div className="flex items-center gap-2 rounded bg-raised/50 px-3 py-1.5 border border-line">
            <circle cx="4" cy="4" r="4" className="fill-crit" />
            <span>Агент офлайн</span>
          </div>
          <div className="flex items-center gap-2 rounded bg-raised/50 px-3 py-1.5 border border-line">
            <circle cx="4" cy="4" r="3" className="fill-ok" />
            <span>IP онлайн</span>
          </div>
          <div className="flex items-center gap-2 rounded bg-raised/50 px-3 py-1.5 border border-line">
            <circle cx="4" cy="4" r="3" className="fill-crit" />
            <span>IP офлайн</span>
          </div>
          <div className="flex items-center gap-2 rounded bg-raised/50 px-3 py-1.5 border border-line">
            <Zap className="h-3 w-3 text-vio" />
            <span>Ядро системы</span>
          </div>
        </div>

        {graph.hubs.length === 0 && (
          <div className="py-16 text-center">
            <Network className="h-12 w-12 mx-auto text-dim opacity-30 mb-4" />
            <p className="text-[13px] text-dim">
              {selectedTag !== 'all' 
                ? `Агентов с тегом "${selectedTagObj?.label}" не найдено.` 
                : 'Агентов пока нет — добавьте их на странице «Агенты».'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
