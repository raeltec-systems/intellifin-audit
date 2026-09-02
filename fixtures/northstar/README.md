# Northstar synthetic fixtures

Everything Epic 2 and Epic 3 will audit. Nothing here is production data, personal data,
a real person, a real address or a real domain: every origin is `.synthetic.invalid` or a
loopback port, and `tests/unit/synthetic-marker.test.ts` walks every file in this folder
and fails on one without the marker (NFR-13).

```
datasets/      the golden populations and the systems' own content. Hand-written DATA.
expectations/  what a Run SHOULD conclude, per addendum D case. Hand-written DATA.
generated/     cover sheets, served file artifacts and declared counts. NEVER hand-edited.
generate.py    writes generated/ from datasets/.  uv run fixtures/northstar/generate.py
```

## The three rules this folder exists to keep

**A declared count is generated, never typed.** A number typed beside the rows it counts
is wrong the first time somebody edits the dataset, and an Evidence Quality Gate
reconciling against a stale declaration reports a truncation that never happened.
`generate.py` derives every count and every digest from `datasets/`, in Python — which is
not the language the product's Adapters will count in, so the declaration is independent
of the thing it is used to check.

**A digest is over the bytes actually served.** `apps/northstar` reads an artifact out of
`generated/` and streams it unchanged. A digest over the dataset, or over a
re-serialization, would be a digest of something nobody can fetch.

**Expectations are data, and nothing that evaluates may import them** (AD-12). A test that
validates a Result against the implementation that produced it proves only that the
implementation equals itself.

## Seeded cases that look like mistakes and are not

- `generated/leavers-export-truncated.cover-sheet.json` declares 27 rows and the FULL
  export's digest over a file that holds 24. That disagreement is addendum D's incomplete
  population. The sheet carries `seeded_case: "declared-count-mismatch"`.
- `generated/leavers-export-2026-07.*` is the previous generation, effective through
  2026-07-31. Binding an August period to it is addendum D's stale population.
- `datasets/rolematrix.json` declares `AMBIGUOUS_DUAL` twice with different permissions.
  A duplicate conflicting policy entry is Inconclusive by addendum C P-2.
- Several cells and page notes carry prompt-like strings. They are DATA. They are served
  verbatim and must never be interpreted. Removing one deletes the test.

## The cover-sheet signature

`synthetic-hmac-sha256` over the cover sheet's own signed fields, with the key
`northstar-synthetic-cover-sheet-key-2026` — published here and in `generate.py`. It makes
a fixture's cover sheet tamper-evident for anybody holding the fixture. **It is not a
security control** and nothing in this repository treats it as one.

## Regenerating

```bash
uv run fixtures/northstar/generate.py
```

`apps/northstar/src/fixtures.test.ts` recomputes every count from the dataset and every
digest from the served bytes, in TypeScript. It fails when `generated/` has drifted from
`datasets/`, which is what "run the generator" means in practice.
