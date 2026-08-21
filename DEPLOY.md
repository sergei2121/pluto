# PLUTO — инструкция по развёртыванию

Полный цикл: сервер на Ubuntu (Docker Compose) → агенты на Windows-машинах → веб-консоль.

```
┌─────────────┐  WebSocket/TLS   ┌───────────────────────┐        ┌──────────────┐
│ Агенты Win  │ ───────────────▶ │ PLUTO Core (Docker)   │ ─────▶ │ PostgreSQL 16│
│ Go · служба │  телеметрия/LAN  │ Node.js · опросы · API│        │ метрики      │
└─────────────┘                  │ :8080 консоль :8443 WS│        └──────────────┘
                                 └───────────────────────┘
                                         ▲ опрос: PING · HTTP · API · RTSP · SIP
┌─────────────┐                          │
│ Цели сети   │ ◀────────────────────────┘
│ камеры, АТС │
└─────────────┘
```

**Требования**

| Компонент | Минимум |
|---|---|
| Сервер | Ubuntu 22.04/24.04 (или Debian 12), Docker 24+, Compose v2, 1 ГБ ОЗУ |
| Агенты | Windows 10 / 11 / Server 2016+ (x64), права администратора |
| Сеть | открытые порты `8080/tcp` (консоль+API) и `8443/tcp` (агенты) |

---

## Часть 1 · Сервер на Ubuntu

### 1.1 Установите Docker (если ещё нет)

```bash
sudo apt update && sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"   # перезайдите в сессию
docker compose version            # проверка: v2.x
```

### 1.2 Склонируйте репозиторий

```bash
git clone https://github.com/pluto-monitor/pluto.git
cd pluto
```

### 1.3 Создайте `.env` с секретами

```bash
cp .env.example .env
nano .env
```

Заполните три значения (случайные строки — `openssl rand -hex 32`):

| Переменная | Назначение |
|---|---|
| `DB_PASS` | пароль внутренней PostgreSQL |
| `ADMIN_PASSWORD` | пароль входа `admin` в консоль — **смените после первого входа** |
| `JWT_SECRET` | подпись сессий, от 64 символов |

### 1.4 Запустите систему

```bash
docker compose up -d          # первый запуск: скачает образы (~400 МБ)
docker compose ps             # оба контейнера — Up (healthy)
docker compose logs -f core   # наблюдайте старт ядра
```

### 1.5 Первый вход

Откройте `http://<IP-сервера>:8080` → логин `admin`, пароль из `ADMIN_PASSWORD`.
Сразу: **Настройки → Пользователи → Сменить пароль**, затем создайте
пользователей-наблюдателей с разрешёнными типами устройств.

### 1.6 Откройте порты (ufw)

```bash
sudo ufw allow 8080/tcp    # консоль и REST API
sudo ufw allow 8443/tcp    # WebSocket-шлюз агентов
sudo ufw enable
```

### 1.7 TLS и домен (рекомендуется)

Проще всего — обратный прокси Caddy перед ядром (Let's Encrypt автоматически).
В отдельном `Caddyfile`:

```
pluto.example.com {
    reverse_proxy localhost:8080
}
```

Для шлюза агентов замените `wss://pluto.example.com:8443/ws` на путь через домен,
либо оставьте прямой порт 8443 — образ ядра принимает самоподписанный сертификат.

---

## Часть 2 · Агенты на Windows-машинах

Агент — один файл `pluto-agent.exe` (Go, ~14 МБ). Устанавливается как служба
Windows с автозапуском; аутентификация — токен из консоли.

### 2.1 Получите токен в консоли

Консоль → **Агенты** → кнопка **«Токен подключения»** → «Сгенерировать» → скопируйте.

### 2.2 Установка одной командой (PowerShell, от администратора)

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://get.pluto.mon/agent.ps1 | iex"
pluto-agent.exe install --server wss://pluto.example.com:8443/ws --token <ТОКЕН>
net start pluto-agent
```

### 2.3 Конфигурация `C:\ProgramData\pluto\agent.yaml`

Создаётся установщиком; интервалы можно править вручную:

```yaml
server: wss://pluto.example.com:8443/ws
token: <ТОКЕН>
heartbeat_sec: 10     # «живость» соединения
metrics_sec: 3        # телеметрия ЦП/ОЗУ/дисков/температур/сети
lan_scan_sec: 300     # ARP-скан доступных подсетей
collectors: [cpu, ram, disks, temps, net, arp]
```

После правки: `net stop pluto-agent && net start pluto-agent`.

### 2.4 Что агент присылает

- ЦП: загрузка по ядрам и суммарная, температура, тактовая частота;
- ОЗУ: занято/всего, температура модулей;
- Диски: количество, буквы, объёмы, занятость, температуры;
- Сеть: счётчики RX/TX (байт/с) по каждому интерфейсу;
- Локальные сети: список доступных подсетей + ARP-таблица хостов (IP, MAC, онлайн).

В консоли машина появляется в разделе **Агенты** в течение ~10 секунд;
детальная панель — по клику на карточку (графики ЦП/ОЗУ, диски, температура, LAN).

---

## Часть 3 · Веб-консоль (этот репозиторий)

Консоль встроена в образ ядра и отдаётся на `:8080` — отдельно ставить не нужно.

```bash
# Разработка
npm install
npm run dev          # http://localhost:5173 — встроенное ядро (эмуляция)

# Продакшен-сборка
npm run build        # результат в dist/, копируется в образ core при сборке
```

> **Встроенный режим**: без поднятого Docker-ядра консоль исполняет ту же модель
> данных и движок опросов в браузере — систему можно осмотреть «как есть».
> После `docker compose up` подключите консоль к реальному API ядра
> (базовый URL задаётся переменной `VITE_PLUTO_API`).

---

## Часть 4 · Эксплуатация

```bash
# Обновление до новой версии
git pull
docker compose pull
docker compose up -d

# Логи / статус / перезапуск
docker compose logs -f core
docker compose ps
docker compose restart core

# Резервная копия базы
docker compose exec db pg_dump -U pluto pluto > pluto-backup-$(date +%F).sql

# Восстановление
cat pluto-backup-YYYY-MM-DD.sql | docker compose exec -T db psql -U pluto -d pluto

# Остановить (данные сохранятся в томах)
docker compose down

# Полное удаление вместе с данными
docker compose down -v
```

Данные живут в именованных томах `pg-data` (метрики, события, настройки) и
`core-data` (файлы ядра) — они переживают пересоздание контейнеров.

---

## Часть 5 · Диагностика

| Симптом | Проверка |
|---|---|
| Консоль не открывается | `docker compose ps` → core `Up`; `curl http://localhost:8080/api/health` |
| Агент не подключается | токен свежий? порт `8443/tcp` открыт в ufw/фаерволе? имя сервера резолвится с Windows-машины? |
| Агент виден, но без LAN-скана | `lan_scan_sec` в `agent.yaml`; перезапустите службу |
| ICMP-проверки молчат | в docker-сети ping доступен из коробки; для внешнего NAT проверьте `--network host` или cap `NET_ADMIN` |
| Забыт пароль admin | остановите core, задайте новый `ADMIN_PASSWORD` в `.env`, `docker compose up -d` — ядро переприменит |

Быстрая проверка здоровья:

```bash
curl -s http://localhost:8080/api/health
# {"status":"ok","core":"1.4","db":"up","agents":0,"devices":0}
```
