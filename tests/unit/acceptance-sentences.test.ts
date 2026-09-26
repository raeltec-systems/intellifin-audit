import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ROUTE_BOUNDARY_COPY } from '../../apps/web/src/design/route-boundary-words';

/**
 * The deployed acceptance decides whether an Evidence link OPENED by looking for the
 * sentences the product renders when one does not. A sentence retyped in a checker is
 * pinned against nothing: change the page's wording and the check silently starts passing
 * for every broken link, which is exactly the "a check that cannot fail" defect the rest of
 * this pass removed. So each sentence the harness looks for is read back out of the page
 * that renders it — the `copy.test.ts` discipline, applied to the harness.
 */
const HARNESS = readFileSync('scripts/verify-deployed-loancore.mjs', 'utf8');

describe('the sentences the deployed acceptance looks for', () => {
  it('uses the evidence inspector\'s own banner title for a failed snapshot read', () => {
    const inspector = readFileSync('apps/web/app/runs/[id]/evidence/[evidenceId]/page.tsx', 'utf8');
    // One banner title covers every `EvidenceSnapshotReadFailure`, so matching it is
    // matching all thirteen.
    expect(inspector).toContain('title="Snapshot cell unavailable"');
    expect(HARNESS).toContain("body.includes('Snapshot cell unavailable')");
  });

  it('uses the route boundary\'s own heading for a page that could not be built', () => {
    // The boundary renders its words from `route-boundary-words.ts`, and `error.test.ts`
    // reads them back out of the rendered page. The HEADING is what the harness matches:
    // it heads every boundary on every path, and both of the banner's sentences start
    // with it, so one match covers them all.
    const boundary = readFileSync('apps/web/app/error.tsx', 'utf8');
    expect(boundary).toContain('{ROUTE_BOUNDARY_COPY.heading}');
    expect(HARNESS).toContain(`body.includes('${ROUTE_BOUNDARY_COPY.heading}')`);
    // Story 10.8 retired the sentence that claimed nothing was changed: the boundary is
    // reached after a committed action whose acknowledgement was lost, where it was false.
    expect(boundary).not.toContain('Nothing was changed');
    expect(HARNESS).not.toContain("Couldn't load this page");
  });

  it('reads the predetermined truth off disk rather than importing it', () => {
    // AD-12: nothing that executes a Run may import an expectation file, and the harness
    // drives a real Run. It reads the oracle with `readFileSync`, never an import.
    expect(HARNESS).toContain("readFileSync('fixtures/northstar/expectations/p-1-live-acceptance.json', 'utf8')");
    expect(HARNESS).not.toMatch(/import[^\n]*expectations\//);
  });

  it('requires every check it names to be present before it accepts', () => {
    // `report.required` is the list every check must satisfy. A check computed but left
    // out of it is a check whose failure nobody would see.
    const required = /report\.required = \[([^\]]*)\]/.exec(HARNESS)?.[1] ?? '';
    const names = [...required.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
    expect(names.length).toBeGreaterThan(10);
    const computed = new Set([...HARNESS.matchAll(/report\.checks\.([A-Za-z]+)\s*=/g)].map((m) => m[1]!));
    // `defectivePopulationRefused` is pushed separately, behind the negative-case input.
    for (const name of computed) {
      if (name === 'defectivePopulationRefused') continue;
      expect(names, `${name} is computed but never required`).toContain(name);
    }
  });
});
