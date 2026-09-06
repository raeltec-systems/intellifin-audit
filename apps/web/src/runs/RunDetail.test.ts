import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GATE_CHECKS, OUTCOME_ROWS } from '@intellifin/domain';
import type {
  RunEvidenceItem,
  RunExceptionRow,
  RunGateRow,
  RunObservationRow,
  RunResultRow,
  RunTimelineRead,
} from '@intellifin/infrastructure';

import { EvidenceCard, GroundingInspector, evidenceCardProps } from './EvidenceCards';
import { ExceptionCard } from './ExceptionList';
import { GateChecklist } from './GateChecklist';
import { SafeNextActionPanel } from './ResultSections';
import { ADAPTER_ACTIONS_UNRECORDED } from '../design/copy';
import { ExecutionTimeline } from './Timeline';
import { ConclusionTriptych } from './Triptych';
import { UntrustedText } from './UntrustedText';

/**
 * The Run Detail components, rendered server-side.
 *
 * Every property under test is a property of the MARKUP — which cell is clickable, which
 * sentence a Run with no Gate rows shows, whether a Target System's own words reach the
 * page as prose — so each one is rendered rather than asserted through a helper.
 */

const RUN_ID = '019823ab-0000-7000-8000-000000000001';

function result(overrides: Partial<RunResultRow> = {}): RunResultRow {
  return {
    version: 1,
    outcome: 'PASS',
    outcomeRow: 'pass',
    sealed: true,
    gatePassed: true,
    sealedAt: '2026-09-06T09:03:41.000Z',
    scope: 'Every account of every employee terminated in the period.',
    publication: {
      templateId: 'P-1',
      controlName: 'Terminated Users',
      scope: null,
      period: { from: '2026-08-01', to: '2026-08-31' },
      population: { rowsParsed: 10, included: 8, excluded: 2, indeterminate: 0 },
      exclusions: [],
      coverage: [],
      conditions: [],
      exceptions: { total: 0, records: [] },
      unevaluated: { total: 0, records: [] },
      controlFields: [],
      gate: { passed: true, checks: GATE_CHECKS.length, failed: [] },
      evidence: { state: 'SEALED', requiredTotal: 1, registered: 1, missingRequired: 0, abandoned: 0 },
      statement: 'Every condition on every inspected record is Compliant.',
    },
    ...overrides,
  };
}

const triptych = (props: Parameters<typeof ConclusionTriptych>[0]): string =>
  renderToStaticMarkup(React.createElement(ConclusionTriptych, props));

describe('the conclusion triptych', () => {
  it('shows three cells and makes none of them clickable', () => {
    const html = triptych({ state: 'COMPLETED', result: result(), gateChecks: 20, gateFailed: 0 });
    expect(html.match(/ls-triptych__cell/g) ?? []).toHaveLength(3);
    for (const label of ['Run lifecycle', 'Evidence Quality Gate', 'Result outcome']) {
      expect(html).toContain(label);
    }
    // No cell is clickable: the tabs are the navigation. There is no link, no button and
    // no handler in this component, so one cannot appear by accident.
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<button');
  });

  it('carries the sealed marker and the Result version, and the published statement', () => {
    const html = triptych({ state: 'COMPLETED', result: result(), gateChecks: 20, gateFailed: 0 });
    expect(html).toContain('Sealed');
    expect(html).toContain('Result version');
    expect(html).toContain('>1<');
    expect(html).toContain('Every condition on every inspected record is Compliant.');
    expect(html).toContain('Every account of every employee terminated in the period.');
  });

  it('says Unsealed for a Pending Confirmation Result', () => {
    const html = triptych({
      state: 'COMPLETED',
      result: result({ outcome: 'PENDING_CONFIRMATION', outcomeRow: 'pending-confirmation', sealed: false }),
      gateChecks: 20,
      gateFailed: 0,
    });
    expect(html).toContain('Pending Confirmation');
    expect(html).toContain('Unsealed');
    expect(html).not.toContain('>Sealed<');
  });

  it('states an unreadable published document rather than reaching into it', () => {
    // `run_result.publication` is jsonb whose CHECK says only that it is an object, so an
    // empty document is storable. The outcome, the seal and the version are typed COLUMNS
    // and are still true; only the document is unreadable, and the triptych says which.
    const html = triptych({
      state: 'COMPLETED',
      result: { ...result(), publication: null },
      gateChecks: 20,
      gateFailed: 0,
    });
    expect(html).toContain('Pass');
    expect(html).toContain('Sealed');
    expect(html).toContain('Result version');
    expect(html).toContain('The published Result document could not be read.');
  });

  it('states that no Result exists rather than inventing a version', () => {
    const html = triptych({ state: 'QUEUED', result: null, gateChecks: 0, gateFailed: 0 });
    expect(html).toContain('Queued');
    expect(html).toContain('Not evaluated');
    expect(html).toContain('No conclusion issued');
    expect(html).toContain('No Result version. No Result has been published.');
    expect(html).toContain('No Result has been published for this Run.');
    expect(html).not.toContain('Sealed');
  });
});

const gateRow = (overrides: Partial<RunGateRow> = {}): RunGateRow => ({
  check: 'per-record-coverage',
  outcome: 'FAIL',
  diagnostics: ['record-uninspected'],
  targetSystems: ['accessgate'],
  workItems: ['019823ab-0000-7000-8000-0000000000c1'],
  records: ['E-001'],
  total: 3,
  ...overrides,
});

const checklist = (props: Parameters<typeof GateChecklist>[0]): string =>
  renderToStaticMarkup(React.createElement(GateChecklist, props));

describe('the Evidence Quality Gate checklist', () => {
  it('renders no checklist at all when the Gate never ran, and says why', () => {
    // A Run canceled while queued has NO §H rows. An empty checklist rendered as though
    // the Gate had run and found nothing is the "empty list reads as a passed control"
    // defect in its purest form.
    const html = checklist({
      rows: [],
      runId: RUN_ID,
      failedFirst: false,
      notEvaluatedReason: 'The Run was canceled before the Evidence Quality Gate ran.',
    });
    expect(html).toContain('Not evaluated');
    expect(html).toContain('The Run was canceled before the Evidence Quality Gate ran.');
    expect(html).not.toContain('ls-gate__row');
    expect(html).not.toContain('checks passed');
  });

  it('derives the header count and groups the rows the way EXPERIENCE.md does', () => {
    const rows = GATE_CHECKS.map((check) =>
      gateRow({ check, outcome: 'PASS', diagnostics: [], targetSystems: [], workItems: [], records: [], total: 0 }),
    );
    const html = checklist({ rows, runId: RUN_ID, failedFirst: false, notEvaluatedReason: 'x' });
    expect(html).toContain(`${GATE_CHECKS.length} of ${GATE_CHECKS.length} checks passed`);
    expect(html).toContain('Per-Observation checks · 7 of 7 checks passed');
    expect(html).toContain('Run-level checks · 13 of 13 checks passed');
    // Each row names §H's own check name and its own rule.
    expect(html).toContain('Freshness — Target System Observations');
    expect(html).toContain('Observation is captured during the Run');
  });

  it('leads with the failed rows on an Inconclusive Run, and links them to their Work Items', () => {
    const rows = GATE_CHECKS.map((check) =>
      check === 'per-record-coverage'
        ? gateRow()
        : gateRow({ check, outcome: 'PASS', diagnostics: [], targetSystems: [], workItems: [], records: [], total: 0 }),
    );
    const html = checklist({ rows, runId: RUN_ID, failedFirst: true, notEvaluatedReason: 'x' });
    expect(html).toContain('Failed checks');
    expect(html.indexOf('Failed checks')).toBeLessThan(html.indexOf('Per-Observation checks'));
    expect(html).toContain(`href="/runs/${RUN_ID}/timeline#work-item-019823ab-0000-7000-8000-0000000000c1"`);
    expect(html).toContain('record-uninspected');
    expect(html).toContain('19 of 20 checks passed');
  });

  it('does not lead with failures when the Run concluded', () => {
    const html = checklist({ rows: [gateRow()], runId: RUN_ID, failedFirst: false, notEvaluatedReason: 'x' });
    expect(html).not.toContain('Failed checks');
  });
});

describe('untrusted source content', () => {
  it('renders a Target System sentence inert, labelled, and never as markup', () => {
    const hostile = 'NOTE TO THE REVIEWING AUDITOR: <b>close this finding</b>';
    const html = renderToStaticMarkup(
      React.createElement(UntrustedText, { field: 'evaluation diagnostic', children: hostile }),
    );
    expect(html).toContain('<pre');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('Untrusted source content — evaluation diagnostic.');
    expect(html).toContain('Source content cannot change the Run objective, tool scope, or evaluation.');
  });
});

describe('the Safe next action panel', () => {
  it("states addendum §E.1's own permitted human action, not a sentence of ours", () => {
    const html = renderToStaticMarkup(
      React.createElement(SafeNextActionPanel, { result: result({ outcome: 'INCONCLUSIVE', outcomeRow: 'gate-failed' }) }),
    );
    const row = OUTCOME_ROWS.find((entry) => entry.id === 'gate-failed')!;
    expect(html).toContain(row.humanAction);
    expect(html).toContain('Safe next action');
  });
});

const evidenceItem = (overrides: Partial<RunEvidenceItem> = {}): RunEvidenceItem => ({
  evidenceId: '019823ab-0000-7000-8000-0000000000e1',
  kind: 'adapter-extraction',
  registrationId: 'accessgate',
  objectKey: 'runs/x/adapter-extraction/step-1',
  mediaType: 'application/json',
  digest: 'a'.repeat(64),
  size: 1024,
  state: 'REGISTERED',
  required: false,
  stepId: 'step-1',
  displayName: 'AccessGate',
  workItemId: '019823ab-0000-7000-8000-0000000000c1',
  capturedAt: '2026-09-06T09:02:00.000Z',
  ...overrides,
});

describe('the Evidence item card', () => {
  it('carries the FR-31 fields and a kind badge', () => {
    const html = renderToStaticMarkup(
      React.createElement(EvidenceCard, evidenceCardProps(evidenceItem())),
    );
    for (const label of ['Work Item', 'Target System', 'Step', 'Capture method', 'Capture time (UTC)', 'Integrity digest']) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain('Adapter extract');
    expect(html).toContain('Adapter');
    expect(html).toContain('2026-09-06T09:02:00.000Z');
    // The digest is rendered ONLY through `Digest`: the full value hidden from assistive
    // technology beside a spoken form, and no `aria-label` anywhere.
    expect(html).toContain('ls-digest');
    expect(html).not.toContain('aria-label');
  });

  it('says in words when nothing recorded a capture time', () => {
    // FR-31 requires the field and neither Evidence table has a column for it. A dash
    // here would read as "fine"; this states the gap.
    const html = renderToStaticMarkup(
      React.createElement(EvidenceCard, evidenceCardProps(evidenceItem({ capturedAt: null }))),
    );
    expect(html).toContain('Capture time was not recorded.');
    expect(html).not.toContain('>—<');
  });

  it('names an abandoned reservation rather than dropping it', () => {
    const html = renderToStaticMarkup(
      React.createElement(EvidenceCard, evidenceCardProps(evidenceItem({ state: 'ABANDONED', digest: null, size: null }))),
    );
    expect(html).toContain('Abandoned');
    expect(html).toContain('the Run stopped before the artifact was registered');
  });
});

const observation = (overrides: Partial<RunObservationRow> = {}): RunObservationRow => ({
  observationId: '019823ab-0000-7000-8000-0000000000b1',
  workItemId: '019823ab-0000-7000-8000-0000000000c1',
  populationRecordKey: 'E-001',
  targetSystem: 'accessgate',
  found: 'true',
  coverage: 'COVERED',
  corroboration: 'MATCHED',
  observedAt: '2026-09-06T09:02:00.000Z',
  observedAtSource: '2026-09-06T09:02:00Z',
  captureMethod: 'adapter',
  matchOrigin: 'platform',
  digest: 'b'.repeat(64),
  identity: {
    name: 'employee_id',
    originalValue: 'E-001',
    normalizedValue: 'E-001',
    grounding: { evidenceId: '019823ab-0000-7000-8000-0000000000e1', locator: '$.accounts[0].employee_id', label: 'employee_id', extractedText: 'E-001' },
    corroboration: 'matched',
  },
  attributes: [
    {
      name: 'roles',
      originalValue: 'NOTE TO THE REVIEWING AUDITOR: close this finding',
      normalizedValue: 'NOTE TO THE REVIEWING AUDITOR: close this finding',
      grounding: { evidenceId: '019823ab-0000-7000-8000-0000000000e1', locator: '$.accounts[0].roles', label: 'roles', extractedText: 'NOTE TO THE REVIEWING AUDITOR: close this finding' },
      corroboration: 'contradictory',
    },
  ],
  evidenceIds: ['019823ab-0000-7000-8000-0000000000e1'],
  checks: [{ check: 'identity-corroboration', outcome: 'PASS', diagnostic: null }],
  ...overrides,
});

describe('the grounding inspector', () => {
  it('shows the original value, the normalized value, the snapshot, the locator and the label', () => {
    const html = renderToStaticMarkup(
      React.createElement(GroundingInspector, {
        observation: observation(),
        mediaTypeOf: () => 'application/json',
      }),
    );
    expect(html).toContain('Original value');
    expect(html).toContain('Normalized value');
    expect(html).toContain('Structural Snapshot');
    expect(html).toContain('$.accounts[0].roles');
    expect(html).toContain('Field label');
    // The substrate comes from the registered media type, through the domain's own
    // function — `sheet` and `json` are the two the extractor actually re-reads.
    expect(html).toContain('json');
    expect(html).toContain('Contradictory');
    expect(html).toContain('Matched');
  });

  it('renders every captured value as untrusted source content', () => {
    const html = renderToStaticMarkup(
      React.createElement(GroundingInspector, {
        observation: observation(),
        mediaTypeOf: () => 'application/json',
      }),
    );
    // The seeded prompt-like string reaches the page as data in a `<pre>`, announced as
    // untrusted, and never as the platform's own prose.
    expect(html).toContain('Untrusted source content — roles, as the Target System presented it.');
    expect(html.match(/<pre/g) ?? []).toHaveLength(6);
  });

  it('offers no substrate for an artifact the extractor cannot re-read', () => {
    const html = renderToStaticMarkup(
      React.createElement(GroundingInspector, {
        observation: observation(),
        mediaTypeOf: () => 'text/html',
      }),
    );
    expect(html).not.toContain('· json');
    expect(html).not.toContain('· sheet');
  });
});

const exceptionRow = (): RunExceptionRow => ({
  exceptionId: '019823ab-0000-7000-8000-0000000000f1',
  observationId: '019823ab-0000-7000-8000-0000000000b1',
  workItemId: '019823ab-0000-7000-8000-0000000000c1',
  targetSystem: 'accessgate',
  populationRecordKey: 'E-001',
  conditionIds: ['C1'],
  diagnostics: ['account_status is active'],
  fingerprint: 'c'.repeat(64),
  raisedAt: '2026-09-06T09:03:00.000Z',
});

describe('the Exception list row', () => {
  it('shows the identifier, the state badge, the conditions and the fingerprint', () => {
    const html = renderToStaticMarkup(
      React.createElement(ExceptionCard, {
        exception: exceptionRow(),
        evaluations: [
          {
            observationId: '019823ab-0000-7000-8000-0000000000b1',
            conditionId: 'C1',
            origin: 'RULE',
            value: 'EXCEPTION',
            confirmation: null,
            confidence: null,
            rationale: null,
            diagnostic: 'account_status is active',
          },
        ],
        conditionText: () => 'The account is disabled at the termination date.',
        masked: false,
      }),
    );
    expect(html).toContain('Open');
    expect(html).toContain('E-001');
    expect(html).toContain('Rule-Classified');
    expect(html).toContain('Exception');
    expect(html).toContain('The account is disabled at the termination date.');
    // No "Open" link: Exception Detail is a later epic, and a link to a page that does
    // not exist would send an auditor to a 404.
    expect(html).not.toContain('<a ');
  });

  it('masks the identity where the binding designates it', () => {
    const html = renderToStaticMarkup(
      React.createElement(ExceptionCard, {
        exception: exceptionRow(),
        evaluations: [],
        conditionText: () => null,
        masked: true,
      }),
    );
    expect(html).toContain('••••');
    expect(html).toContain('Masked by the Population Source binding');
    expect(html).not.toContain('E-001');
  });
});

const timeline = (overrides: Partial<RunTimelineRead> = {}): RunTimelineRead => ({
  workspace: null,
  population: {
    status: 'POPULATION_READY',
    attempts: 1,
    diagnostic: null,
    stepId: 'population',
    startedAt: '2026-09-06T09:00:10.000Z',
    attemptStartedAt: '2026-09-06T09:00:10.000Z',
  },
  execution: {
    status: 'EXTRACTION_COMPLETE',
    attempts: 1,
    diagnostic: null,
    startedAt: '2026-09-06T09:01:00.000Z',
    runStartedAt: '2026-09-06T09:00:10.000Z',
  },
  sessionSteps: [
    {
      stepId: 'step-ref',
      ordinal: 1,
      displayName: 'RoleMatrix',
      action: 'extract-adapter',
      registrationId: 'rolematrix',
      state: 'ACQUIRED',
      attempts: 1,
      diagnostic: null,
      evidenceId: null,
    },
  ],
  workItems: [
    {
      workItemId: '019823ab-0000-7000-8000-0000000000c1',
      stepId: 'step-1',
      ordinal: 1,
      displayName: 'AccessGate',
      registrationId: 'accessgate',
      state: 'OBSERVED',
      attempts: 1,
      cycles: 0,
      diagnostic: null,
      evidenceId: null,
      observations: 8,
    },
  ],
  stepExecutions: {
    total: 2,
    rows: [
      {
        stepExecutionId: '019823ab-0000-7000-8000-0000000000d1',
        planStepId: 'step-ref',
        workItemId: null,
        action: 'extract-adapter',
        state: 'SUCCEEDED',
        attempt: 1,
        startedAt: '2026-09-06T09:01:00.000Z',
        completedAt: '2026-09-06T09:01:05.000Z',
        diagnostic: null,
      },
      {
        stepExecutionId: '019823ab-0000-7000-8000-0000000000d2',
        planStepId: 'step-1',
        workItemId: '019823ab-0000-7000-8000-0000000000c1',
        action: 'extract-adapter',
        state: 'SUCCEEDED',
        attempt: 1,
        startedAt: '2026-09-06T09:02:00.000Z',
        completedAt: '2026-09-06T09:02:20.000Z',
        diagnostic: null,
      },
    ],
  },
  toolActions: { total: 0, rows: [] },
  ...overrides,
});

const renderTimeline = (read: RunTimelineRead): string =>
  renderToStaticMarkup(React.createElement(ExecutionTimeline, { timeline: read, runId: RUN_ID }));

describe('the Execution Timeline', () => {
  it('shows no Agent Workspace row for a Run whose plan required none', () => {
    // Most Runs are adapter-only. A workspace row on one of those would say a browser was
    // provisioned for a Run that never had one.
    expect(renderTimeline(timeline())).not.toContain('Create the Agent Workspace');
  });

  it('names the Agent Workspace, the guarantee its mode had, and nests its attempt', () => {
    const html = renderTimeline(
      timeline({
        workspace: {
          status: 'OPEN',
          attempts: 1,
          diagnostic: null,
          stepId: 'session-1',
          mode: 'local',
          startedAt: '2026-09-06T09:00:00.000Z',
          releasedAt: null,
        },
        stepExecutions: {
          total: 1,
          rows: [
            {
              stepExecutionId: '019823ab-0000-7000-8000-0000000000d9',
              planStepId: 'session-1',
              workItemId: null,
              action: 'create-workspace',
              state: 'SUCCEEDED',
              attempt: 1,
              startedAt: '2026-09-06T09:00:00.000Z',
              completedAt: '2026-09-06T09:00:02.000Z',
              diagnostic: null,
            },
          ],
        },
      }),
    );
    expect(html).toContain('Create the Agent Workspace');
    // The two modes are not the same guarantee, so the surface says which one this Run had
    // rather than printing a value nobody can interpret.
    expect(html).toContain('Local browser, shared process');
    // Without this the attempt would be a `run_step_execution` row nothing on the page
    // renders — an invisible Step Execution is the defect this row exists to prevent.
    expect(html).toContain('--ls-timeline-level:1');
  });

  it('nests the Step Executions under the unit that started them, at 20px per level', () => {
    const html = renderTimeline(timeline());
    expect(html).toContain('--ls-timeline-level:0');
    expect(html).toContain('--ls-timeline-level:1');
    expect(html).toContain('Acquire the population');
    expect(html).toContain('RoleMatrix');
    expect(html).toContain('AccessGate');
    // The Work Item is the anchor a failed Gate row links to.
    expect(html).toContain('id="work-item-019823ab-0000-7000-8000-0000000000c1"');
  });

  it('says in words that an adapter Step Execution records no Tool Actions, and stays silent for an agent one', () => {
    // The adapter path writes no `run_tool_action` rows, so its Step Executions render with
    // nothing beneath them — and an empty fourth level reads as "no actions were taken",
    // which is false: the adapter resolved a credential, fetched a collection and froze the
    // response. `Never probed` and `Not evaluated` are the same choice made before.
    const adapter = renderTimeline(timeline());
    expect(adapter).toContain(ADAPTER_ACTIONS_UNRECORDED);

    // An AGENT Step Execution with no Tool Actions really did take none, so it says nothing
    // rather than blaming the build for an absence that is true.
    const agent = renderTimeline(
      timeline({
        stepExecutions: {
          total: 1,
          rows: [
            {
              stepExecutionId: '019823ab-0000-7000-8000-0000000000d3',
              planStepId: 'step-sign-in',
              workItemId: null,
              action: 'sign-in',
              state: 'SUCCEEDED',
              attempt: 1,
              startedAt: '2026-09-06T09:03:00.000Z',
              completedAt: '2026-09-06T09:03:02.000Z',
              diagnostic: null,
            },
          ],
        },
      }),
    );
    expect(agent).not.toContain(ADAPTER_ACTIONS_UNRECORDED);
  });

  it('collapses to Work Item rows by default, and expands a unit whose Step Execution failed', () => {
    const collapsed = renderTimeline(timeline());
    expect(collapsed).toContain('<details');
    expect(collapsed).not.toContain('<details class="ls-expand" open');

    const withFailure = timeline();
    const failed = renderTimeline({
      ...withFailure,
      stepExecutions: {
        total: 2,
        rows: withFailure.stepExecutions.rows.map((execution, index) =>
          index === 1 ? { ...execution, state: 'FAILED', diagnostic: 'extraction-incomplete' } : execution,
        ),
      },
    });
    expect(failed).toContain('open=""');
    expect(failed).toContain('one or more failed');
    expect(failed).toContain('extraction-incomplete');
  });

  it('writes the status word and the duration on every row', () => {
    const html = renderTimeline(timeline());
    expect(html).toContain('Observed');
    expect(html).toContain('Acquired');
    expect(html).toContain('20s');
  });

  it('names the Session Step by the action the plan froze, not by a hard-coded kind', () => {
    // The detail said "Reference Source" for every Session Step, which stopped being true
    // the moment Story 4.2 wrote the first `sign-in` row. A label that states something
    // untrue is worse than one that states nothing.
    const html = renderTimeline(
      timeline({
        sessionSteps: [
          {
            stepId: 'session-2',
            ordinal: 1,
            displayName: 'LoanCore',
            action: 'sign-in',
            registrationId: 'loancore',
            state: 'ACQUIRED',
            attempts: 1,
            diagnostic: null,
            evidenceId: null,
          },
        ],
      }),
    );
    expect(html).toContain('Sign in to the Target System');
    expect(html).not.toContain('Reference Source');
  });

  it('renders the Tool Action and SAYS its capture was suppressed, and why', () => {
    // Story 4.3. The action happened and must be visible; only its content is withheld. A
    // suppression that showed as a gap is what a reader takes for nothing having occurred
    // — the sign-out defect's shape, an absent signal that looks like success.
    const html = renderTimeline(timeline({ toolActions: { total: 1, rows: [SIGN_IN_ACTION] } }));
    expect(html).toContain('Tool Action');
    expect(html).toContain('navigate');
    expect(html).toContain('Capture suppressed');
    expect(html).toContain('a credential was presented on this request');
    expect(html).toContain('http://localhost:4300/loancore');
    expect(html).toContain('Performed');
  });

  it('says capture was PERMITTED for an action that presented no credential', () => {
    // The other half. Without it "capture is suppressed for a credential-entry action" is
    // satisfied by a surface that says so on every row.
    const html = renderTimeline(
      timeline({
        toolActions: {
          total: 1,
          rows: [{ ...SIGN_IN_ACTION, capture: 'PERMITTED', captureSuppression: null }],
        },
      }),
    );
    expect(html).toContain('Capture permitted');
    expect(html).not.toContain('Capture suppressed');
  });

  it('shows a denied Tool Action with the rule that refused it', () => {
    const html = renderTimeline(
      timeline({
        toolActions: {
          total: 1,
          rows: [
            {
              ...SIGN_IN_ACTION,
              outcome: 'denied',
              denial: 'origin-not-allowed',
              status: null,
            },
          ],
        },
      }),
    );
    expect(html).toContain('Denied');
    expect(html).toContain('origin-not-allowed');
  });
});

/** One agent sign-in Tool Action, nested under the workspace's Step Execution. */
const SIGN_IN_ACTION = {
  toolActionId: '019823ab-0000-7000-8000-0000000000e1',
  stepExecutionId: '019823ab-0000-7000-8000-0000000000d1',
  surface: 'agent',
  action: 'navigate',
  method: 'GET',
  destination: 'http://localhost:4300/loancore',
  outcome: 'performed',
  denial: null,
  status: 200,
  redirected: false,
  downloads: 0,
  capture: 'SUPPRESSED',
  captureSuppression: 'credential-entry',
  startedAt: '2026-09-06T09:01:01.000Z',
  completedAt: '2026-09-06T09:01:02.000Z',
  diagnostic: null,
};
