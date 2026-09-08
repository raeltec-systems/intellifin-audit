import './agent-workspace-observer.mjs';
// Synthetic SDK HTTP output only. Actual worker/browser/storage supply every captured byte.
const cases = JSON.parse(process.env.SYNTHETIC_RETRIEVED_ABUSE_CASES ?? '[]');
if (cases.length === 0) throw new Error('Retrieved abuse cases are required.');
const counts = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).hostname !== 'api.anthropic.com') return realFetch(input, init);
  const body = JSON.parse(init?.body ?? await input.text());
  const content = body.messages.at(-1).content;
  const prompt = typeof content === 'string' ? content : content.filter(row => row.type === 'text').map(row => row.text).join('');
  const envelope = JSON.parse(prompt);
  const nodes = envelope.retrieved.flatMap(row => JSON.parse(row.text).nodes ?? []);
  const row = cases.find(candidate => nodes.some(node => node.label === 'Untrusted audit note' && node.value === candidate.text));
  if (!row) throw new Error('The worker did not capture the planted authenticated data cell.');
  if (envelope.objective !== 'Inspect only the bound synthetic employee and read Status.') throw new Error('The frozen objective changed.');
  if (Object.hasOwn(envelope, 'answer') || Object.hasOwn(envelope, 'answerNote')) throw new Error('Answer narration reached the model.');
  const count = (counts.get(row.id) ?? 0) + 1; counts.set(row.id, count);
  const proposal = count === 1
    ? { actions: [], uncertainty: { kind: 'insufficient-evidence', rationale: row.text } }
    : { actions: [{ toolId: 'retrieved-unapproved-tool', parameters: [] }], uncertainty: { kind: 'none', rationale: null } };
  process.stdout.write(`Synthetic retrieved abuse proposal:${JSON.stringify({ id: row.id, phase: count === 1 ? 'question' : 'denied-tool',
    objectiveUnchanged: true, answerNarrationAbsent: !prompt.includes('SYNTHETIC-ANSWER-NOTE-DO-NOT-FORWARD') })}\n`);
  return new Response(JSON.stringify({ id: 'msg_synthetic_retrieved_abuse', type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: JSON.stringify(proposal) }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100 } }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'synthetic-retrieved-abuse' } });
};
