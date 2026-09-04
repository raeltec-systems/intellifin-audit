import { describe, expect, it, vi } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DrizzleProcedureRepository } from './procedure-repository.js';
import type { Database } from '../db/client.js';

const id = '018f0000-0000-7000-8000-000000000001';
const parent = { procedureId: id, controlName: 'Synthetic procedure', templateId: 'P-4', createdAt: new Date(0), updatedAt: new Date(0) };
function database(parents: unknown[], activeRows: unknown[]) {
  const limit = vi.fn(async () => parents);
  const order = vi.fn(async (..._expressions: SQL[]) => activeRows);
  const where = vi.fn((_condition: SQL) => ({ orderBy: order }));
  const selectDistinctOn = vi.fn((_on: unknown, _projection: unknown) => ({ from: () => ({ where }) }));
  const select = vi.fn(() => ({ from: () => ({ orderBy: () => ({ limit }) }) }));
  return { db: { select, selectDistinctOn } as unknown as Database, selectDistinctOn, where, order, limit };
}

describe('Procedure list metadata query', () => {
  it('restricts the Active metadata projection to selected Procedures without fetching plan/history', async () => {
    const fake = database([parent], [{ procedureId: id, state: 'ACTIVE', versionNumber: 7 }]);
    const result = await new DrizzleProcedureRepository(fake.db, 12).listProcedures();
    expect(result[0]).toMatchObject({ activeVersionState: 'ACTIVE', activeVersionNumber: 7 });
    expect(fake.limit).toHaveBeenCalledWith(12);
    expect(Object.keys(fake.selectDistinctOn.mock.calls[0]![1] as object)).toEqual(['procedureId', 'state', 'versionNumber']);
    const dialect = new PgDialect();
    const predicate = dialect.sqlToQuery(fake.where.mock.calls[0]![0]);
    expect(predicate.params).toEqual([id, 'ACTIVE']);
    const order = dialect.sqlToQuery(sql.join(fake.order.mock.calls[0]!, sql`, `)).sql;
    expect(order).toContain('"version_number" desc');
    expect(order).toContain('"version_id" desc');
  });
  it('does not scan versions for an empty page', async () => {
    const fake = database([], []);
    expect(await new DrizzleProcedureRepository(fake.db).listProcedures()).toEqual([]);
    expect(fake.selectDistinctOn).not.toHaveBeenCalled();
  });
  it.each([{ procedureId: id, state: 'DRAFT', versionNumber: 1 }, { procedureId: id, state: 'ACTIVE', versionNumber: 0 }, { procedureId: 'unselected', state: 'ACTIVE', versionNumber: 1 }])('fails closed on invalid displayed Active metadata', async (row) => {
    const fake = database([parent], [row]);
    expect((await new DrizzleProcedureRepository(fake.db).listProcedures())[0]).toMatchObject({ activeVersionState: null, activeVersionNumber: null });
  });
});
