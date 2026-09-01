// ─── PLUTO: устройства ───────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Star, Trash2, LayoutGrid, RefreshCw, X } from 'lucide-react';
import { Panel, StatusDot, STATUS_META, Sparkbar, TypeBadge, Modal, Field, Toggle, EmptyState, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts, visibleDevices } from '../lib/store';
import { forceCheck } from '../lib/engine';
import { cls, expandTargets, isTarget, TAG_COLORS } from '../lib/util';
import { DEVICE_TYPES, DEVICE_TYPE_META, type Device, type DeviceType } from '../lib/types';

function DeviceModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Device | null }) {
  const tags = usePluto((s) => s.tags);
  const [name, setName] = useState('');
  const [type, setType] = useState<DeviceType>('ping');
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('');
  const [path, setPath] = useState('');
  const [interval, setIntervalV] = useState(60);
  const [showcase, setShowcase] = useState(false);
  const [selTags, setSelTags] = useState<string[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (initial) {
      setName(initial.name); setType(initial.type); setAddress(initial.address);
      setPort(initial.port != null ? String(initial.port) : ''); setPath(initial.path || '');
      setIntervalV(initial.interval); setShowcase(initial.showcase); setSelTags(initial.tags);
    } else {
      setName(''); setType('ping'); setAddress(''); setPort(''); setPath('');
      setIntervalV(60); setShowcase(false); setSelTags([]);
    }
  }, [open, initial]);

  const save = async () => {
    setErr('');
    if (!address.trim()) return setErr('Укажите адрес');
    if (type === 'ping' && !isTarget(address)) return setErr('Для PING: IP, диапазон 1.2.3.1-10 или подсеть 1.2.3.0/24');
    const body: Partial<Device> = {
      name: name.trim() || address.trim(), type, address: address.trim(),
      port: port ? parseInt(port, 10) : null, path: path.trim(),
      interval: Math.max(5, interval), showcase, tags: selTags,
    };
    try {
      if (initial) await store.updateDevice(initial.id, body);
      else {
        // диапазон разворачиваем в отдельные PING-устройства
        if (type === 'ping' && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address.trim())) {
          const ips = expandTargets(address);
          for (const ip of ips) {
            await store.addDevice({ ...body, type, name: `${body.name} · ${ip}`, address: ip } as never);
          }
          useToasts.push('ok', `Добавлено ${ips.length} устройств из диапазона`);
          onClose();
          return;
        }
        await store.addDevice(body as never);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Изменить устройство' : 'Новое устройство'}>
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Тип проверки</span>
          <div className="flex flex-wrap gap-1.5">
            {DEVICE_TYPES.map((t) => (
              <button key={t} onClick={() => setType(t)}
                className={cls('rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-all',
                  type === t ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}
                title={DEVICE_TYPE_META[t].desc}>
                {DEVICE_TYPE_META[t].label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-dim/80">{DEVICE_TYPE_META[type].desc}</p>
        </div>

        <Field label="Название">
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Сервер 1С" />
        </Field>

        <Field label={type === 'ping' ? 'IP / диапазон / подсеть' : 'Адрес'} hint={type === 'ping' ? 'Один IP, диапазон 192.168.1.10-20 или подсеть 192.168.1.0/24' : undefined}>
          <input className="inp font-mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={type === 'ping' ? '192.168.1.0/24' : '192.168.1.10'} />
        </Field>

        {(type === 'http' || type === 'api') && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Порт"><input className="inp font-mono" value={port} onChange={(e) => setPort(e.target.value)} placeholder="8080" /></Field>
            <Field label="Путь"><input className="inp font-mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/health" /></Field>
          </div>
        )}

        <Field label="Интервал опроса, сек">
          <input className="inp font-mono" type="number" min={5} value={interval} onChange={(e) => setIntervalV(parseInt(e.target.value, 10) || 60)} />
        </Field>

        <div className="flex items-center justify-between rounded-lg border border-line bg-raised/40 px-4 py-3">
          <div>
            <p className="text-[13px] font-semibold text-ink">На публичной витрине</p>
            <p className="mt-0.5 text-[11px] text-dim">Статус виден без входа на отдельном порту</p>
          </div>
          <Toggle checked={showcase} onChange={setShowcase} />
        </div>

        {tags.length > 0 && (
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Теги</span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const on = selTags.includes(t.id);
                return (
                  <button key={t.id} onClick={() => setSelTags((s) => on ? s.filter((x) => x !== t.id) : [...s, t.id])}
                    className={cls('rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all', on ? 'text-void' : 'text-mut')}
                    style={{ borderColor: t.color, background: on ? t.color : 'transparent' }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {err && <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg border border-line bg-raised/50 px-4 py-2 text-[13px] font-semibold text-dim transition-colors hover:text-mut">Отмена</button>
          <button onClick={save} className="rounded-lg border border-vio/60 bg-vio/25 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/35">
            {initial ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function Devices() {
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const tags = usePluto((s) => s.tags);
  const routeParam = usePluto((s) => s.routeParam);
  const isAdmin = user?.role === 'admin';

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | Device['status']>('all');
  const [modal, setModal] = useState<{ open: boolean; initial: Device | null }>({ open: false, initial: null });

  useEffect(() => {
    if (routeParam === 'new') { setModal({ open: true, initial: null }); store.nav('devices'); }
    else if (routeParam === 'down') { setFilter('down'); store.nav('devices'); }
  }, [routeParam]);

  const tagById = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return devices.filter((d) => {
      if (filter !== 'all' && d.status !== filter) return false;
      if (!query) return true;
      const tagIds = tags.filter((t) => t.label.toLowerCase().includes(query)).map((t) => t.id);
      return d.name.toLowerCase().includes(query) || d.address.toLowerCase().includes(query) || d.tags.some((t) => tagIds.includes(t));
    });
  }, [devices, q, filter, tags]);

  const counts = useMemo(() => ({
    all: devices.length,
    up: devices.filter((d) => d.status === 'up').length,
    down: devices.filter((d) => d.status === 'down').length,
    degraded: devices.filter((d) => d.status === 'degraded').length,
    unknown: devices.filter((d) => d.status === 'unknown').length,
  }), [devices]);

  return (
    <div className="space-y-4">
      <Panel
        title={`Устройства · ${devices.length}`} icon={<Plus className="h-4 w-4" />}
        right={isAdmin ? (
          <button onClick={() => setModal({ open: true, initial: null })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-vio/50 bg-vio/20 px-3 py-1.5 text-[12.5px] font-bold text-ink transition-all hover:bg-vio/30">
            <Plus className="h-4 w-4" /> Добавить устройство
          </button>
        ) : undefined}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-line bg-raised/70 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: имя, IP или тег…"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-dim/80" />
            {q && <button onClick={() => setQ('')} className="text-dim hover:text-ink"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([['all', `Все ${counts.all}`], ['up', `В сети ${counts.up}`], ['degraded', `Деградация ${counts.degraded}`], ['down', `Авария ${counts.down}`], ['unknown', `Ожидание ${counts.unknown}`]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={cls('rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition-all',
                  filter === v ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {list.length === 0 ? (
          <EmptyState icon={<Search className="h-6 w-6" />} title={devices.length ? 'Ничего не найдено' : 'Устройств пока нет'}
            text={devices.length ? 'Попробуйте другой запрос или сбросьте фильтры.' : 'Добавьте первое устройство — PING, HTTP, API, RTSP или SIP.'}
            action={isAdmin && !devices.length ? (
              <button onClick={() => setModal({ open: true, initial: null })}
                className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">
                Добавить устройство
              </button>
            ) : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line/60 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">
                  <th className="py-2 pr-3">Устройство</th>
                  <th className="py-2 pr-3">Тип</th>
                  <th className="py-2 pr-3">Статус</th>
                  <th className="py-2 pr-3">Задержка</th>
                  <th className="hidden py-2 pr-3 lg:table-cell">История</th>
                  <th className="hidden py-2 pr-3 xl:table-cell">Теги</th>
                  <th className="hidden py-2 pr-3 md:table-cell">Опрос</th>
                  <th className="py-2 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => {
                  const m = STATUS_META[d.status];
                  return (
                    <tr key={d.id} className="border-b border-line/30 transition-colors hover:bg-raised/40">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => store.toggleDeviceFav(d.id)} title="В избранное"
                            className={cls('transition-transform hover:scale-110', d.favorite ? 'text-warn' : 'text-dim/40 hover:text-dim')}>
                            <Star className={cls('h-4 w-4', d.favorite && 'fill-warn')} strokeWidth={1.5} />
                          </button>
                          <div>
                            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                              {d.name}
                              {d.showcase && <span className="rounded border border-mint/40 bg-mint/10 px-1 py-px text-[8.5px] font-bold text-mint" title="На публичной витрине">ВИТРИНА</span>}
                            </div>
                            <div className="font-mono text-[11px] text-dim">{d.address}{d.port ? `:${d.port}` : ''}{d.path || ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3"><TypeBadge t={d.type} /></td>
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2">
                          <StatusDot status={d.status} />
                          <span className={cls('text-[12px] font-semibold', m.text)}>{m.label}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[13px] tabular-nums text-mut">{d.status === 'down' ? '—' : `${d.latency ?? '—'}${d.latency != null ? ' мс' : ''}`}</td>
                      <td className="hidden py-2.5 pr-3 lg:table-cell"><Sparkbar data={d.history} /></td>
                      <td className="hidden py-2.5 pr-3 xl:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {d.tags.map((tid) => tagById[tid] && (
                            <span key={tid} className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                              style={{ borderColor: tagById[tid].color, color: tagById[tid].color }}>
                              {tagById[tid].label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="hidden py-2.5 pr-3 font-mono text-[11px] text-dim md:table-cell">
                        <TimeAgo ts={d.lastCheck} />
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => void forceCheck(d.id)} title="Проверить сейчас"
                            className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-vio">
                            <RefreshCw className={cls('h-4 w-4', d.checking && 'animate-spin')} />
                          </button>
                          {isAdmin && (
                            <>
                              <button onClick={() => store.toggleDeviceShowcase(d.id)} title={d.showcase ? 'Убрать с витрины' : 'На витрину'}
                                className={cls('rounded-md p-1.5 transition-colors hover:bg-raised', d.showcase ? 'text-mint' : 'text-dim hover:text-mint')}>
                                <LayoutGrid className="h-4 w-4" />
                              </button>
                              <button onClick={() => setModal({ open: true, initial: d })} title="Изменить"
                                className="rounded-md px-2 py-1 text-[11px] font-semibold text-dim transition-colors hover:bg-raised hover:text-ink">
                                Изм.
                              </button>
                              <button onClick={() => { if (window.confirm(`Удалить «${d.name}»?`)) void store.removeDevice(d.id); }} title="Удалить"
                                className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-crit">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <DeviceModal open={modal.open} initial={modal.initial} onClose={() => setModal({ open: false, initial: null })} />
    </div>
  );
}
