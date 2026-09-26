import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const reads = vi.hoisted(() => ({ evidence: vi.fn(), timeline: vi.fn(), access: vi.fn() }));
vi.mock('@intellifin/infrastructure', () => ({
  DrizzleActorNameReader: class { namesFor = async () => new Map(); },
  DrizzleFrozenExecutionReader: class { readFrozenExecution = async () => null; },
  DrizzleRunDetailRepository: class {
    readTimeline = reads.timeline; readEvidenceItemsByIds = reads.evidence;
    readLatestFrame = async () => null; readLatestStepExecution = async () => null;
    readAgentWorkPosition = async () => null; readEvidenceItems = async () => [];
    readFlags = async () => []; readLogicalStepProgress = async () => ({ started: 0, retries: 0 });
  },
  readRecordNames: async () => new Map(), readTimelineHead: async () => 0,
}));
vi.mock('../../../../src/bootstrap', () => ({ getRuntime: async () => ({ db: {} }) }));
vi.mock('../../../../src/runs/detail', () => ({ openRun: reads.access,
  RunDenied: () => null, CancellationBanners: () => null, OpenEscalationSection: () => null,
  PauseBanners: () => null, runTabHref: () => '/' }));
import { LiveViewer, type LiveViewerProps } from '../../../../src/runs/LiveViewer';
import RunLivePage from './page';
function viewer(node: unknown): LiveViewerProps | null {
  if (Array.isArray(node)) { for (const child of node) { const found = viewer(child); if (found) return found; } return null; }
  if (!React.isValidElement(node)) return null;
  return node.type === LiveViewer ? node.props as LiveViewerProps : viewer((node.props as {children?: unknown}).children);
}
beforeEach(() => {
  vi.clearAllMocks();
  reads.access.mockResolvedValue({ allowed: true, run: { runId: 'run', state: 'RUNNING', pauseRequest: null, cancellation: null }, readAt: new Date() });
  reads.timeline.mockResolvedValue({ sessionSteps: [{ stepId: 'adapter', action: 'extract-adapter', displayName: 'Reference', state: 'ACQUIRED', attempts: 1, evidenceId: 'artifact' }], workItems: [], stepExecutions: { rows: [], total: 0 }, workspace: null });
  reads.evidence.mockResolvedValue([{ evidenceId: 'artifact', state: 'REGISTERED', digest: 'a'.repeat(64) }]);
});
describe('Live View adapter evidence through the real page read', () => {
  it('resolves the exact registered artifact independently of the evidence overview prefix', async () => {
    const props = viewer(await RunLivePage({ params: Promise.resolve({ id: 'run' }) }));
    expect(reads.evidence).toHaveBeenCalledWith('run', ['artifact']);
    expect(props?.adapterSteps[0]).toMatchObject({ evidenceId: 'artifact', digest: 'a'.repeat(64) });
  });
  it('keeps no-artifact separate from a registered identity whose evidence could not be read', async () => {
    reads.evidence.mockResolvedValue([]);
    const missing = viewer(await RunLivePage({ params: Promise.resolve({ id: 'run' }) }));
    expect(missing?.adapterSteps[0]).toMatchObject({ evidenceId: 'artifact', digest: null });
    const timeline = await reads.timeline(); timeline.sessionSteps[0].evidenceId = null;
    const absent = viewer(await RunLivePage({ params: Promise.resolve({ id: 'run' }) }));
    expect(absent?.adapterSteps[0]).toMatchObject({ evidenceId: null, digest: null });
  });
  it('does not label a reserved artifact as a registered digest', async () => {
    reads.evidence.mockResolvedValue([{ evidenceId: 'artifact', state: 'RESERVED', digest: 'a'.repeat(64) }]);
    expect(viewer(await RunLivePage({ params: Promise.resolve({ id: 'run' }) }))?.adapterSteps[0]?.digest).toBeNull();
  });
});
