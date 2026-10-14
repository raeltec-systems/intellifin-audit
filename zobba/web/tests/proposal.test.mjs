import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { citationsFor, parseProposal, proposalCommand, validDocument, validLabel } from '../src/proposal.ts';
import { parseSaveMethodology } from '../src/methodology.ts';

const real = JSON.parse(readFileSync(new URL('./fixtures/methodology-proposal.json', import.meta.url), 'utf8'));

test('the API proposal fixture parses unchanged and every kept field is cited', () => {
  assert.deepEqual(parseProposal(real), real);
  assert.equal(real.status, 'drafted');
  assert.equal(real.source.kind, 'imported_proposal');
  assert.deepEqual(real.missing_criteria, ['AP-2']);
  assert.equal(citationsFor(real, 'requirements[0].criteria[0]')[0].quote, 'Payments over 10,000 have two approvals.');
});

test('a proposal that claims more than it cites, or claims authorship, is refused', () => {
  for (const bad of [
    { ...real, citations: real.citations.filter(c => c.field !== 'requirements[0].criteria[0]') },
    { ...real, citations: real.citations.filter(c => c.field !== 'requirements[1].label') },
    { ...real, source: { ...real.source, kind: 'authored' } },
    { ...real, missing_criteria: ['AP-9'] },
    { ...real, status: 'failed', reason: 'model_unavailable' },
    { ...real, status: 'uncertain' },
    { ...real, citations: [{ ...real.citations[0], location: { start: '5', end: '5', line: '1' } }, ...real.citations.slice(1)] },
    { ...real, disclosure: { ...real.disclosure, media_type: 'application/pdf' } },
  ]) assert.throws(() => parseProposal(bad));
  const uncertain = { ...real, status: 'uncertain', definition: null, source: null, citations: [], conflicts: [], missing_criteria: [], unverified: [] };
  assert.equal(parseProposal(uncertain).status, 'uncertain');
  assert.equal(parseProposal({ ...uncertain, status: 'in_progress' }).status, 'in_progress');
});

test('client bounds equal the server bounds, in bytes and code points', () => {
  // A quote is at most 2,000 UTF-8 bytes, not 2,000 characters.
  const quote = 'é'.repeat(1000);
  assert.equal(parseProposal({ ...real, citations: [{ ...real.citations[0], quote }, ...real.citations.slice(1)] }).citations[0].quote, quote);
  assert.throws(() => parseProposal({ ...real, citations: [{ ...real.citations[0], quote: quote + 'é' }, ...real.citations.slice(1)] }));
  // A file name is a label of at most 200 code points.
  assert.ok(validLabel('\u{1F600}'.repeat(200)));
  assert.ok(!validLabel('\u{1F600}'.repeat(201)));
  assert.ok(!validLabel('a\u0007b'));
  assert.ok(validDocument('# Method\n\tline\r\n'));
  assert.ok(!validDocument('   '));
  assert.ok(!validDocument('bad\u0000'));
  assert.ok(!validDocument('é'.repeat(100_001)), '200,002 bytes is over the byte limit');
});

test('the editor receives a new command that only the ordinary Save can apply', () => {
  const command = proposalCommand(real, '3', 'key-1');
  assert.deepEqual(parseSaveMethodology(command), command);
  assert.equal(command.supersedes, null);
  assert.equal(command.expected_revision, '3');
  assert.equal(command.source.kind, 'imported_proposal');
  command.definition.requirements[0].criteria.push('edited');
  assert.equal(real.definition.requirements[0].criteria.length, 1, 'editing never changes the proposal');
  assert.throws(() => proposalCommand({ ...real, status: 'failed' }, '3', 'k'));
});
