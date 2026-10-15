/** Resolve TCP routing without including credentials in diagnostics. */
export function databaseEndpoint(source: URL, pgport = process.env.PGPORT): { host: string; port: number } {
  const host = source.hostname.replace(/^\[|\]$/g, '');
  const rawPort = source.port || pgport || '5432';
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || !host ||
      !/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('Invalid PostgreSQL TCP endpoint.');
  }
  return { host, port: Number(rawPort) };
}
