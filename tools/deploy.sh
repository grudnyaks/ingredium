#!/usr/bin/env bash
# Публикует папку app/ в ветку gh-pages (GitHub Pages). Запуск из корня репозитория.
set -euo pipefail
python3 tests/e2e.py
tmp=$(mktemp -d)
cp -r app/. "$tmp/"
touch "$tmp/.nojekyll"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git push -f "$(git -C "$OLDPWD" remote get-url origin)" gh-pages
echo "Опубликовано: https://grudnyaks.github.io/ingredium/"
