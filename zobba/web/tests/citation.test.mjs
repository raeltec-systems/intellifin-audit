import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedQuote, chipLabel, parseAnswer, parseAnswers, parseSource, reasonLabel, splitAtBytes } from '../src/citation.ts';

const verified = {
  original_id: 'trial-balance', readable: true, filename: 'Trial balance.xlsx', version: 'v1', sha256: 'a'.repeat(64),
  locator: 'cell:Sheet1!B4', location: 'Sheet1!B4', byte_start: null, byte_end: null, quote: '1,250.00', verification: 'verified', reason: null,
};
const hidden = {
  original_id: 'contract-pdf', readable: false, filename: null, version: null, sha256: null,
  locator: 'page:2', location: 'Page 2', byte_start: null, byte_end: null, quote: null, verification: 'unverified', reason: 'page_only',
};
const answer = {
  invocation_id: 'inv-a', text: 'The balance is 1,250.00. Uncited.',
  segments: [{ text: 'The balance is 1,250.00.', sources: [verified, hidden] }, { text: ' Uncited.', sources: [] }],
  limitations: ['Page 3 of the scan could not be read.'],
};

test('a cited answer is strictly parsed and its segments are exactly its unchanged text', () => {
  assert.deepEqual(parseAnswer(answer), answer);
  assert.deepEqual(parseAnswers({ answers: [answer] }), [answer]);
  assert.throws(() => parseAnswer({ ...answer, text: 'Edited.' }), 'segments must join to the text');
  assert.throws(() => parseAnswer({ ...answer, segments: [] }));
  assert.throws(() => parseAnswers({ answers: [answer, answer] }), 'duplicate invocation');
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
  for (const leak of [{ quote: 'Payment is due' }, { filename: 'Contract.pdf' }, { version: 'v1' }, { sha256: 'b'.repeat(64) }]) {
    assert.throws(() => parseSource({ ...hidden, ...leak }), JSON.stringify(leak));
  }
  assert.throws(() => parseSource({ ...verified, quote: null }), 'a readable source carries its quote');
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
