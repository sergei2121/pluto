# PLUTO: Инструкция по настройке мониторинга

## Обзор

Система PLUTO поддерживает сбор метрик производительности через два источника телеметрии:

1. **Netdata** — рекомендуемый способ для Linux серверов с широким набором метрик
2. **Pluto Agent** — кроссплатформенный агент для Windows и Linux

Все сборщики метрик находятся в модуле `/server/src/telemetry/collectors.js`.

---

## Источники телеметрии

### Netdata API v2

**Установка Netdata:**

Linux (официальный скрипт):
```bash
wget -O /tmp/netdata-kickstart.sh https://get.netdata.cloud/kickstart.sh && sh /tmp/netdata-kickstart.sh
```

Docker:
```bash
docker run -d --name=netdata \
  -p 19999:19999 \
  -v netdataconfig:/etc/netdata \
  -v netdatalib:/var/lib/netdata \
  netdata/netdata:latest
```

Windows: скачайте установщик с [netdata.cloud](https://netdata.cloud/)

**Настройка плагинов для расширенных метрик:**

Отредактируйте `/etc/netdata/go.d.conf`:
```yaml
modules:
  go.d/nvidia_smi: yes    # GPU NVIDIA
  go.d/smartctl: yes      # Температуры дисков
  go.d/disks_space: yes   # Пространство дисков
```

Перезапустите: `sudo systemctl restart netdata`

### Pluto Agent

Для Windows и Linux систем без Netdata используйте Pluto Agent.

Смотрите подробную инструкцию в [MONITORING-WINDOWS-LINUX.md](MONITORING-WINDOWS-LINUX.md)

---

## Настройка в PLUTO

1. В консоли PLUTO: **«Агенты» → «Добавить агента»**
2. Укажите:
   - **Имя**: название сервера
   - **Netdata URL**: `http://<IP-сервера>:19999` (для Netdata)
   - **Agent URL**: `http://<IP-сервера>:8080` (для Pluto Agent)

---

## Собираемые метрики

### Базовые метрики (оба источника)

- **CPU**: загрузка процессора (total, user, system, iowait, softirq, guest)
- **RAM**: использование оперативной памяти (процент, использовано, всего, cached, buffers)
- **Swap**: использование файла подкачки
- **Сеть**: received/sent (КБ/с)
- **Disk I/O**: операции чтения/записи

### Расширенные метрики

- **Диски**: 
  - Количество дисков
  - Общий объем дисков
  - Использованное пространство
- **Температуры**:
  - CPU температура
  - SSD/HDD температура  
  - GPU температура
- **GPU** (если установлен):
  - Загрузка видеокарты (%)
  - Использование памяти GPU
  - Общий объем памяти GPU

---

## Архитектура сборщика метрик

```
/server/src/telemetry/
├── collectors.js        # Модуль сбора из Netdata и Pluto Agent
```

### Модуль collectors.js

Экспортируемые функции:

- `collectNetdata(baseUrl, fetchFn)` — запрос к Netdata API v2
- `collectFromAgent(agentUrl, fetchJsonFn)` — запрос к Pluto Agent API

### Интеграция в server.js

Функция `collectTelemetry(agent)` автоматически выбирает источник:

```javascript
async function collectTelemetry(agent) {
  // Приоритет: сначала Netdata, затем Pluto Agent
  if (agent.netdataUrl) {
    const g = await telemetryCollectors.collectNetdata(agent.netdataUrl, fetchText);
    return { ...g, via: 'netdata' };
  }
  if (agent.agentUrl) {
    const g = await telemetryCollectors.collectFromAgent(agent.agentUrl, fetchJson);
    return { ...g, via: 'pluto_agent' };
  }
  throw new Error('Нет доступного источника телеметрии');
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
curl -s "http://<IP>:19999/api/v2/data?context=nvidia_gpu.gpu_utilization&format=json"
curl -s "http://<IP>:19999/api/v2/data?context=disks.space&format=json"
curl -s "http://<IP>:19999/api/v2/data?context=sensors.temperatures&format=json"
```

**Pluto Agent:**
```bash
curl -s "http://<IP>:8080/api/metrics" | jq
```

### Частые проблемы

| Проблема | Решение |
|----------|---------|
| «Netdata context не доступен» | Убедитесь что API v2 включён (по умолчанию в новых версиях) |
| Нет данных о GPU | Установите плагин nvidia_smi для Netdata или проверьте драйверы |
| Нет температур | Установите lm_sensors (Linux) или проверьте датчики (Windows) |
| Агент не подключается | Проверьте firewall и доступность порта |

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
- Не открывайте порты мониторинга напрямую в интернет
- Используйте firewall для ограничения доступа:

```bash
sudo ufw allow from 10.0.0.0/24 to any port 19999 # Netdata
sudo ufw allow from 10.0.0.0/24 to any port 8080  # Pluto Agent
```

---

## Поддержка

Документация:
- [README.md](README.md) — общее описание системы
- [DEPLOY.md](DEPLOY.md) — инструкция по развёртыванию
- [MONITORING-WINDOWS-LINUX.md](MONITORING-WINDOWS-LINUX.md) — подробная инструкция для Windows/Linux

Исходный код сборщиков: `/server/src/telemetry/`
