#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
mkdir -p .private
# Atomic lock avoids two connectors using the same session on this tablet.
exec 9>.private/termux.lock
flock -n 9 || { echo 'Le bot est déjà lancé sur cette tablette.'; exit 1; }
termux-wake-lock
trap 'termux-wake-unlock' EXIT
echo 'Bot YE : http://127.0.0.1:3191 — Ctrl+C pour arrêter.'
node scripts/whatsapp-qr-pilot.mjs
