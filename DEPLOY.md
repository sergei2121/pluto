# PLUTO — инструкция по развёртыванию

## Если вы получили ошибку `…/server not found`

Старый `docker-compose.yml` ссылался на готовый образ в реестре и каталог `./server`,
которого ещё не было в репозитории. Теперь **весь сервер и агент лежат прямо в репозитории**:

- `server/` — ядро (Node.js, REST API, движок опроса, шлюз агентов) + `Dockerfile`;
- `agent/` — исходники Windows-агента (Go, один файл);
- веб-консоль собирается тем же Dockerfile из корня репозитория.

Исправление на уже развёрнутой машине:

```bash
cd /home/pluto/pluto
git pull
docker compose up -d --build    # соберёт образ из исходников
```

---

## Версия 1.6 · если консоль показывает «ядро: эмуляция»

Эмуляция означает, что в браузере работает **старый образ** (консоль запекается в него
при сборке, поэтому `git pull` без `--build` ничего не меняет, а `--build` может переиспользовать
кэш). Гарантированная чистая пересборка — удаляем старые образы и собираем заново:

```bash
cd /home/pluto/pluto
git pull
docker compose down
docker rmi -f pluto/core:1.4 pluto/core:1.5 pluto/core:1.6 2>/dev/null   # выкинуть кэш образов
docker compose build --no-cache                                          # собрать с нуля
docker compose up -d
```

Проверка (до браузера):

```bash
# 1. Какая версия реально лежит на диске (должно быть 1.6.0):
grep -o "version: '1.[0-9.]*'" server/src/server.js

# 2. Какое ядро отвечает (должно быть 200 и "version":"1.6.0"):
curl -s http://localhost:8080/api/health

# 3. Журнал запуска (должно быть [pluto] core v1.6.0):
docker compose logs --tail=5 core
```

Если `grep` на шаге 1 не находит `1.6.0` — репозиторий на сервере отстаёт: `git pull` не принёс
новые файлы (проверьте remote и ветку: `git -C /home/pluto/pluto remote -v && git -C /home/pluto/pluto log --oneline -3`).

В самой консоли версия видна в двух местах: чип в шапке («ядро: сервер · v1.6.0» + «консоль v1.6.0»)
и нижний левый угол сайдбара. Если «консоль» показывает не 1.6.0 — образ точно старый, пересоберите по инструкции выше.

---

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
docker compose up -d --build
docker compose ps                # статус: core — running
```

Готово:

| Что | Где |
|---|---|
| Веб-консоль + REST API | `http://<IP-сервера>:8080` |
| Шлюз агентов (WebSocket) | `ws://<IP-сервера>:8443/ws` |
| База данных | том Docker `pluto-data` → `/data/db.json` |

Первый вход: **admin** / пароль из `.env` (по умолчанию `pluto`) — сразу смените его:
*Настройки → Пользователи → admin → «Сменить пароль»*.

### 2.3 Firewall

```bash
sudo ufw allow 8080/tcp    # консоль
sudo ufw allow 8443/tcp    # агенты
```

### 2.4 Домен + HTTPS (опционально)

Агентам нужен `wss://` — поставьте перед ядром Caddy (TLS от Let's Encrypt автоматически):

```caddy
# /etc/caddy/Caddyfile
pluto.example.com {
    reverse_proxy 127.0.0.1:8080
}
pluto-ws.example.com {
    reverse_proxy 127.0.0.1:8443
}
```

Тогда в команде установки агента используйте `wss://pluto-ws.example.com/ws`.

## 3. Установка агентов (Windows)

Агент собирает: загрузку и температуру ЦП, ОЗУ (занято/всего), диски (количество,
объёмы, занятость), сетевые счётчики RX/TX и список доступных локальных сетей (ARP-скан).

### 3.1 Получить токен

В консоли: **Агенты → «Токен подключения» → введите имя → Сгенерировать**. Скопируйте токен.

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

Флаги: `-metrics 3` (сек, телеметрия), `-lan 300` (сек, скан сетей).

Агент появится в консоли в течение нескольких секунд: событие «Агент … подключился»,
затем живые метрики и список локальных сетей на карточке агента.

## 4. Что делать после установки

1. **Устройства** → «Добавить устройство»: тип (PING / HTTP / API / RTSP / SIP),
   адрес, порт/путь, кастомный интервал, теги.
2. **Настройки → Интервалы**: глобальные интервалы по типам, таймаут, порог аварии
   (N сбоев подряд), фактор деградации (во сколько раз пинг выше базового считается деградацией).
3. **Настройки → Теги**: создайте теги (до 10 цветов из палитры), присваивайте их устройствам.
4. **Настройки → Уведомления**: Telegram (токен бота + chat_id), e-mail (SMTP),
   всплывающие окна браузера; каждый канал и каждое событие включается отдельно.
5. **Пользователи**: создайте наблюдателей и отметьте, какие типы устройств им видны.

Проверки на сервере — настоящие: ICMP через системный `ping`, HTTP/API через
запросы, RTSP — `OPTIONS`/ответ `RTSP/1.0 200`, SIP — `OPTIONS`/`SIP/2.0 200` по UDP.

## 5. Эксплуатация

```bash
# Обновление из репозитория
git pull && docker compose up -d --build

# Логи
docker compose logs -f core

# Бэкап базы (база — один файл в томе)
docker compose exec core cp /data/db.json /data/db.backup.json
docker run --rm -v pluto_pluto-data:/data -v $PWD:/backup alpine \
  cp /data/db.json /backup/pluto-backup-$(date +%F).json

# Полное удаление (включая данные!)
docker compose down -v
```

Данные живут в томе `pluto-data` и переживают `docker compose down` (без `-v`),
перезагрузку хоста и пересборку образа.

## 6. Диагностика

| Симптом | Проверить |
|---|---|
| `denied: requested access to the resource is denied` / `server not found` | Обновите репозиторий (`git pull`) и используйте `up -d --build` — образ собирается локально |
| Консоль не открывается | `docker compose ps`, `sudo ufw status`, порт 8080 не занят другим сервисом |
| Агент «не подключается» | Токен скопирован полностью; сервер и порт 8443 доступны: `Test-NetConnection <IP> -Port 8443`; для `wss://` нужен TLS-прокси |
| Агент подключился, но нет температур | WMI-класс `MSAcpi_ThermalZoneTemperature` требует прав администратора и поддерживается не всеми материнскими платами — поле будет 0 |
| ICMP «нет данных» | В образе используется системный ping (`iputils`); убедитесь, что целевой хост не блокирует эхо-запросы |
| Забыт пароль admin | Удалите файл `/data/db.json` в томе и перезапустите контейнер — база создастся заново с паролем из `.env` |
