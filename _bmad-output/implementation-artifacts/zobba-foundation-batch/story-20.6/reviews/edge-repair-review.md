[
  {
    "location": "zobba/migrations/0005_membership_administration.sql:134-138",
    "trigger_condition": "Legacy assignment pagination crosses valid client IDs whose tuple and concatenated ordering differ.",
    "guard_snippet": "-- Use the same tuple order in LIMIT, aggregation and continuation.\nSELECT coalesce(jsonb_agg(v ORDER BY client_id, engagement_id),'[]'::jsonb)\nFROM (SELECT a.client_id, a.engagement_id, jsonb_build_object(...) v\n      ... ORDER BY a.client_id, a.engagement_id LIMIT 51) page;\n-- C-collation reproducer: 50 a/e001..e050 plus 51 a-/e001..e051.\n-- Current three pages omit a/e050 and repeat a-/e001.",
    "potential_consequence": "An active assignment is permanently omitted from inspection and cannot be selected for removal."
  },
  {
    "location": "zobba/web/src/MembershipWorkspace.tsx:159-161",
    "trigger_condition": "An open legacy editor refreshes after expiry reduces assignment count from 101 to 100.",
    "guard_snippet": "// Bind assignment editing mode to the initial draft, just like expectedVersion.\nconst [assignmentsComplete] = useState(member.assignments_complete);\n// Use assignmentsComplete consistently for rendering and submit selection.\n// Alternatively discard/reopen the draft when completeness changes.\n// Reproduced: initial draft e001..e100; e001 expires; refreshed membership\n// contains e002..e101 at the same version. Current Save sends replace e001..e100.",
    "potential_consequence": "A role-only save renews an expired assignment and silently revokes an unseen active assignment."
  }
]
