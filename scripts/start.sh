#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

command -v docker >/dev/null 2>&1 || { echo "Docker CLI was not found." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker Engine is not running. Start Docker Desktop / Docker Engine." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (docker compose)." >&2; exit 1; }

LAN_IP=""
if command -v ip >/dev/null 2>&1; then
  LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1)"
fi
if [ -z "$LAN_IP" ] && command -v hostname >/dev/null 2>&1; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
[ -n "$LAN_IP" ] || LAN_IP="192.168.31.47"
ANDROID_BASE_URL="${BAJAJ_ANDROID_API_BASE_URL:-http://${LAN_IP}:8080/}"
ANDROID_ENV="apps/android/.env"
if [ ! -f "$ANDROID_ENV" ] || [ -n "${BAJAJ_ANDROID_API_BASE_URL:-}" ]; then
  printf 'EXPO_PUBLIC_API_BASE_URL=%s\n' "$ANDROID_BASE_URL" > "$ANDROID_ENV"
else
  EXISTING="$(sed -n 's/^[[:space:]]*EXPO_PUBLIC_API_BASE_URL[[:space:]]*=[[:space:]]*//p' "$ANDROID_ENV" | head -n 1)"
  [ -z "$EXISTING" ] || ANDROID_BASE_URL="$(printf '%s' "$EXISTING" | tr -d '"')"
fi

echo "QuantaEdge | Lucky Bajaj — local stack"
echo "Customer web : http://localhost:3000"
echo "Staff web    : http://localhost:3001"
echo "Backend API  : http://localhost:8080"
echo "Android API  : $ANDROID_BASE_URL"

docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml up --build -d

echo "Waiting for the API and both websites…"
i=0
while [ "$i" -lt 90 ]; do
  if curl -fsS http://localhost:8080/actuator/health >/dev/null 2>&1 \
    && curl -fsS http://localhost:3000/ >/dev/null 2>&1 \
    && curl -fsS http://localhost:3001/ >/dev/null 2>&1; then
    echo ""
    echo "All services are responding:"
    echo "Customer website : http://localhost:3000"
    echo "Staff portal     : http://localhost:3001"
    echo "Backend API      : http://localhost:8080"
    echo "Android device   : $ANDROID_BASE_URL"
    docker compose -f compose.yaml ps
    exit 0
  fi
  i=$((i + 1))
  sleep 2
done

echo "Stack did not become healthy. Recent service logs:" >&2
docker compose -f compose.yaml logs --tail=100
exit 1
