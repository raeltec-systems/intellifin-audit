import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ROLES } from '@intellifin/domain';
import { ROLE_LABELS, NO_ROLE_LABEL } from '../admin/roles';
import { SIGNED_IN_AS_LABEL, SignedInAs } from './SignedInAs';

const NAMED = new Map([['synthetic-auditor', 'Dana Mwale']]);

function render(props: Parameters<typeof SignedInAs>[0]): string {
  return renderToStaticMarkup(createElement(SignedInAs, props));
}

describe('the shell names the person and the authority they hold', () => {
  it('writes the name, never the id, when a name is known', () => {
    const html = render({ userId: 'synthetic-auditor', names: NAMED, role: 'auditor' });
    expect(html).toContain('Dana Mwale');
    expect(html).not.toContain('synthetic-auditor');
  });

  it('says what the line is, for a reader who has no top bar to look at', () => {
    const html = render({ userId: 'synthetic-auditor', names: NAMED, role: 'auditor' });
    expect(html).toContain(SIGNED_IN_AS_LABEL);
    // Visually hidden, not hidden from assistive technology: `aria-hidden` here would
    // leave a screen reader with a bare name and role and nothing saying what they are.
    expect(html).toContain('ls-visually-hidden');
    expect(html).not.toContain('aria-hidden');
  });

  it.each(ROLES)('writes %s in words, never as the stored value', role => {
    const html = render({ userId: 'synthetic-auditor', names: NAMED, role });
    expect(html).toContain(ROLE_LABELS[role]);
    // `audit-manager` and `poc-administrator` are stored values; printing one at a
    // reader is the platform speaking its own language, which is the defect the
    // plain-words pass removed from the authoring screens.
    if (role !== 'auditor') expect(html).not.toContain(role);
  });

  it('shows the id when no name is known, rather than a blank where a person belongs', () => {
    const html = render({ userId: 'synthetic-auditor', names: new Map(), role: 'auditor' });
    expect(html).toContain('synthetic-auditor');
    expect(html).toContain('ls-mono');
  });

  it('calls an account with no role a state, never a default role', () => {
    const html = render({ userId: 'synthetic-auditor', names: NAMED, role: null });
    expect(html).toContain(NO_ROLE_LABEL);
    expect(html).not.toContain(ROLE_LABELS.auditor);
  });

  it('names nobody when the identity could not be resolved', () => {
    // `currentIdentity`'s `degraded` arm keeps the shell and drops the role. Naming a
    // person the server could not identify would state something it does not know.
    expect(render({ userId: null, names: new Map(), role: null })).toBe('');
  });
});
