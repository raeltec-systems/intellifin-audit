### Successful excerpt capture and recovery lack verification through their public routes

- **Changed surface:** Exact object reads feed excerpt capture and automatic-capture recovery in `zobba/crates/api/src/knowledge.rs:805` and `zobba/crates/api/src/knowledge.rs:864`.
- **Impacted consumer or site:** The source recovery button and byte-range form in `zobba/web/src/EvidenceKnowledge.tsx:24`, mounted by `zobba/web/src/EvidenceWorkspace.tsx:332`.
- **Existing test evidence:** `Regression gap`: `zobba/crates/api/tests/knowledge_http.rs:351` starts the router without object storage; its excerpt test at line 591 submits only an invalid range. `zobba/crates/infrastructure/tests/knowledge.rs:917` and line 933 call repository methods directly with prepared capture data. The browser test at `zobba/web/tests/browser/knowledge.spec.ts:175` checks that recovery is enabled, then leaves without invoking it. Repository-wide searches for `record_excerpt`, `recover_capture`, their HTTP routes, `EvidenceKnowledge`, and both control labels found no successful public-route exercise.
- **Missing verification:** A successful request must read the registered original, persist the requested exact byte range or recover missing automatic capture, and expose the resulting source identity and text.
- **Demonstration:** Returning `knowledge_unavailable` from either handler after request validation would leave the checked tests passing: invalid requests still refuse, repository tests bypass the handlers, and acquisition uses a different producer path.
- **Consequence:** Both advertised source-capture controls could fail for valid originals while verification passes.
- **Suggested test shape:** Use the existing real object-storage browser fixture to capture a nonzero UTF-8 byte range and recover an incomplete capture; assert resulting text, offsets, immutable source identity, and exact retry behavior.

### Knowledge verification never rejects a changed Task epoch or methodology binding in the checked tests

- **Changed surface:** `KnowledgeRepository::verify` rejects mismatched execution epochs and methodology bindings at `zobba/crates/infrastructure/src/knowledge.rs:904`.
- **Impacted consumer or site:** `readKnowledge` relies on this verification before returning context to the Task inspector at `zobba/web/src/knowledge.ts:117`.
- **Existing test evidence:** `Regression gap`: Repository-wide searches for `VerifyKnowledge`, `/knowledge/verify`, and their consumers identified `zobba/crates/infrastructure/tests/knowledge.rs:3045` and `zobba/crates/api/tests/knowledge_http.rs:410`. Both supply the current epoch and binding; their refusal cases change source standing or authority. The browser-port test at `zobba/web/tests/knowledge.test.mjs:133` supplies an unconditional mocked 409 and checks the outgoing fields.
- **Missing verification:** Independently assert that an obsolete execution epoch and an obsolete methodology binding each produce a conflict while record revisions and source access remain unchanged.
- **Demonstration:** Removing the comparison at `knowledge.rs:904` would preserve all assertions described above: source corrections and access revocations still fail elsewhere, and the mocked response remains 409.
- **Consequence:** The verification endpoint could certify context against an obsolete Task basis, undermining the browser’s current-context guarantee.
- **Suggested test shape:** Capture a valid verification request, advance the Task epoch or methodology binding through its owning workflow, and assert rejection of the old request and acceptance of a fresh one.

### Applied Guide standing is unverified at the knowledge consumer

- **Changed surface:** `checked_view` derives Received versus Applied standing from the original Guide’s events at `zobba/crates/infrastructure/src/knowledge.rs:572`.
- **Impacted consumer or site:** Knowledge cards display this standing as attribution at `zobba/web/src/TaskKnowledge.tsx:38`.
- **Existing test evidence:** `Regression gap`: `zobba/crates/infrastructure/tests/knowledge.rs:508` asserts only Received standing. The browser suite stops its worker at `zobba/web/tests/browser/knowledge.spec.ts:26`; its Guide test at line 183 checks text and original Task identity, without checking Applied standing. Repository-wide searches for `checked_view`, `project_guide`, standing assertions, and the Applied message found no test observing the applied branch.
- **Missing verification:** After the original Guide is applied, knowledge inspection must report Applied while retaining its original Task, cycle, command, and text.
- **Demonstration:** Always returning the Received message at `knowledge.rs:575` would satisfy the existing standing assertion and the checked HTTP/browser assertions.
- **Consequence:** Applied guidance could remain labeled pending in working knowledge, giving auditors an incorrect account of its status.
