# Collation probe attempt disposition

Attempt 1: synthetic Task seed hit tasks_current_cycle after skills_write set deferred constraints immediate. Added explicit fixture SET CONSTRAINTS tasks_current_cycle DEFERRED before paired Task/cycle inserts.

Attempt 2: both 64-row assignment traversals passed; probe-only impact assertion had an ambiguous PL/pgSQL item variable versus JSON element alias. Qualified e.item and e.position.

Attempt 3: passed on newly created en_US.utf8 libc database; default text order was proven different from the independently literal ASCII order. Traversed 64 clients, 64 engagements, and 192 impact references for each restricted-all/exact-version query, including within-Task revision page boundaries. All attempts dropped only the database created by that run and verified its absence. No production behavior changed for either fixture correction.

The earlier successful repair catalog and hashes are retained in schema-stage1/. Final catalog regeneration is a rollback against the guarded existing test database; published migration/catalog prefixes 1–8 remain byte-identical.
