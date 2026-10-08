import type { ProxyOptions } from 'vite';

/** Runs before Vite's built-in error listener, which logs request URL and stack. */
export const protectProxyErrors: NonNullable<ProxyOptions['configure']> = (proxy) => {
  proxy.on('error', (error, request) => {
    request.url = '/api/upstream';
    for (const key of Object.keys(error)) delete (error as unknown as Record<string, unknown>)[key];
    delete error.cause;
    error.name = 'Error';
    error.message = 'upstream_unavailable';
    error.stack = 'upstream_unavailable';
  });
};
