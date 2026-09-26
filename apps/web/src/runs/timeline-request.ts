const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function timelineRequest(query: Readonly<Record<string, string | string[] | undefined>>):
  { readonly cursor: number; readonly waitId?: string } | null {
  // Other Timeline sections own their query keys (for example pauseAfter).
  // Validate only this section's selectors so independent pagination composes.
  if (query.wait !== undefined) {
    return typeof query.wait === 'string' && UUID.test(query.wait) && query.decisionsAfter === undefined
      ? { cursor: 0, waitId: query.wait.toLowerCase() } : null;
  }
  if (query.decisionsAfter === undefined) return { cursor: 0 };
  return typeof query.decisionsAfter === 'string' && /^(0|[1-9]\d*)$/.test(query.decisionsAfter) && Number.isSafeInteger(Number(query.decisionsAfter))
    ? { cursor: Number(query.decisionsAfter) } : null;
}
