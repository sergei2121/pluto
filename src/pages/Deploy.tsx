// ─── PLUTO: развёртывание и документация ────────────────────────────────────
import { Panel, CopyBlock } from '../components/ui';
import { CONSOLE_VERSION } from '../lib/util';

const COMPOSE = `# docker-compose.yml (уже в корне репозитория)
services:
  core:
    image: pluto/core:${CONSOLE_VERSION}
    build: .
    restart: unless-stopped
    ports:
      - "8080:8080"   # консоль + REST API
      - "8443:8443"   # WebSocket-шлюз агентов
    environment:
      - ADMIN_PASSWORD=\${ADMIN_PASSWORD:-pluto}
    volumes:
      - pluto-data:/data
volumes:
  pluto-data:`;

const SERVER_INSTALL = `# 1. Docker (Ubuntu 22.04+), если ещё не установлен:
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker

# 2. PLUTO:
git clone https://github.com/pluto-monitor/pluto.git && cd pluto
cp .env.example .env            # при желании задайте свой ADMIN_PASSWORD
docker compose up -d --build    # ОБЯЗАТЕЛЬНО --build: образ собирается из исходников

# 3. Проверка, что ядро актуально:
curl -s http://localhost:8080/api/health   # → {"ok":true,"version":"${CONSOLE_VERSION}",...}`;

const FIREWALL = `sudo ufw allow 8080/tcp   # консоль
sudo ufw allow 8443/tcp   # агенты`;

const AGENT_INSTALL = `# Токен создаётся в консоли: Агенты → «Создать токен агента».
# Одна строка в PowerShell (от администратора); IP и токен подставятся из окна токена:
iwr http://<IP-сервера>:8080/agent/install.ps1 -OutFile $env:TEMP\\pluto-install.ps1; & $env:TEMP\\pluto-install.ps1 -Token '<ТОКЕН>'

# Установщик сам: запишет конфиг, скомпилирует агент встроенным csc.exe,
# поставит службу pluto-agent и дождётся подключения. Логи: C:\\ProgramData\\pluto\\agent.log`;

const DIAG = `# Жив ли API и какая версия (должно быть ${CONSOLE_VERSION}):
curl -s http://localhost:8080/api/health

# Настоящий ping изнутри ядра — ровно так оно проверяет устройства:
docker compose exec core ping -c 1 <IP-устройства>

# Журнал проверок:
docker compose logs -f core`;

export default function Deploy() {
  return (
    <div className="space-y-4">
      <Panel title="1 · Сервер на Ubuntu (Docker Compose)" icon="rocket">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3">
            <CopyBlock label="bash · установка" code={SERVER_INSTALL} />
            <CopyBlock label="bash · firewall" code={FIREWALL} />
          </div>
          <div className="space-y-3 text-[12.5px] leading-relaxed text-mut">
            <p>Сервер — это один контейнер <span className="font-mono text-ink">pluto/core</span>: REST API, движок опроса (ping / HTTP / API / RTSP / SIP), WebSocket-шлюз агентов и сама веб-консоль.</p>
            <p>База — один файл <span className="font-mono text-ink">db.json</span> в томе <span className="font-mono text-ink">pluto-data</span>; переживает пересборку образа и перезагрузку хоста.</p>
            <p className="text-dim">Первый вход: <span className="font-mono text-ink">admin</span> / пароль из <span className="font-mono text-ink">.env</span> (по умолчанию <span className="font-mono text-ink">pluto</span>) — смените сразу в «Настройки → Пользователи».</p>
          </div>
        </div>
      </Panel>

      <Panel title="2 · Агент на Windows" icon="agents">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <CopyBlock label="powershell · одна строка" code={AGENT_INSTALL} />
          <div className="space-y-3 text-[12.5px] leading-relaxed text-mut">
            <p>Агент компилируется <b className="text-ink">прямо на машине</b> встроенным компилятором <span className="font-mono text-ink">csc.exe</span> (.NET Framework есть в каждой Windows 10/11), поэтому всегда получается под правильную архитектуру — ошибки «не является приложением» нет.</p>
            <p>Служба запускает exe <b className="text-ink">без аргументов</b>: сервер и токен агент читает из <span className="font-mono text-ink">C:\ProgramData\pluto\agent.conf</span>. Чтобы сменить их — отредактируйте файл и <span className="font-mono text-ink">Restart-Service pluto-agent</span>.</p>
            <p>Собирает: загрузку и температуру ЦП, ОЗУ, диски, сетевые счётчики RX/TX и ARP-скан доступных локальных сетей.</p>
          </div>
        </div>
      </Panel>

      <Panel title="3 · docker-compose.yml" icon="server">
        <CopyBlock label="yaml" code={COMPOSE} />
      </Panel>

      <Panel title="4 · Диагностика" icon="activity">
        <div className="space-y-3">
          <CopyBlock label="bash · на сервере" code={DIAG} />
          <p className="text-[11.5px] leading-relaxed text-dim">
            Если в шапке консоли горит «ядро: эмуляция» — образ устарел: выполните <span className="font-mono text-mut">git pull &amp;&amp; docker compose up -d --build</span> и обновите страницу (Ctrl+Shift+R). Настоящие проверки даёт только серверное ядро.
          </p>
        </div>
      </Panel>
    </div>
  );
}
