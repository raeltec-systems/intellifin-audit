import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DRAFT_CREATED_BODY, DRAFT_CREATED_TEMPLATE, draftCreatedBanner } from './new-procedure-words';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/**
 * UX-05 and UX-07: a Procedure is named by its Procedure name, and creating a harmless
 * Draft is one action whose success is said on the Builder it lands on.
 */
describe('creating a Draft in one action', () => {
  it('opens no confirmation dialog on the New procedure form', () => {
    const form = read('./NewProcedureForm.tsx');
    expect(form).not.toContain('ConfirmDialog');
    expect(form).toContain('builder?created=1');
  });

  it('names the new Draft in the Builder banner, safely for any name', () => {
    expect(draftCreatedBanner('Leavers August')).toBe('Draft “Leavers August” created.');
    // `String.prototype.replace` would expand `$&` into the placeholder text.
    expect(draftCreatedBanner('Fee $& review')).toBe('Draft “Fee $& review” created.');
    expect(DRAFT_CREATED_TEMPLATE).toContain('{name}');
    expect(DRAFT_CREATED_BODY.length).toBeGreaterThan(0);
  });

  it('shows the banner only when the Builder is reached from creation, reading the words from this module', () => {
    const page = read('../../app/procedures/[id]/builder/page.tsx');
    expect(page).toContain("query.created === '1'");
    expect(page).toContain('draftCreatedBanner(draft.controlName)');
    expect(page).not.toContain('created.');
  });

  it('calls the field the Procedure name on the creation and rename forms', () => {
    for (const path of ['./NewProcedureForm.tsx', './RenameDraftForm.tsx']) {
      const source = read(path);
      expect(source).toContain('Procedure name');
      expect(source).not.toMatch(/>\s*(?:New )?Control name\s*</u);
    }
  });
});
