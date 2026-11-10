#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
if [ -z "${PREFIX:-}" ] || [[ "$PREFIX" != *com.termux* ]]; then
  echo 'Ce programme doit être exécuté dans Termux.'; exit 1
fi
pkg install -y nodejs-lts git python make clang
npm ci --omit=dev
mkdir -p .private
if [ ! -s .private/hosting.env ]; then
  read -r -s -p 'Clé DeepSeek (saisie masquée) : ' ye_key
  printf '\n'
  [ -n "$ye_key" ] || { echo 'Clé absente : installation arrêtée.'; exit 1; }
  printf 'DEEPSEEK_API_KEY=%s\n' "$ye_key" > .private/hosting.env
  unset ye_key
fi
chmod 600 .private/hosting.env
echo 'Installation terminée. Démarrer avec : bash scripts/start-termux.sh'
echo 'Puis ouvrir http://127.0.0.1:3191 dans Chrome sur cette tablette.'
