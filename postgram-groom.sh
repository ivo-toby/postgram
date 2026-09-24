#!/bin/bash
set -euo pipefail

LOG="/home/haasie/postgram/postgram-groom.log"
CONTAINER="postgram-mcp-server-1"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')

TELEGRAM_TOKEN="8386959259:AAEW-TukTDeS3d1TjeZMIHeSiBVfQBQCsr8"
TELEGRAM_CHAT_ID="987136532"

echo "=== Postgram Groom Run: $TIMESTAMP ===" > "$LOG"

# Stap 1 — analyseer en markeer durable memories ouder dan 7 dagen (LLM classificatie)
echo "[1/3] Markeren durable memories (7d)..." >> "$LOG"
docker exec "$CONTAINER" pgm-admin memory groom-durable --older-than 7d --mode mark --yes >> "$LOG" 2>&1

# Stap 2 — samenvoegen/herschrijven doorvoeren
echo "[2/3] Apply durable grooming..." >> "$LOG"
docker exec "$CONTAINER" pgm-admin memory apply-durable-grooming --mode auto --yes >> "$LOG" 2>&1

# Stap 3 — session context promoten/archiveren (ouder dan 7 dagen, max 50 per client)
echo "[3/3] Session context groom (promote)..." >> "$LOG"
docker exec "$CONTAINER" pgm-admin memory groom --all-clients --older-than 7d --mode promote --limit 50 --yes >> "$LOG" 2>&1

echo "=== Done ===" >> "$LOG"

# Telegram notificatie
SAMENVATTING=$(tail -20 "$LOG")
# Encode summary for URL using Python3
ENCODED_SUMMARY=$(echo "$SAMENVATTING" | python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.stdin.read()))")

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d text="🧹 <b>Postgram groom voltooid</b> op ${TIMESTAMP}%0A%0A<code>${ENCODED_SUMMARY}</code>" \
  -d parse_mode="HTML" > /dev/null
