import type { JsonObject, JsonValue } from '../canonical-json.js';
import { AuditEventValidationError } from '../audit-event.js';

/** Public platform identity only. Never derive a viewer reference from a provider handle. */
export function workspaceReference(runId: string): string {
  return `workspace-${runId}`;
}

const CAPABILITY_KEYS = new Set([
  'workspaceid', 'providersessionid', 'signedsessionid', 'wsendpoint', 'cdpendpoint',
  'observerendpoint', 'controlendpoint', 'streamendpoint', 'replayurl',
]);

/** Append-time policy only: old immutable events must still verify unchanged. */
export function assertNoWorkspaceCapabilities(payload: JsonObject): void {
  const visit = (value: JsonValue): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    for (const [key, child] of Object.entries(value)) {
      if (CAPABILITY_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        throw new AuditEventValidationError('payload', 'workspace connection capabilities are forbidden');
      }
      visit(child);
    }
  };
  visit(payload);
}
