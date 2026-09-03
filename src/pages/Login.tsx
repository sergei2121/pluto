// ─── PLUTO: экран входа ──────────────────────────────────────────────────────
import { useState, type FormEvent } from 'react';
import { Orbit, Shield, ChevronRight, AlertTriangle } from 'lucide-react';
import { store } from '../lib/store';
import { cls, CONSOLE_VERSION } from '../lib/util';

function Planet() {
  return (
    <svg viewBox="0 0 400 400" className="h-full w-full">
      <defs>
        <radialGradient id="pl-body" cx="38%" cy="34%" r="80%">
          <stop offset="0%" stopColor="#a99bf5" />
          <stop offset="55%" stopColor="#8f7df0" />
          <stop offset="100%" stopColor="#5d4fc0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="110" fill="url(#pl-body)" />
      <circle cx="165" cy="170" r="24" fill="#7c6be0" opacity=".65" />
      <circle cx="240" cy="235" r="16" fill="#7c6be0" opacity=".5" />
      <circle cx="205" cy="150" r="9" fill="#7c6be0" opacity=".45" />
      <g transform="rotate(-18 200 200)">
        <ellipse cx="200" cy="200" rx="180" ry="56" fill="none" stroke="#7ba4e6" strokeWidth="6" opacity=".85" />
        <ellipse cx="200" cy="200" rx="180" ry="56" fill="none" stroke="#5fc6d8" strokeWidth="1.5" opacity=".5" />
      </g>
      <circle cx="76" cy="172" r="12" fill="#7ba4e6" />
      <circle cx="76" cy="172" r="20" fill="#7ba4e6" opacity=".25" />
    </svg>
  );
}

export default function Login() {
  const [l, setL] = useState('');
  const [p, setP] = useState('');
  const [code, setCode] = useState('');
  const [need2FA, setNeed2FA] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const res = await store.login(l, p, code.trim() || undefined);
    setBusy(false);
    if (res === '2FA') { setNeed2FA(true); setErr(null); return; }
    if (res) { setErr(res); setShake((x) => x + 1); }
  };

  return (
    <div className="relative flex h-screen overflow-hidden bg-void text-ink">
      <div className="pointer-events-none absolute inset-0"><div className="nebula absolute inset-0" /><div className="stars absolute inset-0" /><div className="stars stars-2 absolute inset-0" /></div>

      <div className="relative hidden flex-1 items-center justify-center lg:flex">
        <div className="rise h-[420px] w-[420px] opacity-90"><Planet /></div>
      </div>

      <div className="relative z-10 flex w-full items-center justify-center p-6 lg:w-[480px] lg:border-l lg:border-line lg:bg-deep/60 lg:backdrop-blur-sm">
        <div key={shake} className={cls('rise w-full max-w-[360px]', shake > 0 && 'animate-[shake_.35s_ease-in-out]')}>
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Orbit className="h-9 w-9 text-vio" />
            <span className="font-display text-[20px] font-bold tracking-[0.22em]">PLUTO</span>
          </div>

          <h1 className="font-display text-[26px] font-bold leading-tight">Вход в центр мониторинга</h1>
          <p className="mt-1.5 text-[13px] text-dim">Устройства, relay-агенты, телеметрия Glances и публичная витрина.</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Логин</span>
              <input className="inp" value={l} onChange={(e) => { setL(e.target.value); setErr(null); }} autoFocus autoComplete="username" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Пароль</span>
              <input className="inp" type="password" value={p} onChange={(e) => { setP(e.target.value); setErr(null); }} autoComplete="current-password" />
            </label>

            {need2FA && (
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-vio">
                  <Shield className="h-3.5 w-3.5" /> Код двухфакторной аутентификации
                </span>
                <input className="inp font-mono tracking-[0.3em]" value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} placeholder="000000" inputMode="numeric" autoFocus />
              </label>
            )}

            {err && (
              <p className="flex items-center gap-2 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">
                <AlertTriangle className="h-4 w-4 shrink-0" />{err}
              </p>
            )}

            <button type="submit" disabled={busy} className="group relative w-full overflow-hidden rounded-lg border border-vio/50 bg-vio/20 py-2.5 font-display text-[14px] font-bold text-ink transition-all hover:border-vio hover:bg-vio/30 disabled:opacity-60">
              <span className="relative z-10 flex items-center justify-center gap-2">
                {busy ? 'Проверка…' : need2FA ? 'Подтвердить код' : 'Войти в систему'}
                {!busy && <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
              </span>
            </button>
          </form>

          <div className="mt-6 rounded-lg border border-vio/25 bg-vio/5 px-4 py-3">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-vio">
              <Shield className="h-3.5 w-3.5" /> Первый запуск — чистая база
            </p>
            <p className="mt-1.5 font-mono text-[12px] text-mut">
              администратор: <span className="text-ink">admin</span> / <span className="text-ink">pluto</span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">Смените пароль в «Настройки → Пользователи» сразу после входа.</p>
          </div>

          <p className="mt-5 text-center font-mono text-[10.5px] text-dim">PLUTO Core v{CONSOLE_VERSION}</p>
        </div>
      </div>
    </div>
  );
}
