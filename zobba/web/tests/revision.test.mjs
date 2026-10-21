import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { causeLabel, errorLabel, parseChain, parseDisposition, parseDispositionPage, parseHistory, rationaleBytes, reviewLabel } from '../src/revision.ts';

// The exact history JSON `crates/worker/tests/revision.rs` recorded from the
// real API (identifiers and digests replaced by stable ones).
const recorded = JSON.parse(readFileSync(new URL('./fixtures/task-revision.json', import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

const disposition = { id: 'disp-1', actor_id: 'actor-a', actor_label: 'Alex', chain_id: 'eval-1', revision: '1', revision_id: 'eval-1', kind: 'replaced', concern: null, verdict: 'not_met', rationale: 'The requester and the approver share a manager.', references: [], recorded_us: '1' };
const chain = { chain_id: 'eval-1', head_id: 'eval-1', revision: '1', basis_id: 'basis-1', criterion_id: 'crit-1', applicability: 'applicable', execution: 'completed', verdict: 'met', reason: null, origin: 'model_proposal', causes: [], effective_verdict: 'not_met', effective_origin: 'human', review: 'replaced', earlier_accepted: false, disposition };

test('the recorded chain history parses exactly', () => {
  const page = parseHistory(recorded, recorded.chain_id);
  assert.deepEqual(page, recorded);
  assert.deepEqual(page.entries.map(e => e.revision), ['1', '2', '3']);
  assert.deepEqual(page.entries[2].causes, ['inputs_changed', 'basis_revised', 'reconsideration_requested']);
  assert.equal(page.entries[1].dispositions[0].kind, 'needs_reconsideration');
  assert.equal(page.entries[2].changes.replaced.length, 1);
});

test('each history rule refuses exactly its own defect', () => {
  const cases = [
    ['an unknown field', h => { h.confidence = '0.9'; }],
    ['a page of another chain', h => { h.chain_id = 'eval-99'; }],
    ['a gap in revision numbers', h => { h.entries.splice(1, 1); }],
    ['causes on revision 1', h => { h.entries[0].causes = ['inputs_changed']; }],
    ['changes on revision 1', h => { h.entries[0].changes.added = ['fact-1']; }],
    ['a revision 2 with no predecessor', h => { h.entries[1].predecessor_id = null; }],
    ['a cause outside the closed set', h => { h.entries[1].causes = ['manual_override']; }],
    ['causes out of their closed order', h => { h.entries[2].causes = ['basis_revised', 'inputs_changed']; }],
    ['a disposition of another revision', h => { h.entries[1].dispositions[0].revision_id = h.entries[2].id; }],
    // A middle page (with a cursor) whose total is below a listed number:
    // only the total rule can refuse it.
    ['a total below the listed revisions', h => { h.entries.splice(2, 1); h.next_cursor = '2'; h.total = '1'; }],
    ['a cursor that is not the last listed revision', h => { h.entries.splice(2, 1); h.next_cursor = '1'; }],
    ['a final page that stops short of the total', h => { h.total = '4'; }],
    ['a disposition total below the listed ones', h => { h.entries[1].dispositions_total = '0'; }],
    ['a disposition cursor after a short list', h => { h.entries[1].dispositions_next_cursor = h.entries[1].dispositions[0].id; }],
  ];
  for (const [name, change] of cases) {
    const h = clone(recorded);
    change(h);
    assert.throws(() => parseHistory(h, recorded.chain_id), /Invalid assessment response/, name);
  }
});

test('a revision holds any number of dispositions, read in bounded pages', () => {
  const entry = clone(recorded.entries[1]);
  const one = entry.dispositions[0];
  const listed = n => Array.from({ length: n }, (_, i) => ({ ...clone(one), id: `disp-${i + 100}` }));
  // A history entry lists the first 16 of 200 and names the next page.
  const h = clone(recorded);
  h.entries[1].dispositions = listed(16);
  h.entries[1].dispositions_total = '200';
  h.entries[1].dispositions_next_cursor = 'disp-115';
  assert.deepEqual(parseHistory(h, recorded.chain_id), h);
  const page = (n, next) => ({ revision_id: entry.id, total: '200', dispositions: listed(n), next_cursor: next });
  const full = page(50, 'disp-149');
  assert.deepEqual(parseDispositionPage(full, entry.id), full);
  assert.deepEqual(parseDispositionPage(page(3, null), entry.id), page(3, null));
  const cases = [
    ['a cursor that is not the last listed', page(50, 'disp-100')],
    ['a next page after a short page', page(49, 'disp-148')],
    ['another revision', { ...page(1, null), revision_id: 'rev-99' }],
    ['a total below the listed dispositions', { ...page(3, null), total: '2' }],
    ['a repeated disposition', { ...page(2, null), dispositions: [clone(one), clone(one)] }],
  ];
  for (const [name, value] of cases) assert.throws(() => parseDispositionPage(value, entry.id), /Invalid/, name);
});

test('a chain head states its review state exactly as derived', () => {
  assert.deepEqual(parseChain(chain), chain);
  const cases = [
    ['a replaced rule verdict', { origin: 'deterministic', judgment: undefined }],
    ['an effective verdict other than the person\'s', { effective_verdict: 'met' }],
    // An accepted disposition shown as pending (effective fields are the
    // head's own, so only the review/kind rule can refuse it).
    ['a review that is not the newest disposition', { review: 'pending_reconsideration', effective_verdict: 'met', effective_origin: 'model_proposal', disposition: { ...disposition, kind: 'accepted', verdict: null } }],
    ['a revision-1 head with causes', { causes: ['inputs_changed'] }],
    ['a disposition of another revision', { disposition: { ...disposition, revision: '2', revision_id: 'rev-2' } }],
    ['a confidence field', { confidence: '0.9' }],
  ];
  for (const [name, change] of cases) {
    const c = { ...clone(chain), ...change };
    for (const key of Object.keys(c)) if (c[key] === undefined) delete c[key];
    assert.throws(() => parseChain(c), /Invalid assessment response/, name);
  }
  // An earlier revision was accepted and this one has its own disposition
  // (r1 accepted, r2 asked to reconsider): a state the loop reaches.
  const reconsidered = { ...clone(chain), revision: '2', head_id: 'rev-2', causes: ['inputs_changed'], effective_verdict: 'met', effective_origin: 'model_proposal', review: 'pending_reconsideration', earlier_accepted: true,
    disposition: { ...disposition, revision: '2', revision_id: 'rev-2', kind: 'needs_reconsideration', verdict: null, concern: 'facts' } };
  assert.deepEqual(parseChain(reconsidered), reconsidered);
  // Unreviewed: the head's own verdict and origin.
  const unreviewed = { ...clone(chain), effective_verdict: 'met', effective_origin: 'model_proposal', review: 'unreviewed', disposition: null };
  assert.deepEqual(parseChain(unreviewed), unreviewed);
});

test('a disposition pairs its kind with its concern or verdict', () => {
  assert.deepEqual(parseDisposition(disposition), disposition);
  const reconsider = { ...disposition, kind: 'needs_reconsideration', verdict: null, concern: 'facts' };
  assert.deepEqual(parseDisposition(reconsider), reconsider);
  assert.throws(() => parseDisposition({ ...disposition, verdict: null }), /Invalid/, 'replaced without a verdict');
  assert.throws(() => parseDisposition({ ...reconsider, concern: null }), /Invalid/, 'reconsideration without a concern');
  assert.throws(() => parseDisposition({ ...disposition, kind: 'waived' }), /Invalid/, 'no waiver');
  assert.throws(() => parseDisposition({ ...disposition, rationale: 'é'.repeat(1001) }), /Invalid/, 'over 2,000 bytes');
  // A label is bounded in characters like the server's identities: 200
  // CJK characters (600 bytes) are one valid label, 201 are not.
  const named = { ...disposition, actor_label: '審'.repeat(200) };
  assert.deepEqual(parseDisposition(named), named);
  assert.throws(() => parseDisposition({ ...disposition, actor_label: '審'.repeat(201) }), /Invalid/, 'over 200 characters');
});

test('the words name causes, review states and refusals', () => {
  assert.equal(causeLabel.reconsideration_requested, 'a person asked for reconsideration');
  assert.equal(reviewLabel.pending_reconsideration, 'Waiting for Zobba to reconsider');
  assert.match(errorLabel.not_replaceable, /cannot be replaced/);
  assert.match(errorLabel.revision_superseded, /newer revision/);
  assert.equal(rationaleBytes('é'), 2);
  assert.ok(!JSON.stringify(recorded).includes('confidence'));
});
