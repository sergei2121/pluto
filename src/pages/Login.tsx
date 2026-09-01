// ─── PLUTO: экран входа ──────────────────────────────────────────────────────
import { useState, type FormEvent } from 'react';
import { Orbit, LogIn } from 'lucide-react';
import { Starfield } from '../components/layout';
import { store, usePluto, useToasts } from '../lib/store';
import { api, setApiToken } from '../lib/api';
import { cls, CONSOLE_VERSION } from '../lib/util';

export default function Login() {
  const apiMode = usePluto((s) => s.apiMode);
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (apiMode === 'server') {
      setBusy(true);
      try {
        const r = await api.login(login.trim(), pass);
        setApiToken(r.token);
        store.enterServer(r.user);
        useToasts.push('ok', `Добро пожаловать, ${r.user.name}`);
      } catch (ex) {
        setErr(ex instanceof Error ? ex.message : 'Не удалось войти');
      } finally {
        setBusy(false);
      }
      return;
    }
    const res = store.login(login, pass);
    if (res) setErr(res);
    else useToasts.push('ok', 'Вход выполнен (встроенный режим)');
  };

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-void p-6">
      <Starfield />

      <div className="pointer-events-none absolute -right-40 top-1/2 hidden -translate-y-1/2 lg:block" aria-hidden>
        <svg width="620" height="620" viewBox="0 0 620 620" className="drop-shadow-[0_0_80px_rgba(143,125,240,.25)]">
          <defs>
            <radialGradient id="pl-surf" cx="38%" cy="34%" r="75%">
              <stop offset="0%" stopColor="#b9aef5" />
              <stop offset="45%" stopColor="#8f7df0" />
              <stop offset="100%" stopColor="#3c3470" />
            </radialGradient>
            <radialGradient id="pl-shadow" cx="70%" cy="60%" r="70%">
              <stop offset="55%" stopColor="rgba(7,10,22,0)" />
              <stop offset="100%" stopColor="rgba(7,10,22,.85)" />
            </radialGradient>
          </defs>
          <circle cx="310" cy="310" r="215" fill="url(#pl-surf)" />
          <circle cx="245" cy="250" r="34" fill="#7668d8" opacity=".5" />
          <circle cx="360" cy="380" r="22" fill="#7668d8" opacity=".4" />
          <circle cx="310" cy="310" r="215" fill="url(#pl-shadow)" />
          <ellipse cx="310" cy="310" rx="300" ry="86" fill="none" stroke="#7ba4e6" strokeWidth="2.5" opacity=".55" transform="rotate(-16 310 310)" />
        </svg>
      </div>

      <div className="rise relative z-10 w-full max-w-[400px]">
        <div className="mb-7 flex items-center gap-3.5">
          <span className="text-vio drop-shadow-[0_0_16px_rgba(143,125,240,.5)]">
            <Orbit className="h-11 w-11" strokeWidth={1.5} />
          </span>
          <div>
            <div className="font-display text-[26px] font-bold leading-none tracking-[0.24em] text-ink">PLUTO</div>
            <div className="mt-1.5 text-[10.5px] font-medium uppercase tracking-[0.2em] text-dim">центр мониторинга инфраструктуры</div>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-xl border border-line bg-panel/90 p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,.8)]">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Логин</span>
            <input className="inp" autoFocus value={login} onChange={(e) => setLogin(e.target.value)} placeholder="admin" />
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Пароль</span>
            <input className="inp" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••" />
          </label>

          {err && (
            <p className="mt-3 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className={cls(
              'group relative mt-5 flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg border border-vio/50 bg-vio/20 py-2.5',
              'text-[13.5px] font-bold text-ink transition-all hover:border-vio hover:bg-vio/30',
              busy && 'cursor-wait opacity-60',
            )}
          >
            <LogIn className="h-4 w-4 text-vio transition-transform group-hover:translate-x-0.5" />
            {busy ? 'Проверка…' : 'Войти в систему'}
          </button>

          <div className="mt-5 rounded-lg border border-vio/25 bg-vio/5 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-vio">
              {apiMode === 'server' ? 'Ядро: серверное (Docker)' : 'Ядро: встроенное (браузер)'}
            </p>
            <p className="mt-1.5 font-mono text-[12px] text-mut">
              администратор: <span className="text-ink">admin</span> /{' '}
              <span className="text-ink">{apiMode === 'server' ? 'пароль из .env' : 'pluto'}</span>
            </p>
          </div>
        </form>

        <p className="mt-5 text-center font-mono text-[10.5px] text-dim">
          PLUTO Core v{CONSOLE_VERSION} · сервер — Ubuntu / Docker · relay — на ваших ПК
        </p>
      </div>
    </div>
  );
}
