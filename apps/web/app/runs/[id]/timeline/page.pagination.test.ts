import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@intellifin/infrastructure', () => ({
  DrizzleRunDetailRepository: class { async readTimeline() { return { decisions: { rows: [], total: 100, nextCursor: 75, selectionFound: true }, population: null, execution: null, sessionSteps: [], workItems: [], stepExecutions: { rows: [], total: 0 } }; } },
  DrizzleActorNameReader: class { async namesFor() { return new Map(); } },
}));
vi.mock('../../../../src/bootstrap', () => ({ getRuntime: async () => ({ db: {} }) }));
vi.mock('../../../../src/runs/detail', () => ({ openRun: async () => ({ allowed: true, run: { runId: 'run', state: 'COMPLETED' }, readAt: new Date() }),
  RunDenied: () => null, RunDetailFrame: ({ children }: { children: React.ReactNode }) => React.createElement('main', null, children) }));
vi.mock('../../../../src/runs/Timeline', () => ({ ExecutionTimeline: () => null }));
import Page from './page';
it('preserves another Timeline section’s selector when paging decisions', async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'run' }), searchParams: Promise.resolve({ decisionsAfter: '50', pauseBefore: '99' }) }));
  expect(html).toContain('href="/runs/run/timeline?pauseBefore=99"');
  expect(html).toContain('href="/runs/run/timeline?pauseBefore=99&amp;decisionsAfter=75"');
});
