import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HumanMatch } from './HumanMatch';
import { matchOriginWord } from './labels';
const decision = { waitId: 'wait-exact', answerOptionId: 'candidate-2', answerLabel: '<script>Candidate 2</script>', answerMasked: false, actorId: 'actor', actorName: 'Named Auditor', decidedAt: '2026-09-26T10:00:00.000Z' };
describe('stored human match provenance', () => {
  it('renders the retained answer, actor, time and exact wait identity inertly', () => {
    const html = renderToStaticMarkup(React.createElement(HumanMatch, { runId: 'run', matchOrigin: 'human-matched', decision }));
    expect(html).toContain(matchOriginWord('human-matched'));
    expect(html).toContain('wait-exact'); expect(html).toContain('candidate-2');
    expect(html).toContain('Named Auditor'); expect(html).toContain(decision.decidedAt);
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
  });
  it('never labels a platform match as human even with stray provenance', () => {
    expect(renderToStaticMarkup(React.createElement(HumanMatch, { runId: 'run', matchOrigin: 'platform', decision }))).toBe('');
  });
  it('retains the human flag when no exact decision is linked, without inventing one', () => {
    const html = renderToStaticMarkup(React.createElement(HumanMatch, { runId: 'run', matchOrigin: 'human-matched' }));
    expect(html).toContain(matchOriginWord('human-matched')); expect(html).not.toContain('wait-exact');
  });
});
