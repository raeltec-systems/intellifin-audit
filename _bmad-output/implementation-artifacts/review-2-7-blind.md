# Story 2.7 — blind review

Reviewed the complete tracked and untracked diff from `7e47280f292535f65bbb78522e1a4965c76bb1f4`. Retained findings summary; severity and routing are the coordinator's responsibility.

1. Submit ignores unsaved editor values, conflicts and unknown save outcomes.
2. Executable-plan diff hides previous/after contents behind a changed sentence.
3. Submitted preview uses the live row while approval freezes the submission snapshot.
4. Invalid predecessor reads as missing and can be presented as a first version.
5. Review reader validates shape but not section uniqueness or consistency with the definition.
6. Database review/decision CHECKs are shallow rather than validating every nested entry.
7. Delivered notification history is silently capped at 100 with no continuation.
8. Identical notification links lack identifying Procedure/version/time context.
9. Notifications opened before worker delivery offer no explicit refresh affordance.
10. Pending-delivery polling lacks an index matching its filter and order.
11. Rejection rationale disappears from the visible decision surface after Edit/resubmission.
12. Read-only review content is hidden by the desktop-only wrapper.


