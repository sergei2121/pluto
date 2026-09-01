// ─── PLUTO: развёртывание ────────────────────────────────────────────────────
import { Rocket, Server, Monitor, LayoutGrid } from 'lucide-react';
import { Panel, CopyBlock } from '../components/ui';

const COMPOSE_UP = `# На сервере (Ubuntu), из корня репозитория:
git clone https://github.com/pluto-monitor/pluto.git
cd pluto
cp .env.example .env        # при желании задайте ADMIN_PASSWORD
docker compose up -d --build

# Консоль:   http://<IP-сервера>:8080   (вход admin / пароль из .env, по умолчанию pluto)
# Витрина:   http://<IP-сервера>:8081   (публично, без входа)`;

const RELAY_BUILD = `# На ПК (Windows), в каталоге pluto-relay:
go build -o pluto-relay.exe .

# Запуск (слушает :8091, пингует цели по запросу ядра):
pluto-relay.exe -port 8091

# Проверка с этого же ПК:
curl "http://127.0.0.1:8091/ping?targets=10.0.0.5,10.0.0.6"`;

const SHOWCASE = `# Порт витрины задаётся в «Настройки -> Витрина» (консоль) и пробрасывается
# в docker-compose переменной PLUTO_SHOWCASE_PORT (по умолчанию 8081):
#
#   PLUTO_SHOWCASE_PORT=8081
#
# После смены порта в консоли нажмите «Применить и перезапустить».`;

export default function Deploy() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="1 · Серверное ядро" icon={<Rocket className="h-4 w-4" />}>
        <p className="mb-3 text-[12.5px] leading-relaxed text-dim">
          Ядро — Node-сервер в Docker: реальные проверки (ping, HTTP, RTSP, SIP), опрос relay-агентов
          и отдельный публичный порт витрины. Веб-консоль встроена в образ и подключается к ядру сама.
        </p>
        <CopyBlock label="bash" code={COMPOSE_UP} />
      </Panel>

      <Panel title="2 · pluto-relay на ПК" icon={<Monitor className="h-4 w-4" />}>
        <p className="mb-3 text-[12.5px] leading-relaxed text-dim">
          Relay — крошечный HTTP-сервис (один Go-бинарник) для ПК. Он пингует устройства, доступные
          только этой машине (за NAT / в отдельном VLAN). Только пинг — ничего больше. Ядро обращается
          к нему по адресу из карточки агента.
        </p>
        <CopyBlock label="powershell / bash" code={RELAY_BUILD} />
        <p className="mt-3 text-[12px] leading-relaxed text-dim">
          Затем в консоли: <span className="font-semibold text-mut">Агенты → Добавить агента</span> — укажите IP ПК,
          адрес relay (<code className="font-mono text-[11px]">http://&lt;ip-пк&gt;:8091</code>) и цели для пинга.
        </p>
      </Panel>

      <Panel title="3 · Публичная витрина" icon={<LayoutGrid className="h-4 w-4" />}>
        <p className="mb-3 text-[12.5px] leading-relaxed text-dim">
          Витрина — отдельный HTTP-порт ядра со списком отмеченных устройств и их статусом.
          Работает <span className="font-semibold text-mint">без входа</span>: только список, без меню и управления.
          Обновляется автоматически каждые 10 секунд.
        </p>
        <CopyBlock label="docker-compose" code={SHOWCASE} />
      </Panel>

      <Panel title="Порты" icon={<Server className="h-4 w-4" />}>
        <ul className="space-y-2.5 text-[12.5px] text-dim">
          <li className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised/40 px-3 py-2">
            <span>Консоль + API</span><code className="font-mono text-[12px] text-mut">8080</code>
          </li>
          <li className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised/40 px-3 py-2">
            <span>Публичная витрина</span><code className="font-mono text-[12px] text-mut">8081</code>
          </li>
          <li className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised/40 px-3 py-2">
            <span>pluto-relay на каждом ПК</span><code className="font-mono text-[12px] text-mut">8091</code>
          </li>
        </ul>
        <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
          Если 8080 занят (например, Zabbix), задайте <code className="font-mono">PLUTO_HTTP_PORT</code> в <code className="font-mono">.env</code>.
        </p>
      </Panel>
    </div>
  );
}
