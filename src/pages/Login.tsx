// ─── PLUTO: экран входа ──────────────────────────────────────────────────────
import { useState, type FormEvent } from 'react';
import { Orbit, Shield, ArrowRight } from 'lucide-react';
import { store, usePluto } from '../lib/store';
import { cls, CONSOLE_VERSION } from '../lib/util';
import { Starfield } from '../components/layout';

export default function Login() {
  const apiMode = usePluto((s) => s.apiMode);
  const [l, setL] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (apiMode === 'server') {
      setBusy(true);
      const res = await store.loginServer(l, p);
      setBusy(false);
      if (res) {
        setErr(res);
        setShake((x) => x + 1);
      }
      return;
    }
    const res = store.login(l, p);
    if (res) {
      setErr(res);
      setShake((x) => x + 1);
    }
  };

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-void p-6">
      <Starfield />

      {/* планета справа — характерный образ системы */}
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
          <circle cx="300" cy="330" r="12" fill="#a497ef" opacity=".5" />
          <circle cx="310" cy="310" r="215" fill="url(#pl-shadow)" />
          <ellipse cx="310" cy="310" rx="300" ry="86" fill="none" stroke="#7ba4e6" strokeWidth="2.5" opacity=".55" transform="rotate(-16 310 310)" />
          <ellipse cx="310" cy="310" rx="300" ry="86" fill="none" stroke="#5fc6d8" strokeWidth="1" opacity=".3" transform="rotate(-16 310 310)" />
        </svg>
      </div>

      <div key={shake} className={cls('rise relative z-10 w-full max-w-[400px]', shake > 0 && 'animate-[shakeX_.4s_ease]')}>
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
            <input
              className="inp"
              value={l}
              onChange={(e) => { setL(e.target.value); setErr(null); }}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-dim">Пароль</span>
            <input
              className="inp"
              type="password"
              value={p}
              onChange={(e) => { setP(e.target.value); setErr(null); }}
              autoComplete="current-password"
            />
          </label>

          {err && (
            <p className="pop mt-3.5 rounded-lg border border-crit/35 bg-crit/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-crit">{err}</p>
          )}

          <button
            type="submit"
            disabled={busy || !l.trim() || !p}
            className="group relative mt-5 flex w-full items-center justify-center overflow-hidden rounded-lg border border-vio/50 bg-vio/15 py-2.5 text-[13.5px] font-bold text-vio transition-all duration-200 hover:border-vio/80 hover:bg-vio/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {busy ? 'Подключение к ядру…' : 'Войти в систему'}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </button>

          <div className="mt-5 rounded-lg border border-vio/25 bg-vio/5 px-4 py-3">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-vio">
              <Shield className="h-3.5 w-3.5" />
              {apiMode === 'server' ? 'Ядро: серверное (Docker)' : 'Ядро: встроенное (браузер)'}
            </p>
            <p className="mt-1.5 font-mono text-[12px] text-mut">
              администратор: <span className="text-ink">admin</span> /{' '}
              <span className="text-ink">{apiMode === 'server' ? 'пароль из .env' : 'pluto'}</span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">
              {apiMode === 'server'
                ? 'Проверки (ping, HTTP, RTSP, SIP) и телеметрию AIDA64/Glances выполняет серверное ядро — данные реальные.'
                : 'Серверное ядро не обнаружено: работает встроенный движок с синтетическими данными.'}
            </p>
          </div>
        </form>

        <p className="mt-5 text-center font-mono text-[10.5px] tracking-wider text-dim">
          PLUTO Core v{CONSOLE_VERSION} · сервер — Ubuntu / Docker Compose
        </p>
      </div>

      <style>{`@keyframes shakeX { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-7px)} 50%{transform:translateX(6px)} 75%{transform:translateX(-3px)} }`}</style>
    </div>
  );
}
