// ─── PLUTO: устройства (PING/HTTP/API/RTSP/SIP + диапазоны) ─────────────────
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Star, Trash2, X, RefreshCw, Server } from 'lucide-react';
import { Drawer, EmptyState, Field, Modal, Panel, Sparkbar, StatusDot, STATUS_META, TimeAgo, TypeBadge } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts, visibleDevices } from '../lib/store';
import { forceCheck } from '../lib/engine';
import { cls, fmtMs } from '../lib/util';
import { DEVICE_TYPE_META, DEVICE_TYPES, type Device, type DeviceType } from '../lib/types';

const isIp = (s: string) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);

function ipNum(ip: string): number {
  return ip.split('.').reduce((acc, o) => acc * 256 + parseInt(o, 10), 0);
}

const FILTERS: { v: 'all' | 'up' | 'down' | 'degraded'; label: string }[] = [
  { v: 'all', label: 'Все' }, { v: 'up', label: 'В сети' }, { v: 'degraded', label: 'Деградация' }, { v: 'down', label: 'Авария' },
];

export default function Devices() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const devices = usePluto((s) => visibleDevices(s, user));
  const tags = usePluto((s) => s.tags);
  const routeParam = usePluto((s) => s.routeParam);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'up' | 'down' | 'degraded'>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    if (routeParam === 'new') { setAddOpen(true); store.nav('devices'); }
    else if (routeParam === 'down') { setFilter('down'); store.nav('devices'); }
    else if (routeParam) {
      const d = devices.find((x) => x.address === routeParam);
      if (d) setDetailId(d.id);
      store.nav('devices');
    }
  }, [routeParam, devices]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return devices.filter((d) => {
      if (filter !== 'all' && d.status !== filter) return false;
      if (tagFilter && !d.tags.includes(tagFilter)) return false;
      if (query && !d.name.toLowerCase().includes(query) && !d.address.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [devices, q, filter, tagFilter]);

  const detail = detailId ? devices.find((d) => d.id === detailId) ?? null : null;

  return (
    <div className="space-y-4">
      <Panel
        title="Устройства" icon={<Server className="h-4 w-4" />}
        right={
          isAdmin ? (
            <button className="btn-acc" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Добавить устройство
            </button>
          ) : undefined
        }
        bodyClass="p-0"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line/60 px-4 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-raised/70 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или IP…" className="w-44 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-dim/80" />
          </div>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button key={f.v} onClick={() => setFilter(f.v)}
                className={cls('rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold transition-all', filter === f.v ? 'bg-vio/25 text-ink' : 'text-dim hover:text-mut')}>
                {f.label}
              </button>
            ))}
          </div>
          {tags.length > 0 && (
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="inp !w-auto !py-1.5 text-[12px]">
              <option value="">Все теги</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          )}
          <span className="ml-auto font-mono text-[11px] text-dim">{list.length} из {devices.length}</span>
        </div>

        {list.length === 0 ? (
          <EmptyState
            icon={<Server className="h-6 w-6" />}
            title={devices.length === 0 ? 'Устройств пока нет' : 'Ничего не найдено'}
            text={devices.length === 0 ? 'Добавьте первое устройство: одиночный адрес или целый диапазон IP для массового пинга.' : 'Попробуйте изменить фильтр или запрос.'}
            action={isAdmin && devices.length === 0 ? <button className="btn-acc" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Добавить устройство</button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-line/50">
            {list.map((d) => {
              const m = STATUS_META[d.status];
              return (
                <li key={d.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-raised/40" onClick={() => setDetailId(d.id)}>
                  <StatusDot status={d.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-ink">{d.name}</span>
                      {d.favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-warn text-warn" />}
                      {d.tags.map((tid) => {
                        const t = tags.find((x) => x.id === tid);
                        return t ? <span key={tid} className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide" style={{ background: `${t.color}22`, color: t.color }}>{t.label}</span> : null;
                      })}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-dim">
                      <TypeBadge t={d.type} />
                      <span>{d.address}{d.port ? `:${d.port}` : ''}</span>
                      <span>·</span>
                      <TimeAgo ts={d.lastCheck} />
                    </div>
                  </div>
                  <Sparkbar data={d.history} height={24} width={110} />
                  <div className="w-[86px] text-right">
                    <div className={cls('font-mono text-[15px] font-bold tabular-nums', m.text)}>
                      {d.status === 'down' ? 'СБОЙ' : fmtMs(d.latency)}
                      {d.approx && d.status !== 'down' && <span className="ml-0.5 text-[10px] text-dim">≈</span>}
                    </div>
                    <div className={cls('text-[9.5px] font-bold uppercase tracking-wider', m.text)}>{m.label}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <AddDeviceModal open={addOpen} onClose={() => setAddOpen(false)} />
      <DeviceDrawer device={detail} onClose={() => setDetailId(null)} isAdmin={isAdmin} />
    </div>
  );
}

// ─── Добавление: одно устройство или диапазон ───────────────────────────────

function AddDeviceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tags = usePluto((s) => s.tags);
  const settings = usePluto((s) => s.settings);

  const [mode, setMode] = useState<'single' | 'range'>('single');
  const [type, setType] = useState<DeviceType>('ping');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [ipFrom, setIpFrom] = useState('');
  const [ipTo, setIpTo] = useState('');
  const [port, setPort] = useState('');
  const [path, setPath] = useState('');
  const [method, setMethod] = useState('GET');
  const [body, setBody] = useState('');
  const [interval, setInterval] = useState(60);
  const [selTags, setSelTags] = useState<string[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) {
      setMode('single'); setType('ping'); setName(''); setAddress(''); setIpFrom(''); setIpTo('');
      setPort(''); setPath(''); setMethod('GET'); setBody(''); setInterval(settings.intervals.ping); setSelTags([]); setErr('');
    }
  }, [open, settings]);

  const rangeCount = useMemo(() => {
    if (!isIp(ipFrom) || !isIp(ipTo)) return null;
    const a = ipNum(ipFrom), b = ipNum(ipTo);
    if (a > b) return null;
    const prefix = (ip: string) => ip.split('.').slice(0, 3).join('.');
    if (prefix(ipFrom) !== prefix(ipTo)) return null;
    return b - a + 1;
  }, [ipFrom, ipTo]);

  const submit = () => {
    setErr('');
    if (mode === 'single') {
      if (!address.trim()) return setErr('Укажите адрес устройства');
      if ((type === 'http' || type === 'api') && !/^https?:\/\//i.test(address.trim()) && !address.trim()) return setErr('Укажите хост');
    } else {
      if (!isIp(ipFrom) || !isIp(ipTo)) return setErr('Начальный и конечный IP — в формате 192.168.1.10');
      if (rangeCount == null) return setErr('Диапазон должен быть в одной подсети /24, начало ≤ конца');
      if (rangeCount > 254) return setErr('Не более 254 адресов за раз');
    }
    if (interval < 5 || interval > 86400) return setErr('Интервал — от 5 до 86400 секунд');

    if (mode === 'single') {
      store.addDevice({
        name: name.trim() || address.trim(), type, address: address.trim(),
        port: port ? parseInt(port, 10) : null, path, method: type === 'api' ? method : null,
        body: type === 'api' ? body : null, interval, tags: selTags,
      });
    } else {
      const a = ipNum(ipFrom);
      for (let i = 0; i < (rangeCount as number); i++) {
        const n = a + i;
        const ip = `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
        store.addDevice({ name: `${name.trim() || 'Диапазон'} ${ip}`, type: 'ping', address: ip, interval, tags: selTags });
      }
      useToasts.push('ok', `Добавлено ${rangeCount} устройств (${ipFrom} — ${ipTo})`);
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Новое устройство">
      <div className="space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setMode('single')} className={cls('flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition-all', mode === 'single' ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
            Одно устройство
          </button>
          <button onClick={() => setMode('range')} className={cls('flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition-all', mode === 'range' ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
            Диапазон устройств
          </button>
        </div>

        {mode === 'single' ? (
          <>
            <Field label="Тип проверки">
              <div className="grid grid-cols-5 gap-1.5">
                {DEVICE_TYPES.map((t) => (
                  <button key={t} onClick={() => { setType(t); setInterval(settings.intervals[t]); }}
                    title={DEVICE_TYPE_META[t].desc}
                    className={cls('rounded-lg border px-2 py-2 font-mono text-[11px] font-bold transition-all', type === t ? 'border-vio/50 bg-vio/15 text-vio' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                    {DEVICE_TYPE_META[t].label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-dim">{DEVICE_TYPE_META[type].desc}</p>
            </Field>
            <Field label="Имя">
              <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={type === 'rtsp' ? 'RTSP-ссылка' : type === 'sip' ? 'SIP URI' : 'IP-адрес или хост'}>
              <input className="inp font-mono" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            {(type === 'http' || type === 'api' || type === 'rtsp') && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Порт"><input className="inp font-mono" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} /></Field>
                {type !== 'rtsp' && <Field label="Путь"><input className="inp font-mono" value={path} onChange={(e) => setPath(e.target.value)} /></Field>}
              </div>
            )}
            {type === 'api' && (
              <>
                <Field label="Метод">
                  <div className="flex gap-1.5">
                    {['GET', 'POST', 'PUT'].map((mth) => (
                      <button key={mth} onClick={() => setMethod(mth)} className={cls('rounded-lg border px-3 py-1.5 font-mono text-[11px] font-bold transition-all', method === mth ? 'border-vio/50 bg-vio/15 text-vio' : 'border-line bg-raised/50 text-dim')}>{mth}</button>
                    ))}
                  </div>
                </Field>
                {method !== 'GET' && (
                  <Field label="Тело запроса (JSON)">
                    <textarea className="inp min-h-[74px] resize-y font-mono text-[12px]" value={body} onChange={(e) => setBody(e.target.value)} />
                  </Field>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <Field label="Название диапазона" hint="Каждое устройство получит имя с суффиксом-адресом">
              <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Начальный IP"><input className="inp font-mono" value={ipFrom} onChange={(e) => setIpFrom(e.target.value)} placeholder="192.168.1.10" /></Field>
              <Field label="Конечный IP"><input className="inp font-mono" value={ipTo} onChange={(e) => setIpTo(e.target.value)} placeholder="192.168.1.20" /></Field>
            </div>
            <div className={cls('rounded-lg border px-3 py-2 font-mono text-[12px]', rangeCount == null ? 'border-line text-dim' : rangeCount > 254 ? 'border-crit/40 text-crit' : 'border-ok/40 text-ok')}>
              {rangeCount == null
                ? 'Задайте диапазон — одна подсеть /24, начало ≤ конца'
                : rangeCount > 254
                  ? `Получится ${rangeCount} адресов — слишком много (максимум 254)`
                  : `Получится устройств: ${rangeCount} (все — типа PING)`}
            </div>
          </>
        )}

        <Field label={`Интервал опроса, сек (по умолчанию для ${mode === 'range' ? 'PING' : DEVICE_TYPE_META[type].label}: ${settings.intervals[mode === 'range' ? 'ping' : type]})`}>
          <input className="inp font-mono" type="number" min={5} value={interval} onChange={(e) => setInterval(parseInt(e.target.value, 10) || 60)} />
        </Field>

        {tags.length > 0 && (
          <Field label="Теги">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const on = selTags.includes(t.id);
                return (
                  <button key={t.id} onClick={() => setSelTags((s) => (on ? s.filter((x) => x !== t.id) : [...s, t.id]))}
                    className="rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-all"
                    style={on ? { borderColor: t.color, background: `${t.color}22`, color: t.color } : { borderColor: 'var(--color-line)', color: 'var(--color-dim)' }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {err && <p className="rounded-lg border border-crit/35 bg-crit/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-crit">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-acc" onClick={submit}>
            <Plus className="h-4 w-4" /> {mode === 'range' ? `Добавить ${rangeCount ?? '…'} устройств` : 'Добавить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Детали устройства ──────────────────────────────────────────────────────

function DeviceDrawer({ device, onClose, isAdmin }: { device: Device | null; onClose: () => void; isAdmin: boolean }) {
  const tags = usePluto((s) => s.tags);
  const [checking, setChecking] = useState(false);

  if (!device) return <Drawer open={false} onClose={onClose} title=""><div /></Drawer>;
  const m = STATUS_META[device.status];

  return (
    <Drawer
      open={!!device}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <StatusDot status={device.status} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-bold text-ink">{device.name}</div>
            <div className="font-mono text-[10.5px] text-dim">{device.address}{device.port ? `:${device.port}` : ''} · {DEVICE_TYPE_META[device.type].label}</div>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-line bg-raised/40 p-3">
            <div className={cls('font-mono text-[20px] font-bold tabular-nums', m.text)}>{device.status === 'down' ? 'СБОЙ' : fmtMs(device.latency)}</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-dim">задержка</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/40 p-3">
            <div className="font-mono text-[20px] font-bold tabular-nums text-ink">{device.baseline != null ? fmtMs(device.baseline) : '—'}</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-dim">базовая</div>
          </div>
          <div className="rounded-lg border border-line bg-raised/40 p-3">
            <div className="font-mono text-[20px] font-bold tabular-nums text-ink">{device.interval} с</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-dim">интервал</div>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-dim">История проверок · {device.history.length} точек</h4>
          <Sparkbar data={device.history} height={44} width={440} />
        </div>

        <div className="space-y-1.5 font-mono text-[11.5px] text-mut">
          <div className="flex justify-between"><span className="text-dim">Статус</span><span className={m.text}>{m.label}</span></div>
          <div className="flex justify-between"><span className="text-dim">Сбоев подряд</span><span>{device.fails}</span></div>
          <div className="flex justify-between"><span className="text-dim">Последняя проверка</span><TimeAgo ts={device.lastCheck} /></div>
          <div className="flex justify-between"><span className="text-dim">Смена статуса</span><TimeAgo ts={device.lastChange} /></div>
          {device.tags.length > 0 && (
            <div className="flex justify-between">
              <span className="text-dim">Теги</span>
              <span className="flex gap-1">
                {device.tags.map((tid) => {
                  const t = tags.find((x) => x.id === tid);
                  return t ? <span key={tid} className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase" style={{ background: `${t.color}22`, color: t.color }}>{t.label}</span> : null;
                })}
              </span>
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="flex gap-2 border-t border-line/60 pt-4">
            <button
              className="btn-ghost"
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                const r = await forceCheck(device.id);
                setChecking(false);
                if (r) useToasts.push(r.ok ? 'ok' : 'crit', r.ok ? `Проверка: ${fmtMs(r.latency)}` : 'Проверка: нет ответа');
              }}
            >
              <RefreshCw className={cls('h-3.5 w-3.5', checking && 'animate-spin')} /> Проверить сейчас
            </button>
            <button className="btn-ghost" onClick={() => store.toggleDeviceFav(device.id)}>
              <Star className={cls('h-3.5 w-3.5', device.favorite && 'fill-warn text-warn')} /> {device.favorite ? 'Из избранного' : 'В избранное'}
            </button>
            <button
              className="btn-danger ml-auto"
              onClick={() => {
                if (window.confirm(`Удалить «${device.name}» из мониторинга?`)) {
                  store.removeDevice(device.id);
                  onClose();
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Удалить
            </button>
          </div>
        )}
      </div>
    </Drawer>
  );
}
