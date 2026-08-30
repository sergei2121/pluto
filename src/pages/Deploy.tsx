// ─── PLUTO: развёртывание и документация ────────────────────────────────────
import { Rocket, Server, Terminal, BarChart3, ShieldCheck } from 'lucide-react';
import { CopyBlock, Panel } from '../components/ui';

const COMPOSE = `services:
  core:
    build:
      context: .
      dockerfile: server/Dockerfile
    image: pluto/core:1.10.0
    restart: unless-stopped
    ports:
      - "\${PLUTO_HTTP_PORT:-8080}:8080"   # консоль + API
      - "\${PLUTO_AGENT_PORT:-8443}:8443"  # шлюз (резерв)
    environment:
      - ADMIN_PASSWORD=\${ADMIN_PASSWORD:-pluto}
    volumes:
      - pluto-data:/data
volumes:
  pluto-data:`;

const SERVER_CMDS = `# 1. Docker (Ubuntu 22.04+)
sudo apt update && sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \\
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \\
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 2. PLUTO
git clone https://github.com/pluto-monitor/pluto.git
cd pluto
cp .env.example .env          # при желании: свой ADMIN_PASSWORD и порты
docker compose up -d --build

# 3. Проверка
curl -s http://localhost:8080/api/health   # → "version":"1.10.0"
sudo ufw allow 8080/tcp && sudo ufw allow 8443/tcp`;

const RELAY_CMDS = `# Сборка (Go 1.12+, без внешних зависимостей):
cd aida-monitor
go build -o aida-monitor.exe .    # Windows
go build -o aida-monitor .        # Linux

# Запуск (слушает :8091):
.\\aida-monitor.exe                # Windows
./aida-monitor &                  # Linux

# Эндпоинты для ядра:
#   GET /ping?targets=10.0.0.5,10.0.0.6   → пинги изнутри VLAN
#   GET /fetch?url=http://127.0.0.1:8090/ → тело страницы (loopback)
#   GET /sse-stream?url=...               → прокси SSE AIDA64 (реальное время)`;

const AIDA_HINT = `# AIDA64 (Windows): Настройки → RemoteSensor → включить веб-сервер.
# По умолчанию http://127.0.0.1:8090/
# Если адрес 127.0.0.1 — ядро читает его ЧЕРЕЗ RELAY (aida-monitor),
# т.к. из контейнера loopback машины недостижим.

# Glances:
#   Rocky Linux:  sudo dnf install glances && glances -w   (порт 61208)
#   Windows:      pip install glances, затем glances.exe -w`;

const DIAG_CMDS = `# Ядро живо и какой версии:
curl -s http://localhost:8080/api/health

# Журнал опросов (AIDA / Glances / пинги):
docker compose logs -f core

# Если консоль показывает «ядро: эмуляция» — образ устарел:
git pull && docker compose up -d --build

# Relay доступен с сервера:
curl -s http://<IP-машины>:8091/health`;

export default function Deploy() {
  return (
    <div className="space-y-4">
      <Panel title="Сервер · Ubuntu / Docker Compose" icon={<Server className="h-4 w-4" />}>
        <div className="space-y-3">
          <CopyBlock label="bash · установка" code={SERVER_CMDS} />
          <CopyBlock label="docker-compose.yml (уже в репозитории)" code={COMPOSE} />
          <p className="text-[12px] leading-relaxed text-dim">
            Консоль открывается на <span className="font-mono text-mut">http://&lt;IP&gt;:8080</span>, вход{' '}
            <span className="font-mono text-mut">admin</span> / пароль из <span className="font-mono text-mut">.env</span> (по умолчанию pluto — смените сразу).
            База — один файл <span className="font-mono text-mut">db.json</span> в томе pluto-data.
            Если 8080 занят (например, Zabbix) — задайте <span className="font-mono text-mut">PLUTO_HTTP_PORT=8090</span> в .env.
          </p>
        </div>
      </Panel>

      <Panel title="Relay · aida-monitor (Windows / Linux)" icon={<Terminal className="h-4 w-4" />}>
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-mut">
            Один Go-бинарник без зависимостей. Ставится на машину агента и решает две задачи архитектуры:
            <b className="text-ink"> обход VLAN</b> (ядро пингует недоступные себе устройства изнутри сети агента) и{' '}
            <b className="text-ink">доступ к loopback-страницам</b> (AIDA64 на 127.0.0.1 и SSE-поток реального времени).
            Указывается в карточке агента в поле «Relay для пингов и loopback» (по умолчанию{' '}
            <span className="font-mono text-mut">http://&lt;IP-машины&gt;:8091/</span>).
          </p>
          <CopyBlock label="bash / powershell" code={RELAY_CMDS} />
        </div>
      </Panel>

      <Panel title="Источники данных · AIDA64 и Glances" icon={<BarChart3 className="h-4 w-4" />}>
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-mut">
            Агент — это просто IP: ничего устанавливать не обязательно. Ядро пингует его (uptime), читает{' '}
            <b className="text-ink">листинг AIDA64</b> (показания текут в реальном времени через SSE-подписку, резерв — опрос страницы каждые 10 с)
            и страницу <b className="text-ink">Glances</b> (каждые 60 с, хранение 30 дней). Архив AIDA64 хранится 60 дней.
          </p>
          <CopyBlock label="шпаргалка" code={AIDA_HINT} />
        </div>
      </Panel>

      <Panel title="Диагностика" icon={<ShieldCheck className="h-4 w-4" />}>
        <div className="space-y-3">
          <CopyBlock label="bash" code={DIAG_CMDS} />
          <p className="text-[12px] leading-relaxed text-dim">
            В консоли у каждого источника есть кнопка «Проверить источник» (карточка агента) — она показывает, что реально
            приходит со страницы: маршрут (напрямую / через relay), размер ответа, распознанные поля и фрагмент текста.
          </p>
        </div>
      </Panel>

      <Panel title="Архитектура" icon={<Rocket className="h-4 w-4" />}>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { t: 'Ядро (сервер)', d: 'Node.js в Docker: REST API, планировщик опросов, SSE-подписки на AIDA64, хранение 60/30 дней с ярусным сжатием и автоочисткой.' },
            { t: 'Relay (машины)', d: 'aida-monitor — лёгкий Go-сервис: пинги внутри VLAN, проксирование локальных страниц и SSE-потока AIDA64.' },
            { t: 'Консоль (браузер)', d: 'React: определяется ядро по подписи в HTML; если его нет — встроенный движок с синтетическими данными для осмотра системы.' },
          ].map((x) => (
            <div key={x.t} className="rounded-lg border border-line bg-raised/40 p-4">
              <h4 className="font-display text-[13px] font-bold text-vio">{x.t}</h4>
              <p className="mt-1.5 text-[12px] leading-relaxed text-dim">{x.d}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
