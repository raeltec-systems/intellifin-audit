import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

const childProcess = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: childProcess.spawn,
}));

import { startLiveWorker } from '../fixtures/solari-audit-acceptance';

it.each([
  { name: 'already-closed failure', alreadyClosed: true, code: 1, refuses: true },
  { name: 'failure during graceful stop', alreadyClosed: false, code: 1, refuses: true },
  { name: 'already-closed clean exit', alreadyClosed: true, code: 0, refuses: false },
  { name: 'clean graceful stop', alreadyClosed: false, code: 0, refuses: false },
])('live acceptance shutdown: $name', async ({ alreadyClosed, code, refuses }) => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    kill: vi.fn(() => { child.emit('close', code); return true; }),
  });
  childProcess.spawn.mockReturnValue(child);
  const worker = startLiveWorker({});
  if (alreadyClosed) child.emit('close', code);
  if (refuses) {
    await expect(worker.stop()).rejects.toThrow('Live worker exited unsuccessfully; raw logs are withheld.');
  } else {
    await expect(worker.stop()).resolves.toBeUndefined();
  }
  expect(child.kill.mock.calls).toEqual(alreadyClosed ? [] : [['SIGTERM']]);
});
