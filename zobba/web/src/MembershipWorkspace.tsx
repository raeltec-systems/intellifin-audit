import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AccessError, logout, readSession } from './auth';
import type { Session } from './auth';
import { roleLabel } from './engagements';
import { applyMembership, assignmentKey, effectiveMembershipStatus, invitationLink, membershipExpiryInput, newInvitationSecret, parseMembershipExpiry, previewInvitation, readAdminOrganisations, readMemberAssignments, readMembership, takeInvitationFragment, verifyMembershipSession } from './membership';
import type { Assignment, AssignableEngagement, InvitationPreview, IssueInvitation, Member, MemberAssignmentPage, MemberRole, MembershipAction, MembershipCursors, MembershipReceipt, MembershipSnapshot, OrganisationPage, SaveMember } from './membership';

// Capture once before React's StrictMode render replay and remove from history
// before any authentication or protected read starts. No browser storage.
export const hasIncomingInvitation = location.pathname === '/invitation' || location.hash.startsWith('#invitation=');
let incomingSecret = takeInvitationFragment(location, history);
export function captureIncomingInvitation(): void {
  if (location.hash.startsWith('#invitation=')) incomingSecret = takeInvitationFragment(location, history);
}

type View = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'unavailable' } |
  { kind: 'ready'; session: Session; organisations: OrganisationPage; snapshot: MembershipSnapshot | null };
type MutationState = { kind: 'idle' } | { kind: 'working'; action: MembershipAction; session: Session } |
  { kind: 'uncertain'; action: MembershipAction; session: Session } | { kind: 'refused'; message: string } |
  { kind: 'saved'; receipt: MembershipReceipt; secret?: string; session: Session };
const roleOptions: MemberRole[] = ['auditor', 'audit_manager', 'admin'];

function errorMessage(error: unknown): string {
  if (error instanceof AccessError && error.status === 409 && error.code === 'last_admin') return 'This change would leave the organisation without an active, non-expiring Admin. Establish another active, non-expiring Admin with an active account first, then save this change again.';
  if (error instanceof AccessError && error.status === 409) return 'This change conflicts with current membership. Reload current state before editing again.';
  if (error instanceof AccessError && error.status === 400) return 'This change was refused. Check the recipient, roles, assignments and expiry, then try again.';
  return 'Your current account cannot make this change. Refresh your access before continuing.';
}

function useMembershipMutation(session: Session | null, onAccessFailure: (error?: AccessError) => void, onSaved: (action: MembershipAction) => void) {
  const [state, setState] = useState<MutationState>({ kind: 'idle' });
  const running = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; running.current?.abort(); }; }, []);
  async function run(action: MembershipAction) {
    if (running.current || !session) return;
    const boundSession = state.kind === 'uncertain' ? state.session : session;
    if (state.kind === 'uncertain' && state.action !== action) return;
    if (boundSession.identity.id !== session.identity.id || boundSession.csrf_token !== session.csrf_token) {
      setState({ kind: 'idle' }); onAccessFailure(new AccessError(412)); return;
    }
    const controller = new AbortController(); running.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setState({ kind: 'working', action, session: boundSession });
    try {
      const receipt = await applyMembership(action, boundSession, controller.signal);
      if (!mounted.current || running.current !== controller) return;
      setState({ kind: 'saved', receipt, secret: action.kind === 'issue' ? action.body.secret : undefined, session: boundSession });
      onSaved(action);
    } catch (error) {
      if (!mounted.current || running.current !== controller) return;
      if (error instanceof AccessError && ([401, 412].includes(error.status) || error.status === 403 && action.kind !== 'accept')) {
        setState({ kind: 'idle' }); onAccessFailure(error);
      } else if (error instanceof AccessError && [400, 403, 409].includes(error.status)) {
        setState({ kind: 'refused', message: errorMessage(error) });
      } else {
        // Keep the exact command in this account/scope's memory. Never generate
        // a replacement key after an acknowledgement may have been lost.
        setState({ kind: 'uncertain', action, session: boundSession });
      }
    } finally { clearTimeout(timeout); if (running.current === controller) running.current = null; }
  }
  const reset = useCallback(() => { running.current?.abort(); running.current = null; setState({ kind: 'idle' }); }, []);
  return { state, run, reset, locked: state.kind === 'working' || state.kind === 'uncertain' };
}

function MutationNotice({ mutation, reload }: { mutation: ReturnType<typeof useMembershipMutation>; reload: () => void }) {
  const { state } = mutation;
  if (state.kind === 'working') return <p className="notice" role="status">Saving your change…</p>;
  if (state.kind === 'uncertain') return <div className="notice" role="alert"><p>We could not confirm this change. Retry the exact request to recover its original receipt.</p>
    <button type="button" onClick={() => void mutation.run(state.action)}>Retry exact request</button>
    <p className="scope-note">A retry cannot restore authority that was later revoked. Leaving this page discards this local recovery request.</p></div>;
  if (state.kind === 'refused') return <div className="notice" role="alert"><p>{state.message}</p><button type="button" className="quiet-button" onClick={reload}>Reload current state</button></div>;
  if (state.kind === 'saved') return <div className="notice" role="status"><p>Change recorded. Receipt {state.receipt.event_id}.</p><p className="scope-note">The receipt confirms the original change; current access is checked separately.</p></div>;
  return null;
}

function RoleFields({ value, onChange, disabled }: { value: MemberRole[]; onChange: (roles: MemberRole[]) => void; disabled: boolean }) {
  return <fieldset disabled={disabled} className="membership-fieldset"><legend>Organisation roles</legend>
    {roleOptions.map(role => <label className="membership-check" key={role}><input type="checkbox" checked={value.includes(role)}
      onChange={event => onChange(event.target.checked ? [...value, role] : value.filter(item => item !== role))} />{roleLabel(role)}</label>)}
    <p className="field-help">Admin manages membership. Audit access also requires an Auditor or Audit manager role and an engagement assignment.</p>
  </fieldset>;
}

function AssignmentFields({ engagements, value, onChange, disabled, nextPage, firstPage }: {
  engagements: AssignableEngagement[]; value: Assignment[]; onChange: (assignments: Assignment[]) => void; disabled: boolean;
  nextPage?: () => void; firstPage?: () => void;
}) {
  const keys = new Set(value.map(assignmentKey));
  const known = new Set(engagements.map(assignmentKey));
  const outside = value.filter(item => !known.has(assignmentKey(item)));
  return <fieldset disabled={disabled} className="membership-fieldset"><legend>Engagement assignments</legend>
    {engagements.map(item => <label className="membership-check" key={assignmentKey(item)}><input type="checkbox" checked={keys.has(assignmentKey(item))}
      disabled={!keys.has(assignmentKey(item)) && value.length >= 100} onChange={event => onChange(event.target.checked
        ? [...value, { client_id: item.client_id, engagement_id: item.engagement_id }] : value.filter(other => assignmentKey(other) !== assignmentKey(item)))} />
      <span>{item.client_name} / {item.engagement_name}</span></label>)}
    {engagements.length === 0 ? <p className="field-help">No engagements on this page.</p> : null}
    {outside.map(item => <label className="membership-check" key={assignmentKey(item)}><input type="checkbox" checked
      onChange={() => onChange(value.filter(other => assignmentKey(other) !== assignmentKey(item)))} /><span>Assigned scope: {item.client_id} / {item.engagement_id}</span></label>)}
    <p className="field-help">{value.length} of at most 100 assignments selected. Selections on other pages are retained.</p>
    {nextPage || firstPage ? <div className="membership-actions">{firstPage ? <button type="button" className="quiet-button" onClick={firstPage}>First engagement page</button> : null}
      {nextPage ? <button type="button" className="quiet-button" onClick={nextPage}>Next engagement page</button> : null}</div> : null}
  </fieldset>;
}

function LegacyAssignmentFields({ member, snapshot, session, disabled, removals, setRemovals, onAccessFailure }: {
  member: Member; snapshot: MembershipSnapshot; session: Session; disabled: boolean; removals: Assignment[];
  setRemovals: (value: Assignment[]) => void; onAccessFailure: (error?: AccessError) => void;
}) {
  const [after, setAfter] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<{ kind: 'loading' | 'unavailable' } | { kind: 'ready'; page: MemberAssignmentPage }>({ kind: 'loading' });
  const failure = useRef(onAccessFailure); failure.current = onAccessFailure;
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    const timeout = setTimeout(() => controller.abort(), 8000); setView({ kind: 'loading' });
    void readMemberAssignments(snapshot.organisation_id, member.actor_id, session, controller.signal, after).then(page => {
      if (current) setView({ kind: 'ready', page });
    }).catch(error => {
      if (!current) return;
      setView({ kind: 'unavailable' });
      if (error instanceof AccessError && [401, 403, 412].includes(error.status)) failure.current(error);
    }).finally(() => clearTimeout(timeout));
    return () => { current = false; controller.abort(); clearTimeout(timeout); };
  }, [after, attempt, member.actor_id, session, snapshot.organisation_id]);
  const selectedKeys = new Set(removals.map(assignmentKey));
  return <fieldset className="membership-fieldset" disabled={disabled}><legend>Existing engagement assignments</legend>
    <p className="field-help">This member has {member.assignments_count} assignments. Saving roles, membership status or expiry preserves every assignment unless you explicitly select removals below.</p>
    {view.kind === 'loading' ? <p role="status">Checking existing assignments…</p> : null}
    {view.kind === 'unavailable' ? <div className="notice" role="alert"><p>We could not check these assignments. No assignments will be removed without your selection.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry assignment check</button></div> : null}
    {view.kind === 'ready' ? <>
      {view.page.assignments.map(item => <label className="membership-check" key={assignmentKey(item)}><input type="checkbox" checked={selectedKeys.has(assignmentKey(item))}
        disabled={!selectedKeys.has(assignmentKey(item)) && removals.length >= 100} onChange={event => setRemovals(event.target.checked
          ? [...removals, { client_id: item.client_id, engagement_id: item.engagement_id }] : removals.filter(value => assignmentKey(value) !== assignmentKey(item)))} />
        <span>Remove {item.client_name} / {item.engagement_name}{item.expires_at !== null ? <small> · Expires {new Date(item.expires_at * 1000).toLocaleString()}</small> : null}</span></label>)}
      <div className="membership-actions">{after ? <button type="button" className="quiet-button" onClick={() => setAfter(null)}>First existing assignment page</button> : null}
        {view.page.next_cursor ? <button type="button" className="quiet-button" onClick={() => setAfter(view.page.next_cursor)}>Next existing assignment page</button> : null}</div>
    </> : null}
    <p className="field-help">{removals.length} assignments selected for removal when you save. Other assignments are preserved.</p>
  </fieldset>;
}

function MemberEditor({ member, snapshot, session, onAccessFailure, locked, save, pageAssignments }: {
  member: Member; snapshot: MembershipSnapshot; session: Session; onAccessFailure: (error?: AccessError) => void; locked: boolean;
  save: (member: Member, expectedVersion: string, mode: SaveMember['assignment_mode'], assignments: SaveMember['assignments']) => void;
  pageAssignments: (cursor: string | null) => void;
}) {
  const [draft, setDraft] = useState(member);
  const [expectedVersion] = useState(snapshot.version);
  // The draft's completeness and retained scopes belong to its opening
  // snapshot. Paging, access refresh or elapsed expiry must not turn a partial
  // draft into a replacement or a retained assignment into an implicit regrant.
  const [assignmentsComplete] = useState(member.assignments_complete);
  const [originalAssignments] = useState(() => new Set(member.assignments.map(assignmentKey)));
  const [expiryEnabled, setExpiryEnabled] = useState(member.expires_at !== null);
  const [expiry, setExpiry] = useState(membershipExpiryInput(member.expires_at));
  const [removals, setRemovals] = useState<Assignment[]>([]);
  const expiresAt = expiryEnabled ? parseMembershipExpiry(expiry) : null;
  const expiryValid = !expiryEnabled || expiresAt !== null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!locked && expiryValid) save({ ...draft, expires_at: expiresAt }, expectedVersion,
      assignmentsComplete ? 'replace' : removals.length ? 'remove' : 'preserve',
      (assignmentsComplete ? draft.assignments : removals).map(item => ({ ...item, renew: assignmentsComplete && !originalAssignments.has(assignmentKey(item)) })));
  }
  return <form className="membership-editor" aria-label={`Edit ${member.display_name}`} onSubmit={submit}>
    <h3>{member.display_name}</h3><p className="field-help">{member.actor_id}</p>
    <label className="membership-check"><input type="checkbox" checked={draft.active} disabled={locked} onChange={event => setDraft({ ...draft, active: event.target.checked })} />Active membership</label>
    <p className="field-help">Deactivating membership removes current access and preserves historical authorship.</p>
    <label className="membership-check"><input type="checkbox" checked={expiryEnabled} disabled={locked} onChange={event => {
      setExpiryEnabled(event.target.checked); if (event.target.checked && !expiry) setExpiry(membershipExpiryInput(Math.floor(Date.now() / 1000) + 86400));
    }} />Use a membership expiry</label>
    {expiryEnabled ? <label className="membership-label">Membership expiry (UTC)<input type="datetime-local" step="1" min="1970-01-01T00:00:01" max="9999-12-31T23:59:59" required value={expiry} disabled={locked} onChange={event => setExpiry(event.target.value)} /></label> : null}
    <p className="field-help">Choose a future expiry to renew temporary membership, or uncheck expiry to remove its time limit.</p>
    <RoleFields value={draft.roles} disabled={locked} onChange={roles => setDraft({ ...draft, roles })} />
    {assignmentsComplete ? <AssignmentFields engagements={snapshot.engagements} value={draft.assignments} disabled={locked} onChange={assignments => setDraft({ ...draft, assignments })}
      nextPage={snapshot.engagements_next_cursor ? () => pageAssignments(snapshot.engagements_next_cursor) : undefined} firstPage={() => pageAssignments(null)} /> :
      <LegacyAssignmentFields member={member} snapshot={snapshot} session={session} disabled={locked} removals={removals} setRemovals={setRemovals} onAccessFailure={onAccessFailure} />}
    {assignmentsComplete ? <p className="field-help">Existing assignments keep their expiry. To renew an assignment that expired while editing, save, reopen this editor, and select it again.</p> : null}
    <p className="field-help">After saving: {effectiveMembershipStatus({ active: draft.active, expires_at: expiresAt })} membership.</p>
    <button type="submit" disabled={locked || !expiryValid || draft.active && draft.roles.length === 0}>Save membership</button>
  </form>;
}

function InvitationEditor({ snapshot, locked, issue, pageAssignments }: {
  snapshot: MembershipSnapshot; locked: boolean; issue: (draft: Omit<IssueInvitation, 'key' | 'secret'>) => void;
  pageAssignments: (cursor: string | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<MemberRole[]>(['auditor']);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [lifetime, setLifetime] = useState(86400);
  const [expectedVersion] = useState(snapshot.version);
  return <form className="membership-editor" aria-label="Create private invitation" onSubmit={event => {
    event.preventDefault(); if (!locked) issue({ recipient_email: email, roles, assignments, expires_in_seconds: lifetime, expected_version: expectedVersion });
  }}><h3>Create a private invitation</h3>
    <p className="field-help">Choose one recipient and their access. Share the private link yourself; Zobba does not send an email.</p>
    <label className="membership-label">Recipient email<input type="email" autoComplete="off" maxLength={254} required value={email} disabled={locked} onChange={event => setEmail(event.target.value)} /></label>
    <p className="field-help">The recipient must sign in with this verified email. The part before @ is case-sensitive.</p>
    <RoleFields value={roles} onChange={setRoles} disabled={locked} />
    <AssignmentFields engagements={snapshot.engagements} value={assignments} onChange={setAssignments} disabled={locked}
      nextPage={snapshot.engagements_next_cursor ? () => pageAssignments(snapshot.engagements_next_cursor) : undefined} firstPage={() => pageAssignments(null)} />
    <label className="membership-label">Invitation expires after<select value={lifetime} disabled={locked} onChange={event => setLifetime(Number(event.target.value))}>
      <option value={300}>5 minutes</option><option value={3600}>1 hour</option><option value={86400}>1 day</option><option value={604800}>7 days</option>
    </select></label>
    <button type="submit" disabled={locked || roles.length === 0}>Create private invitation</button>
  </form>;
}

function PrivateLink({ secret, invitationId }: { secret: string; invitationId: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const link = invitationLink(secret, location.origin);
  return <section className="private-invitation" aria-label="Private invitation link" data-invitation-id={invitationId}><h3>Private invitation ready</h3>
    <p>Copy this link and share it only with the named recipient. It is shown only in this page session.</p>
    <label className="membership-label">Private invitation link<input data-membership-focus="private-link" readOnly value={link} onFocus={event => event.target.select()} /></label>
    <button type="button" onClick={() => void navigator.clipboard.writeText(link).then(() => { setCopied(true); setCopyFailed(false); }).catch(() => setCopyFailed(true))}>Copy private link</button>
    {copied ? <p role="status">Private link copied.</p> : null}{copyFailed ? <p role="status">Select the link above and copy it with your keyboard.</p> : null}
  </section>;
}

function OrganisationEditor({ snapshot, session, onAccessFailure, mutation, refresh, changePage }: {
  snapshot: MembershipSnapshot; session: Session; onAccessFailure: (error?: AccessError) => void; mutation: ReturnType<typeof useMembershipMutation>; refresh: () => void;
  changePage: (kind: keyof MembershipCursors, cursor: string | null) => void;
}) {
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const savedEvent = mutation.state.kind === 'saved' ? mutation.state.receipt.event_id : null;
  useEffect(() => { if (savedEvent) { setSelectedMember(null); setInviteOpen(false); } }, [savedEvent]);
  const member = snapshot.members.find(item => item.actor_id === selectedMember);
  const reload = () => { mutation.reset(); setSelectedMember(null); setInviteOpen(false); setEditorGeneration(value => value + 1); refresh(); };
  return <section className="membership-organisation" aria-label={`${snapshot.organisation_name} membership`}>
    <div className="membership-heading"><div><p className="eyebrow">Organisation administration</p><h2>{snapshot.organisation_name}</h2></div>
      <span className="engagement-role">Admin</span></div>
    <p className="scope-note">Manage access here. Open assigned audit work separately from Engagements. Admin alone grants no audit content or sign-off access.</p>
    <MutationNotice mutation={mutation} reload={reload} />
    {mutation.state.kind === 'saved' && mutation.state.secret ? <PrivateLink key={mutation.state.secret} secret={mutation.state.secret} invitationId={mutation.state.receipt.invitation_id!} /> : null}
    <section className="membership-section" aria-labelledby="members-title"><h3 id="members-title">Members</h3>
      <ul className="membership-list">{snapshot.members.map(item => <li key={item.actor_id}><div><strong>{item.display_name}</strong>
        <span>{item.roles.map(roleLabel).join(' · ') || 'No roles'} · {effectiveMembershipStatus(item)}</span><span>{item.assignments_count} engagement assignments</span></div>
        <button className="quiet-button" type="button" data-membership-focus={`member-${item.actor_id}`} disabled={mutation.locked} aria-label={`Edit ${item.display_name}`} onClick={() => { setSelectedMember(item.actor_id); setInviteOpen(false); }}>Edit</button></li>)}</ul>
      {snapshot.members.length === 0 ? <p>No members on this page.</p> : null}
      <div className="membership-actions"><button className="quiet-button" type="button" disabled={mutation.locked} onClick={() => { setSelectedMember(null); changePage('members_after', null); }}>First member page</button>
        {snapshot.members_next_cursor ? <button className="quiet-button" type="button" disabled={mutation.locked} onClick={() => { setSelectedMember(null); changePage('members_after', snapshot.members_next_cursor); }}>Next member page</button> : null}</div>
    </section>
    {member && !inviteOpen ? <MemberEditor key={`${member.actor_id}/${editorGeneration}`} member={member} snapshot={snapshot} session={session} onAccessFailure={onAccessFailure} locked={mutation.locked}
      pageAssignments={cursor => changePage('engagements_after', cursor)} save={(draft, expectedVersion, mode, assignments) => void mutation.run({ kind: 'save', organisation_id: snapshot.organisation_id,
        body: { key: crypto.randomUUID(), expected_version: expectedVersion, actor_id: draft.actor_id, roles: draft.roles, active: draft.active, expires_at: draft.expires_at, assignments, assignment_mode: mode } })} /> : null}
    <section className="membership-section" aria-labelledby="invitations-title"><div className="membership-heading"><h3 id="invitations-title" data-membership-focus="invitations" tabIndex={-1}>Invitations</h3>
      <button className="quiet-button" type="button" disabled={mutation.locked} onClick={() => { setInviteOpen(true); setSelectedMember(null); }}>Invite a member</button></div>
      <ul className="membership-list">{snapshot.invitations.map(item => <li key={item.id} data-invitation-id={item.id}><div><strong>{item.recipient_email}</strong>
        <span>{item.status} · {item.roles.map(roleLabel).join(' · ')}</span><span>{item.assignments.length} assignments · Expires {new Date(item.expires_at * 1000).toLocaleString()}</span></div>
        {item.status === 'pending' ? <button className="quiet-button" type="button" disabled={mutation.locked} aria-label={`Revoke invitation for ${item.recipient_email}`}
          onClick={() => void mutation.run({ kind: 'revoke', organisation_id: snapshot.organisation_id, body: { key: crypto.randomUUID(), expected_version: snapshot.version, invitation_id: item.id } })}>Revoke</button> : null}</li>)}</ul>
      {snapshot.invitations.length === 0 ? <p>No invitations on this page.</p> : null}
      <div className="membership-actions"><button className="quiet-button" type="button" disabled={mutation.locked} onClick={() => changePage('invitations_after', null)}>First invitation page</button>
        {snapshot.invitations_next_cursor ? <button className="quiet-button" type="button" disabled={mutation.locked} onClick={() => changePage('invitations_after', snapshot.invitations_next_cursor)}>Next invitation page</button> : null}</div>
    </section>
    {inviteOpen ? <InvitationEditor key={editorGeneration} snapshot={snapshot} locked={mutation.locked} pageAssignments={cursor => changePage('engagements_after', cursor)}
      issue={draft => void mutation.run({ kind: 'issue', organisation_id: snapshot.organisation_id,
        body: { ...draft, key: crypto.randomUUID(), secret: newInvitationSecret() } })} /> : null}
  </section>;
}

function InvitationAcceptance({ secret, session, onAccessFailure, mutation, onAccessStable }: {
  secret: string | null; session: Session; onAccessFailure: (error?: AccessError) => void; mutation: ReturnType<typeof useMembershipMutation>; onAccessStable: () => void;
}) {
  const [preview, setPreview] = useState<{ kind: 'loading' } | { kind: 'ready'; terms: InvitationPreview } | { kind: 'refused' } | { kind: 'unavailable' }>({ kind: 'loading' });
  const mutationState = useRef(mutation.state); mutationState.current = mutation.state;
  const failureCallback = useRef(onAccessFailure); failureCallback.current = onAccessFailure;
  const stableCallback = useRef(onAccessStable); stableCallback.current = onAccessStable;
  const [previewAttempt, setPreviewAttempt] = useState(0);
  useEffect(() => { if (mutation.state.kind === 'refused') setPreview({ kind: 'refused' }); }, [mutation.state.kind]);
  useEffect(() => {
    // A consumed invitation cannot be previewed as pending again. Its frozen
    // uncertain acceptance still recovers the original receipt without regrant.
    if (!secret || ['working', 'uncertain', 'saved'].includes(mutationState.current.kind)) return;
    const controller = new AbortController(); let current = true;
    const timeout = setTimeout(() => controller.abort(), 8000); setPreview({ kind: 'loading' });
    void previewInvitation(secret, session, controller.signal).then(terms => {
      if (current) { setPreview({ kind: 'ready', terms }); stableCallback.current(); }
    }).catch(error => {
      if (!current) return;
      setPreview({ kind: error instanceof AccessError && [400, 403, 404].includes(error.status) ? 'refused' : 'unavailable' });
      if (error instanceof AccessError && [401, 412].includes(error.status)) failureCallback.current(error);
    }).finally(() => clearTimeout(timeout));
    return () => { current = false; controller.abort(); clearTimeout(timeout); };
  }, [secret, session, previewAttempt]);
  const accepted = mutation.state.kind === 'saved';
  return <section className="invitation-acceptance"><h2>Accept a private invitation</h2>
    <p>You are signed in as <strong>{session.identity.display_name}</strong>. Accept explicitly to add the invitation's fixed roles and assignments.</p>
    <p>The invitation must match your verified email and organisation identity provider. Sign-in must have completed within the last five minutes.</p>
    {!secret && !accepted ? <p className="notice" role="status">Open the original private invitation link after signing in. For your privacy, the link is not stored here.</p> : null}
    {secret && preview.kind === 'loading' && !mutation.locked ? <p role="status">Checking the invitation and its access…</p> : null}
    {secret && preview.kind === 'unavailable' ? <div className="notice" role="alert"><p>We could not check this invitation because the connection is unavailable. Try again when the connection recovers.</p>
      <button type="button" className="quiet-button" onClick={() => setPreviewAttempt(value => value + 1)}>Retry invitation check</button></div> : null}
    {secret && preview.kind === 'refused' ? <div className="notice" role="alert"><p>This invitation is not available to your current verified account. It may have expired, been revoked, or require a fresh sign-in.</p>
      <button type="button" className="quiet-button" onClick={() => setPreviewAttempt(value => value + 1)}>Check invitation again</button></div> : null}
    {preview.kind === 'ready' ? <section className="invitation-terms" aria-label="Verified invitation access"><h3>{preview.terms.organisation_name}</h3>
      <dl><div><dt>Recipient</dt><dd>{preview.terms.recipient_email}</dd></div><div><dt>Roles</dt><dd>{preview.terms.roles.map(roleLabel).join(' · ')}</dd></div>
        <div><dt>Expires</dt><dd>{new Date(preview.terms.expires_at * 1000).toLocaleString()}</dd></div></dl>
      <h3>Engagement assignments</h3>{preview.terms.assignments.length ? <ul>{preview.terms.assignments.map(item => <li key={assignmentKey(item)}>{item.client_name} / {item.engagement_name}</li>)}</ul> : <p>No engagement assignments.</p>}
      <p>Admin alone grants no audit content or sign-off access.</p></section> : null}
    <MutationNotice mutation={mutation} reload={() => { mutation.reset(); setPreviewAttempt(value => value + 1); }} />
    {secret && !accepted && preview.kind === 'ready' ? <button type="button" disabled={mutation.locked} onClick={() => void mutation.run({ kind: 'accept', organisation_id: preview.terms.organisation_id, body: { key: crypto.randomUUID(), secret } })}>Accept invitation</button> : null}
    {accepted ? <p><a href="/" data-membership-focus="accepted-engagements">View your current engagements</a> · <a href="/membership">View membership administration</a></p> : preview.kind !== 'unavailable' ? <p><a href="/api/auth/login">Sign in again</a>, then reopen the original private invitation link. Your provider may reuse its sign-in session.</p> : null}
  </section>;
}

export function MembershipWorkspace({ invitation = false }: { invitation?: boolean }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState(true);
  const [secret, setSecret] = useState(incomingSecret);
  const [invitationMode, setInvitationMode] = useState(hasIncomingInvitation || invitation);
  const invitationModeRef = useRef(hasIncomingInvitation || invitation);
  const [invitationGeneration, setInvitationGeneration] = useState(0);
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const logoutIntent = useRef(false);
  const logoutRequest = useRef<AbortController | null>(null);
  const lastSession = useRef<Session | null>(null);
  const clearMutation = useRef<() => void>(() => {});
  const selected = useRef<string | null>(new URLSearchParams(location.search).get('organisation_id'));
  const orgAfter = useRef<string | null>(null);
  const cursors = useRef<MembershipCursors>({});
  const recoveryBlocked = useRef(false);
  const recoveryRemaining = useRef(1);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const pendingFocus = useRef<string | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const previousSelection = useRef<[number | null, number | null] | null>(null);
  const refresh = useCallback(async (userInitiated = false) => {
    if (logoutIntent.current || recoveryBlocked.current && !userInitiated) return;
    if (userInitiated) { recoveryBlocked.current = false; recoveryRemaining.current = 1; }
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.getClientRects().length) {
      previousFocus.current = active;
      previousSelection.current = active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] : null;
    }
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000); setBusy(true);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const session = await readSession(controller.signal);
          if (request.current !== controller) return;
          if (lastSession.current && (lastSession.current.identity.id !== session.identity.id || lastSession.current.csrf_token !== session.csrf_token)) {
            clearMutation.current(); setSecret(null); setInvitationGeneration(value => value + 1); pendingFocus.current = null;
            // Keep the organisation selection for the same person only after a
            // fresh read; every private editor is still replaced by its session key.
            if (lastSession.current.identity.id !== session.identity.id) { selected.current = null; orgAfter.current = null; cursors.current = {}; }
          }
          lastSession.current = session;
          const organisations = invitationModeRef.current ? { organisations: [], next_cursor: null } : await readAdminOrganisations(session, controller.signal, orgAfter.current);
          let snapshot: MembershipSnapshot | null = null;
          if (!invitationModeRef.current && selected.current) {
            try { snapshot = await readMembership(selected.current, session, controller.signal, cursors.current); }
            catch (error) {
              if (error instanceof AccessError && [403, 404].includes(error.status)) {
                selected.current = null; cursors.current = {}; history.replaceState(null, '', '/membership');
                clearMutation.current();
                setNotice('This organisation is no longer available for administration. Choose from your current access.');
              } else throw error;
            }
          }
          await verifyMembershipSession(session, controller.signal);
          if (request.current !== controller) return;
          if (!invitationModeRef.current) recoveryRemaining.current = 1;
          setView({ kind: 'ready', session, organisations, snapshot }); return;
        } catch (error) {
          if (!(error instanceof AccessError && error.status === 412 && attempt === 0 && recoveryRemaining.current > 0)) throw error;
          recoveryRemaining.current--;
        }
      }
    } catch (error) {
      if (request.current !== controller) return;
      if (error instanceof AccessError && error.status === 401) { clearMutation.current(); setView({ kind: 'signed-out' }); if (lastSession.current) setSecret(null); }
      else { recoveryBlocked.current = true; setView({ kind: 'unavailable' }); }
    } finally { clearTimeout(timeout); if (request.current === controller) setBusy(false); }
  }, []);
  function accessFailure(error?: AccessError) {
    if (error?.status === 412) {
      if (recoveryRemaining.current === 0) {
        recoveryBlocked.current = true; request.current?.abort(); request.current = null;
        setBusy(false); setView({ kind: 'unavailable' }); return;
      }
      recoveryRemaining.current--;
    }
    setView({ kind: 'loading' }); void refresh();
  }
  // Recovery custody belongs to this mounted shell, outside disposable read
  // views. It is exposed only after the exact session and scope are verified.
  const mutation = useMembershipMutation(view.kind === 'ready' && !busy ? view.session : null, accessFailure, action => {
    pendingFocus.current = action.kind === 'issue' ? 'private-link' : action.kind === 'save' ? `member-${action.body.actor_id}` : action.kind === 'revoke' ? 'invitations' : 'accepted-engagements';
    if (action.kind === 'accept') setSecret(null);
    else void refresh(true);
  });
  clearMutation.current = mutation.reset;
  useEffect(() => {
    incomingSecret = null;
    void refresh();
    const focus = () => { if (document.visibilityState === 'visible') void refresh(); };
    const visibility = () => {
      if (logoutIntent.current) return;
      if (document.visibilityState === 'hidden') { request.current?.abort(); request.current = null; setBusy(true); }
      else void refresh();
    };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    const hashchange = () => {
      if (!location.hash.startsWith('#invitation=')) return;
      const nextSecret = takeInvitationFragment(location, history);
      clearMutation.current(); request.current?.abort(); request.current = null;
      invitationModeRef.current = true; setInvitationMode(true);
      setSecret(logoutIntent.current ? null : nextSecret);
      setInvitationGeneration(value => value + 1); pendingFocus.current = null;
      // A new link cannot cancel sign-out, erase its uncertain retry, or
      // replace completed sign-out guidance with a read that is prohibited.
      if (logoutIntent.current) return;
      setNotice(''); setView({ kind: 'loading' }); focusHeading.current = true; void refresh(true);
    };
    const timer = setInterval(focus, 30_000);
    window.addEventListener('focus', focus); window.addEventListener('pageshow', pageshow); window.addEventListener('hashchange', hashchange); window.addEventListener('popstate', hashchange); document.addEventListener('visibilitychange', visibility);
    return () => { request.current?.abort(); request.current = null; logoutRequest.current?.abort(); logoutRequest.current = null; clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('pageshow', pageshow); window.removeEventListener('hashchange', hashchange); window.removeEventListener('popstate', hashchange); document.removeEventListener('visibilitychange', visibility); };
  }, [refresh]);
  useEffect(() => {
    if (busy) return;
    if (pendingFocus.current && view.kind === 'ready') {
      const target = document.querySelector<HTMLElement>(`[data-membership-focus="${CSS.escape(pendingFocus.current)}"]`);
      (target ?? heading.current)?.focus({ preventScroll: true }); pendingFocus.current = null;
    } else if (focusHeading.current) { heading.current?.focus({ preventScroll: true }); focusHeading.current = false; }
    else if (previousFocus.current?.isConnected && previousFocus.current.getClientRects().length) {
      previousFocus.current.focus({ preventScroll: true });
      if (previousFocus.current instanceof HTMLInputElement && previousSelection.current && previousSelection.current[0] !== null && previousSelection.current[1] !== null) {
        previousFocus.current.setSelectionRange(...previousSelection.current);
      }
    } else if (previousFocus.current) heading.current?.focus({ preventScroll: true });
    previousFocus.current = null; previousSelection.current = null;
  }, [busy, view, mutation.state]);
  function choose(organisationId: string | null) {
    mutation.reset(); pendingFocus.current = null;
    selected.current = organisationId; cursors.current = {}; setNotice(''); setView({ kind: 'loading' }); focusHeading.current = true;
    history.replaceState(null, '', `/membership${organisationId ? `?organisation_id=${encodeURIComponent(organisationId)}` : ''}`); void refresh(true);
  }
  function changePage(kind: keyof MembershipCursors, cursor: string | null) {
    cursors.current = { ...cursors.current, [kind]: cursor ?? undefined }; void refresh(true);
  }
  async function signOut() {
    if (logoutRequest.current) return;
    mutation.reset(); pendingFocus.current = null;
    logoutIntent.current = true; setSecret(null); request.current?.abort();
    request.current = null;
    const previousSession = view.kind === 'ready' ? view.session : null;
    setView({ kind: 'loading' }); setBusy(true);
    const controller = new AbortController(); logoutRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      await logout(previousSession ?? await readSession(controller.signal), controller.signal);
      if (logoutRequest.current === controller) setView({ kind: 'signed-out' });
    } catch (error) {
      if (logoutRequest.current !== controller) return;
      if (error instanceof AccessError && error.status === 401) setView({ kind: 'signed-out' });
      else { setView({ kind: 'unavailable' }); setNotice('We could not confirm sign-out. Try signing out again.'); }
    } finally { clearTimeout(timeout); if (logoutRequest.current === controller) { logoutRequest.current = null; setBusy(false); } }
  }
  return <div className="app-shell membership-shell"><a className="skip-link" href="#workspace">Skip to workspace</a>
    <aside className="sidebar" aria-label="Workspace navigation"><img className="brand-lockup" src="/assets/zobba-lockup-color.svg" alt="Zobba" width="132" height="32" />
      <nav aria-label="Main"><a href="/">Engagements</a><a href="/membership" aria-current={invitationMode ? undefined : 'page'}>Membership</a></nav>
      <div className="sidebar-note"><span className="pair-label">Pair</span><p>Organisation administration</p><a href="/status">Connection status</a></div></aside>
    <div className="workspace"><header className="workspace-header"><span>{invitationMode ? 'Invitation' : 'Membership'}</span>
      {view.kind === 'ready' && !busy ? <div className="identity"><span>{view.session.identity.display_name}</span><button type="button" className="quiet-button" onClick={() => void signOut()}>Sign out</button></div> : null}</header>
      <main id="workspace" className="membership-main" tabIndex={-1}>
        {busy ? <p role="status">Checking current access…</p> : null}
        {view.kind === 'signed-out' && !busy ? <section className="intro"><p className="eyebrow">Zobba · Pair</p><h1 ref={heading} tabIndex={-1}>Sign in to continue</h1>
          <p>{invitationMode ? 'Sign in, then reopen the original private invitation link. Its secret is not kept through sign-in.' : 'Sign in to administer the organisations available to your current account.'}</p>
          <a href="/api/auth/login" className="primary-link">Sign in to Zobba</a></section> : null}
        {view.kind === 'unavailable' && !busy ? <section className="intro"><h1 ref={heading} tabIndex={-1}>Connection interrupted</h1><p role="alert">{notice || 'We could not verify your current access. Check your connection and try again.'}</p>
          <button type="button" onClick={() => void (notice.includes('sign-out') ? signOut() : refresh(true))}>{notice.includes('sign-out') ? 'Try signing out again' : 'Try again'}</button></section> : null}
        {view.kind === 'ready' ? <div className="membership-protected" hidden={busy}>
          <div className="membership-breadcrumb"><a href="/">← Assigned engagements</a>{view.snapshot ? <button type="button" className="quiet-button" onClick={() => choose(null)}>All organisations</button> : null}</div>
          <div className="intro"><p className="eyebrow">Zobba · Pair</p><h1 ref={heading} tabIndex={-1}>{invitationMode ? 'Your invitation' : 'Membership administration'}</h1>
            {!invitationMode ? <p className="intro-copy">Choose an organisation to manage its members, roles and engagement assignments.</p> : null}</div>
          {notice ? <p className="notice" role="status">{notice}</p> : null}
          {invitationMode ? <InvitationAcceptance key={`${view.session.identity.id}/${view.session.csrf_token}/${invitationGeneration}`} secret={secret} session={view.session} onAccessFailure={accessFailure} mutation={mutation} onAccessStable={() => { recoveryRemaining.current = 1; }} /> :
            view.snapshot ? <OrganisationEditor key={`${view.session.identity.id}/${view.session.csrf_token}/${view.snapshot.organisation_id}`} snapshot={view.snapshot} session={view.session} onAccessFailure={accessFailure} mutation={mutation} refresh={() => void refresh(true)} changePage={changePage} /> : <>
              {view.organisations.organisations.length ? <ul className="engagement-list" aria-label="Organisations you administer">{view.organisations.organisations.map(org => <li key={org.organisation_id}>
                <button type="button" className="engagement-card" onClick={() => choose(org.organisation_id)}><span className="engagement-title">{org.organisation_name}</span><span className="engagement-role">Admin · Manage membership</span></button></li>)}</ul> :
                <section className="empty-panel"><h2>No organisations to administer</h2><p>Your current account has no Admin membership on this page. Your assigned audit work is available from Engagements.</p></section>}
              <div className="membership-actions">{orgAfter.current ? <button type="button" className="quiet-button" onClick={() => { orgAfter.current = null; void refresh(true); }}>First organisation page</button> : null}
                {view.organisations.next_cursor ? <button type="button" className="quiet-button" onClick={() => { orgAfter.current = view.organisations.next_cursor; void refresh(true); }}>Next organisation page</button> : null}</div>
            </>}
          <div className="access-footer"><span>Showing your current access</span><button type="button" className="quiet-button" onClick={() => void refresh(true)}>Refresh access</button></div>
        </div> : null}
      </main></div></div>;
}
