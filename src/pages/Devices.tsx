// ─── PLUTO: устройства ───────────────────────────────────────────────────────
import { memo, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Star, RefreshCw, LayoutGrid } from 'lucide-react';
import { Panel, StatusDot, STATUS_META, Sparkbar, TypeBadge, Modal, Field, EmptyState, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts, visibleDevices } from '../lib/store';
import { forceCheck } from '../lib/engine';
import { cls, fmtMs, expandTargets, isTarget } from '../lib/util';
import { DEVICE_TYPES, DEVICE_TYPE_META, type Device, type DeviceType } from '../lib/types';

const PAGE_SIZE = 50;

function DeviceModal({ open, initial, onClose }: { open: boolean; initial: Device | null; onClose: () => void }) {
  const tags = usePluto((s) => s.tags);
  const settings = usePluto((s) => s.settings);
  const [mode, setMode] = useState<'single' | 'range'>('single');
  const [name, setName] = useState('');
  const [type, setType] = useState<DeviceType>('ping');
  const [address, setAddress] = useState('');
  const [ipFrom, setIpFrom] = useState('');
  const [ipTo, setIpTo] = useState('');
  const [interval, setIntervalSec] = useState(60);
  const [selTags, setSelTags] = useState<string[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr(''); setMode('single');
    if (initial) {
      setName(initial.name); setType(initial.type); setAddress(initial.address);
      setIntervalSec(initial.interval); setSelTags(initial.tags);
    } else {
      setName(''); setType('ping'); setAddress(''); setIpFrom(''); setIpTo('');
      setIntervalSec(settings.intervals.ping); setSelTags([]);
    }
  }, [open, initial, settings.intervals.ping]);

  const rangeCount = useMemo(() => {
    if (!ipFrom || !ipTo) return 0;
    if (!isTarget(ipFrom) || !isTarget(ipTo)) return 0;
    const a = expandTargets(ipFrom), b = expandTargets(ipTo);
    return a.length && b.length ? Math.abs(b[0].split('.').map(Number)[3] - a[0].split('.').map(Number)[3]) + 1 : 0;
  }, [ipFrom, ipTo]);

  const save = async () => {
    setErr('');
    if (mode === 'range') {
      if (!isTarget(ipFrom) || !isTarget(ipTo)) return setErr('Укажите корректные начальный и конечный IP');
      const from = expandTargets(ipFrom), to = expandTargets(ipTo);
      const base = from[0].split('.').slice(0, 3).join('.');
      const a = +from[0].split('.')[3], b = +to[0].split('.')[3];
      if (from[0].split('.').slice(0, 3).join('.') !== to[0].split('.').slice(0, 3).join('.')) return setErr('Начальный и конечный IP должны быть в одной подсети /24');
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (hi - lo > 253) return setErr('Не более 254 адресов в диапазоне');
      for (let i = lo; i <= hi; i++) {
        await store.addDevice({ name: `${name.trim() || 'PING'} ${base}.${i}`, type: 'ping', address: `${base}.${i}`, interval, tags: selTags, favorite: false, showcase: false, port: null, path: '', method: null, body: null });
      }
      useToasts.push('ok', `Добавлено устройств: ${hi - lo + 1}`);
      onClose();
      return;
    }
    if (!name.trim()) return setErr('Укажите имя');
    if (!address.trim()) return setErr('Укажите адрес');
    if (initial) {
      await store.updateDevice(initial.id, { name: name.trim(), type, address: address.trim(), interval, tags: selTags });
    } else {
      await store.addDevice({ name: name.trim(), type, address: address.trim(), interval, tags: selTags, favorite: false, showcase: false, port: null, path: '', method: null, body: null });
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Изменить устройство' : 'Новое устройство'}>
      <div className="space-y-4">
        {!initial && (
          <div className="flex overflow-hidden rounded-lg border border-line bg-raised/50">
            {([{ v: 'single', label: 'Одно устройство' }, { v: 'range', label: 'Диапазон устройств' }] as const).map((m) => (
              <button key={m.v} onClick={() => setMode(m.v)}
                className={cls('flex-1 px-3 py-2 text-[12.5px] font-semibold transition-all', mode === m.v ? 'bg-vio/25 text-ink' : 'text-dim hover:text-mut')}>
                {m.label}
              </button>
            ))}
          </div>
        )}

        {mode === 'single' ? (
          <>
            <Field label="Имя"><input className="inp" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} /></Field>
            <Field label="Тип">
              <select className="inp" value={type} onChange={(e) => setType(e.target.value as DeviceType)}>
                {DEVICE_TYPES.map((t) => <option key={t} value={t}>{DEVICE_TYPE_META[t].label} — {DEVICE_TYPE_META[t].desc}</option>)}
              </select>
            </Field>
            <Field label="Адрес" hint="IP или хост; для RTSP — полная ссылка, для SIP — sip:uri">
              <input className="inp font-mono" value={address} onChange={(e) => { setAddress(e.target.value); setErr(''); }} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Название (префикс)" hint="Каждое устройство получит суффикс со своим IP"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Начальный IP"><input className="inp font-mono" value={ipFrom} onChange={(e) => { setIpFrom(e.target.value); setErr(''); }} placeholder="192.168.1.10" /></Field>
              <Field label="Конечный IP"><input className="inp font-mono" value={ipTo} onChange={(e) => { setIpTo(e.target.value); setErr(''); }} placeholder="192.168.1.40" /></Field>
            </div>
            {rangeCount > 0 && <p className="font-mono text-[12px] text-ok">Получится устройств: {rangeCount}</p>}
          </>
        )}

        <Field label="Интервал опроса, сек"><input className="inp font-mono" type="number" min={5} value={interval} onChange={(e) => setIntervalSec(parseInt(e.target.value, 10) || 60)} /></Field>

        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Теги</span>
          {tags.length === 0 ? (
            <p className="text-[11.5px] text-dim">Тегов пока нет — создайте их в «Настройки → Теги», затем присвойте здесь.</p>
          ) : (
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
          )}
        </div>

        {err && <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}
        <button onClick={save} className="btn-acc w-full justify-center"><Plus className="h-4 w-4" />{initial ? 'Сохранить' : mode === 'range' ? `Добавить ${rangeCount || ''} устройств` : 'Добавить'}</button>
      </div>
    </Modal>
  );
}

function ClearAllButton({ count }: { count: number }) {
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 4000);
    return () => clearTimeout(t);
  }, [arm]);
  if (count === 0) return null;
  return (
    <button disabled={busy}
      onClick={async () => { if (!arm) { setArm(true); return; } setBusy(true); try { await store.clearDevices(); } finally { setBusy(false); setArm(false); } }}
      className={cls('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-all',
        arm ? 'border-crit/60 bg-crit/20 text-crit' : 'border-line bg-raised/50 text-dim hover:border-crit/50 hover:text-crit')}
      title="Удалить все устройства">
      <Trash2 className="h-3.5 w-3.5" />{busy ? 'Удаляю…' : arm ? `Точно удалить ${count}?` : 'Очистить всё'}
    </button>
  );
}

const DeviceRow = memo(function DeviceRow({ d, isAdmin, onEdit }: { d: Device; isAdmin: boolean; onEdit: (d: Device) => void }) {
  const tags = usePluto((s) => s.tags);
  const m = STATUS_META[d.status];
  const tagObjs = d.tags.map((id) => tags.find((t) => t.id === id)).filter(Boolean) as { id: string; label: string; color: string }[];
  return (
    <tr className="border-b border-line/30 transition-colors hover:bg-raised/40">
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2">
          <StatusDot status={d.status} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink">{d.name}</div>
            <div className="font-mono text-[11px] text-dim">{d.address}</div>
          </div>
        </div>
      </td>
      <td className="py-2.5 pr-3"><TypeBadge t={d.type} /></td>
      <td className="py-2.5 pr-3"><span className={cls('text-[12px] font-semibold', m.text)}>{m.label}</span></td>
      <td className="py-2.5 pr-3 font-mono text-[13px] tabular-nums text-mut">{d.status === 'down' ? '—' : fmtMs(d.latency)}{d.approx && d.status !== 'down' && <span className="ml-0.5 text-[9px] text-dim">≈</span>}</td>
      <td className="hidden py-2.5 pr-3 lg:table-cell"><Sparkbar data={d.history} height={22} width={110} /></td>
      <td className="hidden py-2.5 pr-3 xl:table-cell">
        <div className="flex flex-wrap gap-1">{tagObjs.map((t) => <span key={t.id} className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ borderColor: t.color, color: t.color }}>{t.label}</span>)}</div>
      </td>
      <td className="hidden py-2.5 pr-3 font-mono text-[11px] text-dim md:table-cell">{d.interval} с</td>
      <td className="py-2.5 text-right">
        <div className="flex items-center justify-end gap-0.5">
          <button onClick={() => void forceCheck(d.id)} title="Проверить сейчас" className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-vio"><RefreshCw className={cls('h-3.5 w-3.5', d.checking && 'animate-spin')} /></button>
          <button onClick={() => store.toggleDeviceFav(d.id)} title="В избранное" className={cls('rounded-md p-1.5 transition-all', d.favorite ? 'text-warn' : 'text-dim/40 hover:text-dim')}><Star className={cls('h-3.5 w-3.5', d.favorite && 'fill-warn')} /></button>
          <button onClick={() => store.toggleDeviceShowcase(d.id)} title="На витрину" className={cls('rounded-md p-1.5 transition-all', d.showcase ? 'text-mint' : 'text-dim/40 hover:text-dim')}><LayoutGrid className="h-3.5 w-3.5" /></button>
          {isAdmin && <button onClick={() => onEdit(d)} title="Изменить" className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>}
          {isAdmin && <button onClick={() => { if (window.confirm(`Удалить «${d.name}»?`)) void store.removeDevice(d.id); }} title="Удалить" className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-crit"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      </td>
    </tr>
  );
});

export default function Devices() {
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const routeParam = usePluto((s) => s.routeParam);
  const isAdmin = user?.role === 'admin';
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'down' | 'degraded'>('all');
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState<{ open: boolean; initial: Device | null }>({ open: false, initial: null });

  useEffect(() => { if (routeParam === 'down') setStatusFilter('down'); if (routeParam === 'new') setModal({ open: true, initial: null }); }, [routeParam]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return devices.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (query && !d.name.toLowerCase().includes(query) && !d.address.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [devices, q, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = list.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const onEdit = (d: Device) => setModal({ open: true, initial: d });

  return (
    <div className="space-y-4">
      <Panel title={`Устройства · ${list.length}`} icon={<Plus className="h-4 w-4" />}
        right={isAdmin ? (
          <div className="flex items-center gap-2">
            <ClearAllButton count={devices.length} />
            <button onClick={() => setModal({ open: true, initial: null })} className="btn-acc"><Plus className="h-4 w-4" />Добавить</button>
          </div>
        ) : undefined}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-raised/50 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-dim" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Имя или адрес…" className="w-44 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-dim/70" />
          </div>
          <div className="flex overflow-hidden rounded-lg border border-line bg-raised/50">
            {([{ v: 'all', label: 'Все' }, { v: 'down', label: 'Аварии' }, { v: 'degraded', label: 'Деградация' }] as const).map((f) => (
              <button key={f.v} onClick={() => { setStatusFilter(f.v); setPage(0); }}
                className={cls('px-3 py-1.5 text-[12px] font-semibold transition-all', statusFilter === f.v ? 'bg-vio/25 text-ink' : 'text-dim hover:text-mut')}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {list.length === 0 ? (
          <EmptyState icon={<Search className="h-6 w-6" />} title={devices.length ? 'Ничего не найдено' : 'Устройств пока нет'}
            text={devices.length ? 'Попробуйте другой запрос или сбросьте фильтры.' : 'Добавьте первое устройство — PING, HTTP, API, RTSP или SIP.'}
            action={isAdmin && !devices.length ? (
              <button onClick={() => setModal({ open: true, initial: null })} className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">Добавить устройство</button>
            ) : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line/60 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">
                  <th className="py-2 pr-3">Устройство</th><th className="py-2 pr-3">Тип</th><th className="py-2 pr-3">Статус</th>
                  <th className="py-2 pr-3">Задержка</th><th className="hidden py-2 pr-3 lg:table-cell">История</th>
                  <th className="hidden py-2 pr-3 xl:table-cell">Теги</th><th className="hidden py-2 pr-3 md:table-cell">Опрос</th>
                  <th className="py-2 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>{pageItems.map((d) => <DeviceRow key={d.id} d={d} isAdmin={!!isAdmin} onEdit={onEdit} />)}</tbody>
            </table>
          </div>
        )}

        {list.length > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between border-t border-line/40 pt-3">
            <span className="font-mono text-[11px] text-dim">{safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, list.length)} из {list.length}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}
                className="rounded-md border border-line bg-raised/50 px-2.5 py-1 text-[11.5px] font-semibold text-mut transition-all hover:text-ink disabled:opacity-40">←</button>
              <span className="px-2 font-mono text-[11.5px] text-mut">{safePage + 1} / {pageCount}</span>
              <button onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))} disabled={safePage >= pageCount - 1}
                className="rounded-md border border-line bg-raised/50 px-2.5 py-1 text-[11.5px] font-semibold text-mut transition-all hover:text-ink disabled:opacity-40">→</button>
            </div>
          </div>
        )}
      </Panel>

      <DeviceModal open={modal.open} initial={modal.initial} onClose={() => setModal({ open: false, initial: null })} />
    </div>
  );
}
