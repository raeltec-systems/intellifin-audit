#!/usr/bin/env python3
"""Mutation proof for docs/contracts/tenancy-v1.md (Story 11.1; tenancy-v1 section 6).

Two tests hold the tenancy contract: tests/unit/tenancy-inventory.test.ts (the document against
itself and the Drizzle schema) and tests/integration/table-classification.test.ts (section 3
against the migrated database). This script breaks each rule they hold ONCE in the document,
runs the test file that holds it, and requires the case named for that rule to fail:

- with every case of the file still collected, so a document the parser cannot read (which
  fails the whole file, or every case at once, and names no rule) never counts as a kill;
- with an assertion failure, never a thrown parse error: the parser's structural errors start
  "tenancy-v1:" and are refused as proof.

Three tolerance cases change the document in ways the parser must accept (a heading and a
table row inside a code fence, an escaped pipe in a cell, a decision wrapped onto a second
line) and require that nothing fails in either file. Two control cases break the document so
that it no longer parses, and require the harness to refuse the resulting failures as proof.

The document is copied aside before anything runs. The copy is the restore source, never
`git checkout`, which would also throw away uncommitted work; it is restored in a `finally`
and its SHA-256 must then equal the original's. The script refuses a document with
uncommitted changes unless it is given --allow-uncommitted, so that an interrupted run can
always be undone from git as well.

Run on demand, from any directory, with Node 24 and pnpm on PATH and DATABASE_URL naming a
migrated test database (the integration file refuses any other):

    python3 scripts/verify-tenancy-contract-mutations.py [--case ID ...] [--markdown] [--json PATH]

It is not a CI gate. Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
DOC_RELATIVE = 'docs/contracts/tenancy-v1.md'
DOC = ROOT / DOC_RELATIVE

SUITES: dict[str, list[str]] = {
    'unit': ['tests/unit/tenancy-inventory.test.ts'],
    'integration': ['-c', 'tests/integration/vitest.config.ts', 'tests/integration/table-classification.test.ts'],
}


class AnchorDrift(Exception):
    """A mutation's anchor no longer occurs exactly once: the document moved under it."""


class HarnessError(Exception):
    """The harness could not produce a result it can trust."""


Mutation = Callable[[str], str]


def _occurs_once(text: str, needle: str) -> None:
    count = text.count(needle)
    if count != 1:
        raise AnchorDrift(f'expected exactly one occurrence, found {count}: {needle[:110]!r}')


def replace_once(old: str, new: str) -> Mutation:
    def mutate(text: str) -> str:
        _occurs_once(text, old)
        return text.replace(old, new)
    return mutate


def _line_index(lines: list[str], start: str) -> int:
    hits = [index for index, line in enumerate(lines) if line.startswith(start)]
    if len(hits) != 1:
        raise AnchorDrift(f'expected exactly one line starting {start[:110]!r}, found {len(hits)}')
    return hits[0]


def delete_line(start: str) -> Mutation:
    def mutate(text: str) -> str:
        lines = text.split('\n')
        del lines[_line_index(lines, start)]
        return '\n'.join(lines)
    return mutate


def after_line(start: str, *added: str) -> Mutation:
    def mutate(text: str) -> str:
        lines = text.split('\n')
        index = _line_index(lines, start)
        lines[index + 1:index + 1] = list(added)
        return '\n'.join(lines)
    return mutate


def duplicate_line(start: str) -> Mutation:
    def mutate(text: str) -> str:
        lines = text.split('\n')
        index = _line_index(lines, start)
        lines.insert(index + 1, lines[index])
        return '\n'.join(lines)
    return mutate


@dataclass(frozen=True)
class Case:
    id: str
    rule: str
    suite: str
    # The case that must fail. None marks a tolerance case: nothing may fail, in either file.
    killer: str | None
    mutate: Mutation
    # What the harness must answer: a kill, an accepted tolerance case, or (for a control) a
    # refusal to count a parse error as proof.
    expect: str = 'KILLED'


# Rows and cells the cases below break, spelled exactly as the document spells them.
FLAG3 = '| `public.run_flag` | client/engagement-owned | A flag raised on one Run. |'
FLAG5 = '| `public.run_flag` | tenant, client, engagement | SELECT, INSERT | — | — |'
NOTE = '| `public.notification` | tenant, client, engagement, owner(SELECT) |'
INIT = '| `public.run_initiation_request` | tenant, client, owner | SELECT, INSERT | — | — |'
SNAP = '`review-snapshot-expiry`: SELECT, DELETE, LOCK |'
WAIT_ND = ('`notification-delivery`: SELECT, LOCK; '
           '`wait-timeout`: SELECT, UPDATE(closed_at, closure_kind, answer_option_id, actor), LOCK |')
MESSAGES = ('| `public.run_conversation_message` | tenant, client, engagement | SELECT, INSERT | SELECT, INSERT | '
            '`wait-timeout`: SELECT, INSERT |')
TRANSITIONS = ('| `public.run_interaction_transition` | tenant, client, engagement | SELECT, INSERT | SELECT, INSERT | '
               '`wait-timeout`: SELECT, INSERT |')
WAIT_TIMEOUT_APPENDS = '| `wait-timeout` | Run | yes | yes |'
MEMBER_APPENDS = '| `member` | `platform`, Procedure, Run, registration, binding | yes | yes |'
D3_WRAP = "the runtime only reads it. A tenant's own model policy is Story 13.14a's"

CASES: list[Case] = [
    # Section 3, the classification.
    Case('C1', 'one class per relation', 'unit', 'names each relation once',
         after_line(FLAG3, '| `public.run_flag` | tenant-owned | A second class. |')),
    Case('C2', 'schema-qualified relations (section 3)', 'unit', 'writes every relation schema-qualified',
         replace_once(FLAG3, FLAG3.replace('`public.run_flag`', '`run_flag`'))),
    Case('C3', 'schema-qualified relations (section 4.4)', 'unit', 'writes every relation schema-qualified',
         replace_once('| `public.run_tool_action` | SELECT |', '| `run_tool_action` | SELECT |')),
    Case('C4', 'exact class names', 'unit', 'uses only the five class names',
         replace_once(FLAG3, FLAG3.replace('client/engagement-owned', 'engagement-owned'))),
    Case('C5', 'every Drizzle table classified', 'unit', 'classifies every table the Drizzle schema declares',
         delete_line(FLAG3)),
    # Section 5, the inventory.
    Case('I1', 'a protected table missing from the inventory', 'unit', 'has exactly one row per protected table',
         delete_line(FLAG5)),
    Case('I2', 'a protected table given two inventory rows', 'unit', 'has exactly one row per protected table',
         duplicate_line(FLAG5)),
    Case('I3', 'an infrastructure table given a policy (`pgboss.job`)', 'unit',
         'gives no tenant policy to an authentication or infrastructure table',
         after_line(FLAG5, '| `pgboss.job` | tenant | SELECT | — | — |')),
    Case('I4', 'a class boundary missing (no `engagement`)', 'unit',
         'carries at least its class boundaries on every protected table',
         replace_once(FLAG5, FLAG5.replace('tenant, client, engagement', 'tenant, client'))),
    Case('I5', 'the boundary vocabulary', 'unit', 'uses only tenant, client, engagement and owner as boundaries',
         replace_once(FLAG5, FLAG5.replace('tenant, client, engagement', 'tenant, client, engagement, region'))),
    Case('I6', '`owner(...)` names policy commands (`READ`)', 'unit',
         'narrows only the owner boundary, and only to policy commands',
         replace_once(NOTE, NOTE.replace('owner(SELECT)', 'owner(READ)'))),
    Case('I7', '`owner(...)` never names `LOCK`', 'unit', 'narrows only the owner boundary, and only to policy commands',
         replace_once(NOTE, NOTE.replace('owner(SELECT)', 'owner(SELECT, LOCK)'))),
    Case('I8', '`owner(...)` names a command once', 'unit', 'narrows only the owner boundary, and only to policy commands',
         replace_once(NOTE, NOTE.replace('owner(SELECT)', 'owner(SELECT, SELECT)'))),
    Case('I9', 'only the owner boundary is narrowed', 'unit', 'narrows only the owner boundary, and only to policy commands',
         replace_once(FLAG5, FLAG5.replace('tenant, client, engagement', 'tenant, client, engagement(SELECT)'))),
    Case('I10', '`owner(SELECT)` names every UPDATE a person kind holds', 'unit',
         'names every UPDATE and DELETE a person holds in an owner boundary that names SELECT',
         replace_once('owner(SELECT) | SELECT, INSERT | INSERT |', 'owner(SELECT) | SELECT, INSERT, UPDATE | INSERT |')),
    Case('I11', 'a boundary at most once per row', 'unit', 'names each boundary at most once per row',
         replace_once(NOTE, NOTE.replace('owner(SELECT)', 'owner, owner(SELECT)'))),
    Case('I12', 'a user-owned table has a bare `owner`', 'unit', 'gives every user-owned table a bare owner boundary',
         replace_once(INIT, INIT.replace('tenant, client, owner', 'tenant, client, owner(SELECT)'))),
    Case('I13', 'only the five commands (`TRUNCATE`)', 'unit', 'grants only SELECT, INSERT, UPDATE, DELETE and LOCK',
         replace_once(FLAG5, FLAG5.replace('| SELECT, INSERT |', '| SELECT, TRUNCATE |'))),
    Case('I14', 'only `UPDATE` takes columns', 'unit', 'narrows only UPDATE to columns',
         replace_once(FLAG5, FLAG5.replace('| SELECT, INSERT |', '| SELECT(flag_id), INSERT |'))),
    Case('I15', 'a narrow `UPDATE` names real columns', 'unit', 'names only real columns in a narrow UPDATE',
         replace_once('UPDATE(delivered_at,', 'UPDATE(invented_column, delivered_at,')),
    Case('I16', 'a command at most once per principal', 'unit', 'grants each command at most once per principal kind',
         replace_once(FLAG5, FLAG5.replace('| SELECT, INSERT |', '| SELECT, INSERT, SELECT |'))),
    Case('I17', 'no `UPDATE` beside an `UPDATE(...)` for one principal', 'unit',
         'grants each command at most once per principal kind',
         replace_once(WAIT_ND, WAIT_ND.replace('SELECT, UPDATE(closed_at', 'SELECT, UPDATE, UPDATE(closed_at'))),
    Case('I18', '`LOCK` comes with `SELECT`', 'unit', 'grants SELECT wherever it grants UPDATE, DELETE or LOCK',
         replace_once(WAIT_ND, WAIT_ND.replace('`notification-delivery`: SELECT, LOCK', '`notification-delivery`: LOCK'))),
    Case('I19', '`UPDATE` comes with `SELECT`', 'unit', 'grants SELECT wherever it grants UPDATE, DELETE or LOCK',
         replace_once('`registration-probe`: SELECT, INSERT, UPDATE(state, observed_at, observed_by) |',
                      '`registration-probe`: INSERT, UPDATE(state, observed_at, observed_by) |')),
    Case('I20', '`DELETE` comes with `SELECT`', 'unit', 'grants SELECT wherever it grants UPDATE, DELETE or LOCK',
         replace_once('| `public.run_review_snapshot` | tenant, client, engagement, owner | SELECT, INSERT, DELETE | — |',
                      '| `public.run_review_snapshot` | tenant, client, engagement, owner | INSERT, DELETE | — |')),
    Case('I21', 'someone reads every protected table', 'unit', 'lets some principal read every protected table',
         replace_once(FLAG5, FLAG5.replace('| SELECT, INSERT |', '| INSERT |'))),
    # Section 4.2, the closed list and the maintenance cells.
    Case('P1', 'the closed list names each principal once', 'unit', 'names each maintenance principal once',
         duplicate_line('| `review-snapshot-expiry` |')),
    Case('P2', 'no maintenance principal is named after a principal kind', 'unit',
         'names no maintenance principal after a principal kind',
         after_line('| `review-snapshot-expiry` |', '| `member` | A person. | Their own rows. | the web |')),
    Case('P3', 'an unknown maintenance principal', 'unit', 'names only maintenance principals from the closed list',
         replace_once(FLAG5, FLAG5.replace('| — | — |', '| — | `invented-principal`: SELECT |'))),
    Case('P4', 'every listed principal is used', 'unit', 'uses every maintenance principal of the closed list',
         replace_once(SNAP, '— |')),
    Case('P5', 'each principal says which rows it may reach (D7)', 'unit',
         'D7: says which rows each maintenance principal may reach',
         replace_once('| Deletes expired record-review presentation copies. | Expired snapshots. |',
                      '| Deletes expired record-review presentation copies. | — |')),
    Case('P6', 'an entry is `principal`: COMMANDS', 'unit', 'writes every maintenance entry as `principal`: COMMANDS',
         replace_once(SNAP, SNAP.replace('`review-snapshot-expiry`', 'review-snapshot-expiry'))),
    Case('P7', 'an entry grants at least one command', 'unit', 'grants at least one command in every maintenance entry',
         replace_once(SNAP, '`review-snapshot-expiry`: — |')),
    Case('P8', 'a principal at most once per row', 'unit', 'names each maintenance principal at most once per row',
         replace_once(WAIT_ND, WAIT_ND[:-2] + '; `wait-timeout`: SELECT |')),
    # Section 4.3, the audit append.
    Case('A1', 'appenders are known principals', 'unit', 'names only known principals in the audit append',
         after_line(WAIT_TIMEOUT_APPENDS, '| `invented-appender` | Run | no | no |')),
    Case('A2', 'each appender once', 'unit', 'names each appending principal once', duplicate_line(WAIT_TIMEOUT_APPENDS)),
    Case('A3', 'known aggregates', 'unit', 'names only the known aggregates',
         replace_once(WAIT_TIMEOUT_APPENDS, '| `wait-timeout` | Run, Engagement | yes | yes |')),
    Case('A4', 'receipts and narration are yes or no', 'unit', 'answers yes or no for command receipts and narrated events',
         replace_once(WAIT_TIMEOUT_APPENDS, '| `wait-timeout` | Run | sometimes | yes |')),
    Case('A5', 'member and execution delegation answer yes to both', 'unit',
         'answers yes to both for member and execution delegation',
         replace_once(MEMBER_APPENDS, MEMBER_APPENDS.replace('| yes | yes |', '| no | yes |'))),
    Case('A6', 'an `audit_events` inserter missing from section 4.3', 'unit',
         'lists exactly the principals that insert into audit_events',
         delete_line('| `evidence-read-issuer` | Run | no | no |')),
    Case('A7', 'a section 4.3 principal without `INSERT` on `audit_events`', 'unit',
         'lists exactly the principals that insert into audit_events',
         replace_once('`evidence-read-issuer`: INSERT; ', '')),
    Case('A8', 'the head is locked and advanced', 'unit', 'gives every appending principal the head it locks and advances',
         replace_once('`plan-derivation`: SELECT, INSERT, UPDATE(last_sequence, last_event_hash), LOCK',
                      '`plan-derivation`: SELECT, INSERT, UPDATE(last_sequence), LOCK')),
    Case('A9', 'a UUID aggregate locks `audit_run`', 'unit',
         'gives every appender of a UUID aggregate SELECT and LOCK on audit_run',
         replace_once('`plan-derivation`: SELECT, LOCK; ', '')),
    Case('A10', 'command receipts need the projection grants', 'unit',
         'gives every principal whose events carry a command receipt the projection grants',
         replace_once('| SELECT, INSERT, LOCK | SELECT, LOCK | `wait-timeout`: SELECT, LOCK |',
                      '| SELECT, INSERT, LOCK | SELECT | `wait-timeout`: SELECT, LOCK |')),
    Case('A11', 'narrated events need the narration grants', 'unit',
         'gives every principal whose events are narrated the narration grants',
         replace_once(MESSAGES, MESSAGES.replace('`wait-timeout`: SELECT, INSERT |', '— |'))),
    Case('A12', 'a principal marked no holds no projection grant', 'unit',
         'gives a maintenance principal marked no none of the projection or narration grants',
         replace_once(TRANSITIONS, TRANSITIONS.replace(
             '`wait-timeout`: SELECT, INSERT |', '`evidence-integrity`: SELECT, INSERT; `wait-timeout`: SELECT, INSERT |'))),
    Case('A13', 'a principal outside section 4.3 holds no narration grant', 'unit',
         'gives a closed-list principal outside the audit append no projection or narration grant',
         replace_once(MESSAGES, MESSAGES.replace(
             '`wait-timeout`: SELECT, INSERT |', '`registration-probe`: SELECT, INSERT; `wait-timeout`: SELECT, INSERT |'))),
    # Section 4.4, the Run completion path.
    Case('R1', 'every completion caller reads the frozen plan', 'unit',
         'gives member, execution delegation and wait-timeout every command the completion path runs',
         replace_once('`wait-timeout`: SELECT; `workspace-reaper`: SELECT |', '`workspace-reaper`: SELECT |')),
    Case('R2', 'a completion row nobody holds', 'unit',
         'gives member, execution delegation and wait-timeout every command the completion path runs',
         after_line('| `public.run_tool_action` | SELECT |', '| `public.run_flag` | SELECT |')),
    Case('R3', 'a narrow `UPDATE` covers every column the path writes', 'unit',
         'gives member, execution delegation and wait-timeout every command the completion path runs',
         replace_once('| `public.run_wait` | SELECT, UPDATE(closed_at, closure_kind, actor), LOCK |',
                      '| `public.run_wait` | SELECT, UPDATE(closed_at, closure_kind, actor, opened_at), LOCK |')),
    # Section 7, the decisions.
    Case('E1', 'no decision beyond D7', 'unit', 'records exactly D1 to D7 and open decisions O1 to O9',
         after_line('- **D7. ', '- **D8. An extra decision nobody made.** Story 11.4.')),
    Case('E2', 'no open decision missing', 'unit', 'records exactly D1 to D7 and open decisions O1 to O9',
         delete_line('- **O9. ')),
    Case('E3', 'every decision names its story', 'unit', 'names the story that settles every decision',
         replace_once("A tenant's own model policy is Story 13.14a's `model-policy-v1`",
                      "A tenant's own model policy is a later `model-policy-v1`")),
    Case('E4', 'a line after a blank line is not part of the bullet above it', 'unit',
         'names the story that settles every decision',
         replace_once(D3_WRAP, D3_WRAP.replace(" A tenant's", "\n\n  A tenant's"))),
    Case('E5', 'citations outside section 7 resolve', 'unit', 'cites only decisions §7 records',
         replace_once(FLAG3, FLAG3.replace('A flag raised on one Run.', 'A flag raised on one Run (D9).'))),
    Case('E6', 'citations inside section 7 resolve', 'unit', 'cites only decisions §7 records',
         replace_once("Either one pass per tenant, or a tenantless maintenance context bounded by D7's predicate.",
                      "Either one pass per tenant (see O10), or a tenantless maintenance context bounded by D7's predicate.")),
    Case('E7', 'decision D1: client material', 'unit', 'D1: classifies Procedures, registrations and bindings as client material',
         replace_once('| `public.procedure` | client/engagement-owned |', '| `public.procedure` | tenant-owned |')),
    Case('E8', 'decision D2: `procedure_change` is client material', 'unit', 'D2: classifies procedure_change as client material',
         replace_once('| `public.procedure_change` | client/engagement-owned |', '| `public.procedure_change` | tenant-owned |')),
    Case('E9', 'decision D3: `procedure_configuration` is infrastructure', 'unit', 'D3: keeps procedure_configuration platform infrastructure',
         replace_once('| `public.procedure_configuration` | platform infrastructure |',
                      '| `public.procedure_configuration` | tenant-owned |')),
    Case('E10', 'decision D4: a client boundary beside the owner', 'unit', 'D4: keeps a client boundary beside the owner on run_initiation_request',
         replace_once(INIT, INIT.replace('tenant, client, owner', 'tenant, owner'))),
    Case('E11', 'decision D5: roles and grants are tenant-owned', 'unit', 'D5: classifies user_role and user_permission_grant as tenant-owned',
         replace_once('| `public.user_permission_grant` | tenant-owned |', '| `public.user_permission_grant` | user-owned |')),
    Case('E12', 'decision D6: `notification` is `owner(SELECT)`', 'unit', 'D6: restricts only reads of a notification to its owner, and every command elsewhere',
         replace_once(NOTE, NOTE.replace('owner(SELECT)', 'owner'))),
    # The rules Story 11.4 builds policies from.
    Case('S1', 'scope, not capability', 'unit', 'states that the inventory is scope, not capability',
         replace_once('The inventory states scope, not capability.', 'The inventory states capability.')),
    Case('S2', 'a null scope column means the level above', 'unit',
         'states that a null scope column means the level above, never unrestricted',
         replace_once('**A null scope column means the level above, never unrestricted.**',
                      '**A null scope column means unrestricted.**')),
    Case('S3', 'derived from the production code', 'unit',
         "states that the inventory is derived from the production code's access paths",
         replace_once("derived from the production code's access paths", 'derived from the tests')),
    Case('S4', 'the owner boundary applies to members and delegations only', 'unit',
         'states that the owner boundary applies to members and execution delegations only',
         replace_once(', and applies to members and execution delegations only (D6)', ' (D6)')),
    Case('S5', 'a `LOCK` without `UPDATE` is an UPDATE policy whose `WITH CHECK` is false', 'unit',
         'states that a LOCK without UPDATE is an UPDATE policy whose WITH CHECK is false',
         replace_once(', and a `LOCK` without `UPDATE` is built as an UPDATE policy whose `WITH CHECK` is false: Story 11.6 grants',
                      '. Story 11.6 grants')),
    # The paths the document cites.
    Case('F1', 'a partial path names a real file', 'unit', 'cites only repository paths that exist',
         replace_once('(`derivation-queue.ts`)', '(`derivation-queues.ts`)')),
    Case('F2', 'a full path names a real file', 'unit', 'cites only repository paths that exist',
         replace_once('`appendAuditEvent` in `packages/infrastructure/src/db/audit-events.ts`',
                      '`appendAuditEvent` in `packages/infrastructure/src/audit-events.ts`')),
    # Section 3 against the migrated database.
    Case('B1', 'a relation the database holds has no row', 'integration', 'classifies every relation the database holds',
         delete_line('| `pgboss.warning` |')),
    Case('B2', 'a row names a relation the database does not hold', 'integration',
         'classifies nothing the database does not hold',
         after_line('| `pgboss.warning` |', '| `public.dropped_long_ago` | platform infrastructure | Gone. |')),
    Case('B3', 'a partition given a row', 'integration', 'gives no partition a row of its own, and classifies every partition root',
         after_line('| `pgboss.warning` |', '| `pgboss.job_common` | platform infrastructure | A partition. |')),
    Case('B4', 'a partition root left unclassified', 'integration',
         'gives no partition a row of its own, and classifies every partition root',
         delete_line('| `pgboss.job` |')),
    Case('B5', 'an owned sequence given a row', 'integration',
         'gives no owned sequence a row of its own, and classifies every owning table',
         after_line('| `drizzle.__drizzle_migrations` |',
                    "| `drizzle.__drizzle_migrations_id_seq` | platform infrastructure | The migration record's id sequence. |")),
    Case('B6', 'the table owning a sequence left unclassified', 'integration',
         'gives no owned sequence a row of its own, and classifies every owning table',
         delete_line('| `drizzle.__drizzle_migrations` |')),
    Case('B7', 'a protected table owns a sequence', 'integration', 'lets no protected table own a sequence',
         replace_once('| `drizzle.__drizzle_migrations` | platform infrastructure |',
                      '| `drizzle.__drizzle_migrations` | tenant-owned |')),
    Case('B8', 'an unprotected table references a protected one', 'integration',
         'protects every table that references a protected table',
         replace_once(FLAG3, FLAG3.replace('client/engagement-owned', 'platform infrastructure'))),
    # Tolerance: the parser must accept each of these, and nothing may fail in either file.
    Case('T1', 'a heading and a table row inside a code fence are text', 'both', None,
         after_line('| `drizzle.__drizzle_migrations` |', '', '```text', '## 5. Policy inventory',
                    '### 4.2 Maintenance principals', '| `public.fenced_example` | tenant-owned | Inside a fence. |', '```'),
         expect='ACCEPTED'),
    Case('T2', 'an escaped pipe belongs to its cell', 'both', None,
         replace_once(FLAG3, FLAG3.replace('A flag raised on one Run.', 'A flag raised on one Run \\| never on a Procedure.')),
         expect='ACCEPTED'),
    Case('T3', 'a wrapped decision keeps its continuation line', 'both', None,
         replace_once(D3_WRAP, D3_WRAP.replace(" A tenant's", "\n  A tenant's")), expect='ACCEPTED'),
    # Controls: an unescaped pipe makes the document unreadable. The unit file then fails before
    # it runs a case, and every integration case throws the parser's error; neither is a kill.
    Case('X1', 'control: a parse error in the unit file is not a kill', 'unit', 'names each relation once',
         replace_once(FLAG3, FLAG3.replace('A flag raised on one Run.', 'A flag | raised on one Run.')),
         expect='NOT PROVEN'),
    Case('X2', 'control: a parse error in the integration file is not a kill', 'integration',
         'classifies every relation the database holds',
         replace_once(FLAG3, FLAG3.replace('A flag raised on one Run.', 'A flag | raised on one Run.')),
         expect='NOT PROVEN'),
]


@dataclass
class Outcome:
    collected: int
    passed: list[str]
    failed: dict[str, list[str]]
    other: list[str]
    file_errors: list[str]


def _tail(text: str, lines: int = 20) -> str:
    return '\n'.join(text.strip().splitlines()[-lines:])


def run_suite(suite: str, workdir: Path) -> Outcome:
    report = workdir / f'vitest-{suite}.json'
    report.unlink(missing_ok=True)
    completed = subprocess.run(
        ['pnpm', 'exec', 'vitest', 'run', *SUITES[suite], '--reporter=json', f'--outputFile={report}'],
        cwd=ROOT, env=os.environ, capture_output=True, text=True,
    )
    if not report.exists():
        raise HarnessError(f'Vitest wrote no report for the {suite} file (exit {completed.returncode}):\n'
                           f'{_tail(completed.stdout)}\n{_tail(completed.stderr)}')
    data = json.loads(report.read_text(encoding='utf-8'))
    cases = [case for result in data['testResults'] for case in result['assertionResults']]
    return Outcome(
        collected=len(cases),
        passed=[case['title'] for case in cases if case['status'] == 'passed'],
        failed={case['title']: case.get('failureMessages') or [] for case in cases if case['status'] == 'failed'},
        other=[f"{case['title']} ({case['status']})" for case in cases if case['status'] not in ('passed', 'failed')],
        file_errors=[result['message'] for result in data['testResults'] if result.get('message')],
    )


def clean(outcome: Outcome, expected: int) -> bool:
    return (outcome.collected == expected and len(outcome.passed) == expected
            and not outcome.failed and not outcome.other and not outcome.file_errors)


def is_assertion(message: str) -> bool:
    # A broken rule fails an expectation; the parser never does, it throws "Error: tenancy-v1: ...".
    return message.lstrip().startswith('AssertionError')


def verdict(case: Case, outcomes: dict[str, Outcome], baseline: dict[str, Outcome]) -> str:
    for suite, outcome in outcomes.items():
        if outcome.collected != baseline[suite].collected or outcome.file_errors or outcome.other:
            return f'NOT PROVEN ({suite} file did not run every case)'
    if case.killer is None:
        failed = [title for outcome in outcomes.values() for title in outcome.failed]
        return 'ACCEPTED' if not failed else 'REFUSED (' + '; '.join(failed) + ')'
    messages = outcomes[case.suite].failed.get(case.killer)
    if messages is None:
        return 'SURVIVED'
    if not messages or not all(is_assertion(message) for message in messages):
        return 'NOT PROVEN (failed without an assertion)'
    return 'KILLED'


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def refuse(message: str) -> None:
    print(f'verify-tenancy-contract-mutations: {message}', file=sys.stderr)
    sys.exit(2)


def preflight(allow_uncommitted: bool) -> None:
    if not os.environ.get('DATABASE_URL'):
        refuse('DATABASE_URL must name a migrated test database; the integration file holds section 3 against it.')
    if shutil.which('pnpm') is None:
        refuse('pnpm is not on PATH.')
    node = subprocess.run(['node', '--version'], capture_output=True, text=True)
    if node.returncode != 0 or not node.stdout.strip().startswith('v24.'):
        refuse(f'Node 24 is required on PATH (found {node.stdout.strip() or "no node"}).')
    status = subprocess.run(['git', '-C', str(ROOT), 'status', '--porcelain', '--', DOC_RELATIVE],
                            capture_output=True, text=True)
    if status.returncode != 0:
        refuse(f'git could not report the status of {DOC_RELATIVE}: {status.stderr.strip()}')
    if status.stdout.strip() and not allow_uncommitted:
        refuse(f'{DOC_RELATIVE} has uncommitted changes. Commit them first, or pass --allow-uncommitted '
               '(the document is still restored from a copy, but git can no longer undo an interrupted run).')


def main() -> int:
    parser = argparse.ArgumentParser(description='Mutation proof for docs/contracts/tenancy-v1.md.')
    parser.add_argument('--case', action='append', default=[], metavar='ID', help='run only this case (repeatable)')
    parser.add_argument('--allow-uncommitted', action='store_true',
                        help='run although the document has uncommitted changes')
    parser.add_argument('--markdown', action='store_true', help='print the results as a Markdown table')
    parser.add_argument('--json', type=Path, metavar='PATH', help='also write the results as JSON')
    options = parser.parse_args()

    preflight(options.allow_uncommitted)
    ids = [case.id for case in CASES]
    duplicated = sorted({case_id for case_id in ids if ids.count(case_id) > 1})
    unknown = sorted(set(options.case) - set(ids))
    if duplicated or unknown:
        refuse(f'duplicate case ids {duplicated}, unknown --case ids {unknown}')
    selected = [case for case in CASES if not options.case or case.id in options.case]

    original_text = DOC.read_text(encoding='utf-8')
    drift = []
    for case in selected:
        try:
            if case.mutate(original_text) == original_text:
                drift.append(f'{case.id}: the mutation changes nothing')
        except AnchorDrift as error:
            drift.append(f'{case.id}: {error}')
    if drift:
        refuse('Mutation anchor drift. Repoint these anchors to the document as it now reads:\n  ' + '\n  '.join(drift))

    workdir = Path(tempfile.mkdtemp(prefix='tenancy-mutations-'))
    backup = workdir / 'tenancy-v1.original.md'
    shutil.copyfile(DOC, backup)
    original = sha256(backup)
    # SIGTERM becomes SystemExit, so the finally below restores the document on a kill too.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))

    results: list[dict[str, object]] = []
    restored = False
    try:
        baseline = {suite: run_suite(suite, workdir) for suite in SUITES}
        for suite, outcome in baseline.items():
            if outcome.collected == 0 or not clean(outcome, outcome.collected):
                raise HarnessError(f'the {suite} file does not pass on the unmutated document: '
                                   f'{len(outcome.passed)}/{outcome.collected} passed, failed {sorted(outcome.failed)}, '
                                   f'other {outcome.other}, file errors {outcome.file_errors}')
            titles = outcome.passed
            if len(set(titles)) != len(titles):
                raise HarnessError(f'the {suite} file has two cases with one name; a named kill would be ambiguous')
        for case in selected:
            if case.killer is not None and case.killer not in baseline[case.suite].passed:
                raise HarnessError(f'{case.id} names a case the {case.suite} file does not have: {case.killer!r}')

        for case in selected:
            DOC.write_text(case.mutate(original_text), encoding='utf-8')
            try:
                suites = list(SUITES) if case.suite == 'both' else [case.suite]
                outcomes = {suite: run_suite(suite, workdir) for suite in suites}
            finally:
                shutil.copyfile(backup, DOC)
            result = verdict(case, outcomes, baseline)
            also = sorted(title for outcome in outcomes.values() for title in outcome.failed if title != case.killer)
            results.append({'id': case.id, 'rule': case.rule, 'suite': case.suite, 'case': case.killer or '(nothing may fail)',
                            'expected': case.expect, 'verdict': result, 'alsoFailed': also,
                            'held': result.startswith(case.expect)})
            print(f'{result:48} {case.id:4} {case.rule}', flush=True)
    finally:
        shutil.copyfile(backup, DOC)
        restored = sha256(DOC) == original
        if restored:
            shutil.rmtree(workdir, ignore_errors=True)
        else:
            print(f'The document was NOT restored: its SHA-256 differs from {original}. '
                  f'The original is kept at {backup}.', file=sys.stderr)
    if not restored:
        return 3

    after_dir = Path(tempfile.mkdtemp(prefix='tenancy-mutations-after-'))
    try:
        after = {suite: run_suite(suite, after_dir) for suite in SUITES}
    finally:
        shutil.rmtree(after_dir, ignore_errors=True)
    after_clean = all(clean(outcome, baseline[suite].collected) for suite, outcome in after.items())

    if options.markdown:
        print('\n| Id | Rule | File | Named case | Verdict |\n|---|---|---|---|---|')
        for row in results:
            print(f"| {row['id']} | {row['rule']} | {row['suite']} | {row['case']} | {row['verdict']} |")
    groups = {'KILLED': 'mutations killed by their named case', 'ACCEPTED': 'tolerance cases accepted',
              'NOT PROVEN': 'controls refused as proof'}
    print()
    for expected, words in groups.items():
        rows = [row for row in results if row['expected'] == expected]
        if rows:
            print(f"{sum(1 for row in rows if row['held'])} of {len(rows)} {words}.")
    print(f'Document restored: SHA-256 {original}. After the run: ' + '; '.join(
        f'{suite} {len(outcome.passed)}/{outcome.collected} passed' for suite, outcome in after.items()) + '.')
    if options.json is not None:
        options.json.write_text(json.dumps({'sha256': original, 'results': results, 'after': {
            suite: {'collected': outcome.collected, 'passed': len(outcome.passed), 'failed': sorted(outcome.failed)}
            for suite, outcome in after.items()}}, indent=1) + '\n', encoding='utf-8')
    return 0 if all(row['held'] for row in results) and after_clean else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except HarnessError as error:
        print(f'verify-tenancy-contract-mutations: {error}', file=sys.stderr)
        sys.exit(2)
