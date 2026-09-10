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

const RELAY_INSTALL = `# Сборка relay (на машине с Go, затем скопировать pluto-relay.exe на ПК)
cd pluto-relay
go build -o pluto-relay.exe .

# Запуск на Windows-ПК (слушает :8091, пингует локальные устройства)
pluto-relay.exe
# или службой:
pluto-relay.exe -install`;

const GLANCES_INSTALL = `# Linux (Rocky): веб-интерфейс Glances на :61208
sudo dnf install glances
glances -w

# Windows: pip install glances, затем
glances -w

# В консоли PLUTO: Агенты -> Изменить -> укажите http://<IP-ПК>:61208`;

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
          <Panel title="2 · Relay-агент на ПК" icon={<Monitor className="h-4 w-4" />}>
            <p className="mb-3 text-[12px] leading-relaxed text-dim">
              Один Go-бинарник без зависимостей. Ставится на ПК внутри VLAN/NAT и пингует устройства,
              недоступные серверу напрямую. Адрес указывается в «Агенты → Изменить».
            </p>
            <CopyBlock label="powershell / bash" code={RELAY_INSTALL} />
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
