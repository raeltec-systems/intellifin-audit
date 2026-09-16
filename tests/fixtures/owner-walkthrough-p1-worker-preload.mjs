// Test-only provider interception for the ACTUAL compiled worker.
//
// ONE journey needs BOTH model gateways in one process. The owner walkthrough authors a
// P-1 Draft THROUGH the interface, so the version freezes the web server's model identity
// (`playwright.config.ts` gives it `anthropic` / `synthetic-http-fixture`) and the worker
// has to DERIVE the executable plan; it then runs that plan with the agent, which asks the
// separate provider-native agent gateway for a Tool Action. `anthropic-worker-preload.mjs`
// answers the first and `agent-evaluation-worker-preload.mjs` the second — but each THROWS
// on the other's envelope and both wrap `globalThis.fetch` for `api.anthropic.com`, so
// chaining them in either order fails the first request of the other kind. The dispatch
// therefore lives here, in one place, keyed on the envelope the worker actually sent.
//
// It fabricates nothing. A derivation is answered with the COMPILER's own bytes — which is
// the whole of what a passing provider does there, because `derive-plan.ts` stores the
// compiler's output and refuses any candidate whose plan semantics differ — and an action
// is answered with ONE opaque tool id the platform itself offered, with no parameters. No
// Run row, Observation, Evidence artifact, outcome or observed value comes from this file;
// PostgreSQL, the production worker, the local Chromium, Northstar and the real Evidence
// store supply every one. No live model service is contacted, and production images never
// import this file.
import { deriveExecutablePlan } from '../../packages/domain/dist/index.js';

if (process.env.MODEL_API_KEY !== 'isolated-synthetic-http-fixture') {
  throw new Error('The owner P-1 preload requires the isolated derivation fixture key.');
}
if (process.env.ANTHROPIC_API_KEY !== 'synthetic-owner-walkthrough-p1-interception') {
  throw new Error('The owner P-1 preload requires its clearly synthetic agent provider key.');
}

const realFetch = globalThis.fetch;
let responseNumber = 0;

function answer(body, payload) {
  responseNumber += 1;
  return new Response(JSON.stringify({
    id: `msg_synthetic_owner_p1_${String(responseNumber)}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100 },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'request-id': 'synthetic-owner-walkthrough-p1' },
  });
}

/**
 * One line per intercepted call, so the spec can say what the model was asked for without
 * retaining a prompt, a provider response or anything a Target System said. Closed fields
 * only: a phase name and a logical action, both the platform's own vocabulary.
 */
function marker(fields) {
  process.stdout.write(`Synthetic owner P-1 provider:${JSON.stringify(fields)}\n`);
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).hostname !== 'api.anthropic.com') return realFetch(input, init);

  const body = JSON.parse(init?.body ?? await input.text());
  const content = body.messages.at(-1)?.content;
  const prompt = typeof content === 'string'
    ? content
    : content.filter((part) => part.type === 'text').map((part) => part.text).join('');
  const envelope = JSON.parse(prompt);
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw new Error('The actual worker did not send a JSON envelope.');
  }

  // Plan derivation. `model-gateway.ts` sends `{ compilerVersion, promptVersion,
  // authoredInputs }`; the agent envelopes carry `phase` and `tools` and never this key,
  // so the dispatch is unambiguous rather than a guess about which gateway called.
  if (Object.hasOwn(envelope, 'authoredInputs')) {
    const derived = deriveExecutablePlan(envelope.authoredInputs, envelope.compilerVersion);
    if (!derived.ok) throw new Error('The authored inputs this journey saved are incomplete.');
    marker({ phase: 'derivation' });
    return answer(body, derived.plan);
  }

  // P-1's only Agent-Judged condition is C2, and this journey REMOVES it the way the owner
  // did. An evaluation request therefore means the frozen version still carries a condition
  // the auditor deleted, which is a defect to see rather than a request to satisfy.
  if (envelope.phase === 'evaluation') {
    marker({ phase: 'evaluation', refused: true });
    throw new Error('The walked version froze no Agent-Judged condition, so no evaluation may be requested.');
  }

  if ((envelope.phase ?? 'actions') !== 'actions' || !Array.isArray(envelope.tools)) {
    throw new Error('The actual worker did not send the bounded action proposal envelope.');
  }

  // The platform allocates every destination, parameter and locator. This picks ONE opaque
  // approved tool by its logical action and authors no route, query, value or locator; on
  // the canonical LoanCore pages that is landing navigation, then search, then the grounded
  // record link, then the field reads.
  const tool = envelope.tools.find((candidate) => candidate.action === 'search') ??
    envelope.tools.find((candidate) => candidate.action === 'open-record') ??
    envelope.tools.find((candidate) => candidate.action === 'navigate') ??
    envelope.tools.find((candidate) => candidate.action === 'read-attribute');
  if (!tool) throw new Error('The actual worker exposed no approved action for this journey.');
  marker({ phase: 'actions', action: tool.action });
  return answer(body, {
    actions: [{ toolId: tool.toolId, parameters: [] }],
    uncertainty: { kind: 'none', rationale: null },
  });
};
