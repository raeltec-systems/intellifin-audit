// Test-only provider interception for the ACTUAL compiled worker.
//
// This fixture returns bounded, valid model JSON and never creates a Run row,
// Observation, Evidence artifact, or review state. PostgreSQL, the production
// worker, browser, Northstar, and the real Evidence store supply those facts.
// No live model service is contacted; production images never import this file.
import './agent-workspace-observer.mjs';

if (process.env.ANTHROPIC_API_KEY !== 'synthetic-agent-abuse-interception') {
  throw new Error('Evaluation journey preload requires its clearly synthetic provider key.');
}

const realFetch = globalThis.fetch;
let responseNumber = 0;

function response(body, proposal) {
  responseNumber += 1;
  return new Response(JSON.stringify({
    id: `msg_synthetic_evaluation_journey_${String(responseNumber)}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text: JSON.stringify(proposal) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100 },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'request-id': 'synthetic-evaluation-journey' },
  });
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

  if (envelope.phase === 'evaluation') {
    const evaluation = envelope.evaluation;
    if (!evaluation || !Array.isArray(evaluation.conditions) || evaluation.conditions.length !== 1 ||
        evaluation.conditions[0].conditionId !== 'C2') {
      throw new Error('The actual worker did not bind one frozen P-1 C2 evaluation.');
    }
    if (typeof evaluation.observationId !== 'string' || evaluation.observationId.length === 0) {
      throw new Error('The actual worker did not bind the final Observation identity.');
    }
    process.stdout.write(`Synthetic evaluation journey provider:${JSON.stringify({
      phase: 'evaluation', conditionId: 'C2', observationBound: true,
    })}\n`);
    return response(body, {
      phase: 'evaluation',
      proposals: [{
        conditionId: 'C2',
        value: 'COMPLIANT',
        confidence: '0.95',
        rationale: 'Synthetic provider proposal: the captured account is disabled and carries only the frozen read-only role.',
      }],
      uncertainty: { kind: 'none', rationale: null },
    });
  }

  if ((envelope.phase ?? 'actions') !== 'actions' || !Array.isArray(envelope.tools)) {
    throw new Error('The actual worker did not send the bounded action proposal envelope.');
  }

  // The platform allocates every destination and locator. The fixture chooses one
  // opaque approved tool; it never authors a route or a population parameter.
  // Pick from the platform's current catalog by logical action. The fixture never
  // authors a route, query or locator; on the canonical LoanCore pages this yields
  // landing navigation, then search, then the grounded record link, then field reads.
  const tool = envelope.tools.find((candidate) => candidate.action === 'search') ??
    envelope.tools.find((candidate) => candidate.action === 'open-record') ??
    envelope.tools.find((candidate) => candidate.action === 'navigate') ??
    envelope.tools.find((candidate) => candidate.action === 'read-attribute');
  if (!tool) throw new Error('The actual worker did not expose an approved action for the journey.');

  process.stdout.write(`Synthetic evaluation journey provider:${JSON.stringify({
    phase: 'actions', action: tool.action, destination: tool.destination,
  })}\n`);
  return response(body, {
    actions: [{ toolId: tool.toolId, parameters: [] }],
    uncertainty: { kind: 'none', rationale: null },
  });
};
