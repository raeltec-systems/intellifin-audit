# Admin continuity: owner decision

**1 October 2026 (Africa/Lusaka). Recommended; pending owner approval. No policy or code change in the Story 21.1 repair. Story 20.6 is owner-accepted.**

Approve requiring **at least one active, non-expiring Admin membership attached to an active application identity in each organisation**. Additional temporary Admins remain allowed.

Today the last-Admin guard accepts another currently eligible Admin with a future expiry. Two Admins can therefore both acquire finite expiries, and both later expire without another write. The relevant predicate is in [migration 0005](../../../zobba/migrations/0005_membership_administration.sql#L227); it implements current eligibility, not guaranteed continuity through time.

If approved, a Save that would remove, deactivate, demote or give an expiry to the last qualifying Admin would fail atomically with a clear instruction to establish a replacement first. Use the existing organisation lock so concurrent edits cannot each rely on the other Admin. Once a replacement exists, the original edit is an ordinary Save. **No second approver or approval ceremony** is proposed for membership, assignment or methodology edits.

Pending, expired or revoked invitations would not count as replacements. An accepted Admin invitation can count only after it establishes an active membership and active identity. Invitation expiry and normal sign-in/session expiry remain independent.

Membership expiry currently applies to all roles on the membership. A non-expiring member with combined audit roles also retains those roles without a membership deadline; engagement scope and assignment expiry still apply. Prefer an Admin-only continuity membership where enduring audit roles are inappropriate. This proposal grants no audit authority or engagement access by itself.

For existing organisations, first report those without a qualifying Admin. A currently authorised Admin must explicitly nominate a replacement or clear an existing membership expiry through an attributed Save. Do not silently promote anyone, remove expiry or revive an identity in a migration. An organisation where every Admin has already expired needs a separately authorised owner-verification recovery procedure. Rollout must account for these organisations explicitly before enforcing the rule.

This protects continuity against membership expiry and routine application-controlled edits. It does not establish availability of the human or their external identity provider. Routine identity offboarding must participate in the same check; emergency security revocation must not keep a compromised account enabled merely to satisfy the rule. Recovery remains a separate policy obligation.

If approved, qualify first/second expiry saves, concurrent removal/expiry, inactive identities, pending versus accepted invitations, exact replay and stale versions, unchanged ordinary edits, and passage of time beyond all temporary memberships. Preserve published migrations; add any required database change in a new migration.

**Decision requested:** approve the non-expiring-Admin safeguard above for a separately specified change. It is not implemented or treated as approved by this repair.
