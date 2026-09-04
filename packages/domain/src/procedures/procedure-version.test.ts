import { describe, expect, it } from 'vitest';

import {
  DRAFT_SECTION_HEADINGS,
  PROCEDURE_VERSION_STATES,
  PROCEDURE_VERSION_TRANSITIONS,
  canTransition,
  initialDraftSections,
  isDraftSectionHeading,
  isProcedureVersionState,
  isValidDraftSectionsPayload,
} from './procedure-version.js';
import { PROCEDURE_TEMPLATES, PROCEDURE_TEMPLATE_IDS, type TemplateId } from './templates.js';

/**
 * The Procedure Version state machine and the Template pre-fill, as §E and §C state
 * them. The verbatim pinning of every §C default lives in
 * `tests/unit/procedure-templates.test.ts`, which reads the addendum off disk — this
 * package has no `@types/node` and cannot read a file, exactly as it cannot read
 * `process.env` (AD-11).
 */

describe('the version state vocabulary', () => {
  it('is exactly the six states of §E, in order', () => {
    expect(PROCEDURE_VERSION_STATES).toEqual([
      'DRAFT',
      'SUBMITTED',
      'APPROVED',
      'REJECTED',
      'ACTIVE',
      'RETIRED',
    ]);
  });

  it('recognizes each state and nothing else', () => {
    for (const state of PROCEDURE_VERSION_STATES) {
      expect(isProcedureVersionState(state)).toBe(true);
    }
    expect(isProcedureVersionState('draft')).toBe(false);
    expect(isProcedureVersionState('PENDING')).toBe(false);
    expect(isProcedureVersionState('constructor')).toBe(false);
    expect(isProcedureVersionState(undefined)).toBe(false);
  });
});

describe('the permitted transitions', () => {
  it('gives every state a transition entry, and only the edges of §E', () => {
    expect(Object.keys(PROCEDURE_VERSION_TRANSITIONS).sort()).toEqual(
      [...PROCEDURE_VERSION_STATES].sort(),
    );
    expect(PROCEDURE_VERSION_TRANSITIONS['DRAFT']).toEqual(['SUBMITTED']);
    expect(PROCEDURE_VERSION_TRANSITIONS['SUBMITTED']).toEqual(['APPROVED', 'REJECTED']);
    expect(PROCEDURE_VERSION_TRANSITIONS['APPROVED']).toEqual(['ACTIVE']);
    expect(PROCEDURE_VERSION_TRANSITIONS['REJECTED']).toEqual(['DRAFT']);
    expect(PROCEDURE_VERSION_TRANSITIONS['ACTIVE']).toEqual(['RETIRED']);
    expect(PROCEDURE_VERSION_TRANSITIONS['RETIRED']).toEqual([]);
  });

  it('reaches every state from DRAFT through permitted edges only', () => {
    const reachable = new Set<string>(['DRAFT']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [from, targets] of Object.entries(PROCEDURE_VERSION_TRANSITIONS)) {
        if (reachable.has(from)) {
          for (const target of targets) {
            if (!reachable.has(target)) {
              reachable.add(target);
              grew = true;
            }
          }
        }
      }
    }
    expect([...reachable].sort()).toEqual([...PROCEDURE_VERSION_STATES].sort());
  });

  it('refuses an edge the machine does not draw', () => {
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransition('DRAFT', 'RETIRED')).toBe(false);
    expect(canTransition('SUBMITTED', 'DRAFT')).toBe(false);
    expect(canTransition('ACTIVE', 'DRAFT')).toBe(false);
    expect(canTransition('RETIRED', 'ACTIVE')).toBe(false);
  });

  it('lets a rejected version return to DRAFT on edit', () => {
    expect(canTransition('REJECTED', 'DRAFT')).toBe(true);
  });
});

describe('the Builder section headings', () => {
  it('are the nine, in Builder order', () => {
    expect(DRAFT_SECTION_HEADINGS).toEqual([
      'Control',
      'Objective',
      'Period and scope',
      'Population Source binding',
      'Target System selection',
      'Audit Instructions',
      'Compliance Rule conditions',
      'Evidence Requirements',
      'Schedule',
    ]);
  });

  it('recognizes each heading and nothing else', () => {
    for (const heading of DRAFT_SECTION_HEADINGS) {
      expect(isDraftSectionHeading(heading)).toBe(true);
    }
    expect(isDraftSectionHeading('control')).toBe(false);
    expect(isDraftSectionHeading('Plan preview')).toBe(false);
  });
});

describe('initialDraftSections', () => {
  it('pre-fills every Template from its own record', () => {
    for (const template of PROCEDURE_TEMPLATES) {
      const sections = initialDraftSections(template.id);
      expect(sections.map((section) => section.heading)).toEqual([...DRAFT_SECTION_HEADINGS]);
      const byHeading = new Map(sections.map((section) => [section.heading, section.content]));
      expect(byHeading.get('Control')).toBe(template.controlStatement);
      expect(byHeading.get('Objective')).toBe(template.objective);
      expect(byHeading.get('Population Source binding')).toBe(template.populationSource);
      expect(byHeading.get('Target System selection')).toBe(template.targetSystems);
      expect(byHeading.get('Audit Instructions')).toBe(template.auditInstructions);
      expect(byHeading.get('Evidence Requirements')).toBe(template.evidenceRequirements);
      expect(byHeading.get('Schedule')).toBe(template.schedule);
      // Nothing is compiled: the PlanCompiler is Story 2.6 (AD-23).
      for (const section of sections) {
        expect(section.compiled).toBe(false);
      }
    }
  });

  it('gives every Template the sections §C gives it, and nulls where §C is silent', () => {
    const rest = PROCEDURE_TEMPLATES.slice(1);
    const byHeading = (templateId: TemplateId) =>
      new Map(initialDraftSections(templateId).map((s) => [s.heading, s.content]));

    // P-1: §C states every section.
    const p1Sections = byHeading('P-1');
    expect(p1Sections.get('Control')).not.toBeNull();
    expect(p1Sections.get('Audit Instructions')).not.toBeNull();
    expect(p1Sections.get('Evidence Requirements')).not.toBeNull();
    expect(p1Sections.get('Schedule')).toBe('weekly');

    // P-2 to P-4: §C gives no Control statement, no instructions, no evidence list, no Schedule.
    for (const template of rest) {
      const sections = byHeading(template.id);
      expect(sections.get('Control')).toBeNull();
      expect(sections.get('Audit Instructions')).toBeNull();
      expect(sections.get('Evidence Requirements')).toBeNull();
      expect(sections.get('Schedule')).toBeNull();
      // But the objective and the two §C halves every Template has are there.
      expect(sections.get('Objective')).toBe(template.objective);
      expect(sections.get('Population Source binding')).toBe(template.populationSource);
      expect(sections.get('Target System selection')).toBe(template.targetSystems);
    }
  });

  it('states the Compliance Rule conditions from the Template conditions', () => {
    const p1 = PROCEDURE_TEMPLATES[0];
    if (!p1) throw new Error('P-1 is missing');
    const conditions = initialDraftSections('P-1').find(
      (section) => section.heading === 'Compliance Rule conditions',
    );
    const content = conditions?.content ?? '';
    expect(content).toContain('condition C1 (RULE):');
    expect(content).toContain('condition C2 (AGENT_JUDGED):');
    expect(content).toContain(p1.conditions[0]?.compliant ?? '');
    expect(content).toContain(p1.conditions[1]?.exception ?? '');
  });

  it('refuses an id that is not a shipped Template', () => {
    expect(() => initialDraftSections('P-5' as TemplateId)).toThrow();
  });
});

describe('isValidDraftSectionsPayload', () => {
  it('accepts exactly what creation stores', () => {
    for (const template of PROCEDURE_TEMPLATES) {
      const payload = { templateId: template.id, sections: initialDraftSections(template.id) };
      expect(isValidDraftSectionsPayload(payload)).toBe(true);
    }
  });

  it('refuses the shapes that are not a section payload', () => {
    const valid = { templateId: 'P-1', sections: initialDraftSections('P-1') };
    expect(isValidDraftSectionsPayload(null)).toBe(false);
    expect(isValidDraftSectionsPayload('P-1')).toBe(false);
    expect(isValidDraftSectionsPayload({ ...valid, templateId: 'P-9' })).toBe(false);
    expect(isValidDraftSectionsPayload({ ...valid, sections: valid.sections.slice(1) })).toBe(false);
    expect(
      isValidDraftSectionsPayload({
        templateId: 'P-1',
        sections: [...valid.sections.slice(1), valid.sections[0]],
      }),
    ).toBe(false);
    expect(
      isValidDraftSectionsPayload({
        templateId: 'P-1',
        sections: valid.sections.map((section, index) =>
          index === 0 ? { ...section, compiled: true } : section,
        ),
      }),
    ).toBe(false);
    expect(
      isValidDraftSectionsPayload({
        templateId: 'P-1',
        sections: valid.sections.map((section, index) =>
          index === 0 ? { ...section, content: 42 } : section,
        ),
      }),
    ).toBe(false);
  });

  it('accepts an edited section, because editing belongs to stories 2.2 to 2.5', () => {
    // The validator is structural. It must not re-derive the Template, or a later story
    // could not store the draft the auditor actually saved.
    const edited = initialDraftSections('P-1').map((section, index) =>
      index === 8 ? { ...section, content: 'once' } : section,
    );
    expect(isValidDraftSectionsPayload({ templateId: 'P-1', sections: edited })).toBe(true);
  });

  it('refuses the payload prototype tricks a plain check would miss', () => {
    const payload = {
      templateId: 'P-1',
      sections: initialDraftSections('P-1'),
    };
    expect(isValidDraftSectionsPayload({ ...payload, templateId: 'toString' })).toBe(false);
    const spoofed: unknown = Object.create(null);
    expect(isValidDraftSectionsPayload(spoofed)).toBe(false);
  });

  it('agrees with the Template order on disk', () => {
    expect(PROCEDURE_TEMPLATE_IDS).toEqual(['P-1', 'P-2', 'P-3', 'P-4']);
  });
});
