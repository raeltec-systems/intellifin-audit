import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NewProcedureForm } from './NewProcedureForm';
import { NEW_PROCEDURE_PREPARING, NEW_PROCEDURE_REQUIRES_JAVASCRIPT } from './new-procedure-words';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('New Procedure before hydration', () => {
  it('makes server-rendered fields unavailable and explains why without creating anything', () => {
    const onCreate = vi.fn(async () => ({ ok: false as const, reason: 'Not submitted' }));
    const html = renderToStaticMarkup(React.createElement(NewProcedureForm, { onCreate }));
    expect(html).toContain('data-new-procedure-ready="false"');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain(NEW_PROCEDURE_PREPARING);
    expect(html.indexOf(NEW_PROCEDURE_PREPARING)).toBeLessThan(html.indexOf('<fieldset'));
    // Rendered as ordinary markup, never inside `<noscript>`: a reader whose scripts
    // simply failed is the case that sentence has to reach, and the one it cannot.
    expect(html).toContain(NEW_PROCEDURE_REQUIRES_JAVASCRIPT);
    expect(html).not.toContain('<noscript>');
    expect(html.indexOf(NEW_PROCEDURE_REQUIRES_JAVASCRIPT)).toBeLessThan(html.indexOf('<fieldset'));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
