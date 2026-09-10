// Типы для редактируемой карты топологии

export interface MapNode {
  id: string;
  type: 'core' | 'agent' | 'glances' | 'ping' | 'custom' | 'camera' | 'switch' | 'router' | 'server';
  name: string;
  address?: string;
  x: number;
  y: number;
  status?: 'online' | 'offline' | 'warning' | 'unknown';
  metrics?: {
    cpu?: number;
    memory?: number;
    disk?: number;
    latency?: number;
  };
  templateId?: string;
  comment?: string;
}

export interface MapLink {
  id: string;
  source: string;
  target: string;
  label?: string;
  status?: 'active' | 'inactive' | 'warning';
}

export interface NetworkMapTemplate {
  id: string;
  name: string;
  nodes: MapNode[];
  links: MapLink[];
  createdAt: number;
  updatedAt: number;
  isDefault?: boolean;
}

export interface NodeDefinition {
  type: MapNode['type'];
  label: string;
  icon: string;
  color: string;
  requiresAddress?: boolean;
}

export const NODE_TYPES: Record<MapNode['type'], NodeDefinition> = {
  core: {
    type: 'core',
    label: 'Ядро системы',
    icon: '🛡️',
    color: '#3b82f6',
    requiresAddress: false,
  },
  server: {
    type: 'server',
    label: 'Сервер',
    icon: '🖥️',
    color: '#10b981',
    requiresAddress: true,
  },
  agent: {
    type: 'agent',
    label: 'PLUTO Агент',
    icon: '⚙️',
    color: '#06b6d4',
    requiresAddress: true,
  },
  glances: {
    type: 'glances',
    label: 'Glances Monitor',
    icon: '📊',
    color: '#f59e0b',
    requiresAddress: true,
  },
  switch: {
    type: 'switch',
    label: 'Коммутатор',
    icon: '🔀',
    color: '#8b5cf6',
    requiresAddress: true,
  },
  router: {
    type: 'router',
    label: 'Маршрутизатор',
    icon: '🌐',
    color: '#6366f1',
    requiresAddress: true,
  },
  camera: {
    type: 'camera',
    label: 'IP Камера',
    icon: '📹',
    color: '#ec4899',
    requiresAddress: true,
  },
  ping: {
    type: 'ping',
    label: 'Ping Устройство',
    icon: '📡',
    color: '#14b8a6',
    requiresAddress: true,
  },
  custom: {
    type: 'custom',
    label: 'Пользовательский узел',
    icon: '📌',
    color: '#6b7280',
    requiresAddress: false,
  },
};
