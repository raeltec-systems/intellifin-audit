# Story 2.8 — edge-case review

Same complete captured diff as the blind review. Context-free reviewer loaded the frozen edge-case prompt independently.

- `packages/application/src/procedures/new-version.ts`: role revocation while waiting for the shared transaction lock can still permit a Draft and queued derivation. Recheck transaction-scoped authorization and audit refusal.
- `apps/web/app/procedures/[id]/builder/page.tsx`: after version 101 is created, the oldest-100 lookup cannot resolve it. Fetch the selected identity directly and preserve access to history.

Both claims duplicate the same required actions in blind findings 2 and 1 respectively.
