# Reproduce the original failure separately

The committed negative receipts were captured before the two production files
were repaired. A negative command against repaired production must not be called
a reproduction: the wrapper refuses that state with exit 2. Use an isolated
worktree containing the repair tests and the original two production files.

These commands assume this managed environment's installed tools and local
guarded test PostgreSQL service. Run after checking out the repaired checkpoint.
Do not run concurrently with another fixture using port 9444 or its disposable
test database. No development database is selected.

```bash
. /workspace/zobba-build-tools/activate-tests.sh
repair_source=$(git rev-parse --show-toplevel)
negative_root=$(mktemp -d /tmp/zobba-unicode-negative.XXXXXX)
negative_repo="$negative_root/repo"
git -C "$repair_source" worktree add --detach "$negative_repo" HEAD
git -C "$negative_repo" restore --source=26271284b03d5114f6ead2146092c5e1a50fdd7c -- zobba/web/src/evidence.ts zobba/web/src/EvidenceWorkspace.tsx
python3 - "$negative_repo" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1]) / 'zobba/web/tests/evidence.test.mjs'
# The old module has no new-input helper export. Omit only that import in this
# isolated test copy; the name filter runs the six unchanged parity groups.
# The helper-specific test is excluded. Production files remain exact baseline.
s = p.read_text()
assert s.count(', trimEvidenceWhitespace }') == 1
p.write_text(s.replace(', trimEvidenceWhitespace }', ' }'))
PY
pnpm --dir "$negative_repo/zobba" install --frozen-lockfile
export ZOBBA_UNICODE_REPOSITORY_DIR="$negative_repo"
export ZOBBA_UNICODE_EVIDENCE_DIR="$negative_root/evidence"
repair_commands="$repair_source/_bmad-output/implementation-artifacts/zobba-foundation-batch/story-21.1-unicode/commands.sh.txt"
bash "$repair_commands" negative-unit
bash "$repair_commands" negative-browser
```

Both commands should return **exit 1**, with six parity groups and three browser
scenarios failing on the original incompatibility. Run both commands separately
if your shell stops on nonzero exits. A setup/build/fixture failure is not a
successful negative control; inspect the logs for the expected assertions.

The final browser test strengthens fresh acquisition with a U+FEFF filename;
the historical baseline receipt used the earlier ordinary filename. Both versions
exercise the original source-entry refusal. Raw historical receipts are preserved
as recorded, rather than relabelled as execution of the later test snapshot.

The worktree is disposable and deliberately dirty; retain it and its evidence for
inspection or remove only this newly created worktree when finished. Do not
restore the primary working tree or rewrite accepted records to run a control.
