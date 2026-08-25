// ─── PLUTO: устройства ──────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Plus, Star, Trash2, Zap, Search } from 'lucide-react';
import { Panel, StatusDot, STATUS_META, TypeBadge, Sparkbar, EmptyState, Modal, Drawer, Field, Seg, TimeAgo } from '../components/ui';
import { usePluto, useCurrentUser, visibleDevices, store, useToasts } from '../lib/store';
import { forceCheck } from '../lib/engine';
import { cls, fmtMs } from '../lib/util';
import type { Device, DeviceType } from '../lib/types';
import { DEVICE_TYPE_META, DEVICE_TYPES } from '../lib/types';

export default function Devices() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const allDevices = usePluto((s) => s.devices);
  const tags = usePluto((s) => s.tags);
  const routeParam = usePluto((s) => s.routeParam);
  const devices = useMemo(() => visibleDevices(allDevices, user), [allDevices, user]);

  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | DeviceType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'up' | 'down' | 'degraded'>('all');
  const [modal, setModal] = useState<null | { edit?: Device }>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  // открытие по routeParam: 'new' → модалка, 'down' → фильтр аварий, адрес → панель
  useEffect(() => {
    if (!routeParam) return;
    if (routeParam === 'new') {
      if (isAdmin) setModal({});
    } else if (routeParam === 'down') {
      setStatusFilter('down');
    } else {
      const d = devices.find((x) => x.address === routeParam);
      if (d) setDrawerId(d.id);
    }
  }, [routeParam, isAdmin, devices]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const tagIds = tags.filter((t) => t.label.toLowerCase().includes(query)).map((t) => t.id);
    return devices.filter((d) => {
      if (typeFilter !== 'all' && d.type !== typeFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (query && !(d.name.toLowerCase().includes(query) || d.address.toLowerCase().includes(query) || d.tags.some((t) => tagIds.includes(t)))) return false;
      return true;
    });
  }, [devices, q, typeFilter, statusFilter, tags]);

  const drawerDevice = drawerId ? devices.find((d) => d.id === drawerId) : undefined;

  return (
    <div className="space-y-4">
      <Panel
        title="Устройства" icon={<Zap className="h-4 w-4" />}
        right={isAdmin ? (
          <button className="btn-acc" onClick={() => setModal({})}>
            <Plus className="h-4 w-4" /> Добавить устройство
          </button>
        ) : undefined}
        bodyClass="p-0"
      >
        {/* панель фильтров */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-raised/70 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="IP, имя или тег…"
              className="w-44 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-dim/80" />
          </div>
          <Seg options={[{ v: 'all' as const, label: 'Все типы' }, ...DEVICE_TYPES.map((t) => ({ v: t, label: DEVICE_TYPE_META[t].label }))]} value={typeFilter} onChange={setTypeFilter} />
          <Seg options={[{ v: 'all' as const, label: 'Все' }, { v: 'up' as const, label: 'В сети' }, { v: 'degraded' as const, label: 'Деградация' }, { v: 'down' as const, label: 'Авария' }]} value={statusFilter} onChange={setStatusFilter} />
          <span className="ml-auto font-mono text-[11px] text-dim">{filtered.length} из {devices.length}</span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title={devices.length === 0 ? 'Устройств пока нет' : 'Ничего не найдено'}
            text={devices.length === 0 ? 'Добавьте первое устройство — ping, HTTP, API, RTSP или SIP — с кастомным интервалом.' : 'Попробуйте изменить фильтры или запрос.'}
            action={isAdmin && devices.length === 0 ? (
              <button className="btn-acc" onClick={() => setModal({})}><Plus className="h-4 w-4" /> Добавить устройство</button>
            ) : undefined} />
        ) : (
          <ul>
            {filtered.map((d) => {
              const m = STATUS_META[d.status];
              return (
                <li key={d.id} className="group flex cursor-pointer items-center gap-4 border-b border-line-soft/60 px-4 py-3 transition-colors last:border-0 hover:bg-raised/50" onClick={() => setDrawerId(d.id)}>
                  <StatusDot status={d.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-semibold text-ink">{d.name}</span>
                      {d.favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-warn text-warn" strokeWidth={1.5} />}
                      <TypeBadge t={d.type} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-dim">
                      <span>{d.address}</span>
                      {d.tags.map((tid) => {
                        const t = tags.find((x) => x.id === tid);
                        return t ? <span key={tid} className="rounded px-1.5 py-px text-[9.5px] font-semibold" style={{ background: t.color + '22', color: t.color }}>{t.label}</span> : null;
                      })}
                    </div>
                  </div>
                  <div className="hidden md:block"><Sparkbar data={d.history} height={26} width={130} /></div>
                  <div className="w-20 text-right">
                    <div className={cls('font-mono text-[15px] font-bold tabular-nums', m.text)}>
                      {d.status === 'down' ? 'СБОЙ' : d.checking ? '…' : fmtMs(d.latency)}
                      {d.approx && d.status !== 'down' && !d.checking && <span className="ml-0.5 text-[10px] text-dim">≈</span>}
                    </div>
                    <div className={cls('text-[10px]', m.text)}>{d.checking ? 'опрос…' : m.label}</div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button title="В избранное" onClick={(e) => { e.stopPropagation(); store.toggleDeviceFav(d.id); }} className="rounded-md p-1.5 text-dim hover:bg-raised hover:text-warn">
                        <Star className={cls('h-4 w-4', d.favorite && 'fill-warn text-warn')} />
                      </button>
                      <button title="Удалить" onClick={(e) => { e.stopPropagation(); setConfirmDel(d.id); }} className="rounded-md p-1.5 text-dim hover:bg-raised hover:text-crit">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {modal && <DeviceModal edit={modal.edit} onClose={() => setModal(null)} />}

      <Drawer open={!!drawerDevice} onClose={() => setDrawerId(null)}
        title={drawerDevice ? (
          <div className="flex items-center gap-2.5">
            <StatusDot status={drawerDevice.status} />
            <div>
              <div className="font-display text-[14px] font-bold text-ink">{drawerDevice.name}</div>
              <div className="font-mono text-[11px] text-dim">{drawerDevice.address}</div>
            </div>
          </div>
        ) : null}>
        {drawerDevice && <DeviceDetails d={drawerDevice} tags={tags} isAdmin={!!isAdmin} onEdit={() => { setModal({ edit: drawerDevice }); }} />}
      </Drawer>

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Удалить устройство?" width="max-w-sm">
        <p className="text-[13px] text-mut">Устройство будет удалено из мониторинга вместе с историей проверок.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Отмена</button>
          <button className="btn-danger" onClick={() => { if (confirmDel) { store.removeDevice(confirmDel); setConfirmDel(null); setDrawerId(null); } }}>Удалить</button>
        </div>
      </Modal>
    </div>
  );
}

// ─── Детали устройства ──────────────────────────────────────────────────────

function DeviceDetails({ d, tags, isAdmin, onEdit }: { d: Device; tags: { id: string; label: string; color: string }[]; isAdmin: boolean; onEdit: () => void }) {
  const m = STATUS_META[d.status];
  const [checking, setChecking] = useState(false);

  const runNow = async () => {
    setChecking(true);
    const r = await forceCheck(d.id);
    setChecking(false);
    if (r) useToasts.push(r.ok ? 'ok' : 'warn', r.ok ? `Проверка: ${fmtMs(r.latency)}` : 'Проверка: устройство недоступно');
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-raised/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Статус</div>
          <div className={cls('mt-1 font-display text-[15px] font-bold', m.text)}>{m.label}</div>
        </div>
        <div className="rounded-lg border border-line bg-raised/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Задержка</div>
          <div className={cls('mt-1 font-mono text-[15px] font-bold', m.text)}>{d.status === 'down' ? '—' : fmtMs(d.latency)}{d.approx && d.status !== 'down' ? ' ≈' : ''}</div>
        </div>
        <div className="rounded-lg border border-line bg-raised/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Базовая линия</div>
          <div className="mt-1 font-mono text-[15px] font-bold text-ink">{fmtMs(d.baseline)}</div>
        </div>
        <div className="rounded-lg border border-line bg-raised/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Интервал</div>
          <div className="mt-1 font-mono text-[15px] font-bold text-ink">{d.interval} с</div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-dim">История проверок</div>
        <Sparkbar data={d.history} height={40} width={420} />
      </div>

      <div className="space-y-1.5 font-mono text-[11.5px] text-mut">
        <div className="flex justify-between"><span className="text-dim">Тип</span><span>{DEVICE_TYPE_META[d.type].label}</span></div>
        <div className="flex justify-between"><span className="text-dim">Последняя проверка</span><TimeAgo ts={d.lastCheck} /></div>
        <div className="flex justify-between"><span className="text-dim">Сбоев подряд</span><span>{d.fails}</span></div>
        {d.tags.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-dim">Теги</span>
            <span className="flex gap-1">{d.tags.map((tid) => { const t = tags.find((x) => x.id === tid); return t ? <span key={tid} className="rounded px-1.5 py-px text-[10px]" style={{ background: t.color + '22', color: t.color }}>{t.label}</span> : null; })}</span>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex gap-2 pt-2">
          <button className="btn-acc flex-1" onClick={runNow} disabled={checking}>
            <Zap className="h-4 w-4" /> {checking ? 'Проверка…' : 'Проверить сейчас'}
          </button>
          <button className="btn-ghost" onClick={onEdit}>Изменить</button>
        </div>
      )}
    </div>
  );
}

// ─── Модалка добавления/правки ──────────────────────────────────────────────

function DeviceModal({ edit, onClose }: { edit?: Device; onClose: () => void }) {
  const tags = usePluto((s) => s.tags);
  const settings = usePluto((s) => s.settings);

  const [type, setType] = useState<DeviceType>(edit?.type ?? 'ping');
  const [name, setName] = useState(edit?.name ?? '');
  const [address, setAddress] = useState(edit?.address ?? '');
  const [port, setPort] = useState<string>(edit?.port != null ? String(edit.port) : '');
  const [pathVal, setPathVal] = useState(edit?.path ?? '');
  const [method, setMethod] = useState<'GET' | 'POST'>(edit?.method === 'GET' ? 'GET' : 'POST');
  const [body, setBody] = useState(edit?.body ?? '');
  const [interval, setInterval] = useState<string>(String(edit?.interval ?? settings.intervals.ping));
  const [selTags, setSelTags] = useState<string[]>(edit?.tags ?? []);
  const [err, setErr] = useState<string | null>(null);

  // при смене типа подставляем его интервал по умолчанию (только для нового)
  useEffect(() => {
    if (!edit) setInterval(String(settings.intervals[type] ?? 60));
  }, [type, edit, settings]);

  const save = () => {
    if (!address.trim()) {
      setErr('Укажите адрес (IP, хост или ссылку)');
      return;
    }
    const iv = Math.max(5, parseInt(interval, 10) || 60);
    const payload = {
      name: name.trim() || address.trim(),
      type,
      address: address.trim(),
      port: port ? parseInt(port, 10) : null,
      path: pathVal.trim(),
      method: type === 'api' ? method : null,
      body: type === 'api' ? body : null,
      interval: iv,
      tags: selTags,
    };
    if (edit) store.updateDevice(edit.id, payload);
    else store.addDevice(payload);
    useToasts.push('ok', edit ? 'Устройство обновлено' : 'Устройство добавлено');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={edit ? 'Изменить устройство' : 'Новое устройство'} width="max-w-xl">
      <div className="space-y-4">
        <Field label="Тип проверки">
          <div className="grid grid-cols-5 gap-1.5">
            {DEVICE_TYPES.map((t) => (
              <button key={t} onClick={() => setType(t)}
                className={cls('rounded-lg border px-2 py-2 text-[11.5px] font-bold transition-all', type === t ? 'border-vio/60 bg-vio-deep/40 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                {DEVICE_TYPE_META[t].label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-dim">{DEVICE_TYPE_META[type].desc}</p>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Название"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={type === 'rtsp' || type === 'sip' ? 'Ссылка / URI' : 'IP-адрес или хост'}>
            <input className="inp font-mono" value={address} onChange={(e) => { setAddress(e.target.value); setErr(null); }} />
          </Field>
        </div>

        {(type === 'http' || type === 'api') && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Порт"><input className="inp font-mono" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Путь"><input className="inp font-mono" value={pathVal} onChange={(e) => setPathVal(e.target.value)} /></Field>
          </div>
        )}

        {type === 'api' && (
          <>
            <Field label="Метод">
              <Seg options={[{ v: 'GET' as const, label: 'GET' }, { v: 'POST' as const, label: 'POST' }]} value={method} onChange={setMethod} />
            </Field>
            <Field label="Тело запроса (JSON)"><textarea className="inp min-h-[74px] resize-y font-mono text-[12px]" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          </>
        )}

        <Field label="Интервал опроса, сек" hint="Минимум 5 секунд.">
          <input className="inp font-mono" value={interval} onChange={(e) => setInterval(e.target.value.replace(/\D/g, ''))} />
        </Field>

        {tags.length > 0 && (
          <Field label="Теги">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const on = selTags.includes(t.id);
                return (
                  <button key={t.id} onClick={() => setSelTags((cur) => (on ? cur.filter((x) => x !== t.id) : [...cur, t.id]))}
                    className={cls('rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-all', on ? 'border-transparent' : 'border-line bg-raised/50 text-dim hover:text-mut')}
                    style={on ? { background: t.color + '33', color: t.color, borderColor: t.color + '66' } : undefined}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {err && <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-acc" onClick={save}>{edit ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    </Modal>
  );
}
