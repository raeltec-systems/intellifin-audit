# Admin continuity: owner decision

**1 October 2026 (Africa/Lusaka). Approved by the owner after acceptance of the Unicode repair at `9a76c5c`. Story 20.6 remains owner-accepted. Implementation is tracked in the [Admin continuity specification](../spec-20-6-admin-continuity-safeguard.md).**

Each organisation must retain **at least one active, non-expiring Admin membership attached to an active application identity**. Additional temporary Admins remain allowed.

At the accepted Unicode checkpoint, the last-Admin guard accepted another currently eligible Admin with a future expiry. Two Admins could therefore both acquire finite expiries, and both later expire without another write. The historical predicate in [migration 0005](../../../zobba/migrations/0005_membership_administration.sql#L227) implements current eligibility rather than guaranteed continuity through time; that published migration remains unchanged.

A Save that would remove, deactivate, demote or give an expiry to the last qualifying Admin must fail atomically with a clear instruction to establish a replacement first. Membership and identity lifecycle mutations must share database-enforced serialisation so concurrent edits cannot each rely on the other Admin. Once a replacement exists, the original edit is an ordinary Save. **No second approver or approval ceremony** is added for membership, assignment or methodology edits.

Pending, expired or revoked invitations do not count as replacements. An accepted Admin invitation can count only after it establishes an active non-expiring membership and active identity. Invitation expiry and normal sign-in/session expiry remain independent.

Membership expiry applies to all roles on the membership. A non-expiring member with combined audit roles also retains those roles without a membership deadline; engagement scope and assignment expiry still apply. Prefer an Admin-only continuity membership where enduring audit roles are inappropriate. This safeguard grants no audit authority or engagement access by itself.

For existing organisations, first report those without a qualifying Admin. A currently authorised Admin must explicitly nominate a replacement or clear an existing membership expiry through an attributed Save. Do not silently promote anyone, remove expiry or revive an identity in a migration. An organisation where every Admin has already expired needs a separately authorised owner-verification recovery procedure. Rollout must account for these organisations explicitly before enforcing the rule.

This protects continuity against membership expiry, membership changes and application identity deactivation/removal, including direct owner SQL. It does not establish availability of the human or their external identity provider. Establish a qualifying replacement before routine offboarding; referenced identity deletion must also preserve historical attribution. No emergency exception or recovery bypass is authorised by this safeguard. Security response and owner-verification recovery remain separate operating obligations; external identity-provider suspension is outside this database invariant.

Qualify first/second expiry saves, concurrent membership and identity changes, multi-organisation identity deactivation, identity removal, inactive identities, pending versus accepted invitations, exact replay and stale versions, unchanged ordinary edits, and passage of time beyond temporary memberships. Preserve published migrations; add database enforcement in a new migration, with atomic first-Admin provisioning and explicit preflight for existing organisations.

**Decision:** approved for implementation on `codex/zobba-foundation-batch`. The Unicode repair itself did not change this policy. No merge, deployment or next batch is authorised by this follow-up.

The approved safeguard is implemented and independently reviewed in the [Admin continuity checkpoint](ADMIN-CONTINUITY-CHECKPOINT.md), with source hashes, concurrency/lifecycle assertions and final verification receipts. No merge, deployment or next batch was performed.
