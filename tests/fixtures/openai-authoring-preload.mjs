// Test-only transport fixture for the REAL web composition root and installed SDK.
// No production import or runtime image includes this file. It proves transport and
// workflow behavior, not the model's wording quality or semantic faithfulness.
if (process.env.AUTHORING_OPENAI_API_KEY !== 'isolated-synthetic-authoring-fixture') throw new Error('Authoring preload requires its isolated fixture key.');
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== 'api.openai.com') return realFetch(input, init);
  if (url.pathname !== '/v1/responses') throw new Error('Unexpected synthetic authoring endpoint.');
  const body = JSON.parse(init?.body ?? await input.text());
  if (body.model !== 'gpt-5.6-terra' || body.store !== false || body.tools?.length) throw new Error('Unexpected synthetic authoring request.');
  const message = body.input.find(item => item.role === 'user');
  const envelope = JSON.parse(message.content.map(part => part.text ?? '').join(''));
  const notes = envelope.notes;
  if (notes === 'SYNTHETIC:FAIL') return new Response(JSON.stringify({ error: { message: 'Synthetic provider failure', type: 'server_error', code: 'server_error' } }), { status: 503, headers: { 'content-type': 'application/json' } });
  if (notes.startsWith('SYNTHETIC:DELAY ')) await new Promise(resolve => setTimeout(resolve, 2000));
  const proposal = notes === 'SYNTHETIC:CLARIFY'
    ? { proposedText: null, clarifications: ['Which approved criterion should this procedure use?'] }
    : { proposedText: notes.replace(/^SYNTHETIC:DELAY /, '') || envelope.currentText, clarifications: [] };
  return new Response(JSON.stringify({
    id: 'resp_synthetic_authoring', object: 'response', created_at: 1789084800, model: body.model, status: 'completed',
    output: [{ id: 'msg_synthetic_authoring', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(proposal), annotations: [] }] }],
    usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
