import type { TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Only the already-selected acceptance facts may enter this sink, never raw logs. */
export async function retainLiveAcceptanceReport(
  testInfo: Pick<TestInfo, 'outputPath' | 'attach'>,
  name: 'solari-audit-acceptance.json' | 'solari-workspace-isolation.json',
  report: Record<string, unknown>,
  secrets: readonly string[],
): Promise<boolean> {
  const serialized = JSON.stringify(report, null, 2);
  if (secrets.some(secret => secret.length > 0 && serialized.includes(secret))) return false;
  // The list reporter does not materialize body attachments for upload-artifact.
  const path = testInfo.outputPath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialized, { mode: 0o600 });
  await testInfo.attach(name, { path, contentType: 'application/json' });
  console.info(`LIVE_ACCEPTANCE_REPORT ${JSON.stringify(report)}`);
  return true;
}
