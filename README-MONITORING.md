# PLUTO: Инструкция по настройке мониторинга через различные системы телеметрии

## Обзор

Система PLUTO поддерживает сбор метрик производительности через следующие системы мониторинга:

1. **Glances** — основной источник (CPU, RAM, GPU, диски, сеть, температуры, процессы)
2. **Netdata** — альтернативный источник с детальными метриками
3. **Telegraf** + InfluxDB — сбор метрик в формате InfluxDB Line Protocol
4. **Prometheus** — совместимость с Prometheus-экспортерами

Все сборщики метрик вынесены в модуль `/server/src/telemetry/collectors.js` и используют единый интерфейс.

---

## 1. Glances (рекомендуемый)

### Установка Glances

**Linux (Ubuntu/Debian):**
```bash
pip install glances
glances -w  # веб-режим, порт 61208
```

**Windows:**
```powershell
pip install glances
glances -w
```

**Docker:**
```bash
docker run --rm -p 61208:61208 nicolargo/glances:latest
```

### Настройка в PLUTO

1. Откройте веб-консоль PLUTO
2. Перейдите в **«Агенты» → «Добавить агента»**
3. Укажите:
   - **Имя**: название сервера
   - **Glances URL**: `http://<IP-сервера>:61208`
   - **Источник телеметрии**: `glances`

### Собираемые метрики

- CPU: общий %, по ядрам, user/system/iowait
- RAM: %, использовано/всего/доступно (ГБ)
- GPU: загрузка, память, температура (если есть)
- Диски:占用 %, размер, использование
- Сеть: Rx/Tx для всех адаптеров
- Температуры: CPU, SSD, HDD, датчики
- Процессы: топ-10 по CPU
- Контейнеры: статус, CPU, память
- Uptime, load average, swap, battery (для ноутбуков)

### Проверка подключения

```bash
curl http://<IP>:61208/api/4/all
```

---

## 2. Netdata

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
   - **Источник телеметрии**: `netdata`

### Собираемые метрики

- CPU: user, system, iowait, softirq, guest
- RAM: used, cached, buffers, free
- Swap: %, использовано/всего
- Сеть: received/sent (КБ/с)
- Disk I/O: reads/writes (операции/с)
- Температуры: CPU, SSD
- Pressure Stall Information (PSI)

### Проверка подключения

```bash
curl "http://<IP>:19999/api/v2/data?context=system.cpu&format=json"
```

---

## 3. Telegraf

### Установка Telegraf

**Linux (Ubuntu/Debian):**
```bash
wget -qO- https://repos.influxdata.com/influxdata.key | sudo tee /etc/apt/trusted.gpg.d/influxdata.asc
echo "deb https://repos.influxdata.com/ubuntu stable main" | sudo tee /etc/apt/sources.list.d/influxdb.list
sudo apt update && sudo apt install telegraf
```

**Конфигурация `/etc/telegraf/telegraf.conf`:**
```toml
[agent]
  interval = "10s"
  output_format = "influx"

# Входной плагин для сбора метрик системы
[[inputs.cpu]]
  percpu = false
  totalcpu = true

[[inputs.mem]]
[[inputs.swap]]
[[inputs.disk]]
  mount_points = ["/"]

[[inputs.net]]
  interfaces = ["eth0", "enp*"]

[[inputs.temp]]

# Выходной плагин HTTP Listener (для PLUTO)
[[outputs.http]]
  urls = ["http://<PLUTO-IP>:8080/api/telegraf"]
  method = "POST"
  data_format = "influx"
```

**Docker:**
```bash
docker run -d --name=telegraf \
  -v /etc/telegraf:/etc/telegraf:ro \
  --privileged \
  telegraf:latest
```

### Настройка в PLUTO

1. В консоли PLUTO: **«Агенты» → «Добавить агента»**
2. Укажите:
   - **Имя**: название сервера
   - **Telemetry URL**: `http://<IP-сервера>:8186` (порт Telegraf HTTP listener)
   - **Источник телеметрии**: `telegraf`

### Формат данных

Telegraf отправляет данные в формате **InfluxDB Line Protocol**:
```
cpu,host=server01 usage_idle=95.5,usage_user=2.3,usage_system=1.2
mem,host=server01 used_percent=65.2,used=4294967296,total=8589934592
disk,path=/,device=sda1 used_percent=45.0
```

### Собираемые метрики

- CPU: usage_idle, usage_user, usage_system
- RAM: used_percent
- Disk: used_percent (для root /)
- Network: bytes_recv, bytes_sent
- Temperatures: значения датчиков

### Проверка подключения

```bash
curl http://<IP>:8186/metrics
```

---

## 4. Prometheus

### Установка Prometheus Node Exporter

**Linux:**
```bash
wget https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz
tar xvfz node_exporter-*.tar.gz
sudo mv node_exporter-*.linux-amd64/node_exporter /usr/local/bin/
```

**Systemd сервис `/etc/systemd/system/node_exporter.service`:**
```ini
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=prometheus
ExecStart=/usr/local/bin/node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable node_exporter && sudo systemctl start node_exporter
```

**Docker:**
```bash
docker run -d --name=node_exporter \
  -p 9100:9100 \
  prom/node-exporter:latest
```

### Настройка в PLUTO

1. В консоли PLUTO: **«Агенты» → «Добавить агента»**
2. Укажите:
   - **Имя**: название сервера
   - **Telemetry URL**: `http://<IP-сервера>:9100`
   - **Источник телеметрии**: `prometheus`

### Запрашиваемые метрики (PromQL)

- CPU: `100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`
- RAM: `(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100`
- Disk: `(1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100`

### Проверка подключения

```bash
curl "http://<IP>:9100/metrics" | head -20
```

---

## Архитектура сборщиков метрик

```
/server/src/telemetry/
├── collectors.js        # Основные функции сбора для всех источников
├── prometheusCollector.js # Парсер Prometheus text format
└── telegrafParser.js    # Парсер InfluxDB Line Protocol
```

### Модуль collectors.js

Экспортируемые функции:

- `parseGlancesData(data)` — преобразование JSON от Glances API
- `collectNetdata(baseUrl, fetchFn)` — запрос к Netdata API v2
- `collectPrometheus(baseUrl, fetchFn)` — запрос PromQL к Prometheus
- `collectTelegraf(baseUrl, fetchFn)` — получение метрик от Telegraf
- `parseTelegrafData(body)` — парсинг InfluxDB Line Protocol

### Интеграция в server.js

Функция `collectTelemetry(agent)` автоматически выбирает нужный сборщик на основе `agent.telemetrySource`:

```javascript
async function collectTelemetry(agent) {
  const source = agent.telemetrySource || 'glances';
  
  if (source === 'netdata') {
    return await telemetryCollectors.collectNetdata(agent.netdataUrl, fetchText);
  } else if (source === 'telegraf') {
    return await telemetryCollectors.collectTelegraf(agent.telemetryUrl, fetchText);
  } else if (source === 'prometheus') {
    return await telemetryCollectors.collectPrometheus(agent.telemetryUrl, fetchText);
  } else {
    return await collectGlances(agent.glancesUrl);
  }
}
```

---

## Сравнение источников

| Метрика | Glances | Netdata | Telegraf | Prometheus |
|---------|---------|---------|----------|------------|
| CPU % | ✓ | ✓ | ✓ | ✓ |
| CPU per-core | ✓ | ✗ | ✓ | ✓ |
| RAM % | ✓ | ✓ | ✓ | ✓ |
| GPU | ✓ | ✗ | ✗ | ✗ |
| Disk I/O | ✓ | ✓ | ✓ | ✓ |
| Temperatures | ✓ | ✓ | ✓ | ✓ |
| Processes | ✓ | ✓ | ✓ | ✗ |
| Containers | ✓ | ✓ | ✓ | ✓ |
| Network adapters | ✓ | ✓ | ✓ | ✓ |
| Battery | ✓ | ✗ | ✗ | ✗ |
| Load average | ✓ | PSI | ✗ | ✓ |

**Рекомендации:**
- **Glances** — универсальный выбор для большинства сценариев
- **Netdata** — если нужна максимальная детализация и PSI
- **Telegraf** — при наличии инфраструктуры InfluxDB
- **Prometheus** — при интеграции с существующим Prometheus

---

## Диагностика

### Логи сервера PLUTO

```bash
docker compose logs -f core | grep telemetry
```

### Тестирование подключения

**Glances:**
```bash
curl -s http://<IP>:61208/api/4/all | jq '.cpu.total'
```

**Netdata:**
```bash
curl -s "http://<IP>:19999/api/v2/data?context=system.cpu&format=json" | jq '.result.data[-1][1]'
```

**Prometheus:**
```bash
curl -s "http://<IP>:9100/metrics" | grep node_cpu_seconds_total | head -5
```

**Telegraf:**
```bash
curl -s http://<IP>:8186/metrics | head -10
```

### Частые проблемы

| Проблема | Решение |
|----------|---------|
| «Glances недоступен» | Проверьте `glances -w`, порт 61208, firewall |
| «Netdata context не доступен» | Убедитесь что API v2 включён (по умолчанию в новых версияциях) |
| «Prometheus метрика недоступна» | Проверьте наличие node_exporter и правильность PromQL |
| «Telegraf данные не парсятся» | Убедитесь что формат вывода — InfluxDB Line Protocol |

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
- Не открывайте порты Glances/Netdata/Prometheus напрямую в интернет
- Используйте firewall для ограничения доступа к портам мониторинга:

```bash
sudo ufw allow from 10.0.0.0/24 to any port 61208  # Glances
sudo ufw allow from 10.0.0.0/24 to any port 19999 # Netdata
sudo ufw allow from 10.0.0.0/24 to any port 9100  # Prometheus
```

---

## Поддержка

Документация:
- [README.md](README.md) — общее описание системы
- [DEPLOY.md](DEPLOY.md) — инструкция по развёртыванию
- [README-GLANCES.md](README-GLANCES.md) — детали по Glances

Исходный код сборщиков: `/server/src/telemetry/`
