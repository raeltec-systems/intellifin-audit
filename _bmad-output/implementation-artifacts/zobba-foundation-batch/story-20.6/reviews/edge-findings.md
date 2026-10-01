[
  {
    "location": "zobba/web/src/MembershipWorkspace.tsx:274-277",
    "trigger_condition": "A second sign-in replaces the session while keeping the same actor ID.",
    "guard_snippet": "if (lastSession.current !== session.csrf_token) { clearDraftsAndSecrets(); remountEditors(); }",
    "potential_consequence": "Session rotation redisplays old drafts and permits retrying their commands under the replacement session."
  },
  {
    "location": "zobba/crates/application/src/membership.rs:158",
    "trigger_condition": "Admin saves a member expiry above 253402300799 through the membership API.",
    "guard_snippet": "self.expires_at.is_none_or(|expiry| (1..=253402300799).contains(&expiry))",
    "potential_consequence": "Persisted membership makes the entire organisation workspace fail with Connection interrupted."
  }
]
