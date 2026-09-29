import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { refreshesSurface } from './refresh-events';

/**
 * Which Timeline events re-read a Run surface, and that every surface asks the same
 * question (Story 10.7 review).
 */

describe('the events a Run surface re-reads on', () => {
  it('skips the three internal families no surface renders', () => {
    for (const type of [
      'evidence-access.grant-issued',
      'evidence-access.denied',
      'evidence-access.read',
      'notification.in-app-delivery',
      'notification.email-delivery',
      'security.denied',
    ]) {
      expect(refreshesSurface(type), type).toBe(false);
    }
  });

  it('re-reads on everything else, a denied Tool Action and a family added later included', () => {
    for (const type of [
      'lifecycle.run-queued',
      'lifecycle.run-flagged',
      'lifecycle.result-sealed',
      'lifecycle.run-canceled',
      'execution.escalation-raised',
      'execution.observations-registered',
      'execution.capture-registered',
      'failure.retry',
      'failure.evidence-integrity',
      'review.conversation-received',
      'configuration.registration-changed',
      // The Timeline renders a denied Tool Action; only the person-refused event is internal.
      'security.action-denied',
      // Nothing may hide by resembling an internal name.
      'security.denied-later',
      'evidence.read',
      // A family nobody has written yet re-reads by default.
      'export.package-written',
    ]) {
      expect(refreshesSurface(type), type).toBe(true);
    }
  });
});

describe('every live banner on a Run surface goes through the filter', () => {
  const web = fileURLToPath(new URL('../../', import.meta.url));

  function sources(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { found.push(...sources(path)); continue; }
      if (path.endsWith('.tsx') && !path.includes('.test.')) found.push(path);
    }
    return found;
  }

  it('mounts `LiveBanner` only inside `SurfaceLiveBanner`', () => {
    // Run Detail and the Runs list are server components and cannot pass the filter
    // themselves, so a direct `<LiveBanner` anywhere else is a surface that re-reads on
    // its own Evidence reads. Every offender is named.
    const offenders = sources(web)
      .filter((path) => !path.endsWith(join('src', 'runs', 'SurfaceLiveBanner.tsx')) && !path.endsWith(join('src', 'runs', 'LiveBanner.tsx')))
      .filter((path) => /<LiveBanner\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(web, path));
    expect(offenders, `a direct <LiveBanner mount:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('pins Run Detail and the Runs list to the filtered banner', () => {
    for (const path of ['src/runs/detail.tsx', 'app/runs/page.tsx']) {
      expect(readFileSync(join(web, path), 'utf8'), path).toMatch(/<SurfaceLiveBanner\b/);
    }
  });
});
