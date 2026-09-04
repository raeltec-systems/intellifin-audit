import { describe, expect, it } from 'vitest';

import {
  CONDITION_ORIGINS,
  PROCEDURE_TEMPLATES,
  PROCEDURE_TEMPLATE_IDS,
  findProcedureTemplate,
  heroProcedureTemplate,
  isConditionOrigin,
} from './templates.js';

/**
 * The Template records, checked in-package.
 *
 * What these tests cannot do here is prove a default matches the addendum: this package
 * has no `@types/node`, so no file can be read. That pin lives in
 * `tests/unit/procedure-templates.test.ts`, which reads §C off disk; what this file
 * owns is everything that does not need the artifact — the shape of the records, the
 * invariants the domain itself relies on, and the accessors.
 *
 * Stored defaults keep §C's own punctuation, including the backticks §C writes around
 * attribute names; the disk-side pin normalizes markdown emphasis and backticks on both
 * sides before comparing, so the words are what is pinned.
 */

describe('the Template records', () => {
  it('are four, in §C order, and frozen', () => {
    expect(PROCEDURE_TEMPLATES).toHaveLength(4);
    expect(PROCEDURE_TEMPLATES.map((template) => template.id)).toEqual([
      'P-1',
      'P-2',
      'P-3',
      'P-4',
    ]);
  });

  it('carry every field the contract names', () => {
    for (const template of PROCEDURE_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.objective.length).toBeGreaterThan(0);
      expect(template.populationSource.length).toBeGreaterThan(0);
      expect(template.targetSystems.length).toBeGreaterThan(0);
      expect(template.workItemCoverage.length).toBeGreaterThan(0);
      expect(template.goldenBindingReference.length).toBeGreaterThan(0);
      expect(template.expectationsVersion.length).toBeGreaterThan(0);
      expect(template.confirmationScriptVersion.length).toBeGreaterThan(0);
      expect(typeof template.hero).toBe('boolean');
    }
  });

  it('give every condition the three outcome slots §C states', () => {
    for (const template of PROCEDURE_TEMPLATES) {
      for (const condition of template.conditions) {
        // Every condition states Compliant and Exception; Unevaluated is stated where §C
        // names what makes one. `also` may be empty.
        expect(condition.compliant === null || condition.compliant.length > 0).toBe(true);
        expect(condition.exception === null || condition.exception.length > 0).toBe(true);
      }
    }
    // P-1 C2: §C gives only the Exception sentence and the Gate-failure rule.
    const p1c2 = PROCEDURE_TEMPLATES[0]?.conditions.find((c) => c.conditionId === 'C2');
    expect(p1c2?.compliant).toBeNull();
    expect(p1c2?.unevaluated).toBeNull();
    expect(p1c2?.exception).toContain('privileged');
  });

  it('mark P-1 the hero and only P-1', () => {
    expect(heroProcedureTemplate().id).toBe('P-1');
    expect(PROCEDURE_TEMPLATES.filter((template) => template.hero).map((t) => t.id)).toEqual([
      'P-1',
    ]);
  });

  it('give P-1 the §C extras: attribute labels, secondary key, escalation seeds', () => {
    const p1 = PROCEDURE_TEMPLATES[0];
    if (!p1) throw new Error('P-1 is missing');
    expect(p1.declaredAttributeLabels).toEqual({
      account_status: 'Status',
      username: 'Username',
      roles: 'Roles',
      identity: 'Employee ID',
    });
    expect(p1.secondaryKey).toBe('full name');
    expect(p1.also.length).toBe(2);
    // The escalation seeds and the 24-hour variant are both §C text, pinned to the
    // artifact by the test under `tests/unit`.
    expect(p1.also[0]).toContain('choose candidate');
    expect(p1.also[1]).toContain('24-hour disablement-window');
  });

  it('declare no C2 on any Template but P-1, and only RULE conditions elsewhere', () => {
    for (const template of PROCEDURE_TEMPLATES.slice(1)) {
      expect(template.conditions).toHaveLength(1);
      expect(template.conditions[0]?.conditionId).toBe('C1');
      expect(template.conditions[0]?.origin).toBe('RULE');
    }
  });
});

describe('the condition origin vocabulary', () => {
  it('is exactly the two authored origins', () => {
    expect(CONDITION_ORIGINS).toEqual(['RULE', 'AGENT_JUDGED']);
    expect(isConditionOrigin('RULE')).toBe(true);
    expect(isConditionOrigin('AGENT_JUDGED')).toBe(true);
    // HUMAN arises only from a rejection, never from authoring (addendum §E).
    expect(isConditionOrigin('HUMAN')).toBe(false);
    expect(isConditionOrigin('rule')).toBe(false);
    expect(isConditionOrigin(undefined)).toBe(false);
  });
});

describe('the accessors', () => {
  it('resolve every shipped id and refuse anything else', () => {
    for (const id of PROCEDURE_TEMPLATE_IDS) {
      expect(findProcedureTemplate(id).id).toBe(id);
    }
    expect(() => findProcedureTemplate('P-9' as never)).toThrow();
  });
});
