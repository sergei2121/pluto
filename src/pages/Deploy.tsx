// ─── PLUTO: развёртывание и документация ────────────────────────────────────
import { Rocket, Server, Monitor, Activity } from 'lucide-react';
import { Panel, CopyBlock } from '../components/ui';

const SERVER_INSTALL = `# Docker (если ещё нет)
sudo apt update && sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \\
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \\
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \\
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# PLUTO
git clone https://github.com/pluto-monitor/pluto.git
cd pluto
cp .env.example .env          # при желании задайте ADMIN_PASSWORD
docker compose up -d --build  # консоль: http://<IP>:8080, витрина: :8081

# Проверка версии ядра
curl -s http://localhost:8080/api/health`;

// ─── Новый relay-агент: состав и полный цикл (сборка → запуск → регистрация) ─
const AGENT_COMPONENTS = [
  { part: 'pluto-relay/main.go', role: 'Исходник агента: ICMP-серии (-count 5, первый пакет — warm-up), min/avg/max/jitter/потери, HTTP API на :8091' },
  { part: 'pluto-relay/go.mod', role: 'Только стандартная библиотека Go: зависимостей нет, бинарник автономный' },
  { part: 'Go ≥ 1.21', role: 'Нужен лишь на сборочной машине; на целевом ПК рантайм Go не требуется' },
  { part: 'Порт TCP :8091', role: 'Входящие правила файрвола для подсети ядра PLUTO — иначе проверки хаба уйдут в down' },
  { part: 'server/src/lib/relay.js', role: 'Ядро: координирует серии, прибавляет сетевой путь до агента (pathMs) к его локальным замерам' },
  { part: '«Хабы → Изменить»', role: 'Поле Agent URL: http://<IP-ПК>:8091 — после сохранения расписание проверок пересобирается само' },
];

const AGENT_BUILD_WINDOWS = `# 1. Установить Go (один раз): winget install GoLang.Go   (или msi с go.dev)
go version                        # должно быть >= 1.21

# 2. Взять исходники агента: git clone <pluto> ИЛИ скопировать папку pluto-relay\*
cd pluto-relay

# 3. Сборка (ОБЯЗАТЕЛЬНА после любого изменения main.go, например новых метрик серии)
go build -o pluto-relay.exe .

# 4. Ручной прогон перед установкой в службу
.\\pluto-relay.exe                # слушает :8091
curl "http://localhost:8091/ping?targets=127.0.0.1"
#    ожидаемый ответ: JSON с полями alive, latencyMs, minMs, maxMs, jitterMs, sent, received

# 5. Автозапуск службой Windows (переживает logout и перезагрузку)
pluto-relay.exe -install          # удаление службы: sc delete pluto-relay

# 6. Файрвол: разрешить ядру PLUTO входящие соединения на :8091
netsh advfirewall firewall add rule name="PLUTO relay" ^
  dir=in action=allow protocol=TCP localport=8091 remoteip=<подсеть-сервера>`;

const AGENT_BUILD_LINUX = `# 1. Go: sudo apt install golang-go   (или tarball с go.dev)
# 2. Клонировать/скопировать pluto-relay, затем:
cd pluto-relay && go build -o pluto-relay .
./pluto-relay                     # проверка: curl localhost:8091/ping?targets=127.0.0.1

# 3. Служба systemd (автозапуск + рестарт при падении):
sudo mkdir -p /opt/pluto-relay && cp pluto-relay /opt/pluto-relay/
sudo tee /etc/systemd/system/pluto-relay.service > /dev/null <<'EOF'
[Unit]
Description=PLUTO relay agent
After=network-online.target
[Service]
ExecStart=/opt/pluto-relay/pluto-relay -port 8091
Restart=always
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now pluto-relay`;

const AGENT_FLAGS = `# Параметры запуска агента (все необязательные, значения по умолчанию):
pluto-relay -port 8091        # порт HTTP API
            -timeout 2000     # бюджет времени на одно устройство, мс
            -count 5          # ICMP-пакетов в серии (1-й — warm-up, отбрасывается)
            -concurrency 8    # сколько устройств пинговать параллельно`;

const AGENT_REGISTER = `# Регистрация в PLUTO (браузер, консоль):
#   1. «Устройства»: завести проверяемые устройства этого сегмента (тип PING)
#   2. «Хабы» -> Добавить/Изменить хаб:
#        Name      — напр. "Станок-цех-2"
#        Agent URL — http://<IP-ПК-с-агентом>:8091
#   3. Сохранить: ядро немедленно опросит агента, в карточке появятся
#      latencyMs + pathMs (сквозной путь), min/max/jitter и потери серии.
#
# Диагностика:
curl http://<IP-ядра>:8080/api/health           # ядро живо
docker compose logs core | grep relay           # ошибки опроса агентов
# device "down" при живом агенте => файрвол режет :8091 или неверный IP`;

const AGENT_UPGRADE = `# Пересборка агента после обновления кода (изменения в pluto-relay/main.go):
git pull
cd pluto-relay && go build -o pluto-relay.exe .
sc stop pluto-relay && sc start pluto-relay     # Windows-служба
# Linux: sudo systemctl restart pluto-relay
#
# ВАЖНО: база данных НЕ затрагивается — агент stateless, вся история
# проверок живёт в server/data/db.json на стороне ядра.`;

const GLANCES_INSTALL = `# Linux (Rocky): веб-интерфейс Glances на :61208
sudo dnf install glances
glances -w

# Windows: pip install glances, затем
glances -w

# В консоли PLUTO: Хабы -> Изменить -> укажите http://<IP-ПК>:61208`;

const ARCH = [
  { from: 'Консоль (браузер)', to: 'Ядро :8080', what: 'REST API + поллинг состояния' },
  { from: 'Ядро', to: 'Устройства', what: 'PING / HTTP / API / RTSP / SIP' },
  { from: 'Ядро', to: 'pluto-relay :8091', what: 'пинг устройств внутри VLAN/NAT' },
  { from: 'Ядро', to: 'Glances :61208', what: 'телеметрия CPU/GPU/RAM/диски/сеть/температуры' },
  { from: 'Ядро', to: 'Витрина :8081', what: 'публичный статус без входа' },
  { from: 'Ядро', to: 'Зеркало (опц.)', what: 'push снапшота на read-only копию' },
];

export default function Deploy() {
  return (
    <div className="space-y-4">
      <Panel title="Архитектура" icon={<Activity className="h-4 w-4" />}>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line/60 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">
                <th className="py-2 pr-3">Откуда</th><th className="py-2 pr-3">Куда</th><th className="py-2 pr-3">Что передаётся</th>
              </tr>
            </thead>
            <tbody>
              {ARCH.map((r, i) => (
                <tr key={i} className="border-b border-line/30 transition-colors hover:bg-raised/40">
                  <td className="py-2.5 pr-3 font-mono text-[12px] text-vio">{r.from}</td>
                  <td className="py-2.5 pr-3 font-mono text-[12px] text-blu">{r.to}</td>
                  <td className="py-2.5 pr-3 text-[12.5px] text-mut">{r.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="1 · Сервер (Ubuntu + Docker)" icon={<Server className="h-4 w-4" />}>
          <CopyBlock label="bash" code={SERVER_INSTALL} />
        </Panel>
        <div className="space-y-4">
          <Panel title="2 · Новый relay-агент на ПК" icon={<Monitor className="h-4 w-4" />}>
            <p className="mb-3 text-[12px] leading-relaxed text-dim">
              Один Go-бинарник без зависимостей: ставится на ПК внутри VLAN/NAT и пингует устройства
              серии из 5 ICMP-пакетов (первый — warm-up), возвращая ядру медиану, min/max, джиттер и потери.
              Ядро прибавляет сетевой путь до агента (pathMs) — задержки получаются сквозными и реалистичными.
            </p>
            <div className="mb-3 overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line/60 text-[10px] font-bold uppercase tracking-[0.12em] text-dim">
                    <th className="py-1.5 pr-3">Компонент</th><th className="py-1.5 pr-3">Назначение</th>
                  </tr>
                </thead>
                <tbody>
                  {AGENT_COMPONENTS.map((c, i) => (
                    <tr key={i} className="border-b border-line/30">
                      <td className="py-1.5 pr-3 font-mono text-[11.5px] text-vio whitespace-nowrap">{c.part}</td>
                      <td className="py-1.5 pr-3 text-[12px] text-mut">{c.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CopyBlock label="Windows: сборка + служба + файрвол" code={AGENT_BUILD_WINDOWS} />
            <div className="my-3" />
            <CopyBlock label="Linux: сборка + systemd" code={AGENT_BUILD_LINUX} />
            <div className="my-3" />
            <CopyBlock label="Параметры запуска" code={AGENT_FLAGS} />
            <div className="my-3" />
            <CopyBlock label="Регистрация в консоли («Хабы»)" code={AGENT_REGISTER} />
            <div className="my-3" />
            <CopyBlock label="Пересборка после обновления кода" code={AGENT_UPGRADE} />
          </Panel>
          <Panel title="3 · Glances (телеметрия)" icon={<Rocket className="h-4 w-4" />}>
            <p className="mb-3 text-[12px] leading-relaxed text-dim">
              Открытый источник телеметрии: CPU по ядрам, GPU, RAM, диски, все сетевые адаптеры и температуры.
              Хранение истории — 30 дней.
            </p>
            <CopyBlock label="bash" code={GLANCES_INSTALL} />
          </Panel>
        </div>
      </div>

      <Panel title="Эксплуатация" icon={<Rocket className="h-4 w-4" />}>
        <CopyBlock label="bash" code={`git pull && docker compose up -d --build   # обновление
docker compose logs -f core                # логи
docker compose exec core cp /data/db.json /data/db.backup.json  # бэкап
docker compose down -v                     # полное удаление с данными`} />
      </Panel>
    </div>
  );
}
