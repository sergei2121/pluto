// ─── PLUTO: Редактируемая карта сети v2.0.0 ──────────────────────────────────
// Интерактивная карта с возможностью добавления узлов вручную
// - Ядро системы в центре
// - Добавление агентов, Glances, Ping устройств
// - Создание и сохранение шаблонов карт
// - Перетаскивание узлов с привязкой линий связи
// - Настройка имен, адресов и комментариев
// - Улучшенный интерфейс с градиентами и анимациями

import { useState, useEffect, useRef, useMemo } from 'react';
import { store, useCurrentUser, usePluto, visibleAgents, visibleDevices } from '../lib/store';
import type { Agent, Device } from '../lib/types';
import type { MapNode, MapLink, NetworkMapTemplate } from '../types/map';
import { NODE_TYPES } from '../types/map';
import { 
  Plus, Trash2, Save, FolderOpen, Settings, X, Check, 
  Move, Zap, Eye, EyeOff, Search, Filter, ChevronDown,
  Server, Monitor, Wifi, WifiOff, Activity, Camera, Network,
  HardDrive, Router, Database, Shield, Cpu
} from 'lucide-react';
import { cls } from '../lib/util';

interface NodeDragState {
  nodeId: string;
  startX: number;
  startY: number;
  startNodeX: number;
  startNodeY: number;
}

const STORAGE_KEY = 'pluto-network-maps';

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

export default function NetworkMapEditor() {
  const user = useCurrentUser();
  const allAgents = usePluto((s) => visibleAgents(s, user));
  const devices = usePluto((s) => visibleDevices(s, user));
  
  const [maps, setMaps] = useState<NetworkMapTemplate[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [links, setLinks] = useState<MapLink[]>([]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showTemplatesPanel, setShowTemplatesPanel] = useState(false);
  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null);
  const [dragState, setDragState] = useState<NodeDragState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Загрузка карт из localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: NetworkMapTemplate[] = JSON.parse(stored);
        setMaps(parsed);
        if (parsed.length > 0 && !currentMapId) {
          const defaultMap = parsed.find(m => m.isDefault) || parsed[0];
          setCurrentMapId(defaultMap.id);
          setNodes(defaultMap.nodes);
          setLinks(defaultMap.links);
        }
      } else {
        // Создаем карту по умолчанию с ядром
        const defaultMap: NetworkMapTemplate = {
          id: generateId(),
          name: 'Основная карта',
          nodes: [{
            id: 'core-1',
            type: 'core',
            name: 'Ядро системы',
            x: 0,
            y: 0,
            status: 'online',
          }],
          links: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isDefault: true,
        };
        setMaps([defaultMap]);
        setCurrentMapId(defaultMap.id);
        setNodes(defaultMap.nodes);
        setLinks(defaultMap.links);
        localStorage.setItem(STORAGE_KEY, JSON.stringify([defaultMap]));
      }
    } catch (e) {
      console.error('Failed to load maps:', e);
    }
  }, []);

  // Сохранение текущей карты
  const saveCurrentMap = () => {
    if (!currentMapId) return;
    
    setMaps(prev => {
      const updated = prev.map(m => {
        if (m.id === currentMapId) {
          return { ...m, nodes, links, updatedAt: Date.now() };
        }
        return m;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // Автосохранение при изменениях
  useEffect(() => {
    if (currentMapId && nodes.length > 0) {
      const timeout = setTimeout(saveCurrentMap, 1000);
      return () => clearTimeout(timeout);
    }
  }, [nodes, links]);

  // Создание новой карты
  const createNewMap = (name: string) => {
    const newMap: NetworkMapTemplate = {
      id: generateId(),
      name,
      nodes: [{
        id: 'core-' + generateId(),
        type: 'core',
        name: 'Ядро системы',
        x: 0,
        y: 0,
        status: 'online',
      }],
      links: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    setMaps(prev => [...prev, newMap]);
    setCurrentMapId(newMap.id);
    setNodes(newMap.nodes);
    setLinks(newMap.links);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...maps, newMap]));
  };

  // Удаление карты
  const deleteMap = (mapId: string) => {
    if (maps.length <= 1) {
      alert('Нельзя удалить последнюю карту');
      return;
    }
    
    if (!confirm('Удалить эту карту?')) return;
    
    const updated = maps.filter(m => m.id !== mapId);
    setMaps(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    
    if (currentMapId === mapId) {
      setCurrentMapId(updated[0].id);
      setNodes(updated[0].nodes);
      setLinks(updated[0].links);
    }
  };

  // Добавление узла
  const addNode = (type: MapNode['type'], data?: Partial<MapNode>) => {
    const nodeDef = NODE_TYPES[type];
    const newNode: MapNode = {
      id: `${type}-${generateId()}`,
      type,
      name: data?.name || nodeDef.label,
      address: data?.address,
      x: data?.x ?? (-pan.x + (containerRef.current?.clientWidth || 800) / 2) / zoom,
      y: data?.y ?? (-pan.y + (containerRef.current?.clientHeight || 600) / 2) / zoom,
      status: 'unknown',
      ...data,
    };
    
    setNodes(prev => [...prev, newNode]);
    
    // Автоматически создаем связь с ядром если это не ядро
    if (type !== 'core') {
      const coreNode = nodes.find(n => n.type === 'core');
      if (coreNode) {
        setLinks(prev => [...prev, {
          id: `link-${generateId()}`,
          source: coreNode.id,
          target: newNode.id,
          status: 'active',
        }]);
      }
    }
    
    setShowAddPanel(false);
  };

  // Удаление узла
  const deleteNode = (nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setLinks(prev => prev.filter(l => l.source !== nodeId && l.target !== nodeId));
    if (selectedNode?.id === nodeId) {
      setSelectedNode(null);
    }
  };

  // Обновление узла
  const updateNode = (nodeId: string, updates: Partial<MapNode>) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, ...updates } : n));
  };

  // Обработчики перетаскивания
  const handleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    setSelectedNode(node);
    setDragState({
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragState) {
      const dx = (e.clientX - dragState.startX) / zoom;
      const dy = (e.clientY - dragState.startY) / zoom;
      
      updateNode(dragState.nodeId, {
        x: dragState.startNodeX + dx,
        y: dragState.startNodeY + dy,
      });
    } else if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setPan({
        x: pan.x + dx,
        y: pan.y + dy,
      });
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setDragState(null);
    setIsPanning(false);
  };

  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && !selectedNode)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  // Фильтрация доступных узлов для добавления
  const availableAgents = useMemo(() => {
    if (!searchQuery.trim()) return allAgents;
    const query = searchQuery.toLowerCase();
    return allAgents.filter(a => 
      a.name.toLowerCase().includes(query) || 
      a.ip.toLowerCase().includes(query)
    );
  }, [allAgents, searchQuery]);

  const availableDevices = useMemo(() => {
    if (!searchQuery.trim()) return devices;
    const query = searchQuery.toLowerCase();
    return devices.filter(d => 
      d.name.toLowerCase().includes(query) || 
      d.address.toLowerCase().includes(query)
    );
  }, [devices, searchQuery]);

  const currentMap = maps.find(m => m.id === currentMapId);

  return (
    <div className="space-y-4">
      {/* Заголовок */}
      <div className="rise relative overflow-hidden rounded-xl border border-line bg-panel/90 p-5">
        {/* Декоративный градиент */}
        <div className="pointer-events-none absolute inset-0 opacity-20" style={{
          background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.1) 0%, transparent 50%, rgba(6, 182, 212, 0.1) 100%)'
        }} />
        
        <div className="relative flex items-center justify-between">
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink flex items-center gap-2">
              <Network className="h-5 w-5 text-vio" />
              Карта сети · редактор v2.0.0
            </h2>
            <p className="text-[11.5px] text-dim mt-1">
              {currentMap?.name || 'Карта'} • <span className="text-ok">{nodes.length}</span> узлов • <span className="text-blu">{links.length}</span> связей
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Кнопка Сохранить */}
            <button
              onClick={saveCurrentMap}
              className="flex items-center gap-1.5 rounded-lg border border-ok/30 bg-ok/20 px-3 py-1.5 text-[11.5px] font-semibold text-ok hover:bg-ok/30 transition-colors"
              title="Сохранить карту"
            >
              <Save className="h-3.5 w-3.5" />
              Сохранить
            </button>

            {/* Выбор карты */}
            <div className="relative">
              <button
                onClick={() => setShowTemplatesPanel(!showTemplatesPanel)}
                className="flex items-center gap-1.5 rounded-lg border border-vio/30 bg-vio/10 px-3 py-1.5 text-[11.5px] font-semibold text-vio hover:bg-vio/20"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {currentMap?.name || 'Выбрать карту'}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              
              {showTemplatesPanel && (
                <div className="absolute right-0 top-full z-[60] mt-1 min-w-[250px] rounded-lg border border-line bg-panel shadow-xl max-h-[400px] overflow-y-auto">
                  <div className="p-2 border-b border-line sticky top-0 bg-panel z-10">
                    <button
                      onClick={() => {
                        const name = prompt('Название новой карты:');
                        if (name) createNewMap(name);
                        setShowTemplatesPanel(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[11.5px] text-ok hover:bg-ok/10"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Создать карту
                    </button>
                  </div>
                  {maps.map(map => (
                    <div
                      key={map.id}
                      className={cls(
                        'flex items-center justify-between px-3 py-2 text-[11.5px] hover:bg-raised cursor-pointer',
                        currentMapId === map.id ? 'bg-vio/10 text-vio' : 'text-ink'
                      )}
                      onClick={() => {
                        setCurrentMapId(map.id);
                        setNodes(map.nodes);
                        setLinks(map.links);
                        setShowTemplatesPanel(false);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {map.isDefault && <Zap className="h-3 w-3 text-blu" />}
                        {map.name}
                      </div>
                      {!map.isDefault && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMap(map.id);
                          }}
                          className="p-1 text-dim hover:text-crit"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Добавить узел */}
            <button
              onClick={() => setShowAddPanel(!showAddPanel)}
              className="flex items-center gap-1.5 rounded-lg border border-ok/30 bg-ok/10 px-3 py-1.5 text-[11.5px] font-semibold text-ok hover:bg-ok/20"
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить узел
            </button>

            {/* Зум */}
            <div className="flex items-center gap-1 rounded-lg border border-line bg-raised px-2 py-1">
              <button
                onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
                className="p-1 text-dim hover:text-ink"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
              <span className="w-12 text-center text-[10px] font-mono">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom(z => Math.min(2, z + 0.1))}
                className="p-1 text-dim hover:text-ink"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Панель карты */}
      <div className="rise relative overflow-hidden rounded-xl border border-line bg-panel/90" style={{ height: '750px' }}>
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)',
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }} />
        
        <div
          ref={containerRef}
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          onMouseDown={handleContainerMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            background: 'radial-gradient(circle at center, rgba(124, 58, 237, 0.03) 0%, transparent 70%)'
          }}
        >
          {/* Сетка фона */}
          <div className="absolute inset-0 opacity-20 pointer-events-none" style={{
            backgroundImage: `
              linear-gradient(rgba(124, 58, 237, 0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(124, 58, 237, 0.1) 1px, transparent 1px)
            `,
            backgroundSize: `${30 * zoom}px ${30 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }} />
          
          <div style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: '100%',
            height: '100%',
            position: 'relative',
          }}>
            {/* Связи - рендерим первыми чтобы были под узлами */}
            <svg className="absolute inset-0 pointer-events-none" style={{ 
              width: '100%', 
              height: '100%',
              overflow: 'visible'
            }}>
              <defs>
                <linearGradient id="linkGradient-active" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0.4" />
                </linearGradient>
                <linearGradient id="linkGradient-inactive" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity="0.4" />
                </linearGradient>
                <linearGradient id="linkGradient-warning" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.4" />
                </linearGradient>
              </defs>
              {links.map(link => {
                const source = nodes.find(n => n.id === link.source);
                const target = nodes.find(n => n.id === link.target);
                if (!source || !target) return null;
                
                const gradientId = link.status === 'active' ? 'url(#linkGradient-active)' : 
                                   link.status === 'warning' ? 'url(#linkGradient-warning)' : 
                                   'url(#linkGradient-inactive)';
                
                return (
                  <g key={link.id}>
                    {/* Тень линии */}
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke="rgba(0,0,0,0.3)"
                      strokeWidth="4"
                      strokeDasharray={link.status === 'inactive' ? '5,5' : 'none'}
                      opacity="0.3"
                      className="transition-all duration-300"
                    />
                    {/* Основная линия */}
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={link.status === 'active' ? '#22c55e' : link.status === 'warning' ? '#f59e0b' : '#ef4444'}
                      strokeWidth="2"
                      strokeDasharray={link.status === 'inactive' ? '5,5' : 'none'}
                      opacity="0.7"
                      className="transition-all duration-300"
                    />
                  </g>
                );
              })}
            </svg>

            {/* Узлы */}
            {nodes.map(node => {
              const def = NODE_TYPES[node.type];
              const isSelected = selectedNode?.id === node.id;
              
              return (
                <div
                  key={node.id}
                  className={cls(
                    'absolute flex flex-col items-center cursor-move transition-all duration-200',
                    isSelected ? 'z-50 scale-110' : 'z-10 hover:scale-105'
                  )}
                  style={{
                    left: node.x,
                    top: node.y,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onMouseDown={(e) => handleMouseDown(e, node.id)}
                >
                  <div
                    className={cls(
                      'flex h-16 w-16 items-center justify-center rounded-full border-2 shadow-lg transition-all',
                      isSelected ? 'scale-110 ring-2 ring-vio' : ''
                    )}
                    style={{
                      backgroundColor: def.color + '20',
                      borderColor: def.color,
                      boxShadow: `0 0 20px ${def.color}40`,
                    }}
                  >
                    <span className="text-2xl">{def.icon}</span>
                  </div>
                  
                  <div className="mt-2 rounded bg-panel/90 px-2 py-1 text-center backdrop-blur border border-line max-w-[150px]">
                    <div className="text-[10px] font-bold text-ink truncate">
                      {node.name}
                    </div>
                    {node.address && (
                      <div className="text-[9px] font-mono text-dim truncate">
                        {node.address}
                      </div>
                    )}
                    {node.comment && (
                      <div className="mt-1 text-[8px] text-dim italic truncate" title={node.comment}>
                        📝 {node.comment}
                      </div>
                    )}
                    {node.metrics && (
                      <div className="mt-1 flex gap-1">
                        {node.metrics.cpu !== undefined && (
                          <span className="text-[8px] text-blu">CPU: {node.metrics.cpu}%</span>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {isSelected && (
                    <div className="mt-2 flex gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const newName = prompt('Имя узла:', node.name);
                          if (newName) updateNode(node.id, { name: newName });
                        }}
                        className="rounded bg-vio/20 p-1 text-vio hover:bg-vio/30"
                        title="Переименовать"
                      >
                        <Settings className="h-3 w-3" />
                      </button>
                      {node.type !== 'core' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNode(node.id);
                          }}
                          className="rounded bg-crit/20 p-1 text-crit hover:bg-crit/30"
                          title="Удалить"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Подсказка */}
        <div className="absolute bottom-3 left-3 rounded bg-panel/90 px-3 py-2 text-[10px] text-dim backdrop-blur border border-line">
          <Move className="inline h-3 w-3 mr-1" />
          Перетаскивайте узлы • Колесо мыши: зум • Средняя кнопка: панорама
        </div>
      </div>

      {/* Панель добавления узлов */}
      {showAddPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAddPanel(false)}>
          <div className="w-[500px] max-h-[80vh] overflow-y-auto rounded-xl border border-line bg-panel shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line p-4">
              <h3 className="font-display text-[14px] font-bold text-ink">Добавить узел</h3>
              <button onClick={() => setShowAddPanel(false)} className="p-1 text-dim hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              {/* Поиск */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Поиск агентов и устройств..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-line bg-raised px-3 py-2 pl-9 text-[12px] text-ink focus:border-vio/50 focus:outline-none"
                />
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
              </div>

              {/* Типы узлов */}
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Типы узлов</h4>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(NODE_TYPES) as Array<keyof typeof NODE_TYPES>).map(type => {
                    const def = NODE_TYPES[type];
                    return (
                      <button
                        key={type}
                        onClick={() => addNode(type)}
                        className="flex items-center gap-2 rounded-lg border border-line bg-raised p-3 text-left hover:bg-vio/10 hover:border-vio/30 transition-colors"
                      >
                        <span className="text-xl">{def.icon}</span>
                        <div>
                          <div className="text-[11px] font-bold text-ink">{def.label}</div>
                          <div className="text-[9px] text-dim">{def.requiresAddress ? 'Требуется адрес' : 'Без адреса'}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Доступные агенты */}
              {availableAgents.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">PLUTO Агенты</h4>
                  <div className="max-h-[200px] overflow-y-auto space-y-1">
                    {availableAgents.map(agent => (
                      <button
                        key={agent.id}
                        onClick={() => addNode('agent', {
                          name: agent.name,
                          address: agent.ip,
                        })}
                        className="flex w-full items-center gap-2 rounded border border-line bg-raised p-2 text-left hover:bg-ok/10 hover:border-ok/30 transition-colors"
                      >
                        <Server className="h-4 w-4 text-blu" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold text-ink truncate">{agent.name}</div>
                          <div className="text-[9px] font-mono text-dim">{agent.ip}</div>
                        </div>
                        <Plus className="h-3 w-3 text-ok" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Доступные устройства */}
              {availableDevices.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Устройства</h4>
                  <div className="max-h-[200px] overflow-y-auto space-y-1">
                    {availableDevices.map(device => (
                      <button
                        key={device.id}
                        onClick={() => addNode('ping', {
                          name: device.name,
                          address: device.address,
                        })}
                        className="flex w-full items-center gap-2 rounded border border-line bg-raised p-2 text-left hover:bg-blu/10 hover:border-blu/30 transition-colors"
                      >
                        <Monitor className="h-4 w-4 text-vio" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold text-ink truncate">{device.name}</div>
                          <div className="text-[9px] font-mono text-dim">{device.address}</div>
                        </div>
                        <Plus className="h-3 w-3 text-blu" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Панель свойств выбранного узла */}
      {selectedNode && (
        <div className="rise fixed bottom-4 right-4 w-72 overflow-hidden rounded-xl border border-line bg-panel/95 p-4 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-display text-[12px] font-bold text-ink">Свойства узла</h4>
            <button onClick={() => setSelectedNode(null)} className="p-1 text-dim hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="text-[9px] uppercase tracking-[0.1em] text-dim">Имя</label>
              <input
                type="text"
                value={selectedNode.name}
                onChange={(e) => updateNode(selectedNode.id, { name: e.target.value })}
                className="mt-1 w-full rounded border border-line bg-raised px-2 py-1.5 text-[11px] text-ink focus:border-vio/50 focus:outline-none"
              />
            </div>
            
            {selectedNode.type !== 'core' && (
              <div>
                <label className="text-[9px] uppercase tracking-[0.1em] text-dim">Адрес</label>
                <input
                  type="text"
                  value={selectedNode.address || ''}
                  onChange={(e) => updateNode(selectedNode.id, { address: e.target.value })}
                  className="mt-1 w-full rounded border border-line bg-raised px-2 py-1.5 text-[11px] font-mono text-ink focus:border-vio/50 focus:outline-none"
                />
              </div>
            )}
            
            <div>
              <label className="text-[9px] uppercase tracking-[0.1em] text-dim">Комментарий</label>
              <textarea
                value={selectedNode.comment || ''}
                onChange={(e) => updateNode(selectedNode.id, { comment: e.target.value })}
                placeholder="Описание оборудования, характеристики..."
                rows={3}
                className="mt-1 w-full rounded border border-line bg-raised px-2 py-1.5 text-[11px] text-ink focus:border-vio/50 focus:outline-none resize-none"
              />
            </div>
            
            <div>
              <label className="text-[9px] uppercase tracking-[0.1em] text-dim">Тип</label>
              <div className="mt-1 flex items-center gap-2 rounded border border-line bg-raised px-2 py-1.5">
                <span>{NODE_TYPES[selectedNode.type].icon}</span>
                <span className="text-[11px] text-ink">{NODE_TYPES[selectedNode.type].label}</span>
              </div>
            </div>
            
            <div className="pt-2 border-t border-line">
              <button
                onClick={() => deleteNode(selectedNode.id)}
                disabled={selectedNode.type === 'core'}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-crit/30 bg-crit/10 py-1.5 text-[11px] font-semibold text-crit transition-colors hover:bg-crit/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить узел
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
