# Workspace capability containment — 17 September 2026

`WorkspaceRef.workspaceId` is sensitive operational state. Solari signed session IDs
in connection URLs are bearer capabilities, not harmless correlation identifiers.
Source: https://docs.getsolari.com/api-reference (Authentication).

The platform reference is `workspace-<run-id>`. It permits correlation within IntelliFin,
not provider access. Public read models must not SELECT the provider handle or serialize
it into HTML, React Server Component payloads, JSON, logs, audit events or exports.

The worker retains the complete provider handle for reattach/release. It is not truncated
or hashed in operational state. The append-time audit writer refuses capability-shaped
payload fields without changing historical canonicalization. Historical events remain
unchanged and private; public readers use explicit safe projections. Operators must
treat existing historical database values as credential material.

A viewer is read-only and server-authorized. It must never receive a provider connection
URL or accept arbitrary browser-control commands. Credential entry is hidden before
transmission, not masked after delivery. Provider recording remains disabled.
