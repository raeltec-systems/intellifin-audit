import { randomUUID } from 'node:crypto';

import { Solari, SolariError } from '@solarisdk/browser';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Response,
  type Route,
} from 'playwright-core';

import {
  BrowserActionError,
  WorkspaceProvisionError,
  type BrowserActionFailureCode,
  type BrowserActionArtifact,
  type BrowserActionResult,
  type BrowserExecution,
  type BrowserToolAction,
  type ResolvedCredential,
  type WorkspaceDenial,
  type WorkspaceEgressPolicy,
  type WorkspaceHandle,
  type WorkspaceMode,
  type WorkspaceRef,
} from '@intellifin/application';
import {
  sanitizeDestination,
  withinFrozenOrigin,
  WEB_TREE_MEDIA_TYPE,
} from '@intellifin/domain';

import { withinOrigin } from './origin-policy.js';
import { hasAuthenticatedAccount } from './authentication-proof.js';
import {
  assertActionDeadline,
  captureWebTree,
  isActionDeadlineExceeded,
  remainingActionTime,
  timeoutForDeadline,
  withActionDeadline,
} from './web-tree-capture.js';

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
 * What a caller asked to be captured, read through the union rather than around it.
 *
 * `capture` exists only on the arm with no credential, so this is `[]` for every
 * credential-entry action the type system permits — and reads whatever a caller that cast
 * past the union actually put there, which is the case the runtime refusal exists for.
 */
function requestedCapture(action: BrowserToolAction): readonly string[] {
  const requested = (action as { readonly capture?: unknown }).capture;
  if (requested === undefined) return [];
  if (!Array.isArray(requested)) throw new BrowserActionError('contract');
  return requested as readonly string[];
}

const BROWSER_CAPTURE_KINDS = new Set(['structural-snapshot', 'screenshot']);

/** Methods a page may issue without a Tool Action: no request-body write surface. */
const READ_ONLY_BROWSER_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The workspace route's method policy, kept pure for the unit boundary test. */
export function isReadOnlyBrowserMethod(method: string): boolean {
  return typeof method === 'string' && READ_ONLY_BROWSER_METHODS.has(method.toUpperCase());
}

type CaptureGuard = {
  readonly held: number;
  readonly discloses: (bytes: Uint8Array) => boolean;
  readonly redact: (text: string) => string;
};

function isCaptureGuard(value: unknown): value is CaptureGuard {
  try {
    if (value === null || typeof value !== 'object') return false;
    const guard = value as Partial<CaptureGuard>;
    return (
      typeof guard.discloses === 'function' &&
      typeof guard.redact === 'function' &&
      typeof guard.held === 'number' &&
      Number.isSafeInteger(guard.held) &&
      guard.held >= 0
    );
  } catch {
    return false;
  }
}

/** Refuse unknown capture names and the deferred frame capture at the browser boundary. */
function validateCaptureRequest(action: BrowserToolAction, guard: unknown): readonly string[] {
  const capture = requestedCapture(action);
  if (
    capture.length > 2 ||
    new Set(capture).size !== capture.length ||
    capture.some((kind) => typeof kind !== 'string' || !BROWSER_CAPTURE_KINDS.has(kind))
  ) {
    throw new BrowserActionError('contract');
  }
  if (capture.length === 0) return capture;
  if (!isCaptureGuard(guard)) throw new BrowserActionError('contract');
  return capture;
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
 * A full, query-free location for binding an action to the current page.
 *
 * `safeDestination` is intentionally bounded for immutable audit rows. It cannot be used
 * as the identity comparison here: two paths that differ after its bound would otherwise
 * compare equal. URL parsing keeps the full path while discarding only query/fragment data.
 */
function comparableLocation(raw: string): string | null {
  if (typeof raw !== 'string' || /[\s\u0000-\u001f\u007f]/u.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) return null;
    parsed.search = '';
    parsed.hash = '';
    return `${parsed.protocol}//${parsed.host}${parsed.pathname || '/'}`;
  } catch {
    return null;
  }
}

/**
 * Whether a current browser page is the exact sanitized location an approved read selected.
 *
 * Query strings are intentionally ignored here: a search result keeps its population query
 * in the live browser URL while the action log and gate carry only the query-free location.
 * Anything unparseable, or any different authority/path, fails closed before the page is
 * captured. The helper is pure so the location rule is unit-testable without a browser.
 */
export function currentPageLocationMatches(expected: string, actual: string): boolean {
  const expectedLocation = comparableLocation(expected);
  const actualLocation = comparableLocation(actual);
  return (
    expectedLocation !== null &&
    actualLocation !== null &&
    expectedLocation === actualLocation
  );
}

/** A current-page read's approved destination is query-free by construction. */
function isQueryFreeDestination(destination: string): boolean {
  try {
    const parsed = new URL(destination);
    return (
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * A configured authentication endpoint is a full HTTP(S) URL with no query, fragment or
 * URL credentials. The query-free rule prevents a signed or record URL from becoming part
 * of the frozen contract and gives the form guard one exact request target to compare with
 * the browser's resolved action.
 */
function isValidAuthenticationDestination(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2048 ||
    /[\s\u0000-\u001f\u007f]/u.test(value) ||
    !isQueryFreeDestination(value)
  ) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Read the optional caller-supplied frozen authentication endpoint without trusting its type. */
function requestedAuthenticationDestination(action: BrowserToolAction): unknown {
  return (action as BrowserToolAction & { readonly authenticationDestination?: unknown })
    .authenticationDestination;
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

interface ArmedAuthenticationPost {
  /** The page whose main frame is allowed to submit the form. */
  readonly page: Page;
  /** The form submitter's resolved action, including any target-owned query. */
  readonly destination: string;
  /** Used only to ask whether the in-flight body contains this credential. */
  readonly credential: ResolvedCredential;
  /** A login form may consume this exception exactly once. */
  used: boolean;
}

interface LiveWorkspace {
  readonly ref: WorkspaceRef;
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly handle: PlaywrightWorkspace;
  /** The ONE page this workspace drives, made on the first Tool Action. */
  page: Page | null;
  /**
   * The most recent main-frame response for the live page.
   *
   * A `read-attribute` action reads the page already produced by a preceding search or
   * navigation. Playwright has no response object for an action that deliberately does not
   * navigate, so retain the provider response in process memory for truthful status/method
   * metadata. It never crosses the application boundary or enters an audit row.
   */
  lastResponse: Response | null;
  /** A single, short-lived exception for the target's real credential form POST. */
  authPost: ArmedAuthenticationPost | null;
  /** Downloads this workspace was offered. Offered, and never executed. */
  downloads: number;
  /** The workspace's compiled egress allowlist, so an action can ask it too. */
  readonly allowed: (destination: string) => boolean;
}

/** Compare the exact resolved authentication URL without retaining a query in a record. */
function sameNavigationUrl(expected: string, actual: string): boolean {
  try {
    const expectedUrl = new URL(expected);
    const actualUrl = new URL(actual);
    expectedUrl.hash = '';
    actualUrl.hash = '';
    return expectedUrl.href === actualUrl.href;
  } catch {
    return false;
  }
}

/**
 * Allow the one real form POST used by `signIn`, and nothing a page script can substitute.
 *
 * The context route has no DOM initiator information. The narrowest safe mechanism here is
 * therefore a one-shot main-frame navigation to the form's resolved action, armed only while
 * `signIn` is clicking, with a body that the opaque credential scanner proves contains the
 * credential. Fetch/XHR, a different URL, a redirect replay, a second POST, or a body without
 * the credential all fall through to the read-only refusal below.
 */
function isArmedAuthenticationPost(
  live: LiveWorkspace | null,
  request: Request,
): boolean {
  const armed = live?.authPost;
  if (armed === null || armed === undefined || armed.used) return false;
  try {
    if (
      request.method().toUpperCase() !== 'POST' ||
      !request.isNavigationRequest() ||
      request.resourceType() !== 'document' ||
      request.frame() !== armed.page.mainFrame() ||
      request.redirectedFrom() !== null ||
      !sameNavigationUrl(armed.destination, request.url())
    ) return false;
    const body = request.postDataBuffer();
    if (body === null || !armed.credential.discloses(body)) return false;
    armed.used = true;
    return true;
  } catch {
    // A provider object that cannot be inspected cannot prove this is the approved login.
    return false;
  }
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
      // the same intent and `**/*` has its own opinions about what a path is. An allowed
      // origin alone is not enough: page JavaScript can issue a same-origin POST, so the
      // workspace permits only read methods unless the sign-in mechanism has armed its one
      // exact, credential-bearing form submission.
      await context.route(
        () => true,
        async (route: Route) => {
          const request = route.request();
          const url = request.url();
          if (
            allowed(url) &&
            (isReadOnlyBrowserMethod(request.method()) || isArmedAuthenticationPost(live, request))
          ) {
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
      live = {
        ref,
        browser,
        context,
        handle,
        page: null,
        lastResponse: null,
        authPost: null,
        downloads: 0,
        allowed,
      };
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
    captureGuard?: {
      readonly held: number;
      readonly discloses: (bytes: Uint8Array) => boolean;
      readonly redact: (text: string) => string;
    },
  ): Promise<BrowserActionResult> {
    // FIRST, before the workspace is even looked up. The union already makes this
    // unrepresentable: a `BrowserToolAction` carrying a credential has no `capture` field.
    // A structural type does not CONTAIN anything though — TypeScript's excess-property
    // check fires only on a fresh literal assigned to an annotated type, and a caller that
    // cast past the union compiles — so the mechanism refuses it as well. Capture is
    // SUPPRESSED for a credential-entry action: a Structural Snapshot, a screenshot or a
    // frame taken while a credential is on the wire would put a working credential into
    // immutable Evidence, and nothing can take it out again.
    //
    // It is checked before the liveness lookup because it is a fact about the REQUEST, not
    // about the workspace: reporting it as `unavailable` because the browser happened to be
    // gone would name the wrong thing, and would hide the request that must never be made.
    const capture = validateCaptureRequest(action, captureGuard);
    if (action.credential !== null && capture.length > 0) {
      throw new BrowserActionError('contract');
    }
    // Search is a fixed logical action. It is deliberately the only action that can fill
    // controls: arbitrary click/type/evaluate operations would let a model choose a write
    // surface that the frozen action gate never described. Credentials are only for the
    // dedicated sign-in navigation and cannot be combined with a search submission.
    if (action.action === 'search' && action.credential !== null) {
      throw new BrowserActionError('contract');
    }
    const requestedAuthentication =
      action.credential === null ? null : requestedAuthenticationDestination(action);
    let authenticationDestination: string | null = null;
    const live = this.live.get(ref.workspaceId);
    // A workspace belongs to ONE Run and to one mode, exactly as `attach` requires.
    if (!live || live.ref.runId !== ref.runId || live.ref.mode !== ref.mode) {
      throw new BrowserActionError('unavailable');
    }
    if (!live.browser.isConnected()) {
      this.live.delete(ref.workspaceId);
      throw new BrowserActionError('unavailable');
    }
    // A configured endpoint outside this action's frozen target is a scope violation even if
    // the workspace union allowlist contains it.
    if (action.credential !== null) {
      if (!isValidAuthenticationDestination(requestedAuthentication)) {
        // A legacy target may omit the endpoint. Refuse credential use rather than selecting a
        // form action from retrieved page content.
        throw new BrowserActionError('contract');
      }
      authenticationDestination = requestedAuthentication;
      if (!withinFrozenOrigin(action.destination, authenticationDestination)) {
        throw new BrowserActionError('scope');
      }
    }
    const timeout = Math.max(1, Math.min(timeoutMs, 600_000));
    const deadline = Date.now() + timeout;
    const before = live.handle.denied();

    let page: Page | null = null;
    try {
      const currentPageRead = action.action === 'read-attribute';
      let response: Response | null = null;
      if (currentPageRead) {
        // `read-attribute` consumes the page selected by the preceding approved action. It
        // must never reload the sanitized, query-free destination: doing so discards the
        // actual GET search result whose snapshot grounds the read. Parameters and
        // credentials are forbidden on this read arm; the application gate still decides
        // the action and target before this mechanism is reached.
        if (
          action.credential !== null ||
          (action.parameters !== undefined &&
            (!Array.isArray(action.parameters) || action.parameters.length !== 0))
        ) {
          throw new BrowserActionError('contract');
        }
        if (!isQueryFreeDestination(action.destination)) {
          // A read destination is an expected sanitized location, never a new query the
          // model may invent. The live page's query is retained only inside the browser.
          throw new BrowserActionError('contract');
        }
        page = live.page;
        if (page === null || page.isClosed()) {
          throw new BrowserActionError('unavailable');
        }
        if (
          !currentPageLocationMatches(action.destination, page.url()) ||
          !live.allowed(page.url())
        ) {
          // A page selected for another target, or a page whose path no longer matches the
          // frozen action destination, is a scope failure. No content is captured from it.
          throw new BrowserActionError('scope');
        }
        response = live.lastResponse;
        if (response === null) {
          // An attached page restored after a process restart has no response object that
          // can truthfully describe how it arrived. Re-establish it through a fresh
          // approved action rather than inventing status or method metadata.
          throw new BrowserActionError('unavailable');
        }
      } else {
        page = await this.pageFor(live, deadline);
        response = await withActionDeadline(
          () => page!.goto(action.destination, {
            waitUntil: 'domcontentloaded',
            timeout: timeoutForDeadline(deadline, timeout),
          }),
          deadline,
        );
        if (action.action === 'search') {
          if (response === null) throw new BrowserActionError('contract');
          if (!withinFrozenOrigin(action.destination, page.url())) {
            throw new BrowserActionError('scope');
          }
          response = await withActionDeadline(
            () => submitSearch(
              live,
              page!,
              action.destination,
              action.parameters ?? [],
              timeout,
              response!,
              deadline,
            ),
            deadline,
          );
        }
      }
      // The credential exists for the length of ONE submission and is dropped as soon as
      // the navigation it caused has settled. A workspace that kept it would present it on
      // every later request of the Run, which is the opposite of just in time.
      if (action.credential !== null && response !== null) {
        if (authenticationDestination === null) throw new BrowserActionError('contract');
        response = await withActionDeadline(
          () => signIn(
            live,
            page!,
            action.destination,
            authenticationDestination,
            action.credential,
            timeout,
            response!,
            deadline,
          ),
          deadline,
        );
      }
      // `null` is a same-document navigation, which is not something this platform asked
      // for and not something it can record a status for.
      if (response === null) throw new BrowserActionError('contract');
      // The workspace may contain several configured Target Systems. Authentication proved by
      // a redirect into another allowed system is not authentication for this action's target.
      if (
        (action.credential !== null || action.action === 'search') &&
        !withinFrozenOrigin(action.destination, page.url())
      ) {
        throw new BrowserActionError('scope');
      }
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
      const artifacts = capture.length === 0
        ? []
        : await withActionDeadline(
            () => captureArtifacts(page!, capture, captureGuard!, timeout, location, deadline),
            deadline,
          );
      const session = await withActionDeadline(
        () => hasAuthenticatedAccount(page!, response!),
        deadline,
      );
      // Keep the response only after every action-level check and capture has succeeded.
      // A current-page read deliberately keeps the same response: it did not put a new
      // request on the wire and therefore has no new response to retain.
      if (!currentPageRead) live.lastResponse = response;
      assertActionDeadline(deadline);
      return {
        status: response.status(),
        // What the workspace actually put on the wire last, which for a sign-in is the
        // form's own `POST` and not the `GET` the action started with. Read from the request
        // rather than assumed, because the immutable action log records what happened.
        method: originatingMethod(response),
        location,
        redirected: currentPageRead ? false : response.request().redirectedFrom() !== null,
        downloads: live.downloads,
        // Authentication is the approved target-specific postcondition on the live page and
        // response; a cookie alone is never treated as proof.
        session,
        artifacts,
      };
    } catch (error) {
      // A timeout can happen during navigation, search, capture or the final authentication
      // proof. The page is then an active browser surface that must not be reused. Set the
      // workspace page slot aside before bounded cleanup; the LiveWorkspace identity remains
      // in the map so release can still revoke the provider session.
      const expired = isActionDeadlineExceeded(error) || remainingActionTime(deadline) === 0;
      if (expired || action.credential !== null) {
        await this.discardActivePage(live, page, CLOSE_TIMEOUT_MS);
      }
      throw actionFailure(error, live.handle.denied() > before);
    }
  }

  /**
   * The ONE page a workspace drives, made on its first Tool Action.
   *
   * One page, because the session lives in the CONTEXT's cookie jar and a page per action
   * would lose nothing but would make "what the workspace is looking at" a question with
   * several answers.
   */
  private async pageFor(live: LiveWorkspace, deadline: number): Promise<Page> {
    if (live.page !== null && !live.page.isClosed()) {
      assertActionDeadline(deadline);
      return live.page;
    }
    if (live.page !== null) {
      // A closed page cannot carry the response metadata used by a current-page read.
      // Clear both together before making a replacement surface.
      live.page = null;
      live.lastResponse = null;
    }
    assertActionDeadline(deadline);

    // `context.newPage()` has no Playwright timeout option. Keep the pending promise
    // attached so a page that resolves after this action expires is closed rather than
    // becoming an unowned surface in the workspace.
    let cancelled = false;
    let cleanupStarted = false;
    let resolved: Page | null = null;
    const pending = live.context.newPage();
    const cleanupLate = (page: Page): void => {
      if (cleanupStarted) return;
      cleanupStarted = true;
      void this.discardActivePage(live, page, CLOSE_TIMEOUT_MS).catch(() => undefined);
    };
    void pending.then(
      (page) => {
        resolved = page;
        if (cancelled || remainingActionTime(deadline) === 0) cleanupLate(page);
      },
      () => undefined,
    );

    try {
      const page = await withActionDeadline(() => pending, deadline);
      resolved = page;
      assertActionDeadline(deadline);
      // Counted, never accepted: `acceptDownloads: false` cancels it and this records that
      // the Target System offered one.
      page.on('download', () => {
        live.downloads += 1;
      });
      live.page = page;
      return page;
    } catch (error) {
      if (isActionDeadlineExceeded(error) || remainingActionTime(deadline) === 0) {
        cancelled = true;
        if (resolved !== null) cleanupLate(resolved);
      }
      throw error;
    }
  }

  /**
   * Remove the one page that may have received a credential before a submission failed.
   *
   * `live.page = null` happens first so even a close that stops answering cannot make the
   * page the next action's surface. Closing the page is the normal path; closing the context
   * and then the browser are fail-closed fallbacks if the page is unresponsive. The workspace
   * remains in `this.live` so its Run/provider identity can still be released.
   */
  private async discardActivePage(
    live: LiveWorkspace,
    page: Page | null,
    timeoutMs: number = CLOSE_TIMEOUT_MS,
  ): Promise<void> {
    // A page being discarded can no longer complete an armed form submission. Revoke the
    // exception before any close attempt, so a late provider request cannot use it.
    live.authPost = null;
    const active = page ?? live.page;
    if (active === null) return;
    // Make reuse impossible before asking Playwright to close anything. The workspace stays
    // in `this.live`, so its provider/run identity remains available to release().
    if (live.page === active) {
      live.page = null;
      live.lastResponse = null;
    }
    const cleanupDeadline = Date.now() + Math.max(1, Math.min(timeoutMs, CLOSE_TIMEOUT_MS));
    const closeBounded = async (work: () => Promise<unknown>): Promise<void> => {
      const remaining = remainingActionTime(cleanupDeadline);
      if (remaining === 0) return;
      try {
        await withTimeout(work(), remaining);
      } catch {
        // Cleanup must not replace the original action failure.
      }
    };
    await closeBounded(() => active.close());
    let closed = false;
    try {
      closed = active.isClosed();
    } catch {
      closed = true;
    }
    if (closed) return;
    await closeBounded(() => live.context.close());
    try {
      closed = active.isClosed();
    } catch {
      closed = true;
    }
    if (closed) return;
    await closeBounded(() => live.browser.close());
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

/**
 * The resolved fields of a form and of its submitter, named structurally.
 *
 * `packages/infrastructure` has no DOM lib — nothing on this side of the boundary is a
 * browser — so the shapes the evaluated callback reads are declared here rather than
 * borrowed from `HTMLFormElement`. These are the RESOLVED values the browser will use,
 * not the attribute text, which may be relative, absent or overridden.
 */
interface SubmittableForm {
  readonly action: string;
  readonly method: string;
}
interface FormSubmitter {
  readonly formAction: string;
  /** The effective method, inherited from the associated form when no override is declared. */
  readonly formMethod: string;
  readonly form: SubmittableForm | null;
  readonly hasAttribute: (name: string) => boolean;
}

interface SearchParameter {
  readonly name: string;
  readonly value: string;
}

interface SearchSubmissionEntry {
  readonly name: string | null;
  /** `null` is a non-string FormData entry (for example, a file control). */
  readonly value: string | null;
}

/** The bounded parameter shape the application gate forwards to the browser. */
const SEARCH_PARAMETER_LIMITS = {
  count: 16,
  name: 200,
  value: 512,
} as const;

/**
 * Ask the browser for the exact successful controls it will serialize for this submitter.
 * FormData(form, submitter) is fixed platform behaviour, so this does not reimplement form
 * serialization in the host (where a hidden control or a named submit button could be
 * missed). Non-string entries are represented only by `null`; file names never cross back.
 */
const SEARCH_FORM_DATA = (element: unknown): SearchSubmissionEntry[] => {
  const control = element as { readonly form?: unknown };
  const form = control.form;
  if (form === null || form === undefined) throw new Error('form missing');
  const constructor = (globalThis as unknown as {
    readonly FormData?: new (
      form: unknown,
      submitter?: unknown,
    ) => { readonly entries: () => IterableIterator<readonly [unknown, unknown]> };
  }).FormData;
  if (constructor === undefined) throw new Error('form data unavailable');
  const data = new constructor(form, element);
  const entries: SearchSubmissionEntry[] = [];
  for (const pair of data.entries()) {
    entries.push({
      name: typeof pair[0] === 'string' ? pair[0] : null,
      value: typeof pair[1] === 'string' ? pair[1] : null,
    });
  }
  return entries;
};

/**
 * Prove that the browser's successful controls contain only the gate's values. Empty
 * controls are harmless and remain allowed so a real form may expose optional filters;
 * every non-empty extra, duplicate approved field, or file entry is outside the frozen
 * population scope and is refused before the click sends it.
 */
function validateSearchFormData(value: unknown, parameters: readonly SearchParameter[]): void {
  if (!Array.isArray(value)) throw new BrowserActionError('contract');
  const expected = new Map(parameters.map((parameter) => [parameter.name, parameter.value]));
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('name' in entry) ||
      !('value' in entry)
    ) {
      throw new BrowserActionError('contract');
    }
    const name = (entry as { readonly name?: unknown }).name;
    const submitted = (entry as { readonly value?: unknown }).value;
    if (typeof name !== 'string' || (typeof submitted !== 'string' && submitted !== null)) {
      throw new BrowserActionError('contract');
    }
    if (submitted === null) {
      // A file is a successful control but cannot be represented as one of the gate's
      // text parameters. Refuse it without returning its file name or contents.
      throw new BrowserActionError('scope');
    }
    if (expected.has(name)) {
      if (seen.has(name) || submitted !== expected.get(name)) {
        throw new BrowserActionError('scope');
      }
      seen.add(name);
      continue;
    }
    if (submitted !== '') throw new BrowserActionError('scope');
  }
  if (seen.size !== expected.size) throw new BrowserActionError('contract');
}

/** Compare the actual navigation request with the values approved by the application gate. */
function searchRequestMatchesParameters(
  requestUrl: string,
  parameters: readonly SearchParameter[],
): boolean {
  let query: URLSearchParams;
  try {
    query = new URL(requestUrl).searchParams;
  } catch {
    return false;
  }
  const expected = new Map(parameters.map((parameter) => [parameter.name, parameter.value]));
  const seen = new Set<string>();
  for (const [name, value] of query) {
    if (expected.has(name)) {
      if (seen.has(name) || value !== expected.get(name)) return false;
      seen.add(name);
    } else if (value !== '') {
      // Blank optional controls may be serialized by a conforming browser; non-empty
      // material must always be an exact gate parameter.
      return false;
    }
  }
  return seen.size === expected.size;
}

/**
 * Resolve one control's accessible label from the rendered DOM.
 *
 * `getByLabel` is still used for the final exact lookup. This small fixed callback only
 * identifies the label attached to a control selected by its query name; it never evaluates
 * model text or returns a page supplied selector.
 */
const ACCESSIBLE_LABEL = (element: unknown): string => {
  const control = element as {
    readonly getAttribute: (name: string) => string | null;
    readonly labels?: {
      readonly length: number;
      readonly item: (index: number) => { readonly innerText?: string } | null;
    } | null;
    readonly ownerDocument?: {
      readonly getElementById: (id: string) => { readonly innerText?: string } | null;
    };
  };
  const aria = control.getAttribute('aria-label');
  if (aria !== null && aria.trim() !== '') return aria.trim().replace(/\s+/gu, ' ');
  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy !== null && labelledBy.trim() !== '') {
    const text = labelledBy
      .trim()
      .split(/\s+/u)
      .map((id) => control.ownerDocument?.getElementById(id))
      .filter((label): label is { readonly innerText?: string } => label !== null && label !== undefined)
      .map((label) => label.innerText ?? '')
      .join(' ')
      .trim()
      .replace(/\s+/gu, ' ');
    if (text !== '') return text;
  }
  const labels = control.labels;
  if (labels === null || labels === undefined) return '';
  const text: string[] = [];
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels.item(index);
    if (label !== null) text.push(label.innerText ?? '');
  }
  return text.join(' ').trim().replace(/\s+/gu, ' ');
};

/** Read the submitter's effective method and action without exposing a DOM object upstream. */
async function resolvedSubmitter(
  submitter: Locator,
  deadline: number,
): Promise<{ readonly formAction: string; readonly formMethod: string }> {
  const value: unknown = await withActionDeadline(
    () => submitter.evaluate((element) => {
      const control = element as unknown as FormSubmitter;
      return {
        // The IDL `formAction` property is resolved even when no `formaction` attribute is
        // present; in that case browsers expose the current document URL. Native form
        // submission instead falls back to the associated form's action. Distinguish the
        // attribute override from that default so the request arm matches what the browser
        // will actually put on the wire.
        formAction: control.hasAttribute('formaction')
          ? control.formAction
          : control.form?.action ?? '',
        // The same distinction matters for an explicitly empty `formmethod`: an override is
        // an override, while an absent attribute inherits the form's effective method.
        formMethod: control.hasAttribute('formmethod')
          ? control.formMethod
          : control.form?.method ?? '',
      };
    }),
    deadline,
  );
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { readonly formAction?: unknown }).formAction !== 'string' ||
    typeof (value as { readonly formMethod?: unknown }).formMethod !== 'string'
  ) {
    throw new BrowserActionError('contract');
  }
  return value as { readonly formAction: string; readonly formMethod: string };
}

/**
 * Submit the target's own GET search form using only application-approved parameters.
 *
 * The form and submitter are judged by their resolved browser properties, and the browser's
 * own successful-control list is checked after approved values are filled. A POST, a
 * cross-target action, an ambiguous label, a second submitter or an unapproved query value
 * is a contract/scope refusal; no guessed control and no arbitrary JavaScript is used.
 */
async function submitSearch(
  live: LiveWorkspace,
  page: Page,
  destination: string,
  parameters: readonly SearchParameter[],
  timeoutMs: number,
  landed: Response,
  deadline: number,
): Promise<Response> {
  assertActionDeadline(deadline);
  if (
    !Array.isArray(parameters) ||
    parameters.length === 0 ||
    parameters.length > SEARCH_PARAMETER_LIMITS.count ||
    parameters.some(
      (parameter) =>
        typeof parameter !== 'object' ||
        parameter === null ||
        typeof parameter.name !== 'string' ||
        parameter.name.length === 0 ||
        parameter.name.trim() !== parameter.name ||
        parameter.name.length > SEARCH_PARAMETER_LIMITS.name ||
        typeof parameter.value !== 'string' ||
        parameter.value.length > SEARCH_PARAMETER_LIMITS.value,
    )
  ) {
    throw new BrowserActionError('contract');
  }
  const names = new Set(parameters.map((parameter) => parameter.name));
  if (names.size !== parameters.length) throw new BrowserActionError('contract');

  const forms = page.locator('form');
  let selected: { readonly form: Locator; readonly fields: readonly Locator[] } | null = null;
  const formCount = await withActionDeadline(() => forms.count(), deadline);
  for (let formIndex = 0; formIndex < formCount; formIndex += 1) {
    const form = forms.nth(formIndex);
    const fields: Locator[] = [];
    for (const parameter of parameters) {
      const candidates = form.locator(
        'input:not([type])[name], input[type="text" i][name], input[type="search" i][name]',
      );
      const matches: Locator[] = [];
      const candidateCount = await withActionDeadline(() => candidates.count(), deadline);
      for (let fieldIndex = 0; fieldIndex < candidateCount; fieldIndex += 1) {
        const candidate = candidates.nth(fieldIndex);
        const candidateName = await withActionDeadline(
          () => candidate.getAttribute('name'),
          deadline,
        );
        if (candidateName !== parameter.name) continue;
        const accessibleLabel = await withActionDeadline(
          () => candidate.evaluate(ACCESSIBLE_LABEL),
          deadline,
        );
        if (typeof accessibleLabel !== 'string' || accessibleLabel === '') {
          throw new BrowserActionError('contract');
        }
        const exact = form.getByLabel(accessibleLabel, { exact: true });
        const exactCount = await withActionDeadline(() => exact.count(), deadline);
        const exactName = exactCount === 1
          ? await withActionDeadline(() => exact.getAttribute('name'), deadline)
          : null;
        if (exactCount !== 1 || exactName !== parameter.name) {
          throw new BrowserActionError('contract');
        }
        matches.push(exact);
      }
      if (matches.length !== 1) {
        // This form does not describe this parameter. Continue looking for the one form
        // that does; two forms that both describe it are rejected below.
        fields.length = 0;
        break;
      }
      const field = matches[0]!;
      const [visible, editable] = await withActionDeadline(
        () => Promise.all([field.isVisible(), field.isEditable()]),
        deadline,
      );
      if (!visible || !editable) {
        throw new BrowserActionError('contract');
      }
      fields.push(field);
    }
    if (fields.length !== parameters.length) continue;
    if (selected !== null) throw new BrowserActionError('contract');
    selected = { form, fields };
  }
  if (selected === null) throw new BrowserActionError('contract');

  const submitters = selected.form.locator(
    'button:not([type]), button[type="submit" i], input[type="submit" i]',
  );
  const submitterCount = await withActionDeadline(() => submitters.count(), deadline);
  if (submitterCount !== 1) throw new BrowserActionError('contract');
  const submitter = submitters.first();
  const [submitterVisible, submitterEnabled] = await withActionDeadline(
    () => Promise.all([submitter.isVisible(), submitter.isEnabled()]),
    deadline,
  );
  if (!submitterVisible || !submitterEnabled) {
    throw new BrowserActionError('contract');
  }
  const [formAction, formMethod, submitterDetails] = await withActionDeadline(
    () => Promise.all([
      selected!.form.evaluate((element) => (element as unknown as SubmittableForm).action),
      selected!.form.evaluate((element) => (element as unknown as SubmittableForm).method),
      resolvedSubmitter(submitter, deadline),
    ]),
    deadline,
  );
  if (typeof formAction !== 'string' || typeof formMethod !== 'string') {
    throw new BrowserActionError('contract');
  }
  // Search is a read only GET. A form that would place values in a request body, or a
  // submitter whose override points elsewhere, cannot be treated as this logical action.
  if (formMethod.toUpperCase() !== 'GET') throw new BrowserActionError('scope');
  if (submitterDetails.formMethod.toUpperCase() !== 'GET') throw new BrowserActionError('scope');
  if (!withinFrozenOrigin(destination, formAction)) throw new BrowserActionError('scope');
  if (!withinFrozenOrigin(destination, submitterDetails.formAction)) throw new BrowserActionError('scope');

  for (const [index, parameter] of parameters.entries()) {
    await withActionDeadline(
      () => selected!.fields[index]!.fill(parameter.value, { timeout: timeoutForDeadline(deadline, timeoutMs) }),
      deadline,
    );
  }
  // FormData applies the browser's own successful-control rules, including hidden fields,
  // selected options and the named submitter. Validate it after the approved values are in
  // place so an unapproved non-empty control is refused before a request leaves the browser.
  const formData = await withActionDeadline(
    () => submitter.evaluate(SEARCH_FORM_DATA),
    deadline,
  );
  validateSearchFormData(formData, parameters);
  // A page-level route runs before the context's frozen-egress route. It closes the race
  // between the FormData inspection above and the click: an onsubmit handler can still add a
  // hidden control, change the method or redirect the first navigation. Approved requests
  // call fallback so the workspace policy remains the final egress boundary.
  let armed = false;
  const searchRoute = async (route: Route): Promise<void> => {
    const request = route.request();
    const initialMainNavigation =
      armed &&
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      request.redirectedFrom() === null;
    if (!initialMainNavigation) {
      await route.fallback();
      return;
    }
    const approved =
      request.method().toUpperCase() === 'GET' &&
      withinFrozenOrigin(destination, request.url()) &&
      searchRequestMatchesParameters(request.url(), parameters);
    if (!approved) {
      await route.abort('blockedbyclient');
      return;
    }
    // Do not continue directly: that would skip the context route which enforces the
    // workspace's full frozen-origin policy.
    await route.fallback();
  };
  let routeInstalled = false;
  let routeCancelled = false;
  let routeRemovalStarted = false;
  const removeSearchRoute = async (): Promise<void> => {
    if (!routeInstalled || routeRemovalStarted) return;
    routeRemovalStarted = true;
    try {
      await withTimeout(page.unroute('**/*', searchRoute), CLOSE_TIMEOUT_MS);
    } catch {
      // A page can close while the late route installation is being unwound. Cleanup must
      // never replace the action's original failure or create a raw provider error.
    }
  };
  // `page.route` is normally immediate, but keep a late resolution attached so a deadline
  // cannot leave a page-level guard installed after this action has already failed.
  const installingRoute = page.route('**/*', searchRoute);
  void installingRoute.then(
    () => {
      routeInstalled = true;
      if (routeCancelled) void removeSearchRoute().catch(() => undefined);
    },
    () => undefined,
  );
  try {
    await withActionDeadline(() => installingRoute, deadline);
    routeInstalled = true;
    armed = true;

    const submitted = withActionDeadline(
      () => page.waitForRequest(
        (request) =>
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame(),
        { timeout: timeoutForDeadline(deadline, timeoutMs) },
      ),
      deadline,
    );
    const settled = withActionDeadline(
      () => page.waitForResponse(
        (response) =>
          response.request().isNavigationRequest() &&
          response.frame() === page.mainFrame() &&
          (response.status() < 300 || response.status() >= 400),
        { timeout: timeoutForDeadline(deadline, timeoutMs) },
      ),
      deadline,
    );
    // Both waits are started before the click. Attach observers immediately as well: if the
    // route rejects the click, its request/response promise can still settle later at the
    // deadline without becoming an unhandled rejection.
    void submitted.catch(() => undefined);
    void settled.catch(() => undefined);
    const click = withActionDeadline(
      () => submitter.click({ timeout: timeoutForDeadline(deadline, timeoutMs) }),
      deadline,
    );
    const [clickResult, requestResult] = await Promise.allSettled([click, submitted]);
    if (requestResult.status === 'fulfilled') {
      const request = requestResult.value;
      if (
        request.method().toUpperCase() !== 'GET' ||
        !withinFrozenOrigin(destination, request.url()) ||
        !searchRequestMatchesParameters(request.url(), parameters)
      ) {
        throw new BrowserActionError('scope');
      }
    }
    if (clickResult.status === 'rejected') throw clickResult.reason;
    if (requestResult.status === 'rejected') throw requestResult.reason;
    const response = await settled;
    await withActionDeadline(
      () => page.waitForLoadState('domcontentloaded', { timeout: timeoutForDeadline(deadline, timeoutMs) }),
      deadline,
    );
    if (!live.allowed(page.url())) throw new BrowserActionError('scope');
    if (!withinFrozenOrigin(destination, page.url())) throw new BrowserActionError('scope');
    // Keep this explicit. A same-document response is not a result page the action can bind
    // to, and the initial landing response is only used to find the form.
    if (response === landed) throw new BrowserActionError('contract');
    assertActionDeadline(deadline);
    return response;
  } finally {
    routeCancelled = true;
    await removeSearchRoute();
  }
}

/** Capture exactly the requested final-page artifacts, each bound to its sanitized URL. */
async function captureArtifacts(
  page: Page,
  capture: readonly string[],
  guard: {
    readonly held: number;
    readonly discloses: (bytes: Uint8Array) => boolean;
    readonly redact: (text: string) => string;
  },
  timeoutMs: number,
  location: string,
  deadline: number,
): Promise<readonly BrowserActionArtifact[]> {
  const captured = await captureWebTree(page, guard, {
    screenshot: capture.includes('screenshot'),
    timeoutMs,
    deadline,
  });
  let artifactLocation: string;
  try {
    assertActionDeadline(deadline);
    artifactLocation = guard.redact(location);
    assertActionDeadline(deadline);
    if (guard.discloses(new TextEncoder().encode(artifactLocation))) {
      throw new BrowserActionError('contract');
    }
    assertActionDeadline(deadline);
  } catch (error) {
    if (error instanceof BrowserActionError || isActionDeadlineExceeded(error)) throw error;
    throw new BrowserActionError('contract');
  }
  const artifacts: BrowserActionArtifact[] = [];
  for (const kind of capture) {
    if (kind === 'structural-snapshot') {
      artifacts.push({
        kind,
        bytes: captured.snapshot,
        mediaType: WEB_TREE_MEDIA_TYPE,
        location: artifactLocation,
      });
    } else if (kind === 'screenshot' && captured.screenshot !== null) {
      artifacts.push({
        kind,
        bytes: captured.screenshot,
        mediaType: 'image/png',
        location: artifactLocation,
      });
    }
  }
  return artifacts;
}

/**
 * Sign in through the Target System's OWN form (Story 4.2).
 *
 * The credential-entry mechanism. It runs after the action's navigation has landed on the
 * frozen origin, which — for a system that requires a credential — is where that system
 * serves its sign-in form. Nothing here guesses a path, follows a link or reads a location
 * out of the page: the destination is the one the Procedure Version froze and the gate
 * already authorized, and the only thing taken from the document is the form's own
 * declaration of where it posts, which is then checked against the exact authentication
 * destination frozen with that registration.
 *
 * **A stated mechanism contract, not a heuristic.** Exactly one `<form>` carrying exactly
 * one `<input type="password">` and exactly one submit control; the form must declare
 * `POST`; its action must remain inside the Target's frozen origin, and the submitter's
 * effective action must equal the exact configured authentication URL. A submitter override
 * is therefore allowed only when it names that exact URL. Anything else is refused rather than guessed at — a
 * mechanism that picked one of several forms would be choosing, on a page a Target System
 * controls, where a credential goes.
 *
 * The exact endpoint check is stronger than the workspace origin allowlist: a plan naming
 * two web Target Systems has BOTH origins in the workspace union, but a form on one system
 * must still be unable to choose a business-write path under its own origin. The configured
 * URL is checked against the target's frozen origin as well, so the browser and gate retain
 * one answer to "inside the frozen target".
 *
 * The value exists in `enterCredential` and nowhere else — the same just-in-time shape the
 * header presentation had, one presentation along.
 */
async function signIn(
  live: LiveWorkspace,
  page: Page,
  destination: string,
  authenticationDestination: string,
  credential: ResolvedCredential,
  timeoutMs: number,
  landed: Response,
  deadline: number,
): Promise<Response> {
  assertActionDeadline(deadline);
  // A redirect into another configured Target System cannot establish this action's target
  // session, even if that other page happens to carry the approved account marker.
  if (!withinFrozenOrigin(destination, page.url())) throw new BrowserActionError('scope');
  if (
    !isValidAuthenticationDestination(authenticationDestination) ||
    !withinFrozenOrigin(destination, authenticationDestination)
  ) {
    throw new BrowserActionError('contract');
  }

  // Already signed in: the system answered the navigation and the workspace holds a session
  // for this origin, so there is nothing to enter and nothing to submit. The IDEMPOTENT
  // branch, and it is reachable — a database failure between a successful sign-in and its
  // commit leaves the checkpoint saying `RETRY` while the browser still holds the cookie,
  // and the phase's own sweep re-claims in the same process. Without it that blip would
  // report `contract` and cost the Run, which is the opposite of what AD-16 asks for.
  if (await withActionDeadline(() => hasAuthenticatedAccount(page, landed), deadline)) {
    return landed;
  }

  const forms = page.locator('form:has(input[type="password"])');
  if (await withActionDeadline(() => forms.count(), deadline) !== 1) {
    throw new BrowserActionError('contract');
  }
  const form = forms.first();
  const fields = form.locator('input[type="password"]');
  const submits = form.locator('button[type="submit"], input[type="submit"]');
  const [fieldCount, submitCount] = await withActionDeadline(
    () => Promise.all([fields.count(), submits.count()]),
    deadline,
  );
  if (fieldCount !== 1 || submitCount !== 1) {
    throw new BrowserActionError('contract');
  }
  const submitter = submits.first();

  // `HTMLFormElement.action`/`.method` and `HTMLButtonElement.formAction` are the RESOLVED
  // values the browser will actually use, which is what has to be judged — not the
  // attribute text, which may be relative, absent, or overridden by the submitter.
  const [formAction, formMethod, submitterDetails] = await withActionDeadline(
    () => Promise.all([
      form.evaluate((element) => (element as unknown as SubmittableForm).action),
      form.evaluate((element) => (element as unknown as SubmittableForm).method),
      resolvedSubmitter(submitter, deadline),
    ]),
    deadline,
  );
  // A `GET` form would put the credential in the URL, in browser history, in the `Referer`
  // header and in every access log. This platform will not type one into it. The submitter
  // can override the form method, so its effective method is checked too.
  if (typeof formAction !== 'string' || typeof formMethod !== 'string') {
    throw new BrowserActionError('contract');
  }
  if (formMethod.toUpperCase() !== 'POST') throw new BrowserActionError('scope');
  if (submitterDetails.formMethod.toUpperCase() !== 'POST') throw new BrowserActionError('scope');
  // The page may declare a same-origin business endpoint, so origin membership alone is
  // insufficient for the EFFECTIVE submitter action. Keep the form itself inside the frozen
  // target, then require the action this selected submitter will actually use to equal the
  // immutable configured endpoint. This preserves a submitter override when (and only when)
  // it is that endpoint; without an override, `resolvedSubmitter` inherits formAction.
  if (!withinFrozenOrigin(destination, formAction)) {
    throw new BrowserActionError('scope');
  }
  if (!sameNavigationUrl(authenticationDestination, submitterDetails.formAction)) {
    throw new BrowserActionError('scope');
  }

  await withActionDeadline(
    () => enterCredential(credential, fields.first(), timeoutForDeadline(deadline, timeoutMs), deadline),
    deadline,
  );

  // Arm exactly one request for the form's effective action. The context route remains
  // read-only until this point, and the allowance is revoked in `finally` even when the
  // provider or the target fails to answer.
  if (live.authPost !== null) throw new BrowserActionError('contract');
  const authPost: ArmedAuthenticationPost = {
    page,
    destination: authenticationDestination,
    credential,
    used: false,
  };
  live.authPost = authPost;
  try {
    // The FIRST non-redirect navigation response of the main frame after the submission.
    // Filtering the redirects out is what makes this the answer the system settled on rather
    // than the `303` it passed through on the way.
    const settled = withActionDeadline(
      () => page.waitForResponse(
        (response) =>
          response.request().isNavigationRequest() &&
          response.frame() === page.mainFrame() &&
          (response.status() < 300 || response.status() >= 400),
        { timeout: timeoutForDeadline(deadline, timeoutMs) },
      ),
      deadline,
    );
    await withActionDeadline(
      () => submitter.click({ timeout: timeoutForDeadline(deadline, timeoutMs) }),
      deadline,
    );
    const response = await settled;
    await withActionDeadline(
      () => page.waitForLoadState('domcontentloaded', { timeout: timeoutForDeadline(deadline, timeoutMs) }),
      deadline,
    );
    // The workspace is still inside its frozen allowlist. The interception should already
    // have aborted anything else; this is the second lock on that door, checked here as well
    // as by the caller because a sign-in is where a system most wants to send a browser
    // somewhere new.
    if (!live.allowed(page.url())) throw new BrowserActionError('scope');
    if (!withinFrozenOrigin(destination, page.url())) throw new BrowserActionError('scope');
    assertActionDeadline(deadline);
    return response;
  } finally {
    if (live.authPost === authPost) live.authPost = null;
  }
}

/**
 * Type the credential into one field, and hold it nowhere else.
 *
 * `enter` writes the value into a sink; the sink is a local binding of this function; the
 * binding is cleared in the `finally`. `ResolvedCredential` has no field holding the value,
 * so this is the only place in the browser path where it exists at all, and it exists for
 * the length of one `fill`.
 */
async function enterCredential(
  credential: ResolvedCredential,
  field: Locator,
  timeoutMs: number,
  deadline: number,
): Promise<void> {
  assertActionDeadline(deadline);
  let typed = '';
  credential.enter({
    set: (value: string) => {
      typed = value;
    },
  });
  // A resolver whose `enter` wrote nothing has not presented a credential, and submitting
  // an empty field would fail for a reason that is not the true one.
  if (typed === '') throw new BrowserActionError('contract');
  try {
    await withActionDeadline(
      () => field.fill(typed, { timeout: timeoutForDeadline(deadline, timeoutMs) }),
      deadline,
    );
    assertActionDeadline(deadline);
  } finally {
    typed = '';
  }
}

/**
 * The method of the request that produced this response, before any redirect the SYSTEM
 * chose.
 *
 * A sign-in navigates with a `GET`, submits the system's form with a `POST`, and the
 * system answers a `303` the browser follows with a second `GET`. Reading the final
 * request's method would record that last `GET` and leave the `POST` invisible — which
 * would put the old false equivalence ("read-only means the log only ever shows a GET")
 * back, one layer down. The chain's ORIGIN is the request this platform actually made.
 */
export function originatingMethod(response: Response): string {
  let request = response.request();
  for (let hop = 0; hop < 20; hop += 1) {
    const previous = request.redirectedFrom();
    if (previous === null) break;
    request = previous;
  }
  return request.method().toUpperCase();
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
