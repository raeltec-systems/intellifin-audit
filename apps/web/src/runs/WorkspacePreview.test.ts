import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { WorkspacePreview, matchingPreview } from './WorkspacePreview';
const sample = { runId: 'run', runtimeId: 'runtime', workspaceRevision: 1, privacyEpoch: 2, mode: 'public' as const, sequence: 3, capturedAt: 1000, captureCompletedAt: 1100, expiresAt: 5000 };
describe('preview freshness after image decode', () => {
  it('accepts only the same fresh runtime, epoch and sample', () => {
    expect(matchingPreview(sample, sample, 2000)).toBe(true);
    for (const changed of [{ runId: 'foreign' }, { runtimeId: 'replacement' }, { workspaceRevision: 2 }, { privacyEpoch: 3 }, { mode: 'private' as const }, { sequence: 4 }, { capturedAt: 999 }, { expiresAt: 1900 }]) {
      expect(matchingPreview(sample, { ...sample, ...changed }, 2000)).toBe(false);
    }
    expect(matchingPreview(sample, sample, 4000)).toBe(false);
    expect(matchingPreview(sample, sample, 999)).toBe(false);
    expect(matchingPreview({ ...sample, captureCompletedAt: 999 }, sample, 2000)).toBe(false);
  });
  it('allows capture progress during decode without extending the decoded sample age', () => {
    const newer = { ...sample, sequence: 4, capturedAt: 1500, captureCompletedAt: 1600 };
    expect(matchingPreview(sample, newer, 2000)).toBe(true);
    expect(matchingPreview(sample, newer, 4000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, sequence: 2 }, 2000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, privacyEpoch: 3 }, 2000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, runtimeId: 'replacement' }, 2000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, mode: 'private' }, 2000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, capturedAt: 2100 }, 2000)).toBe(false);
    expect(matchingPreview(sample, { ...newer, captureCompletedAt: 1400 }, 2000)).toBe(false);
  });
  it('starts with an accessible unavailable state and no prior pixels', () => {
    const html = renderToStaticMarkup(createElement(WorkspacePreview, { runId: 'run', enabled: true }));
    expect(html).toContain('role="status"'); expect(html).toContain('aria-live="polite"'); expect(html).toContain('unavailable'); expect(html).not.toContain('<img');
  });
});
