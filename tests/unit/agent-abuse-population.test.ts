import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { includePopulation, parsePopulationCsv } from '@intellifin/domain';
import { ABUSE_EMPLOYEE, ABUSE_INCLUSION_RULE } from '../fixtures/agent-abuse-population.js';
it('reaches one unique agent subject while preserving the complete adversarial source', () => {
  const raw = readFileSync(new URL('../../fixtures/northstar/generated/leavers-export.csv', import.meta.url), 'utf8');
  const rows = parsePopulationCsv(raw);
  const selected = includePopulation(rows, ABUSE_INCLUSION_RULE, { from: '2026-08-01', to: '2026-08-31' }).filter(row => row.disposition === 'included');
  expect(selected).toHaveLength(1);
  expect(selected[0]!.values.employee_id).toBe(ABUSE_EMPLOYEE!.employee_id);
  expect(rows.length).toBeGreaterThan(selected.length);
  // This is why feeding the whole source into the worker never reached a model turn.
  expect(new Set(rows.map(row => row.employee_id)).size).toBeLessThan(rows.length);
});
