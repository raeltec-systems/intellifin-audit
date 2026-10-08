[
  {
    "location": "zobba/crates/infrastructure/src/evidence/mod.rs:225-250",
    "trigger_condition": "PostgreSQL uses en_US collation and returns mixed-case evidence IDs in locale order.",
    "guard_snippet": "WHERE id COLLATE \"C\" > $1 ORDER BY id COLLATE \"C\"",
    "potential_consequence": "Valid registry and recovery pages fail browser validation, making evidence unavailable."
  },
  {
    "location": "zobba/web/src/evidence.ts:173-180",
    "trigger_condition": "Valid maximum escaped source assertions serialize a recovery draft above 16,384 characters.",
    "guard_snippet": "if (raw.length > 32 * 1024) { discardAcquisitionDraft(); return null; }",
    "potential_consequence": "Reload deletes the retry key, so uncertain acquisition cannot automatically resume its original reservation."
  },
  {
    "location": "zobba/web/src/EvidenceWorkspace.tsx:150-156",
    "trigger_condition": "A source assertion fits maxLength but exceeds 2,000 UTF-8 bytes.",
    "guard_snippet": "pending.request = parseReservationRequest(pending.request); saveAcquisitionDraft(pending); setDraft(pending);",
    "potential_consequence": "Invalid assertions become frozen retry drafts; users must discard everything to edit them."
  },
  {
    "location": "zobba/web/src/EvidenceWorkspace.tsx:144",
    "trigger_condition": "Selecting a file over 10 MiB makes measureFile throw a plain Error.",
    "guard_snippet": "if (file.size > MAX_ORIGINAL_BYTES) { setError('Choose an original of 10 MiB or less.'); return; }",
    "potential_consequence": "Oversized files display a storage outage and retry message instead of the size validation error."
  }
]
