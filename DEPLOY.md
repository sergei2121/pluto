# PLUTO — инструкция по развёртыванию (v1.6.0)

## 1. Требования

- Ubuntu 22.04+ (сервер), 1 ГБ ОЗУ, ~500 МБ диска;
- Docker Engine + плагин Compose v2;
- для агентов: Windows 10/11 или Server 2016+, Go 1.21+ (только для сборки, см. часть 3).

## 2. Установка сервера

### 2.1 Docker (если ещё не установлен)

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER    # войти в систему заново
```

### 2.2 PLUTO

```bash
git clone https://github.com/pluto-monitor/pluto.git
cd pluto
cp .env.example .env             # при желании задайте свой ADMIN_PASSWORD
docker compose up -d --build     # ОБЯЗАТЕЛЬНО --build: образ собирается из исходников
docker compose ps                # статус: core — running / healthy
```

| Что | Где |
|---|---|
| Веб-консоль + REST API | `http://<IP-сервера>:8080` |
| Шлюз агентов (WebSocket) | `ws://<IP-сервера>:8443/ws` |
| База данных | том Docker `pluto-data` → `/data/db.json` |

Первый вход: **admin** / пароль из `.env` (по умолчанию `pluto`) — сразу смените его:
*Настройки → Пользователи → admin → «Новый пароль»*.

### 2.3 Firewall

```bash
sudo ufw allow 8080/tcp    # консоль
sudo ufw allow 8443/tcp    # агенты
```

### 2.4 Домен + HTTPS (опционально)

Агентам нужен `wss://` — поставьте перед ядром Caddy (TLS от Let's Encrypt автоматически):

```caddy
pluto.example.com {
    reverse_proxy 127.0.0.1:8080
}
pluto-ws.example.com {
    reverse_proxy 127.0.0.1:8443
}
```

Тогда в команде установки агента используйте `wss://pluto-ws.example.com/ws`.

## 3. Установка агентов (Windows)

### 3.1 Получить токен

В консоли: **Агенты → «Создать токен агента»**. Скопируйте токен.

### 3.2 Собрать бинарник (один раз, на любой машине с Go)

```powershell
cd agent
go build -o pluto-agent.exe .
```

Готовый `pluto-agent.exe` можно раздавать по сети (один файл, без зависимостей).

### 3.3 Установить службой на целевой машине

PowerShell **от имени администратора**:

```powershell
pluto-agent.exe -install -server ws://<IP-сервера>:8443/ws -token <ТОКЕН>
```

Служба `pluto-agent` создаётся с автозапуском и сразу стартует. Управление:

```powershell
sc.exe query pluto-agent        # статус
sc.exe stop pluto-agent         # остановить
pluto-agent.exe -uninstall      # удалить службу
```

Агент появится в консоли в течение нескольких секунд, затем — живые метрики и список локальных сетей.

## 4. Что делать после установки

1. **Устройства** → «Добавить устройство»: тип (PING / HTTP / API / RTSP / SIP), адрес, интервал, теги.
2. **Настройки → Опросы**: интервалы по типам, таймаут, порог аварии, фактор деградации.
3. **Настройки → Теги**: создайте теги (до 10 цветов), присваивайте их устройствам.
4. **Настройки → Уведомления**: Telegram, e-mail, всплывающие окна; каждый канал и событие отдельно.
5. **Пользователи**: создайте наблюдателей и отметьте, какие типы устройств им видны.

Проверки на сервере — настоящие: ICMP через системный `ping`, HTTP/API через запросы,
RTSP — `OPTIONS`/ответ `RTSP/1.0 200`, SIP — `OPTIONS`/`SIP/2.0 200` по UDP.

## 5. Проверка, что всё актуально

```bash
# Жив ли API и какая версия ядра (должно быть 1.6.0):
curl -s http://localhost:8080/api/health

# Настоящий ping изнутри ядра — ровно так оно проверяет устройства:
docker compose exec core ping -c 1 <IP-устройства>

# Живой журнал проверок:
docker compose logs -f core
```

В браузере индикатор в шапке: зелёный **«ядро: сервер · v1.6.0»** — проверки настоящие;
жёлтый **«ядро: эмуляция»** — образ устарел, пересоберите:

```bash
git pull && docker compose up -d --build
```

## 6. Эксплуатация

```bash
# Обновление из репозитория
git pull && docker compose up -d --build

# Логи
docker compose logs -f core

# Бэкап базы (база — один файл в томе)
docker compose exec core cp /data/db.json /data/db.backup.json

# Полное удаление (включая данные!)
docker compose down -v
```

Данные живут в томе `pluto-data` и переживают `docker compose down` (без `-v`),
перезагрузку хоста и пересборку образа.

## 7. Диагностика

| Симптом | Проверить |
|---|---|
| Консоль показывает «ядро: эмуляция» | Образ устарел: `git pull && docker compose up -d --build`, затем Ctrl+Shift+R |
| `curl /api/health` вернул 401 | Запущен старый образ (до 1.6) — пересоберите с `--build` |
| Консоль не открывается | `docker compose ps`, `sudo ufw status`, порт 8080 не занят |
| Агент «не подключается» | Токен скопирован полностью; `Test-NetConnection <IP> -Port 8443`; для `wss://` нужен TLS-прокси |
| Нет температур | WMI `MSAcpi_ThermalZoneTemperature` требует прав администратора и поддерживается не всеми платами |
| Забыт пароль admin | Удалите `/data/db.json` в томе и перезапустите контейнер — база создастся заново |
