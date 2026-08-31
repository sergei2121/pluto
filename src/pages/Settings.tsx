// ─── PLUTO: настройки системы ───────────────────────────────────────────────
import { useEffect, useState } from 'react';
import {
  Send, Tag as TagIcon, Bell, Users, Database, Plus, Trash2, Monitor, Server, BarChart3, Radio, RefreshCw,
} from 'lucide-react';
import { Field, Panel, Toggle, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts } from '../lib/store';
import { sendTestNotification, requestPushPermission } from '../lib/engine';
import { api } from '../lib/api';
import { cls, TAG_COLORS, timeAgo } from '../lib/util';
import { DEVICE_TYPES, DEVICE_TYPE_META, type DeviceType, type Settings as TSettings, type User } from '../lib/types';

type Tab = 'polling' | 'tags' | 'notify' | 'users' | 'database' | 'mirror';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('polling');
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'polling', label: 'Опросы и пороги', icon: <Send className="h-3.5 w-3.5" /> },
    { id: 'tags', label: 'Теги', icon: <TagIcon className="h-3.5 w-3.5" /> },
    { id: 'notify', label: 'Уведомления', icon: <Bell className="h-3.5 w-3.5" /> },
    { id: 'users', label: 'Пользователи', icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'database', label: 'База данных', icon: <Database className="h-3.5 w-3.5" /> },
    { id: 'mirror', label: 'Зеркало', icon: <Radio className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cls('flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold transition-all', tab === t.id ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-panel/70 text-dim hover:text-mut')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'polling' && <PollingTab />}
      {tab === 'tags' && <TagsTab />}
      {tab === 'notify' && <NotifyTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'database' && <DatabaseTab />}
      {tab === 'mirror' && <MirrorTab />}
    </div>
  );
}

// ─── Опросы и пороги ────────────────────────────────────────────────────────

function NumField({ label, value, onChange, min, suffix, hint }: { label: string; value: number; onChange: (v: number) => void; min: number; suffix?: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input className="inp font-mono" type="number" min={min} value={value} onChange={(e) => onChange(parseInt(e.target.value, 10) || min)} />
        {suffix && <span className="shrink-0 font-mono text-[11px] text-dim">{suffix}</span>}
      </div>
    </Field>
  );
}

function PollingTab() {
  const settings = usePluto((s) => s.settings);
  const apiMode = usePluto((s) => s.apiMode);
  const [draft, setDraft] = useState<TSettings>({ ...settings, intervals: { ...settings.intervals } });

  useEffect(() => setDraft({ ...settings, intervals: { ...settings.intervals } }), [settings]);

  const set = (patch: Partial<TSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const setInt = (k: DeviceType | 'glances' | 'agent', v: number) => setDraft((d) => ({ ...d, intervals: { ...d.intervals, [k]: v } }));

  return (
    <Panel title="Интервалы опросов и пороги" icon={<Send className="h-4 w-4" />}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DEVICE_TYPES.map((t) => (
          <NumField key={t} label={`${DEVICE_TYPE_META[t].label} — интервал`} value={draft.intervals[t]} onChange={(v) => setInt(t, v)} min={5} suffix="сек" />
        ))}
        <NumField label="Агенты — интервал опроса" value={draft.intervals.agent ?? 30} onChange={(v) => setInt('agent', v)} min={10} suffix="сек" hint="Пинг до IP (uptime) и relay-пинги устройств" />
        <NumField label="Glances — интервал" value={draft.intervals.glances ?? 60} onChange={(v) => setInt('glances', v)} min={15} suffix="сек" hint="Опрос Glances (агенты и Bars)" />
        <NumField label="Таймаут проверки" value={draft.timeoutMs} onChange={(v) => set({ timeoutMs: v })} min={500} suffix="мс" />
        <NumField label="Порог аварии" value={draft.failThreshold} onChange={(v) => set({ failThreshold: v })} min={1} suffix="сб." hint="Сбоев подряд до статуса «Авария»" />
        <NumField label="Фактор деградации" value={draft.degradeFactor} onChange={(v) => set({ degradeFactor: v })} min={2} suffix="×" hint="Во сколько раз пинг выше базового — деградация" />
        <NumField label="Мин. задержка деградации" value={draft.degradeMinMs} onChange={(v) => set({ degradeMinMs: v })} min={10} suffix="мс" />
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-line/60 pt-4">
        <button className="btn-acc" onClick={() => store.saveSettings(draft)}>
          <Send className="h-4 w-4" /> Сохранить настройки
        </button>
        <span className="text-[11.5px] text-dim">
          {apiMode === 'server' ? 'Настройки применяются к серверному ядру сразу.' : 'Работает во встроенном режиме.'}
        </span>
      </div>
    </Panel>
  );
}

// ─── Теги ───────────────────────────────────────────────────────────────────

function TagsTab() {
  const tags = usePluto((s) => s.tags);
  const devices = usePluto((s) => s.devices);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [err, setErr] = useState('');

  const add = () => {
    const res = store.addTag(label, color);
    if (res) return setErr(res);
    setLabel('');
    setErr('');
    useToasts.push('ok', 'Тег создан');
  };

  return (
    <Panel title="Теги устройств · до 10 цветов" icon={<TagIcon className="h-4 w-4" />}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Field label="Название тега">
            <input className="inp" value={label} onChange={(e) => { setLabel(e.target.value); setErr(''); }} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Цвет</span>
          <div className="flex gap-1.5">
            {TAG_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={cls('h-7 w-7 rounded-lg transition-all', color === c ? 'scale-110 ring-2 ring-ink/60' : 'opacity-70 hover:opacity-100')}
                style={{ background: c }} />
            ))}
          </div>
        </div>
        <button className="btn-acc" onClick={add}><Plus className="h-4 w-4" /> Создать тег</button>
      </div>
      {err && <p className="mt-2 text-[12px] font-semibold text-crit">{err}</p>}

      {tags.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-line bg-raised/20 px-4 py-5 text-center text-[12.5px] text-dim">
          Тегов пока нет. Создайте первый — например, «Серверная», «Кассы», «Видеонаблюдение».
        </p>
      ) : (
        <ul className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tags.map((t) => {
            const used = devices.filter((d) => d.tags.includes(t.id)).length;
            return (
              <li key={t.id} className="flex items-center gap-2.5 rounded-lg border border-line bg-raised/40 px-3 py-2.5">
                <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: t.color }} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{t.label}</span>
                <span className="font-mono text-[10.5px] text-dim">{used} устр.</span>
                <button onClick={() => { if (window.confirm(`Удалить тег «${t.label}»? Он будет снят со всех устройств.`)) store.removeTag(t.id); }}
                  className="rounded p-1 text-dim transition-colors hover:text-crit">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ─── Уведомления ────────────────────────────────────────────────────────────

function NotifyTab() {
  const settings = usePluto((s) => s.settings);
  const n = settings.notifications;
  const [busy, setBusy] = useState<string | null>(null);

  const upd = (patch: Partial<TSettings['notifications']>) =>
    store.setSettingsRaw({ ...settings, notifications: { ...n, ...patch } });
  const updOn = (k: keyof TSettings['notifications']['on'], v: boolean) =>
    upd({ on: { ...n.on, [k]: v } });

  const save = () => {
    store.saveSettings(settings);
  };

  const test = async (kind: 'push' | 'telegram' | 'email') => {
    if (kind === 'push') {
      const ok = await requestPushPermission();
      if (!ok) {
        useToasts.push('warn', 'Разрешение на уведомления не выдано');
        return;
      }
    }
    setBusy(kind);
    const r = sendTestNotification(kind);
    setBusy(null);
    useToasts.push(r.ok ? 'ok' : 'warn', r.text);
  };

  const EvToggle = ({ k, label }: { k: keyof TSettings['notifications']['on']; label: string }) => (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line bg-raised/40 px-3.5 py-2.5">
      <span className="text-[12.5px] font-semibold text-mut">{label}</span>
      <Toggle checked={n.on[k]} onChange={(v) => updOn(k, v)} />
    </label>
  );

  return (
    <div className="space-y-4">
      <Panel title="Каналы уведомлений" icon={<Bell className="h-4 w-4" />}>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-line bg-raised/30 p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-[13px] font-bold text-ink">Telegram</h4>
              <Toggle checked={n.telegram.enabled} onChange={(v) => upd({ telegram: { ...n.telegram, enabled: v } })} />
            </div>
            <div className="mt-3 space-y-3">
              <Field label="Токен бота">
                <input className="inp font-mono text-[12px]" value={n.telegram.botToken} onChange={(e) => upd({ telegram: { ...n.telegram, botToken: e.target.value } })} />
              </Field>
              <Field label="Chat ID">
                <input className="inp font-mono text-[12px]" value={n.telegram.chatId} onChange={(e) => upd({ telegram: { ...n.telegram, chatId: e.target.value } })} />
              </Field>
              <button className="btn-ghost w-full justify-center" disabled={!n.telegram.enabled || busy === 'telegram'} onClick={() => test('telegram')}>
                Отправить тест
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-raised/30 p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-[13px] font-bold text-ink">E-mail (SMTP)</h4>
              <Toggle checked={n.email.enabled} onChange={(v) => upd({ email: { ...n.email, enabled: v } })} />
            </div>
            <div className="mt-3 space-y-3">
              <Field label="SMTP-сервер"><input className="inp font-mono text-[12px]" value={n.email.smtp} onChange={(e) => upd({ email: { ...n.email, smtp: e.target.value } })} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="От"><input className="inp font-mono text-[12px]" value={n.email.from} onChange={(e) => upd({ email: { ...n.email, from: e.target.value } })} /></Field>
                <Field label="Кому"><input className="inp font-mono text-[12px]" value={n.email.to} onChange={(e) => upd({ email: { ...n.email, to: e.target.value } })} /></Field>
              </div>
              <button className="btn-ghost w-full justify-center" disabled={!n.email.enabled || busy === 'email'} onClick={() => test('email')}>
                Отправить тест
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-raised/30 p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-[13px] font-bold text-ink">Всплывающие окна</h4>
              <Toggle checked={n.push.enabled} onChange={async (v) => { if (v) { const ok = await requestPushPermission(); if (!ok) { useToasts.push('warn', 'Браузер не дал разрешение'); return; } } upd({ push: { enabled: v } }); }} />
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
              Уведомления браузера — видны, даже когда открыта другая вкладка. Работают через системный центр уведомлений.
            </p>
            <button className="btn-ghost mt-3 w-full justify-center" disabled={!n.push.enabled || busy === 'push'} onClick={() => test('push')}>
              Отправить тест
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button className="btn-acc" onClick={save}><Send className="h-4 w-4" /> Сохранить уведомления</button>
          <span className="text-[11.5px] text-dim">Каналы и события применяются после сохранения.</span>
        </div>
      </Panel>

      <Panel title="События, о которых уведомлять" icon={<Bell className="h-4 w-4" />}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <EvToggle k="down" label="Авария: устройство потеряно" />
          <EvToggle k="degraded" label="Деградация связи" />
          <EvToggle k="recover" label="Восстановление связи" />
          <EvToggle k="agentOff" label="Агент вышел из сети" />
          <EvToggle k="agentOn" label="Агент вернулся в сеть" />
        </div>
      </Panel>
    </div>
  );
}

// ─── Пользователи ───────────────────────────────────────────────────────────

function UsersTab() {
  const users = usePluto((s) => s.users);
  const me = useCurrentUser();
  const [form, setForm] = useState({ name: '', login: '', password: '', role: 'viewer' as 'admin' | 'viewer', scope: [] as string[] });
  const [err, setErr] = useState('');

  const toggleScope = (k: string) =>
    setForm((f) => ({ ...f, scope: f.scope.includes(k) ? f.scope.filter((x) => x !== k) : [...f.scope, k] }));

  const add = () => {
    const res = store.addUser(form);
    if (res) return setErr(res);
    setForm({ name: '', login: '', password: '', role: 'viewer', scope: [] });
    setErr('');
    useToasts.push('ok', 'Пользователь создан');
  };

  return (
    <div className="space-y-4">
      <Panel title="Создать пользователя" icon={<Users className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Имя"><input className="inp" value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setErr(''); }} /></Field>
          <Field label="Логин"><input className="inp font-mono" value={form.login} onChange={(e) => { setForm({ ...form, login: e.target.value }); setErr(''); }} /></Field>
          <Field label="Пароль"><input className="inp font-mono" type="password" value={form.password} onChange={(e) => { setForm({ ...form, password: e.target.value }); setErr(''); }} /></Field>
          <Field label="Роль">
            <div className="flex gap-1.5">
              <button onClick={() => setForm({ ...form, role: 'viewer' })} className={cls('flex-1 rounded-lg border px-2 py-2 text-[11.5px] font-bold transition-all', form.role === 'viewer' ? 'border-vio/50 bg-vio/15 text-vio' : 'border-line bg-raised/50 text-dim')}>Наблюдатель</button>
              <button onClick={() => setForm({ ...form, role: 'admin' })} className={cls('flex-1 rounded-lg border px-2 py-2 text-[11.5px] font-bold transition-all', form.role === 'admin' ? 'border-vio/50 bg-vio/15 text-vio' : 'border-line bg-raised/50 text-dim')}>Админ</button>
            </div>
          </Field>
        </div>

        {form.role === 'viewer' && (
          <div className="mt-4">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Что видит наблюдатель</span>
            <div className="flex flex-wrap gap-1.5">
              {DEVICE_TYPES.map((t) => (
                <button key={t} onClick={() => toggleScope(t)}
                  className={cls('rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold transition-all', form.scope.includes(t) ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                  {DEVICE_TYPE_META[t].label}
                </button>
              ))}
              <button onClick={() => toggleScope('agent')}
                className={cls('rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold transition-all', form.scope.includes('agent') ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                АГЕНТЫ
              </button>
              <button onClick={() => toggleScope('glances')}
                className={cls('rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold transition-all', form.scope.includes('glances') ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                GLANCES
              </button>
            </div>
          </div>
        )}

        {err && <p className="mt-3 text-[12px] font-semibold text-crit">{err}</p>}
        <button className="btn-acc mt-4" onClick={add}><Plus className="h-4 w-4" /> Создать</button>
      </Panel>

      <Panel title="Пользователи" icon={<Users className="h-4 w-4" />} bodyClass="p-0">
        <ul className="divide-y divide-line/50">
          {users.map((u: User) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-vio/15 font-display text-[13px] font-bold text-vio ring-1 ring-vio/25">
                {u.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">{u.name}</span>
                  <span className={cls('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide', u.role === 'admin' ? 'bg-vio/20 text-vio' : 'bg-raised text-dim')}>
                    {u.role === 'admin' ? 'администратор' : 'наблюдатель'}
                  </span>
                  {u.builtIn && <span className="text-[9.5px] uppercase tracking-wide text-dim">встроенный</span>}
                </div>
                <div className="mt-0.5 font-mono text-[10.5px] text-dim">
                  {u.login}{u.scope.length > 0 && <> · доступ: {u.scope.map((s) => s.toUpperCase()).join(', ')}</>}
                </div>
              </div>
              {u.id !== me?.id && !u.builtIn && (
                <button onClick={() => { if (window.confirm(`Удалить пользователя «${u.name}»?`)) store.removeUser(u.id); }}
                  className="rounded p-1.5 text-dim transition-colors hover:text-crit">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

// ─── База данных: удаление записей ─────────────────────────────────────────

function DatabaseTab() {
  const devices = usePluto((s) => s.devices);
  const agents = usePluto((s) => s.agents);
  const glances = usePluto((s) => s.glances);
  const [confirm, setConfirm] = useState<string | null>(null);

  const Row = ({ icon, title, sub, badge, onDel }: { icon: React.ReactNode; title: string; sub: string; badge?: string; onDel: () => void }) => (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="text-dim">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-ink">{title}</div>
        <div className="truncate font-mono text-[10.5px] text-dim">{sub}</div>
      </div>
      {badge && <span className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-dim">{badge}</span>}
      {confirm === title ? (
        <div className="flex gap-1.5">
          <button className="btn-danger !px-2.5 !py-1 !text-[11px]" onClick={() => { onDel(); setConfirm(null); }}>Точно?</button>
          <button className="btn-ghost !px-2.5 !py-1 !text-[11px]" onClick={() => setConfirm(null)}>Нет</button>
        </div>
      ) : (
        <button onClick={() => setConfirm(title)} className="rounded p-1.5 text-dim transition-colors hover:text-crit">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed text-dim">
        Удаление записей из базы. Действие необратимо: история и архивы стираются. Удаление двухшаговое — нажмите «Точно?» для подтверждения.
      </p>

      <Panel title={`Устройства · ${devices.length}`} icon={<Server className="h-4 w-4" />} bodyClass="p-0">
        {devices.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-dim">Устройств нет</p>
        ) : (
          <ul className="divide-y divide-line/50">
            {devices.map((d) => (
              <Row key={d.id} icon={<Server className="h-4 w-4" />} title={d.name} sub={`${d.address} · ${d.type.toUpperCase()}`} badge={d.status} onDel={() => store.removeDevice(d.id)} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Агенты · ${agents.length}`} icon={<Monitor className="h-4 w-4" />} bodyClass="p-0">
        {agents.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-dim">Агентов нет</p>
        ) : (
          <ul className="divide-y divide-line/50">
            {agents.map((a) => (
              <Row key={a.id} icon={<Monitor className="h-4 w-4" />} title={a.name} sub={a.ip || '—'} badge={a.online ? 'в сети' : 'офлайн'} onDel={() => store.removeAgent(a.id)} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Серверы Glances · ${glances.length}`} icon={<BarChart3 className="h-4 w-4" />} bodyClass="p-0">
        {glances.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-dim">Glances-устройств нет</p>
        ) : (
          <ul className="divide-y divide-line/50">
            {glances.map((g) => (
              <Row key={g.id} icon={<BarChart3 className="h-4 w-4" />} title={g.name} sub={g.url} badge={g.online ? 'доступен' : 'нет'} onDel={() => store.removeGlancesDevice(g.id)} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ─── Зеркало-ретранслятор ───────────────────────────────────────────────────

function MirrorTab() {
  const settings = usePluto((s) => s.settings);
  const mirror = usePluto((s) => s.mirror);
  const mirrorLast = usePluto((s) => s.mirrorLast);
  const syncedAt = usePluto((s) => s.mirrorSyncedAt);
  const [draft, setDraft] = useState<TSettings['mirror']>(settings.mirror);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(settings.mirror); }, [settings.mirror]);

  const save = () => {
    store.saveSettings({ ...settings, mirror: { ...draft, url: draft.url.trim().replace(/\/+$/, ''), interval: Math.min(3600, Math.max(30, draft.interval)) } });
  };

  const sendNow = async () => {
    setBusy(true);
    await store.syncMirrorNow();
    setBusy(false);
  };

  // Если мы на зеркале — показываем состояние приёма, а не отправку
  if (mirror) {
    return (
      <Panel title="Режим зеркала" icon={<Radio className="h-4 w-4" />}>
        <div className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-3.5">
          <p className="text-[13px] font-semibold text-warn">Этот экземпляр — зеркало-ретранслятор (только чтение).</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-mut">
            Данные получены от основного сервера {syncedAt ? timeAgo(syncedAt) : 'ещё не синхронизированы'}.
            Здесь нельзя добавлять устройства, агентов или менять настройки — все изменения делайте на основном сервере в локальной сети.
            Зеркало не опрашивает устройства, а лишь показывает последнюю копию состояния.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel title="Отправка копии на ретранслятор" icon={<Radio className="h-4 w-4" />}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised/40 px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">Отправлять снапшот состояния</p>
              <p className="mt-0.5 text-[11.5px] text-dim">Устройства, агенты, события — без паролей и настроек</p>
            </div>
            <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
          </div>

          <Field label="Адрес зеркала" hint="Публичный URL ретранслятора с HTTPS, например https://pluto.example.com">
            <input className="inp font-mono" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://pluto.example.com" disabled={!draft.enabled} />
          </Field>

          <Field label="Секрет (MIRROR_SECRET)" hint="Должен совпадать с переменной MIRROR_SECRET в docker-compose зеркала. Минимум 32 символа.">
            <input className="inp font-mono" type="password" value={draft.secret} onChange={(e) => setDraft({ ...draft, secret: e.target.value })} disabled={!draft.enabled} />
          </Field>

          <Field label="Интервал синхронизации" hint="Как часто отправлять снапшот, сек (30–3600). По умолчанию 60.">
            <div className="flex items-center gap-2">
              <input className="inp font-mono" type="number" min={30} max={3600} value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: parseInt(e.target.value, 10) || 60 })} disabled={!draft.enabled} />
              <span className="shrink-0 font-mono text-[11px] text-dim">сек</span>
            </div>
          </Field>

          <div className="flex items-center gap-2 pt-1">
            <button className="btn-acc" onClick={save}><RefreshCw className="h-4 w-4" /> Сохранить</button>
            <button className="btn-ghost" onClick={sendNow} disabled={busy || !draft.enabled || !draft.url || !draft.secret}>
              <RefreshCw className={cls('h-4 w-4', busy && 'animate-spin')} /> Отправить сейчас
            </button>
          </div>
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="Статус" icon={<Radio className="h-4 w-4" />}>
          {mirrorLast ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-dim">Последняя отправка</span>
                <span className="font-mono text-[12px] text-mut">{timeAgo(mirrorLast.t)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-dim">Результат</span>
                <span className={cls('font-mono text-[12px] font-semibold', mirrorLast.ok ? 'text-ok' : 'text-crit')}>{mirrorLast.ok ? 'успешно' : 'ошибка'}</span>
              </div>
              {mirrorLast.error && <p className="rounded border border-crit/30 bg-crit/10 px-2.5 py-1.5 text-[11px] text-crit">{mirrorLast.error}</p>}
            </div>
          ) : (
            <p className="text-[12px] text-dim">Отправок ещё не было. Сохраните настройки и нажмите «Отправить сейчас».</p>
          )}
        </Panel>

        <Panel title="Как это работает" icon={<Radio className="h-4 w-4" />}>
          <p className="text-[12px] leading-relaxed text-dim">
            Основной сервер (в локальной сети) каждые N секунд собирает снапшот состояния и отправляет его по HTTPS на публичный
            read-only экземпляр. Зеркало не опрашивает устройства и не принимает изменений — даже при его компрометации
            злоумышленник получит только витрину статусов, без паролей, сессий и настроек. Управление — только через локальную сеть.
          </p>
        </Panel>
      </div>
    </div>
  );
}
