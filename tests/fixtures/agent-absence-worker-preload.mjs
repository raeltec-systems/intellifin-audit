// TEST-ONLY synthetic model HTTP. No Observation, search result, source, authentication
// or browser action is fabricated: the compiled worker executes opaque approved tools.
if (process.env.ANTHROPIC_API_KEY !== 'synthetic-agent-absence-interception') {
  throw new Error('Absence journey preload requires its synthetic provider key.');
}
const realFetch = globalThis.fetch;
let sequence = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).hostname !== 'api.anthropic.com') return realFetch(input, init);
  const body = JSON.parse(init?.body ?? await input.text());
  const content = body.messages.at(-1)?.content;
  const text = typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('');
  const envelope = JSON.parse(text);
  if ((envelope.phase ?? 'actions') !== 'actions' || !Array.isArray(envelope.tools)) {
    throw new Error('A proven absent account must not request an applicable privileged-role evaluation.');
  }
  const tool = envelope.tools.find(candidate => candidate.action === 'search') ??
    envelope.tools.find(candidate => candidate.action === 'navigate') ??
    envelope.tools.find(candidate => candidate.action === 'read-attribute');
  if (!tool) throw new Error('Absence journey has no approved action.');
  process.stdout.write(`Synthetic absence provider:${JSON.stringify({ action: tool.action, opaqueTool: typeof tool.toolId === 'string' })}\n`);
  return new Response(JSON.stringify({
    id: `msg_synthetic_absence_${++sequence}`, type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: JSON.stringify({ actions: [{ toolId: tool.toolId, parameters: [] }], uncertainty: { kind: 'none', rationale: null } }) }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 100 },
  }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'synthetic-absence-journey' } });
};
