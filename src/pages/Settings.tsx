// ─── PLUTO: настройки системы ────────────────────────────────────────────────
import { useState } from 'react';
import { Bell, Clock, Mail, Pencil, Plus, Send, Tag as TagIcon, Trash2, Users, X } from 'lucide-react';
import { Field, Modal, Panel, Seg, Toggle } from '../components/ui';
import { usePluto, useToasts } from '../lib/store';
import { sendTestNotification, requestPushPermission } from '../lib/engine';
import { cls, TAG_COLORS } from '../lib/util';
import { DEVICE_TYPES, DEVICE_TYPE_META, type Settings as TSettings, type User } from '../lib/types';

type Tab = 'poll' | 'tags' | 'notify' | 'users';

// ─── Интервалы опросов ──────────────────────────────────────────────────────

function PollTab() {
  const settings = usePluto((s) => s.settings);
  const saveSettings = usePluto((s) => s.saveSettings);
  const apiMode = usePluto((s) => s.apiMode);
  const [draft, setDraft] = useState<TSettings>({ ...settings, intervals: { ...settings.intervals } });

  const num = (v: string, fb: number) => {
    const n = parseInt(v, 10);
    return isNaN(n) ? fb : Math.max(1, n);
  };

  return (
    <div className="space-y-4">
      <Panel title="Интервалы опросов по типам" icon={Clock} delay={0}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {DEVICE_TYPES.map((t) => (
            <Field key={t} label={`${DEVICE_TYPE_META[t].label}, сек`}>
              <input
                className="inp font-mono"
                value={draft.intervals[t]}
                onChange={(e) => setDraft({ ...draft, intervals: { ...draft.intervals, [t]: num(e.target.value.replace(/\D/g, ''), draft.intervals[t]) } })}
              />
            </Field>
          ))}
        </div>
      </Panel>

      <Panel title="Пороговые значения" icon={Clock} delay={60}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Таймаут, мс"><input className="inp font-mono" value={draft.timeoutMs} onChange={(e) => setDraft({ ...draft, timeoutMs: num(e.target.value.replace(/\D/g, ''), 3000) })} /></Field>
          <Field label="Сбоев до аварии"><input className="inp font-mono" value={draft.failThreshold} onChange={(e) => setDraft({ ...draft, failThreshold: num(e.target.value.replace(/\D/g, ''), 3) })} /></Field>
          <Field label="Фактор деградации" hint="во сколько раз выше базовой"><input className="inp font-mono" value={draft.degradeFactor} onChange={(e) => setDraft({ ...draft, degradeFactor: num(e.target.value.replace(/\D/g, ''), 10) })} /></Field>
          <Field label="Деградация от, мс"><input className="inp font-mono" value={draft.degradeMinMs} onChange={(e) => setDraft({ ...draft, degradeMinMs: num(e.target.value.replace(/\D/g, ''), 250) })} /></Field>
        </div>
      </Panel>

      <Panel title="Агенты" icon={Clock} delay={120}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Heartbeat, сек"><input className="inp font-mono" value={draft.heartbeat} onChange={(e) => setDraft({ ...draft, heartbeat: num(e.target.value.replace(/\D/g, ''), 10) })} /></Field>
          <Field label="Телеметрия, сек"><input className="inp font-mono" value={draft.metrics} onChange={(e) => setDraft({ ...draft, metrics: num(e.target.value.replace(/\D/g, ''), 3) })} /></Field>
          <Field label="Скан сетей, сек"><input className="inp font-mono" value={draft.lanScan} onChange={(e) => setDraft({ ...draft, lanScan: num(e.target.value.replace(/\D/g, ''), 300) })} /></Field>
          <div className="flex items-end pb-1">
            {apiMode === 'server' ? (
              <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-ok/30 bg-ok/5 px-3.5 py-2.5">
                <span>
                  <span className="block text-[12px] font-semibold text-ink">Реальные проверки</span>
                  <span className="block text-[10.5px] text-dim">серверное ядро: ping, HTTP, RTSP, SIP</span>
                </span>
                <span className="dot-live h-2 w-2 shrink-0 rounded-full bg-ok" />
              </div>
            ) : (
              <label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-raised/40 px-3.5 py-2.5">
                <span>
                  <span className="block text-[12px] font-semibold text-ink">Сетевая эмуляция</span>
                  <span className="block text-[10.5px] text-dim">браузерное ядро</span>
                </span>
                <Toggle checked={draft.simulate} onChange={(v) => setDraft({ ...draft, simulate: v })} />
              </label>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
          {apiMode === 'server'
            ? 'Консоль подключена к серверному ядру: задержки и статусы — результат настоящих проверок, телеметрия приходит от агентов.'
            : 'Встроенное ядро эмулирует ICMP/RTSP/SIP, поэтому задержки не совпадают с реальным ping. Разверните сервер — консоль подключится к ядру автоматически.'}
        </p>
      </Panel>

      <div className="flex justify-end">
        <button className="btn-acc" onClick={() => saveSettings(draft)}>Сохранить настройки</button>
      </div>
    </div>
  );
}

// ─── Теги ────────────────────────────────────────────────────────────────────

function TagsTab() {
  const tags = usePluto((s) => s.tags);
  const devices = usePluto((s) => s.devices);
  const addTag = usePluto((s) => s.addTag);
  const removeTag = usePluto((s) => s.removeTag);
  const toast = (k: 'ok' | 'warn', t: string) => useToasts.push(k, t);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);

  const submit = () => {
    const err = addTag(label, color);
    if (err) toast('warn', err);
    else { setLabel(''); toast('ok', 'Тег создан'); }
  };

  return (
    <Panel title="Теги устройств" icon={TagIcon} delay={0}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[220px]">
            <Field label="Название тега"><input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>
          </div>
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Цвет</span>
            <div className="flex gap-1.5">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cls('h-7 w-7 rounded-full transition-transform hover:scale-110', color === c && 'ring-2 ring-ink ring-offset-2 ring-offset-panel')}
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
          <button className="btn-acc" onClick={submit}><Plus className="h-4 w-4" /> Создать</button>
        </div>

        {tags.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-raised/30 p-4 text-center text-[12.5px] text-dim">
            Тегов пока нет. Создайте первый — до 10 цветов в палитре.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {tags.map((t) => {
              const count = devices.filter((d) => d.tags.includes(t.id)).length;
              return (
                <div key={t.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised/50 px-3.5 py-2.5">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
                  <span className="flex-1 text-[13px] font-semibold text-ink">{t.label}</span>
                  <span className="font-mono text-[11px] text-dim">{count} устр.</span>
                  <button onClick={() => removeTag(t.id)} className="rounded-md p-1 text-dim transition-colors hover:text-crit">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ─── Уведомления ────────────────────────────────────────────────────────────

function NotifyTab() {
  const settings = usePluto((s) => s.settings);
  const setRaw = usePluto((s) => s.setSettingsRaw);
  const toast = (k: 'ok' | 'warn', t: string) => useToasts.push(k, t);
  const n = settings.notifications;

  const upd = (patch: Partial<TSettings['notifications']>) => {
    setRaw({ ...settings, notifications: { ...n, ...patch } });
  };

  const test = async (kind: 'push' | 'telegram' | 'email') => {
    if (kind === 'push') {
      const granted = await requestPushPermission();
      if (!granted) { toast('warn', 'Разрешение на уведомления не выдано'); return; }
    }
    const r = sendTestNotification(kind);
    toast(r.ok ? 'ok' : 'warn', r.text);
  };

  const EvToggle = ({ k, label }: { k: keyof TSettings['notifications']['on']; label: string }) => (
    <div className="flex items-center justify-between rounded-lg border border-line bg-raised/40 px-3.5 py-2.5">
      <span className="text-[12.5px] font-medium text-mut">{label}</span>
      <Toggle checked={n.on[k]} onChange={(v) => upd({ on: { ...n.on, [k]: v } })} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Telegram" icon={Send} delay={0}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-ink">Включено</span>
              <Toggle checked={n.telegram.enabled} onChange={(v) => upd({ telegram: { ...n.telegram, enabled: v } })} />
            </div>
            <Field label="Токен бота"><input className="inp font-mono text-[12px]" value={n.telegram.botToken} onChange={(e) => upd({ telegram: { ...n.telegram, botToken: e.target.value } })} /></Field>
            <Field label="chat_id"><input className="inp font-mono text-[12px]" value={n.telegram.chatId} onChange={(e) => upd({ telegram: { ...n.telegram, chatId: e.target.value } })} /></Field>
            <button className="btn-ghost w-full justify-center" onClick={() => test('telegram')}>Отправить тест</button>
          </div>
        </Panel>

        <Panel title="Почта (SMTP)" icon={Mail} delay={60}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-ink">Включено</span>
              <Toggle checked={n.email.enabled} onChange={(v) => upd({ email: { ...n.email, enabled: v } })} />
            </div>
            <div className="grid grid-cols-[1fr_80px] gap-2">
              <Field label="SMTP-хост"><input className="inp font-mono text-[12px]" value={n.email.smtp} onChange={(e) => upd({ email: { ...n.email, smtp: e.target.value } })} /></Field>
              <Field label="Порт"><input className="inp font-mono text-[12px]" value={n.email.port} onChange={(e) => upd({ email: { ...n.email, port: parseInt(e.target.value.replace(/\D/g, ''), 10) || 587 } })} /></Field>
            </div>
            <Field label="Кому"><input className="inp font-mono text-[12px]" value={n.email.to} onChange={(e) => upd({ email: { ...n.email, to: e.target.value } })} /></Field>
            <button className="btn-ghost w-full justify-center" onClick={() => test('email')}>Отправить тест</button>
          </div>
        </Panel>

        <Panel title="Всплывающие окна" icon={Bell} delay={120}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-ink">Включено</span>
              <Toggle checked={n.push.enabled} onChange={(v) => upd({ push: { enabled: v } })} />
            </div>
            <p className="text-[11.5px] leading-relaxed text-dim">
              Срабатывают даже если открыта другая вкладка браузера. Требуется разрешение на уведомления.
            </p>
            <button className="btn-ghost w-full justify-center" onClick={() => test('push')}>Отправить тест</button>
          </div>
        </Panel>
      </div>

      <Panel title="Какие события присылать" icon={Bell} delay={180}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <EvToggle k="down" label="Авария (потеря связи)" />
          <EvToggle k="degraded" label="Деградация связи" />
          <EvToggle k="recover" label="Восстановление" />
          <EvToggle k="agentOff" label="Агент офлайн" />
          <EvToggle k="agentOn" label="Агент в сети" />
        </div>
      </Panel>
    </div>
  );
}

// ─── Пользователи ────────────────────────────────────────────────────────────

function UserModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: User | null }) {
  const addUser = usePluto((s) => s.addUser);
  const updateUser = usePluto((s) => s.updateUser);
  const apiMode = usePluto((s) => s.apiMode);
  const toast = (k: 'ok' | 'warn', t: string) => useToasts.push(k, t);
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer');
  const [scope, setScope] = useState<string[]>([]);
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');

  const submit = () => {
    if (initial) {
      updateUser(initial.id, { login, name, role, scope: scope as any, ...(pass ? { pass } : {}) });
      toast('ok', 'Пользователь обновлён');
      onClose();
      return;
    }
    const e = addUser({ login, name, role, scope, pass });
    if (e) { setErr(e); return; }
    toast('ok', 'Пользователь создан');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Редактировать пользователя' : 'Новый пользователь'}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Логин"><input className="inp font-mono" value={login} onChange={(e) => { setLogin(e.target.value); setErr(''); }} disabled={initial?.builtIn} /></Field>
          <Field label="Отображаемое имя"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <Field label="Роль">
          <Seg
            options={[{ v: 'viewer' as const, label: 'Наблюдатель' }, { v: 'admin' as const, label: 'Администратор' }]}
            value={role}
            onChange={setRole}
          />
        </Field>
        {role === 'viewer' && (
          <Field label="Доступные типы устройств" hint="что может смотреть наблюдатель">
            <div className="flex flex-wrap gap-1.5">
              {[...DEVICE_TYPES, 'agent' as const].map((t) => {
                const on = scope.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => setScope((s) => (on ? s.filter((x) => x !== t) : [...s, t]))}
                    className={cls('rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold', on ? 'border-vio/60 bg-viodeep/40 text-ink' : 'border-line bg-raised/60 text-dim')}
                  >
                    {t === 'agent' ? 'АГЕНТЫ' : DEVICE_TYPE_META[t as keyof typeof DEVICE_TYPE_META].label}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        <Field label={initial ? 'Новый пароль (пусто — без изменений)' : 'Пароль'}>
          <input className="inp" type="password" value={pass} onChange={(e) => { setPass(e.target.value); setErr(''); }} />
        </Field>
        {err && <p className="pop rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-acc" onClick={submit}>{initial ? 'Сохранить' : 'Создать'}</button>
        </div>
      </div>
    </Modal>
  );
}

function UsersTab() {
  const users = usePluto((s) => s.users);
  const removeUser = usePluto((s) => s.removeUser);
  const toast = (k: 'ok' | 'warn', t: string) => useToasts.push(k, t);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  return (
    <Panel
      title="Пользователи и доступ" icon={Users} delay={0}
      right={<button className="btn-acc" onClick={() => { setEditing(null); setModal(true); }}><Plus className="h-4 w-4" /> Добавить</button>}
    >
      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised/50 px-3.5 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-viodeep/40 font-display text-[12px] font-bold text-vio ring-1 ring-vio/30">
              {u.login.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink">{u.login}{u.builtIn && <span className="ml-2 rounded bg-vio/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-vio">по умолчанию</span>}</div>
              <div className="text-[11px] text-dim">
                {u.role === 'admin' ? 'администратор' : `наблюдатель · ${(u.scope as string[]).map((x) => x === 'agent' ? 'агенты' : x).join(', ') || 'нет доступа'}`}
              </div>
            </div>
            <button onClick={() => { setEditing(u); setModal(true); }} className="rounded-md p-1.5 text-dim transition-colors hover:text-ink">
              <Pencil className="h-4 w-4" />
            </button>
            {!u.builtIn && (
              <button onClick={() => { const e = removeUser(u.id); if (e) toast('warn', e); else toast('ok', 'Пользователь удалён'); }} className="rounded-md p-1.5 text-dim transition-colors hover:text-crit">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <UserModal open={modal} onClose={() => setModal(false)} initial={editing} />
    </Panel>
  );
}

// ─── Страница ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('poll');
  const resetBase = usePluto((s) => s.resetBase);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-center justify-between gap-3">
        <Seg
          options={[
            { v: 'poll' as const, label: 'Опросы' },
            { v: 'tags' as const, label: 'Теги' },
            { v: 'notify' as const, label: 'Уведомления' },
            { v: 'users' as const, label: 'Пользователи' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'poll' && (
          confirmReset ? (
            <button className="btn-ghost border-crit/50 text-crit" onClick={() => { resetBase(); setConfirmReset(false); }}>
              <X className="h-4 w-4" /> Точно очистить базу?
            </button>
          ) : (
            <button className="btn-ghost" onClick={() => setConfirmReset(true)}>
              <Trash2 className="h-4 w-4" /> Очистить базу
            </button>
          )
        )}
      </div>

      {tab === 'poll' && <PollTab />}
      {tab === 'tags' && <TagsTab />}
      {tab === 'notify' && <NotifyTab />}
      {tab === 'users' && <UsersTab />}
    </div>
  );
}
