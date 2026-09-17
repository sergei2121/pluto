# Сбор данных с Glances

## Обзор

Система уже содержит встроенную поддержку сбора телеметрии из Glances через API.

## Как это работает

### 1. Функция `collectGlances(url)` (server/src/server.js, строка 423)

Функция пытается получить данные следующими способами (по порядку):

1. **API v4** - запрос к `/api/4/all`
2. **API v3** - запрос к `/api/3/all`  
3. **HTML парсинг** - парсинг главной страницы для извлечения метрик

### 2. Использование в системе

Для добавления агента с Glances:

```javascript
// Через API системы
POST /api/agent
{
  "name": "Server Name",
  "ip": "x.x.x.x",
  "glancesUrl": "http://x.x.x.x:61208",
  "telemetrySource": "glances"
}
```

### 3. Интервал сбора

Интервал сбора данных Glances настраивается в `lib.js`:
```javascript
intervals: { glances: 20 } // 20 секунд по умолчанию
```

## Тестирование подключения

Запустите тестовый скрипт:

```bash
node test-glances.js http://x.x.x.x:61208
```

Замените `x.x.x.x` на реальный IP адрес вашего сервера с Glances.

## Требования к Glances

1. Glances должен быть запущен в режиме веб-сервера:
   ```bash
   glances -w
   ```

2. Порт 61208 должен быть доступен для подключения

3. Для API доступа может потребоваться настройка CORS (если серверы в разных сетях)

## Пример данных от Glances API

```json
{
  "cpu": { "total": 25.5 },
  "mem": { "percent": 65.2, "used": 4294967296, "total": 8589934592 },
  "network": [
    { "interface_name": "eth0", "rx": 1234567, "tx": 7654321 }
  ],
  "fs": [
    { "mnt_point": "/", "percent": 45.0, "used": 10737418240, "size": 21474836480 }
  ],
  "uptime": "3 days, 4:23:15",
  "sensors": [
    { "label": "CPU", "value": 55.0, "unit": "°C" }
  ]
}
```

## Настройка в Docker

Если используете docker-compose:

```yaml
services:
  pluto-server:
    environment:
      - GLANCES_URL=http://x.x.x.x:61208
```

## Troubleshooting

### Ошибка подключения
- Проверьте доступность порта: `telnet x.x.x.x 61208`
- Убедитесь что Glances запущен: `systemctl status glances` или `ps aux | grep glances`

### Ошибка API
- Проверьте версию Glances: `glances --version`
- Попробуйте вручную: `curl http://x.x.x.x:61208/api/4/all`

### HTML парсинг не работает
- Убедитесь что веб-интерфейс доступен в браузере
- Проверьте что страница содержит data-value атрибуты
