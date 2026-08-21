// ─── PLUTO: развёртывание и документация ─────────────────────────────────────
import { I } from '../components/icons';
import { CopyBlock, Panel } from '../components/ui';

const COMPOSE = `services:
  core:
    build:
      context: .                  # образ собирается из исходников репозитория
      dockerfile: server/Dockerfile
    image: pluto/core:1.6
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/api/health"]
      interval: 15s
      timeout: 4s
      retries: 3
    ports:
      - "8080:8080"      # веб-консоль + REST API
      - "8443:8443"      # WebSocket-шлюз агентов
    environment:
      ADMIN_PASSWORD: \${ADMIN_PASSWORD:-pluto}   # смените после первого входа
      DATA_DIR: /data
    volumes:
      - pluto-data:/data          # база db.json — переживает пересборку

volumes:
  pluto-data:`;

const ENV_EXAMPLE = `# .env — создайте рядом с docker-compose.yml (cp .env.example .env)

# Пароль администратора по умолчанию (логин: admin).
# Смените после первого входа: Настройки → Пользователи.
ADMIN_PASSWORD=pluto`;

const AGENT_PS = `# Сборка бинарника из исходников (Go 1.21+, один раз):
cd agent
go build -o pluto-agent.exe .

# PowerShell (от имени администратора) — установка службой:
pluto-agent.exe -install -server ws://<IP-сервера>:8443/ws -token <ТОКЕН_АГЕНТА>

# Управление:
sc.exe query pluto-agent      # статус службы
pluto-agent.exe -uninstall    # удаление`;

const AGENT_YAML = `# pluto-agent.exe -h
-server   адрес шлюза:  ws://<IP>:8443/ws  или  wss://pluto.example.com/ws
-token    токен из консоли (Агенты → Токен подключения)
-metrics  интервал телеметрии, сек         (по умолчанию 3)
-lan      интервал скана локальных сетей   (по умолчанию 300)
-install  установить службой Windows "pluto-agent" с автозапуском

# Сборщики: ЦП (загрузка, температура WMI), ОЗУ, диски (объёмы и
# занятость), счётчики сети RX/TX, ARP-скан доступных подсетей.`;

const DIAG_CMDS = `# 1. Жив ли API (ожидается {"ok":true,...}):
curl -s http://localhost:8080/api/health

# 2. Настоящий ping изнутри ядра — ровно так проверяются устройства:
docker compose exec core ping -c 1 <IP-устройства>

# 3. Живой журнал проверок (адрес → результат → задержка):
docker compose logs -f core

# 4. Если в консоли чип «ядро: эмуляция» — образ не пересобран:
git pull && docker compose up -d --build`;

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
        { x: 590, y: 40, w: 150, h: 64, t1: 'Хранилище /data', t2: 'db.json · Docker volume', c: '#55c795' },
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
          <CopyBlock label="bash · три команды" code={`git clone https://github.com/pluto-monitor/pluto.git\ncd pluto\ncp .env.example .env && nano .env\ndocker compose up -d --build   # сервер собирается из исходников (server/)`} />
          <div className="grid gap-3 lg:grid-cols-2">
            <CopyBlock label="docker-compose.yml" code={COMPOSE} />
            <CopyBlock label=".env.example" code={ENV_EXAMPLE} />
          </div>
          <p className="text-[12px] leading-relaxed text-dim">
            Консоль откроется на <span className="font-mono text-mut">http://&lt;сервер&gt;:8080</span>, вход — <span className="font-mono text-mut">admin</span> / пароль из <span className="font-mono text-mut">.env</span>.
            Обновление: <span className="font-mono text-mut">git pull &amp;&amp; docker compose up -d --build</span>. Полная инструкция — <span className="font-mono text-mut">DEPLOY.md</span> в корне репозитория.
          </p>
        </div>
      </Panel>

      <Panel title="2 · Установка агента (Windows)" icon="agents" delay={120}>
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <CopyBlock label="powershell" code={AGENT_PS} />
            <CopyBlock label="параметры агента" code={AGENT_YAML} />
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
              <li>пароли — <span className="text-mut">scrypt</span> с солью, сессии — случайные токены, хранимые в базе;</li>
              <li>агенты подключаются по <span className="text-mut">ws/wss</span> со стойким токеном — перевыпускается одним кликом;</li>
              <li>роли: администратор и наблюдатель с фильтром по типам устройств;</li>
              <li>журнал событий хранит входы, изменения настроек и аварии.</li>
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title="5 · Диагностика: проверки ли настоящие?" icon="activity" delay={300}>
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-mut">
            Жёлтая плашка «работа без серверного ядра» или чип <span className="font-mono text-warn">ядро: эмуляция</span> в шапке означают,
            что в контейнере старая консоль и результаты синтезируются браузером — именно поэтому несуществующие хосты могут выглядеть «живыми».
            Браузер физически не умеет отправлять ICMP: настоящий ping делает только серверное ядро. Пересоберите образ и обновите страницу (Ctrl+Shift+R).
          </p>
          <CopyBlock label="bash · на сервере" code={DIAG_CMDS} />
          <p className="text-[11.5px] leading-relaxed text-dim">
            После каждой проверки ядро пишет в лог строку вида{' '}
            <span className="font-mono text-mut">[pluto] PING 192.168.1.10 → ok 1 мс</span> или{' '}
            <span className="font-mono text-mut">[pluto] PING 10.0.0.99 → недоступен</span> — по ней видно, что опрашивается и какой ответ получен.
          </p>
        </div>
      </Panel>
    </div>
  );
}
