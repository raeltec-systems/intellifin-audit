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
  let proposal = notes === 'SYNTHETIC:CLARIFY'
    ? { proposedText: null, clarifications: ['Which approved criterion should this procedure use?'] }
    : { proposedText: notes.replace(/^SYNTHETIC:(?:DELAY|STREAM) /, '') || envelope.currentText, clarifications: [] };
  if (notes === 'SYNTHETIC:CLARIFY' && envelope.mode === 'revise') {
    if (envelope.revision?.draft !== 'SYNTHETIC:CLARIFY' || !envelope.revision.history.length) throw new Error('Missing clarification conversation.');
    proposal = { proposedText: envelope.changes, clarifications: [] };
  }
  // Explicit synthetic conversation case: exact payload assertions prove the real
  // revision path, not a model's understanding or general wording faithfulness.
  if (notes === 'Synthetic test: Compare every baseline parameter in ProdConsole with the approved baseline. Keep evidence and flag values that cannot be read.') {
    const kept = '1. Read every baseline parameter in ProdConsole.\n2. Compare observed values with the approved baseline.';
    if (envelope.mode === 'revise') {
      if (!envelope.revision?.draft.endsWith('Human note: preserve exact parameter names.')
        || !envelope.changes.includes('Drop the summary by owner.') || !envelope.revision.history.length) throw new Error('Missing synthetic revision context.');
      proposal = { proposedText: `${kept}\n3. Leave missing or unreadable values unresolved and record the reason.\nHuman note: preserve exact parameter names.`, clarifications: [], explanation: 'Kept the first two steps, removed the owner summary, and added a reason for unreadable values. Does that reflect your intent?' };
    } else proposal = { proposedText: `${kept}\n3. Add a separate summary by owner.\n4. Leave missing values unresolved.`, clarifications: [] };
  }
  const complete = {
    id: 'resp_synthetic_authoring', object: 'response', created_at: 1789084800, model: body.model, status: 'completed',
    output: [{ id: 'msg_synthetic_authoring', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ explanation: 'Synthetic provider fixture: review this proposed approach before accepting.', ...proposal }), annotations: [] }] }],
    usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  };
  if (!body.stream) return new Response(JSON.stringify(complete), { headers: { 'content-type': 'application/json' } });
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const send = event => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      send({ type: 'response.created', response: complete });
      send({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_synthetic_authoring' } });
      const text = complete.output[0].content[0].text;
      for (let offset = 0; offset < text.length; offset += 80) {
        send({ type: 'response.output_text.delta', item_id: 'msg_synthetic_authoring', output_index: 0, delta: text.slice(offset, offset + 80) });
        // Deliberate test-only transport pacing: the browser must observe actual
        // incomplete SDK output before completion, never a simulated UI animation.
        await new Promise(resolve => setTimeout(resolve, notes.startsWith('SYNTHETIC:STREAM ') && offset === 0 ? 3000 : 300));
      }
      send({ type: 'response.output_item.done', output_index: 0, item: complete.output[0] });
      send({ type: 'response.completed', response: complete });
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
};
