[
  {
    "location": "apps/web/src/procedures/EvidenceScheduleForm.tsx:318-320",
    "trigger_condition": "Revalidation supplies another auditor's Schedule while the mounted form retains its initial values",
    "guard_snippet": "Synchronize pristine schedule inputs from draft.schedule; preserve the original token when local edits conflict.",
    "potential_consequence": "Old Schedule values can overwrite the new Schedule using its refreshed concurrency token."
  },
  {
    "location": "apps/web/src/procedures/EvidenceScheduleForm.tsx:78-84",
    "trigger_condition": "Saving dirty Evidence adds forced capture fields absent from local requirements",
    "guard_snippet": "Reconcile successful saves against the normalized submitted requirements, preserving only edits made during the request.",
    "potential_consequence": "Dirty state never clears; later Target deselection exposes outdated grounding and screenshot values."
  }
]
