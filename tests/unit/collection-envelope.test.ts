import { describe, expect, it } from 'vitest';

import { COLLECTION_ENVELOPE_KEYS, isCompleteCollectionEnvelope } from '@intellifin/domain';

import { handleRequest } from '../../apps/northstar/src/server.js';
import { ROUTES } from '../../apps/northstar/src/routes.js';

/**
 * The closed v1 collection envelope, against the bytes a synthetic system really serves.
 *
 * `COLLECTION_ENVELOPE_KEYS` decides two things: whether Story 3.2 accepts an API
 * population as a complete extraction, and whether Story 3.4 will believe a `found =
 * false` Observation from one. A key the server sends and the list does not name makes
 * every real response "not provably complete", and every absence from it `UNINSPECTED`.
 *
 * That is not hypothetical: the list was briefly written twice, and the second copy left
 * out `synthetic` — the NFR-13 marker EVERY Northstar response carries. Every unit and
 * integration fixture agreed with the copy, because the fixtures were written beside it,
 * so three suites stayed green while the real served bytes were judged incomplete. Only
 * the browser suite, four and a half minutes in, could see it.
 *
 * This is that check in one second. It reads the real handler rather than a fixture, so a
 * key added to `collection()` in `apps/northstar/src/apis.ts` fails here and not in a
 * Run.
 */

const permitted = new Set<string>(COLLECTION_ENVELOPE_KEYS);

/** Every route that answers a collection: the ones a Run's adapter actually extracts. */
const COLLECTIONS = ROUTES.filter((route) => /\/(accounts|approvals|transactions|employees)$/.test(route.probe));

describe('the closed collection envelope against the served bytes', () => {
  it('covers every collection route the synthetic systems serve', () => {
    // Four adapter-extractable collections: AccessGate, ApproveNow, LedgerFlow, PeopleHub.
    expect(COLLECTIONS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(COLLECTIONS.map((route) => [route.probe, route] as const))(
    'serves %s inside the closed envelope, and declares itself complete',
    (probe) => {
      const response = handleRequest('GET', probe);
      expect(response.status).toBe(200);
      const body = JSON.parse(String(response.body)) as Record<string, unknown>;
      const unknown = Object.keys(body).filter((key) => !permitted.has(key));
      expect(unknown).toEqual([]);
      // The envelope's own verdict, which is what both stages read.
      expect(isCompleteCollectionEnvelope(body)).toBe(true);
      // `returned` is the row count THIS response carries, and the adapter compares it
      // with the rows it parsed. A response that reports a different number is not
      // provably complete however many keys it names.
      const collection = Object.keys(body).find((key) =>
        ['accounts', 'approvals', 'transactions', 'employees'].includes(key),
      );
      expect(collection).toBeDefined();
      expect(body['returned']).toBe((body[collection!] as unknown[]).length);
    },
  );

  it('refuses an envelope carrying a continuation marker', () => {
    const response = handleRequest('GET', COLLECTIONS[0]!.probe);
    const body = JSON.parse(String(response.body)) as Record<string, unknown>;
    expect(isCompleteCollectionEnvelope({ ...body, next_cursor: 'page-2' })).toBe(false);
    expect(isCompleteCollectionEnvelope({ ...body, complete: false })).toBe(false);
  });
});
