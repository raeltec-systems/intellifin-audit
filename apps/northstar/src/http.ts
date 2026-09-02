/**
 * The request and response shapes this application works in, and nothing else.
 *
 * `handleRequest` is a pure function from a request to a response. `main.ts` is the only
 * module that touches `node:http`, so every route can be exercised without a socket and
 * the read-only rule can be asserted over the route table rather than over a running
 * server.
 */

export interface NorthstarRequest {
  /** As the client sent it, upper-cased. Never trusted to be one of ours. */
  readonly method: string;
  /** The decoded path. `readPath` guarantees it is a string even for a malformed escape. */
  readonly path: string;
  /** The raw path, before decoding. */
  readonly rawPath: string;
  readonly query: URLSearchParams;
}

export interface NorthstarResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
}

/** The two methods every Northstar system serves. There is no third. */
export const READ_METHODS = ['GET', 'HEAD'] as const;
export type ReadMethod = (typeof READ_METHODS)[number];

export function isReadMethod(method: string): method is ReadMethod {
  return (READ_METHODS as readonly string[]).includes(method);
}

/**
 * `decodeURIComponent` throws on a malformed escape, and `/loancore/users/%E0%A4%A` is a
 * URL anybody can type. Unguarded, the URIError becomes a 500 from a system whose whole
 * job is to be boringly predictable. Fall back to the raw text, which is what the caller
 * asked for anyway.
 */
export function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const NO_STORE = {
  // A synthetic system's answers are deterministic, and a Run must be reproducible. A
  // cached intermediate answering instead of the system would make "the same call twice
  // returns the same bytes" true for the wrong reason.
  'cache-control': 'no-store',
} as const;

export function json(status: number, value: unknown): NorthstarResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE },
    body: `${JSON.stringify(value, null, 2)}\n`,
  };
}

export function html(status: number, body: string): NorthstarResponse {
  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE },
    body,
  };
}

export function bytes(
  status: number,
  contentType: string,
  payload: Uint8Array,
): NorthstarResponse {
  return { status, headers: { 'content-type': contentType, ...NO_STORE }, body: payload };
}

/**
 * HTML entity-encoding for text that came out of a dataset.
 *
 * This is a TRANSPORT encoding, never a redaction. A seeded prompt-like string is the
 * case; escaping it away at the fixture or at the boundary would delete the test. What
 * this does is stop a value from becoming markup — the text a reader and a parser see is
 * byte-for-byte the dataset's value, and `server.test.ts` decodes the page and compares.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
