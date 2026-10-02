# Epic 21 Context: Use firm methods and trustworthy working material

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give auditors attributable evidence, applicable firm methods, trusted techniques and scoped working knowledge for continuing audit work. Preserve current authority and source lineage as material is acquired, interpreted, found and reused. Admin configuration uses ordinary validated Save; evidence identity alone establishes neither truth nor completeness.

## Stories

- Story 21.1: Acquire and inspect immutable scoped evidence
- Story 21.2: Save and bind applicable firm methodology
- Story 21.3: Install and select trusted skills
- Story 21.4: Remember scoped working knowledge with its basis
- Story 21.5: Acquire documents through a firm-owned connection
- Story 21.6: Find working material without losing provenance

## Requirements & Constraints

Methodology defines requirements; skills provide techniques; knowledge records scoped facts and decisions; evidence supplies inspectable support. None grants access or manufactures review. Admin alone grants neither client-evidence access nor audit sign-off. Preserve the approved continuity safeguard: every organisation retains an active, non-expiring Admin membership linked to an active identity, enforced atomically across membership and identity changes. Additional temporary Admins and ordinary Save remain supported.

Methodology packages include criteria and authority, applicable areas/periods, populations, evidence checks, ratings, templates, review rules and suitable skills. Validated Save atomically records an attributable immutable version and scoped effective assignment; invalid input leaves the prior version effective. Imported interpretations remain sourced, editable proposals until Save. Undo creates a successor. Incomplete scoped overrides cannot erase inherited mandatory requirements. Business applicability differs from save time; latest-saved is not a policy-selection rule. Demonstration packs are opt-in and neutral starters are labelled.

Bind applicable method/template versions and period before substantive evaluation, with an inspectable reason. Changes default to new Tasks. Explicit application to active Tasks commits a binding change at a safe boundary and recomputes affected draft dependencies. Preserve in-flight basis and actual outcomes; reviewed or issued work requires a successor or reconsideration. Uncertain semantic changes are potentially material. Current restrictions and recalls override pinning; chat replies and optional preferences cannot override required controls. Configuration Save needs no second approver.

Installed skill versions declare purpose, applicability, method compatibility, inputs/outputs, resources/digests, provenance, availability scope and requested tools/effects. Explain the selected version and technique. Auditors can choose skills or override optional advice. Disable stops new selection; recall blocks further faulty-version use and identifies affected work. Retrieved instruction-like documents remain evidence until deliberately installed through the trusted catalog. Requested capabilities never confer permission; scripts use isolated analysis.

Keep personal, firm, client and engagement knowledge distinct. Record exact attributable decisions, supported facts with certainty/period, unsupported assertions as assertions, and reversible low-risk preferences. Cross-engagement reuse requires explicit eligible scope, current access and applicability; summarisation cannot turn client facts into firm-wide knowledge. Conflicts stay visible. Corrections or revocations invalidate dependent knowledge, summaries, embeddings, previews and pending disclosure. Empty or partial retrieval never proves absence.

Immutable originals retain acquisition identity, actor/scope, account/location, available source version, time, query/selection, known coverage, digest and size. Derivations remain separate with exact inputs and methods; citations resolve to registered evidence. Connector acquisition checks current account, resource, purpose, consent and delegation. Owner departure or expired consent blocks dependent work with a repair action. Credentials never enter browser clients, context, analysis or logs. Supplier notices and webhooks require reacquiring and checking actual authorised content.

## Technical Decisions

Continue the single Rust backend and fresh PostgreSQL authority with React/TypeScript Pair UI. Domain/application meaning stays independent of SQL, HTTP and provider types; infrastructure implements application-owned ports. PostgreSQL owns durable scoped state; S3 owns binary originals. Modules own their commands and records, with explicit versioned contracts. Historical code supplies selectively adopted fixtures/assets, not a second Node domain authority.

Use application filters, forced row-level security, non-owner runtime roles, scoped foreign keys and transaction-local context. Recheck current authority at read, dispatch and disclosure boundaries. Filter scope/access/period before retrieval ranking. Context fragments retain kind, source/configuration/version, scope, freshness, confidence and dependency manifests; record meaningful omissions. Compaction rehydrates exact decisions and unresolved work from durable records. Reauthorise late results before disclosure or reuse; retained restricted history is not current model/viewer access.

Object writes cannot join a database transaction. Reserve immutable identity, conditionally upload, independently verify stored bytes/size/digest, then register; retry against the same reservation. Quarantine incomplete/orphan objects. Never overwrite originals or publish partial/substituted material. Parsers and document programs execute only in bounded isolated analysis with selected inputs and no acquisition credentials.

Verify positive and negative isolation, integrity, revocation, effective-period selection, inherited rules, skill recall and knowledge dependency invalidation. Use real PostgreSQL scope tests and object-store interruption/substitution/retry fixtures. Connector qualification needs a real designated Graph tenant; deterministic fixtures alone do not establish external qualification.

## UX & Interaction Patterns

Settings → Methodology and skills exposes ordinary Save, validation, assignment scope/effective period and new-versus-active-work impact. Show method/skill identity in the Working brief and What Zobba is using, with eligible knowledge correction, exclusion, update, forgetting and preference Undo. Material conflicts receive focused questions rather than blanket memory approval.

Keep client/engagement scope and source/version/acquisition status visible. Distinguish bounded previews from original downloads and partial, stale, unreadable or unavailable material from empty results. Preserve conversation, inspected selection and keyboard focus through claim → citation → evidence → return navigation. Search is bounded and paginated; cross-client results permit navigation without combining context. Apply WCAG 2.2 AA, including keyboard, screen-reader and narrow-layout checks.

## Cross-Story Dependencies

21.1 depends on 20.2 and 20.5; 21.2 on 20.6; 21.3 on 21.2; 21.4 on 20.4, 21.1 and 21.2; 21.5 on 20.5, 20.6 and 21.1; 21.6 on 21.1 and 21.4. Methodology, trusted skills, knowledge and evidence are prerequisites for the first complete Task and later analysis, evaluation and review; catalog installation alone does not implement agent invocation.
