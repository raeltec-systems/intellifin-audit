import { useCallback, useEffect } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Scope } from './engagements';
import { methodologyIssueLabel, readTaskBasis } from './methodology';
import type { TaskBasis } from './methodology';
import { useSkillInspection } from './useSkillInspection';
import type { MethodContext } from './knowledge-context';

interface Props { scope: Scope; taskId: string; taskRevision: string; session: Session; accessReady: boolean; onAccessFailure: (error?: AccessError) => void; onContext?: (context: MethodContext | null) => void }
const statusLabels = { resolved: 'Applicable firm methodology', neutral: 'Neutral starter', incomplete: 'Incomplete methodology basis', ambiguous: 'Applicability needs clarification', recalled: 'Recalled methodology basis' };
const fields = { criteria: 'Criteria', populations: 'Population and sampling', evidence_checks: 'Evidence checks', ratings: 'Ratings', review_rules: 'Review and issuance rules' } as const;

function Resolution({ resolution }: { resolution: TaskBasis['current']['resolution'] }) {
  const requirementLabels = new Map(resolution.requirements.map(({ requirement }) => [requirement.id, requirement.label ?? requirement.id]));
  const neutralSources = new Set(resolution.neutral_source_version_ids);
  return <>
    <p><strong>{resolution.status === 'resolved' && neutralSources.size > 0 ? 'Firm methodology with neutral starter content' : statusLabels[resolution.status]}</strong></p><p>{resolution.reason}</p>
    {neutralSources.size > 0 ? <p className="scope-note">This basis retains neutral starter contributions. Their fields and templates are labelled below; they do not become firm criteria through inheritance.</p> : null}
    <dl><div><dt>Audit area</dt><dd>{resolution.context.audit_area ?? 'Not yet specified'}</dd></div><div><dt>Business period</dt><dd>{resolution.context.period_start ? `${resolution.context.period_start} to ${resolution.context.period_end}` : 'Not yet specified'}</dd></div><div><dt>Exact methodology versions</dt><dd>{resolution.version_ids.join(', ') || 'No configured firm version'}</dd></div></dl>
    {resolution.issues.length ? <><h4>Basis limitations</h4><ul aria-label="Basis limitations">{resolution.issues.map((issue, index) => <li key={index}>{methodologyIssueLabel(issue, requirementLabels)}</li>)}</ul><p>Missing criteria block dependent conclusions only; planning and evidence preparation can continue.</p><details><summary>Recorded limitation codes</summary><ul>{resolution.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details></> : null}
    {resolution.requirements.map(({ requirement, source_version_ids, field_sources }) => <details key={requirement.id} className="methodology-bound-requirement"><summary>{requirement.label ?? requirement.id} · {requirement.mandatory ? 'Mandatory' : 'Optional'}</summary><p>Requirement {requirement.id} · source versions {source_version_ids.join(', ')}</p>
      {Object.entries(fields).map(([field, label]) => { const values = requirement[field as keyof typeof fields]; return values?.length ? <section key={field}><h5>{label}</h5><ul>{values.map((value, index) => <li className="retained-text" key={index}>{value}</li>)}</ul></section> : null; })}
      {requirement.templates?.length ? <p>Templates: {requirement.templates.map(v => `${v.id}@${v.version}`).join(', ')}</p> : null}
      {requirement.suitable_skills?.length ? <p>Suitable skills: {requirement.suitable_skills.map(v => `${v.id}@${v.version}`).join(', ')}</p> : null}
      <dl>{field_sources.map(source => <div key={source.field}><dt>{source.field.replaceAll('_', ' ')}</dt><dd>{source.version_ids.map((id, index) => <span key={id}>{index ? ', ' : ''}{id}{neutralSources.has(id) ? ' · Neutral starter contribution' : ''}</span>)}</dd></div>)}</dl>
    </details>)}
    {resolution.templates.map(({ template, source_version_id }) => <details key={`${template.id}@${template.version}`}><summary>Template: {template.name} · {template.id}@{template.version}{neutralSources.has(source_version_id) ? ' · Neutral starter' : ''}</summary><p>Source methodology version {source_version_id}</p>{template.sections.map(section => <section key={section.id}><h5>{section.title} · {section.required ? 'Required section' : 'Optional section'}</h5><p className="retained-text">{section.content}</p></section>)}</details>)}
  </>;
}
function BindingAttribution({ binding }: { binding: TaskBasis['current'] }) {
  return <details><summary>Binding attribution</summary><p className="scope-note">Binding {binding.id} · applies from execution epoch {binding.execution_epoch} · recorded by {binding.actor_id} · {new Date(binding.bound_at * 1000).toLocaleString()}</p>{binding.context_command_id ? <p className="scope-note">Audit context supplied by Guide {binding.context_command_id}</p> : null}</details>;
}
export function TaskMethodology({ scope, taskId, taskRevision, session, accessReady, onAccessFailure, onContext }: Props) {
  const owner = JSON.stringify([session.identity.id, session.csrf_token, scope.organisation_id, scope.client_id, scope.engagement_id, taskId]);
  const read = useCallback((signal: AbortSignal) => readTaskBasis(scope, taskId, session, signal), [owner]);
  const inspection = useSkillInspection(owner, accessReady, taskRevision, read, onAccessFailure);
  const current = inspection.value;
  useEffect(() => {
    const binding = inspection.verified && current?.current;
    onContext?.(binding ? { task_id: taskId, binding_id: binding.id, status: binding.resolution.status, checked_at: Date.now(),
      source_version_ids: [...new Set([...binding.resolution.version_ids, ...binding.resolution.neutral_source_version_ids, ...binding.resolution.requirements.flatMap(r => [...r.source_version_ids, ...r.field_sources.flatMap(f => f.version_ids)]), ...binding.resolution.templates.map(t => t.source_version_id)])].sort() } : null);
  }, [inspection.verified, current, taskId, onContext]);
  return <section ref={inspection.panel} className="brief-section task-methodology" aria-label="Methodology basis"><h4>Methodology basis</h4>
    {!inspection.verified ? <p role="status">{inspection.error ? 'Current methodology basis is unavailable. Refresh to inspect it.' : 'Checking the recorded methodology basis…'}</p> : null}<div hidden={!inspection.verified}>
    {current ? <>
      {current.recalled ? <p className="notice" role="alert">This basis includes a recalled version. New affected use is blocked; original activity and receipts are retained.</p> : null}
      <Resolution resolution={current.current.resolution} />
      <BindingAttribution binding={current.current} />
      {current.notices.some(notice => notice.impact.activation_mode === 'new_tasks') ? <section className="methodology-update-notices" aria-label="Methodology update notices"><h4>Updates available for new Tasks</h4>{current.notices.filter(notice => notice.impact.activation_mode === 'new_tasks').map(notice => <article key={notice.id}><p>Version {notice.version_id} saved by {notice.actor_id} on {new Date(notice.requested_at * 1000).toLocaleString()}. This Task retains its original binding.</p><ul>{notice.impact.diff.map((line, index) => <li key={index}>{line}</li>)}</ul></article>)}</section> : null}
      {current.pending ? <details open className="methodology-pending"><summary>Pending methodology change</summary><p className="retained-text">{current.pending.reason}</p><p>Requested by {current.pending.actor_id} on {new Date(current.pending.requested_at * 1000).toLocaleString()} · request {current.pending.id}. The original basis stays in force for consumed work until reconciliation reaches a safe boundary.</p><Resolution resolution={current.pending.resolution} /></details> : null}
      {current.history.some(binding => binding.id !== current.current.id) ? <details><summary>Prior recorded bindings</summary>{current.history.filter(binding => binding.id !== current.current.id).map(binding => <article key={binding.id}><Resolution resolution={binding.resolution} /><BindingAttribution binding={binding} /></article>)}</details> : null}
    </> : null}
    </div><button type="button" className="text-button" disabled={!accessReady || inspection.loading} onClick={() => void inspection.refresh()}>Refresh methodology basis</button>
  </section>;
}
