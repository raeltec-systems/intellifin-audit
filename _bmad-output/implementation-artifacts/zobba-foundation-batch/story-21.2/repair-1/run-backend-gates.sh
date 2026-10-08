#!/usr/bin/env bash
set -uo pipefail
. /workspace/zobba-build-tools/activate-tests.sh
cd /workspace/intellifin-audit/zobba
/tmp/zobba-story-21-2/repair-1/run-rust.sh || exit "$?"
run_gate() {
  name=$1
  shift
  "$@" > "/tmp/zobba-story-21-2/repair-1/$name.txt" 2>&1
  status=$?
  printf '%s\n' "$status" > "/tmp/zobba-story-21-2/repair-1/$name.exit"
  printf '%s: %s\n' "$name" "$status"
  test "$status" = 0
}
run_gate frozen-clippy cargo clippy --workspace --all-targets --locked --offline -- -D warnings &&
run_gate frozen-rust-build cargo build --workspace --locked --offline &&
/tmp/zobba-story-21-2/repair-1/run-smoke.sh
