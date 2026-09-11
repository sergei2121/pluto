// ─── PLUTO: Карта сети v5.0.0 ────────────────────────────────────────────────
// Автоматическая визуализация топологии сети
// Структура: PLUTO → Агенты → Диапазоны пинга → IP пинга
// Отдельная карта: Устройства прямого пинга из PLUTO
// Значок "GL" для агентов с мониторингом Glances

import { useMemo, useState } from 'react';
import { store, useCurrentUser, usePluto, visibleAgents, visibleDevices } from '../lib/store';
import { cls, fmtMs, pingStats } from '../lib/util';
import type { Agent, Device, Tag } from '../lib/types';
import { Wifi, WifiOff, Globe, ChevronDown, Filter, Activity, Network, Zap, Server, Monitor, Cpu, Radio, Gauge } from 'lucide-react';

interface IpNode {
  ip: string;
  alive: boolean;
  latency: number | null;
}

interface RangeNode {
  name: string;
  range: string;
  ips: IpNode[];
  online: number;
  total: number;
}

interface AgentNode {
  agent: Agent;
  online: boolean;
  hasGlances: boolean;
  ranges: RangeNode[];
  totalIps: number;
  onlineIps: number;
}

interface DirectDeviceNode {
  device: Device;
  subnet: string;
}

function buildAgentHierarchy(agents: Agent[]): AgentNode[] {
  return agents.map((a) => {
    const hasGlances = a.glancesUrl && a.glancesUrl.trim() !== '';
    
    // Строим иерархию: Агент → Диапазоны → IP
    const ranges: RangeNode[] = a.targets.map((t) => {
      const results = Array.isArray(t.results) ? t.results : [];
      const ips: IpNode[] = results.map(r => ({
        ip: r.ip,
        alive: r.alive,
        latency: r.latency
      }));
      
      const onlineCount = results.filter(r => r.alive).length;
      
      return {
        name: t.name || t.target,
        range: t.range || t.target,
        ips,
        online: onlineCount,
        total: results.length
      };
    });
    
    const totalIps = ranges.reduce((sum, r) => sum + r.total, 0);
    const onlineIps = ranges.reduce((sum, r) => sum + r.online, 0);
    
    return {
      agent: a,
      online: a.online,
      hasGlances,
      ranges,
      totalIps,
      onlineIps
    };
  });
}

function buildDirectPingHierarchy(devices: Device[]): DirectDeviceNode[] {
  // Фильтруем только устройства типа ping, которые мониторятся напрямую из PLUTO
  return devices
    .filter(d => d.type === 'ping')
    .map(d => {
      const parts = d.address.split('.');
      const subnet = parts.length >= 3 ? parts.slice(0, 3).join('.0/24') : 'other';
      return { device: d, subnet };
    });
}

export default function NetworkMap() {
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const allAgents = usePluto((s) => visibleAgents(s, user));
  const tags = usePluto((s) => s.tags);
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [activeTab, setActiveTab] = useState<'agents' | 'direct'>('agents');

  const agents = useMemo(() => {
    if (selectedTag === 'all') return allAgents;
    return allAgents.filter(a => a.tags.includes(selectedTag));
  }, [allAgents, selectedTag]);

  // Строим иерархии для визуализации
  const agentHierarchy = useMemo(() => buildAgentHierarchy(agents), [agents]);
  const directDevices = useMemo(() => buildDirectPingHierarchy(devices), [devices]);

  const getTagObj = (id: string) => tags.find(t => t.id === id);
  const selectedTagObj = selectedTag !== 'all' ? getTagObj(selectedTag) : null;

  // Размеры холста
  const W = 1600, H = 900;
  const cx = W / 2, cy = H / 2 - 50;
  
  // Радиусы расположения элементов для карты агентов
  const hubR = 340;  // Радиус расположения агентов от центра
  const rangeR = 150;  // Радиус расположения диапазонов от агента
  const ipR = 80;  // Радиус расположения IP от диапазона

  // Позиции агентов по кругу
  const agentPositions = agentHierarchy.map((node, i) => {
    const ang = (i / Math.max(1, agentHierarchy.length)) * Math.PI * 2 - Math.PI / 2;
    return { 
      ...node, 
      x: cx + Math.cos(ang) * hubR, 
      y: cy + Math.sin(ang) * hubR, 
      angle: ang 
    };
  });

  // Группировка устройств прямого пинга по подсетям
  const directSubnets = useMemo(() => {
    const groups: Record<string, DirectDeviceNode[]> = {};
    directDevices.forEach(d => {
      if (!groups[d.subnet]) groups[d.subnet] = [];
      groups[d.subnet].push(d);
    });
    return Object.entries(groups).map(([subnet, devs]) => ({
      subnet,
      devices: devs,
      online: devs.filter(d => d.device.status === 'up').length,
      total: devs.length
    }));
  }, [directDevices]);

  // Позиции устройств прямого пинга
  const directDevicePositions = directSubnets.flatMap((group, groupIdx) => {
    const groupAngle = (groupIdx / Math.max(1, directSubnets.length)) * Math.PI * 2 - Math.PI / 2;
    const groupRadius = 300;
    const groupCx = cx + Math.cos(groupAngle) * groupRadius;
    const groupCy = cy + Math.sin(groupAngle) * groupRadius;
    
    const deviceCount = group.devices.length;
    const angleStep = deviceCount > 1 ? (2 * Math.PI) / deviceCount : 0;
    
    return group.devices.map((d, i) => {
      const angle = deviceCount > 1 ? angleStep * i - Math.PI / 2 : 0;
      const deviceRadius = deviceCount > 1 ? 60 : 0;
      return {
        device: d.device,
        x: groupCx + Math.cos(angle) * deviceRadius,
        y: groupCy + Math.sin(angle) * deviceRadius,
        subnet: group.subnet,
        groupOnline: group.online,
        groupTotal: group.total
      };
    });
  });

  // Сбор всей статистики по IP через агентов
  const allIpResults = useMemo(() => {
    const results: Array<{ ip: string; alive: boolean; latency: number | null; agentName: string; agentId: string }> = [];
    for (const agent of agentHierarchy) {
      for (const range of agent.ranges) {
        for (const ip of range.ips) {
          results.push({
            ip: ip.ip,
            alive: ip.alive,
            latency: ip.latency,
            agentName: agent.agent.name,
            agentId: agent.agent.id
          });
        }
      }
    }
    return results;
  }, [agentHierarchy]);

  const totalUniqueIps = new Set(allIpResults.map(r => `${r.agentId}:${r.ip}`)).size;
  const onlineIps = allIpResults.filter(r => r.alive).length;
  const offlineIps = totalUniqueIps - onlineIps;
  const directOnline = directSubnets.reduce((sum, g) => sum + g.online, 0);
  const directTotal = directSubnets.reduce((sum, g) => sum + g.total, 0);
  const agentsWithGlances = agentHierarchy.filter(a => a.hasGlances).length;

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
              Карта сети v5.0.0
            </h2>
            <p className="text-[11.5px] text-dim mt-1.5">
              автоматическая визуализация топологии{selectedTagObj && ` · тег: ${selectedTagObj.label}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Переключатель вкладок */}
            <div className="flex overflow-hidden rounded-xl border border-line bg-raised/50">
              <button
                onClick={() => setActiveTab('agents')}
                className={`flex items-center gap-2 px-4 py-2 text-[12px] font-semibold transition-all ${activeTab === 'agents' ? 'bg-vio/25 text-ink' : 'text-dim hover:text-mut'}`}
              >
                <Server className="h-4 w-4" />
                Агенты
              </button>
              <button
                onClick={() => setActiveTab('direct')}
                className={`flex items-center gap-2 px-4 py-2 text-[12px] font-semibold transition-all ${activeTab === 'direct' ? 'bg-vio/25 text-ink' : 'text-dim hover:text-mut'}`}
              >
                <Monitor className="h-4 w-4" />
                Прямой пинг
              </button>
            </div>
            
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

        {/* Статистика - разная для вкладок */}
        {activeTab === 'agents' ? (
          <div className="mt-5 grid grid-cols-4 gap-4">
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
            <div className="group relative overflow-hidden rounded-xl border border-line bg-gradient-to-br from-vio/10 to-vio/5 p-4 text-center hover:border-vio/40 hover:shadow-lg hover:shadow-vio/10 transition-all duration-300">
              <div className="flex items-center justify-center gap-2">
                <Gauge className="h-5 w-5 text-vio group-hover:scale-110 transition-transform" />
                <div className="text-[26px] font-bold text-vio">{agentsWithGlances}</div>
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.15em] text-dim mt-2">с GL</div>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-3 gap-4">
            <div className="group relative overflow-hidden rounded-xl border border-line bg-gradient-to-br from-blu/10 to-blu/5 p-4 text-center hover:border-blu/40 hover:shadow-lg hover:shadow-blu/10 transition-all duration-300">
              <div className="flex items-center justify-center gap-2">
                <Monitor className="h-5 w-5 text-blu group-hover:scale-110 transition-transform" />
                <div className="text-[26px] font-bold text-blu">{directTotal}</div>
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.15em] text-dim mt-2">Устройств</div>
            </div>
            <div className="group relative overflow-hidden rounded-xl border border-line bg-gradient-to-br from-ok/10 to-ok/5 p-4 text-center hover:border-ok/40 hover:shadow-lg hover:shadow-ok/10 transition-all duration-300">
              <div className="flex items-center justify-center gap-2">
                <Wifi className="h-5 w-5 text-ok group-hover:scale-110 transition-transform" />
                <div className="text-[26px] font-bold text-ok">{directOnline}</div>
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.15em] text-dim mt-2">онлайн</div>
            </div>
            <div className="group relative overflow-hidden rounded-xl border border-line bg-gradient-to-br from-crit/10 to-crit/5 p-4 text-center hover:border-crit/40 hover:shadow-lg hover:shadow-crit/10 transition-all duration-300">
              <div className="flex items-center justify-center gap-2">
                <WifiOff className="h-5 w-5 text-crit group-hover:scale-110 transition-transform" />
                <div className="text-[26px] font-bold text-crit">{directTotal - directOnline}</div>
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.15em] text-dim mt-2">офлайн</div>
            </div>
          </div>
        )}

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

            {/* Отображение в зависимости от вкладки */}
            {activeTab === 'agents' ? (
              <>
                {/* Связи от ядра к агентам (рисуем первыми чтобы были под узлами) */}
                {agentPositions.map((a) => (
                  <g key={`agent-line-${a.agent.id}`}>
                    {/* Основная линия */}
                    <line
                      x1={cx}
                      y1={cy}
                      x2={a.x}
                      y2={a.y}
                      stroke={a.online ? 'url(#agentLineGradient-online)' : 'url(#agentLineGradient-offline)'}
                      strokeWidth="3"
                      strokeDasharray={a.online ? 'none' : '6,4'}
                      opacity="0.7"
                      className="transition-all duration-500"
                    />
                    {/* Анимированные точки на линии */}
                    {a.online && (
                      <circle r="3" fill="#22c55e" opacity="0.6">
                        <animateMotion 
                          dur="2s" 
                          repeatCount="indefinite"
                          path={`M ${cx} ${cy} L ${a.x} ${a.y}`}
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

                {/* Агенты и их диапазоны с IP */}
                {agentPositions.map((a) => {
                  // Вычисляем позиции диапазонов вокруг агента
                  const rangeCount = a.ranges.length;
                  const rangeAngleStep = rangeCount > 0 ? (2 * Math.PI) / rangeCount : 0;
                  
                  return (
                    <g key={a.agent.id}>
                      {/* Узел агента - шестиугольник */}
                      <g 
                        className="transition-all duration-300 hover:scale-110 cursor-pointer"
                        filter="url(#nodeShadow)"
                      >
                        <rect
                          x={a.x - 24}
                          y={a.y - 24}
                          width="48"
                          height="48"
                          rx="12"
                          ry="12"
                          fill={a.online ? '#22c55e25' : '#ef444425'}
                          stroke={a.online ? '#22c55e' : '#ef4444'}
                          strokeWidth="2.5"
                        >
                          <title>{`${a.agent.name}\n${a.online ? 'Онлайн' : 'Офлайн'}\nДиапазонов: ${rangeCount}\nIP целей: ${a.totalIps}\nОнлайн: ${a.onlineIps}${a.hasGlances ? '\nGL: активен' : ''}`}</title>
                        </rect>
                        
                        {/* Иконка сервера для агента */}
                        <Server className="h-6 w-6" 
                          x={a.x - 12} 
                          y={a.y - 12}
                          style={{ 
                            color: a.online ? '#22c55e' : '#ef4444',
                            filter: 'drop-shadow(0 0 4px currentColor)'
                          }} 
                        />
                        
                        {/* Значок GL если есть Glances мониторинг */}
                        {a.hasGlances && (
                          <g transform={`translate(${a.x + 10}, ${a.y - 10})`}>
                            <circle cx="0" cy="0" r="9" fill="#7c3aed" stroke="#fff" strokeWidth="1.5" />
                            <text x="0" y="4" textAnchor="middle" className="fill-white text-[8px] font-bold">GL</text>
                          </g>
                        )}
                      </g>
                      
                      {/* Подпись агента */}
                      <text 
                        x={a.x} 
                        y={a.y + 46} 
                        textAnchor="middle" 
                        className="fill-ink text-[10px] font-semibold"
                        style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
                      >
                        {a.agent.name.length > 16 ? a.agent.name.substring(0, 14) + '..' : a.agent.name}
                      </text>

                      {/* Диапазоны и IP внутри них */}
                      {a.ranges.map((range, rangeIdx) => {
                        const rangeAngle = rangeAngleStep * rangeIdx - Math.PI / 2;
                        const rangeX = a.x + Math.cos(rangeAngle) * rangeR;
                        const rangeY = a.y + Math.sin(rangeAngle) * rangeR;
                        
                        // Позиции IP вокруг диапазона
                        const ipCount = range.ips.length;
                        const ipAngleStep = ipCount > 0 ? (2 * Math.PI) / ipCount : 0;
                        
                        return (
                          <g key={`${a.agent.id}-range-${rangeIdx}`}>
                            {/* Линия от агента к диапазону */}
                            <line
                              x1={a.x}
                              y1={a.y}
                              x2={rangeX}
                              y2={rangeY}
                              stroke="#7c3aed"
                              strokeWidth="1.5"
                              strokeDasharray="4,3"
                              opacity="0.4"
                            />
                            
                            {/* Узел диапазона */}
                            <g
                              className="transition-all duration-300 hover:scale-110 cursor-pointer"
                              filter="url(#nodeShadow)"
                            >
                              <circle
                                cx={rangeX}
                                cy={rangeY}
                                r={Math.min(28, 18 + range.ips.length * 2)}
                                fill={range.online > 0 ? '#3b82f625' : '#ef444425'}
                                stroke={range.online > 0 ? '#3b82f6' : '#ef4444'}
                                strokeWidth="2"
                              >
                                <title>{`${range.name || range.range}\nДиапазон: ${range.range}\nВсего IP: ${range.total}\nОнлайн: ${range.online}`}</title>
                              </circle>
                              <text 
                                x={rangeX} 
                                y={rangeY + 4} 
                                textAnchor="middle" 
                                className="fill-ink text-[8px] font-semibold"
                              >
                                {range.ips.length}
                              </text>
                            </g>
                            
                            {/* Подпись диапазона */}
                            <text 
                              x={rangeX} 
                              y={rangeY + 42} 
                              textAnchor="middle" 
                              className="fill-mut text-[8px]"
                              style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
                            >
                              {(range.name || range.range).length > 14 
                                ? (range.name || range.range).substring(0, 12) + '..' 
                                : (range.name || range.range)}
                            </text>
                            
                            {/* IP адреса вокруг диапазона */}
                            {range.ips.map((ip, ipIdx) => {
                              const ipAngle = ipAngleStep * ipIdx - Math.PI / 2;
                              const ipX = rangeX + Math.cos(ipAngle) * ipR;
                              const ipY = rangeY + Math.sin(ipAngle) * ipR;
                              
                              return (
                                <g 
                                  key={`${a.agent.id}-${rangeIdx}-${ip.ip}`}
                                  className="transition-all duration-300 hover:scale-125 cursor-pointer"
                                >
                                  {/* Линия от диапазона к IP */}
                                  <line
                                    x1={rangeX}
                                    y1={rangeY}
                                    x2={ipX}
                                    y2={ipY}
                                    stroke={ip.alive ? '#22c55e' : '#ef4444'}
                                    strokeWidth="1"
                                    opacity="0.4"
                                  />
                                  
                                  {/* Узел IP */}
                                  <circle
                                    cx={ipX}
                                    cy={ipY}
                                    r="6"
                                    fill={ip.alive ? '#22c55e35' : '#ef444435'}
                                    stroke={ip.alive ? '#22c55e' : '#ef4444'}
                                    strokeWidth="2"
                                    filter="url(#nodeShadow)"
                                  >
                                    <title>{`${ip.ip}\n${ip.alive ? 'Онлайн' : 'Офлайн'}${ip.latency != null ? `\n${ip.latency} мс` : ''}\nДиапазон: ${range.name || range.range}`}</title>
                                  </circle>
                                </g>
                              );
                            })}
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </>
            ) : (
              /* Вкладка прямого пинга */
              <>
                {/* Связи от ядра к группам подсетей */}
                {directSubnets.map((group, groupIdx) => {
                  const groupAngle = (groupIdx / Math.max(1, directSubnets.length)) * Math.PI * 2 - Math.PI / 2;
                  const groupRadius = 280;
                  const groupX = cx + Math.cos(groupAngle) * groupRadius;
                  const groupY = cy + Math.sin(groupAngle) * groupRadius;
                  
                  return (
                    <g key={`direct-group-${group.subnet}`}>
                      <line
                        x1={cx}
                        y1={cy}
                        x2={groupX}
                        y2={groupY}
                        stroke={group.online > 0 ? 'url(#agentLineGradient-online)' : 'url(#agentLineGradient-offline)'}
                        strokeWidth="2.5"
                        strokeDasharray={group.online > 0 ? 'none' : '5,4'}
                        opacity="0.6"
                      />
                    </g>
                  );
                })}
                
                {/* Ядро системы */}
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
                
                {/* Устройства прямого пинга */}
                {directDevicePositions.map((pos, idx) => (
                  <g 
                    key={`direct-${pos.device.id}`}
                    className="transition-all duration-300 hover:scale-125 cursor-pointer"
                    filter="url(#nodeShadow)"
                  >
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r="10"
                      fill={pos.device.status === 'up' ? '#22c55e35' : '#ef444435'}
                      stroke={pos.device.status === 'up' ? '#22c55e' : '#ef4444'}
                      strokeWidth="2.5"
                    >
                      <title>{`${pos.device.name}\nIP: ${pos.device.address}\n${pos.device.status === 'up' ? 'Онлайн' : 'Офлайн'}\nПодсеть: ${pos.subnet}${pos.device.latency != null ? `\n${pos.device.latency} мс` : ''}`}</title>
                    </circle>
                    
                    {/* Иконка монитора для устройства */}
                    <Monitor className="h-4 w-4"
                      x={pos.x - 8}
                      y={pos.y - 8}
                      style={{
                        color: pos.device.status === 'up' ? '#22c55e' : '#ef4444',
                        filter: 'drop-shadow(0 0 4px currentColor)'
                      }}
                    />
                  </g>
                ))}
                
                {/* Группы подсетей - подписи */}
                {directSubnets.map((group, groupIdx) => {
                  const groupAngle = (groupIdx / Math.max(1, directSubnets.length)) * Math.PI * 2 - Math.PI / 2;
                  const groupRadius = 280;
                  const groupX = cx + Math.cos(groupAngle) * groupRadius;
                  const groupY = cy + Math.sin(groupAngle) * groupRadius;
                  
                  return (
                    <g key={`subnet-label-${group.subnet}`}>
                      <circle
                        cx={groupX}
                        cy={groupY}
                        r="35"
                        fill="transparent"
                        stroke="#7c3aed"
                        strokeWidth="1"
                        strokeDasharray="4,4"
                        opacity="0.3"
                      />
                      <text 
                        x={groupX} 
                        y={groupY + 55} 
                        textAnchor="middle" 
                        className="fill-mut text-[9px] font-semibold"
                      >
                        {group.subnet}
                      </text>
                      <text 
                        x={groupX} 
                        y={groupY + 68} 
                        textAnchor="middle" 
                        className="fill-dim text-[8px]"
                      >
                        {group.online}/{group.total}
                      </text>
                    </g>
                  );
                })}
              </>
            )}
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
