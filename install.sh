#!/usr/bin/env bash
# PLUTO — проверка целостности репозитория и пересборка.
# Запуск на сервере:  bash install.sh
set -e
cd "$(dirname "$0")"

V=$(cat VERSION 2>/dev/null || echo "?")
echo "PLUTO v$V — проверка файлов…"

MISSING=0
for f in docker-compose.yml server/Dockerfile server/package.json server/src/server.js server/src/lib.js agent/main.go agent/go.mod index.html src/App.tsx; do
  if [ -f "$f" ]; then
    echo "  ✓ $f"
  else
    echo "  ✗ ОТСУТСТВУЕТ: $f"
    MISSING=1
  fi
done

if [ "$MISSING" = "1" ]; then
  echo ""
  echo "Часть файлов не дошла до сервера. Синхронизируйте репозиторий целиком"
  echo "(git pull / копирование всех файлов), затем повторите: bash install.sh"
  exit 1
fi

echo ""
echo "Все файлы на месте. Пересобираю образ…"
docker compose build --progress=plain
docker compose up -d

echo ""
echo "Проверяю ядро…"
sleep 2
H=$(curl -s http://localhost:8080/api/health || true)
echo "  /api/health → $H"
if echo "$H" | grep -q "\"version\":\"$V\""; then
  echo "✓ Ядро актуально (v$V). Откройте консоль: http://<IP>:8080 (Ctrl+Shift+R)"
else
  echo "✗ Версия ядра не совпадает с $V — проверьте docker compose logs core"
  exit 1
fi
