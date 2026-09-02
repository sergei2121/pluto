// ─── PLUTO: топология сети ───────────────────────────────────────────────────
// Ядро в центре, агенты-хабы по орбите, их цели пинга — листья.
// Рисуем детерминированным радиальным графом (SVG), без физических симуляций.
import { useMemo } from 'react';
import { store, useCurrentUser, usePluto, visibleAgents, visibleDevices } from '../lib/store';
import { STATUS_META } from '../components/ui';
import { cls, pingStats } from '../lib/util';
import type { Agent, Device } from '../lib/types';

interface LeafNode {
  key: string;
  label: string;
  alive: boolean;
  latency: number | null;
  kind: 'target' | 'device' | 'glances';
}

function buildGraph(devices: Device[], agents: Agent[]) {
  // ядро → агенты; агент → цели пинга + glances; ядро → одиночные устройства
  const hubs = agents.map((a) => {
    const st = pingStats(a.targets);
    const leaves: LeafNode[] = [];
    for (const t of a.targets) for (const r of t.results) {
      leaves.push({ key: `${a.id}:${r.ip}`, label: r.ip, alive: r.alive, latency: r.latency, kind: 'target' });
    }
    if (a.glancesUrl) leaves.push({ key: `${a.id}:gl`, label: 'glances', alive: a.online, latency: null, kind: 'glances' });
    return { agent: a, online: st.offline === 0 && st.total > 0, leaves };
  });
  const standalone = devices.map((d) => ({ device: d }));
  return { hubs, standalone };
}

export default function Topology() {
  const user = useCurrentUser();
  const devices = usePluto((s) => visibleDevices(s, user));
  const agents = usePluto((s) => visibleAgents(s, user));

  const graph = useMemo(() => buildGraph(devices, agents), [devices, agents]);

  const W = 960, H = 640, cx = W / 2, cy = H / 2;
  const hubR = 210; // орбита агентов
  const leafR = 92; // радиус листьев вокруг хаба

  const hubPos = graph.hubs.map((h, i) => {
    const ang = (i / Math.max(1, graph.hubs.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...h, x: cx + Math.cos(ang) * hubR, y: cy + Math.sin(ang) * hubR, ang };
  });

  return (
    <div className="space-y-4">
      <div className="rise relative overflow-hidden rounded-xl border border-line bg-panel/90">
        <div className="pointer-events-none absolute inset-0 nebula" />
        <div className="pointer-events-none absolute inset-0 stars" />
        <div className="relative flex items-center justify-between px-5 pt-4">
          <div>
            <h2 className="font-display text-[15px] font-bold text-ink">Карта инфраструктуры</h2>
            <p className="text-[11.5px] text-dim">ядро → агенты-хабы → локальные устройства · клик по узлу открывает его страницу</p>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-mut">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-vio" /> ядро</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blu" /> агент</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ok" /> онлайн</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-crit" /> офлайн</span>
          </div>
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="relative mx-auto block w-full max-w-[960px]">
          <defs>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#8f7df0" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#8f7df0" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* связи ядро → хабы */}
          {hubPos.map((h) => (
            <line key={`l-${h.agent.id}`} x1={cx} y1={cy} x2={h.x} y2={h.y}
              stroke={h.agent.online ? 'rgba(143,125,240,.5)' : 'rgba(224,122,128,.5)'} strokeWidth={h.agent.online ? 2 : 1.2}
              strokeDasharray={h.agent.online ? undefined : '5 5'} />
          ))}
          {/* связи хаб → листья */}
          {hubPos.map((h) =>
            h.leaves.map((lf, i) => {
              const la = h.ang + ((i - (h.leaves.length - 1) / 2) * 0.5);
              const lx = h.x + Math.cos(la) * leafR, ly = h.y + Math.sin(la) * leafR;
              return <line key={`ll-${lf.key}`} x1={h.x} y1={h.y} x2={lx} y2={ly}
                stroke={lf.alive ? 'rgba(85,199,149,.4)' : 'rgba(224,122,128,.35)'} strokeWidth={1} />;
            }),
          )}
          {/* связи ядро → одиночные устройства (по нижней дуге) */}
          {graph.standalone.map((sd, i) => {
            const ang = Math.PI * 0.15 + (i / Math.max(1, graph.standalone.length)) * Math.PI * 0.7;
            const x = cx + Math.cos(ang) * (hubR + 120), y = cy + Math.sin(ang) * 120 + 60;
            return <line key={`ls-${sd.device.id}`} x1={cx} y1={cy} x2={x} y2={y}
              stroke={sd.device.status === 'up' ? 'rgba(85,199,149,.3)' : sd.device.status === 'down' ? 'rgba(224,122,128,.4)' : 'rgba(139,147,184,.25)'} strokeWidth={1} />;
          })}

          {/* листья */}
          {hubPos.map((h) =>
            h.leaves.map((lf, i) => {
              const la = h.ang + ((i - (h.leaves.length - 1) / 2) * 0.5);
              const lx = h.x + Math.cos(la) * leafR, ly = h.y + Math.sin(la) * leafR;
              const color = lf.alive ? '#55c795' : '#e07a80';
              return (
                <g key={lf.key} className="cursor-default">
                  <circle cx={lx} cy={ly} r={6} fill={color} opacity={lf.alive ? 0.9 : 0.8} />
                  <text x={lx} y={ly + 16} textAnchor="middle" fontSize="9" fill="#8b93b8" fontFamily="JetBrains Mono">{lf.label}</text>
                  {lf.latency != null && <text x={lx} y={ly + 26} textAnchor="middle" fontSize="8" fill="#5fc6d8" fontFamily="JetBrains Mono">{lf.latency} мс</text>}
                </g>
              );
            }),
          )}

          {/* хабы-агенты */}
          {hubPos.map((h) => (
            <g key={h.agent.id} className="cursor-pointer" onClick={() => store.nav('agents', h.agent.name)}>
              <circle cx={h.x} cy={h.y} r={30} fill="rgba(123,164,230,.12)" stroke={h.agent.online ? '#7ba4e6' : '#e07a80'} strokeWidth={2} />
              <circle cx={h.x} cy={h.y} r={5} fill={h.agent.online ? '#7ba4e6' : '#e07a80'} />
              <text x={h.x} y={h.y + 46} textAnchor="middle" fontSize="11" fontWeight="600" fill="#dfe3f5">{h.agent.name}</text>
              <text x={h.x} y={h.y + 59} textAnchor="middle" fontSize="9" fill="#8b93b8" fontFamily="JetBrains Mono">
                {pingStats(h.agent.targets).online}/{pingStats(h.agent.targets).total} · {h.agent.latency ?? '—'} мс
              </text>
            </g>
          ))}

          {/* одиночные устройства */}
          {graph.standalone.map((sd, i) => {
            const ang = Math.PI * 0.15 + (i / Math.max(1, graph.standalone.length)) * Math.PI * 0.7;
            const x = cx + Math.cos(ang) * (hubR + 120), y = cy + Math.sin(ang) * 120 + 60;
            const m = STATUS_META[sd.device.status];
            return (
              <g key={sd.device.id} className="cursor-pointer" onClick={() => store.nav('devices', sd.device.address)}>
                <rect x={x - 7} y={y - 7} width={14} height={14} rx={3} fill="rgba(18,22,42,.9)" stroke={m.dot.replace('bg-', '#')} strokeWidth={1.5} />
                <text x={x} y={y + 22} textAnchor="middle" fontSize="9" fill="#aeb6d8">{sd.device.name.slice(0, 16)}</text>
              </g>
            );
          })}

          {/* ядро в центре */}
          <g className="cursor-pointer" onClick={() => store.nav('dashboard')}>
            <circle cx={cx} cy={cy} r={70} fill="url(#coreGlow)" />
            <circle cx={cx} cy={cy} r={34} fill="rgba(143,125,240,.15)" stroke="#8f7df0" strokeWidth={2.5} />
            <circle cx={cx} cy={cy} r={7} fill="#8f7df0" className="dot-live" />
            <text x={cx} y={cy + 52} textAnchor="middle" fontSize="13" fontWeight="700" fill="#8f7df0" letterSpacing="3">PLUTO</text>
            <text x={cx} y={cy + 66} textAnchor="middle" fontSize="9" fill="#8b93b8">ядро · {agents.length} аг. · {devices.length} устр.</text>
          </g>
        </svg>
      </div>

      {/* сводка по хабам */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {hubPos.map((h) => {
          const st = pingStats(h.agent.targets);
          return (
            <button key={h.agent.id} onClick={() => store.nav('agents', h.agent.name)}
              className="rise flex items-center gap-3 rounded-xl border border-line bg-panel/90 px-4 py-3 text-left transition-all hover:border-vio/40 hover:bg-raised/60">
              <span className={cls('h-2.5 w-2.5 shrink-0 rounded-full', h.agent.online ? 'bg-blu' : 'bg-crit')} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-ink">{h.agent.name}</div>
                <div className="font-mono text-[10.5px] text-dim">{h.agent.ip} · {h.leaves.length} узлов</div>
              </div>
              <div className="text-right">
                <div className={cls('font-mono text-[13px] font-bold', st.offline ? 'text-warn' : 'text-ok')}>{st.online}/{st.total}</div>
                <div className="font-mono text-[9.5px] text-dim">онлайн</div>
              </div>
            </button>
          );
        })}
        {hubPos.length === 0 && (
          <p className="col-span-full py-6 text-center text-[12.5px] text-dim">
            Агентов пока нет — добавьте их на странице «Агенты», и здесь появится карта сети.
          </p>
        )}
      </div>
    </div>
  );
}
