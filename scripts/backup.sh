#!/usr/bin/env bash
# Create a custom-format PostgreSQL backup from the Docker Compose stack.
#
# Usage:
#   ./scripts/backup.sh
#   COMPOSE_FILE=docker-compose.prod.yml ENV_FILE=.env.production ./scripts/backup.sh
#
# Environment overrides:
#   BACKUP_DIR (default: ./backups)   RETENTION_DAYS (default: 30)
#   POSTGRES_SERVICE (default: postgres)   POSTGRES_USER / POSTGRES_DB
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
DB_USER="${POSTGRES_USER:-kampala}"
DB_NAME="${POSTGRES_DB:-kampalasmart}"

compose_args=(-f "$COMPOSE_FILE")
if [[ -n "${ENV_FILE:-}" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
fi

umask 077
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/${DB_NAME}-${STAMP}.dump"

echo "Dumping database '$DB_NAME' to $FILE"
docker compose "${compose_args[@]}" exec -T "$POSTGRES_SERVICE" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner --no-privileges \
  > "$FILE"

if [[ ! -s "$FILE" ]]; then
  echo "Backup failed: dump file is empty." >&2
  rm -f "$FILE"
  exit 1
fi

echo "Backup complete: $(du -h "$FILE" | cut -f1)"

if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.dump" -type f \
    -mtime "+$RETENTION_DAYS" -print -delete || true
fi
