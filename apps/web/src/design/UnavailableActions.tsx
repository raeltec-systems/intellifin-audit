'use client';

// `useId` is a hook, so this component runs on the client. It renders inert markup and
// carries no state; the directive is only what `useId` requires.
import { useId } from 'react';

export interface UnavailableAction {
  /**
   * The id the disabled button points its `aria-describedby` at. The panel's sentence
   * and the button's accessible description are then the same text, not two copies of
   * it that can drift.
   */
  readonly id: string;
  /** The action's own label, as it reads on the button that is unavailable. */
  readonly label: string;
  readonly reason: string;
}

interface UnavailableActionsProps {
  readonly actions: readonly UnavailableAction[];
  /**
   * The heading level, so the panel sits correctly under whatever heading precedes it.
   * A fixed `<h2>` inverts the outline on any surface that introduces the action bar
   * with an `<h3>`.
   */
  readonly headingLevel?: 2 | 3 | 4;
}

/**
 * `{components.unavailable-actions-panel}` — the visible half of the disabled-action
 * rule.
 *
 * DESIGN.md and EXPERIENCE.md both state it, and EXPERIENCE.md calls its statement
 * canonical: "A disabled action keeps its position; its reason appears in the
 * 'Unavailable actions' panel and as the button's accessible description — never
 * tooltip-only." This panel is the first half; `Button`'s `disabledReasonId` is the
 * second, pointing at these ids.
 *
 * Nothing renders when every action is available: an empty panel would say a surface
 * has restrictions it does not have.
 */
export function UnavailableActions({
  actions,
  headingLevel = 2,
}: UnavailableActionsProps): React.JSX.Element | null {
  // Generated, not fixed: two panels on one surface would otherwise both claim the same
  // heading id and the second `aria-labelledby` would resolve to the first panel's.
  const headingId = useId();
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';

  if (actions.length === 0) return null;
  return (
    <section className="ls-unavailable" aria-labelledby={headingId}>
      <Heading className="ls-unavailable__heading" id={headingId}>
        Unavailable actions
      </Heading>
      <ul>
        {actions.map((action) => (
          <li key={action.id} id={action.id}>
            <strong>{action.label}</strong> — {action.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
