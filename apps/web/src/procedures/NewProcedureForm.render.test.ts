import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NewProcedureForm, NEW_PROCEDURE_PREPARING } from './NewProcedureForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('New Procedure before hydration', () => {
  it('makes server-rendered fields unavailable and explains why without creating anything', () => {
    const onCreate = vi.fn(async () => ({ ok: false as const, reason: 'Not submitted' }));
    const html = renderToStaticMarkup(React.createElement(NewProcedureForm, { onCreate }));
    expect(html).toContain('data-new-procedure-ready="false"');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain(NEW_PROCEDURE_PREPARING);
    expect(html.indexOf(NEW_PROCEDURE_PREPARING)).toBeLessThan(html.indexOf('<fieldset'));
    expect(html).toContain('Enable JavaScript to create a Procedure.');
    expect(onCreate).not.toHaveBeenCalled();
  });
});
