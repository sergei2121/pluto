// ─── PLUTO: Карта сети v5.2.0 ────────────────────────────────────────────────
// Автоматическая визуализация топологии сети
// Структура: PLUTO → Агенты → Диапазоны пинга → IP пинга
// Отдельная карта: Устройства прямого пинга из PLUTO
// Значок "GL" для агентов с мониторингом Glances
// Интерактивные подсказки по клику с детальной информацией
// Цветовая кодировка агентов по тегам
// Модальные окна с подробной информацией об узлах

import { useMemo, useState } from 'react';
import { store, useCurrentUser, usePluto, visibleAgents, visibleDevices } from '../lib/store';
import { cls, fmtMs, pingStats } from '../lib/util';
import type { Agent, Device, Tag } from '../lib/types';
import { Wifi, WifiOff, Globe, ChevronDown, Filter, Activity, Network, Zap, Server, Monitor, Cpu, Radio, Gauge, X, ExternalLink, Clock, TrendingUp } from 'lucide-react';

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

interface SelectedNode {
  type: 'agent' | 'ip' | 'direct';
  agent?: Agent;
  ip?: string;
  alive?: boolean;
  latency?: number | null;
  device?: Device;
  x: number;
  y: number;
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
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [showOfflineOnly, setShowOfflineOnly] = useState(false);

  const agents = useMemo(() => {
    let result = allAgents;
    if (selectedTag !== 'all') {
      result = result.filter(a => a.tags.includes(selectedTag));
    }
    if (showOfflineOnly) {
      result = result.filter(a => !a.online);
    }
    return result;
  }, [allAgents, selectedTag, showOfflineOnly]);

  // Строим иерархии для визуализации
  const agentHierarchy = useMemo(() => buildAgentHierarchy(agents), [agents]);
  const directDevices = useMemo(() => buildDirectPingHierarchy(devices), [devices]);

  const getTagObj = (id: string) => tags.find(t => t.id === id);
  const selectedTagObj = selectedTag !== 'all' ? getTagObj(selectedTag) : null;

  // Получаем цвет тега для агента (первый тег или дефолтный)
  const getAgentColor = (agent: Agent) => {
    if (agent.tags.length === 0) return '#7c3aed'; // фиолетовый по умолчанию
    const tag = getTagObj(agent.tags[0]);
    return tag ? tag.color : '#7c3aed';
  };

  // Функция для форматирования истории пингов в виде графика/статистики
  const renderPingHistory = (history: number[], fails: number) => {
    if (!history || history.length === 0) return <div className="text-dim text-[11px]">Нет данных</div>;
    
    const last100 = history.slice(-100);
    const online = last100.filter(v => v >= 0).length;
    const offline = last100.filter(v => v < 0).length;
    const avgLatency = online > 0 
      ? Math.round(last100.filter(v => v >= 0).reduce((a, b) => a + b, 0) / online) 
      : null;
    
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-dim">Последние 100 проверок:</span>
          <span className="text-ok">{online} онлайн</span>
          <span className="text-crit">{offline} офлайн</span>
        </div>
        {avgLatency && (
          <div className="flex items-center gap-1.5 text-[11px] text-mut">
            <TrendingUp className="h-3 w-3" />
            <span>Средняя задержка: <strong className="text-ink">{avgLatency} мс</strong></span>
          </div>
        )}
        {/* Визуализация истории в виде мини-графика */}
        <div className="flex gap-0.5 h-8 items-end mt-2 overflow-hidden">
          {last100.map((val, idx) => (
            <div
              key={idx}
              className="flex-1 min-w-[2px] rounded-t"
              style={{
                height: val >= 0 ? `${Math.min(100, Math.max(10, (val / 200) * 100))}%` : '4px',
                backgroundColor: val >= 0 ? '#22c55e' : '#ef4444',
                opacity: 0.6 + (idx / last100.length) * 0.4
              }}
              title={val >= 0 ? `${val} мс` : 'Офлайн'}
            />
          ))}
        </div>
      </div>
    );
  };

  // Размеры холста
  const W = 1600, H = 900;
  const cx = W / 2, cy = H / 2 - 50;
  
  // Схема: горизонтальная компоновка
  // PLUTO ядро слева, агенты в центре, диапазоны и IP справа
  const plutoX = 150;  // Позиция ядра PLUTO
  const plutoY = H / 2;
  const agentColumnX = 450;  // Колонка агентов
  const rangeColumnX = 800;  // Колонка диапазонов
  const ipColumnX = 1200;    // Колонка IP адресов
  
  const agentSpacing = Math.min(100, (H - 200) / Math.max(1, agentHierarchy.length + 1));

  // Позиции агентов по вертикали в колонке
  const agentPositions = agentHierarchy.map((node, i) => {
    return { 
      ...node, 
      x: agentColumnX, 
      y: 100 + agentSpacing * (i + 1),
      index: i
    };
  });
  
  // Позиции диапазонов и IP для каждого агента
  const getRangePositions = (agentNode: typeof agentPositions[0]) => {
    const rangeCount = agentNode.ranges.length;
    const rangeSpacing = Math.min(80, (H - 150) / Math.max(1, rangeCount + 1));
    
    return agentNode.ranges.map((range, rangeIdx) => {
      const rangeY = 100 + rangeSpacing * (rangeIdx + 1);
      
      // Позиции IP вокруг диапазона
      const ipCount = range.ips.length;
      const ipAngleStep = ipCount > 0 ? (2 * Math.PI) / ipCount : 0;
      
      return {
        range,
        rangeIdx,
        x: rangeColumnX,
        y: rangeY,
        ips: range.ips.map((ip, ipIdx) => {
          const ipAngle = ipAngleStep * ipIdx - Math.PI / 2;
          const ipRadius = 70;
          return {
            ip,
            ipIdx,
            x: rangeColumnX + ipRadius * Math.cos(ipAngle),
            y: rangeY + ipRadius * Math.sin(ipAngle)
          };
        })
      };
    });
  };

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
              Карта сети v5.2.0
            </h2>
            <p className="text-[11.5px] text-dim mt-1.5">
              автоматическая визуализация топологии{selectedTagObj && ` · тег: ${selectedTagObj.label}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Кнопка "Только офлайн" */}
            <button 
              onClick={() => setShowOfflineOnly(!showOfflineOnly)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-[12px] font-semibold transition-all ${showOfflineOnly ? 'bg-crit/20 border-crit/40 text-crit' : 'border-line bg-raised/50 text-dim hover:text-mut'}`}
            >
              <WifiOff className="h-4 w-4" />
              Только офлайн
            </button>

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
                      x1={plutoX + 40}
                      y1={plutoY}
                      x2={a.x - 30}
                      y2={a.y}
                      stroke={a.online ? 'url(#agentLineGradient-online)' : 'url(#agentLineGradient-offline)'}
                      strokeWidth="2.5"
                      strokeDasharray={a.online ? 'none' : '6,4'}
                      opacity="0.7"
                      className="transition-all duration-500"
                    />
                    {/* Анимированные точки на линии */}
                    {a.online && (
                      <circle r="2.5" fill="#22c55e" opacity="0.6">
                        <animateMotion 
                          dur="4s" 
                          repeatCount="indefinite"
                          path={`M ${plutoX + 40} ${plutoY} L ${a.x - 30} ${a.y}`}
                        />
                      </circle>
                    )}
                  </g>
                ))}

                {/* Ядро системы PLUTO слева - стилизованное под схему */}
                <g filter="url(#coreGlow)">
                  <rect 
                    x={plutoX - 40} 
                    y={plutoY - 40} 
                    width="80" 
                    height="80" 
                    rx="16"
                    ry="16"
                    fill="url(#coreGradient)" 
                    stroke="#7c3aed" 
                    strokeWidth="3"
                    className="transition-all duration-300 hover:scale-105"
                  />
                  <Zap className="h-9 w-9 text-vio" x={plutoX - 18} y={plutoY - 18} style={{ filter: 'drop-shadow(0 0 8px rgba(124, 58, 237, 0.6))' }} />
                </g>
                <text x={plutoX} y={plutoY + 65} textAnchor="middle" className="fill-ink text-[11px] font-bold tracking-[0.15em]">PLUTO</text>
                <text x={plutoX} y={plutoY + 78} textAnchor="middle" className="fill-dim text-[8px] tracking-[0.1em]">ЯДРО</text>

                {/* Агенты и их диапазоны с IP */}
                {agentPositions.map((a) => {
                  const rangePositions = getRangePositions(a);
                  
                  return (
                    <g key={a.agent.id}>
                      {/* Узел агента - прямоугольник со скругленными углами */}
                      <g
                        className="transition-all duration-300 hover:scale-110 cursor-pointer"
                        filter="url(#nodeShadow)"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedNode({ type: 'agent', agent: a.agent, x: a.x, y: a.y });
                        }}
                      >
                        <rect
                          x={a.x - 36}
                          y={a.y - 28}
                          width="72"
                          height="56"
                          rx="14"
                          ry="14"
                          fill={a.online ? '#22c55e25' : '#ef444425'}
                          stroke={getAgentColor(a.agent)}
                          strokeWidth="2.5"
                        >
                          <title>{`${a.agent.name}\n${a.online ? 'Онлайн' : 'Офлайн'}\nДиапазонов: ${a.ranges.length}\nIP целей: ${a.totalIps}\nОнлайн: ${a.onlineIps}${a.hasGlances ? '\nGL: активен' : ''}`}</title>
                        </rect>
                        
                        {/* Иконка сервера для агента */}
                        <Server className="h-7 w-7" 
                          x={a.x - 14} 
                          y={a.y - 14}
                          style={{ 
                            color: a.online ? '#22c55e' : '#ef4444',
                            filter: 'drop-shadow(0 0 4px currentColor)'
                          }} 
                        />
                        
                        {/* Значок GL если есть Glances мониторинг */}
                        {a.hasGlances && (
                          <g transform={`translate(${a.x + 22}, ${a.y - 14})`}>
                            <circle cx="0" cy="0" r="10" fill="#7c3aed" stroke="#fff" strokeWidth="1.5" />
                            <text x="0" y="4" textAnchor="middle" className="fill-white text-[8px] font-bold">GL</text>
                          </g>
                        )}
                      </g>
                      
                      {/* Подпись агента */}
                      <text 
                        x={a.x} 
                        y={a.y + 48} 
                        textAnchor="middle" 
                        className="fill-ink text-[10px] font-semibold"
                        style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
                      >
                        {a.agent.name.length > 14 ? a.agent.name.substring(0, 12) + '..' : a.agent.name}
                      </text>

                      {/* Диапазоны и IP внутри них */}
                      {rangePositions.map((rp) => (
                        <g key={`${a.agent.id}-range-${rp.rangeIdx}`}>
                          {/* Линия от агента к диапазону */}
                          <line
                            x1={a.x + 36}
                            y1={a.y}
                            x2={rp.x - 30}
                            y2={rp.y}
                            stroke="#7c3aed"
                            strokeWidth="1.5"
                            strokeDasharray="4,3"
                            opacity="0.5"
                          />
                          
                          {/* Узел диапазона */}
                          <g
                            className="transition-all duration-300 hover:scale-110 cursor-pointer"
                            filter="url(#nodeShadow)"
                          >
                            <ellipse
                              cx={rp.x}
                              cy={rp.y}
                              rx={Math.min(40, 24 + rp.range.ips.length * 3)}
                              ry="24"
                              fill={rp.range.online > 0 ? '#3b82f625' : '#ef444425'}
                              stroke={rp.range.online > 0 ? '#3b82f6' : '#ef4444'}
                              strokeWidth="2"
                            >
                              <title>{`${rp.range.name || rp.range.range}\nДиапазон: ${rp.range.range}\nВсего IP: ${rp.range.total}\nОнлайн: ${rp.range.online}`}</title>
                            </ellipse>
                            <text 
                              x={rp.x} 
                              y={rp.y + 4} 
                              textAnchor="middle" 
                              className="fill-ink text-[8px] font-semibold"
                            >
                              {rp.range.ips.length}
                            </text>
                          </g>
                          
                          {/* Подпись диапазона */}
                          <text 
                            x={rp.x} 
                            y={rp.y + 40} 
                            textAnchor="middle" 
                            className="fill-mut text-[8px]"
                            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
                          >
                            {(rp.range.name || rp.range.range).length > 16 
                              ? (rp.range.name || rp.range.range).substring(0, 14) + '..' 
                              : (rp.range.name || rp.range.range)}
                          </text>
                          
                          {/* IP адреса вокруг диапазона */}
                          {rp.ips.map((ipData) => (
                            <g 
                              key={`${a.agent.id}-${rp.rangeIdx}-${ipData.ip.ip}`}
                              className="transition-all duration-300 hover:scale-125 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedNode({ type: 'ip', ip: ipData.ip.ip, alive: ipData.ip.alive, latency: ipData.ip.latency, x: ipData.x, y: ipData.y });
                              }}
                            >
                              {/* Линия от диапазона к IP */}
                              <line
                                x1={rp.x}
                                y1={rp.y}
                                x2={ipData.x}
                                y2={ipData.y}
                                stroke={ipData.ip.alive ? '#22c55e' : '#ef4444'}
                                strokeWidth="1"
                                opacity="0.4"
                              />
                              
                              {/* Узел IP */}
                              <circle
                                cx={ipData.x}
                                cy={ipData.y}
                                r="7"
                                fill={ipData.ip.alive ? '#22c55e35' : '#ef444435'}
                                stroke={ipData.ip.alive ? '#22c55e' : '#ef4444'}
                                strokeWidth="2"
                                filter="url(#nodeShadow)"
                              >
                                <title>{`${ipData.ip.ip}\n${ipData.ip.alive ? 'Онлайн' : 'Офлайн'}${ipData.ip.latency != null ? `\n${ipData.ip.latency} мс` : ''}\nДиапазон: ${rp.range.name || rp.range.range}`}</title>
                              </circle>
                            </g>
                          ))}
                        </g>
                      ))}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNode({ type: 'direct', device: pos.device, x: pos.x, y: pos.y });
                    }}
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

        {/* Модальное окно с информацией о выбранном узле */}
        {selectedNode && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setSelectedNode(null)}
          >
            <div 
              className="relative max-w-md w-full mx-4 rounded-2xl border border-line bg-panel shadow-2xl overflow-hidden rise"
              onClick={(e) => e.stopPropagation()}
              style={{
                left: selectedNode.x > W / 2 ? `calc(50% - ${W - selectedNode.x}px)` : `calc(50% + ${selectedNode.x}px)`,
                top: selectedNode.y > H / 2 ? `calc(50% - ${H - selectedNode.y}px)` : `calc(50% + ${selectedNode.y}px)`,
                transform: 'translate(-50%, -50%)'
              }}
            >
              {/* Заголовок модального окна */}
              <div className="flex items-center justify-between p-4 border-b border-line bg-gradient-to-r from-vio/10 to-transparent">
                <div className="flex items-center gap-2.5">
                  {selectedNode.type === 'agent' && (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: `${getAgentColor(selectedNode.agent!)}25` }}>
                      <Server className="h-5 w-5" style={{ color: getAgentColor(selectedNode.agent!) }} />
                    </div>
                  )}
                  {selectedNode.type === 'ip' && (
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${selectedNode.alive ? 'bg-ok/20' : 'bg-crit/20'}`}>
                      <Activity className={`h-5 w-5 ${selectedNode.alive ? 'text-ok' : 'text-crit'}`} />
                    </div>
                  )}
                  {selectedNode.type === 'direct' && (
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${selectedNode.device?.status === 'up' ? 'bg-ok/20' : 'bg-crit/20'}`}>
                      <Monitor className={`h-5 w-5 ${selectedNode.device?.status === 'up' ? 'text-ok' : 'text-crit'}`} />
                    </div>
                  )}
                  <div>
                    <h3 className="font-display text-[14px] font-bold text-ink">
                      {selectedNode.type === 'agent' && selectedNode.agent?.name}
                      {selectedNode.type === 'ip' && selectedNode.ip}
                      {selectedNode.type === 'direct' && selectedNode.device?.name}
                    </h3>
                    <p className="text-[10.5px] text-dim">
                      {selectedNode.type === 'agent' && 'Агент мониторинга'}
                      {selectedNode.type === 'ip' && (selectedNode.alive ? 'Онлайн' : 'Офлайн')}
                      {selectedNode.type === 'direct' && 'Устройство прямого пинга'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised/50 text-dim hover:text-ink hover:bg-raised transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Содержимое модального окна */}
              <div className="p-4 space-y-4">
                {/* Информация об агенте */}
                {selectedNode.type === 'agent' && selectedNode.agent && (
                  <>
                    <div className="rounded-xl border border-line bg-raised/30 p-3.5">
                      <div className="flex items-center gap-2 mb-2">
                        <Globe className="h-4 w-4 text-blu" />
                        <span className="text-[11px] uppercase tracking-[0.1em] text-dim">IP адрес агента</span>
                      </div>
                      <div className="text-[15px] font-mono font-semibold text-ink">{selectedNode.agent.address}</div>
                    </div>

                    {/* Теги агента */}
                    {selectedNode.agent.tags.length > 0 && (
                      <div className="rounded-xl border border-line bg-raised/30 p-3.5">
                        <div className="flex items-center gap-2 mb-2.5">
                          <Filter className="h-4 w-4 text-vio" />
                          <span className="text-[11px] uppercase tracking-[0.1em] text-dim">Теги</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedNode.agent.tags.map(tagId => {
                            const tag = getTagObj(tagId);
                            return tag ? (
                              <a
                                key={tag.id}
                                href={`/?view=devices&tag=${tag.id}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:scale-105"
                                style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40`, borderWidth: '1px' }}
                                onClick={(e) => { e.stopPropagation(); }}
                              >
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                                {tag.label}
                              </a>
                            ) : null;
                          })}
                        </div>
                      </div>
                    )}

                    {/* Glances мониторинг */}
                    {selectedNode.agent.glancesUrl && selectedNode.agent.glancesUrl.trim() !== '' && (
                      <div className="rounded-xl border border-line bg-gradient-to-br from-vio/10 to-vio/5 p-3.5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Gauge className="h-4 w-4 text-vio" />
                            <span className="text-[11px] uppercase tracking-[0.1em] text-dim">Glances мониторинг</span>
                          </div>
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok/20">
                            <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
                          </span>
                        </div>
                        <a
                          href={selectedNode.agent.glancesUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-lg bg-panel/50 px-3 py-2.5 text-[12px] text-vio hover:bg-vio/15 transition-all group"
                        >
                          <span className="truncate">{selectedNode.agent.glancesUrl}</span>
                          <ExternalLink className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                        </a>
                      </div>
                    )}

                    {/* Статистика агента */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-line bg-raised/30 p-3 text-center">
                        <div className="text-[18px] font-bold text-blu">{selectedNode.agent.targets.reduce((sum, t) => sum + (Array.isArray(t.results) ? t.results.length : 0), 0)}</div>
                        <div className="text-[9px] uppercase tracking-[0.1em] text-dim mt-0.5">IP целей</div>
                      </div>
                      <div className="rounded-xl border border-line bg-raised/30 p-3 text-center">
                        <div className="text-[18px] font-bold text-ok">
                          {selectedNode.agent.targets.reduce((sum, t) => sum + (Array.isArray(t.results) ? t.results.filter(r => r.alive).length : 0), 0)}
                        </div>
                        <div className="text-[9px] uppercase tracking-[0.1em] text-dim mt-0.5">Онлайн</div>
                      </div>
                      <div className="rounded-xl border border-line bg-raised/30 p-3 text-center">
                        <div className="text-[18px] font-bold text-crit">
                          {selectedNode.agent.targets.reduce((sum, t) => sum + (Array.isArray(t.results) ? t.results.filter(r => !r.alive).length : 0), 0)}
                        </div>
                        <div className="text-[9px] uppercase tracking-[0.1em] text-dim mt-0.5">Офлайн</div>
                      </div>
                    </div>
                  </>
                )}

                {/* Информация об IP */}
                {selectedNode.type === 'ip' && (
                  <>
                    <div className="rounded-xl border border-line bg-raised/30 p-3.5">
                      <div className="flex items-center gap-2 mb-2">
                        <Activity className={`h-4 w-4 ${selectedNode.alive ? 'text-ok' : 'text-crit'}`} />
                        <span className="text-[11px] uppercase tracking-[0.1em] text-dim">Статус</span>
                      </div>
                      <div className={`text-[16px] font-semibold ${selectedNode.alive ? 'text-ok' : 'text-crit'}`}>
                        {selectedNode.alive ? '● Онлайн' : '● Офлайн'}
                      </div>
                      {selectedNode.latency != null && (
                        <div className="mt-2 text-[13px] text-mut">
                          Задержка: <strong className="text-ink">{selectedNode.latency} мс</strong>
                        </div>
                      )}
                    </div>

                    {/* История пингов для IP */}
                    <div className="rounded-xl border border-line bg-raised/30 p-3.5">
                      <div className="flex items-center gap-2 mb-3">
                        <Clock className="h-4 w-4 text-blu" />
                        <span className="text-[11px] uppercase tracking-[0.1em] text-dim">История пингов</span>
                      </div>
                      {renderPingHistory([], 0)}
                    </div>
                  </>
                )}

                {/* Информация об устройстве прямого пинга */}
                {selectedNode.type === 'direct' && selectedNode.device && (
                  <>
                    <div className="rounded-xl border border-line bg-raised/30 p-3.5">
                      <div className="flex items-center gap-2 mb-2">
                        <Monitor className={`h-4 w-4 ${selectedNode.device.status === 'up' ? 'text-ok' : 'text-crit'}`} />
                        <span className="text-[11px] uppercase tracking-[0.1em] text-dim">Статус</span>
                      </div>
                      <div className={`text-[16px] font-semibold ${selectedNode.device.status === 'up' ? 'text-ok' : 'text-crit'}`}>
                        {selectedNode.device.status === 'up' ? '● Онлайн' : '● Офлайн'}
                      </div>
                      {selectedNode.device.latency != null && (
                        <div className="mt-2 text-[13px] text-mut">
                          Задержка: <strong className="text-ink">{selectedNode.device.latency} мс</strong>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-line bg-raised/30 p-3.5">
                      <div className="flex items-center gap-2 mb-2">
                        <Globe className="h-4 w-4 text-blu" />
                        <span className="text-[11px] uppercase tracking-[0.1em] text-dim">IP адрес</span>
                      </div>
                      <div className="text-[15px] font-mono font-semibold text-ink">{selectedNode.device.address}</div>
                    </div>

                    {/* Теги устройства */}
                    {selectedNode.device.tags.length > 0 && (
                      <div className="rounded-xl border border-line bg-raised/30 p-3.5">
                        <div className="flex items-center gap-2 mb-2.5">
                          <Filter className="h-4 w-4 text-vio" />
                          <span className="text-[11px] uppercase tracking-[0.1em] text-dim">Теги</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedNode.device.tags.map(tagId => {
                            const tag = getTagObj(tagId);
                            return tag ? (
                              <a
                                key={tag.id}
                                href={`/?view=devices&tag=${tag.id}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:scale-105"
                                style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40`, borderWidth: '1px' }}
                                onClick={(e) => { e.stopPropagation(); }}
                              >
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                                {tag.label}
                              </a>
                            ) : null;
                          })}
                        </div>
                      </div>
                    )}

                    {/* История пингов для устройства */}
                    <div className="rounded-xl border border-line bg-raised/30 p-3.5">
                      <div className="flex items-center gap-2 mb-3">
                        <Clock className="h-4 w-4 text-blu" />
                        <span className="text-[11px] uppercase tracking-[0.1em] text-dim">История пингов</span>
                      </div>
                      {renderPingHistory(selectedNode.device.history || [], selectedNode.device.fails || 0)}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

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
            <span>Ядро PLUTO</span>
          </div>
          {showOfflineOnly && (
            <div className="flex items-center gap-2.5 rounded-lg bg-crit/15 px-3.5 py-2 border border-crit/30 shadow-sm">
              <WifiOff className="h-3.5 w-3.5 text-crit" />
              <span className="text-crit font-semibold">Режим: только офлайн</span>
            </div>
          )}
        </div>

        {agentHierarchy.length === 0 && (
          <div className="py-20 text-center">
            <div className="flex h-20 w-20 mx-auto items-center justify-center rounded-2xl bg-raised/50 border border-line mb-5">
              <Network className="h-10 w-10 text-dim opacity-40" />
            </div>
            <p className="text-[13.5px] text-dim">
              {showOfflineOnly 
                ? 'Офлайн агентов не найдено — все агенты работают нормально.' 
                : selectedTag !== 'all' 
                  ? `Агентов с тегом "${selectedTagObj?.label}" не найдено.` 
                  : 'Агентов пока нет — добавьте их на странице «Агенты».'}
            </p>
            {showOfflineOnly && (
              <button
                onClick={() => setShowOfflineOnly(false)}
                className="mt-4 px-4 py-2 rounded-xl bg-vio/20 text-vio font-semibold text-[12px] hover:bg-vio/30 transition-all"
              >
                Показать все агенты
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
