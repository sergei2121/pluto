# PLUTO: Инструкция по настройке мониторинга через Netdata

## Обзор

Система PLUTO поддерживает сбор метрик производительности через систему мониторинга **Netdata** — это единственный источник телеметрии в системе.

Все сборщики метрик находятся в модуле `/server/src/telemetry/collectors.js` и используют API Netdata v2.

---

## Netdata

### Установка Netdata

**Linux (официальный скрипт):**
```bash
wget -O /tmp/netdata-kickstart.sh https://get.netdata.cloud/kickstart.sh && sh /tmp/netdata-kickstart.sh
```

**Docker:**
```bash
docker run -d --name=netdata \
  -p 19999:19999 \
  -v netdataconfig:/etc/netdata \
  -v netdatalib:/var/lib/netdata \
  netdata/netdata:latest
```

### Настройка в PLUTO

1. В консоли PLUTO: **«Агенты» → «Добавить агента»**
2. Укажите:
   - **Имя**: название сервера
   - **Netdata URL**: `http://<IP-сервера>:19999`

### Собираемые метрики

- CPU: user, system, iowait, softirq, guest
- RAM: used, cached, buffers, free
- Swap: %, использовано/всего
- Сеть: received/sent (КБ/с)
- Disk I/O: reads/writes (операции/с)
- Температуры: CPU, SSD

### Проверка подключения

```bash
curl "http://<IP>:19999/api/v2/data?context=system.cpu&format=json"
```

---

## Архитектура сборщика метрик

```
/server/src/telemetry/
├── collectors.js        # Основная функция сбора из Netdata API v2
```

### Модуль collectors.js

Экспортируемая функция:

- `collectNetdata(baseUrl, fetchFn)` — запрос к Netdata API v2

### Интеграция в server.js

Функция `collectTelemetry(agent)` автоматически запрашивает данные из Netdata:

```javascript
async function collectTelemetry(agent) {
  if (agent.netdataUrl) {
    const g = await telemetryCollectors.collectNetdata(agent.netdataUrl, fetchText);
    return { ...g, via: 'netdata' };
  }
  throw new Error('Нет доступного источника телеметрии (укажите Netdata URL)');
}
```

---

## Диагностика

### Логи сервера PLUTO

```bash
docker compose logs -f core | grep telemetry
```

### Тестирование подключения

**Netdata:**
```bash
curl -s "http://<IP>:19999/api/v2/data?context=system.cpu&format=json" | jq '.result.data[-1][1]'
```

### Частые проблемы

| Проблема | Решение |
|----------|---------|
| «Netdata context не доступен» | Убедитесь что API v2 включён (по умолчанию в новых версияциях) |

---

## Обновление конфигурации

После изменения интервалов опроса в **«Настройки → Опросы»** перезапустите контейнер:

```bash
docker compose restart core
```

Для применения изменений в коде сборщиков:

```bash
cd /path/to/pluto
git pull
docker compose up -d --build
```

---

## Безопасность

- Все запросы к источникам телеметрии выполняются по **HTTP** (локальная сеть)
- Для доступа из интернета используйте **HTTPS прокси** (Caddy, Nginx)
- Не открывайте порт Netdata напрямую в интернет
- Используйте firewall для ограничения доступа к порту мониторинга:

```bash
sudo ufw allow from 10.0.0.0/24 to any port 19999 # Netdata
```

---

## Поддержка

Документация:
- [README.md](README.md) — общее описание системы
- [DEPLOY.md](DEPLOY.md) — инструкция по развёртыванию

Исходный код сборщиков: `/server/src/telemetry/`
