// ─── PLUTO: настройки системы ───────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Send, Tag as TagIcon, Bell, Users, Radio, Plus, Trash2, Monitor, Server, Check, Pencil, ShieldCheck, KeyRound, X } from 'lucide-react';
import { Panel, Field, Toggle, EmptyState } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts } from '../lib/store';
import { sendTestNotification, requestPushPermission } from '../lib/engine';
import { cls, TAG_COLORS, uid, timeAgo } from '../lib/util';
import {
  DEVICE_TYPES, DEVICE_TYPE_META, type DeviceType, type Settings as TSettings,
  type User, type Role, type Route,
} from '../lib/types';

type Tab = 'polling' | 'tags' | 'notify' | 'users' | 'mirror';

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
  const setInt = (k: DeviceType | 'agent' | 'glances', v: number) => setDraft((d) => ({ ...d, intervals: { ...d.intervals, [k]: v } }));

  return (
    <Panel title="Интервалы опроса и пороги" icon={<Send className="h-4 w-4" />}>
      <div className="grid gap-4 md:grid-cols-2">
        {DEVICE_TYPES.map((t) => (
          <NumField key={t} label={`${DEVICE_TYPE_META[t].label} — интервал`} value={draft.intervals[t]} onChange={(v) => setInt(t, v)} min={5} suffix="сек" />
        ))}
        <NumField label="Агенты — интервал опроса" value={draft.intervals.agent} onChange={(v) => setInt('agent', v)} min={10} suffix="сек" hint="Пинг до ПК и relay-пинги устройств" />
        <NumField label="Glances — интервал" value={draft.intervals.glances} onChange={(v) => setInt('glances', v)} min={10} suffix="сек" hint="Опрос телеметрии Glances" />
        <NumField label="Таймаут проверки" value={draft.timeoutMs} onChange={(v) => setDraft({ ...draft, timeoutMs: v })} min={500} suffix="мс" />
        <NumField label="Сбоев подряд до «Аварии»" value={draft.failThreshold} onChange={(v) => setDraft({ ...draft, failThreshold: v })} min={1} />
        <NumField label="Фактор деградации" value={draft.degradeFactor} onChange={(v) => setDraft({ ...draft, degradeFactor: v })} min={2} hint="Во сколько раз пинг выше базового = деградация" />
        <NumField label="Мин. задержка деградации" value={draft.degradeMinMs} onChange={(v) => setDraft({ ...draft, degradeMinMs: v })} min={50} suffix="мс" />
      </div>
      <button onClick={() => void store.saveSettings(draft)} className="btn-acc mt-5"><Check className="h-4 w-4" />Сохранить</button>
    </Panel>
  );
}

function TagsTab() {
  const tags = usePluto((s) => s.tags);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);

  const add = async () => {
    const err = await store.addTag(label, color);
    if (err) useToasts.push('warn', err);
    else setLabel('');
  };

  return (
    <Panel title={`Теги · ${tags.length}`} icon={<TagIcon className="h-4 w-4" />}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Название"><input className="inp w-56" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Например: Склад" /></Field>
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Цвет</span>
          <div className="flex gap-1.5">
            {TAG_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={cls('h-7 w-7 rounded-full border-2 transition-transform hover:scale-110', color === c ? 'border-ink' : 'border-transparent')}
                style={{ background: c }} title={c} />
            ))}
          </div>
        </div>
        <button onClick={() => void add()} className="btn-acc"><Plus className="h-4 w-4" />Создать тег</button>
      </div>

      {tags.length === 0 ? (
        <EmptyState icon={<TagIcon className="h-6 w-6" />} title="Тегов пока нет" text="Создайте тег и присваивайте его устройствам и агентам — потом по тегам работает быстрый поиск." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <span key={t.id} className="group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: t.color, color: t.color }}>
              {t.label}
              <button onClick={() => void store.removeTag(t.id)} className="opacity-50 transition-opacity hover:opacity-100" title="Удалить тег"><Trash2 className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}

function NotifyTab() {
  const settings = usePluto((s) => s.settings);
  const [draft, setDraft] = useState<TSettings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const n = draft.notifications;
  const setN = (patch: Partial<TSettings['notifications']>) => setDraft({ ...draft, notifications: { ...n, ...patch } });

  return (
    <div className="space-y-4">
      <Panel title="Telegram" icon={<Bell className="h-4 w-4" />}>
        <div className="mb-3 flex items-center justify-between"><span className="text-[13px] text-mut">Отправлять в Telegram</span><Toggle checked={n.telegram.enabled} onChange={(v) => setN({ telegram: { ...n.telegram, enabled: v } })} /></div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Токен бота"><input className="inp font-mono" value={n.telegram.botToken} onChange={(e) => setN({ telegram: { ...n.telegram, botToken: e.target.value } })} /></Field>
          <Field label="Chat ID"><input className="inp font-mono" value={n.telegram.chatId} onChange={(e) => setN({ telegram: { ...n.telegram, chatId: e.target.value } })} /></Field>
        </div>
      </Panel>

      <Panel title="E-mail (SMTP)" icon={<Bell className="h-4 w-4" />}>
        <div className="mb-3 flex items-center justify-between"><span className="text-[13px] text-mut">Отправлять по почте</span><Toggle checked={n.email.enabled} onChange={(v) => setN({ email: { ...n.email, enabled: v } })} /></div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="SMTP-хост"><input className="inp font-mono" value={n.email.smtp} onChange={(e) => setN({ email: { ...n.email, smtp: e.target.value } })} /></Field>
          <Field label="От"><input className="inp font-mono" value={n.email.from} onChange={(e) => setN({ email: { ...n.email, from: e.target.value } })} /></Field>
          <Field label="Кому"><input className="inp font-mono" value={n.email.to} onChange={(e) => setN({ email: { ...n.email, to: e.target.value } })} /></Field>
        </div>
      </Panel>

      <Panel title="Всплывающие окна браузера" icon={<Bell className="h-4 w-4" />}>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-mut">Push-уведомления (работают, даже если вкладка не активна)</span>
          <div className="flex items-center gap-2">
            <button onClick={() => requestPushPermission()} className="btn-ghost text-[12px]">Разрешить</button>
            <Toggle checked={n.push.enabled} onChange={(v) => setN({ push: { enabled: v } })} />
          </div>
        </div>
      </Panel>

      <Panel title="Какие события отправлять" icon={<Bell className="h-4 w-4" />}>
        <div className="grid gap-3 md:grid-cols-2">
          {([
            ['down', 'Авария устройства'], ['degraded', 'Деградация связи'], ['recover', 'Восстановление'],
            ['agentOff', 'Агент офлайн'], ['agentOn', 'Агент снова в сети'],
          ] as const).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between rounded-lg border border-line/60 bg-raised/30 px-3 py-2.5">
              <span className="text-[13px] text-mut">{label}</span>
              <Toggle checked={n.on[k]} onChange={(v) => setN({ on: { ...n.on, [k]: v } })} />
            </div>
          ))}
        </div>
      </Panel>

      <div className="flex gap-2">
        <button onClick={() => void store.saveSettings(draft)} className="btn-acc"><Check className="h-4 w-4" />Сохранить</button>
        <button onClick={() => sendTestNotification()} className="btn-ghost">Отправить тест</button>
      </div>
    </div>
  );
}

/** Пункты меню, которые можно разрешить наблюдателю (settings/showcase — только admin). */
const MENU_GRANTS: { route: Route; label: string }[] = [
  { route: 'dashboard', label: 'Главная' },
  { route: 'devices', label: 'Устройства' },
  { route: 'agents', label: 'Агенты' },
  { route: 'agent-pings', label: 'Пинги агентов' },
  { route: 'topology', label: 'Топология' },
  { route: 'stats-bars', label: 'Статистика Bars' },
  { route: 'stats-ws', label: 'Статистика WS' },
  { route: 'sla', label: 'SLA-отчёт' },
  { route: 'deploy', label: 'Развёртывание' },
];

function CheckPill({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cls('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition-all',
        on ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-raised/40 text-dim hover:text-mut')}>
      <span className={cls('flex h-3.5 w-3.5 items-center justify-center rounded-full border', on ? 'border-vio bg-vio text-void' : 'border-dim')}>
        {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}

function UserEditor({ initial, onClose }: { initial: User | null; onClose: () => void }) {
  const isNew = !initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [login, setLogin] = useState(initial?.login ?? '');
  const [pass, setPass] = useState('');
  const [role, setRole] = useState<Role>(initial?.role ?? 'viewer');
  const [menuScope, setMenuScope] = useState<Route[]>(initial?.menuScope ?? ['dashboard']);
  const [deviceScope, setDeviceScope] = useState<DeviceType[]>(initial?.deviceScope ?? []);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleMenu = (r: Route) =>
    setMenuScope((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  const toggleDevice = (t: DeviceType) =>
    setDeviceScope((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const save = async () => {
    setErr(null);
    if (!name.trim() || !login.trim()) return setErr('Укажите имя и логин');
    if (isNew && !pass) return setErr('Задайте пароль для нового пользователя');
    if (!menuScope.includes('dashboard')) menuScope.unshift('dashboard');
    setBusy(true);
    const u: User = {
      id: initial?.id ?? uid('usr'),
      login: login.trim(),
      name: name.trim(),
      role,
      menuScope: role === 'admin' ? [] : menuScope,
      deviceScope: role === 'admin' ? [] : deviceScope,
      builtIn: initial?.builtIn ?? false,
      twoFA: initial?.twoFA ?? { enabled: false, secret: null },
      createdAt: initial?.createdAt ?? Date.now(),
    };
    const res = await store.saveUser(u, pass.trim() || undefined);
    setBusy(false);
    if (res) return setErr(res);
    onClose();
  };

  return (
    <div className="rounded-xl border border-vio/40 bg-panel/95 p-5 shadow-[0_20px_60px_-15px_rgba(0,0,0,.7)]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-[16px] font-bold text-ink">{isNew ? 'Новый пользователь' : `Редактирование · ${initial!.name}`}</h3>
        <button onClick={onClose} className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-ink"><X className="h-4 w-4" /></button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Имя"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Петров" /></Field>
        <Field label="Логин"><input className="inp font-mono" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="ipetrov" disabled={!isNew && initial?.builtIn} /></Field>
        <Field label={isNew ? 'Пароль' : 'Новый пароль (необязательно)'} hint={isNew ? undefined : 'Оставьте пустым, чтобы не менять'}>
          <input className="inp font-mono" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field label="Роль">
          <div className="flex gap-2">
            {(['admin', 'viewer'] as Role[]).map((r) => (
              <button key={r} onClick={() => setRole(r)}
                className={cls('flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-bold transition-all',
                  role === r ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-raised/40 text-dim hover:text-mut')}>
                {r === 'admin' ? 'Администратор' : 'Наблюдатель'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {role === 'viewer' && (
        <>
          <div className="mt-5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">
              <Monitor className="h-3.5 w-3.5" /> Доступные пункты меню
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MENU_GRANTS.map((m) => (
                <CheckPill key={m.route} on={menuScope.includes(m.route)} label={m.label} onClick={() => toggleMenu(m.route)} />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-dim">«Главная» добавляется всегда. «Настройки» и «Витрина» доступны только администраторам.</p>
          </div>

          <div className="mt-5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">
              <Server className="h-3.5 w-3.5" /> Видимые типы устройств
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DEVICE_TYPES.map((t) => (
                <CheckPill key={t} on={deviceScope.includes(t)} label={DEVICE_TYPE_META[t].label} onClick={() => toggleDevice(t)} />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-dim">Если ничего не выбрано, наблюдатель не видит устройств, но видит меню.</p>
          </div>
        </>
      )}

      {role === 'admin' && (
        <p className="mt-5 rounded-lg border border-vio/25 bg-vio/5 px-4 py-3 text-[12px] leading-relaxed text-mut">
          <ShieldCheck className="mr-1.5 inline h-4 w-4 text-vio" />
          Администратор имеет полный доступ ко всем разделам, устройствам и настройкам — ограничения ниже не применяются.
        </p>
      )}

      {err && <p className="mt-4 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">Отмена</button>
        <button onClick={() => void save()} disabled={busy} className="btn-acc">
          <Check className="h-4 w-4" />{busy ? 'Сохранение…' : isNew ? 'Создать' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

function UsersTab() {
  const users = usePluto((s) => s.users);
  const me = useCurrentUser();
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);

  const remove = (u: User) => {
    if (u.id === me?.id) { useToasts.push('warn', 'Нельзя удалить самого себя'); return; }
    if (u.builtIn) { useToasts.push('warn', 'Встроенного администратора удалить нельзя'); return; }
    if (!window.confirm(`Удалить пользователя «${u.name}»?`)) return;
    void store.removeUser(u.id);
  };

  return (
    <div className="space-y-4">
      {creating && <UserEditor initial={null} onClose={() => setCreating(false)} />}
      {editing && <UserEditor initial={editing} onClose={() => setEditing(null)} />}

      <Panel title={`Пользователи · ${users.length}`} icon={<Users className="h-4 w-4" />}
        right={<button onClick={() => setCreating(true)} className="btn-acc text-[12px]"><Plus className="h-3.5 w-3.5" />Добавить</button>}>
        <p className="mb-3 text-[12px] leading-relaxed text-dim">
          Администратор видит всё. Наблюдателю разрешаются только выбранные пункты меню и типы устройств.
          Вход встроенного администратора: <code className="font-mono text-mut">admin / pluto</code>.
        </p>

        {users.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="Пользователей нет" text="Создайте первого пользователя, чтобы разграничить доступ." />
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="group flex items-center justify-between gap-3 rounded-lg border border-line/60 bg-raised/30 px-3.5 py-3 transition-colors hover:border-vio/30">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={cls('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-[13px] font-bold',
                    u.role === 'admin' ? 'bg-vio/20 text-vio ring-1 ring-vio/30' : 'bg-blu/15 text-blu ring-1 ring-blu/25')}>
                    {u.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-ink">{u.name}</span>
                      {u.twoFA?.enabled && <KeyRound className="h-3.5 w-3.5 shrink-0 text-ok" aria-label="2FA включена" />}
                      {u.builtIn && <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[9px] font-bold uppercase text-dim">системный</span>}
                    </div>
                    <div className="font-mono text-[11px] text-dim">@{u.login} · создан {timeAgo(u.createdAt)}</div>
                    {u.role === 'viewer' && (
                      <div className="mt-0.5 text-[10.5px] text-dim">
                        меню: {u.menuScope.length} · устройства: {u.deviceScope.length ? u.deviceScope.map((d) => DEVICE_TYPE_META[d].label).join(', ') : 'нет'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className={cls('hidden rounded-full border px-2.5 py-1 text-[10.5px] font-bold sm:inline',
                    u.role === 'admin' ? 'border-vio/50 text-vio' : 'border-line text-dim')}>
                    {u.role === 'admin' ? 'администратор' : 'наблюдатель'}
                  </span>
                  <button onClick={() => setEditing(u)} title="Редактировать"
                    className="rounded-md p-1.5 text-dim transition-all hover:bg-raised hover:text-vio"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(u)} title="Удалить" disabled={u.builtIn || u.id === me?.id}
                    className="rounded-md p-1.5 text-dim transition-all hover:bg-raised hover:text-crit disabled:cursor-not-allowed disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function MirrorTab() {
  const settings = usePluto((s) => s.settings);
  const [draft, setDraft] = useState(settings.mirror);
  useEffect(() => setDraft(settings.mirror), [settings.mirror]);

  return (
    <Panel title="Зеркало-ретранслятор" icon={<Radio className="h-4 w-4" />}>
      <p className="mb-4 text-[12px] leading-relaxed text-dim">
        Основной сервер (в локальной сети) периодически отправляет снапшот состояния на публичный read-only экземпляр.
        Зеркало не опрашивает устройства и не принимает изменений — только витрина статусов.
      </p>
      <div className="mb-3 flex items-center justify-between"><span className="text-[13px] text-mut">Включить зеркалирование</span><Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Адрес зеркала" hint="https://pluto.example.com"><input className="inp font-mono" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} disabled={!draft.enabled} /></Field>
        <Field label="Секрет (MIRROR_SECRET)"><input className="inp font-mono" type="password" value={draft.secret} onChange={(e) => setDraft({ ...draft, secret: e.target.value })} disabled={!draft.enabled} /></Field>
        <NumField label="Интервал синхронизации" value={draft.interval} onChange={(v) => setDraft({ ...draft, interval: v })} min={30} suffix="сек" />
      </div>
      <button onClick={() => void store.saveSettings({ ...settings, mirror: draft })} className="btn-acc mt-4"><Check className="h-4 w-4" />Сохранить</button>
    </Panel>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('polling');
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'polling', label: 'Опросы и пороги', icon: <Send className="h-3.5 w-3.5" /> },
    { id: 'tags', label: 'Теги', icon: <TagIcon className="h-3.5 w-3.5" /> },
    { id: 'notify', label: 'Уведомления', icon: <Bell className="h-3.5 w-3.5" /> },
    { id: 'users', label: 'Пользователи', icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'mirror', label: 'Зеркало', icon: <Radio className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cls('inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold transition-all',
              tab === t.id ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-panel/90 text-dim hover:text-mut')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'polling' && <PollingTab />}
      {tab === 'tags' && <TagsTab />}
      {tab === 'notify' && <NotifyTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'mirror' && <MirrorTab />}
    </div>
  );
}
