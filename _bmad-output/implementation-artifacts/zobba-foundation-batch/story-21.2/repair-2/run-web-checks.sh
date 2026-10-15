#!/usr/bin/env bash
set -euo pipefail
. /workspace/zobba-build-tools/activate-tests.sh
cd /workspace/intellifin-audit/zobba
result=0
pnpm --filter @zobba/web check > /tmp/zobba-story-21-2/repair-2/web-check.log 2>&1 || result=$?
printf '%s\n' "$result" > /tmp/zobba-story-21-2/repair-2/web-check.exit
if [ "$result" -ne 0 ]; then exit "$result"; fi
pnpm --filter @zobba/web build > /tmp/zobba-story-21-2/repair-2/web-build.log 2>&1 || result=$?
printf '%s\n' "$result" > /tmp/zobba-story-21-2/repair-2/web-build.exit
exit "$result"
