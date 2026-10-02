#!/usr/bin/env bash
set -euo pipefail
. /workspace/zobba-build-tools/activate-tests.sh
cd /workspace/intellifin-audit/zobba
for task in api:generate check build; do
  name=${task//:/-}
  result=0
  pnpm "$task" > "/tmp/zobba-story-21-2/repair-1/web-$name.log" 2>&1 || result=$?
  printf '%s\n' "$result" > "/tmp/zobba-story-21-2/repair-1/web-$name.exit"
  if [ "$result" -ne 0 ]; then exit "$result"; fi
done
