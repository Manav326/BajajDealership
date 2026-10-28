#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

command -v docker >/dev/null 2>&1 || { echo "Docker CLI was not found." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker Engine is not running. Start Docker Desktop / Docker Engine." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (docker compose)." >&2; exit 1; }

# Generate a random first-owner setup token in the ignored local .env.
GENERATED_BOOTSTRAP_TOKEN=0
ROOT_ENV=".env"
ROOT_ENV_EXISTS=0
[ -f "$ROOT_ENV" ] && ROOT_ENV_EXISTS=1
if ! grep -Eq '^[[:space:]]*APP_BOOTSTRAP_TOKEN[[:space:]]*=[[:space:]]*[^[:space:]]+' "$ROOT_ENV" 2>/dev/null; then
  if command -v openssl >/dev/null 2>&1; then
    NEW_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
  else
    NEW_BOOTSTRAP_TOKEN="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \\n')"
  fi
  if [ "$ROOT_ENV_EXISTS" -eq 0 ]; then
    cat > "$ROOT_ENV" <<EOF
POSTGRES_DB=bajaj_dealership
POSTGRES_USER=bajaj_app
POSTGRES_PASSWORD=bajaj_local_only
POSTGRES_PORT=5432
API_PORT=8080
CUSTOMER_WEB_PORT=3000
STAFF_WEB_PORT=3001
APP_BOOTSTRAP_TOKEN=$NEW_BOOTSTRAP_TOKEN
EOF
  elif grep -Eq '^[[:space:]]*APP_BOOTSTRAP_TOKEN[[:space:]]*=' "$ROOT_ENV"; then
    awk -v token="$NEW_BOOTSTRAP_TOKEN" '
      BEGIN { written = 0 }
      /^[[:space:]]*APP_BOOTSTRAP_TOKEN[[:space:]]*=/ {
        if (!written) print "APP_BOOTSTRAP_TOKEN=" token
        written = 1
        next
      }
      { print }
      END { if (!written) print "APP_BOOTSTRAP_TOKEN=" token }
    ' "$ROOT_ENV" > "$ROOT_ENV.tmp"
    mv "$ROOT_ENV.tmp" "$ROOT_ENV"
  else
    printf '\\nAPP_BOOTSTRAP_TOKEN=%s\\n' "$NEW_BOOTSTRAP_TOKEN" >> "$ROOT_ENV"
  fi
  GENERATED_BOOTSTRAP_TOKEN=1
fi
if [ "$GENERATED_BOOTSTRAP_TOKEN" -eq 1 ]; then
  echo ""
  echo "One-time initial owner setup token (local only):"
  sed -n 's/^[[:space:]]*APP_BOOTSTRAP_TOKEN[[:space:]]*=[[:space:]]*//p' "$ROOT_ENV" | tail -n 1
  echo "Use this in the X-Bootstrap-Token header for POST /api/v1/system/bootstrap."
  echo "After owner setup, remove APP_BOOTSTRAP_TOKEN from .env and restart the API."
  echo ""
fi

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
