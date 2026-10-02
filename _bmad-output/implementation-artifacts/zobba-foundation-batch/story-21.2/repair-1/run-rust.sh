#!/usr/bin/env bash
set -euo pipefail
. /workspace/zobba-build-tools/activate-tests.sh
cd /workspace/intellifin-audit/zobba
. /tmp/zobba-story-21-2/rust-fixture/env.sh
export ZOBBA_FIXTURE_DIR=/tmp/zobba-story-21-2/rust-fixture
export ZOBBA_FIXTURE_PORT=9446
export RUST_TEST_THREADS=1
export ZOBBA_FIXTURE_APP_PORT=5173
export ZOBBA_OIDC_ISSUER=https://127.0.0.1:9446
export ZOBBA_PUBLIC_ORIGIN=https://localhost:5173
export ZOBBA_OIDC_REDIRECT_URI=https://localhost:5173/api/auth/callback
export ZOBBA_TEST_MIGRATION_DATABASE_URL=postgresql://zobba_patch20_3_owner@127.0.0.1:55434/zobba_patch20_3_test
export ZOBBA_TEST_RUNTIME_DATABASE_URL=postgresql://zobba_patch20_3_app@127.0.0.1:55434/zobba_patch20_3_test
export ZOBBA_TEST_ADMIN_DATABASE_URL=postgresql://zobba_local_admin@127.0.0.1:55434/zobba_patch20_3_test
python3 - <<'PY'
import socket
with socket.socket() as connection:connection.bind(('127.0.0.1',9446))
PY
node fixtures/oidc/server.mjs > /tmp/zobba-story-21-2/repair-1/rust-idp.txt 2>&1 &
fixture_pid=$!
finish() {
  result=$?
  trap - EXIT
  kill "$fixture_pid" 2>/dev/null || true
  wait "$fixture_pid" 2>/dev/null || true
  printf '%s\n' "$result" > /tmp/zobba-story-21-2/repair-1/rust-tests.exit
  exit "$result"
}
trap finish EXIT
curl --cacert "$ZOBBA_OIDC_CA_FILE" --retry 10 --retry-connrefused --retry-delay 1 --max-time 2 --fail --silent --output /dev/null "$ZOBBA_OIDC_ISSUER/.well-known/openid-configuration"
cargo test --workspace --locked --offline > /tmp/zobba-story-21-2/repair-1/rust-tests.txt 2>&1
