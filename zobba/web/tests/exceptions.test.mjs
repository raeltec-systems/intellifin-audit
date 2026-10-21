import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NOT_REMEDIATION, PERSON_UNDETERMINED, PROPOSED_MET, errorLabel, parseDetail, parseEffective, parseException, parseExceptionDisposition, parseExceptions, rationaleBytes, statusLabel, statusWords } from '../src/exceptions.ts';

// The exact exception list JSON `crates/worker/tests/exception.rs` recorded
// from the real API (identifiers and digests replaced by stable ones).
const recorded = JSON.parse(readFileSync(new URL('./fixtures/task-exceptions.json', import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

test('the recorded exception list parses exactly', () => {
  const list = parseExceptions(recorded);
  assert.deepEqual(list, recorded);
  assert.deepEqual(list.exceptions.map(e => e.status), ['replaced_by_human_judgment', 'resolved_by_evidence', 'open', 'closed_by_disposition', 'open', 'open']);
  assert.equal(list.counts.total, '6');
  assert.equal(list.counts.subjects, '5', 'distinct subjects, fewer than exceptions');
  assert.equal(list.next_cursor, null, 'one page holds them all');
  // INV-0051 was closed, then a judgment over evidence its closure never saw
  // reopened it: open, with its closure still the newest disposition.
  assert.equal(list.exceptions[2].disposition.kind, 'closed');
  const [first, second] = list.effective_summaries;
  assert.equal(second.supersedes, first.id, 'a later effective summary supersedes the earlier one');
  // A closure never drops a failing count below what the evidence shows.
  assert.equal(second.summary.failing_subjects, '3');
  assert.equal(second.conclusion, 'exceptions_found_inconclusive');
  assert.deepEqual(second.effective_limitations.map(l => l.code), ['unresolved_subjects', 'unreviewed_model_proposals', 'open_exceptions']);
  assert.ok(!JSON.stringify(recorded).includes('confidence'));
  assert.ok(!/%|percent/.test(JSON.stringify(recorded)), 'no percentages');
});

test('each list rule refuses exactly its own defect', () => {
  const cases = [
    ['an unknown field', l => { l.waived = '1'; }],
    ['counts by status that do not add up to the total', l => { l.counts.open = '4'; }],
    ['more distinct subjects than exceptions', l => { l.counts.subjects = '7'; }],
    ['a status outside the closed set', l => { l.exceptions[0].status = 'waived'; }],
    ['status words that are not the derived sentence', l => { l.exceptions[4].status_words = 'Open: resolved.'; }],
    ['a resolved exception whose latest observation still awaits review', l => { l.exceptions[1].latest_observed = 'proposed_met'; }],
    ['a closed exception whose newest disposition is not a closure', l => { l.exceptions[3].disposition.kind = 'reopened'; l.exceptions[3].disposition.references = []; }],
    ['a closure without evidence', l => { l.exceptions[3].disposition.references = []; }],
    ['an exception with no occurrence', l => { l.exceptions[0].occurrences = '0'; }],
    ['a disposition count without a newest disposition', l => { l.exceptions[0].dispositions = '1'; }],
    ['a changed remediation sentence', l => { l.not_remediation = 'resolved'; }],
    ['a next page after a part page', l => { l.next_cursor = l.exceptions[5].id; }],
    ['a listed exception count that is not the total', l => { l.effective_summaries[0].listed.pop(); }],
    ['an effective summary that supersedes itself', l => { l.effective_summaries[1].supersedes = l.effective_summaries[1].id; }],
    ['limitations out of their closed order', l => { l.effective_summaries[1].effective_limitations.reverse(); }],
    ['open exceptions not stated as a limitation', l => { l.effective_summaries[1].effective_limitations.pop(); }],
    ['a conclusion other than the derived one', l => { l.effective_summaries[1].conclusion = 'exceptions_found'; }],
    ['an effective count that does not add up', l => { l.effective_summaries[1].exceptions.open = '5'; }],
    ['an exact flag on an incomplete population', l => { l.effective_summaries[1].exact = false; }],
  ];
  for (const [name, change] of cases) {
    const l = clone(recorded);
    change(l);
    assert.throws(() => parseExceptions(l), /Invalid assessment response/, name);
  }
});

test('each open state says exactly its own sentence', () => {
  const base = clone(recorded.exceptions[4]);
  for (const [latest, words] of [
    ['not_observed', `Open: ${NOT_REMEDIATION}.`],
    ['proposed_met', `Open: ${PROPOSED_MET}.`],
    ['person_undetermined', `Open: ${PERSON_UNDETERMINED}.`],
    ['not_met', 'Open: a current observation does not meet the criterion.'],
  ]) {
    const e = { ...base, latest_observed: latest, status_words: words };
    assert.equal(statusWords('open', latest), words);
    assert.deepEqual(parseException(e), e);
    assert.throws(() => parseException({ ...e, status_words: 'Open: resolved.' }), /Invalid/, latest);
  }
  // Neither an unreviewed proposal nor a person's undetermined is remediation.
  assert.match(PERSON_UNDETERMINED, /not evidence of remediation/);
  assert.match(PROPOSED_MET, /awaiting human review/);
});

test('an open exception caps "no exception found" at inconclusive', () => {
  const e = clone(recorded.effective_summaries[1]);
  e.summary.conclusion = 'no_exception_found';
  e.conclusion = 'no_exception_found';
  assert.throws(() => parseEffective(e), /Invalid/, 'open exceptions remain');
});

test('a disposition is a closure with evidence or a reopening', () => {
  const closed = recorded.exceptions[2].disposition;
  assert.deepEqual(parseExceptionDisposition(closed), closed);
  const reopened = { ...clone(closed), kind: 'reopened', references: [] };
  assert.deepEqual(parseExceptionDisposition(reopened), reopened);
  assert.throws(() => parseExceptionDisposition({ ...closed, kind: 'waived' }), /Invalid/, 'no waiver');
  assert.throws(() => parseExceptionDisposition({ ...closed, rationale: 'é'.repeat(1001) }), /Invalid/, 'over 2,000 bytes');
});

test('a detail page names its own exception and its occurrences', () => {
  const exception = clone(recorded.exceptions[3]);
  const detail = {
    exception,
    occurrences: [{ source_kind: 'evaluation', source_id: 'eval-1', population_id: null, member_ordinal: null, criterion_id: 'crit-2', basis_id: 'basis-1', origin: 'model_proposal', evidence: ['0'.repeat(64)], source_us: '1', seq: '1' }],
    dispositions: [exception.disposition],
    next_cursor: null,
  };
  assert.deepEqual(parseDetail(detail, exception.id), detail);
  assert.throws(() => parseDetail(detail, 'exc-' + 'f'.repeat(40)), /Invalid/, 'another exception');
  const human = clone(detail);
  human.occurrences[0].origin = 'human';
  assert.throws(() => parseDetail(human, exception.id), /Invalid/, 'a human occurrence is a person\'s verdict');
  const unordered = clone(detail);
  unordered.occurrences.push({ ...unordered.occurrences[0], source_id: 'eval-2', seq: '1' });
  assert.throws(() => parseDetail(unordered, exception.id), /Invalid/, 'occurrences in their order');
  const partial = clone(detail);
  partial.next_cursor = '1';
  assert.throws(() => parseDetail(partial, exception.id), /Invalid/, 'a next page only after a full page');
  parseEffective(recorded.effective_summaries[0]);
});

test('the words name statuses and refusals', () => {
  assert.equal(statusLabel.closed_by_disposition, 'Closed by disposition');
  assert.match(errorLabel.exception_close_forbidden, /Audit manager or the Task's accountable person/);
  assert.match(errorLabel.exception_disposition_invalid, /at least one evidence reference/);
  assert.equal(rationaleBytes('é'), 2);
});
