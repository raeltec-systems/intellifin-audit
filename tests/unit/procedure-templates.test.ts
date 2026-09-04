import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PROCEDURE_TEMPLATES,
  PROCEDURE_TEMPLATE_IDS,
  heroProcedureTemplate,
  isTemplateId,
  type ProcedureTemplate,
  type TemplateCondition,
} from '@intellifin/domain';

/**
 * The four Template contracts, pinned to addendum §C on disk.
 *
 * A value retyped into TypeScript and asserted against a copy of itself proves only
 * that the file agrees with itself. Every default in `templates.ts` is therefore read
 * here from the addendum artifact and required to appear VERBATIM in the Template
 * block of §C. The addendum writes some strings inside markdown emphasis
 * (for example the P-2 reference-source bullet) or with backticks inside them, so both
 * sides are compared after stripping emphasis markers and backticks from the artifact
 * text — never after altering the constant.
 *
 * This test lives under `tests/unit`, not in `packages/domain`: the domain package has
 * no `@types/node` on purpose (AD-11 — its absence is what stops `process.env`
 * typechecking there), so nothing inside it may read a file.
 */

const ROOT = '../../';
const ADDENDUM =
  '_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md';
const SYSTEMS = 'fixtures/northstar/datasets/systems.json';
const EXPECTATIONS_DIR = 'fixtures/northstar/expectations';

const addendum = readFileSync(fileURLToPath(new URL(`${ROOT}${ADDENDUM}`, import.meta.url)), 'utf8');
const systems = JSON.parse(
  readFileSync(fileURLToPath(new URL(`${ROOT}${SYSTEMS}`, import.meta.url)), 'utf8'),
) as {
  population_source_bindings: readonly { id: string }[];
};

/** The four expectation fixtures, by filename. */
const EXPECTATION_FILES: Readonly<Record<string, string>> = {
  'p-1-terminated-users': 'p-1-terminated-users.json',
  'p-2-sod-conflicts': 'p-2-sod-conflicts.json',
  'p-3-high-value-approvals': 'p-3-high-value-approvals.json',
  'p-4-config-deviation': 'p-4-config-deviation.json',
};

function expectationIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const file of Object.values(EXPECTATION_FILES)) {
    const parsed = JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`${ROOT}${EXPECTATIONS_DIR}/${file}`, import.meta.url)),
        'utf8',
      ),
    ) as { expectation_id?: string };
    if (parsed.expectation_id) ids.add(parsed.expectation_id);
  }
  return ids;
}

const EXPECTED_IDS = expectationIds();

/**
 * Strip the markdown the addendum wraps strings in: double-star emphasis, single-star
 * emphasis, and backtick code markers. Applied to the ARTIFACT only; the stored
 * constants must match what is left.
 */
function plain(text: string): string {
  const withoutBold = text.split('**').join('');
  const withoutItalic = withoutBold.split('*').join('');
  return withoutItalic.split('`').join('');
}

/** The §C block for one Template id, as plain text. */
function templateBlock(id: string): string {
  const start = addendum.indexOf(`### ${id}:`);
  expect(start, `addendum §C has a "### ${id}:" heading`).toBeGreaterThanOrEqual(0);
  const next = addendum.indexOf('\n### ', start + 1);
  const end = addendum.indexOf('\n## ', start + 1);
  // The block runs to the next heading of either level; P-4 is the last in §C, so its
  // block ends where "## D." begins.
  const stop = next === -1 ? end : Math.min(next, end);
  expect(stop, `a heading follows the ${id} block`).toBeGreaterThan(start);
  return plain(addendum.slice(start, stop));
}

const BLOCKS: Readonly<Record<string, string>> = Object.fromEntries(
  PROCEDURE_TEMPLATE_IDS.map((id) => [id, templateBlock(id)]),
);

/** One stored string, pinned: it must appear in the block, or the block is wrong. */
function expectPinned(block: string, value: string | null): void {
  if (value === null) return;
  expect(block).toContain(plain(value));
}

/** One condition, with every string §C states for it pinned. */
function expectConditionPinned(block: string, condition: TemplateCondition): void {
  expectPinned(block, condition.applicability);
  expectPinned(block, condition.compliant);
  expectPinned(block, condition.exception);
  expectPinned(block, condition.unevaluated);
  for (const extra of condition.also) expectPinned(block, extra);
}

describe('the four Procedure Templates', () => {
  it('are exactly the four ids, with P-1 first and marked the hero', () => {
    expect(PROCEDURE_TEMPLATE_IDS).toEqual(['P-1', 'P-2', 'P-3', 'P-4']);
    expect(PROCEDURE_TEMPLATES.map((template) => template.id)).toEqual(PROCEDURE_TEMPLATE_IDS);
    expect(heroProcedureTemplate().id).toBe('P-1');
    expect(PROCEDURE_TEMPLATES.filter((template) => template.hero)).toHaveLength(1);
  });

  it('are pinned to addendum §C block by block, default by default', () => {
    for (const template of PROCEDURE_TEMPLATES) {
      const block = BLOCKS[template.id];
      if (block === undefined) throw new Error(`no §C block pinned for ${template.id}`);
      expect(block).toContain(template.name);
      expectPinned(block, template.controlStatement);
      expectPinned(block, template.objective);
      expectPinned(block, template.populationSource);
      expectPinned(block, template.targetSystems);
      expectPinned(block, template.workItemCoverage);
      expectPinned(block, template.auditInstructions);
      expectPinned(block, template.evidenceRequirements);
      expectPinned(block, template.schedule);
      expectPinned(block, template.inconclusive);
      for (const extra of template.also) expectPinned(block, extra);

      // Declared attribute labels: every stored string is what §C states.
      if (template.declaredAttributeLabels !== null) {
        for (const [attribute, label] of Object.entries(template.declaredAttributeLabels)) {
          expect(block).toContain(label);
          if (attribute !== 'identity') expect(block).toContain(attribute);
        }
        expect(block).toContain(template.secondaryKey ?? '');
      } else {
        expect(template.secondaryKey).toBeNull();
      }

      for (const condition of template.conditions) {
        expectConditionPinned(block, condition);
      }
    }
  });

  it('gives every Template an objective and a population default, because §C does', () => {
    for (const template of PROCEDURE_TEMPLATES) {
      expect(template.objective.length).toBeGreaterThan(0);
      expect(template.populationSource.length).toBeGreaterThan(0);
      expect(template.targetSystems.length).toBeGreaterThan(0);
      expect(template.workItemCoverage.length).toBeGreaterThan(0);
    }
  });

  it('marks exactly the fields §C states non-null, and nothing more', () => {
    const [p1, p2, p3, p4] = PROCEDURE_TEMPLATES;
    if (p1 === undefined || p2 === undefined || p3 === undefined || p4 === undefined) {
      throw new Error('a Template is missing from the array');
    }
    // §C gives a Control statement and a Schedule default only to P-1.
    expect(p1.controlStatement).not.toBeNull();
    expect(p1.schedule).toBe('weekly');
    for (const template of [p2, p3, p4]) {
      expect(template.controlStatement).toBeNull();
      expect(template.schedule).toBeNull();
    }
  });

  it('originates each condition as §C says: C1 is RULE, and P-1 C2 is Agent-Judged', () => {
    for (const template of PROCEDURE_TEMPLATES) {
      expect(template.conditions.length).toBeGreaterThanOrEqual(1);
      for (const condition of template.conditions) {
        if (template.id === 'P-1' && condition.conditionId === 'C2') {
          expect(condition.origin).toBe('AGENT_JUDGED');
        } else {
          expect(condition.origin).toBe('RULE');
        }
      }
    }
  });
});

describe('the golden references each Template names', () => {
  it('names a Population Source binding that exists in the fixture catalogue', () => {
    const bindingIds = new Set(systems.population_source_bindings.map((binding) => binding.id));
    for (const template of PROCEDURE_TEMPLATES) {
      expect(bindingIds.has(template.goldenBindingReference), template.id).toBe(true);
    }
  });

  it('names an expectation fixture and a confirmation script version that exist on disk', () => {
    for (const template of PROCEDURE_TEMPLATES) {
      expect(EXPECTED_IDS.has(template.expectationsVersion), template.id).toBe(true);
      // AD-19: one confirmation script per environment, shared by all four Templates.
      expect(template.confirmationScriptVersion).toBe('confirmation-scripts');
    }
    const scripts = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(`${ROOT}${EXPECTATIONS_DIR}/confirmation-scripts.json`, import.meta.url),
        ),
        'utf8',
      ),
    ) as { expectation_id?: string };
    expect(scripts.expectation_id).toBe('confirmation-scripts');
  });

  it('never reads a fixture at run time: the module names them as data only', () => {
    // The Template NAMES its references; acquiring them is a later story work. This
    // file reads the fixtures to prove the names resolve; the domain module must not.
    // The strongest structural statement: the module imports nothing at all. It is
    // frozen data, so there is nothing for it to load — not a fixture, not a helper.
    const source = readFileSync(
      fileURLToPath(new URL('../../packages/domain/src/procedures/templates.ts', import.meta.url)),
      'utf8',
    );
    expect(source.match(/^import /m)).toBeNull();
    expect(source.match(/require\(/)).toBeNull();
  });
});

describe('the Template guard', () => {
  it('recognizes the four ids and nothing else', () => {
    for (const id of PROCEDURE_TEMPLATE_IDS) expect(isTemplateId(id)).toBe(true);
    expect(isTemplateId('p-1')).toBe(false);
    expect(isTemplateId('P-5')).toBe(false);
    expect(isTemplateId('constructor')).toBe(false);
    expect(isTemplateId(null)).toBe(false);
  });
});
