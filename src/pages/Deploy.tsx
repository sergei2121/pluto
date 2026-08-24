// ─── PLUTO: развёртывание и документация ────────────────────────────────────
import { Activity, Globe, Monitor, ShieldCheck, Terminal } from 'lucide-react';
import { CopyBlock, Panel } from '../components/ui';
import { DEVICE_TYPES, DEVICE_TYPE_META } from '../lib/types';

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
      - pluto-data:/data     # база db.json — переживает пересборку

volumes:
  pluto-data:`;

const ENV_EXAMPLE = `# .env — создайте рядом с docker-compose.yml (cp .env.example .env)

# Пароль администратора по умолчанию (логин: admin).
# Смените после первого входа: Настройки → Пользователи.
ADMIN_PASSWORD=pluto`;

const AGENT_PS = `# Сборка бинарника (Go 1.12+, один раз). ВАЖНО: кросс-компиляция под Windows,
# иначе получите Linux-бинарник и «не является действительным приложением»:
cd agent
GOOS=windows GOARCH=amd64 go build -o pluto-agent.exe .

# Передайте pluto-agent.exe на Windows-машину и положите в C:\pluto.
# PowerShell (от администратора) — установка службой одной строкой, из любой папки:
& "C:\pluto\pluto-agent.exe" -install -server ws://<IP-сервера>:8443/ws -token <ТОКЕН_АГЕНТА>

# Управление:
sc.exe query pluto-agent                        # статус службы
& "C:\pluto\pluto-agent.exe" -uninstall         # удаление`;

const DIAG_CMDS = `# 1. Жив ли API (ожидается {"ok":true,...,"version":"1.6.0"}):
curl -s http://localhost:8080/api/health

# 2. Настоящий ping изнутри ядра — ровно так проверяются устройства:
docker compose exec core ping -c 1 <IP-устройства>

# 3. Живой журнал проверок (адрес → результат → задержка):
docker compose logs -f core

# 4. Если в консоли чип «ядро: эмуляция» — образ не пересобран:
git pull && docker compose up -d --build`;

export default function Deploy() {
  return (
    <div className="space-y-4">
      <Panel title="Архитектура" icon={Globe} delay={0}>
        <p className="text-[12.5px] leading-relaxed text-mut">
          <span className="font-bold text-ink">Ядро</span> (Node.js в Docker) выполняет настоящие проверки — системный <span className="font-mono text-vio">ping</span>,
          HTTP-запросы, RTSP <span className="font-mono text-vio">OPTIONS</span>, SIP <span className="font-mono text-vio">OPTIONS</span> по UDP — и принимает телеметрию
          от <span className="font-bold text-ink">агентов</span> (один бинарник на Go для Windows) по WebSocket. Веб-консоль собирается в тот же образ и
          отдаётся ядром; при наличии <span className="font-mono text-vio">/api/health</span> она автоматически переключается с браузерной эмуляции на реальные данные.
        </p>
      </Panel>

      <Panel title="1 · Установка сервера (Ubuntu / Docker Compose)" icon={Terminal} delay={60}>
        <div className="space-y-3">
          <CopyBlock label="bash · три команды" code={`git clone https://github.com/pluto-monitor/pluto.git\ncd pluto\ncp .env.example .env && nano .env\ndocker compose up -d --build   # сервер собирается из исходников (server/)`} />
          <div className="grid gap-3 lg:grid-cols-2">
            <CopyBlock label="docker-compose.yml" code={COMPOSE} />
            <CopyBlock label=".env" code={ENV_EXAMPLE} />
          </div>
          <p className="text-[12px] leading-relaxed text-dim">
            Консоль откроется на <span className="font-mono text-mut">http://&lt;сервер&gt;:8080</span>, вход — <span className="font-mono text-mut">admin</span> / пароль из <span className="font-mono text-mut">.env</span>.
            Обновление: <span className="font-mono text-mut">git pull &amp;&amp; docker compose up -d --build</span>. Полная инструкция — <span className="font-mono text-mut">DEPLOY.md</span> в корне репозитория.
          </p>
        </div>
      </Panel>

      <Panel title="2 · Установка агента (Windows)" icon={Monitor} delay={120}>
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-mut">
            Токен создаётся в консоли: <span className="font-semibold text-ink">Агенты → «Создать токен агента»</span>. Агент ставится службой с автозапуском
            и начинает присылать телеметрию: ЦП, ОЗУ, диски и температуры, сетевые счётчики, ARP-скан локальных сетей.
          </p>
          <CopyBlock label="powershell" code={AGENT_PS} />
        </div>
      </Panel>

      <Panel title="3 · Типы проверок" icon={Activity} delay={180} bodyClass="p-0">
        <ul>
          {DEVICE_TYPES.map((t, i) => (
            <li key={t} className="grid grid-cols-[76px_1fr] items-baseline gap-4 border-b border-linesoft/60 px-4 py-3 last:border-0 sm:grid-cols-[76px_90px_1fr]">
              <span className="rounded border border-line bg-raised px-2 py-1 text-center font-mono text-[10.5px] font-bold tracking-wider text-vio">{DEVICE_TYPE_META[t].label}</span>
              <span className="text-[13px] font-semibold text-ink">{DEVICE_TYPE_META[t].label}</span>
              <span className="col-span-2 text-[12px] leading-relaxed text-dim sm:col-span-1">{DEVICE_TYPE_META[t].desc}{i === 0 && ' Интервал задаётся глобально в настройках и переопределяется у каждого устройства.'}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="4 · Уведомления и безопасность" icon={ShieldCheck} delay={240}>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-line bg-raised/40 p-4">
            <span className="text-[13px] font-bold text-ink">Каналы уведомлений</span>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-dim">
              <li><span className="text-mut">Telegram</span> — токен от @BotFather + chat_id, отправка через Bot API;</li>
              <li><span className="text-mut">Почта</span> — SMTP (на сервере ядра);</li>
              <li><span className="text-mut">Всплывающие окна браузера</span> — срабатывают при активной другой вкладке;</li>
              <li>каждый канал и каждое событие включаются/выключаются независимо.</li>
            </ul>
          </div>
          <div className="rounded-lg border border-line bg-raised/40 p-4">
            <span className="text-[13px] font-bold text-ink">Безопасность</span>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-dim">
              <li>пароли — <span className="text-mut">scrypt</span> с солью, сессии — случайные токены;</li>
              <li>агенты подключаются по <span className="text-mut">ws/wss</span> со стойким токеном — перевыпускается одним кликом;</li>
              <li>роли: администратор и наблюдатель с фильтром по типам устройств;</li>
              <li>журнал событий хранит входы, изменения настроек и аварии.</li>
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title="5 · Диагностика: проверки ли настоящие?" icon={Activity} delay={300}>
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
