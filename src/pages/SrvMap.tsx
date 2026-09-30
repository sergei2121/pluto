// ─── PLUTO: Карта VideoSRV — схема размещения видеосерверов по городу ───────
// Собственная редактируемая карта: узлы (строения/площадки) с привязкой к хашам
// из выпадающего списка (тег "VideoSRV"), связи между узлами и комментарии.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Map as MapIcon, Plus, Trash2, Save, Link2, X, Network, Server, Boxes, MessageSquare, Pencil,
} from 'lucide-react';
import { Panel, Modal, Field, EmptyState } from '../components/ui';
import { api } from '../lib/api';
import { hasVideoSrvTag, useCurrentUser, usePluto, useToasts } from '../lib/store';
import { cls, fmtMs, uid } from '../lib/util';
import type { Agent, SrvLinkKind, SrvMap, SrvMapLink, SrvMapNode, SrvNodeIcon } from '../lib/types';

// Холст карты: крупнее, чтобы умещалось больше узлов (серверы + коммутаторы)
const CANVAS_W = 1400;
const CANVAS_H = 900;
const GRID = 20;

/** Иконки узлов: видеосервер и коммутатор. */
const NODE_ICONS: Record<SrvNodeIcon, { label: string; Icon: typeof Server }> = {
  server: { label: 'Сервер', Icon: Server },
  switch: { label: 'Коммутатор', Icon: Boxes },
};

const LINK_KINDS: Record<SrvLinkKind, { label: string; color: string; dash?: string }> = {
  fiber: { label: 'Оптика', color: '#8f7df0', dash: undefined },
  radio: { label: 'Радиолиния', color: '#5fc6d8', dash: '7 5' },
  lan:   { label: 'LAN / медь', color: '#aeb6d8', dash: '2 4' },
};

/** Статус хаба для цветовой индикации узла. */
function nodeColor(a: Agent | null): string {
  if (!a) return '#8b93b8';          // не привязан — серый
  if (!a.online) return '#e07a80';   // офлайн — красный
  if (a.latency != null && a.latency > 150) return '#dfa65e'; // медленно — жёлтый
  return '#55c795';                  // онлайн — зелёный
}

function snap(v: number): number { return Math.round(v / GRID) * GRID; }
function clampN(v: number, min: number, max: number): number { return Math.min(max, Math.max(min, v)); }

export default function SrvMapPage() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const agentsAll = usePluto((s) => s.agents);
  const tagList = usePluto((s) => s.tags);
  // Список устройств для выпадающего фильтра — только хабы с тегом "VideoSRV"
  // (агентские теги хранятся как метки; сравнение — без учёта регистра, см. hasVideoSrvTag)
  const srvAgents = useMemo(() => agentsAll.filter((a) => hasVideoSrvTag(a.tags, tagList)), [agentsAll, tagList]);
  const agentById = useMemo(() => new Map(agentsAll.map((a) => [a.id, a])), [agentsAll]);

  const [maps, setMaps] = useState<SrvMap[]>([]);
  const [curId, setCurId] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editNode, setEditNode] = useState<SrvMapNode | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<SrvMapLink | null>(null);
  const [viewOnly, setViewOnly] = useState(false); // режим «только просмотр» (для viewer)

  const wrapRef = useRef<HTMLDivElement>(null);

  const cur = maps.find((m) => m.id === curId) || null;

  async function reload(selectFirst = false) {
    try {
      const r = await api.srvMaps();
      const list = Array.isArray(r.maps) ? r.maps : [];
      setMaps(list);
      if (selectFirst || !list.some((m) => m.id === curId)) setCurId(list[0]?.id || '');
    } catch (e) {
      useToasts.push('crit', `Карта VideoSRV: ${e instanceof Error ? e.message : 'ошибка загрузки'}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void reload(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function patchCur(fn: (m: SrvMap) => SrvMap) {
    setMaps((prev) => prev.map((m) => (m.id === curId ? fn(m) : m)));
    setDirty(true);
  }

  // ── операции над картой (локально; на сервер уходит при «Сохранить») ──
  /** Создание узла: видеосервер (привязка к хабу) или коммутатор (добавляется вручную). */
  function makeNode(agentId: string | null, icon: SrvNodeIcon): SrvMapNode {
    const a = agentId ? agentById.get(agentId) || null : null;
    return {
      id: uid('smn'),
      label: a?.name || (icon === 'switch' ? 'Коммутатор' : 'Новый узел'),
      agentId,
      x: snap(CANVAS_W / 2), y: snap(CANVAS_H / 2),
      icon,
      district: '', address: '', address2: '', building: '', secret: '', port: '', comment: '',
    };
  }

  function addNode(agentId: string) {
    placeNode(makeNode(agentId, 'server'));
  }

  /** Добавить коммутатор — узел без привязки к хабу, иконку выбирает пользователь. */
  function addSwitch() {
    placeNode(makeNode(null, 'switch'));
  }

  function placeNode(n: SrvMapNode) {
    patchCur((m) => {
      let { x, y } = n;
      let tries = 0;
      while (m.nodes.some((o) => Math.abs(o.x - x) < GRID * 3 && Math.abs(o.y - y) < GRID * 3) && tries < 40) {
        x = clampN(snap(x + GRID * 3), 30, CANVAS_W - 30);
        if (x >= CANVAS_W - 30) { x = 30; y = clampN(snap(y + GRID * 3), 30, CANVAS_H - 30); }
        tries++;
      }
      return { ...m, nodes: [...m.nodes, { ...n, x, y }] };
    });
    useToasts.push('info', `Узел «${n.label}» добавлен на карту`);
  }

  function moveNode(id: string, x: number, y: number) {
    patchCur((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
  }

  function saveNode(node: SrvMapNode) {
    patchCur((m) => {
      const exists = m.nodes.some((n) => n.id === node.id);
      return {
        ...m,
        nodes: exists ? m.nodes.map((n) => (n.id === node.id ? node : n)) : [...m.nodes, node],
        // если удалили привязку — связи остаются, просто узел станет серым
      };
    });
    setEditNode(null);
  }

  function deleteNode(id: string) {
    patchCur((m) => ({
      ...m,
      nodes: m.nodes.filter((n) => n.id !== id),
      links: m.links.filter((l) => l.from !== id && l.to !== id),
    }));
    if (linkFrom === id) setLinkFrom(null);
  }

  function startLink(fromId: string) {
    if (!isAdmin || viewOnly) return;
    if (linkFrom === null) { setLinkFrom(fromId); useToasts.push('info', 'Выберите второй узел для связи'); return; }
    if (linkFrom === fromId) { setLinkFrom(null); return; }
    const dup = cur?.links.some((l) => (l.from === linkFrom && l.to === fromId) || (l.from === fromId && l.to === linkFrom));
    if (dup) { setLinkFrom(null); useToasts.push('warn', 'Связь между этими узлами уже есть'); return; }
    setLinkDraft({ id: uid('sml'), from: linkFrom, to: fromId, kind: 'fiber', label: '', portFrom: '', portTo: '', comment: '' });
    setLinkFrom(null);
  }

  function saveLink(link: SrvMapLink) {
    patchCur((m) => ({
      ...m,
      links: m.links.some((l) => l.id === link.id)
        ? m.links.map((l) => (l.id === link.id ? link : l))
        : [...m.links, link],
    }));
    setLinkDraft(null);
  }

  function deleteLink(id: string) {
    patchCur((m) => ({ ...m, links: m.links.filter((l) => l.id !== id) }));
  }

  // ── создание/удаление карт ──
  async function createMap() {
    const name = window.prompt('Название новой карты:', 'Карта видеосерверов');
    if (!name) return;
    setSaving(true);
    try {
      const m = await api.saveSrvMap({ name, nodes: [], links: [] });
      setMaps((prev) => [...prev, m]);
      setCurId(m.id);
      setDirty(false);
      useToasts.push('ok', `Карта «${m.name}» создана`);
    } catch (e) {
      useToasts.push('crit', e instanceof Error ? e.message : 'ошибка создания карты');
    } finally { setSaving(false); }
  }

  async function removeMap() {
    if (!cur) return;
    if (!window.confirm(`Удалить карту «${cur.name}»? Действие необратимо.`)) return;
    try {
      await api.deleteSrvMap(cur.id);
      setDirty(false);
      await reload(true);
      useToasts.push('info', 'Карта удалена');
    } catch (e) {
      useToasts.push('crit', e instanceof Error ? e.message : 'ошибка удаления');
    }
  }

  async function saveMap() {
    if (!cur) return;
    setSaving(true);
    try {
      const saved = await api.saveSrvMap(cur);
      setMaps((prev) => prev.map((m) => (m.id === saved.id ? saved : m)));
      setDirty(false);
      useToasts.push('ok', 'Карта сохранена');
    } catch (e) {
      useToasts.push('crit', e instanceof Error ? e.message : 'ошибка сохранения');
    } finally { setSaving(false); }
  }

  // ── drag узлов ──
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  function onNodePointerDown(e: React.PointerEvent, id: string) {
    if (!isAdmin || viewOnly) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id, moved: false };
  }

  // авто-сохранение позиции после перетаскивания — по желанию пользователя кнопкой «Сохранить»

  const nodeById = useMemo(() => new Map((cur?.nodes || []).map((n) => [n.id, n])), [cur]);

  // ── зум/панорамирование холста (колесо — зум вокруг курсора, перетаскивание фона — панорама) ──
  // масштаб по умолчанию 100% (BASE_ZOOM), кнопки +/− изменяют масштаб на 50% относительно текущего
  const BASE_ZOOM = 1;
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3.5;
  const [zoom, setZoom] = useState(BASE_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const zoomRef = useRef(BASE_ZOOM);
  zoomRef.current = zoom;
  const curRef = useRef(cur);
  curRef.current = cur;

  function resetView() { setZoom(BASE_ZOOM); setPan({ x: 0, y: 0 }); }

  function onWheel(e: React.WheelEvent) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const z0 = zoomRef.current;
    const z1 = clampN(z0 * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(z1 - z0) < 0.001) return;
    e.preventDefault();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    setPan((p) => ({
      x: clampN(fx * rect.width - ((fx * rect.width - p.x) / z0) * z1, rect.width * (1 - z1), 0),
      y: clampN(fy * rect.height - ((fy * rect.height - p.y) / z0) * z1, rect.height * (1 - z1), 0),
    }));
    setZoom(z1);
  }

  function onBgPointerDown(e: React.PointerEvent) {
    if (!wrapRef.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
  }
  function onCanvasPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (d && wrapRef.current && curRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      const px = ((e.clientX - rect.left - pan.x) / (rect.width * zoom)) * CANVAS_W;
      const py = ((e.clientY - rect.top - pan.y) / (rect.height * zoom)) * CANVAS_H;
      d.moved = true;
      moveNode(d.id, clampN(snap(px), 20, CANVAS_W - 20), clampN(snap(py), 20, CANVAS_H - 20));
      return;
    }
    const p = panRef.current;
    if (p && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setPan({
        x: clampN(p.ox + (e.clientX - p.sx), rect.width * (1 - zoom), 0),
        y: clampN(p.oy + (e.clientY - p.sy), rect.height * (1 - zoom), 0),
      });
    }
  }
  function onCanvasPointerUp() { dragRef.current = null; panRef.current = null; }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* шапка: выбор карты + действия */}
      <Panel
        title="Карта VideoSRV"
        icon={<MapIcon className="h-4 w-4" />}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select value={curId} onChange={(e) => { setCurId(e.target.value); setDirty(false); setLinkFrom(null); }}
              className="inp h-8 max-w-[220px] text-[12.5px]">
              {maps.length === 0 && <option value="">— нет карт —</option>}
              {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {isAdmin && (
              <>
                <button onClick={() => void createMap()} className="btn-ghost h-8"><Plus className="h-3.5 w-3.5" />Новая карта</button>
                {cur && <button onClick={() => void removeMap()} className="btn-ghost h-8 text-crit"><Trash2 className="h-3.5 w-3.5" />Удалить</button>}
                <button onClick={() => setViewOnly((v) => !v)} className={cls('btn-ghost h-8', viewOnly && 'text-warn')}>
                  {viewOnly ? 'Просмотр вкл' : 'Только просмотр'}
                </button>
                <button onClick={() => void saveMap()} disabled={!dirty || saving}
                  className={cls('btn-acc h-8', (!dirty || saving) && 'opacity-50')}>
                  <Save className="h-3.5 w-3.5" />{saving ? 'Сохранение…' : dirty ? 'Сохранить *' : 'Сохранено'}
                </button>
              </>
            )}
          </div>
        }
      >
        {!cur ? (
          loading
            ? <p className="py-8 text-center text-[13px] text-dim">загрузка карт…</p>
            : <EmptyState icon={<MapIcon className="h-6 w-6" />} title="Карт пока нет"
                text={isAdmin
                  ? 'Создайте первую карту видеосерверов и добавьте на неё узлы из списка хабов с тегом «VideoSRV».'
                  : 'Администратор ещё не создал ни одной карты.'}
                action={isAdmin ? <button onClick={() => void createMap()} className="btn-acc"><Plus className="h-4 w-4" />Создать карту</button> : undefined} />
        ) : (
          <div className="space-y-4">
            {/* ХОЛСТ — уменьшен на 30% (70% ширины окна) + зум/панорама */}
            <div className="relative mx-auto aspect-[16/10] overflow-hidden rounded-xl border border-line bg-[#0d1122]"
              style={{ width: 'min(70vw, 1330px)' }}>
              <div ref={wrapRef}
                className="absolute inset-0 cursor-move touch-none select-none"
                onWheel={onWheel}
                onPointerDown={onBgPointerDown}
                onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerLeave={onCanvasPointerUp}>
                <div className="absolute left-0 top-0 origin-top-left"
                  style={{
                    width: `${zoom * 100}%`, height: `${zoom * 100}%`,
                    transform: `translate(${pan.x}px, ${pan.y}px)`,
                    backgroundImage: 'radial-gradient(circle, rgba(143,125,240,.10) 1px, transparent 1px)',
                    backgroundSize: `${GRID / 2}px ${GRID / 2}px`,
                  }}>
                  <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} className="absolute inset-0 h-full w-full">
                    {/* связи */}
                    {cur.links.map((l) => {
                      const a = nodeById.get(l.from); const b = nodeById.get(l.to);
                      if (!a || !b) return null;
                      const meta = LINK_KINDS[l.kind] || LINK_KINDS.lan;
                      const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
                      const ports = [l.portFrom && `${a.label}:${l.portFrom}`, l.portTo && `${b.label}:${l.portTo}`].filter(Boolean).join(' ↔ ');
                      return (
                        <g key={l.id} className="cursor-pointer" onClick={() => isAdmin && !viewOnly && setLinkDraft(l)}>
                          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={meta.color} strokeWidth={2.2} strokeDasharray={meta.dash} opacity={0.85} />
                          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
                          <circle cx={mx} cy={my} r={9} fill="#12162a" stroke={meta.color} strokeWidth={1.5} />
                          <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={9} fill={meta.color} fontWeight={700}>✎</text>
                          {(l.label || '') !== '' && (
                            <text x={mx} y={my - 14} textAnchor="middle" fontSize={10.5} fill="#aeb6d8">{l.label}</text>
                          )}
                          {ports !== '' && (
                            <text x={mx} y={my + 24} textAnchor="middle" fontSize={9.5} fill="#8b93b8">{ports}</text>
                          )}
                        </g>
                      );
                    })}
                    {/* линия-заготовка при выборе пары узлов */}
                    {linkFrom && (
                      <text x={CANVAS_W / 2} y={18} textAnchor="middle" fontSize={12} fill="#dfa65e">
                        Режим связи: кликните второй узел (или тот же — отмена)
                      </text>
                    )}
                  </svg>

                  {/* узлы */}
                  {cur.nodes.map((n) => {
                    const a = n.agentId ? agentById.get(n.agentId) || null : null;
                    const col = nodeColor(a);
                    const selected = linkFrom === n.id;
                    const IconComp = NODE_ICONS[n.icon]?.Icon || Server;
                    return (
                      <div key={n.id}
                        onPointerDown={(e) => onNodePointerDown(e, n.id)}
                        onClick={() => { if (dragRef.current?.moved) return; if (linkFrom) startLink(n.id); else setEditNode(n); }}
                        title={a ? `${a.name} · ${a.ip} · ${a.online ? 'онлайн' : 'офлайн'}` : (n.icon === 'switch' ? 'Коммутатор' : 'Узел без привязки к хабу')}
                        className={cls('absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-grab select-none active:cursor-grabbing',
                          selected && 'animate-pulse')}
                        style={{ left: `${(n.x / CANVAS_W) * 100}%`, top: `${(n.y / CANVAS_H) * 100}%` }}>
                        <div className={cls('flex flex-col items-center gap-1', selected && 'rounded-lg ring-2 ring-warn px-1')}>
                          <span className="relative flex h-6 w-6 items-center justify-center rounded-full border-2 bg-panel"
                            style={{ borderColor: col, boxShadow: `0 0 10px ${col}66` }}>
                            <IconComp className="h-3.5 w-3.5" style={{ color: col }} />
                          </span>
                          {/* только имя узла — прочее (ЖК/офис, ip) не показываем на подписи */}
                          <span className="max-w-[150px] truncate rounded-md border border-line/70 bg-deep/90 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink">
                            {n.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* управление масштабом: шаг ±50% от текущего, по умолчанию 100% */}
              <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-lg border border-line bg-panel/90 p-1 backdrop-blur">
                <button className="btn-ghost h-7 w-7 p-0 text-[14px] leading-none" onClick={() => setZoom((z) => clampN(z * 0.5, ZOOM_MIN, ZOOM_MAX))} title="Уменьшить на 50%">−</button>
                <span className="w-11 text-center font-mono text-[11px] text-mut">{Math.round(zoom * 100)}%</span>
                <button className="btn-ghost h-7 w-7 p-0 text-[14px] leading-none" onClick={() => setZoom((z) => clampN(z * 1.5, ZOOM_MIN, ZOOM_MAX))} title="Увеличить на 50%">+</button>
                <button className="btn-ghost h-7 px-2 text-[11px]" onClick={resetView} title="Сбросить вид">Сброс</button>
              </div>
            </div>

            {/* легенда */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dim">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-ok" />хаб онлайн</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-crit" />хаб офлайн</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-warn" />высокая задержка</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-dim" />без привязки</span>
              <span className="flex items-center gap-1.5"><Server className="h-3.5 w-3.5" />сервер</span>
              <span className="flex items-center gap-1.5"><Boxes className="h-3.5 w-3.5" />коммутатор</span>
              <span className="mx-1 hidden h-3 w-px bg-line sm:block" />
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-6" style={{ background: LINK_KINDS.fiber.color }} />оптика</span>
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-6" style={{ background: `repeating-linear-gradient(90deg, ${LINK_KINDS.radio.color} 0 6px, transparent 6px 10px)` }} />радиолиния</span>
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-6" style={{ background: `repeating-linear-gradient(90deg, ${LINK_KINDS.lan.color} 0 2px, transparent 2px 6px)` }} />LAN</span>
              {isAdmin && !viewOnly && <span className="ml-auto text-[10.5px] text-dim/70">колесо — масштаб · фон — панорама · перетаскивайте узлы · клик — свойства · «Связь» — затем клик по второму узлу</span>}
            </div>

            {/* БОКОВЫЕ ПАНЕЛИ */}
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[300px_minmax(0,1fr)_minmax(0,1fr)]">
              {isAdmin && !viewOnly && (
                <div className="rounded-xl border border-line bg-raised/40 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Добавить устройство (VideoSRV)</p>
                  <AgentPicker agents={srvAgents} usedIds={new Set(cur.nodes.map((n) => n.agentId).filter(Boolean) as string[])} onPick={addNode} />
                  <button onClick={addSwitch} className="btn-ghost mt-2 h-8 w-full justify-center">
                    <Boxes className="h-3.5 w-3.5" />Добавить коммутатор
                  </button>
                  {srvAgents.length === 0 && (
                    <p className="mt-2 text-[11.5px] leading-relaxed text-warn">
                      Нет хабов с тегом «VideoSRV». Присвойте тег хабу в разделе «Хабы», чтобы он появился здесь.
                    </p>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-line bg-raised/40 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">
                  <Network className="h-3.5 w-3.5" />Связи ({cur.links.length})
                </p>
                {cur.links.length === 0 && <p className="text-[12px] text-dim">Пока нет. Нажмите «Связь» под узлом и выберите второй узел.</p>}
                <ul className="scroll-thin max-h-56 space-y-1.5 overflow-y-auto">
                  {cur.links.map((l) => {
                    const a = nodeById.get(l.from); const b = nodeById.get(l.to);
                    const meta = LINK_KINDS[l.kind] || LINK_KINDS.lan;
                    const ports = [l.portFrom && `${a?.label || '?'}:${l.portFrom}`, l.portTo && `${b?.label || '?'}:${l.portTo}`].filter(Boolean).join(' ↔ ');
                    return (
                      <li key={l.id} className="flex items-center gap-2 rounded-lg border border-line/60 bg-panel/60 px-2 py-1.5 text-[11.5px]">
                        <i className="h-0.5 w-4 shrink-0" style={{ background: meta.color }} />
                        <button className="min-w-0 flex-1 truncate text-left text-mut hover:text-ink"
                          onClick={() => setLinkDraft(l)} title={[l.comment, ports].filter(Boolean).join(' · ') || undefined}>
                          {a?.label || '?'} ↔ {b?.label || '?'}{l.label ? ` · ${l.label}` : ''}{ports ? ` · ${ports}` : ''}
                        </button>
                        {isAdmin && !viewOnly && (
                          <button onClick={() => deleteLink(l.id)} className="shrink-0 rounded p-1 text-dim hover:text-crit"><X className="h-3 w-3" /></button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="rounded-xl border border-line bg-raised/40 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">
                  <MessageSquare className="h-3.5 w-3.5" />Узлы ({cur.nodes.length})
                </p>
                <ul className="scroll-thin max-h-72 space-y-1.5 overflow-y-auto">
                  {cur.nodes.map((n) => {
                    const a = n.agentId ? agentById.get(n.agentId) || null : null;
                    const NIcon = NODE_ICONS[n.icon]?.Icon || Server;
                    return (
                      <li key={n.id} className="rounded-lg border border-line/60 bg-panel/60 px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: nodeColor(a) }} />
                          <NIcon className="h-3.5 w-3.5 shrink-0 text-dim" />
                          <button className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-ink hover:text-vio" onClick={() => setEditNode(n)}>
                            {n.label}
                          </button>
                          {n.port && <span className="shrink-0 rounded border border-line/70 bg-raised px-1 font-mono text-[9.5px] text-mut">{n.port}</span>}
                          {a && <span className="shrink-0 font-mono text-[10px] text-dim">{fmtMs(a.latency)}</span>}
                        </div>
                        {(n.district || n.address || n.address2 || n.comment) && (
                          <p className="mt-1 line-clamp-2 pl-4 text-[10.5px] leading-snug text-dim">
                            {[n.district, n.address, n.address2].filter(Boolean).join(' · ')}{n.comment ? ` — ${n.comment}` : ''}
                          </p>
                        )}
                      </li>
                    );
                  })}
                  {cur.nodes.length === 0 && <li className="text-[12px] text-dim">Добавьте узлы из списка выше.</li>}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* редактор узла */}
      {editNode && cur && (
        <NodeEditor
          initial={editNode}
          agents={srvAgents}
          isAdmin={isAdmin && !viewOnly}
          onClose={() => setEditNode(null)}
          onSave={(n) => saveNode(n)}
          onDelete={isAdmin && !viewOnly ? () => { deleteNode(editNode.id); setEditNode(null); } : undefined}
          onLink={isAdmin && !viewOnly ? () => { setLinkFrom(editNode.id); setEditNode(null); } : undefined}
        />
      )}

      {/* редактор связи */}
      {linkDraft && cur && (
        <LinkEditor
          initial={linkDraft}
          nodes={cur.nodes}
          isNew={!cur.links.some((l) => l.id === linkDraft.id)}
          onClose={() => setLinkDraft(null)}
          onSave={(l) => saveLink(l)}
          onDelete={isAdmin && !viewOnly ? () => { deleteLink(linkDraft.id); setLinkDraft(null); } : undefined}
        />
      )}
    </div>
  );
}

/** Выпадающий список хабов с тегом VideoSRV (уже размещённые помечены). */
function AgentPicker({ agents, usedIds, onPick }: {
  agents: Agent[]; usedIds: Set<string>; onPick: (agentId: string) => void;
}) {
  const [sel, setSel] = useState('');
  return (
    <div className="flex gap-2">
      <select value={sel} onChange={(e) => setSel(e.target.value)} className="inp h-8 flex-1 text-[12.5px]">
        <option value="">— выберите хаб —</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.ip}){usedIds.has(a.id) ? ' — уже на карте' : ''}
          </option>
        ))}
      </select>
      <button disabled={!sel} onClick={() => { if (sel) { onPick(sel); setSel(''); } }}
        className={cls('btn-acc h-8 shrink-0', !sel && 'opacity-50')}>
        <Plus className="h-3.5 w-3.5" />Добавить
      </button>
    </div>
  );
}

function NodeEditor({ initial, agents, isAdmin, onClose, onSave, onDelete, onLink }: {
  initial: SrvMapNode; agents: Agent[]; isAdmin: boolean;
  onClose: () => void; onSave: (n: SrvMapNode) => void; onDelete?: () => void; onLink?: () => void;
}) {
  const [n, setN] = useState<SrvMapNode>({ ...initial });
  const set = <K extends keyof SrvMapNode>(k: K, v: SrvMapNode[K]) => setN((p) => ({ ...p, [k]: v }));
  const linked = agents.find((a) => a.id === n.agentId) || null;
  return (
    <Modal open onClose={onClose} title={`Узел карты · ${initial.label}`} width="max-w-xl">
      <div className="space-y-3">
        <Field label="Название узла"><input className="inp" value={n.label} onChange={(e) => set('label', e.target.value)} placeholder="" /></Field>
        <Field label="Иконка на карте" hint="Коммутатор можно добавить вручную — привязка к хабу не обязательна">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(NODE_ICONS) as SrvNodeIcon[]).map((k) => {
              const Ic = NODE_ICONS[k].Icon;
              return (
                <button key={k} onClick={() => set('icon', k)}
                  className={cls('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition-all',
                    n.icon === k ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-raised/40 text-dim hover:text-mut')}>
                  <Ic className="h-3.5 w-3.5" />{NODE_ICONS[k].label}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="ЖК\\Офис"><input className="inp" value={n.district} onChange={(e) => set('district', e.target.value)} placeholder="" /></Field>
          <Field label="Порт коммутатора" hint="Порт, к которому подключен сервер">
            <input className="inp" value={n.port} onChange={(e) => set('port', e.target.value)} placeholder="Gi1/0/1" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="IP 1"><input className="inp font-mono" value={n.address} onChange={(e) => set('address', e.target.value)} placeholder="10.0.0.1" /></Field>
          <Field label="IP 2"><input className="inp font-mono" value={n.address2} onChange={(e) => set('address2', e.target.value)} placeholder="10.0.0.2" /></Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Логин"><input className="inp" value={n.building} onChange={(e) => set('building', e.target.value)} autoComplete="off" placeholder="" /></Field>
          <Field label="Пароль"><input className="inp" type="password" value={n.secret} onChange={(e) => set('secret', e.target.value)} autoComplete="new-password" placeholder="" /></Field>
        </div>
        <Field label="Видеосервер (хаб с тегом VideoSRV)">
          <select className="inp" value={n.agentId || ''} disabled={!isAdmin}
            onChange={(e) => {
              const id = e.target.value || null;
              const a = id ? agents.find((x) => x.id === id) : null;
              setN((p) => ({ ...p, agentId: id, label: a && !p.label.trim() ? a.name : p.label }));
            }}>
            <option value="">— без привязки —</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.ip})</option>)}
            {n.agentId && !agents.some((a) => a.id === n.agentId) && (
              <option value={n.agentId}>Текущий хаб (нет тега VideoSRV)</option>
            )}
          </select>
          {linked && (
            <span className="mt-1 block text-[11px] text-dim">
              {linked.online ? '● онлайн' : '● офлайн'}{linked.latency != null ? ` · ${fmtMs(linked.latency)}` : ''} · {linked.ip}
            </span>
          )}
        </Field>
        <Field label="Комментарий к серверу" hint="Оборудование, питание, ответственные, особенности монтажа и т.п.">
          <textarea className="inp min-h-[90px] resize-y" value={n.comment} onChange={(e) => set('comment', e.target.value)}
            placeholder="" />
        </Field>

        {isAdmin && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => onSave({ ...n, label: n.label.trim() || 'Узел без названия' })} className="btn-acc"><Save className="h-4 w-4" />Применить</button>
            {onLink && <button onClick={onLink} className="btn-ghost"><Link2 className="h-4 w-4" />Связь с другим узлом</button>}
            {onDelete && <button onClick={onDelete} className="btn-ghost ml-auto text-crit"><Trash2 className="h-4 w-4" />Удалить узел</button>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function LinkEditor({ initial, nodes, isNew, onClose, onSave, onDelete }: {
  initial: SrvMapLink; nodes: SrvMapNode[]; isNew: boolean;
  onClose: () => void; onSave: (l: SrvMapLink) => void; onDelete?: () => void;
}) {
  const [l, setL] = useState<SrvMapLink>({ ...initial });
  const a = nodes.find((x) => x.id === l.from); const b = nodes.find((x) => x.id === l.to);
  return (
    <Modal open onClose={onClose} title={isNew ? 'Новая связь' : 'Правка связи'} width="max-w-md">
      <div className="space-y-3">
        <p className="text-[13px] text-mut">{a?.label || '?'} ↔ {b?.label || '?'}</p>
        <Field label="Тип канала">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(LINK_KINDS) as SrvLinkKind[]).map((k) => (
              <button key={k} onClick={() => setL((p) => ({ ...p, kind: k }))}
                className={cls('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition-all',
                  l.kind === k ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-raised/40 text-dim hover:text-mut')}>
                <i className="h-0.5 w-4" style={{ background: LINK_KINDS[k].color }} />{LINK_KINDS[k].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Подпись (скорость, канал)"><input className="inp" value={l.label} onChange={(e) => setL((p) => ({ ...p, label: e.target.value }))} placeholder="" /></Field>
        <Field label="Комментарий">
          <textarea className="inp min-h-[70px] resize-y" value={l.comment} onChange={(e) => setL((p) => ({ ...p, comment: e.target.value }))}
            placeholder="" />
        </Field>
        <div className="flex gap-2 pt-1">
          <button onClick={() => onSave({ ...l, from: l.from, to: l.to })} className="btn-acc"><Pencil className="h-4 w-4" />Сохранить связь</button>
          {onDelete && !isNew && <button onClick={onDelete} className="btn-ghost ml-auto text-crit"><Trash2 className="h-4 w-4" />Удалить</button>}
        </div>
      </div>
    </Modal>
  );
}
