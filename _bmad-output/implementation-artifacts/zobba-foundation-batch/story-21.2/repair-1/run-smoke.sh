#!/usr/bin/env bash
set -uo pipefail
. /workspace/zobba-build-tools/activate-tests.sh
cd /workspace/intellifin-audit/zobba
export CARGO_NET_OFFLINE=true
export RUST_TEST_THREADS=1
export ZOBBA_TEST_MIGRATION_DATABASE_URL=postgresql://zobba_patch20_3_owner@127.0.0.1:55434/zobba_patch20_3_test
export ZOBBA_TEST_RUNTIME_DATABASE_URL=postgresql://zobba_patch20_3_app@127.0.0.1:55434/zobba_patch20_3_test
export ZOBBA_TEST_ADMIN_DATABASE_URL=postgresql://zobba_local_admin@127.0.0.1:55434/zobba_patch20_3_test
python3 scripts/smoke.py > /tmp/zobba-story-21-2/repair-1/frozen-smoke.txt 2>&1
result=$?
printf '%s\n' "$result" > /tmp/zobba-story-21-2/repair-1/frozen-smoke.exit
exit "$result"
