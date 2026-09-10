# ─── PLUTO Agent: сборка на самой Windows-машине (самый надёжный путь) ───────
# Запуск НА WINDOWS (PowerShell):
#     cd <папка-репозитория>\agent
#     powershell -ExecutionPolicy Bypass -File .\build.ps1
#
# Go на Windows по умолчанию собирает под Windows — кросс-компиляция не нужна.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Разрядность текущей ОС (AMD64 или ARM64)
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'ARM64') { $goarch = 'arm64' } else { $goarch = 'amd64' }
Write-Host "→ Сборка под Windows/$goarch (OS: $arch)"

# Go на Windows всегда даёт PE-бинарник, но фиксируем платформу явно.
$env:GOOS = 'windows'
$env:GOARCH = $goarch
go build -trimpath -o pluto-agent.exe .
if ($LASTEXITCODE -ne 0) { throw "go build завершился с ошибкой (код $LASTEXITCODE)" }

# Самопроверка заголовка PE: первые 2 байта должны быть "MZ" (77 90).
$bytes = [System.IO.File]::ReadAllBytes("$PSScriptRoot\pluto-agent.exe")[0..1]
if ($bytes[0] -eq 77 -and $bytes[1] -eq 90) {
    Write-Host "✓ OK: заголовок PE (MZ) подтверждён — бинарник Windows."
    Write-Host "✓ Готовый файл: $PSScriptRoot\pluto-agent.exe"
    Write-Host ""
    Write-Host "Установка службой:"
    Write-Host "    .\pluto-agent.exe -install -server ws://<IP>:8443/ws -token <ТОКЕН>"
} else {
    Write-Host "✗ ОШИБКА: заголовок $($bytes[0]) $($bytes[1]) — файл не является Windows-PE."
    exit 1
}
