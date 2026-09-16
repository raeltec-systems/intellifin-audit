import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, describe, it, vi } from 'vitest';
import { deriveExecutablePlan, diffReviewedDefinitions, type ReviewedDefinition, type VersionDecisionRecord } from '@intellifin/domain';
import { initialPlanDerivation, type ProcedureVersionView } from '@intellifin/application';
import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import VersionReviewPage from '../../app/procedures/[id]/versions/[versionId]/page';
import { decisionWord } from './version-review-words';
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

async function renderVersion(overrides: Partial<ProcedureVersionView> = {}): Promise<string> {
  const inputs = executablePlanInputs(), result = deriveExecutablePlan(inputs);
  if (!result.ok) throw new Error(result.reason);
  const definition: ReviewedDefinition & { compiledPlan: typeof result.plan } = { schemaVersion: 1, inputs, compiledPlan: result.plan, modelConfiguration: { provider: 'saved-provider', modelId: 'saved-model', promptVersion: '1' }, toolConfiguration: { interpreterContract: 'executable-plan-v1', identityMatching: 'opaque-exact-strings', accessPolicy: 'frozen-registered-read-actions', actions: ['create-workspace'] } };
  row = { ...inputs, ...initialPlanDerivation(), procedureId: 'procedure', versionId: 'version', versionNumber: 3, state: 'SUBMITTED', targetBlockers: [], evidenceBlockers: [], createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T01:00:00Z', compiledPlan: result.plan, derivationModel: definition.modelConfiguration, planStatus: 'succeeded', decisions: DECISIONS, submittedReview: { schemaVersion: 1, versionId: 'version', baseline: null, definition, diff: diffReviewedDefinitions(null, definition) }, ...overrides };
  return renderToStaticMarkup(await VersionReviewPage({ params: Promise.resolve({ id: 'procedure', versionId: 'version' }) }));
}

/** The Decision history section alone: `approve` also appears in control ids and labels. */
function decisionHistory(html: string): string {
  return /<section aria-label="Decision history">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
}

/**
 * UX-11: the surface printed `decision.actorId` — an opaque id — as the person
 * accountable for an audit decision, beside the stored decision value and a raw stored
 * timestamp.
 */
describe('the decision history names people, not identifiers', () => {
  it('resolves every actor through the one id-to-name port, in one statement', async () => {
    names.mockResolvedValueOnce(new Map([['author-id', 'Dana Mwale'], ['manager-id', 'Ada Mensah']]));
    const html = await renderVersion();
    expect(names).toHaveBeenCalledWith(['author-id', 'manager-id']);
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

  it('names the same person in the Saved decision section', async () => {
    names.mockResolvedValueOnce(new Map([['manager-id', 'Ada Mensah']]));
    const html = await renderVersion();
    const saved = /<h2>Saved decision<\/h2>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
    expect(saved).toContain('Ada Mensah');
    expect(saved).not.toContain('manager-id');
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

  it('reads every timestamp as ISO 8601 UTC, keeping the stored instant machine-readable', async () => {
    names.mockResolvedValueOnce(new Map());
    const history = decisionHistory(await renderVersion());
    // EXPERIENCE.md fixes ISO 8601 UTC on every surface. The stored text carries a +02:00
    // offset, so a page that printed it verbatim would show a local time on a UTC surface.
    expect(history).toContain('2026-09-04T23:00:00.000Z');
    // `renderToStaticMarkup` writes the React prop name; HTML attribute names are
    // ASCII case-insensitive, so a browser parses this as `datetime`.
    expect(history).toContain('dateTime="2026-09-05T01:00:00.000+02:00"');
    expect(history).toContain('2026-09-06T09:30:00.000Z');
  });

  it('keeps the rationale a rejecting manager wrote', async () => {
    names.mockResolvedValueOnce(new Map());
    expect(decisionHistory(await renderVersion())).toContain('Widen the Period.');
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
