// ─── PLUTO: развёртывание и документация ─────────────────────────────────────
import { I } from '../components/icons';
import { CopyBlock, Panel } from '../components/ui';

const COMPOSE = `services:
  core:
    image: ghcr.io/pluto-monitor/core:1.4
    restart: unless-stopped
    ports:
      - "8080:8080"      # веб-консоль + REST API
      - "8443:8443"      # WebSocket для агентов (TLS)
    environment:
      DATABASE_URL: postgres://pluto:\${DB_PASS}@db:5432/pluto
      ADMIN_PASSWORD: \${ADMIN_PASSWORD}   # смените при первом входе
      JWT_SECRET: \${JWT_SECRET}
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - core-data:/data

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: pluto
      POSTGRES_PASSWORD: \${DB_PASS}
      POSTGRES_DB: pluto
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pluto"]
      interval: 5s
      retries: 10
    volumes:
      - pg-data:/var/lib/postgresql/data

volumes:
  core-data:
  pg-data:`;

const ENV_EXAMPLE = `# .env — создайте рядом с docker-compose.yml
DB_PASS=сгенерируйте_надёжный_пароль
ADMIN_PASSWORD=pluto          # временный, смените в консоли
JWT_SECRET=случайная_строка_64_символа`;

const AGENT_PS = `# PowerShell (от имени администратора) — одна команда:
powershell -ExecutionPolicy Bypass -Command "irm https://get.pluto.mon/agent.ps1 | iex"

# Скрипт установит агент как службу Windows:
pluto-agent.exe install --server wss://pluto.example.com:8443/ws --token <ТОКЕН_АГЕНТА>
net start pluto-agent`;

const AGENT_YAML = `# C:\\ProgramData\\pluto\\agent.yaml (создаётся установщиком)
server: wss://pluto.example.com:8443/ws
token: <ТОКЕН_АГЕНТА>
heartbeat_sec: 10
metrics_sec: 3
lan_scan_sec: 300
collectors: [cpu, ram, disks, temps, net, arp]`;

function Arch() {
  return (
    <svg viewBox="0 0 760 240" className="w-full">
      <defs>
        <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 z" fill="#5d6690" />
        </marker>
      </defs>
      {[
        { x: 20, y: 40, w: 150, h: 64, t1: 'Агенты Windows', t2: 'Go · служба · токен', c: '#7ba4e6' },
        { x: 20, y: 136, w: 150, h: 64, t1: 'Цели мониторинга', t2: 'ICMP · HTTP · RTSP · SIP', c: '#5fc6d8' },
        { x: 300, y: 62, w: 170, h: 116, t1: 'PLUTO Core', t2: 'Node.js · воркеры опроса', t3: 'Docker · Ubuntu', c: '#9a8cfa' },
        { x: 590, y: 40, w: 150, h: 64, t1: 'PostgreSQL 16', t2: 'метрики · события', c: '#55c795' },
        { x: 590, y: 136, w: 150, h: 64, t1: 'Веб-консоль', t2: 'эта панель · роли', c: '#dfa65e' },
      ].map((b) => (
        <g key={b.t1}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="10" fill="#1c2440" stroke={b.c} strokeOpacity="0.45" />
          <text x={b.x + b.w / 2} y={b.y + (b.t3 ? 34 : 30)} textAnchor="middle" fill="#e4e8f7" fontSize="13" fontWeight="700" fontFamily="Manrope, sans-serif">{b.t1}</text>
          <text x={b.x + b.w / 2} y={b.y + (b.t3 ? 54 : 50)} textAnchor="middle" fill="#8b93b8" fontSize="10.5" fontFamily="JetBrains Mono, monospace">{b.t2}</text>
          {b.t3 && <text x={b.x + b.w / 2} y={b.y + 72} textAnchor="middle" fill="#8b93b8" fontSize="10.5" fontFamily="JetBrains Mono, monospace">{(b as { t3?: string }).t3}</text>}
        </g>
      ))}
      <line x1="170" y1="72" x2="298" y2="100" stroke="#5d6690" strokeWidth="1.4" markerEnd="url(#arr)" strokeDasharray="5 4" />
      <line x1="170" y1="168" x2="298" y2="140" stroke="#5d6690" strokeWidth="1.4" markerEnd="url(#arr)" strokeDasharray="5 4" />
      <line x1="470" y1="100" x2="588" y2="74" stroke="#5d6690" strokeWidth="1.4" markerEnd="url(#arr)" />
      <line x1="470" y1="140" x2="588" y2="166" stroke="#5d6690" strokeWidth="1.4" markerEnd="url(#arr)" />
      <text x="234" y="70" textAnchor="middle" fill="#626d95" fontSize="9.5" fontFamily="JetBrains Mono, monospace">WebSocket · телеметрия</text>
      <text x="234" y="180" textAnchor="middle" fill="#626d95" fontSize="9.5" fontFamily="JetBrains Mono, monospace">опрос по расписанию</text>
    </svg>
  );
}

const CHECKS = [
  { t: 'PING', n: 'ICMP-эхо с кастомным интервалом', d: 'Задержка, потери, порог аварии (N сбоев подряд), фактор деградации.' },
  { t: 'HTTP', n: 'Запрос на хост:порт/путь', d: 'Код ответа, время до первого байта; успех = ответ в пределах таймаута.' },
  { t: 'API', n: 'Отправка кастомной команды', d: 'GET/POST с JSON-телом: перезапуск службы, переключение реле и т.п.' },
  { t: 'RTSP', n: 'Проверка видеопотока', d: 'OPTIONS/DESCRIBE к камере + контроль RTP-пакетов, битрейт.' },
  { t: 'SIP', n: 'SIP OPTIONS keep-alive', d: 'Регистрация/доступность VoIP-эндпоинта, время отклика 200 OK.' },
];

export default function Deploy() {
  return (
    <div className="space-y-4">
      <Panel title="Архитектура" icon="globe" delay={0}>
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-lg border border-line bg-[#0b0f1f] p-4"><Arch /></div>
          <div className="space-y-3 text-[12.5px] leading-relaxed text-mut">
            <p>
              <span className="font-bold text-ink">Серверная часть</span> — Node.js-ядро в Docker: планировщик проверок, WebSocket-шлюз для агентов,
              REST API и веб-консоль. Работает на Ubuntu 22.04+ из коробки.
            </p>
            <p>
              <span className="font-bold text-ink">Агенты</span> — один бинарный файл на Go для Windows: служба с автозапуском, токен-аутентификация,
              телеметрия ЦП/ОЗУ/дисков/температур/сети и ARP-скан доступных локальных сетей.
            </p>
            <p>
              <span className="font-bold text-ink">Эта панель</span> сейчас работает во встроенном режиме: та же модель данных и движок опроса исполняются
              в браузере, поэтому систему можно осмотреть без сервера. После docker compose данные пойдут из реального ядра.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="1 · Установка сервера (Ubuntu / Docker Compose)" icon="terminal" delay={60}>
        <div className="space-y-3">
          <CopyBlock label="bash · три команды" code={`git clone https://github.com/pluto-monitor/pluto.git\ncd pluto\ncp .env.example .env && nano .env\ndocker compose up -d`} />
          <div className="grid gap-3 lg:grid-cols-2">
            <CopyBlock label="docker-compose.yml" code={COMPOSE} />
            <CopyBlock label=".env.example" code={ENV_EXAMPLE} />
          </div>
          <p className="text-[12px] leading-relaxed text-dim">
            Консоль откроется на <span className="font-mono text-mut">http://&lt;сервер&gt;:8080</span>, вход — <span className="font-mono text-mut">admin</span> / пароль из <span className="font-mono text-mut">.env</span>.
            Обновление: <span className="font-mono text-mut">git pull &amp;&amp; docker compose pull &amp;&amp; docker compose up -d</span>.
          </p>
        </div>
      </Panel>

      <Panel title="2 · Установка агента (Windows)" icon="agents" delay={120}>
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <CopyBlock label="powershell" code={AGENT_PS} />
            <CopyBlock label="agent.yaml" code={AGENT_YAML} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { i: 'zap' as const, t: 'ЦП и ОЗУ', d: 'загрузка, частоты, температура (WMI)' },
              { i: 'hdd' as const, t: 'Диски', d: 'объёмы, SMART-температуры, количество' },
              { i: 'radar' as const, t: 'Сеть и LAN', d: 'счётчики трафика, ARP-скан подсетей' },
            ].map((x) => (
              <div key={x.t} className="rounded-lg border border-line bg-raised/40 p-3.5">
                <span className="flex items-center gap-2 text-[12.5px] font-bold text-ink"><I n={x.i} className="h-4 w-4 text-vio" />{x.t}</span>
                <p className="mt-1 text-[11.5px] leading-relaxed text-dim">{x.d}</p>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-dim">Токен агента создаётся в разделе «Агенты» → кнопка «Токен». При компрометации токен перевыпускается одним кликом — старый сразу недействителен.</p>
        </div>
      </Panel>

      <Panel title="3 · Типы проверок" icon="activity" delay={180} bodyClass="p-0">
        <ul>
          {CHECKS.map((c, i) => (
            <li key={c.t} className="grid grid-cols-[76px_1fr] items-baseline gap-4 border-b border-line-soft/60 px-4 py-3 last:border-0 sm:grid-cols-[76px_240px_1fr]">
              <span className="rounded border border-line bg-raised px-2 py-1 text-center font-mono text-[10.5px] font-bold tracking-wider text-vio">{c.t}</span>
              <span className="text-[13px] font-semibold text-ink">{c.n}</span>
              <span className="col-span-2 text-[12px] leading-relaxed text-dim sm:col-span-1">{c.d}{i === 0 && ' Интервал задаётся глобально в настройках и переопределяется у каждого устройства.'}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="4 · Уведомления и безопасность" icon="shield" delay={240}>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-line bg-raised/40 p-4">
            <span className="flex items-center gap-2 text-[13px] font-bold text-ink"><I n="bell" className="h-4 w-4 text-vio" /> Каналы уведомлений</span>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-dim">
              <li><span className="text-mut">Telegram</span> — токен от @BotFather + chat_id, отправка через Bot API;</li>
              <li><span className="text-mut">Почта</span> — SMTP (nodemailer на сервере ядра);</li>
              <li><span className="text-mut">Всплывающие окна браузера</span> — срабатывают при активной другой вкладке;</li>
              <li>каждый канал и каждое событие включаются/выключаются независимо.</li>
            </ul>
          </div>
          <div className="rounded-lg border border-line bg-raised/40 p-4">
            <span className="flex items-center gap-2 text-[13px] font-bold text-ink"><I n="lock" className="h-4 w-4 text-vio" /> Безопасность</span>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-dim">
              <li>пароли — <span className="text-mut">argon2id</span>, сессии — JWT с коротким TTL;</li>
              <li>агенты ходят только по <span className="text-mut">wss://</span> с одноразовыми токенами;</li>
              <li>роли: администратор и наблюдатель с фильтром по типам устройств;</li>
              <li>журнал событий хранит входы, изменения настроек и аварии.</li>
            </ul>
          </div>
        </div>
      </Panel>
    </div>
  );
}
