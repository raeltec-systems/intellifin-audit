import { describe, expect, it } from 'vitest';

import { PROBE_TIMEOUT_MS, probeOrigins, type Fetcher } from './probe-runner.js';

/**
 * What the sweep may do to a Target System, and what it concludes.
 *
 * The database half is exercised in `tests/integration/probe.test.ts` against real rows;
 * this file is about the decision, which needs no database and must be checkable without
 * one.
 */

function answering(status: number): Fetcher {
  return async () => ({ ok: status < 500, status });
}

const refusing: Fetcher = async () => {
  throw new Error('ECONNREFUSED');
};

describe('probeOrigins', () => {
  it('calls a system with GET only, and sends no body and no credentials', async () => {
    const calls: { origin: string; init: RequestInit }[] = [];
    // The real fetcher is not reachable from here, so the contract is asserted where it is
    // expressible: the port takes an origin and a signal and nothing else. There is no
    // parameter through which a body, a header or a credential could be passed to a
    // customer's system, which is the containment rather than a rule to remember.
    const recording: Fetcher = async (origin, signal) => {
      calls.push({ origin, init: { signal } });
      return { ok: true, status: 200 };
    };
    await probeOrigins(['http://localhost:4300/loancore'], recording);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.origin).toBe('http://localhost:4300/loancore');
  });

  it('is reachable when the system answers', async () => {
    expect(await probeOrigins(['https://a.synthetic.invalid'], answering(200))).toBe('reachable');
  });

  it('is reachable on a 404: the system answered, it just had nothing there', async () => {
    // A 404 from a live system is a live system. Treating it as unreachable would put a
    // running Target System in the same state as one nobody can talk to.
    expect(await probeOrigins(['https://a.synthetic.invalid'], answering(404))).toBe('reachable');
  });

  it('is unreachable on a 500', async () => {
    expect(await probeOrigins(['https://a.synthetic.invalid'], answering(503))).toBe('unreachable');
  });

  it('is unreachable when the call throws', async () => {
    expect(await probeOrigins(['https://a.synthetic.invalid'], refusing)).toBe('unreachable');
  });

  it('is reachable when ANY allowlisted origin answers', async () => {
    // The origins are an allowlist of places the agent may go, not a list of things that
    // must all be up.
    let call = 0;
    const secondWorks: Fetcher = async () => {
      call += 1;
      if (call === 1) throw new Error('ECONNREFUSED');
      return { ok: true, status: 200 };
    };
    expect(
      await probeOrigins(['https://down.synthetic.invalid', 'https://up.synthetic.invalid'], secondWorks),
    ).toBe('reachable');
  });

  it('stops at the first origin that answers', async () => {
    let calls = 0;
    const counting: Fetcher = async () => {
      calls += 1;
      return { ok: true, status: 200 };
    };
    await probeOrigins(['https://a.synthetic.invalid', 'https://b.synthetic.invalid'], counting);
    expect(calls).toBe(1);
  });

  it('says there is nothing to probe when the registration names no origin', async () => {
    // A desktop system has an application identity and no origin. Writing "unreachable"
    // would be a claim the probe cannot support; the surface keeps saying "Never probed",
    // which is true.
    expect(await probeOrigins([], answering(200))).toBe('no-probeable-origin');
  });

  it('refuses to fetch a scheme that is not http or https', async () => {
    let calls = 0;
    const counting: Fetcher = async () => {
      calls += 1;
      return { ok: true, status: 200 };
    };
    expect(await probeOrigins(['file:///etc/passwd', 'ftp://a.synthetic.invalid'], counting)).toBe(
      'no-probeable-origin',
    );
    expect(calls).toBe(0);
  });

  it('treats an origin that is not a URL as nothing to probe, never as a failure', async () => {
    expect(await probeOrigins(['not a url at all'], answering(200))).toBe('no-probeable-origin');
  });

  it('probes the http origins and ignores the ones it cannot', async () => {
    let calls = 0;
    const counting: Fetcher = async (origin) => {
      calls += 1;
      expect(origin).toBe('https://ok.synthetic.invalid');
      return { ok: true, status: 200 };
    };
    expect(await probeOrigins(['file:///etc/passwd', 'https://ok.synthetic.invalid'], counting)).toBe(
      'reachable',
    );
    expect(calls).toBe(1);
  });

  it('gives up on a call that never answers', async () => {
    // Without a deadline one unresponsive system parks the whole sweep. The signal is the
    // mechanism, so a fetcher that honours it is what a real one must do.
    const hanging: Fetcher = (_origin, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    expect(await probeOrigins(['https://slow.synthetic.invalid'], hanging, 10)).toBe('unreachable');
  });

  it('bounds the wait by default', () => {
    expect(PROBE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
