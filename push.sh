#!/usr/bin/env bash
# ─── PLUTO: первый пуш в https://github.com/sergei2121/plutomain ─────────────
# Запускать из корня проекта (там, где лежит package.json):
#   chmod +x push.sh && ./push.sh
set -u

REPO="https://github.com/sergei2121/plutomain.git"
BRANCH="main"

g() { printf '\033[32m✓\033[0m %s\n' "$*"; }
y() { printf '\033[33m!\033[0m %s\n' "$*"; }
r() { printf '\033[31m✗\033[0m %s\n' "$*"; }
b() { printf '\033[36m→\033[0m %s\n' "$*"; }

# ── проверки окружения ───────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || { r "git не найден. Установите: sudo apt install git"; exit 1; }
[ -f package.json ] || { r "Запустите скрипт из корня проекта (там, где package.json)."; exit 1; }
g "git найден: $(git --version)"

# ── чувствительные файлы не должны улететь ───────────────────────────────────
[ -f .gitignore ] || { r "Нет .gitignore — откажусь пушить, чтобы не слить .env и node_modules."; exit 1; }
if [ -f .env ]; then
  if git check-ignore -q .env 2>/dev/null; then
    g ".env присутствует, но исключён из коммита (.gitignore)"
  else
    r ".env НЕ исключён из коммита — остановлен. Добавьте '.env' в .gitignore."; exit 1
  fi
fi

# ── репозиторий и ветка ──────────────────────────────────────────────────────
if [ ! -d .git ]; then
  b "Инициализирую git-репозиторий…"
  git init -q
fi
git branch -M "$BRANCH"
g "Ветка: $BRANCH"

if git remote get-url origin >/dev/null 2>&1; then
  CUR=$(git remote get-url origin)
  if [ "$CUR" != "$REPO" ]; then
    b "Перенаправляю origin: $CUR → $REPO"
    git remote set-url origin "$REPO"
  fi
else
  git remote add origin "$REPO"
fi
g "origin: $REPO"

# ── что улетит ───────────────────────────────────────────────────────────────
git add -A
COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
[ "$COUNT" -gt 0 ] || { r "Нечего коммитить — всё уже отправлено."; exit 0; }
b "Файлов в коммите: $COUNT"
git diff --cached --name-only | head -12 | sed 's/^/    /'
[ "$COUNT" -gt 12 ] && echo "    … и ещё $((COUNT - 12))"

# ── коммит и пуш ─────────────────────────────────────────────────────────────
git -c user.name="${GIT_AUTHOR_NAME:-PLUTO}" -c user.email="${GIT_AUTHOR_EMAIL:-pluto@pluto.local}" \
  commit -q -m "PLUTO $(cat VERSION 2>/dev/null || echo 2.0.0): ядро, relay-агент и веб-консоль"
g "Коммит создан"

b "Пушу в $REPO (ветка $BRANCH)…"
if git push -u origin "$BRANCH" 2>&1; then
  g "Готово! Репозиторий: https://github.com/sergei2121/plutomain"
else
  r "GitHub отклонил пуш. Скорее всего, нужна авторизация:"
  echo
  echo "  Вариант 1 — HTTPS + токен (PAT):"
  echo "    1) GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens"
  echo "    2) создайте токен с доступом к plutomain (Contents: Read and write)"
  echo "    3) повторите ./push.sh; на запрос пароля вставьте токен (логин — sergei2121)"
  echo
  echo "  Вариант 2 — SSH:"
  echo "    git remote set-url origin git@github.com:sergei2121/plutomain.git && ./push.sh"
fi
