#!/usr/bin/env bash
# Restore a custom-format dump into a PostgreSQL database in the Docker Compose
# stack. This is destructive: objects in the target database are dropped and
# recreated from the dump. The script refuses to run without RESTORE_CONFIRM=yes.
#
# Usage:
#   RESTORE_CONFIRM=yes ./scripts/restore.sh backups/kampalasmart-....dump
#   RESTORE_CONFIRM=yes ./scripts/restore.sh dump.dump kampalasmart_restore_drill
#
# Environment overrides:
#   COMPOSE_FILE, ENV_FILE, POSTGRES_SERVICE, POSTGRES_USER, POSTGRES_DB
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: RESTORE_CONFIRM=yes $0 <dump-file> [target-database]" >&2
  exit 1
fi

if [[ "${RESTORE_CONFIRM:-}" != "yes" ]]; then
  echo "Refusing to restore without RESTORE_CONFIRM=yes." >&2
  echo "Restoring drops and recreates objects in the target database." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
DB_USER="${POSTGRES_USER:-kampala}"
TARGET_DB="${2:-${POSTGRES_DB:-kampalasmart}}"
FILE="$1"

if [[ ! -s "$FILE" ]]; then
  echo "Dump file not found or empty: $FILE" >&2
  exit 1
fi
if [[ ! "$TARGET_DB" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "Unsafe database name: $TARGET_DB" >&2
  exit 1
fi

compose_args=(-f "$COMPOSE_FILE")
if [[ -n "${ENV_FILE:-}" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
fi

echo "Ensuring database '$TARGET_DB' exists"
exists="$(docker compose "${compose_args[@]}" exec -T "$POSTGRES_SERVICE" \
  psql -U "$DB_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'")"
if [[ "$exists" != "1" ]]; then
  docker compose "${compose_args[@]}" exec -T "$POSTGRES_SERVICE" \
    createdb -U "$DB_USER" "$TARGET_DB"
fi

echo "Restoring $FILE into '$TARGET_DB'"
docker compose "${compose_args[@]}" exec -T "$POSTGRES_SERVICE" \
  pg_restore -U "$DB_USER" -d "$TARGET_DB" \
  --clean --if-exists --no-owner --no-privileges --single-transaction \
  < "$FILE"

echo "Restore complete."
echo "Verify before switching traffic:"
echo "  docker compose ${compose_args[*]} exec $POSTGRES_SERVICE psql -U $DB_USER -d $TARGET_DB -c '\\dt'"
echo "  docker compose ${compose_args[*]} exec $POSTGRES_SERVICE psql -U $DB_USER -d $TARGET_DB -c 'SELECT COUNT(*) FROM \"Sale\";'"
