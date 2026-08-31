// ─── PLUTO: настройки системы ────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Send, Tag as TagIcon, Bell, Users, Database, Plus, Trash2, Server, Monitor, LayoutGrid } from 'lucide-react';
import { Field, Panel, Toggle } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts } from '../lib/store';
import { requestPushPermission, sendTestNotification } from '../lib/engine';
import { cls, TAG_COLORS } from '../lib/util';
import { DEVICE_TYPES, DEVICE_TYPE_META, type DeviceType, type Settings as TSettings, type User } from '../lib/types';

type Tab = 'polling' | 'tags' | 'notify' | 'users' | 'database';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('polling');
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'polling', label: 'Опросы и пороги', icon: <Send className="h-3.5 w-3.5" /> },
    { id: 'tags', label: 'Теги', icon: <TagIcon className="h-3.5 w-3.5" /> },
    { id: 'notify', label: 'Уведомления', icon: <Bell className="h-3.5 w-3.5" /> },
    { id: 'users', label: 'Пользователи', icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'database', label: 'База данных', icon: <Database className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cls('flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold transition-all',
              tab === t.id ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-panel/70 text-dim hover:text-mut')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      {tab === 'polling' && <PollingTab />}
      {tab === 'tags' && <TagsTab />}
      {tab === 'notify' && <NotifyTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'database' && <DatabaseTab />}
    </div>
  );
}

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
  const [draft, setDraft] = useState<TSettings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const set = (patch: Partial<TSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const setInt = (k: DeviceType | 'agent', v: number) => setDraft((d) => ({ ...d, intervals: { ...d.intervals, [k]: v } }));

  return (
    <Panel title="Интервалы опроса и пороги" icon={<Send className="h-4 w-4" />}
      right={<button onClick={() => store.saveSettings(draft)} className="rounded-lg border border-vio/50 bg-vio/20 px-3.5 py-1.5 text-[12.5px] font-bold text-ink transition-all hover:bg-vio/30">Сохранить</button>}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DEVICE_TYPES.map((t) => (
          <NumField key={t} label={`${DEVICE_TYPE_META[t].label} — интервал`} value={draft.intervals[t]} onChange={(v) => setInt(t, v)} min={5} suffix="сек" />
        ))}
        <NumField label="Relay-агенты — интервал" value={draft.intervals.agent} onChange={(v) => setInt('agent', v)} min={10} suffix="сек" hint="Пинг ПК и его целей через relay" />
        <NumField label="Таймаут проверки" value={draft.timeoutMs} onChange={(v) => set({ timeoutMs: v })} min={500} suffix="мс" />
        <NumField label="Порог аварии" value={draft.failThreshold} onChange={(v) => set({ failThreshold: v })} min={1} suffix="сб." hint="Сколько сбоев подряд считать аварией" />
        <NumField label="Фактор деградации" value={draft.degradeFactor} onChange={(v) => set({ degradeFactor: v })} min={2} suffix="×" hint="Во сколько раз пинг выше обычного — деградация" />
        <NumField label="Мин. задержка деградации" value={draft.degradeMinMs} onChange={(v) => set({ degradeMinMs: v })} min={10} suffix="мс" />
      </div>
    </Panel>
  );
}

function TagsTab() {
  const tags = usePluto((s) => s.tags);
  const devices = usePluto((s) => s.devices);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [err, setErr] = useState('');

  const add = () => {
    const res = store.addTag(label, color);
    if (res) setErr(res);
    else { setLabel(''); setErr(''); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Новый тег" icon={<Plus className="h-4 w-4" />}>
        <div className="space-y-4">
          <Field label="Название">
            <input className="inp" value={label} onChange={(e) => { setLabel(e.target.value); setErr(''); }} placeholder="Например: Склад" />
          </Field>
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Цвет (до 10 в палитре)</span>
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className={cls('h-8 w-8 rounded-full border-2 transition-transform hover:scale-110', color === c ? 'border-ink' : 'border-transparent')}
                  style={{ background: c }} title={c} />
              ))}
            </div>
          </div>
          {err && <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}
          <button onClick={add} className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">
            Создать тег
          </button>
        </div>
      </Panel>

      <Panel title={`Существующие теги · ${tags.length}`} icon={<TagIcon className="h-4 w-4" />}>
        {tags.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-dim">Тегов пока нет — создайте первый слева.</p>
        ) : (
          <ul className="space-y-2">
            {tags.map((t) => {
              const used = devices.filter((d) => d.tags.includes(t.id)).length;
              return (
                <li key={t.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised/40 px-3 py-2">
                  <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: t.color }} />
                  <span className="flex-1 text-[13px] font-semibold text-ink">{t.label}</span>
                  <span className="font-mono text-[11px] text-dim">{used} устр.</span>
                  <button onClick={() => { if (window.confirm(`Удалить тег «${t.label}»?`)) store.removeTag(t.id); }}
                    className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-crit">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function NotifyTab() {
  const settings = usePluto((s) => s.settings);
  const [n, setN] = useState<TSettings['notifications']>(settings.notifications);
  useEffect(() => setN(settings.notifications), [settings.notifications]);
  const save = () => store.saveSettings({ ...settings, notifications: n });

  const Row = ({ title, sub, checked, onChange }: { title: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised/40 px-4 py-3">
      <div>
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        {sub && <p className="mt-0.5 text-[11px] text-dim">{sub}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );

  return (
    <div className="space-y-4">
      <Panel title="Каналы уведомлений" icon={<Bell className="h-4 w-4" />}
        right={<button onClick={save} className="rounded-lg border border-vio/50 bg-vio/20 px-3.5 py-1.5 text-[12.5px] font-bold text-ink transition-all hover:bg-vio/30">Сохранить</button>}>
        <div className="space-y-3">
          <Row title="Всплывающие окна браузера" sub="Даже если открыта другая вкладка"
            checked={n.push.enabled} onChange={(v) => { setN({ ...n, push: { enabled: v } }); if (v) void requestPushPermission(); }} />
          <div className="rounded-lg border border-line bg-raised/40 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-ink">Telegram</p>
                <p className="mt-0.5 text-[11px] text-dim">Через Bot API</p>
              </div>
              <Toggle checked={n.telegram.enabled} onChange={(v) => setN({ ...n, telegram: { ...n.telegram, enabled: v } })} />
            </div>
            {n.telegram.enabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Токен бота"><input className="inp font-mono" value={n.telegram.botToken} onChange={(e) => setN({ ...n, telegram: { ...n.telegram, botToken: e.target.value } })} /></Field>
                <Field label="Chat ID"><input className="inp font-mono" value={n.telegram.chatId} onChange={(e) => setN({ ...n, telegram: { ...n.telegram, chatId: e.target.value } })} /></Field>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-line bg-raised/40 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-ink">E-mail</p>
                <p className="mt-0.5 text-[11px] text-dim">SMTP на серверном ядре</p>
              </div>
              <Toggle checked={n.email.enabled} onChange={(v) => setN({ ...n, email: { ...n.email, enabled: v } })} />
            </div>
            {n.email.enabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="SMTP"><input className="inp font-mono" value={n.email.smtp} onChange={(e) => setN({ ...n, email: { ...n.email, smtp: e.target.value } })} /></Field>
                <Field label="От"><input className="inp font-mono" value={n.email.from} onChange={(e) => setN({ ...n, email: { ...n.email, from: e.target.value } })} /></Field>
                <Field label="Кому"><input className="inp font-mono" value={n.email.to} onChange={(e) => setN({ ...n, email: { ...n.email, to: e.target.value } })} /></Field>
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="События" icon={<Bell className="h-4 w-4" />}
        right={<button onClick={save} className="rounded-lg border border-vio/50 bg-vio/20 px-3.5 py-1.5 text-[12.5px] font-bold text-ink transition-all hover:bg-vio/30">Сохранить</button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Row title="Авария (потеря связи)" checked={n.on.down} onChange={(v) => setN({ ...n, on: { ...n.on, down: v } })} />
          <Row title="Деградация связи" checked={n.on.degraded} onChange={(v) => setN({ ...n, on: { ...n.on, degraded: v } })} />
          <Row title="Восстановление связи" checked={n.on.recover} onChange={(v) => setN({ ...n, on: { ...n.on, recover: v } })} />
          <Row title="Relay-агент вышел из сети" checked={n.on.agentOff} onChange={(v) => setN({ ...n, on: { ...n.on, agentOff: v } })} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(['push', 'telegram', 'email'] as const).map((k) => (
            <button key={k} onClick={() => { const r = sendTestNotification(k); useToasts.push(r.ok ? 'ok' : 'warn', r.text); }}
              className="rounded-lg border border-line bg-raised/50 px-3.5 py-2 text-[12.5px] font-semibold text-mut transition-colors hover:text-ink">
              Тест: {k === 'push' ? 'браузер' : k}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function UsersTab() {
  const users = usePluto((s) => s.users);
  const me = useCurrentUser();
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<User['role']>('viewer');
  const [scope, setScope] = useState<DeviceType[]>([]);
  const [seeAgents, setSeeAgents] = useState(false);
  const [err, setErr] = useState('');

  const add = () => {
    const res = store.addUser({ login, name, role, scope: seeAgents ? [...scope, 'agent' as never] : scope });
    if (res) setErr(res);
    else { setLogin(''); setName(''); setScope([]); setSeeAgents(false); setErr(''); }
  };
  const toggleScope = (t: DeviceType) => setScope((s) => s.includes(t) ? s.filter((x) => x !== t) : [...s, t]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Новый пользователь" icon={<Plus className="h-4 w-4" />}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Логин"><input className="inp font-mono" value={login} onChange={(e) => { setLogin(e.target.value); setErr(''); }} /></Field>
            <Field label="Имя"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          </div>
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Роль</span>
            <div className="flex gap-1.5">
              {([['viewer', 'Наблюдатель'], ['admin', 'Администратор']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setRole(v)}
                  className={cls('rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-all', role === v ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {role === 'viewer' && (
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Видимые типы устройств</span>
              <div className="flex flex-wrap gap-1.5">
                {DEVICE_TYPES.map((t) => (
                  <button key={t} onClick={() => toggleScope(t)}
                    className={cls('rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all', scope.includes(t) ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                    {DEVICE_TYPE_META[t].label}
                  </button>
                ))}
                <button onClick={() => setSeeAgents((v) => !v)}
                  className={cls('rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all', seeAgents ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                  АГЕНТЫ
                </button>
              </div>
            </div>
          )}
          {err && <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}
          <button onClick={add} className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">Создать</button>
        </div>
      </Panel>

      <Panel title={`Пользователи · ${users.length}`} icon={<Users className="h-4 w-4" />}>
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised/40 px-3 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-vio/25 font-display text-[12px] font-bold text-vio ring-1 ring-vio/30">
                {u.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{u.name}{u.id === me?.id && <span className="ml-1.5 text-[10px] text-dim">(вы)</span>}</div>
                <div className="font-mono text-[10.5px] text-dim">
                  {u.login} · {u.role === 'admin' ? 'админ' : (u.scope as string[]).join(', ') || 'нет доступа'}
                </div>
              </div>
              {!u.builtIn && (
                <button onClick={() => { if (window.confirm(`Удалить пользователя «${u.name}»?`)) store.removeUser(u.id); }}
                  className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-crit">
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

function DatabaseTab() {
  const devices = usePluto((s) => s.devices);
  const agents = usePluto((s) => s.agents);
  const events = usePluto((s) => s.events);
  const shown = devices.filter((d) => d.showcase).length;

  const Card = ({ icon, title, value, sub }: { icon: React.ReactNode; title: string; value: number; sub: string }) => (
    <div className="rounded-xl border border-line bg-raised/40 p-4">
      <div className="flex items-center gap-2 text-dim">{icon}<span className="text-[11px] font-bold uppercase tracking-wider">{title}</span></div>
      <div className="mt-2 font-display text-[26px] font-bold text-ink">{value}</div>
      <div className="text-[11px] text-dim">{sub}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card icon={<Server className="h-4 w-4" />} title="Устройства" value={devices.length} sub={`${shown} на витрине`} />
        <Card icon={<Monitor className="h-4 w-4" />} title="Relay-агенты" value={agents.length} sub={`${agents.filter((a) => a.online).length} на связи`} />
        <Card icon={<LayoutGrid className="h-4 w-4" />} title="На витрине" value={shown} sub="публично, без входа" />
        <Card icon={<Bell className="h-4 w-4" />} title="Событий" value={events.length} sub="в журнале" />
      </div>
      <Panel title="Хранение" icon={<Database className="h-4 w-4" />}>
        <p className="text-[12.5px] leading-relaxed text-dim">
          База — один файл <code className="rounded bg-void/50 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">data/db.json</code> в томе
          Docker <code className="rounded bg-void/50 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">pluto-data</code>. Он переживает пересборку
          образа и <code className="font-mono">docker compose down</code> (без <code className="font-mono">-v</code>). Бэкап — простое копирование файла.
        </p>
      </Panel>
    </div>
  );
}
