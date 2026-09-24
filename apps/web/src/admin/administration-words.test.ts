import { describe, expect, it } from 'vitest';

import { SUBSECTION_LABELS } from '../shell/breadcrumb-rules';
import {
  ACCOUNTS_WITHOUT_ROLE,
  ADMINISTRATION_AREAS,
  ADMINISTRATION_NOT_AVAILABLE,
  ADMINISTRATION_TABS,
  ADMINISTRATOR_COVER,
  AUDIT_ACTIVITY_NONE_SENTENCE,
  AUTH_ENDPOINT_HELP,
  AUTH_ENDPOINT_LABEL,
  CONNECTION_CHECK_NOT_RUN_SENTENCE,
  CREDENTIAL_REFERENCE_MEANING,
  CREDENTIAL_REFERENCE_UNKNOWN,
  FIELD_ORDER_SENTENCE,
  ONBOARDING_STEPS,
  ROLE_GUARDRAILS,
  SOURCES_WITHOUT_A_CONFIRMED_COUNT,
  SOURCE_NOT_VALIDATED,
  SYSTEMS_NEVER_CHECKED,
  affectedProceduresSentence,
  duplicateFieldNames,
  fieldListDuplicateWarning,
  healthSentence,
  inventoryFilterSentence,
  userPageSentence,
} from './administration-words';

/**
 * The Administration area's own sentences, pinned (UI cleanup 2026-09-22).
 *
 * A sentence retyped in a component is a sentence pinned against nothing, and three of
 * these replace a sentence the walkthrough found stating something untrue. The rules
 * below are about what each one may NOT say as much as what it does.
 */

describe('the three tabs are the three breadcrumb labels', () => {
  it('names the areas exactly as the trail names them', () => {
    // Package 1 set these in `breadcrumb-rules.ts`. A tab reading "Target systems" over a
    // crumb reading "Systems" is two names for one place, which is the defect the whole
    // plain-words pass exists to remove.
    for (const tab of ADMINISTRATION_TABS) {
      expect(SUBSECTION_LABELS[tab.href], tab.href).toBe(tab.label);
    }
  });

  it('offers Users, Population sources and Systems, in that order', () => {
    expect(ADMINISTRATION_TABS.map((tab) => tab.label)).toEqual([
      'Users',
      'Population sources',
      'Systems',
    ]);
  });

  it('never calls them by the names the domain freezes', () => {
    const rendered = [
      ...ADMINISTRATION_TABS.map((tab) => tab.label),
      ...Object.values(ADMINISTRATION_AREAS).map((area) => `${area.title} ${area.purpose}`),
    ].join(' ');
    for (const phrase of ['Target System registration', 'Population Source binding', 'binding']) {
      expect(rendered, phrase).not.toContain(phrase);
    }
  });

  it('gives every area a noun pair and a purpose', () => {
    for (const tab of ADMINISTRATION_TABS) {
      const area = ADMINISTRATION_AREAS[tab.href];
      expect(area.title).toBe(tab.label);
      expect(area.singular.length).toBeGreaterThan(0);
      expect(area.plural).not.toBe(area.singular);
      expect(area.purpose.endsWith('.')).toBe(true);
    }
  });
});

/**
 * UX-37: the landing states what is true, and says what is missing in a caption rather
 * than as a refusal.
 */
describe('the configuration health lines', () => {
  it('says what was checked when nothing is wrong, rather than disappearing', () => {
    // A health section that renders nothing when everything is fine is indistinguishable
    // from one that never ran — the "an empty state is a statement about the environment"
    // rule, applied to a summary.
    for (const line of [
      ACCOUNTS_WITHOUT_ROLE,
      SOURCES_WITHOUT_A_CONFIRMED_COUNT,
      SYSTEMS_NEVER_CHECKED,
    ]) {
      expect(healthSentence(line, 0)).toBe(line.clear);
      expect(line.clear.length).toBeGreaterThan(0);
    }
  });

  it('counts in words, with the right noun for one', () => {
    expect(healthSentence(ACCOUNTS_WITHOUT_ROLE, 1)).toContain('1 account holds no role');
    expect(healthSentence(ACCOUNTS_WITHOUT_ROLE, 4)).toContain('4 accounts hold no role');
    expect(healthSentence(SOURCES_WITHOUT_A_CONFIRMED_COUNT, 1)).toContain('1 source has');
    expect(healthSentence(SOURCES_WITHOUT_A_CONFIRMED_COUNT, 2)).toContain('2 sources have');
    expect(healthSentence(SYSTEMS_NEVER_CHECKED, 1)).toContain('1 system has');
    expect(healthSentence(SYSTEMS_NEVER_CHECKED, 3)).toContain('3 systems have');
  });

  it('separates no administrator from exactly one', () => {
    expect(ADMINISTRATOR_COVER.problem(0)).toContain('No account can administer');
    expect(ADMINISTRATOR_COVER.problem(1)).toContain('One account can administer');
    expect(ADMINISTRATOR_COVER.problem(1)).toContain('refused');
  });

  it('states what this release does not do once, as a caption, without refusing anything', () => {
    for (const fact of ['source or a connection', 'invitations', 'password recovery', 'diagnostics']) {
      expect(ADMINISTRATION_NOT_AVAILABLE, fact).toContain(fact);
    }
    // Not a refusal: it describes the release, it does not decline a request.
    expect(ADMINISTRATION_NOT_AVAILABLE).not.toContain('not permit');
    expect(ADMINISTRATION_NOT_AVAILABLE).not.toContain('not part of this release');
  });
});

/** UX-38: the page sentence carries the EXACT total beside the bounded page. */
describe('the user directory sentences', () => {
  it('names the range and the exact total', () => {
    expect(userPageSentence(1, 25, 72)).toBe('Showing 1–25 of 72 accounts.');
    expect(userPageSentence(1, 1, 1)).toBe('Showing 1–1 of 1 account.');
    expect(userPageSentence(26, 50, 1842)).toContain('1,842 accounts');
  });
});

/** UX-39: the guardrails are stated where the control is, not only when it refuses. */
describe('the role guardrails', () => {
  it('names both changes the command refuses', () => {
    expect(ROLE_GUARDRAILS).toContain('your own role');
    expect(ROLE_GUARDRAILS).toContain('no PoC Administrator');
  });
});

/** UX-40: the supported onboarding, and the reset flow that does not exist. */
describe('the onboarding block', () => {
  it('says the administrator hands over the password and no email is sent', () => {
    expect(ONBOARDING_STEPS[0]).toContain('directly');
    expect(ONBOARDING_STEPS[0]).toContain('no email');
  });

  it('says there is no way to change a password afterwards, rather than inventing one', () => {
    // There is no password-change command, no reset link, and `seed:identity` never
    // resets a password either. A step naming a remedy would send an administrator
    // looking for a screen this build does not have.
    const last = ONBOARDING_STEPS[2] ?? '';
    expect(last).toContain('no reset link');
    expect(last).toContain('replaced');
    for (const invented of ['reset email', 'Reset password', 'forgot']) {
      expect(last, invented).not.toContain(invented);
    }
  });
});

/** UX-42: the field list says what will be saved and warns before a save is refused. */
describe('the field list words', () => {
  it('says the order must match the file', () => {
    expect(FIELD_ORDER_SENTENCE).toContain('order the file has them in');
  });

  it('names the duplicated fields, and agrees with itself about one or several', () => {
    expect(fieldListDuplicateWarning(['employee_id'])).toContain('employee_id is listed more than once');
    const two = fieldListDuplicateWarning(['a', 'b']);
    expect(two).toContain('a, b are listed more than once');
  });

  it('says nothing here opens the source', () => {
    expect(SOURCE_NOT_VALIDATED).toContain('Nothing here opens the source');
    expect(SOURCE_NOT_VALIDATED).toContain('A Run is what reads it');
  });

  it('finds the names that repeat, once each, in their first order', () => {
    expect(duplicateFieldNames(['a', 'b', 'a'])).toEqual(['a']);
    expect(duplicateFieldNames(['a', 'b', 'c'])).toEqual([]);
    expect(duplicateFieldNames(['a', 'a', 'a'])).toEqual(['a']);
    expect(duplicateFieldNames(['b', 'a', 'b', 'a'])).toEqual(['b', 'a']);
  });
});

describe('inventory-first sentences (UX-43)', () => {
  it('states the filtered count against the exact total', () => {
    expect(inventoryFilterSentence(2, 9, 'sources')).toBe('Showing 2 of 9 sources.');
  });
});

/**
 * UX-44: a system a Run has used never reads "No worker has observed this system yet".
 *
 * EXPERIENCE.md's UI cleanup section names that sentence directly. It was false on
 * exactly the systems an operator cares most about, because a completed Run had observed
 * them; the connection check and the last audit activity are two facts.
 */
describe('the two facts a system states', () => {
  it('never claims nothing has observed the system', () => {
    for (const sentence of [CONNECTION_CHECK_NOT_RUN_SENTENCE, AUDIT_ACTIVITY_NONE_SENTENCE]) {
      expect(sentence).not.toContain('No worker has observed');
      expect(sentence).not.toContain('no worker has observed');
    }
  });

  it('says what the connection check is and who runs it', () => {
    expect(CONNECTION_CHECK_NOT_RUN_SENTENCE).toContain('whether the address answers');
    expect(CONNECTION_CHECK_NOT_RUN_SENTENCE).toContain('never contacts a system');
  });

  it('says what an absence of audit activity is read from', () => {
    expect(AUDIT_ACTIVITY_NONE_SENTENCE).toContain('Procedure Version froze');
  });
});

/**
 * UX-45: the field IS the authentication endpoint, and the label says so.
 *
 * The old label called it the address OF the sign-in form while the help called it the
 * address the form SENDS TO — two different things on one control.
 */
describe('the authentication endpoint words', () => {
  it('names the endpoint in the label rather than the page', () => {
    expect(AUTH_ENDPOINT_LABEL).toContain('Authentication endpoint');
    expect(AUTH_ENDPOINT_LABEL).toContain('sends the credential');
    expect(AUTH_ENDPOINT_LABEL).not.toContain('address of the sign-in form');
  });

  it('tells the three addresses apart', () => {
    expect(AUTH_ENDPOINT_HELP).toContain('where the agent may browse');
    expect(AUTH_ENDPOINT_HELP).toContain('sign-in page is one of those');
    expect(AUTH_ENDPOINT_HELP).toContain('single address the password may be sent to');
  });

  it('says what a stored credential name is, and never claims to hold one', () => {
    expect(CREDENTIAL_REFERENCE_MEANING).toContain('not the password');
    expect(CREDENTIAL_REFERENCE_MEANING).toContain('keeps elsewhere');
    // An empty list of known names must not read as "this deployment declared none".
    expect(CREDENTIAL_REFERENCE_UNKNOWN).toContain('cannot list');
  });
});

/** UX-46: the confirmation names the Procedures, and says when it could not. */
describe('the affected-procedure sentence', () => {
  it('names them', () => {
    expect(affectedProceduresSentence(['Leaver access', 'Vendor SoD'], 2)).toBe(
      'Leaver access, Vendor SoD.',
    );
  });

  it('says how many more it did not name', () => {
    expect(affectedProceduresSentence(['A', 'B'], 5)).toBe('A, B, and 3 more.');
  });

  it('never reads an unreadable list as an empty one', () => {
    // A change whose affected set could not be read is not a change that affects none.
    expect(affectedProceduresSentence(null, 0)).toContain('could not be listed');
    expect(affectedProceduresSentence([], 0)).toBe('No Active procedure uses it.');
  });
});
