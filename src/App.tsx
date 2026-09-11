import { useEffect, useState } from 'react';
import { Orbit } from 'lucide-react';
import { getState, store, useCurrentUser, usePluto } from './lib/store';
import { detectApi, getApiToken, restoreServerSession, syncAll } from './lib/api';
import { Shell } from './components/layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Agents from './pages/Agents';
import AgentPings from './pages/AgentPings';
import Stats from './pages/Stats';
import NetworkMap from './pages/NetworkMap';
import Sla from './pages/Sla';
import SettingsPage from './pages/Settings';
import Deploy from './pages/Deploy';

export default function App() {
  const hasSession = usePluto((s) => !!s.session);
  const apiMode = usePluto((s) => s.apiMode);
  const route = usePluto((s) => s.route);
  const user = useCurrentUser();
  const [booting, setBooting] = useState(true);

  // Проверка доступности серверного ядра
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      const r = await detectApi();
      if (!alive) return;
      if (r.ver) {
        store.setCoreVersion(r.ver, r.diag || null);
        if (!getState().session) {
          await restoreServerSession();
        } else {
          void syncAll();
        }
      } else {
        store.setCoreVersion(null, r.diag);
      }
      if (alive) setBooting(false);
    };
    void probe();
    const t = window.setInterval(() => {
      if (apiMode !== 'server') void probe();
    }, 4000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  // Серверный режим: поллинг состояния ядра
  useEffect(() => {
    if (!(hasSession && apiMode === 'server')) return;
    const t = window.setInterval(() => void syncAll(), 4000);
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

  if (!hasSession || !user) return <Login />;

  // контроль доступа по ролям:
  //  admin — всё; settings — только admin; viewer — только разрешённые пункты меню
  let page = route;
  if (user.role !== 'admin' && (page === 'settings')) page = 'dashboard';
  else if (user.role !== 'admin' && !user.menuScope.includes(page)) page = 'dashboard';

  return (
    <Shell>
      {page === 'dashboard' && <Dashboard />}
      {page === 'devices' && <Devices key={`dev-${user.id}`} />}
      {page === 'agents' && <Agents key={`ag-${user.id}`} />}
      {page === 'agent-pings' && <AgentPings key={`ap-${user.id}`} />}
      {page === 'network-map' && <NetworkMap key={`netmap-${user.id}`} />}
      {page === 'stats-bars' && <Stats key="stats-bars" mode="bars" />}
      {page === 'stats-ws' && <Stats key="stats-ws" mode="ws" />}
      {page === 'sla' && <Sla key={`sla-${user.id}`} />}
      {page === 'settings' && <SettingsPage />}
      {page === 'deploy' && <Deploy />}
    </Shell>
  );
}
