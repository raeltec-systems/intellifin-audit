import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AccessError } from '../src/auth.ts';
import { discardAcquisitionDraft, downloadEvidence, evidenceAudience, evidenceSearchQuery, listEvidence, measureFile, parseEvidence, parseReservationRequest,
  previewEvidence, recoverAcquisitionDraft, ReservationLimitError, reserveEvidence, safeFilename, saveAcquisitionDraft, trimEvidenceWhitespace } from '../src/evidence.ts';
const scope = { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' };
const session = { identity: { id: 'actor-a', display_name: 'Auditor A' }, csrf_token: 'session-a' };
const engagement = { ...scope, organisation_name: 'Northstar', client_name: 'Alder', engagement_name: 'FY2026 audit', roles: ['auditor'] };
const file = new File(['inert original\n'], 'original.txt');
const identity = await measureFile(file);
const request = { key: 'request-a', filename: file.name, identity, source: { system: 'Asserted ledger', account: null, source_version: null, selection: null, coverage: null } };
const reservation = { id: 'evidence-a', actor_id: session.identity.id, scope, request, reserved_at: 1800000000 };
const evidence = { reservation, version: 'opaque-v1', registered_at: 1800000001 };
const signal = () => new AbortController().signal;
// The Rust API contract test expands this same matrix against its domain validator.
const metadataParity = JSON.parse(readFileSync(new URL('../../tests/fixtures/evidence-metadata-parity.json', import.meta.url), 'utf8'));
function metadataCases(maxBytes) {
  const cases = [...metadataParity.literals];
  for (const group of metadataParity.characters) {
    const codepoints = [...group.codepoints, ...group.ranges.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, index) => first + index))];
    for (const point of codepoints) {
      const character = String.fromCodePoint(point);
      const positions = { leading: `${character}metadata`, trailing: `metadata${character}`, internal: `meta${character}data`, alone: character };
      for (const position of group.positions) cases.push({ ...group, name: `${group.name}-U+${point.toString(16)}-${position}`, value: positions[position] });
    }
  }
  for (const boundary of metadataParity.byte_boundaries) {
    for (const extra of [0, 1]) {
      const remaining = maxBytes + extra - Buffer.byteLength(boundary.prefix + boundary.suffix);
      const unitBytes = Buffer.byteLength(boundary.unit);
      const value = boundary.prefix + boundary.unit.repeat(Math.floor(remaining / unitBytes)) + 'a'.repeat(remaining % unitBytes) + boundary.suffix;
      assert.equal(Buffer.byteLength(value), maxBytes + extra);
      cases.push({ name: `${boundary.name}-${maxBytes + extra}-bytes`, value, filename_valid: extra === 0, source_valid: extra === 0 });
    }
  }
  return cases;
}
for (const [field, maxBytes] of Object.entries(metadataParity.fields)) {
  test(`shared Rust/browser Unicode metadata parity preserves ${field} and recovery exactly`, async context => {
    const values = new Map();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
    context.after(() => { delete globalThis.sessionStorage; });
    const audience = await evidenceAudience(session, scope);
    const cases = metadataCases(maxBytes), failures = [];
    for (const entry of cases) {
      const label = `${field}: ${entry.name}`;
      const candidate = field === 'filename' ? { ...request, filename: entry.value } : { ...request, source: { ...request.source, [field]: entry.value } };
      const draft = { audience, request: candidate, reservationId: reservation.id };
      try {
        if (field === 'filename' ? entry.filename_valid : entry.source_valid) {
          const originalRequest = structuredClone(candidate);
          assert.deepEqual(parseReservationRequest(candidate), originalRequest, label);
          const item = { ...evidence, reservation: { ...reservation, request: candidate } };
          assert.deepEqual(parseEvidence(item, scope), item, label);
          for (const reservationId of [null, reservation.id]) {
            const expected = { ...draft, request: originalRequest, reservationId };
            saveAcquisitionDraft(structuredClone(expected));
            assert.deepEqual(JSON.parse([...values.values()][0]), expected, label);
            assert.deepEqual(recoverAcquisitionDraft(audience), expected, label);
          }
        } else {
          assert.throws(() => parseReservationRequest(candidate), label);
          assert.throws(() => saveAcquisitionDraft(draft), label);
          values.set('zobba.evidence-draft.v1', JSON.stringify(draft));
          assert.equal(recoverAcquisitionDraft(audience), null, label);
          assert.equal(values.size, 0, label);
        }
      } catch (error) { failures.push(`${label}: ${error.message}`); }
      values.clear();
    }
    assert.deepEqual(failures, [], `${field}: all ${cases.length} shared cases executed`);
  });
}
test('new evidence input trims Unicode White_Space while preserving FEFF and internal values', () => {
  const whitespace = metadataParity.characters.find(group => group.name === 'Unicode-White_Space').codepoints;
  for (const point of whitespace) {
    const character = String.fromCodePoint(point);
    assert.equal(trimEvidenceWhitespace(`${character}\ufeffmetadata\ufeff${character}`), '\ufeffmetadata\ufeff', `U+${point.toString(16)}`);
  }
  assert.equal(trimEvidenceWhitespace(String.fromCodePoint(...whitespace)), '');
  assert.equal(trimEvidenceWhitespace(' \ufeff '), '\ufeff');
  assert.equal(trimEvidenceWhitespace('\u0000metadata\u0000'), '\u0000metadata\u0000');
  for (const entry of metadataParity.literals) {
    if (entry.source_valid && entry.value !== null) assert.equal(trimEvidenceWhitespace(entry.value), entry.value, entry.name);
  }
});
function authorizedFetch(context, first, current = session) {
  context.mock.method(globalThis, 'fetch', async (path, init) => {
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store');
    if (path === '/api/auth/session') return Response.json(current);
    assert.equal(init.headers['X-Expected-Session'], session.csrf_token);
    if (/\/engagements\/engagement-a\?/.test(path)) return Response.json(engagement);
    return first(path, init);
  });
}
test('evidence parser binds scope, immutable identity and non-null version without propagating private fields', () => {
  assert.deepEqual(parseEvidence({ ...evidence, storage_key: 'private' }, scope), evidence);
  for (const value of [ { ...evidence, version: 'null' }, { ...evidence, version: '' }, { ...evidence, reservation: { ...reservation, scope: { ...scope, client_id: 'foreign' } } } ]) assert.throws(() => parseEvidence(value, scope));
  for (const change of [{ filename: '../unsafe' }, { filename: ' a' }, { identity: { ...identity, size: 10 * 1024 * 1024 + 1 } }, { identity: { ...identity, sha256: 'x'.repeat(64) } }, { source: { ...request.source, coverage: 'x'.repeat(2001) } }]) assert.throws(() => parseReservationRequest({ ...request, ...change }));
});
test('reservation retry sends unchanged attributed payload and enforces the expected session', async context => {
  const bodies = [];
  authorizedFetch(context, (_path, init) => {
    assert.equal(init.method, 'POST'); assert.equal(init.headers['X-CSRF-Token'], session.csrf_token);
    bodies.push(init.body); return Response.json(reservation);
  });
  assert.deepEqual(await reserveEvidence(scope, session, request, signal()), reservation);
  assert.deepEqual(await reserveEvidence(scope, session, request, signal()), reservation);
  assert.equal(bodies[0], bodies[1]); assert.deepEqual(JSON.parse(bodies[0]), request);
});
test('completed metadata is refused after account or same-actor session replacement', async context => {
  for (const current of [{ ...session, csrf_token: 'replacement-session' }, { identity: { id: 'actor-b', display_name: 'Other' }, csrf_token: 'other-session' }]) {
    authorizedFetch(context, () => Response.json({ items: [evidence], next_cursor: null, storage_configured: true }), current);
    await assert.rejects(listEvidence(scope, session, signal()), error => error instanceof AccessError && error.status === 412);
    context.mock.restoreAll();
  }
});
test('authenticated download verifies bounded actual bytes and content identity before disclosure', async context => {
  authorizedFetch(context, () => new Response(file));
  assert.equal(await (await downloadEvidence(scope, session, evidence, signal())).text(), await file.text());
  context.mock.restoreAll();
  for (const bytes of ['corrupt bytes!!', 'short', 'x'.repeat(identity.size + 1)]) {
    authorizedFetch(context, () => new Response(bytes));
    await assert.rejects(downloadEvidence(scope, session, evidence, signal())); context.mock.restoreAll();
  }
});
test('completed download bytes remain fenced across same-actor session replacement', async context => {
  authorizedFetch(context, () => new Response(file), { ...session, csrf_token: 'new-session' });
  await assert.rejects(downloadEvidence(scope, session, evidence, signal()), error => error instanceof AccessError && error.status === 412);
});
test('browser recovery retains exact reservation only for the same session and composite scope', async context => {
  const values = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  context.after(() => { delete globalThis.sessionStorage; });
  const audience = await evidenceAudience(session, scope), draft = { audience, request, reservationId: reservation.id };
  saveAcquisitionDraft(draft); assert.deepEqual(recoverAcquisitionDraft(audience), draft);
  assert.match(audience, /^[0-9a-f]{64}$/); assert.ok(![...values.values()][0].includes(session.csrf_token));
  assert.equal(recoverAcquisitionDraft(await evidenceAudience({ ...session, csrf_token: 'changed' }, scope)), null); assert.equal(values.size, 0);
  saveAcquisitionDraft(draft); assert.equal(recoverAcquisitionDraft(await evidenceAudience(session, { ...scope, client_id: 'foreign' })), null);
  saveAcquisitionDraft(draft); discardAcquisitionDraft(); assert.equal(values.size, 0);
});
test('download filename strips path and header controls', () => {
  assert.equal(safeFilename('../unsafe\\name\r\n.txt'), '_unsafe_name__.txt');
  assert.equal(safeFilename('...'), 'evidence-original');
  for (const [input, expected] of [
    ['a'.repeat(200) + '.csv', 'a'.repeat(116) + '.csv'], ['Résumé.tsv', 'R_sum_.tsv'], ['😺.txt', '_.txt'],
    ['x'.repeat(119) + '.' + 'z'.repeat(21), 'x'.repeat(119)], ['...a.csv...', 'a.csv'],
  ]) assert.equal(safeFilename(input), expected);
});

test('maximum valid escaped assertions retain their exact immutable recovery envelope', async context => {
  const values = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  context.after(() => { delete globalThis.sessionStorage; });
  const audience = await evidenceAudience(session, scope);
  for (const escaped of ['"'.repeat(2000), '\\'.repeat(2000)]) {
    const maximum = { ...request, filename: '"'.repeat(255), source: Object.fromEntries(Object.keys(request.source).map(key => [key, escaped])) };
    const draft = { audience, request: maximum, reservationId: 'r'.repeat(128) };
    saveAcquisitionDraft(draft); assert.ok([...values.values()][0].length > 20_000);
    assert.deepEqual(recoverAcquisitionDraft(audience), draft);
  }
  values.clear();
  assert.throws(() => saveAcquisitionDraft({ audience, request: { ...request, source: { ...request.source, system: '界'.repeat(1000) } }, reservationId: null }));
  assert.equal(values.size, 0);
});

test('durable reservation quota is distinguished from conflict and transient I/O capacity', async context => {
  for (const [status, body, quota] of [[409, { error: 'evidence_reservation_limit' }, true], [409, { error: 'evidence_conflict' }, false], [429, { error: 'evidence_capacity' }, false]]) {
    authorizedFetch(context, () => Response.json(body, { status }));
    await assert.rejects(reserveEvidence(scope, session, request, signal()), error => error instanceof AccessError && error.status === status && (error instanceof ReservationLimitError) === quota);
    context.mock.restoreAll();
  }
  authorizedFetch(context, () => new Response('{"error":"evidence_reservation_limit","padding":"' + 'x'.repeat(5000) + '"}', { status: 409 }));
  await assert.rejects(reserveEvidence(scope, session, request, signal()), error => error instanceof AccessError && !(error instanceof ReservationLimitError));
});

test('bounded evidence pages validate ordered examined-prefix continuation and explicit coverage', async context => {
  const items = Array.from({ length: 50 }, (_, index) => ({ ...evidence, reservation: { ...reservation, id: `evidence-${String(index).padStart(2, '0')}` } }));
  const valid = { items, next_cursor: 'evidence-49', storage_configured: false, query: '', coverage: { examined_count: 50, candidate_limit: 256, complete: false } };
  authorizedFetch(context, () => Response.json(valid));
  assert.deepEqual(await listEvidence(scope, session, signal()), valid); context.mock.restoreAll();
  for (const value of [{ ...valid, items: [...items, evidence] }, { ...valid, items: [...items].reverse() }, { ...valid, next_cursor: 'evidence-48' }, { items, next_cursor: 'evidence-49' }]) {
    authorizedFetch(context, () => Response.json(value)); await assert.rejects(listEvidence(scope, session, signal())); context.mock.restoreAll();
  }
});

test('source search preserves Unicode, uses UTF-8 bounds and canonical query equality', async context => {
  for (const [input, expected] of [['\u2000Résumé\u3000', 'Résumé'], ['\ufeff', '\ufeff'], ['界'.repeat(66) + 'aa', '界'.repeat(66) + 'aa'], ['internal\u2028value', 'internal\u2028value']]) assert.equal(evidenceSearchQuery(input), expected);
  for (const input of ['界'.repeat(67), '\nsearch', 'search\r', 'text\u0085', '\u0000']) assert.throws(() => evidenceSearchQuery(input));
  const result = { items: [evidence], next_cursor: null, storage_configured: true, query: 'Résumé', coverage: { examined_count: 1, candidate_limit: 256, complete: true } };
  authorizedFetch(context, path => { assert.equal(new URL(path, 'https://example.test').searchParams.get('q'), 'Résumé'); return Response.json(result); });
  assert.deepEqual(await listEvidence(scope, session, signal(), undefined, '\u2000Résumé\u3000'), result);
  context.mock.restoreAll();
  authorizedFetch(context, () => Response.json({ ...result, query: 'different' }));
  await assert.rejects(listEvidence(scope, session, signal(), undefined, 'Résumé'));
});

test('sparse and empty search pages can continue only through a valid examined prefix', async context => {
  const empty = { items: [], next_cursor: 'evidence-z', storage_configured: true, query: 'needle', coverage: { examined_count: 256, candidate_limit: 256, complete: false } };
  for (const valid of [empty, { ...empty, items: [evidence] }, { ...empty, next_cursor: null, coverage: { ...empty.coverage, complete: true } }]) {
    authorizedFetch(context, () => Response.json(valid));
    assert.deepEqual(await listEvidence(scope, session, signal(), undefined, 'needle'), valid); context.mock.restoreAll();
  }
  for (const invalid of [
    { ...empty, next_cursor: null }, { ...empty, coverage: { ...empty.coverage, complete: true } },
    { ...empty, coverage: { ...empty.coverage, examined_count: 257 } }, { ...empty, coverage: { ...empty.coverage, examined_count: 0 } },
    { ...empty, coverage: { ...empty.coverage, candidate_limit: 1024 } }, { ...empty, coverage: undefined },
    { ...empty, items: [evidence], next_cursor: 'evidence-0' },
  ]) { authorizedFetch(context, () => Response.json(invalid)); await assert.rejects(listEvidence(scope, session, signal(), undefined, 'needle')); context.mock.restoreAll(); }
  authorizedFetch(context, () => Response.json(empty));
  await assert.rejects(listEvidence(scope, session, signal(), 'evidence-z', 'needle'));
});


test('plain-text preview refuses more than 100 lines or 64 KiB before rendering', async context => {
  const valid = { kind: 'plain_text', text: Array(100).fill('line').join('\n'), truncated: true };
  authorizedFetch(context, () => Response.json(valid));
  assert.deepEqual(await previewEvidence(scope, session, reservation.id, signal()), valid); context.mock.restoreAll();
  for (const text of [Array(101).fill('line').join('\n'), '界'.repeat(22000)]) {
    authorizedFetch(context, () => Response.json({ ...valid, text }));
    await assert.rejects(previewEvidence(scope, session, reservation.id, signal())); context.mock.restoreAll();
  }
});
