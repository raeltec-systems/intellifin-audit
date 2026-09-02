import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_DENIAL_REASON, DENIAL_REASONS } from '@intellifin/domain';

/**
 * The denial strings, checked against the UX handoff on disk.
 *
 * `roles.test.ts` compares them with `DENIAL_REASONS`, which is the module under
 * test — on its own that proves only that the file agrees with itself. This reads
 * "Roles and Action Gating" out of EXPERIENCE.md and checks each string appears there
 * character for character, the way `db/schema.test.ts` guards the role vocabulary
 * against the migration. Reword either side and this fails.
 *
 * It lives here rather than in `packages/domain` on purpose: that package omits
 * `types: ["node"]` so `process.env` cannot typecheck inside it (AD-11), which also
 * means it cannot read a file. `tests/unit` is where domain tests that need the
 * filesystem go.
 *
 * The planning-artifact folder name contains a space, so the path is one string
 * resolved relative to this file rather than assembled from segments.
 */
const EXPERIENCE_PATH = fileURLToPath(
  new URL(
    '../../_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/EXPERIENCE.md',
    import.meta.url,
  ),
);

const experience = readFileSync(EXPERIENCE_PATH, 'utf8');

describe('the denial strings against the UX handoff', () => {
  it('finds the "Roles and Action Gating" table it is quoting', () => {
    expect(experience).toContain('## Roles and Action Gating');
  });

  it.each(Object.entries(DENIAL_REASONS))(
    '%s is reproduced verbatim from the table',
    (_key, reason) => {
      expect(experience).toContain(reason);
    },
  );

  it('quotes all five specified strings and invents no sixth', () => {
    expect(Object.keys(DENIAL_REASONS)).toHaveLength(5);
  });

  it('keeps the default reason out of the table, because the table does not specify it', () => {
    // The table leaves those cells as a bare em dash. The default is ours, and saying
    // so here stops somebody later assuming it is copy they can find upstream.
    expect(experience).not.toContain(DEFAULT_DENIAL_REASON);
  });

  it('finds each string on a row of the gating table, not merely somewhere in the file', () => {
    const table = experience.slice(experience.indexOf('## Roles and Action Gating'));
    const rows = table.split('\n').filter((line) => line.startsWith('|'));
    for (const reason of Object.values(DENIAL_REASONS)) {
      expect(
        rows.some((row) => row.includes(reason)),
        `"${reason}" is not on a row of the gating table`,
      ).toBe(true);
    }
  });
});
