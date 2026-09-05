import { ExecutablePlanSchema } from '@intellifin/domain';
import { ACTION_LABELS } from './plan-step-labels';
import type { JsonValue, VersionSectionDiff } from '@intellifin/domain';
function label(value: string): string {
  const special: Record<string,string> = { sourceSnapshot: 'Population Source', credential_ref: 'Credential reference', allowed_origins: 'Allowed origins or application identity', permitted_actions: 'Permitted read actions', applicabilityAst: 'Compiled applicability', rule: 'Compiled condition', status: 'Evaluation origin', groundedBy: 'Grounding Evidence', modelRead: 'Read by the model', platformCaptured: 'Captured by the platform', zeroRecordPass: 'Permit a zero-record Pass', allowVersionedDuplicates: 'Permit versioned duplicate primary keys', from: 'Start date', to: 'End date' };
  return special[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_',' ').replace(/^./, c => c.toUpperCase());
}
function Value({ value }: { value: JsonValue }): React.JSX.Element {
  if (value === null) return <span>Not set</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value !== 'object') return <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value === 'RULE' ? 'Rule-Classified' : value === 'AGENT_JUDGED' ? 'Agent-Judged' : String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ul className="ls-stack">{value.map((entry,index) => <li key={index}><Value value={entry} /></li>)}</ul> : <span>None</span>;
  return <dl className="ls-stack">{Object.entries(value).map(([key,entry]) => <div key={key}><dt><strong>{label(key)}</strong></dt><dd><Value value={entry} /></dd></div>)}</dl>;
}
function PlanSteps({ value }: { value: JsonValue }): React.JSX.Element {
  if (value === null) return <p>No previous executable plan.</p>;
  const parsed = ExecutablePlanSchema.safeParse(value);
  if (!parsed.success) return <p>The previous executable plan could not be verified.</p>;
  const plan = parsed.data;
  const steps = (entries: typeof plan.sessionSteps) => <ol>{entries.map(step => <li key={step.id}><strong>{ACTION_LABELS[step.action]}</strong><p>{step.text}</p>{step.targetSystemId ? <p>Target System: {plan.inputs.targets.find(target => target.registrationId === step.targetSystemId)?.displayName ?? step.targetSystemId}</p> : null}</li>)}</ol>;
  return <div className="ls-stack"><h4>Session Steps</h4>{steps(plan.sessionSteps)}{plan.targetSystems.map(target => <section key={target.registrationId}><h4>{plan.inputs.targets.find(entry => entry.registrationId === target.registrationId)?.displayName ?? target.registrationId}</h4>{steps(target.planSteps)}</section>)}</div>;
}
export function VersionDiff({ diff, first }: { readonly diff: readonly VersionSectionDiff[]; readonly first: boolean }): React.JSX.Element {
  return <section className="ls-stack" aria-label="Section-by-section version diff">{diff.map(section => <details key={section.section} open={first || section.changed}><summary>{section.section} · {section.changed ? 'Changed' : 'Unchanged'}</summary>
    <div className="ls-stack">{!first ? <section><h3>Previous</h3>{section.section === 'Executable plan' ? <PlanSteps value={section.before} /> : <Value value={section.before} />}</section> : null}<section><h3>Submitted for review</h3>{section.section === 'Executable plan' ? <PlanSteps value={section.after} /> : <Value value={section.after} />}</section></div>
  </details>)}</section>;
}
