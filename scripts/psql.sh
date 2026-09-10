#!/usr/bin/env sh
# Host `psql` is not installed; the local Supabase DB container ships psql 17.6.
# SQL files are fed in over stdin because they live on the host, not in the container.
set -eu
CONTAINER="${SEPAK_DB_CONTAINER:-supabase_db_sepak}"
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "container $CONTAINER is not running; run: supabase start" >&2
  exit 1
fi
exec docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
