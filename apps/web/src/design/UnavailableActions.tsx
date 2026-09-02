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
}: UnavailableActionsProps): React.JSX.Element | null {
  if (actions.length === 0) return null;
  return (
    <section className="ls-unavailable" aria-labelledby="unavailable-actions-heading">
      <h2 className="ls-unavailable__heading" id="unavailable-actions-heading">
        Unavailable actions
      </h2>
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
