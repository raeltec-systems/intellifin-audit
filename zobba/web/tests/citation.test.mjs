import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boundedQuote, chipLabel, parseAnswer, parseAnswers, parseSource, reasonLabel, splitAtBytes } from '../src/citation.ts';

const verified = {
  original_id: 'trial-balance', readable: true, filename: 'Trial balance.xlsx', version: 'v1', sha256: 'a'.repeat(64),
  locator: 'cell:Sheet1!B4', location: 'Sheet1!B4', byte_start: null, byte_end: null, quote: '1,250.00', verification: 'verified', reason: null,
};
const hidden = {
  original_id: 'contract-pdf', readable: false, filename: null, version: null, sha256: null,
  locator: null, location: null, byte_start: null, byte_end: null, quote: null, verification: 'unverified', reason: 'page_only',
};
const answer = {
  invocation_id: 'inv-a', text: 'The balance is 1,250.00. Uncited.',
  segments: [{ text: 'The balance is 1,250.00.', sources: [verified, hidden] }, { text: ' Uncited.', sources: [] }],
  limitations: ['Page 3 of the scan could not be read.'],
  verification_failed: false,
};

test('a cited answer is strictly parsed and its segments are exactly its unchanged text', () => {
  assert.deepEqual(parseAnswer(answer), answer);
  assert.deepEqual(parseAnswers({ answers: [answer] }), { answers: [answer], skipped: 0 });
  assert.throws(() => parseAnswer({ ...answer, text: 'Edited.' }), 'segments must join to the text');
  assert.throws(() => parseAnswer({ ...answer, segments: [] }));
  assert.throws(() => parseAnswer({ ...answer, verification_failed: undefined }));
  assert.deepEqual(parseAnswers({ answers: [answer, answer] }), { answers: [answer], skipped: 1 }, 'duplicate invocation');
  assert.throws(() => parseAnswers({ answers: 'none' }));
});

test('one malformed answer is skipped and counted, never hiding the others', () => {
  const other = { ...answer, invocation_id: 'inv-b' };
  const parsed = parseAnswers({ answers: [answer, { ...answer, invocation_id: 'inv-c', text: 'Edited.' }, other] });
  assert.deepEqual(parsed, { answers: [answer, other], skipped: 1 });
});

test('the exact API JSON produced by the worker integration test parses', () => {
  const body = JSON.parse(readFileSync(new URL('./fixtures/task-answers.json', import.meta.url), 'utf8'));
  const parsed = parseAnswers(body);
  assert.equal(parsed.skipped, 0);
  assert.deepEqual(parsed.answers, body.answers, 'every field is kept exactly');
  assert.equal(parsed.answers.length, 2, 'intermediate reading turns are not answers');
  const sources = parsed.answers[1].segments.flatMap(segment => segment.sources);
  assert.ok(sources.some(source => source.verification === 'verified'));
  assert.ok(sources.some(source => source.reason === 'page_only'));
  const hiddenSource = sources.find(source => !source.readable);
  assert.ok(hiddenSource && hiddenSource.quote === null && hiddenSource.location === null);
});

test('a failed verification shows every source unchecked and discloses no original', () => {
  const unchecked = { ...hidden, original_id: 'trial-balance', verification: 'unchecked', reason: null };
  const failed = { ...answer, segments: [{ text: 'The balance is 1,250.00.', sources: [unchecked] }, { text: ' Uncited.', sources: [] }], verification_failed: true };
  assert.deepEqual(parseAnswer(failed), failed);
  assert.throws(() => parseAnswer({ ...failed, verification_failed: false }), 'an unchecked source belongs to a failed verification');
  assert.throws(() => parseAnswer({ ...answer, verification_failed: true }), 'a failed verification checked nothing');
  assert.throws(() => parseSource({ ...unchecked, readable: true }));
  assert.throws(() => parseSource({ ...unchecked, reason: 'page_only' }));
});

test('every closed verification result parses, and nothing else does', () => {
  for (const reason of ['not_found_at_location', 'location_missing', 'source_unreadable', 'page_only']) {
    assert.equal(parseSource({ ...verified, verification: 'unverified', reason }).reason, reason);
    assert.ok(reasonLabel[reason]);
  }
  for (const bad of [
    { ...verified, verification: 'unverified', reason: null },
    { ...verified, reason: 'page_only' },
    { ...verified, verification: 'unverified', reason: 'low_confidence' },
    { ...verified, verification: 'probably' },
    { ...verified, confidence: undefined, quote: 'x'.repeat(1001) },
    { ...verified, locator: null },
    { ...verified, byte_start: 3, byte_end: null },
    { ...verified, byte_start: 4, byte_end: 4 },
  ]) assert.throws(() => parseSource(bad), JSON.stringify(bad));
  assert.equal(parseSource({ ...verified, locator: null, location: null, verification: 'unverified', reason: 'location_missing' }).location, null);
});

test('a source the viewer cannot read discloses no quote, filename or version', () => {
  assert.equal(parseSource(hidden).quote, null);
  for (const leak of [{ quote: 'Payment is due' }, { filename: 'Contract.pdf' }, { version: 'v1' }, { sha256: 'b'.repeat(64) },
    { locator: 'page:2', location: 'Page 2' }, { byte_start: 1, byte_end: 2 }]) {
    assert.throws(() => parseSource({ ...hidden, ...leak }), JSON.stringify(leak));
  }
  assert.throws(() => parseSource({ ...verified, quote: null }), 'a readable source carries its quote');
  assert.equal(parseSource({ ...verified, filename: null }).filename, null, 'a filename may be unrecorded');
});

test('a cited filename follows the evidence filename bound', () => {
  const name = `${'é'.repeat(125)}.xlsx`;
  assert.equal(parseSource({ ...verified, filename: name }).filename, name);
  assert.throws(() => parseSource({ ...verified, filename: `${'é'.repeat(126)}.xlsx` }), 'beyond 255 bytes');
  assert.throws(() => parseSource({ ...verified, filename: 'bad\u0007name.xlsx' }));
});

test('the chip shows the short first filename and +N for further sources', () => {
  assert.deepEqual(chipLabel([verified, hidden]), { label: 'Trial balance.xlsx', more: 1 });
  assert.deepEqual(chipLabel([hidden]), { label: 'Source', more: 0 });
  const long = { ...verified, filename: 'A very long working paper filename.xlsx' };
  assert.equal(chipLabel([long]).label, 'A very long working pap…');
  assert.equal([...boundedQuote('é'.repeat(400))].length, 280);
  assert.equal(boundedQuote('short'), 'short');
});

test('a cited byte range is marked only when it lies wholly in the preview on character boundaries', () => {
  const text = 'Opening balance 1,250.00 agreed to the ledger.\n';
  assert.deepEqual(splitAtBytes(text, 16, 24), ['Opening balance ', '1,250.00', ' agreed to the ledger.\n']);
  assert.equal(splitAtBytes(text, 16, 999), null);
  assert.equal(splitAtBytes('﻿é', 3, 4), null, 'inside a character');
  assert.deepEqual(splitAtBytes('﻿é', 3, 5), ['﻿', 'é', '']);
});
