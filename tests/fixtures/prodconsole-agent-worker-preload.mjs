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
let heldReadAttributeResponse = false;
const READ_ATTRIBUTE_BARRIER_TIMEOUT_MS = 60_000;

if (typeof process.send !== 'function') {
  throw new Error('ProdConsole active-workspace proof requires the worker IPC channel.');
}

function waitForReadAttributeRelease(signal) {
  if (heldReadAttributeResponse) return Promise.resolve();
  heldReadAttributeResponse = true;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const release = (message) => {
      if (message?.type !== 'release-prodconsole-read-attribute-barrier') return;
      finish();
    };
    const disconnected = () => finish(new Error('prodconsole-read-attribute-barrier-disconnected'));
    const aborted = () => finish(new Error('prodconsole-read-attribute-barrier-aborted'));
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off('message', release);
      process.off('disconnect', disconnected);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve();
    };

    // Install every release path before announcing readiness. A parent can answer the
    // readiness message immediately, and a lost parent must never leave this request
    // waiting past the bounded model turn.
    process.on('message', release);
    process.once('disconnect', disconnected);
    signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish(new Error('prodconsole-read-attribute-barrier-timeout')), READ_ATTRIBUTE_BARRIER_TIMEOUT_MS);
    timer.unref?.();
    if (signal?.aborted) {
      finish(new Error('prodconsole-read-attribute-barrier-aborted'));
      return;
    }
    try {
      process.send({ type: 'prodconsole-read-attribute-barrier-ready' }, (error) => {
        if (error) finish(error);
      });
    } catch (error) {
      finish(error);
    }
  });
}

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
  // The second navigation has already committed its real structural snapshot and
  // screenshot before this model turn is requested. Holding this first read response
  // gives the browser proof a bounded ACTIVE Run with a registered frame while the
  // compiled worker remains alive and still serves protected frame grants.
  if (navigation === undefined && selected.some((tool) => tool.action === 'read-attribute')) {
    await waitForReadAttributeRelease(init?.signal);
  }
  process.stdout.write(`Synthetic ProdConsole journey provider:${JSON.stringify({
    phase: 'actions', actions: selected.map((tool) => tool.action),
    snapshotTimeToolPresent: envelope.tools.some((tool) => tool.description === 'Read the approved ProdConsole snapshot time.'),
  })}\n`);
  return response(body, {
    actions: selected.map((tool) => ({ toolId: tool.toolId, parameters: [] })),
    uncertainty: { kind: 'none', rationale: null },
  });
};
