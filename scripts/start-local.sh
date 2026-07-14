#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PNPM_VERSION="10.20.0"

usage() {
  cat <<'EOF'
Lantern AI local one-click startup

Usage:
  ./scripts/start-local.sh

The script installs dependencies, starts PostgreSQL/Redis, applies Prisma
migrations, creates starter data only when the database is empty, and starts
Web/API/Worker together. Press Ctrl+C to stop application processes.

Docker data remains available between runs. To stop containers later:
  docker compose down
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 0 ]]; then
  printf 'Unknown argument: %s\n\n' "$1" >&2
  usage >&2
  exit 2
fi

cd "$ROOT_DIR"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_command node
require_command npm
require_command docker

if ! docker info >/dev/null 2>&1; then
  printf 'Docker is not running. Start Docker Desktop, then run this script again.\n' >&2
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  printf 'Global pnpm was not found; using pnpm %s through npx.\n' "$PNPM_VERSION"
  PNPM=(npx --yes "pnpm@${PNPM_VERSION}")
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  printf 'Created local .env from .env.example.\n'
fi

read_env_value() {
  awk -v target="$1" '
    index($0, target "=") == 1 {
      sub("^[^=]*=", "")
      print
      exit
    }
  ' .env
}

write_env_value() {
  local key="$1"
  local value="$2"
  local temporary
  temporary="$(mktemp "${TMPDIR:-/tmp}/lantern-env.XXXXXX")"
  chmod 600 "$temporary"
  awk -v target="$key" -v replacement="$value" '
    BEGIN { replaced = 0 }
    index($0, target "=") == 1 {
      print target "=" replacement
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print target "=" replacement
    }
  ' .env > "$temporary"
  mv "$temporary" .env
  chmod 600 .env
}

ensure_model_key() {
  local variable="$1"
  local label="$2"
  local current
  local entered
  current="$(read_env_value "$variable")"
  if [[ -n "$current" ]]; then
    return
  fi
  if [[ ! -t 0 ]]; then
    printf '%s is empty in .env. Run interactively or fill it manually.\n' "$variable" >&2
    exit 1
  fi
  read -r -s -p "$label API key: " entered
  printf '\n'
  if [[ -z "$entered" ]]; then
    printf '%s cannot be empty.\n' "$variable" >&2
    exit 1
  fi
  write_env_value "$variable" "$entered"
}

ensure_model_key TEXT_MODEL_API_KEY DeepSeek
ensure_model_key IMAGE_MODEL_API_KEY Qwen-Image

export_env_value() {
  local key="$1"
  local value
  value="$(read_env_value "$key")"
  if [[ -n "$value" ]]; then
    export "$key=$value"
  fi
}

export_env_value APP_ENV
export_env_value API_PORT
export_env_value LANTERN_API_INTERNAL_URL
export_env_value LANTERN_DEV_USER_EMAIL
export_env_value NEXT_PUBLIC_LANTERN_API_URL
export_env_value NEXT_PUBLIC_LANTERN_UPLOAD_API_URL

printf '\n[1/5] Installing dependencies...\n'
"${PNPM[@]}" install --frozen-lockfile

printf '\n[2/5] Starting PostgreSQL and Redis...\n'
docker compose up -d --wait postgres redis

printf '\n[3/5] Generating Prisma client...\n'
"${PNPM[@]}" db:generate

printf '\n[4/5] Applying migrations and checking starter data...\n'
"${PNPM[@]}" db:migrate
"${PNPM[@]}" db:seed:if-empty

printf '\n[5/5] Starting Lantern AI...\n'
printf 'Web will be available at the URL printed below. Press Ctrl+C to stop.\n\n'
exec "${PNPM[@]}" dev
