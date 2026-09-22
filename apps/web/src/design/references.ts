/**
 * Short references for identifiers a person has to tell apart but never types
 * (UI cleanup 2026-09-21, UX-02, UX-21, UX-25).
 *
 * A Run, an Exception and a workspace are UUIDs, and the walkthrough found them as the
 * PRIMARY label of rows, headings and jump pills — thirty-six characters a reader cannot
 * compare by eye and does not need to. EXPERIENCE.md now names a row by what a person
 * recognises (the Procedure, the record, the person) and puts a short reference beside it,
 * with the full identifier under Technical details.
 *
 * The reference is the LAST characters of the identifier, not the first: a UUIDv7 begins
 * with its timestamp, so two Runs started in the same minute share their first eight
 * characters, while the tail is random. Eight hexadecimal characters distinguish more rows
 * than any deployment of this PoC holds, and a reader can still find the full identifier
 * by its ending.
 */
export const REFERENCE_LENGTH = 8;

/** `bf4ea3e7` for `01a0b465-a21d-7fba-acbd-fc2abf4ea3e7`; a short identifier is its own reference. */
export function shortReference(id: string): string {
  const compact = id.replaceAll('-', '');
  return compact.length <= REFERENCE_LENGTH ? compact : compact.slice(-REFERENCE_LENGTH);
}

/** `Run bf4ea3e7`: the kind of thing, then the reference. */
export function referenceLabel(kind: string, id: string): string {
  return `${kind} ${shortReference(id)}`;
}
