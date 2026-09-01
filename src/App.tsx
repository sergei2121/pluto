// ─── PLUTO: корень приложения ────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Orbit } from 'lucide-react';
import { getState, restoreServerSession, store, useCurrentUser, usePluto } from './lib/store';
import { detectApi, syncAll } from './lib/api';
import { startEngine, stopEngine } from './lib/engine';
import { Shell } from './components/layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Agents from './pages/Agents';
import Showcase from './pages/Showcase';
import SettingsPage from './pages/Settings';
import Deploy from './pages/Deploy';

export default function App() {
  const hasSession = usePluto((s) => !!s.session);
  const apiMode = usePluto((s) => s.apiMode);
  const route = usePluto((s) => s.route);
  const user = useCurrentUser();
  const [booting, setBooting] = useState(true);

  // Определение режима: серверное ядро рядом?
  useEffect(() => {
    let alive = true;
    const probe = async (first: boolean) => {
      const ver = await detectApi();
      if (!alive) return;
      if (ver) {
        store.setCoreVersion(ver);
        if (!getState().session && !(await restoreServerSession())) {
          /* покажем экран входа */
        } else if (getState().apiMode === 'server') {
          void syncAll();
        }
      }
      if (first && alive) setBooting(false);
    };
    void probe(true);
    const t = window.setInterval(() => {
      if (!getState().session) void probe(false);
    }, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // Встроенный движок — только когда нет серверного ядра
  useEffect(() => {
    if (hasSession && apiMode === 'embedded') startEngine();
    else stopEngine();
    return () => stopEngine();
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
          <Orbit className="h-12 w-12 animate-pulse text-vio drop-shadow-[0_0_18px_rgba(143,125,240,.5)]" />
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
  if (user.role !== 'admin' && (page === 'settings' || page === 'showcase')) page = 'dashboard';
  if (user.role !== 'admin' && page === 'agents' && !user.scope.includes('agent' as never)) page = 'dashboard';

  return (
    <Shell>
      {page === 'dashboard' && <Dashboard />}
      {page === 'devices' && <Devices key={`dev-${user.id}`} />}
      {page === 'agents' && <Agents key={`ag-${user.id}`} />}
      {page === 'showcase' && <Showcase />}
      {page === 'settings' && <SettingsPage />}
      {page === 'deploy' && <Deploy />}
    </Shell>
  );
}
