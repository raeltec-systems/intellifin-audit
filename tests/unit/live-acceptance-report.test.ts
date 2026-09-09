import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { retainLiveAcceptanceReport } from '../fixtures/live-acceptance-report';

it('retains failed acceptance and its cleanup identity as an uploadable JSON file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'live-report-'));
  const attach = vi.fn(async () => {});
  const report = { acceptance: 'not-accepted', workspace: { mode: 'solari', workspace_id: 'synthetic-session', status: 'RELEASED' } };
  try {
    expect(await retainLiveAcceptanceReport({ outputPath: name => join(directory, name), attach },
      'solari-audit-acceptance-policy-bound.json', report, ['synthetic-secret'])).toBe(true);
    const path = join(directory, 'solari-audit-acceptance-policy-bound.json');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(report);
    expect(attach).toHaveBeenCalledWith('solari-audit-acceptance-policy-bound.json', { path, contentType: 'application/json' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('refuses secret-bearing reports before writing, attaching or logging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'live-report-'));
  const attach = vi.fn(async () => {}), log = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    expect(await retainLiveAcceptanceReport({ outputPath: name => join(directory, name), attach },
      'solari-workspace-isolation.json', { diagnostic: 'synthetic-secret' }, ['synthetic-secret'])).toBe(false);
    expect(await readdir(directory)).toEqual([]);
    expect(attach).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  } finally { log.mockRestore(); await rm(directory, { recursive: true, force: true }); }
});
