// ─── PLUTO: настройки системы ───────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Send, Tag as TagIcon, Bell, Users, Radio, Plus, Trash2, Monitor, Server, Check, Pencil, ShieldCheck, KeyRound, X, Eye, EyeOff, FileBarChart, Rocket, Cpu, Globe, Activity, Download, Terminal, ClipboardList, HardDrive, Thermometer, Video, Slack, MessageSquare } from 'lucide-react';
import { Panel, Field, Toggle, EmptyState } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts } from '../lib/store';
import { sendTestNotification, requestPushPermission } from '../lib/engine';
import { cls, TAG_COLORS, uid, timeAgo } from '../lib/util';
import DeployPage from './Deploy';
import {
  DEVICE_TYPES, DEVICE_TYPE_META, type DeviceType, type Settings as TSettings,
  type User, type Role, type Route,
} from '../lib/types';

type Tab = 'polling' | 'tags' | 'notify' | 'alerts' | 'users' | 'mirror' | 'sla' | 'deploy' | 'system';

interface PingResult {
  success: boolean;
  latencyMs: number | null;
  timestamp: number | null;
  error?: string;
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
  const [visible, setVisible] = useState(true);

  const add = async () => {
    const err = await store.addTag(label, color, visible);
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
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Видимость</span>
          <Toggle checked={visible} onChange={setVisible} />
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
              <button onClick={() => void store.toggleTagVisibility(t.id)} className="opacity-50 transition-opacity hover:opacity-100" title={t.visible ? 'Скрыть на странице Устройства' : 'Показать на странице Устройства'}>
                {t.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
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
      {/* ─── Интеграции (Slack, Teams, Discord) ───────────────────────────── */}
      <Panel title="Интеграции с мессенджерами" icon={<MessageSquare className="h-4 w-4" />}>
        <div className="space-y-4">
          {/* Slack */}
          <div className="rounded-lg border border-line/60 bg-raised/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Slack className="h-4 w-4 text-[#4A154B]" />
                <span className="font-semibold text-ink">Slack</span>
              </div>
              <Toggle checked={n.integrations?.slack?.enabled ?? false} onChange={(v) => setN({ integrations: { ...n.integrations, slack: { ...n.integrations?.slack, enabled: v } } })} />
            </div>
            <Field label="Webhook URL">
              <input className="inp font-mono" value={n.integrations?.slack?.webhookUrl ?? ''} onChange={(e) => setN({ integrations: { ...n.integrations, slack: { ...n.integrations?.slack, webhookUrl: e.target.value } } })} placeholder="https://hooks.slack.com/services/..." />
            </Field>
          </div>

          {/* Microsoft Teams */}
          <div className="rounded-lg border border-line/60 bg-raised/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Slack className="h-4 w-4 text-[#4C1D95]" />
                <span className="font-semibold text-ink">Microsoft Teams</span>
              </div>
              <Toggle checked={n.integrations?.teams?.enabled ?? false} onChange={(v) => setN({ integrations: { ...n.integrations, teams: { ...n.integrations?.teams, enabled: v } } })} />
            </div>
            <Field label="Webhook URL">
              <input className="inp font-mono" value={n.integrations?.teams?.webhookUrl ?? ''} onChange={(e) => setN({ integrations: { ...n.integrations, teams: { ...n.integrations?.teams, webhookUrl: e.target.value } } })} placeholder="https://outlook.office.com/webhook/..." />
            </Field>
          </div>

          {/* Discord */}
          <div className="rounded-lg border border-line/60 bg-raised/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-[#5865F2]" />
                <span className="font-semibold text-ink">Discord</span>
              </div>
              <Toggle checked={n.integrations?.discord?.enabled ?? false} onChange={(v) => setN({ integrations: { ...n.integrations, discord: { ...n.integrations?.discord, enabled: v } } })} />
            </div>
            <Field label="Webhook URL">
              <input className="inp font-mono" value={n.integrations?.discord?.webhookUrl ?? ''} onChange={(e) => setN({ integrations: { ...n.integrations, discord: { ...n.integrations?.discord, webhookUrl: e.target.value } } })} placeholder="https://discord.com/api/webhooks/..." />
            </Field>
          </div>
        </div>
      </Panel>

      {/* ─── Telegram ─────────────────────────────────────────────────────── */}
      <Panel title="Telegram" icon={<Bell className="h-4 w-4" />}>
        <div className="mb-3 flex items-center justify-between"><span className="text-[13px] text-mut">Отправлять в Telegram</span><Toggle checked={n.telegram.enabled} onChange={(v) => setN({ telegram: { ...n.telegram, enabled: v } })} /></div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Токен бота"><input className="inp font-mono" value={n.telegram.botToken} onChange={(e) => setN({ telegram: { ...n.telegram, botToken: e.target.value } })} /></Field>
          <Field label="Chat ID"><input className="inp font-mono" value={n.telegram.chatId} onChange={(e) => setN({ telegram: { ...n.telegram, chatId: e.target.value } })} /></Field>
        </div>
      </Panel>

      {/* ─── E-mail ───────────────────────────────────────────────────────── */}
      <Panel title="E-mail (SMTP)" icon={<Bell className="h-4 w-4" />}>
        <div className="mb-3 flex items-center justify-between"><span className="text-[13px] text-mut">Отправлять по почте</span><Toggle checked={n.email.enabled} onChange={(v) => setN({ email: { ...n.email, enabled: v } })} /></div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="SMTP-хост"><input className="inp font-mono" value={n.email.smtp} onChange={(e) => setN({ email: { ...n.email, smtp: e.target.value } })} /></Field>
          <Field label="От"><input className="inp font-mono" value={n.email.from} onChange={(e) => setN({ email: { ...n.email, from: e.target.value } })} /></Field>
          <Field label="Кому"><input className="inp font-mono" value={n.email.to} onChange={(e) => setN({ email: { ...n.email, to: e.target.value } })} /></Field>
        </div>
      </Panel>

      {/* ─── Push браузера ───────────────────────────────────────────────── */}
      <Panel title="Всплывающие окна браузера" icon={<Bell className="h-4 w-4" />}>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-mut">Push-уведомления (работают, даже если вкладка не активна)</span>
          <div className="flex items-center gap-2">
            <button onClick={() => requestPushPermission()} className="btn-ghost text-[12px]">Разрешить</button>
            <Toggle checked={n.push.enabled} onChange={(v) => setN({ push: { enabled: v } })} />
          </div>
        </div>
      </Panel>

      {/* ─── События ──────────────────────────────────────────────────────── */}
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

/** Пункты меню, которые можно разрешить наблюдателю (settings — только admin). */
const MENU_GRANTS: { route: Route; label: string }[] = [
  { route: 'dashboard', label: 'Главная' },
  { route: 'devices', label: 'Устройства' },
  { route: 'agents', label: 'Агенты' },
  { route: 'agent-pings', label: 'Пинги агентов' },
  { route: 'network-map', label: 'Карта сети' },
  { route: 'stats-bars', label: 'Статистика Bars' },
  { route: 'stats-ws', label: 'Статистика WS' },
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
            <p className="mt-1.5 text-[11px] text-dim">«Главная» добавляется всегда. «Настройки» доступны только администраторам.</p>
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

interface SlaReportConfig {
  enabled: boolean;
  schedule: 'daily' | 'weekly' | 'monthly';
  hour: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  outputPath: string;
}

function SlaReportTab() {
  const settings = usePluto((s) => s.settings);
  const devices = usePluto((s) => s.devices);
  const [draft, setDraft] = useState<SlaReportConfig>(settings.slaReport || { enabled: false, schedule: 'daily', hour: 8, outputPath: './data/Отчет SLA' });
  useEffect(() => setDraft(settings.slaReport || { enabled: false, schedule: 'daily', hour: 8, outputPath: './data/Отчет SLA' }), [settings.slaReport]);
  const [generating, setGenerating] = useState(false);

  const setCfg = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });

  const generateReportNow = async () => {
    setGenerating(true);
    try {
      // Собираем данные по всем устройствам за последние 30 дней
      const reportData = devices.map((d) => {
        const h = d.history.slice(-1500);
        const checks = h.length;
        const downCount = h.filter((v) => v < 0).length;
        const uptimePct = checks ? Math.round(((checks - downCount) / checks) * 1000) / 10 : 100;
        const ups = h.filter((v) => v >= 0);
        const avgLatency = ups.length ? Math.round(ups.reduce((a, b) => a + b, 0) / ups.length) : null;
        return {
          id: d.id,
          name: d.name,
          type: d.type,
          address: d.address,
          uptimePct,
          downCount,
          checks,
          avgLatency,
        };
      });

      const overall = reportData.length
        ? Math.round((reportData.reduce((a, r) => a + r.uptimePct, 0) / reportData.length) * 100) / 100
        : 100;

      const report = {
        generatedAt: new Date().toISOString(),
        period: '30 дней',
        overallUptime: overall,
        deviceCount: reportData.length,
        devices: reportData,
      };

      // В реальном серверном режиме здесь был бы вызов API для сохранения на сервер
      // Для демонстрации скачиваем файл
      const head = 'id;name;type;address;uptime_pct;down_count;checks;avg_latency_ms';
      const body = reportData.map((r) => [r.id, r.name, r.type, r.address, r.uptimePct, r.downCount, r.checks, r.avgLatency ?? ''].join(';'));
      const csvContent = '\uFEFF' + [head, ...body].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pluto-sla-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      
      useToasts.push('ok', 'SLA-отчет сгенерирован и загружен');
    } catch (err) {
      useToasts.push('crit', 'Ошибка генерации отчета');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Panel title="Авто-отчет SLA" icon={<FileBarChart className="h-4 w-4" />}>
      <p className="mb-4 text-[12px] leading-relaxed text-dim">
        Автоматическая генерация SLA-отчета по расписанию с выгрузкой в папку на локальном сервере.
        Отчет формируется за последние 30 дней по всем устройствам.
      </p>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13px] text-mut">Включить авто-отчет</span>
        <Toggle checked={draft.enabled} onChange={(v) => setCfg({ enabled: v })} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Расписание">
          <select className="inp" value={draft.schedule} onChange={(e) => setCfg({ schedule: e.target.value as 'daily' | 'weekly' | 'monthly' })} disabled={!draft.enabled}>
            <option value="daily">Ежедневно</option>
            <option value="weekly">Еженедельно</option>
            <option value="monthly">Ежемесячно</option>
          </select>
        </Field>

        <Field label="Час генерации" hint="0-23">
          <input className="inp font-mono" type="number" min={0} max={23} value={draft.hour} onChange={(e) => setCfg({ hour: parseInt(e.target.value, 10) || 0 })} disabled={!draft.enabled} />
        </Field>

        {draft.schedule === 'weekly' && (
          <Field label="День недели" hint="0=воскресенье, 6=суббота">
            <input className="inp font-mono" type="number" min={0} max={6} value={draft.dayOfWeek ?? 0} onChange={(e) => setCfg({ dayOfWeek: parseInt(e.target.value, 10) || 0 })} disabled={!draft.enabled} />
          </Field>
        )}

        {draft.schedule === 'monthly' && (
          <Field label="День месяца" hint="1-31">
            <input className="inp font-mono" type="number" min={1} max={31} value={draft.dayOfMonth ?? 1} onChange={(e) => setCfg({ dayOfMonth: parseInt(e.target.value, 10) || 1 })} disabled={!draft.enabled} />
          </Field>
        )}

        <Field label="Путь к папке" hint="Папка для отчетов на локальном сервере" className="md:col-span-2">
          <input className="inp font-mono" value={draft.outputPath} onChange={(e) => setCfg({ outputPath: e.target.value })} placeholder="./data/Отчет SLA" disabled={!draft.enabled} />
        </Field>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-raised/30 px-4 py-3">
        <p className="text-[11.5px] text-mut">
          <strong>Текущие настройки:</strong>{' '}
          {draft.enabled 
            ? `Генерация ${draft.schedule === 'daily' ? 'ежедневно' : draft.schedule === 'weekly' ? `каждую неделю (день ${draft.dayOfWeek ?? 0})` : `каждый месяц (число ${draft.dayOfMonth ?? 1})`} в ${draft.hour}:00 → ${draft.outputPath}`
            : 'Отключено'}
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={() => void store.saveSettings({ ...settings, slaReport: draft })} className="btn-acc">
          <Check className="h-4 w-4" />Сохранить настройки
        </button>
        <button onClick={generateReportNow} disabled={generating} className="btn-ghost">
          <FileBarChart className="h-4 w-4" />{generating ? 'Генерация...' : 'Сгенерировать отчет сейчас'}
        </button>
      </div>
    </Panel>
  );
}

/** Компонент вкладки "Система" — отображение статуса ядра и пинг до ya.ru */
function SystemTab() {
  const apiMode = usePluto((s) => s.apiMode);
  const coreVersion = usePluto((s) => s.coreVersion);
  const coreDiag = usePluto((s) => s.coreDiag);
  const [pingResult, setPingResult] = useState<PingResult>({ success: false, latencyMs: null, timestamp: null });
  const [isPinging, setIsPinging] = useState(false);

  const doPing = async () => {
    setIsPinging(true);
    setPingResult({ success: false, latencyMs: null, timestamp: null });
    try {
      const start = performance.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      try {
        await fetch('https://ya.ru/favicon.ico', {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-cache',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const end = performance.now();
        const latency = Math.round(end - start);
        setPingResult({ success: true, latencyMs: latency, timestamp: Date.now() });
      } catch (fetchError) {
        clearTimeout(timeout);
        throw fetchError;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      setPingResult({ 
        success: false, 
        latencyMs: null, 
        timestamp: Date.now(), 
        error: errorMsg 
      });
    } finally {
      setIsPinging(false);
    }
  };

  useEffect(() => {
    void doPing();
  }, []);

  const isServer = apiMode === 'server';

  return (
    <div className="space-y-4">
      <Panel title="Статус ядра системы" icon={<Cpu className="h-4 w-4" />}>
        <div className="flex items-start gap-4">
          <div className={cls(
            'flex h-16 w-16 shrink-0 items-center justify-center rounded-xl',
            isServer ? 'bg-ok/15 ring-2 ring-ok/30' : 'bg-warn/15 ring-2 ring-warn/30'
          )}>
            {isServer ? <Cpu className="h-8 w-8 text-ok" /> : <Monitor className="h-8 w-8 text-warn" />}
          </div>
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-2">
              <span className={cls(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
                isServer ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'
              )}>
                {isServer ? 'Реальное ядро' : 'Эмуляция'}
              </span>
              {isServer && coreVersion && <span className="font-mono text-[11px] text-dim">v{coreVersion}</span>}
            </div>
            <p className="text-[13px] leading-relaxed text-mut">
              {isServer 
                ? 'Система работает в режиме серверного ядра PLUTO Core. Все проверки устройств выполняются реально.' 
                : 'Система работает в режиме браузерной эмуляции. Для полноценной работы подключите PLUTO Core.'}
            </p>
            {coreDiag && !isServer && (
              <p className="mt-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[11.5px] text-warn">
                <Activity className="mr-1.5 inline h-3.5 w-3.5" />
                {coreDiag}
              </p>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Проверка интернет-соединения" icon={<Globe className="h-4 w-4" />}>
        <p className="mb-4 text-[12px] leading-relaxed text-dim">
          Реальный пинг до <code className="font-mono text-mut">ya.ru</code> для проверки доступности интернета.
          Данные не эмулируются — выполняется настоящий HTTP-запрос.
        </p>
        
        <div className="rounded-xl border border-line bg-raised/30 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className={cls('h-5 w-5', pingResult.success ? 'text-ok' : pingResult.error ? 'text-crit' : 'text-dim')} />
              <div>
                <p className="text-[13px] font-semibold text-ink">ya.ru</p>
                <p className="text-[11px] text-dim">
                  {isPinging 
                    ? 'Выполняется пинг…' 
                    : pingResult.success 
                      ? `Ответ получен за ${pingResult.latencyMs} мс` 
                      : pingResult.error 
                        ? `Ошибка: ${pingResult.error}`
                        : 'Нет данных'}
                </p>
              </div>
            </div>
            <button 
              onClick={doPing} 
              disabled={isPinging}
              className={cls(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-all',
                isPinging ? 'bg-raised text-dim cursor-not-allowed' : 'btn-acc'
              )}
            >
              <Activity className="h-3.5 w-3.5" />
              {isPinging ? 'Пинг…' : 'Проверить'}
            </button>
          </div>
          
          {pingResult.timestamp && (
            <div className="mt-3 flex items-center gap-4 text-[11px] text-dim">
              <span>Последняя проверка: {new Date(pingResult.timestamp).toLocaleTimeString()}</span>
              {pingResult.success && pingResult.latencyMs !== null && (
                <>
                  <span className="font-mono text-ok">{pingResult.latencyMs} мс</span>
                  <span className={cls(
                    'rounded px-1.5 py-0.5',
                    pingResult.latencyMs < 50 ? 'bg-ok/15 text-ok' : 
                    pingResult.latencyMs < 150 ? 'bg-warn/15 text-warn' : 'bg-crit/15 text-crit'
                  )}>
                    {pingResult.latencyMs < 50 ? 'Отлично' : pingResult.latencyMs < 150 ? 'Нормально' : 'Высокая задержка'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Информация о системе" icon={<Monitor className="h-4 w-4" />}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-raised/30 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Режим работы</p>
            <p className={cls('mt-1 text-[14px] font-bold', isServer ? 'text-ok' : 'text-warn')}>
              {isServer ? 'Серверный (ядро активно)' : 'Браузерный (эмуляция)'}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-raised/30 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Интернет-соединение</p>
            <p className={cls('mt-1 text-[14px] font-bold', pingResult.success ? 'text-ok' : 'text-crit')}>
              {pingResult.success ? 'Активно' : pingResult.error ? 'Недоступно' : 'Не проверено'}
            </p>
          </div>
          {isServer && coreVersion && (
            <div className="rounded-lg border border-line bg-raised/30 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Версия ядра</p>
              <p className="mt-1 font-mono text-[14px] font-bold text-ink">{coreVersion}</p>
            </div>
          )}
          <div className="rounded-lg border border-line bg-raised/30 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Время системы</p>
            <ClockDisplay />
          </div>
        </div>
      </Panel>

      <Panel title="Мониторинг Windows и Linux" icon={<HardDrive className="h-4 w-4" />}>
        <div className="space-y-4">
          <div className="rounded-xl border border-vio/30 bg-vio/5 p-4">
            <h4 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-vio">
              <ClipboardList className="h-4 w-4" />Собираемые метрики
            </h4>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-start gap-2 rounded-lg border border-line bg-panel/50 p-3">
                <Cpu className="mt-0.5 h-4 w-4 text-ok" />
                <div>
                  <p className="text-[12px] font-semibold text-ink">Процессор (CPU)</p>
                  <p className="text-[11px] text-dim">Загрузка total, user, system, iowait, softirq, guest</p>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-line bg-panel/50 p-3">
                <Server className="mt-0.5 h-4 w-4 text-blue" />
                <div>
                  <p className="text-[12px] font-semibold text-ink">Оперативная память (RAM)</p>
                  <p className="text-[11px] text-dim">Процент, used, total, cached, buffers</p>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-line bg-panel/50 p-3">
                <HardDrive className="mt-0.5 h-4 w-4 text-purple" />
                <div>
                  <p className="text-[12px] font-semibold text-ink">Диски</p>
                  <p className="text-[11px] text-dim">Количество, общий объем, использовано, I/O операции</p>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-line bg-panel/50 p-3">
                <Thermometer className="mt-0.5 h-4 w-4 text-warn" />
                <div>
                  <p className="text-[12px] font-semibold text-ink">Температуры</p>
                  <p className="text-[11px] text-dim">CPU, SSD/HDD, GPU</p>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-line bg-panel/50 p-3">
                <Video className="mt-0.5 h-4 w-4 text-pink" />
                <div>
                  <p className="text-[12px] font-semibold text-ink">Видеокарта (GPU)</p>
                  <p className="text-[11px] text-dim">Загрузка %, память used/total (если установлена)</p>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-line bg-panel/50 p-3">
                <Activity className="mt-0.5 h-4 w-4 text-cyan" />
                <div>
                  <p className="text-[12px] font-semibold text-ink">Сеть</p>
                  <p className="text-[11px] text-dim">Входящий/исходящий трафик</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-panel/50 p-4">
              <h4 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-ink">
                <Download className="h-4 w-4" />Netdata (рекомендуется для Linux)
              </h4>
              <p className="mb-3 text-[12px] leading-relaxed text-dim">
                Универсальная система мониторинга с веб-интерфейсом. Поддерживает Windows (через WSL) и Linux.
              </p>
              <div className="space-y-2">
                <div className="rounded-lg bg-void/50 p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Linux — быстрая установка:</p>
                  <code className="block overflow-x-auto text-[11.5px] text-mut">wget -O /tmp/netdata-kickstart.sh https://get.netdata.cloud/kickstart.sh &amp;&amp; sh /tmp/netdata-kickstart.sh</code>
                </div>
                <div className="rounded-lg bg-void/50 p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Windows — через Chocolatey:</p>
                  <code className="block overflow-x-auto text-[11.5px] text-mut">choco install netdata</code>
                </div>
                <div className="rounded-lg bg-void/50 p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Windows — через winget:</p>
                  <code className="block overflow-x-auto text-[11.5px] text-mut">winget install Netdata.Netdata</code>
                </div>
              </div>
              <p className="mt-3 text-[11.5px] text-dim">
                После установки укажите в настройках агента URL: <code className="font-mono text-mut">http://&lt;IP-сервера&gt;:19999</code>
              </p>
            </div>

            <div className="rounded-xl border border-line bg-panel/50 p-4">
              <h4 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-ink">
                <Terminal className="h-4 w-4" />Pluto Agent (Windows/Linux)
              </h4>
              <p className="mb-3 text-[12px] leading-relaxed text-dim">
                Легковесный агент для сбора системных метрик. Отдает данные в формате JSON на endpoint <code className="font-mono text-mut">/api/metrics</code>.
              </p>
              <div className="space-y-2">
                <div className="rounded-lg bg-void/50 p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Windows — PowerShell скрипт:</p>
                  <code className="block overflow-x-auto text-[11.5px] text-mut">powershell -ExecutionPolicy Bypass -File .\install-pluto-agent.ps1</code>
                </div>
                <div className="rounded-lg bg-void/50 p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Linux — bash скрипт:</p>
                  <code className="block overflow-x-auto text-[11.5px] text-mut">sudo ./install-pluto-agent.sh</code>
                </div>
                <div className="rounded-lg bg-void/50 p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Node.js (кроссплатформенно):</p>
                  <code className="block overflow-x-auto text-[11.5px] text-mut">npm install -g @pluto/agent &amp;&amp; pluto-agent install</code>
                </div>
              </div>
              <p className="mt-3 text-[11.5px] text-dim">
                Агент устанавливается как служба Windows или systemd-юнит в Linux.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-panel/50 p-4">
            <h4 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-ink">
              <ClipboardList className="h-4 w-4" />Формат данных Pluto Agent
            </h4>
            <p className="mb-2 text-[12px] text-dim">Агент должен отдавать метрики в следующем формате JSON:</p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-void/70 p-3 text-[11px] leading-relaxed text-mut">
{`{
  "cpu": { "usage": 45.2, "user": 30.1, "system": 10.5, "iowait": 4.6 },
  "memory": { "used": 8589934592, "total": 17179869184, "usage_percent": 50.0 },
  "swap": { "used": 1073741824, "total": 4294967296, "usage_percent": 25.0 },
  "disks": [{ "name": "C:", "total": 500107862016, "used": 250053931008, "free": 250053931008 }],
  "disk": { "read_per_sec": 1024000, "write_per_sec": 512000 },
  "network": { "bytes_recv_per_sec": 102400, "bytes_sent_per_sec": 51200 },
  "temperatures": { "cpu": 65.5, "ssd": 45.0, "gpu": 70.0 },
  "gpu": { "name": "NVIDIA GeForce RTX 3080", "usage_percent": 75.0, "memory_used": 8589934592, "memory_total": 10737418240 }
}`}
            </pre>
          </div>

          <div className="rounded-xl border border-warn/30 bg-warn/5 p-4">
            <h4 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-warn">
              <Activity className="h-4 w-4" />Диагностика
            </h4>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Netdata — проверка API:</p>
                <code className="block overflow-x-auto rounded bg-void/50 p-2 text-[11px] text-mut">curl "http://&lt;IP&gt;:19999/api/v2/data?context=system.cpu&amp;format=json"</code>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Pluto Agent — проверка endpoint:</p>
                <code className="block overflow-x-auto rounded bg-void/50 p-2 text-[11px] text-mut">curl http://&lt;IP&gt;:&lt;PORT&gt;/api/metrics</code>
              </div>
            </div>
            <p className="mt-3 text-[11.5px] text-dim">
              Полная документация: <code className="font-mono text-mut">MONITORING-WINDOWS-LINUX.md</code>
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ClockDisplay() {
  const [time, setTime] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <p className="mt-1 font-mono text-[14px] font-bold text-ink">{new Date(time).toLocaleString('ru-RU')}</p>;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('polling');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof document !== 'undefined') {
      return (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark';
    }
    return 'dark';
  });
  
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'polling', label: 'Опросы и пороги', icon: <Send className="h-3.5 w-3.5" /> },
    { id: 'tags', label: 'Теги', icon: <TagIcon className="h-3.5 w-3.5" /> },
    { id: 'notify', label: 'Уведомления', icon: <Bell className="h-3.5 w-3.5" /> },
    { id: 'alerts', label: 'HDD Error', icon: <Bell className="h-3.5 w-3.5" /> },
    { id: 'users', label: 'Пользователи', icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'mirror', label: 'Зеркало', icon: <Radio className="h-3.5 w-3.5" /> },
    { id: 'sla', label: 'SLA-отчёт', icon: <FileBarChart className="h-3.5 w-3.5" /> },
    { id: 'deploy', label: 'Развёртывание', icon: <Rocket className="h-3.5 w-3.5" /> },
    { id: 'system', label: 'Система', icon: <Cpu className="h-3.5 w-3.5" /> },
  ];

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('pluto-theme', newTheme);
  };

  return (
    <div className="space-y-4">
      <div className="rise mb-3 flex items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cls('inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold transition-all',
                tab === t.id ? 'border-vio/60 bg-vio/20 text-ink' : 'border-line bg-panel/90 text-dim hover:text-mut')}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        <button onClick={toggleTheme} className="btn-ghost text-[12px]" title="Переключить тему">
          {theme === 'dark' ? '☀️ Светлая' : '🌙 Тёмная'}
        </button>
      </div>

      {tab === 'polling' && <PollingTab />}
      {tab === 'tags' && <TagsTab />}
      {tab === 'notify' && <NotifyTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'mirror' && <MirrorTab />}
      {tab === 'sla' && <SlaReportTab />}
      {tab === 'deploy' && <DeployPage />}
      {tab === 'system' && <SystemTab />}
    </div>
  );
}
