import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { NOTHING_CHANGED_CLAIM } from './nothing-changed';
import { ROUTE_BOUNDARY_COPY, routeBoundarySentence } from './route-boundary-words';

/**
 * The route boundary's words (Story 10.8).
 *
 * The Run sentence is the owner's candidate, and the place the owner wrote it is
 * epics.md Story 10.8. The owner approved all five on 2026-09-26, and the UX contract states
 * them in EXPERIENCE.md's state table, in the one row for the route boundary beside "Action
 * failed". Both are read back off disk rather than compared with a copy of themselves, so a
 * change on either side fails here and the two are changed together.
 */
const epics = readFileSync(
  fileURLToPath(new URL('../../../../_bmad-output/planning-artifacts/epics.md', import.meta.url)),
  'utf8',
);
const story = /### Story 10\.8:[\s\S]*?(?=\n### Story )/.exec(epics)?.[0] ?? '';
const experience = readFileSync(
  fileURLToPath(new URL('../../../../_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/EXPERIENCE.md', import.meta.url)),
  'utf8',
);
const boundaryRow = experience.split('\n').find((line) => line.startsWith('| Any | Page could not be loaded (route boundary) |')) ?? '';

describe('the route boundary sentences', () => {
  it('reads the Story 10.8 acceptance criteria off disk', () => {
    // A story block that was not found would make the next assertion vacuous.
    expect(story).toContain('the generic rendering error states only what it knows');
  });

  it("uses the owner's candidate sentence for a Run page, verbatim", () => {
    expect(story).toContain(`"${ROUTE_BOUNDARY_COPY.run}"`);
  });

  it('reads the route boundary row of EXPERIENCE.md off disk', () => {
    // A row that was not found would make every assertion below vacuous.
    expect(boundaryRow).toMatch(/^\| Any \| Page could not be loaded \(route boundary\) \| .+ \|$/);
  });

  it.each(Object.entries(ROUTE_BOUNDARY_COPY))('states the approved %s sentence in that row, verbatim', (_key, sentence) => {
    expect(boundaryRow).toContain(`"${sentence}"`);
  });

  it('leaves the Action failed row for an action the platform refused', () => {
    // That row's "Nothing was changed." is true of a refusal and false of a lost
    // acknowledgement; the boundary row says which one it is not.
    expect(experience).toContain('| Any | Action failed | Destructive Banner "Couldn\'t {action}. Nothing was changed." with the platform reason;');
    expect(boundaryRow).toContain('The "Action failed" row stays for an action the platform refused.');
    expect(boundaryRow).not.toMatch(NOTHING_CHANGED_CLAIM);
  });

  it('never claims that nothing was changed', () => {
    // Whether anything changed is established only by an action's recorded outcome. The
    // boundary is reached after a committed action whose answer was lost, so any claim
    // here would be a guess stated as a fact.
    for (const [key, sentence] of Object.entries(ROUTE_BOUNDARY_COPY)) {
      expect(sentence, key).not.toMatch(NOTHING_CHANGED_CLAIM);
    }
  });

  it('starts each title with the heading, so the banner and the heading say one thing', () => {
    expect(ROUTE_BOUNDARY_COPY.run.startsWith(`${ROUTE_BOUNDARY_COPY.heading}.`)).toBe(true);
    expect(ROUTE_BOUNDARY_COPY.other.startsWith(`${ROUTE_BOUNDARY_COPY.heading}.`)).toBe(true);
  });
});

describe('which sentence a page gets', () => {
  it.each([
    '/runs/019823ab-0000-7000-8000-0000000000a1',
    '/runs/019823ab-0000-7000-8000-0000000000a1/',
    '/runs/019823ab-0000-7000-8000-0000000000a1/live',
    '/runs/019823ab-0000-7000-8000-0000000000a1/evidence/019823ab-0000-7000-8000-0000000000b2',
    '/runs/019823ab-0000-7000-8000-0000000000a1/replay',
  ])('names the Run on %s', (pathname) => {
    expect(routeBoundarySentence(pathname)).toBe(ROUTE_BOUNDARY_COPY.run);
  });

  it.each([
    '/', '/runs', '/runs/', '/runsx/1', '/procedures/019823ab-0000-7000-8000-0000000000a1',
    '/administration/users', '/notifications', 'runs/x', '', null, undefined,
  ])('names no Run on %s', (pathname) => {
    expect(routeBoundarySentence(pathname)).toBe(ROUTE_BOUNDARY_COPY.other);
  });
});
