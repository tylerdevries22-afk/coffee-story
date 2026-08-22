#!/usr/bin/env bash
# Superseded: migrations moved to supabase/migrations/ (Supabase CLI layout,
# with a real ledger). Apply them with:
#   supabase db push            # against the linked hosted project
#   supabase start              # local/CI stack (applies them automatically)
# This shim keeps old runbooks from silently applying nothing.
echo "migrate.sh is superseded: migrations live in supabase/migrations/ and are applied with the Supabase CLI (supabase db push / supabase start)." >&2
exit 1
