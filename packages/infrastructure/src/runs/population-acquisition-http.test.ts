import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHmac } from 'node:crypto';
import { canonicalJson, type JsonValue } from '@intellifin/domain';

import { PopulationAcquisitionError } from '@intellifin/application';
import type { ExplicitPeriod, ProcedureSourceSnapshot } from '@intellifin/domain';

import {
  HttpPopulationAcquisition,
  POPULATION_ACQUISITION_MAX_BYTES,
} from './population-acquisition-http.js';

const period: ExplicitPeriod = { from: '2026-01-01', to: '2026-01-31' };
const coverFixture = JSON.parse(readFileSync(new URL('../../../../fixtures/northstar/generated/leavers-export.cover-sheet.json', import.meta.url), 'utf8')) as Record<string, unknown>;

function resign(cover: Record<string, unknown>): void {
  const fields = ['source','covers','generation','generated_at','effective_period','complete','row_count','declared_schema','content_digest','format'];
  cover['signature'] = { scheme: 'synthetic-hmac-sha256', key_id: 'northstar-cover-sheet-2026', key_is_published: true,
    value: createHmac('sha256', 'northstar-synthetic-cover-sheet-key-2026').update(canonicalJson(Object.fromEntries(fields.map(key => [key, cover[key]])) as JsonValue)).digest('hex') };
}

function source(
  kind: 'versioned-file' | 'read-only-api',
  location: string,
  declaredCountMechanism: 'cover-sheet' | 'count-endpoint' | 'none' = kind === 'versioned-file' ? 'cover-sheet' : 'count-endpoint',
): ProcedureSourceSnapshot {
  return {
    bindingId: '018f0000-0000-7000-8000-000000000001',
    displayName: 'Synthetic source',
    digest: '0'.repeat(64),
    contract: {
      kind,
      location,
      declared_schema: ['id'],
      declared_count_mechanism: declaredCountMechanism,
      sensitive_fields: [],
    },
  };
}

function response(body: string, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('HttpPopulationAcquisition', () => {
  it('GETs the frozen CSV and its same-origin cover sheet as independent declarations', async () => {
    const calls: Request[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push(request);
      if (request.url.endsWith('/leavers-export.csv')) return response('id\nE-1\n', 'text/csv; charset=utf-8');
      return response(JSON.stringify(coverFixture), 'application/json; charset=utf-8');
    });
    const result = await new HttpPopulationAcquisition({ fetch }).acquire(
      source('versioned-file', 'https://source.example.test/files/leavers-export.csv'),
      period,
      1000,
    );

    expect(new TextDecoder().decode(result.bytes)).toBe('id\nE-1\n');
    expect(result.mediaType).toBe('text/csv');
    expect(result.declaration).toMatchObject({ representation: 'csv-raw-v1' });
    expect(calls.map((call) => call.url)).toEqual([
      'https://source.example.test/files/leavers-export.csv',
      'https://source.example.test/files/leavers-export.cover-sheet.json',
    ]);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(calls.every((call) => call.redirect === 'error')).toBe(true);
    expect(calls.every((call) => call.headers.get('accept-encoding') === 'identity')).toBe(true);
  });

  it.each(['missing signature', 'bad signature', 'tampered declaration', 'wrong algorithm'])('retains primary bytes and rejects %s', async mode => {
    const cover = structuredClone(coverFixture);
    if (mode === 'missing signature') delete cover['signature'];
    if (mode === 'bad signature') (cover['signature'] as Record<string, unknown>)['value'] = '0'.repeat(64);
    if (mode === 'tampered declaration') cover['row_count'] = 999;
    if (mode === 'wrong algorithm') { (cover['content_digest'] as Record<string, unknown>)['algorithm'] = 'md5'; resign(cover); }
    const fetch = vi.fn(async (input: string | URL | Request) => String(input).endsWith('.csv') ? response('id\n1\n', 'text/csv') : response(JSON.stringify(cover), 'application/json'));
    const result = await new HttpPopulationAcquisition({ fetch }).acquire(source('versioned-file', 'https://source.example.test/leavers-export.csv'), period, 1000);
    expect(new TextDecoder().decode(result.bytes)).toBe('id\n1\n');
    expect(result.declaration).toBeNull();
  });

  it.each([null, 'application/octet-stream', 'text/csv; charset=latin1', 'text/csv; charset'])('preserves unsupported primary media %s for a failed parse with Evidence', async media => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([0, 255, 1]), { headers: media === null ? {} : { 'content-type': media } }));
    const result = await new HttpPopulationAcquisition({ fetch }).acquire(source('versioned-file', 'https://source.example.test/rows.csv', 'none'), period, 1000);
    expect([...result.bytes]).toEqual([0, 255, 1]);
    expect(result.mediaType).not.toBe('text/csv');
  });

  it('preserves Fetch-decoded gzip bytes despite the compressed Content-Length', async () => {
    const plain = 'id\n' + 'row\n'.repeat(100);
    const compressed = gzipSync(plain);
    const server = createServer((_request, reply) => { reply.writeHead(200, { 'content-type': 'text/csv', 'content-encoding': 'gzip', 'content-length': compressed.length }); reply.end(compressed); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing server address');
      const frozen = source('versioned-file', `http://127.0.0.1:${address.port}/rows.csv`, 'none');
      const result = await new HttpPopulationAcquisition().acquire(frozen, period, 3000);
      expect(new TextDecoder().decode(result.bytes)).toBe(plain);
      await expect(new HttpPopulationAcquisition({ maxBytes: 100 }).acquire(frozen, period, 3000)).rejects.toMatchObject({ code: 'integrity' });
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('uses only the API payload’s frozen same-path count endpoint for a declaration', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith('/count')) {
        return response(JSON.stringify({ schema_version: 1, representation: 'population-rows-v1', count: 1 }), 'application/json');
      }
      return response(JSON.stringify({
        source: 'peoplehub',
        declared_count_endpoint: '/peoplehub/employees/count',
        employees: [{ id: 'E-1' }],
      }), 'application/json');
    });
    const result = await new HttpPopulationAcquisition({ fetch }).acquire(
      source('read-only-api', 'https://source.example.test/peoplehub/employees'),
      period,
      1000,
    );

    expect(result.mediaType).toBe('application/json');
    expect(result.declaration).toMatchObject({ representation: 'population-rows-v1' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[0]?.[1] as RequestInit).method).toBe('GET');
  });

  it.each([
    ['non-http protocol', 's3://bucket/rows.csv'],
    ['URL credentials', 'https://user:password@source.example.test/rows.csv'],
    ['fragment', 'https://source.example.test/rows.csv#private'],
    ['count endpoint', 'https://source.example.test/rows/count'],
    ['pagination query', 'https://source.example.test/rows?page=2'],
    ['secret query', 'https://source.example.test/rows?token=private'],
  ])('refuses %s before making a request', async (_name, location) => {
    const fetch = vi.fn();
    await expect(new HttpPopulationAcquisition({ fetch }).acquire(
      source('versioned-file', location),
      period,
      1000,
    )).rejects.toMatchObject({ code: 'contract' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves raw bytes when a count endpoint is advertised outside the frozen source path and origin', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ declared_count_endpoint: 'https://other.example.test/count' }), 'application/json'));
    const result = await new HttpPopulationAcquisition({ fetch }).acquire(
      source('read-only-api', 'https://source.example.test/peoplehub/employees'),
      period,
      1000,
    );
    expect(new TextDecoder().decode(result.bytes)).toContain('declared_count_endpoint');
    expect(result.declaration).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses redirects and response bodies beyond the frozen byte bound', async () => {
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://other.example.test' } }));
    await expect(new HttpPopulationAcquisition({ fetch: redirect }).acquire(
      source('versioned-file', 'https://source.example.test/rows.csv'),
      period,
      1000,
    )).rejects.toMatchObject({ code: 'contract' });

    const tooLarge = vi.fn(async () => new Response(new Uint8Array(4), {
      headers: { 'content-type': 'text/csv', 'content-length': '4' },
    }));
    await expect(new HttpPopulationAcquisition({ fetch: tooLarge, maxBytes: 3 }).acquire(
      source('versioned-file', 'https://source.example.test/rows.csv'),
      period,
      1000,
    )).rejects.toMatchObject({ code: 'integrity' });
    expect(POPULATION_ACQUISITION_MAX_BYTES).toBe(16 * 1024 * 1024);
  });

  it('aborts an in-flight fetch when the deadline expires', async () => {
    let aborted = false;
    const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    }));
    await expect(new HttpPopulationAcquisition({ fetch }).acquire(
      source('versioned-file', 'https://source.example.test/rows.csv'),
      period,
      10,
    )).rejects.toBeInstanceOf(PopulationAcquisitionError);
    expect(aborted).toBe(true);
  });
});
