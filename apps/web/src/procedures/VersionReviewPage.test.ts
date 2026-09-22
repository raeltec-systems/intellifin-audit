import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, describe, it, vi } from 'vitest';
import { deriveExecutablePlan, diffReviewedDefinitions, type ReviewedDefinition, type VersionDecisionRecord } from '@intellifin/domain';
import { initialPlanDerivation, type ProcedureVersionView } from '@intellifin/application';
import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import VersionReviewPage from '../../app/procedures/[id]/versions/[versionId]/page';
import { decisionWord } from './version-review-words';
import { DIFF_WORDS } from './VersionDiff';
import { CONDITION_NOT_IN_WORDS } from './condition-words';
import {
  FIRST_VERSION_SENTENCE,
  FROZEN_CONTRACT_SUMMARY,
  REVIEW_HEADINGS,
  SAVED_DECISION_LABEL,
  comparedWithSentence,
  templateWords,
} from './review/review-words';
let row: ProcedureVersionView;
const names = vi.fn(async (_userIds: readonly string[]) => new Map<string, string>());
vi.mock('@intellifin/infrastructure',()=>({DrizzleProcedureRepository:class {async findVersion(){return row;} async activatedSuccessors(){return new Map();}},DrizzleActorNameReader:class {namesFor=names;}}));
vi.mock('../bootstrap',()=>({getRuntime:async()=>({db:{}})}));
vi.mock('../server-session',()=>({requireServerAction:async()=>({allowed:true}),currentIdentity:async()=>({kind:'identified',role:'audit-manager',session:{userId:'reviewer',sessionId:'session'}})}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn(),push:vi.fn()}),notFound:()=>{throw new Error('not found');}}));
// The decision controls are a client component whose dialog portals into a container set
// in an effect, so under `renderToStaticMarkup` it renders nothing at all. What the page
// owns is the SUBJECT it hands them; the sentences themselves are proved in
// `version-review-words.test.ts`.
vi.mock('./VersionActions',()=>({VersionActions:(props:{subject?:{controlName:string;versionNumber:number;firstVersion:boolean}})=>React.createElement('output',{'data-subject-control':props.subject?.controlName,'data-subject-version':props.subject?.versionNumber,'data-subject-first':String(props.subject?.firstVersion)})}));
it('renders the submitted definition even when live operational plan metadata advances',async()=>{
  const inputs=executablePlanInputs(), result=deriveExecutablePlan(inputs); if(!result.ok) throw new Error(result.reason);
  const saved={...result.plan,sessionSteps:result.plan.sessionSteps.map((step,index)=>index===0?{...step,text:'Saved submitted steps'}:step)};
  const definition:ReviewedDefinition & {compiledPlan:typeof saved}={schemaVersion:1,inputs,compiledPlan:saved,modelConfiguration:{provider:'saved-provider',modelId:'saved-model',promptVersion:'1'},toolConfiguration:{interpreterContract:'executable-plan-v1',identityMatching:'opaque-exact-strings',accessPolicy:'frozen-registered-read-actions',actions:['create-workspace']}};
  row={...inputs,...initialPlanDerivation(),procedureId:'procedure',versionId:'version',versionNumber:1,state:'SUBMITTED',targetBlockers:[],evidenceBlockers:[],createdAt:'2026-09-05T00:00:00Z',updatedAt:'2026-09-05T01:00:00Z',compiledPlan:{...saved,sessionSteps:saved.sessionSteps.map((step,index)=>index===0?{...step,text:'Later operational steps'}:step)},derivationModel:{provider:'later-provider',modelId:'later-model',promptVersion:'2'},planStatus:'succeeded',submittedReview:{schemaVersion:1,versionId:'version',baseline:null,definition,diff:diffReviewedDefinitions(null,definition)}};
  const html=renderToStaticMarkup(await VersionReviewPage({params:Promise.resolve({id:'procedure',versionId:'version'})}));
  expect(html).toContain('Saved submitted steps'); expect(html).not.toContain('Later operational steps');
  expect(html).toContain('saved-model'); expect(html).not.toContain('later-model');
});

/** Two saved decisions by two different people, one of them in a non-UTC offset. */
const DECISIONS: readonly VersionDecisionRecord[] = [
  { schemaVersion: 1, actorId: 'author-id', occurredAt: '2026-09-05T01:00:00.000+02:00', priorState: 'DRAFT', decision: 'submit', rationale: null, aggregateRevision: 'a'.repeat(64) },
  { schemaVersion: 1, actorId: 'manager-id', occurredAt: '2026-09-06T09:30:00.000Z', priorState: 'SUBMITTED', decision: 'reject', rationale: 'Widen the Period.', aggregateRevision: 'b'.repeat(64) },
];

async function renderVersion(overrides: Partial<ProcedureVersionView> = {}, baselineVersionNumber: number | null = null): Promise<string> {
  const inputs = executablePlanInputs(), result = deriveExecutablePlan(inputs);
  if (!result.ok) throw new Error(result.reason);
  const definition: ReviewedDefinition & { compiledPlan: typeof result.plan } = { schemaVersion: 1, inputs, compiledPlan: result.plan, modelConfiguration: { provider: 'saved-provider', modelId: 'saved-model', promptVersion: '1' }, toolConfiguration: { interpreterContract: 'executable-plan-v1', identityMatching: 'opaque-exact-strings', accessPolicy: 'frozen-registered-read-actions', actions: ['create-workspace'] } };
  // A later version compares against a predecessor whose scope differs by one sentence,
  // so exactly one authored fact should be reported as changed.
  const previous: ReviewedDefinition = { ...definition, inputs: { ...inputs, scope: 'The predecessor scope.' } };
  const baseline = baselineVersionNumber === null ? null : { versionId: 'baseline', versionNumber: baselineVersionNumber, revision: 'c'.repeat(64) };
  row = { ...inputs, ...initialPlanDerivation(), procedureId: 'procedure', versionId: 'version', versionNumber: 3, state: 'SUBMITTED', targetBlockers: [], evidenceBlockers: [], createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T01:00:00Z', compiledPlan: result.plan, derivationModel: definition.modelConfiguration, planStatus: 'succeeded', decisions: DECISIONS, submittedReview: { schemaVersion: 1, versionId: 'version', baseline, definition, diff: diffReviewedDefinitions(baseline === null ? null : previous, definition) }, ...overrides };
  return renderToStaticMarkup(await VersionReviewPage({ params: Promise.resolve({ id: 'procedure', versionId: 'version' }) }));
}

function region(html: string, marker: string): string {
  const start = html.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<', start);
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(open))?.[1] ?? 'div';
  const end = html.indexOf(`</${tag}>`, start);
  return html.slice(open, end === -1 ? undefined : end);
}

/** The Decision history disclosure alone: `approve` also appears in control ids and labels. */
function decisionHistory(html: string): string {
  return region(html, 'data-decision-history');
}

/**
 * UX-11: the surface printed `decision.actorId` — an opaque id — as the person
 * accountable for an audit decision, beside the stored decision value and a raw stored
 * timestamp.
 */
describe('the decision history names people, not identifiers', () => {
  it('resolves every actor through the one id-to-name port, in one statement', async () => {
    names.mockClear();
    names.mockResolvedValueOnce(new Map([['author-id', 'Dana Mwale'], ['manager-id', 'Ada Mensah']]));
    const html = await renderVersion();
    // One statement, and the responsible author is resolved with the decision actors —
    // the decision bar names them all and a second read would be a second statement.
    expect(names).toHaveBeenCalledTimes(1);
    expect(names.mock.calls[0]![0]).toEqual(expect.arrayContaining(['author-id', 'manager-id']));
    const history = decisionHistory(html);
    expect(history).toContain('Dana Mwale');
    expect(history).toContain('Ada Mensah');
    expect(history).not.toContain('author-id');
    expect(history).not.toContain('manager-id');
  });

  it('shows the id when no name is known, rather than a blank where a person belongs', async () => {
    names.mockResolvedValueOnce(new Map());
    const history = decisionHistory(await renderVersion());
    expect(history).toContain('author-id');
    expect(history).toContain('ls-mono');
  });

  it('names the same person in the one Saved decision the surface shows', async () => {
    names.mockResolvedValueOnce(new Map([['manager-id', 'Ada Mensah']]));
    const html = await renderVersion();
    const saved = region(html, 'data-saved-decision');
    expect(saved).toContain('Ada Mensah');
    expect(saved).not.toContain('manager-id');
    // UX-34: "Saved decision" is said ONCE. It used to be a heading above the content
    // AND the last row of the Decision history directly below it.
    expect(html.split(SAVED_DECISION_LABEL).length - 1).toBe(1);
  });

  it('writes the decision as a word and never as the stored value', async () => {
    names.mockResolvedValueOnce(new Map([['author-id', 'Dana Mwale'], ['manager-id', 'Ada Mensah']]));
    const history = decisionHistory(await renderVersion());
    expect(history).toContain(decisionWord('submit'));
    expect(history).toContain(decisionWord('reject'));
    // `submit` and `reject` are stored values; a reader should never meet one.
    expect(history).not.toMatch(/(^|[^A-Za-z])submit([^A-Za-z]|$)/);
    expect(history).not.toMatch(/(^|[^A-Za-z])reject([^A-Za-z]|$)/);
  });

  it('reads every instant as readable UTC, keeping the exact instant machine-readable', async () => {
    names.mockResolvedValueOnce(new Map());
    const history = decisionHistory(await renderVersion());
    // UX-02: a person reads `4 Sep 2026, 23:00:00 UTC`, and the `datetime` attribute
    // carries the same instant exactly. The stored text has a +02:00 offset, so a page
    // that printed it verbatim would show a local time on a UTC-only surface.
    expect(history).toContain('4 Sep 2026, 23:00:00 UTC');
    // `renderToStaticMarkup` writes the React prop name; HTML attribute names are
    // ASCII case-insensitive, so a browser parses this as `datetime`.
    expect(history).toContain('dateTime="2026-09-04T23:00:00.000Z"');
    expect(history).toContain('6 Sep 2026, 09:30:00 UTC');
    // The raw ISO instant is never the visible text of an ordinary surface.
    expect(history).not.toContain('>2026-09-06T09:30:00.000Z<');
  });

  it('keeps the rationale a rejecting manager wrote', async () => {
    names.mockResolvedValueOnce(new Map());
    expect(decisionHistory(await renderVersion())).toContain('Widen the Period.');
  });

  it('collapses the history into a disclosure that says how many decisions it holds', async () => {
    names.mockResolvedValueOnce(new Map());
    const history = decisionHistory(await renderVersion());
    expect(history).toContain('<details');
    expect(history).toContain(`${REVIEW_HEADINGS.history} · 2 decisions`);
  });
});

/**
 * UX-33: the submitted-version review was 13,887px of nested frozen structures. It now
 * leads with what an approver decides, and the frozen contract is behind ONE disclosure.
 */
describe('the review leads with the decision summary', () => {
  it('states what is tested, the scope, the systems, the criteria, the proof and the frequency', async () => {
    names.mockResolvedValueOnce(new Map());
    const html = await renderVersion();
    for (const heading of [REVIEW_HEADINGS.tested, REVIEW_HEADINGS.scope, REVIEW_HEADINGS.systems, REVIEW_HEADINGS.criteria, REVIEW_HEADINGS.evidence, REVIEW_HEADINGS.frequency, REVIEW_HEADINGS.access]) {
      expect(html, heading).toContain(heading);
    }
    // The Template is named, never shown as its stored id on the ordinary reading.
    expect(html).toContain(templateWords(row.templateId));
  });

  it('says a criterion the audit reader cannot express as what it is, with the approved text', async () => {
    // This fixture is P-4, whose Template criterion is frozen prose the simple reader
    // has no shape for. A surface that invented a sentence there would describe a rule
    // the version did not freeze; `DecisionSummary.test.ts` proves the other arm, where
    // `conditionSentence` really does answer.
    names.mockResolvedValueOnce(new Map());
    const criteria = region(await renderVersion(), 'data-review-block="criteria"');
    expect(criteria).toContain(CONDITION_NOT_IN_WORDS);
    expect(criteria).toContain('Observed and approved normalized values are equal.');
  });

  it('renders the executable plan contract ONCE, inside the technical disclosure', async () => {
    names.mockResolvedValueOnce(new Map());
    const html = await renderVersion();
    // `ExecutablePlanPreview` is a client component; under SSR it renders its own card,
    // and the page must mount exactly one of them, after the disclosure's summary.
    const previews = html.split('data-testid="executable-plan-preview"').length - 1;
    expect(previews).toBe(1);
    const disclosure = html.indexOf(FROZEN_CONTRACT_SUMMARY);
    expect(disclosure).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="executable-plan-preview"')).toBeGreaterThan(disclosure);
    // And the stored section-by-section diff is inside it too, not above the summary.
    expect(html.indexOf('data-version-diff')).toBeGreaterThan(disclosure);
  });

  it('puts the decision above everything it is a decision about', async () => {
    names.mockResolvedValueOnce(new Map());
    const html = await renderVersion();
    const bar = html.indexOf('data-decision-bar');
    expect(bar).toBeGreaterThan(-1);
    expect(bar).toBeLessThan(html.indexOf(REVIEW_HEADINGS.tested));
    expect(bar).toBeLessThan(html.indexOf('data-subject-control'));
    // Exactly one set of decision controls. Two would be two Approve buttons for one
    // version, and a guard withdrawn on one of them.
    expect(html.split('data-subject-control').length - 1).toBe(1);
  });

  it('never shows a raw identifier outside the technical disclosure', async () => {
    names.mockResolvedValueOnce(new Map());
    const html = await renderVersion();
    const ordinary = html.slice(0, html.indexOf(FROZEN_CONTRACT_SUMMARY));
    for (const id of [row.versionId, row.procedureId]) {
      // The identifiers still appear in `href`s and control ids, which are not text a
      // reader meets; what must not appear is the id rendered as a value.
      expect(ordinary, id).not.toContain(`>${id}<`);
    }
  });
});

/**
 * UX-33: the stored diff marks EVERY section of a first version `changed` — a review
 * with no baseline must — so rendering that flag told an approver that fourteen sections
 * had been changed by somebody on a version with no predecessor at all.
 */
describe('what changed is compared against something', () => {
  it('says a first version has nothing to compare, and marks no section Changed', async () => {
    names.mockResolvedValueOnce(new Map());
    const html = await renderVersion();
    expect(region(html, 'data-what-changed')).toContain(FIRST_VERSION_SENTENCE);
    expect(html).not.toContain(`· ${DIFF_WORDS.changed}`);
    // The stored sections are still there, as New, under the technical disclosure.
    expect(html).toContain(`· ${DIFF_WORDS.first}`);
  });

  it('lists only the facts a later version really changed, as before → after', async () => {
    names.mockResolvedValueOnce(new Map());
    const changed = region(await renderVersion({}, 2), 'data-what-changed');
    expect(changed).toContain(comparedWithSentence(2));
    expect(changed).toContain('The predecessor scope.');
    expect(changed).toContain(row.scope);
    // One authored fact differs, so one authored section is listed — never fourteen.
    expect(changed.split('<dt>').length - 1).toBe(1);
  });
});

/**
 * UX-13: the surface a manager approves from had no breadcrumb and no way back to the
 * Procedure. The shell already stands its own trail down for `/procedures/**`
 * (`rendersOwnTrail`), so before this there was no trail at all.
 */
describe('the version review surface can be left', () => {
  it('trails itself: Procedures, the Control name, the version', async () => {
    names.mockResolvedValueOnce(new Map());
    const html = await renderVersion();
    const trail = /<nav class="ls-breadcrumbs" aria-label="Breadcrumb">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    expect(trail).toContain('Procedures');
    expect(trail).toContain(row.controlName);
    expect(trail).toContain('Version 3');
    expect(trail).toContain('href="/procedures"');
    expect(trail).toContain('href="/procedures/procedure"');
  });

  it('renders exactly one Breadcrumb landmark', async () => {
    // Two `<nav aria-label="Breadcrumb">` on one page are two landmarks a screen reader
    // cannot tell apart, and axe never reports it: `landmark-unique` is a best-practice
    // rule and never reaches `results.violations`.
    names.mockResolvedValueOnce(new Map());
    const html = await renderVersion();
    expect(html.split('aria-label="Breadcrumb"').length - 1).toBe(1);
  });

  it('offers a named way back to the Procedure', async () => {
    names.mockResolvedValueOnce(new Map());
    const html = await renderVersion();
    expect(html).toContain('>Back to Procedure</a>');
  });
});

/**
 * UX-17: the approval dialog said "Approve?" over a generic consequence. The page is
 * what knows which Procedure and which version; the words are proved separately.
 */
describe('the decision controls are told what they are deciding', () => {
  it('names the Control and the version number', async () => {
    names.mockResolvedValueOnce(new Map());
    const html = await renderVersion();
    expect(html).toContain('data-subject-control="' + row.controlName + '"');
    expect(html).toContain('data-subject-version="3"');
  });

  it('says a later version is not the first, because an Active predecessor may exist', async () => {
    names.mockResolvedValueOnce(new Map());
    expect(await renderVersion()).toContain('data-subject-first="false"');
  });

  it('says version 1 is the first, where approval always activates at once', async () => {
    // Version numbers start at 1 and rise, and no transition returns a later state to
    // SUBMITTED, so a submitted version 1 is the only version this Procedure has.
    names.mockResolvedValueOnce(new Map());
    expect(await renderVersion({ versionNumber: 1 })).toContain('data-subject-first="true"');
  });
});
