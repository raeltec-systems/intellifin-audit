import { Icon } from './Icon';
import { statusPresentation, type StatusFamily, type StatusState } from './status';

interface StatusBadgeProps<F extends StatusFamily> {
  readonly family: F;
  readonly state: StatusState<F>;
  /** `{spacing.badge-sm}` in tables and lists, `{spacing.badge-md}` in headers. */
  readonly size?: 'sm' | 'md';
}

/**
 * A status badge: the state's exact word, its icon, its treatment.
 *
 * There is no prop for the word, the colour, or the icon. The family and the state are
 * the whole input, and the vocabulary supplies the rest — so a badge without an icon,
 * a badge without a word, or a badge whose colour disagrees with its family cannot be
 * written. `state` is typed against the family, so an unknown state is a compile error
 * rather than a grey badge nobody notices.
 */
export function StatusBadge<F extends StatusFamily>({
  family,
  state,
  size = 'sm',
}: StatusBadgeProps<F>): React.JSX.Element {
  const { word, treatment, icon } = statusPresentation(family, state);
  return (
    <span className={`ls-badge ls-badge--${size} ls-badge--${treatment}`}>
      <Icon name={icon} size={size === 'sm' ? 12 : 14} />
      {word}
    </span>
  );
}
