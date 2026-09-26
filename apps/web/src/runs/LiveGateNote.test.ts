import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ACTION_GATE_OPEN, ActionGateProvider, type ActionGateState } from '../design/action-gate';
import { LIVE_GATE_NOTE_ID, LIVE_GATE_REASONS } from './live-status';
import { LiveGateNote } from './LiveGateNote';

/** The note under a gate in the given state, as the Live View header renders it. */
function render(gate: ActionGateState | null): string {
  const note = React.createElement(LiveGateNote);
  return renderToStaticMarkup(gate === null ? note : React.createElement(ActionGateProvider, { value: gate }, note));
}

/**
 * Story 10.8 screenshot review. The gate's reason was each withdrawn control's accessible
 * description and nothing else, so with the flag disclosure closed a sighted reader saw
 * greyed controls and no reason anywhere on the page.
 */
describe('LiveGateNote', () => {
  it.each(['lost', 'ended'] as const)('states the %s reason as visible text, by the id a reader can be pointed at', (reason) => {
    const html = render({ disabledReason: LIVE_GATE_REASONS[reason] });
    expect(html).toBe(`<p id="${LIVE_GATE_NOTE_ID}" class="ls-caption">${LIVE_GATE_REASONS[reason]}</p>`);
    // Visible text: never the visually hidden treatment the controls' own copies have.
    expect(html).not.toContain('ls-visually-hidden');
  });

  it('says nothing while the controls may be used, and nothing with no gate at all', () => {
    expect(render(ACTION_GATE_OPEN)).toBe('');
    // Run Detail has no gate: its controls are not withdrawn, so a note would be false there.
    expect(render(null)).toBe('');
  });

  // The narrow viewport's reason is the stage's floor sentence, already on the page, and
  // `runEnded` lasts until the re-read removes the controls; a second copy of either would
  // be the same sentence twice.
  it.each(['viewport', 'runEnded'] as const)('leaves the %s reason to the sentence that already states it', (reason) => {
    expect(render({ disabledReason: LIVE_GATE_REASONS[reason] })).toBe('');
  });
});
