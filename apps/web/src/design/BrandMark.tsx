/**
 * The IntelliFin interlock mark, reverse variant.
 *
 * Copied path-for-path from the asset DESIGN.md names — `claude/mockups/assets/
 * interlock-master-reverse.svg` — rather than referenced from there: nothing under
 * `_bmad-output/` is shipped in the container image, and a mark that fails to load
 * leaves the sidebar unbranded.
 *
 * Its two fills are the asset's own and are the one place in the application where a
 * colour is not a token: a brand mark is a fixed artwork, not a themeable surface.
 * DESIGN.md says the reverse variant is the one that sits on the sidebar.
 *
 * Decorative: the wordmark beside it says "IntelliFin Audit" in text.
 */
export function BrandMark({ size = 20 }: { readonly size?: number }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="#FFFFFF">
        <rect x="4" y="16" width="28" height="8" />
        <rect x="4" y="16" width="8" height="28" />
        <rect x="4" y="36" width="28" height="8" />
        <rect x="24" y="16" width="8" height="8" />
        <rect x="24" y="32" width="8" height="12" />
      </g>
      <g fill="#43D9C7">
        <rect x="16" y="4" width="28" height="8" />
        <rect x="36" y="4" width="8" height="28" />
        <rect x="16" y="24" width="28" height="8" />
        <rect x="16" y="4" width="8" height="12" />
      </g>
    </svg>
  );
}
