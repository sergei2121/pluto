// ─── PLUTO: экран входа ─────────────────────────────────────────────────────
import { useState, type FormEvent } from 'react';
import { LogIn, Shield, ChevronRight } from 'lucide-react';
import { store, usePluto } from '../lib/store';
import { cls, CONSOLE_VERSION } from '../lib/util';
import { PlanetMark, Starfield } from '../components/layout';

export default function Login() {
  const apiMode = usePluto((s) => s.apiMode);
  const coreVersion = usePluto((s) => s.coreVersion);
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

  const server = apiMode === 'server';

  return (
    <div className="relative flex h-screen overflow-hidden bg-void">
      <Starfield />

      {/* Арт: планета */}
      <div className="relative hidden flex-1 items-center justify-center lg:flex">
        <div className="rise relative">
          <div className="absolute inset-0 -m-16 rounded-full bg-vio/10 blur-3xl" />
          <PlanetMark className="relative h-64 w-64 animate-[spin_90s_linear_infinite] drop-shadow-[0_0_60px_rgba(143,125,240,.35)]" />
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-center">
            <div className="font-display text-3xl font-bold tracking-[0.4em] text-ink">PLUTO</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.3em] text-dim">центр мониторинга инфраструктуры</div>
          </div>
        </div>
      </div>

      {/* Форма */}
      <div className="relative z-10 flex w-full items-center justify-center p-6 lg:w-[480px] lg:border-l lg:border-line lg:bg-deep/80">
        <div key={shake} className={cls('w-full max-w-sm', shake > 0 && 'shake')}>
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <PlanetMark className="h-10 w-10" />
            <div className="font-display text-xl font-bold tracking-[0.25em] text-ink">PLUTO</div>
          </div>

          <h1 className="font-display text-2xl font-bold text-ink">Вход в систему</h1>
          <p className="mt-1.5 text-[13px] text-dim">Авторизуйтесь, чтобы открыть консоль мониторинга.</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Логин</span>
              <input value={l} onChange={(e) => { setL(e.target.value); setErr(null); }} autoFocus
                className="inp" placeholder="admin" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Пароль</span>
              <input type="password" value={p} onChange={(e) => { setP(e.target.value); setErr(null); }}
                className="inp" placeholder="••••••••" />
            </label>

            {err && (
              <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[12.5px] text-crit">{err}</p>
            )}

            <button type="submit" disabled={busy}
              className="group relative flex w-full items-center justify-center overflow-hidden rounded-lg bg-vio px-4 py-2.5 font-display text-[13.5px] font-bold text-[#12101f] transition-all duration-200 hover:bg-vio/90 hover:shadow-[0_0_24px_rgba(143,125,240,.4)] disabled:opacity-60">
              <span className="flex items-center gap-2">
                {busy ? 'Подключение к ядру…' : 'Войти в систему'}
                <LogIn className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          </form>

          <div className="mt-6 rounded-lg border border-vio/25 bg-vio/5 px-4 py-3">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-vio">
              <Shield className="h-3.5 w-3.5" />
              {server ? 'Ядро: серверное (Docker)' : 'Ядро: встроенное (браузер)'}
            </p>
            <p className="mt-1.5 font-mono text-[12px] text-mut">
              администратор: <span className="text-ink">admin</span> /{' '}
              <span className="text-ink">{server ? 'пароль из .env' : 'pluto'}</span>
              {server && coreVersion ? <span className="ml-2 text-dim">· v{coreVersion}</span> : null}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">
              {server
                ? 'Проверки (ping, HTTP, RTSP, SIP) и телеметрию агентов выполняет серверное ядро — данные реальные.'
                : 'Серверное ядро не обнаружено: работает встроенный движок. Разверните сервер — страница «Развёртывание».'}
            </p>
          </div>

          <p className="mt-5 text-center font-mono text-[10.5px] text-dim">
            PLUTO Core v{CONSOLE_VERSION} · сервер — Ubuntu / Docker Compose · агенты — Windows
          </p>
        </div>
      </div>
      <span className="hidden"><ChevronRight className="h-3 w-3" /></span>
    </div>
  );
}
