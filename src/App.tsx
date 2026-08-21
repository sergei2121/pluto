// ─── PLUTO: корень приложения ────────────────────────────────────────────────
import { useEffect } from 'react';
import { useStore, useCurrentUser } from './lib/store';
import { startEngine, stopEngine } from './lib/engine';
import { Shell } from './components/layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Agents from './pages/Agents';
import SettingsPage from './pages/Settings';
import Deploy from './pages/Deploy';

export default function App() {
  const hasSession = useStore((s) => !!s.session);
  const route = useStore((s) => s.route);
  const user = useCurrentUser();

  useEffect(() => {
    if (hasSession) startEngine();
    else stopEngine();
    return () => {
      stopEngine();
    };
  }, [hasSession]);

  if (!hasSession || !user) {
    return (
      <>
        <Login />
      </>
    );
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
