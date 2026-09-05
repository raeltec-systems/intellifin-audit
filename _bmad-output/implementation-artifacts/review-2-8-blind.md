# Story 2.8 — blind review

Captured diff: 240,776 bytes; SHA-256 `31078947807d724d81354f8531bcd630df3c2301ba85449c04e16e2b25e2f208`. Context-free reviewer; findings below retain each claim and requested action. Final severity and routing belong to the coordinator's triage.

- Builder resolves selected versions through the oldest-100 list: version 101 can be created but redirects to 404. Fetch selected identity directly and verify owning Procedure/state.
- New version authorizes before the transaction lock, allowing a queued request after role revocation. Recheck authorization in the transaction.
- Ripple discovery validates every Active version before filtering, so an unreadable unrelated version blocks unrelated changes. Query the affected subset first.
- Tool changes are advertised but fan-out compares only model identity. Implement a supported tool tuple or explicitly refuse unsupported publication kinds.
- New Procedure creation ignores published current configuration and uses process dependencies. Connect it to authoritative publication or enforce consistency.
- External modelId is trimmed without checking its type. Validate the complete JSON shape before property access.
- Revision replay ignores changeKind and accepts contradictory event metadata. Compare complete publication identity.
- Configuration and replay tables lack SQL update protection despite being described as immutable identities. Protect historical records while allowing the current pointer to advance.
- Platform Draft creation does not notify its responsible human. Add transactional idempotent notification.
- Retired Version review omits successor data and falsely states that no successor is recorded. Resolve actual succession.
- New version failures are caught without telemetry/correlation context. Record safe operational failure before the unknown-outcome response.
- New version's render-delayed busy flag lacks duplicate/lost-response tests. Add a synchronous guard and proof that committed-response loss blocks further requests.
