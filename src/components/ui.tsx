// ─── PLUTO: UI-кит ───────────────────────────────────────────────────────────
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check, AlertTriangle, Bell, Activity, X, Inbox, Copy,
  Send, Tag, Users, Mail, Rocket, Monitor, Server, Star, Settings as SettingsIcon,
} from 'lucide-react';
import { cls, timeAgo } from '../lib/util';
import type { DeviceStatus } from '../lib/types';

/** Имена иконок, которые можно передавать в Panel строкой */
const PANEL_ICONS: Record<string, ReactNode> = {
  send: <Send className="h-4 w-4" />,
  alert: <AlertTriangle className="h-4 w-4" />,
  tag: <Tag className="h-4 w-4" />,
  users: <Users className="h-4 w-4" />,
  mail: <Mail className="h-4 w-4" />,
  bell: <Bell className="h-4 w-4" />,
  rocket: <Rocket className="h-4 w-4" />,
  agents: <Monitor className="h-4 w-4" />,
  server: <Server className="h-4 w-4" />,
  activity: <Activity className="h-4 w-4" />,
  star: <Star className="h-4 w-4" />,
  settings: <SettingsIcon className="h-4 w-4" />,
  inbox: <Inbox className="h-4 w-4" />,
};

export function Panel({
  title, icon, right, children, className, bodyClass, delay = 0,
}: {
  title?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode;
  className?: string; bodyClass?: string; delay?: number;
}) {
  const iconEl = typeof icon === 'string' ? PANEL_ICONS[icon] ?? null : icon;
  return (
    <section
      className={cls('rise rounded-xl border border-line bg-panel/90 shadow-[0_8px_30px_-12px_rgba(5,8,20,.8)]', className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      {title && (
        <header className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
          {iconEl && <span className="text-vio">{iconEl}</span>}
          <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-mut">{title}</h2>
          <div className="ml-auto flex items-center gap-2">{right}</div>
        </header>
      )}
      <div className={cls('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export const STATUS_META: Record<DeviceStatus, { label: string; dot: string; text: string }> = {
  up: { label: 'В сети', dot: 'bg-ok', text: 'text-ok' },
  down: { label: 'Авария', dot: 'bg-crit', text: 'text-crit' },
  degraded: { label: 'Деградация', dot: 'bg-warn', text: 'text-warn' },
  unknown: { label: 'Ожидание', dot: 'bg-dim', text: 'text-dim' },
};

export function StatusDot({ status }: { status: DeviceStatus }) {
  const m = STATUS_META[status];
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
      {status !== 'unknown' && (
        <span className={cls('absolute inline-flex h-full w-full rounded-full opacity-40 breathe', m.dot)} />
      )}
      <span className={cls('relative inline-flex h-2.5 w-2.5 rounded-full', m.dot)} />
    </span>
  );
}

export function TypeBadge({ t }: { t: string }) {
  return (
    <span className="inline-flex items-center rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-mut">
      {t.toUpperCase()}
    </span>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={cls(
        'relative h-[22px] w-10 shrink-0 rounded-full border transition-colors duration-200',
        checked ? 'border-vio/60 bg-vio-deep/80' : 'border-line bg-raised',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      aria-pressed={checked}
    >
      <span
        className={cls(
          'absolute top-[2px] h-4 w-4 rounded-full transition-all duration-200',
          checked ? 'left-[21px] bg-ink shadow-[0_0_8px_rgba(154,140,250,.7)]' : 'left-[2px] bg-dim',
        )}
      />
    </button>
  );
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#070a16]/80" onClick={onClose} />
      <div className={cls('pop relative w-full rounded-xl border border-line bg-panel shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)]', width)}>
        <header className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold tracking-wide text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[78vh] overflow-y-auto p-5 scroll-thin">{children}</div>
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <div className={cls('fixed inset-0 z-40 transition', open ? 'pointer-events-auto' : 'pointer-events-none')}>
      <div className={cls('absolute inset-0 bg-[#070a16]/70 transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
      <aside
        className={cls(
          'absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-line bg-panel shadow-[-20px_0_60px_rgba(0,0,0,.5)] transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <div className="min-w-0">{title}</div>
          <button onClick={onClose} className="ml-3 rounded-md p-1.5 text-dim transition-colors hover:bg-raised hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 scroll-thin">{children}</div>
      </aside>
    </div>
  );
}

export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-vio/10 blur-xl" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-line bg-raised text-dim">
          {icon ?? <Inbox className="h-6 w-6" />}
        </div>
      </div>
      <div>
        <p className="font-display text-sm font-semibold text-ink">{title}</p>
        {text && <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-dim">{text}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-dim/80">{hint}</span>}
    </label>
  );
}

// ─── Графики (SVG, без зависимостей) ─────────────────────────────────────────

export function Sparkbar({ data, height = 26, width = 120 }: { data: number[]; height?: number; width?: number }) {
  const view = data.slice(-30);
  if (view.length === 0) {
    return <div className="flex items-center font-mono text-[10px] text-dim/70" style={{ height }}>нет данных</div>;
  }
  const max = Math.max(...view.filter((v) => v > 0), 1);
  const bw = width / 30;
  return (
    <svg width={width} height={height} className="shrink-0">
      {view.map((v, i) => {
        const fail = v < 0;
        const h = fail ? height : Math.max(3, (v / max) * (height - 4));
        return (
          <rect key={i} x={i * bw + 0.5} y={height - h} width={Math.max(1.5, bw - 1.5)} height={h} rx={0.8}
            fill={fail ? '#e07a80' : v > max * 0.6 ? '#dfa65e' : '#8f7df0'} opacity={fail ? 0.95 : 0.85} />
        );
      })}
    </svg>
  );
}

export function AreaChart({ values, height = 90, color = '#8f7df0', unit = '', max: maxProp }: { values: number[]; height?: number; color?: string; unit?: string; max?: number }) {
  const view = values.slice(-60);
  if (view.length < 2) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-line bg-raised/40 font-mono text-[11px] text-dim" style={{ height }}>
        сбор метрик…
      </div>
    );
  }
  const w = 300;
  const max = maxProp ?? Math.max(...view, 1) * 1.15;
  const pts = view.map((v, i) => [(i / (view.length - 1)) * w, height - 6 - (Math.min(v, max) / max) * (height - 16)]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const last = view[view.length - 1];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        <defs>
          <linearGradient id={`ag-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.35" />
            <stop offset="1" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={w} y1={height * f} y2={height * f} stroke="#27304f" strokeWidth="0.6" strokeDasharray="3 5" />
        ))}
        <polygon points={`0,${height} ${line} ${w},${height}`} fill={`url(#ag-${color.replace('#', '')})`} />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
      </svg>
      <span className="absolute right-1 top-0 font-mono text-[11px] font-semibold" style={{ color }}>
        {typeof last === 'number' ? (last >= 100 ? Math.round(last) : last.toFixed(1)) : last}
        {unit}
      </span>
    </div>
  );
}

export function Ring({ value, size = 64, color = '#8f7df0', label }: { value: number; size?: number; color?: string; label?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27304f" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (v / 100) * c} className="transition-all duration-700 ease-out" />
      </svg>
      <div className="absolute text-center">
        <div className="font-mono text-[13px] font-bold leading-none text-ink">{Math.round(v)}%</div>
        {label && <div className="mt-0.5 text-[9px] uppercase tracking-wider text-dim">{label}</div>}
      </div>
    </div>
  );
}

export function Bar({ value, color = '#8f7df0', className }: { value: number; color?: string; className?: string }) {
  const v = Math.min(100, Math.max(0, value));
  const c = v > 85 ? '#e07a80' : v > 65 ? '#dfa65e' : color;
  return (
    <div className={cls('h-1.5 w-full overflow-hidden rounded-full bg-raised', className)}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${v}%`, background: c }} />
    </div>
  );
}

export function Seg<T extends string>({ options, value, onChange }: { options: { v: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-raised/70 p-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={cls('rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all duration-150', value === o.v ? 'bg-vio-deep/70 text-ink shadow-sm' : 'text-dim hover:text-mut')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* клипборд недоступен */
    }
  };
  return (
    <div className="group relative overflow-hidden rounded-lg border border-line bg-[#0b0f1f]">
      {label && <div className="border-b border-line-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-dim">{label}</div>}
      <pre className="overflow-x-auto p-3.5 font-mono text-[12px] leading-relaxed text-[#b9c2e8] scroll-thin">{code}</pre>
      <button onClick={copy}
        className={cls('absolute right-2 top-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all',
          copied ? 'border-ok/50 bg-ok/10 text-ok' : 'border-line bg-raised text-dim opacity-0 hover:text-ink group-hover:opacity-100')}>
        <Copy className="h-3 w-3" />
        {copied ? 'Готово' : 'Копия'}
      </button>
    </div>
  );
}

export function TimeAgo({ ts, className }: { ts: number; className?: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  return <span className={className}>{timeAgo(ts)}</span>;
}

export const Icon = { Check, AlertTriangle, Bell, Activity };
