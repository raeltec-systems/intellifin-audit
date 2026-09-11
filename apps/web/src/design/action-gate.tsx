'use client';

import { createContext, useContext } from 'react';

/**
 * Whether a surface currently permits its mutating controls, and the sentence that says
 * why not (Story 5.7, widened by the PR 29 review).
 *
 * It lives in the design system rather than beside Live View because `ConfirmDialog` is
 * the component every confirmation on this product goes through, and a design component
 * reaching into a feature to ask a question is the dependency the wrong way round. The
 * gate is a general fact about a surface — "these controls are not live right now" — and
 * Live View is only the first surface to have one.
 *
 * **Open is the default, and that is the truth rather than a convenience.** A surface with
 * no provider makes no claim about being live, so it has nothing to withdraw: Run Detail
 * mounts the same Pause, Cancel and Flag components and is unaffected, and so is every
 * administration and authoring dialog.
 */

export interface ActionGateState {
  /** The sentence a withdrawn control shows, or `null` when the controls may be used. */
  readonly disabledReason: string | null;
}

export const ACTION_GATE_OPEN: ActionGateState = { disabledReason: null };

const ActionGateContext = createContext<ActionGateState>(ACTION_GATE_OPEN);

export const ActionGateProvider = ActionGateContext.Provider;

export function useActionGate(): ActionGateState {
  return useContext(ActionGateContext);
}
