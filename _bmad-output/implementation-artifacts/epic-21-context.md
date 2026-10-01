# Epic 21 Context: Use firm methods and trustworthy working material

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give auditors attributable evidence, applicable firm methods, trusted techniques, and scoped working knowledge that can support continuing work. Preserve current authority and source lineage as material is acquired, interpreted, found, and reused. Admin configuration is a validated Save; evidence identity does not establish source truth or completeness.

## Stories

- Story 21.1: Acquire and inspect immutable scoped evidence
- Story 21.2: Save and bind applicable firm methodology
- Story 21.3: Install and select trusted skills
- Story 21.4: Remember scoped working knowledge with its basis
- Story 21.5: Acquire documents through a firm-owned connection
- Story 21.6: Find working material without losing provenance

## Requirements & Constraints

Registered originals retain their source, account, acquisition time, available version, query or selection, known coverage, measured content identity, actor, and scope. Derived material and annotations are separate attributable objects. Keep the lineage from source and acquisition through analysis, claims, work products, review, and issuance. A matching hash proves byte identity only; it does not prove truth, completeness, or sufficiency.

Admin can validate and save attributable immutable methodology versions and scoped effective assignments without a second approval. New work binds the applicable version before substantive evaluation. Active work changes require an explicit impact choice and safe-boundary application; inherited requirements, historical basis, and reviewed or issued work remain intact. Skills are trusted, versioned techniques with declared purpose, applicability, inputs, outputs, resources, and requested effects. Skills and retrieved content cannot grant access; a document that resembles instructions remains evidence unless deliberately installed through the trusted catalog.

Keep personal, firm, client, and engagement knowledge distinct. Identify whether information is a supported fact, user assertion, decision, or preference, with attribution, source, freshness, and correction status. Filter by current scope, authority, and applicability before retrieval and recheck before disclosure. Corrections or revocations invalidate dependent knowledge and previews. An empty or partial search never proves absence; inaccessible client material never becomes firm-wide context by summarization.

Connector acquisition uses current account, resource, purpose, consent, and delegation checks. Credentials stay in scoped custody and out of logs, context, analysis, and browser clients. Supplier notices or webhooks are hints: obtain and verify the actual authorized content before treating it as received or sufficient. Isolation, secret containment, and integrity require both positive and negative tests, including revocation and missing or changed bytes.

## Technical Decisions

Use the own Rust backend and fresh PostgreSQL schema. PostgreSQL owns scoped metadata and durable state; S3 owns binary originals. Keep domain and application meaning independent of SQL, HTTP, and storage-provider types; application-owned ports are implemented by infrastructure, and the API exposes generated contracts. External object writes do not join a PostgreSQL transaction. Reserve an immutable object identity, upload conditionally, read back and verify measured bytes, size, and digest, then register. Retry registration against the same reservation; never overwrite or register partial, substituted, or mismatched bytes. Keep incomplete uploads quarantined and unavailable as evidence. Apply current authority to every metadata read and object read. Tests need real PostgreSQL scope coverage and object-store refusal, interruption, retry, substitution, and read-back fixtures; local owned test stores or protocol fixtures do not require paid cloud resources.

Evidence, methodology, skills, and working knowledge have distinct meanings even where they share storage. Methodology provides requirements, skills provide techniques, knowledge provides scoped facts and decisions, and evidence provides inspectable material. No parser or document program runs in the application process; analysis receives selected immutable inputs through its separately bounded environment. Historical implementation behavior may provide useful fixtures, but the new Rust model and schema own runtime authority.

## UX & Interaction Patterns

Keep the engagement and client scope visible wherever material is inspected or acquired. Present source lineage and metadata with an explicit distinction between a bounded preview and the original download. Preserve the selected item and keyboard focus when following citations, opening details, returning to a claim, or moving between conversation and workspace. Search results identify their client and source status; they never imply combined cross-client context. Show partial, stale, unreadable, or unavailable material honestly. Methodology and skills use ordinary validated Save with visible scope and affected-work information. Meet WCAG 2.2 AA, including labeled controls, keyboard access, announced state changes, and usable narrow-screen inspection.

## Cross-Story Dependencies

Story 21.1 depends on 20.2 and 20.5. Story 21.2 depends on membership administration in 20.6; 21.3 depends on 21.2. Story 21.4 depends on 20.4, 21.1, and 21.2. Story 21.5 depends on 20.5, 20.6, and 21.1. Story 21.6 depends on 21.1 and 21.4. Methodology, skills, scoped knowledge, and registered evidence feed the first complete Task and later analysis, evaluation, and work-product review.
