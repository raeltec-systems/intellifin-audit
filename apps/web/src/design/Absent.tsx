/**
 * The absent marker.
 *
 * EXPERIENCE.md → Formats: "Absent values — `—`; source nulls as literal `null`." So the
 * visible glyph is the em dash the contract fixes. On its own that is meaningless to a
 * screen reader, which reads it as "em dash" or as nothing at all, so an equivalent
 * sentence sits beside it — the `Digest` pattern, for the same reason and with the same
 * mechanics: no ARIA role, nothing a role rule can silently drop, and no accessible name
 * on an element that cannot carry one.
 *
 * `what` is REQUIRED. A cell that says only "—" tells the reader nothing about which of
 * the many things that could be absent is; this component cannot be used without saying.
 */
export function Absent({ what }: { readonly what: string }): React.JSX.Element {
  return (
    <span className="ls-absent">
      <span aria-hidden="true">—</span>
      <span className="ls-visually-hidden">{what}</span>
    </span>
  );
}
