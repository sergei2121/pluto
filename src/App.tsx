// ─── PLUTO: корень приложения ────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { useStore, useCurrentUser, useToasts } from './lib/store';
import { startEngine, stopEngine } from './lib/engine';
import { detectApi, apiMe, getApiToken, setApiToken, syncAll } from './lib/api';
import { Shell } from './components/layout';
import { PlanetMark } from './components/icons';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Agents from './pages/Agents';
import SettingsPage from './pages/Settings';
import Deploy from './pages/Deploy';

export default function App() {
  const hasSession = useStore((s) => !!s.session);
  const apiMode = useStore((s) => s.apiMode);
  const route = useStore((s) => s.route);
  const user = useCurrentUser();
  const [booting, setBooting] = useState(true);

  // Определение режима: есть ли серверное ядро рядом (/api/health)?
  // Пробуем при старте, затем фоном каждые 5 с и при возврате на вкладку —
  // даже при активной сессии, чтобы появление ядра не осталось незамеченным.
  useEffect(() => {
    let alive = true;

    const probe = async (first: boolean) => {
      const ver = await detectApi();
      if (!alive) return;
      const s = useStore.getState();
      if (ver) {
        if (s.coreVersion !== ver) useStore.setState({ coreVersion: ver });
        if (getApiToken()) {
          // токен есть: добираемся до серверной сессии
          if (s.apiMode !== 'server') {
            try {
              const me = await apiMe();
              useStore.getState().enterServer(me);
              void syncAll();
            } catch {
              setApiToken(null); // токен протух — покажем вход
            }
          }
        } else if (s.apiMode === 'embedded' && s.session) {
          // Ядро появилось, а пользователь сидит во встроенной (эмуляционной)
          // сессии: завершаем её и просим войти уже в серверное ядро.
          useStore.getState().logout();
          useToasts.getState().push('info', 'Обнаружено серверное ядро — войдите, чтобы видеть реальные проверки');
        }
      } else if (s.coreVersion !== null) {
        useStore.setState({ coreVersion: null });
      }
      if (first) setBooting(false);
    };

    void probe(true);
    const t = window.setInterval(() => void probe(false), 5000);
    const vis = () => {
      if (document.visibilityState === 'visible') void probe(false);
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      alive = false;
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  // Встроенный движок — только когда нет серверного ядра
  useEffect(() => {
    if (hasSession && apiMode === 'embedded') startEngine();
    else stopEngine();
    return () => {
      stopEngine();
    };
  }, [hasSession, apiMode]);

  // Серверный режим: поллинг состояния ядра
  useEffect(() => {
    if (!(hasSession && apiMode === 'server')) return;
    const t = window.setInterval(() => void syncAll(), 2500);
    return () => window.clearInterval(t);
  }, [hasSession, apiMode]);

  if (booting) {
    return (
      <div className="flex h-screen items-center justify-center bg-void">
        <div className="rise flex flex-col items-center gap-4">
          <PlanetMark className="h-12 w-12 animate-pulse drop-shadow-[0_0_18px_rgba(143,125,240,.5)]" />
          <p className="font-mono text-[11.5px] uppercase tracking-[0.2em] text-dim">подключение к ядру…</p>
        </div>
      </div>
    );
  }

  if (!hasSession || !user) {
    return <Login />;
  }

  // контроль доступа по ролям
  let page = route;
  if (user.role !== 'admin' && page === 'settings') page = 'dashboard';
  if (user.role !== 'admin' && page === 'agents' && !user.scope.includes('agent')) page = 'dashboard';

  return (
    <Shell>
      {page === 'dashboard' && <Dashboard />}
      {page === 'devices' && <Devices key={`dev-${user.id}`} />}
      {page === 'agents' && <Agents key={`ag-${user.id}`} />}
      {page === 'settings' && <SettingsPage />}
      {page === 'deploy' && <Deploy />}
    </Shell>
  );
}
