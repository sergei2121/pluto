// ─── PLUTO: агенты ───────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Copy, Cpu, HardDrive, KeyRound, Monitor, Network, Pencil, Plus, Star, Terminal, Thermometer, Trash2 } from 'lucide-react';
import { AreaChart, Bar, CopyBlock, Drawer, EmptyState, Field, Modal, Panel, Ring, StatusDot, TimeAgo } from '../components/ui';
import { usePluto, useCurrentUser, visibleAgents, useToasts } from '../lib/store';
import { api, syncAll } from '../lib/api';
import { cls, fmtBytes, fmtGb, pct } from '../lib/util';
import type { Agent } from '../lib/types';

function AgentCard({ a, delay, onOpen }: { a: Agent; delay: number; onOpen: () => void }) {
  const toggleFav = usePluto((s) => s.toggleAgentFav);
  return (
    <div
      className="rise group cursor-pointer rounded-xl border border-line bg-panel/85 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40 hover:bg-raised/70"
      style={{ animationDelay: `${delay}ms` }}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2.5">
        <StatusDot status={a.online ? 'up' : 'down'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold text-ink">{a.name || a.hostname}</div>
          <div className="truncate font-mono text-[10.5px] text-dim">
            {a.hostname && a.hostname !== a.name ? `${a.hostname} · ` : ''}{a.ip} · {a.os || 'Windows'}
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); toggleFav(a.id); }} className="rounded-md p-1 text-dim transition-all hover:text-warn">
          <Star className={cls('h-4 w-4', a.favorite && 'fill-warn text-warn')} />
        </button>
      </div>

      <div className="mt-3.5 flex items-center gap-4">
        <Ring value={a.online ? a.cpuLoad : 0} size={58} label="ЦП" color={a.cpuLoad > 85 ? '#e07a80' : '#8f7df0'} />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div>
            <div className="mb-1 flex justify-between font-mono text-[10px] text-dim">
              <span>ОЗУ {fmtGb(a.ramUsed)} / {fmtGb(a.ramTotal)}</span>
              <span className="text-mut">{a.online ? pct(a.ramUsed, a.ramTotal) + '%' : '—'}</span>
            </div>
            <Bar value={a.online ? pct(a.ramUsed, a.ramTotal) : 0} color="#7ba4e6" />
          </div>
          <div>
            <div className="mb-1 flex justify-between font-mono text-[10px] text-dim">
              <span>Диски ({a.disks.length})</span>
              <span className="text-mut">{a.online && a.disks.length ? pct(a.disks.reduce((s, d) => s + d.used, 0), a.disks.reduce((s, d) => s + d.total, 0)) + '%' : '—'}</span>
            </div>
            <Bar value={a.online && a.disks.length ? pct(a.disks.reduce((s, d) => s + d.used, 0), a.disks.reduce((s, d) => s + d.total, 0)) : 0} color="#5fc6d8" />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-linesoft pt-2.5 font-mono text-[10.5px] text-dim">
        <span className="flex items-center gap-1.5 text-warn"><Thermometer className="h-3 w-3" />{a.online ? `${Math.round(a.cpuTemp)}°C` : '—'}</span>
        <span className="flex items-center gap-1.5 text-blu"><Network className="h-3 w-3" />{a.online ? `${Math.round(a.rxRate)} КБ/с` : '—'}</span>
        <span className={a.online ? 'text-ok' : 'text-crit'}>{a.online ? 'в сети' : 'офлайн'}</span>
      </div>
    </div>
  );
}

function AgentDrawer({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (a: Agent) => void }) {
  const a = usePluto((s) => s.agents.find((x) => x.id === id));
  const removeAgent = usePluto((s) => s.removeAgent);
  const toggleFav = usePluto((s) => s.toggleAgentFav);
  const apiMode = usePluto((s) => s.apiMode);
  const [confirmDel, setConfirmDel] = useState(false);

  if (!a) return <Drawer open={false} onClose={onClose} title={null}><div /></Drawer>;

  const cpuHist = a.history.map((h) => h.cpu);
  const ramHist = a.history.map((h) => h.ram);

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <StatusDot status={a.online ? 'up' : 'down'} />
          <div>
            <div className="font-display text-[15px] font-semibold text-ink">{a.name || a.hostname}</div>
            <div className="font-mono text-[11px] text-dim">
              {a.hostname && a.hostname !== a.name ? `${a.hostname} · ` : ''}{a.ip} · агент v{a.version}
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-center rounded-lg border border-line bg-raised/50 p-3">
            <Ring value={a.online ? a.cpuLoad : 0} size={76} label={`ЦП · ${a.cpuCores} яд.`} color={a.cpuLoad > 85 ? '#e07a80' : '#8f7df0'} />
          </div>
          <div className="flex flex-col justify-center gap-1.5 rounded-lg border border-line bg-raised/50 p-3.5 font-mono text-[12px]">
            <div className="flex justify-between"><span className="text-dim">Темп. ЦП</span><span className="text-warn">{a.online ? `${Math.round(a.cpuTemp)}°C` : '—'}</span></div>
            <div className="flex justify-between"><span className="text-dim">Темп. ОЗУ</span><span className="text-warn">{a.online ? `${Math.round(a.ramTemp)}°C` : '—'}</span></div>
            <div className="flex justify-between"><span className="text-dim">RX всего</span><span className="text-blu">{fmtBytes(a.rxBytes)}</span></div>
            <div className="flex justify-between"><span className="text-dim">TX всего</span><span className="text-blu">{fmtBytes(a.txBytes)}</span></div>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-dim">Загрузка ЦП</div>
          <AreaChart values={cpuHist} height={80} color="#8f7df0" unit="%" max={100} />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-dim">Загрузка ОЗУ</div>
          <AreaChart values={ramHist} height={80} color="#7ba4e6" unit="%" max={100} />
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-dim">
            <HardDrive className="h-3.5 w-3.5" /> Диски ({a.disks.length})
          </div>
          <div className="space-y-2">
            {a.disks.map((d) => (
              <div key={d.id} className="rounded-lg border border-line bg-raised/40 p-3">
                <div className="mb-1.5 flex justify-between font-mono text-[11.5px]">
                  <span className="font-bold text-ink">{d.label}</span>
                  <span className="text-dim">{fmtGb(d.used)} / {fmtGb(d.total)} · {Math.round(d.temp)}°C</span>
                </div>
                <Bar value={pct(d.used, d.total)} color="#5fc6d8" />
              </div>
            ))}
            {a.disks.length === 0 && <p className="text-[12px] text-dim">Нет данных о дисках</p>}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-dim">
            <Network className="h-3.5 w-3.5" /> Локальные сети (ARP-скан)
          </div>
          {a.networks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line bg-raised/30 p-3 text-[12px] text-dim">
              Скан ещё не выполнялся или сети не обнаружены.
            </p>
          ) : (
            <div className="space-y-2">
              {a.networks.map((n) => (
                <div key={n.cidr} className="rounded-lg border border-line bg-raised/40 p-3">
                  <div className="mb-1.5 font-mono text-[11.5px] font-bold text-ink">{n.cidr} <span className="font-normal text-dim">· {n.iface}</span></div>
                  <div className="space-y-1">
                    {n.hosts.slice(0, 8).map((h) => (
                      <div key={h.ip} className="flex items-center gap-2 font-mono text-[11px]">
                        <span className={cls('h-1.5 w-1.5 rounded-full', h.online ? 'bg-ok' : 'bg-dim')} />
                        <span className="text-mut">{h.ip}</span>
                        <span className="text-dim/70">{h.mac}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5 rounded-lg border border-line bg-raised/40 p-3.5 font-mono text-[12px]">
          <div className="flex justify-between"><span className="text-dim">Последний heartbeat</span><TimeAgo ts={a.lastSeen} className="text-mut" /></div>
          <div className="flex justify-between"><span className="text-dim">Источник данных</span><span className={apiMode === 'server' ? 'text-ok' : 'text-warn'}>{apiMode === 'server' ? 'реальный агент' : 'эмуляция'}</span></div>
        </div>

        <div className="flex gap-2 border-t border-linesoft pt-4">
          <button className="btn-ghost flex-1 justify-center" onClick={() => toggleFav(a.id)}>
            <Star className={cls('h-4 w-4', a.favorite && 'fill-warn text-warn')} /> Избранное
          </button>
          {apiMode === 'server' && (
            <button className="btn-ghost flex-1 justify-center" onClick={() => onEdit(a)}>
              <Pencil className="h-4 w-4" /> Изменить
            </button>
          )}
          {confirmDel ? (
            <button className="btn-ghost flex-1 justify-center border-crit/50 text-crit" onClick={() => { removeAgent(a.id); onClose(); }}>
              Подтвердить удаление
            </button>
          ) : (
            <button className="btn-ghost flex-1 justify-center hover:border-crit/50 hover:text-crit" onClick={() => setConfirmDel(true)}>
              <Trash2 className="h-4 w-4" /> Удалить
            </button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ─── Окно с созданным токеном ────────────────────────────────────────────────

function TokenModal({ info, onClose }: { info: { name: string; token: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : '<IP-сервера>';
  const installCmd = `cd C:\\pluto\n.\\pluto-agent.exe -install -server ws://${host}:8443/ws -token ${info?.token ?? '<ТОКЕН>'}`;

  const copyToken = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* буфер обмена недоступен — токен можно выделить вручную */
    }
  };

  return (
    <Modal open={!!info} onClose={onClose} title="Токен подключения агента">
      {info && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3.5 py-2.5">
            <KeyRound className="h-4 w-4 shrink-0 text-ok" />
            <p className="text-[12.5px] text-ok">Токен для «{info.name}» создан. Агент с этим токеном появится в списке автоматически.</p>
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Токен</span>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-[#0b0f1f] px-3.5 py-3">
              <code className="min-w-0 flex-1 break-all font-mono text-[13px] font-semibold tracking-wide text-vio">{info.token}</code>
              <button
                onClick={copyToken}
                className={cls(
                  'flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all',
                  copied ? 'border-ok/50 bg-ok/10 text-ok' : 'border-line bg-raised text-dim hover:text-ink',
                )}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Установка на Windows (PowerShell, администратор)</span>
            <CopyBlock label="powershell · с подставленным токеном" code={installCmd} />
            <p className="mt-2 text-[11px] leading-relaxed text-dim">
              Сначала соберите бинарник (<span className="font-mono text-mut">cd agent; go build -o pluto-agent.exe .</span>),
              положите его в <span className="font-mono text-mut">C:\pluto</span> и запускайте с префиксом{' '}
              <span className="font-mono text-mut">.\</span> — без него Windows не найдёт файл в текущей папке.
            </p>
          </div>

          <p className="rounded-lg border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-warn">
            Токен — ключ доступа к ядру. Храните его как пароль и не передавайте третьим лицам. При компрометации удалите агента и создайте новый токен.
          </p>
        </div>
      )}
    </Modal>
  );
}

// ─── Создание агента: имя → токен ───────────────────────────────────────────

function NewAgentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (info: { name: string; token: string }) => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = (k: 'ok' | 'warn', t: string) => useToasts.push(k, t);

  useEffect(() => {
    if (open) { setName(''); setErr(''); }
  }, [open]);

  const submit = () => {
    const n = name.trim();
    if (!n) { setErr('Введите понятное имя — за что отвечает машина'); return; }
    setBusy(true);
    api.createAgentToken(n)
      .then((r) => { onCreated({ name: n, token: r.token }); void syncAll(); onClose(); })
      .catch((e) => toast('warn', (e as Error)?.message || 'Не удалось создать токен'))
      .finally(() => setBusy(false));
  };

  return (
    <Modal open={open} onClose={onClose} title="Новый агент">
      <div className="space-y-4">
        <Field label="Имя агента" hint="как он будет виден в списке: за что отвечает машина">
          <input
            className="inp"
            value={name}
            onChange={(e) => { setName(e.target.value); setErr(''); }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Например: Касса №3 · Склад — видеонаблюдение"
            autoFocus
          />
        </Field>
        <p className="rounded-lg border border-line bg-raised/40 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-dim">
          Имя можно изменить в любой момент через карточку агента. Hostname машины подставится автоматически при первом подключении.
        </p>
        {err && <p className="pop rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn-acc" onClick={submit} disabled={busy}>
            <KeyRound className="h-4 w-4" /> {busy ? 'Создание…' : 'Создать токен'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Редактирование агента (имя) ────────────────────────────────────────────

function EditAgentModal({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = (k: 'ok' | 'warn', t: string) => useToasts.push(k, t);

  useEffect(() => {
    if (agent) { setName(agent.name || agent.hostname || ''); setErr(''); }
  }, [agent]);

  const submit = () => {
    if (!agent) return;
    const n = name.trim();
    if (!n) { setErr('Имя не может быть пустым'); return; }
    setBusy(true);
    api.patchAgent(agent.id, { name: n })
      .then(() => { toast('ok', `Агент переименован в «${n}»`); void syncAll(); onClose(); })
      .catch((e) => toast('warn', (e as Error)?.message || 'Не удалось сохранить'))
      .finally(() => setBusy(false));
  };

  return (
    <Modal open={!!agent} onClose={onClose} title="Изменить агента">
      {agent && (
        <div className="space-y-4">
          <Field label="Имя агента" hint="отображается в списке и на карточке">
            <input
              className="inp"
              value={name}
              onChange={(e) => { setName(e.target.value); setErr(''); }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              autoFocus
            />
          </Field>
          <div className="space-y-1.5 rounded-lg border border-line bg-raised/40 p-3.5 font-mono text-[12px]">
            <div className="flex justify-between"><span className="text-dim">Hostname</span><span className="text-mut">{agent.hostname || '—'}</span></div>
            <div className="flex justify-between"><span className="text-dim">IP</span><span className="text-mut">{agent.ip || '—'}</span></div>
          </div>
          {err && <p className="pop rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={onClose}>Отмена</button>
            <button className="btn-acc" onClick={submit} disabled={busy}>
              <Pencil className="h-4 w-4" /> {busy ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Agents() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const allAgents = usePluto((s) => s.agents);
  const agents = useMemo(() => visibleAgents(allAgents, user), [allAgents, user]);
  const addEmulated = usePluto((s) => s.addEmulatedAgent);
  const apiMode = usePluto((s) => s.apiMode);
  const metrics = usePluto((s) => s.settings.metrics);
  const toast = (k: 'ok' | 'warn', t: string) => useToasts.push(k, t);

  const [showInstall, setShowInstall] = useState(false);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ name: string; token: string } | null>(null);
  const [newAgent, setNewAgent] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);

  const online = agents.filter((a) => a.online).length;

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-4 rounded-lg border border-line bg-raised/60 px-4 py-2.5">
          <span className="font-mono text-[12px] text-mut"><span className="font-bold text-ok">{online}</span> / {agents.length} в сети</span>
          <span className="h-4 w-px bg-line" />
          <span className="font-mono text-[12px] text-dim">телеметрия каждые {metrics} с</span>
        </div>

        <div className="ml-auto flex gap-2">
          {isAdmin && (
            <>
              <button className="btn-ghost" onClick={() => setShowInstall((v) => !v)}>
                <Terminal className="h-4 w-4" /> Установка на Windows
              </button>
              {apiMode === 'server' ? (
                <button className="btn-acc" onClick={() => setNewAgent(true)}>
                  <KeyRound className="h-4 w-4" /> Создать токен агента
                </button>
              ) : (
                <button className="btn-acc" onClick={() => { const a = addEmulated(); if (a) { toast('ok', `Тестовый агент ${a.hostname} подключён`); setDrawer(a.id); } }}>
                  <Plus className="h-4 w-4" /> Подключить тестового агента
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {showInstall && isAdmin && (
        <Panel title="Подключение реального агента (Windows)" icon={Terminal} delay={40}>
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-mut">
              Агент — один исполняемый файл на Go, без зависимостей. Ставится одной командой PowerShell, регистрируется как служба Windows
              и подключается к ядру по WebSocket с токеном. Токен создаётся кнопкой «Создать токен агента».
            </p>
            <CopyBlock label="powershell · сборка из исходников" code={`cd agent\ngo build -o pluto-agent.exe .\nmkdir C:\pluto\nmove pluto-agent.exe C:\pluto\pluto-agent.exe`} />
            <CopyBlock label="powershell · установка службой (из C:\pluto)" code={`cd C:\pluto\n.\pluto-agent.exe -install -server ws://<IP-сервера>:8443/ws -token <ТОКЕН_АГЕНТА>`} />
            <p className="text-[11.5px] text-dim">
              Агент собирает: ЦП (загрузка, температура), ОЗУ, диски (объёмы, занятость, температуры), сетевые счётчики RX/TX и ARP-скан доступных локальных сетей.
            </p>
          </div>
        </Panel>
      )}

      {agents.length === 0 ? (
        <Panel title="Реестр агентов" icon={Monitor} delay={80}>
          <EmptyState
            icon={Monitor}
            title="Агентов пока нет"
            text={apiMode === 'server'
              ? 'Создайте токен и запустите pluto-agent на Windows-машине — телеметрия появится в течение секунд.'
              : 'Подключите Windows-машину по токену или поднимите тестового агента, чтобы увидеть телеметрию: ЦП, ОЗУ, диски, температуры, сеть и LAN-скан.'}
            action={isAdmin ? (
              apiMode === 'server' ? (
                <button className="btn-acc" onClick={() => setNewAgent(true)}><KeyRound className="h-4 w-4" /> Создать токен агента</button>
              ) : (
                <button className="btn-acc" onClick={() => { const a = addEmulated(); if (a) { toast('ok', `Тестовый агент ${a.hostname} подключён`); setDrawer(a.id); } }}>
                  <Plus className="h-4 w-4" /> Подключить тестового агента
                </button>
              )
            ) : undefined}
          />
        </Panel>
      ) : (
        <div className="grid gap-3.5 md:grid-cols-2 2xl:grid-cols-3">
          {agents.map((a, i) => (
            <AgentCard key={a.id} a={a} delay={Math.min(i * 60, 360)} onOpen={() => setDrawer(a.id)} />
          ))}
        </div>
      )}

      <AgentDrawer id={drawer} onClose={() => setDrawer(null)} onEdit={(a) => setEditing(a)} />
      <TokenModal info={tokenInfo} onClose={() => setTokenInfo(null)} />
      <NewAgentModal open={newAgent} onClose={() => setNewAgent(false)} onCreated={(info) => setTokenInfo(info)} />
      <EditAgentModal agent={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
