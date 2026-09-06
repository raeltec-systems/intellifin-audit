import { randomUUID } from 'node:crypto';

import { Solari, SolariError } from '@solarisdk/browser';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright-core';

import {
  BrowserActionError,
  WorkspaceProvisionError,
  type BrowserActionFailureCode,
  type BrowserActionResult,
  type BrowserExecution,
  type BrowserToolAction,
  type WorkspaceDenial,
  type WorkspaceEgressPolicy,
  type WorkspaceHandle,
  type WorkspaceMode,
  type WorkspaceRef,
} from '@intellifin/application';
import { sanitizeDestination, withinFrozenOrigin } from '@intellifin/domain';

import { withinOrigin } from './origin-policy.js';

/**
 * The ONE implementation of `BrowserExecution` (Story 4.1, AD-4).
 *
 * **Solari and Playwright were never alternatives.** Solari is a managed remote browser
 * and you drive it WITH the Playwright client API: `sessions.create()` hands back a
 * wire-protocol endpoint and `chromium.connect()` connects to it. So there is one
 * implementation, written against the Playwright client, and where the browser runs is a
 * composition-root choice. Two implementations would be two answers to one question, and
 * the second would be the one nobody kept honest.
 *
 * It deliberately uses `sessions.create()` + `chromium.connect()` rather than
 * `solari.launch()`. `launch()` returns a `BrowserSession` whose `raw`, `contexts()` and
 * `newPage()` are typed against the SDK's own bundled **`patchright-core`**, a separate
 * package from `playwright-core` with separately declared, structurally similar types. The
 * two modes would then hold two different `Browser` types that do not assign to each
 * other, and the only ways out are a second code path or an `as` — the first is what this
 * story exists not to have, and the second papers over a real difference. `Session` itself
 * is four strings (`id`, `wsEndpoint`, `cdpEndpoint`, `expiresAt`), so nothing typed
 * against the fork crosses this module at all.
 *
 * `launch()`'s post-connect health probe is not lost by that choice: connecting is followed
 * immediately by `newContext` plus two route installations, which are three protocol round
 * trips, so a browser that answered the connection and is dead fails HERE rather than at
 * Story 4.2's first navigation.
 *
 * **What each mode actually guarantees** (`epic-4-browser-provider-decision.md`):
 *
 * | | `local` | `solari` |
 * |---|---|---|
 * | Cookies, storage, cache, session, per Run | Isolated by browser context | Isolated, separate managed browser |
 * | Process isolation | **None. One worker process.** | Provider-side, separate from the worker |
 * | Egress control | Inside the browser, by request interception | Provider-side egress, plus interception |
 *
 * The weaker sentence is the one written wherever the guarantee is claimed. `local` gives
 * the browser-state half and not the sandbox half, and this module never says otherwise.
 *
 * **Escalation features stay OFF, named rather than defaulted.** See `SESSION_OPTIONS`.
 */

/** Where the browser runs. `recording` is an Epic 5 constraint honoured here; see below. */
export interface SolariConnection {
  readonly mode: 'solari';
  readonly apiKey: string;
  /** Defaults to the SDK's own default region when absent. */
  readonly region?: string | undefined;
  /** A staging or self-hosted gateway. Replaces `region` when set. */
  readonly baseUrl?: string | undefined;
  /**
   * Session replay, which CANNOT be enabled later.
   *
   * The replay endpoint 404s forever for a session created without it, and the decision is
   * taken at `sessions.create()` — which is this story's code, while Epic 5 is what reads
   * a replay. So the flag is threaded through now even though nothing reads one yet.
   */
  readonly recording: boolean;
}
export interface LocalConnection {
  readonly mode: 'local';
}
export type BrowserConnection = SolariConnection | LocalConnection;

/**
 * How many denied destinations one workspace keeps for the next drain.
 *
 * A bound on the RECORD, never on the enforcement: every request outside the frozen
 * origins is aborted whether or not there is room to describe it, and `denied()` keeps the
 * exact total beside this bounded sample — the `run_gate_check` shape, and for the same
 * reason.
 */
export const WORKSPACE_DENIAL_SAMPLE = 100;

/** How long a page has to close before the release stops waiting for it. */
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * The Solari session options, written out so every one of them is a decision.
 *
 * - `proxy` — ABSENT. `proxy: "smart"` runs an escalation ladder and swaps the egress in
 *   place when it detects a block page. That is the exact opposite of confining a Run to
 *   its Procedure Version's frozen allowed origins, so it is not a configuration flag this
 *   deployment exposes; enabling it would be a scope decision with an audit consequence.
 * - `stealth` — ABSENT. It is the prerequisite for `proxy` and `captcha`, and the Target
 *   Systems here are synthetic services that ask nothing of it.
 * - `captcha` — ABSENT. Managed captcha solving is a third party acting inside an audit
 *   Run; nothing in this platform's evidence model can describe what it did.
 * - `profileId` — ABSENT, and `solari.profiles.save()` is never called. Cookies and
 *   `localStorage` persist server-side only with a named profile, so naming none is what
 *   makes every session start clean — which is exactly what per-Run isolation wants. A
 *   later "resume where the agent left off" story would be choosing to weaken it.
 * - `webBotAuth` — ABSENT. It signs outbound requests to a bot directory, which is a
 *   claim about this platform's identity that nobody has authorized it to make.
 *
 * `recording` is the only one supplied, and it is supplied because it cannot be turned on
 * afterwards.
 */
function sessionOptions(connection: SolariConnection): { recording?: boolean } {
  return connection.recording ? { recording: true } : {};
}

/**
 * The scheme, authority and path of a destination — never its query, fragment or body.
 *
 * This value is written into the immutable audit chain as a security event, and anything
 * that enters the chain can never be taken out. A query string is where a session token,
 * a signed URL or a record identifier lives, so it is removed here rather than trusted to
 * be absent.
 */
export function safeDestination(url: string): string {
  return sanitizeDestination(url);
}

/**
 * The frozen egress allowlist, compiled once, as a predicate over a destination.
 *
 * The rule is `withinOrigin`'s — the same authority-plus-path-boundary rule the adapter
 * path applies to a frozen Target System — because "stay inside the frozen origins" is one
 * rule of this product and two copies of it would agree on every value anybody thought to
 * try. An allowed origin here is a base URL that may include a path prefix
 * (`http://localhost:4300/loancore`), so `/loancore-other` is outside `/loancore`.
 *
 * A frozen origin this build cannot parse REFUSES the whole workspace rather than being
 * dropped: a partial allowlist is a workspace confined to less than the Version said, and
 * a silently narrower allowlist would look like a Target System that was simply down.
 *
 * An EMPTY allowlist denies everything, which is the correct reading of a plan that names
 * no web Target System — a desktop-only Run, whose registration slot holds an application
 * identity rather than an origin.
 */
export function egressPolicy(policy: WorkspaceEgressPolicy): (destination: string) => boolean {
  const origins = policy.allowedOrigins.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new WorkspaceProvisionError('policy');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new WorkspaceProvisionError('policy');
    }
    if (parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') {
      throw new WorkspaceProvisionError('policy');
    }
    return parsed;
  });
  return (destination: string): boolean => {
    let candidate: URL;
    try {
      candidate = new URL(destination);
    } catch {
      return false;
    }
    // A fragment never goes on the wire, so a candidate carrying one is normalized rather
    // than refused: `withinOrigin` rejects a non-empty hash, which is right for a location
    // this platform chose to fetch and wrong for a URL a browser handed back.
    candidate.hash = '';
    return origins.some((origin) => withinOrigin(origin, candidate));
  };
}

/** A live workspace, plus the Playwright context Story 4.2 will drive. */
export interface PlaywrightWorkspace extends WorkspaceHandle {
  /**
   * The browser context this workspace owns.
   *
   * Deliberately NOT on the `BrowserExecution` port: `packages/application` has no host
   * types at all, which is the compiler-enforced half of AD-11, so no Playwright type may
   * cross that boundary. Story 4.2 adds the actions it needs to the port as structural
   * commands; this is what the implementation drives them with.
   */
  readonly context: BrowserContext;
}

interface LiveWorkspace {
  readonly ref: WorkspaceRef;
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly handle: PlaywrightWorkspace;
  /** The ONE page this workspace drives, made on the first Tool Action. */
  page: Page | null;
  /** Downloads this workspace was offered. Offered, and never executed. */
  downloads: number;
  /**
   * The credential a Tool Action is presenting RIGHT NOW, and the origin it may reach.
   *
   * `setExtraHTTPHeaders` would put the header on every request the page makes until it is
   * cleared — including, once a plan names two web Target Systems, requests to the OTHER
   * one, because the egress allowlist is the union of their frozen origins. So the header
   * is attached in the interception instead, to requests inside the destination's OWN
   * frozen origin only, and dropped the moment the action finishes. Story 4.3 owns the full
   * just-in-time guarantee; this is the narrowest surface it can have meanwhile.
   */
  credential: { origin: string; headers: Record<string, string> } | null;
  /** The workspace's compiled egress allowlist, so an action can ask it too. */
  readonly allowed: (destination: string) => boolean;
}

export class PlaywrightBrowserExecution implements BrowserExecution {
  readonly mode: WorkspaceMode;
  private readonly live = new Map<string, LiveWorkspace>();
  private solari: Solari | null = null;

  constructor(private readonly connection: BrowserConnection) {
    this.mode = connection.mode;
  }

  /**
   * The Solari client, built the first time a workspace actually needs one.
   *
   * Lazy because it is the privileged object: it holds the deployment's API key and starts
   * a loopback proxy server. "Build a privileged object only where it is used" — the same
   * reason `PostgresIdentityUnitOfWork` stopped constructing the one sign-up-capable auth
   * instance on every identity transaction.
   */
  private client(): Solari {
    if (this.connection.mode !== 'solari') throw new WorkspaceProvisionError('policy');
    this.solari ??= new Solari({
      apiKey: this.connection.apiKey,
      ...(this.connection.baseUrl === undefined
        ? this.connection.region === undefined
          ? {}
          : { region: this.connection.region as 'us-west' }
        : { baseUrl: this.connection.baseUrl }),
    });
    return this.solari;
  }

  async create(input: {
    readonly runId: string;
    readonly policy: WorkspaceEgressPolicy;
    readonly timeoutMs: number;
  }): Promise<PlaywrightWorkspace> {
    // Compiled BEFORE anything is provisioned: a frozen allowlist this build cannot read
    // must not cost a provider session to discover.
    const allowed = egressPolicy(input.policy);
    const timeout = Math.max(1, Math.min(input.timeoutMs, 600_000));

    let browser: Browser;
    let workspaceId: string;
    // The provider's HARD deadline: Solari auto-releases the session at `expiresAt`, and
    // nothing a Run does resets it. A locally launched browser has no such deadline — it
    // lives exactly as long as this process does — so `null` is the truth there rather than
    // an invented far-future timestamp.
    let expiresAt: string | null = null;
    try {
      if (this.connection.mode === 'solari') {
        const session = await this.client().sessions.create(sessionOptions(this.connection));
        workspaceId = session.id;
        expiresAt = session.expiresAt;
        try {
          browser = await chromium.connect(session.wsEndpoint, { timeout });
        } catch (error) {
          // The session exists and nothing can drive it. Give the slot back rather than
          // holding it until the provider's own grace timer reaps it. Fire-and-forget is
          // right HERE and only here: no row has been written, so nothing is about to
          // claim the release happened. A Run's terminal transition uses `releaseAndWait`,
          // because a row saying RELEASED while the provider still holds the session is
          // exactly the kind of untrue record this platform must not write.
          this.client().sessions.release(workspaceId);
          throw error;
        }
      } else {
        workspaceId = randomUUID();
        browser = await chromium.launch({ timeout });
      }
    } catch (error) {
      throw provisionFailure(error);
    }

    try {
      // One context per workspace, owned here. `serviceWorkers: 'block'` because a service
      // worker's own fetches are NOT seen by `context.route`, so a page that registered one
      // would have an unpoliced path to the network — the interception has to be the only
      // way out, not the usual way out.
      // `acceptDownloads: false` so a file the site offers is CANCELLED rather than
      // written: an audit Run reads, and a download is neither read nor executed. The
      // `download` event still fires, which is what lets a Tool Action record that one was
      // offered — "handled per the conformance contract, never executed".
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      // Filled in below, once the handle exists. The route handler closes over it so a
      // credential can be attached to one action's own requests and to nothing else.
      let live: LiveWorkspace | null = null;
      const denials: WorkspaceDenial[] = [];
      let deniedTotal = 0;
      const deny = (destination: string, method: string, resourceType: string): void => {
        deniedTotal += 1;
        if (denials.length < WORKSPACE_DENIAL_SAMPLE) {
          denials.push({ destination: safeDestination(destination), method, resourceType });
        }
      };
      // Every request, by predicate rather than by glob: a glob is a second language for
      // the same intent and `**/*` has its own opinions about what a path is.
      await context.route(
        () => true,
        async (route: Route) => {
          const request = route.request();
          const url = request.url();
          if (allowed(url)) {
            const presenting = live?.credential ?? null;
            // Only inside the destination's OWN frozen origin. A second web Target System
            // is inside the workspace's allowlist and must never receive the first one's
            // credential.
            if (presenting !== null && withinFrozenOrigin(presenting.origin, url)) {
              await route.continue({ headers: { ...request.headers(), ...presenting.headers } });
              return;
            }
            await route.continue();
            return;
          }
          deny(url, request.method(), request.resourceType());
          // Aborted in the browser, so nothing is ever put on the wire. Under Solari the
          // provider's own egress is a second boundary; under `local` this is the only one.
          await route.abort('blockedbyclient');
        },
      );
      // A WebSocket handshake is NOT a `route()` request, so without this a page could open
      // one to any host and the allowlist would never see it. Only the disallowed ones are
      // routed: a handler that never calls `connectToServer` leaves the socket unconnected.
      await context.routeWebSocket(
        (url: URL) => !allowed(url.toString()),
        (ws) => {
          deny(ws.url(), 'WEBSOCKET', 'websocket');
          ws.close({ code: 1008, reason: 'Outside the frozen allowed origins' });
        },
      );

      const ref: WorkspaceRef = { runId: input.runId, workspaceId, mode: this.mode };
      const handle: PlaywrightWorkspace = {
        ref,
        expiresAt,
        context,
        takeDenials: () => denials.splice(0, denials.length),
        denied: () => deniedTotal,
      };
      live = { ref, browser, context, handle, page: null, downloads: 0, credential: null, allowed };
      this.live.set(workspaceId, live);
      return handle;
    } catch (error) {
      await this.teardown(workspaceId, browser, null);
      throw provisionFailure(error);
    }
  }

  async attach(ref: WorkspaceRef): Promise<PlaywrightWorkspace | null> {
    const live = this.live.get(ref.workspaceId);
    // A workspace belongs to ONE Run and to one mode. An identity that matches on the
    // string alone but names another Run is not this Run's workspace.
    if (!live || live.ref.runId !== ref.runId || live.ref.mode !== ref.mode) return null;
    if (!live.browser.isConnected()) {
      this.live.delete(ref.workspaceId);
      return null;
    }
    return live.handle;
  }

  /**
   * Release a workspace and revoke its credentials. Idempotent, by identity.
   *
   * A workspace this process does not hold is still released at the provider when this
   * process can reach it — that is the whole point of carrying the provider identity on
   * the checkpoint. What it CANNOT do is release a Solari session while configured for the
   * local mode: the key is gone, the session is genuinely still held, and saying so by
   * throwing is honest where resolving silently would record a release that never happened.
   */
  async release(ref: WorkspaceRef, timeoutMs: number): Promise<void> {
    const bound = Math.max(1, Math.min(timeoutMs, CLOSE_TIMEOUT_MS));
    const live = this.live.get(ref.workspaceId);
    if (live && live.ref.runId === ref.runId) {
      await this.teardown(ref.workspaceId, live.browser, live.context, bound);
    }
    if (ref.mode !== 'solari') return;
    if (this.connection.mode !== 'solari') {
      throw new Error('This process cannot release a Solari workspace: no provider is configured');
    }
    try {
      await this.client().sessions.releaseAndWait(ref.workspaceId);
    } catch (error) {
      // A session the provider no longer knows about is already released, which is the
      // outcome asked for. Anything else is a real failure and the row stays open.
      if (error instanceof SolariError && (error.code === 'InvalidSessionId' || error.status === 404)) {
        return;
      }
      throw error;
    }
  }

  /**
   * Perform ONE Tool Action the gate has already authorized (Story 4.2).
   *
   * The GATE is not here. `authorizeToolAction` runs at the port's call site in
   * `packages/application`, so this implementation cannot skip it and a second provider
   * would inherit the decision rather than reimplement it. What lives here is the
   * MECHANISM: the credential presented just in time and withdrawn immediately, the
   * request interception that is already installed, and the reading of what the browser
   * actually did.
   *
   * A destination the frozen allowlist does not cover is aborted inside the browser and
   * never put on the wire — including a destination a server-chosen redirect points at,
   * which is what makes "a 3xx to another origin is not followed" a property of the
   * mechanism rather than a check somebody remembered. The workspace's exact denial COUNT
   * is what distinguishes that from a network fault: it is read before and after, so a
   * refusal is reported as `scope` and never as an outage.
   */
  async perform(
    ref: WorkspaceRef,
    action: BrowserToolAction,
    timeoutMs: number,
  ): Promise<BrowserActionResult> {
    const live = this.live.get(ref.workspaceId);
    // A workspace belongs to ONE Run and to one mode, exactly as `attach` requires.
    if (!live || live.ref.runId !== ref.runId || live.ref.mode !== ref.mode) {
      throw new BrowserActionError('unavailable');
    }
    if (!live.browser.isConnected()) {
      this.live.delete(ref.workspaceId);
      throw new BrowserActionError('unavailable');
    }
    const timeout = Math.max(1, Math.min(timeoutMs, 600_000));
    const before = live.handle.denied();

    let page: Page;
    try {
      page = await this.pageFor(live);
    } catch {
      throw new BrowserActionError('unavailable');
    }

    // The credential exists here for the length of ONE navigation. `authorize` is the only
    // way it can be read, it writes into a record this method owns, and it is dropped in
    // the `finally` — a workspace that kept it would present the credential on every later
    // request of the Run, which is the opposite of just in time. The interception attaches
    // it, not `setExtraHTTPHeaders`, so it reaches the destination's own frozen origin and
    // nothing else the allowlist happens to cover.
    const headers: Record<string, string> = {};
    action.credential?.authorize({
      set: (name: string, value: string) => {
        headers[name] = value;
      },
    });
    live.credential =
      Object.keys(headers).length > 0 ? { origin: action.destination, headers } : null;

    let response: Awaited<ReturnType<Page['goto']>>;
    try {
      response = await page.goto(action.destination, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
    } catch (error) {
      throw actionFailure(error, live.handle.denied() > before);
    } finally {
      live.credential = null;
    }
    // `null` is a same-document navigation, which is not something this platform asked
    // for and not something it can record a status for.
    if (response === null) throw new BrowserActionError('contract');
    // Where the navigation ENDED, against the frozen allowlist rather than against the
    // destination: a same-origin redirect is legitimate and lands somewhere the action did
    // not name. The interception should already have aborted anything else; this is the
    // second lock on that door.
    //
    // Deliberately NOT `denied() > before`. That counts every request the workspace
    // refused during the navigation, and a page referencing a font, a beacon or an image
    // off-origin is ordinary — failing the Tool Action for it would report `scope` for
    // something the PLATFORM never attempted. Those denials are still recorded, as the
    // security events the workspace drains at its own transaction boundaries.
    if (!live.allowed(page.url())) throw new BrowserActionError('scope');

    const location = safeDestination(page.url());
    return {
      status: response.status(),
      location,
      redirected: response.request().redirectedFrom() !== null,
      downloads: live.downloads,
      // "The session held in the workspace", read from the workspace rather than believed:
      // a cookie for the destination's own origin is what a later request will carry.
      session: (await live.context.cookies(action.destination)).length > 0,
    };
  }

  /**
   * The ONE page a workspace drives, made on its first Tool Action.
   *
   * One page, because the session lives in the CONTEXT's cookie jar and a page per action
   * would lose nothing but would make "what the workspace is looking at" a question with
   * several answers.
   */
  private async pageFor(live: LiveWorkspace): Promise<Page> {
    if (live.page !== null && !live.page.isClosed()) return live.page;
    const page = await live.context.newPage();
    // Counted, never accepted: `acceptDownloads: false` cancels it and this records that
    // the Target System offered one.
    page.on('download', () => {
      live.downloads += 1;
    });
    live.page = page;
    return page;
  }

  /**
   * Release this process's own provider resources. Called by the composition root only.
   *
   * `solari.close()` is REQUIRED in Node and `browser.close()` is not enough: the client
   * keeps a loopback proxy server open for its connection-retry path, and that handle keeps
   * the event loop alive — a worker that closes only the browser never exits. The same
   * defect class as an unread `fetch` body holding a socket (Story 1.8) and a deadline's
   * `dispose` that cleared the timer without aborting (PR 23), so it is a shutdown step
   * rather than a happy-path call.
   */
  async close(): Promise<void> {
    for (const [id, live] of [...this.live]) {
      await this.teardown(id, live.browser, live.context);
    }
    await this.solari?.close().catch(() => undefined);
    this.solari = null;
  }

  private async teardown(
    workspaceId: string,
    browser: Browser,
    context: BrowserContext | null,
    timeoutMs: number = CLOSE_TIMEOUT_MS,
  ): Promise<void> {
    this.live.delete(workspaceId);
    if (context) await withTimeout(context.close(), timeoutMs);
    await withTimeout(browser.close(), timeoutMs);
  }
}

/** A close that cannot hang the worker's shutdown on a browser that has stopped answering. */
async function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Why a Tool Action failed, as the closed vocabulary the stage acts on.
 *
 * `blocked` is the workspace's own denial counter having moved, which is the only
 * trustworthy way to tell "the allowlist aborted this" from "the network broke": Chromium
 * reports both as an aborted navigation, and calling a refusal an outage is the mistake
 * Epic 3 already paid for.
 */
export function actionFailure(error: unknown, blocked: boolean): BrowserActionError {
  if (error instanceof BrowserActionError) return error;
  if (blocked) return new BrowserActionError('scope');
  const message = error instanceof Error ? error.message : '';
  // A navigation the browser refused for a reason that is not this platform's allowlist —
  // a bad scheme, a certificate, a protocol error. Not an outage to chase and not
  // something a retry against the same frozen bytes would answer differently.
  const code: BrowserActionFailureCode = /ERR_UNKNOWN_URL_SCHEME|ERR_INVALID_URL/.test(message)
    ? 'contract'
    : 'unavailable';
  return new BrowserActionError(code);
}

/**
 * `SolariErrorCode`, mapped onto the failure vocabulary the stage retries against.
 *
 * The five codes are NOT one class, and folding them together would put a wall and a
 * hiccup in the same durable record:
 *
 * - `ConcurrencyLimitExceeded` — every slot is busy right now. Capacity, retried.
 * - `BrowserUnhealthy` — a browser that answered and is not usable. Retried, and the
 *   natural response is a FRESH session rather than a reattach, which is what a retry
 *   through the command does.
 * - `FeatureRequiresPlan`, `PlanLimitExceeded` — refusals. They answer identically on
 *   every attempt, so retrying spends the Session Step budget against a wall (the
 *   `credential-unresolved` rule from Story 3.3).
 * - `InvalidSessionId` — the stored identity is gone. On a release that is the outcome
 *   asked for and is handled there; reaching this mapping it is a refusal, not an outage.
 */
const SOLARI_FAILURES: Readonly<Record<string, WorkspaceProvisionError['code']>> = {
  ConcurrencyLimitExceeded: 'capacity',
  BrowserUnhealthy: 'unavailable',
  FeatureRequiresPlan: 'entitlement',
  PlanLimitExceeded: 'entitlement',
  InvalidSessionId: 'refused',
};

/**
 * Why provisioning failed, as the closed vocabulary the stage retries against.
 *
 * An error that is not a `SolariError` at all — a socket reset, a DNS failure, a locally
 * launched Chromium that would not start — is an outage and is retried. A `SolariError`
 * whose code this build does not recognise is NOT: `SolariErrorCode` is widened with
 * `| string`, so a later provider release can name a reason nobody here has read, and
 * calling it transient would retry it four times on the strength of not knowing what it is.
 */
export function provisionFailure(error: unknown): WorkspaceProvisionError {
  if (error instanceof WorkspaceProvisionError) return error;
  if (error instanceof SolariError) {
    const code = error.code;
    if (typeof code === 'string' && Object.hasOwn(SOLARI_FAILURES, code)) {
      return new WorkspaceProvisionError(SOLARI_FAILURES[code]!);
    }
    if (error.status === 401 || error.status === 402 || error.status === 403) {
      return new WorkspaceProvisionError('entitlement');
    }
    if (error.status === 429 || error.status === 503) {
      return new WorkspaceProvisionError('capacity');
    }
    return new WorkspaceProvisionError('refused');
  }
  return new WorkspaceProvisionError('unavailable');
}
