#!/usr/bin/env bash
set -euo pipefail
. /workspace/zobba-build-tools/activate-tests.sh
cd /workspace/intellifin-audit/zobba
export ZOBBA_TEST_MIGRATION_DATABASE_URL=postgresql://zobba_local_admin@127.0.0.1:55434/zobba_story_20_test
export ZOBBA_TEST_RUNTIME_DATABASE_URL=postgresql://zobba_app@127.0.0.1:55434/zobba_story_20_test
export ZOBBA_TEST_ADMIN_DATABASE_URL=postgresql://zobba_local_admin@127.0.0.1:55434/zobba_story_20_test
export ZOBBA_FIXTURE_DIR=/tmp/zobba-story-21-2/browser-fixture
export ZOBBA_BROWSER_EXECUTABLE=/usr/bin/chromium
export ZOBBA_BROWSER_OUTPUT_DIR=/tmp/zobba-story-21-2/repair-1/browser-access-results
python3 -c "import sys; sys.path.insert(0,'scripts'); import smoke; smoke.test_urls()"
psql "$ZOBBA_TEST_MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL' > /tmp/zobba-story-21-2/repair-1/browser-access-reset.log 2>&1
DO $$ BEGIN IF current_database()<>'zobba_story_20_test' THEN RAISE EXCEPTION 'wrong disposable target'; END IF; END $$;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
printf '0\n' > /tmp/zobba-story-21-2/repair-1/browser-access-reset.exit
result=0
pnpm test:browser tests/browser/conversation-review.spec.ts --workers=1 --retries=0 > /tmp/zobba-story-21-2/repair-1/browser-access.log 2>&1 || result=$?
printf '%s\n' "$result" > /tmp/zobba-story-21-2/repair-1/browser-access.exit
exit "$result"
