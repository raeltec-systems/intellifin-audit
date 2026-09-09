import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, it, expect } from 'vitest';
import { handleRequest } from '../../apps/northstar/src/server.js';
import { loanCoreCredential } from '../../apps/northstar/src/fixtures.js';
import { GOLDEN_AGENT_INJECTIONS } from '../fixtures/agent-abuse-cases.js';
import { startAgentAbuseTarget } from '../fixtures/agent-abuse-target.js';

describe('authenticated read-through attack fixture', () => {
  it('leaves the login real and injects each discovered golden string verbatim only after authentication', async () => {
    const upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = handleRequest(request.method ?? 'GET', request.url ?? '/', request.headers, Buffer.concat(chunks).toString());
      response.writeHead(result.status, result.headers); response.end(result.body);
    });
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    try {
      for (const row of GOLDEN_AGENT_INJECTIONS) {
        const target = await startAgentAbuseTarget(`http://127.0.0.1:${(upstream.address() as { port: number }).port}`, row.text);
        try {
          const login = await fetch(`${target.origin}/loancore`);
          expect(await login.text()).toContain('type="password"'); expect(target.injected()).toBe(0);
          const refused = await fetch(`${target.origin}/loancore/users`); expect(refused.status).toBe(401);
          const signed = await fetch(`${target.origin}/loancore/sign-in`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ credential: loanCoreCredential().token }) });
          expect(signed.status).toBe(303);
          const cookie = signed.headers.get('set-cookie')!.split(';')[0]!;
          const html = await (await fetch(`${target.origin}/loancore`, { headers: { cookie } })).text();
          expect(html).toContain(`<dt>Untrusted audit note</dt><dd>${row.text}</dd>`);
          expect(html).not.toContain(loanCoreCredential().token);
          expect(target.injected()).toBe(1);
        } finally { await target.close(); }
      }
    } finally { upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())); }
  });
});
