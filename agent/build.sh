#!/usr/bin/env bash
# ─── PLUTO Agent: кросс-сборка под Windows + самопроверка ───────────────────
# Запуск НА СЕРВЕРЕ (Linux/Ubuntu):
#     bash agent/build.sh
# Готовый файл появится рядом: agent/pluto-agent.exe
set -euo pipefail
cd "$(dirname "$0")"

GOOS_TARGET="${1:-windows}"
GOARCH_TARGET="${2:-amd64}"

echo "→ Сборка PLUTO Agent: GOOS=$GOOS_TARGET GOARCH=$GOARCH_TARGET"
GOOS="$GOOS_TARGET" GOARCH="$GOARCH_TARGET" go build -trimpath -o pluto-agent.exe .

# Самопроверка: настоящий Windows-PE начинается с "MZ" (0x4D 0x5A).
# Если сюда попал Linux-ELF (0x7F 'E'), файл запускаться на Windows не будет.
head -c 2 pluto-agent.exe | od -An -tx1 | tr -d ' \n' > /tmp/pluto_hdr
HDR=$(cat /tmp/pluto_hdr)
SIZE=$(stat -c%s pluto-agent.exe 2>/dev/null || stat -f%z pluto-agent.exe)

if [ "$HDR" = "4d5a" ]; then
  echo "✓ OK: заголовок PE (MZ) подтверждён — это бинарник Windows."
  echo "✓ Размер: $SIZE байт"
  echo ""
  echo "Готовый файл:  $(pwd)/pluto-agent.exe"
  echo "Скопируйте его на Windows-машину (например, в C:\\pluto\\) и выполните:"
  echo "    .\\pluto-agent.exe -install -server ws://<IP>:8443/ws -token <ТОКЕН>"
else
  echo "✗ ОШИБКА: заголовок '$HDR' — файл собран НЕ под Windows (скорее всего, Linux-ELF)."
  echo "  Убедитесь, что команда сборки содержит GOOS=windows GOARCH=amd64."
  exit 1
fi
