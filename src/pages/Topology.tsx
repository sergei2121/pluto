// ─── PLUTO: топология сети v2.0.1 ────────────────────────────────────────────
// Минималистичный вид: только пингуемые IP через агентов + события статусов справа.
import { useMemo, useState, useEffect } from 'react';
import { store, useCurrentUser, usePluto, visibleAgents, visibleDevices } from '../lib/store';
import { cls, fmtMs, pingStats } from '../lib/util';
import type { Agent, Device, Tag, RelayPingResult } from '../lib/types';
import { Wifi, WifiOff, Globe, ChevronDown, Filter, Activity, Clock } from 'lucide-react';

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
  // ядро → агенты; агент → цели пинга; ядро → одиночные устройства
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

export default function Topology() {
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const allAgents = usePluto((s) => visibleAgents(s, user));
  const tags = usePluto((s) => s.tags);
  const events = usePluto((s) => s.events);
  const [showMap, setShowMap] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [showTagFilter, setShowTagFilter] = useState(false);
  
  // Состояние для отслеживания статусов IP (для генерации событий)
  const [prevIpStatuses, setPrevIpStatuses] = useState<Map<string, { alive: boolean; lastEventTs: number }>>(new Map());
  const [ipEvents, setIpEvents] = useState<IpStatusEvent[]>([]);

  // Фильтрация агентов по тегу
  const agents = useMemo(() => {
    if (selectedTag === 'all') return allAgents;
    return allAgents.filter(a => a.tags.includes(selectedTag));
  }, [allAgents, selectedTag]);

  const graph = useMemo(() => buildGraph(devices, agents), [devices, agents]);

  // Получение объекта тега по ID
  const getTagObj = (id: string) => tags.find(t => t.id === id);
  const selectedTagObj = selectedTag !== 'all' ? getTagObj(selectedTag) : null;

  // Сбор всех пингуемых IP с их статусами
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

  // Генерация событий при изменении статуса IP
  useEffect(() => {
    const now = Date.now();
    const newEvents: IpStatusEvent[] = [];
    const newPrevStatuses = new Map<string, { alive: boolean; lastEventTs: number }>();
    
    // Определяем период опроса (берём среднее из последних опросов агентов, или дефолт 60 сек)
    const pollInterval = 60000; // 60 секунд по умолчанию
    
    for (const result of allIpResults) {
      const key = `${result.agentId}:${result.ip}`;
      const prev = prevIpStatuses.get(key);
      
      if (!prev) {
        // Первое обнаружение IP - создаём событие
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
        // Статус изменился - создаём событие
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
        // Статус не изменился - проверяем, нужно ли повторить событие
        const timeSinceLastEvent = now - prev.lastEventTs;
        if (timeSinceLastEvent >= pollInterval) {
          // Повторяем событие с периодичностью опроса
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
    
    // Удаляем из prevIpStatuses ключи, которых больше нет
    for (const [key, value] of prevIpStatuses.entries()) {
      if (!allIpResults.some(r => `${r.agentId}:${r.ip}` === key)) {
        // IP исчез - можно добавить событие об удалении
      }
    }
    
    if (newEvents.length > 0) {
      // Добавляем новые события в начало списка, ограничиваем 50 последними
      setIpEvents(prev => [...newEvents, ...prev].slice(0, 50));
    }
    
    setPrevIpStatuses(newPrevStatuses);
  }, [allIpResults]);

  const W = 960, H = 640, cx = W / 2, cy = H / 2;
  const hubR = 210; // орбита агентов
  const leafR = 92; // радиус листьев вокруг хаба

  const hubPos = graph.hubs.map((h, i) => {
    const ang = (i / Math.max(1, graph.hubs.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...h, x: cx + Math.cos(ang) * hubR, y: cy + Math.sin(ang) * hubR, ang };
  });

  // Подсчёт уникальных пингуемых IP
  const totalUniqueIps = new Set(allIpResults.map(r => `${r.agentId}:${r.ip}`)).size;
  const onlineIps = allIpResults.filter(r => r.alive).length;
  const offlineIps = totalUniqueIps - onlineIps;

  return (
    <div className="space-y-4">
      {/* Упрощённый вид: только пингуемые IP и события */}
      <div className="rise relative overflow-hidden rounded-xl border border-line bg-panel/90 p-5">
        <div className="pointer-events-none absolute inset-0 nebula" />
        <div className="pointer-events-none absolute inset-0 stars" />
        <div className="relative flex items-center justify-between">
          <div>
            <h2 className="font-display text-[15px] font-bold text-ink">Топология · сводка v2.0.1</h2>
            <p className="text-[11.5px] text-dim">пингуемые IP через агентов{selectedTagObj && ` · тег: ${selectedTagObj.label}`}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Выпадающий список с тегами для фильтрации */}
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

        {/* Статистика только по пингуемым IP */}
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

        {/* Список пингуемых IP через агентов */}
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

      {/* Панель событий справа - статусы IP */}
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
