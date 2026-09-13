import { isAuthoringProgress, type AuthoringDraftFields, type AuthoringProgress } from '@intellifin/application';
import { isWritingResponse, type WritingAssistantActions } from './WritingAssistant';

/** A partial response is never returned as a suggestion. Missing completion is an
 * uncertain outcome, recovered only with the original request identity and payload. */
export async function streamAuthoringSuggestion(fields: AuthoringDraftFields, onProgress?: (progress: AuthoringProgress) => void): ReturnType<WritingAssistantActions['generate']> {
  const response = await fetch('/api/procedures/authoring', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields), signal: AbortSignal.timeout(45_000),
  });
  // These statuses are explicit pre-generation refusals. Do not read an arbitrary
  // proxy/server error body or trap an expired session in "recover this request".
  const refusal = ({
    400: 'That writing request was not valid. Review your notes and try again.',
    401: 'Your session has expired. Sign in again to continue writing assistance.',
    403: 'Writing assistance is not permitted for this request. Reload the application and check your access.',
    413: 'That writing request is too large. Shorten your notes and try again.',
    429: 'The writing request limit has been reached. Try later or keep writing manually.',
  } as Record<number, string>)[response.status];
  if (refusal) { await response.body?.cancel().catch(() => {}); return { ok: false, reason: refusal }; }
  if (!response.ok || !response.body) throw new Error('Writing response unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', bytes = 0, events = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) throw new Error('Writing response incomplete');
      bytes += part.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error('Writing response exceeds its limit');
      buffer += decoder.decode(part.value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        if (boundary > 128 * 1024 || ++events > 129) throw new Error('Writing response exceeds its limit');
        const event = JSON.parse(buffer.slice(0, boundary)) as Record<string, unknown>;
        buffer = buffer.slice(boundary + 1);
        if (event?.['requestId'] !== fields.requestId) throw new Error('Writing response belongs to a different request');
        if (event['type'] === 'progress' && isAuthoringProgress(event['progress'])) onProgress?.(event['progress']);
        else if (event['type'] === 'result') {
          const result = event['result'] as Record<string, unknown> | null;
          if (result?.['ok'] === true && isWritingResponse(result['suggestion'], fields)) return { ok: true, suggestion: result['suggestion'] };
          if (result?.['ok'] === false && typeof result['reason'] === 'string' && result['reason'].length <= 2_000) return { ok: false, reason: result['reason'] };
          throw new Error('Invalid completed response');
        } else throw new Error('Unconfirmed writing response');
      }
      if (buffer.length > 128 * 1024) throw new Error('Writing response exceeds its limit');
    }
  } finally { await reader.cancel().catch(() => {}); }
}
