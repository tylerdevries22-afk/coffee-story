#!/usr/bin/env bash
# Applies every migration in order against SUPABASE_DB_URL (the direct
# Postgres connection string from the Supabase dashboard, *not* the REST URL).
# Plain psql, in filename order; each file is idempotent-safe to re-run only
# where it says so, so track what has been applied (Supabase's own migration
# table, or run this once per environment).
set -euo pipefail
: "${SUPABASE_DB_URL:?set SUPABASE_DB_URL to the direct Postgres connection string}"
for file in "$(dirname "$0")"/migrations/*.sql; do
  echo "== applying ${file##*/}"
  psql "$SUPABASE_DB_URL" --set ON_ERROR_STOP=1 -f "$file"
done
echo "migrations applied"
