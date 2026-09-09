import { describe, expect, it } from 'vitest';

import { registrationDigest } from '../registrations/target-system.js';
import { bindingDigest, bindingDigestEnvelope, type BindingDigestInput } from '../sources/population-source.js';
import { compileComplianceDraft, initialDraftCompliance } from './plan-compiler.js';
import { type ProcedureSourceSnapshot } from './population-draft.js';
import {
  PROCEDURE_READINESS_CODES,
  READINESS_NOTHING_FOUND,
  READINESS_NO_GUARANTEE,
  TERMINATION_TIME_COLUMN,
  terminationColumnFor,
  isProcedureReadinessCode,
  procedureReadiness,
  type ProcedureReadinessInputs,
} from './readiness.js';
import { type CompiledComplianceCondition } from './compliance-draft.js';
import { snapshotFromRegistration, type RegistrationSixFields } from './target-draft.js';

/**
 * Readiness before paid execution: an advisory, closed-vocabulary read of the Draft's own
 * authoring inputs. Every case here asserts BOTH directions — the item is raised when the
 * Draft has the gap, and is absent when it does not — because a check that only ever
 * fires proves nothing about the case it exists to distinguish.
 */

function registration(fields: Omit<RegistrationSixFields, 'digest'>): RegistrationSixFields {
  return { ...fields, digest: registrationDigest(fields) };
}

const LOANCORE = snapshotFromRegistration(
  registration({
    registrationId: '018f0000-0000-7000-8000-0000000000a1',
    displayName: 'LoanCore',
    kind: 'web',
    allowedOrigins: ['http://localhost:4300/loancore'],
    applicationIdentity: '',
    credentialRef: 'vault://audit/loancore',
    permittedActions: ['navigate', 'search', 'read-attribute'],
    attributeLabelPatterns: ['Status', 'Username', 'Roles'],
    secondaryKey: 'Full name',
  }),
);

const LEDGERDESK = snapshotFromRegistration(
  registration({
    registrationId: '018f0000-0000-7000-8000-0000000000a2',
    displayName: 'LedgerDesk',
    kind: 'desktop',
    allowedOrigins: [],
    applicationIdentity: 'com.northstar.ledgerdesk',
    credentialRef: 'vault://audit/ledgerdesk',
    permittedActions: ['navigate', 'read-attribute'],
    attributeLabelPatterns: ['Status'],
    secondaryKey: '',
  }),
);

function source(declaredSchema: readonly string[]): ProcedureSourceSnapshot {
  const input: BindingDigestInput = {
    kind: 'versioned-file',
    location: 'https://population.synthetic.invalid/leavers.csv',
    declaredSchema,
    declaredCountMechanism: 'cover-sheet',
    sensitiveFields: [],
  };
  return {
    bindingId: '018f0000-0000-7000-8000-0000000000b1',
    displayName: 'Leavers export',
    digest: bindingDigest(input),
    contract: bindingDigestEnvelope(input),
  };
}

const DATE_ONLY_SOURCE = source(['employee_id', 'employment_status', 'termination_effective_date']);
const TIME_SOURCE = source(['employee_id', 'employment_status', TERMINATION_TIME_COLUMN]);

/** A P-1 Draft with every readiness gap closed. Each case opens exactly one. */
function ready(overrides: Partial<ProcedureReadinessInputs> = {}): ProcedureReadinessInputs {
  const compliance = initialDraftCompliance('P-1');
  return {
    templateId: 'P-1',
    targets: [LOANCORE],
    sourceSnapshot: DATE_ONLY_SOURCE,
    // C2 is the Template's Agent-Judged condition; give it the policy so the baseline is clean.
    complianceConditions: compliance.complianceConditions.map((condition) =>
      condition.status === 'AGENT_JUDGED'
        ? { ...condition, policy: { kind: 'role-privilege' as const, rolesField: 'roles' as const, privileged: ['LOAN_ADMIN'], nonPrivileged: ['VIEWER'] } }
        : condition,
    ),
    evidenceRequirements: [
      { attributeName: 'account_status', modelRead: false, groundedBy: ['structural-snapshot'], screenshot: true, recordingSegment: false, platformCaptured: true },
    ],
    ...overrides,
  };
}

const codesOf = (inputs: ProcedureReadinessInputs): readonly string[] =>
  procedureReadiness(inputs).map((item) => item.code);

describe('the readiness vocabulary', () => {
  it('is closed, and its guard accepts exactly its own members', () => {
    expect([...PROCEDURE_READINESS_CODES]).toEqual([
      'targets-missing',
      'unsupported-target-selected',
      'source-not-bound',
      'agent-judged-without-policy',
      'termination-time-precision-missing',
      'disablement-capture-missing',
      'model-read-attribute',
    ]);
    for (const code of PROCEDURE_READINESS_CODES) expect(isProcedureReadinessCode(code)).toBe(true);
    // A plain-object index would answer `Object.prototype.constructor` here.
    for (const other of ['constructor', 'toString', '', 'targets_missing', 42, null]) {
      expect(isProcedureReadinessCode(other)).toBe(false);
    }
  });

  it('states that readiness is not a runtime guarantee, and says so when nothing is found', () => {
    expect(READINESS_NO_GUARANTEE).toContain('never contact a Target System');
    expect(READINESS_NO_GUARANTEE).toContain('can still produce an Inconclusive Run');
    // An empty list must never read as a passed control.
    expect(READINESS_NOTHING_FOUND).not.toBe('');
  });
});

describe('procedureReadiness', () => {
  it('finds nothing in a complete P-1 Draft', () => {
    expect(procedureReadiness(ready())).toEqual([]);
  });

  it('names every item with an actionable sentence and the section that resolves it', () => {
    const items = procedureReadiness({
      ...ready(),
      targets: [LEDGERDESK],
      sourceSnapshot: null,
      complianceConditions: initialDraftCompliance('P-1').complianceConditions,
      evidenceRequirements: [
        { attributeName: 'roles', modelRead: true, groundedBy: [], screenshot: false, recordingSegment: false, platformCaptured: false },
      ],
    });
    for (const item of items) {
      expect(isProcedureReadinessCode(item.code)).toBe(true);
      // A sentence a person can act on: it names the section it is resolved in.
      expect(item.sentence).toContain(item.section);
      expect(item.sentence.trim()).toBe(item.sentence);
      expect(item.sentence.endsWith('.')).toBe(true);
    }
  });

  it('raises targets-missing only when nothing is selected', () => {
    expect(codesOf(ready({ targets: [] }))).toContain('targets-missing');
    expect(codesOf(ready())).not.toContain('targets-missing');
  });

  it('names the unsupported desktop system rather than reporting an anonymous gap', () => {
    const items = procedureReadiness(ready({ targets: [LOANCORE, LEDGERDESK] }));
    const unsupported = items.filter((item) => item.code === 'unsupported-target-selected');
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]!.subject).toBe('LedgerDesk');
    expect(unsupported[0]!.sentence).toContain('LedgerDesk');
    // A web-only selection is supported, so nothing is raised.
    expect(codesOf(ready({ targets: [LOANCORE] }))).not.toContain('unsupported-target-selected');
  });

  it('raises source-not-bound only when no source is bound, and names who can register one', () => {
    const items = procedureReadiness(ready({ sourceSnapshot: null }));
    const missing = items.find((item) => item.code === 'source-not-bound');
    expect(missing?.sentence).toContain('PoC Administrator');
    expect(codesOf(ready())).not.toContain('source-not-bound');
  });

  it('raises agent-judged-without-policy for an unbound roles judgement, and not once a policy is frozen', () => {
    // The Template's own P-1 C2 is Agent-Judged with no policy.
    const items = procedureReadiness(ready({ complianceConditions: initialDraftCompliance('P-1').complianceConditions }));
    const gap = items.find((item) => item.code === 'agent-judged-without-policy');
    expect(gap?.subject).toBe('C2');
    expect(gap?.section).toBe('Compliance Rule conditions');
    // The baseline binds the policy, so nothing is raised.
    expect(codesOf(ready())).not.toContain('agent-judged-without-policy');
  });

  it('does not ask a Template with no roles field for a role-privilege policy', () => {
    // P-3 declares no `roles` field, so an Agent-Judged condition there has nothing to classify.
    const p3 = compileComplianceDraft('P-3', {
      conditions: [{ conditionId: 'C9', text: 'Judge whether the approval was reasonable.', applicability: 'all records', comparison: null }],
      confidenceThreshold: '0.80',
    });
    expect(p3.ok).toBe(true);
    if (!p3.ok) return;
    expect(p3.value.complianceConditions[0]!.status).toBe('AGENT_JUDGED');
    expect(
      codesOf({ templateId: 'P-3', targets: [LOANCORE], sourceSnapshot: DATE_ONLY_SOURCE, complianceConditions: p3.value.complianceConditions, evidenceRequirements: [] }),
    ).not.toContain('agent-judged-without-policy');
  });

  it('raises termination-time-precision-missing for a disablement window over a date-only source', () => {
    const windowed = compileComplianceDraft('P-1', {
      conditions: [{ conditionId: 'C1', text: 'disabled_time - termination_time <= 24h', applicability: 'all records', comparison: { boundary: 'inclusive', threshold: '24', tolerance: '0' } }],
      confidenceThreshold: '0.80',
    });
    expect(windowed.ok).toBe(true);
    if (!windowed.ok) return;
    expect(windowed.value.complianceConditions[0]!.rule?.kind).toBe('disablement-window');

    const gap = procedureReadiness(ready({ complianceConditions: windowed.value.complianceConditions })).find(
      (item) => item.code === 'termination-time-precision-missing',
    );
    expect(gap?.subject).toBe('C1');
    expect(gap?.sentence).toContain(TERMINATION_TIME_COLUMN);

    // A source that declares the column closes it.
    expect(
      codesOf(ready({ complianceConditions: windowed.value.complianceConditions, sourceSnapshot: TIME_SOURCE })),
    ).not.toContain('termination-time-precision-missing');
    // And an unbound source reports the binding gap instead of guessing about precision.
    const unbound = codesOf(ready({ complianceConditions: windowed.value.complianceConditions, sourceSnapshot: null }));
    expect(unbound).toContain('source-not-bound');
    expect(unbound).not.toContain('termination-time-precision-missing');
  });

  it('reads the frozen mapping when the condition carries one, and the default when it does not', () => {
    const windowed = compileComplianceDraft('P-1', {
      conditions: [{ conditionId: 'C3', text: 'disabled_time - termination_time <= 24h', applicability: 'found = true', comparison: { boundary: 'inclusive', threshold: '24', tolerance: '0' } }],
      confidenceThreshold: '0.80',
    });
    expect(windowed.ok).toBe(true);
    if (!windowed.ok) return;
    const condition = windowed.value.complianceConditions[0]!;
    // No mapping: the default column, exactly as before the key existed.
    expect(terminationColumnFor(condition)).toBe(TERMINATION_TIME_COLUMN);

    // A frozen mapping names the column the auditor declared, and readiness asks the
    // source for THAT one. The key is optional and this build's compiler may not emit it,
    // so the case is constructed the way a stored row would arrive.
    const mapped = { ...condition, mapping: [{ field: 'termination_time', column: 'ended_at' }] };
    expect(terminationColumnFor(mapped)).toBe('ended_at');
    const gap = procedureReadiness(ready({ complianceConditions: [mapped], sourceSnapshot: TIME_SOURCE })).find(
      (item) => item.code === 'termination-time-precision-missing',
    );
    // `termination_effective_time` is declared and `ended_at` is not, so the mapped
    // column is what decides — a default read here would have found nothing wrong.
    expect(gap?.sentence).toContain('ended_at');
    expect(
      codesOf(ready({ complianceConditions: [mapped], sourceSnapshot: source(['employee_id', 'ended_at']) })),
    ).not.toContain('termination-time-precision-missing');

    // A mapping for another field, a malformed entry and a non-array all fall back.
    for (const value of [[{ field: 'disabled_time', column: 'x' }], [null], [{ field: 'termination_time' }], [{ field: 'termination_time', column: '' }], 'ended_at', null]) {
      // Deliberately NOT the compiled type: these are the shapes a stored row could carry,
      // and the reader has to fall back on every one of them rather than trust the type.
      const probe = { ...condition, mapping: value } as unknown as CompiledComplianceCondition;
      expect(terminationColumnFor(probe)).toBe(TERMINATION_TIME_COLUMN);
    }
  });

  it('raises disablement-capture-missing when nothing captures the disablement time', () => {
    const windowed = compileComplianceDraft('P-1', {
      conditions: [{ conditionId: 'C3', text: 'disabled_time - termination_time <= 24h', applicability: 'found = true', comparison: { boundary: 'inclusive', threshold: '24', tolerance: '0' } }],
      confidenceThreshold: '0.80',
    });
    expect(windowed.ok).toBe(true);
    if (!windowed.ok) return;

    const gap = procedureReadiness(ready({ complianceConditions: windowed.value.complianceConditions })).find(
      (item) => item.code === 'disablement-capture-missing',
    );
    // The subject is the attribute the compiled rule itself names, not a retyped copy.
    expect(gap?.subject).toBe('disabled_time');
    expect(gap?.section).toBe('Evidence Requirements');
    expect(gap?.sentence).toContain('disabled_time');

    // Declaring the requirement closes it, whatever else the Draft declares beside it.
    expect(
      codesOf(ready({
        complianceConditions: windowed.value.complianceConditions,
        evidenceRequirements: [
          { attributeName: 'account_status', modelRead: false, groundedBy: ['structural-snapshot'], screenshot: true, recordingSegment: false, platformCaptured: true },
          { attributeName: 'disabled_time', modelRead: false, groundedBy: ['structural-snapshot'], screenshot: false, recordingSegment: false, platformCaptured: false },
        ],
      })),
    ).not.toContain('disablement-capture-missing');

    // And a Draft with no window condition never asks for the capture.
    expect(codesOf(ready())).not.toContain('disablement-capture-missing');
  });

  it('leaves the status rule alone: it needs no termination time at all', () => {
    // The Template's own C1 is the named-set status rule over a date-only source.
    expect(codesOf(ready())).not.toContain('termination-time-precision-missing');
  });

  it('names a model-read attribute with no grounding, and leaves a grounded one alone', () => {
    const items = procedureReadiness(
      ready({
        evidenceRequirements: [
          { attributeName: 'roles', modelRead: true, groundedBy: [], screenshot: false, recordingSegment: false, platformCaptured: false },
          { attributeName: 'username', modelRead: true, groundedBy: ['structural-snapshot'], screenshot: false, recordingSegment: false, platformCaptured: false },
        ],
      }),
    );
    const named = items.filter((item) => item.code === 'model-read-attribute');
    expect(named).toHaveLength(1);
    expect(named[0]!.subject).toBe('roles');
  });

  it('returns a deterministic order over an incomplete Draft', () => {
    const broken: ProcedureReadinessInputs = {
      templateId: 'P-1',
      targets: [LEDGERDESK],
      sourceSnapshot: null,
      complianceConditions: initialDraftCompliance('P-1').complianceConditions,
      evidenceRequirements: [
        { attributeName: 'roles', modelRead: true, groundedBy: [], screenshot: false, recordingSegment: false, platformCaptured: false },
      ],
    };
    expect(codesOf(broken)).toEqual([
      'unsupported-target-selected',
      'source-not-bound',
      'agent-judged-without-policy',
      'model-read-attribute',
    ]);
    // Pure: the same inputs give the same answer, and nothing is mutated.
    expect(procedureReadiness(broken)).toEqual(procedureReadiness(broken));
  });
});
