// ─── PLUTO: Карта сети v3.0.0 ────────────────────────────────────────────────
// Визуальная карта сети с агентами и пингуемыми IP
// Полностью переработанный интерфейс с квадратами со скругленными углами
// Исправлена проблема с линиями - привязка к фактическим координатам узлов

import { useMemo, useState } from 'react';
import { store, useCurrentUser, usePluto, visibleAgents, visibleDevices } from '../lib/store';
import { cls, fmtMs, pingStats } from '../lib/util';
import type { Agent, Device, Tag } from '../lib/types';
import { Wifi, WifiOff, Globe, ChevronDown, Filter, Activity, Network, Zap, Server, Square } from 'lucide-react';

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

  // Размеры холста
  const W = 1200, H = 750;
  const cx = W / 2, cy = H / 2;
  
  // Радиусы расположения элементов
  const hubR = 280;  // Радиус расположения агентов от центра
  const leafR = 90;  // Радиус расположения IP от агента

  // Позиции хабов (агентов) по кругу
  const hubPos = graph.hubs.map((h, i) => {
    const ang = (i / Math.max(1, graph.hubs.length)) * Math.PI * 2 - Math.PI / 2;
    return { 
      ...h, 
      x: cx + Math.cos(ang) * hubR, 
      y: cy + Math.sin(ang) * hubR, 
      angle: ang 
    };
  });

  const totalUniqueIps = new Set(allIpResults.map(r => `${r.agentId}:${r.ip}`)).size;
  const onlineIps = allIpResults.filter(r => r.alive).length;
  const offlineIps = totalUniqueIps - onlineIps;

  return (
    <div className="space-y-4">
      <div className="rise relative overflow-hidden rounded-2xl border border-line bg-panel/95 p-6 shadow-xl">
        {/* Фоновые эффекты */}
        <div className="pointer-events-none absolute inset-0 nebula" />
        <div className="pointer-events-none absolute inset-0 stars" />
        
        {/* Декоративная сетка */}
        <div 
          className="pointer-events-none absolute inset-0 opacity-15"
          style={{
            backgroundImage: `
              linear-gradient(rgba(124, 58, 237, 0.15) 1px, transparent 1px),
              linear-gradient(90deg, rgba(124, 58, 237, 0.15) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
          }}
        />
        
        {/* Градиентное свечение по краям */}
        <div className="pointer-events-none absolute inset-0" style={{
          background: 'radial-gradient(circle at center, transparent 40%, rgba(124, 58, 237, 0.1) 100%)'
        }} />
        
        <div className="relative flex items-center justify-between mb-6">
          <div>
            <h2 className="font-display text-[17px] font-bold text-ink flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-vio/15 border border-vio/30">
                <Network className="h-5 w-5 text-vio" />
              </div>
              Карта сети v3.0.0
            </h2>
            <p className="text-[11.5px] text-dim mt-1.5">
              визуализация топологии{selectedTagObj && ` · тег: ${selectedTagObj.label}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button 
                onClick={() => setShowTagFilter(!showTagFilter)}
                className="flex items-center gap-2 rounded-xl border border-vio/30 bg-vio/15 px-4 py-2 text-[12px] font-semibold text-vio transition-all hover:bg-vio/25 hover:scale-105"
              >
                <Filter className="h-4 w-4" />
                {selectedTag === 'all' ? 'Все теги' : selectedTagObj?.label || 'Теги'}
                <ChevronDown className={`h-4 w-4 transition-transform ${showTagFilter ? 'rotate-180' : ''}`} />
              </button>
              {showTagFilter && (
                <div className="absolute right-0 top-full z-50 mt-2 min-w-[200px] rounded-xl border border-line bg-panel shadow-2xl overflow-hidden">
                  <button
                    onClick={() => { setSelectedTag('all'); setShowTagFilter(false); }}
                    className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[12px] transition-colors hover:bg-raised ${selectedTag === 'all' ? 'bg-vio/15 text-vio' : 'text-ink'}`}
                  >
                    <Globe className="h-4 w-4" />
                    Все агенты
                  </button>
                  {tags.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setSelectedTag(t.id); setShowTagFilter(false); }}
                      className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[12px] transition-colors hover:bg-raised ${selectedTag === t.id ? 'bg-vio/15 text-vio' : 'text-ink'}`}
                    >
                      <span className="h-3 w-3 rounded-full shadow-sm" style={{ backgroundColor: t.color }} />
                      <span style={{ color: t.color }}>{t.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Статистика */}
        <div className="mt-5 grid grid-cols-3 gap-4">
          <div className="group relative overflow-hidden rounded-xl border border-line bg-gradient-to-br from-blu/10 to-blu/5 p-4 text-center hover:border-blu/40 hover:shadow-lg hover:shadow-blu/10 transition-all duration-300">
            <div className="flex items-center justify-center gap-2">
              <Activity className="h-5 w-5 text-blu group-hover:scale-110 transition-transform" />
              <div className="text-[26px] font-bold text-blu">{totalUniqueIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.15em] text-dim mt-2">IP целей</div>
          </div>
          <div className="group relative overflow-hidden rounded-xl border border-line bg-gradient-to-br from-ok/10 to-ok/5 p-4 text-center hover:border-ok/40 hover:shadow-lg hover:shadow-ok/10 transition-all duration-300">
            <div className="flex items-center justify-center gap-2">
              <Wifi className="h-5 w-5 text-ok group-hover:scale-110 transition-transform" />
              <div className="text-[26px] font-bold text-ok">{onlineIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.15em] text-dim mt-2">онлайн</div>
          </div>
          <div className="group relative overflow-hidden rounded-xl border border-line bg-gradient-to-br from-crit/10 to-crit/5 p-4 text-center hover:border-crit/40 hover:shadow-lg hover:shadow-crit/10 transition-all duration-300">
            <div className="flex items-center justify-center gap-2">
              <WifiOff className="h-5 w-5 text-crit group-hover:scale-110 transition-transform" />
              <div className="text-[26px] font-bold text-crit">{offlineIps}</div>
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.15em] text-dim mt-2">офлайн</div>
          </div>
        </div>

        {/* SVG карта сети */}
        <div className="mt-8 flex justify-center">
          <svg width={W} height={H} className="max-w-full" style={{ overflow: 'visible' }}>
            {/* Дефиниции градиентов и эффектов */}
            <defs>
              {/* Градиент для линий к агентам */}
              <linearGradient id="agentLineGradient-online" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0.6" />
              </linearGradient>
              <linearGradient id="agentLineGradient-offline" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.6" />
              </linearGradient>
              
              {/* Градиент для линий к IP */}
              <linearGradient id="ipLineGradient-online" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0.3" />
              </linearGradient>
              <linearGradient id="ipLineGradient-offline" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.3" />
              </linearGradient>
              
              {/* Градиент для ядра */}
              <radialGradient id="coreGradient" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.1" />
              </radialGradient>
              
              {/* Свечение для ядра */}
              <filter id="coreGlow">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              
              {/* Тень для узлов */}
              <filter id="nodeShadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.3"/>
              </filter>
            </defs>

            {/* Связи от ядра к агентам (рисуем первыми чтобы были под узлами) */}
            {hubPos.map((h) => (
              <g key={`hub-line-${h.agent.id}`}>
                {/* Основная линия */}
                <line
                  x1={cx}
                  y1={cy}
                  x2={h.x}
                  y2={h.y}
                  stroke={h.online ? 'url(#agentLineGradient-online)' : 'url(#agentLineGradient-offline)'}
                  strokeWidth="3"
                  strokeDasharray={h.online ? 'none' : '6,4'}
                  opacity="0.7"
                  className="transition-all duration-500"
                />
                {/* Анимированные точки на линии */}
                {h.online && (
                  <circle r="3" fill="#22c55e" opacity="0.6">
                    <animateMotion 
                      dur="2s" 
                      repeatCount="indefinite"
                      path={`M ${cx} ${cy} L ${h.x} ${h.y}`}
                    />
                  </circle>
                )}
              </g>
            ))}

            {/* Ядро системы в центре - квадрат со скругленными углами */}
            <g filter="url(#coreGlow)">
              <rect 
                x={cx - 28} 
                y={cy - 28} 
                width="56" 
                height="56" 
                rx="14"
                ry="14"
                fill="url(#coreGradient)" 
                stroke="#7c3aed" 
                strokeWidth="3"
                className="transition-all duration-300 hover:scale-105"
              />
              <Zap className="h-7 w-7 text-vio" x={cx - 14} y={cy - 14} style={{ filter: 'drop-shadow(0 0 8px rgba(124, 58, 237, 0.6))' }} />
            </g>
            <text x={cx} y={cy + 52} textAnchor="middle" className="fill-ink text-[11px] font-bold tracking-[0.15em]">ЯДРО СИСТЕМЫ</text>

            {/* Агенты и их цели */}
            {hubPos.map((h) => {
              // Вычисляем позиции листьев (IP адресов) вокруг агента
              const leafPositions = h.leaves.map((l, i) => {
                const count = h.leaves.length;
                const angleStep = (2 * Math.PI) / count;
                const angle = angleStep * i - Math.PI / 2;
                return {
                  x: h.x + Math.cos(angle) * leafR,
                  y: h.y + Math.sin(angle) * leafR,
                  leaf: l
                };
              });

              return (
                <g key={h.agent.id}>
                  {/* Связи от агента к целям (рисуем перед агентом но под листьями) */}
                  {leafPositions.map((lp) => (
                    <line
                      key={`leaf-line-${lp.leaf.key}`}
                      x1={h.x}
                      y1={h.y}
                      x2={lp.x}
                      y2={lp.y}
                      stroke={lp.leaf.alive ? 'url(#ipLineGradient-online)' : 'url(#ipLineGradient-offline)'}
                      strokeWidth="2"
                      opacity="0.5"
                      className="transition-all duration-300"
                    >
                      <title>{`${lp.leaf.label}: ${lp.leaf.alive ? 'онлайн' : 'офлайн'}${lp.leaf.latency != null ? `, ${lp.leaf.latency} мс` : ''}`}</title>
                    </line>
                  ))}

                  {/* Узел агента - квадрат со скругленными углами */}
                  <g 
                    className="transition-all duration-300 hover:scale-110 cursor-pointer"
                    filter="url(#nodeShadow)"
                  >
                    <rect
                      x={h.x - 22}
                      y={h.y - 22}
                      width="44"
                      height="44"
                      rx="10"
                      ry="10"
                      fill={h.online ? '#22c55e25' : '#ef444425'}
                      stroke={h.online ? '#22c55e' : '#ef4444'}
                      strokeWidth="2.5"
                    >
                      <title>{`${h.agent.name}\n${h.online ? 'Онлайн' : 'Офлайн'}\nЦелей: ${h.leaves.length}`}</title>
                    </rect>
                    
                    {/* Иконка сервера для агента */}
                    <Server className="h-5 w-5" 
                      x={h.x - 10} 
                      y={h.y - 10}
                      style={{ 
                        color: h.online ? '#22c55e' : '#ef4444',
                        filter: 'drop-shadow(0 0 4px currentColor)'
                      }} 
                    />
                  </g>
                  
                  {/* Подпись агента */}
                  <text 
                    x={h.x} 
                    y={h.y + 42} 
                    textAnchor="middle" 
                    className="fill-ink text-[10px] font-semibold"
                    style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
                  >
                    {h.agent.name.length > 14 ? h.agent.name.substring(0, 12) + '..' : h.agent.name}
                  </text>

                  {/* Цели (IP адреса) - маленькие квадраты со скругленными углами */}
                  {leafPositions.map((lp) => (
                    <g 
                      key={lp.leaf.key}
                      className="transition-all duration-300 hover:scale-125 cursor-pointer"
                    >
                      <rect
                        x={lp.x - 8}
                        y={lp.y - 8}
                        width="16"
                        height="16"
                        rx="4"
                        ry="4"
                        fill={lp.leaf.alive ? '#22c55e35' : '#ef444435'}
                        stroke={lp.leaf.alive ? '#22c55e' : '#ef4444'}
                        strokeWidth="2"
                        filter="url(#nodeShadow)"
                      >
                        <title>{`${lp.leaf.label}\n${lp.leaf.alive ? 'Онлайн' : 'Офлайн'}\nАгент: ${lp.leaf.agentName}${lp.leaf.latency != null ? `\n${lp.leaf.latency} мс` : ''}`}</title>
                      </rect>
                      {/* Точка в центре для IP */}
                      <circle
                        cx={lp.x}
                        cy={lp.y}
                        r="3"
                        fill={lp.leaf.alive ? '#22c55e' : '#ef4444'}
                        opacity="0.9"
                      />
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Легенда */}
        <div className="mt-6 flex flex-wrap justify-center gap-3 text-[10.5px] text-dim">
          <div className="flex items-center gap-2.5 rounded-lg bg-raised/60 px-3.5 py-2 border border-line shadow-sm">
            <div className="h-4 w-4 rounded bg-blu/30 border-2 border-blu" />
            <span>Агент онлайн</span>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg bg-raised/60 px-3.5 py-2 border border-line shadow-sm">
            <div className="h-4 w-4 rounded bg-crit/30 border-2 border-crit" />
            <span>Агент офлайн</span>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg bg-raised/60 px-3.5 py-2 border border-line shadow-sm">
            <div className="h-3 w-3 rounded bg-ok border border-ok" />
            <span>IP онлайн</span>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg bg-raised/60 px-3.5 py-2 border border-line shadow-sm">
            <div className="h-3 w-3 rounded bg-crit border border-crit" />
            <span>IP офлайн</span>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg bg-raised/60 px-3.5 py-2 border border-line shadow-sm">
            <div className="h-4 w-4 rounded bg-vio/30 border-2 border-vio flex items-center justify-center">
              <Zap className="h-2.5 w-2.5 text-vio" />
            </div>
            <span>Ядро системы</span>
          </div>
        </div>

        {graph.hubs.length === 0 && (
          <div className="py-20 text-center">
            <div className="flex h-20 w-20 mx-auto items-center justify-center rounded-2xl bg-raised/50 border border-line mb-5">
              <Network className="h-10 w-10 text-dim opacity-40" />
            </div>
            <p className="text-[13.5px] text-dim">
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
