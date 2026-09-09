// Test-only provider interception for the ACTUAL compiled worker.
//
// This fixture returns bounded, valid model JSON and never creates a Run row,
// Observation, Evidence artifact, or review state. PostgreSQL, the production
// worker, browser, Northstar, and the real Evidence store supply those facts.
// No live model service is contacted; production images never import this file.
if (process.env.ANTHROPIC_API_KEY !== 'synthetic-prodconsole-provider-interception') {
  throw new Error('ProdConsole journey preload requires its clearly synthetic provider key.');
}

const realFetch = globalThis.fetch;
let responseNumber = 0;

function response(body, proposal) {
  responseNumber += 1;
  return new Response(JSON.stringify({
    id: `msg_synthetic_prodconsole_journey_${String(responseNumber)}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text: JSON.stringify(proposal) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100 },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'request-id': 'synthetic-prodconsole-journey' },
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

  if (envelope.phase === 'evaluation') throw new Error('P-4 requires deterministic rule evaluation, not a model judgment.');

  if ((envelope.phase ?? 'actions') !== 'actions' || !Array.isArray(envelope.tools)) {
    throw new Error('The actual worker did not send the bounded action proposal envelope.');
  }

  // Deterministic TEST provider, not live model acceptance. It reads no dataset or
  // expectation file and emits no observed values: only opaque platform tool IDs.
  const navigation = envelope.tools.find((tool) => tool.action === 'navigate');
  const selected = navigation ? [navigation] : envelope.tools.filter((tool) =>
    tool.action === 'read-attribute' || tool.action === 'read-metadata');
  if (selected.length === 0) throw new Error('The actual worker exposed no approved P-4 read.');
  process.stdout.write(`Synthetic ProdConsole journey provider:${JSON.stringify({
    phase: 'actions', actions: selected.map((tool) => tool.action),
    snapshotTimeToolPresent: envelope.tools.some((tool) => tool.description === 'Read the approved ProdConsole snapshot time.'),
  })}\n`);
  return response(body, {
    actions: selected.map((tool) => ({ toolId: tool.toolId, parameters: [] })),
    uncertainty: { kind: 'none', rationale: null },
  });
};
