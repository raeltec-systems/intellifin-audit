import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProcedureVersionView } from '@intellifin/application';

import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { SECTION_WORDS } from '../design/plain-words';
import { TECHNICAL_DETAILS_LABEL } from '../design/TechnicalDetails';
import { PLAN_DRAFT_INCOMPLETE, PLAN_PLATFORM_FAILED, PLAN_RETRY_LABEL } from './plan-words';
import { RetryPlanDerivation } from './RetryPlanDerivation';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * UX-16: the plan recovery says whether the auditor has something to fix or the platform
 * needs another try, and keeps the attempt history under Technical details.
 */
function failed(overrides: Partial<ProcedureVersionView> = {}): ProcedureVersionView {
  return { ...executablePlanInputs(), versionId: 'version', procedureId: 'procedure', versionNumber: 2, state: 'DRAFT', targetBlockers: [], evidenceBlockers: [],
    createdAt: '2026-09-04T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z', planCompilerVersion: '1', compiledPlan: null, planDerivable: false,
    planStatus: 'failed', planFailureReason: 'The frozen derivation model configuration is unavailable.', planInputDigest: 'digest', derivationModel: null,
    planAttempts: [{ attemptId: 'a1', inputDigest: 'digest', attemptedAt: '2026-09-04T01:02:03Z', outcome: 'failure', reason: 'The frozen derivation model configuration is unavailable.', model: null }],
    ...overrides };
}
const render = (draft: ProcedureVersionView) => renderToStaticMarkup(React.createElement(RetryPlanDerivation, { draft, rowVersion: 'row', onRetry: async () => ({ ok: true as const, rowVersion: 'next' }) }));

describe('preparing the test plan again (UX-16)', () => {
  it('says the platform could not prepare a complete draft, and offers to try again', () => {
    const html = render(failed());
    expect(html).toContain('data-plan-recovery="platform"');
    expect(html).toContain(PLAN_PLATFORM_FAILED);
    expect(html).toContain(PLAN_RETRY_LABEL);
    // The mechanism's words stay out of what is read first; the recorded reason keeps its
    // own wording under Technical details.
    const ordinary = html.slice(0, html.indexOf(TECHNICAL_DETAILS_LABEL));
    expect(ordinary).not.toContain('derivation');
    expect(ordinary).not.toContain('Retry plan');
  });

  it('says something is missing in the draft, naming the section that fixes it', () => {
    const html = render(failed({ sourceSnapshot: null, planFailureReason: 'Choose a Population Source.' }));
    expect(html).toContain('data-plan-recovery="draft"');
    expect(html).toContain(PLAN_DRAFT_INCOMPLETE);
    expect(html).toContain(SECTION_WORDS['Population Source binding'].title);
  });

  it('keeps the attempt history and the recorded reason under Technical details, with a readable stamp', () => {
    const html = render(failed());
    const technical = html.slice(html.indexOf(`<summary>${TECHNICAL_DETAILS_LABEL}</summary>`));
    expect(technical).toContain('data-plan-attempts');
    expect(technical).toContain('4 Sep 2026, 01:02:03 UTC');
    expect(technical).toMatch(/<time [^>]*2026-09-04T01:02:03\.000Z/u);
    expect(html.indexOf('data-plan-attempts')).toBeGreaterThan(html.indexOf(TECHNICAL_DETAILS_LABEL));
  });
});
