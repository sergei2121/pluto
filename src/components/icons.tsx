// ─── PLUTO: иконки (inline SVG, stroke) ─────────────────────────────────────
import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  dashboard: (<><rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" /><rect x="13.5" y="12" width="7.5" height="9" rx="1.5" /><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5" /></>),
  server: (<><rect x="3" y="4" width="18" height="7" rx="1.6" /><rect x="3" y="13" width="18" height="7" rx="1.6" /><path d="M6.5 7.5h.01M6.5 16.5h.01M10 7.5h2M10 16.5h2" /></>),
  agents: (<><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5" /></>),
  settings: (<><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10 5.09V5a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" /></>),
  rocket: (<><path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2" /><path d="M12 15 9 12c.7-2.8 2-5.5 4-7.5 2.7-2.7 6.5-3 6.5-3s-.3 3.8-3 6.5c-2 2-4.7 3.3-7.5 4Z" /><path d="M9 12H5.5L8 8.5M12 15v3.5L15.5 16" /><circle cx="15" cy="9" r="1.4" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  bell: (<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M10.3 21a2 2 0 0 0 3.4 0" /></>),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (<><path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M19 6l-.8 14a2 2 0 0 1-2 1.9H7.8a2 2 0 0 1-2-1.9L5 6" /><path d="M10 11v6M14 11v6" /></>),
  pencil: (<><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></>),
  star: <path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9Z" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="m4.5 12.5 5 5L19.5 7" />,
  copy: (<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>),
  refresh: (<><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" /></>),
  logout: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>),
  shield: (<><path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" /><path d="m9 12 2 2 4-4.5" /></>),
  users: (<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M21.5 20c-.5-2.1-1.7-3.6-3.3-4.4" /></>),
  tag: (<><path d="M12.6 2.6 21.4 11.4a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6Z" /><circle cx="7.5" cy="7.5" r="1.3" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>),
  zap: <path d="M13 2 4 14h6l-1 8 9-12h-6Z" />,
  activity: <path d="M22 12h-4l-3 8-6-16-3 8H2" />,
  terminal: (<><path d="m4 17 6-5-6-5M12 19h8" /></>),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  alert: (<><path d="M12 3 2.5 20h19Z" /><path d="M12 9.5V14M12 17h.01" /></>),
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
  globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" /></>),
  thermo: <path d="M14 4a2 2 0 1 0-4 0v10.5a4 4 0 1 0 4 0Z" />,
  hdd: (<><path d="M22 12.5 18.5 5a2 2 0 0 0-1.8-1H7.3a2 2 0 0 0-1.8 1L2 12.5V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2Z" /><path d="M2 12.5h20M6.5 16.5h.01M10 16.5h.01" /></>),
  net: (<><path d="M12 20a8 8 0 0 1 0-16 8 8 0 0 1 0 16Z" /><path d="M4 12h16M12 4c2.5 2.2 4 5 4 8s-1.5 5.8-4 8c-2.5-2.2-4-5-4-8s1.5-5.8 4-8Z" /></>),
  power: (<><path d="M12 2v9" /><path d="M18.4 6.6a9 9 0 1 1-12.8 0" /></>),
  doc: (<><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" /><path d="M14 2v5h5M9 13h6M9 17h6M9 9h1.5" /></>),
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4.5 21c1-3.8 4-6 7.5-6s6.5 2.2 7.5 6" /></>),
  lock: (<><rect x="4.5" y="10.5" width="15" height="10.5" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>),
  mail: (<><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" />,
  wifi: (<><path d="M5 12.5a10 10 0 0 1 14 0M8.5 15.8a5.5 5.5 0 0 1 7 0M2 9a15 15 0 0 1 20 0" /><path d="M12 19.5h.01" /></>),
  radar: (<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12 18 6" /><path d="M12 12h.01" /></>),
  filter: <path d="M22 4H2l8 9.5V20l4 2v-8.5Z" />,
  play: <path d="m7 4 13 8-13 8Z" />,
  box: (<><path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5Z" /><path d="m3 8.5 9 5 9-5M12 21v-7.5" /></>),
};

export type IconName = keyof typeof paths;

export function I({ n, className = 'w-4 h-4', sw = 1.7 }: { n: IconName; className?: string; sw?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths[n]}
    </svg>
  );
}

/** Фирменный знак PLUTO — карликовая планета с кольцом */
export function PlanetMark({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="pl-gr" x1="10" y1="8" x2="38" y2="40">
          <stop offset="0" stopColor="#b3a5ff" />
          <stop offset="1" stopColor="#5d54b8" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="13" fill="url(#pl-gr)" />
      <circle cx="19" cy="19" r="2.6" fill="#0d1120" opacity=".28" />
      <circle cx="29" cy="27" r="1.8" fill="#0d1120" opacity=".22" />
      <circle cx="22" cy="29" r="1.2" fill="#0d1120" opacity=".25" />
      <ellipse cx="24" cy="24" rx="21" ry="7.5" stroke="#8f7df0" strokeWidth="1.6" transform="rotate(-16 24 24)" opacity=".9" />
      <circle cx="42" cy="13" r="1.1" fill="#9aa7d8" />
      <circle cx="7" cy="36" r="0.9" fill="#9aa7d8" opacity=".7" />
    </svg>
  );
}
