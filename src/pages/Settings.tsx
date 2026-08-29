// ─── PLUTO: настройки системы ───────────────────────────────────────────────
import { useMemo, useState } from 'react';
import {
  BarChart3, Bell, Database, Mail, Monitor, Plus, Save, Send, Server, Shield, Tag as TagIcon, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { Panel, Field, Toggle, Modal } from '../components/ui';
import { usePluto, store, useToasts } from '../lib/store';
import { sendTestNotification, requestPushPermission } from '../lib/engine';
import { TAG_COLORS, CONSOLE_VERSION, cls } from '../lib/util';
import { DEVICE_TYPES, DEVICE_TYPE_META, type Settings as TSettings, type User, type DeviceType } from '../lib/types';

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
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cls(
              'flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold transition-all',
              tab === t.id
                ? 'border-vio/50 bg-vio/15 text-ink shadow-[0_0_0_1px_rgba(143,125,240,.2)]'
                : 'border-line bg-raised/50 text-dim hover:border-line/80 hover:text-mut',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10.5px] text-dim">PLUTO v{CONSOLE_VERSION}</span>
      </div>

      {tab === 'polling' && <PollingTab />}
      {tab === 'tags' && <TagsTab />}
      {tab === 'notify' && <NotifyTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'database' && <DatabaseTab />}
    </div>
  );
}

// ─── Опросы и пороги ────────────────────────────────────────────────────────

function NumField({ label, value, onChange, min = 1, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number; suffix?: string }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="number" min={min} step={step} value={value}
          onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
          className="w-28 rounded-lg border border-line bg-raised/60 px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-vio/60"
        />
        {suffix && <span className="text-[11.5px] text-dim">{suffix}</span>}
      </div>
    </Field>
  );
}

function PollingTab() {
  const settings = usePluto((s) => s.settings);
  const [draft, setDraft] = useState<TSettings>({ ...settings, intervals: { ...settings.intervals }, notifications: settings.notifications });
  const set = (p: Partial<TSettings>) => setDraft((d) => ({ ...d, ...p }));
  const setInt = (k: DeviceType | 'glances' | 'agent' | 'aida', v: number) => setDraft((d) => ({ ...d, intervals: { ...d.intervals, [k]: v } }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Интервалы опроса по типам" icon="send">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {DEVICE_TYPES.map((t) => (
            <NumField key={t} label={`${DEVICE_TYPE_META[t].label} — интервал`} value={draft.intervals[t]} onChange={(v) => setInt(t, v)} min={5} suffix="сек" />
          ))}
          <NumField label="Glances (Bars) — интервал" value={draft.intervals.glances ?? 60} onChange={(v) => setInt('glances', v)} min={15} suffix="сек" />
          <NumField label="Агенты — интервал опроса" value={draft.intervals.agent ?? 30} onChange={(v) => setInt('agent', v)} min={10} suffix="сек" />
          <NumField label="Датчик AIDA64 — интервал" value={draft.intervals.aida ?? 60} onChange={(v) => setInt('aida', v)} min={15} suffix="сек" />
        </div>
      </Panel>

      <Panel title="Пороги и таймауты" icon="alert">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <NumField label="Таймаут проверки" value={draft.timeoutMs} onChange={(v) => set({ timeoutMs: v })} min={500} step={500} suffix="мс" />
          <NumField label="Сбоев подряд до аварии" value={draft.failThreshold} onChange={(v) => set({ failThreshold: v })} min={1} />
          <NumField label="Фактор деградации" value={draft.degradeFactor} onChange={(v) => set({ degradeFactor: v })} min={2} suffix="×" />
          <NumField label="Деградация от" value={draft.degradeMinMs} onChange={(v) => set({ degradeMinMs: v })} min={50} step={50} suffix="мс" />
        </div>
        <p className="mt-4 text-[11.5px] leading-relaxed text-dim">
          Деградация — когда задержка выше базовой (скользящее среднее устройства) в <b className="text-mut">{draft.degradeFactor} раз</b> и не ниже {draft.degradeMinMs} мс.
        </p>
      </Panel>

      <div className="lg:col-span-2 flex justify-end">
        <button
          onClick={() => { store.saveSettings(draft); }}
          className="flex items-center gap-2 rounded-lg border border-vio/50 bg-vio/15 px-4 py-2 text-[13px] font-semibold text-ink transition-all hover:bg-vio/25"
        >
          <Save className="h-4 w-4" /> Сохранить настройки
        </button>
      </div>
    </div>
  );
}

// ─── Теги ───────────────────────────────────────────────────────────────────

function TagsTab() {
  const tags = usePluto((s) => s.tags);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);

  const add = () => {
    const err = store.addTag(label, color);
    if (err) useToasts.push('warn', err);
    else { setLabel(''); useToasts.push('ok', 'Тег создан'); }
  };

  return (
    <Panel title="Теги устройств (до 10 цветов)" icon="tag">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Field label="Название тега">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Например: склад"
              className="w-full rounded-lg border border-line bg-raised/60 px-3 py-2 text-[13px] text-ink outline-none focus:border-vio/60" />
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Цвет</span>
          <div className="flex flex-wrap gap-1.5">
            {TAG_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={cls('h-7 w-7 rounded-full border-2 transition-transform hover:scale-110', color === c ? 'border-ink' : 'border-transparent')}
                style={{ background: c }} aria-label={c} />
            ))}
          </div>
        </div>
        <button onClick={add} className="flex items-center gap-2 rounded-lg border border-vio/50 bg-vio/15 px-4 py-2 text-[13px] font-semibold text-ink transition-all hover:bg-vio/25">
          <Plus className="h-4 w-4" /> Добавить
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {tags.length === 0 && <p className="text-[12.5px] text-dim">Тегов пока нет — создайте первый выше.</p>}
        {tags.map((t) => (
          <span key={t.id} className="group flex items-center gap-2 rounded-full border border-line bg-raised/60 py-1 pl-3 pr-1.5 text-[12.5px] font-medium text-ink">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
            {t.label}
            <button onClick={() => store.removeTag(t.id)} className="rounded-full p-1 text-dim transition-colors hover:bg-crit/15 hover:text-crit">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </Panel>
  );
}

// ─── Уведомления ────────────────────────────────────────────────────────────

function NotifyTab() {
  const settings = usePluto((s) => s.settings);
  const [n, setN] = useState(settings.notifications);
  const set = (p: Partial<typeof n>) => setN((d) => ({ ...d, ...p }));
  const [testResult, setTestResult] = useState<string | null>(null);

  const save = () => {
    store.saveSettings({ ...settings, notifications: n });
  };

  const test = (kind: 'push' | 'telegram' | 'email') => {
    save();
    if (kind === 'push') requestPushPermission();
    const r = sendTestNotification(kind);
    setTestResult(r.text);
    useToasts.push(r.ok ? 'ok' : 'warn', r.text);
  };

  const events: { k: keyof typeof n.on; label: string }[] = [
    { k: 'down', label: 'Авария (потеря связи)' },
    { k: 'degraded', label: 'Деградация связи' },
    { k: 'recover', label: 'Восстановление' },
    { k: 'agentOff', label: 'Агент офлайн' },
    { k: 'agentOn', label: 'Агент в сети' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Telegram" icon="send">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-mut">Включено</span>
              <Toggle checked={n.telegram.enabled} onChange={(v) => set({ telegram: { ...n.telegram, enabled: v } })} />
            </div>
            <Field label="Токен бота">
              <input value={n.telegram.botToken} onChange={(e) => set({ telegram: { ...n.telegram, botToken: e.target.value } })}
                className="w-full rounded-lg border border-line bg-raised/60 px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-vio/60" />
            </Field>
            <Field label="Chat ID">
              <input value={n.telegram.chatId} onChange={(e) => set({ telegram: { ...n.telegram, chatId: e.target.value } })}
                className="w-full rounded-lg border border-line bg-raised/60 px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-vio/60" />
            </Field>
            <button onClick={() => test('telegram')} className="flex items-center gap-2 rounded-lg border border-line bg-raised/60 px-3 py-1.5 text-[12px] font-semibold text-mut transition-all hover:text-ink">
              <Send className="h-3.5 w-3.5" /> Тест
            </button>
          </div>
        </Panel>

        <Panel title="E-mail (SMTP)" icon="mail">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-mut">Включено</span>
              <Toggle checked={n.email.enabled} onChange={(v) => set({ email: { ...n.email, enabled: v } })} />
            </div>
            <Field label="SMTP-хост">
              <input value={n.email.smtp} onChange={(e) => set({ email: { ...n.email, smtp: e.target.value } })}
                className="w-full rounded-lg border border-line bg-raised/60 px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-vio/60" />
            </Field>
            <Field label="Кому">
              <input value={n.email.to} onChange={(e) => set({ email: { ...n.email, to: e.target.value } })}
                className="w-full rounded-lg border border-line bg-raised/60 px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-vio/60" />
            </Field>
            <button onClick={() => test('email')} className="flex items-center gap-2 rounded-lg border border-line bg-raised/60 px-3 py-1.5 text-[12px] font-semibold text-mut transition-all hover:text-ink">
              <Mail className="h-3.5 w-3.5" /> Тест
            </button>
          </div>
        </Panel>

        <Panel title="Всплывающие окна" icon="bell">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-mut">Включено</span>
              <Toggle checked={n.push.enabled} onChange={(v) => set({ push: { ...n.push, enabled: v } })} />
            </div>
            <p className="text-[11.5px] leading-relaxed text-dim">
              Работают, даже когда PLUTO открыт в другой вкладке. Браузер запросит разрешение на уведомления.
            </p>
            <button onClick={() => test('push')} className="flex items-center gap-2 rounded-lg border border-line bg-raised/60 px-3 py-1.5 text-[12px] font-semibold text-mut transition-all hover:text-ink">
              <Bell className="h-3.5 w-3.5" /> Тест
            </button>
          </div>
        </Panel>
      </div>

      <Panel title="Какие события присылать" icon="alert">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <div key={e.k} className="flex items-center justify-between rounded-lg border border-line bg-raised/40 px-3.5 py-2.5">
              <span className="text-[12.5px] font-medium text-mut">{e.label}</span>
              <Toggle checked={n.on[e.k]} onChange={(v) => set({ on: { ...n.on, [e.k]: v } })} />
            </div>
          ))}
        </div>
      </Panel>

      <div className="flex items-center justify-end gap-3">
        {testResult && <span className="text-[11.5px] text-dim">{testResult}</span>}
        <button onClick={save} className="flex items-center gap-2 rounded-lg border border-vio/50 bg-vio/15 px-4 py-2 text-[13px] font-semibold text-ink transition-all hover:bg-vio/25">
          <Save className="h-4 w-4" /> Сохранить уведомления
        </button>
      </div>
    </div>
  );
}

// ─── Пользователи ───────────────────────────────────────────────────────────

function UsersTab() {
  const users = usePluto((s) => s.users);
  const [modal, setModal] = useState(false);
  return (
    <Panel
      title="Пользователи и роли" icon="users"
      right={
        <button onClick={() => setModal(true)} className="flex items-center gap-1.5 rounded-lg border border-vio/50 bg-vio/15 px-3 py-1.5 text-[12px] font-semibold text-ink transition-all hover:bg-vio/25">
          <UserPlus className="h-3.5 w-3.5" /> Добавить
        </button>
      }
    >
      <div className="space-y-2">
        {users.map((u) => <UserRow key={u.id} u={u} />)}
      </div>
      <AddUserModal open={modal} onClose={() => setModal(false)} />
    </Panel>
  );
}

function UserRow({ u }: { u: User }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-raised/40 px-3.5 py-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-vio-deep/40 font-display text-[13px] font-bold text-vio ring-1 ring-vio/30">
        {u.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          {u.name}
          {u.builtIn && <span className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[9.5px] uppercase text-dim">системный</span>}
        </div>
        <div className="text-[11px] text-dim">
          {u.role === 'admin' ? 'администратор — полный доступ' : `наблюдатель · ${u.scope.length ? u.scope.map((s) => s.toUpperCase()).join(', ') : 'без прав'}`}
        </div>
      </div>
      {!u.builtIn && (
        <button onClick={() => store.removeUser(u.id)} className="rounded-md p-1.5 text-dim transition-colors hover:bg-crit/15 hover:text-crit">
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer');
  const [scope, setScope] = useState<string[]>([]);

  const toggleScope = (t: string) => setScope((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const submit = () => {
    const err = store.addUser({ name, password, role, scope: role === 'viewer' ? scope : [] });
    if (err) useToasts.push('warn', err);
    else { useToasts.push('ok', `Пользователь ${name} создан`); onClose(); setName(''); setPassword(''); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Новый пользователь">
      <div className="space-y-4">
        <Field label="Логин">
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-line bg-raised/60 px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-vio/60" />
        </Field>
        <Field label="Пароль">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-line bg-raised/60 px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-vio/60" />
        </Field>
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Роль</span>
          <div className="flex gap-2">
            {(['viewer', 'admin'] as const).map((r) => (
              <button key={r} onClick={() => setRole(r)}
                className={cls('flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition-all', role === r ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                {r === 'admin' ? 'Администратор' : 'Наблюдатель'}
              </button>
            ))}
          </div>
        </div>
        {role === 'viewer' && (
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Видимые типы устройств</span>
            <div className="flex flex-wrap gap-2">
              {DEVICE_TYPES.map((t) => (
                <button key={t} onClick={() => toggleScope(t)}
                  className={cls('rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold transition-all', scope.includes(t) ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                  {DEVICE_TYPE_META[t].label}
                </button>
              ))}
              <button onClick={() => toggleScope('agent')}
                className={cls('rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold transition-all', scope.includes('agent') ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                АГЕНТЫ
              </button>
              <button onClick={() => toggleScope('glances')}
                className={cls('rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold transition-all', scope.includes('glances') ? 'border-vio/50 bg-vio/15 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                GLANCES
              </button>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg border border-line bg-raised/60 px-4 py-2 text-[13px] font-semibold text-dim transition-all hover:text-ink">Отмена</button>
          <button onClick={submit} className="flex items-center gap-2 rounded-lg border border-vio/50 bg-vio/15 px-4 py-2 text-[13px] font-semibold text-ink transition-all hover:bg-vio/25">
            <Shield className="h-4 w-4" /> Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── База данных (удаление устройств и агентов) ─────────────────────────────

function DeleteBtn({ onDel, label }: { onDel: () => void; label: string }) {
  const [arm, setArm] = useState(false);
  return arm ? (
    <button
      onClick={() => { onDel(); setArm(false); }}
      className="rounded-md border border-crit/50 bg-crit/15 px-2.5 py-1 text-[11px] font-bold text-crit transition-colors hover:bg-crit/25"
    >
      Точно?
    </button>
  ) : (
    <button
      onClick={() => setArm(true)}
      title={label}
      className="rounded-md p-1.5 text-dim transition-colors hover:bg-crit/10 hover:text-crit"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function RowItem({ icon, title, sub, badge, onDel, delLabel }: {
  icon: React.ReactNode; title: string; sub: string; badge?: string; onDel: () => void; delLabel: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-raised/40 px-3.5 py-2.5 transition-colors hover:border-line/80">
      <span className="text-dim">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-ink">{title}</span>
          {badge && <span className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-dim">{badge}</span>}
        </div>
        <div className="truncate font-mono text-[10.5px] text-dim">{sub}</div>
      </div>
      <DeleteBtn onDel={onDel} label={delLabel} />
    </div>
  );
}

function DatabaseTab() {
  const devices = usePluto((s) => s.devices);
  const agents = usePluto((s) => s.agents);
  const glances = usePluto((s) => s.glances);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`Устройства · ${devices.length}`} icon={<Server className="h-4 w-4" />} delay={0}>
        {devices.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-dim">Устройств в базе нет</p>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => (
              <RowItem
                key={d.id}
                icon={<Server className="h-4 w-4" />}
                title={d.name}
                sub={d.address}
                badge={DEVICE_TYPE_META[d.type]?.label ?? d.type}
                onDel={() => store.removeDevice(d.id)}
                delLabel={`Удалить устройство ${d.name}`}
              />
            ))}
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <Panel title={`Агенты · ${agents.length}`} icon={<Monitor className="h-4 w-4" />} delay={60}>
          {agents.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-dim">Агентов в базе нет</p>
          ) : (
            <div className="space-y-2">
              {agents.map((a) => (
                <RowItem
                  key={a.id}
                  icon={<Monitor className="h-4 w-4" />}
                  title={a.name}
                  sub={a.ip || '—'}
                  badge={a.online ? 'в сети' : 'офлайн'}
                  onDel={() => store.removeAgent(a.id)}
                  delLabel={`Удалить агента ${a.name}`}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title={`Серверы Glances · ${glances.length}`} icon={<BarChart3 className="h-4 w-4" />} delay={120}>
          {glances.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-dim">Серверов Glances в базе нет</p>
          ) : (
            <div className="space-y-2">
              {glances.map((g) => (
                <RowItem
                  key={g.id}
                  icon={<BarChart3 className="h-4 w-4" />}
                  title={g.name}
                  sub={g.url}
                  badge={g.online ? 'в сети' : 'офлайн'}
                  onDel={() => store.removeGlances(g.id)}
                  delLabel={`Удалить сервер Glances ${g.name}`}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
