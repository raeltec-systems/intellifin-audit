import { ICON_GLYPHS, type IconName } from './icons';

export type { IconName };

interface IconProps {
  readonly name: IconName;
  /**
   * Pixel size of the square glyph. Icons scale with the thing they sit in, so this
   * is a size rather than a token: DESIGN.md sizes the badge and the control, not the
   * glyph inside it.
   */
  readonly size?: number;
  /**
   * The name a screen reader reads. Omit it — the default — when the icon repeats a
   * word beside it, which every status badge does. An icon that carries meaning on its
   * own must pass one, and DESIGN.md forbids that case for status.
   */
  readonly label?: string;
}

/**
 * One glyph from the self-hosted subset (`icons.ts`).
 *
 * Decorative by default: `aria-hidden`, no title, no focus. That is the right default
 * because the rule the product is built on — every status carries an icon AND a word —
 * makes the icon redundant to assistive technology everywhere it appears.
 *
 * The glyph markup is a constant from `ICON_GLYPHS`, keyed by a union type. No caller
 * supplies markup and no data reaches this element, so the inner HTML is fixed at build
 * time; `dangerouslySetInnerHTML` is how a static SVG body is inlined without turning
 * 700 path elements into 700 lines of JSX.
 */
export function Icon({ name, size = 16, label }: IconProps): React.JSX.Element {
  const decorative = label === undefined;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={label}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICON_GLYPHS[name] }}
    />
  );
}
