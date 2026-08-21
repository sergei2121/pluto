// ─── PLUTO: авторизация ──────────────────────────────────────────────────────
import { useState, type FormEvent } from 'react';
import { I, PlanetMark } from '../components/icons';
import { Starfield, ToastHost } from '../components/layout';
import { useStore } from '../lib/store';
import { cls } from '../lib/util';

const PLANET_IMG = 'https://image.qwenlm.ai/generated-images/120b83b6-62c1-434e-a8ab-680747038cb2/_result.png';

export default function Login() {
  const login = useStore((s) => s.login);
  const [l, setL] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const res = login(l, p);
    if (res) {
      setErr(res);
      setShake((x) => x + 1);
    }
  };

  return (
    <div className="relative flex h-screen overflow-hidden bg-void text-ink">
      <Starfield />

      {/* Левая колонка — форма */}
      <div className="relative z-10 flex w-full flex-col justify-center px-8 sm:px-16 lg:w-[52%] lg:px-24">
        <div className="rise flex items-center gap-4">
          <PlanetMark className="h-12 w-12 drop-shadow-[0_0_18px_rgba(143,125,240,.5)]" />
          <div>
            <div className="font-display text-[26px] font-bold tracking-[0.28em] text-ink">PLUTO</div>
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.22em] text-dim">система мониторинга инфраструктуры</div>
          </div>
        </div>

        <div key={shake} className={cls('rise mt-10 w-full max-w-sm', shake > 0 && 'shake')} style={{ animationDelay: '80ms' }}>
          <h1 className="font-display text-lg font-semibold text-ink">Вход в консоль</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
            Доступ разграничен: администратор управляет системой, наблюдатели смотрят активность разрешённых типов устройств.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Логин</span>
              <div className="flex items-center gap-2.5 rounded-lg border border-line bg-raised/70 px-3.5 py-2.5 transition-all focus-within:border-vio/60 focus-within:shadow-[0_0_0_3px_rgba(143,125,240,.12)]">
                <I n="user" className="h-4 w-4 shrink-0 text-dim" />
                <input
                  value={l}
                  onChange={(e) => { setL(e.target.value); setErr(null); }}
                  autoFocus
                  autoComplete="username"
                  className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim/70"
                  placeholder="admin"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Пароль</span>
              <div className="flex items-center gap-2.5 rounded-lg border border-line bg-raised/70 px-3.5 py-2.5 transition-all focus-within:border-vio/60 focus-within:shadow-[0_0_0_3px_rgba(143,125,240,.12)]">
                <I n="lock" className="h-4 w-4 shrink-0 text-dim" />
                <input
                  type="password"
                  value={p}
                  onChange={(e) => { setP(e.target.value); setErr(null); }}
                  autoComplete="current-password"
                  className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim/70"
                  placeholder="••••••••"
                />
              </div>
            </label>

            {err && (
              <p className="flex items-center gap-2 rounded-lg border border-crit/35 bg-crit/10 px-3.5 py-2.5 text-[12.5px] font-medium text-crit">
                <I n="alert" className="h-4 w-4 shrink-0" /> {err}
              </p>
            )}

            <button
              type="submit"
              className="group relative w-full overflow-hidden rounded-lg bg-vio-deep py-3 font-display text-[13px] font-bold uppercase tracking-[0.16em] text-ink transition-all duration-200 hover:bg-vio hover:text-void active:scale-[.99]"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                Войти в систему <I n="chevronRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </button>
          </form>

          <div className="mt-6 rounded-lg border border-vio/25 bg-vio/5 px-4 py-3">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-vio">
              <I n="shield" className="h-3.5 w-3.5" /> Первый запуск — чистая база
            </p>
            <p className="mt-1.5 font-mono text-[12px] text-mut">
              администратор: <span className="text-ink">admin</span> / <span className="text-ink">pluto</span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">Смените пароль в разделе «Настройки → Пользователи» сразу после входа.</p>
          </div>
        </div>

        <p className="rise absolute bottom-6 left-8 text-[11px] text-dim/70 sm:left-16 lg:left-24" style={{ animationDelay: '200ms' }}>
          PLUTO Core v1.4 · сервер — Ubuntu / Docker Compose · агенты — Windows
        </p>
      </div>

      {/* Правая колонка — арт */}
      <div className="relative hidden flex-1 lg:block">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${PLANET_IMG})` }} />
        <div className="absolute inset-0 bg-gradient-to-r from-void via-void/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-void/80 via-transparent to-void/30" />
        <div className="absolute bottom-10 left-10 right-10 max-w-md">
          <div className="rise space-y-3" style={{ animationDelay: '160ms' }}>
            <p className="font-display text-[22px] font-semibold leading-snug text-ink">
              Дальний рубеж вашей сети — под наблюдением
            </p>
            <div className="flex flex-wrap gap-2">
              {['ICMP ping', 'HTTP / порты', 'API-команды', 'RTSP-потоки', 'SIP OPTIONS', 'агенты Windows'].map((t) => (
                <span key={t} className="rounded-md border border-line bg-deep/70 px-2.5 py-1 font-mono text-[10.5px] font-medium tracking-wide text-mut backdrop-blur-sm">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ToastHost />
    </div>
  );
}
