#!/usr/bin/env bash
set -uo pipefail
. /workspace/zobba-build-tools/activate-tests.sh
cd /workspace/intellifin-audit/zobba
run_gate() {
  name=$1
  shift
  "$@" > "/tmp/zobba-story-21-2/repair-1/$name.txt" 2>&1
  status=$?
  printf '%s\n' "$status" > "/tmp/zobba-story-21-2/repair-1/$name.exit"
  printf '%s: %s\n' "$name" "$status"
  test "$status" = 0
}
run_gate frozen-fmt cargo fmt --check &&
run_gate frozen-python python3 -B -m unittest discover -s scripts -p 'test_*.py' &&
run_gate frozen-boundaries python3 scripts/check-boundaries.py &&
run_gate frozen-fixtures pnpm fixture:test
