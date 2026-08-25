// ─── PLUTO: агенты ──────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Plus, Star, Trash2, Monitor, Cpu, HardDrive, Network, KeyRound, Pencil, Terminal, Thermometer } from 'lucide-react';
import { AreaChart, Bar, CopyBlock, Drawer, EmptyState, Modal, Panel, Ring, StatusDot, TimeAgo, Field } from '../components/ui';
import { usePluto, useCurrentUser, visibleAgents, store, useToasts } from '../lib/store';
import { cls, fmtBytes, fmtGb, pct } from '../lib/util';
import type { Agent } from '../lib/types';

function hostIp(): string {
  return window.location.hostname || '127.0.0.1';
}

export default function Agents() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const apiMode = usePluto((s) => s.apiMode);
  const allAgents = usePluto((s) => s.agents);
  const routeParam = usePluto((s) => s.routeParam);
  const agents = useMemo(() => visibleAgents(allAgents, user), [allAgents, user]);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ name: string; token: string } | null>(null);
  const [tokenModal, setTokenModal] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    if (!routeParam) return;
    if (routeParam === 'new') {
      if (isAdmin) setTokenModal(true);
    } else {
      const a = agents.find((x) => (x.hostname || x.name) === routeParam || x.name === routeParam);
      if (a) setDrawerId(a.id);
    }
  }, [routeParam, isAdmin, agents]);

  const online = agents.filter((a) => a.online).length;
  const drawerAgent = drawerId ? agents.find((a) => a.id === drawerId) : undefined;

  const createToken = async (name: string) => {
    const r = await store.createAgentToken(name);
    setTokenModal(false);
    if (r) setTokenInfo({ name: r.agent.name, token: r.token });
  };

  return (
    <div className="space-y-4">
      {apiMode === 'server' && isAdmin && (
        <Panel title="Подключение реального агента" icon={<Terminal className="h-4 w-4" />}
          right={<button className="btn-ghost" onClick={() => setShowInstall((v) => !v)}><Terminal className="h-4 w-4" /> Инструкция</button>}>
          {!showInstall ? (
            <p className="text-[12.5px] leading-relaxed text-mut">
              Создайте токен кнопкой <b className="text-ink">«Создать токен агента»</b> и вставьте одну команду в PowerShell (от администратора) на Windows-машине.
              Установщик сам скачает исходник с ядра, скомпилирует его встроенным компилятором Windows под вашу архитектуру, запишет сервер и токен в{' '}
              <span className="font-mono text-[11.5px] text-mut">agent.conf</span> и поставит агент службой. В конце он сам проверит подключение.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-[12px] text-dim">Служба запускает exe <b className="text-mut">без аргументов</b> — сервер и токен агент читает из <span className="font-mono">C:\ProgramData\pluto\agent.conf</span>. Это исключает все проблемы с кавычками и кодировками.</p>
              <CopyBlock label="powershell · одна строка, токен подставится из окна токена" code={`iwr http://${hostIp()}:8080/agent/install.ps1 -OutFile $env:TEMP\\pluto-install.ps1; & $env:TEMP\\pluto-install.ps1 -Token '<ТОКЕН>'`} />
              <CopyBlock label="powershell · управление службой" code={`sc.exe query pluto-agent\nRestart-Service pluto-agent\nGet-Content C:\\ProgramData\\pluto\\agent.log -Wait`} />
            </div>
          )}
        </Panel>
      )}

      <Panel title="Агенты" icon={<Monitor className="h-4 w-4" />}
        right={
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-dim">{online} / {agents.length} в сети</span>
            {isAdmin && (
              <button className="btn-acc" onClick={() => setTokenModal(true)}>
                <Plus className="h-4 w-4" /> Создать токен агента
              </button>
            )}
          </div>
        }
        bodyClass="p-4">
        {agents.length === 0 ? (
          <EmptyState title="Агентов пока нет"
            text={apiMode === 'server' ? 'Создайте токен и запустите одну команду на Windows-машине — агент появится здесь с живой телеметрией.' : 'Агенты подключаются к серверному ядру. Разверните сервер — страница «Развёртывание».'}
            action={isAdmin && apiMode === 'server' ? (
              <button className="btn-acc" onClick={() => setTokenModal(true)}><Plus className="h-4 w-4" /> Создать токен агента</button>
            ) : undefined} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {agents.map((a) => (
              <AgentCard key={a.id} a={a} onOpen={() => setDrawerId(a.id)} />
            ))}
          </div>
        )}
      </Panel>

      <Drawer open={!!drawerAgent} onClose={() => setDrawerId(null)}
        title={drawerAgent ? (
          <div className="flex items-center gap-2.5">
            <StatusDot status={drawerAgent.online ? 'up' : 'down'} />
            <div>
              <div className="font-display text-[14px] font-bold text-ink">{drawerAgent.name}</div>
              <div className="font-mono text-[11px] text-dim">{drawerAgent.hostname || drawerAgent.ip || '—'}</div>
            </div>
          </div>
        ) : null}>
        {drawerAgent && (
          <AgentDetails a={drawerAgent} isAdmin={!!isAdmin} onEdit={() => setEditAgent(drawerAgent)} onDelete={() => setConfirmDel(drawerAgent.id)} />
        )}
      </Drawer>

      <NewTokenModal open={tokenModal} onClose={() => setTokenModal(false)} onCreate={createToken} />
      <TokenModal info={tokenInfo} onClose={() => setTokenInfo(null)} />
      <EditAgentModal agent={editAgent} onClose={() => setEditAgent(null)} />

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Удалить агента?" width="max-w-sm">
        <p className="text-[13px] text-mut">Агент будет удалён из реестра. Его токен перестанет работать.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Отмена</button>
          <button className="btn-danger" onClick={() => { if (confirmDel) { store.removeAgent(confirmDel); setConfirmDel(null); setDrawerId(null); } }}>Удалить</button>
        </div>
      </Modal>
    </div>
  );
}

// ─── Карточка агента ────────────────────────────────────────────────────────

function AgentCard({ a, onOpen }: { a: Agent; onOpen: () => void }) {
  return (
    <div className="group cursor-pointer rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-vio/40" onClick={onOpen}>
      <div className="flex items-center gap-2">
        <StatusDot status={a.online ? 'up' : 'down'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-ink">{a.name}</div>
          <div className="truncate font-mono text-[10.5px] text-dim">{a.hostname || a.ip || 'нет данных'}</div>
        </div>
        {a.favorite && <Star className="h-3.5 w-3.5 fill-warn text-warn" strokeWidth={1.5} />}
      </div>

      <div className="mt-3 flex items-center gap-4">
        <Ring value={a.online ? a.cpuLoad : 0} size={56} label="ЦП" color={a.cpuLoad > 85 ? '#e07a80' : '#8f7df0'} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="mb-1 flex justify-between font-mono text-[10px] text-dim"><span>ОЗУ</span><span className="text-mut">{a.online ? `${pct(a.ramUsed, a.ramTotal)}%` : '—'}</span></div>
            <Bar value={a.online ? pct(a.ramUsed, a.ramTotal) : 0} color="#7ba4e6" />
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] text-dim">
            <span className="flex items-center gap-1 text-warn"><Thermometer className="h-3 w-3" />{a.online ? `${Math.round(a.cpuTemp)}°C` : '—'}</span>
            <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" />{a.disks.length} диск(ов)</span>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between font-mono text-[10px] text-dim">
        <span>{a.ip || '—'}</span>
        <span className={a.online ? 'text-ok' : 'text-crit'}>{a.online ? 'в сети' : 'офлайн'}</span>
      </div>
    </div>
  );
}

// ─── Детали агента ──────────────────────────────────────────────────────────

function AgentDetails({ a, isAdmin, onEdit, onDelete }: { a: Agent; isAdmin: boolean; onEdit: () => void; onDelete: () => void }) {
  const cpuHist = a.history.map((h) => h.cpu);
  const ramHist = a.history.map((h) => h.ram);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col items-center rounded-lg border border-line bg-raised/50 p-3">
          <Ring value={a.online ? a.cpuLoad : 0} size={64} label="ЦП" color={a.cpuLoad > 85 ? '#e07a80' : '#8f7df0'} />
          <div className="mt-1.5 font-mono text-[10px] text-dim">{a.cpuCores} ядер · {Math.round(a.cpuTemp)}°C</div>
        </div>
        <div className="flex flex-col items-center rounded-lg border border-line bg-raised/50 p-3">
          <Ring value={a.online ? pct(a.ramUsed, a.ramTotal) : 0} size={64} label="ОЗУ" color="#7ba4e6" />
          <div className="mt-1.5 font-mono text-[10px] text-dim">{fmtGb(a.ramUsed)} / {fmtGb(a.ramTotal)}</div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-line bg-raised/50 p-3 text-center">
          <Network className="h-5 w-5 text-blu" />
          <div className="mt-1 font-mono text-[12px] font-bold text-ink">{Math.round(a.rxRate)} КБ/с</div>
          <div className="font-mono text-[10px] text-dim">RX · TX {Math.round(a.txRate)} КБ/с</div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-dim">Загрузка ЦП</div>
        <AreaChart values={cpuHist} height={80} color="#8f7df0" unit="%" max={100} />
      </div>
      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-dim">Загрузка ОЗУ</div>
        <AreaChart values={ramHist} height={80} color="#7ba4e6" unit="%" max={100} />
      </div>

      {a.disks.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-dim">Диски</div>
          <div className="space-y-2">
            {a.disks.map((d, i) => (
              <div key={i} className="rounded-lg border border-line bg-raised/50 p-2.5">
                <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
                  <span className="flex items-center gap-1.5 text-mut"><HardDrive className="h-3.5 w-3.5 text-dim" />{d.label}</span>
                  <span className="text-dim">{fmtGb(d.used)} / {fmtGb(d.total)}</span>
                </div>
                <Bar value={pct(d.used, d.total)} color="#5fc6d8" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-dim">Локальные сети (ARP-скан)</div>
        {a.networks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-raised/40 px-3 py-3 text-center font-mono text-[11px] text-dim">
            {a.online ? 'скан выполняется…' : 'агент офлайн'}
          </p>
        ) : (
          <div className="space-y-2">
            {a.networks.map((n, i) => (
              <div key={i} className="rounded-lg border border-line bg-raised/50 p-2.5">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-ink">{n.cidr}</span>
                  <span className="text-dim">{n.iface} · {n.hosts.filter((h) => h.online).length} хост(ов)</span>
                </div>
                {n.hosts.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {n.hosts.slice(0, 12).map((h, j) => (
                      <span key={j} className={cls('rounded px-1.5 py-px font-mono text-[9.5px]', h.online ? 'bg-ok/10 text-ok' : 'bg-raised text-dim')}>{h.ip}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5 font-mono text-[11.5px] text-mut">
        <div className="flex justify-between"><span className="text-dim">Версия агента</span><span>{a.version || '—'}</span></div>
        <div className="flex justify-between"><span className="text-dim">ОС</span><span>{a.os || '—'}</span></div>
        <div className="flex justify-between"><span className="text-dim">Последний контакт</span><TimeAgo ts={a.lastSeen} /></div>
      </div>

      {isAdmin && (
        <div className="flex gap-2 pt-2">
          <button className="btn-ghost flex-1" onClick={onEdit}><Pencil className="h-4 w-4" /> Изменить</button>
          <button className="btn-danger" onClick={onDelete}><Trash2 className="h-4 w-4" /> Удалить</button>
        </div>
      )}
    </div>
  );
}

// ─── Модалка: имя нового агента ─────────────────────────────────────────────

function NewTokenModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) setName('');
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Новый агент" width="max-w-md">
      <Field label="Название агента" hint="Понятное имя для списка: «Сервер 1С», «Касса №2», «Офис — маршрутизатор».">
        <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Сервер 1С" autoFocus />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn-acc" onClick={() => onCreate(name.trim() || 'agent-' + Date.now().toString(36).slice(-4))}>
          <KeyRound className="h-4 w-4" /> Создать токен
        </button>
      </div>
    </Modal>
  );
}

// ─── Модалка: токен и команда установки ─────────────────────────────────────

function TokenModal({ info, onClose }: { info: { name: string; token: string } | null; onClose: () => void }) {
  const installCmd = `iwr http://${hostIp()}:8080/agent/install.ps1 -OutFile $env:TEMP\\pluto-install.ps1; & $env:TEMP\\pluto-install.ps1 -Token '${info?.token ?? '<ТОКЕН>'}'`;
  return (
    <Modal open={!!info} onClose={onClose} title={`Токен агента «${info?.name ?? ''}»`} width="max-w-2xl">
      <div className="space-y-3">
        <div className="rounded-lg border border-vio/30 bg-vio/5 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-vio">Токен подключения</div>
          <div className="mt-1 break-all font-mono text-[15px] font-bold text-ink">{info?.token}</div>
        </div>
        <p className="text-[12px] leading-relaxed text-dim">
          Вставьте одну строку в <b className="text-mut">PowerShell (от имени администратора)</b> на Windows-машине.
          Установщик сам скомпилирует агент и поставит его службой — ничего устанавливать заранее не нужно.
        </p>
        <CopyBlock label="powershell · одна строка, токен уже подставлен" code={installCmd} />
        <p className="text-[11px] leading-relaxed text-dim">
          Токен — это ключ доступа. Храните его как пароль: любой, у кого он есть, сможет подключить машину к вашему ядру.
        </p>
        <div className="flex justify-end">
          <button className="btn-acc" onClick={onClose}>Готово</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Модалка: редактирование агента ─────────────────────────────────────────

function EditAgentModal({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (agent) setName(agent.name);
  }, [agent]);
  return (
    <Modal open={!!agent} onClose={onClose} title="Изменить агента" width="max-w-md">
      <Field label="Название агента">
        <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn-acc" onClick={() => {
          if (agent && name.trim()) {
            store.updateAgent(agent.id, { name: name.trim() });
            useToasts.push('ok', 'Агент переименован');
          }
          onClose();
        }}>Сохранить</button>
      </div>
    </Modal>
  );
}
