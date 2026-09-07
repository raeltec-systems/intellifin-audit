import { describe, expect, it } from 'vitest';
import { SolariError } from '@solarisdk/browser';
import { NO_CREDENTIALS, WorkspaceProvisionError } from '@intellifin/application';

import {
  PlaywrightBrowserExecution,
  egressPolicy,
  provisionFailure,
  safeDestination,
} from './browser-execution.js';
import { resolvedCredential } from './credential-resolver.js';
import { completionForWebTree } from './web-tree-capture.js';

/**
 * The pure halves of the Agent Workspace implementation.
 *
 * The interception itself is proved against a REAL Chromium and a real HTTP server in
 * `tests/integration/agent-workspace.test.ts` — a policy predicate that agrees with a test
 * proves nothing about whether a request left the machine. What is pinned here is the
 * judgement that predicate makes, the shape of what a denial is allowed to record, and the
 * mapping from a provider error onto the vocabulary the stage retries against.
 */

const ORIGIN = 'https://synthetic.invalid/loancore';

describe('the frozen egress allowlist', () => {
  const allowed = egressPolicy({ allowedOrigins: [ORIGIN] });

  it('permits the frozen origin and everything under it on a path boundary', () => {
    expect(allowed('https://synthetic.invalid/loancore')).toBe(true);
    expect(allowed('https://synthetic.invalid/loancore/employees')).toBe(true);
    expect(allowed('https://synthetic.invalid/loancore/employees?q=1')).toBe(true);
  });

  it('denies a sibling path, another host, another scheme and a port change', () => {
    // The path boundary, not a prefix: one synthetic process serves every synthetic system.
    expect(allowed('https://synthetic.invalid/loancore-other')).toBe(false);
    expect(allowed('https://elsewhere.invalid/loancore')).toBe(false);
    expect(allowed('http://synthetic.invalid/loancore')).toBe(false);
    expect(allowed('https://synthetic.invalid:8443/loancore')).toBe(false);
  });

  it('denies a destination carrying credentials, and every non-http scheme', () => {
    expect(allowed('https://user:pass@synthetic.invalid/loancore')).toBe(false);
    expect(allowed('data:text/html,<b>x</b>')).toBe(false);
    expect(allowed('file:///etc/passwd')).toBe(false);
    expect(allowed('not a url at all')).toBe(false);
  });

  it('normalizes a fragment away rather than denying the request that carries one', () => {
    // A fragment never goes on the wire. `withinOrigin` refuses one, which is right for a
    // location this platform CHOSE to fetch and wrong for a URL a browser handed back.
    expect(allowed('https://synthetic.invalid/loancore/employees#row-3')).toBe(true);
  });

  it('denies everything when the plan names no web Target System', () => {
    const nothing = egressPolicy({ allowedOrigins: [] });
    expect(nothing('https://synthetic.invalid/loancore')).toBe(false);
    expect(nothing('about:blank')).toBe(false);
  });

  it('refuses the whole workspace when a frozen origin cannot be read', () => {
    // A partial allowlist is a workspace confined to less than the Version said, and a
    // silently narrower one looks exactly like a Target System that was simply down.
    for (const origin of ['not a url', 'ftp://synthetic.invalid/x', 'https://u:p@x.invalid/y']) {
      expect(() => egressPolicy({ allowedOrigins: [ORIGIN, origin] })).toThrow(
        WorkspaceProvisionError,
      );
    }
    expect(() => egressPolicy({ allowedOrigins: ['not a url'] })).toThrow(
      expect.objectContaining({ code: 'policy' }),
    );
  });
});

describe('what a denial is allowed to record', () => {
  it('keeps the scheme, authority and path and drops the query and fragment', () => {
    // The value goes into the immutable chain, and a query string is where a session
    // token, a signed URL or a record identifier lives.
    expect(safeDestination('https://elsewhere.invalid/steal?token=abc#frag')).toBe(
      'https://elsewhere.invalid/steal',
    );
    expect(safeDestination('https://user:pass@elsewhere.invalid/x')).toBe(
      'https://elsewhere.invalid/x',
    );
  });

  it('says so in words when a destination cannot be parsed', () => {
    expect(safeDestination('::::')).toBe('(unparseable destination)');
  });

  it('is bounded, because a chain row cannot be taken back out', () => {
    expect(safeDestination(`https://elsewhere.invalid/${'a'.repeat(4000)}`).length).toBe(500);
  });
});

describe('a provider failure, mapped onto the retry vocabulary', () => {
  it('retries capacity and an unhealthy browser', () => {
    expect(provisionFailure(new SolariError('busy', 429, undefined, 'ConcurrencyLimitExceeded')).code)
      .toBe('capacity');
    expect(provisionFailure(new SolariError('sick', undefined, undefined, 'BrowserUnhealthy')).code)
      .toBe('unavailable');
  });

  it('never retries a plan refusal, which will refuse identically every time', () => {
    expect(provisionFailure(new SolariError('no', 402, undefined, 'FeatureRequiresPlan')).code)
      .toBe('entitlement');
    expect(provisionFailure(new SolariError('no', 402, undefined, 'PlanLimitExceeded')).code)
      .toBe('entitlement');
    expect(provisionFailure(new SolariError('no', 403)).code).toBe('entitlement');
  });

  it('fails closed on a provider code this build has never read', () => {
    // `SolariErrorCode` is widened with `| string`. Calling an unknown reason transient
    // would retry it four times on the strength of not knowing what it is.
    expect(provisionFailure(new SolariError('?', 500, undefined, 'RegionDrained2029')).code)
      .toBe('refused');
    expect(provisionFailure(new SolariError('?', 500)).code).toBe('refused');
  });

  it('treats anything that is not a provider error as an outage', () => {
    expect(provisionFailure(new Error('ECONNRESET')).code).toBe('unavailable');
    expect(provisionFailure('nonsense').code).toBe('unavailable');
  });

  it('passes an existing provision error through unchanged', () => {
    const original = new WorkspaceProvisionError('policy');
    expect(provisionFailure(original)).toBe(original);
  });
});

describe('attaching and releasing without a live workspace', () => {
  const execution = new PlaywrightBrowserExecution({ mode: 'local' });

  it('answers nothing for an identity this process does not hold', async () => {
    // Expected rather than exceptional: a browser does not survive the process that
    // connected to it, so a worker that died holding one cannot reattach to it.
    await expect(
      execution.attach({ runId: 'run-1', workspaceId: 'gone', mode: 'local' }),
    ).resolves.toBeNull();
  });

  it('releases a local identity it does not hold, because that browser is already gone', async () => {
    await expect(
      execution.release({ runId: 'run-1', workspaceId: 'gone', mode: 'local' }, 1000),
    ).resolves.toBeUndefined();
  });

  it('refuses to pretend it released a Solari session it cannot reach', async () => {
    // Recording a release that never happened would leave the row saying the slot was
    // given back while the provider holds it to its own deadline.
    await expect(
      execution.release({ runId: 'run-1', workspaceId: 'sess-1', mode: 'solari' }, 1000),
    ).rejects.toThrow(/cannot release a Solari workspace/);
  });

  it('reports the mode a composition root actually gave it', () => {
    expect(execution.mode).toBe('local');
    expect(
      new PlaywrightBrowserExecution({ mode: 'solari', apiKey: 'slr_live_x', recording: true }).mode,
    ).toBe('solari');
  });
});

describe('capture during credential use', () => {
  const execution = new PlaywrightBrowserExecution({ mode: 'local' });
  const ref = { runId: 'run-1', workspaceId: 'gone', mode: 'local' as const };
  const credential = resolvedCredential('cred://a', 'synthetic-token-never-store-me');

  it('refuses a credential-entry action that asks for capture, before anything else', async () => {
    // The `BrowserToolAction` union makes this not compile, so the only way to reach it is
    // the way a real defect would: a cast past the union, or a JavaScript caller. Refusing
    // it in the MECHANISM is what makes suppression a guarantee rather than a promise —
    // "a structural type does not CONTAIN anything" is a lesson this codebase has already
    // paid for once.
    for (const capture of [['screenshot'], ['structural-snapshot'], ['frame'], ['screenshot', 'frame']]) {
      await expect(
        execution.perform(
          ref,
          { action: 'navigate', destination: 'http://localhost:4300/loancore', credential, capture } as never,
          1000,
        ),
      ).rejects.toMatchObject({ code: 'contract' });
    }
  });

  it('does not refuse a credential-entry action that asks for nothing', async () => {
    // The refusal is about CAPTURE, not about credentials: the sign-in itself must still
    // reach the workspace, and here it gets as far as the liveness check and reports the
    // workspace it cannot find — which is the next thing that is wrong, not this one.
    await expect(
      execution.perform(
        ref,
        { action: 'navigate', destination: 'http://localhost:4300/loancore', credential },
        1000,
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
    // An empty request from a caller that cast is the same: nothing was asked for.
    await expect(
      execution.perform(
        ref,
        { action: 'navigate', destination: 'http://localhost:4300/loancore', credential, capture: [] } as never,
        1000,
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('leaves an action with no credential free to ask for capture', async () => {
    // Story 4.4 is what implements capture; the suppression is what this story owns, and it
    // must not turn into "nothing may ever be captured".
    await expect(
      execution.perform(
        ref,
        {
          action: 'navigate',
          destination: 'http://localhost:4300/loancore',
          credential: null,
          capture: ['screenshot'],
        },
        1000,
        NO_CREDENTIALS,
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('requires a guard at the runtime capture seam', async () => {
    await expect(
      execution.perform(
        ref,
        {
          action: 'navigate',
          destination: 'http://localhost:4300/loancore',
          credential: null,
          capture: ['screenshot'],
        },
        1000,
      ),
    ).rejects.toMatchObject({ code: 'contract' });
  });

  it('refuses malformed or duplicate capture requests before workspace lookup', async () => {
    const requests: readonly { readonly capture: unknown }[] = [
      { capture: ['screenshot', 'screenshot'] },
      { capture: ['structural-snapshot', 'screenshot', 'frame'] },
      { capture: 'screenshot' },
      { capture: [null] },
    ];
    for (const request of requests) {
      await expect(
        execution.perform(
          ref,
          { action: 'navigate', destination: 'http://localhost:4300/loancore', credential: null, ...request } as never,
          1000,
          NO_CREDENTIALS,
        ),
      ).rejects.toMatchObject({ code: 'contract' });
    }
  });
});

describe('LoanCore web-tree completion metadata', () => {
  const base = {
    schemaVersion: 1 as const,
    nodes: [
      {
        group: 'page',
        role: 'status' as const,
        label: 'result-summary',
        value: 'Showing 1 of 1 matching accounts.',
        target: null,
      },
    ],
  };

  it('keeps the target declared total and marks a complete result', () => {
    expect(completionForWebTree(base).completion).toEqual({ complete: true, returned: 1 });
  });

  it('does not infer a total from rows or an empty result', () => {
    expect(completionForWebTree({ schemaVersion: 1, nodes: [] })).toEqual({ schemaVersion: 1, nodes: [] });
    expect(completionForWebTree({
      schemaVersion: 1,
      nodes: [{ ...base.nodes[0]!, value: 'Showing 1 of 24 matching accounts.' }],
    }).completion).toEqual({ complete: false, returned: 24 });
    expect(completionForWebTree({
      schemaVersion: 1,
      nodes: [{ ...base.nodes[0]!, value: 'Showing 1 matching account.' }],
    })).toEqual({
      schemaVersion: 1,
      nodes: [{ ...base.nodes[0]!, value: 'Showing 1 matching account.' }],
    });
  });
});
