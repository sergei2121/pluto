// ─── PLUTO: relay-агенты (пинг через ПК) ─────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Plus, Star, Trash2, RefreshCw, Monitor, Search, X, Check, Minus } from 'lucide-react';
import { Panel, StatusDot, Modal, Field, EmptyState, TimeAgo } from '../components/ui';
import { store, useCurrentUser, usePluto, useToasts, visibleAgents } from '../lib/store';
import { cls, fmtMs, fmtUp, isIp, isTarget } from '../lib/util';
import type { Agent, RelayTargetResult } from '../lib/types';

function AgentModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Agent | null }) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [targetsText, setTargetsText] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (initial) {
      setName(initial.name); setIp(initial.ip); setRelayUrl(initial.relayUrl);
      setTargetsText(initial.pingTargets.join('\n'));
    } else {
      setName(''); setIp(''); setRelayUrl(''); setTargetsText('');
    }
  }, [open, initial]);

  const save = async () => {
    setErr('');
    if (!name.trim()) return setErr('Укажите имя');
    if (!isIp(ip.trim())) return setErr('IP-адрес ПК в формате 192.168.1.10');
    const targets = targetsText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const bad = targets.find((t) => !isTarget(t));
    if (bad) return setErr(`Некорректная цель: «${bad}». Форматы: 10.0.0.5, 10.0.0.1-20, 10.0.0.0/24`);
    const body = { name: name.trim(), ip: ip.trim(), relayUrl: relayUrl.trim(), pingTargets: targets };
    try {
      if (initial) await store.updateAgent(initial.id, body);
      else await store.addAgent(body);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Изменить агента' : 'Новый relay-агент'}>
      <div className="space-y-4">
        <div className="rounded-lg border border-vio/25 bg-vio/5 px-4 py-3 text-[12px] leading-relaxed text-mut">
          <span className="font-bold text-vio">pluto-relay</span> — «кусок PLUTO», который ставится на ПК и пингует
          устройства, доступные только этой машине (NAT/VLAN). Только пинг — ничего больше.
        </div>

        <Field label="Имя">
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Офис — ПК админа" />
        </Field>

        <Field label="IP-адрес ПК" hint="Ядро пингует его, чтобы понять, на связи ли relay">
          <input className="inp font-mono" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.10" />
        </Field>

        <Field label="Адрес pluto-relay" hint="HTTP-адрес relay на этом ПК, порт по умолчанию 8091">
          <input className="inp font-mono" value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} placeholder="http://192.168.1.10:8091" />
        </Field>

        <Field label="Цели для пинга (по одной в строке)" hint="IP, диапазон 10.0.0.1-20 или подсеть 10.0.0.0/24 — устройства, доступные только этому ПК">
          <textarea className="inp font-mono" rows={5} value={targetsText} onChange={(e) => setTargetsText(e.target.value)}
            placeholder={'10.0.0.5\n10.0.0.1-20'} />
        </Field>

        {err && <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg border border-line bg-raised/50 px-4 py-2 text-[13px] font-semibold text-dim transition-colors hover:text-mut">Отмена</button>
          <button onClick={save} className="rounded-lg border border-vio/60 bg-vio/25 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/35">
            {initial ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TargetBlock({ t, online }: { t: RelayTargetResult; online: boolean }) {
  const alive = t.results.filter((r) => r.alive).length;
  return (
    <div className="rounded-lg border border-line bg-raised/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[12px] font-semibold text-ink">{t.target}</span>
        <span className={cls('font-mono text-[11px] font-bold', alive === t.results.length ? 'text-ok' : alive === 0 ? 'text-crit' : 'text-warn')}>
          {alive}/{t.results.length} живо
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {t.results.map((r) => (
          <div key={r.ip} className="flex items-center gap-1.5 rounded border border-line/60 bg-panel/60 px-2 py-1">
            {r.alive ? <Check className="h-3 w-3 shrink-0 text-ok" /> : <Minus className="h-3 w-3 shrink-0 text-crit" />}
            <span className="truncate font-mono text-[10.5px] text-mut">{r.ip}</span>
            <span className="ml-auto font-mono text-[10px] text-dim">{r.alive ? `${r.latency}мс` : '—'}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right font-mono text-[10px] text-dim">
        {online ? <TimeAgo ts={t.lastCheck} /> : 'relay офлайн — пинг не выполнялся'}
      </div>
    </div>
  );
}

function AgentCard({ a, onEdit }: { a: Agent; onEdit: (a: Agent) => void }) {
  const alive = a.targets.reduce((n, t) => n + t.results.filter((r) => r.alive).length, 0);
  const total = a.targets.reduce((n, t) => n + t.results.length, 0);
  return (
    <div className="rise rounded-xl border border-line bg-panel/90 p-4 transition-all duration-200 hover:border-vio/40">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <StatusDot status={a.online ? 'up' : 'down'} />
          <div>
            <div className="text-[14px] font-semibold text-ink">{a.name}</div>
            <div className="font-mono text-[11px] text-dim">{a.ip}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => store.toggleAgentFav(a.id)} title="В избранное"
            className={cls('rounded-md p-1.5 transition-all hover:bg-raised', a.favorite ? 'text-warn' : 'text-dim/40 hover:text-dim')}>
            <Star className={cls('h-4 w-4', a.favorite && 'fill-warn')} strokeWidth={1.5} />
          </button>
          <button onClick={() => void store.pollAgentNow(a.id)} title="Опросить сейчас"
            className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-vio">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => onEdit(a)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-dim transition-colors hover:bg-raised hover:text-ink">Изм.</button>
          <button onClick={() => { if (window.confirm(`Удалить агента «${a.name}»?`)) void store.removeAgent(a.id); }}
            className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-crit">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-line/60 bg-raised/40 px-2.5 py-2 text-center">
          <div className={cls('font-mono text-[15px] font-bold', a.online ? 'text-vio' : 'text-dim')}>{fmtMs(a.latency)}</div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-dim">пинг до ПК</div>
        </div>
        <div className="rounded-lg border border-line/60 bg-raised/40 px-2.5 py-2 text-center">
          <div className="font-mono text-[15px] font-bold text-mint">{alive}<span className="text-[10px] text-dim">/{total || '—'}</span></div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-dim">целей живо</div>
        </div>
        <div className="rounded-lg border border-line/60 bg-raised/40 px-2.5 py-2 text-center">
          <div className="font-mono text-[15px] font-bold text-blu">{a.online ? fmtUp(Date.now() - (a.onlineSince || Date.now())) : '—'}</div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-dim">в сети</div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-dim">
        <span className="truncate">{a.relayUrl || 'relay-адрес не задан'}</span>
        <span className={a.online ? 'text-ok' : 'text-crit'}>{a.online ? 'relay на связи' : 'relay офлайн'}</span>
      </div>

      {a.targets.length > 0 && (
        <div className="mt-3 space-y-2">
          {a.targets.map((t) => <TargetBlock key={t.target} t={t} online={a.online} />)}
        </div>
      )}
    </div>
  );
}

export default function Agents() {
  const user = useCurrentUser();
  const agents = usePluto((s) => visibleAgents(s, user));
  const isAdmin = user?.role === 'admin';
  const routeParam = usePluto((s) => s.routeParam);

  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ open: boolean; initial: Agent | null }>({ open: false, initial: null });

  useEffect(() => {
    if (routeParam === 'new') { setModal({ open: true, initial: null }); store.nav('agents'); }
  }, [routeParam]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter((a) => a.name.toLowerCase().includes(query) || a.ip.includes(query));
  }, [agents, q]);

  return (
    <div className="space-y-4">
      <Panel title={`Relay-агенты · ${agents.length}`} icon={<Monitor className="h-4 w-4" />}
        right={isAdmin ? (
          <button onClick={() => setModal({ open: true, initial: null })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-vio/50 bg-vio/20 px-3 py-1.5 text-[12.5px] font-bold text-ink transition-all hover:bg-vio/30">
            <Plus className="h-4 w-4" /> Добавить агента
          </button>
        ) : undefined}>
        <div className="mb-4 flex min-w-[220px] items-center gap-2 rounded-lg border border-line bg-raised/70 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени или IP…"
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-dim/80" />
          {q && <button onClick={() => setQ('')} className="text-dim hover:text-ink"><X className="h-3.5 w-3.5" /></button>}
        </div>

        {list.length === 0 ? (
          <EmptyState icon={<Monitor className="h-6 w-6" />} title={agents.length ? 'Ничего не найдено' : 'Relay-агентов пока нет'}
            text={agents.length ? 'Попробуйте другой запрос.' : 'Добавьте ПК с pluto-relay, чтобы пинговать устройства в его локальной сети (NAT/VLAN).'}
            action={isAdmin && !agents.length ? (
              <button onClick={() => setModal({ open: true, initial: null })}
                className="rounded-lg border border-vio/50 bg-vio/20 px-4 py-2 text-[13px] font-bold text-ink transition-all hover:bg-vio/30">
                Добавить агента
              </button>
            ) : undefined} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.map((a) => <AgentCard key={a.id} a={a} onEdit={(ag) => setModal({ open: true, initial: ag })} />)}
          </div>
        )}
      </Panel>

      <AgentModal open={modal.open} initial={modal.initial} onClose={() => setModal({ open: false, initial: null })} />
    </div>
  );
}
