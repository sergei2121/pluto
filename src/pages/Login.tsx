// ─── PLUTO: экран входа ─────────────────────────────────────────────────────
import { useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Starfield, ToastHost } from '../components/layout';
import { usePluto } from '../lib/store';
import { cls, CONSOLE_VERSION } from '../lib/util';

function PlanetScene() {
  return (
    <svg viewBox="0 0 400 500" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="body" cx="32%" cy="26%" r="85%">
          <stop offset="0%" stopColor="#cfc3ff" />
          <stop offset="40%" stopColor="#8f7df0" />
          <stop offset="78%" stopColor="#574aa8" />
          <stop offset="100%" stopColor="#322a66" />
        </radialGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8f7df0" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#8f7df0" stopOpacity="0" />
        </radialGradient>
        <clipPath id="clip"><circle cx="200" cy="230" r="120" /></clipPath>
      </defs>

      {[
        [40, 60, 1.4], [340, 90, 1], [300, 40, 1.8], [70, 420, 1.2], [360, 380, 1.5],
        [20, 250, 1], [380, 220, 1.2], [120, 30, 1], [250, 470, 1.4], [330, 300, 1],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#e7eaf9" opacity={0.25 + (i % 3) * 0.18} />
      ))}

      <circle cx="200" cy="230" r="170" fill="url(#glow)" />
      <circle cx="200" cy="230" r="120" fill="url(#body)" />

      <g clipPath="url(#clip)" opacity="0.5">
        <ellipse cx="160" cy="190" rx="30" ry="16" fill="#6f5fd0" />
        <ellipse cx="250" cy="260" rx="40" ry="20" fill="#4a3f8f" />
        <ellipse cx="180" cy="300" rx="24" ry="12" fill="#6f5fd0" />
        <circle cx="230" cy="170" r="10" fill="#b7a9ff" opacity="0.5" />
      </g>

      <ellipse cx="200" cy="230" rx="185" ry="52" fill="none" stroke="#7ba4e6" strokeWidth="3" opacity="0.7" transform="rotate(-16 200 230)" />
      <ellipse cx="200" cy="230" rx="185" ry="52" fill="none" stroke="#5fc6d8" strokeWidth="1.2" opacity="0.5" transform="rotate(-16 200 230)" />

      <circle cx="200" cy="230" r="120" fill="none" stroke="#c9bfff" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

export default function Login() {
  const login = usePluto((s) => s.login);
  const loginServer = usePluto((s) => s.loginServer);
  const apiMode = usePluto((s) => s.apiMode);
  const coreVersion = usePluto((s) => s.coreVersion);
  const serverAvailable = apiMode === 'server' || coreVersion !== null;

  const [l, setL] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const res = apiMode === 'server' ? await loginServer(l, p) : login(l, p);
    setBusy(false);
    if (res) {
      setErr(res);
      setShake((x) => x + 1);
    }
  };

  return (
    <div className="relative flex h-screen overflow-hidden bg-void text-ink">
      <Starfield />

      <div className="relative z-10 grid h-full w-full lg:grid-cols-[minmax(420px,42%)_1fr]">
        {/* Левая колонка — форма */}
        <div className="flex h-full items-center overflow-y-auto px-8 py-10 scroll-thin sm:px-16 lg:px-24">
          <div key={shake} className={cls('w-full max-w-sm', shake > 0 && 'shake')}>
            <div className="rise flex items-center gap-3">
              <svg viewBox="0 0 48 48" className="h-10 w-10 drop-shadow-[0_0_14px_rgba(143,125,240,.5)]" fill="none">
                <circle cx="24" cy="24" r="14" fill="#8f7df0" />
                <ellipse cx="24" cy="24" rx="21" ry="7" stroke="#7ba4e6" strokeWidth="1.6" opacity="0.8" transform="rotate(-18 24 24)" />
              </svg>
              <div>
                <div className="font-display text-2xl font-bold tracking-[0.24em]">PLUTO</div>
                <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-dim">центр мониторинга</div>
              </div>
            </div>

            <h1 className="rise font-display mt-10 text-[22px] font-semibold leading-snug" style={{ animationDelay: '60ms' }}>
              Вход в консоль
            </h1>
            <p className="rise mt-1.5 text-[13px] text-dim" style={{ animationDelay: '100ms' }}>
              Мониторинг серверов, сети и Windows-агентов
            </p>

            <form onSubmit={submit} className="rise mt-8 space-y-4" style={{ animationDelay: '140ms' }}>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Логин</label>
                <input className="inp" value={l} onChange={(e) => { setL(e.target.value); setErr(null); }} autoFocus autoComplete="username" />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Пароль</label>
                <input className="inp" type="password" value={p} onChange={(e) => { setP(e.target.value); setErr(null); }} autoComplete="current-password" />
              </div>

              {err && (
                <div className="pop flex items-center gap-2 rounded-lg border border-crit/40 bg-crit/10 px-3.5 py-2.5 text-[12.5px] text-crit">
                  {err}
                </div>
              )}

              <button type="submit" disabled={busy} className="btn-acc group w-full justify-center py-2.5 disabled:opacity-60">
                <span className="flex items-center justify-center gap-2">
                  {busy ? 'Подключение к ядру…' : 'Войти в систему'}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            </form>

            <div className="rise mt-6 rounded-lg border border-vio/25 bg-vio/5 px-4 py-3" style={{ animationDelay: '180ms' }}>
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-vio">
                <ShieldCheck className="h-3.5 w-3.5" />
                {apiMode === 'server'
                  ? coreVersion === 'legacy'
                    ? 'Ядро: серверное · старая сборка'
                    : `Ядро: серверное · v${coreVersion}`
                  : 'Ядро: встроенное (браузер)'}
              </p>
              <p className="mt-1.5 font-mono text-[12px] text-mut">
                администратор: <span className="text-ink">admin</span> /{' '}
                <span className="text-ink">{serverAvailable ? 'пароль из .env' : 'pluto'}</span>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-dim">
                {apiMode === 'server'
                  ? 'Проверки (ping, HTTP, RTSP, SIP) и телеметрию агентов выполняет серверное ядро — данные реальные.'
                  : 'Серверное ядро не обнаружено: работает встроенный движок (эмуляция). Разверните сервер — см. «Развёртывание».'}
              </p>
            </div>
          </div>
        </div>

        {/* Правая колонка — арт */}
        <div className="relative hidden overflow-hidden border-l border-line lg:block">
          <PlanetScene />
          <div className="absolute inset-0 bg-gradient-to-r from-void via-transparent to-transparent" />
        </div>
      </div>

      <p className="rise absolute bottom-6 left-8 z-10 text-[11px] text-dim/70 sm:left-16 lg:left-24" style={{ animationDelay: '220ms' }}>
        PLUTO Core v{CONSOLE_VERSION} · сервер — Ubuntu / Docker Compose · агенты — Windows
      </p>

      <ToastHost />
    </div>
  );
}
