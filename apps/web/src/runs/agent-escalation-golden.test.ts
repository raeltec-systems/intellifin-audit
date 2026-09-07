import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RunWait } from '@intellifin/application';
import { GOLDEN_AGENT_INJECTIONS } from '../../../../tests/fixtures/agent-abuse-cases.js';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../app/runs/actions', () => ({ answerEscalationAction: vi.fn() }));
import { EscalationPanel, orderedEscalationOptions } from './EscalationPanel';

// SSR surface proof only. Authorized click/answer persistence and actual worker journeys
// including post-hydration answer preselection remain separate acceptance gates; rendering this component is not that journey.
const wait: RunWait = { runId: '019823ab-0000-7000-8000-000000000001', waitId: '019823ab-0000-7000-8000-000000000002',
  kind: 'retry-or-skip', options: [{ id: 'retry', label: 'Retry' }, { id: 'skip', label: 'Skip' }],
  deadline: '2026-09-06T13:00:00.000Z', closedAt: null, closureKind: null, answerOptionId: null, actor: null };
function markup(agentQuestion: string | null): string {
  return renderToStaticMarkup(React.createElement(EscalationPanel, { runId: wait.runId, wait,
    details: { stepId: 'step-1', supportingEvidenceIds: [], workItemId: null, agentQuestion }, runRevision: 1, readAt: '2026-09-06T09:00:00.000Z' }));
}
describe('seeded agent-generated escalation text is not answer authority', () => {
  it.each(GOLDEN_AGENT_INJECTIONS)('$id retains the generated label and closed options in server rendering', row => {
    const before = JSON.stringify(wait), options = orderedEscalationOptions(wait);
    const html = markup(row.text);
    const escaped = renderToStaticMarkup(React.createElement('pre', null, row.text)).replace(/^<pre>|<\/pre>$/gu, '');
    expect(html).toContain(escaped);
    expect(html).toContain('AGENT-GENERATED question');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('checked=""');
    expect(orderedEscalationOptions(wait)).toEqual(options);
    expect(JSON.stringify(wait)).toBe(before);
    expect((html.match(/<button\b/gu) ?? []).length).toBe((markup(null).match(/<button\b/gu) ?? []).length);
  });
});
