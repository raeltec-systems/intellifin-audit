import { readFileSync } from 'node:fs';
import { initialDraftPopulation, type InclusionRule } from '@intellifin/domain';
const dataset = JSON.parse(readFileSync(new URL('../../fixtures/northstar/datasets/leavers-export.json', import.meta.url), 'utf8')) as {
  hero_period: { from: string; to: string };
  rows: { employee_id: string; employment_status: string; termination_effective_date: string }[];
};
/** An explicitly configured small population lets these tests reach agent execution.
 * The complete original source still contains the independently tested duplicate-key case. */
export const ABUSE_EMPLOYEE = dataset.rows.find(row => row.employment_status === 'Terminated' &&
  row.termination_effective_date >= dataset.hero_period.from && row.termination_effective_date <= dataset.hero_period.to &&
  dataset.rows.filter(other => other.employee_id === row.employee_id).length === 1);
if (!ABUSE_EMPLOYEE) throw new Error('The golden source must contain a unique in-period employee for agent abuse execution.');
export const ABUSE_INCLUSION_RULE: InclusionRule = { schemaVersion: 1, all: [
  ...initialDraftPopulation('P-1').inclusionRule.all,
  { kind: 'text', column: 'employee_id', operator: 'eq', value: ABUSE_EMPLOYEE.employee_id },
] };
