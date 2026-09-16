import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ProcedureVersionView, TargetSystemRegistration } from '@intellifin/application';
import { registrationDigest, snapshotFromRegistration } from '@intellifin/domain';

import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { TargetSelectionForm } from './TargetSelectionForm';
import { DESKTOP_DEFAULT_LEFT_OUT, targetCoverageMissing } from './labels';

/**
 * What the Target Systems panel says about a Template default this release cannot run.
 *
 * The owner met both halves of a contradiction on THIS panel while authoring P-1: the
 * suggestion caption said LedgerDesk cannot be run and to leave it out, and a warning
 * Banner below it said "Add the registered desktop system". The panel now answers the
 * completeness question once, in the direction that is true — and only while the desktop
 * default really is left out, because once one is selected the sentence would be false
 * and `procedureReadiness` names the selected system as unsupported instead.
 *
 * `.test.ts` with `React.createElement`, not `.tsx`: Vitest's include globs collect
 * `*.test.ts` and not `*.test.tsx`, so a component test written as `.tsx` is collected
 * by nothing and passes silently.
 */

const DESKTOP: TargetSystemRegistration = (() => {
  const registration = {
    registrationId: '018f0000-0000-7000-8000-0000000000d1', displayName: 'LedgerDesk', kind: 'desktop' as const,
    allowedOrigins: ['com.northstar.ledgerdesk'], applicationIdentity: 'com.northstar.ledgerdesk',
    credentialRef: 'vault://audit/ledgerdesk', permittedActions: ['read-attribute'] as const,
    attributeLabelPatterns: ['Account status'], secondaryKey: '',
  };
  return { ...registration, digest: registrationDigest(registration) } as unknown as TargetSystemRegistration;
})();

function draft(targets: ProcedureVersionView['targets']): ProcedureVersionView {
  return {
    ...executablePlanInputs(),
    // P-1 is the Template that names a desktop default; the fixture's own is P-4.
    templateId: 'P-1', targets,
    versionId: 'version', procedureId: 'procedure', versionNumber: 1, state: 'DRAFT',
    targetBlockers: [], evidenceBlockers: [],
    createdAt: '2026-09-04T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z',
    planCompilerVersion: '1', compiledPlan: null, planDerivable: true,
    planStatus: 'pending', planFailureReason: null, planInputDigest: null,
    derivationModel: null, planAttempts: [],
  } as unknown as ProcedureVersionView;
}

const render = (version: ProcedureVersionView, registrations: readonly TargetSystemRegistration[] = []): string =>
  renderToStaticMarkup(
    React.createElement(TargetSelectionForm, {
      draft: version, registrations, rowVersion: 'token',
      onSave: async () => ({ ok: true, rowVersion: 'token', changed: false }) as never,
    }),
  );

describe('the Target Systems panel and a desktop Template default', () => {
  it('never asks for the desktop system the caption tells the auditor to leave out', () => {
    const html = render(draft([]));
    // The caption is still there, unchanged.
    expect(html).toContain('this release cannot run a desktop system');
    // And the completeness answer agrees with it now.
    expect(html).toContain(DESKTOP_DEFAULT_LEFT_OUT);
    expect(html).not.toContain('Add the registered desktop system');
    expect(html).not.toContain('names a desktop Target System');
  });

  it('still asks for the web system, which this release does run', () => {
    expect(render(draft([]))).toContain(targetCoverageMissing('web'));
  });

  it('stops saying the desktop system is left out once one is selected', () => {
    const selected = render(draft([snapshotFromRegistration(DESKTOP as never)]));
    expect(selected).not.toContain(DESKTOP_DEFAULT_LEFT_OUT);
    // What remains true about it is said by the suggestion note and, once the Draft is
    // read for readiness, by `unsupported-target-selected`.
    expect(selected).toContain('this release cannot run a desktop system');
  });
});
