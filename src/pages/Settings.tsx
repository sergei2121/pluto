// ─── PLUTO: настройки системы ────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { I } from '../components/icons';
import { Field, Modal, Panel, Seg, Toggle } from '../components/ui';
import { useStore, useToasts } from '../lib/store';
import { sendTestNotification } from '../lib/engine';
import { cls, fmtDate, TAG_COLORS } from '../lib/util';
import type { CheckScope, DeviceType, Settings as TSettings, User } from '../lib/types';
import { DEVICE_TYPE_META } from '../lib/types';

type Tab = 'poll' | 'tags' | 'notify' | 'users';

// ─── Опросы ──────────────────────────────────────────────────────────────────

function PollTab() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const [draft, setDraft] = useState<TSettings>({ ...settings, intervals: { ...settings.intervals } });

  const num = (v: string, fb: number) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fb;
  };

  return (
    <div className="space-y-4">
      <Panel title="Интервалы опросов по типам проверок" icon="clock" delay={0}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {(Object.keys(DEVICE_TYPE_META) as DeviceType[]).map((t) => (
            <Field key={t} label={DEVICE_TYPE_META[t].short} hint={DEVICE_TYPE_META[t].label}>
              <div className="flex items-center gap-2">
                <input
                  className="inp font-mono"
                  value={draft.intervals[t]}
                  onChange={(e) => setDraft({ ...draft, intervals: { ...draft.intervals, [t]: num(e.target.value.replace(/\D/g, ''), draft.intervals[t]) } })}
                />
                <span className="text-[11px] text-dim">сек</span>
              </div>
            </Field>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-dim">Это значения по умолчанию при создании устройства — у каждого устройства интервал можно задать индивидуально.</p>
      </Panel>

      <Panel title="Пороговые значения" icon="activity" delay={60}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Порог аварии" hint="сбоев подряд до статуса «авария»">
            <input className="inp font-mono" value={draft.failThreshold} onChange={(e) => setDraft({ ...draft, failThreshold: num(e.target.value.replace(/\D/g, ''), 3) })} />
          </Field>
          <Field label="Фактор деградации" hint="во сколько раз пинг выше базового">
            <input className="inp font-mono" value={draft.degradeFactor} onChange={(e) => setDraft({ ...draft, degradeFactor: num(e.target.value.replace(/\D/g, ''), 5) })} />
          </Field>
          <Field label="Мин. порог деградации" hint="абсолютная задержка, мс">
            <input className="inp font-mono" value={draft.degradeMinMs} onChange={(e) => setDraft({ ...draft, degradeMinMs: num(e.target.value.replace(/\D/g, ''), 80) })} />
          </Field>
          <Field label="Таймаут проверки" hint="мс до принудительного сбоя">
            <input className="inp font-mono" value={draft.timeoutMs} onChange={(e) => setDraft({ ...draft, timeoutMs: num(e.target.value.replace(/\D/g, ''), 4000) })} />
          </Field>
        </div>
      </Panel>

      <Panel title="Агенты" icon="agents" delay={120}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Heartbeat" hint="сек, контроль живости">
            <input className="inp font-mono" value={draft.heartbeat} onChange={(e) => setDraft({ ...draft, heartbeat: num(e.target.value.replace(/\D/g, ''), 10) })} />
          </Field>
          <Field label="Телеметрия" hint="сек, сбор метрик">
            <input className="inp font-mono" value={draft.metrics} onChange={(e) => setDraft({ ...draft, metrics: num(e.target.value.replace(/\D/g, ''), 3) })} />
          </Field>
          <Field label="Скан локальных сетей" hint="сек, ARP-опрос">
            <input className="inp font-mono" value={draft.lanScan} onChange={(e) => setDraft({ ...draft, lanScan: num(e.target.value.replace(/\D/g, ''), 300) })} />
          </Field>
          <div className="flex items-end pb-1">
            <label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-raised/40 px-3.5 py-2.5">
              <span>
                <span className="block text-[12px] font-semibold text-ink">Сетевая эмуляция</span>
                <span className="block text-[10.5px] text-dim">браузерное ядро: честные fetch-зонды off</span>
              </span>
              <Toggle checked={draft.simulate} onChange={(v) => setDraft({ ...draft, simulate: v })} />
            </label>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
          Встроенное (браузерное) ядро эмулирует ICMP/RTSP/SIP и недостижимые хосты, чтобы система была работоспособна без серверной части.
          При развёртывании сервера ядро выполняет настоящие проверки — эмуляцию можно выключить.
        </p>
      </Panel>

      <div className="flex justify-end">
        <button className="btn-acc" onClick={() => saveSettings(draft)}>
          <I n="check" className="h-4 w-4" /> Сохранить настройки
        </button>
      </div>
    </div>
  );
}

// ─── Теги ────────────────────────────────────────────────────────────────────

function TagsTab() {
  const tags = useStore((s) => s.tags);
  const devices = useStore((s) => s.devices);
  const addTag = useStore((s) => s.addTag);
  const removeTag = useStore((s) => s.removeTag);
  const toast = useToasts((s) => s.push);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);

  const usage = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of devices) for (const t of d.tags) m[t] = (m[t] ?? 0) + 1;
    return m;
  }, [devices]);

  const submit = () => {
    const err = addTag(label, color);
    if (err) toast('warn', err);
    else { setLabel(''); toast('ok', `Тег «${label.trim()}» создан`); }
  };

  return (
    <div className="space-y-4">
      <Panel title="Создание тега" icon="tag" delay={0}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Название">
              <input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Новый тег" />
            </Field>
          </div>
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Цвет · 10 вариантов</span>
            <div className="flex gap-1.5">
              {TAG_COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className={cls('h-7 w-7 rounded-md transition-all duration-150', color === c ? 'scale-110 ring-2 ring-ink/70 ring-offset-2 ring-offset-panel' : 'hover:scale-105')}
                  style={{ background: c }} title={c} />
              ))}
            </div>
          </div>
          <button className="btn-acc sm:mb-0.5" onClick={submit}><I n="plus" className="h-4 w-4" /> Создать</button>
        </div>
      </Panel>

      <Panel title={`Теги · ${tags.length}`} icon="tag" delay={60} bodyClass="p-4">
        {tags.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-dim">Тегов пока нет — создайте первый, чтобы размечать устройства и быстро искать их на главной.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tags.map((t) => (
              <li key={t.id} className="group flex items-center gap-2.5 rounded-lg border border-line bg-raised/40 px-3.5 py-2.5 transition-colors hover:border-line/80 hover:bg-raised/70">
                <span className="flex items-center gap-2 rounded-md px-2.5 py-1 text-[12px] font-bold text-void" style={{ background: t.color }}>
                  <span className="h-2 w-2 rounded-full bg-void/40" />{t.label}
                </span>
                <span className="ml-auto font-mono text-[11px] text-dim">{usage[t.id] ?? 0} устр.</span>
                <button
                  onClick={() => { removeTag(t.id); toast('info', `Тег «${t.label}» удалён`); }}
                  className="rounded-md p-1 text-dim opacity-0 transition-all hover:bg-crit/15 hover:text-crit group-hover:opacity-100"
                  title="Удалить тег">
                  <I n="trash" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ─── Уведомления ─────────────────────────────────────────────────────────────

function NotifyTab() {
  const settings = useStore((s) => s.settings);
  const setRaw = useStore((s) => s.setSettingsRaw);
  const pushEvent = useStore((s) => s.pushEvent);
  const toast = useToasts((s) => s.push);
  const n = settings.notifications;
  const upd = (patch: Partial<typeof n>) => setRaw({ ...settings, notifications: { ...n, ...patch } });

  const togglePush = async (v: boolean) => {
    if (v) {
      if (typeof Notification === 'undefined') { toast('warn', 'Браузер не поддерживает уведомления'); return; }
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('warn', 'Разрешение не выдано — уведомления браузера отключены'); return; }
      toast('ok', 'Push-уведомления включены — сработают даже при закрытой вкладке PLUTO');
      pushEvent('info', 'system', 'Включены всплывающие уведомления браузера');
    }
    upd({ push: { enabled: v } });
  };

  const test = (kind: 'push' | 'telegram' | 'email') => {
    const r = sendTestNotification(kind);
    toast(r.ok ? 'ok' : 'warn', r.text);
  };

  const OnToggle = ({ k, label }: { k: keyof typeof n.on; label: string }) => (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-raised/40 px-3.5 py-2.5 transition-colors hover:bg-raised/70">
      <span className="text-[12.5px] font-medium text-mut">{label}</span>
      <Toggle checked={n.on[k]} onChange={(v) => upd({ on: { ...n.on, [k]: v } })} />
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Telegram */}
        <Panel title="Telegram" icon="send" delay={0}
          right={<Toggle checked={n.telegram.enabled} onChange={(v) => { upd({ telegram: { ...n.telegram, enabled: v } }); if (v) pushEvent('info', 'system', 'Уведомления Telegram включены'); }} />}>
          <div className="space-y-3">
            <Field label="Токен бота" hint="Создайте бота у @BotFather">
              <input className="inp font-mono text-[12px]" value={n.telegram.botToken}
                onChange={(e) => upd({ telegram: { ...n.telegram, botToken: e.target.value } })} />
            </Field>
            <Field label="Chat ID" hint="ID чата или канала для уведомлений">
              <input className="inp font-mono text-[12px]" value={n.telegram.chatId}
                onChange={(e) => upd({ telegram: { ...n.telegram, chatId: e.target.value } })} />
            </Field>
            <button className="btn-ghost w-full justify-center" disabled={!n.telegram.enabled} onClick={() => test('telegram')}>
              <I n="send" className="h-4 w-4" /> Тестовое сообщение
            </button>
            <p className="text-[10.5px] leading-relaxed text-dim">Отправка выполняется напрямую через Telegram Bot API — работает сразу, без сервера.</p>
          </div>
        </Panel>

        {/* Email */}
        <Panel title="Электронная почта" icon="mail" delay={60}
          right={<Toggle checked={n.email.enabled} onChange={(v) => { upd({ email: { ...n.email, enabled: v } }); if (v) pushEvent('info', 'system', 'Почтовые уведомления включены'); }} />}>
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_84px] gap-2">
              <Field label="SMTP-сервер">
                <input className="inp font-mono text-[12px]" value={n.email.smtp}
                  onChange={(e) => upd({ email: { ...n.email, smtp: e.target.value } })} />
              </Field>
              <Field label="Порт">
                <input className="inp font-mono text-[12px]" value={n.email.port}
                  onChange={(e) => upd({ email: { ...n.email, port: parseInt(e.target.value.replace(/\D/g, ''), 10) || 587 } })} />
              </Field>
            </div>
            <Field label="Отправитель">
              <input className="inp font-mono text-[12px]" value={n.email.from}
                onChange={(e) => upd({ email: { ...n.email, from: e.target.value } })} />
            </Field>
            <Field label="Получатель">
              <input className="inp font-mono text-[12px]" value={n.email.to}
                onChange={(e) => upd({ email: { ...n.email, to: e.target.value } })} />
            </Field>
            <button className="btn-ghost w-full justify-center" disabled={!n.email.enabled} onClick={() => test('email')}>
              <I n="mail" className="h-4 w-4" /> Тестовое письмо
            </button>
            <p className="text-[10.5px] leading-relaxed text-dim">SMTP-отправка выполняется серверной частью ядра (nodemailer); в браузерном режиме письмо эмулируется.</p>
          </div>
        </Panel>

        {/* Push */}
        <Panel title="Всплывающие (браузер)" icon="bell" delay={120}
          right={<Toggle checked={n.push.enabled} onChange={togglePush} />}>
          <div className="space-y-3">
            <div className="rounded-lg border border-line bg-raised/40 px-3.5 py-3">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                <span className={cls('h-2 w-2 rounded-full', typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'bg-ok' : 'bg-warn')} />
                {typeof Notification !== 'undefined'
                  ? Notification.permission === 'granted' ? 'Разрешение выдано' : Notification.permission === 'denied' ? 'Разрешение запрещено браузером' : 'Разрешение ещё не запрошено'
                  : 'Не поддерживается'}
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">
                Системные уведомления ОС: срабатывают, даже если PLUTO открыт в другой вкладке или браузер свёрнут.
              </p>
            </div>
            <button className="btn-ghost w-full justify-center" disabled={!n.push.enabled} onClick={() => test('push')}>
              <I n="bell" className="h-4 w-4" /> Показать тестовое окно
            </button>
          </div>
        </Panel>
      </div>

      <Panel title="Какие события уведомлять" icon="filter" delay={160}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <OnToggle k="down" label="Авария устройства" />
          <OnToggle k="degraded" label="Деградация связи" />
          <OnToggle k="recover" label="Восстановление" />
          <OnToggle k="agentOff" label="Агент офлайн" />
          <OnToggle k="agentOn" label="Агент в сети" />
        </div>
      </Panel>
    </div>
  );
}

// ─── Пользователи ────────────────────────────────────────────────────────────

const SCOPE_LABELS: Record<CheckScope, string> = {
  ping: 'Ping', http: 'HTTP', api: 'API', rtsp: 'RTSP', sip: 'SIP', agent: 'Агенты',
};

function UserModal({ initial, onClose }: { initial?: User; onClose: () => void }) {
  const saveUser = useStore((s) => s.saveUser);
  const toast = useToasts((s) => s.push);
  const [name, setName] = useState(initial?.name ?? '');
  const [login, setLogin] = useState(initial?.login ?? '');
  const [pass, setPass] = useState('');
  const [role, setRole] = useState<'admin' | 'viewer'>(initial?.role ?? 'viewer');
  const [scope, setScope] = useState<CheckScope[]>(initial?.scope.filter((s) => s !== 'agent').length ? initial.scope : ['ping', 'http']);
  const [err, setErr] = useState('');

  const submit = () => {
    const e = saveUser({ id: initial?.id, name: name.trim(), login, pass, role, scope: role === 'admin' ? ['ping', 'http', 'api', 'rtsp', 'sip', 'agent'] : scope });
    if (e) setErr(e);
    else { toast('ok', initial ? 'Пользователь обновлён' : `Пользователь ${login} создан`); onClose(); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Имя"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Логин"><input className="inp font-mono" value={login} onChange={(e) => { setLogin(e.target.value); setErr(''); }} disabled={initial?.builtIn} /></Field>
        <div className="col-span-2">
          <Field label={initial ? 'Новый пароль (пусто — без изменений)' : 'Пароль'}>
            <input className="inp font-mono" type="password" value={pass} onChange={(e) => { setPass(e.target.value); setErr(''); }} placeholder="••••••" />
          </Field>
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Роль</span>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => !initial?.builtIn && setRole('admin')}
            className={cls('rounded-lg border px-3 py-2.5 text-left transition-all', role === 'admin' ? 'border-vio/60 bg-vio-deep/40' : 'border-line bg-raised/50 hover:text-ink', initial?.builtIn && 'opacity-70')}>
            <span className="flex items-center gap-2 text-[13px] font-bold text-ink"><I n="shield" className="h-4 w-4 text-vio" /> Администратор</span>
            <span className="mt-0.5 block text-[11px] text-dim">полный доступ ко всем разделам</span>
          </button>
          <button type="button" onClick={() => !initial?.builtIn && setRole('viewer')}
            className={cls('rounded-lg border px-3 py-2.5 text-left transition-all', role === 'viewer' ? 'border-vio/60 bg-vio-deep/40' : 'border-line bg-raised/50 hover:text-ink', initial?.builtIn && 'opacity-70')}>
            <span className="flex items-center gap-2 text-[13px] font-bold text-ink"><I n="eye" className="h-4 w-4 text-blu" /> Наблюдатель</span>
            <span className="mt-0.5 block text-[11px] text-dim">только просмотр выбранных типов</span>
          </button>
        </div>
      </div>

      {role === 'viewer' && (
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Разрешённые типы устройств</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(SCOPE_LABELS) as CheckScope[]).map((sc) => {
              const on = scope.includes(sc);
              return (
                <button key={sc} type="button"
                  onClick={() => setScope((s) => (on ? s.filter((x) => x !== sc) : [...s, sc]))}
                  className={cls('rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-all', on ? 'border-vio/60 bg-vio-deep/50 text-ink' : 'border-line bg-raised/50 text-dim hover:text-mut')}>
                  {SCOPE_LABELS[sc]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {err && <p className="flex items-center gap-2 rounded-lg border border-crit/35 bg-crit/10 px-3 py-2 text-[12px] font-medium text-crit"><I n="alert" className="h-3.5 w-3.5" />{err}</p>}

      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn-acc" onClick={submit}><I n="check" className="h-4 w-4" /> {initial ? 'Сохранить' : 'Создать'}</button>
      </div>
    </div>
  );
}

function UsersTab() {
  const users = useStore((s) => s.users);
  const removeUser = useStore((s) => s.removeUser);
  const toast = useToasts((s) => s.push);
  const [modal, setModal] = useState<{ open: boolean; edit?: User }>({ open: false });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] text-dim">Администратор по умолчанию — <span className="font-mono text-mut">admin</span>. Создавайте наблюдателей для просмотра активности отдельных типов устройств.</p>
        <button className="btn-acc" onClick={() => setModal({ open: true })}><I n="plus" className="h-4 w-4" /> Пользователь</button>
      </div>

      <Panel title={`Пользователи · ${users.length}`} icon="users" delay={0} bodyClass="p-0">
        <ul>
          {users.map((u) => (
            <li key={u.id} className="group flex flex-wrap items-center gap-3 border-b border-line-soft/60 px-4 py-3 last:border-0 hover:bg-raised/40">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-vio-deep/40 font-display text-[13px] font-bold text-vio ring-1 ring-vio/25">
                {u.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">{u.name}</span>
                  {u.builtIn && <span className="rounded border border-vio/35 bg-vio/10 px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-vio">по умолчанию</span>}
                </div>
                <div className="font-mono text-[11px] text-dim">@{u.login} · создан {fmtDate(u.createdAt)}</div>
              </div>
              <span className={cls('ml-2 rounded-md px-2 py-1 font-mono text-[10.5px] font-bold uppercase', u.role === 'admin' ? 'bg-vio/10 text-vio' : 'bg-blu/10 text-blu')}>
                {u.role === 'admin' ? 'админ' : 'наблюдатель'}
              </span>
              {u.role === 'viewer' && (
                <span className="flex flex-wrap gap-1">
                  {u.scope.map((sc) => (
                    <span key={sc} className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-dim">{SCOPE_LABELS[sc]}</span>
                  ))}
                </span>
              )}
              <div className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button className="icon-btn" title="Изменить" onClick={() => setModal({ open: true, edit: u })}><I n="pencil" className="h-4 w-4" /></button>
                <button className="icon-btn hover:text-crit" title={u.builtIn ? 'Встроенного администратора удалить нельзя' : 'Удалить'}
                  onClick={() => { const e = removeUser(u.id); if (e) toast('warn', e); else toast('info', `Пользователь ${u.login} удалён`); }}>
                  <I n="trash" className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.edit ? `Пользователь @${modal.edit.login}` : 'Новый пользователь'}>
        <UserModal initial={modal.edit} onClose={() => setModal({ open: false })} />
      </Modal>
    </div>
  );
}

// ─── Опасная зона + страница ─────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('poll');
  const resetBase = useStore((s) => s.resetBase);
  const toast = useToasts((s) => s.push);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-center justify-between gap-3">
        <Seg<Tab>
          options={[
            { v: 'poll', label: 'Опросы' },
            { v: 'tags', label: 'Теги' },
            { v: 'notify', label: 'Уведомления' },
            { v: 'users', label: 'Пользователи' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="flex items-center gap-2">
          {confirmReset ? (
            <span className="flex items-center gap-2 rounded-lg border border-crit/35 bg-crit/10 px-3 py-1.5">
              <span className="text-[12px] font-semibold text-crit">Стереть все данные?</span>
              <button className="btn-danger" onClick={() => { resetBase(); setConfirmReset(false); toast('warn', 'База очищена — система снова в состоянии первого запуска'); }}>Стереть</button>
              <button className="btn-ghost" onClick={() => setConfirmReset(false)}>Отмена</button>
            </span>
          ) : (
            <button className="btn-ghost text-crit hover:border-crit/40" onClick={() => setConfirmReset(true)}>
              <I n="trash" className="h-4 w-4" /> Очистить базу
            </button>
          )}
        </div>
      </div>

      {tab === 'poll' && <PollTab />}
      {tab === 'tags' && <TagsTab />}
      {tab === 'notify' && <NotifyTab />}
      {tab === 'users' && <UsersTab />}
    </div>
  );
}
