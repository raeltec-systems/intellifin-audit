import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PERIOD_DERIVATION_RULES } from '@intellifin/domain';
import type { ProcedureVersionView } from '@intellifin/application';
import { NO_AUTOMATIC_RUNS_SENTENCE, RUN_STARTS_ON_CONFIRM_SENTENCE, START_RUN_LINK_LABEL } from '../design/run-start-words';
import { VersionStatus } from './VersionStatus';

function version(overrides: Record<string, unknown>): ProcedureVersionView {
  return {
    procedureId: 'proc-1',
    versionId: 'v-1',
    state: 'ACTIVE',
    decisions: [],
    platformOrigin: null,
    lifecycle: null,
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: PERIOD_DERIVATION_RULES.once },
    period: { from: '2026-08-01', to: '2026-08-31' },
    ...overrides,
  } as unknown as ProcedureVersionView;
}

const html = (overrides: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(React.createElement(VersionStatus, { version: version(overrides) }));

describe('VersionStatus on an Active version', () => {
  it('starts a one-time version with its saved dates already in the link', () => {
    const out = html();
    expect(out).toContain('href="/procedures/proc-1?from=2026-08-01&amp;to=2026-08-31#initiate-run"');
    expect(out).toContain(`>${START_RUN_LINK_LABEL}</a>`);
    expect(out).toContain(RUN_STARTS_ON_CONFIRM_SENTENCE);
    expect(out).toContain(NO_AUTOMATIC_RUNS_SENTENCE);
    expect(out).toContain('The saved dates are 2026-08-01 to 2026-08-31.');
    // A one-time schedule's time starts nothing, so it is not printed as though it did.
    expect(out).not.toContain('at 00:00 UTC');
  });

  it('links without dates when the one-time version saved no Period', () => {
    const out = html({ period: null });
    expect(out).toContain('href="/procedures/proc-1#initiate-run"');
    expect(out).not.toContain('The saved dates are');
  });

  it('lets a scheduled version choose the period it wants to test', () => {
    const out = html({ schedule: { frequency: 'monthly', startTime: '06:00', periodDerivationRule: PERIOD_DERIVATION_RULES.monthly } });
    expect(out).toContain('href="/procedures/proc-1#initiate-run"');
    expect(out).toContain('Saved Schedule: monthly at 06:00 UTC.');
    expect(out).toContain('First period start after activation: Not recorded.');
  });

  it('offers no Run on a version that is not Active', () => {
    for (const state of ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETIRED']) {
      expect(html({ state }), state).not.toContain(START_RUN_LINK_LABEL);
    }
  });
});
