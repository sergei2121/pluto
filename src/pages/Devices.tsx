// ─── PLUTO: устройства ───────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Play, Plus, Search, Server, Star, Trash2, X } from 'lucide-react';
import { Drawer, EmptyState, Field, Modal, Panel, Sparkbar, StatusDot, STATUS_META, TimeAgo, TypeBadge } from '../components/ui';
import { usePluto, useCurrentUser, visibleDevices } from '../lib/store';
import { forceCheck } from '../lib/engine';
import { cls, fmtMs } from '../lib/util';
import { DEVICE_TYPES, DEVICE_TYPE_META, type Device, type DeviceStatus, type DeviceType } from '../lib/types';

const ADDR_LABEL: Record<DeviceType, { label: string }> = {
  ping: { label: 'IP-адрес или хост' },
  http: { label: 'Хост' },
  api: { label: 'Хост или полный URL' },
  rtsp: { label: 'RTSP-ссылка' },
  sip: { label: 'SIP URI' },
};

const STATUS_FILTERS: { v: DeviceStatus | 'all'; label: string }[] = [
  { v: 'all', label: 'Все' },
  { v: 'up', label: 'В сети' },
  { v: 'down', label: 'Авария' },
  { v: 'degraded', label: 'Деградация' },
];

// ─── Модалка добавления/редактирования ──────────────────────────────────────

function DeviceModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Device | null }) {
  const addDevice = usePluto((s) => s.addDevice);
  const updateDevice = usePluto((s) => s.updateDevice);
  const tags = usePluto((s) => s.tags);
  const settings = usePluto((s) => s.settings);

  const [type, setType] = useState<DeviceType>('ping');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('');
  const [path, setPath] = useState('');
  const [method, setMethod] = useState('GET');
  const [body, setBody] = useState('');
  const [interval, setIntervalV] = useState('30');
  const [selTags, setSelTags] = useState<string[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setType(initial.type); setName(initial.name); setAddress(initial.address);
      setPort(initial.port ? String(initial.port) : ''); setPath(initial.path || '');
      setMethod(initial.method || 'GET'); setBody(initial.body || '');
      setIntervalV(String(initial.interval)); setSelTags(initial.tags);
    } else {
      setType('ping'); setName(''); setAddress(''); setPort(''); setPath('');
      setMethod('GET'); setBody(''); setIntervalV(String(settings.intervals.ping)); setSelTags([]);
    }
    setErr('');
  }, [open, initial, settings]);

  useEffect(() => {
    if (!initial) setIntervalV(String(settings.intervals[type] ?? 60));
  }, [type, initial, settings]);

  const submit = () => {
    if (!address.trim()) { setErr('Укажите адрес'); return; }
    const iv = Math.max(5, parseInt(interval, 10) || 60);
    const payload = {
      name, type, address: address.trim(),
      port: port ? parseInt(port, 10) : null,
      path: path.trim(), method: type === 'api' ? method : null,
      body: type === 'api' ? body : null,
      interval: iv, tags: selTags,
    };
    if (initial) updateDevice(initial.id, payload);
    else addDevice(payload);
    onClose();
  };

  const showPort = type === 'http' || type === 'rtsp' || type === 'sip';
  const showPath = type === 'http' || type === 'api';

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Редактировать устройство' : 'Новое устройство'}>
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Тип проверки</span>
          <div className="grid grid-cols-5 gap-1.5">
            {DEVICE_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                title={DEVICE_TYPE_META[t].desc}
                className={cls(
                  'rounded-lg border px-2 py-2 font-mono text-[11px] font-bold tracking-wider transition-all',
                  type === t ? 'border-vio/60 bg-viodeep/40 text-ink' : 'border-line bg-raised/60 text-dim hover:text-mut',
                )}
              >
                {DEVICE_TYPE_META[t].label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-dim">{DEVICE_TYPE_META[type].desc}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Название"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Интервал, сек" hint="минимум 5"><input className="inp font-mono" value={interval} onChange={(e) => setIntervalV(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>

        <Field label={ADDR_LABEL[type].label}>
          <input className="inp font-mono" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <div className={cls('grid gap-3', showPort && showPath ? 'grid-cols-2' : 'grid-cols-1')}>
          {showPort && <Field label="Порт"><input className="inp font-mono" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} /></Field>}
          {showPath && <Field label="Путь"><input className="inp font-mono" value={path} onChange={(e) => setPath(e.target.value)} /></Field>}
        </div>

        {type === 'api' && (
          <>
            <Field label="Метод">
              <div className="flex gap-1.5">
                {['GET', 'POST', 'PUT'].map((m) => (
                  <button key={m} onClick={() => setMethod(m)} className={cls('rounded-lg border px-3 py-1.5 font-mono text-[11px] font-bold', method === m ? 'border-vio/60 bg-viodeep/40 text-ink' : 'border-line bg-raised/60 text-dim')}>
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Тело (JSON)"><textarea className="inp min-h-[74px] resize-y font-mono text-[12px]" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          </>
        )}

        {tags.length > 0 && (
          <Field label="Теги">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const on = selTags.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelTags((s) => (on ? s.filter((x) => x !== t.id) : [...s, t.id]))}
                    className={cls('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-all', on ? 'border-transparent text-[#10101c]' : 'border-line bg-raised/60 text-mut')}
                    style={on ? { background: t.color } : {}}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? '#10101c' : t.color }} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {err && <p className="pop rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-acc" onClick={submit}>{initial ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Панель деталей ─────────────────────────────────────────────────────────

function DeviceDrawer({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (d: Device) => void }) {
  const d = usePluto((s) => s.devices.find((x) => x.id === id));
  const removeDevice = usePluto((s) => s.removeDevice);
  const toggleFav = usePluto((s) => s.toggleDeviceFav);
  const tags = usePluto((s) => s.tags);
  const apiMode = usePluto((s) => s.apiMode);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  if (!d) return <Drawer open={false} onClose={onClose} title={null}><div /></Drawer>;
  const m = STATUS_META[d.status];
  const dTags = tags.filter((t) => d.tags.includes(t.id));

  const checkNow = async () => {
    setBusy(true);
    await forceCheck(d.id);
    setBusy(false);
  };

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <StatusDot status={d.status} />
          <div>
            <div className="font-display text-[15px] font-semibold text-ink">{d.name}</div>
            <div className="font-mono text-[11px] text-dim">{d.address}</div>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Задержка</div>
            <div className={cls('mt-1 font-mono text-[20px] font-bold', m.text)}>{d.status === 'down' ? '—' : fmtMs(d.latency)}</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Базовая</div>
            <div className="mt-1 font-mono text-[20px] font-bold text-mut">{d.baseline ? fmtMs(Math.round(d.baseline)) : '—'}</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Статус</div>
            <div className={cls('mt-1 font-mono text-[15px] font-bold', m.text)}>{m.label}</div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-dim">История проверок</div>
          <Sparkbar data={d.history} height={48} width={440} />
        </div>

        <div className="space-y-1.5 rounded-lg border border-line bg-raised/40 p-3.5 font-mono text-[12px]">
          <div className="flex justify-between"><span className="text-dim">Тип</span><TypeBadge t={d.type} /></div>
          <div className="flex justify-between"><span className="text-dim">Интервал</span><span className="text-mut">{d.interval} с</span></div>
          <div className="flex justify-between"><span className="text-dim">Последняя проверка</span><TimeAgo ts={d.lastCheck} className="text-mut" /></div>
          <div className="flex justify-between"><span className="text-dim">Сбои подряд</span><span className={d.fails > 0 ? 'text-crit' : 'text-mut'}>{d.fails}</span></div>
          <div className="flex justify-between"><span className="text-dim">Источник данных</span><span className={apiMode === 'server' ? 'text-ok' : 'text-warn'}>{apiMode === 'server' ? 'серверное ядро' : 'эмуляция ≈'}</span></div>
        </div>

        {dTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {dTags.map((t) => (
              <span key={t.id} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-[#10101c]" style={{ background: t.color }}>
                {t.label}
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2 border-t border-linesoft pt-4">
          <button className="btn-acc flex-1 justify-center" onClick={checkNow} disabled={busy}>
            <Play className="h-4 w-4" /> {busy ? 'Проверка…' : 'Проверить сейчас'}
          </button>
          <button className="btn-ghost" onClick={() => toggleFav(d.id)} title="Избранное">
            <Star className={cls('h-4 w-4', d.favorite && 'fill-warn text-warn')} />
          </button>
          <button className="btn-ghost" onClick={() => onEdit(d)} title="Редактировать">
            <Pencil className="h-4 w-4" />
          </button>
          {confirmDel ? (
            <button className="btn-ghost border-crit/50 text-crit" onClick={() => { removeDevice(d.id); onClose(); }}>
              <X className="h-4 w-4" /> Точно?
            </button>
          ) : (
            <button className="btn-ghost hover:border-crit/50 hover:text-crit" onClick={() => setConfirmDel(true)} title="Удалить">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ─── Строка устройства ──────────────────────────────────────────────────────

function DeviceRow({ d, delay, onOpen }: { d: Device; delay: number; onOpen: () => void }) {
  const toggleFav = usePluto((s) => s.toggleDeviceFav);
  const tags = usePluto((s) => s.tags);
  const m = STATUS_META[d.status];
  const dTags = tags.filter((t) => d.tags.includes(t.id));
  return (
    <div
      className="rise group flex cursor-pointer items-center gap-3.5 rounded-lg border border-line bg-panel/80 px-4 py-3 transition-all duration-150 hover:-translate-y-px hover:border-vio/40 hover:bg-raised/70"
      style={{ animationDelay: `${delay}ms` }}
      onClick={onOpen}
    >
      <StatusDot status={d.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-ink">{d.name}</span>
          <TypeBadge t={d.type} />
        </div>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-dim">
          <span>{d.address}</span>
          {dTags.map((t) => (
            <span key={t.id} className="flex items-center gap-1 text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
              {t.label}
            </span>
          ))}
        </div>
      </div>
      <Sparkbar data={d.history} height={24} width={100} />
      <div className="w-[84px] text-right">
        <div className={cls('font-mono text-[15px] font-bold tabular-nums', m.text)}>
          {d.status === 'down' ? 'СБОЙ' : d.checking ? '…' : fmtMs(d.latency)}
          {d.approx && d.status !== 'down' && <span className="ml-0.5 text-[10px] text-dim">≈</span>}
        </div>
        <div className={cls('text-[10px]', m.text)}>{m.label}</div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); toggleFav(d.id); }}
        className="rounded-md p-1.5 text-dim transition-all hover:text-warn"
        title="Избранное"
      >
        <Star className={cls('h-4 w-4', d.favorite && 'fill-warn text-warn')} />
      </button>
    </div>
  );
}

// ─── Страница ────────────────────────────────────────────────────────────────

export default function Devices() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const allDevices = usePluto((s) => s.devices);
  const devices = useMemo(() => visibleDevices(allDevices, user), [allDevices, user]);
  const tags = usePluto((s) => s.tags);
  const routeParam = usePluto((s) => s.routeParam);
  const nav = usePluto((s) => s.nav);

  const [status, setStatus] = useState<DeviceStatus | 'all'>('all');
  const [typeF, setTypeF] = useState<DeviceType | 'all'>('all');
  const [tagF, setTagF] = useState<string>('all');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);

  // routeParam: 'new' → модалка, 'down' → фильтр аварии, адрес → панель
  useEffect(() => {
    if (!routeParam) return;
    if (routeParam === 'new') {
      if (isAdmin) { setEditing(null); setModal(true); }
      nav('devices');
    } else if (routeParam === 'down') {
      setStatus('down');
      nav('devices');
    } else {
      const d = devices.find((x) => x.address === routeParam || x.name === routeParam);
      if (d) setDrawer(d.id);
      nav('devices');
    }
  }, [routeParam, isAdmin, devices, nav]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const tagIds = tags.filter((t) => t.label.toLowerCase().includes(query)).map((t) => t.id);
    return devices.filter((d) => {
      if (status !== 'all' && d.status !== status) return false;
      if (typeF !== 'all' && d.type !== typeF) return false;
      if (tagF !== 'all' && !d.tags.includes(tagF)) return false;
      if (query && !(d.name.toLowerCase().includes(query) || d.address.toLowerCase().includes(query) || d.tags.some((t) => tagIds.includes(t)))) return false;
      return true;
    });
  }, [devices, status, typeF, tagF, q, tags]);

  const counts = useMemo(() => ({
    all: devices.length,
    up: devices.filter((d) => d.status === 'up').length,
    down: devices.filter((d) => d.status === 'down').length,
    degraded: devices.filter((d) => d.status === 'degraded').length,
  }), [devices]);

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-raised/60 p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.v}
              onClick={() => setStatus(f.v)}
              className={cls(
                'rounded-md px-3 py-1.5 text-[12px] font-semibold transition-all',
                status === f.v ? 'bg-viodeep/70 text-ink' : 'text-dim hover:text-mut',
              )}
            >
              {f.label}
              <span className="ml-1.5 font-mono text-[10px] opacity-70">{counts[f.v as keyof typeof counts] ?? 0}</span>
            </button>
          ))}
        </div>

        <select className="inp w-auto" value={typeF} onChange={(e) => setTypeF(e.target.value as any)}>
          <option value="all">Все типы</option>
          {DEVICE_TYPES.map((t) => <option key={t} value={t}>{DEVICE_TYPE_META[t].label}</option>)}
        </select>

        {tags.length > 0 && (
          <select className="inp w-auto" value={tagF} onChange={(e) => setTagF(e.target.value)}>
            <option value="all">Все теги</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}

        <div className="relative ml-auto w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
          <input className="inp pl-9" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {isAdmin && (
          <button className="btn-acc" onClick={() => { setEditing(null); setModal(true); }}>
            <Plus className="h-4 w-4" /> Добавить устройство
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Panel title="Реестр устройств" icon={Server} delay={60}>
          <EmptyState
            icon={Server}
            title={devices.length === 0 ? 'Устройств пока нет' : 'Ничего не найдено'}
            text={devices.length === 0
              ? 'Добавьте первое устройство: ping, HTTP, API-команда, RTSP или SIP — с кастомным интервалом и тегами.'
              : 'Попробуйте изменить фильтры или поисковый запрос.'}
            action={isAdmin && devices.length === 0 ? (
              <button className="btn-acc" onClick={() => { setEditing(null); setModal(true); }}>
                <Plus className="h-4 w-4" /> Добавить устройство
              </button>
            ) : undefined}
          />
        </Panel>
      ) : (
        <div className="space-y-2">
          {filtered.map((d, i) => (
            <DeviceRow key={d.id} d={d} delay={Math.min(i * 40, 320)} onOpen={() => setDrawer(d.id)} />
          ))}
        </div>
      )}

      <DeviceModal open={modal} onClose={() => setModal(false)} initial={editing} />
      <DeviceDrawer id={drawer} onClose={() => setDrawer(null)} onEdit={(d) => { setEditing(d); setModal(true); }} />
    </div>
  );
}
