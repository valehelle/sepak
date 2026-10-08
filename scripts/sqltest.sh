#!/usr/bin/env sh
# Runs one SQL test file inside a transaction that is always rolled back,
# after supabase/tests/_prelude.sql. Pass --raw to run a file without the
# prelude (for suites that test the real, signed-in entry points).
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "${1:-}" = "--raw" ]; then
  shift
  { echo 'begin;'; cat "$1"; echo 'rollback;'; } | sh "$DIR/psql.sh"
else
  { echo 'begin;'; cat "$DIR/../supabase/tests/_prelude.sql" "$1"; echo 'rollback;'; } | sh "$DIR/psql.sh"
fi
