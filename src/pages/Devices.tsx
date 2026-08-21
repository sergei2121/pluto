// ─── PLUTO: управление устройствами ──────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { I } from '../components/icons';
import { AreaChart, Drawer, EmptyState, Field, Modal, Panel, Sparkbar, StatusDot, STATUS_META, TypeBadge, TimeAgo } from '../components/ui';
import { useStore, useToasts, useCurrentUser, visibleDevices } from '../lib/store';
import { forceCheck } from '../lib/engine';
import { cls, fmtMs, timeAgo } from '../lib/util';
import type { Device, DeviceType } from '../lib/types';
import { DEVICE_TYPES, DEVICE_TYPE_META } from '../lib/types';

// ─── Форма устройства ────────────────────────────────────────────────────────

const ADDR_LABEL: Record<DeviceType, { label: string }> = {
  ping: { label: 'IP-адрес или хост' },
  http: { label: 'Хост' },
  api: { label: 'Хост или полный URL' },
  rtsp: { label: 'RTSP-ссылка' },
  sip: { label: 'SIP URI' },
};

function DeviceForm({ initial, onClose }: { initial?: Device; onClose: () => void }) {
  const addDevice = useStore((s) => s.addDevice);
  const updateDevice = useStore((s) => s.updateDevice);
  const settings = useStore((s) => s.settings);
  const tags = useStore((s) => s.tags);
  const toast = useToasts((s) => s.push);

  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<DeviceType>(initial?.type ?? 'ping');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [port, setPort] = useState(initial?.port ? String(initial.port) : '');
  const [path, setPath] = useState(initial?.path ?? '');
  const [method, setMethod] = useState<'GET' | 'POST'>(initial?.method ?? 'GET');
  const [body, setBody] = useState(initial?.body ?? '');
  const [interval, setIntervalS] = useState(String(initial?.interval ?? settings.intervals.ping));
  const [selTags, setSelTags] = useState<string[]>(initial?.tags ?? []);
  const [err, setErr] = useState('');

  const pickType = (t: DeviceType) => {
    setType(t);
    if (!initial) setIntervalS(String(settings.intervals[t]));
  };

  const submit = () => {
    const addr = address.trim();
    if (!addr) { setErr('Укажите адрес устройства'); return; }
    const iv = parseInt(interval, 10);
    if (!iv || iv < 5 || iv > 86400) { setErr('Интервал — от 5 до 86400 секунд'); return; }
    const common = {
      name: name.trim() || addr,
      address: addr,
      port: port ? parseInt(port, 10) || undefined : undefined,
      path: path.trim() || undefined,
      interval: iv,
      tags: selTags,
    };
    if (initial) {
      updateDevice(initial.id, { ...common, type, method, body: body.trim() || undefined });
      toast('ok', `Устройство «${common.name}» обновлено`);
    } else {
      addDevice({ ...common, type, method, body: body.trim() || undefined });
      toast('ok', `Устройство «${common.name}» добавлено — первая проверка в течение нескольких секунд`);
    }
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Тип проверки</span>
        <div className="grid grid-cols-5 gap-1.5">
          {DEVICE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => pickType(t)}
              title={DEVICE_TYPE_META[t].label}
              className={cls(
                'rounded-lg border px-1 py-2.5 font-mono text-[11px] font-bold tracking-wide transition-all duration-150',
                type === t ? 'border-vio/60 bg-vio-deep/40 text-ink shadow-[0_0_16px_-4px_rgba(143,125,240,.5)]' : 'border-line bg-raised/50 text-dim hover:border-line hover:text-mut',
              )}
            >
              {DEVICE_TYPE_META[t].short}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-dim">{DEVICE_TYPE_META[type].label}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Название">
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className={cls(type === 'ping' || type === 'rtsp' || type === 'sip' ? 'col-span-2' : 'col-span-2')}>
          <Field label={ADDR_LABEL[type].label}>
            <input className="inp font-mono" value={address} onChange={(e) => { setAddress(e.target.value); setErr(''); }} placeholder={ADDR_LABEL[type].ph} />
          </Field>
        </div>
        {(type === 'http' || type === 'api') && (
          <>
            <Field label="Порт">
              <input className="inp font-mono" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} placeholder="8080" inputMode="numeric" />
            </Field>
            <Field label="Путь">
              <input className="inp font-mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/health" />
            </Field>
          </>
        )}
        {type === 'api' && (
          <>
            <Field label="Метод">
              <div className="flex gap-1.5">
                {(['GET', 'POST'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(m)}
                    className={cls('flex-1 rounded-lg border px-2 py-2 font-mono text-[12px] font-bold transition-all', method === m ? 'border-vio/60 bg-vio-deep/40 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Интервал, сек">
              <input className="inp font-mono" value={interval} onChange={(e) => setIntervalS(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
            </Field>
            {method === 'POST' && (
              <div className="col-span-2">
                <Field label="Тело команды (JSON)" hint="Отправляется как payload кастомной команды">
                  <textarea className="inp min-h-[74px] resize-y font-mono text-[12px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder='{"action":"reboot","target":"relay-4"}' />
                </Field>
              </div>
            )}
          </>
        )}
        {type !== 'api' && (
          <Field label="Интервал опроса, сек" hint="Кастомный интервал для этого устройства">
            <input className="inp font-mono" value={interval} onChange={(e) => setIntervalS(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </Field>
        )}
      </div>

      <div>
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Теги</span>
        {tags.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[12px] text-dim">Теги создаются в «Настройки системы → Теги»</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const on = selTags.includes(t.id);
              return (
                <button key={t.id} type="button"
                  onClick={() => setSelTags((s) => (on ? s.filter((x) => x !== t.id) : [...s, t.id]))}
                  className={cls('flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-all', on ? 'border-transparent text-void' : 'border-line bg-raised/50 text-mut hover:text-ink')}
                  style={on ? { background: t.color } : undefined}>
                  <span className="h-2 w-2 rounded-full" style={{ background: on ? 'rgba(13,17,32,.5)' : t.color }} />
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {err && <p className="flex items-center gap-2 rounded-lg border border-crit/35 bg-crit/10 px-3 py-2 text-[12px] font-medium text-crit"><I n="alert" className="h-3.5 w-3.5" />{err}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn-acc" onClick={submit}>
          <I n={initial ? 'check' : 'plus'} className="h-4 w-4" />
          {initial ? 'Сохранить' : 'Добавить устройство'}
        </button>
      </div>
    </div>
  );
}

// ─── Детальная панель ────────────────────────────────────────────────────────

function DeviceDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const d = useStore((s) => s.devices.find((x) => x.id === id));
  const tags = useStore((s) => s.tags);
  const events = useStore((s) => s.events);
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const updateDevice = useStore((s) => s.updateDevice);
  const removeDevice = useStore((s) => s.removeDevice);
  const toast = useToasts((s) => s.push);
  const [confirmDel, setConfirmDel] = useState(false);
  const [editForm, setEditForm] = useState(false);
  useEffect(() => { setConfirmDel(false); setEditForm(false); }, [id]);

  if (!d) return <Drawer open={false} onClose={onClose} title=""><div /></Drawer>;
  const m = STATUS_META[d.status];
  const devEvents = events.filter((e) => e.text.includes(d.address) || e.text.includes(d.name)).slice(0, 8);
  const okHist = d.history.filter((v) => v >= 0);
  const failCount = d.history.length - okHist.length;
  const uptime = d.history.length ? Math.round((okHist.length / d.history.length) * 100) : null;
  const dTags = tags.filter((t) => d.tags.includes(t.id));

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <StatusDot status={d.status} />
          <div>
            <div className="truncate font-display text-[14px] font-semibold text-ink">{d.name}</div>
            <div className="font-mono text-[11px] text-dim">{d.address}</div>
          </div>
          <span className={cls('ml-2 rounded-md px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase', m.text)} style={{ background: 'rgba(143,125,240,.08)' }}>{m.label}</span>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-line bg-raised/50 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Задержка</div>
            <div className={cls('mt-1 font-mono text-[20px] font-bold tabular-nums', m.text)}>
              {d.status === 'down' ? '—' : fmtMs(d.latency)}
              {d.approx && d.status !== 'down' && <span className="text-[11px] text-dim"> ≈</span>}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Базовая</div>
            <div className="mt-1 font-mono text-[20px] font-bold tabular-nums text-mut">{fmtMs(d.profile.base)}</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Аптайм (история)</div>
            <div className="mt-1 font-mono text-[20px] font-bold tabular-nums text-ink">{uptime == null ? '—' : `${uptime}%`}</div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-dim">История задержек</span>
            <span className="font-mono text-[11px] text-dim">{okHist.length} ок · {failCount} сбоев</span>
          </div>
          <AreaChart values={okHist.slice(-60)} color="#8f7df0" unit=" мс" height={110} />
        </div>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-dim">Последние проверки</div>
          <Sparkbar data={d.history} height={34} width={440} />
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-line bg-raised/40 p-4 text-[12.5px]">
          <Row k="Тип" v={DEVICE_TYPE_META[d.type].label} />
          <Row k="Интервал" v={`${d.interval} с`} />
          {(d.port || d.path) && <Row k="Порт / путь" v={`${d.port ?? '—'} / ${d.path ?? '—'}`} mono />}
          {d.method && <Row k="Метод" v={d.method} mono />}
          <Row k="Последняя проверка" v={d.lastCheck ? timeAgo(d.lastCheck) : 'ожидается'} />
          <Row k="Смена статуса" v={timeAgo(d.lastChange)} />
          <Row k="Сбоев подряд" v={String(d.fails)} />
          <Row k="Порог аварии" v={`${useStore.getState().settings.failThreshold} сб.`} />
          {d.body && <div className="col-span-2"><Row k="Команда" v={d.body} mono /></div>}
        </div>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-dim">Теги устройства</div>
          {isAdmin ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.length === 0 && <p className="text-[12px] text-dim">Сначала создайте теги в настройках системы</p>}
              {tags.map((t) => {
                const on = d.tags.includes(t.id);
                return (
                  <button key={t.id}
                    onClick={() => updateDevice(d.id, { tags: on ? d.tags.filter((x) => x !== t.id) : [...d.tags, t.id] })}
                    className={cls('flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-all', on ? 'border-transparent text-void' : 'border-line bg-raised/50 text-mut hover:text-ink')}
                    style={on ? { background: t.color } : undefined}>
                    <span className="h-2 w-2 rounded-full" style={{ background: on ? 'rgba(13,17,32,.5)' : t.color }} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          ) : dTags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {dTags.map((t) => (
                <span key={t.id} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold text-void" style={{ background: t.color }}>
                  <span className="h-2 w-2 rounded-full bg-void/40" />{t.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-dim">Без тегов</p>
          )}
        </div>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-dim">События устройства</div>
          {devEvents.length === 0 ? (
            <p className="text-[12px] text-dim">Событий пока нет</p>
          ) : (
            <ul className="space-y-1.5">
              {devEvents.map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-[12px] text-mut">
                  <span className={cls('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', e.sev === 'crit' ? 'bg-crit' : e.sev === 'warn' ? 'bg-warn' : e.sev === 'ok' ? 'bg-ok' : 'bg-vio')} />
                  <span className="flex-1">{e.text}</span>
                  <span className="font-mono text-[10px] text-dim">{timeAgo(e.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
          <button className="btn-ghost" onClick={async () => {
            toast('info', `Внеочередная проверка ${d.address}…`);
            const r = await forceCheck(d.id);
            if (r) toast(r.ok ? 'ok' : 'crit', r.ok ? `Проверка пройдена: ${fmtMs(r.latency)}` : 'Проверка не прошла — устройство не отвечает');
          }}>
            <I n="refresh" className={cls('h-4 w-4', d.checking && 'animate-spin')} /> Проверить сейчас
          </button>
          {isAdmin && (
            <>
              <button className="btn-ghost" onClick={() => setEditForm(true)}><I n="pencil" className="h-4 w-4" /> Изменить</button>
              <div className="ml-auto">
                {confirmDel ? (
                  <span className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-crit">Удалить безвозвратно?</span>
                    <button className="btn-danger" onClick={() => { removeDevice(d.id); onClose(); }}>Да, удалить</button>
                    <button className="btn-ghost" onClick={() => setConfirmDel(false)}>Нет</button>
                  </span>
                ) : (
                  <button className="btn-danger" onClick={() => setConfirmDel(true)}><I n="trash" className="h-4 w-4" /> Удалить</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={editForm} onClose={() => setEditForm(false)} title="Изменить устройство">
        <DeviceForm initial={d} onClose={() => setEditForm(false)} />
      </Modal>
    </Drawer>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-soft/50 pb-1.5">
      <span className="text-dim">{k}</span>
      <span className={cls('text-right text-mut', mono && 'font-mono text-[11.5px]')}>{v}</span>
    </div>
  );
}

// ─── Страница ────────────────────────────────────────────────────────────────

export default function Devices() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const allDevices = useStore((s) => s.devices);
  const devices = useMemo(() => visibleDevices(allDevices, user), [allDevices, user]);
  const tags = useStore((s) => s.tags);
  const nav = useStore((s) => s.nav);
  const toggleFav = useStore((s) => s.toggleDeviceFav);
  const toast = useToasts((s) => s.push);

  const [query, setQuery] = useState('');
  const [typeF, setTypeF] = useState<'all' | DeviceType>('all');
  const [tagF, setTagF] = useState<string | null>(null);
  const [statusF, setStatusF] = useState<'all' | 'down' | 'degraded' | 'up'>('all');
  const [modal, setModal] = useState<{ open: boolean; edit?: Device }>({ open: false });
  const [drawer, setDrawer] = useState<string | null>(null);
  const consumed = useRef(false);
  const routeParam = useStore((s) => s.routeParam);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    if (routeParam === 'new' && isAdmin) setModal({ open: true });
    else if (routeParam === 'down') setStatusF('down');
    else if (routeParam) setQuery(routeParam);
    nav('devices', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (typeF !== 'all' && d.type !== typeF) return false;
      if (statusF !== 'all' && d.status !== statusF) return false;
      if (tagF && !d.tags.includes(tagF)) return false;
      if (q) {
        const tagMatch = tags.some((t) => t.id && t.label.toLowerCase().includes(q) && d.tags.includes(t.id));
        if (!d.name.toLowerCase().includes(q) && !d.address.toLowerCase().includes(q) && !tagMatch) return false;
      }
      return true;
    });
  }, [devices, query, typeF, tagF, statusF, tags]);

  const counts = {
    all: devices.length,
    down: devices.filter((d) => d.status === 'down').length,
    degraded: devices.filter((d) => d.status === 'degraded').length,
    up: devices.filter((d) => d.status === 'up').length,
  };

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-raised/60 px-3 py-2">
          <I n="search" className="h-4 w-4 text-dim" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Фильтр: IP, имя, тег…" className="w-52 bg-transparent text-[13px] text-ink outline-none placeholder:text-dim/80" />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <FilterChip on={typeF === 'all'} onClick={() => setTypeF('all')} label={`Все · ${counts.all}`} />
          {DEVICE_TYPES.map((t) => (
            <FilterChip key={t} on={typeF === t} onClick={() => setTypeF(typeF === t ? 'all' : t)} label={DEVICE_TYPE_META[t].short} />
          ))}
        </div>

        <div className="flex gap-1.5">
          <FilterChip tone="crit" on={statusF === 'down'} onClick={() => setStatusF(statusF === 'down' ? 'all' : 'down')} label={`Авария · ${counts.down}`} />
          <FilterChip tone="warn" on={statusF === 'degraded'} onClick={() => setStatusF(statusF === 'degraded' ? 'all' : 'degraded')} label={`Деградация · ${counts.degraded}`} />
        </div>

        {isAdmin && (
          <button className="btn-acc ml-auto" onClick={() => setModal({ open: true })}>
            <I n="plus" className="h-4 w-4" /> Добавить устройство
          </button>
        )}
      </div>

      {tags.length > 0 && (
        <div className="rise flex flex-wrap items-center gap-1.5" style={{ animationDelay: '60ms' }}>
          <span className="mr-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-dim"><I n="tag" className="h-3.5 w-3.5" /> Теги:</span>
          {tags.map((t) => (
            <button key={t.id} onClick={() => setTagF(tagF === t.id ? null : t.id)}
              className={cls('flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-all', tagF === t.id ? 'border-transparent text-void' : 'border-line bg-raised/50 text-mut hover:text-ink')}
              style={tagF === t.id ? { background: t.color } : undefined}>
              <span className="h-2 w-2 rounded-full" style={{ background: tagF === t.id ? 'rgba(13,17,32,.5)' : t.color }} />{t.label}
            </button>
          ))}
        </div>
      )}

      <Panel title={`Устройства · ${list.length}`} icon="server" delay={100} bodyClass="p-0">
        {list.length === 0 ? (
          <EmptyState
            icon="server"
            title={devices.length === 0 ? 'Устройств пока нет' : 'Ничего не подошло под фильтры'}
            text={devices.length === 0 ? 'Добавьте первое устройство: ping, HTTP-порт, API-команда, RTSP-поток или SIP-эндпоинт.' : 'Попробуйте сбросить фильтры или изменить запрос.'}
            action={isAdmin && devices.length === 0 ? (
              <button className="btn-acc" onClick={() => setModal({ open: true })}><I n="plus" className="h-4 w-4" /> Добавить устройство</button>
            ) : undefined}
          />
        ) : (
          <ul>
            {list.map((d, i) => {
              const m = STATUS_META[d.status];
              const dTags = tags.filter((t) => d.tags.includes(t.id));
              return (
                <li key={d.id}
                  className="rise group grid cursor-pointer grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_auto_auto] items-center gap-x-4 gap-y-2 border-b border-line-soft/60 px-4 py-3 transition-colors last:border-0 hover:bg-raised/50 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_76px_90px_130px_minmax(0,1fr)_auto]"
                  style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
                  onClick={() => setDrawer(d.id)}>
                  <div className="flex min-w-0 items-center gap-3">
                    <StatusDot status={d.status} />
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-semibold text-ink">{d.name}</div>
                      <div className="truncate font-mono text-[11px] text-dim">{d.address}{d.port ? `:${d.port}` : ''}</div>
                    </div>
                  </div>
                  <div className="hidden min-w-0 items-center gap-1.5 overflow-hidden md:flex">
                    {dTags.slice(0, 3).map((t) => (
                      <span key={t.id} className="flex shrink-0 items-center gap-1 rounded border border-line bg-raised px-1.5 py-0.5 text-[10px] font-semibold text-mut">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />{t.label}
                      </span>
                    ))}
                  </div>
                  <TypeBadge t={d.type} />
                  <span className="font-mono text-[11px] text-dim">{d.interval} с</span>
                  <span className={cls('hidden font-mono text-[13px] font-bold tabular-nums md:block', m.text)}>
                    {d.status === 'down' ? 'СБОЙ' : fmtMs(d.latency)}{d.approx && d.status !== 'down' ? '≈' : ''}
                  </span>
                  <span className="hidden md:block"><Sparkbar data={d.history} height={24} width={120} /></span>
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <button title="Проверить сейчас" className="icon-btn"
                      onClick={async () => {
                        toast('info', `Внеочередная проверка ${d.address}…`);
                        const r = await forceCheck(d.id);
                        if (r) toast(r.ok ? 'ok' : 'crit', r.ok ? `${d.name}: ${fmtMs(r.latency)}` : `${d.name}: не отвечает`);
                      }}>
                      <I n="refresh" className={cls('h-4 w-4', d.checking && 'animate-spin')} />
                    </button>
                    <button title={d.favorite ? 'Убрать из избранного' : 'В избранное'}
                      className={cls('icon-btn', d.favorite && 'text-warn')}
                      onClick={() => toggleFav(d.id)}>
                      <I n="star" className={cls('h-4 w-4', d.favorite && 'fill-warn')} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.edit ? 'Изменить устройство' : 'Новое устройство'} width="max-w-xl">
        <DeviceForm initial={modal.edit} onClose={() => setModal({ open: false })} />
      </Modal>

      <DeviceDrawer id={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

function FilterChip({ on, onClick, label, tone }: { on: boolean; onClick: () => void; label: string; tone?: 'crit' | 'warn' }) {
  return (
    <button onClick={onClick}
      className={cls(
        'rounded-md border px-2.5 py-1.5 font-mono text-[11px] font-bold tracking-wide transition-all duration-150',
        on
          ? tone === 'crit' ? 'border-crit/60 bg-crit/15 text-crit' : tone === 'warn' ? 'border-warn/60 bg-warn/15 text-warn' : 'border-vio/60 bg-vio-deep/40 text-ink'
          : 'border-line bg-raised/50 text-dim hover:text-mut',
      )}>
      {label}
    </button>
  );
}
