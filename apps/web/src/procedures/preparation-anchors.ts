import type { PreparationSectionId } from '@intellifin/domain';

/**
 * The Builder outline's stable anchor scheme (UX-15).
 *
 * `GuidedPreparation` used `useId()` for its panel and heading ids, which is right for
 * avoiding a collision between two instances of one component on a page — and useless
 * to any OTHER component that wants to link to a step, because that id is generated
 * fresh on every render and known only inside `GuidedPreparation` itself. There is
 * exactly one Draft Builder mounted per page, so a FIXED prefix costs nothing and is
 * what lets a sibling — the readiness panel — build a working link to the exact step
 * that resolves a finding, without threading `GuidedPreparation`'s internal id out
 * through a render-prop.
 */
export const PREPARATION_PANEL_PREFIX = 'guided-preparation';

export function preparationPanelId(step: PreparationSectionId | 'review'): string {
  return `${PREPARATION_PANEL_PREFIX}-panel-${step}`;
}

/** A link to the exact Builder step, whether or not JavaScript has hydrated it yet. */
export function preparationPanelHref(step: PreparationSectionId | 'review'): string {
  return `#${preparationPanelId(step)}`;
}
