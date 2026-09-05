# Story 2.8 — verification-gap review

Same complete captured diff as the blind review. Context-free reviewer loaded the frozen verification-gap prompt independently.

1. **Saved scheduled boundary lacks integration proof.** Calendar tests exercise the pure helper, while activation integration uses a once Schedule. Replacing command calculation with null would preserve the checked outcomes. Approve a recurring successor with a non-midnight launch and assert its exact UTC boundary in both lifecycle and succession storage; verify the displayed saved value.
2. **Ripple snapshots lack independent expected-value assertions.** Target and Source tests verify counts, provenance, replay and queue records, but do not compare successor snapshots with the owner module's post-save contract. Retaining the old snapshot could still pass. Assert exact changed snapshots, unchanged predecessor/unrelated snapshots, and their consumption by queued derivation.
