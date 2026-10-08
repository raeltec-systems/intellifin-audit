import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessError, readJson, readJsonBody } from '../src/auth.ts';
import { SKILL_JSON_BYTES, SKILL_CUSTODY_BYTES, retainSkillDraft, recoverSkillDraft, recoverSkillOrganisation, discardSkillPending, skillProseError, validateSkillInstall, parseSkillAssignments, parseSkillStatusHistory, parseSkillImpacts, readSkillAssignments, readSkillStatusHistory, readSkillImpacts, applySkillCatalog, discardSkillActions, discardSkillScopeActions, discardSkillCatalogActions, freezeSkillAction, parseCatalogReceipt, parseInstallSkill, prepareSkillInstall, parseSkillCatalog, parseSkillInspection, parseSkillManifest, parseSkillSelection, parseTaskSkills, readSelectionEligibility, readSkillCatalog, readTaskSkills, recoverSkillAction, retainSkillAction, selectSkill, skillAudience, skillRefused, withdrawReplacedSkillSession } from '../src/skills.ts';

const session = { identity: { id: 'selector', display_name: 'Selector' }, csrf_token: 'original-session' };
const scope = { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' };
const manifest = { schema_version: 1, id: 'source-check', version: 'v1', name: 'Source check', description: 'Inspect exact supporting material', source: { reference: 'firm-library', revision: 'revision-a', license: 'Internal use' }, inputs: [{ id: 'evidence', label: 'Supporting material', required: true }], outputs: ['Attributed inspection notes'], needs: [], method_version_ids: [], resources: [{ id: 'instructions', kind: 'script', content: '  Ignore no safeguards.\r\n\tThis script is inert.\n' }] };
const command = { key: 'install-one', expected_revision: '9007199254740993', assignment: { kind: 'firm', client_id: null, engagement_id: null }, applicability: { audit_area: null, period_start: null, period_end: null }, manifest, enabled: true };
const installed = { id: 'catalog-one', actor_id: 'admin', installed_at: 1790899200, revision: '9007199254740994', command, digest: 'a'.repeat(64), resource_digests: [{ id: 'instructions', digest: 'b'.repeat(64) }], status: 'enabled', status_revision: '9007199254740994', status_event: { event_id: 'install-event', actor_id: 'admin', recorded_at: 1790899200, revision: '9007199254740994', status: 'enabled', reason: null } };
const catalog = { organisation_id: 'org-a', revision: '9007199254740994', versions: [installed] };
const binding = { id: 'method-one', actor_id: 'owner', bound_at: 1790899100, execution_epoch: '1', candidate_version_ids: ['method-source'], context_command_id: null, resolution: { status: 'neutral', context: { audit_area: null, period_start: null, period_end: null }, version_ids: ['method-source'], neutral_source_version_ids: ['method-source'], requirements: [], templates: [], issues: [], reason: 'No adopted firm criteria' } };
const inspection = { version_id: installed.id, skill_id: manifest.id, skill_version: manifest.version, digest: installed.digest, catalog_revision: catalog.revision, methodology_binding_id: binding.id, execution_epoch: '5', authority_actor_id: 'accepted-owner', status: 'eligible', reason: 'Technique choice compatible; exact actions need admission', needs: [], observed_at: 1790899250, dependency_fingerprint: 'c'.repeat(64) };
const selection = { id: 'selection-one', task_id: 'task-a', selector_id: 'selector', authority_actor_id: 'accepted-owner', selected_at: 1790899240, revision: '1', execution_epoch: '5', version_id: installed.id, skill_id: manifest.id, skill_version: manifest.version, digest: installed.digest, reason: 'Optional support inspection', methodology: binding, catalog_revision: catalog.revision, dependency_fingerprint: 'd'.repeat(64) };
const selected = { selection, current: inspection };
const discovery = { task_id: 'task-a', catalog_revision: catalog.revision, selection_revision: '1', methodology_binding_id: binding.id, execution_epoch: '5', candidates: [{ version: installed, inspection }], selections: [selected], observed_at: 1790899250 };
const action = { kind: 'select', scope, task_id: 'task-a', body: { key: 'select-one', version_id: installed.id, reason: selection.reason, expected_catalog_revision: catalog.revision, expected_methodology_binding_id: binding.id, expected_execution_epoch: '5', expected_selection_revision: '0' } };
const need = { id: 'read', tool: 'audit_read_v1', account_id: null, environment_id: null, destination: null, resource_id: null, recipients: [], attachment_classifications: [], requires_attachments: false };

// Keep the browser boundary strict without rewriting source strings or digests.
test('skill manifests preserve exact provenance, Unicode, inert resource bytes and canonical large revisions', () => {
  assert.deepEqual(parseSkillManifest(manifest), manifest);
  assert.deepEqual(parseInstallSkill(command), command);
  assert.deepEqual(parseSkillCatalog(catalog, scope.organisation_id), catalog);
  assert.equal(parseSkillCatalog({ ...catalog, private_token: 'discarded' }, scope.organisation_id).private_token, undefined);
  for (const accepted of ['\ufeff', '\ufeffSource', 'Source\ufeff', 'A\u00a0B', '界'.repeat(200)]) {
    const next = { ...manifest, name: accepted, source: { reference: accepted, revision: accepted, license: accepted }, inputs: [{ id: 'input', label: accepted, required: true }], resources: [{ id: 'resource', kind: 'text', content: accepted }] };
    assert.deepEqual(parseSkillManifest(next), next);
  }
  for (const rejected of [' bad', 'bad\u0085', '\ud800', 'bad\nlabel', '界'.repeat(201)]) assert.throws(() => parseSkillManifest({ ...manifest, name: rejected }));
});

test('skill manifest input bounds match server finite vocabulary, canonical sets and UTF-8 capacity', () => {
  for (const replacement of [{ schema_version: 2 }, { needs: [{ ...need, tool: 'shell_v1' }] }, { needs: [{ ...need, recipients: ['z', 'a'] }] }, { needs: [{ ...need, recipients: ['a', 'a'] }] }, { needs: [{ ...need, recipients: Array.from({ length: 17 }, (_, i) => `r${String(i).padStart(2, '0')}`) }] }, { needs: Array.from({ length: 17 }, (_, i) => ({ ...need, id: `n${i}` })) }, { method_version_ids: ['z', 'a'] }, { method_version_ids: Array.from({ length: 33 }, (_, i) => `m${String(i).padStart(2, '0')}`) }, { resources: Array.from({ length: 17 }, (_, i) => ({ id: `r${i}`, kind: 'text', content: 'a' })) }, { outputs: ['unsafe\0text'] }, { outputs: Array(33).fill('Output') }, { resources: [{ id: 'r', kind: 'executable', content: 'inert' }] }]) assert.throws(() => parseSkillManifest({ ...manifest, ...replacement }));
  for (const content of ['', ' \r\n\t\u3000', 'control\u0085text', 'x'.repeat(32769), '界'.repeat(10923), '\ud800']) assert.throws(() => parseSkillManifest({ ...manifest, resources: [{ id: 'r', kind: 'text', content }] }));
  const bounded = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, kind: 'text', content: 'x'.repeat(32768) }));
  assert.equal(parseSkillManifest({ ...manifest, resources: bounded }).resources.length, 4);
  assert.throws(() => parseSkillManifest({ ...manifest, resources: [...bounded, { id: 'extra', kind: 'text', content: 'x' }] }));
  assert.throws(() => parseSkillManifest({ ...manifest, resources: bounded, outputs: Array(32).fill('界'.repeat(2000)) }));
  assert.equal(parseSkillManifest({ ...manifest, needs: [{ ...need, tool: 'analysis_v1' }] }).needs[0].tool, 'analysis_v1');
  for (const expected_revision of ['01', '-1', '9223372036854775808', 12]) assert.throws(() => parseInstallSkill({ ...command, expected_revision }));
  assert.throws(() => parseInstallSkill({ ...command, applicability: { audit_area: null, period_start: '2025-02-29', period_end: '2025-12-31' } }));
  assert.throws(() => parseInstallSkill({ ...command, assignment: { kind: 'firm', client_id: 'client-a', engagement_id: null } }));
});

test('catalog resource digests bind exact resource identities and scope without replacing saved content', () => {
  assert.throws(() => parseSkillCatalog(catalog, 'org-b'), /audience/);
  for (const version of [{ ...installed, resource_digests: [] }, { ...installed, resource_digests: [{ id: 'other', digest: 'b'.repeat(64) }] }, { ...installed, digest: 'uppercase'.repeat(8) }, { ...installed, status: 'certified' }]) assert.throws(() => parseSkillCatalog({ ...catalog, versions: [version] }, 'org-a'));
  assert.throws(() => parseSkillCatalog({ ...catalog, versions: [installed, installed] }, 'org-a'));
});

test('discovery binds exact Task, method, catalog and immutable skill identity across candidates and history', () => {
  assert.deepEqual(parseTaskSkills(discovery, 'task-a'), discovery);
  assert.throws(() => parseTaskSkills(discovery, 'task-b'), /audience/);
  for (const patch of [{ version_id: 'other' }, { skill_id: 'other' }, { digest: 'e'.repeat(64) }, { catalog_revision: '1' }, { methodology_binding_id: 'other' }, { execution_epoch: '6' }]) assert.throws(() => parseTaskSkills({ ...discovery, candidates: [{ version: installed, inspection: { ...inspection, ...patch } }] }, 'task-a'));
  assert.throws(() => parseTaskSkills({ ...discovery, selections: [{ ...selected, selection: { ...selection, task_id: 'task-b' } }] }, 'task-a'));
  assert.throws(() => parseTaskSkills({ ...discovery, selections: Array(129).fill(selected) }, 'task-a'));
});

test('historical selection retains actual selector separately from accepted authority and effective method epoch', () => {
  const value = parseSkillSelection(selected, 'task-a');
  assert.equal(value.selection.selector_id, 'selector'); assert.equal(value.selection.authority_actor_id, 'accepted-owner');
  assert.equal(value.selection.methodology.execution_epoch, '1'); assert.equal(value.selection.execution_epoch, '5');
  for (const status of ['disabled', 'recalled', 'forbidden', 'unavailable', 'methodology_blocked', 'task_blocked']) {
    const blocked = { selection, current: { ...inspection, status, reason: 'Fresh restriction blocks use', catalog_revision: '9007199254740995' } };
    assert.deepEqual(parseSkillSelection(blocked, 'task-a'), blocked); assert.deepEqual(blocked.selection, selection);
  }
  const method = structuredClone(binding);
  method.resolution.templates = [{ template: { id: 'paper', version: 'v1', name: 'Paper', sections: [{ id: 'basis', title: 'Basis', required: true, content: '  Original template\n' }] }, source_version_id: 'historical-template-outside-candidates' }];
  assert.deepEqual(parseSkillSelection({ ...selected, selection: { ...selection, methodology: method } }, 'task-a').selection.methodology, method);
});

test('unavailable and forbidden declared needs retain explanatory metadata without implying operation authority', () => {
  for (const status of ['unavailable', 'forbidden', 'compatible_needs_exact_details']) {
    const value = { ...inspection, status: status === 'compatible_needs_exact_details' ? 'eligible' : status, needs: [{ id: 'read', tool: 'audit_read_v1', status, reason: 'Owned source or exact details needed', refresh_at: 1790899300, blocking_bound: null }] };
    assert.deepEqual(parseSkillInspection(value), value);
  }
  assert.throws(() => parseSkillInspection({ ...inspection, status: 'standing' }));
  assert.throws(() => parseSkillInspection({ ...inspection, needs: [{ id: 'n', tool: 'analysis_v1', status: 'ready_to_execute', reason: 'bad', refresh_at: null, blocking_bound: null }] }));
});

test('exact selection replay freezes complete scope and original basis, returns history with current blocked eligibility', async t => {
  const frozen = freezeSkillAction(action), requests = [];
  assert.equal(Object.isFrozen(frozen.body), true); assert.equal(Object.isFrozen(frozen.scope), true);
  assert.throws(() => { frozen.body.expected_catalog_revision = 'changed'; }, TypeError);
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    if (path.endsWith('/auth/session')) return Response.json(session);
    requests.push({ path, init });
    assert.equal(init.headers['X-Expected-Actor'], session.identity.id); assert.equal(init.headers['X-Expected-Session'], session.csrf_token); assert.equal(init.headers['X-CSRF-Token'], session.csrf_token);
    return Response.json({ selection, current: { ...inspection, catalog_revision: '9007199254740995', status: 'recalled', reason: 'Version recalled since selection' } });
  });
  const first = await selectSkill(frozen, session, new AbortController().signal);
  const replay = await selectSkill(frozen, session, new AbortController().signal);
  assert.deepEqual(first.selection, selection); assert.deepEqual(replay.selection, selection); assert.equal(replay.current.status, 'recalled');
  assert.equal(requests[0].init.body, requests[1].init.body); assert.equal(requests[0].path, '/api/engagements/engagement-a/tasks/task-a/skills/select?organisation_id=org-a&client_id=client-a');
});

test('selection receipts refuse substituted selector, version, reason, Task and expected basis', async t => {
  for (const patch of [{ revision: '2' }, { selector_id: 'other' }, { task_id: 'task-b' }, { reason: 'different choice' }, { version_id: 'other' }, { catalog_revision: '0' }, { execution_epoch: '1' }, { methodology: { ...binding, id: 'other' } }]) {
    t.mock.method(globalThis, 'fetch', async path => Response.json(path.endsWith('/auth/session') ? session : { selection: { ...selection, ...patch }, current: inspection }));
    await assert.rejects(selectSkill(action, session, new AbortController().signal)); t.mock.restoreAll();
  }
});

test('catalog mutations preserve exact retries and validate status receipt audience', async t => {
  const installAction = freezeSkillAction({ kind: 'install', organisation_id: 'org-a', body: command });
  const receipt = { event_id: 'event-one', organisation_id: 'org-a', actor_id: 'selector', version_id: installed.id, revision: catalog.revision, status: 'enabled', affected_selections: '0' };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (path, init) => { if (path.endsWith('/auth/session')) return Response.json(session); requests.push({ path, init }); return Response.json(receipt); });
  await applySkillCatalog(installAction, session, new AbortController().signal); await applySkillCatalog(installAction, session, new AbortController().signal);
  assert.equal(requests[0].path, '/api/skills/organisations/org-a/install'); assert.equal(requests[0].init.body, requests[1].init.body);
  assert.throws(() => parseCatalogReceipt({ ...receipt, actor_id: 'other' }, installAction, session), /audience/);
  assert.throws(() => parseCatalogReceipt({ ...receipt, organisation_id: 'org-b' }, installAction, session), /audience/);
  const disable = { kind: 'status', organisation_id: 'org-a', body: { key: 'disable', expected_revision: catalog.revision, version_id: installed.id, status: 'disabled', reason: 'Fault found' } };
  assert.throws(() => parseCatalogReceipt(receipt, disable, session), /audience/);
  assert.equal(parseCatalogReceipt({ ...receipt, revision: (BigInt(catalog.revision) + 1n).toString(), status: 'disabled' }, disable, session).status, 'disabled');
});

test('replaced sessions prevent a first write and fence a completed write before receipt disclosure', async t => {
  let posts = 0, reads = 0;
  t.mock.method(globalThis, 'fetch', async (_path, init) => { if (init.method === 'POST') posts++; return new Response(null, { status: 412 }); });
  await assert.rejects(selectSkill(action, session, new AbortController().signal), error => error instanceof AccessError && error.status === 412); assert.equal(posts, 0);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async (_path, init) => { if (init.method === 'POST') { posts++; return Response.json(selected); } return Response.json(++reads === 1 ? session : { ...session, csrf_token: 'replacement' }); });
  await assert.rejects(selectSkill(action, session, new AbortController().signal), error => error instanceof AccessError && error.status === 412); assert.equal(posts, 1);
});

test('catalog, discovery and independent eligibility reads verify session after scoped server responses', async t => {
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (path, init) => { paths.push(path); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.headers['X-Expected-Session'], session.csrf_token); return Response.json(path.endsWith('/auth/session') ? session : path.includes('/selections/') ? selected : path.includes('/tasks/') ? discovery : catalog); });
  await readSkillCatalog('org-a', session, new AbortController().signal); await readTaskSkills(scope, 'task-a', session, new AbortController().signal); await readSelectionEligibility(scope, 'task-a', selection.id, session, new AbortController().signal);
  assert.equal(paths.length, 6); assert.equal(paths[4], '/api/engagements/engagement-a/tasks/task-a/skills/selections/selection-one?organisation_id=org-a&client_id=client-a');
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async path => Response.json(path.endsWith('/auth/session') ? { ...session, csrf_token: 'new-session' } : discovery));
  await assert.rejects(readTaskSkills(scope, 'task-a', session, new AbortController().signal), error => error instanceof AccessError && error.status === 412);
});

test('uncertain skill custody is memory-only and isolated to exact actor session organisation and Task', () => {
  discardSkillActions();
  const owner = skillAudience(session, 'org-a', scope, 'task-a'); retainSkillAction(owner, session, action);
  assert.deepEqual(recoverSkillAction(owner, session), action); assert.equal(Object.isFrozen(recoverSkillAction(owner, session).body), true);
  assert.equal(recoverSkillAction(skillAudience(session, 'org-a', scope, 'task-b'), session), null);
  assert.notEqual(owner, skillAudience(session, 'org-a', { ...scope, client_id: 'client-b' }, 'task-a'));
  withdrawReplacedSkillSession({ ...session, csrf_token: 'replacement' }); assert.equal(recoverSkillAction(owner, session), null);
  retainSkillAction(owner, session, action); discardSkillActions(owner); assert.equal(recoverSkillAction(owner, session), null);
});

test('definite conflicts allow review while uncertain retries keep their original key through throttling', () => {
  assert.equal(skillRefused(new AccessError(409)), true); assert.equal(skillRefused(new AccessError(400)), true);
  assert.equal(skillRefused(new AccessError(429)), true); assert.equal(skillRefused(new AccessError(429), true), false);
  assert.equal(skillRefused(new AccessError(503)), false); assert.equal(skillRefused(new Error('network')), false);
});


test('set ordering is canonicalized only at submission without editing the draft or immutable resource bytes', () => {
  const draft = structuredClone(command);
  draft.manifest.method_version_ids = ['z-method', 'a-method'];
  draft.manifest.needs = [{ ...need, recipients: ['z-recipient', 'a-recipient'], attachment_classifications: ['z-class', 'a-class'] }];
  const original = structuredClone(draft), submitted = prepareSkillInstall(draft);
  assert.deepEqual(draft, original);
  assert.deepEqual(submitted.manifest.method_version_ids, ['a-method', 'z-method']);
  assert.deepEqual(submitted.manifest.needs[0].recipients, ['a-recipient', 'z-recipient']);
  assert.deepEqual(submitted.manifest.needs[0].attachment_classifications, ['a-class', 'z-class']);
  assert.deepEqual(submitted.manifest.resources, original.manifest.resources);
  assert.deepEqual(submitted.manifest.source, original.manifest.source);
  draft.manifest.method_version_ids.push(''); assert.throws(() => prepareSkillInstall(draft));
});

test('skills accept bounded 8 MiB metadata responses while ordinary reads stay at 4 MiB', async t => {
  const plain = JSON.stringify({ ...catalog, padding: '' });
  let body = JSON.stringify({ ...catalog, padding: 'x'.repeat(SKILL_JSON_BYTES - new TextEncoder().encode(plain).length) });
  assert.equal(new TextEncoder().encode(body).length, SKILL_JSON_BYTES);
  t.mock.method(globalThis, 'fetch', async path => path.endsWith('/auth/session') ? Response.json(session) : new Response(body, { headers: { 'Content-Type': 'application/json', 'Content-Length': '1' } }));
  assert.deepEqual(await readSkillCatalog('org-a', session, new AbortController().signal), catalog);
  await assert.rejects(readJson('/ordinary', new AbortController().signal), /response size/);
  body += ' ';
  await assert.rejects(readSkillCatalog('org-a', session, new AbortController().signal), /response size/);
});

test('incoherent eligible observations cannot enable selection or silently drop a declared need', () => {
  const forbiddenNeed = { id: 'read', tool: 'audit_read_v1', status: 'forbidden', reason: 'No surviving current hard bound', refresh_at: null, blocking_bound: null };
  assert.throws(() => parseSkillInspection({ ...inspection, needs: [forbiddenNeed] }));
  assert.throws(() => parseTaskSkills({ ...discovery, candidates: [{ version: { ...installed, status: 'disabled' }, inspection }] }, 'task-a'));
  assert.throws(() => parseTaskSkills({ ...discovery, candidates: [{ version: { ...installed, command: { ...command, manifest: { ...manifest, needs: [need] } } }, inspection }] }, 'task-a'));
});


test('maximal conservative catalog/discovery wire envelopes fit the skills-only 8 MiB read bound', async t => {
  // A storage budget cannot coexist with every content field at its individual
  // maximum. Keep the complete 2 MiB/1 MiB budgets as opaque ASCII padding and
  // independently maximize all wire-only wrappers. This intentionally overcounts
  // each encoded command/receipt by an object wrapper and numeric-string margin.
  const maximumId = 'i'.repeat(128), maximumRevision = '9223372036854775807', maximumDigest = 'f'.repeat(64);
  // Organisation/null is five encoded bytes longer than delegation/depth7.
  const maximumNeed = { id: maximumId, tool: 'audit_write_v1', status: 'compatible_needs_exact_details', reason: 'R'.repeat(256), refresh_at: 253402300799, blocking_bound: { accepted: false, kind: 'organisation', delegation_depth: null } };
  const maximumInspection = { version_id: maximumId, skill_id: maximumId, skill_version: maximumId, digest: maximumDigest, catalog_revision: maximumRevision, methodology_binding_id: maximumId, execution_epoch: maximumRevision, authority_actor_id: maximumId, status: 'methodology_blocked', reason: 'R'.repeat(256), needs: Array(16).fill(maximumNeed), observed_at: 253402300799, dependency_fingerprint: maximumDigest };
  const maximumVersion = { id: maximumId, actor_id: maximumId, installed_at: 253402300799, revision: maximumRevision, command: { stored_bytes_budget: 'x'.repeat(2 * 1024 * 1024 / 128), decimal_string_margin: 'x'.repeat(32) }, digest: maximumDigest, resource_digests: Array(16).fill({ id: maximumId, digest: maximumDigest }), status: 'recalled', status_revision: maximumRevision, status_event: { event_id: maximumId, actor_id: maximumId, recorded_at: 253402300799, revision: maximumRevision, status: 'recalled', reason: '😀'.repeat(2000) } };
  const maximumSelection = { stored_bytes_budget: 'x'.repeat(1024 * 1024 / 128), decimal_string_margin: 'x'.repeat(32) };
  const maximumDiscovery = { task_id: maximumId, catalog_revision: maximumRevision, selection_revision: maximumRevision, methodology_binding_id: maximumId, execution_epoch: maximumRevision, observed_at: 253402300799, candidates: Array(128).fill({ version: maximumVersion, inspection: maximumInspection }), selections: Array(128).fill({ selection: maximumSelection, current: maximumInspection }) };
  // Metadata labels allow 200 Unicode scalars, including 4-byte UTF-8 symbols.
  const maximumCatalog = { organisation_id: maximumId, revision: maximumRevision, versions: Array(128).fill(maximumVersion) };
  const maximumAssignment = { clients: Array(50).fill({ client_id: maximumId, client_name: '😀'.repeat(200) }), engagements: Array(50).fill({ client_id: maximumId, engagement_id: maximumId, client_name: '😀'.repeat(200), engagement_name: '😀'.repeat(200) }), next_after: maximumId };
  const maximumHistory = { version_id: maximumId, events: Array(50).fill(maximumVersion.status_event), next_before_revision: maximumRevision };
  const maximumImpact = { organisation_id: maximumId, client_id: maximumId, engagement_id: maximumId, version_id: maximumId, selections: Array(50).fill({ task_id: maximumId, selection_id: maximumId, selector_id: maximumId, selected_at: 253402300799, selection_revision: maximumRevision, version_id: maximumId, skill_id: maximumId, skill_version: maximumId, digest: maximumDigest, methodology_binding_id: maximumId, execution_epoch: maximumRevision, catalog_revision: maximumRevision, status: 'recalled', status_revision: maximumRevision }), next_after: { task_id: maximumId, revision: maximumRevision } };
  const encoded = JSON.stringify(maximumDiscovery), size = new TextEncoder().encode(encoded).length;
  const catalogSize = new TextEncoder().encode(JSON.stringify(maximumCatalog)).length;
  t.diagnostic(`Conservative discovery wire envelope: ${size} bytes; catalog: ${catalogSize} bytes; skill limit: ${SKILL_JSON_BYTES} bytes. 128 candidates + 128 selections, 16 needs/inspection and 16 resource digests/version; 2 MiB command + 1 MiB receipt padding plus wrappers.`);
  assert.ok(size > 4 * 1024 * 1024); assert.ok(size < SKILL_JSON_BYTES); assert.ok(catalogSize < SKILL_JSON_BYTES);
  assert.equal((await readJsonBody(new Response(encoded), SKILL_JSON_BYTES)).candidates.length, 128);
  assert.equal((await readJsonBody(new Response(JSON.stringify(maximumCatalog)), SKILL_JSON_BYTES)).versions.length, 128);
  for (const [name, page] of Object.entries({ assignments: maximumAssignment, history: maximumHistory, impact: maximumImpact })) { const body = JSON.stringify(page), bytes = new TextEncoder().encode(body).length; t.diagnostic(`Conservative ${name} page envelope: ${bytes} bytes.`); assert.ok(bytes < SKILL_JSON_BYTES); assert.deepEqual(await readJsonBody(new Response(body), SKILL_JSON_BYTES), page); }
  await assert.rejects(readJsonBody(new Response(' '.repeat(SKILL_JSON_BYTES + 1)), SKILL_JSON_BYTES), /response size/);
});


test('definite scope and Admin refusals erase only the matching private retry custody', () => {
  discardSkillActions();
  const first = skillAudience(session, 'org-a', scope, 'task-a'), secondScope = { ...scope, client_id: 'client-b' };
  const second = skillAudience(session, 'org-a', secondScope, 'task-b'), admin = skillAudience(session, 'org-a');
  retainSkillAction(first, session, action); retainSkillAction(second, session, { ...action, scope: secondScope, task_id: 'task-b' });
  retainSkillAction(admin, session, { kind: 'install', organisation_id: 'org-a', body: command });
  discardSkillScopeActions(scope);
  assert.equal(recoverSkillAction(first, session), null); assert.notEqual(recoverSkillAction(second, session), null); assert.notEqual(recoverSkillAction(admin, session), null);
  discardSkillCatalogActions('org-a'); assert.equal(recoverSkillAction(admin, session), null); assert.notEqual(recoverSkillAction(second, session), null);
  discardSkillActions();
});

test('server-owned eligibility explanation bound counts UTF-8 bytes while user reasons retain Unicode scalar limits', () => {
  assert.equal(parseSkillInspection({ ...inspection, reason: '😀'.repeat(64) }).reason, '😀'.repeat(64));
  assert.throws(() => parseSkillInspection({ ...inspection, reason: '😀'.repeat(65) }));
  assert.throws(() => parseSkillInspection({ ...inspection, needs: [{ id: 'read', tool: 'audit_read_v1', status: 'unavailable', reason: 'x'.repeat(257), refresh_at: null, blocking_bound: null }], status: 'unavailable' }));
  assert.equal(parseSkillSelection({ ...selected, selection: { ...selection, reason: '😀'.repeat(2000) } }, 'task-a').selection.reason, '😀'.repeat(2000));
});

test('unsent skill drafts preserve exact text and original basis only for their actor session organisation and Task', () => {
  discardSkillActions();
  const owner = skillAudience(session, 'org-a'), taskOwner = skillAudience(session, 'org-a', scope, 'task-a');
  const draft = structuredClone(command); draft.manifest.resources[0].content = '  raw\r\n\tbytes\n'; draft.manifest.method_version_ids = ['z', '', 'a'];
  assert.equal(retainSkillDraft(owner, session, { kind: 'install-draft', organisation_id: 'org-a', body: draft }), true);
  assert.deepEqual(recoverSkillDraft(owner, session).body, draft); assert.equal(recoverSkillOrganisation(session), 'org-a');
  recoverSkillDraft(owner, session).body.manifest.name = 'Cannot mutate custody'; assert.equal(recoverSkillDraft(owner, session).body.manifest.name, draft.manifest.name);
  assert.equal(retainSkillDraft(taskOwner, session, { kind: 'selection-draft', scope, task_id: 'task-a', body: { ...action.body, reason: 'Unsent original reason' } }), true);
  assert.equal(recoverSkillDraft(skillAudience(session, 'org-a', scope, 'task-b'), session), null);
  retainSkillAction(taskOwner, session, action); discardSkillPending(taskOwner);
  assert.equal(recoverSkillAction(taskOwner, session), null); assert.equal(recoverSkillDraft(taskOwner, session).body.reason, 'Unsent original reason');
  discardSkillScopeActions(scope); assert.equal(recoverSkillDraft(taskOwner, session), null); assert.notEqual(recoverSkillDraft(owner, session), null);
  retainSkillDraft(owner, session, { kind: 'status-draft', organisation_id: 'org-a', body: { version: installed, status: 'disabled', reason: ' exact invalid draft ', expected_revision: catalog.revision } });
  assert.equal(recoverSkillDraft(owner, session).body.reason, ' exact invalid draft ');
  withdrawReplacedSkillSession({ ...session, csrf_token: 'new-session' }); assert.equal(recoverSkillDraft(owner, session), null);
  retainSkillDraft(owner, session, { kind: 'install-draft', organisation_id: 'org-a', body: draft }); discardSkillCatalogActions('org-a'); assert.equal(recoverSkillDraft(owner, session), null);
  discardSkillActions();
});

test('bounded draft custody refuses new entries and bytes without evicting drafts or exact pending recovery', () => {
  discardSkillActions();
  const owners = Array.from({ length: 16 }, (_, index) => skillAudience(session, 'org-a', scope, `task-${index}`));
  owners.forEach((owner, index) => assert.equal(retainSkillDraft(owner, session, { kind: 'selection-draft', scope, task_id: `task-${index}`, body: action.body }), true));
  const extra = skillAudience(session, 'org-a', scope, 'task-extra');
  assert.equal(retainSkillDraft(extra, session, { kind: 'selection-draft', scope, task_id: 'task-extra', body: action.body }), false);
  assert.equal(retainSkillAction(extra, session, { ...action, task_id: 'task-extra' }), false);
  assert.equal(retainSkillAction(owners[0], session, action), true); assert.deepEqual(recoverSkillAction(owners[0], session), action);
  owners.forEach(owner => assert.deepEqual(recoverSkillDraft(owner, session).body, action.body));
  const huge = { ...action.body, reason: 'x'.repeat(SKILL_CUSTODY_BYTES) };
  assert.equal(retainSkillDraft(owners[1], session, { kind: 'selection-draft', scope, task_id: 'task-1', body: huge }), false);
  assert.equal(retainSkillDraft(owners[1], session, { kind: 'status-draft', organisation_id: 'org-a', body: { version: installed, status: 'disabled', reason: huge.reason, expected_revision: catalog.revision } }), false);
  assert.deepEqual(recoverSkillDraft(owners[1], session).body, action.body); assert.deepEqual(recoverSkillAction(owners[0], session), action);
  discardSkillActions(owners[15]); assert.equal(retainSkillDraft(extra, session, { kind: 'selection-draft', scope, task_id: 'task-extra', body: action.body }), true);
  discardSkillActions();
  owners.forEach(owner => assert.equal(retainSkillAction(owner, session, action), true));
  discardSkillPending(owners[0]);
  assert.equal(retainSkillDraft(extra, session, { kind: 'selection-draft', scope, task_id: 'task-extra', body: action.body }), true);
  discardSkillActions();
});

test('authoring errors identify exact fields and limits while supplementary characters and raw source text remain intact', () => {
  const valid = structuredClone(command); valid.manifest.name = '😀'.repeat(200); valid.applicability.audit_area = '😀'.repeat(200); valid.manifest.inputs[0].label = '😀'.repeat(200);
  assert.deepEqual(validateSkillInstall(valid), {}); assert.deepEqual(prepareSkillInstall(valid), valid);
  assert.equal(skillProseError('😀'.repeat(2000)), null); assert.match(skillProseError('😀'.repeat(2001)), /2000 Unicode characters/);
  for (const invalid of [' reason', 'reason ', 'reason\nline', '\ud800']) assert.notEqual(skillProseError(invalid), null);
  const draft = structuredClone(valid); draft.manifest.name += '😀'; draft.manifest.inputs.push({ ...draft.manifest.inputs[0] });
  draft.manifest.outputs = Array(33).fill('Output'); draft.manifest.needs = [need, { ...need }];
  draft.manifest.resources = [{ id: 'duplicate', kind: 'text', content: 'x'.repeat(32769) }, { id: 'duplicate', kind: 'text', content: ' raw\r\n' }];
  draft.applicability.period_start = '2025-12-31'; draft.applicability.period_end = '2025-01-01';
  const before = structuredClone(draft), errors = validateSkillInstall(draft);
  assert.match(errors['manifest.name'], /201/); assert.match(errors['manifest.inputs.0.id'], /duplicate/); assert.match(errors['manifest.inputs.1.id'], /duplicate/);
  assert.match(errors['manifest.needs.0.id'], /duplicate/); assert.match(errors['manifest.outputs'], /32 output/); assert.match(errors['manifest.resources.0.id'], /duplicate/);
  assert.match(errors['manifest.resources.0.content'], /32768 bytes/); assert.match(errors['applicability.period_start'], /before period end/); assert.match(errors['applicability.period_end'], /before period end/); assert.deepEqual(draft, before);
  draft.manifest.resources = Array.from({ length: 5 }, (_, index) => ({ id: `r${index}`, kind: 'text', content: 'x'.repeat(32768) }));
  const aggregate = validateSkillInstall(draft); for (let index = 0; index < 5; index++) assert.match(aggregate[`manifest.resources.${index}.content`], /131072 bytes/);
  draft.manifest.outputs = Array(32).fill('😀'.repeat(2000)); assert.match(validateSkillInstall(draft).manifest, /200000 bytes/);
});

test('redacted bound explanations preserve accepted/current kind and depth without leaking rule values', () => {
  for (const accepted of [true, false]) for (const kind of ['organisation', 'engagement', 'member', 'account', 'task', 'delegation']) {
    const blocking_bound = { accepted, kind, delegation_depth: kind === 'delegation' ? 7 : null };
    const value = { ...inspection, status: 'forbidden', needs: [{ id: 'read', tool: 'audit_read_v1', status: 'forbidden', reason: 'Permissions: hard_bounds', refresh_at: null, blocking_bound: { ...blocking_bound, subject_id: 'secret', rule_values: ['secret'] } }] };
    assert.deepEqual(parseSkillInspection(value).needs[0].blocking_bound, blocking_bound);
  }
  for (const blocking_bound of [{ accepted: true, kind: 'unknown', delegation_depth: null }, { accepted: true, kind: 'task', delegation_depth: 1 }, { accepted: false, kind: 'delegation', delegation_depth: 8 }, { accepted: false, kind: 'delegation', delegation_depth: null }]) assert.throws(() => parseSkillInspection({ ...inspection, status: 'forbidden', needs: [{ id: 'n', tool: 'audit_read_v1', status: 'forbidden', reason: 'Denied', refresh_at: null, blocking_bound }] }));
});

test('independent assignment and status pages validate bounds, cursor ordering, scope and persisted provenance', () => {
  const assignments = { clients: [{ client_id: 'client-a', client_name: 'Alder' }], engagements: [], next_after: null };
  assert.deepEqual(parseSkillAssignments(assignments, 'client', null, null), assignments);
  const engagements = { clients: [], engagements: [{ client_id: 'client-a', engagement_id: 'engagement-a', client_name: 'Alder', engagement_name: 'Audit' }], next_after: null };
  assert.deepEqual(parseSkillAssignments(engagements, 'engagement', 'client-a', null), engagements);
  assert.throws(() => parseSkillAssignments(engagements, 'engagement', 'client-b', null)); assert.throws(() => parseSkillAssignments(assignments, 'client', null, 'client-a'));
  assert.throws(() => parseSkillAssignments({ ...assignments, clients: Array(51).fill(assignments.clients[0]) }, 'client', null, null));
  assert.throws(() => parseSkillAssignments({ ...assignments, next_after: 'unrelated' }, 'client', null, null));
  const event = { event_id: 'disable-event', actor_id: 'other-admin', recorded_at: 1790899300, revision: '9007199254740995', status: 'disabled', reason: 'Verified fault' };
  const history = { version_id: installed.id, events: [event, installed.status_event], next_before_revision: null };
  assert.deepEqual(parseSkillStatusHistory(history, installed.id, null), history); assert.throws(() => parseSkillStatusHistory(history, 'other', null)); assert.throws(() => parseSkillStatusHistory(history, installed.id, event.revision));
  assert.equal(parseSkillCatalog({ ...catalog, versions: [{ ...installed, status: 'disabled', status_revision: event.revision, status_event: event }] }, 'org-a').versions[0].status_event.reason, 'Verified fault');
  assert.throws(() => parseSkillCatalog({ ...catalog, versions: [{ ...installed, status_event: event }] }, 'org-a'));
});

test('impact pages bind current audit and optional exact version while preserving original selection references', async t => {
  const impact = { ...scope, version_id: null, selections: [{ task_id: 'task-a', selection_id: selection.id, selector_id: selection.selector_id, selected_at: selection.selected_at, selection_revision: selection.revision, version_id: installed.id, skill_id: manifest.id, skill_version: manifest.version, digest: installed.digest, methodology_binding_id: binding.id, execution_epoch: selection.execution_epoch, catalog_revision: selection.catalog_revision, status: 'recalled', status_revision: '9007199254740995' }], next_after: null };
  assert.deepEqual(parseSkillImpacts(impact, scope, null, null), impact);
  assert.throws(() => parseSkillImpacts(impact, { ...scope, engagement_id: 'other' }, null, null)); assert.throws(() => parseSkillImpacts({ ...impact, version_id: installed.id }, scope, 'other', null));
  assert.throws(() => parseSkillImpacts({ ...impact, selections: [{ ...impact.selections[0], status: 'enabled' }] }, scope, null, null));
  assert.throws(() => parseSkillImpacts(impact, scope, null, { task_id: 'task-a', revision: '1' }));
  const paths = [], assignmentPage = { clients: [], engagements: [], next_after: null }, history = { version_id: installed.id, events: [installed.status_event], next_before_revision: null };
  t.mock.method(globalThis, 'fetch', async (path, init) => { paths.push(path); assert.equal(init.headers['X-Expected-Session'], session.csrf_token); return Response.json(path.endsWith('/auth/session') ? session : path.includes('/assignments') ? assignmentPage : path.includes('/history') ? history : impact); });
  await readSkillAssignments('org-a', 'engagement', 'client-a', 'engagement-before', session, new AbortController().signal);
  await readSkillStatusHistory('org-a', installed.id, null, session, new AbortController().signal);
  await readSkillImpacts(scope, null, null, session, new AbortController().signal);
  assert.equal(paths.length, 6); assert.match(paths[0], /kind=engagement&client_id=client-a&after=engagement-before/); assert.match(paths[2], /versions\/catalog-one\/history$/); assert.match(paths[4], /engagements\/engagement-a\/skills\/impacts\?organisation_id=org-a&client_id=client-a/);
  t.mock.restoreAll(); t.mock.method(globalThis, 'fetch', async path => Response.json(path.endsWith('/auth/session') ? { ...session, csrf_token: 'replacement' } : impact));
  await assert.rejects(readSkillImpacts(scope, null, null, session, new AbortController().signal), error => error instanceof AccessError && error.status === 412);
});
