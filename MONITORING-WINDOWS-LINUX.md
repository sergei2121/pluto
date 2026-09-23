# PLUTO Monitoring Integration for Windows and Linux

## Обзор

Система PLUTO теперь поддерживает сбор расширенных метрик мониторинга для ОС Windows и Linux через два источника:

1. **Netdata** - рекомендуемый способ для Linux серверов
2. **Pluto Agent** - кроссплатформенный агент для Windows и Linux

### Собираемые метрики

- **CPU**: загрузка процессора (total, user, system, iowait, softirq, guest)
- **RAM**: использование оперативной памяти (процент, использовано, всего, cached, buffers)
- **Swap**: использование файла подкачки
- **Диски**: 
  - Количество дисков
  - Общий объем дисков
  - Использованное пространство
  - Операции чтения/записи (I/O)
- **Температуры**:
  - CPU температура
  - SSD/HDD температура
  - GPU температура
- **GPU** (если установлен):
  - Загрузка видеокарты (%)
  - Использование памяти GPU
  - Общий объем памяти GPU
- **Сеть**: входящий/исходящий трафик

---

## Способ 1: Netdata (рекомендуется для Linux)

### Установка Netdata на Linux

```bash
# Официальный скрипт установки
wget -O /tmp/netdata-kickstart.sh https://get.netdata.cloud/kickstart.sh && sh /tmp/netdata-kickstart.sh
```

### Установка Netdata на Windows

1. Скачайте установщик с [официального сайта](https://netdata.cloud/)
2. Запустите `netdata-installer.exe`
3. Следуйте инструкциям мастера установки

Или через PowerShell (требует WSL):
```powershell
# Через Chocolatey
choco install netdata

# Или через winget
winget install Netdata.Netdata
```

### Настройка плагинов Netdata

Для сбора данных о GPU и дисках отредактируйте `/etc/netdata/go.d.conf`:

```yaml
modules:
  go.d/nvidia_smi: yes
  go.d/smartctl: yes
  go.d/disks_space: yes
```

Перезапустите Netdata:
```bash
sudo systemctl restart netdata
```

### Подключение в PLUTO

1. Откройте консоль PLUTO
2. Перейдите в **«Агенты» → «Добавить агента»**
3. Укажите:
   - **Имя**: название сервера
   - **Netdata URL**: `http://<IP-сервера>:19999`

### Проверка подключения

```bash
curl "http://<IP>:19999/api/v2/data?context=system.cpu&format=json"
curl "http://<IP>:19999/api/v2/data?context=nvidia_gpu.gpu_utilization&format=json"
curl "http://<IP>:19999/api/v2/data?context=disks.space&format=json"
curl "http://<IP>:19999/api/v2/data?context=sensors.temperatures&format=json"
```

---

## Способ 2: Pluto Agent (Windows/Linux)

Pluto Agent - это легковесный сервис для сбора системных метрик.

### Требования

- Node.js 18+ (для JavaScript версии)
- Или Go 1.21+ (для Go версии)

### Установка на Windows

#### Вариант A: PowerShell скрипт

Сохраните как `install-pluto-agent.ps1`:

```powershell
# Install Pluto Agent on Windows
$ErrorActionPreference = "Stop"

# Create installation directory
$installDir = "C:\Program Files\PlutoAgent"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# Download agent (replace with actual URL)
$agentUrl = "https://github.com/your-org/pluto/releases/latest/download/pluto-agent-windows.exe"
Invoke-WebRequest -Uri $agentUrl -OutFile "$installDir\pluto-agent.exe"

# Configure
$config = @{
    server_url = "http://YOUR_PLUTO_SERVER:PORT"
    agent_id = $(Get-Random)
    metrics_interval = 30
} | ConvertTo-Json
$config | Out-File -FilePath "$installDir\config.json" -Encoding UTF8

# Install as Windows Service
sc.exe create PlutoAgent binPath= "\"$installDir\pluto-agent.exe\"" start= auto
sc.exe description PlutoAgent "PLUTO Monitoring Agent"
sc.exe start PlutoAgent

Write-Host "Pluto Agent installed successfully!" -ForegroundColor Green
```

Запуск от имени администратора:
```powershell
powershell -ExecutionPolicy Bypass -File .\install-pluto-agent.ps1
```

#### Вариант B: Ручная установка

1. Скачайте `pluto-agent-windows.exe`
2. Создайте файл конфигурации `config.json`:
```json
{
  "server_url": "http://YOUR_PLUTO_SERVER:PORT",
  "agent_id": "unique-agent-id",
  "metrics_interval": 30
}
```
3. Установите как службу:
```cmd
sc create PlutoAgent binPath= "C:\path\to\pluto-agent.exe" start= auto
sc start PlutoAgent
```

### Установка на Linux

#### Вариант A: Bash скрипт

Сохраните как `install-pluto-agent.sh`:

```bash
#!/bin/bash
set -e

INSTALL_DIR="/opt/pluto-agent"
SYSTEMD_DIR="/etc/systemd/system"

echo "Installing Pluto Agent..."

# Create installation directory
sudo mkdir -p $INSTALL_DIR

# Download agent (replace with actual URL)
AGENT_URL="https://github.com/your-org/pluto/releases/latest/download/pluto-agent-linux"
sudo curl -L $AGENT_URL -o $INSTALL_DIR/pluto-agent
sudo chmod +x $INSTALL_DIR/pluto-agent

# Create config
cat << EOF | sudo tee $INSTALL_DIR/config.json
{
  "server_url": "http://YOUR_PLUTO_SERVER:PORT",
  "agent_id": "$(cat /proc/sys/kernel/random/uuid)",
  "metrics_interval": 30
}
EOF

# Create systemd service
cat << EOF | sudo tee $SYSTEMD_DIR/pluto-agent.service
[Unit]
Description=PLUTO Monitoring Agent
After=network.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/pluto-agent
Restart=always
RestartSec=10
User=root
WorkingDirectory=$INSTALL_DIR

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable pluto-agent
sudo systemctl start pluto-agent

echo "Pluto Agent installed successfully!"
echo "Status: $(systemctl is-active pluto-agent)"
```

Запуск:
```bash
chmod +x install-pluto-agent.sh
sudo ./install-pluto-agent.sh
```

#### Вариант B: Через npm (Node.js версия)

```bash
# Глобальная установка
npm install -g @pluto/agent

# Конфигурация
pluto-agent config --server http://YOUR_PLUTO_SERVER:PORT

# Запуск как служба
pluto-agent install
```

### Формат данных Pluto Agent

Агент должен отдавать метрики в формате JSON на endpoint `/api/metrics`:

```json
{
  "cpu": {
    "usage": 45.2,
    "user": 30.1,
    "system": 10.5,
    "iowait": 4.6
  },
  "memory": {
    "used": 8589934592,
    "total": 17179869184,
    "usage_percent": 50.0
  },
  "swap": {
    "used": 1073741824,
    "total": 4294967296,
    "usage_percent": 25.0
  },
  "disks": [
    {
      "name": "C:",
      "total": 500107862016,
      "used": 250053931008,
      "free": 250053931008
    }
  ],
  "disk": {
    "read_per_sec": 1024000,
    "write_per_sec": 512000
  },
  "network": {
    "bytes_recv_per_sec": 102400,
    "bytes_sent_per_sec": 51200
  },
  "temperatures": {
    "cpu": 65.5,
    "ssd": 45.0,
    "gpu": 70.0
  },
  "gpu": {
    "name": "NVIDIA GeForce RTX 3080",
    "usage_percent": 75.0,
    "memory_used": 8589934592,
    "memory_total": 10737418240
  }
}
```

---

## Диагностика

### Проверка работы Netdata

```bash
# Статус службы
systemctl status netdata

# Логи
journalctl -u netdata -f

# Тест API
curl -s "http://localhost:19999/api/v2/data?context=system.cpu&format=json" | jq '.result.data[-1]'
```

### Проверка работы Pluto Agent

**Windows:**
```powershell
# Статус службы
sc query PlutoAgent

# Логи
Get-EventLog -LogName Application -Source PlutoAgent -Newest 20
```

**Linux:**
```bash
# Статус службы
systemctl status pluto-agent

# Логи
journalctl -u pluto-agent -f

# Тест endpoint
curl http://localhost:PORT/api/metrics | jq
```

### Частые проблемы

| Проблема | Решение |
|----------|---------|
| Нет данных о GPU | Установите плагин nvidia_smi для Netdata или проверьте драйверы NVIDIA |
| Нет температур | Убедитесь, что lm_sensors установлен (Linux) или HWMonitor (Windows) |
| Агент не подключается | Проверьте firewall и доступность порта PLUTO сервера |
| Неправильные данные о дисках | Проверьте права доступа к diskperf (Windows) или smartctl (Linux) |

---

## Безопасность

- Используйте HTTPS для передачи метрик через интернет
- Настройте firewall для ограничения доступа к портам мониторинга
- Регулярно обновляйте Netdata и Pluto Agent
- Используйте аутентификацию для доступа к API

### Пример настройки firewall

**Linux (ufw):**
```bash
sudo ufw allow from 10.0.0.0/24 to any port 19999  # Netdata
sudo ufw allow from 10.0.0.0/24 to any port 8080   # Pluto Agent
```

**Windows (PowerShell):**
```powershell
New-NetFirewallRule -DisplayName "Netdata" -Direction Inbound -LocalPort 19999 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Pluto Agent" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
```

---

## Поддержка

Документация:
- [README.md](README.md) — общее описание системы
- [README-MONITORING.md](README-MONITORING.md) — инструкция по настройке Netdata
- [DEPLOY.md](DEPLOY.md) — инструкция по развёртыванию

Исходный код сборщиков: `/server/src/telemetry/collectors.js`
