import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  /** The first sentence. "No Runs yet." */
  readonly headline: string;
  /**
   * What would appear here, and what the absence does not mean. EXPERIENCE.md:
   * "Headline + one sentence that names what would appear and refuses to imply a
   * passed control."
   */
  readonly sentence: string;
  readonly icon?: IconName;
  /**
   * An optional way onward. A LINK, never a handler: an empty state may not carry a
   * call to action that mutates, so this component has no way to express one.
   */
  readonly link?: { readonly href: string; readonly label: string };
}

/**
 * The empty state.
 *
 * The type is the rule: there is a headline, one sentence, and at most a link. There is
 * no `onClick`, no `action`, and no `children`, so "No Runs yet" cannot grow a button
 * that starts one, and an empty collection cannot be dressed up as a passed control.
 */
export function EmptyState({
  headline,
  sentence,
  icon = 'search-x',
  link,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="ls-empty">
      <span className="ls-empty__icon">
        <Icon name={icon} size={20} />
      </span>
      <p className="ls-empty__headline">{headline}</p>
      <p className="ls-empty__sentence">{sentence}</p>
      {link ? <a href={link.href}>{link.label}</a> : null}
    </div>
  );
}
